/**
 * Integration tests for the PDF export (REQ096).
 *
 * The unit suite beside this one asserts what the document *says*; this one
 * asserts the three things only the real endpoint can answer:
 *
 *   - **It is authorized exactly as the spreadsheet is.** Owner or edit token,
 *     for **both** readings — the document carries every quiz answer key,
 *     including one a running question is still withholding from the room
 *     (REQ056), so `?results=false` is a decision about the document rather
 *     than about who may have it. A results link (REQ098) does not open it.
 *   - **It answers with a real PDF, named and uncacheable**, under a filename
 *     that says which of the two readings it is.
 *   - **The numbers in it are the endpoint's own.** The bytes are searched for
 *     the tally `GET /results` publishes for the same deck at the same moment,
 *     because the export reads that aggregation rather than a second one.
 *
 * Runs the real Elysia app against a throw-away in-memory zodstore, like
 * the results-export harness beside it.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { PDF_CONTENT_TYPE } from "./deck-pdf";

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
		body: JSON.stringify({ title: "PDF Test", slides }),
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

/**
 * The words the document draws, as one searchable string.
 *
 * Enough of a PDF reader to assert on, and no more — this repository has no PDF
 * parser and does not need one to check that a number reached the page. Two
 * steps: inflate every `stream … endstream` payload (pdf-lib deflates its
 * content streams), then decode the `<hex> Tj` operands it writes text as. Both
 * are properties of the *file format* rather than of this export, so the helper
 * does not go stale when the layout moves.
 */
async function pdfText(response: Response): Promise<string> {
	return (await pdfRuns(response)).join("\n");
}

/**
 * The same, split the way the document draws it: one entry per run of text
 * pdf-lib put on a page. Use this where *where a word sits* is the claim — a
 * table heading is its own run, so a heading the renderer truncated is a run
 * that is simply not there, which searching a concatenated blob cannot tell you.
 */
async function pdfRuns(response: Response): Promise<string[]> {
	const bytes = new Uint8Array(await response.arrayBuffer());
	const raw = Buffer.from(bytes).toString("latin1");
	const runs: string[] = [];
	const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
	let match = pattern.exec(raw);
	while (match !== null) {
		try {
			const content = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
			const drawn = /<([0-9A-Fa-f]*)>\s*Tj/g;
			let run = drawn.exec(content);
			while (run !== null) {
				runs.push(Buffer.from(run[1], "hex").toString("latin1"));
				run = drawn.exec(content);
			}
		} catch {
			// Not a deflate stream — nothing to read out of it here.
		}
		match = pattern.exec(raw);
	}
	return runs;
}

/**
 * The drawing instructions themselves, not the words they draw — every page's
 * content stream, inflated and joined. Use this where the claim is about *how*
 * something is painted: a colour reaches the page as an `r g b rg` operator and
 * never as text, so `pdfRuns` above cannot see it.
 */
async function pdfOperators(response: Response): Promise<string> {
	const raw = Buffer.from(new Uint8Array(await response.arrayBuffer())).toString(
		"latin1",
	);
	const streams: string[] = [];
	const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
	let match = pattern.exec(raw);
	while (match !== null) {
		try {
			streams.push(
				inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"),
			);
		} catch {
			// Not a deflate stream — nothing to read out of it here.
		}
		match = pattern.exec(raw);
	}
	return streams.join("\n");
}

/** Download one reading of the deck's PDF. */
async function downloadPdf(
	presentationId: string,
	token: string,
	query = "",
): Promise<Response> {
	return authed(`/api/presentations/${presentationId}/deck.pdf${query}`, token);
}

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
	{
		id: "qz",
		type: "quiz",
		question: "Capital of France?",
		options: [
			{ id: "qz-a", text: "Paris", isCorrect: true },
			{ id: "qz-b", text: "Lyon" },
		],
	},
	{ id: "intro", type: "text", question: "Welcome", body: "**Hello** everyone" },
];

/** Cast a small room's worth of answers across the deck above. */
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
		slideId: "mc",
		value: "mc-a",
		participantId: "carol",
	});
	await castVote(presentationId, {
		slideId: "qz",
		value: "qz-a",
		participantId: "alice",
	});
}

const today = (): string => new Date().toISOString().slice(0, 10);

