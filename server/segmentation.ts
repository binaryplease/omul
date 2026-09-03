/**
 * Breaking one slide's tally down by an earlier slide's answers (REQ020,
 * REQ116).
 *
 * The whole feature is a **join on participant id**: the room answered slide 2,
 * the same room answered slide 7, and the question segmentation answers is "what
 * did the people who picked *this* on slide 2 say on slide 7?". Nothing here
 * computes a tally — that is `aggregateSlideResults`' job, and it stays its job:
 * this module decides only **who is in which group**, and the service hands each
 * group's participants to the very same aggregation an unsegmented read goes
 * through. A segment's numbers are therefore the numbers that surface would have
 * drawn for a room of exactly those people, by construction rather than by two
 * implementations agreeing (the reason the preview seam exists too).
 *
 * Three things live here, and they are the three both ends need:
 *
 *  - {@link segmentSourcesFor} — the **descriptor**. Which earlier slides can
 *    group this one, and, for each that cannot, why not in words. The picker on
 *    the results surface is drawn from it and the endpoint validates against it,
 *    so a slide the UI offers is a slide the API accepts and a refusal the API
 *    gives is a refusal the UI already explained (the ineligible
 *    entries are drawn disabled with their reason, never dropped from the menu).
 *  - {@link segmentBucketsFor} — the **join**. One group per authored answer on
 *    the source slide, plus the explicit group of people who did not answer it.
 *  - {@link segmentTallyVisible} — the **disclosure guard**. A group of one is a
 *    person, and their answers to the segmented slide are that person's answers.
 *    See below.
 *
 * It depends on `./schemas` and nothing else — no store, no route, no clock — so
 * the browser composes the same descriptor the server enforces by importing it
 * (a unit of code lives where its dependencies are).
 */

import {
	isMultiSelect,
	isStandingQuizAnswer,
	type QuizAnswerMode,
	quizAnswerModeFor,
	type ResultsCaller,
	slideHasResults,
	type SlideType,
} from "./schemas";

// ── The disclosure guard ─────────────────────────────────────

/**
 * How many people must stand behind a segment before its tally is published to
 * a caller who cannot edit the deck.
 *
 * Segmentation is the one read in this product that can turn two anonymous
 * tallies into an attributable one. "Of the 14 people who answered, 1 picked
 * Marketing" is a count; *that person's* answer to the next question, drawn as
 * their own chart, is a name away from being a quote with a name on it. The
 * marginal tallies both endpoints already publish cannot do that — the join is
 * what does — so the join is where the floor belongs.
 *
 * Five is the small-cell threshold disclosure control conventionally uses, and
 * it is the **default rather than a setting**: nothing loosens it short of
 * proving you authored the deck. An editor (owner or edit token) reads every
 * segment whatever its size — they may already download every row beside the
 * participant id it was cast under (REQ095), so withholding it here would
 * protect nobody from anybody.
 */
export const SEGMENT_MIN_RESPONDENTS = 5;

/**
 * Which groups of a breakdown may be published to this caller — decided over the
 * **whole set at once**, never one group at a time.
 *
 * Deciding it per group is wrong, and wrong in the way that matters: the groups
 * partition the people who answered the slide, and the unsegmented tally is
 * readable by the very same caller on the very same terms. So the answers of the
 * groups that were held back are `unsegmented − Σ(published)` — arithmetic, not
 * an attack. Hold back exactly one group of one person and you have published
 * that person's answers under a different heading, verbatim text and all.
 *
 * Hence **complementary suppression**, the standard answer in disclosure
 * control: whenever a group has to be held back, at least one more group holding
 * people is held back with it, so every residual mixes at least two groups and
 * points at nobody. The complement is the smallest group that clears the floor,
 * because it is the one whose loss costs the reader least.
 *
 * Three details the rule turns on:
 *
 *  - **Empty groups are always published.** A group nobody is in discloses
 *    nothing and contributes nothing to a residual, so counting one as "held
 *    back" would satisfy the rule while defeating it.
 *  - **A breakdown with only one non-empty group publishes nothing extra by
 *    holding it back**, and it is held back all the same: that group *is* the
 *    room, so the residual is the unsegmented tally the caller may already read,
 *    and there is nothing to pair it with.
 *  - **The deck's results link (REQ098) does not lift any of this.** The link
 *    delegates a read of the organizer's numbers, which is what the reveal mode
 *    governs and what REQ098 says it grants. A group of one is not a number
 *    about the room, it is one participant's answers. An editor (owner or edit
 *    token) reads every group whatever its size — they may already download
 *    every row beside the participant id it was cast under (REQ095), so
 *    withholding it from them would protect nobody from anybody.
 *
 * Returns one flag per group, in the order given: `true` where the group's tally
 * may be sent.
 */
