/**
 * Integration tests for the Form question type (REQ061).
 *
 * Exercises the real Elysia app against a throw-away in-memory zodstore:
 *   - the authored fields round-trip through create → fetch
 *   - one participant fills in several typed fields and submits them **once**:
 *     one stored row, and a tally that reports how much of the form got filled
 *     in plus how a choice field's picks split
 *   - each field's type is enforced at the boundary — a non-address, an option
 *     the field does not offer and a missing required field are refused rather
 *     than stored
 *   - one participant holds one submission: re-sending corrects it instead of
 *     adding a second person to the export
 *   - **what the room wrote is never published to the room.** The submissions
 *     block is emitted to a caller who can edit the deck and to nobody else,
 *     whatever the deck's reveal mode says — the counts stay public either way
 *   - the export carries the whole form as a single row (REQ095)
 *
 * The store is in-process (bun:sqlite ":memory:"), matching the p0 / p1 / points
 * / guess / pin harnesses.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeFormSubmission, FORM_ANSWER_MAX_LENGTH } from "./schemas";

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

async function createAndStart(slides: AnyJson[]): Promise<AnyJson> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "Form Test", slides }),
	});
	expect(res.status).toBe(201);
	const pres = await res.json();
	const startRes = await authed(
		`/api/presentations/${pres.id}/start`,
		pres.creatorToken,
		{ method: "POST" },
	);
	expect(startRes.status).toBe(200);
	return pres;
}

/** Submit one participant's whole filled-in form as a single vote. */
async function submitForm(
	presentationId: string,
	participantId: string,
	answers: Record<string, string>,
): Promise<Response> {
	return fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			slideId: "fm",
			value: encodeFormSubmission(answers),
			participantId,
		}),
	});
}

