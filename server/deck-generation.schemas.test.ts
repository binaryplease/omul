/**
 * Unit tests for generating a draft deck from a prompt (REQ007).
 *
 * Covers the generator's pure half and its refusals — no DB, no key, no network,
 * and no provider is ever reached: every case that needs a model hands
 * `createDeckGenerator` a stub, which is the seam that exists for exactly this.
 *
 * Two claims are worth pinning here rather than over HTTP. The first is
 * REQ007's second sentence — **nothing downstream treats generated content as
 * verified** — which in this codebase means one concrete thing: a generated deck
 * never comes back with an answer marked correct. That is a property of every
 * slide a generator can produce, so it is asserted over the whole vocabulary
 * rather than on the one quiz slide a round trip happens to contain. The second
 * is that a **draft becomes ordinary slides**: fully defaulted, individually
 * identified, each type holding only the fields it means. The round trip is in
 * `deck-generation.integration.test.ts`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	createDeckGenerator,
	DeckDraftRequestSchema,
	DECK_GENERATION_ANONYMOUS_ENV,
	DECK_GENERATION_KEY_ENV,
	deckGenerationAllowsAnonymous,
	DEFAULT_DECK_GENERATION_MODEL,
	DECK_GENERATION_MODEL_ENV,
	deckGenerationInstructions,
	deckGenerationModelId,
	draftDeckSlides,
	draftDeckTitle,
	GENERATED_DECK_MAX_SLIDES,
	GENERATED_DECK_MIN_SLIDES,
	GENERATED_SLIDE_TYPES,
	GeneratedDeckSchema,
	GeneratedSlideSchema,
	type GeneratedSlideType,
	isUsableDraftSlide,
	readDeckDraft,
} from "./deck-generator";
import {
	DECK_LANGUAGE_MAX_LENGTH,
	DECK_PROMPT_MAX_LENGTH,
	DECK_TITLE_MAX_LENGTH,
	GenerateDeckSchema,
	POINTS_ITEM_LIMIT,
	RANKING_ITEM_LIMIT,
	SLIDE_ITEM_TEXT_MAX_LENGTH,
	SLIDE_OPTION_LIMIT,
	SLIDE_TEXT_MAX_LENGTH,
	SlideTypeEnum,
	slideHasCorrectAnswers,
} from "./schemas";

/** A drafted slide with everything defaulted, so a case states only its point. */
function drafted(slide: {
	type: GeneratedSlideType;
	question?: string;
	body?: string;
	options?: string[];
	items?: string[];
	scaleMinLabel?: string;
	scaleMaxLabel?: string;
}) {
	return GeneratedSlideSchema.parse(slide);
}

/** A whole draft, from a bare list of slides. */
function draft(slides: Parameters<typeof drafted>[0][], title = "A draft") {
	return GeneratedDeckSchema.parse({ title, slides: slides.map(drafted) });
}

/** One usable slide of every type the generator may author. */
const ONE_OF_EACH_TYPE = GENERATED_SLIDE_TYPES.map((type) =>
	drafted({
		type,
		question: `A ${type} question`,
		body: "Some words",
		options: ["First", "Second", "Third"],
		items: ["Alpha", "Beta", "Gamma"],
		scaleMinLabel: "Low",
		scaleMaxLabel: "High",
	}),
);

const KEY_BEFORE = process.env[DECK_GENERATION_KEY_ENV];
const MODEL_BEFORE = process.env[DECK_GENERATION_MODEL_ENV];
const ANONYMOUS_BEFORE = process.env[DECK_GENERATION_ANONYMOUS_ENV];

/** Put the environment back however a case left it. */
function restoreEnv() {
	if (KEY_BEFORE === undefined) delete process.env[DECK_GENERATION_KEY_ENV];
	else process.env[DECK_GENERATION_KEY_ENV] = KEY_BEFORE;
	if (MODEL_BEFORE === undefined) delete process.env[DECK_GENERATION_MODEL_ENV];
	else process.env[DECK_GENERATION_MODEL_ENV] = MODEL_BEFORE;
	if (ANONYMOUS_BEFORE === undefined) {
		delete process.env[DECK_GENERATION_ANONYMOUS_ENV];
	} else {
		process.env[DECK_GENERATION_ANONYMOUS_ENV] = ANONYMOUS_BEFORE;
	}
}

