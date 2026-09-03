/**
 * Unit tests for the Pin on Image question type (REQ051, REQ052, REQ053).
 *
 * Covers the schema surface, the shared pin codec, and the two derivations the
 * slide type turns on (no DB, no network):
 *   - REQ051 — the "pin-image" slide type is interactive, and a pin round-trips
 *     through one vote value on the image's per-mille lattice
 *   - REQ052 — the interaction area is the slide's `mediaUrl`, resolved in one
 *     place, and a pin slide's media is not the illustration every other
 *     interactive slide's is
 *   - REQ053 — the target area, what counts as inside it, what makes one usable,
 *     and when the audience may be told about it at all
 *
 * The codec and the resolvers are tested here rather than through the API
 * because they are the contract *both* ends share: the participant
 * surface writes the coordinates and the aggregation reads them back.
 */

import { describe, expect, test } from "bun:test";
import {
	decodePinPoint,
	encodePinPoint,
	INTERACTIVE_SLIDE_TYPES,
	isInteractiveSlideType,
	isPinInArea,
	isUsablePinArea,
	PIN_COORDINATE_MAX,
	PinAreaSchema,
	pinAreaFor,
	pinImageFor,
	SlideSchema,
	SlideTypeEnum,
	slideMediaIsInteractionArea,
	solutionVisibleToAudience,
	StoredPresentationSchema,
	withAudienceSolutions,
} from "./schemas";

/** A minimal pin slide with an image and a target area in its middle. */
function pinSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "pn",
		type: "pin-image",
		question: "Where is the aorta?",
		mediaUrl: "https://example.test/heart.png",
		mediaAlt: "Cross-section of a heart",
		pinArea: { x: 400, y: 300, width: 200, height: 150 },
		...overrides,
	});
}

describe("SlideTypeEnum — pin-image (REQ051)", () => {
	test("pin-image is a known slide type", () => {
		expect(SlideTypeEnum.safeParse("pin-image").success).toBe(true);
	});

	test("pin-image is interactive — participants submit to it", () => {
		expect(isInteractiveSlideType("pin-image")).toBe(true);
		expect(INTERACTIVE_SLIDE_TYPES).toContain("pin-image");
	});
});

describe("pinImageFor — the interaction area (REQ052)", () => {
	test("the image is the slide's own media, with its alt text", () => {
		expect(pinImageFor(pinSlide())).toEqual({
			url: "https://example.test/heart.png",
			alt: "Cross-section of a heart",
		});
	});

	test("a field holding only spaces is the absence it looks like", () => {
		expect(pinImageFor({ mediaUrl: "   " }).url).toBe("");
	});

	test("a half-built editor slide with no media at all reads as empty", () => {
		expect(pinImageFor({})).toEqual({ url: "", alt: "" });
	});

	test("only a pin slide's media is its interaction area", () => {
		expect(slideMediaIsInteractionArea("pin-image")).toBe(true);
		// Every other type's media is an illustration beside the question (REQ069)
		// or the whole content of the slide (REQ063) — never something to tap.
		expect(slideMediaIsInteractionArea("image")).toBe(false);
		expect(slideMediaIsInteractionArea("multiple-choice")).toBe(false);
		expect(slideMediaIsInteractionArea("grid")).toBe(false);
	});
});

