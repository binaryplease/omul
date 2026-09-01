/**
 * Unit tests for the typed-answer quiz rules in server/schemas.ts (REQ055).
 *
 * The whole slice turns on one decision — **what counts as the same answer** —
 * so that is what most of this file pins. The rule is exact match after
 * normalization against any of the organizer's accepted solutions:
 *
 *   - it folds what is not the knowledge being tested (case, accents, spacing,
 *     a trailing full stop), so a right answer is not refused over a keyboard;
 *   - it folds nothing else, so a wrong answer is never awarded points — the
 *     failure mode a distance-based grader has and an organizer cannot see.
 *
 * The window, the score and the one-final-answer rule are REQ054/REQ056/REQ057's
 * and are pinned next door in quiz.schemas.test.ts; a typed answer runs through
 * exactly those, which the integration suite exercises end to end.
 */

import { describe, expect, test } from "bun:test";
import {
	acceptedQuizAnswers,
	decodeQuizAnswer,
	encodeQuizAnswer,
	isCorrectQuizAnswer,
	isStandingQuizAnswer,
	matchesQuizAnswer,
	normalizeQuizAnswer,
	QUIZ_MAX_POINTS,
	quizAnswerModeFor,
	scoreQuizAnswer,
} from "./schemas";

/** A typed-answer quiz question accepting two spellings of one answer. */
function typedSlide(overrides: Record<string, unknown> = {}) {
	return {
		type: "quiz" as const,
		timeLimit: 30,
		quizAnswerMode: "type" as const,
		quizAnswers: [
			{ id: "a1", text: "Zürich" },
			{ id: "a2", text: "Zurich, Switzerland" },
		],
		...overrides,
	};
}

describe("quizAnswerModeFor (REQ054, REQ055)", () => {
	test("a quiz answers by selection unless its author said otherwise", () => {
		expect(quizAnswerModeFor({ type: "quiz" })).toBe("select");
		expect(quizAnswerModeFor({ type: "quiz", quizAnswerMode: "select" })).toBe(
			"select",
		);
	});

	test("reads the authored typed mode", () => {
		expect(quizAnswerModeFor({ type: "quiz", quizAnswerMode: "type" })).toBe(
			"type",
		);
	});

	test("only a quiz slide has an answer mode at all", () => {
		// A multiple-choice slide converted from a quiz keeps the stored field;
		// reading it there would offer a text box on a slide that has options.
		expect(
			quizAnswerModeFor({ type: "multiple-choice", quizAnswerMode: "type" }),
		).toBe("select");
	});
});

describe("normalizeQuizAnswer (REQ055) — what it folds", () => {
	test("folds case", () => {
		expect(normalizeQuizAnswer("PARIS")).toBe(normalizeQuizAnswer("paris"));
	});

	test("folds diacritics a phone keyboard may not offer", () => {
		expect(normalizeQuizAnswer("Zürich")).toBe(normalizeQuizAnswer("Zurich"));
		expect(normalizeQuizAnswer("café")).toBe(normalizeQuizAnswer("cafe"));
	});

	test("folds surrounding whitespace and collapses runs inside", () => {
		expect(normalizeQuizAnswer("  New   York  ")).toBe(
			normalizeQuizAnswer("New York"),
		);
	});

	test("folds the punctuation a sentence habit leaves at either end", () => {
		expect(normalizeQuizAnswer("Paris.")).toBe(normalizeQuizAnswer("Paris"));
		expect(normalizeQuizAnswer("“Paris”")).toBe(normalizeQuizAnswer("Paris"));
		expect(normalizeQuizAnswer("Paris!")).toBe(normalizeQuizAnswer("Paris"));
	});
});

