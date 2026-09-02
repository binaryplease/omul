import { z } from "zod";

// ── Slide types ──────────────────────────────────────────────

export const SlideTypeEnum = z.enum([
	// Interactive slide types
	"multiple-choice",
	"word-cloud",
	"open-text",
	"scale",
	"ranking",
	"grid",
	"points",
	"guess-number",
	"pin-image",
	"quiz",
	// Form (REQ061) — several typed fields answered as one submission
	"form",
	// Standings (REQ059) — a slide that reports on the quiz questions around it
	"leaderboard",
	// Content slide types (REQ062/063/064/065/118, REQ066/067/068)
	"text",
	"image",
	"video",
	"embed",
	"instruction",
]);

export type SlideType = z.infer<typeof SlideTypeEnum>;

/** A slide type is "interactive" if participants submit votes/responses to it. */
export const INTERACTIVE_SLIDE_TYPES: readonly SlideType[] = [
	"multiple-choice",
	"word-cloud",
	"open-text",
	"scale",
	"ranking",
	"grid",
	"points",
	"guess-number",
	"pin-image",
	"quiz",
	"form",
];

export function isInteractiveSlideType(type: SlideType): boolean {
	return INTERACTIVE_SLIDE_TYPES.includes(type);
}

/**
 * Whether a slide has an aggregate on the results endpoint at all — the single
 * question every surface that fetches or polls one asks (ADR-0026).
 *
 * Not the same question as {@link isInteractiveSlideType}, and REQ059 is why
 * they parted: a leaderboard slide takes no votes of its own, yet its entire
 * content is a server-derived aggregate. A surface that gated its fetch on
 * "does this slide collect answers" would render an empty board; one that gated
 * it on "is this a content slide" would poll a text slide forever.
 */
export function slideHasResults(type: SlideType): boolean {
	return isInteractiveSlideType(type) || type === "leaderboard";
}

/**
 * Whether an individual answer submitted to this slide type may be taken back
 * out of it by an editor (REQ027) — the one question the delete boundary and
 * every surface that draws the control ask (ADR-0026).
 *
 * Two types, and the reason is what an answer *is* on each of them: a word and
 * a written response are the room's own text, published verbatim on the shared
 * screen, and the one thing an organizer cannot do about a line they must not
 * project is un-say it. Every other type's answer is a *choice* — an option id,
 * a rating, a point on a grid — which carries nothing to withdraw and whose
 * removal would silently re-weight a distribution instead of removing something
 * from a screen. So the set is listed rather than derived from "does this slide
 * take free text", which would sweep in a typed quiz answer (REQ055): that row
 * is scored, and deleting it would change a competitor's standing rather than
 * moderate a wall.
 */
export function slideAnswersAreDeletable(type: SlideType): boolean {
	return type === "word-cloud" || type === "open-text";
}

/**
 * The slide types that *show* something rather than ask something
 * (REQ062 text, REQ063 image, REQ064 video, REQ066/REQ067/REQ068 embedded decks
 * and boards, REQ065/REQ118 join instructions).
 *
 * Listed rather than derived as "not interactive", because the two are not the
 * same set and a leaderboard is the proof: it asks nothing and is still not
 * content — it draws a server-derived aggregate, which is exactly what a
 * content slide never does. An embed slide is content by the same test: a Miro
 * board is worked in rather than read (REQ068), but nothing the room does to it
 * comes back to this service as an answer, so there is no aggregate to draw.
 */
export const CONTENT_SLIDE_TYPES: readonly SlideType[] = [
	"text",
	"image",
	"video",
	"embed",
	"instruction",
];

/**
 * Whether a slide is authored as content rather than as a question (ADR-0026).
 *
 * Four surfaces ask this and each used to spell the union itself — the editor
 * (which fields to offer), the preview pane and both live views (which renderer
 * to use), and the create form (a content slide needs no question). One reading,
 * so a content type added later cannot arrive on three of the four.
 */
export function isContentSlideType(type: SlideType): boolean {
	return CONTENT_SLIDE_TYPES.includes(type);
}

/**
 * What each slide type is **called**, in the words a person reads (ADR-0026).
 *
 * One descriptor, because the name of a type is now written on both sides of
 * the wire: the editor's "Add slide" menu and its type-changer popover compose
 * it (`src/components/SlideTypeMenu.tsx`, which re-exports it), and so does the
 * PDF the server renders a deck into (REQ096) — a document a person reads, in
 * which `guess-number` is storage rather than a name. Two spellings is how a
 * deck comes to be a "Guess the Number" slide in the editor and a
 * "guess-number" one in the file the organizer hands round.
 *
 * It lives here for the reason {@link deckFilenameSlug} does: this is the module
 * both sides already compose their shared rules from, and a label depends on
 * nothing but {@link SlideType} — not on the DOM the menu draws into, and not on
 * the PDF writer the server streams through (ADR-0032).
 */
export const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
	"multiple-choice": "Multiple Choice",
	"word-cloud": "Word Cloud",
	"open-text": "Open Text / Q&A",
	scale: "Scale / Rating",
	ranking: "Ranking",
	grid: "2x2 Grid",
	points: "100 Points",
	"guess-number": "Guess the Number",
	"pin-image": "Pin on Image",
	quiz: "Quiz",
	form: "Form",
	leaderboard: "Leaderboard",
	text: "Text",
	image: "Image",
	video: "Video",
	embed: "Embedded Deck",
	instruction: "How to Join",
};

// ── Results visibility (REQ102) ──────────────────────────────
//
// When aggregated results appear on the shared screen is a deck-level setting
// with an optional per-slide override. The three concrete modes live on the
// presentation as its default; each slide either picks one of them (overriding
// the deck) or "inherit"s the deck default.

/** The three ways aggregated results can appear on the shared screen (REQ102). */
export const ResultsVisibilityEnum = z.enum(["instant", "on-click", "private"]);
export type ResultsVisibility = z.infer<typeof ResultsVisibilityEnum>;

/**
 * A slide's results-visibility setting: one of the three concrete modes (which
 * overrides the deck for that slide) or "inherit" (the default) to follow the
 * presentation's deck-level `resultsVisibility`.
 */
export const SlideResultsVisibilityEnum = z.enum([
	"inherit",
	"instant",
	"on-click",
	"private",
]);
export type SlideResultsVisibility = z.infer<typeof SlideResultsVisibilityEnum>;

/**
 * The results visibility actually in effect for a slide on the shared screen
 * (REQ102): the slide's own override when it sets one, otherwise the deck-level
 * default it inherits. This precedence is expressed once here (ADR-0026) so the
 * presenter and participant surfaces never re-derive it.
 */
export function effectiveResultsVisibility(
	slideVisibility: SlideResultsVisibility | undefined,
	deckVisibility: ResultsVisibility,
): ResultsVisibility {
	if (slideVisibility && slideVisibility !== "inherit") return slideVisibility;
	return deckVisibility;
}

/**
 * The presentation state {@link tallyVisibleToAudience} reads. Structural — like
 * {@link SolutionRevealState} — so a stored document, a parsed response and a
 * client-side presentation all satisfy it without conversion.
 */
export type TallyRevealState = {
	resultsVisibility?: ResultsVisibility | undefined;
	revealedSlideIds?: string[] | undefined;
};

/**
 * Whether a slide's **tally** may be published to the audience at all
 * (REQ015/REQ016/REQ017) — the three reveal modes read as a publication
 * decision rather than as a rendering one.
 *
 *  - `instant` publishes as each answer lands (REQ015);
 *  - `on-click` collects silently and publishes only on the presenter's reveal
 *    (REQ016), which is the per-session control REQ102 shipped;
 *  - `private` never publishes (REQ017) — the answers are still recorded and
 *    still reachable on the results surface, which is authorized as an edit.
 *
 * **This is the gate, not a hint to a renderer.** Every surface that hands a
 * tally to somebody who cannot edit the deck passes through it — the results
 * endpoints and the `results.updated` broadcast alike — because a room-wide
 * frame that carries a withheld tally has published it whatever the receiving
 * client then chooses to draw. `role` on a socket is self-declared and proves
 * nothing (see `server/ws.ts`), so "who may see this" is answered here from the
 * deck's own state and from the caller's proven credential, never from what a
 * client said it was.
 *
 * Deliberately stricter than {@link solutionVisibleToAudience} on one point: an
 * ended deck does **not** publish a tally its mode withheld. An answer key has
 * nothing left to game once the room is done, but "never on screen" and "only
 * when I reveal it" are decisions the organizer made about their own numbers,
 * and ending a session is not the organizer revealing them. It is also what
 * keeps this in step with the participant surface, which reads the same rule.
 */
export function tallyVisibleToAudience(
	slide: {
		id: string;
		resultsVisibility?: SlideResultsVisibility | undefined;
	},
	deck: TallyRevealState,
): boolean {
	const visibility = effectiveResultsVisibility(
		slide.resultsVisibility,
		deck.resultsVisibility ?? "instant",
	);
	if (visibility === "instant") return true;
	if (visibility === "private") return false;
	return (deck.revealedSlideIds ?? []).includes(slide.id);
}

/**
 * What a caller has proved about itself when it asks for a tally.
 *
 * Two independent capabilities, and neither implies the other:
 *
 *  - `canEdit` — the deck's owner, or the holder of its edit token. Reads
 *    everything the organizer authored: the tallies under every reveal mode, a
 *    running quiz question's answer key (REQ056), the presenter's notes
 *    (REQ090), a Form slide's per-participant rows (REQ061).
 *  - `hasResultsLink` — the holder of the deck's shareable results link
 *    (REQ098). Reads the **tallies** under every reveal mode and *nothing else*
 *    an editor reads. The link is a delegation of the numbers, not of the
 *    credential that authored them, and REQ099 will hand it to participants.
 *
 * Both default to the withholding value where they are read, so a surface that
 * forgets to say who is asking publishes nothing.
 */
export type ResultsCaller = {
	canEdit?: boolean | undefined;
	hasResultsLink?: boolean | undefined;
};

/**
 * Whether **this caller** may be sent this slide's tally — the one question the
 * results endpoints and the `results.updated` broadcast ask (ADR-0026).
 *
 * {@link tallyVisibleToAudience} answers it for the room; this answers it for a
 * request, by composing that gate with the two credentials a request can carry.
 * The composition lives here rather than at each call site because a second copy
 * is how one surface comes to disagree with the next about who reads a `private`
 * slide.
 *
 * The results link lifts the reveal-mode gate and **only** that gate: it is the
 * organizer deliberately delegating a read of their own numbers, which is what
 * REQ098 asks for and what the mode — a decision about what the *room* is shown
 * while the session runs — has no say over once the link has been minted.
 */
export function tallyVisibleToCaller(
	slide: {
		id: string;
		resultsVisibility?: SlideResultsVisibility | undefined;
	},
	deck: TallyRevealState,
	caller: ResultsCaller,
): boolean {
	if (caller.canEdit) return true;
	if (caller.hasResultsLink) return true;
	return tallyVisibleToAudience(slide, deck);
}

/** What a caller reads in place of a tally their reveal mode withholds. */
export type WithheldTally = { type: SlideType; withheld: true };

/**
 * The audience's view of a tally that has not been published to them
 * (REQ016/REQ017): the slide type it belongs to, and the plain statement that
 * the numbers are not in this payload.
 *
 * Stated rather than silently emptied, because an empty tally is a lie a client
 * would draw — "0 of 0 answered" under a question twenty people have answered.
 * Announcing it costs nothing: the reveal mode itself already rides the deck
 * payload every participant holds, so which slides are withholding is something
 * they can read either way, and both live surfaces say so on screen in words.
 */
export function withheldTally(type: SlideType): WithheldTally {
	return { type, withheld: true };
}

/** Whether a results payload is the withheld marker rather than a tally. */
export function isWithheldTally(results: unknown): boolean {
	return (
		typeof results === "object" &&
		results !== null &&
		(results as { withheld?: unknown }).withheld === true
	);
}

/**
 * Every slide that puts a tally on screen returned to the deck's reveal mode
 * (REQ018) — the slide half of "set it once for the deck, and let it apply to
 * every question slide in it".
 *
 * The mode itself is not written onto each slide: the deck already carries it
 * and {@link effectiveResultsVisibility} already resolves it, so what this does
 * is **clear the per-slide overrides that would otherwise sit above it**. That
 * is the only thing standing between a deck-level setting and every question
 * slide obeying it, and it keeps them together afterwards — the next deck-level
 * change moves the whole deck again rather than only the slides nobody had
 * touched.
 *
 * Content slides are left alone: they show something rather than ask something,
 * have no tally, and carry the field only because every slide shares one shape.
 * The set is {@link slideHasResults}, so a slide type that gains an aggregate
 * later is swept up here without this function being edited.
 *
 * It **loosens as readily as it tightens**, and that is the operation, not an
 * oversight: an organizer applying `instant` to the deck is asking for every
 * question slide to publish live, including the ones an earlier decision pinned
 * to `on-click` — a Pin on Image slide with a target area (REQ053) among them,
 * whose target is drawn on the reveal this clears. The surface offering it says
 * so before it is used; what it must not do is quietly apply to some slides and
 * not others, which would leave the organizer believing the deck is uniform.
 */
export function withInheritedResultsVisibility<
	SlideShape extends {
		type?: SlideType | undefined;
		resultsVisibility?: SlideResultsVisibility | undefined;
	},
>(slides: SlideShape[]): SlideShape[] {
	return slides.map((slide) =>
		slide.type && slideHasResults(slide.type)
			? { ...slide, resultsVisibility: "inherit" as SlideResultsVisibility }
			: slide,
	);
}

// ── The live room: participation and the blank screen (REQ111, REQ109) ──
//
// Two decisions a presenter makes about the room while it is in front of them,
// and they are written together because they are the two halves REQ109 exists
// to keep apart: whether this slide is **taking answers**, and whether the
// shared screen is **showing anything**. Blanking the screen must not stop the
// room answering, and closing a question must not take the slide off the wall.
// So they are two fields, moved by two routes, and neither is derived from the
// other — a surface that read one off the other would be exactly the coupling
// the requirement rules out.
//
// Both are **server-managed live state**, like `revealedSlideIds` and
// `slideStartedAt` beside them rather than like the authored fields: they
// belong to a session rather than to a deck, they are absent from
// {@link UpdatePresentationSchema} and from the export payload, and a reset
// clears them along with the votes they were paced around.
//
// Both are **public**, for the reason the reveal set is: a phone has to know
// whether the control in front of it will be honoured (ADR-0025 — the reason a
// disabled control gives has to be the true one), and the screen being
// projected may be a second browser rather than the presenter's own.

/**
 * The presentation state {@link slideAcceptsSubmissions} and
 * {@link audienceViewBlanked} read. Structural — like {@link TallyRevealState}
 * — so a stored document, a parsed response and a client-side presentation all
 * satisfy it without conversion.
 */
export type LiveRoomState = {
	closedSlideIds?: string[] | undefined;
	audienceBlanked?: boolean | undefined;
};

/**
 * Whether a slide is currently taking submissions (REQ111).
 *
 * **The stored set is the slides that are closed, not the ones that are open**,
 * and the polarity is load-bearing rather than incidental. A deck's ordinary
 * state is that every slide takes answers: that is what an unopened deck, a
 * deck written before this field existed, and a deck whose presenter never
 * touched the control all mean, and all three re-parse onto `[]` (ADR-0029).
 * Storing the open set instead would make "nothing recorded" read as "nothing
 * takes answers" — a whole room silently refused because a field defaulted.
 *
 * This is the deck-state half of the answer only. Whether the *presentation* is
 * collecting at all is {@link acceptsSubmissions} on the server, and the two are
 * independent questions: a slide can be open on a deck that has not been
 * started, and closed on one that is live.
 */
export function slideAcceptsSubmissions(
	deck: LiveRoomState,
	slideId: string,
): boolean {
	return !(deck.closedSlideIds ?? []).includes(slideId);
}

/**
 * The closed set with one slide opened or closed (REQ111) — the one reading of
 * what the toggle does (ADR-0026), composed by the route that writes it and by
 * the session store that applies its broadcast.
 *
 * Pure and idempotent: closing a slide that is already closed writes the same
 * set back, so a double-tap and a broadcast that arrives twice both land on the
 * state the presenter asked for.
 */
export function withSlideParticipation(
	closedSlideIds: readonly string[],
	slideId: string,
	open: boolean,
): string[] {
	return open
		? closedSlideIds.filter((closedId) => closedId !== slideId)
		: Array.from(new Set([...closedSlideIds, slideId]));
}

/**
 * The reasons a well-formed submission is turned away with a *stated* refusal
 * (REQ054/REQ057/REQ111) — the wire vocabulary, shared by the route that sends
 * it beside its English `error` text and the participant UI that maps it onto
 * the deck's own language (REQ084). Declared here rather than in the service
 * because both ends of the wire read it (ADR-0013): a client left to guess the
 * reason from local state shows the wrong one the moment its state and the
 * server's disagree, which a refusal is *for*.
 */
export const VOTE_REFUSAL_CODES = [
	"quiz-window-closed",
	"quiz-already-answered",
	"participation-closed",
] as const;

/** One entry of {@link VOTE_REFUSAL_CODES}. */
export type VoteRefusalCode = (typeof VOTE_REFUSAL_CODES)[number];

/** Whether an error body's `refused` field names a refusal this vocabulary knows. */
export function isVoteRefusalCode(value: unknown): value is VoteRefusalCode {
	return VOTE_REFUSAL_CODES.includes(value as VoteRefusalCode);
}

/**
 * Whether the shared screen is currently blanked (REQ109).
 *
 * Deck-level rather than per-slide, and deliberately **sticky across
 * navigation**: the presenter took the room's attention off the wall, and the
 * wall staying dark while they line up what comes next is the point. What it
 * does not touch is anything else — the active slide, the question's window,
 * the answers already collected, or whether this slide is taking more of them.
 */
export function audienceViewBlanked(deck: LiveRoomState): boolean {
	return deck.audienceBlanked ?? false;
}

// ── Multiple-choice settings (REQ010, REQ011, REQ014) ────────
//
// The three knobs an organizer turns on a choice slide, defined once here and
// consumed by the editor, the participant surface, the presenter surface and
// the results aggregation alike (ADR-0013/ADR-0026).

/**
 * How a choice slide's results are drawn on the shared screen (REQ010).
 * `bars` is the classic percentage bar chart, `donut`/`pie` the proportional
 * ring and disc, `dots` one animated dot per vote (omul-style).
 */
export const McDisplayStyleEnum = z.enum(["bars", "donut", "pie", "dots"]);
export type McDisplayStyle = z.infer<typeof McDisplayStyleEnum>;

/**
 * Whether a choice result reads as an absolute count, a percentage, or both
 * (REQ011). The slide setting is the deck author's default; the presenter can
 * switch it live on the shared screen without editing the deck.
 */
export const McValueDisplayEnum = z.enum(["count", "percentage", "both"]);
export type McValueDisplay = z.infer<typeof McValueDisplayEnum>;

/**
 * How large a slide's authored text is drawn (REQ091) — its heading and, on a
 * content slide, its body.
 *
 * Named steps rather than a number of pixels, because the same deck is read
 * from a phone held at arm's length and from the back of a lecture hall: a
 * stored `28px` would be one of those two and wrong on the other. Each step is
 * a *multiplier* every surface applies to its own base size, so the compact
 * preview pane stays a preview and the projector stays a projector while the
 * organizer's choice still reads as the same relative jump on both.
 *
 * `medium` is the size every deck authored before this setting existed, and it
 * is exactly today's rendering — the default has to leave an untouched deck
 * looking untouched.
 */
export const SlideTextSizeEnum = z.enum([
	"small",
	"medium",
	"large",
	"x-large",
]);
export type SlideTextSize = z.infer<typeof SlideTextSizeEnum>;

// ── Slide schemas ────────────────────────────────────────────

export const MultipleChoiceOptionSchema = z.object({
	id: z.string(),
	text: z.string(),
	/**
	 * Marks this option as (one of) the correct answer(s) — REQ013. Available on
	 * quiz **and** multiple-choice slides: a knowledge check on a plain choice
	 * slide wants a solution to reveal, without the scoring a quiz competition
	 * slide brings (REQ054–REQ059). Left `undefined` on slides whose author never
	 * marked anything; {@link slideHasCorrectAnswers} is the single read site
	 * that decides whether a slide has a notion of correctness at all.
	 */
	isCorrect: z.boolean().optional(),
});

/**
 * How a quiz question is answered (REQ054 select, REQ055 type).
 *
 * A mode on the quiz slide rather than a second slide type, because everything
 * that makes a quiz a quiz is the same either way: one final answer, inside the
 * presenter's window, scored on correctness plus speed, listed on the same
 * scorecard, with its answer key withheld from competitors until the question is
 * over. What differs is only how the answer is *given* — picked from options, or
 * typed — so that is what the field names (ADR-0027: the unit of sharing is the
 * invariant).
 */
export const QuizAnswerModeEnum = z.enum(["select", "type"]);
export type QuizAnswerMode = z.infer<typeof QuizAnswerModeEnum>;

/**
 * One solution a typed quiz answer may match (REQ055). Carries an id for the
 * same reason every other authored list here does — a stable identity to edit
 * and remove a row by — while the `text` is the whole datum: it is compared
 * against what a participant typed, never sent as an id.
 */
export const QuizAnswerSchema = z.object({
	id: z.string(),
	text: z.string(),
});

export type QuizAnswer = z.infer<typeof QuizAnswerSchema>;

/**
 * How many accepted solutions one typed quiz question may carry (REQ055). Ten,
 * the same ceiling a ranking's items land on, and for the closest reason: the
 * list exists so an organizer can spell out the spellings a strict comparison
 * would otherwise refuse ("USA", "U.S.A.", "United States"), and past ten
 * variants the honest fix is a different question, not a longer answer key.
 */
export const QUIZ_ANSWER_LIMIT = 10;

/**
 * How many ranks a leaderboard slide shows by default (REQ059). Five, because
 * the board's job on the shared screen is the *top* of the field — far enough
 * down that a room recognises a race, short enough that every row is legible
 * from the back at a glance. Everyone else's standing is told to them on their
 * own screen, where there is one row to read rather than forty.
 */
export const LEADERBOARD_DEFAULT_SIZE = 5;

/**
 * The most ranks one leaderboard slide may show. Twenty, the point past which a
 * projected board stops being a picture of the competition and becomes a
 * directory — the same reasoning that caps a guess distribution's columns.
 */
export const LEADERBOARD_SIZE_LIMIT = 20;

/** A single statement on a Scales slide (REQ029). */
export const ScaleStatementSchema = z.object({
	id: z.string(),
	text: z.string(),
});

/** Intermediate label on the scale axis (REQ032). */
export const ScaleLabelSchema = z.object({
	value: z.number(),
	label: z.string(),
});

/** A single item participants put in order on a Ranking slide (REQ034). */
export const RankingItemSchema = z.object({
	id: z.string(),
	text: z.string(),
});

/**
 * How many items one Ranking slide may offer (REQ034 — omul caps the item
 * count per question type). Ten, rather than the five `scaleStatements` allows:
 * a scale statement is answered independently, so five is a comfortable page,
 * while a ranking is one ordering the participant has to hold in their head and
 * physically reorder on a phone — the ceiling is what stays draggable, and past
 * ten the list needs scrolling while being moved through. Ten also keeps the
 * encoded submission (`encodeRanking`) inside `VoteSchema.value`'s 500-character
 * budget with UUID item ids. Declared once here and composed by the schema's
 * `.max()` and the editor's add-item button (ADR-0026).
 */
export const RANKING_ITEM_LIMIT = 10;

/** Separator between item ids in a ranking submission's `value`. */
const RANKING_VALUE_SEPARATOR = ",";

/** A single item participants place on a 2x2 Grid slide (REQ047). */
export const GridItemSchema = z.object({
	id: z.string(),
	text: z.string(),
});

/**
 * One dimension of a 2x2 Grid — everything the organizer authors about a single
 * axis (REQ048, REQ049). Written once and worn by both the horizontal and the
 * vertical axis (ADR-0026), so the two can never offer different settings:
 *
 *  - `title` names what the dimension measures ("Effort", "Impact") — REQ048.
 *  - `min`/`max` are its numeric endpoints, so the axis reads as a range
 *    (0–10) as well as a pair of poles — REQ049.
 *  - `minLabel`/`maxLabel` name those poles ("Low"/"High"). Empty is not a
 *    missing label: it means "read this end as its number", which is how the
 *    scale endpoints already behave.
 */
export const GridAxisSchema = z.object({
	title: z.string().default(""),
	min: z.number().int().default(0),
	max: z.number().int().default(10),
	minLabel: z.string().default(""),
	maxLabel: z.string().default(""),
});

export type GridAxis = z.infer<typeof GridAxisSchema>;

/**
 * How many items one 2x2 Grid slide may offer (REQ047). Eight, between the five
 * `scaleStatements` and the ten `rankingItems` allow: a grid item costs a
 * participant two judgements rather than one, and every item also has to stay
 * legible as a labelled dot on one shared plot — past eight the labels collide
 * on the shared screen, which is the whole point of the slide. Declared once
 * here and composed by the schema's `.max()` and the editor's add-item button
 * (ADR-0026).
 */
export const GRID_ITEM_LIMIT = 8;

/** Separator between the two coordinates in a grid placement's `value`. */
const GRID_VALUE_SEPARATOR = ",";

/** A single item participants fund on a 100 Points slide (REQ045). */
export const PointsItemSchema = z.object({
	id: z.string(),
	text: z.string(),
});

/**
 * The budget one participant distributes across a 100 Points slide's items
 * (REQ044). Fixed rather than authored: "100 points" is the format's name and
 * the mental model it trades on — a share of the budget reads as a percentage
 * without anyone converting it — and a per-slide budget would make two slides'
 * results incomparable for no gain the item weights don't already give.
 * Declared once here and composed by the codec that enforces it, the tally that
 * divides by it, and the participant surface that counts down from it
 * (ADR-0026).
 */
export const POINTS_BUDGET = 100;

/**
 * How many items one 100 Points slide may offer (REQ045). Eight — fewer than
 * the ten `rankingItems` allow, and the same ceiling `gridItems` land on for an
 * unrelated reason.
 *
 * Ranking and grid items are answered *independently*: moving one item up an
 * order, or nudging one dot, leaves every other answer standing. A 100 Points
 * item cannot be answered on its own — the items share one budget, so every
 * change forces the participant to re-check the remainder against all of them
 * at once. That is the interdependence that caps the list, and it bites sooner
 * than the ten a ranking tolerates: on a phone, past eight rows the running
 * subtotal no longer fits on screen with the list it describes.
 *
 * Eight also keeps an encoded allocation (`encodePoints`) at ~330 of
 * `VoteSchema.value`'s 500 characters with UUID item ids, where the hard
 * ceiling would be twelve. Declared once here and composed by both the schema's
 * `.max()` and the editor's add-item button (ADR-0026).
 */
export const POINTS_ITEM_LIMIT = 8;

/** Separator between one item's allocations in a 100 Points `value`. */
const POINTS_VALUE_SEPARATOR = ",";

/** Separator between an item id and the points it was given. */
const POINTS_ALLOCATION_SEPARATOR = ":";

/**
 * The frame a Guess the Number slide offers (REQ040, REQ043): where the
 * permitted numbers start and end, and how far apart the selectable ones sit.
 *
 * Range and resolution are one object rather than three loose fields because
 * neither is usable alone — a range without a step does not say which numbers
 * inside it may be picked, and a step without a range has nothing to divide.
 * Every surface that offers a number, validates one, or plots the distribution
 * of them reads all three together, so they travel together (ADR-0026).
 *
 * **Whole numbers only**, on all three. A fractional step would make "is this
 * guess on the grid?" undecidable without an epsilon — `(0.3 - 0) % 0.1` is not
 * 0 in binary floating point — and a boundary check that is sometimes wrong is
 * worse than one that is narrower. Decimal resolution is not lost by this, only
 * re-expressed: a price is guessed in cents, a rate in tenths of a percent, and
 * the organizer names the unit in the question the way they already do for a
 * scale.
 */
export const GuessRangeSchema = z.object({
	min: z.number().int().default(0),
	max: z.number().int().default(100),
	/**
	 * The increment between selectable values, counted **from `min`** (REQ043):
	 * step 2 over 1–10 offers 1, 3, 5, 7, 9. At least 1, because a step of zero
	 * would make every number equally on and off the grid.
	 */
	step: z.number().int().min(1).default(1),
});

export type GuessRange = z.infer<typeof GuessRangeSchema>;

/**
 * The reference number a Guess the Number slide reveals after the vote (REQ041)
 * and the deviation from it that still counts as correct (REQ042).
 *
 * Tolerance lives **inside** the reference rather than beside it, and the whole
 * object is nullable on the slide. That nesting is the dependency, stated in the
 * type: a slide with no reference has no notion of correctness at all — the same
 * stance a choice slide takes when its author marked no option correct (REQ013)
 * — and a tolerance without a reference is a window around nothing. Modelling
 * the two as independent fields would have forced a silent `tolerance: 0`
 * default onto every slide, which reads as "only the exact number counts" on
 * slides whose author never made that decision at all.
 *
 * Inside a reference the tolerance *does* default to 0, and there it is a real
 * answer to a real question: the organizer has named a correct number, and 0 is
 * the strictest reading of it (REQ042's own example — reference 7, ±0 → only 7).
 */
export const GuessReferenceSchema = z.object({
	/**
	 * The correct number. Defaultless on purpose (ADR-0018): it is the required
	 * input that gives the whole object its meaning, and a defaulted `0` would
	 * assert a correct answer nobody authored. The absence of a reference is
	 * spelled by the field being `null`, never by an empty object.
	 */
	value: z.number().int(),
	/** Deviation from `value` that still counts as correct — 7 ±1 accepts 6–8. */
	tolerance: z.number().int().min(0).default(0),
});

export type GuessReference = z.infer<typeof GuessReferenceSchema>;

/**
 * How many columns the distribution on the shared screen may be split into
 * (REQ039). Twenty-four, because the histogram has to stay readable as one
 * picture on a projector: past roughly two dozen columns the bars are thinner
 * than the gaps between them and the shape — where the room clustered, how wide
 * the spread is — stops being legible, which is the only thing the slide exists
 * to show.
 *
 * It is a ceiling, not a count. A range that offers fewer selectable values than
 * this gets one column per value, which is the honest distribution; a wider one
 * groups a whole number of steps per column so every column still spans the same
 * count of selectable values. Declared once here and composed by the aggregation
 * that fills the columns and the plot that draws them (ADR-0026).
 */
export const GUESS_BUCKET_LIMIT = 24;

// ── Pin on Image (REQ051, REQ052, REQ053) ────────────────────
//
// A pin slide asks its question *on a picture*: the organizer supplies the image
// (REQ052) and a participant answers by marking one point on it (REQ051). What
// makes that expressible at all is the coordinate space the point lives in, and
// it is decided once here.
//
// **The image is its own coordinate space, in per-mille of its own size.** A pin
// is not a pixel and not a fraction: it is a whole number from 0 to
// {@link PIN_COORDINATE_MAX} along each edge, measured on the image itself —
// never on the box a particular screen happened to draw it in. Two properties
// follow, and both are the reason for the choice:
//
//  - **Screen-independent.** The same answer means the same spot on a phone held
//    in one hand and on a projector three metres wide. Storing device pixels
//    would make a room's pins un-comparable the moment two devices differed,
//    which on this slide type is every room.
//  - **Whole numbers, so the arithmetic is exact.** "Is this pin inside the
//    target area?" is decided by integer comparison, with no epsilon and no
//    float that is 0.7000000000000001 on one side of a boundary — the same
//    reasoning that keeps {@link GuessRangeSchema} on integers. A thousandth of
//    an image edge is finer than a projector can show and finer than a fingertip
//    can aim, so nothing an answer means is lost by rounding to it.
//
// `y` is measured **from the top**, unlike a grid axis, because that is how a tap
// on an image reads and how the image itself is addressed everywhere else (CSS,
// canvas, the file's own pixels). An answer's "62" is 62% of the way *down*.

/**
 * The highest pin coordinate: a pin sits at `0…1000` per-mille along each edge
 * of the image, inclusive at both ends. Declared once and composed by the codec
 * that bounds a submission, the picker that authors a target area, and every
 * surface that turns a coordinate back into a position on screen (ADR-0026).
 */
export const PIN_COORDINATE_MAX = 1000;

/** Separator between the two coordinates in a pin's `value`. */
const PIN_VALUE_SEPARATOR = ",";

/**
 * The "correct area" a Pin on Image question may name (REQ053): an axis-aligned
 * rectangle on the image, in the same per-mille coordinates a pin uses, with
 * `x`/`y` at its top-left corner.
 *
 * A rectangle rather than a shape vocabulary, and that is a decision rather than
 * a first cut. The area exists to answer one question — did this pin land in the
 * place the organizer meant? — and a rectangle answers it with two integer
 * comparisons per edge, is drawn by dragging a box across the picture (which is
 * how an organizer thinks about "this region"), and reads identically at any
 * aspect ratio. A polygon or a radius would author a more precise region than a
 * hotspot check can use, and would put a point-in-shape test on the boundary
 * where an inequality now sits.
 *
 * All four fields are **defaultless on purpose** (ADR-0018), the same stance
 * {@link GuessReferenceSchema}'s `value` takes: they are the required input that
 * gives the object its meaning, and a defaulted `0` would assert a target area
 * nobody drew. A slide with no target area spells that as `null` — never as an
 * empty or partial rectangle.
 */
