/**
 * Turning a short text prompt into a draft deck (REQ007).
 *
 * A module of its own for the reason `server/templates.ts` is one (ADR-0032):
 * everything here depends on a model provider, a prompt and the slide
 * vocabulary, and on nothing the presentation service owns — no store, no
 * ownership, no join code, no lifecycle. Delete `services/presentations.ts` and
 * every line below still works. What comes *out* is a plain `Slide[]`, which is
 * why creating the deck from it is a presentation create and lives where the
 * other creates do.
 *
 * **The remote model is the feature, and that is the exception it rides.**
 * ADR-0016 forbids depending on a third-party host to serve first-party assets
 * and allows "explicit third-party product integrations where the remote service
 * is the feature". A generator is that case: there is no asset to bundle, and
 * the thing being asked for is the provider's own answer. The ADR requires such
 * a dependency to be documented — it is, in `docs/deployment.md` and in the
 * README. Two properties keep it from leaking into anything else:
 *
 *   - **Unconfigured is the default, and it fails closed.** No key means no
 *     generation, said out loud through {@link DeckGenerator.availability} so
 *     the surface offering it can disable the control with its reason
 *     (ADR-0025) rather than discovering the fact on a 503. Nothing else in the
 *     product changes when the key is absent.
 *   - **Nothing else in the codebase imports a provider.** The SDK is reached
 *     through a dynamic import inside the one function that calls the model, so
 *     a build, a test run and every route that is not this one never load it.
 *
 * **What the generator may author, and what it deliberately may not.**
 * REQ007's second sentence — "the output is a draft: nothing downstream treats
 * generated content as verified" — is enforced by the *vocabulary*, not by a
 * pass that strips things afterwards. {@link GeneratedSlideSchema} has no field
 * that can express a correct answer: no `isCorrect` on an option, no
 * `quizAnswers`, no `guessReference`, no `pinArea`. So a generated quiz comes
 * back with its questions and its options and **no key**, which is exactly the
 * "no notion of correctness at all" state {@link SlideSchema} already documents
 * for a slide whose author marked nothing — nobody scores, rather than everybody
 * scoring against a guess. Marking the right answer is the one thing a human has
 * to do before the room is scored on it, and it is left to them because a model
 * cannot be the authority for a mark a leaderboard is built on.
 *
 * Nothing records that a deck was generated, for the same reason nothing records
 * that one came from a template: the deck is ordinary and editable from the
 * moment it exists, and a provenance field would be a second thing to keep off
 * every participant-facing payload for no capability in return.
 */

import { z } from "zod";
import {
	DECK_PROMPT_MAX_LENGTH,
	DECK_TITLE_MAX_LENGTH,
	POINTS_ITEM_LIMIT,
	RANKING_ITEM_LIMIT,
	type Slide,
	SLIDE_ITEM_TEXT_MAX_LENGTH,
	SLIDE_OPTION_LIMIT,
	SLIDE_TEXT_MAX_LENGTH,
	SlideSchema,
	type SlideType,
	slideWriteRefusalFor,
} from "./schemas";

// ── What a generator may author ─────────────────────────────

/**
 * The slide types a generated deck may be built from (REQ007 — "slide types …
 * chosen by the generator").
 *
 * Ten of the product's twenty, and the rule is one question: **is the whole
 * slide text somebody can write?** These ten are. The other ten are left out for
 * two distinct reasons, and both are decisions rather than omissions:
 *
 *   - `image`, `video`, `embed` and `pin-image` need an **asset that lives
 *     somewhere else** — a picture, a file, another product's board. A generator
 *     has none to point at, inventing a URL would produce a slide that renders
 *     as a broken frame, and generated media is explicitly not part of this
 *     requirement.
 *   - `grid`, `guess-number` and `form` need a **frame** before they need a
 *     question — two labelled axes with ranges, a numeric span and its
 *     resolution, a set of typed fields. Each is a design decision beyond "what
 *     shall we ask", and each would add fields to the schema below that the
 *     other nine types would leave empty; a `form` is further out still, since
 *     it collects data *about the participant* and nothing should decide to do
 *     that on a one-line brief.
 *
 * The set is a list rather than a rule in code so growing it is one edit here
 * plus the field the new type needs — see {@link draftSlide}.
 */
