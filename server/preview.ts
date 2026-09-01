/**
 * Test votes — synthetic responses for a preview run (REQ104).
 *
 * What this module produces is a **pile of vote rows and nothing else**. It has
 * no store, no route and no clock of its own: everything it needs arrives as an
 * argument, and everything it makes is returned. That is the whole isolation
 * guarantee REQ103/REQ104 stand on, and it is deliberately a property of the
 * module's shape rather than a check inside it — there is no code here that
 * could write a test vote, so there is none to forget to disable. The preview
 * aggregation feeds these rows straight into the same tally a real session's
 * rows go through (`server/services/presentations.ts`), which is what makes a
 * previewed chart the chart the room will actually see.
 *
 * Two further properties are worth stating, because both are load-bearing:
 *
 *  - **Deterministic.** Same deck, same seed, same respondent count → the same
 *    rows, every time. The preview surface polls (a quiz countdown has to keep
 *    running), and a room that reshuffled itself every three seconds would be
 *    unreadable. It also means a test asserts on values rather than on ranges.
 *  - **Submittable.** Every row is built through the same encoders a
 *    participant's phone uses (`encodeRanking`, `encodePoints`,
 *    `encodeGridPoint`, `encodeGuess`, `encodePinPoint`, `encodeQuizAnswer`,
 *    `encodeFormSubmission`) and parsed through
 *    `StoredVoteSchema`, so a synthetic response is the same shape — and passes
 *    the same decoders — as one the vote endpoint would have stored. A test vote
 *    the real boundary would have refused is a preview of a slide that does not
 *    exist.
 */

import {
	acceptedQuizAnswers,
	correctQuizOptionIds,
	encodeFormSubmission,
	encodeGridPoint,
	encodeGuess,
	encodePinPoint,
	encodePoints,
	encodeQuizAnswer,
	encodeRanking,
	FORM_ANSWER_MAX_LENGTH,
	formFieldsFor,
	gridAxesFor,
	guessRangeFor,
	guessReferenceFor,
	isUsableGuessRange,
	matchesQuizAnswer,
	maxSelectionsFor,
	middleGuessValue,
	normalizeQuestionText,
	PIN_COORDINATE_MAX,
	pinAreaFor,
	pinImageFor,
	POINTS_BUDGET,
	quizAnswerModeFor,
	quizTimeLimitFor,
	type Slide,
	snapGuessToGrid,
	type StoredResponseVote,
	StoredResponseVoteSchema,
	type StoredVote,
	StoredVoteSchema,
} from "./schemas";

// ── The run ──────────────────────────────────────────────────

/** What one preview run is: a deck, a size, a seed, and when it opened. */
export type TestVoteRun = {
	/** The deck the rows are addressed to — never used to read or write it. */
	presentationId: string;
	/** Synthetic respondents to simulate (REQ104). */
	respondents: number;
	/** Which run to reproduce; the same seed yields the same rows. */
	seed: number;
	/** When this run's questions opened, ISO — what a quiz answer is timed from. */
	startedAt: string;
};

/**
 * Everything one preview run generated: the votes, and the open-ended upvotes
 * that ride beside them (REQ025). Two lists rather than one because they are two
 * collections in a real session, and the aggregation reads them separately.
 */
export type TestVoteSet = {
	votes: StoredVote[];
	responseVotes: StoredResponseVote[];
};

/** The empty run — a deck with nothing to populate, or `respondents: 0`. */
export function emptyTestVoteSet(): TestVoteSet {
	return { votes: [], responseVotes: [] };
}

// ── Determinism ──────────────────────────────────────────────

/**
 * A small deterministic generator (mulberry32), because `Math.random()` would
 * make every poll a different room. Factory-shaped per ADR-0007: the state is
 * the closure, and each slide gets its own so adding a slide to a deck does not
 * reshuffle the answers on the slides before it.
 */
function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
		drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
		return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fold a slide id into the run's seed, so each slide draws its own room. */
function seedForSlide(seed: number, slideId: string): number {
	let folded = seed >>> 0;
	for (let index = 0; index < slideId.length; index++) {
		folded = (Math.imul(folded, 31) + slideId.charCodeAt(index)) >>> 0;
	}
	return folded;
}

/** A whole number in `[0, bound)`. */
function pickIndex(random: () => number, bound: number): number {
	return Math.min(bound - 1, Math.floor(random() * bound));
}

