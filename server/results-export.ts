/**
 * Spreadsheet export of a deck's results (REQ095).
 *
 * What this module produces is a **workbook and nothing else**. Like
 * `server/preview.ts` beside it, it has no store, no route and no clock of its
 * own: the deck, the rows the room submitted, the aggregates the results
 * endpoint already computed and the instant of the export all arrive as
 * arguments, and a workbook comes back. That shape is what keeps the export
 * honest — it cannot re-derive a tally that disagrees with the one on screen,
 * because it does not compute one. It reads the aggregation's own payload
 * (`getAllResults`) and lays it out.
 *
 * Two stages, deliberately separated:
 *
 *  - {@link buildResultsWorkbook} — pure data. Deck + rows + aggregates in, a
 *    {@link WorkbookModel} of sheets, columns and cells out. Everything worth
 *    asserting about the export is asserted here, against plain arrays, with no
 *    XLSX parser in the loop.
 *  - {@link renderResultsWorkbook} — the only place `exceljs` is touched. It
 *    turns a model into bytes and makes no decisions about content.
 *
 * The five sheets answer the two halves of REQ095 — "raw data *and* result
 * overviews":
 *
 *  1. **Summary** — what deck this is, and how much of it there is.
 *  2. **Slides** — one row per slide: what was asked, and how many answered.
 *  3. **Responses** — the long table. One row per stored submission, decoded
 *     into something readable, carrying the participant id it was cast under
 *     and — where the deck asked the room for one (REQ076) — the name behind it.
 *  4. **Participants** — the same data as a matrix: one row per participant,
 *     one column per interactive slide. This is the "responses per participant
 *     ID and per slide" table the requirement names, with the stated name beside
 *     the id.
 *  5. **Aggregates** — the tallies, in tidy long form: one row per
 *     (slide, entry, metric, value). Every number keeps its own name, so a
 *     column never means "count here and average there" depending on the slide
 *     type it happens to be describing, and a pivot table over the sheet is
 *     immediately usable. That is the format the requirement's stated goal —
 *     analysis outside the tool — actually wants.
 *
 * Nullish cells are emitted as an explicit `null` rather than dropped or
 * softened to `0`: "nobody answered" and "the average was zero" are
 * different readings and must stay so in a spreadsheet, where a `0` in an
 * average column is indistinguishable from an answer somebody gave.
 */

import ExcelJS from "exceljs";
import {
	deckFilenameSlug,
	decodeGridPoint,
	decodeGuess,
	decodePinPoint,
	decodePoints,
	decodeQuizAnswer,
	decodeRanking,
	describeFormSubmission,
	formFieldsFor,
	gridAxesFor,
	guessRangeFor,
	isInteractiveSlideType,
	type Presentation,
	quizAnswerModeFor,
	readFormSubmission,
	type Slide,
	type StoredResponseVote,
	type StoredVote,
} from "./schemas";

// ── The workbook model ───────────────────────────────────────

/** One cell. `null` is an empty cell that was deliberately left empty. */
export type SheetCell = string | number | boolean | null;

/** One column: its header text and how wide it opens. */
export type SheetColumn = { header: string; width: number };

/** One sheet: a header row described by {@link SheetColumn}s, then the rows. */
export type SheetModel = {
	name: string;
	columns: SheetColumn[];
	rows: SheetCell[][];
};

/** A whole workbook, ready to render. */
export type WorkbookModel = { sheets: SheetModel[] };

/**
 * Everything one export reads. The aggregates are the results endpoint's own
 * payload — this module never recomputes a tally — and they are gathered with
 * editor rights, because an export the organizer asked for is theirs to have in
 * full: a quiz answer key withheld from a running room (REQ056) is exactly what
 * a post-session analysis needs.
 */
export type ResultsExportInput = {
	presentation: Presentation;
	votes: StoredVote[];
	responseVotes: StoredResponseVote[];
	/**
	 * What each participant is called, `participantId` → name (REQ076). Empty on
	 * a deck that never asked the room for names, which is what makes every read
	 * of it below a lookup that finds nothing rather than a branch on the deck's
	 * switch.
	 */
	participantNames: Record<string, string>;
	/** One entry per slide, as `getAllResults` returns them. */
	results: SlideResultsPayload[];
	/** The instant the export was taken, ISO. */
	exportedAt: string;
};

// ── Reading the aggregation's payload ────────────────────────
//
// The results payload has no Zod schema of its own — it is a server-internal
// shape that differs per slide type and is consumed untyped by the client
// today. Rather than restate it (which would be a second source of truth that
// drifts, exactly what one source of truth per shape exists to prevent), the
// export declares the narrow
// read-model it needs: every field optional, every list defaulted at the read
// site. A slide type that grows a field simply does not appear in the export
// until a row is written for it.

