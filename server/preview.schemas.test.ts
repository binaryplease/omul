/**
 * Unit tests for the test-vote generator (REQ104).
 *
 * The generator's whole job is to produce responses that are *submittable* — a
 * synthetic row the real boundary would have refused is a preview of a slide
 * that cannot exist — so almost every assertion here reads a generated value
 * back through the very decoder the vote endpoint judges a real submission with
 * (`decodeRanking`, `decodePoints`, `decodeGuess`, `decodeGridPoint`,
 * `decodePinPoint`, `isStandingQuizAnswer`). The other half covers determinism, which is what lets
 * the preview surface poll for a running countdown without reshuffling the room
 * it is showing every three seconds.
 *
 * Pure: no store, no app, no clock beyond the instant handed in.
 */

import { describe, expect, test } from "bun:test";
import {
	generateDeckTestVotes,
	generateSlideTestVotes,
	type TestVoteRun,
} from "./preview";
import {
	decodeGridPoint,
	decodeGuess,
	decodePinPoint,
	decodePoints,
	decodeRanking,
	gridAxesFor,
	guessRangeFor,
	isPinInArea,
	isStandingQuizAnswer,
	maxSelectionsFor,
	pinAreaFor,
	POINTS_BUDGET,
	type Slide,
	SlideSchema,
	StoredVoteSchema,
} from "./schemas";

const RUN: TestVoteRun = {
	presentationId: "deck-1",
	respondents: 20,
	seed: 7,
	startedAt: "2026-08-06T10:00:00.000Z",
};

/** Parse a hand-written slide through the schema so defaults are filled in. */
function slide(fields: Record<string, unknown>): Slide {
	return SlideSchema.parse(fields);
}

function options(count: number, correctIndex: number | null = null) {
	return Array.from({ length: count }, (_unused, index) => ({
		id: `opt-${index}`,
		text: `Option ${index + 1}`,
		...(correctIndex === index ? { isCorrect: true } : {}),
	}));
}

/** The distinct participants behind a set of rows. */
function respondentsIn(votes: { participantId: string }[]): Set<string> {
	return new Set(votes.map((vote) => vote.participantId));
}

