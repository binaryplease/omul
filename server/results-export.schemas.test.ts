/**
 * Unit tests for the results workbook builder (REQ095).
 *
 * The builder's whole job is to say what a spreadsheet cell contains, so almost
 * every assertion here reads a cell out of a plain model — no XLSX parser, no
 * store, no app. Two properties carry the slice:
 *
 *   - **A stored value is never printed as storage.** `"opt-3"`, `"1|4"` and
 *     `"a:40,b:60"` are how a submission is persisted, not what a participant
 *     said. Every branch of {@link describeAnswer} is checked against the codec
 *     the vote endpoint judged the submission with, including the rows those
 *     codecs refuse because the slide was re-authored underneath them — which
 *     read as an explicit `null`, exactly as the live tally drops them.
 *   - **The tallies are read, never recomputed.** {@link aggregateRowsFor} is
 *     fed the results endpoint's own payload shape and asserted to carry those
 *     numbers through under names of their own, so the file can never disagree
 *     with the screen.
 *
 * Pure: no store, no app, no clock beyond the instant handed in.
 */

import { describe, expect, test } from "bun:test";
import {
	aggregateRowsFor,
	buildResultsWorkbook,
	describeAnswer,
	renderResultsWorkbook,
	type ResultsExportInput,
	resultsExportFilename,
	type SheetCell,
	type SheetModel,
	type WorkbookModel,
} from "./results-export";
import {
	encodeFormSubmission,
	encodeGridPoint,
	encodeGuess,
	encodePinPoint,
	encodePoints,
	encodeRanking,
	PresentationSchema,
	type Presentation,
	type Slide,
	SlideSchema,
	type StoredVote,
	StoredVoteSchema,
} from "./schemas";

/** Parse a hand-written slide through the schema so defaults are filled in. */
function slide(fields: Record<string, unknown>): Slide {
	return SlideSchema.parse(fields);
}

/** Parse a hand-written row through the schema, as a stored vote would be. */
function vote(fields: Record<string, unknown>): StoredVote {
	return StoredVoteSchema.parse({
		id: "vote-1",
		presentationId: "deck-1",
		slideId: "slide-1",
		createdAt: "2026-08-06T10:00:00.000Z",
		...fields,
	});
}

/** A three-field Form slide (REQ061): a name, an address, and a track. */
function formSlide(): Slide {
	return slide({
		id: "slide-1",
		type: "form",
		question: "Sign up for the workshop",
		formFields: [
			{ id: "name", label: "Your name" },
			{ id: "mail", label: "Email", type: "email" },
			{
				id: "track",
				label: "Track",
				type: "choice",
				options: [
					{ id: "design", text: "Design" },
					{ id: "eng", text: "Engineering" },
				],
			},
		],
	});
}

/** Parse a hand-written deck through the public presentation schema. */
function deck(slides: Slide[], fields: Record<string, unknown> = {}): Presentation {
	return PresentationSchema.parse({
		id: "deck-1",
		code: "123456",
		title: "Quarterly Review",
		createdAt: "2026-08-01T09:00:00.000Z",
		slides,
		...fields,
	});
}

/** The sheet with this name, which must exist. */
function sheetNamed(model: WorkbookModel, name: string): SheetModel {
	const found = model.sheets.find((one) => one.name === name);
	expect(found).toBeDefined();
	return found as SheetModel;
}

/** The value of one column in one row, by header name. */
function cellIn(sheet: SheetModel, row: SheetCell[], header: string): SheetCell {
	const index = sheet.columns.findIndex((column) => column.header === header);
	expect(index).toBeGreaterThanOrEqual(0);
	return row[index];
}

/** The one row whose `header` column holds `value`. */
function rowWhere(
	sheet: SheetModel,
	header: string,
	value: SheetCell,
): SheetCell[] {
	const found = sheet.rows.find((row) => cellIn(sheet, row, header) === value);
	expect(found).toBeDefined();
	return found as SheetCell[];
}

/** The value of a metric on the Aggregates rows for one entry. */
function metricValue(
	rows: ReturnType<typeof aggregateRowsFor>,
	entry: string | null,
	metric: string,
): SheetCell {
	const found = rows.find(
		(row) => row.entry === entry && row.metric === metric,
	);
	expect(found).toBeDefined();
	return (found as { value: SheetCell }).value;
}