type AggregateEntry = Record<string, unknown>;

export type SlideResultsPayload = {
	slideId?: string;
	question?: string;
	type?: string;
	[key: string]: unknown;
};

/** Read a numeric field, or `null` when it is absent or not a number. */
function numberField(payload: AggregateEntry, key: string): number | null {
	const value = payload[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a string field, or `null` when it is absent or not a string. */
function stringField(payload: AggregateEntry, key: string): string | null {
	const value = payload[key];
	return typeof value === "string" ? value : null;
}

/** Read a list-of-objects field; an absent or malformed one reads as empty. */
function listField(payload: AggregateEntry, key: string): AggregateEntry[] {
	const value = payload[key];
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is AggregateEntry =>
			typeof entry === "object" && entry !== null,
	);
}

/** Read a nested object field, or `null` when it is absent. */
function objectField(payload: AggregateEntry, key: string): AggregateEntry | null {
	const value = payload[key];
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as AggregateEntry)
		: null;
}

// ── Decoding one submission ──────────────────────────────────

/** One stored row, read back into the words the participant meant by it. */
export type DescribedAnswer = {
	/**
	 * The sub-item this row answers — a scale statement (REQ029) or a grid item
	 * (REQ047) — or `null` on a slide whose question has no parts.
	 */
	item: string | null;
	/**
	 * What was answered, decoded through the same codecs the vote endpoint
	 * judged the submission with. `null` for a skipped statement or grid item
	 * (REQ031/REQ050), which is an answer about the item rather than a position
	 * on it, and for a row the slide can no longer read because it was
	 * re-authored underneath — the same rows the live tally drops.
	 */
	answer: string | null;
};

/** The text of a sub-item named by `statementId`, or `null` when unknown. */
function subItemTextIn(slide: Slide, statementId: string | null): string | null {
	if (!statementId) return null;
	const candidates = [
		...(slide.scaleStatements ?? []),
		...(slide.gridItems ?? []),
	];
	const match = candidates.find((candidate) => candidate.id === statementId);
	return match ? match.text : null;
}

/**
 * Read one stored row into a readable answer.
 *
 * Every branch goes through the slide's own codec rather than printing the
 * stored string: `"opt-3"`, `"1|4"` and `"a:40,b:60"` are storage, not answers,
 * and a spreadsheet full of them would satisfy the endpoint and not the
 * requirement. Where a codec refuses the row — the slide was re-authored under
 * it — the answer is `null`, matching what the live tally does with the same
 * row rather than inventing a reading for it.
 */
export function describeAnswer(slide: Slide, vote: StoredVote): DescribedAnswer {
	const item = subItemTextIn(slide, vote.statementId);
	if (vote.skip) return { item, answer: null };

	const value = String(vote.value ?? "");
	switch (slide.type) {
		case "multiple-choice":
		case "quiz": {
			if (quizAnswerModeFor(slide) === "type") {
				return { item, answer: decodeQuizAnswer(value) };
			}
			const option = (slide.options ?? []).find(
				(candidate) => candidate.id === value,
			);
			return { item, answer: option ? option.text : null };
		}

		// The three types whose stored value already *is* the answer: the words a
		// participant typed, and the rating they picked. Nothing to decode, so
		// they share the one branch the `default` below also takes — an empty
		// string reads as `null`, because a row carrying nothing is not an answer
		// somebody gave and left blank.
		case "word-cloud":
		case "open-text":
		case "scale":
			return { item, answer: value.length > 0 ? value : null };

		case "ranking": {
			const items = slide.rankingItems ?? [];
			const order = decodeRanking(value, items);
			if (!order) return { item, answer: null };
			const texts = order.map((itemId) => {
				const ranked = items.find((candidate) => candidate.id === itemId);
				return ranked ? ranked.text : itemId;
			});
			return { item, answer: texts.join(" > ") };
		}

		case "points": {
			const items = slide.pointsItems ?? [];
			const allocation = decodePoints(value, items);
			if (!allocation) return { item, answer: null };
			const spelled = items
				.filter((candidate) => (allocation[candidate.id] ?? 0) > 0)
				.map((candidate) => `${candidate.text}: ${allocation[candidate.id]}`);
			return { item, answer: spelled.join("; ") };
		}

		case "grid": {
			const { xAxis, yAxis } = gridAxesFor(slide);
			const point = decodeGridPoint(value, xAxis, yAxis);
			return { item, answer: point ? `${point.x}, ${point.y}` : null };
		}

		case "guess-number": {
			const guess = decodeGuess(value, guessRangeFor(slide));
			return { item, answer: guess === null ? null : String(guess) };
		}

		case "pin-image": {
			const point = decodePinPoint(value);
			return { item, answer: point ? `${point.x}, ${point.y}` : null };
		}

		// REQ061 — a whole filled-in form is one stored row, so it is one row
		// here too: every answered field, named by what it asked, in the order the
		// organizer authored them. A choice answer is stored as an option id and
		// must never be printed as one, which is what `describeFormSubmission`
		// exists for — the same reading the results table shows.
		//
		// Read with `readFormSubmission`, not the boundary's judgement: an export
		// is the record of what a room wrote, and a rule the organizer added after
		// they wrote it must not empty the cell. This is the one branch here that
		// deliberately does *not* mirror the vote endpoint's decoder — see the
		// block above `decodeFormSubmission` in `server/schemas.ts`.
		case "form": {
			const fields = formFieldsFor(slide);
			const answers = readFormSubmission(value, fields);
			if (!answers) return { item, answer: null };
			const spelled = describeFormSubmission(fields, answers).map(
				(entry) => `${entry.label}: ${entry.answer}`,
			);
			return { item, answer: spelled.length > 0 ? spelled.join("; ") : null };
		}

		default:
			return { item, answer: value.length > 0 ? value : null };
	}
}