export const GENERATED_SLIDE_TYPES = [
	"text",
	"instruction",
	"multiple-choice",
	"quiz",
	"word-cloud",
	"open-text",
	"scale",
	"ranking",
	"points",
	"leaderboard",
] as const satisfies readonly SlideType[];

export type GeneratedSlideType = (typeof GENERATED_SLIDE_TYPES)[number];

/**
 * The fewest slides a generated deck is worth returning with. Three: a way in,
 * something to answer, and something to answer after it. Below that the
 * organizer has been handed a question rather than a deck, and would have been
 * quicker off the blank-deck button.
 */
export const GENERATED_DECK_MIN_SLIDES = 3;

/**
 * The most slides one generation produces. Twelve is a session rather than a
 * curriculum, and it is the ceiling the *cost* argument lands on as much as the
 * editorial one — every slide past it is output the operator pays a provider
 * for and an organizer deletes.
 */
export const GENERATED_DECK_MAX_SLIDES = 12;

/**
 * One slide as a **model** may draft it — deliberately far narrower than
 * {@link SlideSchema}, which carries sixty fields across twenty slide types.
 *
 * Flat, and every field a string or a list of strings. A model filling one
 * object per slide with six known keys is a much smaller target than one
 * choosing a branch of a discriminated union with optional nested objects in it,
 * and everything omitted here is a field {@link SlideSchema}'s own defaults fill
 * in (ADR-0029) — which is what makes the expansion below a mapping rather than
 * a construction.
 *
 * Every field carries a default, so a model that answers with only `type` and
 * `question` produces a complete draft rather than a parse failure (ADR-0029),
 * and {@link isUsableDraftSlide} is what decides whether what arrived is a slide
 * at all.
 *
 * **There is nothing here that marks an answer correct**, and that absence is
 * the whole of REQ007's draft rule — see the module note above.
 */
export const GeneratedSlideSchema = z.object({
	type: z.enum(GENERATED_SLIDE_TYPES),
	/** The heading — the question asked, or the content slide's title. */
	question: z.string().default(""),
	/** `text` and `instruction` only: the words under the heading. */
	body: z.string().default(""),
	/** `multiple-choice` and `quiz` only: the answers offered, unmarked. */
	options: z.array(z.string()).default([]),
	/** `ranking` and `points` only: the rows put in order or funded. */
	items: z.array(z.string()).default([]),
	/** `scale` only: what the bottom and the top of the scale mean. */
	scaleMinLabel: z.string().default(""),
	scaleMaxLabel: z.string().default(""),
});

export type GeneratedSlide = z.infer<typeof GeneratedSlideSchema>;

/**
 * A whole deck as a draft is **read back** (REQ007) — lenient, defaulted, and
 * not what the provider is asked for. That is {@link DeckDraftRequestSchema},
 * and the two are separate for a reason this feature failed on before they
 * were:
 *
 * A schema whose every field carries a `.default(...)` converts to a JSON
 * schema with **no required properties**. Handed to a model as a
 * structured-output target it constrains nothing — an object with a title and
 * an empty slide list satisfies it completely — and a model with nothing to
 * fill in fills the one open string it can see, at length. The first live call
 * against this came back with a two-thousand-character title and no slides at
 * all.
 *
 * So the direction of strictness is inverted between the two: **exact in the
 * ask, forgiving in the read.** The provider is told precisely what a deck is
 * and which fields are mandatory; what comes back is then held loosely enough
 * that one malformed slide does not cost the other eleven.
 */
export const GeneratedDeckSchema = z.object({
	title: z.string().default(""),
	slides: z.array(GeneratedSlideSchema).default([]),
});

export type GeneratedDeck = z.infer<typeof GeneratedDeckSchema>;

