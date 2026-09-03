import type { Slide } from "../types";
import {
	acceptedQuizAnswers,
	correctGuessRangeFor,
	formFieldsFor,
	gridAxesFor,
	guessBucketsFor,
	guessRangeFor,
	guessReferenceFor,
	isPinInArea,
	isUsableGuessRange,
	leaderboardSizeFor,
	maxSelectionsFor,
	PIN_COORDINATE_MAX,
	pinAreaFor,
	pinImageFor,
	POINTS_BUDGET,
	QUIZ_MAX_POINTS,
	quizAnswerModeFor,
	slideHasResults,
} from "../types";

// ── The stand-in room (REQ154) ────────────────────────────────────────
//
// A tally the editor can draw a slide's results from before a single person has
// answered it. It exists so the canvas can show the *rendering* an authored
// chart style, value display, chart colour and answer key select — through the
// renderers the projector uses (`Results.tsx`), fed a payload shaped exactly
// like the one the results endpoint hands out.
//
// Three properties, and each of them is load-bearing:
//
//   - **Deterministic.** The numbers are drawn from a generator seeded with the
//     slide's own id, so the same slide draws the same room on every render, in
//     every session and on every machine. A preview that reshuffled itself under
//     the caret would be a picture nobody could compare two chart styles with,
//     and a test could only assert on ranges.
//   - **Local.** Nothing here reads a session, a socket or the network, and
//     nothing it makes is persisted or sent. It is a picture of a room, not a
//     room — see {@link sampleTallyNote}, which says so on screen.
//   - **Shaped like the wire.** Every payload below mirrors what
//     `aggregateSlideResults` returns for that slide type, field for field, so
//     the renderers meet the same object they meet in front of an audience. A
//     preview that fed them a convenient shape of its own would be previewing a
//     chart the room will not get.
//
// What it deliberately does *not* invent is words nobody wrote. An answer set,
// an accepted answer, a form field or a ranking item is drawn from what the
// author actually typed; only counts, coordinates and the anonymous handles on a
// leaderboard are made up, because those are the room's and the room is what is
// being stood in for.

/** How many people the stand-in room holds — a plausible workshop, not a stadium. */
const SAMPLE_ROOM = 24;

/**
 * When a sample open-text response was written.
 *
 * A literal instant rather than "now": the tally has to be the same object on
 * every render (see the module note), and a clock is the one input that
 * guarantees it is not. Nothing reads it on the canvas — the renderer keeps
 * responses in the order they arrive — so a fixed stamp costs the picture
 * nothing.
 */
const SAMPLE_TIMESTAMP = "2024-01-01T09:00:00.000Z";

/** What a stand-in crowd shouts at a word cloud. */
const SAMPLE_WORDS = [
	"clarity",
	"momentum",
	"focus",
	"trust",
	"speed",
	"craft",
	"ownership",
	"curiosity",
];

/** What a stand-in crowd writes into an open question. */
const SAMPLE_RESPONSES = [
	"The examples made it click.",
	"More time for questions next round.",
	"Best session of the day.",
	"Could we get the slides afterwards?",
	"The live demo was the highlight.",
];

/**
 * Fold a slide id into a seed.
 *
 * FNV-1a: it is one pass over the string, and a single changed character moves
 * the whole value — so two slides created a millisecond apart do not draw
 * near-identical rooms. Never zero, because the generator below would then stand
 * still.
 */
export function sampleTallySeed(slideId: string): number {
	let folded = 0x811c9dc5;
	for (let index = 0; index < slideId.length; index++) {
		folded = Math.imul(folded ^ slideId.charCodeAt(index), 0x01000193) >>> 0;
	}
	return folded >>> 0 || 0x9e3779b9;
}

/**
 * A deterministic generator (mulberry32), factory-shaped so each slide gets its
 * own stream — the same shape `server/preview.ts` uses to keep a dry run stable,
 * and for the same reason: a room that redrew itself every render is a room
 * nobody can read a chart off.
 */
function createSampleRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
		drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
		return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Split a room across `buckets` in uneven but never-empty shares.
 *
 * Uneven on purpose: an evenly split chart shows neither which bar is longest
 * nor whether the palette separates two neighbours, which are the two things the
 * author is looking at. Never empty, because a zero-count option would draw as
 * an absent bar and read as a rendering fault rather than as a quiet option.
 */
function shareRoom(
	random: () => number,
	buckets: number,
	room: number,
): number[] {
	if (buckets <= 0) return [];
	const weights = Array.from({ length: buckets }, () => 0.4 + random());
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	return weights.map((weight) =>
		Math.max(1, Math.round((weight / total) * room)),
	);
}

/** A whole number in `[low, high]`, drawn from the slide's own stream. */
function between(random: () => number, low: number, high: number): number {
	if (high <= low) return low;
	return low + Math.floor(random() * (high - low + 1));
}

/** Two decimals, the rounding every average on the wire already carries. */
function toTwoDecimals(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * What the canvas says under a sample rendering — one line, because the picture
 * is the explanation (REQ155's second invariant applies to this surface too).
 *
 * It states the one thing the drawing cannot: that this room does not exist. And
 * where the slide has nothing to chart yet — an answer set nobody has written,
 * a form with no fields — it says what to author instead of leaving an empty
 * frame to be read as a broken renderer.
 */
export function sampleTallyNote(slide: Slide): string {
	if (!slideHasResults(slide.type)) {
		return "This slide collects nothing, so there are no results to draw.";
	}
	if (!sampleTallyHasContent(slide)) {
		return "Nothing to chart yet — write the answers this slide offers and they appear here.";
	}
	return "Sample results — a stand-in room, so you can see how this slide draws. Nothing here is saved or sent.";
}

/**
 * Whether the slide has enough authored on it for a tally to be about anything.
 *
 * Asked of the *answer shape*, not of the tally: an empty chart and a chart of
 * an empty room are the same picture, and only the author can tell them apart —
 * so the note above does it for them.
 */
export function sampleTallyHasContent(slide: Slide): boolean {
	switch (slide.type) {
		case "multiple-choice":
			return (slide.options ?? []).length > 0;
		case "quiz":
			return quizAnswerModeFor(slide) === "type"
				? acceptedQuizAnswers(slide).length > 0
				: (slide.options ?? []).length > 0;
		case "ranking":
			return (slide.rankingItems ?? []).length > 0;
		case "points":
			return (slide.pointsItems ?? []).length > 0;
		case "grid":
			return (slide.gridItems ?? []).length > 0;
		case "form":
			return formFieldsFor(slide).length > 0;
		case "guess-number":
			return isUsableGuessRange(guessRangeFor(slide));
		case "pin-image":
			return pinImageFor(slide).url !== "";
		default:
			return slideHasResults(slide.type);
	}
}

/**
 * The stand-in room's answers to one slide, in the shape its results endpoint
 * reports — or `null` for a slide that collects nothing, which is what a content
 * slide's results are.
 *
 * `deckQuizCount` is the one fact a leaderboard needs that its own slide does
 * not carry (REQ059): a board sums the deck around it, so a deck with no quiz
 * questions draws the empty board it will really draw rather than a podium the
 * room could never produce.
 */
export function sampleTallyFor(
	slide: Slide,
	deckQuizCount = 0,
): Record<string, unknown> | null {
	if (!slideHasResults(slide.type)) return null;
	const random = createSampleRandom(sampleTallySeed(slide.id ?? ""));

	switch (slide.type) {
		case "multiple-choice":
		case "quiz":
			return quizAnswerModeFor(slide) === "type"
				? sampleTypedQuizTally(slide, random)
				: sampleChoiceTally(slide, random);
		case "word-cloud":
			return sampleWordCloudTally(random);
		case "open-text":
			return sampleOpenTextTally(slide, random);
		case "scale":
			return sampleScaleTally(slide, random);
		case "ranking":
			return sampleRankingTally(slide, random);
		case "points":
			return samplePointsTally(slide, random);
		case "grid":
			return sampleGridTally(slide, random);
		case "guess-number":
			return sampleGuessTally(slide, random);
		case "pin-image":
			return samplePinTally(slide, random);
		case "form":
			return sampleFormTally(slide, random);
		case "leaderboard":
			return sampleLeaderboardTally(slide, random, deckQuizCount);
		default:
			return { type: slide.type, totalVotes: 0 };
	}
}

/**
 * A choice slide's bars, donut, pie or dots (REQ010/REQ011/REQ013).
 *
 * The answer key travels as the author marked it, because that is the whole
 * point of drawing this view: a marked option wears the reveal's own tick here,
 * so "which of these will the room see ringed?" is answered by looking rather
 * than by remembering. A slide with nothing marked reports `null` on every
 * option — no notion of correctness at all, which is a different thing from
 * "all wrong".
 */
function sampleChoiceTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const options = slide.options ?? [];
	const counts = shareRoom(random, options.length, SAMPLE_ROOM);
	const totalVotes = counts.reduce((sum, count) => sum + count, 0);
	const maxSelections = maxSelectionsFor(slide);
	const marksSolution = options.some((option) => option.isCorrect === true);
	// One person, several selections (REQ014): the head count is what the shares
	// are taken of, so it has to sit below the selections cast and above the
	// biggest single bar — otherwise an option would be picked by more people
	// than answered.
	const respondentCount =
		maxSelections === 1
			? totalVotes
			: Math.max(...counts, Math.round(totalVotes / 1.6));
	const correctVotes = options.reduce(
		(sum, option, index) => (option.isCorrect ? sum + counts[index] : sum),
		0,
	);
	return {
		type: slide.type,
		answerMode: "select",
		totalVotes,
		respondentCount,
		maxSelections,
		typedAnswers: null,
		options: options.map((option, index) => ({
			id: option.id,
			text: option.text,
			count: counts[index],
			isCorrect: marksSolution ? option.isCorrect === true : null,
		})),
		scoring:
			slide.type === "quiz"
				? sampleQuizScoring(respondentCount, correctVotes, random)
				: null,
	};
}

/**
 * What the room typed on a free-text quiz question (REQ055).
 *
 * Only the spellings the author said they would accept appear, and each of them
 * is marked correct — because those are the only answers this surface can know
 * anything about. Inventing a plausible *wrong* answer would put words in a
 * room's mouth on a question the editor has never seen asked.
 */
function sampleTypedQuizTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const accepted = acceptedQuizAnswers(slide);
	const counts = shareRoom(random, accepted.length, Math.round(SAMPLE_ROOM * 0.7));
	const answeredCount = SAMPLE_ROOM;
	const correctCount = counts.reduce((sum, count) => sum + count, 0);
	return {
		type: "quiz",
		answerMode: "type",
		totalVotes: answeredCount,
		respondentCount: answeredCount,
		maxSelections: 1,
		// Emptied rather than withheld, the way the aggregation empties it: a typed
		// question offers no options to anyone, and a list left in would be a
		// shortlist containing the answer.
		options: [],
		typedAnswers: {
			accepted,
			entries: accepted
				.map((text, index) => ({
					text,
					count: counts[index],
					isCorrect: true,
				}))
				.sort((first, second) => second.count - first.count),
			distinctCount: accepted.length,
		},
		scoring: sampleQuizScoring(answeredCount, correctCount, random),
	};
}