describe("encodePinPoint / decodePinPoint (REQ051)", () => {
	test("a pin round-trips through a single vote value", () => {
		const value = encodePinPoint({ x: 420, y: 815 });
		expect(value).toBe("420,815");
		expect(decodePinPoint(value)).toEqual({ x: 420, y: 815 });
	});

	test("every corner of the image is on the lattice", () => {
		expect(decodePinPoint("0,0")).toEqual({ x: 0, y: 0 });
		expect(
			decodePinPoint(`${PIN_COORDINATE_MAX},${PIN_COORDINATE_MAX}`),
		).toEqual({ x: PIN_COORDINATE_MAX, y: PIN_COORDINATE_MAX });
	});

	test("tolerates surrounding whitespace from a hand-built submission", () => {
		expect(decodePinPoint(" 12 , 34 ")).toEqual({ x: 12, y: 34 });
	});

	test("rejects a coordinate off the image rather than clamping it", () => {
		expect(decodePinPoint(`${PIN_COORDINATE_MAX + 1},500`)).toBe(null);
		expect(decodePinPoint("500,-1")).toBe(null);
	});

	test("rejects anything that is not two whole numbers", () => {
		expect(decodePinPoint("")).toBe(null);
		expect(decodePinPoint("500")).toBe(null);
		expect(decodePinPoint("1,2,3")).toBe(null);
		expect(decodePinPoint("12.5,30")).toBe(null);
		expect(decodePinPoint("left,30")).toBe(null);
		expect(decodePinPoint("500,")).toBe(null);
	});
});

describe("PinAreaSchema — the target area (REQ053)", () => {
	test("an authored area round-trips", () => {
		expect(pinSlide().pinArea).toEqual({
			x: 400,
			y: 300,
			width: 200,
			height: 150,
		});
	});

	test("no area is the default, and it is not an empty one", () => {
		expect(pinSlide({ pinArea: undefined }).pinArea).toBe(null);
		expect(pinSlide({ pinArea: null }).pinArea).toBe(null);
	});

	test("every corner is required — a partial rectangle is not an area", () => {
		// Defaultless on purpose: a defaulted 0 would assert a target
		// nobody drew.
		expect(PinAreaSchema.safeParse({ x: 10, y: 10, width: 10 }).success).toBe(
			false,
		);
		expect(PinAreaSchema.safeParse({}).success).toBe(false);
	});

	test("a zero-width or fractional area is refused by the schema", () => {
		expect(
			PinAreaSchema.safeParse({ x: 0, y: 0, width: 0, height: 10 }).success,
		).toBe(false);
		expect(
			PinAreaSchema.safeParse({ x: 0, y: 0, width: 10.5, height: 10 }).success,
		).toBe(false);
	});

	test("a stored deck authored before pin slides existed re-parses forward", () => {
		const stored = StoredPresentationSchema.parse({
			id: "p1",
			slides: [{ id: "s1", type: "word-cloud", question: "Describe today" }],
		});
		expect(stored.slides[0].pinArea).toBe(null);
		expect(stored.slides[0].mediaUrl).toBe("");
	});
});