afterEach(restoreEnv);

describe("REQ007 — what a generator may author", () => {
	test("every generated slide type is a real slide type", () => {
		for (const type of GENERATED_SLIDE_TYPES) {
			expect(SlideTypeEnum.safeParse(type).success).toBe(true);
		}
	});

	test("the media slide types are excluded — a generator has no asset to point at", () => {
		for (const type of ["image", "video", "embed", "pin-image"]) {
			expect(GENERATED_SLIDE_TYPES).not.toContain(type);
		}
	});

	test("the framed slide types are excluded — they need a frame before a question", () => {
		for (const type of ["grid", "guess-number", "form"]) {
			expect(GENERATED_SLIDE_TYPES).not.toContain(type);
		}
	});

	test("the drafted-slide schema has no field that can mark an answer correct", () => {
		// The enforcement of REQ007's draft rule is this absence, not a pass that
		// strips something afterwards — so the absence is what is asserted.
		const fields = Object.keys(GeneratedSlideSchema.shape);
		for (const field of ["isCorrect", "quizAnswers", "guessReference", "pinArea"]) {
			expect(fields).not.toContain(field);
		}
	});

	test("a drafted slide needs only its type — every other field defaults", () => {
		const slide = drafted({ type: "open-text" });
		expect(slide.question).toBe("");
		expect(slide.options).toEqual([]);
		expect(slide.items).toEqual([]);
		expect(slide.body).toBe("");
	});
});

describe("REQ007 — the draft rule: nothing comes back verified", () => {
	test("no generated slide carries a correct answer, on any type", () => {
		const slides = draftDeckSlides(
			GeneratedDeckSchema.parse({ title: "All of them", slides: ONE_OF_EACH_TYPE }),
		);
		expect(slides.length).toBeGreaterThan(0);
		for (const slide of slides) {
			// The product's own single read site for "does this slide have a notion
			// of correctness at all" — asked rather than a field compared, so this
			// stays true if the marking mechanism ever grows.
			expect(slideHasCorrectAnswers(slide)).toBe(false);
			for (const option of slide.options) {
				expect(option.isCorrect).toBeUndefined();
			}
			expect(slide.quizAnswers).toEqual([]);
			expect(slide.guessReference).toBeNull();
			expect(slide.pinArea).toBeNull();
		}
	});

	test("a generated quiz slide is a real quiz slide with an unmarked answer set", () => {
		const [slide] = draftDeckSlides(
			draft([
				{
					type: "quiz",
					question: "Which ocean is the largest?",
					options: ["Pacific", "Atlantic", "Indian", "Arctic"],
				},
			]),
		);
		expect(slide.type).toBe("quiz");
		expect(slide.options.map((option) => option.text)).toEqual([
			"Pacific",
			"Atlantic",
			"Indian",
			"Arctic",
		]);
		expect(slideHasCorrectAnswers(slide)).toBe(false);
	});

	test("the brief tells the model not to mark an answer in prose either", () => {
		const instructions = deckGenerationInstructions("A pub quiz", "en");
		expect(instructions).toContain("Never mark, name or hint at which answer is correct");
	});
});