/**
 * How the stand-in room scored a quiz question (REQ054/REQ056).
 *
 * The average is below the maximum even when everybody was right, because the
 * speed half of the score is never fully earned by a whole room — a summary that
 * reported a perfect average would be previewing a scoreboard the deck cannot
 * produce.
 */
function sampleQuizScoring(
	answeredCount: number,
	correctCount: number,
	random: () => number,
): Record<string, unknown> {
	const speedShare = 0.55 + random() * 0.3;
	const totalPoints = Math.round(
		correctCount * (QUIZ_MAX_POINTS / 2 + (QUIZ_MAX_POINTS / 2) * speedShare),
	);
	return {
		answeredCount,
		correctCount,
		totalPoints,
		maxPoints: QUIZ_MAX_POINTS,
		averagePoints: answeredCount
			? toTwoDecimals(totalPoints / answeredCount)
			: null,
		correctShare: answeredCount
			? toTwoDecimals((correctCount / answeredCount) * 100)
			: null,
	};
}

/**
 * A cloud of words nobody said yet (REQ021).
 *
 * The words are the module's own, not the author's, because a word cloud is the
 * one slide whose content *is* what the room writes — there is nothing authored
 * to draw. They are generic enough not to look like an answer to the question
 * above them, and varied enough in count that the size ramp is visible.
 */
