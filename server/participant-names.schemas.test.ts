/**
 * Unit tests for participant names (REQ076) — the pure half.
 *
 * Everything here is a function of its arguments: no store, no app, no clock.
 * Three properties carry the slice at this level:
 *
 *   - **A name is normalised where it is written, not where it is read.**
 *     {@link normalizeParticipantName} folds whitespace, trims and caps, so the
 *     roster row, the spreadsheet cell and the PDF line are all handed one line
 *     rather than each escaping a newline in its own way.
 *   - **The switch is the deck's, and it is off by default.** Every schema that
 *     carries `requireParticipantName` defaults it to `false`, which is what
 *     lets a deck written before the field existed re-parse forward onto the
 *     anonymous room it already had.
 *   - **The exports keep the distinction an explicit `null` makes.** A
 *     participant who stated nothing reads as an explicit `null`, never as an
 *     empty string, in both the workbook and the PDF.
 */

import { describe, expect, test } from "bun:test";
import {
	buildResultsWorkbook,
	participantNameFor,
	type ResultsExportInput,
	type SheetCell,
	type SheetModel,
} from "./results-export";
import { buildDeckDocument, type DeckPdfInput, type PdfBlock } from "./deck-pdf";
import {
	CreatePresentationSchema,
	deckRequiresParticipantName,
	normalizeParticipantName,
	orderParticipantRoster,
	PARTICIPANT_NAME_MAX_LENGTH,
	ParticipantNameSchema,
	ParticipantRosterEntrySchema,
	type Presentation,
	PresentationSchema,
	type Slide,
	SlideSchema,
	StoredParticipantNameSchema,
	StoredPresentationSchema,
	type StoredVote,
	StoredVoteSchema,
	UpdatePresentationSchema,
} from "./schemas";

// ── Normalising a stated name ────────────────────────────────

describe("normalizeParticipantName (REQ076)", () => {
	test("trims the ends", () => {
		expect(normalizeParticipantName("  Ada  ")).toBe("Ada");
	});

	test("folds every run of whitespace to one space", () => {
		// The load-bearing case: a name pasted with a newline in it would break a
		// spreadsheet cell and a roster row alike, so it is folded once here
		// rather than escaped at each of the four places a name is drawn.
		expect(normalizeParticipantName("Ada\n\tLovelace   King")).toBe(
			"Ada Lovelace King",
		);
	});

	test("caps at the declared length", () => {
		const long = "a".repeat(PARTICIPANT_NAME_MAX_LENGTH + 40);
		expect(normalizeParticipantName(long)).toHaveLength(
			PARTICIPANT_NAME_MAX_LENGTH,
		);
	});

	test("a name of nothing but whitespace normalises to nothing", () => {
		expect(normalizeParticipantName("   \n  ")).toBe("");
	});
});

// ── The request boundary ─────────────────────────────────────

describe("ParticipantNameSchema (REQ076)", () => {
	test("trims at the boundary, so a padded name is accepted as its content", () => {
		const parsed = ParticipantNameSchema.parse({
			participantId: "p1",
			name: "  Ada  ",
		});
		expect(parsed.name).toBe("Ada");
	});

	test("a blank name is refused rather than stored empty", () => {
		expect(() =>
			ParticipantNameSchema.parse({ participantId: "p1", name: "   " }),
		).toThrow();
	});

	test("a name past the cap is refused rather than truncated", () => {
		expect(() =>
			ParticipantNameSchema.parse({
				participantId: "p1",
				name: "a".repeat(PARTICIPANT_NAME_MAX_LENGTH + 1),
			}),
		).toThrow();
	});

	test("a name belonging to nobody is refused", () => {
		expect(() =>
			ParticipantNameSchema.parse({ participantId: "", name: "Ada" }),
		).toThrow();
	});
});

// ── The deck's switch ────────────────────────────────────────