describe("REQ007 — a draft becomes ordinary slides", () => {
	test("each type is handed only the fields it means", () => {
		const [content, choice, ranking, points, scale, cloud] = draftDeckSlides(
			draft([
				{ type: "text", question: "Welcome", body: "Read this", options: ["Stray"] },
				{ type: "multiple-choice", question: "Pick", options: ["A", "B"], body: "Stray" },
				{ type: "ranking", question: "Order", items: ["A", "B", "C"] },
				{ type: "points", question: "Fund", items: ["A", "B"] },
				{ type: "scale", question: "Rate", scaleMinLabel: "Bad", scaleMaxLabel: "Good" },
				{ type: "word-cloud", question: "One word?", options: ["Stray"], items: ["Stray"] },
			]),
		);
		expect(content.body).toBe("Read this");
		expect(content.options).toEqual([]);
		expect(choice.options.map((option) => option.text)).toEqual(["A", "B"]);
		expect(choice.body).toBe("");
		expect(ranking.rankingItems.map((item) => item.text)).toEqual(["A", "B", "C"]);
		expect(ranking.options).toEqual([]);
		expect(points.pointsItems.map((item) => item.text)).toEqual(["A", "B"]);
		expect(scale.scaleMinLabel).toBe("Bad");
		expect(scale.scaleMaxLabel).toBe("Good");
		expect(cloud.options).toEqual([]);
		expect(cloud.rankingItems).toEqual([]);
	});

	test("every slide and every row is separately identified", () => {
		const slides = draftDeckSlides(
			draft([
				{ type: "multiple-choice", question: "One", options: ["A", "B"] },
				{ type: "multiple-choice", question: "Two", options: ["A", "B"] },
			]),
		);
		const identities = slides.flatMap((slide) => [
			slide.id,
			...slide.options.map((option) => option.id),
		]);
		expect(new Set(identities).size).toBe(identities.length);
		for (const identity of identities) expect(identity).not.toBe("");
	});

	test("slides come back fully defaulted, like any other deck's", () => {
		const [slide] = draftDeckSlides(draft([{ type: "open-text", question: "Ask" }]));
		// The complete shape (ADR-0024/ADR-0029) — a generated slide and an
		// editor-made one are indistinguishable in everything but their words.
		expect(slide.resultsVisibility).toBe("inherit");
		expect(slide.layout).toBe("inherit");
		expect(slide.notes).toBe("");
		expect(slide.backgroundColor).toBe("");
		expect(slide.textSize).toBe("medium");
	});

	test("row text is trimmed and blank rows are dropped", () => {
		const [slide] = draftDeckSlides(
			draft([
				{ type: "multiple-choice", question: "  Pick one  ", options: ["  A  ", "", "   ", "B"] },
			]),
		);
		expect(slide.question).toBe("Pick one");
		expect(slide.options.map((option) => option.text)).toEqual(["A", "B"]);
	});

	test("row counts are cut to what each slide type accepts", () => {
		const many = (count: number) =>
			Array.from({ length: count }, (_, index) => `Row ${index + 1}`);
		const [choice, ranking, points] = draftDeckSlides(
			draft([
				{ type: "multiple-choice", question: "Pick", options: many(SLIDE_OPTION_LIMIT + 5) },
				{ type: "ranking", question: "Order", items: many(RANKING_ITEM_LIMIT + 5) },
				{ type: "points", question: "Fund", items: many(POINTS_ITEM_LIMIT + 5) },
			]),
		);
		expect(choice.options).toHaveLength(SLIDE_OPTION_LIMIT);
		expect(ranking.rankingItems).toHaveLength(RANKING_ITEM_LIMIT);
		expect(points.pointsItems).toHaveLength(POINTS_ITEM_LIMIT);
	});

	test("a deck is cut to the slide ceiling", () => {
		const slides = draftDeckSlides(
			draft(
				Array.from({ length: GENERATED_DECK_MAX_SLIDES + 6 }, (_, index) => ({
					type: "open-text" as const,
					question: `Question ${index + 1}`,
				})),
			),
		);
		expect(slides).toHaveLength(GENERATED_DECK_MAX_SLIDES);
	});
});

describe("REQ007 — what is not a slide is dropped, not repaired", () => {
	test("a slide with no question is dropped", () => {
		expect(isUsableDraftSlide(drafted({ type: "open-text", question: "   " }))).toBe(false);
		expect(draftDeckSlides(draft([{ type: "open-text", question: "" }]))).toEqual([]);
	});

	test("a choice slide with fewer than two options is dropped", () => {
		expect(
			isUsableDraftSlide(drafted({ type: "multiple-choice", question: "Pick", options: ["Only"] })),
		).toBe(false);
		expect(
			isUsableDraftSlide(drafted({ type: "quiz", question: "Pick", options: ["A", "B"] })),
		).toBe(true);
	});

	test("a ranking or points slide with fewer than two items is dropped", () => {
		expect(
			isUsableDraftSlide(drafted({ type: "ranking", question: "Order", items: ["Only"] })),
		).toBe(false);
		expect(
			isUsableDraftSlide(drafted({ type: "points", question: "Fund", items: ["A", "B"] })),
		).toBe(true);
	});

	test("the types that are their question alone need nothing else", () => {
		for (const type of ["word-cloud", "open-text", "leaderboard", "text", "instruction"] as const) {
			expect(isUsableDraftSlide(drafted({ type, question: "Something" }))).toBe(true);
		}
	});

	test("one unusable slide does not take the rest of the deck with it", () => {
		const slides = draftDeckSlides(
			draft([
				{ type: "instruction", question: "Welcome" },
				{ type: "multiple-choice", question: "Broken", options: ["Only one"] },
				{ type: "open-text", question: "What do you think?" },
			]),
		);
		expect(slides.map((slide) => slide.question)).toEqual([
			"Welcome",
			"What do you think?",
		]);
	});
});