describe("normalizeQuizAnswer (REQ055) — only Latin accents are folded", () => {
	// The fold is the three Combining Diacritical Marks blocks, not every
	// combining mark in Unicode. In Devanagari, Thai, Hebrew and Arabic those
	// marks are not accents on a letter — they *are* letters, vowels written
	// above, below or beside a consonant — so stripping them would collapse
	// different words onto the same key and hand full marks to the wrong word.

	test("Devanagari vowel signs are letters, not accents", () => {
		// कील ("nail") and कल ("tomorrow") are different words.
		expect(normalizeQuizAnswer("कील")).not.toBe(normalizeQuizAnswer("कल"));
		expect(normalizeQuizAnswer("कील")).toBe("कील");
	});

	test("Thai vowel and tone marks are letters, not accents", () => {
		expect(normalizeQuizAnswer("ที่")).not.toBe(normalizeQuizAnswer("ที"));
		expect(normalizeQuizAnswer("ที่")).not.toBe(normalizeQuizAnswer("ท"));
	});

	test("Hebrew niqqud and Arabic harakat are not stripped", () => {
		expect(normalizeQuizAnswer("עִבְרִית")).not.toBe(normalizeQuizAnswer("עברית"));
		expect(normalizeQuizAnswer("مُحَمَّد")).not.toBe(normalizeQuizAnswer("محمد"));
	});

	test("a non-Latin answer still matches itself", () => {
		// Folding nothing must not mean matching nothing: the same word typed the
		// same way is still the same answer, spacing and case rules included.
		const slide = typedSlide({ quizAnswers: [{ id: "a1", text: "कल" }] });
		expect(matchesQuizAnswer(slide, "कल")).toBe(true);
		expect(matchesQuizAnswer(slide, "  कल. ")).toBe(true);
		expect(matchesQuizAnswer(slide, "कील")).toBe(false);
	});
});

describe("normalizeQuizAnswer (REQ055) — what it must not fold", () => {
	test("keeps two different answers different", () => {
		expect(normalizeQuizAnswer("1997")).not.toBe(normalizeQuizAnswer("1987"));
		expect(normalizeQuizAnswer("Mars")).not.toBe(normalizeQuizAnswer("Mercury"));
	});

	test("does not correct a typo — one edit apart is still a different answer", () => {
		// This is the property a distance-based grader cannot have: 1997 and 1987
		// are one edit apart, and awarding points for the wrong year is a mistake
		// the organizer never gets to see.
		expect(normalizeQuizAnswer("Pariss")).not.toBe(normalizeQuizAnswer("Paris"));
	});

	test("keeps punctuation that is part of the answer", () => {
		// Edge-only trimming: stripping punctuation everywhere would fold "C++"
		// onto "C" and "3+4" onto "34".
		expect(normalizeQuizAnswer("C++")).not.toBe(normalizeQuizAnswer("C"));
		expect(normalizeQuizAnswer("3+4")).not.toBe(normalizeQuizAnswer("34"));
	});

	test("does not reorder or abbreviate", () => {
		expect(normalizeQuizAnswer("New York")).not.toBe(
			normalizeQuizAnswer("York New"),
		);
		expect(normalizeQuizAnswer("United States")).not.toBe(
			normalizeQuizAnswer("USA"),
		);
	});
});

describe("acceptedQuizAnswers (REQ055)", () => {
	test("reads the authored solutions in the authored spelling and order", () => {
		expect(acceptedQuizAnswers(typedSlide())).toEqual([
			"Zürich",
			"Zurich, Switzerland",
		]);
	});

	test("drops blank rows and rows that normalize to nothing", () => {
		// An accepted answer of "." would otherwise make punctuation correct.
		const slide = typedSlide({
			quizAnswers: [
				{ id: "a1", text: "Bern" },
				{ id: "a2", text: "   " },
				{ id: "a3", text: "" },
				{ id: "a4", text: "." },
			],
		});
		expect(acceptedQuizAnswers(slide)).toEqual(["Bern"]);
	});

	test("a question whose author named nothing accepts nothing", () => {
		expect(acceptedQuizAnswers(typedSlide({ quizAnswers: [] }))).toEqual([]);
	});
});

describe("encodeQuizAnswer / decodeQuizAnswer (REQ055)", () => {
	test("stores the participant's own spelling, only trimmed", () => {
		// Normalization is how two answers are *compared*, never how one is
		// recorded: an answer rewritten on the way in would show a participant
		// words they did not type under a verdict about whether they were right.
		expect(encodeQuizAnswer("  Zürich  ")).toBe("Zürich");
		expect(decodeQuizAnswer("  PaRiS. ")).toBe("PaRiS.");
	});

	test("a submission that states no answer is not one", () => {
		expect(decodeQuizAnswer("")).toBe(null);
		expect(decodeQuizAnswer("   ")).toBe(null);
		expect(decodeQuizAnswer("...")).toBe(null);
	});
});