describe("requireParticipantName (REQ076)", () => {
	test("a stored deck written before the field existed reads as off", () => {
		const stored = StoredPresentationSchema.parse({ id: "deck-1" });
		expect(stored.requireParticipantName).toBe(false);
		expect(deckRequiresParticipantName(stored)).toBe(false);
	});

	test("a create that says nothing asks for no names", () => {
		const created = CreatePresentationSchema.parse({
			title: "Retro",
			slides: [{ id: "s1", type: "word-cloud", question: "One word?" }],
		});
		expect(created.requireParticipantName).toBe(false);
	});

	test("a create can turn it on, and the response carries it", () => {
		const created = CreatePresentationSchema.parse({
			title: "Retro",
			slides: [{ id: "s1", type: "word-cloud", question: "One word?" }],
			requireParticipantName: true,
		});
		expect(created.requireParticipantName).toBe(true);
		const response = PresentationSchema.parse({
			id: "deck-1",
			code: "123456",
			title: "Retro",
			slides: [],
			createdAt: "2026-08-14T09:00:00.000Z",
			requireParticipantName: true,
		});
		expect(response.requireParticipantName).toBe(true);
		expect(deckRequiresParticipantName(response)).toBe(true);
	});

	test("the patch carries it, and carries nothing when it is not named", () => {
		expect(
			UpdatePresentationSchema.parse({ requireParticipantName: true }),
		).toEqual({ requireParticipantName: true });
		// A PATCH is defined by the keys it carries: a default here would turn
		// every save into a claim about a setting the request never mentioned.
		expect(UpdatePresentationSchema.parse({ title: "Retro" })).toEqual({
			title: "Retro",
		});
	});
});

// ── The stored row ───────────────────────────────────────────

describe("StoredParticipantNameSchema (REQ076)", () => {
	test("the identity pair carries no default and fails loudly", () => {
		expect(() =>
			StoredParticipantNameSchema.parse({ id: "row-1", presentationId: "d1" }),
		).toThrow();
	});

	test("everything else defaults, so the shape can grow with no migration", () => {
		const row = StoredParticipantNameSchema.parse({
			id: "row-1",
			presentationId: "deck-1",
			participantId: "p1",
		});
		expect(row).toEqual({
			id: "row-1",
			presentationId: "deck-1",
			participantId: "p1",
			name: "",
			createdAt: "",
			updatedAt: "",
		});
	});
});

// ── Reading the roster ───────────────────────────────────────

describe("orderParticipantRoster (REQ076)", () => {
	const entry = (participantId: string, name: string) =>
		ParticipantRosterEntrySchema.parse({ participantId, name });

	test("orders by name, case-insensitively", () => {
		const ordered = orderParticipantRoster([
			entry("p3", "charlie"),
			entry("p1", "Ada"),
			entry("p2", "bob"),
		]);
		expect(ordered.map((row) => row.name)).toEqual(["Ada", "bob", "charlie"]);
	});

	test("two people with one name are ordered by their id, stably", () => {
		const ordered = orderParticipantRoster([
			entry("p9", "Ada"),
			entry("p2", "ada"),
		]);
		expect(ordered.map((row) => row.participantId)).toEqual(["p2", "p9"]);
	});

	test("a roster entry defaults every field but its id", () => {
		expect(ParticipantRosterEntrySchema.parse({ participantId: "p1" })).toEqual({
			participantId: "p1",
			name: "",
			answeredSlides: 0,
			statedAt: "",
		});
	});
});

describe("participantNameFor (REQ076)", () => {
	test("reads a stated name", () => {
		expect(participantNameFor({ p1: "Ada" }, "p1")).toBe("Ada");
	});

	test("an unknown participant reads as null, never as an empty cell", () => {
		expect(participantNameFor({ p1: "Ada" }, "p2")).toBeNull();
	});

	test("a stored blank reads as null too — nobody is called nothing", () => {
		expect(participantNameFor({ p1: "" }, "p1")).toBeNull();
	});
});

// ── The exports ──────────────────────────────────────────────

function slide(fields: Record<string, unknown>): Slide {
	return SlideSchema.parse(fields);
}

