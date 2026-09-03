/**
 * Unit tests for server/schemas.ts.
 *
 * Covers the additions made in task/0004-p0-requirements:
 *   - new slide types (text, image, instruction)
 *   - isInteractiveSlideType / INTERACTIVE_SLIDE_TYPES
 *   - media fields (mediaUrl, mediaAlt)
 *   - resultsVisibility (REQ102)
 *   - presentation language + mode (REQ084, REQ003/REQ082)
 *
 * These are pure schema tests — they exercise Zod parsing and don't touch
 * the database or the network.
 */

import { describe, expect, test } from "bun:test";
import {
	CreatePresentationSchema,
	effectiveResultsVisibility,
	INTERACTIVE_SLIDE_TYPES,
	isInteractiveSlideType,
	maxResponsesFor,
	PresentationSchema,
	SCALE_LABEL_LIMIT,
	type Slide,
	SLIDE_ITEM_TEXT_MAX_LENGTH,
	SLIDE_LIMIT,
	SLIDE_MEDIA_URL_MAX_LENGTH,
	SLIDE_OPTION_LIMIT,
	SLIDE_TEXT_MAX_LENGTH,
	SlideInputSchema,
	SlideSchema,
	slideWriteRefusalFor,
	type SlideType,
	SlideTypeEnum,
	UNWRITABLE_PRESENTATION_FIELDS,
	UpdatePresentationSchema,
	withoutUnwritableFields,
} from "./schemas";

describe("SlideTypeEnum", () => {
	test("accepts the five original interactive types", () => {
		for (const t of [
			"multiple-choice",
			"word-cloud",
			"open-text",
			"scale",
			"quiz",
		]) {
			expect(SlideTypeEnum.safeParse(t).success).toBe(true);
		}
	});

	test("accepts the ranking slide type (REQ033)", () => {
		expect(SlideTypeEnum.safeParse("ranking").success).toBe(true);
	});

	test("accepts the 2x2 grid slide type (REQ046)", () => {
		expect(SlideTypeEnum.safeParse("grid").success).toBe(true);
	});

	test("accepts the 100 Points slide type (REQ044)", () => {
		expect(SlideTypeEnum.safeParse("points").success).toBe(true);
	});

	test("accepts the Guess the Number slide type (REQ039)", () => {
		expect(SlideTypeEnum.safeParse("guess-number").success).toBe(true);
	});

	test("accepts the content slide types (REQ062/063/064/065)", () => {
		for (const t of ["text", "image", "video", "instruction"]) {
			expect(SlideTypeEnum.safeParse(t).success).toBe(true);
		}
	});

	test("rejects unknown slide types", () => {
		expect(SlideTypeEnum.safeParse("audio").success).toBe(false);
		expect(SlideTypeEnum.safeParse("").success).toBe(false);
	});
});

describe("isInteractiveSlideType", () => {
	test("returns true for each interactive type", () => {
		for (const t of INTERACTIVE_SLIDE_TYPES) {
			expect(isInteractiveSlideType(t)).toBe(true);
		}
	});

	test("returns false for content slide types", () => {
		expect(isInteractiveSlideType("text")).toBe(false);
		expect(isInteractiveSlideType("image")).toBe(false);
		expect(isInteractiveSlideType("video")).toBe(false);
		expect(isInteractiveSlideType("instruction")).toBe(false);
	});

	test("INTERACTIVE_SLIDE_TYPES has exactly the expected entries", () => {
		expect([...INTERACTIVE_SLIDE_TYPES].sort()).toEqual(
			(
				[
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
				] as SlideType[]
			).sort(),
		);
	});
});