// ── describeAnswer — storage read back into words ────────────

describe("describeAnswer (REQ095)", () => {
	test("a choice vote is the option's text, not its id", () => {
		const choice = slide({
			id: "slide-1",
			type: "multiple-choice",
			question: "Which release train?",
			options: [
				{ id: "opt-a", text: "Weekly" },
				{ id: "opt-b", text: "Monthly" },
			],
		});
		expect(describeAnswer(choice, vote({ value: "opt-b" }))).toEqual({
			item: null,
			answer: "Monthly",
		});
	});

	test("a choice vote for an option since deleted reads as null", () => {
		const choice = slide({
			id: "slide-1",
			type: "multiple-choice",
			question: "Which release train?",
			options: [{ id: "opt-a", text: "Weekly" }],
		});
		expect(describeAnswer(choice, vote({ value: "opt-gone" })).answer).toBeNull();
	});

	test("a typed quiz answer is the participant's own spelling (REQ055)", () => {
		const typed = slide({
			id: "slide-1",
			type: "quiz",
			question: "Capital of France?",
			quizAnswerMode: "type",
			quizAnswers: [{ id: "qa-1", text: "Paris" }],
		});
		expect(describeAnswer(typed, vote({ value: "  paris " })).answer).toBe(
			"paris",
		);
	});

	test("a ranking is the items in order, by name", () => {
		const ranking = slide({
			id: "slide-1",
			type: "ranking",
			question: "Order these",
			rankingItems: [
				{ id: "rk-1", text: "Speed" },
				{ id: "rk-2", text: "Quality" },
				{ id: "rk-3", text: "Cost" },
			],
		});
		const encoded = encodeRanking(["rk-2", "rk-3", "rk-1"]);
		expect(describeAnswer(ranking, vote({ value: encoded })).answer).toBe(
			"Quality > Cost > Speed",
		);
	});

	test("a points allocation names each funded item and its share", () => {
		const points = slide({
			id: "slide-1",
			type: "points",
			question: "Spend the budget",
			pointsItems: [
				{ id: "pt-1", text: "Docs" },
				{ id: "pt-2", text: "Tooling" },
			],
		});
		const encoded = encodePoints({ "pt-1": 40, "pt-2": 60 });
		expect(describeAnswer(points, vote({ value: encoded })).answer).toBe(
			"Docs: 40; Tooling: 60",
		);
	});

	test("a grid placement carries the item it is about and its coordinates", () => {
		const grid = slide({
			id: "slide-1",
			type: "grid",
			question: "Place each initiative",
			gridItems: [{ id: "gr-1", text: "Migration" }],
		});
		const encoded = encodeGridPoint({ x: 3, y: 8 });
		expect(
			describeAnswer(grid, vote({ value: encoded, statementId: "gr-1" })),
		).toEqual({ item: "Migration", answer: "3, 8" });
	});

	test("a guess is the number, and an off-grid one reads as null (REQ043)", () => {
		const guess = slide({
			id: "slide-1",
			type: "guess-number",
			question: "How many?",
			guessRange: { min: 0, max: 100, step: 10 },
		});
		expect(describeAnswer(guess, vote({ value: encodeGuess(30) })).answer).toBe(
			"30",
		);
		expect(describeAnswer(guess, vote({ value: "33" })).answer).toBeNull();
	});

	test("a pin is its coordinates on the image (REQ051)", () => {
		const pin = slide({
			id: "slide-1",
			type: "pin-image",
			question: "Where?",
			pinImageUrl: "https://example.test/map.png",
		});
		const encoded = encodePinPoint({ x: 250, y: 750 });
		expect(describeAnswer(pin, vote({ value: encoded })).answer).toBe("250, 750");
	});

	test("a skipped statement carries the statement and no answer (REQ031)", () => {
		const scale = slide({
			id: "slide-1",
			type: "scale",
			question: "Rate each",
			scaleStatements: [{ id: "st-1", text: "Tooling" }],
			scaleAllowSkip: true,
		});
		expect(
			describeAnswer(
				scale,
				vote({ value: "", statementId: "st-1", skip: true }),
			),
		).toEqual({ item: "Tooling", answer: null });
	});

	test("a whole form is one row, each field named by what it asked (REQ061)", () => {
		const form = formSlide();
		const value = encodeFormSubmission({
			name: "Ada Lovelace",
			mail: "ada@example.org",
			track: "eng",
		});
		expect(describeAnswer(form, vote({ value }))).toEqual({
			item: null,
			// The choice answer reads as its option's text; the stored id never
			// reaches the sheet.
			answer:
				"Your name: Ada Lovelace; Email: ada@example.org; Track: Engineering",
		});
	});

	test("a form row is read as written, not re-judged by today's rules (REQ061)", () => {
		// The export is the record of what a room wrote. An answer the field's
		// *current* type would refuse — a name under a field since narrowed from
		// text to email — is still what somebody wrote, so the cell carries it. A
		// silent gap would tell the organizer nothing about what happened.
		const form = formSlide();
		const value = encodeFormSubmission({ mail: "Ada Lovelace" });
		expect(describeAnswer(form, vote({ value })).answer).toBe(
			"Email: Ada Lovelace",
		);
	});

	test("a form row that was never a submission is an explicit null (REQ061)", () => {
		// The one thing the read-back still refuses: a value that is not the wire
		// format at all, which no participant surface can produce.
		const form = formSlide();
		expect(describeAnswer(form, vote({ value: "mail" })).answer).toBeNull();
	});
});