describe("PDF export (REQ096)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { Elysia } = await import("elysia");

		await db.connectDb();

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

	// ── Authorization ─────────────────────────────────────

	test("the export is refused without the deck's credential", async () => {
		const pres = await create(DECK);
		const anonymous = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/deck.pdf`,
		);
		expect(anonymous.status).toBe(401);
		const wrong = await downloadPdf(pres.id, "not-the-token");
		expect(wrong.status).toBe(401);
	});

	test("the deck-only reading is gated exactly the same way", async () => {
		// `?results=false` draws less; it does not open the route wider. The
		// document still carries the answer key the running room is kept from.
		const pres = await create(DECK);
		const anonymous = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/deck.pdf?results=false`,
		);
		expect(anonymous.status).toBe(401);
	});

	test("a results link does not open it", async () => {
		const pres = await create(DECK);
		const minted = await authed(
			`/api/presentations/${pres.id}/results-link`,
			pres.creatorToken,
			{ method: "POST" },
		);
		expect(minted.status).toBe(201);
		const { resultsToken } = await minted.json();

		const withLink = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/deck.pdf`,
			{ headers: { "X-Omul-Results-Token": resultsToken } },
		);
		expect(withLink.status).toBe(401);
	});

	// ── The response ──────────────────────────────────────

	test("the export is served as a named PDF attachment", async () => {
		const pres = await create(DECK);
		const response = await downloadPdf(pres.id, pres.creatorToken);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(PDF_CONTENT_TYPE);
		expect(response.headers.get("Content-Disposition")).toBe(
			`attachment; filename="pdf-test-results-${today()}.pdf"`,
		);
		// A snapshot of a session still being run must never be served from cache.
		expect(response.headers.get("Cache-Control")).toBe("no-store");

		const bytes = new Uint8Array(await response.arrayBuffer());
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
	});

	test("the file names the product that made it, under its own name", async () => {
		// Producer and Creator are shown by every PDF reader under Document
		// Properties, so they are the product's name on a surface a reader opens
		// — not a repository identifier (REQ167). Read back with the same library
		// that wrote them, since the Info dictionary rides in a compressed object
		// stream and is not in the raw bytes to be searched for.
		//
		// Creator is the one of the pair this app actually owns: pdf-lib overwrites
		// Producer with its own name on every `save()`, so `setProducer` beside it
		// is inert whatever it is passed.
		const pres = await create(DECK);
		const response = await downloadPdf(pres.id, pres.creatorToken);
		const document = await PDFDocument.load(await response.arrayBuffer());
		expect(document.getCreator()).toBe("omul");
	});

	test("the two readings are named apart in the download folder", async () => {
		const pres = await create(DECK);
		const deckOnly = await downloadPdf(pres.id, pres.creatorToken, "?results=false");
		expect(deckOnly.status).toBe(200);
		expect(deckOnly.headers.get("Content-Disposition")).toBe(
			`attachment; filename="pdf-test-deck-${today()}.pdf"`,
		);
	});

	test("a results value the endpoint does not define is refused", async () => {
		const pres = await create(DECK);
		const bogus = await downloadPdf(pres.id, pres.creatorToken, "?results=maybe");
		expect(bogus.status).toBeGreaterThanOrEqual(400);
		expect(bogus.status).toBeLessThan(500);
	});

	test("a deck that does not exist is refused, not rendered", async () => {
		const missing = await downloadPdf("no-such-deck", "any-token");
		expect(missing.status).toBe(401);
	});

	// ── What the file carries ─────────────────────────────

	test("the document draws the deck, and the tally only when asked", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		const withResults = await pdfText(
			await downloadPdf(pres.id, pres.creatorToken, "?results=true"),
		);
		// Both readings draw the deck itself…
		expect(withResults).toContain("Which release train?");
		expect(withResults).toContain("Weekly");
		// …and this one draws the tally under it.
		expect(withResults).toContain("Results");
		expect(withResults).toContain("Respondents");

		const deckOnly = await pdfText(
			await downloadPdf(pres.id, pres.creatorToken, "?results=false"),
		);
		expect(deckOnly).toContain("Which release train?");
		expect(deckOnly).toContain("Weekly");
		expect(deckOnly).not.toContain("Respondents");
	});

	test("the shares in the file are the ones the results endpoint publishes", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		const results = await (
			await authed(`/api/presentations/${pres.id}/results/mc`, pres.creatorToken)
		).json();
		const weekly = results.options.find((option: AnyJson) => option.id === "mc-a");
		const share = Math.round((weekly.count / results.respondentCount) * 10000) / 100;
		// Two of three respondents picked it — a number the document must carry
		// rather than derive, so it is asserted against the endpoint's own payload.
		expect(share).toBeCloseTo(66.67, 2);

		const text = await pdfText(await downloadPdf(pres.id, pres.creatorToken));
		expect(text).toContain(`${share}%`);
		expect(text).toContain(`Count: ${weekly.count}`);
	});

	test("an unthemed deck prints in the app's own accent, not the retired one", async () => {
		// This is the one surface the app writes that reads no theme at all: the
		// palette in `deck-pdf.ts` is held by hand. REQ168 moved the house deck
		// theme onto the chrome's blue, so an organizer running a deck that never
		// chose a theme sees blue bars on the projector and on every phone — a
		// print still answering the tangerine would be the last surface
		// disagreeing, and REQ166's done-when already covered it.
		//
		// Asserted on the drawing operators rather than on the constant, because
		// the claim is about the bytes that reach the reader: the accent is the
		// bar fill, the share percentage and the section labels.
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		const ops = await pdfOperators(await downloadPdf(pres.id, pres.creatorToken));
		// `#1f3bff` — `index.css`'s light-scheme `--color-accent`, which is the
		// scheme a page of paper is in.
		expect(ops).toContain("0.12 0.23 1 rg");
		// `#ff6b35`, retired.
		expect(ops).not.toContain("1 0.42 0.21");
	});

	test("the answer key a running question withholds from the room is in it", async () => {
		const pres = await create(DECK);
		await authed(`/api/presentations/${pres.id}/start`, pres.creatorToken, {
			method: "POST",
		});
		await runSession(pres.id);

		// The room is told nothing about which option is right while the question
		// runs (REQ056) — the export is the organizer's own copy and says so.
		const audience = await (
			await fetch(`${baseUrl}/api/presentations/${pres.id}/results/qz`)
		).json();
		expect(audience.options.every((option: AnyJson) => option.isCorrect === null)).toBe(
			true,
		);

		const text = await pdfText(await downloadPdf(pres.id, pres.creatorToken));
		expect(text).toContain("Paris (correct)");
	});

	test("a table heading wider than its column keeps every word", async () => {
		// A grid slide's entry metrics are Placed / Skipped / Average <x> /
		// Average <y> (REQ048), where the axis names are the organizer's own — and
		// the metric columns are ~70pt wide, so both of those wrap. Drawn as their
		// first line only, the two columns read `Average` and `Average`, and no
		// reader can tell which axis they are looking at.
		const pres = await create([
			{
				id: "grid",
				type: "grid",
				question: "Place each initiative",
				gridXAxis: { title: "Importance", min: 0, max: 10 },
				gridYAxis: { title: "Urgency", min: 0, max: 10 },
				gridItems: [{ id: "g-1", text: "Search rewrite" }],
			},
		]);
		const runs = await pdfRuns(await downloadPdf(pres.id, pres.creatorToken));

		expect(runs).toContain("Average");
		// Each axis name is drawn as a heading line of its own — the run the
		// truncation dropped.
		expect(runs).toContain("Importance");
		expect(runs).toContain("Urgency");
	});

	test("the presenter's own notes are in neither reading", async () => {
		// REQ090 — the notes reach this export's input in full, because it is
		// gathered with editor rights. Nothing draws them, and a document a
		// presenter hands round is the last place their private cue should
		// reappear.
		const pres = await create([
			{
				id: "noted",
				type: "multiple-choice",
				question: "Which release train?",
				notes: "Do not mention the outage",
				options: [{ id: "a", text: "Weekly" }],
			},
		]);
		for (const query of ["?results=true", "?results=false"]) {
			const text = await pdfText(await downloadPdf(pres.id, pres.creatorToken, query));
			expect(text).toContain("Which release train?");
			expect(text).not.toContain("Do not mention the outage");
		}
	});

	test("an empty deck still renders both readings", async () => {
		const pres = await create([
			{ id: "only", type: "word-cloud", question: "One word" },
		]);
		for (const query of ["?results=true", "?results=false"]) {
			const response = await downloadPdf(pres.id, pres.creatorToken, query);
			expect(response.status).toBe(200);
			const bytes = new Uint8Array(await response.arrayBuffer());
			expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
		}
	});
});