// ── Aggregate rows ───────────────────────────────────────────

/**
 * One line of the Aggregates sheet: a metric, the entry it belongs to, and its
 * value. `entry` is `null` for a metric about the slide as a whole.
 */
export type AggregateRow = {
	entry: string | null;
	metric: string;
	value: SheetCell;
};

/**
 * What a share-of-the-whole metric is called, wherever one is published.
 *
 * A name rather than a literal because a second reader now depends on it: the
 * PDF export (REQ096) flattens these same rows and draws a bar for exactly the
 * entries that publish a share, so "which metric is a percentage of the whole?"
 * has to be one fact rather than a string matched in one module against a string
 * spelled in another.
 */
export const SHARE_METRIC = "Share %";

/** A slide-level metric. */
function slideMetric(metric: string, value: SheetCell): AggregateRow {
	return { entry: null, metric, value };
}

/** A metric about one option / word / item / statement / bucket. */
function entryMetric(
	entry: string,
	metric: string,
	value: SheetCell,
): AggregateRow {
	return { entry, metric, value };
}

/** What one grid axis is called in a metric name (REQ048), or its dimension. */
function axisLabel(axis: AggregateEntry | null, fallback: string): string {
	const title = axis ? stringField(axis, "title") : null;
	return title && title.length > 0 ? title : fallback;
}

/** The scoring block a quiz question carries (REQ054/REQ056), flattened. */
function quizScoringRows(scoring: AggregateEntry | null): AggregateRow[] {
	if (!scoring) return [];
	return [
		slideMetric("Answered", numberField(scoring, "answeredCount")),
		slideMetric("Correct answers", numberField(scoring, "correctCount")),
		slideMetric("Correct share %", numberField(scoring, "correctShare")),
		slideMetric("Total points", numberField(scoring, "totalPoints")),
		slideMetric("Average points", numberField(scoring, "averagePoints")),
		slideMetric("Max points per answer", numberField(scoring, "maxPoints")),
	];
}

/**
 * Flatten one slide's aggregate into tidy rows.
 *
 * Every branch reads only what the aggregation already published for that slide
 * type — no arithmetic beyond picking a field out — so a number in the
 * spreadsheet is the number the shared screen drew, by construction.
 */