export const PinAreaSchema = z.object({
	/** Left edge, per-mille from the image's left. */
	x: z.number().int().min(0).max(PIN_COORDINATE_MAX),
	/** Top edge, per-mille from the image's top. */
	y: z.number().int().min(0).max(PIN_COORDINATE_MAX),
	/** Width in per-mille. At least 1: a zero-width target accepts nothing. */
	width: z.number().int().min(1).max(PIN_COORDINATE_MAX),
	/** Height in per-mille, on the same terms. */
	height: z.number().int().min(1).max(PIN_COORDINATE_MAX),
});

export type PinArea = z.infer<typeof PinAreaSchema>;

// ── Form slide (REQ061) ──────────────────────────────────────
//
// Every other interactive slide type here asks the room **one** question and
// reads the answers as a distribution. A form asks one *participant* several
// questions and reads their answers as a record: a name, an address to reach
// them at, which of three tracks they picked. That is a different object, and
// the difference is the whole slide type — the datum is the row, not the column.
//
// Three decisions follow from it, and each is enforced below rather than left to
// a client:
//
//  - **One submission, one row.** The whole form travels as a single `value` on
//    a single vote row, the way a ranking's ordering and a points budget do.
//    Half a form is not a milder answer, it is a person interrupted: the fields
//    are answered together, in one gesture, and splitting them across rows would
//    make "who filled this in?" a join rather than a read — and would let a
//    required field be left out one row at a time.
//  - **Fields are typed, and the type is checked at the boundary.** An email
//    field that accepted anything is a text field wearing a label, and the
//    organizer reading the export is the person who discovers it. What each type
//    accepts is decided in {@link decodeFormSubmission} and nowhere else — and
//    only for an *incoming* submission: a row already stored is read back
//    through {@link readFormSubmission}, which never re-judges it by the rules of
//    a later edit. See the block above those two for why that split exists.
//  - **A submission is answers, never identity.** The row carries what was
//    written and the participant id every vote carries; nothing derives one from
//    the other, and the tally never publishes either to the room (see the
//    aggregation's `form` case, which hands the submitted rows only to a caller
//    that can edit the deck).

/**
 * What one field of a form asks for (REQ061 — "free text, email, choice").
 *
 * Three, not a form-builder's twenty, and the three are the ones the requirement
 * names. Each is a distinct *validation*, which is the only reason a field type
 * exists at all: `text` accepts what was typed, `email` accepts only something
 * shaped like an address to reach somebody at, `choice` accepts only one of the
 * options the organizer wrote. A "number" or a "date" would be a fourth
 * validation nobody has asked for; adding one later costs an enum member and a
 * branch, which is exactly what this shape is for.
 */
export const FormFieldTypeEnum = z.enum(["text", "email", "choice"]);
export type FormFieldType = z.infer<typeof FormFieldTypeEnum>;

/** One option offered by a `choice` field on a Form slide (REQ061). */
export const FormFieldOptionSchema = z.object({
	id: z.string(),
	text: z.string(),
});

export type FormFieldOption = z.infer<typeof FormFieldOptionSchema>;

/**
 * How many options one `choice` field may offer. Eight, the ceiling a grid's
 * items and a points slide's items land on: past eight, a list a participant has
 * to read *while also filling in the rest of a form* stops being a choice and
 * becomes a search. A longer list is a question of its own, which is what a
 * multiple-choice slide already is.
 */
export const FORM_FIELD_OPTION_LIMIT = 8;

/**
 * The longest one field's answer may be. Two hundred characters: room for a
 * name, a company, an address, or a sentence of free text, and short of the
 * paragraph that belongs on an open-ended slide (REQ026) where the room can read
 * it. It is also what keeps a full form inside a single submission's budget —
 * see {@link FORM_VALUE_MAX_LENGTH}.
 */
export const FORM_ANSWER_MAX_LENGTH = 200;

/**
 * How many fields one Form slide may carry. Six, and the ceiling is about the
 * person filling it in rather than about the storage: a form is answered on a
 * phone, in a room, between two slides, and every field past the first is one
 * more thing standing between the participant and the submit button. Six is a
 * signup — who you are, how to reach you, which track — and the seventh is where
 * a room starts abandoning the form half-filled, which collects nothing at all.
 *
 * Declared once here and composed by the schema's `.max()`, the editor's
 * add-field button, and the value budget below (ADR-0026).
 */
export const FORM_FIELD_LIMIT = 6;

/**
 * One field on a Form slide (REQ061).
 *
 * `id` and `label` carry no default, like every other authored item here
 * (ADR-0018): they are the required inputs that make a field a field — an id to
 * bind an answer to, and the words that say what is being asked. Everything else
 * is a decision with a sensible unmade state, so it defaults (ADR-0029).
 */
export const FormFieldSchema = z.object({
	id: z.string(),
	/**
	 * What this field asks, drawn as its caption on the phone, in the editor's
	 * preview and as the entry name in the export. Named `label` rather than the
	 * `text` every other item schema uses, because a form field also has a
	 * `type` — and `field.text` beside `field.type === "text"` is two different
	 * things one word apart.
	 */
	label: z.string(),
	/** Which of the three answer shapes this field takes. */
	type: FormFieldTypeEnum.default("text"),
	/**
	 * Whether the form may be submitted without this field answered.
	 *
	 * Defaults to `false` — optional — and that direction is deliberate. A
	 * required field is a refusal aimed at a participant who has already started
	 * typing, so it is something the organizer turns *on* for the one or two
	 * fields that genuinely carry the submission, not something every field
	 * inherits because nobody said otherwise.
	 */
	required: z.boolean().default(false),
	/**
	 * The options a `choice` field offers, capped at
	 * {@link FORM_FIELD_OPTION_LIMIT}. Empty on a `text` or `email` field, which
	 * is why it defaults to `[]` rather than being nullable: a field that offers
	 * nothing to pick from and a field that is not a picker are the same absence.
	 */
	options: z
		.array(FormFieldOptionSchema)
		.max(FORM_FIELD_OPTION_LIMIT)
		.default([]),
});

export type FormField = z.infer<typeof FormFieldSchema>;

// ── Per-slide appearance (REQ087, REQ070, REQ071, REQ019) ────
//
// The deck's theme decides what the room is looking at — its palette, its face,
// the wash behind every slide (see the deck-theme block near the bottom of this
// file). A **slide** may then say, for itself and for no other slide, that its
// elements sit somewhere else, that it is drawn on a colour of its own, that it
// carries a picture behind it, or that its words and its bars are coloured
// differently. That is the whole of REQ087: placement, background, colours,
// layered over the theme's defaults.
//
// Four decisions shape the model:
//
//  - **An override layers, it does not replace.** Every field below has an
//    "unauthored" value — `inherit` for placement, `""` for a colour — and a
//    slide that authored nothing is *exactly* the deck's theme, token for token.
//    A slide that authored one colour changes that colour and inherits the rest.
//    This is why a slide carries no palette: sixteen tokens on a slide would be
//    a second theme, and a deck re-themed tomorrow would leave every slide
//    wearing yesterday's.
//  - **The layering is arithmetic, and it happens on the client.** What is
//    stored is what the organizer authored; what a screen is painted with is
//    derived from it over the deck's own variant, in
//    `src/components/SlideAppearance.tsx`, because CSS custom properties are the
//    only consumer (ADR-0032) and the deck's palettes already live there.
//  - **A colour is the same grammar wherever it is authored.** A slide's
//    background and a deck brand's canvas are the same kind of value — a hex
//    triplet an organizer typed — so they share one pattern, one schema and one
//    resolver ({@link authoredColorFor}), declared here because this is the first
//    of the two blocks to be evaluated.
//  - **A value a browser must not be handed is refused, not repaired.** A
//    background image is a URL, exactly like the deck's logo, and goes through
//    the same scheme allowlist ({@link browserSafeAssetUrl}). A colour outside
//    the grammar resolves to "unauthored", so the theme's own value stands. Both
//    answer with the safe value rather than with the attacker's string, and a
//    surface that reads the raw field instead of {@link slideAppearanceFor} is
//    what `scripts/guard-frontend-conventions.ts` fails the build over.

/**
 * A colour an organizer may author: `#rgb` or `#rrggbb`, or the empty string for
 * one they left to the layer underneath.
 *
 * Deliberately narrower than CSS: no `rgb()`, no `hsl()`, no named colours, no
 * `var()`. These values are written into custom properties that a `background`
 * and a `background-image` resolve, so the grammar a colour is allowed to be is
 * the smallest one that can express a brand — anything richer is a place for a
 * second declaration to hide.
 */
export const AUTHORED_COLOR_PATTERN =
	/^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))?$/;

/** An authored colour as a stored field: validated, and empty when unauthored. */
export const AuthoredColorSchema = z
	.string()
	.regex(AUTHORED_COLOR_PATTERN, "A colour is #rgb or #rrggbb, or empty")
	.default("");

/**
 * One authored colour, as a surface may use it — or `""` where the layer
 * underneath stands.
 *
 * A value outside the grammar is refused rather than repaired, because the safe
 * answer is the default and a half-parsed colour is not a colour. Normalized to
 * lower case so `#FFF` and `#fff` are one colour rather than two.
 */
export function authoredColorFor(value: string | null | undefined): string {
	const authored = (value ?? "").trim();
	if (authored === "") return "";
	if (!AUTHORED_COLOR_PATTERN.test(authored)) return "";
	return authored.toLowerCase();
}

/**
 * An authored URL an `<img>` or a `background-image` may be pointed at, or `""`
 * for one that no browser should be handed.
 *
 * `javascript:` and `data:` are not schemes a deck's artwork arrives over, and a
 * protocol-relative `//host/…` names a scheme this check never gets to see. A
 * root-relative path is a file this deployment already serves, so it is served
 * as one. Shared by the deck's logo ({@link deckLogoFor}) and a slide's
 * background image, because "is this a URL we may render?" is one question with
 * one answer (ADR-0026).
 */