function sampleWordCloudTally(random: () => number): Record<string, unknown> {
	const counts = shareRoom(random, SAMPLE_WORDS.length, SAMPLE_ROOM * 2);
	const words = SAMPLE_WORDS.map((text, index) => ({
		text,
		count: counts[index],
	})).sort((first, second) => second.count - first.count);
	return {
		type: "word-cloud",
		totalVotes: counts.reduce((sum, count) => sum + count, 0),
		words,
	};
}

/** Open responses as the room would leave them (REQ023/REQ025). */
function sampleOpenTextTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const responses = SAMPLE_RESPONSES.map((text, index) => ({
		id: `sample-response-${index + 1}`,
		text,
		createdAt: SAMPLE_TIMESTAMP,
		upvotes: slide.allowResponseVotes ? between(random, 0, 9) : 0,
	}));
	return {
		type: "open-text",
		totalVotes: responses.length,
		layout: slide.openTextLayout ?? "speech-bubbles",
		allowResponseVotes: !!slide.allowResponseVotes,
		responses,
	};
}

/**
 * How the room's answers to one statement fall across the scale — the bucket map
 * per value the aggregation emits, summing to the answers it claims.
 *
 * Clustered around the average rather than spread flat, because the average is
 * what is drawn beside it: a distribution that disagreed with its own mean would
 * be two readings of one room. Nothing renders this today (`ScaleResults` draws
 * the mean), which is exactly why it is built rather than stubbed — the payload's
 * only job is to be the shape the wire carries.
 */
function sampleScaleDistribution(
	min: number,
	max: number,
	average: number,
	answered: number,
): Record<number, number> {
	// An author mid-edit can hold min > max — the two number inputs are not
	// clamped against each other, and typing "9" into Min while Max still says 5
	// re-renders the results preview immediately. An inverted range must degrade
	// into the range it spans rather than build zero values and throw on the
	// empty reduce below.
	const low = Math.min(min, max);
	const high = Math.max(min, max);
	const values = Array.from({ length: high - low + 1 }, (_, step) => low + step);
	const weights = values.map((value) =>
		Math.max(0.05, 1 - Math.abs(value - average)),
	);
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const distribution: Record<number, number> = {};
	let assigned = 0;
	values.forEach((value, index) => {
		const count = Math.round((weights[index] / total) * answered);
		distribution[value] = count;
		assigned += count;
	});
	// The rounding remainder lands on the value nearest the mean, so the map adds
	// up to the answers the statement reports rather than to one either side.
	const peak = values.reduce((nearest, value) =>
		Math.abs(value - average) < Math.abs(nearest - average) ? value : nearest,
	);
	distribution[peak] = Math.max(0, distribution[peak] + (answered - assigned));
	return distribution;
}

/** Where the room landed on each statement of a scale (REQ029/REQ030/REQ031). */
function sampleScaleTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const min = slide.scaleMin ?? 1;
	const max = slide.scaleMax ?? 5;
	const statements = slide.scaleStatements ?? [];
	const frame = {
		type: "scale",
		min,
		max,
		minLabel: slide.scaleMinLabel,
		maxLabel: slide.scaleMaxLabel,
		labels: slide.scaleLabels ?? [],
		allowSkip: !!slide.scaleAllowSkip,
	};
	// A skip is only reported where the author allowed one (REQ031); on a slide
	// that does not, a skipped column would describe an answer nobody could give.
	const skipsFor = () =>
		slide.scaleAllowSkip ? between(random, 0, Math.round(SAMPLE_ROOM / 8)) : 0;

	if (statements.length > 0) {
		const perStatement = statements.map((statement) => {
			const skipped = skipsFor();
			const answered = SAMPLE_ROOM - skipped;
			const average = toTwoDecimals(
				min + (max - min) * (0.35 + random() * 0.45),
			);
			return {
				statementId: statement.id,
				text: statement.text,
				totalVotes: SAMPLE_ROOM,
				answered,
				skipped,
				average,
				distribution: sampleScaleDistribution(min, max, average, answered),
			};
		});
		return {
			...frame,
			totalVotes: SAMPLE_ROOM * statements.length,
			statements: perStatement,
		};
	}

	const skipped = skipsFor();
	const answered = SAMPLE_ROOM - skipped;
	const average = toTwoDecimals(min + (max - min) * (0.35 + random() * 0.45));
	return {
		...frame,
		totalVotes: SAMPLE_ROOM,
		average,
		distribution: sampleScaleDistribution(min, max, average, answered),
		skipped,
	};
}