/**
 * Draw one index from a weighted list. Weights need not sum to anything; a list
 * that sums to zero falls back to the first entry rather than running off the
 * end.
 */
function pickWeighted(random: () => number, weights: number[]): number {
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	if (total <= 0) return 0;
	let remaining = random() * total;
	for (let index = 0; index < weights.length; index++) {
		remaining -= weights[index];
		if (remaining <= 0) return index;
	}
	return weights.length - 1;
}

/**
 * A popularity weight per entry — what makes a previewed chart look like a room
 * that had opinions rather than a uniform smear. Drawn from the slide's own
 * generator, so which option wins is a property of the seed and stays put across
 * a poll.
 */
function popularityWeights(random: () => number, count: number): number[] {
	return Array.from({ length: count }, () => 0.15 + random() * random());
}

// ── The words a preview puts on screen ───────────────────────
//
// Deliberately generic and deliberately short. A test vote is scaffolding an
// organizer reads *past* — the question being previewed is "does this chart
// work", not "what did the room say" — so the vocabulary is neutral filler with
// enough repetition to give a word cloud sizes and enough length variation to
// show an open-text wall its longest row.

const PREVIEW_WORDS = [
	"clarity",
	"momentum",
	"focus",
	"trust",
	"speed",
	"quality",
	"teamwork",
	"budget",
	"scope",
	"risk",
	"impact",
	"simplicity",
	"ownership",
	"feedback",
	"alignment",
	"delivery",
];

const PREVIEW_SENTENCES = [
	"More time for deep work.",
	"Clearer priorities before the sprint starts.",
	"Fewer meetings, better agendas.",
	"A shared definition of done.",
	"Faster feedback on drafts.",
	"Someone owning the decision at the end.",
	"Less context switching across projects.",
	"Better handover notes between teams.",
	"Room to fix the things we keep working around.",
	"A roadmap we can actually explain to customers.",
];

/**
 * Plausible wrong answers for a typed quiz question (REQ055). Anything that
 * happens to match one of the organizer's accepted solutions is filtered out at
 * the call site — a "wrong" answer that scored would misreport the room.
 */
/**
 * Names and the addresses that go with them, for a Form slide's preview
 * (REQ061). Paired rather than drawn independently so a previewed row reads as
 * one person — `ada.lovelace@example.org` beside "Ada Lovelace" — which is what
 * the organizer is checking when they look at the table: does a submission read
 * as somebody, and is the column wide enough for them?
 *
 * `example.org` throughout, because these strings land in the organizer's export
 * and the reserved domain is the one guarantee that a test row can never be an
 * address that reaches a real person.
 */
const PREVIEW_PEOPLE = [
	{ name: "Ada Lovelace", email: "ada.lovelace@example.org" },
	{ name: "Grace Hopper", email: "grace.hopper@example.org" },
	{ name: "Alan Turing", email: "alan.turing@example.org" },
	{ name: "Katherine Johnson", email: "k.johnson@example.org" },
	{ name: "Tim Berners-Lee", email: "tim.bl@example.org" },
	{ name: "Radia Perlman", email: "radia.perlman@example.org" },
	{ name: "Barbara Liskov", email: "b.liskov@example.org" },
	{ name: "Donald Knuth", email: "d.knuth@example.org" },
];

/** Short free-text answers for a form's `text` fields. */
const PREVIEW_FORM_TEXT = [
	"Engineering",
	"Product",
	"Northwind Ltd",
	"Second time here",
	"Found it through a colleague",
	"Design systems",
];

const PREVIEW_WRONG_ANSWERS = [
	"Not sure",
	"Vienna",
	"1985",
	"Copper",
	"Ada Lovelace",
	"Forty two",
	"The second one",
];

// ── Rows ─────────────────────────────────────────────────────

/** The participant behind synthetic row `index` — one person across the deck. */
function previewParticipantId(index: number): string {
	return `preview-participant-${index + 1}`;
}

/**
 * Build one vote row, parsed through the stored schema so a synthetic response
 * is provably the shape a real one is (ADR-0013). Nothing here inserts it.
 */