// ── aggregateRowsFor — the tally, read not recomputed ────────

describe("aggregateRowsFor (REQ095)", () => {
	test("a choice slide carries every option's count, share and solution", () => {
		const choice = slide({
			id: "slide-1",
			type: "multiple-choice",
			question: "Which release train?",
			options: [
				{ id: "opt-a", text: "Weekly" },
				{ id: "opt-b", text: "Monthly" },
			],
		});
		const rows = aggregateRowsFor(choice, {
			type: "multiple-choice",
			totalVotes: 5,
			respondentCount: 4,
			options: [
				{ id: "opt-a", text: "Weekly", count: 3, isCorrect: true },
				{ id: "opt-b", text: "Monthly", count: 2, isCorrect: false },
			],
			scoring: null,
		});
		expect(metricValue(rows, null, "Respondents")).toBe(4);
		expect(metricValue(rows, null, "Selections")).toBe(5);
		expect(metricValue(rows, "Weekly", "Count")).toBe(3);
		expect(metricValue(rows, "Weekly", "Share %")).toBe(75);
		expect(metricValue(rows, "Weekly", "Correct")).toBe(true);
		expect(metricValue(rows, "Monthly", "Correct")).toBe(false);
	});

	test("a slide with no notion of correctness reports it as null, not false", () => {
		const choice = slide({
			id: "slide-1",
			type: "multiple-choice",
			question: "Which?",
			options: [{ id: "opt-a", text: "Weekly" }],
		});
		const rows = aggregateRowsFor(choice, {
			totalVotes: 1,
			respondentCount: 1,
			options: [{ id: "opt-a", text: "Weekly", count: 1, isCorrect: null }],
			scoring: null,
		});
		expect(metricValue(rows, "Weekly", "Correct")).toBeNull();
	});

	test("a quiz slide carries its score block beside the options (REQ056)", () => {
		const quiz = slide({
			id: "slide-1",
			type: "quiz",
			question: "Capital of France?",
			options: [{ id: "opt-a", text: "Paris", isCorrect: true }],
		});
		const rows = aggregateRowsFor(quiz, {
			totalVotes: 3,
			respondentCount: 3,
			options: [{ id: "opt-a", text: "Paris", count: 2, isCorrect: true }],
			scoring: {
				answeredCount: 3,
				correctCount: 2,
				correctShare: 66.67,
				totalPoints: 1800,
				averagePoints: 600,
				maxPoints: 1000,
			},
		});
		expect(metricValue(rows, null, "Answered")).toBe(3);
		expect(metricValue(rows, null, "Correct answers")).toBe(2);
		expect(metricValue(rows, null, "Correct share %")).toBe(66.67);
		expect(metricValue(rows, null, "Average points")).toBe(600);
	});

	test("a typed quiz reports what the room wrote, not options (REQ055)", () => {
		const typed = slide({
			id: "slide-1",
			type: "quiz",
			question: "Capital of France?",
			quizAnswerMode: "type",
			quizAnswers: [{ id: "qa-1", text: "Paris" }],
		});
		const rows = aggregateRowsFor(typed, {
			totalVotes: 2,
			respondentCount: 2,
			options: [],
			typedAnswers: {
				accepted: ["Paris"],
				distinctCount: 2,
				entries: [
					{ text: "Paris", count: 1, isCorrect: true },
					{ text: "Lyon", count: 1, isCorrect: false },
				],
			},
			scoring: null,
		});
		expect(metricValue(rows, null, "Accepted answers")).toBe("Paris");
		expect(metricValue(rows, null, "Distinct answers")).toBe(2);
		expect(metricValue(rows, "Lyon", "Correct")).toBe(false);
	});

	test("a multi-statement scale reports each statement's average and skips", () => {
		const scale = slide({
			id: "slide-1",
			type: "scale",
			question: "Rate each",
			scaleStatements: [
				{ id: "st-1", text: "Tooling" },
				{ id: "st-2", text: "Docs" },
			],
		});
		const rows = aggregateRowsFor(scale, {
			totalVotes: 4,
			min: 1,
			max: 5,
			statements: [
				{ statementId: "st-1", text: "Tooling", answered: 2, skipped: 1, average: 4.5 },
				{ statementId: "st-2", text: "Docs", answered: 1, skipped: 0, average: 2 },
			],
		});
		expect(metricValue(rows, "Tooling", "Average")).toBe(4.5);
		expect(metricValue(rows, "Tooling", "Skipped")).toBe(1);
		expect(metricValue(rows, "Docs", "Answered")).toBe(1);
		expect(metricValue(rows, null, "Scale maximum")).toBe(5);
	});

	test("a ranking item that nobody placed keeps a null average rank", () => {
		const ranking = slide({
			id: "slide-1",
			type: "ranking",
			question: "Order these",
			rankingItems: [{ id: "rk-1", text: "Speed" }],
		});
		const rows = aggregateRowsFor(ranking, {
			totalVotes: 2,
			ballots: 2,
			itemCount: 1,
			items: [
				{
					id: "rk-1",
					text: "Speed",
					rank: 1,
					points: 0,
					rankedCount: 0,
					notRanked: 2,
					averageRank: null,
				},
			],
		});
		expect(metricValue(rows, "Speed", "Average rank")).toBeNull();
		expect(metricValue(rows, "Speed", "Not ranked by")).toBe(2);
	});

	test("a guess slide carries its statistics and every bucket", () => {
		const guess = slide({
			id: "slide-1",
			type: "guess-number",
			question: "How many?",
			guessRange: { min: 0, max: 10, step: 5 },
		});
		const rows = aggregateRowsFor(guess, {
			totalVotes: 3,
			guessCount: 3,
			lowestGuess: 0,
			highestGuess: 10,
			averageGuess: 5,
			medianGuess: 5,
			reference: 5,
			tolerance: 1,
			correctCount: 1,
			correctShare: 33.33,
			buckets: [
				{ from: 0, to: 4, count: 1, share: 33.33 },
				{ from: 5, to: 10, count: 2, share: 66.67 },
			],
		});
		expect(metricValue(rows, null, "Median guess")).toBe(5);
		expect(metricValue(rows, null, "Within tolerance %")).toBe(33.33);
		expect(metricValue(rows, "5 to 10", "Count")).toBe(2);
	});

	test("a grid item's averages are named by the axes the organizer wrote", () => {
		const grid = slide({
			id: "slide-1",
			type: "grid",
			question: "Place each",
			gridItems: [{ id: "gr-1", text: "Migration" }],
		});
		const rows = aggregateRowsFor(grid, {
			totalVotes: 2,
			itemCount: 1,
			xAxis: { title: "Effort", min: 0, max: 10 },
			yAxis: { title: "Impact", min: 0, max: 10 },
			items: [
				{
					itemId: "gr-1",
					text: "Migration",
					placed: 2,
					skipped: 0,
					averageX: 1.5,
					averageY: 7.5,
				},
			],
		});
		expect(metricValue(rows, "Migration", "Average Effort")).toBe(1.5);
		expect(metricValue(rows, "Migration", "Average Impact")).toBe(7.5);
	});

	test("a form carries its fill rate, field by field (REQ061)", () => {
		const rows = aggregateRowsFor(formSlide(), {
			type: "form",
			totalVotes: 4,
			submissionCount: 4,
			fieldCount: 3,
			fields: [
				{
					fieldId: "name",
					label: "Your name",
					type: "text",
					required: false,
					answered: 4,
					options: [],
				},
				{
					fieldId: "track",
					label: "Track",
					type: "choice",
					required: false,
					answered: 3,
					options: [
						{ optionId: "design", text: "Design", count: 1 },
						{ optionId: "eng", text: "Engineering", count: 2 },
					],
				},
			],
			submissions: null,
		});
		expect(metricValue(rows, null, "Submissions")).toBe(4);
		expect(metricValue(rows, null, "Fields")).toBe(3);
		expect(metricValue(rows, "Your name", "Answered")).toBe(4);
		expect(metricValue(rows, "Track", "Answered")).toBe(3);
		// A choice field's picks are the one part of a form that is a
		// distribution, so they are counted per option under the field they
		// belong to.
		expect(metricValue(rows, "Track: Engineering", "Count")).toBe(2);
	});

	test("a content slide is still accounted for, with an explicit zero", () => {
		const text = slide({ id: "slide-1", type: "text", question: "Welcome" });
		const rows = aggregateRowsFor(text, { type: "text", totalVotes: 0 });
		expect(metricValue(rows, null, "Responses")).toBe(0);
	});
});

