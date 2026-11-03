/**
 * Unit tests for repeat passes through an audience-paced deck (REQ083), against
 * the schemas and the pure functions alone — no server, no store.
 *
 * Four things are held here:
 *
 *  - **Every new stored field reads forward.** A vote, a response upvote and a
 *    deck written before passes existed carry no `pass` / `allowRepeatPasses`
 *    key at all, and each re-parses onto the value that changes nothing: the
 *    first pass, and the switch off.
 *  - **Which pass a request lands in** is one pure rule (`submissionPassFor`),
 *    and every case of it is spelled out — above all that a device that never
 *    started another pass stays on its first, that a pass the server opened
 *    stays open, and that a number nobody opened can never become a pass.
 *  - **A respondent is one device's one pass**, and a first pass is named by the
 *    participant id itself — so a deck that never allowed a second pass counts
 *    exactly the people it always counted.
 *  - **The exports and the breakdown count respondents**: the workbook's
 *    Summary, Slides and Participants sheets, the PDF's cover and roster, and
 *    the segmented join.
 */

import { describe, expect, test } from "bun:test";
import { buildDeckDocument, type PdfBlock, rosterLabel } from "./deck-pdf";
import {
	buildResultsWorkbook,
	type ResultsExportInput,
	respondentIdsIn,
	respondentsIn,
	type SheetCell,
	type SheetModel,
} from "./results-export";
import {
	CreatePresentationSchema,
	deckAllowsRepeatPasses,
	FIRST_PASS,
	isVoteRefusalCode,
	passOf,
	type Presentation,
	PresentationSchema,
	respondentIdFor,
	respondentIdOf,
	ResponseVoteSchema,
	type Slide,
	SlideSchema,
	StartPassSchema,
	StoredParticipantPassSchema,
	StoredPresentationSchema,
	StoredResponseVoteSchema,
	type StoredVote,
	StoredVoteSchema,
	submissionPassFor,
	UpdatePresentationSchema,
	VOTE_REFUSAL_CODES,
	VoteSchema,
} from "./schemas";
import { segmentBucketsFor } from "./segmentation";

// ── Stored fields read forward ───────────────────────────────

describe("the stored vote's pass (REQ083)", () => {
	const legacyVote = {
		id: "v1",
		presentationId: "deck-1",
		slideId: "s1",
		value: "a",
		participantId: "p1",
		createdAt: "2026-10-01T10:00:00.000Z",
	};

	test("a vote written before passes existed reads as the first pass", () => {
		expect("pass" in legacyVote).toBe(false);
		expect(StoredVoteSchema.parse(legacyVote).pass).toBe(FIRST_PASS);
	});

	test("a later pass is kept as written", () => {
		expect(StoredVoteSchema.parse({ ...legacyVote, pass: 3 }).pass).toBe(3);
	});

	test("anything that is not a pass number is refused on the way in", () => {
		for (const pass of [0, -1, 1.5, "2", null]) {
			expect(StoredVoteSchema.safeParse({ ...legacyVote, pass }).success).toBe(
				false,
			);
		}
	});

	test("a response upvote written before passes existed is the first pass's too", () => {
		const legacyUpvote = {
			id: "u1",
			presentationId: "deck-1",
			slideId: "s1",
			responseId: "v1",
			participantId: "p1",
		};
		expect(StoredResponseVoteSchema.parse(legacyUpvote).pass).toBe(FIRST_PASS);
		expect(StoredResponseVoteSchema.parse({ ...legacyUpvote, pass: 2 }).pass).toBe(
			2,
		);
		expect(
			StoredResponseVoteSchema.safeParse({ ...legacyUpvote, pass: 0 }).success,
		).toBe(false);
	});
});