function testVote(
	run: TestVoteRun,
	slideId: string,
	ordinal: number,
	fields: {
		value: string;
		participantId: string;
		statementId?: string | null;
		skip?: boolean;
		createdAt?: string;
	},
): StoredVote {
	return StoredVoteSchema.parse({
		id: `preview-vote-${slideId}-${ordinal}`,
		presentationId: run.presentationId,
		slideId,
		value: fields.value,
		participantId: fields.participantId,
		statementId: fields.statementId ?? null,
		skip: fields.skip ?? false,
		createdAt: fields.createdAt ?? run.startedAt,
	});
}

/** How long after the run opened a synthetic answer landed, as an ISO instant. */
function answeredAt(run: TestVoteRun, elapsedMs: number): string {
	return new Date(Date.parse(run.startedAt) + Math.round(elapsedMs)).toISOString();
}

// ── Per slide type ───────────────────────────────────────────
//
// One generator per interactive slide type, each producing exactly the shape its
// own tally reads back. They are separate functions rather than one switch body
// because what makes a *plausible* room differs per type — a ranking wants a
// broadly-agreed order with disagreement at the edges, a 100 Points ballot wants
// a spend that sums to the budget, a guess wants a cluster with outliers — and
// that judgement is the only thing here worth reading.

function choiceVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	const options = slide.options ?? [];
	if (options.length === 0) return [];
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const weights = popularityWeights(random, options.length);
	const limit = maxSelectionsFor(slide);
	// An unlimited multi-select is capped at the option count; a capped one at
	// whichever is smaller. One selection is always allowed, so the floor is 1.
	const ceiling =
		limit === 1
			? 1
			: Math.max(1, Math.min(limit === 0 ? options.length : limit, options.length));

	const rows: StoredVote[] = [];
	for (let respondent = 0; respondent < run.respondents; respondent++) {
		const participantId = previewParticipantId(respondent);
		// Most people pick one thing even when they may pick several — a preview
		// that had everybody ticking the cap would flatten every bar to the same
		// height and hide exactly what multi-select does to a chart.
		const selections =
			ceiling === 1 ? 1 : 1 + pickIndex(random, Math.min(ceiling, 3));
		const taken = new Set<number>();
		while (taken.size < selections) {
			const chosen = pickWeighted(random, weights);
			if (taken.has(chosen)) {
				// Weighted draws repeat; walk to the next free option rather than
				// spinning, so a lopsided weight set still terminates.
				let next = (chosen + 1) % options.length;
				while (taken.has(next)) next = (next + 1) % options.length;
				taken.add(next);
				continue;
			}
			taken.add(chosen);
		}
		for (const optionIndex of taken) {
			rows.push(
				testVote(run, slide.id, rows.length, {
					value: options[optionIndex].id,
					participantId,
				}),
			);
		}
	}
	return rows;
}

function quizVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const mode = quizAnswerModeFor(slide);
	const timeLimit = quizTimeLimitFor(slide);
	// An untimed question is not scored on speed, so the spread only has to be
	// plausible; a timed one has to land inside its own window or the tally would
	// preview a room that answered after the buzzer.
	const windowMs = (timeLimit ?? 30) * 1000 * 0.85;

	const answers: string[] = [];
	if (mode === "type") {
		const accepted = acceptedQuizAnswers(slide);
		const wrong = PREVIEW_WRONG_ANSWERS.filter(
			(candidate) => !matchesQuizAnswer(slide, candidate),
		);
		if (accepted.length === 0 && wrong.length === 0) return [];
		for (let respondent = 0; respondent < run.respondents; respondent++) {
			// Roughly three in five know it — enough that the correct answer is the
			// tallest row a typed tally groups, without a preview that reads as a
			// question nobody could get wrong.
			const knowsIt = accepted.length > 0 && random() < 0.6;
			if (knowsIt) {
				const spelling = accepted[pickIndex(random, accepted.length)];
				// Case and a trailing stop, so the preview also shows the grouping
				// (REQ055) folding three spellings into one row.
				answers.push(
					random() < 0.25
						? `${spelling.toLowerCase()}.`
						: encodeQuizAnswer(spelling),
				);
				continue;
			}
			answers.push(
				wrong.length > 0
					? wrong[pickIndex(random, wrong.length)]
					: encodeQuizAnswer(accepted[pickIndex(random, accepted.length)]),
			);
		}
	} else {
		const options = slide.options ?? [];
		if (options.length === 0) return [];
		const correct = correctQuizOptionIds(slide);
		const wrong = options
			.map((option) => option.id)
			.filter((optionId) => !correct.includes(optionId));
		const distractorWeights = popularityWeights(random, Math.max(1, wrong.length));
		for (let respondent = 0; respondent < run.respondents; respondent++) {
			const knowsIt = correct.length > 0 && random() < 0.6;
			if (knowsIt) {
				answers.push(correct[pickIndex(random, correct.length)]);
				continue;
			}
			answers.push(
				wrong.length > 0
					? wrong[pickWeighted(random, distractorWeights)]
					: options[pickIndex(random, options.length)].id,
			);
		}
	}

	// One answer per participant, final — the rule the boundary enforces
	// (REQ054), so a preview that broke it would score a room that cannot exist.
	return answers.map((answer, respondent) =>
		testVote(run, slide.id, respondent, {
			value: answer,
			participantId: previewParticipantId(respondent),
			createdAt: answeredAt(run, random() * windowMs),
		}),
	);
}