describe("maxResponsesFor (REQ022/REQ026)", () => {
	test("an explicit cap wins, 0 meaning unlimited", () => {
		expect(maxResponsesFor({ maxResponses: 3 })).toBe(3);
		expect(maxResponsesFor({ maxResponses: 0, allowMultiple: false })).toBe(0);
	});

	test("a legacy slide resolves through allowMultiple", () => {
		// A slide authored before `maxResponses` existed spells "unlimited" as
		// `allowMultiple: true` and nothing else. Every reader — the boundary
		// that enforces the cap, the phone that counts against it, the editor's
		// departure marker (REQ155) — must resolve it the same way, which is why
		// this is one function rather than a fallback each spells for itself.
		expect(maxResponsesFor({ allowMultiple: true })).toBe(0);
		expect(maxResponsesFor({ allowMultiple: false })).toBe(1);
		expect(maxResponsesFor({})).toBe(1);
	});
});

describe("SlideSchema", () => {
	test("parses a minimal multiple-choice slide with defaults applied", () => {
		const slide = SlideSchema.parse({
			id: "s1",
			type: "multiple-choice",
			question: "Pick one",
			options: [{ id: "a", text: "A" }],
		});
		expect(slide.scaleMin).toBe(1);
		expect(slide.scaleMax).toBe(5);
		expect(slide.scaleMinLabel).toBe("");
		expect(slide.scaleMaxLabel).toBe("");
		expect(slide.timeLimit).toBe(30);
		expect(slide.allowMultiple).toBe(false);
		// REQ046–REQ050 defaults — a slide of any type carries an empty grid
		// item list, both axes on their 0–10 range, and skipping off.
		expect(slide.gridItems).toEqual([]);
		expect(slide.gridXAxis).toEqual({
			title: "",
			min: 0,
			max: 10,
			minLabel: "",
			maxLabel: "",
		});
		expect(slide.gridYAxis.max).toBe(10);
		expect(slide.gridAllowSkip).toBe(false);
		// REQ044/REQ045 default — a slide of any type carries an empty 100
		// Points item list, so a deck authored before the type existed re-parses
		// forward without a migration.
		expect(slide.pointsItems).toEqual([]);
		// REQ039–REQ042 defaults — a slide of any type carries the 0–100 guess
		// frame in steps of 1, and no reference number: a slide whose author never
		// named a correct answer has no notion of correctness at all (REQ041).
		expect(slide.guessRange).toEqual({ min: 0, max: 100, step: 1 });
		expect(slide.guessReference).toBe(null);
		// REQ102 default — a slide inherits the deck-level visibility default
		expect(slide.resultsVisibility).toBe("inherit");
	});

	test("accepts media attachment fields (REQ069)", () => {
		const slide = SlideSchema.parse({
			id: "s-media",
			type: "word-cloud",
			question: "Describe",
			mediaUrl: "https://example.com/img.gif",
			mediaAlt: "An animated gif",
		});
		expect(slide.mediaUrl).toBe("https://example.com/img.gif");
		expect(slide.mediaAlt).toBe("An animated gif");
	});

	test("accepts content slide (text type) with body (REQ062)", () => {
		const slide: Slide = SlideSchema.parse({
			id: "c1",
			type: "text",
			question: "Intro",
			body: "Welcome to the session.",
		});
		expect(slide.type).toBe("text");
		expect(slide.body).toBe("Welcome to the session.");
	});

	test("accepts image content slide with mediaUrl (REQ063)", () => {
		const slide = SlideSchema.parse({
			id: "c2",
			type: "image",
			question: "",
			mediaUrl: "https://example.com/x.jpg",
		});
		expect(slide.type).toBe("image");
	});

	test("accepts video content slide with mediaUrl (REQ064)", () => {
		const slide = SlideSchema.parse({
			id: "c2v",
			type: "video",
			question: "",
			mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		});
		expect(slide.type).toBe("video");
		expect(slide.mediaUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
	});

	test("accepts instruction slide with body (REQ065/REQ118)", () => {
		const slide = SlideSchema.parse({
			id: "c3",
			type: "instruction",
			question: "How to join",
			body: "Go to omul.app and enter the code.",
		});
		expect(slide.type).toBe("instruction");
	});

	test("accepts all four slide resultsVisibility values (REQ102)", () => {
		for (const v of ["inherit", "instant", "on-click", "private"] as const) {
			const slide = SlideSchema.parse({
				id: "s",
				type: "multiple-choice",
				question: "Q",
				resultsVisibility: v,
			});
			expect(slide.resultsVisibility).toBe(v);
		}
	});

	test("rejects unknown resultsVisibility values", () => {
		const result = SlideSchema.safeParse({
			id: "s",
			type: "multiple-choice",
			question: "Q",
			resultsVisibility: "sometimes",
		});
		expect(result.success).toBe(false);
	});
});

describe("resultsVisibility deck default + override (REQ102)", () => {
	test("presentation defaults resultsVisibility to instant", () => {
		const pres = PresentationSchema.parse({
			id: "p",
			code: "123456",
			title: "T",
			slides: [],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(pres.resultsVisibility).toBe("instant");
	});

	test("create schema accepts a deck-level resultsVisibility", () => {
		const created = CreatePresentationSchema.parse({
			title: "T",
			slides: [{ id: "s", type: "multiple-choice", question: "Q" }],
			resultsVisibility: "on-click",
		});
		expect(created.resultsVisibility).toBe("on-click");
	});

	test("effectiveResultsVisibility falls back to the deck default when inheriting", () => {
		expect(effectiveResultsVisibility("inherit", "on-click")).toBe("on-click");
		expect(effectiveResultsVisibility(undefined, "private")).toBe("private");
	});

	test("effectiveResultsVisibility uses the slide override when set", () => {
		expect(effectiveResultsVisibility("private", "instant")).toBe("private");
		expect(effectiveResultsVisibility("instant", "on-click")).toBe("instant");
	});
});

describe("CreatePresentationSchema", () => {
	const minimalSlide = {
		id: "s1",
		type: "multiple-choice",
		question: "Pick one",
	};

	test("applies default language 'en' and mode 'live'", () => {
		const pres = CreatePresentationSchema.parse({
			title: "Hello",
			slides: [minimalSlide],
		});
		expect(pres.language).toBe("en");
		expect(pres.mode).toBe("live");
	});

	test("accepts explicit language (REQ084)", () => {
		const pres = CreatePresentationSchema.parse({
			title: "Hallo",
			slides: [minimalSlide],
			language: "de",
		});
		expect(pres.language).toBe("de");
	});

	test("accepts mode: 'survey' (REQ003/REQ082)", () => {
		const pres = CreatePresentationSchema.parse({
			title: "Async",
			slides: [minimalSlide],
			mode: "survey",
		});
		expect(pres.mode).toBe("survey");
	});

	test("rejects an empty slides array", () => {
		const result = CreatePresentationSchema.safeParse({
			title: "Empty",
			slides: [],
		});
		expect(result.success).toBe(false);
	});

	test("rejects an empty title", () => {
		const result = CreatePresentationSchema.safeParse({
			title: "",
			slides: [minimalSlide],
		});
		expect(result.success).toBe(false);
	});

	test("rejects unknown mode", () => {
		const result = CreatePresentationSchema.safeParse({
			title: "x",
			slides: [minimalSlide],
			mode: "async",
		});
		expect(result.success).toBe(false);
	});
});

describe("PresentationSchema", () => {
	test("defaults revealedSlideIds to an empty array (REQ102)", () => {
		const pres = PresentationSchema.parse({
			id: "p1",
			code: "123456",
			title: "T",
			slides: [],
			createdAt: new Date().toISOString(),
		});
		expect(pres.revealedSlideIds).toEqual([]);
		expect(pres.status).toBe("draft");
		expect(pres.activeSlideIndex).toBe(0);
		expect(pres.language).toBe("en");
		expect(pres.mode).toBe("live");
	});

	test("preserves revealedSlideIds when provided", () => {
		const pres = PresentationSchema.parse({
			id: "p1",
			code: "123456",
			title: "T",
			slides: [],
			revealedSlideIds: ["s1", "s2"],
			createdAt: new Date().toISOString(),
		});
		expect(pres.revealedSlideIds).toEqual(["s1", "s2"]);
	});
});

describe("UpdatePresentationSchema — what a PATCH may write", () => {
	test("carries only the keys the request named — no defaults", () => {
		// `updatePresentation` broadcasts on `"qaEnabled" in changes`, so a default
		// would turn a title change into a claim about the Q&A layer the request
		// never mentioned. This is why the schema inverts the defaults rule.
		const patch = UpdatePresentationSchema.parse({ title: "Renamed" });
		expect(Object.keys(patch)).toEqual(["title"]);
	});

	test("drops the deck's credentials rather than merging them", () => {
		// The escalation this schema exists to close: `StoredPresentationSchema`
		// declares these, so a patch that named one would be merged into the stored
		// document and rewrite what the caller's own authorization is resolved from.
		const patch = UpdatePresentationSchema.parse({
			title: "Renamed",
			creatorId: "someone-else",
			creatorTokenHash: "a".repeat(64),
			resultsTokenHash: "b".repeat(64),
			resultsTokenIssuedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(patch).toEqual({ title: "Renamed" });
	});

	test("drops server-managed state, which has routes of its own", () => {
		const patch = UpdatePresentationSchema.parse({
			status: "live",
			activeSlideIndex: 7,
			revealedSlideIds: ["s1"],
			slideStartedAt: { s1: "2026-01-01T00:00:00.000Z" },
			code: "000000",
		});
		expect(patch).toEqual({});
	});

	test("still validates the authored fields it does accept", () => {
		expect(() => UpdatePresentationSchema.parse({ mode: "broadcast" })).toThrow();
		expect(() =>
			UpdatePresentationSchema.parse({ resultsVisibility: "sometimes" }),
		).toThrow();
		expect(UpdatePresentationSchema.parse({ mode: "survey" }).mode).toBe("survey");
	});
});

describe("REQ159 — what a deck may be written with, and how much of it", () => {
	// The defect these close: the PDF export re-draws a slide's authored text,
	// measuring and breaking every run it is handed. With `slides` and the
	// authored strings on each of them uncapped, one `PATCH` could hand that
	// renderer an unbounded amount of work — on a route a caller self-issues a
	// credential for, on a runtime that answers every other request from the same
	// thread. The cost per character is linear again (`server/deck-pdf.ts`);
	// these are what make the number of characters finite.
	const slideOf = (fields: Record<string, unknown>) => ({
		id: "s1",
		type: "text",
		question: "Pick one",
		...fields,
	});
	const deckOf = (fields: Record<string, unknown>) => ({
		title: "Deck",
		slides: [slideOf(fields)],
	});

	test("a question at the ceiling is written; one past it is refused", () => {
		expect(
			CreatePresentationSchema.safeParse(
				deckOf({ question: "x".repeat(SLIDE_TEXT_MAX_LENGTH) }),
			).success,
		).toBe(true);
		expect(
			CreatePresentationSchema.safeParse(
				deckOf({ question: "x".repeat(SLIDE_TEXT_MAX_LENGTH + 1) }),
			).success,
		).toBe(false);
	});

	test("a body is held to the same ceiling as a question", () => {
		expect(
			CreatePresentationSchema.safeParse(
				deckOf({ body: "x".repeat(SLIDE_TEXT_MAX_LENGTH) }),
			).success,
		).toBe(true);
		expect(
			CreatePresentationSchema.safeParse(
				deckOf({ body: "x".repeat(SLIDE_TEXT_MAX_LENGTH + 1) }),
			).success,
		).toBe(false);
	});

	test("a mediaUrl is held to what a URL is, not to what prose is", () => {
		expect(
			CreatePresentationSchema.safeParse(
				deckOf({ mediaUrl: `https://example.com/${"p".repeat(2_000)}` }),
			).success,
		).toBe(true);
		expect(
			CreatePresentationSchema.safeParse(
				deckOf({ mediaUrl: "u".repeat(SLIDE_MEDIA_URL_MAX_LENGTH + 1) }),
			).success,
		).toBe(false);
		// Prose's allowance is the wrong one to borrow here — it is more than
		// double, and an address that long is not one anything would fetch.
		expect(SLIDE_MEDIA_URL_MAX_LENGTH).toBeLessThan(SLIDE_TEXT_MAX_LENGTH);
	});

	test("a deck at the slide ceiling is written; one past it is refused", () => {
		const slides = (count: number) =>
			Array.from({ length: count }, (_unused, index) => ({
				id: `s${index}`,
				type: "text",
				question: "Pick one",
			}));
		expect(
			CreatePresentationSchema.safeParse({
				title: "Deck",
				slides: slides(SLIDE_LIMIT),
			}).success,
		).toBe(true);
		expect(
			CreatePresentationSchema.safeParse({
				title: "Deck",
				slides: slides(SLIDE_LIMIT + 1),
			}).success,
		).toBe(false);
	});

	test("a PATCH is held to every one of them, exactly as a create is", () => {
		// The door that matters: a create is rate-limited per address and this is
		// not, so a bound only the create enforced would bound nothing.
		expect(
			UpdatePresentationSchema.safeParse({
				slides: [slideOf({ question: "x".repeat(SLIDE_TEXT_MAX_LENGTH + 1) })],
			}).success,
		).toBe(false);
		expect(
			UpdatePresentationSchema.safeParse({
				slides: [slideOf({ body: "x".repeat(SLIDE_TEXT_MAX_LENGTH + 1) })],
			}).success,
		).toBe(false);
		expect(
			UpdatePresentationSchema.safeParse({
				slides: [slideOf({ mediaUrl: "u".repeat(SLIDE_MEDIA_URL_MAX_LENGTH + 1) })],
			}).success,
		).toBe(false);
		expect(
			UpdatePresentationSchema.safeParse({
				slides: Array.from({ length: SLIDE_LIMIT + 1 }, (_unused, index) => ({
					id: `s${index}`,
					type: "text",
					question: "Pick one",
				})),
			}).success,
		).toBe(false);
		expect(
			UpdatePresentationSchema.safeParse({ slides: [slideOf({})] }).success,
		).toBe(true);
	});

	test("a slide already stored past the ceiling still reads back", () => {
		// Why the caps live on the input schemas and not on `SlideSchema`: that one
		// is also what every stored deck is re-parsed through on the way out of the
		// document store. Tightening it would not shorten one oversized field
		// already on disk — it would make the deck holding it unreadable, and
		// answer a denial-of-service defect by denying service. The bound belongs
		// where the bytes arrive.
		const stored = PresentationSchema.safeParse({
			id: "p1",
			code: "123456",
			title: "Written before the ceiling existed",
			slides: [
				{
					id: "s1",
					type: "text",
					question: "x".repeat(SLIDE_TEXT_MAX_LENGTH * 3),
					body: "y".repeat(SLIDE_TEXT_MAX_LENGTH * 3),
					mediaUrl: `https://example.com/${"p".repeat(SLIDE_MEDIA_URL_MAX_LENGTH)}`,
				},
			],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(stored.success).toBe(true);
	});

	test("an option's text is bounded, and so is the list holding it", () => {
		// The exploit the first cut of REQ159 left open: `options` was the one
		// authored list on a slide with neither a count cap nor a text cap, and the
		// export draws it through the same wrapper `question` goes through. The
		// published attack payload worked verbatim with one word changed —
		// `question` for `options[0].text` — and bought ~60s of wedged event loop
		// from a 64 MB body, or 16s from 20,000 options of 1,000 characters.
		expect(
			UpdatePresentationSchema.safeParse({
				slides: [
					slideOf({ options: [{ id: "a", text: "W".repeat(1_000_000) }] }),
				],
			}).success,
		).toBe(false);
		expect(
			UpdatePresentationSchema.safeParse({
				slides: [
					slideOf({
						options: Array.from({ length: 20_000 }, (_unused, index) => ({
							id: `o${index}`,
							text: "W".repeat(1_000),
						})),
					}),
				],
			}).success,
		).toBe(false);
		// And a poll with a few dozen ordinary choices is still a poll.
		expect(
			UpdatePresentationSchema.safeParse({
				slides: [
					slideOf({
						options: Array.from({ length: SLIDE_OPTION_LIMIT }, (_unused, index) => ({
							id: `o${index}`,
							text: "W".repeat(SLIDE_ITEM_TEXT_MAX_LENGTH),
						})),
					}),
				],
			}).success,
		).toBe(true);
	});

	test("every authored row the export draws is bounded, not just an option's", () => {
		// A ceiling on some of them bounds nothing — the attacker moves one word of
		// the payload to whichever field was left plain. Each entry here is a string
		// `questionBlocksFor` puts through `wrapLine`, so each is the same defect.
		const oversized = "W".repeat(SLIDE_ITEM_TEXT_MAX_LENGTH + 1);
		const drawnRows: Array<[string, Record<string, unknown>]> = [
			["ranking item", { rankingItems: [{ id: "r", text: oversized }] }],
			["points item", { pointsItems: [{ id: "p", text: oversized }] }],
			["grid item", { gridItems: [{ id: "g", text: oversized }] }],
			["scale statement", { scaleStatements: [{ id: "s", text: oversized }] }],
			["quiz answer", { quizAnswers: [{ id: "q", text: oversized }] }],
			["form field label", { formFields: [{ id: "f", label: oversized }] }],
			[
				"form field choice",
				{
					formFields: [
						{ id: "f", label: "L", type: "choice", options: [{ id: "o", text: oversized }] },
					],
				},
			],
			["scale end label", { scaleMaxLabel: oversized }],
			["grid axis title", { gridXAxis: { title: oversized } }],
			["media alt", { mediaAlt: oversized }],
		];
		for (const [name, fields] of drawnRows) {
			const refused = UpdatePresentationSchema.safeParse({
				slides: [slideOf(fields)],
			});
			expect(`${name}: ${refused.success}`).toBe(`${name}: false`);
		}
	});

	test("the two lists that carried no ceiling at all now carry one", () => {
		// `options` and `scaleLabels` were the only authored arrays on a slide with
		// no `.max()`; every other one already had a count cap. An unbounded array
		// of bounded strings is still an unbounded slide.
		expect(
			UpdatePresentationSchema.safeParse({
				slides: [
					slideOf({
						scaleLabels: Array.from({ length: SCALE_LABEL_LIMIT + 1 }, (_unused, index) => ({
							value: index,
							label: "x",
						})),
					}),
				],
			}).success,
		).toBe(false);
		expect(
			UpdatePresentationSchema.safeParse({
				slides: [
					slideOf({
						options: Array.from({ length: SLIDE_OPTION_LIMIT + 1 }, (_unused, index) => ({
							id: `o${index}`,
							text: "x",
						})),
					}),
				],
			}).success,
		).toBe(false);
	});

	test("a slide stored above the row ceilings still reads back too", () => {
		// The same promise the question/body case makes, extended to the rows: a
		// deck already on disk with a long option label stays readable. Answering a
		// denial-of-service defect by denying service would be the wrong trade at
		// any one of these fields, not just the three the first cut capped.
		const stored = PresentationSchema.safeParse({
			id: "p1",
			code: "123456",
			title: "Written before the ceilings existed",
			slides: [
				{
					id: "s1",
					type: "multiple-choice",
					question: "Pick one",
					options: Array.from({ length: SLIDE_OPTION_LIMIT * 4 }, (_unused, index) => ({
						id: `o${index}`,
						text: "W".repeat(SLIDE_ITEM_TEXT_MAX_LENGTH * 4),
					})),
				},
			],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(stored.success).toBe(true);
	});

	test("SlideInputSchema is SlideSchema, defaults and all — not a second copy", () => {
		// Extended rather than restated: a field added to a slide is
		// writable the moment it exists, and every default the stored shape
		// declares still lands here.
		const asInput = SlideInputSchema.parse({
			id: "s1",
			type: "multiple-choice",
			question: "Pick one",
		});
		const asStored = SlideSchema.parse({
			id: "s1",
			type: "multiple-choice",
			question: "Pick one",
		});
		expect(asInput).toEqual(asStored);
	});

	test("slideWriteRefusalFor names the slide and the field the boundary would refuse", () => {
		// The boundary's own refusal is a 422 naming a JSON path — right for the
		// caller the caps defend against, useless for an author mid-edit. This is
		// the reading the editor gives them instead, and the only way back for a
		// deck stored before a cap existed: it still reads, but no save of it
		// lands until the author is told which field to trim.
		const fits = { id: "s1", type: "text", question: "Pick one" };
		expect(slideWriteRefusalFor([fits])).toBeNull();

		const oversized = {
			id: "s2",
			type: "text",
			question: "Pick one",
			notes: "x".repeat(SLIDE_TEXT_MAX_LENGTH + 1),
		};
		const refusal = slideWriteRefusalFor([fits, oversized]);
		expect(refusal).not.toBeNull();
		expect(refusal?.slideIndex).toBe(1);
		expect(refusal?.message).toContain("Slide 2");
		expect(refusal?.message).toContain("notes");

		const nested = {
			id: "s3",
			type: "multiple-choice",
			question: "Pick one",
			options: [
				{ id: "o1", text: "fine" },
				{ id: "o2", text: "W".repeat(SLIDE_ITEM_TEXT_MAX_LENGTH + 1) },
			],
		};
		const nestedRefusal = slideWriteRefusalFor([nested]);
		expect(nestedRefusal?.slideIndex).toBe(0);
		expect(nestedRefusal?.message).toContain("options.1.text");
	});

	test("slideWriteRefusalFor refuses the whole list past the slide ceiling", () => {
		const slides = Array.from({ length: SLIDE_LIMIT + 1 }, (_unused, index) => ({
			id: `s${index}`,
			type: "text",
			question: "Pick one",
		}));
		const refusal = slideWriteRefusalFor(slides);
		expect(refusal?.slideIndex).toBeNull();
		expect(refusal?.message).toContain(String(SLIDE_LIMIT));
	});
});

describe("withoutUnwritableFields — the second lock on the same door", () => {
	test("strips every credential-bearing field and keeps the rest", () => {
		const changes = withoutUnwritableFields({
			title: "Renamed",
			creatorId: "someone-else",
			creatorTokenHash: "a".repeat(64),
			resultsTokenHash: "b".repeat(64),
			resultsTokenIssuedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(changes).toEqual({ title: "Renamed" });
	});

	test("names every one of them, so neither lock can drift from the other", () => {
		// `workspaceId` (REQ128) is the one on this list that names no secret, and
		// it belongs here all the same: the caller's own standing on a workspace
		// deck is resolved from their role in the workspace it names, so a body that
		// could write it could move any deck its sender can edit into a workspace
		// they administer.
		expect([...UNWRITABLE_PRESENTATION_FIELDS]).toEqual([
			"creatorId",
			"creatorTokenHash",
			"resultsTokenHash",
			"resultsTokenIssuedAt",
			"workspaceId",
		]);
		for (const field of UNWRITABLE_PRESENTATION_FIELDS) {
			expect(withoutUnwritableFields({ [field]: "x" })).toEqual({});
		}
	});

	test("a patch that names none of them is passed through untouched", () => {
		const changes = { title: "T", qaEnabled: true, slides: [] };
		expect(withoutUnwritableFields(changes)).toEqual(changes);
	});
});