// ── The workbook as a whole ──────────────────────────────────

const DECK: Slide[] = [
	slide({
		id: "mc",
		type: "multiple-choice",
		question: "Which release train?",
		options: [
			{ id: "opt-a", text: "Weekly" },
			{ id: "opt-b", text: "Monthly" },
		],
	}),
	slide({ id: "wc", type: "word-cloud", question: "One word" }),
	slide({ id: "intro", type: "text", question: "Welcome" }),
];

const VOTES: StoredVote[] = [
	vote({ id: "v1", slideId: "mc", value: "opt-a", participantId: "p1" }),
	vote({ id: "v2", slideId: "mc", value: "opt-b", participantId: "p2" }),
	vote({ id: "v3", slideId: "wc", value: "steady", participantId: "p1" }),
];

const INPUT: ResultsExportInput = {
	presentation: deck(DECK),
	votes: VOTES,
	responseVotes: [],
	participantNames: {},
	results: [
		{
			slideId: "mc",
			question: "Which release train?",
			type: "multiple-choice",
			totalVotes: 2,
			respondentCount: 2,
			options: [
				{ id: "opt-a", text: "Weekly", count: 1, isCorrect: null },
				{ id: "opt-b", text: "Monthly", count: 1, isCorrect: null },
			],
			scoring: null,
		},
		{
			slideId: "wc",
			question: "One word",
			type: "word-cloud",
			totalVotes: 1,
			words: [{ text: "steady", count: 1 }],
		},
		{ slideId: "intro", question: "Welcome", type: "text", totalVotes: 0 },
	],
	exportedAt: "2026-08-06T12:30:00.000Z",
};