/** The response cap on a word-cloud / open-text slide (REQ022, REQ026). */
function responseCapFor(slide: Slide): number {
	if (typeof slide.maxResponses === "number") return slide.maxResponses;
	return slide.allowMultiple ? 0 : 1;
}

function wordCloudVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const weights = popularityWeights(random, PREVIEW_WORDS.length);
	const cap = responseCapFor(slide);
	// Three is the ceiling on an unlimited slide: a cloud wants repetition, and
	// past a handful per person the sizes say more about the generator than the
	// slide.
	const perParticipant = cap === 0 ? 3 : Math.min(cap, 3);

	const rows: StoredVote[] = [];
	for (let respondent = 0; respondent < run.respondents; respondent++) {
		const participantId = previewParticipantId(respondent);
		const count = 1 + pickIndex(random, perParticipant);
		for (let submission = 0; submission < count; submission++) {
			rows.push(
				testVote(run, slide.id, rows.length, {
					value: PREVIEW_WORDS[pickWeighted(random, weights)],
					participantId,
				}),
			);
		}
	}
	return rows;
}

function openTextVotes(slide: Slide, run: TestVoteRun): TestVoteSet {
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const weights = popularityWeights(random, PREVIEW_SENTENCES.length);
	const cap = responseCapFor(slide);
	const perParticipant = cap === 0 ? 2 : Math.min(cap, 2);
	const foldsDuplicates = !!slide.allowResponseVotes;

	const votes: StoredVote[] = [];
	const responseVotes: StoredResponseVote[] = [];
	// REQ025 — on a slide that collects upvotes, the vote endpoint turns a
	// re-typed response into an upvote on the one already there rather than a
	// second row (`normalizeQuestionText`). The preview has to do the same or it
	// would draw four identical cards where a real room draws one card with four
	// upvotes — a picture of this slide that this slide never produces.
	const byText = new Map<string, StoredVote>();
	const upvoters = new Map<string, Set<string>>();

	const addUpvote = (response: StoredVote, participantId: string) => {
		if (participantId === response.participantId) return;
		const held = upvoters.get(response.id) ?? new Set<string>();
		if (held.has(participantId)) return;
		held.add(participantId);
		upvoters.set(response.id, held);
		responseVotes.push(
			StoredResponseVoteSchema.parse({
				id: `preview-response-vote-${slide.id}-${responseVotes.length}`,
				presentationId: run.presentationId,
				slideId: slide.id,
				responseId: response.id,
				participantId,
				createdAt: run.startedAt,
			}),
		);
	};

	for (let respondent = 0; respondent < run.respondents; respondent++) {
		const participantId = previewParticipantId(respondent);
		const count = 1 + pickIndex(random, perParticipant);
		for (let submission = 0; submission < count; submission++) {
			const text = PREVIEW_SENTENCES[pickWeighted(random, weights)];
			const existing = foldsDuplicates
				? byText.get(normalizeQuestionText(text))
				: undefined;
			if (existing) {
				addUpvote(existing, participantId);
				continue;
			}
			const vote = testVote(run, slide.id, votes.length, {
				value: text,
				participantId,
			});
			votes.push(vote);
			if (foldsDuplicates) byText.set(normalizeQuestionText(text), vote);
		}
	}

	// Beyond the folds, the room also upvotes responses it did not happen to type
	// itself — which is the gesture REQ025 exists for, and what gives a preview
	// its spread of counts rather than one tall row.
	if (foldsDuplicates) {
		for (const response of votes) {
			for (let respondent = 0; respondent < run.respondents; respondent++) {
				if (random() > 0.18) continue;
				addUpvote(response, previewParticipantId(respondent));
			}
		}
	}

	return { votes, responseVotes };
}