/** The aggregated order a ranking slide exists to produce (REQ033/REQ034). */
function sampleRankingTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const items = slide.rankingItems ?? [];
	const ballots = items.length > 0 ? SAMPLE_ROOM : 0;
	const scored = items.map((item, index) => {
		const rankedCount = ballots - between(random, 0, Math.round(ballots / 8));
		return {
			id: item.id,
			text: item.text,
			// Borda points: the top of the list is worth `items.length`, and the
			// draw only decides how close the neighbours sit.
			points: Math.round(
				rankedCount * (items.length - index) * (0.8 + random() * 0.4),
			),
			rankedCount,
			notRanked: ballots - rankedCount,
		};
	});
	const ordered = [...scored].sort((first, second) => second.points - first.points);
	return {
		type: "ranking",
		totalVotes: ballots * items.length,
		ballots,
		itemCount: items.length,
		// The mean position is read off the *aggregated* order, not the order the
		// author typed the items in: `RankingResults` prints the place and the mean
		// side by side, so a row placed second with a better average position than
		// the row above it would be an ordering contradicting itself on the one
		// slide type whose entire reading is the order. Each row's jitter stays
		// inside its own place, so the two numbers can only ever agree.
		items: ordered.map((item, index) => ({
			...item,
			rank: index + 1,
			averageRank: toTwoDecimals(index + 1 + random() * 0.8),
		})),
	};
}

/** How the room split its hundred points (REQ044/REQ045). */
function samplePointsTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const items = slide.pointsItems ?? [];
	const ballots = items.length > 0 ? SAMPLE_ROOM : 0;
	const shares = shareRoom(random, items.length, POINTS_BUDGET);
	const scored = items.map((item, index) => {
		const funderCount = ballots - between(random, 0, Math.round(ballots / 4));
		return {
			id: item.id,
			text: item.text,
			points: shares[index] * ballots,
			funderCount,
			notFunded: ballots - funderCount,
		};
	});
	const totalPoints = scored.reduce((sum, item) => sum + item.points, 0);
	const ordered = [...scored].sort((first, second) => second.points - first.points);
	return {
		type: "points",
		totalVotes: ballots,
		ballots,
		budget: POINTS_BUDGET,
		itemCount: items.length,
		totalPoints,
		items: ordered.map((item, index) => ({
			...item,
			rank: index + 1,
			share: totalPoints
				? toTwoDecimals((item.points / totalPoints) * 100)
				: 0,
			averagePoints: item.funderCount
				? toTwoDecimals(item.points / item.funderCount)
				: null,
		})),
	};
}

/** Where the room placed each item on the two axes (REQ046/REQ047/REQ050). */
function sampleGridTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const items = slide.gridItems ?? [];
	const { xAxis, yAxis } = gridAxesFor(slide);
	const somewhereOn = (axis: { min: number; max: number }) =>
		axis.min + (axis.max - axis.min) * (0.15 + random() * 0.7);
	const perItem = items.map((item) => {
		// The cluster the average is the centre of: a grid slide's picture is how
		// much the room agreed, so a single mean with nothing behind it would
		// preview the one thing this rendering exists not to be.
		const placements = Array.from({ length: between(random, 5, 9) }, () => ({
			x: toTwoDecimals(somewhereOn(xAxis)),
			y: toTwoDecimals(somewhereOn(yAxis)),
		}));
		const skipped = slide.gridAllowSkip ? between(random, 0, 3) : 0;
		const mean = (values: number[]) =>
			toTwoDecimals(
				values.reduce((sum, one) => sum + one, 0) / placements.length,
			);
		return {
			itemId: item.id,
			text: item.text,
			totalVotes: placements.length + skipped,
			placed: placements.length,
			skipped,
			averageX: mean(placements.map((point) => point.x)),
			averageY: mean(placements.map((point) => point.y)),
			placements,
		};
	});
	return {
		type: "grid",
		totalVotes: perItem.reduce((sum, item) => sum + item.totalVotes, 0),
		itemCount: items.length,
		allowSkip: !!slide.gridAllowSkip,
		xAxis,
		yAxis,
		items: perItem,
	};
}