export function aggregateRowsFor(
	slide: Slide,
	payload: SlideResultsPayload,
): AggregateRow[] {
	const totalVotes = numberField(payload, "totalVotes");

	switch (slide.type) {
		case "multiple-choice":
		case "quiz": {
			const scoring = objectField(payload, "scoring");
			const respondentCount = numberField(payload, "respondentCount");
			const rows: AggregateRow[] = [
				slideMetric("Respondents", respondentCount),
				slideMetric("Selections", totalVotes),
			];

			const typedAnswers = objectField(payload, "typedAnswers");
			if (typedAnswers) {
				// A typed question (REQ055) offers no options to tally; what the room
				// wrote is the result. `entries` is populated here because the export
				// is gathered with editor rights.
				const accepted = typedAnswers.accepted;
				rows.push(
					slideMetric(
						"Accepted answers",
						Array.isArray(accepted) ? accepted.join(", ") : null,
					),
					slideMetric(
						"Distinct answers",
						numberField(typedAnswers, "distinctCount"),
					),
				);
				for (const entry of listField(typedAnswers, "entries")) {
					const text = stringField(entry, "text") ?? "";
					rows.push(entryMetric(text, "Count", numberField(entry, "count")));
					rows.push(
						entryMetric(
							text,
							"Correct",
							typeof entry.isCorrect === "boolean" ? entry.isCorrect : null,
						),
					);
				}
			} else {
				for (const option of listField(payload, "options")) {
					const text = stringField(option, "text") ?? "";
					const count = numberField(option, "count");
					rows.push(entryMetric(text, "Count", count));
					rows.push(
						entryMetric(
							text,
							SHARE_METRIC,
							count !== null && respondentCount
								? Math.round((count / respondentCount) * 10000) / 100
								: null,
						),
					);
					rows.push(
						entryMetric(
							text,
							"Correct",
							typeof option.isCorrect === "boolean" ? option.isCorrect : null,
						),
					);
				}
			}

			return [...rows, ...quizScoringRows(scoring)];
		}

		case "word-cloud": {
			const rows: AggregateRow[] = [slideMetric("Responses", totalVotes)];
			for (const word of listField(payload, "words")) {
				const text = stringField(word, "text") ?? "";
				const count = numberField(word, "count");
				rows.push(entryMetric(text, "Count", count));
				rows.push(
					entryMetric(
						text,
						SHARE_METRIC,
						count !== null && totalVotes
							? Math.round((count / totalVotes) * 10000) / 100
							: null,
					),
				);
			}
			return rows;
		}

		case "open-text": {
			const rows: AggregateRow[] = [slideMetric("Responses", totalVotes)];
			for (const response of listField(payload, "responses")) {
				const text = stringField(response, "text") ?? "";
				rows.push(entryMetric(text, "Upvotes", numberField(response, "upvotes")));
			}
			return rows;
		}

		case "scale": {
			const rows: AggregateRow[] = [
				slideMetric("Responses", totalVotes),
				slideMetric("Scale minimum", numberField(payload, "min")),
				slideMetric("Scale maximum", numberField(payload, "max")),
			];
			const statements = listField(payload, "statements");
			if (statements.length > 0) {
				for (const statement of statements) {
					const text = stringField(statement, "text") ?? "";
					rows.push(entryMetric(text, "Answered", numberField(statement, "answered")));
					rows.push(entryMetric(text, "Skipped", numberField(statement, "skipped")));
					rows.push(entryMetric(text, "Average", numberField(statement, "average")));
				}
				return rows;
			}
			// The legacy single-statement scale, whose statement is the question.
			rows.push(slideMetric("Skipped", numberField(payload, "skipped")));
			rows.push(slideMetric("Average", numberField(payload, "average")));
			return rows;
		}

		case "ranking": {
			const rows: AggregateRow[] = [
				slideMetric("Responses", totalVotes),
				slideMetric("Ballots", numberField(payload, "ballots")),
			];
			for (const item of listField(payload, "items")) {
				const text = stringField(item, "text") ?? "";
				rows.push(entryMetric(text, "Rank", numberField(item, "rank")));
				rows.push(entryMetric(text, "Points", numberField(item, "points")));
				rows.push(entryMetric(text, "Ranked by", numberField(item, "rankedCount")));
				rows.push(entryMetric(text, "Not ranked by", numberField(item, "notRanked")));
				rows.push(entryMetric(text, "Average rank", numberField(item, "averageRank")));
			}
			return rows;
		}

		case "points": {
			const rows: AggregateRow[] = [
				slideMetric("Responses", totalVotes),
				slideMetric("Ballots", numberField(payload, "ballots")),
				slideMetric("Budget per ballot", numberField(payload, "budget")),
				slideMetric("Points distributed", numberField(payload, "totalPoints")),
			];
			for (const item of listField(payload, "items")) {
				const text = stringField(item, "text") ?? "";
				rows.push(entryMetric(text, "Rank", numberField(item, "rank")));
				rows.push(entryMetric(text, "Points", numberField(item, "points")));
				rows.push(entryMetric(text, SHARE_METRIC, numberField(item, "share")));
				rows.push(entryMetric(text, "Funded by", numberField(item, "funderCount")));
				rows.push(entryMetric(text, "Not funded by", numberField(item, "notFunded")));
				rows.push(
					entryMetric(text, "Average points", numberField(item, "averagePoints")),
				);
			}
			return rows;
		}

		case "guess-number": {
			const rows: AggregateRow[] = [
				slideMetric("Responses", totalVotes),
				slideMetric("Guesses", numberField(payload, "guessCount")),
				slideMetric("Lowest guess", numberField(payload, "lowestGuess")),
				slideMetric("Highest guess", numberField(payload, "highestGuess")),
				slideMetric("Average guess", numberField(payload, "averageGuess")),
				slideMetric("Median guess", numberField(payload, "medianGuess")),
				slideMetric("Reference", numberField(payload, "reference")),
				slideMetric("Tolerance", numberField(payload, "tolerance")),
				slideMetric("Within tolerance", numberField(payload, "correctCount")),
				slideMetric("Within tolerance %", numberField(payload, "correctShare")),
			];
			for (const bucket of listField(payload, "buckets")) {
				const from = numberField(bucket, "from");
				const to = numberField(bucket, "to");
				const label = from === to ? `${from}` : `${from} to ${to}`;
				rows.push(entryMetric(label, "Count", numberField(bucket, "count")));
				rows.push(entryMetric(label, SHARE_METRIC, numberField(bucket, "share")));
			}
			return rows;
		}

		case "pin-image": {
			const area = objectField(payload, "correctArea");
			return [
				slideMetric("Responses", totalVotes),
				slideMetric("Pins", numberField(payload, "pinCount")),
				slideMetric("Average X", numberField(payload, "averageX")),
				slideMetric("Average Y", numberField(payload, "averageY")),
				slideMetric(
					"Target area",
					area
						? `${numberField(area, "x")}, ${numberField(area, "y")} to ${
								(numberField(area, "x") ?? 0) + (numberField(area, "width") ?? 0)
							}, ${(numberField(area, "y") ?? 0) + (numberField(area, "height") ?? 0)}`
						: null,
				),
				slideMetric("Pins in target", numberField(payload, "correctCount")),
				slideMetric("Pins in target %", numberField(payload, "correctShare")),
			];
		}

		case "grid": {
			// The axes are named by what the organizer wrote (REQ048), falling back
			// to the bare dimension for a slide whose author left one unnamed — the
			// same fallback the shared screen draws it under.
			const xAxis = objectField(payload, "xAxis");
			const yAxis = objectField(payload, "yAxis");
			const xLabel = axisLabel(xAxis, "X");
			const yLabel = axisLabel(yAxis, "Y");
			const rows: AggregateRow[] = [slideMetric("Responses", totalVotes)];
			for (const item of listField(payload, "items")) {
				const text = stringField(item, "text") ?? "";
				rows.push(entryMetric(text, "Placed", numberField(item, "placed")));
				rows.push(entryMetric(text, "Skipped", numberField(item, "skipped")));
				rows.push(
					entryMetric(text, `Average ${xLabel}`, numberField(item, "averageX")),
				);
				rows.push(
					entryMetric(text, `Average ${yLabel}`, numberField(item, "averageY")),
				);
			}
			return rows;
		}

		// REQ061 — a form's aggregate is how much of it got filled in: how many
		// complete submissions there were, and how many people answered each
		// field. The submitted rows themselves are not repeated here; they are the
		// Responses and Participants sheets' job, and the Aggregates sheet is for
		// the numbers.
		case "form": {
			const rows: AggregateRow[] = [
				slideMetric("Responses", totalVotes),
				slideMetric("Submissions", numberField(payload, "submissionCount")),
				slideMetric("Fields", numberField(payload, "fieldCount")),
			];
			for (const field of listField(payload, "fields")) {
				const label = stringField(field, "label") ?? "";
				rows.push(entryMetric(label, "Answered", numberField(field, "answered")));
				// A choice field is the one part of a form that is a distribution, so
				// its picks are counted; a text or email field carries no options and
				// contributes nothing beyond its answered count.
				for (const option of listField(field, "options")) {
					const text = stringField(option, "text") ?? "";
					rows.push(
						entryMetric(`${label}: ${text}`, "Count", numberField(option, "count")),
					);
				}
			}
			return rows;
		}

		case "leaderboard": {
			const rows: AggregateRow[] = [
				slideMetric("Quiz questions", numberField(payload, "quizCount")),
				slideMetric("Max points", numberField(payload, "maxPoints")),
				slideMetric("Ranked participants", numberField(payload, "rankedCount")),
			];
			for (const entry of listField(payload, "entries")) {
				const label = stringField(entry, "label") ?? "";
				rows.push(entryMetric(label, "Rank", numberField(entry, "rank")));
				rows.push(entryMetric(label, "Points", numberField(entry, "totalPoints")));
				rows.push(
					entryMetric(label, "Correct answers", numberField(entry, "correctCount")),
				);
				rows.push(entryMetric(label, "Answered", numberField(entry, "answeredCount")));
			}
			return rows;
		}

		default:
			// A content slide (REQ062/063/065) collects nothing. It still gets its
			// row, with an explicit zero, so a reader scanning the sheet sees every
			// slide accounted for rather than wondering which ones were dropped.
			return [slideMetric("Responses", totalVotes ?? 0)];
	}
}