describe("matchesQuizAnswer (REQ055)", () => {
	const slide = typedSlide();

	test("accepts an answer that matches any of the organizer's spellings", () => {
		expect(matchesQuizAnswer(slide, "Zürich")).toBe(true);
		expect(matchesQuizAnswer(slide, "zurich")).toBe(true);
		expect(matchesQuizAnswer(slide, "  ZURICH.  ")).toBe(true);
		expect(matchesQuizAnswer(slide, "Zurich, Switzerland")).toBe(true);
	});

	test("refuses an answer the organizer did not name", () => {
		expect(matchesQuizAnswer(slide, "Bern")).toBe(false);
		expect(matchesQuizAnswer(slide, "Zuric")).toBe(false);
		expect(matchesQuizAnswer(slide, "Switzerland")).toBe(false);
	});

	test("nothing matches on a question with no accepted answer", () => {
		// The same stance a choice slide takes when its author marked no option
		// (REQ013): nobody scores, rather than everybody scoring.
		expect(matchesQuizAnswer(typedSlide({ quizAnswers: [] }), "Zürich")).toBe(
			false,
		);
	});

	test("an empty submission never matches", () => {
		expect(matchesQuizAnswer(slide, "   ")).toBe(false);
	});
});

describe("isCorrectQuizAnswer across both modes (REQ054, REQ055)", () => {
	test("a typed question judges the text, not an option id", () => {
		expect(isCorrectQuizAnswer(typedSlide(), "zurich")).toBe(true);
		expect(isCorrectQuizAnswer(typedSlide(), "geneva")).toBe(false);
	});

	test("a select question is unchanged", () => {
		const slide = {
			type: "quiz" as const,
			options: [
				{ id: "a", text: "A", isCorrect: true },
				{ id: "b", text: "B" },
			],
		};
		expect(isCorrectQuizAnswer(slide, "a")).toBe(true);
		expect(isCorrectQuizAnswer(slide, "b")).toBe(false);
	});
});

describe("isStandingQuizAnswer (REQ055)", () => {
	test("a select question stands on its options", () => {
		const slide = {
			type: "quiz" as const,
			options: [{ id: "a", text: "A" }],
		};
		expect(isStandingQuizAnswer(slide, "a")).toBe(true);
		// An option the organizer has since deleted is not an answer to the
		// question as it now stands — so it neither counts nor locks anyone out.
		expect(isStandingQuizAnswer(slide, "gone")).toBe(false);
	});

	test("a typed question stands on anything that is an answer at all", () => {
		expect(isStandingQuizAnswer(typedSlide(), "Bern")).toBe(true);
		expect(isStandingQuizAnswer(typedSlide(), "  ")).toBe(false);
	});

	test("an option id left over from before the switch is not a typed answer", () => {
		// The organizer converted a select question to a typed one under answers
		// already given; a UUID is not an answer to the question they now ask.
		const converted = typedSlide({
			options: [{ id: "opt-1", text: "Zürich" }],
		});
		expect(isStandingQuizAnswer(converted, "opt-1")).toBe(false);
		expect(isStandingQuizAnswer(converted, "Zürich")).toBe(true);
	});
});

describe("a typed answer scores on the same terms (REQ054, REQ055)", () => {
	test("correctness and speed, from the shared scorer", () => {
		// REQ055 adds an answer mode, not a scoring model: the points a typed
		// answer earns are the ones scoreQuizAnswer already awards.
		const correct = matchesQuizAnswer(typedSlide(), "zurich.");
		expect(
			scoreQuizAnswer({
				isCorrect: correct,
				elapsedMs: 0,
				timeLimitSeconds: 30,
			}),
		).toBe(QUIZ_MAX_POINTS);
		expect(
			scoreQuizAnswer({
				isCorrect: matchesQuizAnswer(typedSlide(), "geneva"),
				elapsedMs: 0,
				timeLimitSeconds: 30,
			}),
		).toBe(0);
	});
});