export function browserSafeAssetUrl(value: string | null | undefined): string {
	const authored = (value ?? "").trim();
	if (authored === "") return "";
	if (authored.startsWith("//")) return "";
	if (authored.startsWith("/")) return authored;
	let parsed: URL;
	try {
		parsed = new URL(authored);
	} catch {
		return "";
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
	return authored;
}

/**
 * Where a slide's elements sit (REQ087) — the placement half of a slide's own
 * layout, over the theme's default.
 *
 * Three placements and an `inherit`, and the three are the axis a renderer
 * genuinely has freedom on: this deck's slides are a heading, whatever the slide
 * carries under it, and the room's answers below that, stacked down a column
 * that is as wide as the screen allows. Which edge that column and its words
 * align to is a real layout decision an organizer makes — a title card that
 * reads from the left, a question that hangs off the right of a photograph —
 * while "put the tally in the top-right corner" is a different product.
 *
 * `inherit` is the default and means the theme's own placement, exactly as
 * `resultsVisibility: "inherit"` means the deck's own visibility: a slide that
 * was never given a layout must keep looking as it looked, and a deck-level
 * default arriving later has somewhere to be read from.
 */
export const SLIDE_LAYOUTS = ["inherit", "center", "left", "right"] as const;

export const SlideLayoutEnum = z.enum(SLIDE_LAYOUTS);
export type SlideLayout = z.infer<typeof SlideLayoutEnum>;

/** A layout with the deferral resolved — what a renderer actually places by. */
export type SlidePlacement = Exclude<SlideLayout, "inherit">;

/**
 * The placement a theme lays a slide out in when the slide defers. Centred: it
 * is what every surface in this app has always drawn, so a deck that never
 * authored a layout is not re-laid-out by this field arriving (ADR-0029).
 */
export const DEFAULT_SLIDE_PLACEMENT: SlidePlacement = "center";

export const SlideSchema = z.object({
	id: z.string(),
	type: SlideTypeEnum,
	question: z.string(),
	/** MC / quiz options */
	options: z.array(MultipleChoiceOptionSchema).default([]),
	/** Scale: min/max labels */
	scaleMin: z.number().optional().default(1),
	scaleMax: z.number().optional().default(5),
	scaleMinLabel: z.string().optional().default(""),
	scaleMaxLabel: z.string().optional().default(""),
	/**
	 * Scales: optional list of statements to rate on the shared scale (REQ029).
	 * When omitted or empty, the slide behaves as a single-statement scale
	 * (backwards compatible with existing `scale` slides) using `question` as
	 * the implicit statement.
	 */
	scaleStatements: z.array(ScaleStatementSchema).max(5).default([]),
	/** Scales: optional intermediate labels between min and max (REQ032). */
	scaleLabels: z.array(ScaleLabelSchema).default([]),
	/** Scales: allow participants to skip individual statements (REQ031). */
	scaleAllowSkip: z.boolean().optional().default(false),
	/**
	 * Ranking: the items participants put in order (REQ034). Capped at
	 * {@link RANKING_ITEM_LIMIT}; a slide with fewer than two items has nothing
	 * to order, which the editor prevents by seeding two blank rows.
	 */
	rankingItems: z.array(RankingItemSchema).max(RANKING_ITEM_LIMIT).default([]),
	/**
	 * 2x2 Grid: the items participants place in the coordinate field (REQ047).
	 * Capped at {@link GRID_ITEM_LIMIT}. One item is already a usable slide —
	 * unlike a ranking, each item is judged on its own — so there is no floor.
	 */
	gridItems: z.array(GridItemSchema).max(GRID_ITEM_LIMIT).default([]),
	/**
	 * 100 Points: the items participants distribute their budget across
	 * (REQ045). Capped at {@link POINTS_ITEM_LIMIT}; a slide with fewer than two
	 * items offers no trade-off at all — the whole budget has nowhere else to go
	 * — which the editor prevents by seeding two blank rows.
	 */
	pointsItems: z.array(PointsItemSchema).max(POINTS_ITEM_LIMIT).default([]),
	/**
	 * Guess the Number: the permitted values and their resolution (REQ040,
	 * REQ043). Always present — a numeric estimate needs a frame to be an
	 * estimate rather than a free-text number — so it defaults to the whole
	 * 0–100 range in steps of 1 rather than being nullable.
	 */
	guessRange: GuessRangeSchema.default({}),
	/**
	 * Guess the Number: the correct number to reveal and the deviation from it
	 * that still counts (REQ041, REQ042). `null` — the default — is not "no
	 * tolerance": it is a slide with no notion of correctness at all, which is
	 * the normal shape for an estimation or forecasting question where there is
	 * no right answer to reveal. See {@link GuessReferenceSchema}.
	 */
	guessReference: GuessReferenceSchema.nullable().default(null),
	/**
	 * Pin on Image: the area a pin is expected to land in (REQ053), or `null` —
	 * the default — for a slide with no notion of correctness at all, which is the
	 * normal shape for "where would you put it?" rather than "where is it?". Not
	 * "an empty target": the two are as distinct here as they are on a guess
	 * slide's {@link guessReference}. See {@link PinAreaSchema}.
	 *
	 * The image the area is drawn on is the slide's `mediaUrl` (REQ052) — see
	 * {@link pinImageFor}, which is also why a pin slide's media is not the
	 * illustration every other interactive slide's is.
	 */
	pinArea: PinAreaSchema.nullable().default(null),
	/**
	 * Form: the typed fields one participant fills in and submits together
	 * (REQ061). Capped at {@link FORM_FIELD_LIMIT}. Read it through
	 * {@link formFieldsFor}, which is also where a field nobody finished
	 * authoring stops being part of the question.
	 */
	formFields: z.array(FormFieldSchema).max(FORM_FIELD_LIMIT).default([]),
	/** 2x2 Grid: the horizontal dimension (REQ048, REQ049). */
	gridXAxis: GridAxisSchema.default({}),
	/** 2x2 Grid: the vertical dimension (REQ048, REQ049). */
	gridYAxis: GridAxisSchema.default({}),
	/**
	 * 2x2 Grid: allow participants to mark an item "not assessable" instead of
	 * placing it (REQ050) — the same affordance `scaleAllowSkip` gives a scale
	 * statement, and it rides the same `skip` flag on the vote.
	 */
	gridAllowSkip: z.boolean().optional().default(false),
	/** Quiz: time limit in seconds */
	timeLimit: z.number().optional().default(30),
	/**
	 * Quiz: how participants answer this question (REQ054, REQ055). `select` —
	 * the default, and what every deck authored before REQ055 carries — offers
	 * the slide's `options`; `type` takes a free-text answer and judges it
	 * against {@link quizAnswers}. Read it through {@link quizAnswerModeFor},
	 * which is also the one place a non-quiz slide's leftover value is ignored.
	 */
	quizAnswerMode: QuizAnswerModeEnum.optional().default("select"),
	/**
	 * Quiz (typed answers): the solutions a participant's typed answer is
	 * accepted against (REQ055). Capped at {@link QUIZ_ANSWER_LIMIT}.
	 *
	 * A list rather than a single string because the *spelling* of a right answer
	 * is not the knowledge being tested: "USA" and "United States" are the same
	 * answer, and an organizer who can only name one of them is forced to mark
	 * the room wrong for agreeing with them. Matching is exact after
	 * normalization ({@link normalizeQuizAnswer}) — never fuzzy — so this list is
	 * the only place variants are admitted, which keeps what counts as correct a
	 * decision the organizer made rather than one a distance threshold made.
	 *
	 * Empty is a slide with no notion of correctness at all, the same stance a
	 * choice slide takes when its author marked no option (REQ013): nobody
	 * scores, rather than everybody scoring.
	 */
	quizAnswers: z.array(QuizAnswerSchema).max(QUIZ_ANSWER_LIMIT).default([]),
	/**
	 * Leaderboard: how many ranks the board puts on the shared screen (REQ059).
	 * Capped at {@link LEADERBOARD_SIZE_LIMIT}; read it through
	 * {@link leaderboardSizeFor}, which is also where a hand-built deck's
	 * out-of-range number is brought back inside the board's bounds.
	 *
	 * It bounds what is *shown*, never what is *ranked*: every participant who
	 * answered a quiz question has a rank, and a participant below the cut still
	 * learns theirs on their own screen. A board that ranked only the top few
	 * could not tell anybody else where they stand.
	 */
	leaderboardSize: z
		.number()
		.int()
		.min(1)
		.max(LEADERBOARD_SIZE_LIMIT)
		.optional()
		.default(LEADERBOARD_DEFAULT_SIZE),
	/** Whether to allow multiple votes per participant (legacy; superseded by maxResponses for WC/OE) */
	allowMultiple: z.boolean().optional().default(false),
	/**
	 * Word Cloud / Open Ended: max responses per participant (REQ022, REQ026).
	 * `0` means unlimited. When unset, falls back to `allowMultiple` semantics
	 * (false → 1, true → unlimited) for backward compatibility.
	 */
	maxResponses: z.number().int().min(0).max(50).optional(),
	/** Open Ended result visualization (REQ024). */
	openTextLayout: z
		.enum(["speech-bubbles", "grid"])
		.optional()
		.default("speech-bubbles"),
	/** Open Ended: allow participants to upvote submitted responses (REQ025). */
	allowResponseVotes: z.boolean().optional().default(false),
	/** Multiple-choice / Quiz result visualization (REQ010). */
	mcDisplayStyle: McDisplayStyleEnum.optional().default("bars"),
	/**
	 * Multiple-choice / Quiz: whether a result reads as a count, a percentage or
	 * both (REQ011). `both` is the default because it is what every existing
	 * deck already renders ("12 (40%)"); the presenter can switch the live view
	 * without changing this authored default.
	 */
	mcValueDisplay: McValueDisplayEnum.optional().default("both"),
	/**
	 * Multiple-choice: how many options one participant may select (REQ014).
	 * `1` is single choice, `0` is unlimited ("all that apply"), `n > 1` caps the
	 * selection at n. `null` (the default) means the author never configured it,
	 * in which case the legacy `allowMultiple` flag decides — see
	 * {@link maxSelectionsFor}, the single place that resolves the two.
	 */
	mcMaxSelections: z.number().int().min(0).max(20).nullable().default(null),
	/**
	 * Content slides: body text (REQ062 text, REQ065 instruction).
	 *
	 * Markdown, like `question` — see {@link SlideTextSizeEnum} for the size it
	 * is drawn at (REQ091) and the client's `SlideText` for the subset that is
	 * understood (REQ088 links, REQ089 emphasis and lists). Stored exactly as
	 * the organizer typed it: the markup is resolved where it is *rendered*, so
	 * one authored string cannot mean two different things on two surfaces.
	 */
	body: z.string().default(""),
	/**
	 * How large this slide's authored text is drawn (REQ091). Applies to the
	 * `question` heading on every slide type and to `body` on a content slide —
	 * the text the organizer wrote, not the answer controls or the tally around
	 * it, whose size is a property of the result being read rather than of the
	 * words on the slide.
	 *
	 * Read it through {@link slideTextSizeFor} — never off the field — so a
	 * hand-built deck's missing or unknown value lands on the same step
	 * everywhere rather than on whichever fallback each surface picked.
	 */
	textSize: SlideTextSizeEnum.optional().default("medium"),
	/**
	 * Media attachment URL — primary content for image slides (REQ063), video
	 * slides (REQ064) and embed slides (REQ066/REQ067/REQ068), the interaction
	 * area a Pin on Image question is asked on (REQ052), and an optional
	 * illustration for any other slide (REQ069 — add images/GIFs).
	 *
	 * One field for all five because it is one thing — the media this slide
	 * carries — and a second URL field would let a pin slide hold an image it asks
	 * *about* beside a different one participants pin *on*. Which of the five a
	 * given slide means is answered by named read sites rather than by the field:
	 * {@link slideMediaIsInteractionArea}, which keeps a pin slide's canvas from
	 * also being drawn above itself as decoration, {@link slideVideoFor}, which
	 * decides how a video slide's URL is played and refuses one that no player
	 * should be pointed at, and {@link slideEmbedFor}, which decides whose deck or
	 * board an embed slide frames and refuses every URL that is neither.
	 */
	mediaUrl: z.string().default(""),
	/** Alt text for mediaUrl (accessibility). */
	mediaAlt: z.string().default(""),
	/**
	 * Where this slide's elements sit (REQ087), over the theme's own placement.
	 *
	 * Read through {@link slideAppearanceFor} — never off the field — so a deck
	 * carrying a layout this build does not know lands on the same placement
	 * everywhere rather than on whichever fallback each surface picked.
	 */
	layout: SlideLayoutEnum.default("inherit"),
	/**
	 * The colour this slide is drawn on (REQ070), overriding the theme's canvas
	 * for this slide and leaving the theme itself untouched — every other slide in
	 * the deck goes on wearing it.
	 *
	 * `""` — the default — is "the theme's", not "black": the whole point of the
	 * layer is that an unauthored slide is the theme, token for token. What the
	 * canvas implies for everything drawn *on* it (the raised surfaces, the
	 * borders, and the words when they were not authored either) is derived from
	 * it on the client, the way an authored theme's canvas is.
	 */
	backgroundColor: AuthoredColorSchema,
	/**
	 * Optional background image URL displayed full-bleed behind the slide
	 * (REQ071), under a scrim that keeps the foreground text legible whatever the
	 * picture is — see `slideScrimFor` in `src/components/SlideAppearance.tsx`,
	 * which pairs the scrim's tone with the words that sit on it.
	 *
	 * Rendered through {@link slideAppearanceFor}, which allowlists the scheme:
	 * this string reaches a `background-image`, so a URL no browser should be
	 * pointed at resolves to "no picture" rather than being repaired.
	 */
	backgroundImage: z.string().default(""),
	/**
	 * The colour this slide's words are drawn in (REQ019), over the theme's own.
	 *
	 * Overrides the text ramp for this slide alone: the muted and dim steps are
	 * derived from it against whatever this slide's canvas turned out to be, so a
	 * caption stays a caption rather than becoming the same weight as the heading.
	 */
	textColor: AuthoredColorSchema,
	/**
	 * The colour this slide's charts are drawn from (REQ019), over the theme's own
	 * poll palette.
	 *
	 * One seed rather than eight colours, and that is what makes it an override
	 * rather than a second palette: the eight bars a result is drawn with are
	 * derived from it by hue, so a slide can be "the green one" without an
	 * organizer authoring a categorical scale by hand — and a chart whose series
	 * still have to be told apart stays told apart.
	 */
	chartColor: AuthoredColorSchema,
	/**
	 * What the presenter wrote to themselves about this slide (REQ090) — the
	 * cue, the anecdote, the number they never remember, the thing they must not
	 * say yet.
	 *
	 * **Presenter-only, and enforced on the wire rather than in a renderer.**
	 * Every payload that leaves for somebody who cannot edit the deck goes
	 * through {@link withAudienceSlides}, which empties this field before it is
	 * serialized — so a participant's phone, the join payload, the `slide.changed`
	 * broadcast and the preview's audience pane are never sent the text at all,
	 * and a surface that forgot to hide it would have nothing to show. This is
	 * the stance a Pin on Image target takes (REQ053) and for the same reason: a
	 * client cannot leak what it never received.
	 *
	 * Emptied to `""` rather than dropped, unlike a withheld answer key. There
	 * the absence *is* the signal — a withheld mark must be indistinguishable
	 * from an unmarked option — while a slide with no notes is the overwhelmingly
	 * ordinary case and carries exactly `""` already, so the audience's view of a
	 * noted slide and of an un-noted one are the same complete shape (ADR-0024)
	 * and no client reaches for `??`.
	 *
	 * Markdown like `question` and `body`, resolved where it is rendered.
	 */
	notes: z.string().default(""),
	/**
	 * Per-slide override of the deck-level results visibility (REQ102).
	 *  - "inherit" (default): follow the presentation's `resultsVisibility`
	 *  - "instant": results update in real-time as votes come in
	 *  - "on-click": presenter reveals manually
	 *  - "private": results are never shown on the shared screen
	 * Only applies to interactive slide types. Use {@link effectiveResultsVisibility}
	 * to resolve this against the deck default.
	 */
	resultsVisibility: SlideResultsVisibilityEnum.optional().default("inherit"),
});

export type Slide = z.infer<typeof SlideSchema>;

/**
 * The ceiling on one slide's authored text — its `question` and, on a content
 * slide, its `body` (REQ159).
 *
 * One number for both, because the ceiling is a fact about what a *slide* is
 * rather than about which of its two text fields is being written: both are
 * markdown the organizer typed, both are drawn on a surface a room reads from
 * the back, and neither has anything to say at five thousand characters that it
 * could not say in five hundred. The number is generous on purpose — it is a
 * bound, not a style guide, and a cap tight enough to argue with is a cap that
 * refuses somebody's real deck.
 *
 * What it is *for* is the arithmetic below it. Text authored here is re-drawn
 * by the PDF export, which measures and breaks every run it is given
 * (`server/deck-pdf.ts`); with `slides` uncapped and these two fields uncapped,
 * a single `PATCH` could hand that renderer an unbounded amount of work on a
 * route one caller can hold open, on a runtime that serves every other request
 * from the same thread. Capping the field is what keeps a deck's rendering cost
 * a property of the deck rather than of whatever the last writer felt like
 * sending.
 */
export const SLIDE_TEXT_MAX_LENGTH = 5000;

/**
 * The ceiling on a slide's `mediaUrl` and `backgroundImage` (REQ159) — 2048,
 * the length browsers, proxies and server logs have long since settled on as
 * "a URL".
 *
 * Separate from {@link SLIDE_TEXT_MAX_LENGTH} because it is not authored prose
 * with a generous allowance: it is an address, and an address that does not fit
 * in two kilobytes is not one anything downstream would fetch anyway. Nothing
 * in this app uploads — a slide's media is a URL the organizer pasted, and the
 * PDF export prints that address rather than following it — so there is no
 * inline `data:` payload this has to leave room for.
 */
export const SLIDE_MEDIA_URL_MAX_LENGTH = 2048;

/**
 * The ceiling on one authored **row** of a slide (REQ159): an option to pick,
 * an item to order or fund or place, a statement to rate, an accepted quiz
 * answer, a form field's caption or one of its choices, the alt text on its
 * media, and the words naming either end of a scale or a grid axis.
 *
 * One number for all of them, because they are one kind of thing — a label a
 * participant reads off a phone and acts on, next to a control. Whatever else
 * differs between rating a statement and funding an item, the label doing the
 * asking is the same object, so it gets one ceiling rather than nine
 * (ADR-0026). Five hundred rather than {@link SLIDE_TEXT_MAX_LENGTH}'s five
 * thousand for the same reason: a slide's `body` is prose somebody reads, and a
 * row's text is a thing somebody picks.
 *
 * These are the fields the first cut of REQ159 left out, and leaving them out
 * left the defect open: the PDF export draws every one of them through the same
 * wrapper `question` goes through, so an unbounded option's text bought the same
 * stalled event loop an unbounded question did, one word of the payload apart.
 * A linear cost over an unbounded input is still an unbounded cost.
 */
export const SLIDE_ITEM_TEXT_MAX_LENGTH = 500;

/**
 * How many options one multiple-choice or quiz slide may offer (REQ159).
 *
 * Fifty. It is by far the loosest of the row limits here — a ranking stops at
 * ten and a grid at eight — and deliberately so: unlike those, an option list is
 * answered by *picking one*, so a long one costs the participant a scroll rather
 * than a judgement per row, and polls with a few dozen choices ("which team?",
 * "which session?") are ordinary. What the number is for is that this was the
 * only authored list on a slide with no ceiling at all, which is what let a
 * single slide carry an unbounded number of unbounded strings.
 */
export const SLIDE_OPTION_LIMIT = 50;

/**
 * How many intermediate labels one scale's axis may carry (REQ159).
 *
 * Twenty: a label sits on a point of the scale, and a scale a room reads off a
 * shared screen runs out of points to name well before twenty of them. The
 * other list on a slide that carried no ceiling.
 */
export const SCALE_LABEL_LIMIT = 20;

/**
 * How many slides one deck may hold (REQ159).
 *
 * Two hundred: past it a deck has stopped being a session and become a
 * document, and every surface that renders one — the editor's rail, the
 * presenter's flow, the workbook, the PDF — pays for each slide linearly. It is
 * the outer factor of the same product {@link SLIDE_TEXT_MAX_LENGTH} bounds the
 * inner one of, so the two together are what put a finite ceiling on the work a
 * single authored deck can ask of the server.
 *
 * A ceiling on what may be *written*, not on what may be read: see
 * {@link SlideInputSchema} for why the two differ.
 */
export const SLIDE_LIMIT = 200;

/** One authored row's text, held to {@link SLIDE_ITEM_TEXT_MAX_LENGTH}. */
const AuthoredRowText = z.string().max(SLIDE_ITEM_TEXT_MAX_LENGTH);

/**
 * A grid axis as a **request** may write one — {@link GridAxisSchema} with its
 * three authored strings bounded. Its numbers need no ceiling: a number is one
 * value however large, and the export prints it rather than laying a row out
 * per point on it.
 */
const GridAxisInputSchema = GridAxisSchema.extend({
	title: AuthoredRowText.default(""),
	minLabel: AuthoredRowText.default(""),
	maxLabel: AuthoredRowText.default(""),
});

/**
 * A slide as a **request** may write one — {@link SlideSchema} with a ceiling
 * on every authored string it carries and on every list of them.
 *
 * The caps live here rather than on `SlideSchema` itself because that schema is
 * also what every *stored* slide is re-parsed through on the way out of the
 * document store, and a ceiling on a read is a different promise from a ceiling
 * on a write: tightening the stored shape would not remove one oversized field
 * already on disk, it would make the deck holding it unreadable. So the bound
 * goes where the bytes arrive. This is the split the file already uses for a
 * deck's `title` — capped on {@link CreatePresentationSchema} and
 * {@link UpdatePresentationSchema}, plain `z.string()` on
 * {@link StoredPresentationSchema} — and for the same reason.
 *
 * Extended rather than restated, so a field added to a slide is added in one
 * place and is writable the moment it exists (ADR-0013). The count caps below
 * repeat the ones `SlideSchema` already declares because `.extend()` replaces a
 * key outright; they compose the same constants, so the two cannot drift.
 *
 * **Every** authored string, not the three the first cut of this covered. The
 * export draws an option's text, a ranking item's, a form field's caption and a
 * scale's end labels through exactly the wrapper it draws `question` through, so
 * a ceiling on some of them bounds nothing: an attacker moves one word of the
 * payload. The only authored string left plain is `id`, which is an identity
 * rather than something drawn — capping it would refuse a hand-built deck's ids
 * on save to buy no rendering bound at all.
 */
export const SlideInputSchema = SlideSchema.extend({
	question: z.string().max(SLIDE_TEXT_MAX_LENGTH),
	body: z.string().max(SLIDE_TEXT_MAX_LENGTH).default(""),
	notes: z.string().max(SLIDE_TEXT_MAX_LENGTH).default(""),
	mediaUrl: z.string().max(SLIDE_MEDIA_URL_MAX_LENGTH).default(""),
	mediaAlt: AuthoredRowText.default(""),
	backgroundImage: z.string().max(SLIDE_MEDIA_URL_MAX_LENGTH).default(""),
	scaleMinLabel: AuthoredRowText.optional().default(""),
	scaleMaxLabel: AuthoredRowText.optional().default(""),
	options: z
		.array(MultipleChoiceOptionSchema.extend({ text: AuthoredRowText }))
		.max(SLIDE_OPTION_LIMIT)
		.default([]),
	scaleStatements: z
		.array(ScaleStatementSchema.extend({ text: AuthoredRowText }))
		.max(5)
		.default([]),
	scaleLabels: z
		.array(ScaleLabelSchema.extend({ label: AuthoredRowText }))
		.max(SCALE_LABEL_LIMIT)
		.default([]),
	rankingItems: z
		.array(RankingItemSchema.extend({ text: AuthoredRowText }))
		.max(RANKING_ITEM_LIMIT)
		.default([]),
	gridItems: z
		.array(GridItemSchema.extend({ text: AuthoredRowText }))
		.max(GRID_ITEM_LIMIT)
		.default([]),
	pointsItems: z
		.array(PointsItemSchema.extend({ text: AuthoredRowText }))
		.max(POINTS_ITEM_LIMIT)
		.default([]),
	quizAnswers: z
		.array(QuizAnswerSchema.extend({ text: AuthoredRowText }))
		.max(QUIZ_ANSWER_LIMIT)
		.default([]),
	formFields: z
		.array(
			FormFieldSchema.extend({
				label: AuthoredRowText,
				options: z
					.array(FormFieldOptionSchema.extend({ text: AuthoredRowText }))
					.max(FORM_FIELD_OPTION_LIMIT)
					.default([]),
			}),
		)
		.max(FORM_FIELD_LIMIT)
		.default([]),
	gridXAxis: GridAxisInputSchema.default({}),
	gridYAxis: GridAxisInputSchema.default({}),
});

export type SlideInput = z.infer<typeof SlideInputSchema>;

/**
 * Why a slide list cannot be **written**, said for its author (REQ159).
 *
 * The write boundary refuses a deck over the caps with a validation error
 * naming a JSON path — the right answer for the API caller the caps defend
 * against, and a useless one for an author mid-edit, whose editor can render
 * it as nothing better than "the save failed". Run before the save, on the
 * same schema the boundary parses with (ADR-0013), this names the slide and
 * the field instead. It is also the only way back for a deck stored before a
 * cap existed: the stored shape is deliberately uncapped so such a deck still
 * *reads*, but every save of it is refused until the oversized field is
 * trimmed — and an author who is not told which field that is cannot trim it.
 *
 * `null` when every slide fits, else the first failure: one sentence in the
 * editor's own vocabulary (slides numbered from 1), and the index of the slide
 * it names so a surface can put the author in front of it — `null` for a
 * refusal of the whole list rather than of one slide.
 */
export function slideWriteRefusalFor(
	slides: readonly unknown[],
): { slideIndex: number | null; message: string } | null {
	if (slides.length > SLIDE_LIMIT) {
		return {
			slideIndex: null,
			message: `This deck holds ${slides.length} slides; a deck can hold at most ${SLIDE_LIMIT}.`,
		};
	}
	for (const [slideIndex, slide] of slides.entries()) {
		const parsed = SlideInputSchema.safeParse(slide);
		if (parsed.success) continue;
		const issue = parsed.error.issues[0];
		const fieldPath =
			issue.path.length > 0 ? issue.path.join(".") : "this slide";
		return {
			slideIndex,
			message: `Slide ${slideIndex + 1}, ${fieldPath}: ${issue.message}`,
		};
	}
	return null;
}

/**
 * The keys of a slide that hold rows carrying an identity of their own — the
 * lists a copy has to re-identify, listed once so a slide type added later is
 * added here rather than in each of the three places a deck gets copied.
 *
 * `scaleLabels` is deliberately absent: a scale's intermediate labels are keyed
 * by the value they sit on, not by an id, so there is nothing to regenerate.
 */
const IDENTIFIED_SLIDE_LISTS = [
	"options",
	"scaleStatements",
	"rankingItems",
	"gridItems",
	"pointsItems",
	"quizAnswers",
	"formFields",
] as const;

/**
 * Copies of `slides` under fresh identities — the single definition of what it
 * means for one deck's slides to be *copies* of another's rather than the same
 * slides seen twice (REQ006 "detached from their source").
 *
 * Three surfaces need exactly this and used to spell two different versions of
 * it (ADR-0026): creating a deck from a template, duplicating a deck, and
 * importing an exported one. The identities are regenerated all the way down —
 * the slide, the rows it carries, and a form field's own options (REQ061), which
 * are one level deeper than anything else here.
 *
 * Generic over the slide shape on purpose: the server holds parsed slides and
 * the editor holds half-authored ones (`z.input`), and re-identifying a copy is
 * the same operation on both. Nothing else about the slide is touched.
 */
export function withFreshSlideIds<SlideShape extends { id?: string }>(
	slides: readonly SlideShape[],
): SlideShape[] {
	return slides.map((slide) => {
		const copy: Record<string, unknown> = { ...slide, id: crypto.randomUUID() };
		for (const listKey of IDENTIFIED_SLIDE_LISTS) {
			const rows = (slide as Record<string, unknown>)[listKey];
			if (!Array.isArray(rows)) continue;
			copy[listKey] = rows.map((row: Record<string, unknown>) => {
				const rowCopy: Record<string, unknown> = {
					...row,
					id: crypto.randomUUID(),
				};
				if (Array.isArray(row.options)) {
					rowCopy.options = row.options.map((option: Record<string, unknown>) => ({
						...option,
						id: crypto.randomUUID(),
					}));
				}
				return rowCopy;
			});
		}
		return copy as SlideShape;
	});
}

/**
 * The size a slide's authored text is drawn at (REQ091) — the single read site
 * for {@link SlideSchema.shape.textSize}, asked by every surface that renders a
 * heading or a body (ADR-0026).
 *
 * A slide is not always a parsed one: the editor holds a half-built slide whose
 * defaults have not been applied, and a deck posted by hand can carry a step
 * nobody defined. Both land on `medium` here — the size an untouched deck has
 * always been drawn at — rather than on whatever each surface would have
 * guessed, which is how the projector and the phone come to disagree about how
 * big the same sentence is.
 */
export function slideTextSizeFor(slide: {
	textSize?: SlideTextSize | undefined;
}): SlideTextSize {
	const parsed = SlideTextSizeEnum.safeParse(slide.textSize);
	return parsed.success ? parsed.data : "medium";
}

/**
 * The appearance a slide authored for itself, as the fields arrive. Written
 * structurally rather than as `Pick<Slide, …>` for the reason the choice
 * settings below are: the server holds a parsed slide and the editor holds a
 * half-built one, and resolving an override is the same operation on both.
 */
export type SlideAppearanceSettings = {
	layout?: string | null | undefined;
	backgroundColor?: string | null | undefined;
	backgroundImage?: string | null | undefined;
	textColor?: string | null | undefined;
	chartColor?: string | null | undefined;
};

/**
 * A slide's own appearance, resolved (REQ087, REQ070, REQ071, REQ019).
 *
 * Every colour is either a colour or `""`, and `""` means *the deck theme's* —
 * the layering is expressed by absence, so a consumer never has to know which
 * fields were authored, only what to do when one was not.
 */
export type SlideAppearance = {
	/** Where the slide's elements sit — the deferral already resolved. */
	placement: SlidePlacement;
	/** The canvas this slide is drawn on, or `""` for the theme's. */
	backgroundColor: string;
	/** The picture behind it, or `""` for none — and for one we may not load. */
	backgroundImage: string;
	/** The words' colour, or `""` for the theme's. */
	textColor: string;
	/** The seed this slide's charts are drawn from, or `""` for the theme's. */
	chartColor: string;
};

/**
 * What a slide looks like over the deck's theme (REQ087) — the single read site
 * for the four override fields, asked by every surface a slide is drawn on
 * (ADR-0026): the projector, every phone in the room, the editor's preview and
 * its filmstrip, and the shared results page.
 *
 * Everything a value could be wrong in is resolved here and nowhere else: an
 * unknown layout falls back to {@link DEFAULT_SLIDE_PLACEMENT}, a string that is
 * not a colour falls back to the theme's, and a URL no browser should be pointed
 * at falls back to no picture at all. A surface that read `slide.textColor`
 * itself would have stepped around all three.
 */
export function slideAppearanceFor(
	slide: SlideAppearanceSettings,
): SlideAppearance {
	const layout = SlideLayoutEnum.safeParse((slide.layout ?? "").trim());
	const placement =
		layout.success && layout.data !== "inherit"
			? layout.data
			: DEFAULT_SLIDE_PLACEMENT;
	return {
		placement,
		backgroundColor: authoredColorFor(slide.backgroundColor),
		backgroundImage: browserSafeAssetUrl(slide.backgroundImage),
		textColor: authoredColorFor(slide.textColor),
		chartColor: authoredColorFor(slide.chartColor),
	};
}

/**
 * The subset of a slide the choice-settings resolvers below read. Written
 * structurally (rather than `Pick<Slide, …>`) so the same functions accept a
 * parsed slide from the server and a half-built one from the editor, where the
 * defaulted fields are still absent.
 */
type ChoiceSettings = {
	type?: SlideType | undefined;
	options?: { isCorrect?: boolean | undefined }[] | undefined;
	mcMaxSelections?: number | null | undefined;
	allowMultiple?: boolean | undefined;
};

/**
 * How many options one participant may select on a choice slide (REQ014):
 * `1` for single choice, `0` for unlimited, `n` for a capped multi-select.
 *
 * Expressed once here (ADR-0026) because four surfaces need the same answer —
 * the vote validator that enforces it, the participant UI that offers it, the
 * results aggregation that picks its percentage basis, and the editor that
 * shows the current setting. Slides authored before REQ014 carry
 * `mcMaxSelections: null` and fall back to the legacy `allowMultiple` flag, so
 * they keep behaving exactly as they did.
 *
 * **A quiz competition slide is always single answer** (REQ054), whatever a
 * hand-built deck put in `mcMaxSelections`. Its score is one answer's
 * correctness and speed; "how many of the right ones did you find" is a
 * different question with a different scoring model, and letting a multi-select
 * quiz reach the boundary would score it as if it were this one.
 */
export function maxSelectionsFor(slide: ChoiceSettings): number {
	if (slide.type === "quiz") return 1;
	if (typeof slide.mcMaxSelections === "number") return slide.mcMaxSelections;
	return slide.allowMultiple ? 0 : 1;
}

/** Whether a choice slide allows more than one selection per participant. */
export function isMultiSelect(slide: ChoiceSettings): boolean {
	return maxSelectionsFor(slide) !== 1;
}

/** The pair of fields {@link maxResponsesFor} reads, on the same terms as {@link ChoiceSettings}. */
export type ResponseSettings = {
	maxResponses?: number | null | undefined;
	allowMultiple?: boolean | undefined;
};

/**
 * How many answers one participant may send on a word-cloud or open-text slide
 * (REQ022/REQ026): `1` for a single answer, `0` for unlimited, `n` for a cap.
 *
 * Expressed once here for the same reason as {@link maxSelectionsFor}: the vote
 * boundary that enforces it, the participant UI that counts against it, and the
 * editor that shows it (and marks its departure, REQ155) must all resolve the
 * legacy fallback identically — a slide authored before `maxResponses` existed
 * carries only `allowMultiple`, where `true` means unlimited and `false` means
 * one answer.
 */
export function maxResponsesFor(slide: ResponseSettings): number {
	if (typeof slide.maxResponses === "number") return slide.maxResponses;
	return slide.allowMultiple ? 0 : 1;
}

/**
 * Whether the author marked any option correct (REQ013). A choice slide with no
 * marked option has no notion of correctness at all — distinct from "every
 * option is wrong" — so results emit `isCorrect: null` for it (ADR-0024) and no
 * surface renders a solution badge.
 */
export function slideHasCorrectAnswers(slide: ChoiceSettings): boolean {
	return (slide.options ?? []).some((option) => option.isCorrect === true);
}

// ── Ranking submissions (REQ033) ─────────────────────────────
//
// A ranking is one *ordering*, not one choice, so a participant's whole answer
// travels as a single `value` on a single vote row: the item ids they placed,
// best first, joined by `RANKING_VALUE_SEPARATOR`. Keeping the ordering atomic
// is what makes it meaningful — half a submitted order ranks nothing — and it
// means ranking needs no new stored field.
//
// The encode/decode pair lives here, beside the schema both ends parse, because
// the participant surface writes the value and the aggregation reads it back
// (ADR-0013/ADR-0026); neither may spell the wire format itself.

/** Encode an ordered list of item ids (best first) into a vote `value`. */
export function encodeRanking(orderedItemIds: string[]): string {
	return orderedItemIds.join(RANKING_VALUE_SEPARATOR);
}

/**
 * Read a ranking submission back into the item ids it orders, best first, or
 * `null` when it is not a usable ordering of this slide's items.
 *
 * A submission may name a **subset** of the items: REQ034 allows participants to
 * rank only part of the list, and the Borda-style tally in `getSlideResults`
 * scores by position from the top, so a partial order stays comparable with a
 * complete one. What is rejected is an ordering that cannot be scored at all —
 * empty, naming an item the slide does not have, or placing the same item twice
 * (which would let one participant hand an item several positions' worth of
 * points).
 */
export function decodeRanking(
	value: string,
	items: { id: string }[],
): string[] | null {
	const known = new Set(items.map((item) => item.id));
	const ordered = value
		.split(RANKING_VALUE_SEPARATOR)
		.map((itemId) => itemId.trim())
		.filter((itemId) => itemId.length > 0);
	if (ordered.length === 0) return null;
	const seen = new Set<string>();
	for (const itemId of ordered) {
		if (!known.has(itemId) || seen.has(itemId)) return null;
		seen.add(itemId);
	}
	return ordered;
}

// ── 2x2 Grid placements (REQ046, REQ047, REQ050) ─────────────
//
// A grid is Scales in two dimensions (REQ047's own words), so it is modelled
// the way multi-statement scales already are: **one vote row per item**, keyed
// by the existing `statementId`, with the existing `skip` flag carrying "not
// assessable" (REQ050). No new stored field is needed for either.
//
// This deliberately differs from the ranking codec next door, which packs a
// participant's whole answer into one row. A ranking is one *ordering* — half a
// submitted order ranks nothing — while grid items are judged independently:
// a participant may place three items, skip a fourth and leave a fifth for
// later, and every one of those is a complete answer about that item. Per-item
// rows are what make a partial response, a per-item skip, and a per-item
// re-placement expressible at all; folding them into one value would also push
// a full slide of UUID-ided items against `VoteSchema.value`'s 500 characters.
//
// What *is* packed into `value` is the coordinate pair itself, encoded and read
// back by the pair below (ADR-0013/ADR-0026) so neither the participant surface
// nor the aggregation spells the wire format.

/**
 * Read a `"x,y"` submission into the two whole numbers it names, or `null` when
 * it is not two whole numbers at all.
 *
 * The *parse*, and nothing else: what a legal coordinate is differs between the
 * slide types that use this shape — a grid placement is bounded by the axes the
 * organizer authored, a pin by the image's own per-mille lattice — so each codec
 * keeps its own bounds check and only the reading of the wire format is shared
 * (ADR-0010). Surrounding whitespace is tolerated, because a hand-built request
 * may carry it and it changes no coordinate; anything else — a missing half, a
 * third part, a fraction, a word — is refused here rather than in two places.
 */
function decodeIntegerPair(
	value: string,
	separator: string,
): { x: number; y: number } | null {
	const parts = value.split(separator).map((part) => part.trim());
	if (parts.length !== 2) return null;
	const [xText, yText] = parts;
	if (xText.length === 0 || yText.length === 0) return null;
	const x = Number(xText);
	const y = Number(yText);
	if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
	return { x, y };
}

/** Encode a placement into a vote `value`: the x and y coordinate. */
export function encodeGridPoint(point: { x: number; y: number }): string {
	return `${point.x}${GRID_VALUE_SEPARATOR}${point.y}`;
}

/**
 * Read a placement back into its coordinates, or `null` when it is not a point
 * on the grid the organizer authored.
 *
 * Rejected: anything that is not two whole numbers, and any coordinate outside
 * its axis. Both matter because the axes are authored values — an out-of-range
 * point would render outside the plotted field, and a fractional one would
 * claim a precision the sliders never offered. A row stored under an older set
 * of endpoints therefore stops counting once the organizer narrows an axis,
 * rather than dragging the average off the field.
 */
export function decodeGridPoint(
	value: string,
	xAxis: GridAxis,
	yAxis: GridAxis,
): { x: number; y: number } | null {
	const point = decodeIntegerPair(value, GRID_VALUE_SEPARATOR);
	if (!point) return null;
	if (point.x < xAxis.min || point.x > xAxis.max) return null;
	if (point.y < yAxis.min || point.y > yAxis.max) return null;
	return point;
}

/**
 * The subset of a slide the grid axis resolver reads. Written structurally (as
 * {@link ChoiceSettings} is) so the same function accepts a parsed slide from
 * the server and a half-built one from the editor, where a defaulted axis is
 * still absent.
 */
type GridAxisSettings = {
	gridXAxis?: unknown;
	gridYAxis?: unknown;
};

/** Read one authored axis with every endpoint filled in. */
export function resolveGridAxis(axis: unknown): GridAxis {
	const parsed = GridAxisSchema.safeParse(axis ?? {});
	return parsed.success ? parsed.data : GridAxisSchema.parse({});
}

/**
 * Both axes of a grid slide, fully resolved (ADR-0026). Four surfaces need the
 * same answer — the vote validator that bounds a placement, the participant UI
 * that offers the sliders, the aggregation that averages coordinates, and the
 * plot that draws the field — so the defaults are applied in exactly one place
 * and no read site reaches for `??` per endpoint.
 */
export function gridAxesFor(slide: GridAxisSettings): {
	xAxis: GridAxis;
	yAxis: GridAxis;
} {
	return {
		xAxis: resolveGridAxis(slide.gridXAxis),
		yAxis: resolveGridAxis(slide.gridYAxis),
	};
}

// ── 100 Points allocations (REQ044, REQ045) ──────────────────
//
// A participant's whole allocation travels as a single `value` on a single vote
// row, the way a ranking's ordering does — and for a sharper version of the same
// reason. A ranking is one *ordering*; an allocation is one *budget*. Half a
// submitted budget is not half an opinion, it is an unspent budget: the items
// only mean anything relative to the 100 they share, so splitting them across
// rows would let a participant sit at 60 points spent and quietly deflate every
// share their partial ballot was counted into.
//
// Encoded as `itemId:points` pairs joined by `POINTS_VALUE_SEPARATOR`. Items
// given nothing are simply absent — zero is the default reading, so writing it
// out would only spend characters — which is what keeps a full eight-item
// allocation inside `value`'s 500-character budget with UUID ids.
//
// The pair lives here, beside the schema both ends parse, because the
// participant surface writes the value and the aggregation reads it back
// (ADR-0013/ADR-0026); neither may spell the wire format itself.

/**
 * Encode an allocation (item id → points) into a vote `value`. Items funded
 * with nothing are dropped, so what goes on the wire is only what was spent.
 */
export function encodePoints(allocation: Record<string, number>): string {
	return Object.entries(allocation)
		.filter(([, points]) => points > 0)
		.map(
			([itemId, points]) =>
				`${itemId}${POINTS_ALLOCATION_SEPARATOR}${points}`,
		)
		.join(POINTS_VALUE_SEPARATOR);
}

/**
 * Read an allocation back into every item's points — unfunded items included as
 * an explicit `0`, so no read site reaches for `??` — or `null` when it is not
 * a spendable budget for this slide's items.
 *
 * **Exactly {@link POINTS_BUDGET} is required**, and this is where that is
 * decided (ADR-0013): the requirement's whole point is a forced trade-off, and a
 * ballot that stops at 60 is not a milder opinion — it is a different question
 * ("how much did you care to spend?") whose points would still be divided by a
 * full budget in the tally, flattering every item it did fund. Over-spending is
 * rejected for the mirror-image reason: it would buy one participant more say
 * than the room. Rejecting both at the boundary is what makes an item's share
 * comparable across participants at all.
 *
 * Also rejected: an empty submission, a fractional or negative amount, an item
 * the slide does not have, and the same item funded twice (which would let one
 * participant spend past the budget one entry at a time).
 */
export function decodePoints(
	value: string,
	items: { id: string }[],
): Record<string, number> | null {
	// A Map rather than an object literal: item ids are authored data, and a
	// key like "toString" must not be mistaken for one the slide declares.
	const allocation = new Map(items.map((item) => [item.id, 0]));
	const entries = value
		.split(POINTS_VALUE_SEPARATOR)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	if (entries.length === 0) return null;
	const seen = new Set<string>();
	for (const entry of entries) {
		const parts = entry
			.split(POINTS_ALLOCATION_SEPARATOR)
			.map((part) => part.trim());
		if (parts.length !== 2) return null;
		const [itemId, pointsText] = parts;
		if (!allocation.has(itemId) || seen.has(itemId)) return null;
		if (pointsText.length === 0) return null;
		const points = Number(pointsText);
		if (!Number.isInteger(points) || points < 0 || points > POINTS_BUDGET) {
			return null;
		}
		seen.add(itemId);
		allocation.set(itemId, points);
	}
	let spent = 0;
	for (const points of allocation.values()) spent += points;
	if (spent !== POINTS_BUDGET) return null;
	// Object.fromEntries keeps the Map's insertion order — the authored item
	// order — so re-encoding a decoded allocation is canonical.
	return Object.fromEntries(allocation);
}

// ── Guess the Number (REQ039–REQ043) ─────────────────────────
//
// A guess is one number, so it is the simplest submission of any slide type
// here: one row per participant, the number itself as `value`, no `statementId`
// and no packing. What is not simple is *which* numbers count, and that is
// decided in exactly one place below.
//
// The range and the step are authored settings, not client conventions, so a
// submission is checked against them at the boundary and rejected outright
// rather than clamped or rounded (`decodeGuess`). Both alternatives would record
// an estimate the participant never made — and on this slide type the estimate
// is the entire datum, so a silently moved one is not a rounding detail, it is a
// fabricated opinion in the distribution.
//
// Correctness (REQ041/REQ042) is derived here too, from the authored reference,
// so the aggregation and every surface that badges a guess agree on where the
// accepted window starts and ends (ADR-0026).

/**
 * Whether a range can actually be guessed in. A frame is usable when it is a
 * frame at all: whole numbers, a step of at least one, a high end above the low
 * one, and a step no wider than the span it divides — a step wider than the
 * range would leave `min` as the only selectable value, which is a slide with
 * one possible answer.
 *
 * Read by the codec, which lets an unusable frame accept **no** submissions
 * rather than guessing what its author meant, and by the editor, which refuses
 * to save one. Failing closed matters more than failing helpfully here: a
 * distribution of numbers gathered under a frame nobody can state is not a
 * result anyone can read.
 */
export function isUsableGuessRange(range: GuessRange): boolean {
	if (
		!Number.isInteger(range.min) ||
		!Number.isInteger(range.max) ||
		!Number.isInteger(range.step)
	) {
		return false;
	}
	if (range.step < 1) return false;
	if (range.max <= range.min) return false;
	return range.step <= range.max - range.min;
}

/**
 * The subset of a slide the guess resolvers read. Written structurally (as
 * {@link ChoiceSettings} is) so the same functions accept a parsed slide from
 * the server and a half-built one from the editor, where a defaulted range is
 * still absent.
 */
type GuessSettings = {
	guessRange?: unknown;
	guessReference?: unknown;
};

/** Read one authored range with every endpoint and the step filled in. */
export function resolveGuessRange(range: unknown): GuessRange {
	const parsed = GuessRangeSchema.safeParse(range ?? {});
	return parsed.success ? parsed.data : GuessRangeSchema.parse({});
}

/**
 * A guess slide's frame, fully resolved (ADR-0026). Four surfaces need the same
 * answer — the vote validator that bounds a guess, the participant UI that
 * offers the number field, the aggregation that buckets the distribution, and
 * the plot that draws it — so the defaults are applied in exactly one place and
 * no read site reaches for `??` per endpoint.
 */
export function guessRangeFor(slide: GuessSettings): GuessRange {
	return resolveGuessRange(slide.guessRange);
}

/**
 * A guess slide's reference with its tolerance filled in, or `null` when the
 * slide has none (REQ041). The counterpart to {@link guessRangeFor}, and the one
 * place the tolerance default is applied: an editor's half-built reference
 * carries no tolerance yet, and letting each surface reach for `?? 0` would put
 * the "strictest reading" decision in four places instead of the schema.
 *
 * Anything that is not a usable reference — including the `null` that means the
 * author set none — reads as `null`, so "no notion of correctness" has exactly
 * one shape at every read site.
 */
export function guessReferenceFor(slide: GuessSettings): GuessReference | null {
	if (slide.guessReference === null || slide.guessReference === undefined) {
		return null;
	}
	const parsed = GuessReferenceSchema.safeParse(slide.guessReference);
	return parsed.success ? parsed.data : null;
}

/** Encode a guess into a vote `value`. */
export function encodeGuess(guess: number): string {
	return String(guess);
}

/**
 * Read a guess back into the number it states, or `null` when it is not one of
 * the values this slide offers.
 *
 * Rejected: anything that is not a whole number, a number outside the authored
 * range (REQ040), a number that does not sit on the authored step grid (REQ043),
 * and every submission at all to a slide whose range is unusable. Off-step is
 * rejected rather than snapped for the reason above the block: the participant's
 * number *is* the answer, so moving it invents one.
 *
 * A row stored under an older frame therefore stops counting once the organizer
 * narrows the range or coarsens the step, rather than dragging the distribution
 * outside the picture it is plotted on.
 */
export function decodeGuess(value: string, range: GuessRange): number | null {
	if (!isUsableGuessRange(range)) return null;
	const text = value.trim();
	if (text.length === 0) return null;
	const guess = Number(text);
	if (!Number.isInteger(guess)) return null;
	if (guess < range.min || guess > range.max) return null;
	// Counted from `min`, not from zero: the grid an organizer authors starts
	// where their range starts, so 1–10 in twos offers 1,3,5,7,9 — not 2,4,6,8.
	return (guess - range.min) % range.step === 0 ? guess : null;
}

/**
 * The window of numbers that count as correct (REQ042), or `null` when the slide
 * has no reference at all (REQ041) — the "no notion of correctness" case, which
 * every surface must be able to tell apart from "nobody was right".
 *
 * Inclusive at both ends: REQ042's example is reference 7 with ±1 accepting
 * 6–8, so a guess exactly at the edge of the tolerance the organizer granted is
 * inside it. The window is deliberately not clamped to the slide's range — an
 * organizer who sets a reference at the top of the range still means "within one
 * of it", and a clamp would quietly make the accepted window asymmetric.
 */
export function correctGuessRangeFor(
	reference: GuessReference | null | undefined,
): { min: number; max: number } | null {
	if (!reference) return null;
	return {
		min: reference.value - reference.tolerance,
		max: reference.value + reference.tolerance,
	};
}

// ── Where the selectable values are (REQ043) ──────────────────
//
// Three surfaces need to name a value the slide actually offers rather than any
// number in the range: the editor seeds a reference number, the participant's ±
// controls land on a value the boundary will accept, and the check below asks
// whether a reference is reachable at all. Written once here (ADR-0026) so a
// "valid value" cannot mean one thing where it is offered and another where it
// is judged — the defect that let the editor seed a number nobody could submit.

/**
 * The highest value the step grid offers. `max` is the *bound*, not necessarily
 * a selectable value: 0–10 in threes stops at 9.
 */
export function highestGuessValue(range: GuessRange): number {
	return (
		range.min + Math.floor((range.max - range.min) / range.step) * range.step
	);
}

/** Pull a number onto the nearest value the slide offers, inside its range. */
export function snapGuessToGrid(value: number, range: GuessRange): number {
	const steps = Math.round((value - range.min) / range.step);
	const snapped = range.min + steps * range.step;
	return Math.min(Math.max(snapped, range.min), highestGuessValue(range));
}

/**
 * The selectable value nearest the middle of the range. It is what the ±
 * controls start from on an untouched slide and what the editor seeds a fresh
 * reference number with — the same value in both places, because a seed the
 * participant surface would refuse is the bug this exists to prevent.
 */
export function middleGuessValue(range: GuessRange): number {
	return snapGuessToGrid(Math.round((range.min + range.max) / 2), range);
}

/**
 * Whether any value the slide offers falls inside the accepted window (REQ042) —
 * that is, whether a participant can be right at all.
 *
 * This is the check a reference number needs, and it is deliberately *not*
 * "the reference sits on the step grid". A reference is the truth, while the
 * step is the input resolution, and the two need not coincide: a true figure of
 * 517 on a slide that steps in tens is a perfectly good question once the
 * tolerance is ±10, because 510 and 520 are then correct. What is never a good
 * question is a window no selectable value reaches — reference 6 on a slide
 * offering 1, 3, 5, 7, 9, or a reference outside the range entirely. Those read
 * as an authored correct answer while `correctCount` stays 0 for every
 * participant forever, which is worse than having no reference at all.
 *
 * A slide with no reference is trivially fine: it claims no correct answer, so
 * there is nothing to be unreachable.
 */
export function isReachableGuessReference(
	range: GuessRange,
	reference: GuessReference | null | undefined,
): boolean {
	if (!reference) return true;
	if (!isUsableGuessRange(range)) return false;
	const window = correctGuessRangeFor(reference);
	if (!window) return true;
	// The lowest selectable value at or above the window's floor; correct when
	// it is still inside the window and on the board.
	const firstAtOrAbove =
		range.min +
		Math.ceil((Math.max(window.min, range.min) - range.min) / range.step) *
			range.step;
	return (
		firstAtOrAbove <= window.max && firstAtOrAbove <= highestGuessValue(range)
	);
}

/** One column of the distribution: the span of guesses it collects. */
export type GuessBucket = {
	/** Lowest selectable value in the column. */
	from: number;
	/**
	 * Highest selectable value in the column — the last *step*, not the boundary
	 * before the next column. A one-value column has `from === to`, and a guess
	 * belongs to the column where `from <= guess <= to`.
	 */
	to: number;
};

/**
 * The columns a range's distribution is drawn in (REQ039), derived from the
 * authored frame alone — no votes involved. Shared by the aggregation that fills
 * them, the editor preview that shows the empty frame, and the plot that draws
 * both (ADR-0026), so a column can never mean one span in the tally and another
 * on screen.
 *
 * Every column spans the same number of steps, so the columns stay comparable by
 * height; the last one is short when the step count does not divide evenly,
 * which is the honest way round — inventing values past `max` to pad it would
 * put selectable numbers on the axis that the slide never offered. An unusable
 * range has no columns at all.
 */
export function guessBucketsFor(range: GuessRange): GuessBucket[] {
	if (!isUsableGuessRange(range)) return [];
	const stepCount = Math.floor((range.max - range.min) / range.step) + 1;
	const stepsPerBucket = Math.ceil(
		stepCount / Math.min(stepCount, GUESS_BUCKET_LIMIT),
	);
	const bucketCount = Math.ceil(stepCount / stepsPerBucket);
	return Array.from({ length: bucketCount }, (_, bucketIndex) => {
		const lastStepIndex = Math.min(
			(bucketIndex + 1) * stepsPerBucket - 1,
			stepCount - 1,
		);
		return {
			from: range.min + bucketIndex * stepsPerBucket * range.step,
			to: range.min + lastStepIndex * range.step,
		};
	});
}

// ── Pin on Image (REQ051, REQ052, REQ053) ────────────────────
//
// A pin is one point, so it votes the way a guess does and for the same reason:
// **one row per participant**, the coordinates as `value`, no `statementId`, and
// a re-submission *replaces* the pin rather than adding a second one. Moving your
// pin is the normal gesture on this slide — the answer is where the participant
// ended up pointing — and letting the rows accumulate would weight one person's
// indecision as a cluster of agreement in the distribution the room reads.
//
// Everything a surface needs about a pin slide is derived below, once
// (ADR-0026): which image the question is asked on (REQ052), where the target
// area is (REQ053), whether a pin is inside it, and whether the audience may be
// told any of that yet. The boundary that accepts a submission, the aggregation
// that counts the hits, the participant's canvas and the shared screen all read
// these functions rather than each spelling the rule again.

/**
 * The subset of a slide the pin resolvers read. Structural, like
 * {@link ChoiceSettings} and {@link GuessSettings}, so the same functions accept
 * a parsed slide from the server and a half-built one from the editor, where a
 * defaulted field is still absent.
 */
type PinSettings = {
	mediaUrl?: string | undefined;
	mediaAlt?: string | undefined;
	pinArea?: unknown;
};

/**
 * Whether this slide type's `mediaUrl` is the surface participants interact with
 * rather than an illustration shown beside the question.
 *
 * The one read site for that difference (ADR-0026), and it exists because the
 * failure it prevents is invisible in the schema: every interactive slide draws
 * `mediaUrl` above its control (REQ069), so a pin slide would otherwise show its
 * canvas twice — once as decoration nobody can tap, once as the thing being
 * answered — on the participant's phone *and* on the shared screen.
 */
export function slideMediaIsInteractionArea(type: SlideType): boolean {
	return type === "pin-image";
}

/**
 * The image a Pin on Image question is asked on (REQ052), with its alt text.
 *
 * Read through here rather than off the field, because "has this slide got an
 * interaction area yet?" is a question four surfaces ask and one of them is the
 * vote boundary: a pin slide with no image has no coordinate space, so it accepts
 * no submissions at all (the same stance an unusable guess range takes). The URL
 * is trimmed, so a field holding only spaces is the absence it looks like.
 *
 * REQ052 names .png, .gif, .jpg, .jpeg, .svg, .webp, .avif, .heic and .heif as
 * the formats it expects to work. Nothing here checks the extension: the image is supplied by
 * URL and rendered by the browser, so what is displayable is the browser's answer
 * to give — and a format allowlist on our side would refuse pictures that work
 * while still admitting URLs that are not images at all.
 */
export function pinImageFor(slide: PinSettings): { url: string; alt: string } {
	return {
		url: (slide.mediaUrl ?? "").trim(),
		alt: slide.mediaAlt ?? "",
	};
}

/** Encode a pin into a vote `value`: its per-mille x and y on the image. */
export function encodePinPoint(point: { x: number; y: number }): string {
	return `${point.x}${PIN_VALUE_SEPARATOR}${point.y}`;
}

/**
 * Read a pin back into its coordinates, or `null` when it is not a point on the
 * image's lattice.
 *
 * Rejected: anything that is not two whole numbers, and any coordinate outside
 * `0…`{@link PIN_COORDINATE_MAX}. Out-of-range is refused rather than clamped for
 * the reason a guess is never rounded: the position *is* the whole answer here, so
 * a coordinate pulled onto the edge of the picture is an opinion the participant
 * did not give — and one that would sit in the distribution the room reads as if
 * they had.
 *
 * Unlike a grid placement, the bounds are fixed rather than authored, so a stored
 * pin can never stop decoding: the lattice is the image's own edges, and nothing
 * the organizer edits afterwards moves them. Swapping the image swaps the picture
 * under the room's pins — which is the honest outcome, since the pins are
 * positions on the frame, and re-authoring the question is what changes what they
 * meant.
 */
export function decodePinPoint(value: string): { x: number; y: number } | null {
	const point = decodeIntegerPair(value, PIN_VALUE_SEPARATOR);
	if (!point) return null;
	if (point.x < 0 || point.x > PIN_COORDINATE_MAX) return null;
	if (point.y < 0 || point.y > PIN_COORDINATE_MAX) return null;
	return point;
}

/**
 * The target area a pin slide names (REQ053), or `null` when it names none.
 *
 * Anything that is not a usable rectangle — including the `null` that means the
 * author drew none, and a half-built one from an editor mid-drag — reads as
 * `null`, so "this question has no correct area" has exactly one shape at every
 * read site. The counterpart to {@link guessReferenceFor}, and the same reason it
 * exists: without it each surface would reach for `??` per corner and the
 * "unauthored" case would be spelled four different ways.
 */
export function pinAreaFor(slide: PinSettings): PinArea | null {
	if (slide.pinArea === null || slide.pinArea === undefined) return null;
	const parsed = PinAreaSchema.safeParse(slide.pinArea);
	if (!parsed.success) return null;
	return isUsablePinArea(parsed.data) ? parsed.data : null;
}

/**
 * Whether a rectangle is a target a pin can actually land in: at least one
 * per-mille across each way, and wholly on the image.
 *
 * A target that runs off the edge is refused rather than cropped, on the same
 * grounds a guess range that cannot be guessed in accepts nothing: an area part
 * of which no participant can reach makes "how many were inside?" a number about
 * the picture rather than about the room. Read by the resolver above, which lets
 * an unusable area read as no area at all, and by the editor, which refuses to
 * save one.
 */
export function isUsablePinArea(area: PinArea): boolean {
	if (
		!Number.isInteger(area.x) ||
		!Number.isInteger(area.y) ||
		!Number.isInteger(area.width) ||
		!Number.isInteger(area.height)
	) {
		return false;
	}
	if (area.width < 1 || area.height < 1) return false;
	if (area.x < 0 || area.y < 0) return false;
	return (
		area.x + area.width <= PIN_COORDINATE_MAX &&
		area.y + area.height <= PIN_COORDINATE_MAX
	);
}

/**
 * Whether a pin landed inside the target area (REQ053).
 *
 * **Inclusive on every edge**, which is the same call {@link correctGuessRangeFor}
 * makes about a tolerance: the organizer drew a boundary to include the thing
 * inside it, and a pin exactly on the line they drew is a pin on the target. It
 * is also the only reading a participant can act on — nobody can aim at "inside
 * but not on the edge" — and integers make the comparison exact, so a pin is
 * never inside on one surface and outside on another.
 */
export function isPinInArea(
	point: { x: number; y: number },
	area: PinArea,
): boolean {
	return (
		point.x >= area.x &&
		point.x <= area.x + area.width &&
		point.y >= area.y &&
		point.y <= area.y + area.height
	);
}

// ── Form submissions (REQ061) ────────────────────────────────
//
// See the block above {@link FormFieldTypeEnum} for why a form is one row. What
// is decided here is the two things that follow from it: what a **usable** field
// is, and what one submission looks like on the wire.
//
// The wire format is `fieldId`{US}`answer` pairs joined by {RS} — the ASCII unit
// and record separators. Every other codec here joins on a printable character
// (`,` between ranking ids, `:` between an item and its points) because every
// other codec packs *ids and numbers*, where a comma cannot occur. A form packs
// free text, so a printable separator would have to be escaped — and an escaping
// scheme is a second thing to get wrong on both ends. U+001E and U+001F cannot
// be typed into a field on a phone, carry no meaning in any answer, and are
// refused outright below, so they separate without escaping anything.
//
// Answers are bound to fields by **id**, never by position. A form is the slide
// type most likely to be re-authored between sessions — a field added, one
// reworded, two swapped — and positional binding would not invalidate the old
// rows, which would be honest, it would silently re-attribute them: last month's
// email addresses read back as this month's job titles.

/** Separator between one field's answer and the next. */
const FORM_FIELD_SEPARATOR = "\u001e";

/** Separator between a field's id and the answer given to it. */
const FORM_ANSWER_SEPARATOR = "\u001f";

/**
 * The longest a whole form submission may be on the wire — every field answered
 * to the last character.
 *
 * Derived rather than picked, so the three numbers can never disagree: a field
 * costs its id (a UUID), the two separators around its answer, and the answer
 * itself, and a form may carry {@link FORM_FIELD_LIMIT} of them. A rounder
 * hand-chosen number would be a fourth constant to keep in step with the other
 * three, and the day it fell behind, a legitimately full form would be refused
 * at the boundary with nothing on screen to explain why.
 */
export const FORM_VALUE_MAX_LENGTH =
	FORM_FIELD_LIMIT * (36 + 2 + FORM_ANSWER_MAX_LENGTH);

/**
 * What an email field accepts — a local part, an `@`, and a host with at least
 * one dot in it.
 *
 * Deliberately a *shape* check and deliberately nothing more. No regular
 * expression decides whether an address exists, and the ones that try to encode
 * RFC 5322 reject real addresses people actually hold, which on this slide type
 * means turning away the participant the organizer wanted to hear from. What
 * this catches is the failure worth catching at the boundary: a phone number, a
 * name, a sentence — something that is plainly not an address, typed into the
 * field that promised the organizer one.
 *
 * A dotless host (`ada@localhost`) is refused with it. That is an address only
 * inside one machine, and a form exists to collect a way to reach somebody from
 * outside the room.
 */
const FORM_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/u;

/** Whether a string is shaped like an address an organizer could write to. */
export function isFormEmail(text: string): boolean {
	return FORM_EMAIL.test(text.trim());
}

/**
 * Whether a field is one a participant can actually answer.
 *
 * A field needs words to be a question — an unlabelled input asks nothing, and
 * an answer to it would mean nothing in the export — and a `choice` field needs
 * something to choose between. Both are the state a half-authored slide is in,
 * and both read as "not a field yet" rather than as an error: the editor refuses
 * to save one (see the create page's checks), and until then the surfaces simply
 * do not draw it.
 *
 * The same stance {@link isUsableGuessRange} and {@link isUsablePinArea} take,
 * for the same reason — a question nobody can answer must not silently collect
 * rows that mean nothing.
 */
export function isUsableFormField(field: FormField): boolean {
	if (field.label.trim().length === 0) return false;
	if (field.type !== "choice") return true;
	return field.options.some((option) => option.text.trim().length > 0);
}

/**
 * The subset of a slide the form resolvers read. Structural, like
 * {@link PinSettings} and {@link GuessSettings}, so the same functions accept a
 * parsed slide from the server and a half-built one from the editor.
 */
type FormSettings = {
	formFields?: unknown;
};

/**
 * The fields a Form slide actually asks (REQ061) — the authored list with every
 * default applied and the unfinished ones dropped.
 *
 * The single read site (ADR-0026), asked by the boundary that judges a
 * submission, the phone that draws the inputs, the tally that groups the
 * answers, and the export that names them. A field this refuses is a field none
 * of them knows about, so a half-authored row cannot be answerable on one
 * surface and invisible on another.
 *
 * A slide with no usable field asks nothing, and the boundary accepts nothing
 * for it — the stance a pin slide with no image takes (REQ052).
 */
export function formFieldsFor(slide: FormSettings): FormField[] {
	const parsed = z.array(FormFieldSchema).safeParse(slide.formFields ?? []);
	if (!parsed.success) return [];
	return parsed.data.filter(isUsableFormField);
}

/**
 * Encode one participant's filled-in form into a vote `value`. Fields left blank
 * are dropped, so what goes on the wire is only what was written — the same
 * economy {@link encodePoints} applies to an unfunded item.
 */
export function encodeFormSubmission(answers: Record<string, string>): string {
	return Object.entries(answers)
		.map(([fieldId, answer]) => [fieldId, answer.trim()] as const)
		.filter(([, answer]) => answer.length > 0)
		.map(
			([fieldId, answer]) =>
				`${fieldId}${FORM_ANSWER_SEPARATOR}${answer}`,
		)
		.join(FORM_FIELD_SEPARATOR);
}

// ── Judging a submission vs. reading one back ─────────────────
//
// A form's answers are read in two situations that look alike and are not, and
// keeping them apart is the difference between a slide an organizer can edit and
// one that destroys its own dataset the first time they touch it.
//
//  - **Judging an incoming submission** (`decodeFormSubmission`) asks: *may this
//    row be stored?* It is asked once, at the vote boundary, against the slide as
//    it stands at that instant, and it is strict — a required field left blank, an
//    address that is not one, an option the field does not offer, a field the
//    slide does not have. Every one of those is a client sending something the
//    organizer did not ask for, and the answer is no.
//  - **Reading a stored row back** (`readFormSubmission`) asks a different
//    question entirely: *what did this person write?* They wrote it under the
//    slide as it stood **then**, and the row is a record of that, not a fresh
//    claim about the slide as it stands now.
//
// Judging a stored row by today's rules is how one ordinary edit erases a
// dataset. Tick "Required" on an optional field after forty people have answered
// and every row that left it blank fails a rule that did not exist when it was
// written; delete a field and *every* row names something the slide has not got,
// so all forty vanish from the tally and land in the export as empty cells. The
// rows are still in SQLite the whole time — nothing can read them.
//
// This is deliberately **not** the stance `decodeGuess` and `decodeGridPoint`
// take, where re-authoring a frame does stop a row counting, and the difference
// is what the row *is*. A guess outside the range no longer has a place on the
// axis it would be plotted on; the number is meaningless without its frame. A
// name and an email address mean exactly what they meant before somebody
// reworded the question above them. So the read-back drops only what it can no
// longer name — an entry whose field is gone — and keeps everything else, at
// full fidelity, including an answer today's field type would refuse.

/**
 * The wire format, read into the entries it names — or `null` when it is not the
 * wire format at all.
 *
 * The parse and nothing else (ADR-0010): what a *legal* answer is differs
 * between judging a submission and reading one back, so only the reading of the
 * format is shared and each caller keeps its own rules. Refused here: an entry
 * that is not exactly one field id and one answer (which is also what an answer
 * carrying either separator becomes), and the same field answered twice, which
 * would let one entry quietly overwrite another and leave the participant's own
 * record ambiguous.
 */
function parseFormEntries(value: string): Map<string, string> | null {
	// A Map rather than an object literal, for the reason `decodePoints` uses
	// one: field ids are authored data, and a key like "toString" must not be
	// mistaken for one the slide declares.
	const entries = new Map<string, string>();
	const written = value
		.split(FORM_FIELD_SEPARATOR)
		.filter((entry) => entry.length > 0);
	if (written.length === 0) return null;
	for (const entry of written) {
		const parts = entry.split(FORM_ANSWER_SEPARATOR);
		if (parts.length !== 2) return null;
		const [fieldId, answer] = parts;
		if (entries.has(fieldId)) return null;
		entries.set(fieldId, answer.trim());
	}
	return entries;
}

/**
 * Project a parsed row onto the fields the slide asks now: every field present
 * with an explicit `""` where nothing was written, so no read site reaches for
 * `??`, and in **authored field order**, so re-encoding what was read is
 * canonical whatever order the entries arrived in.
 */
function formAnswersFor(
	entries: Map<string, string>,
	fields: FormField[],
): Record<string, string> {
	const answers = new Map(fields.map((field) => [field.id, ""]));
	for (const field of fields) {
		const answer = entries.get(field.id);
		if (answer !== undefined) answers.set(field.id, answer);
	}
	// Object.fromEntries keeps the Map's insertion order — the authored order.
	return Object.fromEntries(answers);
}

/**
 * Judge an incoming submission against the slide as it stands: every field's
 * answer when the row may be stored, `null` when it may not. **The vote boundary
 * only** — see the block above for why nothing reads a stored row with this.
 *
 * Rejected, and each for its own reason:
 *
 *  - **A field the slide does not have**, or the same field answered twice. The
 *    first is an answer to a question that is not being asked; the second is not
 *    a readable row at all.
 *  - **An answer past {@link FORM_ANSWER_MAX_LENGTH}**, or one carrying either
 *    separator. Both are the wire format being written rather than filled in.
 *  - **An email field that was not given an address** ({@link isFormEmail}) and
 *    a **choice field given something that is not one of its options**. This is
 *    the whole reason a field carries a type: checked here, at the boundary, so
 *    the organizer's export cannot contain an "email" that never was one.
 *  - **A required field left blank**, which is the organizer's own decision
 *    about what makes a submission complete, and the one rule here that is
 *    theirs rather than the format's.
 *  - **A form with nothing written in it at all.** An empty submission is not a
 *    quiet opinion the way an abstention is; it is a row that says nothing about
 *    anybody, and a pile of them is the export's noise floor.
 */
export function decodeFormSubmission(
	value: string,
	fields: FormField[],
): Record<string, string> | null {
	if (fields.length === 0) return null;
	const entries = parseFormEntries(value);
	if (!entries) return null;
	const byId = new Map(fields.map((field) => [field.id, field]));
	for (const [fieldId, answer] of entries) {
		const field = byId.get(fieldId);
		if (!field) return null;
		if (answer.length === 0) continue;
		if (answer.length > FORM_ANSWER_MAX_LENGTH) return null;
		if (field.type === "email" && !isFormEmail(answer)) return null;
		if (
			field.type === "choice" &&
			!field.options.some((option) => option.id === answer)
		) {
			return null;
		}
	}
	const answers = formAnswersFor(entries, fields);
	for (const field of fields) {
		if (field.required && answers[field.id] === "") return null;
	}
	if (Object.values(answers).every((answer) => answer.length === 0)) return null;
	return answers;
}

/**
 * Read a **stored** row back into what its author wrote: every field the slide
 * asks now, with an explicit `""` where they wrote nothing, or `null` only when
 * the row is not a form submission at all.
 *
 * The tally, the results payload and the export all read through here, and none
 * of them re-judges the row — see the block above. The rules the boundary
 * applied were the rules at the moment it was written, and applying today's to
 * a record of the past is how an ordinary edit deletes a dataset:
 *
 *  - **A field that has since been made required** does not retroactively
 *    invalidate the rows that left it blank. They were complete submissions.
 *  - **An answer today's field type would refuse** — a name under a field since
 *    narrowed from text to email — is still what somebody wrote, so it is
 *    reported as written rather than dropped. The organizer reading the export
 *    can see what happened; a silent gap would tell them nothing.
 *  - **An entry naming a field that is gone** is the one thing dropped, because
 *    it is the one thing that can no longer be *named*: there is no label left to
 *    print it under. The rest of the row survives, which is the whole point —
 *    deleting one field of six must not take the other five answers with it.
 *
 * `null` is therefore reserved for a row that was never a submission: a malformed
 * entry, or the same field written twice.
 */
export function readFormSubmission(
	value: string,
	fields: FormField[],
): Record<string, string> | null {
	const entries = parseFormEntries(value);
	if (!entries) return null;
	return formAnswersFor(entries, fields);
}

/**
 * One decoded submission spelled out for a human: what each answered field asked
 * and what was written in it, in authored order.
 *
 * Written once here (ADR-0026) because three surfaces show the same row — the
 * results table on the organizer's screen, the export's Responses sheet, and the
 * per-participant matrix — and a choice answer is stored as an option **id**,
 * which none of them may print. A field left blank is left out rather than
 * printed empty: the row is what somebody wrote, and a list of the questions
 * they skipped is not part of it.
 */
export function describeFormSubmission(
	fields: FormField[],
	answers: Record<string, string>,
): { label: string; answer: string }[] {
	return fields
		.map((field) => {
			const answer = answers[field.id] ?? "";
			if (answer.length === 0) return null;
			if (field.type !== "choice") return { label: field.label, answer };
			const picked = field.options.find((option) => option.id === answer);
			// An option since deleted leaves an id nobody can read. The row is still
			// the row somebody submitted, so it is reported rather than dropped —
			// with the id, which is the only truthful thing left to say about it.
			return { label: field.label, answer: picked ? picked.text : answer };
		})
		.filter((entry): entry is { label: string; answer: string } => entry !== null);
}

// ── Video slide (REQ064) ─────────────────────────────────────
//
// A video slide plays a file **this service does not host** — the organizer
// supplies a URL and the browser fetches it from wherever it already lives.
// Nothing here uploads, stores, transcodes or proxies anything, and that is the
// requirement rather than a shortcut: the deck references the video the way an
// image slide references its picture (REQ063).
//
// Which leaves exactly one question, asked once here (ADR-0026) because the
// editor, the preview pane, the shared screen and the phones all need the same
// answer: *how do you play this URL?* A link to a video platform is a page, not
// a file — pointing a `<video>` element at a YouTube watch URL plays nothing —
// so the provider's own player is loaded in a frame, and only a URL that really
// is a file gets the browser's media element.
//
// It is also the boundary that decides what a player may be pointed at, which is
// why the resolver returns `null` rather than a best guess. An `<iframe src>` is
// a navigation: a `javascript:` or `data:` URL in one executes in the page,
// while the same string in an `<img src>` merely fails to load. So the scheme is
// checked here, at the single read site, instead of being trusted at four render
// sites — and an unplayable URL surfaces to the organizer as "this cannot be
// played" rather than as a blank rectangle in front of a room.

/** How a video slide's URL is played. */
export type SlideVideo = {
	/**
	 * `embed` is a provider's own player, loaded in a frame; `file` is a media
	 * file the browser plays itself.
	 */
	kind: "embed" | "file";
	/** The URL to load — the provider's player URL, or the authored file URL. */
	url: string;
};

/**
 * The subset of a slide the video resolver reads. Structural, like
 * {@link PinSettings}, so it accepts a parsed slide from the server and a
 * half-built one from the editor alike.
 */
type VideoSettings = {
	mediaUrl?: string | undefined;
};

/** Hosts whose watch/share links are YouTube videos. */
const YOUTUBE_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"m.youtube.com",
	"music.youtube.com",
	"youtube-nocookie.com",
	"www.youtube-nocookie.com",
]);