// ── Building the workbook ────────────────────────────────────

/** The slide label a participant-matrix column and a response row are titled by. */
function slideLabel(slide: Slide, index: number): string {
	const question = slide.question.trim();
	return question.length > 0
		? `${index + 1}. ${question}`
		: `${index + 1}. (${slide.type})`;
}

/**
 * Distinct participant ids behind a pile of rows, in first-seen order.
 *
 * Exported because the PDF export (REQ096) puts the same count on its cover
 * that the Summary sheet puts in its `Participants` row, and "how many people
 * answered?" is one fact rather than two implementations that happen to agree
 * today — the same reason {@link SHARE_METRIC} is a name.
 */
export function participantIdsIn(
	/**
	 * Stored rows, read for one field. Typed as the field rather than as
	 * {@link StoredVote} because the third caller (the segmented read, REQ020)
	 * holds the aggregation's untyped rows rather than parsed ones, and a count
	 * of "how many people are behind these rows" must be the same count there.
	 */
	votes: readonly { participantId?: unknown }[],
): string[] {
	const seen: string[] = [];
	const known = new Set<string>();
	for (const vote of votes) {
		const participantId = String(vote.participantId ?? "");
		if (!participantId || known.has(participantId)) continue;
		known.add(participantId);
		seen.push(participantId);
	}
	return seen;
}