export function segmentDisclosure(
	respondentCounts: readonly number[],
	caller: ResultsCaller,
): boolean[] {
	if (caller.canEdit) return respondentCounts.map(() => true);

	const held = new Set<number>();
	respondentCounts.forEach((count, index) => {
		if (count > 0 && count < SEGMENT_MIN_RESPONDENTS) held.add(index);
	});
	if (held.size === 1) {
		// Smallest first, so the complement costs the reader as little as possible;
		// ties break on position, so the same room always reads the same way.
		const complement = respondentCounts
			.map((count, index) => ({ count, index }))
			.filter((group) => group.count > 0 && !held.has(group.index))
			.sort((left, right) => left.count - right.count || left.index - right.index)[0];
		if (complement) held.add(complement.index);
	}
	return respondentCounts.map((_, index) => !held.has(index));
}

// ── What a breakdown may be published *of* ───────────────────

/**
 * The slide types whose tally is a count over an authored set — and nothing
 * else. The only slides a breakdown of is published to a caller who cannot edit
 * the deck.
 *
 * The floor above bounds how *few* people a published group may hold. It cannot
 * bound what one group's payload says about them, and for a slide whose tally is
 * a **list with one entry per respondent** that is the whole disclosure: a group
 * of eight open-text answers is eight verbatim sentences attributed to whoever
 * gave the grouping answer, and the same sentence is matchable across two
 * breakdowns of that slide by different groupings. Intersect "Marketing" from
 * one with "ten years here" from another and a group of five meets a group of
 * six in one person — every group clearing the floor the whole way down.
 *
 * So the cut is made on what the payload *carries* rather than on how many
 * people it took: a distribution over options a room was offered says something
 * about the room, a row somebody wrote says something about them.
 *
 * Left out, and each for that reason: `open-text` (`responses`, one per
 * submission), `word-cloud` (a word one person wrote is an entry of its own),
 * `pin-image` (`pins`), `grid` (`items[].placements`), `guess-number` (its
 * lowest, highest and median are somebody's actual guess) and `leaderboard`
 * (`entries`, one per participant, under a handle that is stable across every
 * breakdown). An editor reads a breakdown of all of them.
 */
export const AGGREGATE_TALLY_TYPES: readonly SlideType[] = [
	"multiple-choice",
	"quiz",
	"scale",
	"ranking",
	"points",
	"form",
];

/**
 * Whether a breakdown **of this slide** may be published to a caller who cannot
 * edit the deck (see {@link AGGREGATE_TALLY_TYPES}).
 *
 * A typed quiz question is the exception inside the list: once its question is
 * over it publishes what the room wrote, one entry per answer (REQ055), which is
 * the same per-respondent row an open-text slide carries all along.
 */
export function segmentedTallyIsAggregate(slide: SegmentSlide): boolean {
	if (!AGGREGATE_TALLY_TYPES.includes(slide.type)) return false;
	return !(slide.type === "quiz" && quizAnswerModeFor(slide) === "type");
}

// ── Which slides can group another one ───────────────────────

/** Why a slide cannot serve as the thing another slide's results are grouped by. */
export type SegmentRefusal =
	| "unknown-slide"
	| "same-slide"
	| "not-earlier"
	| "no-tally"
	| "no-answers"
	| "multi-select"
	| "typed-answers"
	| "unsupported-type";

/**
 * What each refusal says, in the words a person reads.
 *
 * One spelling, because the same sentence is owed in two places: the picker
 * draws it under a disabled entry, and the endpoint returns it when a request
 * names that slide anyway. A menu that explains a refusal one way while the API
 * explains it another is two products.
 */
export const SEGMENT_REFUSAL_REASONS: Record<SegmentRefusal, string> = {
	"unknown-slide": "That slide is not part of this deck.",
	"same-slide": "A slide cannot group its own results by itself.",
	"not-earlier":
		"It comes later in the deck. A breakdown reads backwards: only a slide the same people had already answered can group them.",
	// The one refusal about the slide being broken *down* rather than the one
	// doing the grouping — a title card has no tally to split.
	"no-tally": "That slide has no results to break down.",
	"no-answers":
		"It collects no answers of its own, so there is nothing to group people by.",
	"multi-select":
		"Its participants may pick more than one option, so a single person would land in several groups at once.",
	"typed-answers":
		"Its answers are typed rather than picked, so there is no fixed set of groups to split the room into.",
	"unsupported-type":
		"Its answers are not one choice from a fixed set, so they do not divide the room into groups.",
};