/** The shape of the room's estimates, in the frame the author set (REQ039–REQ043). */
function sampleGuessTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const range = guessRangeFor(slide);
	const reference = guessReferenceFor(slide);
	const correctRange = correctGuessRangeFor(reference);
	const buckets = guessBucketsFor(range);
	// A crowd clusters: the counts fall away from a peak the draw picks, which is
	// what makes a distribution readable as one rather than as noise.
	const peak = between(random, 0, Math.max(0, buckets.length - 1));
	const counts = buckets.map((_, index) => {
		const distance = Math.abs(index - peak);
		return Math.max(0, Math.round((SAMPLE_ROOM / 3) * 0.55 ** distance));
	});
	const guessCount = counts.reduce((sum, count) => sum + count, 0);
	const midpointOf = (index: number) =>
		(buckets[index].from + buckets[index].to) / 2;
	const guesses = counts.flatMap((count, index) =>
		Array.from({ length: count }, () => midpointOf(index)),
	);
	const sorted = [...guesses].sort((first, second) => first - second);
	const middle = Math.floor(sorted.length / 2);
	const inRange = correctRange
		? guesses.filter(
				(guess) => guess >= correctRange.min && guess <= correctRange.max,
			).length
		: null;
	return {
		type: "guess-number",
		totalVotes: guessCount,
		guessCount,
		range,
		buckets: buckets.map((bucket, index) => ({
			from: bucket.from,
			to: bucket.to,
			count: counts[index],
			share: guessCount
				? toTwoDecimals((counts[index] / guessCount) * 100)
				: 0,
		})),
		lowestGuess: guessCount ? sorted[0] : null,
		highestGuess: guessCount ? sorted[sorted.length - 1] : null,
		averageGuess: guessCount
			? toTwoDecimals(
					guesses.reduce((sum, guess) => sum + guess, 0) / guessCount,
				)
			: null,
		medianGuess: guessCount
			? sorted.length % 2
				? sorted[middle]
				: toTwoDecimals((sorted[middle - 1] + sorted[middle]) / 2)
			: null,
		reference: reference ? reference.value : null,
		tolerance: reference ? reference.tolerance : null,
		correctRange,
		correctCount: inRange,
		correctShare:
			inRange !== null && guessCount
				? toTwoDecimals((inRange / guessCount) * 100)
				: null,
	};
}

/** Where the room pointed, on the picture they were asked to point at (REQ051–REQ053). */
function samplePinTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const image = pinImageFor(slide);
	const area = pinAreaFor(slide);
	// Around a hotspot rather than scattered: a heat map of uniform noise shows
	// nothing about a picture, and a target area is something a room mostly finds.
	const centre = area
		? { x: area.x + area.width / 2, y: area.y + area.height / 2 }
		: {
				x: PIN_COORDINATE_MAX * 0.5,
				y: PIN_COORDINATE_MAX * 0.45,
			};
	const spread = PIN_COORDINATE_MAX * 0.14;
	const clamp = (value: number) =>
		Math.max(0, Math.min(PIN_COORDINATE_MAX, Math.round(value)));
	const pins = image.url
		? Array.from({ length: between(random, 14, 20) }, () => ({
				x: clamp(centre.x + (random() - 0.5) * spread * 2),
				y: clamp(centre.y + (random() - 0.5) * spread * 2),
			}))
		: [];
	const pinCount = pins.length;
	const mean = (values: number[]) =>
		toTwoDecimals(values.reduce((sum, one) => sum + one, 0) / pinCount);
	const inArea = area
		? pins.filter((point) => isPinInArea(point, area)).length
		: null;
	return {
		type: "pin-image",
		totalVotes: pinCount,
		pinCount,
		image: { url: image.url, alt: image.alt },
		pins,
		averageX: pinCount ? mean(pins.map((point) => point.x)) : null,
		averageY: pinCount ? mean(pins.map((point) => point.y)) : null,
		correctArea: area,
		correctCount: inArea,
		correctShare:
			inArea !== null && pinCount
				? toTwoDecimals((inArea / pinCount) * 100)
				: null,
	};
}

