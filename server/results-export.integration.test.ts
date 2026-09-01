/**
 * Integration tests for the Results & Export slice (REQ095, REQ101).
 *
 * Two things are under test, and they are the two ends of an organizer's
 * end-of-session workflow — take the data out, then clear it so the deck can be
 * run again:
 *
 *   - **REQ095 — the spreadsheet is the session.** One authenticated request
 *     produces a real XLSX, served as an attachment, whose sheets are read back
 *     here with the same library that wrote them: every response is a row that
 *     names the participant it was cast under and the slide it answered, the
 *     participant matrix is that same data per person, and every number on the
 *     Aggregates sheet is asserted against the live `/results` endpoint's own
 *     payload — because the export reads that aggregation rather than a second
 *     one of its own. The file carries raw responses and quiz answer keys, so
 *     it is authorized as an edit and refused without one.
 *   - **REQ101 — a reset leaves nothing behind.** After a reset the tally is
 *     zero, the export is empty, the deck is a draft again, and a second run's
 *     answers are the *only* thing the results have ever seen. Old and new data
 *     never mix, which is the whole point of the requirement.
 *
 * Runs the real Elysia app against a throw-away in-memory zodstore, like
 * the preview / quiz / grid harnesses beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { XLSX_CONTENT_TYPE } from "./results-export";

let connectDb: () => Promise<void>;

let baseUrl = "";
let server: {
	stop: () => Promise<void>;
	hostname: string;
	port: number;
} | null = null;

// API response is loosely typed
type AnyJson = any;

async function authed(
	path: string,
	token: string,
	init: RequestInit = {},
): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init.headers || {}),
			Authorization: `Bearer ${token}`,
		},
	});
}

async function create(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Export Test", slides }),
	});
	expect(res.status).toBe(201);
	return res.json();
}

async function castVote(
	presentationId: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Download the workbook and read it back with the library that wrote it. */
async function downloadWorkbook(
	presentationId: string,
	token: string,
): Promise<{ response: Response; workbook: ExcelJS.Workbook }> {
	const response = await authed(
		`/api/presentations/${presentationId}/results.xlsx`,
		token,
	);
	expect(response.status).toBe(200);
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(await response.arrayBuffer());
	return { response, workbook };
}

/** Every data row of a sheet, as cell values keyed by header text. */
function rowsOf(
	workbook: ExcelJS.Workbook,
	sheetName: string,
): Record<string, unknown>[] {
	const sheet = workbook.getWorksheet(sheetName);
	expect(sheet).toBeDefined();
	const headerRow = (sheet as ExcelJS.Worksheet).getRow(1);
	const headers: string[] = [];
	headerRow.eachCell((cell, columnNumber) => {
		headers[columnNumber] = String(cell.value ?? "");
	});

	const rows: Record<string, unknown>[] = [];
	(sheet as ExcelJS.Worksheet).eachRow((row, rowNumber) => {
		if (rowNumber === 1) return;
		const entry: Record<string, unknown> = {};
		for (let columnNumber = 1; columnNumber < headers.length; columnNumber++) {
			const header = headers[columnNumber];
			if (!header) continue;
			const value = row.getCell(columnNumber).value;
			entry[header] = value ?? null;
		}
		rows.push(entry);
	});
	return rows;
}

/** The Summary sheet as a field → value map. */
function summaryOf(workbook: ExcelJS.Workbook): Record<string, unknown> {
	const map: Record<string, unknown> = {};
	for (const row of rowsOf(workbook, "Summary")) {
		map[String(row.Field)] = row.Value;
	}
	return map;
}

// ── A deck with a spread of the answer shapes an export has to read ──

