/**
 * Unit tests for presenter notes (REQ090) — the schema surface and the
 * projection that keeps a note off everybody else's screen (no DB, no network).
 *
 * The projection is tested here rather than only through the API because it is
 * the contract both ends share: the server empties a note on the way
 * out, and the preview page re-projects the deck it already holds through the
 * very same function to draw its participant pane. If the two ever disagreed,
 * the dry run would be rehearsing a phone no participant will ever hold.
 *
 * The integration half — that the empty field is what actually lands in each
 * response, broadcast and export — lives in `notes.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	SlideSchema,
	StoredPresentationSchema,
	withAudienceSlides,
	withAudienceSolutions,
	withoutPresenterNotes,
} from "./schemas";

const NOTE = "Pause here. **Ask the room** before advancing.";

/** A slide carrying a presenter note. */
function notedSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "s1",
		type: "multiple-choice",
		question: "Which release train?",
		options: [
			{ id: "a", text: "Weekly" },
			{ id: "b", text: "Monthly" },
		],
		notes: NOTE,
		...overrides,
	});
}

/** A deck state to project against: live, nothing revealed, no question opened. */
function deck(overrides: Record<string, unknown> = {}) {
	return StoredPresentationSchema.parse({
		id: "p1",
		status: "live",
		resultsVisibility: "instant",
		...overrides,
	});
}

describe("SlideSchema — notes (REQ090)", () => {
	test("a slide carries the notes its author wrote, byte for byte", () => {
		expect(notedSlide().notes).toBe(NOTE);
	});

	test("notes default to an empty string", () => {
		// A deck authored before this field existed re-parses forward with the
		// default filling the gap — no migration, and no read site reaching for
		// `??`.
		const slide = SlideSchema.parse({
			id: "old",
			type: "word-cloud",
			question: "One word?",
		});
		expect(slide.notes).toBe("");
	});

	test("every slide type may carry them — including one that collects nothing", () => {
		// A content slide is exactly the slide a presenter is talking over.
		expect(
			SlideSchema.parse({
				id: "intro",
				type: "text",
				question: "Welcome",
				notes: NOTE,
			}).notes,
		).toBe(NOTE);
	});
});

describe("withoutPresenterNotes (REQ090)", () => {
	test("empties the note, whatever the deck's state", () => {
		const [audience] = withoutPresenterNotes([notedSlide()]);
		expect(audience.notes).toBe("");
	});

	test("emptied to `\"\"`, never dropped", () => {
		// The opposite stance to a withheld answer key, and deliberately: a slide
		// with no notes already carries `""`, so the audience's view of a noted
		// slide and an un-noted one are the same complete shape.
		const [audience] = withoutPresenterNotes([notedSlide()]);
		expect("notes" in audience).toBe(true);
		expect(audience.notes).not.toBe(undefined);
	});

	test("leaves everything else on the slide alone", () => {
		const slide = notedSlide();
		const [audience] = withoutPresenterNotes([slide]);
		expect({ ...audience, notes: NOTE }).toEqual(slide);
	});

	test("a slide with no notes is unchanged", () => {
		const slide = notedSlide({ notes: "" });
		expect(withoutPresenterNotes([slide])).toEqual([slide]);
	});
});

describe("withAudienceSlides — one projection, everything presenter-only (REQ090)", () => {
	test("empties the notes and withholds the answer key together", () => {
		const quiz = SlideSchema.parse({
			id: "qz",
			type: "quiz",
			question: "Capital of France?",
			timeLimit: 30,
			options: [
				{ id: "a", text: "Paris", isCorrect: true },
				{ id: "b", text: "Lyon" },
			],
			quizAnswers: [{ id: "k1", text: "Paris" }],
			notes: NOTE,
		});
		const [audience] = withAudienceSlides([quiz], deck(), Date.now());
		expect(audience.notes).toBe("");
		expect(audience.quizAnswers).toEqual([]);
		expect(audience.options.every((option) => !("isCorrect" in option))).toBe(
			true,
		);
	});

	test("a revealed answer key still comes back — the note does not", () => {
		// The two projections answer different questions: a solution has a reveal
		// to come due, a note never does.
		const quiz = SlideSchema.parse({
			id: "qz",
			type: "quiz",
			question: "Capital of France?",
			timeLimit: 30,
			options: [{ id: "a", text: "Paris", isCorrect: true }],
			notes: NOTE,
		});
		const [audience] = withAudienceSlides(
			[quiz],
			deck({ status: "ended" }),
			Date.now(),
		);
		expect(audience.options[0].isCorrect).toBe(true);
		expect(audience.notes).toBe("");
	});

	test("ending the deck is not a reveal for a note", () => {
		for (const status of ["draft", "live", "ended"] as const) {
			const [audience] = withAudienceSlides(
				[notedSlide()],
				deck({ status }),
				Date.now(),
			);
			expect(audience.notes).toBe("");
		}
	});

	test("revealing the slide's results is not a reveal for a note either", () => {
		const [audience] = withAudienceSlides(
			[notedSlide()],
			deck({ revealedSlideIds: ["s1"] }),
			Date.now(),
		);
		expect(audience.notes).toBe("");
	});

	test("the solution projection on its own does not touch notes", () => {
		// Guards the composition rather than the parts: `withAudienceSolutions` is
		// about answer keys and knows nothing about notes, which is exactly why
		// every audience-facing surface must go through `withAudienceSlides` and
		// not reach for the narrower function.
		const [audience] = withAudienceSolutions([notedSlide()], deck(), Date.now());
		expect(audience.notes).toBe(NOTE);
	});
});