/**
 * A form filling up (REQ061) — the fill rate and nothing else, which is the
 * whole rendering that exists for this slide type. What people write never
 * reaches a screen, so there is nothing here to stand in for.
 */
function sampleFormTally(
	slide: Slide,
	random: () => number,
): Record<string, unknown> {
	const fields = formFieldsFor(slide);
	const submissionCount = fields.length > 0 ? Math.round(SAMPLE_ROOM * 0.6) : 0;
	return {
		type: "form",
		totalVotes: submissionCount,
		// The **one field this module will not stand in for.** The wire carries the
		// rows themselves for a caller who can edit the deck — names, addresses,
		// whatever the form asked for — and inventing a plausible set of those is
		// exactly the line the module note draws: counts are the room's, words are
		// the author's, and nobody's personal details are either. `null` is the
		// shape the aggregation emits when it withholds them, and nothing on any
		// screen renders them anyway (see `FormResults`).
		submissions: null,
		submissionCount,
		fieldCount: fields.length,
		fields: fields.map((field) => {
			// A required field is answered by everyone who submitted at all — the
			// boundary refuses a submission that skipped one — so only optional
			// fields have a fill rate below the total.
			const answered = field.required
				? submissionCount
				: submissionCount - between(random, 0, Math.round(submissionCount / 3));
			// A field nobody filled in splits nothing: `shareRoom` keeps every
			// bucket above zero so a quiet option still draws, which is the wrong
			// reading when the denominator itself is zero.
			const counts =
				answered > 0
					? shareRoom(random, field.options.length, answered)
					: field.options.map(() => 0);
			return {
				fieldId: field.id,
				label: field.label,
				type: field.type,
				required: field.required,
				answered,
				options: field.options.map((option, index) => ({
					optionId: option.id,
					text: option.text,
					count: counts[index],
				})),
			};
		}),
	};
}

/**
 * The deck's standings (REQ059) across the quiz questions it actually holds.
 *
 * A deck with none draws the empty board it will really draw: the slide is
 * authored correctly and still has nothing to rank, and a stand-in podium here
 * would hide exactly the thing the author needs to notice.
 */
function sampleLeaderboardTally(
	slide: Slide,
	random: () => number,
	deckQuizCount: number,
): Record<string, unknown> {
	const size = leaderboardSizeFor(slide);
	const maxPoints = deckQuizCount * QUIZ_MAX_POINTS;
	const rankedCount = deckQuizCount > 0 ? SAMPLE_ROOM : 0;
	const rows = Math.min(size, rankedCount);
	let running = Math.round(maxPoints * (0.82 + random() * 0.15));
	const entries = Array.from({ length: rows }, (_, index) => {
		const totalPoints = running;
		running = Math.max(0, running - between(random, 20, 140));
		const correctCount = Math.min(
			deckQuizCount,
			Math.round((totalPoints / Math.max(1, maxPoints)) * deckQuizCount),
		);
		return {
			rank: index + 1,
			// A handle, never a name: the board is anonymous by construction, and a
			// preview that invented "Sarah" would preview a board this deck cannot
			// produce. The label itself is derived by `readLeaderboard`, from this.
			entryId: `sample${String(index + 1).padStart(5, "0")}`,
			totalPoints,
			correctCount,
			answeredCount: deckQuizCount,
		};
	});
	return {
		type: "leaderboard",
		totalVotes: 0,
		quizCount: deckQuizCount,
		maxPoints,
		rankedCount,
		size,
		entries,
	};
}