const DECK: AnyJson[] = [
	{
		id: "mc",
		type: "multiple-choice",
		question: "Which release train?",
		options: [
			{ id: "mc-a", text: "Weekly" },
			{ id: "mc-b", text: "Monthly" },
		],
	},
	{ id: "wc", type: "word-cloud", question: "One word for this quarter" },
	{
		id: "sc",
		type: "scale",
		question: "Rate each",
		scaleStatements: [
			{ id: "st-1", text: "Tooling" },
			{ id: "st-2", text: "Docs" },
		],
		scaleAllowSkip: true,
	},
	{
		id: "qz",
		type: "quiz",
		question: "Capital of France?",
		options: [
			{ id: "qz-a", text: "Paris", isCorrect: true },
			{ id: "qz-b", text: "Lyon" },
		],
	},
	{ id: "intro", type: "text", question: "Welcome" },
];

/** Cast one full room's worth of answers across the deck above. */
async function runSession(presentationId: string): Promise<void> {
	await castVote(presentationId, {
		slideId: "mc",
		value: "mc-a",
		participantId: "alice",
	});
	await castVote(presentationId, {
		slideId: "mc",
		value: "mc-b",
		participantId: "bob",
	});
	await castVote(presentationId, {
		slideId: "wc",
		value: "steady",
		participantId: "alice",
	});
	await castVote(presentationId, {
		slideId: "sc",
		value: "4",
		participantId: "alice",
		statementId: "st-1",
	});
	await castVote(presentationId, {
		slideId: "sc",
		value: "0",
		participantId: "alice",
		statementId: "st-2",
		skip: true,
	});
	await castVote(presentationId, {
		slideId: "qz",
		value: "qz-a",
		participantId: "alice",
	});
	await castVote(presentationId, {
		slideId: "qz",
		value: "qz-b",
		participantId: "bob",
	});
}