/**
 * What the **provider** is asked for — every field required, every field
 * described, and the list bounded at both ends.
 *
 * Required is the load-bearing part (see {@link GeneratedDeckSchema}): a model
 * needs to be told what it must produce, and "not applicable" is expressed as an
 * empty string or an empty list rather than by omission — which is also the
 * shape {@link readDeckDraft} is most forgiving of. The descriptions travel into
 * the JSON schema the SDK builds, so they are the one place the field-to-type
 * mapping is stated where the model will actually read it; the brief in
 * {@link deckGenerationInstructions} says the same things in prose, and the two
 * are deliberately redundant because a structured-output model attends to the
 * schema and a chat model attends to the prompt.
 *
 * Still no field that can mark an answer correct — the vocabulary is the same
 * one, and that absence is REQ007's draft rule.
 */
export const DeckDraftRequestSchema = z.object({
	title: z
		.string()
		.max(DECK_TITLE_MAX_LENGTH)
		.describe("A short title naming the occasion — at most eight words."),
	slides: z
		.array(
			z.object({
				type: z
					.enum(GENERATED_SLIDE_TYPES)
					.describe("Which kind of slide this is."),
				question: z
					.string()
					.max(SLIDE_TEXT_MAX_LENGTH)
					.describe(
						"The heading: the question this slide asks the room, or a content slide's title. Never empty.",
					),
				body: z
					.string()
					.max(SLIDE_TEXT_MAX_LENGTH)
					.describe(
						"Only for `text` and `instruction` slides: the words under the heading. An empty string on every other type.",
					),
				options: z
					.array(z.string().max(SLIDE_ITEM_TEXT_MAX_LENGTH))
					.describe(
						"Only for `multiple-choice` and `quiz`: between 2 and 6 answers to choose between, with no indication of which is correct. An empty array on every other type.",
					),
				items: z
					.array(z.string().max(SLIDE_ITEM_TEXT_MAX_LENGTH))
					.describe(
						"Only for `ranking` and `points`: between 2 and 5 rows to put in order or split a budget across. An empty array on every other type.",
					),
				scaleMinLabel: z
					.string()
					.max(SLIDE_ITEM_TEXT_MAX_LENGTH)
					.describe(
						"Only for `scale`: what the bottom of the scale means, e.g. \"Badly\". An empty string on every other type.",
					),
				scaleMaxLabel: z
					.string()
					.max(SLIDE_ITEM_TEXT_MAX_LENGTH)
					.describe(
						"Only for `scale`: what the top of the scale means, e.g. \"Well\". An empty string on every other type.",
					),
			}),
		)
		.min(GENERATED_DECK_MIN_SLIDES)
		.max(GENERATED_DECK_MAX_SLIDES)
		.describe("The slides of the deck, in the order they will be presented."),
});

/**
 * The deck-shaped envelope, with its slides still unread — the outer half of
 * {@link readDeckDraft}.
 */
const DeckDraftEnvelopeSchema = z.object({
	title: z.string().default(""),
	slides: z.array(z.unknown()).default([]),
});

/**
 * What a model actually answered, read as a draft — or `null` when it did not
 * answer with a deck at all.
 *
 * **Slide by slide, not all-or-nothing.** A single entry naming a slide type the
 * generator may not author, or carrying a number where a string belongs, drops
 * *that entry* and nothing else. A strict `z.array(GeneratedSlideSchema)` would
 * refuse the whole draft over it — spending a provider call, and the operator's
 * money, to hand the organizer nothing when eleven of twelve slides were fine.
 *
 * The envelope itself is still all-or-nothing, because an answer that is not
 * deck-shaped is not a draft with a bad slide in it — it is prose, or an error
 * object, or the model ignoring the schema, and there is nothing in it to keep.
 */
export function readDeckDraft(answered: unknown): GeneratedDeck | null {
	const envelope = DeckDraftEnvelopeSchema.safeParse(answered);
	if (!envelope.success) return null;
	const slides = envelope.data.slides.flatMap((slide) => {
		const parsed = GeneratedSlideSchema.safeParse(slide);
		return parsed.success ? [parsed.data] : [];
	});
	return { title: envelope.data.title, slides };
}

// ── A draft becomes slides ──────────────────────────────────