describe("buildResultsWorkbook (REQ095)", () => {
	const model = buildResultsWorkbook(INPUT);

	test("the workbook holds the five sheets the export promises", () => {
		expect(model.sheets.map((sheet) => sheet.name)).toEqual([
			"Summary",
			"Slides",
			"Responses",
			"Participants",
			"Aggregates",
		]);
	});

	test("the summary counts participants, not rows", () => {
		const summary = sheetNamed(model, "Summary");
		expect(rowWhere(summary, "Field", "Participants")[1]).toBe(2);
		expect(rowWhere(summary, "Field", "Responses")[1]).toBe(3);
		expect(rowWhere(summary, "Field", "Slides")[1]).toBe(3);
		expect(rowWhere(summary, "Field", "Interactive slides")[1]).toBe(2);
		expect(rowWhere(summary, "Field", "Exported at")[1]).toBe(
			"2026-08-06T12:30:00.000Z",
		);
	});

	test("the summary never carries the deck's edit-token hash or owner", () => {
		// The presentation arrives parsed through the public schema, which drops
		// them by construction — but a spreadsheet is a file that leaves the
		// building, so it is asserted here too rather than trusted upstream.
		const flattened = JSON.stringify(model);
		expect(flattened).not.toContain("creatorTokenHash");
		expect(flattened).not.toContain("creatorId");
	});

	test("every slide gets a row, content slides included", () => {
		const slides = sheetNamed(model, "Slides");
		expect(slides.rows).toHaveLength(3);
		const contentRow = rowWhere(slides, "Slide ID", "intro");
		expect(cellIn(slides, contentRow, "Responses")).toBe(0);
		expect(cellIn(slides, contentRow, "Participants")).toBe(0);
	});

	test("responses are one row per submission, in deck order", () => {
		const responses = sheetNamed(model, "Responses");
		expect(responses.rows).toHaveLength(3);
		expect(
			responses.rows.map((row) => cellIn(responses, row, "Slide ID")),
		).toEqual(["mc", "mc", "wc"]);
		const first = responses.rows[0];
		expect(cellIn(responses, first, "Slide #")).toBe(1);
		expect(cellIn(responses, first, "Participant")).toBe("p1");
		expect(cellIn(responses, first, "Answer")).toBe("Weekly");
		expect(cellIn(responses, first, "Item")).toBeNull();
		expect(cellIn(responses, first, "Skipped")).toBe(false);
	});

	test("the participant matrix has one column per interactive slide", () => {
		const participants = sheetNamed(model, "Participants");
		expect(participants.columns.map((column) => column.header)).toEqual([
			"Participant",
			// REQ076 — the name column keeps its place whether or not the deck
			// asked for names; this fixture did not, so every cell in it is null.
			"Name",
			"1. Which release train?",
			"2. One word",
		]);
		const second = rowWhere(participants, "Participant", "p2");
		expect(cellIn(participants, second, "1. Which release train?")).toBe(
			"Monthly",
		);
		// An explicit null, never an empty string: this participant did not answer
		// the word cloud, which is a different reading from a blank answer.
		expect(cellIn(participants, second, "2. One word")).toBeNull();
	});

	test("aggregates carry the endpoint's own numbers under named metrics", () => {
		const aggregates = sheetNamed(model, "Aggregates");
		const weekly = aggregates.rows.find(
			(row) =>
				cellIn(aggregates, row, "Entry") === "Weekly" &&
				cellIn(aggregates, row, "Metric") === "Count",
		);
		expect(weekly).toBeDefined();
		expect(cellIn(aggregates, weekly as SheetCell[], "Value")).toBe(1);
		expect(cellIn(aggregates, weekly as SheetCell[], "Slide #")).toBe(1);
	});

	test("a deck nobody answered exports empty sheets rather than failing", () => {
		const empty = buildResultsWorkbook({
			...INPUT,
			votes: [],
			results: [],
		});
		expect(sheetNamed(empty, "Responses").rows).toHaveLength(0);
		expect(sheetNamed(empty, "Participants").rows).toHaveLength(0);
		expect(rowWhere(sheetNamed(empty, "Summary"), "Field", "Participants")[1]).toBe(
			0,
		);
		// The slides are still listed — an empty session is a session that ran.
		expect(sheetNamed(empty, "Slides").rows).toHaveLength(3);
	});
});

describe("renderResultsWorkbook (REQ095)", () => {
	test("renders a model to XLSX bytes", async () => {
		const bytes = await renderResultsWorkbook(buildResultsWorkbook(INPUT));
		const view = new Uint8Array(bytes as ArrayBufferLike);
		expect(view.byteLength).toBeGreaterThan(0);
		// The ZIP local-file-header magic every XLSX starts with.
		expect([view[0], view[1], view[2], view[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
	});
});

describe("resultsExportFilename (REQ095)", () => {
	test("slugs the title and dates the file from the export instant", () => {
		expect(
			resultsExportFilename("Quarterly Review 2026!", "2026-08-06T12:30:00.000Z"),
		).toBe("quarterly-review-2026-results-2026-08-06.xlsx");
	});

	test("falls back for a title that slugs to nothing", () => {
		expect(resultsExportFilename("!!!", "2026-08-06T12:30:00.000Z")).toBe(
			"presentation-results-2026-08-06.xlsx",
		);
	});
});