/** The tally as an unauthenticated participant reads it. */
async function results(
	presentationId: string,
	slideId: string,
): Promise<AnyJson> {
	const res = await fetch(
		`${baseUrl}/api/presentations/${presentationId}/results/${slideId}`,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

/** The tally as the deck's owner reads it. */
async function ownerResults(
	presentationId: string,
	slideId: string,
	token: string,
): Promise<AnyJson> {
	const res = await authed(
		`/api/presentations/${presentationId}/results/${slideId}`,
		token,
	);
	expect(res.status).toBe(200);
	return await res.json();
}

/** One field's entry in a form results payload. */
function fieldIn(payload: AnyJson, fieldId: string): AnyJson {
	return payload.fields.find((field: AnyJson) => field.fieldId === fieldId);
}

/** A three-field signup form: a name, a required address, and a track. */
function formSlide(overrides: Record<string, unknown> = {}) {
	return {
		id: "fm",
		type: "form",
		question: "Sign up for the workshop",
		formFields: [
			{ id: "name", label: "Your name" },
			{ id: "mail", label: "Email", type: "email", required: true },
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
		...overrides,
	};
}

describe("Form question type integration", () => {
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
		// Elysia runtime shape
		const bunServer = (app as any).server as {
			hostname: string;
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		if (!bunServer) throw new Error("Elysia did not expose a Bun server");
		server = {
			stop: () => bunServer.stop(true),
			hostname: bunServer.hostname,
			port: bunServer.port,
		};
		baseUrl = `http://${bunServer.hostname}:${bunServer.port}`;
	});

	afterAll(async () => {
		if (server) await server.stop();
	});

	test("the authored fields round-trip through create → fetch (REQ061)", async () => {
		const pres = await createAndStart([formSlide()]);
		const res = await fetch(`${baseUrl}/api/presentations/${pres.id}`);
		const fetched = await res.json();
		const fields = fetched.slides[0].formFields;
		expect(fields).toHaveLength(3);
		expect(fields[1]).toEqual({
			id: "mail",
			label: "Email",
			type: "email",
			required: true,
			options: [],
		});
		expect(fields[2].options).toEqual([
			{ id: "design", text: "Design" },
			{ id: "eng", text: "Engineering" },
		]);
	});

	test("a filled-in form is one stored row, and the tally counts it (REQ061)", async () => {
		const pres = await createAndStart([formSlide()]);
		const submitted = await submitForm(pres.id, "p1", {
			name: "Ada Lovelace",
			mail: "ada@example.org",
			track: "eng",
		});
		expect(submitted.status).toBe(200);

		const payload = await results(pres.id, "fm");
		expect(payload.type).toBe("form");
		// One submission, one row — several fields did not become several votes.
		expect(payload.totalVotes).toBe(1);
		expect(payload.submissionCount).toBe(1);
		expect(fieldIn(payload, "name").answered).toBe(1);
		expect(fieldIn(payload, "mail").answered).toBe(1);
		expect(
			fieldIn(payload, "track").options.find(
				(option: AnyJson) => option.optionId === "eng",
			).count,
		).toBe(1);
	});

	test("an optional field left blank is counted as unanswered, not as a refusal", async () => {
		const pres = await createAndStart([formSlide()]);
		expect(
			(await submitForm(pres.id, "p1", { mail: "ada@example.org" })).status,
		).toBe(200);
		const payload = await results(pres.id, "fm");
		expect(payload.submissionCount).toBe(1);
		expect(fieldIn(payload, "name").answered).toBe(0);
		expect(fieldIn(payload, "mail").answered).toBe(1);
	});

	test("a choice field's picks split across its options", async () => {
		const pres = await createAndStart([formSlide()]);
		for (const [participant, track] of [
			["p1", "eng"],
			["p2", "eng"],
			["p3", "design"],
		]) {
			expect(
				(
					await submitForm(pres.id, participant, {
						mail: `${participant}@example.org`,
						track,
					})
				).status,
			).toBe(200);
		}
		const payload = await results(pres.id, "fm");
		expect(payload.submissionCount).toBe(3);
		const track = fieldIn(payload, "track");
		expect(track.answered).toBe(3);
		expect(
			track.options.find((option: AnyJson) => option.optionId === "eng").count,
		).toBe(2);
		expect(
			track.options.find((option: AnyJson) => option.optionId === "design")
				.count,
		).toBe(1);
	});

	test("each field's type is enforced at the boundary (REQ061)", async () => {
		const pres = await createAndStart([formSlide()]);
		// Not an address, into the field that promised the organizer one.
		expect(
			(await submitForm(pres.id, "p1", { mail: "not-an-address" })).status,
		).toBe(400);
		// An option the field does not offer.
		expect(
			(
				await submitForm(pres.id, "p1", {
					mail: "ada@example.org",
					track: "sales",
				})
			).status,
		).toBe(400);
		// A required field left blank.
		expect((await submitForm(pres.id, "p1", { name: "Ada" })).status).toBe(400);
		// An answer past the per-field cap.
		expect(
			(
				await submitForm(pres.id, "p1", {
					mail: "ada@example.org",
					name: "x".repeat(FORM_ANSWER_MAX_LENGTH + 1),
				})
			).status,
		).toBe(400);
		// A form with nothing written in it at all encodes to an empty value, which
		// the request schema turns away before the slide is even looked up — the
		// same 422 an empty submission to any other slide type gets.
		expect((await submitForm(pres.id, "p1", { name: "   " })).status).toBe(422);

		// None of them was stored.
		const payload = await results(pres.id, "fm");
		expect(payload.totalVotes).toBe(0);
		expect(payload.submissionCount).toBe(0);
	});

	test("a slide with no answerable field accepts nothing", async () => {
		const pres = await createAndStart([
			formSlide({ formFields: [{ id: "blank", label: "   " }] }),
		]);
		expect((await submitForm(pres.id, "p1", { blank: "Ada" })).status).toBe(400);
	});

	test("re-sending corrects a submission rather than adding a second (REQ061)", async () => {
		const pres = await createAndStart([formSlide()]);
		expect(
			(
				await submitForm(pres.id, "p1", {
					name: "Ada",
					mail: "ada@exmaple.org",
				})
			).status,
		).toBe(200);
		expect(
			(
				await submitForm(pres.id, "p1", {
					name: "Ada",
					mail: "ada@example.org",
				})
			).status,
		).toBe(200);

		const payload = await ownerResults(pres.id, "fm", pres.creatorToken);
		expect(payload.totalVotes).toBe(1);
		expect(payload.submissionCount).toBe(1);
		expect(payload.submissions).toHaveLength(1);
		expect(
			payload.submissions[0].answers.find(
				(answer: AnyJson) => answer.fieldId === "mail",
			).answer,
		).toBe("ada@example.org");
	});

	test("what people wrote reaches the organizer and nobody else (REQ061)", async () => {
		// The deck publishes every tally the instant it lands — the loosest reveal
		// mode there is (REQ015). The submissions must still not travel: a choice
		// the organizer made about their *numbers* cannot put a stranger's address
		// on the shared screen.
		const pres = await createAndStart([
			formSlide({ resultsVisibility: "instant" }),
		]);
		expect(
			(
				await submitForm(pres.id, "p1", {
					name: "Ada Lovelace",
					mail: "ada@example.org",
				})
			).status,
		).toBe(200);

		const audience = await results(pres.id, "fm");
		// The counts are public — an audience sees the form filling up…
		expect(audience.submissionCount).toBe(1);
		expect(fieldIn(audience, "name").answered).toBe(1);
		// …and the rows are an explicit null rather than an empty list, so
		// "withheld" cannot be misread as "nobody has answered".
		expect(audience.submissions).toBeNull();
		// Nothing anybody wrote is anywhere in the payload.
		expect(JSON.stringify(audience)).not.toContain("ada@example.org");
		expect(JSON.stringify(audience)).not.toContain("Ada Lovelace");

		const owner = await ownerResults(pres.id, "fm", pres.creatorToken);
		expect(owner.submissions).toHaveLength(1);
		expect(JSON.stringify(owner.submissions)).toContain("ada@example.org");
	});

	test("a submission without a participantId is refused (REQ061)", async () => {
		// One form per *participant*, so there has to be one. Since a re-submission
		// replaces the row held under that key, two id-less callers would share a
		// single row and the second would silently overwrite the first person's
		// name and address.
		const pres = await createAndStart([formSlide()]);
		const res = await fetch(
			`${baseUrl}/api/presentations/${pres.id}/vote`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					slideId: "fm",
					value: encodeFormSubmission({
						name: "Ada Lovelace",
						mail: "ada@example.org",
					}),
				}),
			},
		);
		expect(res.status).toBe(400);
		expect((await results(pres.id, "fm")).submissionCount).toBe(0);
	});

	test("re-authoring the slide does not erase what the room already wrote (REQ061)", async () => {
		// The defect this guards: the tally and the export used to re-judge every
		// stored row by the slide's *current* rules, so one ordinary authoring edit
		// retroactively invalidated a dataset that was already collected.
		const pres = await createAndStart([formSlide()]);
		// Three complete submissions; two leave the optional `track` blank.
		expect(
			(
				await submitForm(pres.id, "p1", {
					name: "Ada Lovelace",
					mail: "ada@example.org",
					track: "eng",
				})
			).status,
		).toBe(200);
		expect(
			(
				await submitForm(pres.id, "p2", {
					name: "Grace Hopper",
					mail: "grace@example.org",
				})
			).status,
		).toBe(200);
		expect(
			(
				await submitForm(pres.id, "p3", {
					name: "Alan Turing",
					mail: "alan@example.org",
				})
			).status,
		).toBe(200);
		expect((await results(pres.id, "fm")).submissionCount).toBe(3);

		// The organizer ticks Required on `track` and deletes the `name` field —
		// both ordinary edits, neither of which touches a vote row.
		const patched = await authed(`/api/presentations/${pres.id}`, pres.creatorToken, {
			method: "PATCH",
			body: JSON.stringify({
				slides: [
					formSlide({
						formFields: [
							{ id: "mail", label: "Email", type: "email", required: true },
							{
								id: "track",
								label: "Track",
								type: "choice",
								required: true,
								options: [
									{ id: "design", text: "Design" },
									{ id: "eng", text: "Engineering" },
								],
							},
						],
					}),
				],
			}),
		});
		expect(patched.status).toBe(200);

		// Every row is still there, and every answer to a field that survives the
		// edit is still readable.
		const payload = await results(pres.id, "fm");
		expect(payload.submissionCount).toBe(3);
		expect(fieldIn(payload, "mail").answered).toBe(3);
		expect(fieldIn(payload, "track").answered).toBe(1);

		const { getResultsExport } = await import("./services/presentations");
		const { buildResultsWorkbook } = await import("./results-export");
		const input = await getResultsExport(pres.id, {
			exportedAt: "2026-08-10T12:00:00.000Z",
		});
		const workbook = buildResultsWorkbook(input as AnyJson);
		const responses = workbook.sheets.find(
			(sheet) => sheet.name === "Responses",
		);
		const answerIndex = (responses?.columns ?? []).findIndex(
			(column) => column.header === "Answer",
		);
		const answers = (responses?.rows ?? []).map((row) => row[answerIndex]);
		expect(answers).toHaveLength(3);
		// No empty cells, and the deleted field's answers are the only thing gone —
		// there is no label left to print them under.
		expect(answers).toEqual([
			"Email: ada@example.org; Track: Engineering",
			"Email: grace@example.org",
			"Email: alan@example.org",
		]);
	});

	test("the export carries a whole form as one row (REQ095)", async () => {
		const pres = await createAndStart([formSlide()]);
		expect(
			(
				await submitForm(pres.id, "p1", {
					name: "Ada Lovelace",
					mail: "ada@example.org",
					track: "eng",
				})
			).status,
		).toBe(200);

		const { getResultsExport } = await import("./services/presentations");
		const { buildResultsWorkbook } = await import("./results-export");
		const input = await getResultsExport(pres.id, {
			exportedAt: "2026-08-10T12:00:00.000Z",
		});
		expect(input).not.toBeNull();
		const workbook = buildResultsWorkbook(input as AnyJson);

		const responses = workbook.sheets.find(
			(sheet) => sheet.name === "Responses",
		);
		expect(responses?.rows).toHaveLength(1);
		const answerIndex = (responses?.columns ?? []).findIndex(
			(column) => column.header === "Answer",
		);
		expect(responses?.rows[0][answerIndex]).toBe(
			"Your name: Ada Lovelace; Email: ada@example.org; Track: Engineering",
		);
	});
});