/** The slide types whose question *is* the list of answers under it. */
const CHOICE_DRAFT_TYPES: readonly GeneratedSlideType[] = [
	"multiple-choice",
	"quiz",
];

/**
 * How many rows a drafted list may contribute, per slide type — and, by being
 * keyed only on the types that carry one, which types have a row list at all.
 * {@link isUsableDraftSlide} reads it both ways.
 */
const DRAFT_ROW_LIMITS: Partial<Record<GeneratedSlideType, number>> = {
	"multiple-choice": SLIDE_OPTION_LIMIT,
	quiz: SLIDE_OPTION_LIMIT,
	ranking: RANKING_ITEM_LIMIT,
	points: POINTS_ITEM_LIMIT,
};

/**
 * The rows a drafted list of strings becomes: trimmed, emptied of blanks,
 * identified, and cut to what the slide type accepts.
 *
 * The cut is silent on purpose and is the only silent one here — a model that
 * offered a fifty-first option has offered forty-nine usable ones, and refusing
 * the whole deck over the tail would be spending a provider call to teach an
 * organizer nothing. Text that is *too long* is not cut, because a truncated
 * question changes what was asked; it is refused, by
 * {@link slideWriteRefusalFor} at the end of {@link draftDeckSlides}.
 */
function draftRows(texts: readonly string[], limit: number) {
	return texts
		.map((text) => text.trim())
		.filter((text) => text !== "")
		.slice(0, limit)
		.map((text) => ({ id: crypto.randomUUID(), text }));
}

/**
 * Whether a drafted slide is a slide at all — asked before it is expanded, and
 * the one place a model's misfire is turned into "not this one" rather than into
 * a deck the organizer has to repair.
 *
 * Two floors, and each is the same floor the editor keeps for a human author: a
 * slide needs a question, and a slide that asks somebody to *choose* or to
 * *order* needs at least two things to choose or order between. One option is
 * not a question, and one row is not a ranking (REQ012's two-option floor, and
 * the two blank rows the editor seeds a ranking and a points slide with).
 */
export function isUsableDraftSlide(drafted: GeneratedSlide): boolean {
	if (drafted.question.trim() === "") return false;
	const limit = DRAFT_ROW_LIMITS[drafted.type];
	if (limit === undefined) return true;
	const rows = CHOICE_DRAFT_TYPES.includes(drafted.type)
		? drafted.options
		: drafted.items;
	return draftRows(rows, limit).length >= 2;
}

/**
 * One drafted slide as the deck's own {@link Slide} — a mapping, not a
 * construction: everything this function does not name comes back at
 * {@link SlideSchema}'s default, so a generated slide and a slide the editor
 * made are the same complete shape (ADR-0024/ADR-0029).
 *
 * Each type is handed **only the fields it means**. A `text` slide carrying the
 * options a model volunteered would be a slide with an answer set nothing draws
 * — invisible in the room and confusing in the editor — so the switch is
 * exhaustive rather than a spread of everything that arrived.
 */
function draftSlide(drafted: GeneratedSlide): Slide {
	const base = {
		id: crypto.randomUUID(),
		type: drafted.type,
		question: drafted.question.trim(),
	};
	switch (drafted.type) {
		case "text":
		case "instruction":
			return SlideSchema.parse({ ...base, body: drafted.body.trim() });
		case "multiple-choice":
		case "quiz":
			// No `isCorrect` on any of these rows, and no way to put one there:
			// `draftRows` emits `{ id, text }` and the drafted option was a bare
			// string. This is REQ007's draft rule at the point it would otherwise
			// have to be enforced by remembering to strip something.
			return SlideSchema.parse({
				...base,
				options: draftRows(drafted.options, SLIDE_OPTION_LIMIT),
			});
		case "ranking":
			return SlideSchema.parse({
				...base,
				rankingItems: draftRows(drafted.items, RANKING_ITEM_LIMIT),
			});
		case "points":
			return SlideSchema.parse({
				...base,
				pointsItems: draftRows(drafted.items, POINTS_ITEM_LIMIT),
			});
		case "scale":
			return SlideSchema.parse({
				...base,
				scaleMinLabel: drafted.scaleMinLabel.trim(),
				scaleMaxLabel: drafted.scaleMaxLabel.trim(),
			});
		default:
			// `word-cloud`, `open-text` and `leaderboard` are their question and
			// nothing else — every setting they carry has a default worth having.
			return SlideSchema.parse(base);
	}
}