describe("the deck's switch (REQ083)", () => {
	const legacyDeck = { id: "deck-1", code: "123456", title: "Retro" };

	test("a deck stored before the switch existed reads as off", () => {
		expect(StoredPresentationSchema.parse(legacyDeck).allowRepeatPasses).toBe(
			false,
		);
	});

	test("the public deck always carries the switch, as an explicit false by default", () => {
		const parsed = PresentationSchema.parse({
			...legacyDeck,
			slides: [],
			createdAt: "",
		});
		expect("allowRepeatPasses" in parsed).toBe(true);
		expect(parsed.allowRepeatPasses).toBe(false);
	});

	test("a create that never heard of the switch creates a deck with it off", () => {
		const created = CreatePresentationSchema.parse({
			title: "Survey",
			slides: [{ id: "s1", type: "word-cloud", question: "Word?" }],
			mode: "survey",
		});
		expect(created.allowRepeatPasses).toBe(false);
		expect(
			CreatePresentationSchema.parse({
				title: "Survey",
				slides: [{ id: "s1", type: "word-cloud", question: "Word?" }],
				allowRepeatPasses: true,
			}).allowRepeatPasses,
		).toBe(true);
	});

	test("a PATCH that does not name the switch does not claim one", () => {
		// Defaults are deliberately absent here: `updatePresentation` broadcasts
		// on `"allowRepeatPasses" in changes`, so a default would turn every save
		// into a claim about a setting the request never mentioned.
		expect("allowRepeatPasses" in UpdatePresentationSchema.parse({})).toBe(false);
		expect(
			UpdatePresentationSchema.parse({ allowRepeatPasses: true }).allowRepeatPasses,
		).toBe(true);
		expect(
			UpdatePresentationSchema.safeParse({ allowRepeatPasses: "yes" }).success,
		).toBe(false);
	});

	test("only an audience-paced deck with the switch on allows another pass", () => {
		expect(deckAllowsRepeatPasses({ mode: "survey", allowRepeatPasses: true })).toBe(
			true,
		);
		expect(deckAllowsRepeatPasses({ mode: "survey", allowRepeatPasses: false })).toBe(
			false,
		);
		// Stored but not in effect: a presenter-paced room is one pass through.
		expect(deckAllowsRepeatPasses({ mode: "live", allowRepeatPasses: true })).toBe(
			false,
		);
		// A deck that says nothing is presenter-paced with the switch off.
		expect(deckAllowsRepeatPasses({})).toBe(false);
		expect(deckAllowsRepeatPasses({ allowRepeatPasses: true })).toBe(false);
	});
});

describe("the request shapes (REQ083)", () => {
	test("a vote's pass is optional, and absent means the first", () => {
		const parsed = VoteSchema.parse({ slideId: "s1", value: "a" });
		expect(parsed.pass).toBeUndefined();
		expect(VoteSchema.parse({ slideId: "s1", value: "a", pass: 4 }).pass).toBe(4);
	});

	test("a vote naming something that is not a pass is refused", () => {
		for (const pass of [0, -3, 2.5, "2", Number.MAX_SAFE_INTEGER + 2]) {
			expect(
				VoteSchema.safeParse({ slideId: "s1", value: "a", pass }).success,
			).toBe(false);
		}
	});

	test("an upvote names its pass the same way", () => {
		const base = { slideId: "s1", responseId: "r1", participantId: "p1" };
		expect(ResponseVoteSchema.parse(base).pass).toBeUndefined();
		expect(ResponseVoteSchema.parse({ ...base, pass: 2 }).pass).toBe(2);
		expect(ResponseVoteSchema.safeParse({ ...base, pass: 0 }).success).toBe(false);
	});

	test("starting a pass needs a participant and nothing else", () => {
		expect(StartPassSchema.safeParse({}).success).toBe(false);
		expect(StartPassSchema.safeParse({ participantId: "" }).success).toBe(false);
		expect(StartPassSchema.parse({ participantId: "p1" })).toEqual({
			participantId: "p1",
		});
		// Which pass comes next is the server's to say, so a client's idea of it
		// is not even read.
		expect(StartPassSchema.parse({ participantId: "p1", pass: 7 })).toEqual({
			participantId: "p1",
		});
	});

	test("the refusal a phone meets when the deck stops allowing passes is part of the vocabulary", () => {
		expect(VOTE_REFUSAL_CODES).toContain("repeat-passes-off");
		expect(isVoteRefusalCode("repeat-passes-off")).toBe(true);
	});
});

// ── The pure rules ───────────────────────────────────────────

describe("passOf (REQ083)", () => {
	test("a row with no pass is the first", () => {
		expect(passOf({})).toBe(FIRST_PASS);
	});

	test("a later pass reads as itself", () => {
		expect(passOf({ pass: 1 })).toBe(1);
		expect(passOf({ pass: 4 })).toBe(4);
	});

	test("anything that is not a pass number reads as the first", () => {
		for (const pass of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
			expect(passOf({ pass })).toBe(FIRST_PASS);
		}
	});
});