describe("REQ007 — the deck's title", () => {
	test("the model's title wins when it named one", () => {
		expect(draftDeckTitle(draft([], "Sprint retro"), "a retro for my team")).toBe(
			"Sprint retro",
		);
	});

	test("the brief stands in when the model named none", () => {
		expect(draftDeckTitle(draft([], "   "), "  a retro for my team  ")).toBe(
			"a retro for my team",
		);
	});

	test("the title is held to the deck title ceiling", () => {
		const long = "x".repeat(DECK_TITLE_MAX_LENGTH + 50);
		expect(draftDeckTitle(draft([], long), "brief")).toHaveLength(
			DECK_TITLE_MAX_LENGTH,
		);
	});
});

describe("REQ007 — the brief handed to the model", () => {
	test("it carries the organizer's prompt and the deck's language", () => {
		const instructions = deckGenerationInstructions("  a retro for my team  ", "de");
		expect(instructions).toContain("a retro for my team");
		expect(instructions).toContain("de");
	});

	test("it states the bounds the write boundary will enforce anyway", () => {
		const instructions = deckGenerationInstructions("anything", "en");
		expect(instructions).toContain(String(GENERATED_DECK_MIN_SLIDES));
		expect(instructions).toContain(String(GENERATED_DECK_MAX_SLIDES));
		expect(instructions).toContain(String(SLIDE_TEXT_MAX_LENGTH));
		expect(instructions).toContain(String(SLIDE_ITEM_TEXT_MAX_LENGTH));
	});
});

describe("REQ007 — the request body", () => {
	test("a prompt is required and is not filled in", () => {
		expect(GenerateDeckSchema.safeParse({}).success).toBe(false);
		expect(GenerateDeckSchema.safeParse({ prompt: "   " }).success).toBe(false);
	});

	test("a prompt past the ceiling is refused", () => {
		const long = "x".repeat(DECK_PROMPT_MAX_LENGTH + 1);
		expect(GenerateDeckSchema.safeParse({ prompt: long }).success).toBe(false);
	});

	test("language defaults exactly as the create's does", () => {
		expect(GenerateDeckSchema.parse({ prompt: "a quiz" }).language).toBe("en");
	});

	test("a language past the ceiling is refused — it is forwarded, so it is bounded", () => {
		// The hole this closes: `prompt` was capped and `language` was not, while
		// *both* are interpolated into the brief sent to the paid provider. An
		// anonymous caller could put 500 KB in the field that had no ceiling and
		// bill the operator for ~125k input tokens on a route whose stated bound is
		// a 500-character brief. A ceiling on one forwarded field is a ceiling on
		// nothing.
		const flood = "x".repeat(500_000);
		expect(
			GenerateDeckSchema.safeParse({ prompt: "hi", language: flood }).success,
		).toBe(false);
		expect(
			GenerateDeckSchema.safeParse({
				prompt: "hi",
				language: "x".repeat(DECK_LANGUAGE_MAX_LENGTH + 1),
			}).success,
		).toBe(false);
	});

	test("every realistic language tag still fits", () => {
		for (const tag of ["en", "de", "pt-BR", "zh-Hant-TW", "sr-Latn-RS-x-private"]) {
			expect(
				GenerateDeckSchema.safeParse({ prompt: "a quiz", language: tag }).success,
			).toBe(true);
		}
	});
});