/** Hosts whose links are Vimeo videos. */
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com"]);

/** A YouTube video id as it appears in a share link. */
const YOUTUBE_ID = /^[\w-]{6,20}$/;

/** The path segment carrying a Vimeo video's numeric id. */
const VIMEO_ID = /^\d+$/;

/** A Vimeo unlisted-link hash, which its player needs to open the video. */
const VIMEO_HASH = /^[0-9a-z]+$/i;

/**
 * The YouTube video id a link names, or `""` when it names none.
 *
 * The four shapes a share button produces — `watch?v=`, `youtu.be/`, `shorts/`
 * and an already-embedded `embed/` — plus `live/`, which a premiere hands out
 * and which becomes an ordinary video once it has aired.
 */
function youtubeVideoId(url: URL): string {
	const segments = url.pathname.split("/").filter((segment) => segment !== "");
	if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
		return segments[0] ?? "";
	}
	if (!YOUTUBE_HOSTS.has(url.hostname)) return "";
	if (segments[0] === "watch") return url.searchParams.get("v") ?? "";
	if (
		segments[0] === "embed" ||
		segments[0] === "shorts" ||
		segments[0] === "live"
	) {
		return segments[1] ?? "";
	}
	return "";
}

/**
 * The player URL for a link to a video platform, or `""` when the URL names no
 * platform this knows and is therefore a plain file.
 *
 * YouTube is embedded through `youtube-nocookie.com`, the privacy-preserving
 * host: the audience did not choose to visit a video platform, they walked into
 * a room, so the deck asks for the player that does not plant tracking cookies
 * on their phone before they have pressed anything.
 */
function providerPlayerUrl(url: URL): string {
	const youtubeId = youtubeVideoId(url);
	if (youtubeId !== "" && YOUTUBE_ID.test(youtubeId)) {
		return `https://www.youtube-nocookie.com/embed/${youtubeId}`;
	}
	if (url.hostname === "player.vimeo.com") return url.toString();
	if (VIMEO_HOSTS.has(url.hostname)) {
		const segments = url.pathname.split("/").filter((segment) => segment !== "");
		const idIndex = segments.findIndex((segment) => VIMEO_ID.test(segment));
		if (idIndex !== -1) {
			const player = `https://player.vimeo.com/video/${segments[idIndex]}`;
			// An unlisted video is only reachable with the hash its share link
			// carries, so a link that has one keeps it — dropping it would turn a
			// playable URL into a private-video notice on the projector.
			const hash = segments[idIndex + 1];
			return hash && VIMEO_HASH.test(hash) ? `${player}?h=${hash}` : player;
		}
	}
	return "";
}

/**
 * How a video slide's URL is played (REQ064), or `null` when it is not something
 * a player may be pointed at — the slide carries no URL yet, or the URL is not
 * `http(s)`.
 *
 * The refusal is the safe default and it is deliberately not a repair: a URL
 * that cannot be played is shown to the organizer as one, in the editor, while
 * they can still fix it. Silently rewriting it would mean the deck plays
 * something nobody authored.
 *
 * A root-relative path is a file this deployment already serves, so it is played
 * as one; a protocol-relative `//host/…` is not, since it names a scheme the
 * checks below never get to see.
 */
export function slideVideoFor(slide: VideoSettings): SlideVideo | null {
	const authored = (slide.mediaUrl ?? "").trim();
	if (authored === "") return null;
	if (authored.startsWith("//")) return null;
	if (authored.startsWith("/")) return { kind: "file", url: authored };
	let parsed: URL;
	try {
		parsed = new URL(authored);
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	const player = providerPlayerUrl(parsed);
	if (player !== "") return { kind: "embed", url: player };
	return { kind: "file", url: authored };
}

// ── Embed slide (REQ066, REQ067, REQ068) ─────────────────────
//
// An embed slide frames a deck or a board **somebody else hosts** — a PowerPoint
// file on a web host or in OneDrive/SharePoint (REQ066), a Google Slides deck
// (REQ067), a Miro board (REQ068) — so a presenter can page through material
// they already have without leaving the deck flow, and a room can work in a
// board without being sent to another tab. Nothing is uploaded, converted or
// proxied: the organizer supplies a link and the provider's own viewer draws it.
// Turning a *file* into slides here is a different requirement and is not this
// one; so is driving those slides from the deck's own navigation.
//
// Which leaves the one question this section answers, once (ADR-0026), for the
// editor, the preview pane, the shared screen and the phones: *whose viewer does
// this link open, and at which URL?* A share link is a page for a human — an
// `<iframe>` pointed at `docs.google.com/presentation/d/…/edit` shows a sign-in
// wall, not a deck — so each provider's link is normalised to that provider's
// own embed entry point, and the deck keeps the string the organizer typed.
//
// **The allowlist is the security boundary, and it is the whole of it.** An
// `<iframe src>` is a navigation into our page's frame tree, so an embed slide
// is the one surface that must never be pointed at "whatever the author pasted":
// a URL that is not one of these three providers resolves to `null` rather than
// being framed on a guess. That is stricter than the video slide next door, on
// purpose — a video link that names no platform is still a file a `<video>`
// element plays with no scripting of its own, while an unrecognised page in a
// frame would be arbitrary third-party script running beside the deck. Only
// `https:` is accepted for the same reason: every provider here serves it, and a
// deck displayed to a room should not be fetched over a connection anybody on
// its wifi can rewrite.

/** The providers an embed slide can frame (REQ066, REQ067, REQ068). */
export const EmbedProviderEnum = z.enum([
	"powerpoint",
	"google-slides",
	"miro",
]);
export type EmbedProvider = z.infer<typeof EmbedProviderEnum>;

/**
 * What each embeddable provider is, in one place (ADR-0026): what to call it,
 * and whether the room *works in* it or reads it.
 *
 * `interactive` is a property of the thing embedded rather than of the surface
 * drawing it, which is why it lives beside the provider rather than in a
 * renderer: a board is touched by the people in front of it (REQ068), a deck is
 * paged through by whoever is presenting (REQ066, REQ067). Every surface that
 * has to say so — the editor's note, the frame's own capabilities, the hint on a
 * participant's phone — reads it here rather than re-deciding it.
 */
export const EMBED_PROVIDERS: Record<
	EmbedProvider,
	{ label: string; interactive: boolean }
> = {
	powerpoint: { label: "PowerPoint", interactive: false },
	"google-slides": { label: "Google Slides", interactive: false },
	miro: { label: "Miro board", interactive: true },
};

/** Which provider an embed slide frames, and the URL its viewer is opened at. */
export type SlideEmbed = {
	provider: EmbedProvider;
	/** The provider's own embed URL — never the string the organizer typed. */
	url: string;
};

/**
 * The subset of a slide the embed resolver reads. Structural, like
 * {@link VideoSettings}, so it accepts a parsed slide from the server and a
 * half-built one from the editor alike.
 */
type EmbedSettings = {
	mediaUrl?: string | undefined;
};

/** The host Google serves both editing and embedding of a deck from. */
const GOOGLE_DOCS_HOST = "docs.google.com";

/** A Google file id as it appears in a deck's share or publish link. */
const GOOGLE_FILE_ID = /^[\w-]{8,}$/;

/** The host Microsoft's browser viewer for an Office file answers on. */
const OFFICE_VIEWER_HOST = "view.officeapps.live.com";

/** The host a OneDrive share link resolves to. */
const ONEDRIVE_HOST = "onedrive.live.com";

/** SharePoint tenants, which each get their own subdomain. */
const SHAREPOINT_HOST = /(^|\.)sharepoint\.com$/;

/** The marker a SharePoint share link carries for a PowerPoint file. */
const SHAREPOINT_PRESENTATION = "/:p:/";

/** The file extensions a PowerPoint deck is published under. */
const POWERPOINT_FILE = /\.(pptx?|ppsx?|potx?)$/i;

/** Hosts whose links are Miro boards. */
const MIRO_HOSTS = new Set(["miro.com", "www.miro.com"]);

/** A Miro board id as it appears in a board link — base64-ish, `=` included. */
const MIRO_BOARD_ID = /^[\w=-]{6,}$/;

/** The id a Miro "share by link" URL carries so the link can be opened at all. */
const MIRO_SHARE_LINK_ID = /^[\w-]{6,}$/;

/**
 * The Google Slides embed URL a link names, or `""` when it names none.
 *
 * Both shapes a deck is handed out in: the shared file (`/presentation/d/<id>/…`,
 * whatever the tail says — `edit`, `preview`, `htmlpresent`) and the published
 * one (`/presentation/d/e/<id>/pub`), which carries a different id under `/d/e/`
 * and must keep it. Neither tail is preserved: `/edit` frames an editor the room
 * has no business in, and the `start`/`loop`/`delayms` a publish link carries
 * would hand the deck an autoplay nobody asked this slide for.
 */
function googleSlidesEmbedUrl(url: URL): string {
	if (url.hostname !== GOOGLE_DOCS_HOST) return "";
	const segments = url.pathname.split("/").filter((segment) => segment !== "");
	if (segments[0] !== "presentation" || segments[1] !== "d") return "";
	const published = segments[2] === "e";
	const fileId = published ? segments[3] : segments[2];
	if (!fileId || !GOOGLE_FILE_ID.test(fileId)) return "";
	const path = published ? `d/e/${fileId}` : `d/${fileId}`;
	return `https://${GOOGLE_DOCS_HOST}/presentation/${path}/embed`;
}

/** Microsoft's browser viewer, pointed at a file it is to render. */
function officeViewerUrl(fileUrl: string): string {
	return `https://${OFFICE_VIEWER_HOST}/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
}

/**
 * The PowerPoint embed URL a link names, or `""` when it names none.
 *
 * Four shapes, because "a PowerPoint deck somebody else hosts" (REQ066) is four
 * different links in practice: Microsoft's viewer already pointed at a file, a
 * OneDrive share, a SharePoint share, and a `.pptx` sitting on any web host —
 * the last of which is what the viewer exists for and is handed to it here.
 */
function powerpointEmbedUrl(url: URL): string {
	if (url.hostname === OFFICE_VIEWER_HOST) {
		// Already the viewer. The file it was pointed at is what matters, and it is
		// re-read rather than trusted: `view.aspx` is the full-page viewer and
		// `embed.aspx` the framed one, and a viewer URL carrying no `src` — or one
		// naming something that is not a fetchable file — frames a Microsoft error
		// page rather than the organizer's deck.
		const source = (url.searchParams.get("src") ?? "").trim();
		if (source === "") return "";
		let sourceUrl: URL;
		try {
			sourceUrl = new URL(source);
		} catch {
			return "";
		}
		if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
			return "";
		}
		return officeViewerUrl(sourceUrl.toString());
	}
	if (url.hostname === ONEDRIVE_HOST) {
		// OneDrive's own embed entry point, keeping the sharing parameters the link
		// carries (`cid`, `resid`, `authkey`) — they are what makes the file
		// reachable at all. `em=2` is the reader rather than the file's page.
		const parameters = new URLSearchParams(url.searchParams);
		parameters.set("em", "2");
		return `https://${ONEDRIVE_HOST}/embed?${parameters.toString()}`;
	}
	if (
		SHAREPOINT_HOST.test(url.hostname) &&
		url.pathname.includes(SHAREPOINT_PRESENTATION)
	) {
		// A SharePoint presentation share link becomes an embed by asking for one.
		// The fragment goes: it addresses a place in the page's own UI, which is
		// not the UI the room is about to be shown.
		const embed = new URL(url.toString());
		embed.searchParams.set("action", "embedview");
		embed.hash = "";
		return embed.toString();
	}
	if (POWERPOINT_FILE.test(url.pathname)) return officeViewerUrl(url.toString());
	return "";
}

/**
 * The Miro embed URL a link names, or `""` when it names none.
 *
 * A board link and an already-embeddable one both resolve to `live-embed`, which
 * is the board with its own toolbar — REQ068 asks for a board participants work
 * in, so nothing here asks for the view-only frame. What the room may actually
 * do in it stays Miro's decision, taken from the board's own sharing settings:
 * this slide frames a board, it does not grant access to one.
 */
function miroEmbedUrl(url: URL): string {
	if (!MIRO_HOSTS.has(url.hostname)) return "";
	const segments = url.pathname.split("/").filter((segment) => segment !== "");
	if (segments[0] !== "app") return "";
	if (segments[1] !== "board" && segments[1] !== "live-embed") return "";
	const boardId = segments[2] ?? "";
	if (!MIRO_BOARD_ID.test(boardId)) return "";
	const embed = new URL(`https://miro.com/app/live-embed/${boardId}/`);
	// A board shared by link is reachable *through* that link's id, so a URL
	// carrying one keeps it — the same reason an unlisted Vimeo link keeps its
	// hash. Dropping it would frame a board the room is not allowed to open.
	const shareLinkId = url.searchParams.get("share_link_id") ?? "";
	if (MIRO_SHARE_LINK_ID.test(shareLinkId)) {
		embed.searchParams.set("share_link_id", shareLinkId);
	}
	return embed.toString();
}

/**
 * Which provider's viewer an embed slide's URL opens, and at which URL
 * (REQ066/REQ067/REQ068) — or `null` when the link names none of them.
 *
 * The refusal is the safe default and it is deliberately not a repair, exactly
 * as {@link slideVideoFor}'s is: a link this cannot embed is shown to the
 * organizer as one, in the editor, while they can still fix it. It is also
 * stricter, because the failure is worse — an unrecognised link resolves to
 * nothing at all rather than to a frame around an arbitrary page.
 *
 * The authored string is never rewritten in the deck. What comes back here is
 * the URL a frame may be pointed at; what the organizer typed is what they see
 * when they reopen the slide.
 */
export function slideEmbedFor(slide: EmbedSettings): SlideEmbed | null {
	const authored = (slide.mediaUrl ?? "").trim();
	if (authored === "") return null;
	let parsed: URL;
	try {
		parsed = new URL(authored);
	} catch {
		return null;
	}
	if (parsed.protocol !== "https:") return null;
	const googleSlides = googleSlidesEmbedUrl(parsed);
	if (googleSlides !== "") {
		return { provider: "google-slides", url: googleSlides };
	}
	const powerpoint = powerpointEmbedUrl(parsed);
	if (powerpoint !== "") return { provider: "powerpoint", url: powerpoint };
	const miro = miroEmbedUrl(parsed);
	if (miro !== "") return { provider: "miro", url: miro };
	return null;
}