describe("generateSlideTestVotes — every row is a stored vote (REQ104)", () => {
	const everyInteractiveSlide: Slide[] = [
		slide({ id: "mc", type: "multiple-choice", question: "Pick", options: options(4) }),
		slide({
			id: "mc-multi",
			type: "multiple-choice",
			question: "Pick some",
			options: options(5),
			mcMaxSelections: 3,
		}),
		slide({ id: "wc", type: "word-cloud", question: "One word" }),
		slide({ id: "oe", type: "open-text", question: "Say more", allowResponseVotes: true }),
		slide({ id: "sc", type: "scale", question: "Rate", scaleMin: 1, scaleMax: 7 }),
		slide({
			id: "sc-multi",
			type: "scale",
			question: "Rate these",
			scaleStatements: [
				{ id: "s1", text: "One" },
				{ id: "s2", text: "Two" },
			],
			scaleAllowSkip: true,
		}),
		slide({
			id: "rk",
			type: "ranking",
			question: "Order",
			rankingItems: [
				{ id: "r1", text: "Alpha" },
				{ id: "r2", text: "Beta" },
				{ id: "r3", text: "Gamma" },
			],
		}),
		slide({
			id: "pt",
			type: "points",
			question: "Spend",
			pointsItems: [
				{ id: "p1", text: "Alpha" },
				{ id: "p2", text: "Beta" },
				{ id: "p3", text: "Gamma" },
			],
		}),
		slide({
			id: "gn",
			type: "guess-number",
			question: "How many?",
			guessRange: { min: 0, max: 100, step: 5 },
			guessReference: { value: 40, tolerance: 5 },
		}),
		slide({
			id: "gr",
			type: "grid",
			question: "Place these",
			gridItems: [
				{ id: "g1", text: "Alpha" },
				{ id: "g2", text: "Beta" },
			],
			gridXAxis: { title: "Effort", min: 0, max: 10, minLabel: "", maxLabel: "" },
			gridYAxis: { title: "Impact", min: 0, max: 10, minLabel: "", maxLabel: "" },
			gridAllowSkip: true,
		}),
		slide({
			id: "pn",
			type: "pin-image",
			question: "Where is it?",
			mediaUrl: "https://example.test/map.png",
			pinArea: { x: 400, y: 300, width: 200, height: 150 },
		}),
		slide({
			id: "qz",
			type: "quiz",
			question: "Capital?",
			options: options(4, 1),
			timeLimit: 30,
		}),
		slide({
			id: "qz-typed",
			type: "quiz",
			question: "Capital?",
			quizAnswerMode: "type",
			quizAnswers: [{ id: "a1", text: "Paris" }],
			timeLimit: 30,
		}),
	];

	for (const interactiveSlide of everyInteractiveSlide) {
		test(`${interactiveSlide.id} produces rows the stored schema accepts`, () => {
			const { votes } = generateSlideTestVotes(interactiveSlide, RUN);
			expect(votes.length).toBeGreaterThan(0);
			for (const vote of votes) {
				// Already parsed inside the generator; re-parsing here is what makes
				// "a test vote is shaped exactly like a real one" an assertion rather
				// than a claim in a comment.
				expect(() => StoredVoteSchema.parse(vote)).not.toThrow();
				expect(vote.presentationId).toBe(RUN.presentationId);
				expect(vote.slideId).toBe(interactiveSlide.id);
				expect(vote.participantId).not.toBe("");
				expect(vote.value.length).toBeGreaterThan(0);
			}
			// Every row belongs to one of the respondents the run asked for.
			expect(respondentsIn(votes).size).toBeLessThanOrEqual(RUN.respondents);
		});
	}

	test("slide ids are unique across a deck's generated rows", () => {
		const { votes } = generateDeckTestVotes(everyInteractiveSlide, RUN);
		const ids = new Set(votes.map((vote) => vote.id));
		expect(ids.size).toBe(votes.length);
	});

	test("a leaderboard and the content slide types generate nothing", () => {
		for (const type of [
			"leaderboard",
			"text",
			"image",
			"video",
			"instruction",
		] as const) {
			const generated = generateSlideTestVotes(
				slide({ id: type, type, question: "…" }),
				RUN,
			);
			expect(generated.votes).toEqual([]);
			expect(generated.responseVotes).toEqual([]);
		}
	});

	test("respondents: 0 is a real answer — the empty room", () => {
		const generated = generateDeckTestVotes(everyInteractiveSlide, {
			...RUN,
			respondents: 0,
		});
		expect(generated.votes).toEqual([]);
		expect(generated.responseVotes).toEqual([]);
	});
});