describe("REQ007 — who may spend the provider budget", () => {
	// The paid path needs a control the abuse limits do not give it:
	// `OMUL_RATE_LIMITS_DISABLED` is documented for "a self-hoster on a trusted
	// network" and takes the disk limiter and the money limiter off together, so
	// an operator can lose the only bound on an anonymous LLM proxy without ever
	// deciding to. The account requirement is that second control, and it ships
	// in its most restrictive setting.

	test("an account is required unless the operator opted out", () => {
		delete process.env[DECK_GENERATION_ANONYMOUS_ENV];
		expect(deckGenerationAllowsAnonymous()).toBe(false);
		process.env[DECK_GENERATION_KEY_ENV] = "a-key";
		expect(createDeckGenerator().availability().requiresAccount).toBe(true);
	});

	test("only the exact string \"true\" opens it", () => {
		for (const value of ["", "1", "TRUE", "yes", "false", " true "]) {
			process.env[DECK_GENERATION_ANONYMOUS_ENV] = value;
			expect(deckGenerationAllowsAnonymous()).toBe(false);
		}
		process.env[DECK_GENERATION_ANONYMOUS_ENV] = "true";
		expect(deckGenerationAllowsAnonymous()).toBe(true);
	});

	test("the opt-out is reported so a surface can say why (ADR-0025)", () => {
		process.env[DECK_GENERATION_KEY_ENV] = "a-key";
		process.env[DECK_GENERATION_ANONYMOUS_ENV] = "true";
		expect(createDeckGenerator().availability().requiresAccount).toBe(false);
	});

	test("the rate-limit switch cannot reach it", () => {
		// The whole point of the second control: turning the abuse limits off is
		// not a way to open the paid route.
		const limitsBefore = process.env.OMUL_RATE_LIMITS_DISABLED;
		process.env.OMUL_RATE_LIMITS_DISABLED = "true";
		delete process.env[DECK_GENERATION_ANONYMOUS_ENV];
		try {
			expect(deckGenerationAllowsAnonymous()).toBe(false);
		} finally {
			if (limitsBefore === undefined) {
				delete process.env.OMUL_RATE_LIMITS_DISABLED;
			} else {
				process.env.OMUL_RATE_LIMITS_DISABLED = limitsBefore;
			}
		}
	});
});

describe("REQ007 — which model this deployment asks", () => {
	test("a floating latest alias stands when the deployment names none (ADR-0009)", () => {
		delete process.env[DECK_GENERATION_MODEL_ENV];
		expect(deckGenerationModelId()).toBe(DEFAULT_DECK_GENERATION_MODEL);
	});

	test("the deployment's own model wins", () => {
		process.env[DECK_GENERATION_MODEL_ENV] = "some-other-model";
		expect(deckGenerationModelId()).toBe("some-other-model");
	});
});

describe("REQ007 — availability fails closed", () => {
	test("no key and no injected model means unavailable, with a reason", () => {
		delete process.env[DECK_GENERATION_KEY_ENV];
		const availability = createDeckGenerator().availability();
		expect(availability.available).toBe(false);
		expect(availability.reason).toBeTypeOf("string");
		expect(availability.reason).not.toBe("");
	});

	test("a configured key makes it available, and the reason is an explicit null", () => {
		process.env[DECK_GENERATION_KEY_ENV] = "a-key";
		const availability = createDeckGenerator().availability();
		expect(availability.available).toBe(true);
		// ADR-0024 — emitted, not omitted, so no client tells "no reason" from
		// "field missing".
		expect(availability.reason).toBeNull();
	});

	test("a whitespace-only key is not a key", () => {
		process.env[DECK_GENERATION_KEY_ENV] = "   ";
		expect(createDeckGenerator().availability().available).toBe(false);
	});

	test("the terms it reports are the ones the generator actually keeps", () => {
		process.env[DECK_GENERATION_KEY_ENV] = "a-key";
		const availability = createDeckGenerator().availability();
		expect(availability.promptMaxLength).toBe(DECK_PROMPT_MAX_LENGTH);
		expect(availability.slideTypes).toEqual([...GENERATED_SLIDE_TYPES]);
	});

	test("an unconfigured generator refuses rather than calling anything", () => {
		delete process.env[DECK_GENERATION_KEY_ENV];
		const generator = createDeckGenerator();
		return generator.generate("a retro", "en").then((result) => {
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refused).toBe("unavailable");
		});
	});
});