function vote(fields: Record<string, unknown>): StoredVote {
	return StoredVoteSchema.parse({
		presentationId: "deck-1",
		createdAt: "2026-08-14T10:00:00.000Z",
		...fields,
	});
}

function deck(fields: Record<string, unknown> = {}): Presentation {
	return PresentationSchema.parse({
		id: "deck-1",
		code: "123456",
		title: "Retro",
		createdAt: "2026-08-14T09:00:00.000Z",
		slides: [slide({ id: "wc", type: "word-cloud", question: "One word" })],
		...fields,
	});
}

const NAMED_VOTES: StoredVote[] = [
	vote({ id: "v1", slideId: "wc", value: "steady", participantId: "p1" }),
	vote({ id: "v2", slideId: "wc", value: "busy", participantId: "p2" }),
];

function exportInput(fields: Partial<ResultsExportInput> = {}): ResultsExportInput {
	return {
		presentation: deck({ requireParticipantName: true }),
		votes: NAMED_VOTES,
		responseVotes: [],
		// p2 answered without ever stating one — the case a deck acquires when the
		// switch is turned on mid-session.
		participantNames: { p1: "Ada" },
		results: [
			{
				slideId: "wc",
				question: "One word",
				type: "word-cloud",
				totalVotes: 2,
				words: [
					{ text: "steady", count: 1 },
					{ text: "busy", count: 1 },
				],
			},
		],
		exportedAt: "2026-08-14T12:00:00.000Z",
		...fields,
	};
}

function sheetNamed(model: { sheets: SheetModel[] }, name: string): SheetModel {
	const sheet = model.sheets.find((candidate) => candidate.name === name);
	if (!sheet) throw new Error(`no sheet named ${name}`);
	return sheet;
}

function cellIn(sheet: SheetModel, row: SheetCell[], header: string): SheetCell {
	const index = sheet.columns.findIndex((column) => column.header === header);
	if (index === -1) throw new Error(`no column named ${header}`);
	return row[index];
}

describe("the workbook carries the stated names (REQ076/REQ095)", () => {
	const model = buildResultsWorkbook(exportInput());

	test("the Responses sheet names the person beside the id", () => {
		const responses = sheetNamed(model, "Responses");
		const named = responses.rows.find(
			(row) => cellIn(responses, row, "Participant") === "p1",
		) as SheetCell[];
		expect(cellIn(responses, named, "Name")).toBe("Ada");
	});

	test("a row cast by somebody who stated nothing keeps an explicit null", () => {
		const responses = sheetNamed(model, "Responses");
		const anonymous = responses.rows.find(
			(row) => cellIn(responses, row, "Participant") === "p2",
		) as SheetCell[];
		expect(cellIn(responses, anonymous, "Name")).toBeNull();
		// And the row is still there: an unnamed answer is an answer.
		expect(cellIn(responses, anonymous, "Answer")).toBe("busy");
	});

	test("the participant matrix carries the name beside the id", () => {
		const participants = sheetNamed(model, "Participants");
		expect(participants.columns[0].header).toBe("Participant");
		expect(participants.columns[1].header).toBe("Name");
		const first = participants.rows.find(
			(row) => cellIn(participants, row, "Participant") === "p1",
		) as SheetCell[];
		expect(cellIn(participants, first, "Name")).toBe("Ada");
	});

	test("the summary states both the switch and how many actually said", () => {
		const summary = sheetNamed(model, "Summary");
		const rowFor = (field: string) =>
			summary.rows.find((row) => row[0] === field)?.[1];
		expect(rowFor("Names required")).toBe(true);
		expect(rowFor("Participants")).toBe(2);
		expect(rowFor("Participants named")).toBe(1);
	});

	test("a deck that asked for no names still has the columns, all empty", () => {
		const anonymous = buildResultsWorkbook(
			exportInput({
				presentation: deck({ requireParticipantName: false }),
				participantNames: {},
			}),
		);
		const responses = sheetNamed(anonymous, "Responses");
		expect(
			responses.rows.every(
				(row) => cellIn(responses, row, "Name") === null,
			),
		).toBe(true);
		const summary = sheetNamed(anonymous, "Summary");
		expect(summary.rows.find((row) => row[0] === "Names required")?.[1]).toBe(
			false,
		);
	});
});