// ── Quiz competition (REQ054, REQ056, REQ057) ────────────────
//
// A quiz slide is a choice slide that keeps score. Everything that makes it one
// — which options are the solution, how long the question stays open, and what a
// correct answer is worth — is derived here, once, from what the organizer
// authored (ADR-0026): the boundary that accepts or refuses a submission, the
// tally that scores the room, the participant's countdown and the presenter's
// all read the same functions rather than each spelling the rule again.
//
// Three decisions are worth stating, because they are what make the score mean
// anything:
//
//  - **The window is server-authoritative.** A question opens when the presenter
//    navigates to it (`slideStartedAt` on the presentation) and closes
//    `timeLimit` seconds later. Nothing about that is taken from the client: a
//    countdown on a phone with a wrong clock, or a hand-built request, must not
//    be able to buy time nobody else had.
//  - **An answer is final.** On a quiz slide a participant holds exactly one
//    answer and may not replace it, unlike every other slide type here where
//    changing your mind is the normal gesture. Speed is part of the score, so a
//    re-answer would let someone bank a fast time and then correct it.
//  - **Points are derived, never stored.** A score is a function of the votes
//    and the slide, so re-authoring which option is correct re-scores the room
//    with no migration and no stale total left behind.

/**
 * What a correct answer is worth on its own, however late in the window it
 * lands (REQ056). This is the floor of a correct answer: knowing the answer is
 * the thing being measured, and a participant who knew it slowly still knew it.
 */
export const QUIZ_CORRECT_POINTS = 500;

/**
 * The most a *fast* correct answer adds on top (REQ054 — "points are based on
 * correctness (and possibly speed)"). Awarded on a straight line from the full
 * bonus at the instant the question opens down to nothing at the deadline, so
 * the difference between two people who both knew the answer is how quickly
 * they knew it — never the difference between knowing and guessing, which is
 * why the speed component is capped at the correctness one rather than
 * exceeding it.
 */
export const QUIZ_SPEED_POINTS = 500;

/** The most one quiz question can be worth: instant and correct. */
export const QUIZ_MAX_POINTS = QUIZ_CORRECT_POINTS + QUIZ_SPEED_POINTS;

/**
 * How far past the deadline a submission is still accepted (REQ057). A tap
 * registered at half a second left still has to reach the server, and refusing
 * it would punish a slow network rather than a slow participant.
 *
 * The grace buys *acceptance*, never *points*: elapsed time is clamped to the
 * window before it is scored, so an answer inside the grace scores exactly what
 * an answer at the buzzer scores — the speed bonus is already zero there.
 */
export const QUIZ_SUBMISSION_GRACE_MS = 1500;

/**
 * The subset of a slide the quiz resolvers read. Written structurally (as
 * {@link ChoiceSettings} is) so the same functions accept a parsed slide from
 * the server and a half-built one from the editor.
 */
type QuizSettings = {
	type?: SlideType | undefined;
	timeLimit?: number | undefined;
	options?: { id: string; isCorrect?: boolean | undefined }[] | undefined;
	quizAnswerMode?: QuizAnswerMode | undefined;
	quizAnswers?: { text: string }[] | undefined;
};

/**
 * How long a quiz question stays open, in seconds — or `null` when it has no
 * limit at all (REQ057).
 *
 * `0` is the authored spelling of "no limit", and it is a real answer to a real
 * question rather than an accident: an organizer walking a room through a quiz
 * may want the pace to be theirs, not a clock's. It is kept apart from a
 * *number* of seconds everywhere downstream, because the two say opposite
 * things about a submission that arrives late. A negative or non-finite value
 * reads the same way — a slide whose limit cannot be counted down has none.
 */
export function quizTimeLimitFor(slide: QuizSettings): number | null {
	const limit = slide.timeLimit;
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
		return null;
	}
	return limit;
}

/**
 * When a quiz question closes, as epoch milliseconds — or `null` when it never
 * does: the slide has no time limit, or the question has not been opened yet.
 *
 * A question that has not been opened is the survey-mode case (REQ003 — nobody
 * navigates the room through the deck, so there is no shared instant a question
 * started) and the not-yet-reached case in a live deck. Both mean "no deadline
 * to be past", which is why they collapse to the same `null` rather than to a
 * deadline in the past that would refuse every submission.
 */
export function quizDeadlineFor(
	startedAt: string | null | undefined,
	timeLimitSeconds: number | null,
): number | null {
	if (!startedAt || timeLimitSeconds === null) return null;
	const opened = Date.parse(startedAt);
	if (Number.isNaN(opened)) return null;
	return opened + timeLimitSeconds * 1000;
}

/**
 * Whether a submission arriving `now` is still inside the question's window,
 * grace included (REQ057). A question with no deadline is always open — see
 * {@link quizDeadlineFor} for the two ways that happens.
 */
export function isQuizWindowOpen(
	deadline: number | null,
	now: number,
	graceMs = QUIZ_SUBMISSION_GRACE_MS,
): boolean {
	if (deadline === null) return true;
	return now <= deadline + graceMs;
}

/** How much of the window is left at `now`, in milliseconds; never negative. */
export function quizRemainingMs(deadline: number | null, now: number): number {
	if (deadline === null) return 0;
	return Math.max(0, deadline - now);
}

/** The ids of the options the organizer marked as the solution (REQ013). */
export function correctQuizOptionIds(slide: QuizSettings): string[] {
	return (slide.options ?? [])
		.filter((option) => option.isCorrect === true)
		.map((option) => option.id);
}

// ── Typed answers (REQ055) ───────────────────────────────────
//
// A typed quiz question tests recall rather than recognition: there are no
// options to read off, so the participant writes the answer and the server
// decides whether it is one of the organizer's. Everything else about the slide
// is unchanged — the window, the one-final-answer rule, the correctness-plus-
// speed score, the scorecard — which is why this is a mode on the quiz slide
// and not a slide type of its own.
//
// The whole feature turns on one decision, made here and nowhere else: **what
// counts as the same answer**. Two properties are non-negotiable for a scored
// competition, and together they pick the rule:
//
//  - It must not accept a wrong answer. Edit-distance or "close enough"
//    matching cannot have this property on the answers quizzes are actually
//    made of: 1997 and 1987 are one edit apart, and so are Mann and Mann's
//    neighbours in any short-word answer set. A grader that silently awards
//    points for the wrong year is worse than one that refuses a typo, because
//    the organizer can see and fix a refusal and cannot see a false award.
//  - It must not refuse a right answer over something that is not the
//    knowledge being tested — capitalisation, an accent a phone keyboard did
//    not offer, a double space, a trailing full stop.
//
// So: **exact match after normalization, against any of the organizer's
// accepted solutions.** Normalization folds case, strips diacritics, collapses
// internal whitespace and trims surrounding punctuation — and stops there.
// Anything a normalization cannot fairly fold ("USA" vs "United States") is
// admitted by the organizer adding it to {@link QuizAnswerSchema}'s list, where
// the decision is visible, reviewable and theirs.

/**
 * Punctuation that may sit around a typed answer without being part of it: a
 * trailing full stop, a comma from a list, quotes a participant wrapped their
 * answer in. Deliberately *edge-only* and a deliberately short set — stripping
 * punctuation everywhere would fold "C++" onto "C" and "3+4" onto "34", turning
 * two different answers into one.
 */