describe("REQ007 — the generator over a stub model", () => {
	/** A generator answering with whatever the stub returns. No key, no network. */
	function generatorOver(answer: () => Promise<unknown>) {
		return createDeckGenerator({ model: answer });
	}

	test("a well-formed draft becomes a titled deck of slides", async () => {
		const generator = generatorOver(async () => ({
			title: "Sprint retro",
			slides: [
				{ type: "instruction", question: "Welcome", body: "Anonymous answers." },
				{ type: "scale", question: "How did it go?", scaleMinLabel: "Badly", scaleMaxLabel: "Well" },
				{ type: "open-text", question: "What should we change?" },
			],
		}));
		const result = await generator.generate("a retro for my team", "en");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.title).toBe("Sprint retro");
		expect(result.slides.map((slide) => slide.type)).toEqual([
			"instruction",
			"scale",
			"open-text",
		]);
	});

	test("the stub is handed the organizer's prompt and the deck's language", async () => {
		const seen: { prompt: string; language: string }[] = [];
		const generator = createDeckGenerator({
			model: async (request) => {
				seen.push(request);
				return {
					title: "Ergebnisse",
					slides: [{ type: "open-text", question: "Was denkst du?" }],
				};
			},
		});
		await generator.generate("eine Retro", "de");
		expect(seen).toEqual([{ prompt: "eine Retro", language: "de" }]);
	});

	test("a provider that throws is a stated refusal, not a crash", async () => {
		const generator = generatorOver(async () => {
			throw new Error("upstream exploded");
		});
		const result = await generator.generate("a quiz", "en");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.refused).toBe("provider-failed");
		// The provider's own words stay in the log, not in the answer.
		expect(result.error).not.toContain("upstream exploded");
	});

	test("an answer that is not a deck is refused", async () => {
		const generator = generatorOver(async () => "just some prose");
		const result = await generator.generate("a quiz", "en");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.refused).toBe("unusable-draft");
	});

	test("a draft with nothing usable in it is refused", async () => {
		const generator = generatorOver(async () => ({
			title: "Empty",
			slides: [{ type: "multiple-choice", question: "Pick", options: ["Only one"] }],
		}));
		const result = await generator.generate("a quiz", "en");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.refused).toBe("unusable-draft");
	});

	test("an over-long question is refused rather than truncated or stored", async () => {
		// The generate path creates a deck without a request body passing through
		// `CreatePresentationSchema`, so the authored-text ceiling (REQ159) has to
		// be asked for here — otherwise this would surface as a 500 from the store.
		const generator = generatorOver(async () => ({
			title: "Chatty",
			slides: [{ type: "open-text", question: "x".repeat(SLIDE_TEXT_MAX_LENGTH + 1) }],
		}));
		const result = await generator.generate("a quiz", "en");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.refused).toBe("unusable-draft");
	});

	test("a slide type the generator may not author is dropped", async () => {
		const generator = generatorOver(async () => ({
			title: "Mixed",
			slides: [
				{ type: "image", question: "A picture" },
				{ type: "open-text", question: "What do you think?" },
				{ type: "instruction", question: "Join the session" },
				{ type: "word-cloud", question: "One word?" },
			],
		}));
		const result = await generator.generate("anything", "en");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// The entry naming `image` fails the drafted-slide enum and is dropped on
		// its own — it does not take the slides beside it with it.
		expect(result.slides.map((slide) => slide.type)).toEqual([
			"open-text",
			"instruction",
			"word-cloud",
		]);
	});

	test("a draft that filters down below the floor is refused, not handed over", async () => {
		// The reviewer's scenario: the provider honours the "at least three slides"
		// it was asked for, but one of the three is a choice question whose options
		// are ["Yes", "  "]. `isUsableDraftSlide` drops it on the two-row floor and
		// the organizer would have been handed a two-slide deck — the "question
		// rather than a deck" GENERATED_DECK_MIN_SLIDES exists to refuse, and the
		// state docs/api.md says cannot happen. The floor has to be checked on what
		// survived, not on what was asked for.
		const generator = generatorOver(async () => ({
			title: "Nearly a deck",
			slides: [
				{ type: "instruction", question: "Join the session" },
				{ type: "multiple-choice", question: "Pick one", options: ["Yes", "  "] },
				{ type: "open-text", question: "Anything else?" },
			],
		}));
		const result = await generator.generate("anything", "en");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.refused).toBe("unusable-draft");
	});

	test("a draft of exactly the floor is kept", async () => {
		const generator = generatorOver(async () => ({
			title: "Just enough",
			slides: Array.from({ length: GENERATED_DECK_MIN_SLIDES }, (_, index) => ({
				type: "open-text",
				question: `Question ${index + 1}`,
			})),
		}));
		const result = await generator.generate("anything", "en");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.slides).toHaveLength(GENERATED_DECK_MIN_SLIDES);
	});
});