describe("Results & Export (REQ095, REQ101)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		connectDb = db.connectDb;
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await connectDb();

		const app = new Elysia()
			.get("/api/health", () => ({ ok: true }))
			.use(presentationRoutes);

		app.listen({ port: 0, hostname: "127.0.0.1" });
		server = app.server as unknown as typeof server;
		baseUrl = `http://127.0.0.1:${server?.port}`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	// ── REQ095 — the spreadsheet ──────────────────────────

	test("the export is refused without the deck's credential", async () => {
		const pres = await create(DECK);
		const res = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/results.xlsx`,
		);
		expect(res.status).toBe(401);
		// And a wrong token is refused just the same — not merely a missing one.
		const wrong = await authed(
			`/api/presentations/${pres.id}/results.xlsx`,
			"not-the-token",
		);
		expect(wrong.status).toBe(401);
	});

	test("the export is served as a named XLSX attachment", async () => {
		const pres = await create(DECK);
		const { response } = await downloadWorkbook(pres.id, pres.creatorToken);
		expect(response.headers.get("Content-Type")).toBe(XLSX_CONTENT_TYPE);
		expect(response.headers.get("Content-Disposition")).toBe(
			'attachment; filename="export-test-results-' +
				new Date().toISOString().slice(0, 10) +
				'.xlsx"',
		);
		// A snapshot of a session still being run must never be served from cache.
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});

	test("the workbook names the product that wrote it, under its own name", async () => {
		// Excel shows this under File → Properties → Author, so it is the
		// product's name on a surface somebody opens — not a repository
		// identifier (REQ167). The old name must not ride out of the building on
		// a file the app itself wrote.
		const pres = await create(DECK);
		const { workbook } = await downloadWorkbook(pres.id, pres.creatorToken);
		expect(workbook.creator).toBe("omul");
	});

	test("the workbook carries the five sheets the endpoint promises", async () => {
		const pres = await create(DECK);
		const { workbook } = await downloadWorkbook(pres.id, pres.creatorToken);
		expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
			"Summary",
			"Slides",
			"Responses",
			"Participants",
			"Aggregates",
		]);
	});

	test("every response is a row naming its participant and its slide", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		const { workbook } = await downloadWorkbook(pres.id, pres.creatorToken);
		const responses = rowsOf(workbook, "Responses");
		expect(responses).toHaveLength(7);

		// A choice is the option's text, not the id it is stored under.
		const aliceChoice = responses.find(
			(row) => row["Slide ID"] === "mc" && row.Participant === "alice",
		);
		expect(aliceChoice?.Answer).toBe("Weekly");
		expect(aliceChoice?.["Slide #"]).toBe(1);
		expect(aliceChoice?.Skipped).toBe(false);

		// A per-statement scale row names the statement it answers (REQ029) …
		const tooling = responses.find(
			(row) => row["Slide ID"] === "sc" && row.Item === "Tooling",
		);
		expect(tooling?.Answer).toBe("4");

		// … and a skipped one is an explicit skip with no answer (REQ031).
		const docs = responses.find(
			(row) => row["Slide ID"] === "sc" && row.Item === "Docs",
		);
		expect(docs?.Skipped).toBe(true);
		expect(docs?.Answer).toBeNull();
	});

	test("the participant matrix is one row per participant (REQ095)", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		const { workbook } = await downloadWorkbook(pres.id, pres.creatorToken);
		const participants = rowsOf(workbook, "Participants");
		expect(participants.map((row) => row.Participant)).toEqual([
			"alice",
			"bob",
		]);

		const alice = participants[0];
		expect(alice["1. Which release train?"]).toBe("Weekly");
		expect(alice["2. One word for this quarter"]).toBe("steady");
		// Both statements of the scale land in the one cell the slide owns.
		expect(alice["3. Rate each"]).toBe("Tooling: 4; Docs: (skipped)");

		const bob = participants[1];
		// An unanswered slide is empty, never a blank answer bob gave.
		expect(bob["2. One word for this quarter"]).toBeNull();
		expect(bob["4. Capital of France?"]).toBe("Lyon");

		// The content slide collects nothing, so it is not a column at all.
		expect(Object.keys(alice)).not.toContain("5. Welcome");
	});

	test("the aggregates are the results endpoint's own numbers", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		const liveRes = await authed(
			`/api/presentations/${pres.id}/results`,
			pres.creatorToken,
		);
		const live: AnyJson[] = await liveRes.json();
		const quizLive = live.find((entry) => entry.slideId === "qz");

		const { workbook } = await downloadWorkbook(pres.id, pres.creatorToken);
		const aggregates = rowsOf(workbook, "Aggregates");
		const valueOf = (slideNumber: number, entry: string | null, metric: string) =>
			aggregates.find(
				(row) =>
					row["Slide #"] === slideNumber &&
					row.Entry === entry &&
					row.Metric === metric,
			)?.Value;

		expect(valueOf(1, null, "Respondents")).toBe(2);
		expect(valueOf(1, "Weekly", "Count")).toBe(1);
		expect(valueOf(1, "Weekly", "Share %")).toBe(50);
		expect(valueOf(2, "steady", "Count")).toBe(1);
		expect(valueOf(3, "Tooling", "Average")).toBe(4);
		expect(valueOf(3, "Docs", "Skipped")).toBe(1);

		// The quiz block matches the live payload cell for cell — the export reads
		// that aggregation, it does not run a second one.
		expect(valueOf(4, "Paris", "Count")).toBe(quizLive.options[0].count);
		expect(valueOf(4, "Paris", "Correct")).toBe(true);
		expect(valueOf(4, null, "Correct answers")).toBe(
			quizLive.scoring.correctCount,
		);
		expect(valueOf(4, null, "Correct share %")).toBe(
			quizLive.scoring.correctShare,
		);
	});

	test("the summary counts participants and responses", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		const { workbook } = await downloadWorkbook(pres.id, pres.creatorToken);
		const summary = summaryOf(workbook);
		expect(summary.Presentation).toBe("Export Test");
		expect(summary["Join code"]).toBe(pres.code);
		expect(summary.Participants).toBe(2);
		expect(summary.Responses).toBe(7);
		expect(summary.Slides).toBe(5);
		expect(summary["Interactive slides"]).toBe(4);
	});

	// ── REQ101 — the reset ────────────────────────────────

	test("a reset is refused without the deck's credential", async () => {
		const pres = await create(DECK);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}/reset`, {
			method: "POST",
		});
		expect(res.status).toBe(401);

		const wrong = await authed(
			`/api/presentations/${pres.id}/reset`,
			"not-the-token",
			{ method: "POST" },
		);
		expect(wrong.status).toBe(401);
	});

	test("a reset clears every response and returns the deck to draft", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		const beforeRes = await authed(
			`/api/presentations/${pres.id}/results`,
			pres.creatorToken,
		);
		const before: AnyJson[] = await beforeRes.json();
		expect(before.find((entry) => entry.slideId === "mc").totalVotes).toBe(2);

		const resetRes = await authed(
			`/api/presentations/${pres.id}/reset`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(resetRes.status).toBe(200);
		expect((await resetRes.json()).status).toBe("draft");

		const afterRes = await authed(
			`/api/presentations/${pres.id}/results`,
			pres.creatorToken,
		);
		const after: AnyJson[] = await afterRes.json();
		for (const entry of after) {
			expect(entry.totalVotes).toBe(0);
		}

		// The export is the same story told twice: nothing left to take out.
		const { workbook } = await downloadWorkbook(pres.id, pres.creatorToken);
		expect(rowsOf(workbook, "Responses")).toHaveLength(0);
		expect(rowsOf(workbook, "Participants")).toHaveLength(0);
		expect(summaryOf(workbook).Participants).toBe(0);
		// The deck itself survives — that is what makes it reusable.
		expect(summaryOf(workbook).Slides).toBe(5);
	});

	test("a re-run's results never mix with the run before it (REQ101)", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);
		await authed(`/api/presentations/${pres.id}/reset`, pres.creatorToken, {
			method: "POST",
		});

		// A fresh audience, on the same deck.
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await castVote(pres.id, {
			slideId: "mc",
			value: "mc-b",
			participantId: "carol",
		});

		const resultsRes = await authed(
			`/api/presentations/${pres.id}/results`,
			pres.creatorToken,
		);
		const results: AnyJson[] = await resultsRes.json();
		const choice = results.find((entry) => entry.slideId === "mc");
		expect(choice.totalVotes).toBe(1);
		expect(choice.respondentCount).toBe(1);
		expect(choice.options.find((option: AnyJson) => option.id === "mc-a").count).toBe(
			0,
		);

		const { workbook } = await downloadWorkbook(pres.id, pres.creatorToken);
		const responses = rowsOf(workbook, "Responses");
		expect(responses).toHaveLength(1);
		expect(responses[0].Participant).toBe("carol");
		expect(rowsOf(workbook, "Participants").map((row) => row.Participant)).toEqual(
			["carol"],
		);
	});

	test("a reset clears the Q&A queue asked alongside the votes (REQ101)", async () => {
		const pres = await create(DECK);
		await authed(
			`/api/presentations/${pres.id}/qa/settings`,
			pres.creatorToken,
			{ method: "POST", body: JSON.stringify({ enabled: true }) },
		);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await fetch(`${baseUrl}/api/presentations/${pres.id}/qa`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "Will this be recorded?", participantId: "alice" }),
		});

		const beforeRes = await authed(
			`/api/presentations/${pres.id}/qa`,
			pres.creatorToken,
		);
		expect((await beforeRes.json()).questions).toHaveLength(1);

		await authed(`/api/presentations/${pres.id}/reset`, pres.creatorToken, {
			method: "POST",
		});

		const afterRes = await authed(
			`/api/presentations/${pres.id}/qa`,
			pres.creatorToken,
		);
		expect((await afterRes.json()).questions).toHaveLength(0);
	});
});