function pdfInput(fields: Partial<DeckPdfInput> = {}): DeckPdfInput {
	return { ...exportInput(), includeResults: true, ...fields };
}

/** Every table block in a document, whatever section it is in. */
function tablesIn(document: { sections: { blocks: PdfBlock[] }[] }) {
	return document.sections
		.flatMap((section) => section.blocks)
		.filter((block): block is Extract<PdfBlock, { kind: "table" }> =>
			block.kind === "table",
		);
}

describe("the PDF carries the roster (REQ076/REQ096)", () => {
	test("a named deck gets a roster page, ordered by name", () => {
		const document = buildDeckDocument(pdfInput());
		const roster = tablesIn(document).find((table) =>
			table.columns.includes("Slides answered"),
		);
		expect(roster).toBeDefined();
		// No participant id column: an id is a participant's only credential here
		// — it is what a vote, a question and a stated name are all accepted on —
		// and this document is a handout by its own description. Name and count
		// say who was here; the join to the workbook is the workbook's.
		expect(roster?.columns).toEqual(["Name", "Slides answered"]);
		// Ada first because she is named; the unnamed row is kept and drawn with
		// the document's own empty mark rather than dropped, so the page and the
		// participant count on the cover agree.
		expect(roster?.rows.map((row) => row[0])).toEqual(["Ada", "—"]);
	});

	test("no participant id is printed anywhere in the document", () => {
		// Asserted over the whole document rather than over the roster's columns,
		// so a later section that starts carrying one fails here too.
		const document = buildDeckDocument(pdfInput());
		const printed = JSON.stringify(document);
		expect(printed).toContain("Ada");
		expect(printed).not.toContain("p1");
		expect(printed).not.toContain("p2");
	});

	test("names collected before the switch was turned off still print", () => {
		// The workbook reads the roster unconditionally, with the stated reason
		// that an export dropping them "would be a record of the session that is
		// missing what the session recorded". The two formats have to agree: a
		// deck whose organizer switched names off after the session still ran a
		// session that collected them.
		const document = buildDeckDocument(
			pdfInput({ presentation: deck({ requireParticipantName: false }) }),
		);
		const roster = tablesIn(document).find((table) =>
			table.columns.includes("Slides answered"),
		);
		expect(roster?.rows.map((row) => row[0])).toEqual(["Ada", "—"]);
	});

	test("a room that answered without ever stating a name gets no page", () => {
		const document = buildDeckDocument(pdfInput({ participantNames: {} }));
		expect(
			tablesIn(document).some((table) =>
				table.columns.includes("Slides answered"),
			),
		).toBe(false);
	});

	test("the cover says names were required", () => {
		const document = buildDeckDocument(pdfInput());
		const facts = document.sections[0].blocks.find(
			(block): block is Extract<PdfBlock, { kind: "facts" }> =>
				block.kind === "facts",
		);
		expect(
			facts?.facts.find((fact) => fact.label === "Names required")?.value,
		).toBe("yes");
	});

	test("a deck that asked for no names gets neither the page nor the line", () => {
		const document = buildDeckDocument(
			pdfInput({
				presentation: deck({ requireParticipantName: false }),
				participantNames: {},
			}),
		);
		expect(
			tablesIn(document).some((table) =>
				table.columns.includes("Slides answered"),
			),
		).toBe(false);
		const facts = document.sections[0].blocks.find(
			(block): block is Extract<PdfBlock, { kind: "facts" }> =>
				block.kind === "facts",
		);
		expect(
			facts?.facts.some((fact) => fact.label === "Names required"),
		).toBe(false);
	});

	test("an export taken without results carries no roster at all", () => {
		const document = buildDeckDocument(pdfInput({ includeResults: false }));
		expect(
			tablesIn(document).some((table) =>
				table.columns.includes("Slides answered"),
			),
		).toBe(false);
	});
});