const QUIZ_ANSWER_EDGE_PUNCTUATION =
	/^[\s.,;:!?¡¿"'“”‘’«»()[\]{}]+|[\s.,;:!?¡¿"'“”‘’«»()[\]{}]+$/gu;

/**
 * The accents that are folded off a typed answer: the three **Combining
 * Diacritical Marks** blocks, and only those. They are what NFD decomposes a
 * precomposed Latin letter into — "ü" becomes "u" plus U+0308 — so dropping
 * them is exactly the "Muller answers Müller" fold and nothing more.
 *
 * Deliberately *not* `\p{M}`, which is every combining mark in Unicode. In
 * Devanagari, Thai, Hebrew and Arabic those marks are not accents on a letter,
 * they **are** letters — vowels written above, below or beside a consonant —
 * and stripping them collapses different words onto the same key: `कील` would
 * become `कल`, `ที่` would become `ท`. That is not a lenient comparison, it is
 * a grader awarding full marks for the wrong word, which is the one failure
 * this rule exists to make impossible (see the block above). Those scripts'
 * marks fall outside these blocks, so an answer written in them is compared
 * character for character.
 *
 * The cost is that a *non-Latin* accent is not folded — Greek tonos, Cyrillic
 * breve — so `καφε` does not answer `καφέ`. That is the failure the organizer
 * can see and fix, by adding the spelling to the accepted list, and it is the
 * direction this rule always errs in.
 */
const QUIZ_ANSWER_LATIN_DIACRITICS =
	/[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff]+/gu;

/**
 * The form two typed answers are compared in (REQ055) — see the block above for
 * why the folding stops where it does.
 *
 * Case is folded, Latin-script diacritics are dropped (so "Muller" answers
 * "Müller"), runs of whitespace collapse to one space, and the punctuation a
 * sentence habit leaves at either end is trimmed. Nothing is reordered,
 * abbreviated or approximated, and no other script's marks are touched — see
 * {@link QUIZ_ANSWER_LATIN_DIACRITICS}.
 *
 * Written once here and read by the boundary that judges a submission, the
 * tally that groups the room's answers, and the editor that warns about two
 * accepted solutions that are really one (ADR-0026) — so "the same answer"
 * cannot mean one thing where it is scored and another where it is counted.
 */
export function normalizeQuizAnswer(text: string): string {
	return text
		.normalize("NFD")
		// The base letters the accents sat on are kept.
		.replace(QUIZ_ANSWER_LATIN_DIACRITICS, "")
		.toLowerCase()
		.replace(/\s+/gu, " ")
		.replace(QUIZ_ANSWER_EDGE_PUNCTUATION, "")
		.normalize("NFC");
}

/**
 * How this slide is answered (REQ054, REQ055). Only a quiz slide has an answer
 * mode at all: a `multiple-choice` slide converted from a quiz keeps the stored
 * field, and reading it there would offer a text box on a slide with options.
 */
export function quizAnswerModeFor(slide: {
	type?: SlideType | undefined;
	quizAnswerMode?: QuizAnswerMode | undefined;
}): QuizAnswerMode {
	if (slide.type !== "quiz") return "select";
	return slide.quizAnswerMode === "type" ? "type" : "select";
}

/**
 * The solutions a typed answer is accepted against, as the organizer wrote them
 * (REQ055) — blank rows and rows that normalize to nothing dropped, since an
 * accepted answer of "." would make every unanswerable submission correct.
 *
 * Returned in authored order and in the authored spelling, because this list is
 * also what the room is shown once the question is over.
 */
export function acceptedQuizAnswers(slide: QuizSettings): string[] {
	return (slide.quizAnswers ?? [])
		.map((accepted) => accepted.text.trim())
		.filter((text) => normalizeQuizAnswer(text).length > 0);
}

/** Encode a typed answer into a vote `value` — what the participant wrote. */
export function encodeQuizAnswer(text: string): string {
	return text.trim();
}

/**
 * Read a typed submission back into the answer it states, or `null` when it
 * states none — an empty or whitespace-only value.
 *
 * The participant's own spelling is what is stored and later shown back to
 * them, so nothing is normalized here: normalization is how two answers are
 * *compared* (see {@link normalizeQuizAnswer}), not how one is recorded. An
 * answer rewritten on the way in would show a participant words they did not
 * type under a verdict about whether they were right.
 */
export function decodeQuizAnswer(value: string): string | null {
	const text = encodeQuizAnswer(value);
	return normalizeQuizAnswer(text).length > 0 ? text : null;
}

/**
 * Whether a typed answer is one the organizer accepted (REQ055). A slide with
 * no accepted solutions has no notion of correctness at all, so nothing matches
 * — the same stance {@link correctQuizOptionIds} takes for an unmarked choice
 * slide.
 */
export function matchesQuizAnswer(slide: QuizSettings, text: string): boolean {
	const submitted = normalizeQuizAnswer(text);
	if (submitted.length === 0) return false;
	return acceptedQuizAnswers(slide).some(
		(accepted) => normalizeQuizAnswer(accepted) === submitted,
	);
}

/**
 * Whether a stored answer is still an answer to the question **as it now
 * stands** — the predicate that decides both whether a participant has already
 * used up their one answer and whether the tally may score a row.
 *
 * On a select-answer question that is "the option is still on the slide": an
 * answer naming an option the organizer has since deleted is not an answer to
 * this question, so it neither counts nor locks its participant out. A typed
 * question inherits the same reading from the other side — a row carrying one
 * of the slide's option ids was given to the select-answer question this slide
 * used to be, and a UUID is not a typed answer to the one it is now.
 */
export function isStandingQuizAnswer(
	slide: QuizSettings,
	value: string,
): boolean {
	const isOptionId = (slide.options ?? []).some(
		(option) => option.id === value,
	);
	if (quizAnswerModeFor(slide) === "type") {
		return !isOptionId && decodeQuizAnswer(value) !== null;
	}
	return isOptionId;
}

/**
 * Whether what a participant submitted is a correct answer (REQ056) — the
 * option they picked, or the text they typed (REQ055), decided by the slide's
 * answer mode so that no caller has to branch on it.
 *
 * A slide whose author marked no option and named no accepted answer has no
 * correct answer, so no submission to it is one — the same stance
 * {@link slideHasCorrectAnswers} takes, and it is why an unfinished quiz awards
 * the whole room nothing rather than crediting whoever happened to pick the
 * first option.
 *
 * Everyone does then read as *wrong* on such a slide, which is honest for a
 * score (nobody was right) but not the whole story (there was nothing to be
 * right about). The room's tally keeps the two apart where it matters: its
 * `options[].isCorrect` is an explicit `null` when the slide has no solution to
 * reveal, exactly as it is for a plain choice slide (ADR-0024).
 */
export function isCorrectQuizAnswer(
	slide: QuizSettings,
	submitted: string,
): boolean {
	if (quizAnswerModeFor(slide) === "type") {
		return matchesQuizAnswer(slide, submitted);
	}
	return correctQuizOptionIds(slide).includes(submitted);
}

/**
 * What one answer scores (REQ054, REQ056).
 *
 * A wrong answer scores nothing — a quiz competition ranks knowledge, and a
 * consolation point for answering would rank participation. A correct one earns
 * {@link QUIZ_CORRECT_POINTS} plus a share of {@link QUIZ_SPEED_POINTS} that
 * falls linearly across the window, so answering at the buzzer still banks the
 * correctness half.
 *
 * With no window to be fast inside — an untimed question, or one whose opening
 * instant was never recorded — the speed bonus is awarded **in full** rather
 * than withheld. Withholding it would make an untimed question quietly worth
 * half a timed one and rank a participant against a clock the slide never
 * offered them; awarding it keeps every question worth the same
 * {@link QUIZ_MAX_POINTS} at its best.
 *
 * An answer that *predates* the window it is measured against is a different
 * case entirely, and it earns the correctness half and **no** speed bonus. This
 * happens when the presenter restarts a question's timer
 * ({@link quizDeadlineFor}'s opening instant moves forward, under answers
 * already given), and the obvious reading — clamp the elapsed time to zero —
 * inverts the ranking it exists to produce: the participant who answered a
 * second before the buzzer would be handed {@link QUIZ_MAX_POINTS} for being
 * the slowest in the room, outscoring everyone who answers the fresh window
 * quickly. There is no honest speed to report for an answer given against a
 * window that no longer exists, so none is claimed.
 */
export function scoreQuizAnswer(answer: {
	isCorrect: boolean;
	/** Time from the question opening to the answer landing; `null` if unknown. */
	elapsedMs: number | null;
	/** The window that elapsed time is measured against; `null` if untimed. */
	timeLimitSeconds: number | null;
}): number {
	if (!answer.isCorrect) return 0;
	if (answer.timeLimitSeconds === null || answer.elapsedMs === null) {
		return QUIZ_MAX_POINTS;
	}
	// An answer given before this window opened cannot be timed against it — see
	// above for why crediting it as instant would rank the slowest answer first.
	if (answer.elapsedMs < 0) return QUIZ_CORRECT_POINTS;
	const windowMs = answer.timeLimitSeconds * 1000;
	// Clamped at the far end so an answer inside the grace period is not worth
	// less than nothing.
	const usedMs = Math.min(answer.elapsedMs, windowMs);
	return (
		QUIZ_CORRECT_POINTS +
		Math.round(QUIZ_SPEED_POINTS * (1 - usedMs / windowMs))
	);
}

// ── Leaderboard (REQ059) ─────────────────────────────────────
//
// A leaderboard slide is the deck's standings: what every participant has
// scored across the quiz questions before it, ordered, with the top of the
// field on the shared screen. It collects nothing itself — it reports on the
// quiz slides around it — which is why it is a slide type with no vote path
// rather than a mode on the quiz slide (ADR-0027: the unit of sharing is the
// invariant, and "one question, scored" is not what this is).
//
// Two decisions shape everything below.
//
//  - **A row is named by a one-way handle, never by the participant id.** The
//    id a vote carries *is* that participant's credential — the only thing
//    standing between an answer and anybody overwriting it — and a leaderboard
//    is the most public surface in the product. So the server names each row by
//    a digest of the id (see the service's `leaderboardEntryIdFor`), and this
//    module turns that digest into something a room can read out loud. Nobody
//    is asked to register or pick a nickname to compete: the system ranks the
//    identity it already has.
//  - **Everyone is ranked; only the top is shown.** The slide's size caps the
//    projected board, not the standings behind it, so a participant outside the
//    top five still learns they are 14th of 31 on their own phone. Cutting the
//    ranking to the board would leave most of the room told nothing.

/** One participant's deck-wide quiz total, before it is placed in the order. */
export type LeaderboardTotals = {
	/** The public, one-way handle this row is named by — never a participant id. */
	entryId: string;
	totalPoints: number;
	correctCount: number;
	/** Quiz questions this participant gave a standing answer to. */
	answeredCount: number;
};

/** One row of the standings: a total, placed and named (REQ059). */
export type LeaderboardEntry = LeaderboardTotals & {
	/** 1-based, with ties sharing a place — see {@link rankLeaderboardEntries}. */
	rank: number;
	/** What the row is called on screen, derived from {@link entryId}. */
	label: string;
};

/**
 * What a leaderboard row is called (REQ059).
 *
 * Derived from the row's own handle so it is stable for as long as the handle
 * is — the same participant keeps the same name across every refresh of the
 * board, and across the leaderboard slides of one deck — while naming nothing
 * about the person behind it. No catalog entry asks participants to register or
 * type a nickname, so inventing one here would be inventing a product; a
 * derived name is what an anonymous competition can honestly show.
 *
 * Six hex characters, upper-cased: enough that two rows on a projected board
 * are not called the same thing, short enough to be read out ("Player 3F9A2C
 * takes it").
 */
export function leaderboardEntryLabel(entryId: string): string {
	const handle = entryId.slice(0, 6).toUpperCase();
	return handle ? `Player ${handle}` : "Player";
}

/**
 * Put deck-wide totals in competition order and hand each one its place
 * (REQ059).
 *
 * Ordering is by points, and points alone: correctness and speed are already
 * inside the number ({@link scoreQuizAnswer}), so re-reading either as a
 * tie-break would weigh it twice. Rows that are genuinely level are ordered by
 * their handle — arbitrary, but *stable*, which is the property that matters
 * when the same board is drawn again three seconds later on a screen the whole
 * room is watching.
 *
 * Ranks are standard competition ranks: level rows share a place and the next
 * row takes the place its position implies (1, 2, 2, 4). Two people who scored
 * the same thing are equal — a board that broke that tie by arrival order would
 * be reporting a race that did not happen.
 */
export function rankLeaderboardEntries(
	totals: LeaderboardTotals[],
): LeaderboardEntry[] {
	const ordered = [...totals].sort(
		(left, right) =>
			right.totalPoints - left.totalPoints ||
			(left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0),
	);
	let placedRank = 0;
	let placedPoints: number | null = null;
	return ordered.map((standing, position) => {
		if (placedPoints === null || standing.totalPoints !== placedPoints) {
			placedRank = position + 1;
			placedPoints = standing.totalPoints;
		}
		return {
			...standing,
			rank: placedRank,
			label: leaderboardEntryLabel(standing.entryId),
		};
	});
}

/**
 * How many ranks this leaderboard slide shows (REQ059) — the one read site for
 * the setting, and the one place a hand-built deck's out-of-range number is
 * brought back inside the board's bounds rather than each surface clamping its
 * own way.
 */
export function leaderboardSizeFor(slide: {
	leaderboardSize?: number | undefined;
}): number {
	const authored = slide.leaderboardSize;
	if (typeof authored !== "number" || !Number.isFinite(authored)) {
		return LEADERBOARD_DEFAULT_SIZE;
	}
	return Math.min(
		LEADERBOARD_SIZE_LIMIT,
		Math.max(1, Math.round(authored)),
	);
}

// ── Withholding the answer key (REQ056) ──────────────────────
//
// A quiz slide's marked solution is the answer to the question the room is
// being scored on, so it must not reach a competitor's browser before that
// question is over — not in the deck they joined with, not in the slide pushed
// on navigation, and not in the tally broadcast after every answer that lands.
// Suppressing it in the UI is not enough: what a client holds, a client can
// read, and points and rank hang off it.
//
// Two audiences, therefore, and exactly one predicate deciding between them:
// whoever can **edit** the deck (its owner, or the holder of its edit token —
// the author in the editor and the presenter on the shared screen) always sees
// what they authored, and everyone else sees a quiz solution only once that
// question is genuinely over.

/**
 * The presentation state {@link solutionVisibleToAudience} reads. Structural,
 * so a stored document, a parsed response and a client-side presentation all
 * satisfy it.
 */
type SolutionRevealState = {
	slideStartedAt?: Record<string, string> | undefined;
	revealedSlideIds?: string[] | undefined;
	status?: string | undefined;
	/**
	 * The deck-level results visibility (REQ102). Read only for a slide type whose
	 * solution is revealed by the results gate rather than by a question closing —
	 * a Pin on Image target area (REQ053). Optional so a caller holding a partial
	 * deck still type-checks; absent reads as the schema's own default.
	 */
	resultsVisibility?: ResultsVisibility | undefined;
};

/**
 * Whether a slide's marked solution may be sent to a client that cannot edit
 * the deck.
 *
 * A plain choice slide is unchanged (REQ013): it reveals a solution the moment
 * results are shown, because nothing is scored on it and a knowledge check that
 * hides its own answer key from the tally has no point. A **quiz** slide keeps
 * its answer key back until the question is over, which is any of:
 *
 *  - its window has closed (grace included) — the ordinary live case;
 *  - the presenter deliberately revealed that slide's results (REQ102) — which
 *    is the reveal signal an untimed question has instead of a deadline;
 *  - the presentation has ended, after which there is no question left to game.
 *
 * A question that has *not been opened yet* is withheld, and that matters as
 * much as the running one: a joining participant receives the whole deck, so a
 * quiz three slides ahead would otherwise arrive answered.
 *
 * A **Pin on Image** slide (REQ053) is the third case, and it has no window to
 * wait for: its target area is revealed by the organizer's results-visibility
 * setting (REQ102), which is the reveal control this deck already has. `instant`
 * shows it from the start — the room is watching the aggregate against the target
 * live, so withholding the target while drawing the tally over it would be
 * incoherent; `on-click` keeps it back until the presenter reveals, which is what
 * an organizer running a hotspot check wants and what the editor points them at;
 * `private` never sends it at all, not even once the deck has ended, because
 * "never on screen" is the whole content of that setting.
 *
 * This is deliberately stricter than the nearest precedent: a guess slide's
 * reference number (REQ041) rides the deck payload openly and is only gated where
 * it is *drawn*. A pin target is a region of the picture the participant is
 * looking at while they aim, so it is withheld on the wire as well — a client
 * cannot show what it was never sent.
 */
export function solutionVisibleToAudience(
	slide: {
		id: string;
		type?: SlideType | undefined;
		timeLimit?: number | undefined;
		resultsVisibility?: SlideResultsVisibility | undefined;
	},
	deck: SolutionRevealState,
	now: number,
): boolean {
	if (slide.type === "pin-image") {
		const visibility = effectiveResultsVisibility(
			slide.resultsVisibility,
			deck.resultsVisibility ?? "instant",
		);
		if (visibility === "private") return false;
		if (visibility === "instant") return true;
		if (deck.status === "ended") return true;
		return (deck.revealedSlideIds ?? []).includes(slide.id);
	}
	if (slide.type !== "quiz") return true;
	if (deck.status === "ended") return true;
	if ((deck.revealedSlideIds ?? []).includes(slide.id)) return true;
	const deadline = quizDeadlineFor(
		deck.slideStartedAt?.[slide.id],
		quizTimeLimitFor(slide),
	);
	return deadline !== null && !isQuizWindowOpen(deadline, now);
}

/**
 * The deck's slides as an audience may see them: every quiz question that is
 * not yet over loses the `isCorrect` marks on its options and, on a typed
 * question (REQ055), the accepted answers themselves — which are the answer
 * key in the plainest possible form.
 *
 * The marks are **dropped**, not emitted as an explicit `null` (the shape
 * ADR-0024 would otherwise ask for), because here the absence is the point. An
 * unmarked option already carries no `isCorrect`, so a withheld solution is
 * indistinguishable from a slide whose author marked nothing — where a
 * distinct "withheld" marker would announce that a solution exists and which
 * slides are worth watching for it. `quizAnswers` empties to `[]` for the same
 * reason and reads the same way: a question whose author named no accepted
 * answer carries exactly that. The tally reached through
 * {@link solutionVisibleToAudience} keeps ADR-0024's explicit `null`, since
 * there the key is a documented part of the results contract.
 *
 * A Pin on Image slide loses its target area on the same terms (REQ053), and
 * there the `null` *is* the unauthored shape — a slide with no correct area
 * carries exactly that — so a withheld target is again indistinguishable from a
 * question that never had one.
 */
export function withAudienceSolutions<
	SlideShape extends {
		id: string;
		type?: SlideType | undefined;
		timeLimit?: number | undefined;
		options?: { isCorrect?: boolean | undefined }[] | undefined;
		quizAnswerMode?: QuizAnswerMode | undefined;
		quizAnswers?: unknown;
		resultsVisibility?: SlideResultsVisibility | undefined;
		pinArea?: unknown;
	},
>(slides: SlideShape[], deck: SolutionRevealState, now: number): SlideShape[] {
	return slides.map((slide) => {
		if (solutionVisibleToAudience(slide, deck, now)) return slide;
		// A typed question offers no options to anyone, so the audience is sent
		// none. Left in, they would be a second copy of the answer key in plain
		// text: a question switched from select to type keeps the options it was
		// authored with — deliberately, so the stale answers under it stay
		// recognisable (see {@link isStandingQuizAnswer}) — and the correct one is
		// still spelled out among them.
		const withheldOptions =
			quizAnswerModeFor(slide) === "type"
				? []
				: (slide.options ?? []).map((option) => {
						const { isCorrect: _withheld, ...rest } = option;
						return rest;
					});
		return {
			...slide,
			options: withheldOptions,
			quizAnswers: [],
			// REQ053 — the target area, on a pin slide whose reveal has not come
			// yet. `null` on every other slide type is what they already carry, so
			// naming it unconditionally costs nothing and cannot be forgotten for
			// the one type it is about.
			pinArea: null,
		};
	});
}

/**
 * The deck's slides with every presenter note emptied (REQ090).
 *
 * Unconditional, unlike the solution withholding above: a note has no reveal, no
 * deadline and no visibility setting to come due. It is the presenter's own
 * script, so the only question ever asked of it is *who is holding this payload*
 * — which is exactly the question {@link withAudienceSlides} answers once, for
 * every surface.
 *
 * Emptied rather than dropped — see {@link SlideSchema.shape.notes} for why the
 * audience's view of a noted slide is the same complete shape as an un-noted
 * one, which is the opposite of what a withheld answer key wants.
 */
export function withoutPresenterNotes<SlideShape extends { notes?: unknown }>(
	slides: SlideShape[],
): SlideShape[] {
	return slides.map((slide) => ({ ...slide, notes: "" }));
}

/**
 * A deck's slides as everybody who cannot edit it may see them: solutions
 * withheld until their question is over (REQ056/REQ053) and presenter notes
 * emptied outright (REQ090).
 *
 * **The one function a slide passes through on its way to somebody else's
 * screen**, and the reason it exists rather than two calls at each site: the
 * surfaces that hand out slides — the deck response, the join payload, the
 * `slide.changed` broadcast, the preview's audience pane — must each withhold
 * *everything* presenter-only, and a list of things to remember is a list that
 * grows one forgotten entry at a time. The two projections stay separate
 * functions because they answer different questions (ADR-0010); this is where
 * they are composed, once, so a new presenter-only field is added in one place
 * and every surface has it.
 */
export function withAudienceSlides<
	SlideShape extends {
		id: string;
		type?: SlideType | undefined;
		timeLimit?: number | undefined;
		options?: { isCorrect?: boolean | undefined }[] | undefined;
		quizAnswerMode?: QuizAnswerMode | undefined;
		quizAnswers?: unknown;
		resultsVisibility?: SlideResultsVisibility | undefined;
		pinArea?: unknown;
		notes?: unknown;
	},
>(slides: SlideShape[], deck: SolutionRevealState, now: number): SlideShape[] {
	return withoutPresenterNotes(withAudienceSolutions(slides, deck, now));
}

// ── Q&A layer (REQ036, REQ037, REQ060) ───────────────────────
//
// Q&A is not a slide type here — it is an **overarching interactivity layer**
// (REQ036) switched on for the whole deck, so a participant can ask a question
// from whatever slide is on screen rather than only from the one slide that
// happens to collect them. Its two settings therefore live on the presentation,
// beside the other deck-level defaults above, and never on a slide.
//
// The `open-text` slide type is untouched by all of this: a deck that wants a
// dedicated "questions for the panel" slide still authors one, and REQ025's
// per-response upvotes still ride the votes it collects. What changes is that a
// deck no longer *has* to have one for questions to be askable.

/**
 * Who may read a deck's submitted questions (REQ037).
 *
 * `presenter` keeps the list to the moderation view — the presenter's screen
 * and nobody else's — and is what a fresh deck carries. `everyone` publishes it
 * to the room, upvotes included, which is what makes REQ060's prioritization a
 * thing the audience does rather than a thing the presenter guesses at.
 *
 * The restrictive value is the default deliberately: publishing unfiltered
 * audience questions to a projector is the failure an organizer cannot take
 * back, and the setting that does it sits directly beside the switch that turns
 * the layer on, so opening the room up is a choice they make rather than one
 * they forget to prevent.
 */
export const QAVisibilityEnum = z.enum(["presenter", "everyone"]);
export type QAVisibility = z.infer<typeof QAVisibilityEnum>;

/**
 * The longest a submitted question may be. Declared rather than inlined for the
 * same reason {@link VOTE_VALUE_MAX_LENGTH} is: the field that takes one stops
 * at the same number the boundary refuses past, so a participant meets the cap
 * as a key that does nothing rather than as a raw validation failure.
 */
export const QA_TEXT_MAX_LENGTH = 500;

/**
 * Fold two spellings of the same submission onto one key — trimmed, case-folded,
 * internal whitespace collapsed.
 *
 * One rule, two surfaces (ADR-0026): the Q&A layer's duplicate fold and the
 * open-text slide's auto-upvote (REQ025) are the same judgement about when two
 * people asked the same thing, and two copies of it would eventually disagree.
 *
 * Deliberately *not* {@link normalizeQuizAnswer}: that one folds accents and
 * strips edge punctuation because it decides whether an answer is **right**, and
 * it is scoped to that. This one only decides whether to show one row or two, so
 * it stays the mildest fold that catches a re-typed question.
 */
export function normalizeQuestionText(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The deck-level Q&A settings, structurally — stored, parsed or client-side. */
export type QASettings = {
	qaEnabled?: boolean | undefined;
	qaVisibility?: QAVisibility | undefined;
};

/** The Q&A layer's settings with both values filled in, from any of its shapes. */
export function qaSettingsFor(deck: QASettings): {
	enabled: boolean;
	visibility: QAVisibility;
} {
	return {
		enabled: deck.qaEnabled ?? false,
		visibility: deck.qaVisibility ?? "presenter",
	};
}

/**
 * Whether a caller may read the deck's whole question list (REQ037).
 *
 * Two audiences, one predicate — the same shape {@link solutionVisibleToAudience}
 * takes, and for the same reason: what a client holds, a client can read out of
 * the network tab, so the decision is made once on the server and the list is
 * built from it rather than hidden in a component.
 *
 * Whoever can **edit** the deck always reads all of it, layer switched off
 * included: the questions collected during a Q&A phase are exactly what the
 * presenter turns the layer off to go and work through. Everybody else reads it
 * only while the layer is on *and* the organizer has published it. What a
 * participant is left with when they cannot is their own submissions and
 * nobody else's — see {@link qaQuestionsVisibleTo}.
 */
export function qaListVisibleToAudience(
	deck: QASettings,
	canEdit: boolean,
): boolean {
	if (canEdit) return true;
	const { enabled, visibility } = qaSettingsFor(deck);
	return enabled && visibility === "everyone";
}

/** A stored question, structurally — what the reader below narrows down. */
type QAQuestionRow = {
	id: string;
	participantId?: string | undefined;
};

/**
 * The questions one caller may see, out of everything the deck holds.
 *
 * The whole list when {@link qaListVisibleToAudience} says so, and otherwise the
 * caller's own submissions alone — which is not a consolation prize but the one
 * thing a participant needs from a moderated Q&A: proof that what they asked
 * landed. An anonymous caller (no participant id) owns nothing and so sees
 * nothing, rather than matching every row that also has no id.
 *
 * That is deliberately **one** rule and not two: you always see what you asked,
 * and you see everyone else's only while the layer is on and published. So a
 * presenter switching the layer off mid-session takes the room's list away
 * without also taking each participant's own words off their screen — which
 * would read as their question having been deleted.
 */
export function qaQuestionsVisibleTo<QuestionShape extends QAQuestionRow>(
	questions: QuestionShape[],
	deck: QASettings,
	caller: { canEdit: boolean; participantId: string },
): QuestionShape[] {
	if (qaListVisibleToAudience(deck, caller.canEdit)) return questions;
	if (!caller.participantId) return [];
	return questions.filter(
		(question) => question.participantId === caller.participantId,
	);
}

/**
 * One question as the Q&A list reports it (REQ060). The asking participant's id
 * is **never** among these keys: it is that participant's only credential (the
 * submit and upvote endpoints are public and accept whatever id they are
 * handed), so it is projected down to the two booleans a client actually needs —
 * exactly the stance the leaderboard takes with `entryId`.
 */
export type QAListEntry = {
	id: string;
	text: string;
	/** Upvotes the question has drawn (REQ060). */
	upvotes: number;
	/** Whether the presenter has marked it dealt with (REQ060). */
	answered: boolean;
	/** When it was marked answered, ISO — an explicit `null` while open (ADR-0024). */
	answeredAt: string | null;
	createdAt: string;
	/** Whether the caller asked it. */
	own: boolean;
	/** Whether the caller has upvoted it. */
	upvoted: boolean;
};

/**
 * The order a Q&A list is worked in (REQ060): **open questions first, then the
 * most upvoted, then the ones that have waited longest.**
 *
 * Answered questions sink whatever their score, because the board is a queue and
 * a question already dealt with is not work — leaving a popular answered one on
 * top would push the thing the presenter should take next off the screen, which
 * is the failure "make the processing status visible" exists to prevent. Among
 * open questions the room's upvotes decide, which is the prioritization the
 * requirement asks for; ties go to whoever asked first, so a question does not
 * lose its place merely by being early, and the last tie-break is the id so the
 * same list is drawn the same way every re-render.
 */
export function rankQAQuestions<EntryShape extends QAListEntry>(
	entries: EntryShape[],
): EntryShape[] {
	return [...entries].sort((left, right) => {
		if (left.answered !== right.answered) return left.answered ? 1 : -1;
		if (left.upvotes !== right.upvotes) return right.upvotes - left.upvotes;
		const byAge =
			Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");
		if (byAge) return byAge;
		return left.id.localeCompare(right.id);
	});
}

// ── Participant channels: reactions and live chat (REQ077, REQ078) ──
//
// Two more things a participant sends during a session that are **not answers**:
// a reaction on whatever is on screen (REQ077) and a message in the deck's chat
// (REQ078). They are modelled together because they are the same kind of thing —
// participant-originated traffic that no tally counts and no results payload
// reports — and keeping them in one section is what stops the next channel being
// bolted onto the vote path because that was where the code already was.
//
// Three decisions shape everything below:
//
//  - **Neither is a vote.** Nothing here writes into `votes`, and no aggregation
//    reads it. A reaction never reaches a store at all (see below), and a chat
//    message lives in its own collection keyed by presentation. So "not counted
//    in any tally" is a property of the shape rather than a filter somebody has
//    to remember: there is no code path from either to `getSlideResults`.
//  - **A reaction is not stored, at all.** It is broadcast and forgotten, the
//    same stance the preview takes with its test votes further down: the
//    guarantee that a reaction is never counted as an answer is that the code to
//    persist one does not exist. That is also what makes REQ077's "lightweight"
//    true rather than aspirational — a room of three hundred people tapping a
//    heart writes nothing to disk.
//  - **Both switches default off.** Reactions flying across a projector and an
//    unmoderated chat beside it are the two failures an organizer cannot take
//    back mid-session, so a deck carries neither until somebody asks for it —
//    the same reasoning {@link QAVisibilityEnum} spells out, and the same reading
//    every deck stored before these fields existed re-parses forward onto
//    (ADR-0029).

/**
 * The reactions a participant may send (REQ077).
 *
 * A **closed set**, validated at the boundary, for the same reason a deck's
 * theme is: what rides the wire is which reaction it is, never a glyph or an
 * image, so the room cannot be painted with an arbitrary string and the client
 * decides what each one looks like. The renderings live on the client
 * (`src/components/ReactionBar.tsx`) because an icon component is their only
 * consumer (ADR-0032).
 *
 * Five, deliberately: enough that "yes", "I liked that" and "that was funny" are
 * different things to say, few enough to fit one row on a phone without a picker.
 */
export const REACTION_KINDS = [
	"like",
	"love",
	"celebrate",
	"laugh",
	"insight",
] as const;

export const ReactionKindEnum = z.enum(REACTION_KINDS);
export type ReactionKind = z.infer<typeof ReactionKindEnum>;

/**
 * The longest a chat message may be (REQ078). Shorter than a Q&A question's
 * {@link QA_TEXT_MAX_LENGTH}, and that difference is the point: a question is
 * composed once and read out by the presenter, while chat is a stream somebody
 * scans down the side of a slide. Declared rather than inlined so the field that
 * takes one stops where the boundary refuses, and a participant meets the cap as
 * a key that does nothing.
 */
export const CHAT_TEXT_MAX_LENGTH = 300;

/**
 * The most messages one chat read hands back — the newest this many.
 *
 * A read cap, not a retention rule: nothing is deleted, and the whole channel
 * still goes when the deck does (REQ146) or when the session is cleared
 * (REQ101).
 *
 * **It bounds what is sent, not what is read.** `getChat` still loads the
 * presentation's messages out of the store and trims here, so an hour-long
 * session does not ship ten thousand rows to every phone that refetches, but it
 * does still *read* them — and every post makes every client refetch. Bounding
 * the read as well needs the query to carry the limit, which the store's `find`
 * does not yet take; until it does, this constant is worth exactly the payload
 * it saves and no more.
 */
export const CHAT_HISTORY_LIMIT = 200;

/** The two participant channels a deck carries, structurally. */
export type ParticipantChannelSettings = {
	reactionsEnabled?: boolean | undefined;
	chatEnabled?: boolean | undefined;
};

/**
 * Both channels with their values filled in, from any of the shapes that carry
 * them — stored document, parsed response, or a client's copy of the deck.
 *
 * One read site (ADR-0026), like {@link qaSettingsFor}: the switch a surface
 * offers, the switch a broadcast reports and the switch an endpoint enforces are
 * the same reading of the same two fields.
 */
export function participantChannelsFor(deck: ParticipantChannelSettings): {
	reactions: boolean;
	chat: boolean;
} {
	return {
		reactions: deck.reactionsEnabled ?? false,
		chat: deck.chatEnabled ?? false,
	};
}

/**
 * One chat message as the feed reports it (REQ078).
 *
 * The posting participant's id is **never** among these keys, exactly as it is
 * never among a {@link QAListEntry}'s: it is that participant's only credential,
 * and the post endpoint is public and accepts whatever id it is handed. It is
 * projected down to the one boolean a client needs — which of these lines are
 * mine — so a client cannot impersonate somebody by reading the feed.
 */
export type ChatMessageEntry = {
	id: string;
	text: string;
	createdAt: string;
	/** Whether the caller wrote it. */
	own: boolean;
};

/**
 * The order a chat is read in (REQ078): **oldest first**, the way a conversation
 * happened, with the id as the last tie-break so two messages written in the same
 * millisecond are drawn in the same order on every screen.
 *
 * The opposite of {@link rankQAQuestions}, and for a reason worth stating: a Q&A
 * list is a *queue* the presenter works through, so it is ordered by what should
 * be taken next. A chat is a *transcript*, so it is ordered by what was said
 * when. Sorting a chat by anything else would rewrite the conversation.
 */
export function orderChatMessages<EntryShape extends ChatMessageEntry>(
	entries: EntryShape[],
): EntryShape[] {
	return [...entries].sort((left, right) => {
		const byAge =
			Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");
		if (byAge) return byAge;
		return left.id.localeCompare(right.id);
	});
}

/**
 * The newest `limit` messages, still oldest-first (REQ078).
 *
 * The tail rather than the head: a participant joining an hour in wants the
 * conversation they are walking into, not the one it opened with. Written as its
 * own function because two things want it — the endpoint that caps what it
 * serves, and the tests that prove the cap keeps the *recent* end.
 */
export function recentChatMessages<EntryShape extends ChatMessageEntry>(
	entries: EntryShape[],
	limit: number = CHAT_HISTORY_LIMIT,
): EntryShape[] {
	const ordered = orderChatMessages(entries);
	return limit > 0 && ordered.length > limit ? ordered.slice(-limit) : ordered;
}

// ── Participant names (REQ076) ───────────────────────────────
//
// A deck may **require** the people joining it to state a name, and that name
// then labels their answers wherever the organizer reads them back.
//
// Three decisions decide everything in this block, and each is stated once here
// so no route, no export and no screen re-derives it:
//
//  - **The switch is the deck's, and it is off unless the organizer turned it
//    on.** A deck that never asked for names has none stored and behaves in
//    every particular as it did before this field existed — which is what
//    ADR-0029's default buys, and on a field that decides whether personal data
//    is collected at all it is the only default that fails safe.
//  - **A stated name is not an identity claim.** Nothing verifies it and
//    nothing signs in: the `participantId` minted in the browser stays the
//    handle every stored row is keyed by, and the name is a *label on that
//    handle*. Which is why it lives in a collection of its own rather than
//    being copied onto each vote — one participant has one name on one deck, so
//    correcting a typo must not leave the answers given first under the
//    spelling given second.
//  - **The switch travels to the room and the names never do.** Every phone has
//    to know whether to ask, so `requireParticipantName` rides the public deck
//    document beside the Q&A and channel switches. The names themselves reach
//    only a caller who can edit the deck, on exactly the terms a Form slide's
//    rows do (REQ061) and for the same reason: what an audience is shown is a
//    tally, and a list of names is not one. The deck's **results link** (REQ098)
//    does not lift that — it is a delegation of the *numbers*, and handing over
//    a roster of who was in the room is a decision nobody made by minting it.

/**
 * The longest a stated name may be, in characters.
 *
 * Sized as a name and not as prose — this is a label on a row in a roster and a
 * cell in a spreadsheet, not something anybody reads a sentence of. Declared
 * rather than inlined so the field that takes one stops where the boundary
 * refuses, and a participant meets the cap as a key that does nothing rather
 * than as a rejected submission (ADR-0026).
 */
export const PARTICIPANT_NAME_MAX_LENGTH = 80;

/**
 * A stated name as it is stored: one line, single-spaced, trimmed and bounded.
 *
 * Whitespace is collapsed rather than merely trimmed, which is the one thing
 * this normalisation does beyond what the boundary schema already does. A name
 * is drawn as a row in a roster and written into a spreadsheet cell, and an
 * embedded newline is a value that breaks both — so it is folded where the name
 * is written rather than escaped at each of the four places it is read.
 *
 * Pure, so what a surface offers and what the store holds can be checked
 * against each other without a store.
 */
export function normalizeParticipantName(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, PARTICIPANT_NAME_MAX_LENGTH);
}

/** The name switch a deck carries, structurally. */
export type ParticipantNameSettings = {
	requireParticipantName?: boolean | undefined;
};

/**
 * Whether this deck asks the people joining it for a name (REQ076).
 *
 * One read site (ADR-0026), like {@link qaSettingsFor} and
 * {@link participantChannelsFor}: the question the join screen asks, the
 * question the write endpoint enforces and the question the exports label their
 * columns by are one reading of one field. `false` is what an unset field and a
 * deck written before the field existed both resolve to.
 */
export function deckRequiresParticipantName(
	deck: ParticipantNameSettings,
): boolean {
	return deck.requireParticipantName ?? false;
}

/**
 * Stating a name: who is stating it, and what it is.
 *
 * Neither field defaults — a name belonging to nobody is a row that can never
 * be joined to an answer, and a name of nothing is not a name (ADR-0018).
 * Trimmed and bounded here, exactly as a comment's body is, so a submission of
 * pure whitespace is a malformed request rather than a blank row in the
 * organizer's roster.
 */
export const ParticipantNameSchema = z.object({
	participantId: z.string().min(1),
	name: z.string().trim().min(1).max(PARTICIPANT_NAME_MAX_LENGTH),
});

export type ParticipantNameInput = z.infer<typeof ParticipantNameSchema>;

/**
 * One person in the room, as the organizer reads the roster (REQ076).
 *
 * `participantId` **is** on this shape, unlike the author of a chat message or
 * a Q&A question — and that is not a slip. Those two are read by the room, where
 * the id is a participant's only credential and publishing it would let anyone
 * post as them. This list is read by a caller who can edit the deck and by
 * nobody else, and the id is the very thing that joins a name to the rows in the
 * Responses sheet of their own export (REQ095). Withholding it here would leave
 * an organizer holding two lists they cannot line up.
 */
export const ParticipantRosterEntrySchema = z.object({
	participantId: z.string(),
	/** What they typed on joining, normalised (see {@link normalizeParticipantName}). */
	name: z.string().default(""),
	/** How many of the deck's slides they have answered so far. */
	answeredSlides: z.number().default(0),
	/** When they stated the name, ISO. */
	statedAt: z.string().default(""),
});

export type ParticipantRosterEntry = z.infer<typeof ParticipantRosterEntrySchema>;

/**
 * The order a roster is read in: **by name**, with the participant id as the
 * tie-break so two people who typed the same thing are drawn in the same order
 * on every surface.
 *
 * By name rather than by arrival, and the difference is what the list is for: a
 * roster is something an organizer looks a person up in, and arrival order is a
 * fact about the network. Compared case-insensitively, because a room that
 * typed `ada` and `Ada` should not be sorted into two neighbourhoods.
 */
export function orderParticipantRoster<
	EntryShape extends { name: string; participantId: string },
>(entries: EntryShape[]): EntryShape[] {
	return [...entries].sort((left, right) => {
		const byName = left.name.localeCompare(right.name, undefined, {
			sensitivity: "base",
		});
		if (byName) return byName;
		return left.participantId.localeCompare(right.participantId);
	});
}

/**
 * The ceiling on a deck's authored display text — its `title`, and the name of
 * the theme it authored for itself.
 *
 * Named rather than written twice because the two are the same kind of value:
 * words the organizer typed that ride the public presentation document to every
 * phone in the room. Declared here, ahead of the theme block below, because that
 * is the first of the two to be evaluated.
 */
export const DECK_TITLE_MAX_LENGTH = 200;

// ── Deck theme (REQ079, REQ080, REQ092, REQ135, REQ136) ──────
//
// A deck carries a **theme**, and the theme is what the room is looking at: the
// colours, the typeface the questions are set in, and the wash painted behind
// every slide, on the presenter's screen, on every participant's phone, and on
// the join screen the room reads the code off.
//
// Five decisions shape the model here:
//
//  - **A theme is one of the built-in set, or the deck's own** (REQ080). `theme`
//    names which: one of the five built-in ids below, or `custom`, in which case
//    the appearance is authored on the deck itself as {@link DeckBrandSchema}.
//    Both kinds are stored on the same field, validated at the same boundary and
//    applied by the same wrapper on the same surfaces — which is the whole of
//    "defined, stored and applied to decks exactly as a built-in one is".
//  - **A built-in theme still never ships its appearance.** Only the id is
//    stored, so a deck authored today renders in whatever `pulse` has become
//    tomorrow, and the palettes live on the client, in
//    `src/components/DeckTheme.tsx`, because CSS custom properties are their
//    only consumer (ADR-0032).
//  - **An authored theme does ride the wire, because it is the deck's own
//    content** — there is nowhere else it could live, and the room has to
//    receive it the way it receives the deck's title. What that buys is bounded
//    by validating it as narrowly as it can be validated: a colour is `#rgb` or
//    `#rrggbb` and nothing else, and the typeface is an **id** from the closed
//    set of faces this build ships (REQ092), never a family name a browser would
//    have to go and find (ADR-0016). A hand-built request can therefore paint a
//    room in its own colours — which is the requirement — and cannot put
//    anything but a colour into a colour.
//  - **The theme is the logo's carrier** (REQ136). The requirement offers "a
//    theme or a workspace", and this codebase has no workspace: the deck's
//    theming block is the thing that exists, so the mark hangs off it. It is an
//    image *URL*, exactly like a slide's `mediaUrl` — nothing here uploads,
//    stores or proxies a picture. REQ135's "organization branding" is the same
//    three things (colours, type, mark) on the same carrier, for the same
//    reason.
//  - **A value a browser must not be handed is refused, not repaired.**
//    {@link deckLogoFor} allowlists the URL's scheme, the way
//    {@link slideVideoFor} does; {@link deckBrandFor} does the same for every
//    authored colour and reads the typeface back through the same closed set the
//    boundary validated it against. Both answer with the safe value — no logo, no
//    colour — so a surface that reached for the resolver cannot emit an
//    attacker's string into an attribute or a stylesheet, and one that did not is
//    what `scripts/guard-frontend-conventions.ts` fails the build over.

/**
 * The built-in themes (REQ079), derived from the product's own design system
 * rather than invented: its Signal, Warmth and Data Spectrum rows supply the
 * accents, its surface layers the canvas, and its type scale the direction.
 *
 * `signal` is the house theme — the design system the app already wears — so a
 * deck that never chose one looks exactly as it looks today.
 */
export const BUILT_IN_DECK_THEME_IDS = [
	"signal",
	"pulse",
	"ember",
	"editorial",
	"broadcast",
] as const;

export type BuiltInDeckThemeId = (typeof BUILT_IN_DECK_THEME_IDS)[number];

/**
 * The id a deck wears when its theme is authored on the deck rather than chosen
 * from the set above (REQ080). Not a sixth palette: it says *where the palette
 * comes from*, and {@link DeckBrandSchema} is what it comes from.
 */
export const CUSTOM_DECK_THEME_ID = "custom";

/** Every id a deck's `theme` may hold — the built-in set, plus its own. */
export const DECK_THEME_IDS = [
	...BUILT_IN_DECK_THEME_IDS,
	CUSTOM_DECK_THEME_ID,
] as const;

export const DeckThemeIdEnum = z.enum(DECK_THEME_IDS);
export type DeckThemeId = z.infer<typeof DeckThemeIdEnum>;

/**
 * What an unstated theme means. The house theme, deliberately: the field is
 * being appended to a schema that has been storing decks for a while, and every
 * one of them re-parses forward onto this value (ADR-0029) — so the default has
 * to be the appearance those decks already had, not a new one imposed on them.
 */
export const DEFAULT_DECK_THEME: BuiltInDeckThemeId = "signal";

/**
 * The faces this build ships, and the only families a theme may name (REQ092).
 *
 * An **id** rather than a family string, and that is the requirement rather than
 * a convenience: "loaded so every surface resolves the same face" cannot be true
 * of a name each machine looks up in its own font book, and ADR-0016 forbids
 * fetching one at runtime. So a theme picks from what the bundle already
 * carries — `@fontsource-variable/figtree` and `@fontsource/dm-mono`, imported
 * by `src/index.css` — or from a generic stack every system resolves to
 * something. The stacks themselves live beside the palettes on the client
 * (ADR-0032); what crosses the wire is which of them was chosen.
 */
export const DECK_FONT_IDS = ["figtree", "system", "serif", "mono"] as const;

export const DeckFontIdEnum = z.enum(DECK_FONT_IDS);
export type DeckFontId = z.infer<typeof DeckFontIdEnum>;

/** The house face — what a theme that names none is set in. */
export const DEFAULT_DECK_FONT: DeckFontId = "figtree";

/**
 * An id that named the house face before it moved, and the id it names now
 * (REQ178).
 *
 * The set above is a *closed* vocabulary the docstore gate enforces on every
 * read, so dropping an id from it without saying where it went would mean every
 * deck that had chosen the house face fails to parse — the deck would not open
 * at all, which is a far worse answer than the face it is set in. A retired id
 * is therefore folded onto its replacement at the boundary, once, and no surface
 * below has to know the old one existed.
 *
 * This is not {@link deckFontIdFor}'s fallback wearing a second hat. That one
 * answers *this is not a face we ship* with the house face; this one answers
 * *this was the house face* with what the house face has become. They agree
 * today only because the id that was retired happened to be the house one.
 */
export const RETIRED_DECK_FONT_IDS: Readonly<Record<string, DeckFontId>> = {
	sora: "figtree",
};

/** A retired id read forward onto its replacement; anything else, untouched. */
function foldRetiredDeckFontId(font: unknown): unknown {
	if (typeof font !== "string") return font;
	return RETIRED_DECK_FONT_IDS[font.trim()] ?? font;
}

/**
 * The face field as it is stored and as it crosses the wire: the closed set
 * above, with a retired id folded onto its replacement before the gate sees it.
 *
 * The fold sits *inside* the schema rather than beside it on purpose — a deck
 * authored before the house face moved has to survive `StoredPresentationSchema`
 * as much as it has to survive a POST body, and those are two different call
 * sites of one schema.
 */
export const DeckFontFieldSchema = z.preprocess(
	foldRetiredDeckFontId,
	DeckFontIdEnum,
);

/**
 * Which face a theme's text renders in (REQ092), read through here rather than
 * off the field for the reason {@link deckThemeIdFor} is: a family this build
 * does not ship resolves to the house face on every surface at once, rather than
 * to whatever each one's fallback stack happened to end at.
 */
export function deckFontIdFor(font: string | null | undefined): DeckFontId {
	const parsed = DeckFontFieldSchema.safeParse((font ?? "").trim());
	return parsed.success ? parsed.data : DEFAULT_DECK_FONT;
}

/**
 * A colour an authored theme may be written in — the same grammar a slide's own
 * background and text are written in, declared once as
 * {@link AuthoredColorSchema} beside the per-slide appearance block because that
 * is the first of the two to be evaluated. See it for why the grammar is this
 * narrow.
 */
const DeckBrandColorSchema = AuthoredColorSchema;

/**
 * A theme authored on the deck (REQ080, REQ135) — an organization's own colours
 * and typeface, applied wherever a built-in theme would be.
 *
 * Three colours, not thirty: the canvas the room is looking at, the words on it,
 * and the accent everything live is drawn in. The rest of the palette — the
 * raised surfaces, the borders, the muted and dim text ramps, the accent's hover
 * and glow — is *derived* from those three on the client, because a theme is a
 * small number of decisions and a large number of consequences, and asking an
 * organizer to author sixteen tokens twice over (once per colour scheme) would
 * be asking them to do the derivation by hand.
 *
 * Every field carries a default (ADR-0029) and the empty string means "not
 * authored": a brand that names only its accent is a brand, and the house
 * theme's value stands wherever it named nothing.
 */
export const DeckBrandSchema = z.object({
	/**
	 * What the theme is called in the picker; the deck's own name for it.
	 *
	 * Capped at the length a deck's own `title` is capped at, and for the same
	 * reason: it is authored display text that rides the public presentation
	 * document to every phone in the room, so the ceiling is the one this schema
	 * already picked for that rather than a second number.
	 */
	name: z.string().max(DECK_TITLE_MAX_LENGTH).default(""),
	/** The brand colour: links, bars, the live signal, the slide's wash. */
	accent: DeckBrandColorSchema,
	/** The surface a slide is drawn on — what the room is mostly looking at. */
	canvas: DeckBrandColorSchema,
	/** The words on that canvas. Derived from the canvas when unauthored. */
	text: DeckBrandColorSchema,
	/** The face the text is set in (REQ092), from the set this build ships. */
	font: DeckFontFieldSchema.default(DEFAULT_DECK_FONT),
});

export type DeckBrand = z.infer<typeof DeckBrandSchema>;

/** A brand that authored nothing — every field at its default. */
export const EMPTY_DECK_BRAND: DeckBrand = DeckBrandSchema.parse({});

/** The theming a deck carries — the shape every read site below accepts. */
export type DeckThemeSettings = {
	theme?: string | null;
	themeBrand?: {
		name?: string | null;
		accent?: string | null;
		canvas?: string | null;
		text?: string | null;
		font?: string | null;
	} | null;
	themeLogoUrl?: string | null;
	themeLogoAlt?: string | null;
	title?: string | null;
};

/**
 * Which theme a deck is drawn in (REQ079, REQ080).
 *
 * Read through here rather than off the field, so a deck holding a theme this
 * build does not know — an older document, a hand-built request that slipped
 * past a boundary, a palette that was renamed — falls back to the same theme
 * everywhere instead of to whichever fallback each surface happened to pick.
 */
export function deckThemeIdFor(deck: DeckThemeSettings): DeckThemeId {
	const authored = (deck.theme ?? "").trim();
	const parsed = DeckThemeIdEnum.safeParse(authored);
	return parsed.success ? parsed.data : DEFAULT_DECK_THEME;
}

/**
 * The built-in theme a deck falls back to when it is not wearing one of its own
 * (REQ080) — the answer to "which entry of the palette catalog does this deck
 * index?", which a deck with an authored theme does not have.
 */
export function builtInDeckThemeIdFor(
	deck: DeckThemeSettings,
): BuiltInDeckThemeId {
	const themeId = deckThemeIdFor(deck);
	return themeId === CUSTOM_DECK_THEME_ID ? DEFAULT_DECK_THEME : themeId;
}

/**
 * One authored colour, as a surface may use it (REQ080) — or `""` where the
 * house theme's own value stands.
 *
 * The deck's name for {@link authoredColorFor}: a brand colour and a slide's own
 * colour are the same kind of value and are resolved by the same function, so
 * the two layers of theming cannot come to disagree about what a colour is.
 */
export function deckBrandColorFor(value: string | null | undefined): string {
	return authoredColorFor(value);
}

/**
 * The theme this deck authored for itself (REQ080, REQ135), or `null` when it
 * wears one of the built-in set.
 *
 * The single read site for an authored theme, exactly as {@link deckThemeIdFor}
 * is for a built-in one: every colour comes back validated or empty, and the
 * typeface comes back as an id this build has a face for. A surface that reads
 * `themeBrand` itself has stepped around both.
 *
 * Gated on the theme id, so the answer to "is this deck branded?" is one
 * question rather than two. A brand stays stored while a deck is being previewed
 * in a built-in theme — the organizer's colours are not thrown away by trying
 * `Ember` on — and simply is not what the room is drawn in until `theme` says
 * so.
 */
export function deckBrandFor(deck: DeckThemeSettings): DeckBrand | null {
	if (deckThemeIdFor(deck) !== CUSTOM_DECK_THEME_ID) return null;
	const authored = deck.themeBrand ?? {};
	return {
		name: (authored.name ?? "").trim(),
		accent: deckBrandColorFor(authored.accent),
		canvas: deckBrandColorFor(authored.canvas),
		text: deckBrandColorFor(authored.text),
		font: deckFontIdFor(authored.font),
	};
}

/** The organizer's own mark and the name it goes by (REQ136). */
export type DeckLogo = { url: string; alt: string };

/**
 * The logo the participant-facing surfaces wear in place of the product's
 * default mark (REQ136), or `null` when the deck carries none — and when the one
 * it carries is not a URL an `<img>` may be pointed at.
 *
 * Refused rather than rewritten, like an unplayable video link, and refused by
 * the guard a slide's background image goes through as well
 * ({@link browserSafeAssetUrl}) — "is this a URL we may render?" is one question
 * however the artwork got onto the deck.
 *
 * The accessible name falls back to the deck's own title, because that is what
 * the room calls this presentation and an unnamed mark otherwise announces
 * itself as nothing. With neither, the mark is decorative and says so with an
 * empty `alt`.
 */
export function deckLogoFor(deck: DeckThemeSettings): DeckLogo | null {
	const url = browserSafeAssetUrl(deck.themeLogoUrl);
	if (url === "") return null;
	const alt = (deck.themeLogoAlt ?? "").trim() || (deck.title ?? "").trim();
	return { url, alt };
}

// ── Deck templates (REQ005, REQ006) ──────────────────────────
//
// A template is a prebuilt deck the catalog offers as a starting point. It is
// **not a stored document and never becomes one**: the built-in set is code
// (`server/templates.ts`), and what a template produces is an ordinary
// presentation that keeps no reference back to it (REQ006 — "detached from
// their source"). So there is no `StoredDeckTemplate*` beside the schemas below
// and no collection behind them.
//
// A template carries its slides and the words the catalog is browsed by, and
// deliberately nothing else — in particular **not the deck's settings**. The
// Q&A layer and the two participant channels are off on every new deck by
// decision, not by omission (REQ036/REQ077/REQ078), and an organizer who picked
// "Team check-in" out of a gallery has not asked for an open chat: a template
// that could switch one on would be a security-relevant default loosened by
// somebody other than the operator. A template that wants a tally held back
// says so on the slide it belongs to, where `resultsVisibility` already lives.

/**
 * What a template is *for*, and the only closed vocabulary the catalog is
 * filtered by (REQ005). Five occasions rather than a taxonomy of slide types:
 * an organizer opening the gallery knows what meeting they are about to run,
 * not which question formats they will end up using.
 */
export const DECK_TEMPLATE_CATEGORIES = [
	"meeting",
	"workshop",
	"education",
	"feedback",
	"engagement",
] as const;

export const DeckTemplateCategoryEnum = z.enum(DECK_TEMPLATE_CATEGORIES);
export type DeckTemplateCategory = z.infer<typeof DeckTemplateCategoryEnum>;

/**
 * One entry in the template catalog (REQ005).
 *
 * `id`, `title` and `category` carry no default, like every other identity or
 * required input here (ADR-0018): an entry the gallery cannot name, address or
 * file is not an entry. Everything else defaults, so the served shape is always
 * complete (ADR-0024) and a template authored without tags is the same shape as
 * one with them.
 */
export const DeckTemplateSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().default(""),
	category: DeckTemplateCategoryEnum,
	/**
	 * Free-form words the catalog is searched by, beside the title and the
	 * description. Every one of them is rendered on the entry's card — a match on
	 * a tag nobody can see would be a result with no visible reason to be there.
	 */
	tags: z.array(z.string()).default([]),
	slides: z.array(SlideSchema).default([]),
});

export type DeckTemplate = z.infer<typeof DeckTemplateSchema>;

/** How the catalog is narrowed (REQ005) — both filters independently optional. */
export const DeckTemplateQuerySchema = z.object({
	category: DeckTemplateCategoryEnum.optional(),
	search: z.string().optional(),
});

export type DeckTemplateQuery = z.infer<typeof DeckTemplateQuerySchema>;

/**
 * Everything one catalog entry can be found by, as a single lower-cased string.
 *
 * The category is in it as well as the title, description and tags, so typing
 * "workshop" finds the workshop entries whether or not any of them says the word
 * in its own prose.
 */
export function deckTemplateSearchText(template: DeckTemplate): string {
	return [
		template.title,
		template.description,
		template.category,
		...template.tags,
	]
		.join(" ")
		.toLowerCase();
}

/**
 * Whether an entry answers a search (REQ005). A plain case-insensitive
 * substring, not a fuzzy match: the catalog is a handful of entries an organizer
 * skims, and a result whose reason cannot be pointed at in the card is worse
 * here than a result that never appeared. An empty or whitespace-only search
 * matches everything — it is not a filter yet.
 */
export function deckTemplateMatchesSearch(
	template: DeckTemplate,
	search: string,
): boolean {
	const needle = search.trim().toLowerCase();
	if (needle === "") return true;
	return deckTemplateSearchText(template).includes(needle);
}

/**
 * The catalog narrowed by both filters (REQ005), in the order it was authored.
 *
 * The one implementation of "which entries does this query show", asked by the
 * `GET /api/templates` route and by the gallery that renders it (ADR-0026). The
 * gallery filters the list it already holds rather than re-fetching per
 * keystroke, so this function is what stops the two from disagreeing about what
 * a search means.
 */
export function filterDeckTemplates(
	templates: readonly DeckTemplate[],
	query: DeckTemplateQuery = {},
): DeckTemplate[] {
	return templates.filter((template) => {
		if (query.category && template.category !== query.category) return false;
		return deckTemplateMatchesSearch(template, query.search ?? "");
	});
}

// ── Generating a deck from a prompt (REQ007) ─────────────────
//
// Only the two shapes that cross the HTTP boundary live here. What a generator
// is asked for, what it may author, and how a draft becomes slides are
// `server/deck-generator.ts`'s — it depends on a model provider and on nothing
// this file owns, so it is its own module (ADR-0032), the way the template
// catalog next door is.

/**
 * The ceiling on the prompt a deck is generated from (REQ007 — "a short text
 * prompt").
 *
 * Five hundred characters: enough for the occasion, the audience and the two or
 * three things the organizer wants asked, and short enough that it stays the
 * *brief* it is described as rather than becoming a second place decks are
 * authored. It is also most of the bound on what this server forwards to a third
 * party on a caller's word, which is a reason of its own to keep it small — the
 * rest of that bound is {@link DECK_LANGUAGE_MAX_LENGTH}, because a ceiling on
 * one forwarded field and not the other is a ceiling on nothing.
 */