/** A rating near `centre`, kept inside the authored scale. */
function ratingNear(
	random: () => number,
	centre: number,
	min: number,
	max: number,
): number {
	// Two draws summed, so the ratings pile up around the centre instead of
	// spreading flat — a scale slide's whole picture is where the mass sits.
	const drift = Math.round((random() + random() - 1) * ((max - min) / 3));
	return Math.min(max, Math.max(min, centre + drift));
}

function scaleVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const min = slide.scaleMin ?? 1;
	const max = slide.scaleMax ?? 5;
	if (max <= min) return [];
	const statements = slide.scaleStatements ?? [];
	const allowSkip = !!slide.scaleAllowSkip;

	const rows: StoredVote[] = [];
	if (statements.length === 0) {
		const centre = min + 1 + pickIndex(random, Math.max(1, max - min - 1));
		for (let respondent = 0; respondent < run.respondents; respondent++) {
			rows.push(
				testVote(run, slide.id, rows.length, {
					value: String(ratingNear(random, centre, min, max)),
					participantId: previewParticipantId(respondent),
				}),
			);
		}
		return rows;
	}

	// One row per statement per participant, which is how the real slide votes
	// (REQ029) — a statement is answered on its own and skipped on its own.
	for (const statement of statements) {
		const centre = min + 1 + pickIndex(random, Math.max(1, max - min - 1));
		for (let respondent = 0; respondent < run.respondents; respondent++) {
			const skipped = allowSkip && random() < 0.1;
			rows.push(
				testVote(run, slide.id, rows.length, {
					value: skipped ? "0" : String(ratingNear(random, centre, min, max)),
					participantId: previewParticipantId(respondent),
					statementId: statement.id,
					skip: skipped,
				}),
			);
		}
	}
	return rows;
}

function rankingVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	const items = slide.rankingItems ?? [];
	if (items.length === 0) return [];
	const random = createRandom(seedForSlide(run.seed, slide.id));
	// A "true" order the room broadly agrees on, with per-ballot noise on top:
	// that is what produces an aggregated ranking with a clear top and a contested
	// middle, which is the picture the slide exists to draw.
	const consensus = popularityWeights(random, items.length);

	const rows: StoredVote[] = [];
	for (let respondent = 0; respondent < run.respondents; respondent++) {
		const scored = items.map((item, itemIndex) => ({
			id: item.id,
			score: consensus[itemIndex] + random() * 0.6,
		}));
		scored.sort((left, right) => right.score - left.score);
		let order = scored.map((entry) => entry.id);
		// REQ034 — some participants rank only part of the list, which is what
		// gives the tally a `notRanked` count to show.
		if (order.length >= 3 && random() < 0.2) {
			order = order.slice(0, order.length - 1 - pickIndex(random, 2));
		}
		if (order.length === 0) continue;
		rows.push(
			testVote(run, slide.id, rows.length, {
				value: encodeRanking(order),
				participantId: previewParticipantId(respondent),
			}),
		);
	}
	return rows;
}

function pointsVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	const items = slide.pointsItems ?? [];
	if (items.length === 0) return [];
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const consensus = popularityWeights(random, items.length);

	const rows: StoredVote[] = [];
	for (let respondent = 0; respondent < run.respondents; respondent++) {
		const weights = consensus.map((weight) => weight * (0.4 + random()));
		const total = weights.reduce((sum, weight) => sum + weight, 0);
		const allocation: Record<string, number> = {};
		let spent = 0;
		items.forEach((item, itemIndex) => {
			const share = Math.floor((weights[itemIndex] / total) * POINTS_BUDGET);
			allocation[item.id] = share;
			spent += share;
		});
		// The budget is spent to the last point, because that is what the codec
		// requires (`decodePoints`) — a preview ballot the boundary would refuse is
		// a ballot the tally would drop, and the slide would preview empty.
		allocation[items[0].id] += POINTS_BUDGET - spent;
		rows.push(
			testVote(run, slide.id, rows.length, {
				value: encodePoints(allocation),
				participantId: previewParticipantId(respondent),
			}),
		);
	}
	return rows;
}

function guessVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	const range = guessRangeFor(slide);
	if (!isUsableGuessRange(range)) return [];
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const reference = guessReferenceFor(slide);
	// A room guesses around the truth when there is one, and around the middle of
	// the range when there is not (REQ041) — which is also what makes the
	// correct-share badge show something on a slide that has a reference.
	const centre = snapGuessToGrid(
		reference ? reference.value : middleGuessValue(range),
		range,
	);
	const spread = Math.max(range.step, Math.round((range.max - range.min) / 6));

	const rows: StoredVote[] = [];
	for (let respondent = 0; respondent < run.respondents; respondent++) {
		const drift = (random() + random() - 1) * spread * 2;
		const guess = snapGuessToGrid(Math.round(centre + drift), range);
		rows.push(
			testVote(run, slide.id, rows.length, {
				value: encodeGuess(guess),
				participantId: previewParticipantId(respondent),
			}),
		);
	}
	return rows;
}

function pinVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	// REQ052 — no image, no coordinate space, and the vote boundary refuses every
	// submission to such a slide. A preview that generated pins anyway would draw
	// a cloud on a picture that does not exist.
	if (!pinImageFor(slide).url) return [];
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const area = pinAreaFor(slide);
	// A room aims at the target when there is one (REQ053) — which is also what
	// makes the correct-share badge show something on a hotspot slide — and spreads
	// around the middle of the picture when there is not.
	//
	// The spread is a little under one target-width, which lands roughly two in
	// three pins inside the box: enough that the target is visibly where the room
	// aimed, and not so many that the slide previews as a question nobody could get
	// wrong. Both halves matter to what the organizer is looking at — a preview
	// with a 100% hit rate tells them nothing about how the miss pattern will read.
	const centre = area
		? { x: area.x + area.width / 2, y: area.y + area.height / 2 }
		: { x: PIN_COORDINATE_MAX / 2, y: PIN_COORDINATE_MAX / 2 };
	const spread = area
		? { x: Math.max(1, area.width * 0.85), y: Math.max(1, area.height * 0.85) }
		: { x: PIN_COORDINATE_MAX / 5, y: PIN_COORDINATE_MAX / 5 };

	const onImage = (value: number) =>
		Math.min(PIN_COORDINATE_MAX, Math.max(0, Math.round(value)));

	const rows: StoredVote[] = [];
	for (let respondent = 0; respondent < run.respondents; respondent++) {
		rows.push(
			testVote(run, slide.id, rows.length, {
				value: encodePinPoint({
					x: onImage(centre.x + (random() + random() - 1) * spread.x),
					y: onImage(centre.y + (random() + random() - 1) * spread.y),
				}),
				participantId: previewParticipantId(respondent),
			}),
		);
	}
	return rows;
}

function formVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	// REQ061 — no usable field, no question, and the vote boundary refuses every
	// submission to such a slide. A preview that generated rows anyway would draw
	// a table of answers to questions that are not being asked.
	const fields = formFieldsFor(slide);
	if (fields.length === 0) return [];
	const random = createRandom(seedForSlide(run.seed, slide.id));
	// Per choice field, so the picks split unevenly the way a real room's do —
	// a flat split would hide exactly what the bar chart under a choice field is
	// for.
	const choiceWeights = new Map(
		fields
			.filter((field) => field.type === "choice")
			.map((field) => [field.id, popularityWeights(random, field.options.length)]),
	);

	const rows: StoredVote[] = [];
	for (let respondent = 0; respondent < run.respondents; respondent++) {
		const person = PREVIEW_PEOPLE[respondent % PREVIEW_PEOPLE.length];
		const answers: Record<string, string> = {};
		for (const field of fields) {
			// An optional field is left blank now and then, which is what gives the
			// per-field "answered" counts something to differ about. A required one
			// never is — the boundary would refuse the row, and the slide would
			// preview empty.
			if (!field.required && random() < 0.15) continue;
			if (field.type === "email") {
				answers[field.id] = person.email;
				continue;
			}
			if (field.type === "choice") {
				const weights = choiceWeights.get(field.id) ?? [];
				const picked = field.options[pickWeighted(random, weights)];
				if (picked) answers[field.id] = picked.id;
				continue;
			}
			// A name field asks for a name; anything else gets neutral filler. The
			// label is what says which, because that is all the slide tells us.
			const asksForName = /name/i.test(field.label);
			answers[field.id] = asksForName
				? person.name
				: PREVIEW_FORM_TEXT[pickIndex(random, PREVIEW_FORM_TEXT.length)];
		}
		const value = encodeFormSubmission(answers);
		// Nothing written is not a submission the boundary would accept
		// (`decodeFormSubmission`), so it is not a row a preview may invent — and
		// neither is one past the per-field cap, which the filler never reaches but
		// which is asserted rather than assumed.
		if (value.length === 0) continue;
		if (
			Object.values(answers).some(
				(answer) => answer.length > FORM_ANSWER_MAX_LENGTH,
			)
		) {
			continue;
		}
		rows.push(
			testVote(run, slide.id, rows.length, {
				value,
				participantId: previewParticipantId(respondent),
			}),
		);
	}
	return rows;
}