/**
 * The slides a draft becomes (REQ007): the usable ones, expanded, capped at
 * {@link GENERATED_DECK_MAX_SLIDES}.
 *
 * Pure, and separate from the model call above it (ADR-0010) — which is what
 * lets every claim REQ007 makes about generated *content* be asserted in a test
 * with no key, no network and no provider.
 */
export function draftDeckSlides(draft: GeneratedDeck): Slide[] {
	return draft.slides
		.filter(isUsableDraftSlide)
		.slice(0, GENERATED_DECK_MAX_SLIDES)
		.map(draftSlide);
}

/**
 * What a generated deck is called: the model's title, or the brief it was
 * written from when the model named nothing.
 *
 * The prompt is a better fallback than "Untitled" because it is the one string
 * the organizer definitely recognises — they typed it a few seconds ago — and
 * this deck is about to appear in a list beside every other one they own.
 */
export function draftDeckTitle(draft: GeneratedDeck, prompt: string): string {
	const titled = draft.title.trim();
	const fallback = prompt.trim();
	return (titled || fallback).slice(0, DECK_TITLE_MAX_LENGTH);
}

// ── What the model is asked ─────────────────────────────────

/**
 * The brief handed to the model, built from the organizer's own (REQ007).
 *
 * Pure and exported so what this server asks a third party on a caller's behalf
 * is readable — and assertable — without making the call. Three things it says
 * that the schema cannot: which fields belong to which type (the schema is flat,
 * so nothing stops a model putting options on a text slide), the text ceilings
 * the write boundary will enforce anyway, and that **no answer is to be marked
 * correct** — the schema already makes that impossible, and saying it out loud
 * is what stops a model expressing the mark in prose instead ("Paris (correct)").
 */
export function deckGenerationInstructions(
	prompt: string,
	language: string,
): string {
	return [
		"You are drafting a slide deck for a live audience-participation tool.",
		"The audience answers on their phones and the answers are shown on a shared screen.",
		"",
		`Write every word of the deck in this language: ${language}.`,
		`Draft between ${GENERATED_DECK_MIN_SLIDES} and ${GENERATED_DECK_MAX_SLIDES} slides.`,
		"Open with an `instruction` or `text` slide that says what the session is for, then vary the question types.",
		"",
		"Which fields belong to which slide type — leave every other field empty:",
		"- `text`, `instruction`: `question` is the heading, `body` the words under it.",
		"- `multiple-choice`, `quiz`: `options` holds 2-6 answers to choose between.",
		"- `ranking`, `points`: `items` holds 3-5 rows to put in order or split a budget across.",
		"- `scale`: `scaleMinLabel` and `scaleMaxLabel` say what the bottom and top of the scale mean.",
		"- `word-cloud`, `open-text`: `question` only. A word cloud asks for one word.",
		"- `leaderboard`: `question` only, and only useful in a deck that has `quiz` slides.",
		"",
		"Never mark, name or hint at which answer is correct — not in an option, not in the question, not in the body.",
		"The person running this session marks the answers themselves; a draft that pre-empts them is wrong even when it is right.",
		"",
		`Keep every question and body under ${SLIDE_TEXT_MAX_LENGTH} characters, and every option or item under ${SLIDE_ITEM_TEXT_MAX_LENGTH}.`,
		"Give the deck a short title naming the occasion.",
		"",
		"This is the brief:",
		prompt.trim(),
	].join("\n");
}

// ── Reaching the provider ───────────────────────────────────

/**
 * The environment variable holding the provider credential — the same name
 * `scripts/translate.ts` already reads, because it is the provider's own
 * convention and two names for one key is how a deployment ends up with the
 * feature half-configured.
 */
export const DECK_GENERATION_KEY_ENV = "GOOGLE_GENERATIVE_AI_API_KEY";