/**
 * The fields this module reads off a slide — never the whole schema type.
 *
 * Narrow on purpose, and every field optional but the two that identify it: the
 * browser holds slides built from the schema's *input* type, where every
 * defaulted field is still optional, and the server holds them parsed. Both must
 * be able to call this, so it asks for what it actually reads and nothing more.
 */
export type SegmentSlide = {
	id: string;
	type: SlideType;
	question?: string | undefined;
	options?:
		| { id: string; text?: string | undefined; isCorrect?: boolean | undefined }[]
		| undefined;
	mcMaxSelections?: number | null | undefined;
	allowMultiple?: boolean | undefined;
	quizAnswerMode?: QuizAnswerMode | undefined;
};

/**
 * Whether a slide's own answers form the closed set of groups a breakdown needs
 * — one participant, one group, drawn from something the organizer authored.
 *
 * Two slide types qualify today, and the test is the same one both times: a
 * choice question answered by picking exactly one of its options
 * (`multiple-choice`, REQ010) and a quiz question, which is single-answer by
 * construction (REQ054). What rules the rest out is not their type but their
 * shape:
 *
 *  - a **multi-select** choice slide (REQ014) puts one person in several groups,
 *    so the groups stop being a division of the room and the counts stop adding
 *    up to it;
 *  - a **typed** quiz question (REQ055) has no authored set to divide by — the
 *    answers are whatever the room wrote;
 *  - a scale, ranking, allocation, placement, guess, pin or form answer is not
 *    *one choice from a fixed set*: a scale answer is a rating (and a
 *    multi-statement scale is several per person, REQ029), a ranking is an
 *    ordering, a form is a whole page of answers at once. Each could be given a
 *    grouping rule of its own, and each would be a different feature with a
 *    different meaning — not this one widened.
 *
 * Returns the refusal rather than a boolean because every caller owes the reason
 * to somebody: a menu entry, or a 400.
 */
export function segmentSourceRefusalFor(
	slide: SegmentSlide,
): SegmentRefusal | null {
	if (!slideHasResults(slide.type)) return "no-answers";
	if (slide.type !== "multiple-choice" && slide.type !== "quiz") {
		// A leaderboard has a tally and takes no answers of its own (REQ059), so it
		// is refused for that rather than for its shape.
		return slide.type === "leaderboard" ? "no-answers" : "unsupported-type";
	}
	if (quizAnswerModeFor(slide) === "type") return "typed-answers";
	if (isMultiSelect(slide)) return "multi-select";
	return null;
}

/** One earlier slide, and whether it can group the slide being read. */
export type SegmentSource = {
	slideId: string;
	/** 1-indexed place in the deck — how a picker names it alongside the question. */
	position: number;
	question: string;
	type: SlideType;
	/** `null` when this slide can group the target; otherwise why it cannot. */
	refusal: SegmentRefusal | null;
	/**
	 * The refusal in words, or an explicit `null` when there is none —
	 * so a client renders the sentence it was given rather than keeping its own
	 * copy of the table.
	 */
	reason: string | null;
};

/**
 * Every slide that could be offered as a grouping for `targetSlideId`, in deck
 * order, with the ineligible ones marked rather than dropped.
 *
 * The list is the slides **before** the target that put a tally on screen
 * (`slideHasResults`). Those are the entries a picker draws — the eligible ones
 * live, the rest disabled with `reason` under them. Slides *after*
 * the target are not in the list at all: they are not this control's options
 * that happen to be unavailable, they are outside what a breakdown means
 * (REQ020 — "an earlier slide"), and listing every later slide as a permanent
 * refusal would bury the ones a reader can actually pick.
 *
 * An unknown target answers with an empty list rather than throwing: a deck
 * whose slide was deleted under a stale page has no groupings to offer, which is
 * the true answer.
 */
export function segmentSourcesFor(
	slides: readonly SegmentSlide[],
	targetSlideId: string,
): SegmentSource[] {
	const targetIndex = slides.findIndex((slide) => slide.id === targetSlideId);
	if (targetIndex < 0) return [];
	return slides.slice(0, targetIndex).flatMap((slide, index) => {
		if (!slideHasResults(slide.type)) return [];
		const refusal = segmentSourceRefusalFor(slide);
		return [
			{
				slideId: slide.id,
				position: index + 1,
				question: slide.question ?? "",
				type: slide.type,
				refusal,
				reason: refusal === null ? null : SEGMENT_REFUSAL_REASONS[refusal],
			},
		];
	});
}

/**
 * Whether this deck can group `targetSlideId` by `sourceSlideId`, and why not
 * where it cannot — the **one guard** the endpoint runs and the picker's entries
 * are built from.
 *
 * Order is checked here rather than folded into
 * {@link segmentSourceRefusalFor}, because it is a fact about the pair and not
 * about either slide: the same choice slide groups everything after it and
 * nothing before it.
 *
 * Both ends of the pair are checked. A slide with no tally of its own has
 * nothing to break down, so it is refused as the **target** rather than answered
 * with one empty group per option — a 200 to a question with no meaning is a
 * worse answer than a refusal that names what is wrong.
 */