describe("generateSlideTestVotes — submissions the boundary would accept", () => {
	test("a single-choice slide holds one option per participant", () => {
		const choice = slide({
			id: "mc",
			type: "multiple-choice",
			question: "Pick",
			options: options(4),
		});
		const { votes } = generateSlideTestVotes(choice, RUN);
		const optionIds = new Set(choice.options?.map((option) => option.id));
		expect(votes.length).toBe(RUN.respondents);
		for (const vote of votes) expect(optionIds.has(vote.value)).toBe(true);
		expect(respondentsIn(votes).size).toBe(RUN.respondents);
	});

	test("a capped multi-select never exceeds the cap it was authored with", () => {
		const choice = slide({
			id: "mc",
			type: "multiple-choice",
			question: "Pick up to two",
			options: options(5),
			mcMaxSelections: 2,
		});
		const { votes } = generateSlideTestVotes(choice, RUN);
		const perParticipant = new Map<string, string[]>();
		for (const vote of votes) {
			const held = perParticipant.get(vote.participantId) ?? [];
			held.push(vote.value);
			perParticipant.set(vote.participantId, held);
		}
		for (const held of perParticipant.values()) {
			expect(held.length).toBeLessThanOrEqual(maxSelectionsFor(choice));
			// The endpoint treats a repeat as a deselect, so a duplicate row would
			// preview a selection the participant does not actually hold.
			expect(new Set(held).size).toBe(held.length);
		}
	});

	test("a ranking decodes as an ordering of the slide's own items", () => {
		const ranking = slide({
			id: "rk",
			type: "ranking",
			question: "Order",
			rankingItems: [
				{ id: "r1", text: "Alpha" },
				{ id: "r2", text: "Beta" },
				{ id: "r3", text: "Gamma" },
				{ id: "r4", text: "Delta" },
			],
		});
		const { votes } = generateSlideTestVotes(ranking, RUN);
		expect(votes.length).toBe(RUN.respondents);
		let partialBallots = 0;
		for (const vote of votes) {
			const order = decodeRanking(vote.value, ranking.rankingItems ?? []);
			expect(order).not.toBeNull();
			if ((order ?? []).length < (ranking.rankingItems ?? []).length) {
				partialBallots++;
			}
		}
		// REQ034 — a preview that never left an item unranked would show a `notRanked`
		// column that is always zero, which is not what the slide does in a room.
		expect(partialBallots).toBeGreaterThan(0);
	});

	test("a 100 Points ballot spends exactly the budget", () => {
		const points = slide({
			id: "pt",
			type: "points",
			question: "Spend",
			pointsItems: [
				{ id: "p1", text: "Alpha" },
				{ id: "p2", text: "Beta" },
				{ id: "p3", text: "Gamma" },
			],
		});
		const { votes } = generateSlideTestVotes(points, RUN);
		expect(votes.length).toBe(RUN.respondents);
		for (const vote of votes) {
			const allocation = decodePoints(vote.value, points.pointsItems ?? []);
			// `decodePoints` returning non-null *is* "exactly 100 was spent" — it is
			// where the rule lives, so this is the real check and not a re-derivation.
			expect(allocation).not.toBeNull();
			const spent = Object.values(allocation ?? {}).reduce(
				(sum, amount) => sum + amount,
				0,
			);
			expect(spent).toBe(POINTS_BUDGET);
		}
	});

	test("a single-item 100 Points slide gives that item the whole budget", () => {
		const points = slide({
			id: "pt",
			type: "points",
			question: "Spend",
			pointsItems: [{ id: "only", text: "Alpha" }],
		});
		const { votes } = generateSlideTestVotes(points, RUN);
		for (const vote of votes) {
			expect(decodePoints(vote.value, points.pointsItems ?? [])).toEqual({
				only: POINTS_BUDGET,
			});
		}
	});

	test("a guess sits on the authored step grid, inside the range", () => {
		const guess = slide({
			id: "gn",
			type: "guess-number",
			question: "How many?",
			guessRange: { min: 10, max: 90, step: 4 },
		});
		const range = guessRangeFor(guess);
		const { votes } = generateSlideTestVotes(guess, RUN);
		expect(votes.length).toBe(RUN.respondents);
		for (const vote of votes) {
			const value = decodeGuess(vote.value, range);
			expect(value).not.toBeNull();
			expect(value).toBeGreaterThanOrEqual(range.min);
			expect(value).toBeLessThanOrEqual(range.max);
		}
	});

	test("an unusable guess range generates nothing rather than off-frame rows", () => {
		const guess = slide({
			id: "gn",
			type: "guess-number",
			question: "How many?",
			guessRange: { min: 5, max: 5, step: 1 },
		});
		expect(generateSlideTestVotes(guess, RUN).votes).toEqual([]);
	});

	test("a grid placement decodes as a point on the authored field", () => {
		const grid = slide({
			id: "gr",
			type: "grid",
			question: "Place",
			gridItems: [
				{ id: "g1", text: "Alpha" },
				{ id: "g2", text: "Beta" },
			],
			gridXAxis: { title: "Effort", min: -5, max: 5, minLabel: "", maxLabel: "" },
			gridYAxis: { title: "Impact", min: 0, max: 20, minLabel: "", maxLabel: "" },
			gridAllowSkip: true,
		});
		const { xAxis, yAxis } = gridAxesFor(grid);
		const { votes } = generateSlideTestVotes(grid, RUN);
		// One row per item per participant — the shape a real grid vote takes.
		expect(votes.length).toBe(RUN.respondents * 2);
		const itemIds = new Set((grid.gridItems ?? []).map((item) => item.id));
		for (const vote of votes) {
			expect(itemIds.has(vote.statementId ?? "")).toBe(true);
			// A skipped item carries no coordinate the tally reads, so only the
			// placements have to decode.
			if (!vote.skip) {
				expect(decodeGridPoint(vote.value, xAxis, yAxis)).not.toBeNull();
			}
		}
	});

	test("a multi-statement scale answers each statement in range", () => {
		const scale = slide({
			id: "sc",
			type: "scale",
			question: "Rate",
			scaleMin: 1,
			scaleMax: 5,
			scaleStatements: [
				{ id: "s1", text: "One" },
				{ id: "s2", text: "Two" },
				{ id: "s3", text: "Three" },
			],
		});
		const { votes } = generateSlideTestVotes(scale, RUN);
		expect(votes.length).toBe(RUN.respondents * 3);
		for (const vote of votes) {
			const rating = Number(vote.value);
			expect(Number.isInteger(rating)).toBe(true);
			expect(rating).toBeGreaterThanOrEqual(1);
			expect(rating).toBeLessThanOrEqual(5);
		}
	});

	test("a quiz holds one standing answer per participant, inside its window", () => {
		const quiz = slide({
			id: "qz",
			type: "quiz",
			question: "Capital?",
			options: options(4, 2),
			timeLimit: 30,
		});
		const { votes } = generateSlideTestVotes(quiz, RUN);
		expect(votes.length).toBe(RUN.respondents);
		expect(respondentsIn(votes).size).toBe(RUN.respondents);
		const opened = Date.parse(RUN.startedAt);
		for (const vote of votes) {
			expect(isStandingQuizAnswer(quiz, vote.value)).toBe(true);
			const answered = Date.parse(vote.createdAt);
			expect(answered).toBeGreaterThanOrEqual(opened);
			// Inside the window it is scored against — a preview whose answers landed
			// after the buzzer would report a room the boundary would have refused.
			expect(answered).toBeLessThanOrEqual(opened + 30_000);
		}
	});

	test("a typed quiz answers in words, some of them the accepted spelling", () => {
		const quiz = slide({
			id: "qz",
			type: "quiz",
			question: "Capital of France?",
			quizAnswerMode: "type",
			quizAnswers: [{ id: "a1", text: "Paris" }],
			timeLimit: 30,
		});
		const { votes } = generateSlideTestVotes(quiz, RUN);
		expect(votes.length).toBe(RUN.respondents);
		for (const vote of votes) {
			expect(isStandingQuizAnswer(quiz, vote.value)).toBe(true);
		}
		const correct = votes.filter(
			(vote) => vote.value.toLowerCase().replace(/\.$/, "") === "paris",
		);
		expect(correct.length).toBeGreaterThan(0);
		expect(correct.length).toBeLessThan(votes.length);
	});

	test("an open-text slide with upvotes on nobody's own response (REQ025)", () => {
		const openText = slide({
			id: "oe",
			type: "open-text",
			question: "Say more",
			allowResponseVotes: true,
		});
		const { votes, responseVotes } = generateSlideTestVotes(openText, RUN);
		expect(responseVotes.length).toBeGreaterThan(0);
		const authorOf = new Map(votes.map((vote) => [vote.id, vote.participantId]));
		const held = new Set<string>();
		for (const upvote of responseVotes) {
			expect(authorOf.has(upvote.responseId)).toBe(true);
			expect(upvote.participantId).not.toBe(authorOf.get(upvote.responseId));
			// One participant, one upvote per response — the tally counts distinct
			// upvoters, so duplicate rows would preview a count nobody could produce.
			const pair = `${upvote.responseId}:${upvote.participantId}`;
			expect(held.has(pair)).toBe(false);
			held.add(pair);
		}
	});

	test("a re-typed response folds into an upvote, as the endpoint folds it", () => {
		const withVotes = slide({
			id: "oe",
			type: "open-text",
			question: "Say more",
			allowResponseVotes: true,
		});
		const folded = generateSlideTestVotes(withVotes, RUN);
		// REQ025 — the vote endpoint turns a repeat into an upvote, so a preview
		// that stored both would draw two identical cards where the room draws one.
		const texts = folded.votes.map((vote) => vote.value.toLowerCase());
		expect(new Set(texts).size).toBe(texts.length);

		// Without response voting there is no fold, and repeats are real rows —
		// which is exactly what an open-text slide does when nobody can upvote.
		const plain = generateSlideTestVotes(
			slide({ id: "oe2", type: "open-text", question: "Say more" }),
			RUN,
		);
		expect(plain.responseVotes).toEqual([]);
		expect(plain.votes.length).toBe(RUN.respondents);
	});

	test("a pin slide's pins are on the image, and most hit an authored target", () => {
		const pinTarget = slide({
			id: "pn",
			type: "pin-image",
			question: "Where is it?",
			mediaUrl: "https://example.test/map.png",
			pinArea: { x: 400, y: 300, width: 200, height: 150 },
		});
		const { votes } = generateSlideTestVotes(pinTarget, RUN);
		// One pin per participant — the rule the boundary enforces (REQ051).
		expect(votes.length).toBe(RUN.respondents);
		expect(respondentsIn(votes).size).toBe(RUN.respondents);
		const area = pinAreaFor(pinTarget);
		if (!area) throw new Error("the fixture authored a usable target area");
		let inside = 0;
		for (const vote of votes) {
			// Read back through the decoder the vote endpoint judges with: a preview
			// pin the boundary would refuse is a cloud on a slide nobody can answer.
			const point = decodePinPoint(vote.value);
			expect(point).not.toBe(null);
			if (point && isPinInArea(point, area)) inside++;
		}
		// A room aims at the target, so the correct-share badge shows something —
		// and a plausible minority still miss, so it does not read as a question
		// nobody could get wrong (REQ053).
		expect(inside).toBeGreaterThan(0);
		expect(inside).toBeLessThan(votes.length);
	});

	test("a pin slide with no image generates nothing (REQ052)", () => {
		// No image, no coordinate space — and the vote boundary refuses every
		// submission to such a slide, so a generated pin would be unsubmittable.
		expect(
			generateSlideTestVotes(
				slide({ id: "pn", type: "pin-image", question: "Where?" }),
				RUN,
			).votes,
		).toEqual([]);
	});

	test("a slide with nothing to answer generates nothing", () => {
		for (const empty of [
			slide({ id: "mc", type: "multiple-choice", question: "Pick", options: [] }),
			slide({ id: "rk", type: "ranking", question: "Order", rankingItems: [] }),
			slide({ id: "pt", type: "points", question: "Spend", pointsItems: [] }),
			slide({ id: "gr", type: "grid", question: "Place", gridItems: [] }),
			slide({ id: "qz", type: "quiz", question: "Which?", options: [] }),
		]) {
			expect(generateSlideTestVotes(empty, RUN).votes).toEqual([]);
		}
	});
});