/**
 * What one participant is called, or `null` when they stated nothing (REQ076).
 *
 * A named read rather than an index into the map at each of the three sheets and
 * the PDF that want it, for the reason {@link SHARE_METRIC} is a name: the
 * distinction between "did not say" and "said nothing" is exactly the one
 * an export must keep in a cell, and it has to be drawn the same way everywhere
 * an export prints one. A blank stored value reads as `null` too — a row that
 * carries no name is not somebody called nothing.
 */
export function participantNameFor(
	names: Record<string, string>,
	participantId: string,
): string | null {
	const name = names[participantId];
	return typeof name === "string" && name.length > 0 ? name : null;
}

/**
 * Build the whole workbook. Pure: same input, same sheets, every time — which
 * is what lets the tests assert on cells rather than on a rendered file.
 */
export function buildResultsWorkbook(input: ResultsExportInput): WorkbookModel {
	const {
		presentation,
		votes,
		responseVotes,
		participantNames,
		results,
		exportedAt,
	} = input;
	const slides = presentation.slides;

	// One lookup per slide, so the per-row work below stays linear in the rows
	// rather than in rows × slides.
	const slideIndexById = new Map(slides.map((slide, index) => [slide.id, index]));
	const resultsBySlideId = new Map(
		results.map((payload) => [String(payload.slideId ?? ""), payload]),
	);
	const votesBySlideId = new Map<string, StoredVote[]>();
	for (const vote of votes) {
		const rows = votesBySlideId.get(vote.slideId) ?? [];
		rows.push(vote);
		votesBySlideId.set(vote.slideId, rows);
	}

	const participantIds = participantIdsIn(votes);

	return {
		sheets: [
			summarySheet(
				presentation,
				votes,
				responseVotes,
				participantIds,
				participantNames,
				exportedAt,
			),
			slidesSheet(slides, votesBySlideId),
			responsesSheet(slides, slideIndexById, votes, participantNames),
			participantsSheet(slides, participantIds, votes, participantNames),
			aggregatesSheet(slides, resultsBySlideId),
		],
	};
}