describe("REQ007 — what the provider is asked for is exact", () => {
	// A regression, and the bug is worth naming: the first cut asked the provider
	// with the *lenient* schema, whose every field carried a `.default(...)`. That
	// converts to a JSON schema with no required properties — so `{ title }` alone
	// satisfied it, and the first live call came back with a two-thousand-character
	// title and no slides at all. Exact in the ask, forgiving in the read.

	/** A slide with every field the provider must fill. */
	const complete = {
		type: "open-text",
		question: "What should we change?",
		body: "",
		options: [],
		items: [],
		scaleMinLabel: "",
		scaleMaxLabel: "",
	};

	const wholeDeck = {
		title: "A retro",
		slides: [complete, complete, complete],
	};

	test("a complete draft is accepted", () => {
		expect(DeckDraftRequestSchema.safeParse(wholeDeck).success).toBe(true);
	});

	test("no field is optional — an empty object satisfies nothing", () => {
		expect(DeckDraftRequestSchema.safeParse({}).success).toBe(false);
		expect(DeckDraftRequestSchema.safeParse({ title: "Only a title" }).success).toBe(
			false,
		);
	});

	test("every slide field is required, so 'not applicable' is stated, not omitted", () => {
		for (const field of Object.keys(complete)) {
			const missing = { ...complete } as Record<string, unknown>;
			delete missing[field];
			expect(
				DeckDraftRequestSchema.safeParse({
					title: "A retro",
					slides: [missing, complete, complete],
				}).success,
			).toBe(false);
		}
	});

	test("the slide list is bounded at both ends", () => {
		const withSlides = (count: number) => ({
			title: "A retro",
			slides: Array.from({ length: count }, () => complete),
		});
		expect(
			DeckDraftRequestSchema.safeParse(withSlides(GENERATED_DECK_MIN_SLIDES - 1))
				.success,
		).toBe(false);
		expect(
			DeckDraftRequestSchema.safeParse(withSlides(GENERATED_DECK_MAX_SLIDES + 1))
				.success,
		).toBe(false);
		expect(
			DeckDraftRequestSchema.safeParse(withSlides(GENERATED_DECK_MIN_SLIDES))
				.success,
		).toBe(true);
	});

	test("the title the runaway arrived in is refused outright", () => {
		expect(
			DeckDraftRequestSchema.safeParse({
				...wholeDeck,
				title: "x".repeat(DECK_TITLE_MAX_LENGTH + 1),
			}).success,
		).toBe(false);
	});

	test("it still has no field that can mark an answer correct", () => {
		const slideFields = Object.keys(
			DeckDraftRequestSchema.shape.slides.element.shape,
		);
		expect(slideFields).not.toContain("isCorrect");
		expect(slideFields.sort()).toEqual(Object.keys(GeneratedSlideSchema.shape).sort());
	});
});

describe("REQ007 — reading back what a model answered", () => {
	test("an answer that is not deck-shaped is no draft at all", () => {
		expect(readDeckDraft("just some prose")).toBeNull();
		expect(readDeckDraft(42)).toBeNull();
		expect(readDeckDraft(null)).toBeNull();
		expect(readDeckDraft({ slides: "not a list" })).toBeNull();
	});

	test("a deck-shaped answer with no slides is a draft with no slides", () => {
		expect(readDeckDraft({ title: "Empty" })).toEqual({ title: "Empty", slides: [] });
	});

	test("one unreadable slide is dropped, and the rest of the draft survives", () => {
		const draftRead = readDeckDraft({
			title: "Mixed",
			slides: [
				{ type: "open-text", question: "Kept" },
				{ type: "not-a-slide-type", question: "Dropped" },
				{ type: "word-cloud", question: 17 },
				{ type: "instruction", question: "Also kept" },
			],
		});
		expect(draftRead?.slides.map((slide) => slide.question)).toEqual([
			"Kept",
			"Also kept",
		]);
	});
});