export function segmentRefusalFor(
	slides: readonly SegmentSlide[],
	targetSlideId: string,
	sourceSlideId: string,
): SegmentRefusal | null {
	if (targetSlideId === sourceSlideId) return "same-slide";
	const targetIndex = slides.findIndex((slide) => slide.id === targetSlideId);
	const sourceIndex = slides.findIndex((slide) => slide.id === sourceSlideId);
	if (targetIndex < 0 || sourceIndex < 0) return "unknown-slide";
	if (!slideHasResults(slides[targetIndex].type)) return "no-tally";
	if (sourceIndex > targetIndex) return "not-earlier";
	return segmentSourceRefusalFor(slides[sourceIndex]);
}

// ── The join itself ──────────────────────────────────────────

/**
 * The fields a stored vote row is joined on. Declared as a read model for the
 * same reason the spreadsheet export declares one: the aggregation deals in
 * untyped store rows, and restating the stored schema here would be a second
 * source of truth for it.
 */
export type SegmentVoteRow = {
	participantId?: unknown;
	value?: unknown;
	skip?: unknown;
};

/** One group of participants, named by the answer that put them in it. */
export type SegmentBucket = {
	/**
	 * The authored answer this group stands for — an option id — or `null` for
	 * the people who did not answer the grouping slide at all.
	 */
	key: string | null;
	/** What the group is called on screen: the option's own text. */
	label: string;
	/** Everyone in it, in the order the deck and the store put them. */
	participantIds: string[];
};

/** What the group of participants who never answered the grouping slide is called. */
export const SEGMENT_UNANSWERED_LABEL = "Did not answer";

/**
 * Divide a room into groups by what each participant answered on `slide`.
 *
 * One group per authored option, **in authored order and including the empty
 * ones**, then the people who did not answer it. Empty groups are kept for the
 * reason the tallies keep empty options: "nobody who picked C answered this" is
 * a result, and a group that vanishes when it empties makes a breakdown change
 * shape as answers land.
 *
 * Two rules, both borrowed rather than invented:
 *
 *  - a row only counts if it is still an answer to the slide **as it now
 *    stands** (`isStandingQuizAnswer`) — an option since deleted groups nobody,
 *    exactly as it counts nowhere in the tally;
 *  - where a participant somehow has several rows on a single-answer slide, the
 *    **first** standing one decides their group, which is the rule
 *    `finalQuizAnswers` already applies to the answer that scores. Two readings
 *    of "their answer" is how a breakdown comes to disagree with the bars above
 *    it.
 *
 * `population` is who the breakdown is *about* — the participants the segmented
 * slide itself heard from. It only decides the membership of the final group:
 * somebody who answered neither slide is in no group here, because they are not
 * in the tally being broken down either.
 */
export function segmentBucketsFor(
	slide: SegmentSlide,
	sourceVotes: readonly SegmentVoteRow[],
	population: readonly string[],
): SegmentBucket[] {
	const options = slide.options ?? [];
	const buckets = new Map<string, SegmentBucket>(
		options.map((option, index) => {
			// Trimmed for the label the same way it is trimmed for the emptiness
			// test, or an option authored as `"  Alpha  "` names a group with its
			// padding intact.
			const text = (option.text ?? "").trim();
			return [
				option.id,
				{
					key: option.id,
					label: text.length > 0 ? text : `Option ${index + 1}`,
					participantIds: [],
				},
			];
		}),
	);

	const grouped = new Set<string>();
	for (const sourceVote of sourceVotes) {
		if (sourceVote.skip === true) continue;
		const participantId = String(sourceVote.participantId ?? "");
		if (participantId.length === 0 || grouped.has(participantId)) continue;
		const value = String(sourceVote.value ?? "");
		if (!isStandingQuizAnswer(slide, value)) continue;
		const bucket = buckets.get(value);
		if (!bucket) continue;
		grouped.add(participantId);
		bucket.participantIds.push(participantId);
	}

	const unanswered: string[] = [];
	const seen = new Set<string>();
	for (const participantId of population) {
		if (participantId.length === 0 || grouped.has(participantId)) continue;
		if (seen.has(participantId)) continue;
		seen.add(participantId);
		unanswered.push(participantId);
	}

	return [
		...buckets.values(),
		{
			key: null,
			label: SEGMENT_UNANSWERED_LABEL,
			participantIds: unanswered,
		},
	];
}