/** The environment variable naming which model to ask. */
export const DECK_GENERATION_MODEL_ENV = "OMUL_GENERATION_MODEL";

/**
 * The environment variable that opens generation to callers with no account.
 *
 * **The default is closed, and that is the point.** Every other public route in
 * this product costs the operator something that recovers — disk, sockets, a
 * moment of CPU — and is bounded by the abuse limits accordingly. This one
 * spends a third party's call on the operator's own credential, and money does
 * not recover. The abuse limit alone cannot be the whole control, because
 * `OMUL_RATE_LIMITS_DISABLED` — documented for "a self-hoster on a trusted
 * network" — takes the disk limiter and the money limiter off together: an
 * operator switching off the former inherits the loss of the latter without
 * ever deciding to.
 *
 * So the account requirement is a **second, independent** control that the
 * rate-limit switch cannot reach, and it ships in its most restrictive setting.
 * Turning it off is an explicit, documented opt-in — a deployment that really
 * does want an open drafting service says so, rather than one that never
 * considered the question discovering it from a bill.
 */
export const DECK_GENERATION_ANONYMOUS_ENV = "OMUL_GENERATION_ALLOW_ANONYMOUS";

/**
 * The model asked when the deployment names none.
 *
 * A floating "latest" alias rather than a pinned snapshot, per ADR-0009: a
 * pinned id is a deployment that goes on paying for last year's model until
 * somebody edits this line, and the snapshot behind the alias is the provider's
 * to retire.
 */
export const DEFAULT_DECK_GENERATION_MODEL = "gemini-flash-latest";

/**
 * The most output tokens one draft may spend. Twelve slides of JSON is a couple
 * of thousand; the rest is headroom for a model that reasons before it answers.
 */
export const DECK_GENERATION_MAX_OUTPUT_TOKENS = 8192;

function trimmedEnv(name: string): string {
	return (process.env[name] ?? "").trim();
}

/** Which model this deployment asks. */
export function deckGenerationModelId(): string {
	return trimmedEnv(DECK_GENERATION_MODEL_ENV) || DEFAULT_DECK_GENERATION_MODEL;
}

/**
 * Whether a caller with no account may generate here — `false` unless the
 * operator wrote exactly `"true"`.
 *
 * Read the same way `OMUL_RATE_LIMITS_DISABLED` is (`=== "true"`, never
 * truthiness), so a typo, an empty value or a `"1"` leaves the restrictive
 * setting standing rather than quietly opening the route. See
 * {@link DECK_GENERATION_ANONYMOUS_ENV} for why the default is the closed one.
 */
export function deckGenerationAllowsAnonymous(): boolean {
	return process.env[DECK_GENERATION_ANONYMOUS_ENV] === "true";
}

/**
 * The one function in this codebase that reaches a model provider.
 *
 * The SDK is imported **dynamically**, inside the call, for a reason worth
 * stating: it means a server with no key configured never loads a provider at
 * all, and the whole test suite runs without one being resolvable. It also keeps
 * the module's import graph honest — nothing that merely wants
 * {@link draftDeckSlides} pulls a network client in behind it.
 */
const callGenerationProvider: DeckDraftModel = async ({ prompt, language }) => {
	const [{ createGoogleGenerativeAI }, { generateObject }] = await Promise.all([
		import("@ai-sdk/google"),
		import("ai"),
	]);
	const google = createGoogleGenerativeAI({
		apiKey: trimmedEnv(DECK_GENERATION_KEY_ENV),
	});
	const { object } = await generateObject({
		model: google(deckGenerationModelId()),
		schema: DeckDraftRequestSchema,
		prompt: deckGenerationInstructions(prompt, language),
		// A ceiling on what one draft may cost, and a backstop against the failure
		// mode this schema was rewritten for: a model that starts rambling is
		// stopped rather than billed for, and the truncated JSON surfaces as a
		// stated `provider-failed` refusal instead of a deck.
		maxOutputTokens: DECK_GENERATION_MAX_OUTPUT_TOKENS,
	});
	return object;
};