describe("isUsablePinArea / pinAreaFor (REQ053)", () => {
	test("an area wholly on the image is usable", () => {
		expect(isUsablePinArea({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
		expect(
			isUsablePinArea({
				x: 0,
				y: 0,
				width: PIN_COORDINATE_MAX,
				height: PIN_COORDINATE_MAX,
			}),
		).toBe(true);
	});

	test("an area running off the image is not usable", () => {
		// Part of it is a region no participant can reach, which would make "how
		// many were inside?" a number about the picture rather than the room.
		expect(isUsablePinArea({ x: 900, y: 0, width: 200, height: 100 })).toBe(
			false,
		);
		expect(isUsablePinArea({ x: 0, y: 950, width: 100, height: 100 })).toBe(
			false,
		);
	});

	test("pinAreaFor reads an unusable area as no area at all", () => {
		// One shape for "this question has no correct area", whatever produced it:
		// an author who set none, and a hand-built deck with a target off the edge.
		expect(pinAreaFor({ pinArea: { x: 900, y: 0, width: 200, height: 50 } })).toBe(
			null,
		);
		expect(pinAreaFor({ pinArea: { x: 10, y: 10 } })).toBe(null);
		expect(pinAreaFor({})).toBe(null);
	});

	test("pinAreaFor resolves an authored area for a half-built editor slide", () => {
		expect(pinAreaFor({ pinArea: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({
			x: 1,
			y: 2,
			width: 3,
			height: 4,
		});
	});
});

describe("isPinInArea — did the pin hit the target (REQ053)", () => {
	const area = { x: 400, y: 300, width: 200, height: 150 };

	test("a pin inside the rectangle counts", () => {
		expect(isPinInArea({ x: 500, y: 380 }, area)).toBe(true);
	});

	test("every edge is inclusive — the line the organizer drew is on the target", () => {
		expect(isPinInArea({ x: 400, y: 300 }, area)).toBe(true);
		expect(isPinInArea({ x: 600, y: 450 }, area)).toBe(true);
		expect(isPinInArea({ x: 400, y: 450 }, area)).toBe(true);
	});

	test("a pin outside any edge misses", () => {
		expect(isPinInArea({ x: 399, y: 380 }, area)).toBe(false);
		expect(isPinInArea({ x: 601, y: 380 }, area)).toBe(false);
		expect(isPinInArea({ x: 500, y: 299 }, area)).toBe(false);
		expect(isPinInArea({ x: 500, y: 451 }, area)).toBe(false);
	});
});

describe("who may see the target area (REQ053, REQ102)", () => {
	const deck = (overrides: Record<string, unknown> = {}) => ({
		status: "live",
		resultsVisibility: "instant" as const,
		revealedSlideIds: [] as string[],
		slideStartedAt: {},
		...overrides,
	});

	test("instant results show the target from the start", () => {
		// The room is already watching the tally drawn over the target, so
		// withholding the target while showing the aggregate would be incoherent.
		expect(solutionVisibleToAudience(pinSlide(), deck(), Date.now())).toBe(true);
	});

	test("on-click keeps it back until the presenter reveals the slide", () => {
		const slide = pinSlide({ resultsVisibility: "on-click" });
		expect(solutionVisibleToAudience(slide, deck(), Date.now())).toBe(false);
		expect(
			solutionVisibleToAudience(
				slide,
				deck({ revealedSlideIds: ["pn"] }),
				Date.now(),
			),
		).toBe(true);
	});

	test("a deck defaulted to on-click withholds a slide that inherits it", () => {
		expect(
			solutionVisibleToAudience(
				pinSlide(),
				deck({ resultsVisibility: "on-click" }),
				Date.now(),
			),
		).toBe(false);
	});

	test("an ended deck reveals what was only waiting on a click", () => {
		expect(
			solutionVisibleToAudience(
				pinSlide({ resultsVisibility: "on-click" }),
				deck({ status: "ended" }),
				Date.now(),
			),
		).toBe(true);
	});

	test("private never shows it — not even once the deck has ended", () => {
		// "Never on screen" is the whole content of that setting, so ending the
		// session is not a reveal.
		const slide = pinSlide({ resultsVisibility: "private" });
		expect(solutionVisibleToAudience(slide, deck(), Date.now())).toBe(false);
		expect(
			solutionVisibleToAudience(slide, deck({ status: "ended" }), Date.now()),
		).toBe(false);
	});

	test("withAudienceSolutions strips a withheld target from the deck payload", () => {
		const slide = pinSlide({ resultsVisibility: "on-click" });
		const [audience] = withAudienceSolutions([slide], deck(), Date.now());
		// Withheld as `null`, which is exactly what a slide that named no area
		// carries — so a client cannot tell that a target exists at all.
		expect(audience.pinArea).toBe(null);
	});

	test("withAudienceSolutions leaves a revealed target in place", () => {
		const slide = pinSlide({ resultsVisibility: "on-click" });
		const [audience] = withAudienceSolutions(
			[slide],
			deck({ revealedSlideIds: ["pn"] }),
			Date.now(),
		);
		expect(audience.pinArea).toEqual({
			x: 400,
			y: 300,
			width: 200,
			height: 150,
		});
	});

	test("a quiz slide's own gate is untouched by any of this", () => {
		// Regression guard: the pin branch is read before the quiz branch, so a
		// quiz question that has not opened must still withhold its answer key.
		const quiz = SlideSchema.parse({
			id: "qz",
			type: "quiz",
			question: "Capital of France?",
			options: [{ id: "a", text: "Paris", isCorrect: true }],
			timeLimit: 30,
		});
		expect(solutionVisibleToAudience(quiz, deck(), Date.now())).toBe(false);
	});
});