describe("respondentIdFor / respondentIdOf (REQ083)", () => {
	test("a first pass is named by the participant id itself", () => {
		// The property every pre-existing count rests on: a deck that never
		// allowed a second pass is keyed exactly as it always was.
		expect(respondentIdFor("p1", FIRST_PASS)).toBe("p1");
		expect(respondentIdOf({ participantId: "p1" })).toBe("p1");
		expect(respondentIdOf({ participantId: "p1", pass: 1 })).toBe("p1");
	});

	test("each later pass is somebody else", () => {
		const passes = [1, 2, 3].map((pass) => respondentIdFor("p1", pass));
		expect(new Set(passes).size).toBe(3);
		expect(respondentIdOf({ participantId: "p1", pass: 2 })).toBe(
			respondentIdFor("p1", 2),
		);
	});

	test("the same pass of two devices is two respondents", () => {
		expect(respondentIdFor("p1", 2)).not.toBe(respondentIdFor("p2", 2));
	});

	test("an absent participant stays absent whatever the pass", () => {
		expect(respondentIdFor("", 3)).toBe("");
		expect(respondentIdOf({ pass: 3 })).toBe("");
	});

	test("an id carrying the separator cannot pose as another device's later pass", () => {
		// Found by the review of REQ083: `a#2` on its first pass and `a` on its
		// second were both `a#2`, merged in every count, score and export.
		expect(respondentIdFor("a#2", FIRST_PASS)).not.toBe(respondentIdFor("a", 2));
		expect(respondentIdOf({ participantId: "a#2", pass: 1 })).not.toBe(
			respondentIdOf({ participantId: "a", pass: 2 }),
		);
		// …and is still one respondent per pass of its own.
		const passes = [1, 2, 3].map((pass) => respondentIdFor("a#2", pass));
		expect(new Set(passes).size).toBe(3);
	});
});

describe("submissionPassFor (REQ083)", () => {
	test("the first pass is always open, whatever was opened", () => {
		for (const latestOpened of [1, 2, 5]) {
			expect(submissionPassFor(FIRST_PASS, latestOpened)).toBe(FIRST_PASS);
		}
	});

	test("a device that never started another pass answers in its first, however the request is spelled", () => {
		// Every deck the switch was never on: nothing past the first pass was ever
		// opened, so nothing past it can be reached.
		expect(submissionPassFor(2, FIRST_PASS)).toBe(FIRST_PASS);
		expect(submissionPassFor(9, FIRST_PASS)).toBe(FIRST_PASS);
	});

	test("every pass the server opened stays open — the latest and every one before it", () => {
		expect(submissionPassFor(2, 2)).toBe(2);
		expect(submissionPassFor(3, 3)).toBe(3);
		expect(submissionPassFor(2, 3)).toBe(2);
	});

	test("a pass that was never opened reads as the latest that was", () => {
		// An answer never opens a pass. A client that missed a reset, or a
		// hand-built request, lands in the latest pass the device really has —
		// on a kiosk, the one it is on now, never the person before's.
		expect(submissionPassFor(3, 2)).toBe(2);
		expect(submissionPassFor(7, 2)).toBe(2);
	});

	test("a drifted pass lands in the same place however many answers follow it", () => {
		// The property the reset case rests on: an answer that lands cannot move
		// what was opened, so the second answer from a drifted client goes exactly
		// where the first did, and one person is never split across two passes.
		const opened = FIRST_PASS;
		const first = submissionPassFor(2, opened);
		expect(first).toBe(FIRST_PASS);
		expect(submissionPassFor(2, opened)).toBe(first);
	});

	test("a value below the first pass reads as the first", () => {
		expect(submissionPassFor(0, 3)).toBe(FIRST_PASS);
		expect(submissionPassFor(-4, 3)).toBe(FIRST_PASS);
	});
});

describe("the stored record of opened passes (REQ083)", () => {
	test("a record reads forward: an absent pass is the first, and the identity pair is required", () => {
		const parsed = StoredParticipantPassSchema.parse({
			id: "r1",
			presentationId: "deck-1",
			participantId: "p1",
		});
		expect(parsed).toEqual({
			id: "r1",
			presentationId: "deck-1",
			participantId: "p1",
			openedPass: FIRST_PASS,
			createdAt: "",
			updatedAt: "",
		});
		expect(
			StoredParticipantPassSchema.safeParse({ id: "r1", presentationId: "deck-1" })
				.success,
		).toBe(false);
		expect(
			StoredParticipantPassSchema.safeParse({
				id: "r1",
				presentationId: "deck-1",
				participantId: "p1",
				openedPass: 0,
			}).success,
		).toBe(false);
	});
});

// ── The exports count respondents ────────────────────────────

function slide(fields: Record<string, unknown>): Slide {
	return SlideSchema.parse(fields);
}

function vote(fields: Record<string, unknown>): StoredVote {
	return StoredVoteSchema.parse({
		presentationId: "deck-1",
		createdAt: "2026-10-21T10:00:00.000Z",
		...fields,
	});
}