describe("generateDeckTestVotes — determinism (REQ104)", () => {
	const deck = [
		slide({ id: "mc", type: "multiple-choice", question: "Pick", options: options(4) }),
		slide({ id: "wc", type: "word-cloud", question: "One word" }),
		slide({
			id: "gn",
			type: "guess-number",
			question: "How many?",
			guessRange: { min: 0, max: 50, step: 1 },
		}),
	];

	test("the same seed reproduces the same room", () => {
		const first = generateDeckTestVotes(deck, RUN);
		const second = generateDeckTestVotes(deck, RUN);
		expect(second).toEqual(first);
	});

	test("a different seed produces a different room", () => {
		const first = generateDeckTestVotes(deck, RUN);
		const second = generateDeckTestVotes(deck, { ...RUN, seed: RUN.seed + 1 });
		expect(second).not.toEqual(first);
	});

	test("a slide's answers do not move when another slide is added", () => {
		const before = generateSlideTestVotes(deck[0], RUN);
		const after = generateDeckTestVotes(
			[
				slide({ id: "new", type: "word-cloud", question: "Added first" }),
				...deck,
			],
			RUN,
		);
		const sameSlide = after.votes.filter((vote) => vote.slideId === "mc");
		expect(sameSlide.map((vote) => vote.value)).toEqual(
			before.votes.map((vote) => vote.value),
		);
	});

	test("one participant is the same person across the deck", () => {
		const generated = generateDeckTestVotes(deck, RUN);
		const perSlide = new Map<string, Set<string>>();
		for (const vote of generated.votes) {
			const seen = perSlide.get(vote.slideId) ?? new Set<string>();
			seen.add(vote.participantId);
			perSlide.set(vote.slideId, seen);
		}
		const [first, ...rest] = [...perSlide.values()];
		for (const others of rest) {
			expect([...others].every((one) => first.has(one))).toBe(true);
		}
	});
});