// ── The generator ───────────────────────────────────────────

/**
 * A call to a model: a brief in, whatever the model answered out. `unknown`
 * deliberately — the answer is re-parsed through {@link GeneratedDeckSchema}
 * whatever produced it, so a provider whose SDK types drift, a stub in a test
 * and a hand-built fake are all held to exactly the same shape.
 */
export type DeckDraftModel = (request: {
	prompt: string;
	language: string;
}) => Promise<unknown>;

/** Why a generation could not be answered — the machine-readable half. */
export const DECK_GENERATION_REFUSALS = [
	"unavailable",
	"account-required",
	"provider-failed",
	"unusable-draft",
] as const;

export type DeckGenerationRefusal = (typeof DECK_GENERATION_REFUSALS)[number];

/** What a generation produced, or why it produced nothing. */
export type DeckGenerationResult =
	| { ok: true; title: string; slides: Slide[] }
	| { ok: false; refused: DeckGenerationRefusal; error: string };

/**
 * Whether this deployment can generate at all, and on what terms — read by
 * `GET /api/deck-generation` and, through it, by the surface that offers the
 * control.
 *
 * `reason` is emitted as an explicit `null` when generation is available
 * (ADR-0024), so a client reads one shape either way and never has to tell "no
 * reason" from "field missing".
 */
export type DeckGenerationAvailability = {
	available: boolean;
	reason: string | null;
	promptMaxLength: number;
	slideTypes: GeneratedSlideType[];
	/**
	 * Whether this deployment requires an account to generate — the second,
	 * rate-limit-independent control (see {@link DECK_GENERATION_ANONYMOUS_ENV}).
	 *
	 * Reported rather than left to be discovered on a 401, because it is exactly
	 * the fact a surface needs to disable its control with the true reason
	 * (ADR-0025). It is a *report*, never a credential: the route re-reads the
	 * switch and re-resolves the caller's account on every request, so a client
	 * that gets this wrong only mis-draws its own button.
	 */
	requiresAccount: boolean;
};

export type DeckGenerator = {
	availability: () => DeckGenerationAvailability;
	generate: (prompt: string, language: string) => Promise<DeckGenerationResult>;
};

const UNAVAILABLE_MESSAGE =
	"This server is not configured to generate decks — no generation provider key is set";
export const ACCOUNT_REQUIRED_MESSAGE =
	"Sign in to generate a deck — this server only drafts for account holders";
const PROVIDER_FAILED_MESSAGE =
	"The generation provider could not be reached — try again, or start from a template";
const UNREADABLE_MESSAGE =
	"The generator answered with something this server could not read as a deck";
const EMPTY_DRAFT_MESSAGE =
	"The generator produced too few usable slides for that prompt — try describing the session in more detail";

/**
 * A deck generator (ADR-0007 — a factory over a class, closing over the model
 * rather than holding it in a field).
 *
 * `model` exists so the whole HTTP path can be driven in a test with no key and
 * no network: the routes take a generator rather than reaching for the default
 * one, and a suite hands them a generator over a stub. It is a seam rather than
 * a `dryRun` flag deliberately, the way the participant surfaces' vote transport
 * is (ADR-0010): a flag would leave the provider call sitting in this module
 * with an `if` around it, one edit away from a test suite that bills somebody.
 */