function gridVotes(slide: Slide, run: TestVoteRun): StoredVote[] {
	const items = slide.gridItems ?? [];
	if (items.length === 0) return [];
	const random = createRandom(seedForSlide(run.seed, slide.id));
	const { xAxis, yAxis } = gridAxesFor(slide);
	if (xAxis.max <= xAxis.min || yAxis.max <= yAxis.min) return [];
	const allowSkip = !!slide.gridAllowSkip;

	const rows: StoredVote[] = [];
	for (const item of items) {
		// Each item gets its own cluster centre, so the plot shows items sitting in
		// different quadrants rather than one blob in the middle.
		const centreX = xAxis.min + Math.round(random() * (xAxis.max - xAxis.min));
		const centreY = yAxis.min + Math.round(random() * (yAxis.max - yAxis.min));
		const spreadX = Math.max(1, Math.round((xAxis.max - xAxis.min) / 6));
		const spreadY = Math.max(1, Math.round((yAxis.max - yAxis.min) / 6));
		for (let respondent = 0; respondent < run.respondents; respondent++) {
			const skipped = allowSkip && random() < 0.08;
			const point = {
				x: Math.min(
					xAxis.max,
					Math.max(
						xAxis.min,
						centreX + Math.round((random() + random() - 1) * spreadX * 2),
					),
				),
				y: Math.min(
					yAxis.max,
					Math.max(
						yAxis.min,
						centreY + Math.round((random() + random() - 1) * spreadY * 2),
					),
				),
			};
			rows.push(
				testVote(run, slide.id, rows.length, {
					value: encodeGridPoint(point),
					participantId: previewParticipantId(respondent),
					statementId: item.id,
					skip: skipped,
				}),
			);
		}
	}
	return rows;
}

// ── The deck ─────────────────────────────────────────────────

/**
 * Test votes for one slide (REQ104). A slide type that collects nothing — a
 * content slide, or a leaderboard, which reports on the quiz questions around it
 * — generates nothing, and that is not a gap: a board fills up because the quiz
 * slides beside it did.
 */
export function generateSlideTestVotes(
	slide: Slide,
	run: TestVoteRun,
): TestVoteSet {
	if (run.respondents <= 0) return emptyTestVoteSet();
	switch (slide.type) {
		case "multiple-choice":
			return { votes: choiceVotes(slide, run), responseVotes: [] };
		case "quiz":
			return { votes: quizVotes(slide, run), responseVotes: [] };
		case "word-cloud":
			return { votes: wordCloudVotes(slide, run), responseVotes: [] };
		case "open-text":
			return openTextVotes(slide, run);
		case "scale":
			return { votes: scaleVotes(slide, run), responseVotes: [] };
		case "ranking":
			return { votes: rankingVotes(slide, run), responseVotes: [] };
		case "points":
			return { votes: pointsVotes(slide, run), responseVotes: [] };
		case "guess-number":
			return { votes: guessVotes(slide, run), responseVotes: [] };
		case "pin-image":
			return { votes: pinVotes(slide, run), responseVotes: [] };
		case "grid":
			return { votes: gridVotes(slide, run), responseVotes: [] };
		case "form":
			return { votes: formVotes(slide, run), responseVotes: [] };
		default:
			return emptyTestVoteSet();
	}
}

/** Test votes for a whole deck — every slide's rows, in deck order. */
export function generateDeckTestVotes(
	slides: Slide[],
	run: TestVoteRun,
): TestVoteSet {
	const set = emptyTestVoteSet();
	for (const slide of slides) {
		const generated = generateSlideTestVotes(slide, run);
		set.votes.push(...generated.votes);
		set.responseVotes.push(...generated.responseVotes);
	}
	return set;
}