const SLIDES = [
	slide({
		id: "mc",
		type: "multiple-choice",
		question: "Which team?",
		options: [
			{ id: "eng", text: "Engineering" },
			{ id: "sales", text: "Sales" },
		],
	}),
	slide({ id: "wc", type: "word-cloud", question: "One word" }),
];

function deck(fields: Record<string, unknown> = {}): Presentation {
	return PresentationSchema.parse({
		id: "deck-1",
		code: "123456",
		title: "Kiosk survey",
		mode: "survey",
		allowRepeatPasses: true,
		createdAt: "2026-10-21T09:00:00.000Z",
		slides: SLIDES,
		...fields,
	});
}

/**
 * p1 went through twice; p2 answered once, on a row stored before passes
 * existed — no `pass` key on it at all, the shape every vote on disk had the
 * day this shipped.
 */
const PASS_VOTES: StoredVote[] = [
	vote({ id: "v1", slideId: "mc", value: "eng", participantId: "p1", pass: 1 }),
	vote({ id: "v2", slideId: "wc", value: "first", participantId: "p1", pass: 1 }),
	vote({ id: "v3", slideId: "mc", value: "sales", participantId: "p1", pass: 2 }),
	vote({ id: "v4", slideId: "wc", value: "second", participantId: "p1", pass: 2 }),
	(({ pass: _pass, ...legacy }) => legacy)(
		vote({ id: "v5", slideId: "mc", value: "eng", participantId: "p2" }),
	) as StoredVote,
];