export const DECK_PROMPT_MAX_LENGTH = 500;

/**
 * The ceiling on the language tag a generation call carries (REQ007).
 *
 * It exists because this field is **forwarded**, which is what separates it from
 * the identically-named field on {@link CreatePresentationSchema}: there the tag
 * is only stored and read back, while here it is interpolated into the brief
 * handed to a third-party model on a caller's word. An unbounded string in that
 * position makes {@link DECK_PROMPT_MAX_LENGTH} a bound on nothing — the prompt
 * is capped at 500 characters and the whole payload is not, so an anonymous
 * caller can bill the operator for a request the size of the body limit by
 * putting the text in the other field.
 *
 * Forty characters. The longest realistic BCP-47 tag ("zh-Hant-TW-x-private" and
 * the like) is comfortably under it, and nothing that is not a language tag
 * fits. Deliberately not a grammar: `language` has always been documented as
 * free-form, narrowing it to a pattern would refuse tags this build has not
 * heard of, and the abuse this closes is *volume* rather than shape.
 */
export const DECK_LANGUAGE_MAX_LENGTH = 40;

/**
 * What `POST /api/deck-generation` takes (REQ007).
 *
 * `prompt` carries no default and is the one required input — a generation call
 * with nothing to generate from is a mistake to fail loudly on (ADR-0018), not
 * one to fill in. `language` defaults exactly as the create's does, and it is
 * the deck's language in both senses: the participant strings it is drawn in
 * (REQ084) *and* the language the generator is asked to write its questions in,
 * so a German deck does not come back with English questions on it.
 *
 * Nothing else. A generated deck's room settings — pace, reveal mode, the Q&A
 * layer, the two participant channels, the theme — take their ordinary
 * defaults, for the reason a template cannot switch any of them on either: the
 * withholding value is what an unstated setting means, and a prompt is not the
 * organizer opening their room's chat.
 */
export const GenerateDeckSchema = z.object({
	prompt: z.string().trim().min(1).max(DECK_PROMPT_MAX_LENGTH),
	language: z.string().max(DECK_LANGUAGE_MAX_LENGTH).default("en"),
});

export type GenerateDeckInput = z.infer<typeof GenerateDeckSchema>;

// ── Presentation schema ──────────────────────────────────────

export const CreatePresentationSchema = z
	.object({
		/**
		 * What the deck is called. Defaulted to `""` rather than required, because
		 * a create that names a template may leave it out and inherit the
		 * template's own title (REQ006); the refinement below is what keeps it
		 * mandatory everywhere else, exactly as `min(1)` used to.
		 */
		title: z.string().max(DECK_TITLE_MAX_LENGTH).default(""),
		/**
		 * The deck's slides — or nothing at all when `templateId` names where they
		 * come from (REQ006). Same story as `title`: the floor of one slide is
		 * enforced by the refinement below rather than by `min(1)`, so a
		 * template create is the only way to omit them.
		 *
		 * The ceiling is {@link SLIDE_LIMIT}, and each slide's authored text is
		 * bounded by {@link SlideInputSchema} — the create is one of the two doors
		 * slides come in through, and both are held to the same bound (REQ159).
		 */
		slides: z.array(SlideInputSchema).max(SLIDE_LIMIT).default([]),
		/**
		 * The catalog entry this deck starts from (REQ005, REQ006) — an id from
		 * `GET /api/templates`, or `""` for an ordinary create. What it produces is
		 * a copy: the slides are re-identified on the way in and nothing records
		 * where they came from, so the new deck is editable and detached from the
		 * template the moment it exists.
		 */
		templateId: z.string().default(""),
		/**
		 * The workspace that will own this deck (REQ128), or `""` for a deck the
		 * caller owns themselves — spelled as an empty string rather than a
		 * nullable, like `templateId` directly above it and for the same reason: an
		 * absent optional field and "no workspace" are the same request.
		 *
		 * Naming one is a **claim about the caller's membership**, checked at the
		 * route against their role before anything is written (REQ129); a workspace
		 * they are not in is refused rather than silently ignored, which would
		 * create the deck somewhere they did not ask for.
		 */
		workspaceId: z.string().default(""),
		/**
		 * Language for participant UI/instruction strings (REQ084).
		 * BCP-47-ish tag, e.g. "en", "de", "fr". Free-form for now.
		 */
		language: z.string().optional().default("en"),
		/**
		 * "live" (default) — presenter controls pace; participants follow.
		 * "survey" (REQ003, REQ082) — audience pace; participants navigate on their own.
		 */
		mode: z.enum(["live", "survey"]).optional().default("live"),
		/**
		 * Deck-level default for when aggregated results appear on the shared screen
		 * (REQ102). Each slide may override it; slides set to "inherit" follow this.
		 */
		resultsVisibility: ResultsVisibilityEnum.optional().default("instant"),
		/**
		 * Whether questions can be asked from any slide (REQ036) and who may read
		 * them (REQ037). Off by default — a deck that never wanted Q&A shows the room
		 * no Q&A.
		 */
		qaEnabled: z.boolean().optional().default(false),
		qaVisibility: QAVisibilityEnum.optional().default("presenter"),
		/**
		 * The two participant channels (REQ077, REQ078): whether the room may react
		 * to whatever is on screen, and whether the deck carries a chat. Both off by
		 * default — a deck that never asked for either shows the room neither.
		 */
		reactionsEnabled: z.boolean().optional().default(false),
		chatEnabled: z.boolean().optional().default(false),
		/**
		 * Whether the people joining this deck state a name (REQ076). Off by
		 * default, like the Q&A layer and the two channels above and for a sharper
		 * reason than either: a deck that did not ask for names collects none.
		 */
		requireParticipantName: z.boolean().optional().default(false),
		/**
		 * The deck's appearance (REQ079, REQ080) and the organizer's own mark
		 * (REQ136). Authored with the deck, like its language and its pace —
		 * `themeBrand` only reaches a screen when `theme` is `custom`.
		 */
		theme: DeckThemeIdEnum.optional().default(DEFAULT_DECK_THEME),
		themeBrand: DeckBrandSchema.optional().default({}),
		themeLogoUrl: z.string().optional().default(""),
		themeLogoAlt: z.string().optional().default(""),
	})
	// A deck has to come from somewhere: either the request carries a title and
	// at least one slide, or it names the template both are copied from (REQ006).
	// Expressed as a refinement rather than as `min(1)` on the two fields so the
	// boundary stays exactly as strict as it was for every create that names no
	// template — an empty title or an empty deck is still refused there.
	.superRefine((created, context) => {
		if (created.templateId.trim() !== "") return;
		if (created.title.trim() === "") {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["title"],
				message: "A presentation needs a title, or a templateId to take one from",
			});
		}
		if (created.slides.length === 0) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["slides"],
				message: "A presentation needs at least one slide, or a templateId to copy them from",
			});
		}
	});

/**
 * What `PATCH /api/presentations/:id` is allowed to change — the deck's
 * **authored** fields and nothing else (ADR-0013/ADR-0014).
 *
 * The route had no body schema at all until REQ075, which made the patch an
 * arbitrary merge into the stored document: `StoredPresentationSchema` declares
 * `creatorId` and `creatorTokenHash`, so Zod kept whatever a caller sent for
 * them. That was self-harm while only the owner and the edit-token holder could
 * reach the route; with a bounded third principal it was an escalation — an
 * `edit` collaborator could write themselves into `creatorId` and acquire the
 * two powers their grant is explicitly denied (deleting the deck, and deciding
 * who else is on it), or plant a `creatorTokenHash` of their own choosing and
 * survive being revoked. The gate is this schema: Zod strips keys an object does
 * not declare, so a field that is not in this list cannot be written by this
 * route however it is spelled.
 *
 * **Every field is optional and none carries a `.default(...)`** — the one place
 * in this file where ADR-0029's rule is deliberately inverted, because a PATCH
 * is defined by which keys it *carries*. `updatePresentation` broadcasts on
 * `"qaEnabled" in changes`, so a default would turn every save into a claim
 * about settings the request never mentioned.
 *
 * Server-managed state is absent by design and is moved by its own routes:
 * `status` (start/end), `activeSlideIndex` (slide), `revealedSlideIds` (reveal),
 * `slideStartedAt` (timer), `closedSlideIds` (participation, REQ111),
 * `audienceBlanked` (blank, REQ109), the results link (results-link), the join
 * `code` and `createdAt` (neither is authored at all).
 */
export const UpdatePresentationSchema = z.object({
	title: z.string().max(DECK_TITLE_MAX_LENGTH).optional(),
	/**
	 * The whole slide list, replaced wholesale when the key is present. Bounded
	 * exactly as the create's is (REQ159): this is the *other* door slides come
	 * in through, and the one an attacker reaches for, because a create is rate
	 * limited per address and this is not.
	 */
	slides: z.array(SlideInputSchema).max(SLIDE_LIMIT).optional(),
	language: z.string().optional(),
	mode: z.enum(["live", "survey"]).optional(),
	resultsVisibility: ResultsVisibilityEnum.optional(),
	qaEnabled: z.boolean().optional(),
	qaVisibility: QAVisibilityEnum.optional(),
	reactionsEnabled: z.boolean().optional(),
	chatEnabled: z.boolean().optional(),
	requireParticipantName: z.boolean().optional(),
	theme: DeckThemeIdEnum.optional(),
	themeBrand: DeckBrandSchema.optional(),
	themeLogoUrl: z.string().optional(),
	themeLogoAlt: z.string().optional(),
});

export type UpdatePresentationInput = z.infer<typeof UpdatePresentationSchema>;

/**
 * The stored fields no request body may ever write, whatever route it arrives
 * on — the deck's owner, the edit token's hash, the results link's (REQ098) and
 * the workspace that owns it (REQ128).
 *
 * {@link UpdatePresentationSchema} already keeps them off the one route that
 * takes a free-form patch, and this is the second lock on the same door
 * (`updatePresentation`): the three fields are the credentials the whole
 * authorization model is resolved from, and a route added later without a body
 * schema must not be one request away from handing them over. Each is moved by
 * a function that exists for it alone — `claimOwnership` / `assignOwner`,
 * `createPresentation`, `mintResultsLink` / `revokeResultsLink`,
 * `setPresentationWorkspace` — none of which goes through `updatePresentation`.
 *
 * `workspaceId` is on the list for the same reason as the other four even though
 * it names no secret (REQ128): the caller's standing on a workspace deck is
 * resolved from their role in the workspace it names, so writing it is writing
 * the question one's own authorization is the answer to. A caller who could set
 * it would move any deck they can edit — a deck shared with them at `edit`, or
 * one whose forwarded edit link they hold — into a workspace they administer, and
 * take it.
 */
export const UNWRITABLE_PRESENTATION_FIELDS = [
	"creatorId",
	"creatorTokenHash",
	"resultsTokenHash",
	"resultsTokenIssuedAt",
	"workspaceId",
] as const;

/**
 * A patch with every credential-bearing field removed — the one reading of
 * {@link UNWRITABLE_PRESENTATION_FIELDS} (ADR-0026). Pure: a patch in, a patch
 * out, so what a caller may write is testable without a store.
 */
export function withoutUnwritableFields(
	changes: Record<string, unknown>,
): Record<string, unknown> {
	const allowed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(changes)) {
		if ((UNWRITABLE_PRESENTATION_FIELDS as readonly string[]).includes(key)) {
			continue;
		}
		allowed[key] = value;
	}
	return allowed;
}

export const PresentationSchema = z.object({
	id: z.string(),
	code: z.string(), // 6-digit join code
	title: z.string(),
	slides: z.array(SlideSchema),
	activeSlideIndex: z.number().default(0),
	status: z.enum(["draft", "live", "ended"]).default("draft"),
	language: z.string().default("en"),
	mode: z.enum(["live", "survey"]).default("live"),
	/**
	 * Deck-level default for when aggregated results appear on the shared screen
	 * (REQ102). Each slide may override it; slides set to "inherit" follow this.
	 */
	resultsVisibility: ResultsVisibilityEnum.default("instant"),
	/**
	 * Slides for which the presenter has clicked "reveal" when the effective
	 * results visibility is "on-click" (REQ102).
	 */
	revealedSlideIds: z.array(z.string()).default([]),
	/**
	 * The slides the presenter has closed to submissions (REQ111), and whether
	 * the shared screen is currently blanked (REQ109).
	 *
	 * Public, like `revealedSlideIds` above and `slideStartedAt` below: a phone
	 * that did not know a question had been closed would offer a control the
	 * server is refusing, and the screen being projected may be a second browser
	 * rather than the presenter's own. Read them through
	 * {@link slideAcceptsSubmissions} and {@link audienceViewBlanked}.
	 */
	closedSlideIds: z.array(z.string()).default([]),
	audienceBlanked: z.boolean().default(false),
	/**
	 * When each slide's question was opened, as an ISO instant keyed by slide id
	 * (REQ057). Written by the server when the presenter navigates to a slide,
	 * and the one thing a quiz's countdown and its deadline are derived from —
	 * see {@link quizDeadlineFor}.
	 *
	 * A slide is stamped **once**, on first arrival, and only re-stamped when the
	 * presenter deliberately restarts its timer. Re-stamping on every visit would
	 * make a question's window — and so every score measured against it — depend
	 * on how often the presenter happened to page back through the deck.
	 *
	 * Not private: it is part of the public presentation document precisely
	 * because both the shared screen and every participant's phone have to agree
	 * on when the question closes.
	 */
	slideStartedAt: z.record(z.string(), z.string()).default({}),
	/**
	 * The Q&A layer (REQ036/REQ037): whether questions can be asked from any
	 * slide, and who may read the list.
	 *
	 * Public, like `slideStartedAt` above and for the same reason — every
	 * participant's phone has to know whether the layer is on and whether the list
	 * it can fetch is the room's or only its own. Neither value is a secret; the
	 * questions behind them are, and those never ride this document.
	 */
	qaEnabled: z.boolean().default(false),
	qaVisibility: QAVisibilityEnum.default("presenter"),
	/**
	 * The two participant channels (REQ077, REQ078): whether reactions may be
	 * sent from any slide, and whether the deck carries a live chat.
	 *
	 * Public for the same reason the Q&A settings above are: every phone in the
	 * room has to know whether to draw a reaction bar and a chat box, and neither
	 * switch is a secret. What the channels *carry* is a different question —
	 * a reaction is never stored at all, and the chat has its own endpoint.
	 */
	reactionsEnabled: z.boolean().default(false),
	chatEnabled: z.boolean().default(false),
	/**
	 * Whether the people joining this deck state a name (REQ076).
	 *
	 * Public for the reason the switches above it are, and it is the one on this
	 * document whose *contents* are deliberately elsewhere: every phone has to
	 * know whether to ask before it can draw the question, so the switch travels
	 * to the whole room — while the names it collects reach only a caller who can
	 * edit the deck, through a route of their own. Read it through
	 * {@link deckRequiresParticipantName}.
	 */
	requireParticipantName: z.boolean().default(false),
	/**
	 * The deck's theme (REQ079), the one it authored for itself (REQ080/REQ135)
	 * and the logo it carries (REQ136).
	 *
	 * Public, and necessarily so: the theme is what every phone in the room draws
	 * itself in, and the mark is the one it draws instead of ours. None of it is a
	 * secret — the whole point of all three is that the audience sees them — so
	 * they ride the ordinary presentation document rather than an editor-only
	 * payload, and reach the join screen through the same door.
	 *
	 * Read them through {@link deckThemeIdFor}, {@link deckBrandFor} and
	 * {@link deckLogoFor} rather than off the fields, so an unknown theme, a
	 * colour outside the grammar and an unusable logo URL resolve the same way on
	 * every surface.
	 */
	theme: DeckThemeIdEnum.default(DEFAULT_DECK_THEME),
	themeBrand: DeckBrandSchema.default({}),
	themeLogoUrl: z.string().default(""),
	themeLogoAlt: z.string().default(""),
	/**
	 * The workspace that owns this deck (REQ128), or `null` for a deck owned by an
	 * account or held by an edit token.
	 *
	 * The one ownership field that *does* travel, and the exception proves the
	 * rule: `creatorId` names a person and is stripped from every response, while
	 * this names the shared thing a deck sits in, which is the first fact a surface
	 * listing decks has to draw. It is not a credential and opens nothing — every
	 * gated route re-resolves the caller's role in the workspace from the request's
	 * own credentials, so a client that lies to itself about this only mis-draws
	 * its own buttons.
	 */
	workspaceId: z.string().nullable().default(null),
	createdAt: z.string(),
});

export type Presentation = z.infer<typeof PresentationSchema>;

// ── The shareable results link (REQ098) ──────────────────────

/**
 * The request header a results-link holder presents its token in.
 *
 * A header of its own rather than the `Authorization: Bearer` slot the edit
 * token also answers on: the two are different capabilities, and a server that
 * read one credential out of the other's slot would decide which it was holding
 * by trying both. Lower-cased because that is how `Headers.get` is keyed.
 */
export const RESULTS_TOKEN_HEADER = "x-omul-results-token";

/**
 * The request header a deck's edit-token holder may present its token in.
 *
 * The web UI has always used the `Authorization: Bearer` slot instead, so this
 * is not what the client sends — it is the documented dedicated alternative.
 */
export const EDIT_TOKEN_HEADER = "x-omul-edit-token";

/**
 * A deck's results link as its organizer reads it (REQ098).
 *
 * `resultsToken` is the plaintext secret and is filled **once**, by the mint —
 * only its hash is stored, so no later read can produce it again. Every other
 * read emits the key as an explicit `null` rather than dropping it (ADR-0024),
 * so "there is no link" and "there is a link and this is not the moment you are
 * handed it" stay one shape and no client reaches for `??`.
 */
export const ResultsLinkSchema = z.object({
	/** Whether a link exists right now. `false` after a revoke. */
	active: z.boolean().default(false),
	/** When the current link was minted, or `null` when there is none. */
	issuedAt: z.string().nullable().default(null),
	/** The secret, on the mint response alone. `null` everywhere else. */
	resultsToken: z.string().nullable().default(null),
});

export type ResultsLink = z.infer<typeof ResultsLinkSchema>;

// ── Deck sharing: collaborators on a deck (REQ075) ────────────
//
// A third way an account can have standing on a deck, beside owning it and
// holding its edit token: the owner **grants** another account a stated level of
// access. The level is the whole of what the grant says, and it is enforced on
// the server for every mutation — a UI that merely stopped drawing a button
// would leave the route behind it open to anyone who could type a URL.
//
// Three levels, in one order, and the order is the point: `view` < `comment` <
// `edit`. What separates them is what the holder may **change**, not what they
// may read — a collaborator was deliberately given the deck, so all three read
// it as its author wrote it (the answer keys, the presenter's notes, the tallies
// the room is kept from). Read {@link canMutateDeck} and
// {@link canReadDeckAuthoring} as the two halves of that sentence, and never
// re-derive either by comparing level strings at a call site.
//
// `comment` grants no mutation power beyond `view` **today**, and that is not an
// oversight: comment threads on slides are REQ074, which does not exist yet. The
// level is carried faithfully through the model anyway, so REQ074 has a standing
// to build on rather than a vocabulary to retrofit.

/** The access levels a deck can be shared at, weakest first (REQ075). */
export const DECK_ACCESS_LEVELS = ["view", "comment", "edit"] as const;

export const DeckAccessLevelEnum = z.enum(DECK_ACCESS_LEVELS);

export type DeckAccessLevel = (typeof DECK_ACCESS_LEVELS)[number];

/**
 * Whether an access level authorizes a **mutation** of the deck — the single
 * predicate every gated route is decided by (ADR-0026).
 *
 * `null` is "no standing at all" and is the withholding value, so a caller whose
 * level could not be resolved is refused rather than waved through. Only `edit`
 * passes: `comment` will grow its own writes with REQ074, and those will be
 * writes to a *comment*, not to the deck.
 */
export function canMutateDeck(level: DeckAccessLevel | null): boolean {
	return level === "edit";
}

/**
 * Whether an access level reads the deck as its author wrote it rather than as
 * the room sees it — the quiz answer key still running (REQ056), the presenter's
 * notes (REQ090), a Form slide's per-participant rows (REQ061), a tally the
 * reveal mode withholds (REQ015–REQ017).
 *
 * Any grant at all is enough, because a grant *is* the owner saying "this person
 * is on the deck's side". The level says what they may change; it does not
 * hand them a redacted copy of what they were invited to.
 */
export function canReadDeckAuthoring(level: DeckAccessLevel | null): boolean {
	return level !== null;
}

/**
 * The **strongest** of the levels given, or `null` when there are none.
 *
 * Where {@link weakestDeckAccessLevel} in `services/collaborators.ts` folds
 * several rows of the *same* standing together — duplicates, where the harm is
 * an unseen row keeping access alive — this folds several **independent**
 * standings into one answer, and the two go opposite ways for that reason. A
 * caller who is a member of the workspace that owns a deck *and* holds a grant on
 * it has two separate reasons to be there, and the weaker one is not a demotion:
 * it is the reading the pre-existing code already had, where an owner who somehow
 * also held a `view` grant on their own deck stayed an editor.
 */
export function strongestDeckAccessLevel(
	levels: readonly (DeckAccessLevel | null)[],
): DeckAccessLevel | null {
	let strongest: DeckAccessLevel | null = null;
	for (const level of levels) {
		if (level === null) continue;
		if (
			strongest === null ||
			DECK_ACCESS_LEVELS.indexOf(level) > DECK_ACCESS_LEVELS.indexOf(strongest)
		) {
			strongest = level;
		}
	}
	return strongest;
}

/**
 * Whether the caller a **client surface** is drawing for may edit the deck — the
 * one answer every such surface gates its controls on (ADR-0026), and the client
 * side of {@link canMutateDeck}.
 *
 * A browser has two independent proofs of standing and the server honours both,
 * so asking only one of them is how an owner gets told their own deck is not
 * theirs (REQ149):
 *
 *  - `heldEditToken` — whether this browser holds the deck's edit token, which
 *    rides every mutation as `Authorization: Bearer`. A `localStorage` fact, and
 *    therefore a fact about *this browser* rather than about the caller.
 *  - `accessLevel` — the standing the deck read reported for the request's own
 *    credentials (REQ075). This is the half that covers the owner the token map
 *    cannot see: on a second machine or browser profile, after site data was
 *    cleared, and on a deck created through the API with `x-api-key` — which is
 *    deliberately minted **no** edit token, so its owner can never hold one.
 *
 * `undefined` is accepted for the level and read as no standing, because a page
 * asks this before its fetch has answered; the token half still carries a
 * browser that holds one, so the controls do not flicker through a read-only
 * pass on every load.
 *
 * A *report*, never a credential: every gated route re-resolves the caller's
 * standing from the request's own headers, so a client that gets this wrong
 * mis-draws its own buttons and nothing more.
 */
export function callerCanEditDeck({
	heldEditToken,
	accessLevel,
}: {
	heldEditToken: boolean;
	accessLevel: DeckAccessLevel | null | undefined;
}): boolean {
	return heldEditToken || canMutateDeck(accessLevel ?? null);
}

/**
 * One collaborator on a deck, as its owner reads the list (REQ075).
 *
 * Deliberately keyed by the **grant's** id rather than the collaborator's
 * account id: `creatorId` and every other account identifier stay server-side,
 * and this id is a random per-grant handle that names nothing outside this deck.
 * The email and name are the contact the owner typed to invite them, handed back
 * so the list is legible — never a credential, and never anybody else's to read,
 * since the list is owner-only.
 *
 * Parsing a stored grant through this schema is what drops the account id, the
 * same construction that keeps `creatorTokenHash` off the wire: Zod strips keys
 * the schema does not declare.
 */
export const DeckCollaboratorSchema = z.object({
	/** The grant's own id — the handle a level change or a revoke names it by. */
	id: z.string(),
	/** The invited account's login email, as the owner addressed it. */
	email: z.string().default(""),
	/** Their display name, or `null` when the account has none (ADR-0024). */
	name: z.string().nullable().default(null),
	level: DeckAccessLevelEnum.default("view"),
	createdAt: z.string().default(""),
	updatedAt: z.string().default(""),
});

export type DeckCollaborator = z.infer<typeof DeckCollaboratorSchema>;

/**
 * Sharing a deck with an account: who, and at what level. The email is the only
 * way in — a caller never names an account by id, because it never learns one.
 */
export const ShareDeckSchema = z.object({
	email: z.string().trim().email().max(320),
	/**
	 * Stated rather than inferred, but defaulted to the weakest level: a request
	 * that forgets to say what it is granting must not grant the strongest thing
	 * there is.
	 */
	level: DeckAccessLevelEnum.default("view"),
});

export type ShareDeckInput = z.infer<typeof ShareDeckSchema>;

/**
 * Changing an existing grant's level. No default here, unlike
 * {@link ShareDeckSchema}: this request exists only to state a level, so an
 * absent one is a malformed request rather than a silent demotion to `view`.
 */
export const DeckAccessLevelBodySchema = z.object({
	level: DeckAccessLevelEnum,
});

// ── Comment threads on slides (REQ074) ───────────────────────
//
// The consumer the middle access level was reserved for. A deck carries one
// thread per slide, and the thread is the deck's **authoring** conversation: it
// belongs to the accounts the deck is shared with and to nobody else.
//
// Two rules decide everything in this block, and both are stated here once so no
// route re-derives either:
//
//  - **Who.** {@link canReadDeckComments} and {@link canWriteDeckComments} are
//    the two halves, read off the same resolved level every mutation is decided
//    by. Any grant reads the threads — a `view` collaborator was invited onto the
//    deck and reads what its author wrote, exactly as they read the answer keys
//    and the presenter's notes (see {@link canReadDeckAuthoring}) — while writing
//    starts at `comment`. The deck's **owner** is `edit` by construction, so both
//    predicates answer for them without a case of their own.
//  - **Never a participant.** A comment reaches no payload an unauthenticated or
//    participant-scoped caller can ask for: not the join lookup, not the deck
//    read, not a slide broadcast, not a tally, not the workbook. That is a
//    property of *where the rows live* rather than of a projection somebody has
//    to remember — comments are their own collection, read by their own routes,
//    and no other surface ever loads one. The edit token opens nothing here for
//    the same reason it opens no sharing surface (REQ075): it is anonymous and
//    forwardable, there is no account behind it to attribute a comment to, and an
//    edit link handed to somebody in the room must not turn into a way to read
//    what the organizers said to each other.

/** The longest one comment may be, in characters. */
export const SLIDE_COMMENT_MAX_LENGTH = 2000;

/**
 * Whether an access level may **read** a deck's comment threads (REQ074).
 *
 * Any standing at all, on the reading {@link canReadDeckAuthoring} states: a
 * grant is the owner saying "this person is on the deck's side", and the level
 * says what they may change rather than handing them a redacted copy of the deck
 * they were invited to. `null` — no standing — is the withholding answer, which
 * is what every participant, every stranger and every anonymous caller resolves
 * to.
 */
export function canReadDeckComments(level: DeckAccessLevel | null): boolean {
	return level !== null;
}

/**
 * Whether an access level may **write** a comment on a deck's slide (REQ074).
 *
 * `comment` and `edit`, and this is the first thing in the codebase that tells
 * the two weakest levels apart: a `view` grant is someone shown the deck, a
 * `comment` grant is someone asked what they think of it. Not derived by
 * comparing level strings at a call site — a route that wrote
 * `level !== "view"` would silently start admitting a fourth level the day one
 * is added.
 */
export function canWriteDeckComments(level: DeckAccessLevel | null): boolean {
	return level === "comment" || level === "edit";
}

/**
 * One comment on one slide, as the accounts on the deck read it (REQ074).
 *
 * Keyed by the comment's own id, and carrying **no account identifier** — the
 * author is named by their display name and by nothing else. The construction is
 * the one that keeps `creatorId` off a deck and `userId` off a grant: the schema
 * does not declare the field, and Zod strips what a schema does not declare, so
 * an account id cannot reach a client by being spread into a response here.
 *
 * An email is deliberately *not* on this shape either, and that is narrower than
 * the collaborator list next door. That list is the owner's own, so the
 * addresses on it are ones its reader typed; a thread is read by every account
 * on the deck, and "who is on this deck?" is not a collaborator's to enumerate
 * (REQ075). A name is what reading a conversation needs.
 */
export const SlideCommentSchema = z.object({
	/** The comment's own id — what a delete names it by. */
	id: z.string(),
	/** The slide this thread is anchored to. */
	slideId: z.string().default(""),
	/** What was written, verbatim: stored as typed and never rendered as HTML. */
	body: z.string().default(""),
	/** The author's display name, or `null` when the account has none (ADR-0024). */
	authorName: z.string().nullable().default(null),
	/**
	 * Whether this caller wrote it — resolved per request from the credentials
	 * that request carries, never from anything the client sends. It is what lets
	 * a surface offer the delete only on a comment its reader may actually remove,
	 * and the route re-decides the same question anyway.
	 */
	mine: z.boolean().default(false),
	createdAt: z.string().default(""),
});

export type SlideComment = z.infer<typeof SlideCommentSchema>;

/**
 * Writing one comment: which slide it is anchored to, and what it says.
 *
 * The body is trimmed and bounded here rather than at the store, so a comment of
 * nothing but whitespace is a malformed request instead of an empty line in
 * somebody's thread. Neither field defaults — a comment with no slide is
 * anchored to nothing and a comment with no text is not a comment (ADR-0018).
 */
export const PostSlideCommentSchema = z.object({
	slideId: z.string().min(1),
	body: z.string().trim().min(1).max(SLIDE_COMMENT_MAX_LENGTH),
});

export type PostSlideCommentInput = z.infer<typeof PostSlideCommentSchema>;

// ── Workspaces (REQ128, REQ129) ──────────────────────────────
//
// Every standing above this line belongs to **one account** or to one
// forwardable credential: a deck has an owner, and the owner lends other accounts
// a level on it. A workspace is the thing neither of those can be — an owner that
// is not a person. It holds decks of its own (REQ128), and the accounts in it
// hold a **role** on the workspace rather than a grant on each deck (REQ129).
//
// Three rules decide everything in this block, and all three are stated here once
// so no route re-derives any of them:
//
//  - **A workspace deck has no account owner at all.** `creatorId` is `null` and
//    `workspaceId` names the workspace, which is the whole of REQ128's "surviving
//    any single member's removal": there is no account whose removal takes the
//    deck with it, and — just as importantly — no account that keeps standing on
//    it *after* being removed. The account that made the deck is a member like
//    every other, and stops being one the moment the workspace says so.
//  - **A role resolves to a deck access level, and the level is what every gate
//    reads.** {@link workspaceDeckAccessLevel} is the one bridge, so a workspace
//    deck is authorized by the same {@link canMutateDeck} /
//    {@link canReadDeckAuthoring} predicates a shared deck is, and a mutation
//    route cannot be gated on one model and forget the other.
//  - **What a role governs beyond the deck is its own predicate**, never a
//    comparison of role strings at a call site. The set below is deliberately
//    open at the weak end: REQ131 reserves a reduced-capability role that reads
//    and comments but neither creates nor presents, and adding it means one entry
//    at the front of {@link WORKSPACE_ROLES} and one line in each predicate — not
//    a sweep for `!== "member"` spelled five different ways.
//
// What this slice deliberately does not model: a workspace's own settings, theme,
// templates, usage or seats. Each is its own pending requirement, and a field
// here that nothing enforces would be a promise the server does not keep.

/**
 * The longest a workspace's name may be, in characters. The deck title's cap
 * ({@link DECK_TITLE_MAX_LENGTH}) and for the same reason: it is authored display
 * text that every member reads.
 */
export const WORKSPACE_NAME_MAX_LENGTH = 200;

/**
 * The roles a workspace membership can carry, **weakest first** (REQ129).
 *
 * The order is the one thing the array asserts, and it is what leaves room for
 * REQ131's reduced role to arrive at the front without renumbering anything.
 * Capability is *not* read off this order — the predicates below name their roles
 * explicitly — because "everything above X" is exactly the reading that silently
 * admits a role nobody considered when it is inserted in the middle.
 */
export const WORKSPACE_ROLES = ["member", "admin", "owner"] as const;

export const WorkspaceRoleEnum = z.enum(WORKSPACE_ROLES);

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * What a membership is worth when the request that made it did not say — the
 * weakest role there is, for the reason {@link ShareDeckSchema} defaults a grant
 * to `view`: a request that forgets to state what it is granting must not grant
 * the strongest thing available.
 */
export const DEFAULT_WORKSPACE_ROLE: WorkspaceRole = "member";

/**
 * The standing a role gives on the workspace's **decks** — the single bridge
 * between REQ129's role and the access model every deck route is already decided
 * by (ADR-0026).
 *
 * All three roles read and run the workspace's decks today, which is REQ128's
 * "readable and presentable by its members". They differ in what they may do to
 * the *workspace* (see the predicates below), not in what they may do to a slide.
 * REQ131's reduced role is the first that will answer something weaker here, and
 * it will do so by returning `"comment"` from this one function rather than by
 * every deck route learning about workspaces.
 *
 * `null` — no membership — is the withholding answer, and it is what every
 * stranger, every participant and every anonymous caller resolves to.
 */
export function workspaceDeckAccessLevel(
	role: WorkspaceRole | null,
): DeckAccessLevel | null {
	if (role === null) return null;
	return "edit";
}

/** Whether a role reads the workspace itself: its name, roster and deck list. */
export function canReadWorkspace(role: WorkspaceRole | null): boolean {
	return role !== null;
}