function summarySheet(
	presentation: Presentation,
	votes: StoredVote[],
	responseVotes: StoredResponseVote[],
	participantIds: string[],
	participantNames: Record<string, string>,
	exportedAt: string,
): SheetModel {
	const interactiveCount = presentation.slides.filter((slide) =>
		isInteractiveSlideType(slide.type),
	).length;
	return {
		name: "Summary",
		columns: [
			{ header: "Field", width: 26 },
			{ header: "Value", width: 52 },
		],
		rows: [
			["Presentation", presentation.title],
			["Join code", presentation.code],
			["Status", presentation.status],
			["Mode", presentation.mode],
			["Language", presentation.language],
			["Results visibility", presentation.resultsVisibility],
			["Q&A enabled", presentation.qaEnabled],
			["Q&A visibility", presentation.qaVisibility],
			["Slides", presentation.slides.length],
			["Interactive slides", interactiveCount],
			["Participants", participantIds.length],
			// REQ076 — both halves, because on their own neither is readable. The
			// switch says what the deck asked for; the count says how many of the
			// people who answered actually said, which is the number that tells an
			// organizer whether the Name column beside them is worth reading.
			["Names required", presentation.requireParticipantName],
			[
				"Participants named",
				participantIds.filter(
					(participantId) =>
						participantNameFor(participantNames, participantId) !== null,
				).length,
			],
			["Responses", votes.length],
			["Response upvotes", responseVotes.length],
			["Created at", presentation.createdAt],
			["Exported at", exportedAt],
		],
	};
}

function slidesSheet(
	slides: Slide[],
	votesBySlideId: Map<string, StoredVote[]>,
): SheetModel {
	return {
		name: "Slides",
		columns: [
			{ header: "Slide #", width: 9 },
			{ header: "Slide ID", width: 26 },
			{ header: "Type", width: 18 },
			{ header: "Question", width: 52 },
			{ header: "Participants", width: 14 },
			{ header: "Responses", width: 12 },
		],
		rows: slides.map((slide, index) => {
			const slideVotes = votesBySlideId.get(slide.id) ?? [];
			return [
				index + 1,
				slide.id,
				slide.type,
				slide.question,
				participantIdsIn(slideVotes).length,
				slideVotes.length,
			];
		}),
	};
}

function responsesSheet(
	slides: Slide[],
	slideIndexById: Map<string, number>,
	votes: StoredVote[],
	participantNames: Record<string, string>,
): SheetModel {
	const slideById = new Map(slides.map((slide) => [slide.id, slide]));
	// Slide order first, submission order within it: the sheet reads as a walk
	// through the deck rather than as the arrival log the store keeps.
	const ordered = [...votes].sort((left, right) => {
		const leftIndex = slideIndexById.get(left.slideId) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex =
			slideIndexById.get(right.slideId) ?? Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) return leftIndex - rightIndex;
		return left.createdAt.localeCompare(right.createdAt);
	});

	const rows: SheetCell[][] = [];
	for (const vote of ordered) {
		const slide = slideById.get(vote.slideId);
		// A row whose slide is gone is still a row the room submitted, so it is
		// reported rather than dropped — with explicit nulls where the deck can no
		// longer say what it was an answer to.
		const described = slide
			? describeAnswer(slide, vote)
			: { item: null, answer: null };
		rows.push([
			slide ? (slideIndexById.get(vote.slideId) ?? 0) + 1 : null,
			vote.slideId,
			slide ? slide.type : null,
			slide ? slide.question : null,
			described.item,
			vote.participantId,
			// REQ076 — beside the id rather than in place of it. The id is what
			// joins this row to the Participants sheet and to the roster the
			// organizer read on screen, and it is the only handle a row cast before
			// the deck started asking for names has at all.
			participantNameFor(participantNames, vote.participantId),
			described.answer,
			vote.skip,
			vote.createdAt,
		]);
	}

	return {
		name: "Responses",
		columns: [
			{ header: "Slide #", width: 9 },
			{ header: "Slide ID", width: 26 },
			{ header: "Type", width: 18 },
			{ header: "Question", width: 42 },
			{ header: "Item", width: 28 },
			{ header: "Participant", width: 38 },
			{ header: "Name", width: 26 },
			{ header: "Answer", width: 52 },
			{ header: "Skipped", width: 10 },
			{ header: "Submitted at", width: 26 },
		],
		rows,
	};
}

/**
 * The matrix REQ095 names: one row per participant, one column per interactive
 * slide. A participant who answered several parts of one slide — a multi-select
 * (REQ014), a per-statement scale (REQ029), a grid (REQ047) — has all of it in
 * the one cell, joined, because the column is the slide.
 */