function exportInput(fields: Partial<ResultsExportInput> = {}): ResultsExportInput {
	return {
		presentation: deck(),
		votes: PASS_VOTES,
		responseVotes: [],
		participantNames: { p1: "Ada" },
		results: [],
		exportedAt: "2026-10-21T12:00:00.000Z",
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

function summaryValue(model: { sheets: SheetModel[] }, field: string): SheetCell {
	return sheetNamed(model, "Summary").rows.find((row) => row[0] === field)?.[1] ?? null;
}

describe("respondentsIn (REQ083)", () => {
	test("one respondent per device per pass, in first-seen order", () => {
		expect(respondentsIn(PASS_VOTES)).toEqual([
			{ respondentId: "p1", participantId: "p1", pass: 1 },
			{ respondentId: respondentIdFor("p1", 2), participantId: "p1", pass: 2 },
			{ respondentId: "p2", participantId: "p2", pass: 1 },
		]);
		expect(respondentIdsIn(PASS_VOTES)).toHaveLength(3);
	});

	test("a row naming nobody is nobody's, at any pass", () => {
		expect(
			respondentsIn([{ participantId: "" }, { participantId: "", pass: 2 }]),
		).toEqual([]);
	});

	test("without a second pass it is exactly the set of participants it always was", () => {
		const firstPassOnly = PASS_VOTES.filter((row) => passOf(row) === FIRST_PASS);
		expect(respondentIdsIn(firstPassOnly)).toEqual(["p1", "p2"]);
	});
});

describe("the workbook counts each pass as its own respondent (REQ083/REQ095)", () => {
	const model = buildResultsWorkbook(exportInput());

	test("the summary counts respondents and says the deck allowed repeat passes", () => {
		expect(summaryValue(model, "Participants")).toBe(3);
		expect(summaryValue(model, "Repeat passes")).toBe(true);
		// Ada is named once and went through twice: both of her passes are named.
		expect(summaryValue(model, "Participants named")).toBe(2);
	});

	test("a presenter-paced deck carrying the switch reports it as not in effect", () => {
		const live = buildResultsWorkbook(
			exportInput({ presentation: deck({ mode: "live" }) }),
		);
		expect(summaryValue(live, "Repeat passes")).toBe(false);
		const off = buildResultsWorkbook(
			exportInput({ presentation: deck({ allowRepeatPasses: false }) }),
		);
		expect(summaryValue(off, "Repeat passes")).toBe(false);
	});

	test("the Slides sheet counts each pass that answered a slide", () => {
		const slides = sheetNamed(model, "Slides");
		const choice = slides.rows.find((row) => row[1] === "mc") as SheetCell[];
		expect(cellIn(slides, choice, "Participants")).toBe(3);
		const cloud = slides.rows.find((row) => row[1] === "wc") as SheetCell[];
		expect(cellIn(slides, cloud, "Participants")).toBe(2);
	});

	test("the Participants sheet has one row per pass, each with its own answers", () => {
		const participants = sheetNamed(model, "Participants");
		expect(participants.columns.map((column) => column.header)).toEqual([
			"Participant",
			"Name",
			"Pass",
			"1. Which team?",
			"2. One word",
		]);
		expect(participants.rows).toHaveLength(3);
		const rowOf = (participantId: string, pass: number) =>
			participants.rows.find(
				(row) =>
					cellIn(participants, row, "Participant") === participantId &&
					cellIn(participants, row, "Pass") === pass,
			) as SheetCell[];

		const firstPass = rowOf("p1", 1);
		expect(cellIn(participants, firstPass, "Name")).toBe("Ada");
		expect(cellIn(participants, firstPass, "1. Which team?")).toBe("Engineering");
		expect(cellIn(participants, firstPass, "2. One word")).toBe("first");

		const secondPass = rowOf("p1", 2);
		expect(cellIn(participants, secondPass, "Name")).toBe("Ada");
		expect(cellIn(participants, secondPass, "1. Which team?")).toBe("Sales");
		expect(cellIn(participants, secondPass, "2. One word")).toBe("second");

		// The row stored before passes existed is a first pass like any other.
		const legacy = rowOf("p2", 1);
		expect(cellIn(participants, legacy, "1. Which team?")).toBe("Engineering");
		expect(cellIn(participants, legacy, "2. One word")).toBeNull();
	});

	test("the Responses sheet says which pass every answer was given on", () => {
		const responses = sheetNamed(model, "Responses");
		const passesOf = (participantId: string) =>
			responses.rows
				.filter((row) => cellIn(responses, row, "Participant") === participantId)
				.map((row) => cellIn(responses, row, "Pass"));
		expect(passesOf("p1").sort()).toEqual([1, 1, 2, 2]);
		expect(passesOf("p2")).toEqual([1]);
	});

	test("a deck with no second pass reads 1 all the way down the Pass column", () => {
		const firstPassOnly = buildResultsWorkbook(
			exportInput({
				presentation: deck({ allowRepeatPasses: false }),
				votes: PASS_VOTES.filter((row) => passOf(row) === FIRST_PASS),
			}),
		);
		const participants = sheetNamed(firstPassOnly, "Participants");
		expect(participants.rows.map((row) => cellIn(participants, row, "Pass"))).toEqual(
			[1, 1],
		);
		expect(summaryValue(firstPassOnly, "Participants")).toBe(2);
	});
});

function tablesIn(document: { sections: { blocks: PdfBlock[] }[] }) {
	return document.sections
		.flatMap((section) => section.blocks)
		.filter((block): block is Extract<PdfBlock, { kind: "table" }> =>
			block.kind === "table",
		);
}

describe("the PDF counts and lists each pass (REQ083/REQ096)", () => {
	const document = buildDeckDocument({ ...exportInput(), includeResults: true });

	test("the cover counts respondents, the same number as the workbook's summary", () => {
		const facts = document.sections[0].blocks.find(
			(block): block is Extract<PdfBlock, { kind: "facts" }> =>
				block.kind === "facts",
		);
		expect(facts?.facts.find((fact) => fact.label === "Participants")?.value).toBe(
			"3",
		);
	});

	test("the roster lists each pass, the later ones marked, the unnamed last", () => {
		const roster = tablesIn(document).find((table) =>
			table.columns.includes("Slides answered"),
		);
		expect(roster?.columns).toEqual(["Name", "Slides answered"]);
		expect(roster?.rows).toEqual([
			["Ada", "2"],
			["Ada (pass 2)", "2"],
			["—", "1"],
		]);
	});

	test("still no participant id anywhere in the document", () => {
		const printed = JSON.stringify(document);
		expect(printed).not.toContain("p1");
		expect(printed).not.toContain("p2");
	});

	test("a first pass is the name alone", () => {
		expect(rosterLabel("Ada", FIRST_PASS)).toBe("Ada");
		expect(rosterLabel("Ada", 3)).toBe("Ada (pass 3)");
	});
});

describe("the segmented join is on the respondent (REQ083/REQ020)", () => {
	test("each pass of one device is grouped by its own answer", () => {
		const grouping = SLIDES[0];
		const buckets = segmentBucketsFor(
			grouping,
			PASS_VOTES.filter((row) => row.slideId === "mc"),
			respondentIdsIn(PASS_VOTES.filter((row) => row.slideId === "wc")),
		);
		const engineering = buckets.find((bucket) => bucket.key === "eng");
		const sales = buckets.find((bucket) => bucket.key === "sales");
		// Ada's first pass picked Engineering and her second Sales: the same device
		// lands in both groups, once per pass, which is the only join that means
		// anything when somebody changed their answer the second time through.
		expect(engineering?.participantIds).toEqual(["p1", "p2"]);
		expect(sales?.participantIds).toEqual([respondentIdFor("p1", 2)]);
	});
});