/**
 * Whether a role may **create** decks the workspace owns. Every role today; the
 * reduced role REQ131 reserves is the one that will not, which is why this is a
 * predicate of its own rather than a reading of {@link canReadWorkspace}.
 */
export function canCreateWorkspaceDecks(role: WorkspaceRole | null): boolean {
	return role === "member" || role === "admin" || role === "owner";
}

/**
 * Whether a role may act on a workspace deck the way an account owner acts on
 * their own — **delete it**, and decide which accounts outside the workspace it
 * is shared with (REQ075).
 *
 * Not every member, on the reading `requireEdit(…, { allowCollaborators: false })`
 * already takes for a grant: being trusted to build a deck is not being trusted
 * to destroy it, and a delete takes the room's answers with it (REQ146). A
 * workspace deck has no account owner to fall back on, so this is the answer to
 * "who is the owner here?" — and it is a role, checked on the server.
 */
export function canAdministerWorkspaceDecks(
	role: WorkspaceRole | null,
): boolean {
	return role === "admin" || role === "owner";
}

/** Whether a role may add members, change their role, or remove them. */
export function canManageWorkspaceMembers(role: WorkspaceRole | null): boolean {
	return role === "admin" || role === "owner";
}

/**
 * Whether a role may change the workspace **itself**: rename it, delete it, hand
 * out or take back the `owner` role, and move one of its decks back out into a
 * personal account.
 *
 * The narrowest of the five, and the last one holds the reason: taking a deck out
 * of the workspace is the one act that ends the shared ownership REQ128 exists to
 * create, so it stays with the role that could have deleted the workspace anyway.
 */
export function canAdministerWorkspace(role: WorkspaceRole | null): boolean {
	return role === "owner";
}

/**
 * One workspace, as a member reads it.
 *
 * `role` is the caller's **own** standing, reported here for the reason a deck's
 * `accessLevel` is (REQ075): so a surface can disable what this caller may not do
 * and say why (ADR-0025) instead of letting them find out from a `403`. It is a
 * report and never a credential — every gated route re-resolves the role from the
 * request's own credentials.
 */
export const WorkspaceSchema = z.object({
	id: z.string(),
	name: z.string().default(""),
	role: WorkspaceRoleEnum.nullable().default(null),
	createdAt: z.string().default(""),
	updatedAt: z.string().default(""),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

/**
 * One membership, as the roster shows it.
 *
 * Keyed by the **membership's** own id rather than the account's, the same
 * construction {@link DeckCollaboratorSchema} uses: a role change and a removal
 * name a row, and no account identifier reaches a client because this schema does
 * not declare one and Zod strips what a schema does not declare.
 *
 * `email` is `null` for a reader who may not manage the roster (ADR-0024 — the
 * key is emitted either way, so no client learns a second shape). A member sees
 * who they are working with by name; the address somebody was invited at is
 * membership *management* data, and that is the narrower default of the two.
 */
export const WorkspaceMemberSchema = z.object({
	/** The membership's own id — what a role change or a removal names it by. */
	id: z.string(),
	email: z.string().nullable().default(null),
	name: z.string().nullable().default(null),
	role: WorkspaceRoleEnum.default(DEFAULT_WORKSPACE_ROLE),
	/** Whether this row is the caller's own — what a "Leave" control is drawn on. */
	mine: z.boolean().default(false),
	createdAt: z.string().default(""),
	updatedAt: z.string().default(""),
});

export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

/** Creating a workspace: its name, and nothing else this slice knows about. */
export const CreateWorkspaceSchema = z.object({
	name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX_LENGTH),
});

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

/**
 * Renaming one. A schema of its own rather than a partial of the create, because
 * a rename that carries no name is a malformed request and not a workspace called
 * `""` (ADR-0018).
 */
export const RenameWorkspaceSchema = z.object({
	name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX_LENGTH),
});

/**
 * Adding an account to a workspace: who, and at what role. The email is the only
 * way in, exactly as it is for a deck grant — a caller never names an account by
 * id, because it is never handed one.
 */
export const AddWorkspaceMemberSchema = z.object({
	email: z.string().trim().email().max(320),
	role: WorkspaceRoleEnum.default(DEFAULT_WORKSPACE_ROLE),
});

export type AddWorkspaceMemberInput = z.infer<typeof AddWorkspaceMemberSchema>;

/**
 * Moving an existing membership to another role. No default, unlike
 * {@link AddWorkspaceMemberSchema}: this request exists only to state a role, so
 * an absent one is malformed rather than a silent demotion.
 */
export const WorkspaceRoleBodySchema = z.object({
	role: WorkspaceRoleEnum,
});

/**
 * Moving a deck between a personal account and a workspace (REQ128).
 *
 * `null` is a real value here and means "out of the workspace, into my account",
 * so it is `nullable()` rather than optional — a body that omits the key is a
 * request that did not say where the deck should go.
 */
export const DeckWorkspaceSchema = z.object({
	workspaceId: z.string().nullable(),
});

// ── Vote schema ──────────────────────────────────────────────

/**
 * The longest a single submission's `value` may be. Declared rather than
 * inlined because a free-text answer is typed against it (REQ055): the field
 * that takes one stops at the same number the boundary refuses past, so a
 * participant meets the cap as a key that does nothing rather than as Elysia's
 * raw validation failure in place of the quiz's own wording (ADR-0026).
 */
export const VOTE_VALUE_MAX_LENGTH = 500;

/**
 * The longest submission any slide type accepts — the outer bound the request
 * schema enforces, not the bound any one slide lives under.
 *
 * Two numbers exist because one submission genuinely is bigger than the rest: a
 * Form slide (REQ061) packs several typed answers into one value, so its budget
 * is a multiple of a single answer's ({@link FORM_VALUE_MAX_LENGTH}), while
 * every other type's whole answer is one word, one number or a handful of ids
 * and stays inside {@link VOTE_VALUE_MAX_LENGTH}.
 *
 * Raising the *global* cap to fit the form was the alternative and it is the
 * wrong one: it would quietly let a word-cloud entry be four times longer than
 * the cloud can draw. So the schema takes the widest value any slide could
 * legitimately send, and the per-type bound is applied where the slide type is
 * finally known — see {@link voteValueLimitFor} and its single read site in
 * `submitVote`. A submission over its type's bound is refused with the same 400
 * either way; what differs is only which of the two boundaries names it.
 */
export const VOTE_VALUE_LIMIT = Math.max(
	VOTE_VALUE_MAX_LENGTH,
	FORM_VALUE_MAX_LENGTH,
);

/**
 * The longest submission *this* slide type accepts (ADR-0026). One read site,
 * so the cap a surface offers and the cap the boundary enforces cannot drift.
 */
export function voteValueLimitFor(type: SlideType): number {
	return type === "form" ? FORM_VALUE_MAX_LENGTH : VOTE_VALUE_MAX_LENGTH;
}

export const VoteSchema = z.object({
	slideId: z.string(),
	/**
	 * MC/quiz: option ID. Word-cloud/open-text: text. Scale: number as string.
	 * Ranking: the ordered item IDs, best first, comma-separated — build it with
	 * {@link encodeRanking} and read it with {@link decodeRanking} rather than
	 * splitting the string by hand. 2x2 Grid: one item's coordinates, `"x,y"`,
	 * via {@link encodeGridPoint} / {@link decodeGridPoint}. 100 Points: the
	 * whole allocation as `"itemId:points"` pairs, via {@link encodePoints} /
	 * {@link decodePoints}. Guess the Number: the estimate itself, via
	 * {@link encodeGuess} / {@link decodeGuess}. Pin on Image: the pin's per-mille
	 * position on the image, `"x,y"`, via {@link encodePinPoint} /
	 * {@link decodePinPoint}. Quiz: an option id, or — on a
	 * typed question (REQ055) — the answer the participant wrote, via
	 * {@link encodeQuizAnswer} / {@link decodeQuizAnswer}. Form: the whole
	 * filled-in form as `fieldId`/`answer` pairs, via
	 * {@link encodeFormSubmission} / {@link decodeFormSubmission}.
	 *
	 * Bounded here by the widest any slide type could legitimately be, and by its
	 * own type's bound in `submitVote` — see {@link VOTE_VALUE_LIMIT}.
	 */
	value: z.string().min(1).max(VOTE_VALUE_LIMIT),
	participantId: z.string().optional(),
	/**
	 * The sub-item of the slide this vote answers: the statement being rated on
	 * a multi-statement scale (REQ029), or the item being placed on a 2x2 grid
	 * (REQ047). Genuinely absent for single-statement scales and other slide
	 * types, so it is modelled as an explicit `null` (ADR-0029) rather than a
	 * missing key.
	 */
	statementId: z.string().nullable().default(null),
	/**
	 * `true` to mark this statement skipped (REQ031) or this grid item "not
	 * assessable" (REQ050); `value` is ignored when set.
	 */
	skip: z.boolean().default(false),
});

export type Vote = z.infer<typeof VoteSchema>;

// ── Response vote schema (REQ025) ─────────────────────────────

/** A participant upvoting a submitted open-ended response. */
export const ResponseVoteSchema = z.object({
	slideId: z.string(),
	/** The vote id of the response being upvoted. */
	responseId: z.string(),
	participantId: z.string().optional(),
});

export type ResponseVote = z.infer<typeof ResponseVoteSchema>;

// ── Storage schemas (zodstore) ───────────────────────────────
//
// The shapes below describe documents exactly as `server/db.ts` persists them
// through `@binaryplease/zodstore`. The store is Zod-gated: every document is
// validated on the way in and re-parsed on the way out, so these schemas are the
// single source of truth for the stored shape (ADR-0013) — distinct from the API
// request/response schemas above, because stored documents carry server-managed
// fields (a generated `id`, timestamps, the creator-token hash).
//
// Per ADR-0029 every non-identity field declares a `.default(...)` so the schema
// can grow by appending a field with no migration: rows written under an older
// shape re-parse forward with the default filling the gap. Identity fields — the
// primary `id` and the presentation/slide/response references — carry no default
// and fail loudly when absent (ADR-0018), since a fabricated id is worse than a
// missing one.

export const StoredPresentationSchema = z.object({
	id: z.string(),
	code: z.string().default(""),
	title: z.string().default(""),
	slides: z.array(SlideSchema).default([]),
	activeSlideIndex: z.number().default(0),
	status: z.enum(["draft", "live", "ended"]).default("draft"),
	language: z.string().default("en"),
	mode: z.enum(["live", "survey"]).default("live"),
	resultsVisibility: ResultsVisibilityEnum.default("instant"),
	revealedSlideIds: z.array(z.string()).default([]),
	/**
	 * The slides closed to submissions (REQ111) and whether the shared screen is
	 * blanked (REQ109). Both defaulted per ADR-0029 to the state a deck written
	 * before they existed was already in — every slide open, nothing blanked —
	 * which is also the only pair of defaults that cannot silently refuse a room
	 * or darken a projector. See {@link slideAcceptsSubmissions}.
	 */
	closedSlideIds: z.array(z.string()).default([]),
	audienceBlanked: z.boolean().default(false),
	/** When each slide's question was opened, ISO by slide id (REQ057). */
	slideStartedAt: z.record(z.string(), z.string()).default({}),
	/** The Q&A layer: on/off across every slide (REQ036) and who reads it (REQ037). */
	qaEnabled: z.boolean().default(false),
	qaVisibility: QAVisibilityEnum.default("presenter"),
	/**
	 * The participant channels: reactions on any slide (REQ077) and the deck's
	 * live chat (REQ078). Both defaulted off per ADR-0029, so every deck written
	 * before they existed re-parses forward onto the room it already had rather
	 * than acquiring two channels its organizer never opened.
	 */
	reactionsEnabled: z.boolean().default(false),
	chatEnabled: z.boolean().default(false),
	/**
	 * Whether the people joining this deck state a name (REQ076). Defaulted off
	 * per ADR-0029, so every deck written before this field existed re-parses
	 * forward onto the anonymous room it already had rather than acquiring a
	 * question at its door that its organizer never asked.
	 */
	requireParticipantName: z.boolean().default(false),
	/**
	 * The theme this deck is drawn in (REQ079, REQ080) and the organizer's own
	 * mark (REQ136), stored as an authored URL and its accessible name.
	 *
	 * A **built-in** theme is stored as its id and never as a palette: what
	 * `pulse` looks like is a decision the product keeps making, and a deck that
	 * had baked the colours in would be pinned to the day it was authored. A theme
	 * the deck authored *for itself* has no such catalog to point at, so
	 * `themeBrand` is where its colours and its face are kept — three colours and
	 * a font id, from which the client derives the rest (REQ080/REQ092).
	 *
	 * All of it defaulted per ADR-0029, so every deck written before these fields
	 * existed re-parses forward onto the house theme it was already wearing.
	 */
	theme: DeckThemeIdEnum.default(DEFAULT_DECK_THEME),
	themeBrand: DeckBrandSchema.default({}),
	themeLogoUrl: z.string().default(""),
	themeLogoAlt: z.string().default(""),
	/**
	 * Optional owner id backing the `?creatorId=` list filter. Null until creator
	 * accounts exist; kept here so the filter field is always present (ADR-0024).
	 *
	 * Also `null` — deliberately and always — on a deck a **workspace** owns
	 * (REQ128): the two ownership fields are alternatives rather than layers, and
	 * this one naming an account on a workspace deck would be an account whose
	 * removal from the workspace left it holding the deck anyway. See
	 * `workspaceId` below.
	 */
	creatorId: z.string().nullable().default(null),
	/**
	 * SHA-256 hash of the one-time creator token. Never leaves the server — the
	 * route layer re-parses through {@link PresentationSchema}, which does not
	 * declare this field and so strips it from every response.
	 */
	creatorTokenHash: z.string().nullable().default(null),
	/**
	 * The deck's shareable results link (REQ098), as the SHA-256 hash of the token
	 * that names it and the instant it was issued. `null` means the deck has no
	 * link — which is what every deck written before this field existed re-parses
	 * forward onto (ADR-0029), and the only value that fails safe: a link the
	 * organizer never minted must not be one a caller can present.
	 *
	 * Hashed for the same reason the edit token is, and stripped from responses by
	 * the same construction: {@link PresentationSchema} declares neither field, so
	 * neither can travel. One link per deck, so **revoking is clearing this pair**
	 * and re-minting retires whatever came before by overwriting it.
	 */
	resultsTokenHash: z.string().nullable().default(null),
	resultsTokenIssuedAt: z.string().nullable().default(null),
	/**
	 * The workspace that owns this deck (REQ128), or `null` for a deck owned by an
	 * account. Defaulted per ADR-0029, so every deck written before workspaces
	 * existed re-parses forward onto the account ownership it already had.
	 *
	 * It is a **credential-bearing field** even though it names no secret, and is
	 * on {@link UNWRITABLE_PRESENTATION_FIELDS} for it: the caller's authorization
	 * on a workspace deck is resolved from their role in *this* workspace, so a
	 * request that could write it could move any deck it can edit into a workspace
	 * it administers. It moves through `setPresentationWorkspace` alone, which
	 * checks both ends of the move.
	 *
	 * Set together with a `null` `creatorId` and a `null` `creatorTokenHash`, and
	 * that triple is what {@link canGrandfatherLegacyDeck} exists to tell apart
	 * from a genuine pre-auth deck.
	 */
	workspaceId: z.string().nullable().default(null),
	createdAt: z.string().default(""),
});

export type StoredPresentation = z.infer<typeof StoredPresentationSchema>;

/**
 * Whether a deck with no owner and no edit-token hash is a **pre-auth** deck that
 * predates accounts — grandfathered as editable so it keeps working — or a deck a
 * workspace owns, which has neither for a completely different reason (REQ128).
 *
 * Its own function, and read by `resolveDeckAccess` alone, because getting it
 * wrong is the sharpest failure in this file: a workspace deck read as legacy
 * would hand `edit` to every anonymous caller who could type its id. The
 * withholding answer is the one that costs nothing — an old deck that is wrongly
 * refused is claimed (`POST …/claim`) and works again.
 */
export function canGrandfatherLegacyDeck({
	creatorId,
	creatorTokenHash,
	workspaceId,
}: {
	creatorId: string | null;
	creatorTokenHash: string | null;
	workspaceId: string | null;
}): boolean {
	return !creatorId && !creatorTokenHash && !workspaceId;
}

/**
 * One workspace (REQ128) — an owner of decks that is not an account.
 *
 * `createdBy` records which account brought it into being and authorizes nothing:
 * the standing that matters is a membership row, which the create writes at the
 * same moment (see `services/workspaces.ts`). It is nullable because the account
 * may since have been deleted, and because ADR-0029 wants every non-identity
 * field to have a value a row written before it existed re-parses onto.
 */
export const StoredWorkspaceSchema = z.object({
	id: z.string(),
	name: z.string().default(""),
	createdBy: z.string().nullable().default(null),
	createdAt: z.string().default(""),
	updatedAt: z.string().default(""),
});

export type StoredWorkspace = z.infer<typeof StoredWorkspaceSchema>;

/**
 * One account's membership of one workspace (REQ129) — the stored half of a role.
 *
 * A collection of its own rather than an array on the workspace document, for the
 * reason the deck grants beside it are: it is read from **both** ends. A
 * workspace asks "who is in this?", and an account asks "which workspaces am I
 * in?" — the second on every request that touches a workspace deck, which is what
 * makes it the hot read rather than the convenient one.
 *
 * `workspaceId` and `userId` are the identity pair and carry no default
 * (ADR-0018/ADR-0029): a membership that lost either would be a role in nothing,
 * or nobody's. One row per pair, so "what may this account do here?" has exactly
 * one answer.
 */
export const StoredWorkspaceMemberSchema = z.object({
	id: z.string(),
	workspaceId: z.string(),
	/** The member's account (Better Auth `user.id`). Never leaves the server. */
	userId: z.string(),
	role: WorkspaceRoleEnum.default(DEFAULT_WORKSPACE_ROLE),
	/** The account that added them; `null` for the founding membership. */
	invitedBy: z.string().nullable().default(null),
	createdAt: z.string().default(""),
	updatedAt: z.string().default(""),
});

export type StoredWorkspaceMember = z.infer<typeof StoredWorkspaceMemberSchema>;

/**
 * One account's standing on one deck (REQ075) — the stored half of a grant.
 *
 * A collection of its own rather than an array on the presentation document, for
 * the reason the votes are: the grant is read from **both** ends. A deck asks
 * "who is on this?", and an account asks "which decks am I on?", and only a
 * collection can index both without walking every deck in the store.
 *
 * `presentationId` and `userId` are the identity pair and so carry no default
 * (ADR-0018/ADR-0029) — a grant that lost either would be a standing on nothing,
 * or nobody's. One row per pair: re-sharing with the same account changes the
 * level in place rather than stacking a second grant beside the first, so
 * "what may this account do here?" has exactly one answer.
 */
export const StoredDeckCollaboratorSchema = z.object({
	id: z.string(),
	presentationId: z.string(),
	/** The invited account (Better Auth `user.id`). Never leaves the server. */
	userId: z.string(),
	level: DeckAccessLevelEnum.default("view"),
	/**
	 * The account that granted this — the deck's owner at the time. Kept so a
	 * grant can say where it came from; `null` for a grant written before this
	 * field existed, which is what ADR-0029 buys.
	 */
	invitedBy: z.string().nullable().default(null),
	createdAt: z.string().default(""),
	updatedAt: z.string().default(""),
});

export type StoredDeckCollaborator = z.infer<
	typeof StoredDeckCollaboratorSchema
>;

/**
 * One comment on one slide (REQ074) — the stored half of a deck's threads.
 *
 * A collection of its own rather than an array on the presentation document, and
 * for a sharper reason than the grants beside it: the deck document is handed to
 * the whole room. `GET /join/:code` and every `slide.changed` broadcast are
 * projections of it, so a comment stored *on* it would be one forgotten
 * projection away from the room — and "never visible to participants" would rest
 * on every future read site remembering to strip a field. Here there is nothing
 * to strip: no participant-facing surface loads this collection at all.
 *
 * `presentationId`, `slideId` and `authorId` are the identity triple and carry no
 * default (ADR-0018/ADR-0029) — a comment that lost any of them would be anchored
 * to nothing, on nothing, by nobody. The author is a Better Auth `user.id` and
 * never leaves the server: {@link SlideCommentSchema} does not declare it.
 */
export const StoredSlideCommentSchema = z.object({
	id: z.string(),
	presentationId: z.string(),
	slideId: z.string(),
	/** The account that wrote it (Better Auth `user.id`). Never leaves the server. */
	authorId: z.string(),
	body: z.string().default(""),
	createdAt: z.string().default(""),
});

export type StoredSlideComment = z.infer<typeof StoredSlideCommentSchema>;

export const StoredVoteSchema = z.object({
	id: z.string(),
	presentationId: z.string(),
	slideId: z.string(),
	value: z.string().default(""),
	participantId: z.string().default(""),
	/**
	 * The sub-item this vote answers: a scale statement (REQ029) or a grid item
	 * (REQ047); null for slides that have no sub-items.
	 */
	statementId: z.string().nullable().default(null),
	/**
	 * Whether this statement was skipped (REQ031) / this grid item was marked
	 * not assessable (REQ050).
	 */
	skip: z.boolean().default(false),
	createdAt: z.string().default(""),
});

export type StoredVote = z.infer<typeof StoredVoteSchema>;

export const StoredResponseVoteSchema = z.object({
	id: z.string(),
	presentationId: z.string(),
	slideId: z.string(),
	responseId: z.string(),
	participantId: z.string().default(""),
	createdAt: z.string().default(""),
});

export type StoredResponseVote = z.infer<typeof StoredResponseVoteSchema>;

/**
 * One question asked through the Q&A layer (REQ036). Presentation-scoped, not
 * slide-scoped: the whole point of the layer is that a question outlives the
 * slide that happened to be on screen when somebody thought of it.
 */
export const StoredQAQuestionSchema = z.object({
	id: z.string(),
	presentationId: z.string(),
	text: z.string().default(""),
	/** Who asked. Never leaves the server — see {@link QAListEntry}. */
	participantId: z.string().default(""),
	/** Whether the presenter has marked it dealt with (REQ060). */
	answered: z.boolean().default(false),
	/** When they did, ISO; null while the question is still open (ADR-0024). */
	answeredAt: z.string().nullable().default(null),
	createdAt: z.string().default(""),
});

export type StoredQAQuestion = z.infer<typeof StoredQAQuestionSchema>;

/** One participant's upvote on a submitted question (REQ060). */
export const StoredQAUpvoteSchema = z.object({
	id: z.string(),
	presentationId: z.string(),
	questionId: z.string(),
	participantId: z.string().default(""),
	createdAt: z.string().default(""),
});

export type StoredQAUpvote = z.infer<typeof StoredQAUpvoteSchema>;

/**
 * One message posted to the deck's live chat (REQ078). Presentation-scoped like
 * a Q&A question and for the same reason: the channel belongs to the session,
 * not to whichever slide happened to be up when somebody typed.
 *
 * **There is no `StoredReaction` beside it, and that is the design** (REQ077). A
 * reaction is broadcast and forgotten — see the participant-channels section
 * above — so nothing in this file describes a persisted one, and no collection
 * exists for a future aggregation to find.
 */
export const StoredChatMessageSchema = z.object({
	id: z.string(),
	presentationId: z.string(),
	text: z.string().default(""),
	/** Who wrote it. Never leaves the server — see {@link ChatMessageEntry}. */
	participantId: z.string().default(""),
	createdAt: z.string().default(""),
});

export type StoredChatMessage = z.infer<typeof StoredChatMessageSchema>;

/**
 * The name one participant stated on joining one deck (REQ076).
 *
 * A collection of its own rather than a field on each vote, and the reason is
 * the one stated in the block above {@link ParticipantNameSchema}: a participant
 * has **one** name on a deck. Denormalising it onto the rows would make
 * correcting a typo a rewrite of every answer already given — and a rewrite that
 * missed one would leave the same person in the export twice under two
 * spellings. Here the join is `participantId`, which is what every row already
 * carries.
 *
 * `presentationId` and `participantId` are the identity pair and carry no
 * default (ADR-0018/ADR-0029): a row that lost either is a name belonging to
 * nobody, or to nobody's session. One row per pair — stating a name again
 * corrects it in place.
 *
 * The name never leaves the server except to a caller who can edit the deck:
 * neither {@link PresentationSchema} nor any tally declares it, so there is no
 * projection for a future read site to forget, exactly as with the comment
 * threads next door.
 */
export const StoredParticipantNameSchema = z.object({
	id: z.string(),
	presentationId: z.string(),
	/** The browser-minted handle every one of this person's rows is keyed by. */
	participantId: z.string(),
	name: z.string().default(""),
	createdAt: z.string().default(""),
	updatedAt: z.string().default(""),
});

export type StoredParticipantName = z.infer<typeof StoredParticipantNameSchema>;

// ── Q&A request schemas ──────────────────────────────────────
//
// Request bodies, not stored documents, so ADR-0029's "every field declares a
// default" does not apply the way it does above: an absent key here means "leave
// this as it is", and a default would turn every partial update into a full one.

/** A question submitted through the Q&A layer (REQ036). */
export const QAQuestionSchema = z.object({
	text: z.string().min(1).max(QA_TEXT_MAX_LENGTH),
	participantId: z.string().optional(),
});

export type QAQuestion = z.infer<typeof QAQuestionSchema>;

/** Toggling one participant's upvote on a question (REQ060). */
export const QAUpvoteSchema = z.object({
	participantId: z.string().optional(),
});

/** Marking a question answered, or putting it back in the queue (REQ060). */
export const QAAnsweredSchema = z.object({
	answered: z.boolean().optional(),
});

/**
 * Turning the layer on or off (REQ036) and choosing who reads it (REQ037).
 * Both keys are independently optional — the presenter's two switches move
 * separately, and sending one must not quietly re-assert the other.
 */
export const QASettingsSchema = z.object({
	enabled: z.boolean().optional(),
	visibility: QAVisibilityEnum.optional(),
});

// ── Participant-channel request schemas (REQ077, REQ078) ─────
//
// Request bodies again, so the note above applies unchanged: an absent key means
// "leave this as it is", and a default would turn a partial update into a full
// one.

/**
 * A reaction sent from whatever slide is on screen (REQ077).
 *
 * `slideId` is carried but is **not** what the reaction belongs to: it says
 * where the sender was looking, which is what lets a presenter's screen animate
 * a burst over the slide the room is actually reacting to. Nothing is keyed by
 * it, nothing is aggregated under it, and a reaction sent from a slide that has
 * since changed is still a reaction — so it is nullable rather than required.
 */
export const ReactionSchema = z.object({
	kind: ReactionKindEnum,
	slideId: z.string().optional(),
	participantId: z.string().optional(),
});

export type Reaction = z.infer<typeof ReactionSchema>;

/**
 * A message posted to the deck's live chat (REQ078).
 *
 * `text` is refused when it is **blank**, not merely when it is empty: `" "`
 * passes `.min(1)` and then trims to nothing, and a service that answered that
 * with its ordinary "cannot post" refusal would name the channel being closed
 * as the reason when the channel is open and the message is the problem
 * (ADR-0018 — fail loudly *and* accurately). Caught at the boundary, so a blank
 * message and an empty one are refused the same way, with the same status, for
 * the same stated reason.
 */
export const ChatMessageSchema = z.object({
	text: z
		.string()
		.min(1)
		.max(CHAT_TEXT_MAX_LENGTH)
		.refine((text) => text.trim().length > 0, {
			message: "A chat message cannot be blank",
		}),
	participantId: z.string().optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * Opening or closing the two participant channels (REQ077, REQ078). Both keys
 * are independently optional, like the Q&A layer's pair above: the presenter's
 * switches move separately, and sending one must not quietly re-assert the other.
 */
export const ParticipantChannelsSchema = z.object({
	reactionsEnabled: z.boolean().optional(),
	chatEnabled: z.boolean().optional(),
});

// ── Preview & test votes (REQ103, REQ104) ────────────────────
//
// A preview is a dry run of a deck that has not met a room yet: the organizer
// walks both perspectives — the shared screen and a participant's phone — and
// populates them with **test votes** so the charts on screen are the charts the
// room will see rather than empty frames.
//
// The whole slice turns on one property, and it is a property of the *shape* of
// the feature rather than of any check inside it: **a test vote is not a
// response.** Nothing generated for a preview is ever written. The generator
// (`server/preview.ts`) returns rows and returns them to its caller; the preview
// aggregation reads those rows out of memory; no store is touched on the path,
// so there is no vote to leak into a tally, a live session, or a participant's
// screen. Storing them and filtering them out later would put the guarantee in a
// predicate somebody can forget — this way the guarantee is that the code to
// write one does not exist.
//
// The knobs below are the whole request surface: how many synthetic respondents
// to simulate, which run to reproduce, and when the run's questions opened.

/**
 * How many synthetic respondents a preview simulates when the organizer has not
 * said (REQ104). Two dozen: enough that a distribution has a shape — a word
 * cloud with repeats, a ranking with a settled order, a leaderboard with a
 * podium — and small enough that a bar chart's labels are still the ones a
 * modest room produces.
 */
export const PREVIEW_DEFAULT_RESPONDENTS = 24;

/**
 * The most respondents one preview may simulate. Two hundred, because the
 * question REQ104 asks it to answer is "do these slides still work with many
 * responses" — the word cloud that stops fitting, the open-text wall, the
 * leaderboard past its cut — and that question needs a number well past a
 * typical room. Past this the answer stops changing and the cost of generating
 * and aggregating a whole deck per poll does not.
 */
export const PREVIEW_RESPONDENT_LIMIT = 200;

/**
 * What a preview run is asked for. Every field is optional and every one is a
 * *reproducibility* control rather than a setting on the deck: two requests with
 * the same three values produce the same test votes, which is what lets the
 * preview poll for a live countdown without the room it is showing changing
 * under the organizer every three seconds.
 */
export const PreviewQuerySchema = z.object({
	/** Synthetic respondents to simulate (REQ104); `0` previews empty slides. */
	respondents: z.coerce
		.number()
		.int()
		.min(0)
		.max(PREVIEW_RESPONDENT_LIMIT)
		.optional(),
	/**
	 * Which run to reproduce. The same seed over the same deck yields the same
	 * votes, so "regenerate" is the organizer changing this number and nothing
	 * else is ever non-deterministic.
	 */
	seed: z.coerce.number().int().min(0).optional(),
	/**
	 * When this run's questions opened, ISO. Supplied by the client so a poll
	 * does not restart every countdown it refreshes; defaults to the server's now
	 * for the first request of a run, which is what the response echoes back.
	 */
	startedAt: z.string().datetime().optional(),
});

export type PreviewQuery = z.infer<typeof PreviewQuerySchema>;

// ── PDF export (REQ096) ──────────────────────────────────────

/**
 * The one thing a caller decides about the deck's PDF: whether the collected
 * results are rendered into it (REQ096 — "with or without its collected
 * results").
 *
 * A **string** enum rather than `z.coerce.boolean()`, which reads the string
 * `"false"` as `true` — a query parameter arrives as text, and a switch whose
 * off position silently means on is the one bug this field could have. The two
 * spellings are the only ones accepted; anything else is a 422 from the route
 * rather than a document quietly carrying answers the caller asked it not to.
 *
 * Defaults to `"true"`, the results-carrying reading, because this is a route
 * on the results surface and the file it names is the session. The route is
 * authorized as an edit either way, so the default is not a disclosure decision
 * — it decides how much of what the caller may already read is drawn.
 */
export const DeckPdfQuerySchema = z.object({
	results: z.enum(["true", "false"]).optional().default("true"),
});

export type DeckPdfQuery = z.infer<typeof DeckPdfQuerySchema>;

// ── Segmented results (REQ020, REQ116) ───────────────────────

/**
 * The one thing a segmented read is asked for: which earlier slide's answers the
 * room is grouped by (REQ020).
 *
 * Required rather than defaulted, and it is the route's whole subject: there is
 * no sensible "group by whatever comes to hand", and a breakdown that quietly
 * picked its own grouping would be a chart nobody asked for. What may be named
 * here is `server/segmentation.ts`' call — this only insists that something was.
 */
export const SegmentQuerySchema = z.object({
	by: z.string().min(1),
});

export type SegmentQuery = z.infer<typeof SegmentQuerySchema>;

// ── Download filenames (REQ095) ──────────────────────────────

/**
 * The slug a deck's title is saved under, wherever a file leaves the building.
 *
 * Two surfaces name a download after the same deck — the client saves a
 * presentation as JSON, and the server names the results workbook it streams
 * back (REQ095) — so the rule that turns a title into a filename is one
 * descriptor both compose (ADR-0026), not a transform written once per side of
 * the wire. Two copies is how a deck called "Q3 — Review" eventually saves as
 * `q3-review.omul.json` from one surface and `q3---review-results-….xlsx`
 * from the other.
 *
 * It lives here for the reason every other cross-wire rule in this module does:
 * it is the only module the client already composes server logic from
 * (`src/types.ts` re-exports it), and the slug has no dependency that would tie
 * it to either side — not the DOM the client saves through, and not the
 * workbook writer the server streams.
 *
 * Lower case, single hyphens, none leading or trailing, and capped so a long
 * title cannot produce a filename an operating system refuses. A title that
 * slugs to nothing at all — punctuation only, a non-Latin script, or empty —
 * falls back to `presentation` rather than to the empty string, which would
 * save as a file with no name.
 */
export function deckFilenameSlug(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "presentation"
	);
}