function participantsSheet(
	slides: Slide[],
	participantIds: string[],
	votes: StoredVote[],
	participantNames: Record<string, string>,
): SheetModel {
	const columns = slides
		.map((slide, index) => ({ slide, index }))
		.filter(({ slide }) => isInteractiveSlideType(slide.type));

	// (participantId, slideId) → the answers that participant gave on that slide.
	const answersByParticipant = new Map<string, Map<string, string[]>>();
	const slideById = new Map(slides.map((slide) => [slide.id, slide]));
	for (const vote of votes) {
		const slide = slideById.get(vote.slideId);
		if (!slide) continue;
		const described = describeAnswer(slide, vote);
		const spelled = described.answer ?? (vote.skip ? "(skipped)" : null);
		if (spelled === null) continue;
		const bySlide = answersByParticipant.get(vote.participantId) ?? new Map();
		const cell = bySlide.get(vote.slideId) ?? [];
		cell.push(described.item ? `${described.item}: ${spelled}` : spelled);
		bySlide.set(vote.slideId, cell);
		answersByParticipant.set(vote.participantId, bySlide);
	}

	return {
		name: "Participants",
		columns: [
			{ header: "Participant", width: 38 },
			// REQ076 — the second column rather than the first, and the id keeps its
			// place. This sheet is one row per *participant id*, which is the only
			// thing every row is guaranteed to have: a deck that asked no names, and
			// a person who answered before it started asking, both belong on it.
			{ header: "Name", width: 26 },
			...columns.map(({ slide, index }) => ({
				header: slideLabel(slide, index),
				width: 34,
			})),
		],
		rows: participantIds.map((participantId) => {
			const bySlide = answersByParticipant.get(participantId);
			return [
				participantId,
				participantNameFor(participantNames, participantId),
				...columns.map(({ slide }) => {
					const cell = bySlide?.get(slide.id);
					// An explicit `null` for "this participant did not answer this
					// slide" — never an empty string, which reads as an answer they
					// gave and left blank.
					return cell && cell.length > 0 ? cell.join("; ") : null;
				}),
			];
		}),
	};
}

function aggregatesSheet(
	slides: Slide[],
	resultsBySlideId: Map<string, SlideResultsPayload>,
): SheetModel {
	const rows: SheetCell[][] = [];
	slides.forEach((slide, index) => {
		const payload = resultsBySlideId.get(slide.id) ?? {};
		for (const row of aggregateRowsFor(slide, payload)) {
			rows.push([
				index + 1,
				slide.question,
				slide.type,
				row.entry,
				row.metric,
				row.value,
			]);
		}
	});

	return {
		name: "Aggregates",
		columns: [
			{ header: "Slide #", width: 9 },
			{ header: "Question", width: 42 },
			{ header: "Type", width: 18 },
			{ header: "Entry", width: 42 },
			{ header: "Metric", width: 22 },
			{ header: "Value", width: 18 },
		],
		rows,
	};
}

// ── Rendering ────────────────────────────────────────────────

/**
 * Turn a model into XLSX bytes. The only place `exceljs` is used, and it makes
 * no decisions about content — every question of *what* the export says is
 * already settled in {@link buildResultsWorkbook}.
 */
export async function renderResultsWorkbook(
	model: WorkbookModel,
): Promise<ArrayBuffer> {
	const workbook = new ExcelJS.Workbook();
	workbook.creator = "omul";

	for (const sheet of model.sheets) {
		const worksheet = workbook.addWorksheet(sheet.name);
		worksheet.columns = sheet.columns.map((column) => ({
			header: column.header,
			width: column.width,
		}));
		worksheet.getRow(1).font = { bold: true };
		// Freeze the header so a long Responses sheet stays readable while
		// scrolling — the one place the export makes a presentation choice, and it
		// is about the frame rather than the data.
		worksheet.views = [{ state: "frozen", ySplit: 1 }];
		for (const row of sheet.rows) {
			// exceljs writes `null` as an empty cell, which is the reading a
			// nullish value owes: the column is present and carries no value.
			worksheet.addRow(row);
		}
	}

	// exceljs types its own output as an `ArrayBuffer` and hands back a Node
	// `Buffer` at runtime. Both are bodies a `Response` accepts, so the bytes go
	// out as written rather than through a re-wrap that would only copy them.
	return workbook.xlsx.writeBuffer();
}

/** The MIME type an XLSX download is served under. */
export const XLSX_CONTENT_TYPE =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The filename the browser saves the export as. Slugged from the deck's title
 * through {@link deckFilenameSlug} — the same descriptor the JSON deck export
 * composes, so the two files a deck produces are named by one rule — and dated
 * from the export instant so a deck run twice does not overwrite its own first
 * file in the download folder.
 */
export function resultsExportFilename(title: string, exportedAt: string): string {
	const day = exportedAt.slice(0, 10);
	return `${deckFilenameSlug(title)}-results-${day}.xlsx`;
}