export function createDeckGenerator(
	options: { model?: DeckDraftModel | null } = {},
): DeckGenerator {
	const injected = options.model ?? null;

	/**
	 * Read at call time rather than at module load: a deployment's key arrives
	 * in the environment, and a test that sets or clears one between cases must
	 * not be answered from a value read at import.
	 */
	function configured(): boolean {
		return injected !== null || trimmedEnv(DECK_GENERATION_KEY_ENV) !== "";
	}

	function availability(): DeckGenerationAvailability {
		const available = configured();
		return {
			available,
			reason: available ? null : UNAVAILABLE_MESSAGE,
			promptMaxLength: DECK_PROMPT_MAX_LENGTH,
			slideTypes: [...GENERATED_SLIDE_TYPES],
			requiresAccount: !deckGenerationAllowsAnonymous(),
		};
	}

	async function generate(
		prompt: string,
		language: string,
	): Promise<DeckGenerationResult> {
		if (!configured()) {
			return { ok: false, refused: "unavailable", error: UNAVAILABLE_MESSAGE };
		}
		const model = injected ?? callGenerationProvider;

		let answered: unknown;
		try {
			answered = await model({ prompt, language });
		} catch (cause) {
			// The operator needs the provider's own words; the caller gets a
			// sentence that says what to do instead. A provider error can carry a
			// request id, a quota state or a fragment of the prompt, and none of
			// that is a client's to read off a failed deck.
			console.error("[deck-generation] provider call failed:", cause);
			return {
				ok: false,
				refused: "provider-failed",
				error: PROVIDER_FAILED_MESSAGE,
			};
		}

		const drafted = readDeckDraft(answered);
		if (!drafted) {
			return {
				ok: false,
				refused: "unusable-draft",
				error: UNREADABLE_MESSAGE,
			};
		}

		// The floor is checked on what *survived* {@link isUsableDraftSlide},
		// not on what the model sent. `DeckDraftRequestSchema` asks for at least
		// three, but asking is not getting: a draft of exactly three whose middle
		// slide is a choice question with one usable option is dropped to two here,
		// and two is the "a question rather than a deck" the constant exists to
		// refuse. Enforcing it only in the ask left the floor documented and
		// unheld.
		const slides = draftDeckSlides(drafted);
		if (slides.length < GENERATED_DECK_MIN_SLIDES) {
			return {
				ok: false,
				refused: "unusable-draft",
				error: EMPTY_DRAFT_MESSAGE,
			};
		}

		// The same gate the two authoring doors are held to (REQ159). This path
		// creates a deck without passing a request body through
		// `CreatePresentationSchema`, so the ceiling on authored text has to be
		// asked for here — otherwise a chatty model's five-thousand-character
		// question would be refused by the document store as a 500 instead of by
		// this function as a stated refusal.
		const refusal = slideWriteRefusalFor(slides);
		if (refusal) {
			return {
				ok: false,
				refused: "unusable-draft",
				error: `The generator produced a slide this deck cannot hold. ${refusal.message}`,
			};
		}

		return {
			ok: true,
			title: draftDeckTitle(drafted, prompt),
			slides,
		};
	}

	return { availability, generate };
}

/**
 * The generator the server runs — the real provider, configured from the
 * environment. Routes take one as an argument and default to this, so the
 * production wiring is a default rather than a reach.
 */
export const deckGenerator: DeckGenerator = createDeckGenerator();

/**
 * What generation amounts to in *this* deployment, stated on every boot — the
 * same reason the rate limiter and the discovery origin state theirs: a server
 * with no key configured is indistinguishable from a broken one to everybody
 * except the process that knows why, and "the generate button does nothing" is
 * the report an operator would otherwise get from a user.
 */
export function deckGenerationStartupReport(): string[] {
	if (!deckGenerator.availability().available) {
		return [
			`[deck-generation] off — ${DECK_GENERATION_KEY_ENV} is not set. Decks can still be created blank or from a template.`,
		];
	}
	const lines = [
		`[deck-generation] on — prompts are sent to the model "${deckGenerationModelId()}" via ${DECK_GENERATION_KEY_ENV}.`,
	];
	// Who may spend that credential is the other half of the posture, and the
	// half an operator is most likely to be wrong about — so it is stated
	// whenever generation is on, not only when it has been opened up.
	if (deckGenerationAllowsAnonymous()) {
		lines.push(
			`[deck-generation] OPEN — ${DECK_GENERATION_ANONYMOUS_ENV}="true", so callers with no account can spend your provider budget.`,
			"[deck-generation] Only the abuse limits bound this, and OMUL_RATE_LIMITS_DISABLED would remove those too.",
		);
	} else {
		lines.push(
			"[deck-generation] Restricted to signed-in accounts (the default). Set " +
				`${DECK_GENERATION_ANONYMOUS_ENV}="true" to open it to anonymous callers.`,
		);
	}
	return lines;
}
