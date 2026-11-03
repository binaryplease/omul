/**
 * Integration tests for themes over a free-text slide's answers (REQ114,
 * slice 1: the server store).
 *
 * An editor creates, renames and deletes named themes on a word-cloud or
 * open-ended slide and moves that slide's answers between them. The grouping is
 * stored beside the answers, so the answers themselves — and every tally built
 * from them — must read exactly as before; and it is the editors' alone, so no
 * participant-facing payload and no results-link read may carry it.
 *
 * Runs the real Elysia routes against a throw-away in-memory zodstore.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RESULTS_TOKEN_HEADER } from "./schemas";

let baseUrl = "";
let server: { stop: () => Promise<void> } | null = null;

// API responses are loosely typed, like the neighbouring harnesses.
type AnyJson = any;

/** A theme name no other payload could carry by accident. */
const THEME_NAME = "Pricing-concerns-theme";

const DECK: AnyJson[] = [
	{ id: "wc", type: "word-cloud", question: "One word", maxResponses: 3 },
	{ id: "ot", type: "open-text", question: "What should change?" },
	{
		id: "mc",
		type: "multiple-choice",
		question: "Which train?",
		options: [
			{ id: "mc-a", text: "Weekly" },
			{ id: "mc-b", text: "Monthly" },
		],
	},
];

async function call(
	path: string,
	init: RequestInit & { token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
	const { token, headers, ...rest } = init;
	return fetch(`${baseUrl}/api${path}`, {
		...rest,
		headers: {
			"Content-Type": "application/json",
			...(headers ?? {}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
	});
}

/** A started deck with two words, two responses and one choice vote in it. */
async function runSession(): Promise<AnyJson> {
	const created = await call("/presentations", {
		method: "POST",
		body: JSON.stringify({ title: "Themes Test", slides: DECK }),
	});
	expect(created.status).toBe(201);
	const pres = await created.json();
	await call(`/presentations/${pres.id}/start`, {
		method: "POST",
		token: pres.creatorToken,
	});
	for (const [slideId, value, participantId] of [
		["wc", "speed", "alice"],
		["wc", "cost", "bob"],
		["ot", "Too expensive", "alice"],
		["ot", "Ship faster", "bob"],
		["mc", "mc-a", "alice"],
	]) {
		const vote = await call(`/presentations/${pres.id}/vote`, {
			method: "POST",
			body: JSON.stringify({ slideId, value, participantId }),
		});
		expect(vote.status).toBe(200);
	}
	return pres;
}

async function editorResults(pres: AnyJson, slideId: string): Promise<AnyJson> {
	const response = await call(`/presentations/${pres.id}/results/${slideId}`, {
		token: pres.creatorToken,
	});
	expect(response.status).toBe(200);
	return response.json();
}

/** The ids of an open-ended slide's responses, in the order they came back. */
async function responseIds(pres: AnyJson): Promise<string[]> {
	const tally = await editorResults(pres, "ot");
	return (tally.responses as AnyJson[]).map((response) => response.id);
}

async function createTheme(
	pres: AnyJson,
	slideId: string,
	name: string,
): Promise<Response> {
	return call(`/presentations/${pres.id}/slides/${slideId}/answer-themes`, {
		method: "POST",
		token: pres.creatorToken,
		body: JSON.stringify({ name }),
	});
}

async function listThemes(pres: AnyJson, slideId: string): Promise<AnyJson[]> {
	const response = await call(
		`/presentations/${pres.id}/slides/${slideId}/answer-themes`,
		{ token: pres.creatorToken },
	);
	expect(response.status).toBe(200);
	return (await response.json()).themes;
}

async function assign(
	pres: AnyJson,
	answerId: string,
	themeId: string | null,
	token: string = pres.creatorToken,
): Promise<Response> {
	return call(`/presentations/${pres.id}/answers/${answerId}/answer-theme`, {
		method: "PUT",
		token,
		body: JSON.stringify({ themeId }),
	});
}

describe("Answer themes on free-text slides (REQ114)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { presentationRoutes } = await import("./routes/presentations");
		const { answerThemeRoutes } = await import("./routes/answer-themes");
		const { Elysia } = await import("elysia");
		await db.connectDb();
		const app = new Elysia().use(presentationRoutes).use(answerThemeRoutes);
		app.listen({ port: 0, hostname: "127.0.0.1" });
		const bunServer = (app as any).server as {
			port: number;
			stop: (closeActive?: boolean) => Promise<void>;
		};
		server = { stop: () => bunServer.stop(true) };
		baseUrl = `http://127.0.0.1:${bunServer.port}`;
	});

	afterAll(async () => {
		await server?.stop();
	});

	test("an editor creates, renames and deletes a theme", async () => {
		const pres = await runSession();
		const created = await createTheme(pres, "ot", `  ${THEME_NAME}  `);
		expect(created.status).toBe(201);
		const theme = await created.json();
		expect(theme).toEqual({
			id: expect.any(String),
			slideId: "ot",
			name: THEME_NAME,
			answerIds: [],
			createdAt: expect.any(String),
		});
		expect(await listThemes(pres, "ot")).toEqual([theme]);

		const path = `/presentations/${pres.id}/slides/ot/answer-themes/${theme.id}`;
		const renamed = await call(path, {
			method: "PATCH",
			token: pres.creatorToken,
			body: JSON.stringify({ name: "Speed" }),
		});
		expect(renamed.status).toBe(200);
		expect((await renamed.json()).name).toBe("Speed");

		for (const name of ["   ", "x".repeat(81)]) {
			expect((await createTheme(pres, "ot", name)).status).toBe(422);
		}

		const deleted = await call(path, {
			method: "DELETE",
			token: pres.creatorToken,
		});
		expect(deleted.status).toBe(200);
		expect(await listThemes(pres, "ot")).toEqual([]);
		expect(
			(await call(path, { method: "DELETE", token: pres.creatorToken })).status,
		).toBe(404);
	});

	test("a slide holds at most 50 themes", async () => {
		const pres = await runSession();
		for (let count = 0; count < 50; count++) {
			expect((await createTheme(pres, "wc", `Theme ${count}`)).status).toBe(201);
		}
		const refused = await createTheme(pres, "wc", "One too many");
		expect(refused.status).toBe(400);
		expect((await refused.json()).refused).toBe("theme-limit");
	});

	test("an answer is assigned, moved and unassigned without changing the tally", async () => {
		const pres = await runSession();
		const before = await editorResults(pres, "ot");
		const [first, second] = await responseIds(pres);
		const themeA = await (await createTheme(pres, "ot", "A")).json();
		const themeB = await (await createTheme(pres, "ot", "B")).json();

		const assigned = await assign(pres, first, themeA.id);
		expect(assigned.status).toBe(200);
		expect(await assigned.json()).toEqual({
			answerId: first,
			themeId: themeA.id,
			slideId: "ot",
		});
		await assign(pres, second, themeA.id);
		// Moving: an answer is in at most one theme on its slide.
		await assign(pres, first, themeB.id);
		await assign(pres, first, themeB.id);
		let themes = await listThemes(pres, "ot");
		expect(themes.map((theme) => theme.answerIds)).toEqual([[second], [first]]);

		expect((await assign(pres, first, null)).status).toBe(200);
		themes = await listThemes(pres, "ot");
		expect(themes.map((theme) => theme.answerIds)).toEqual([[second], []]);

		// Deleting a theme ungroups its answers and deletes none of them.
		await call(`/presentations/${pres.id}/slides/ot/answer-themes/${themeA.id}`, {
			method: "DELETE",
			token: pres.creatorToken,
		});
		expect(await editorResults(pres, "ot")).toEqual(before);
	});

	test("a word cloud's answers group by their editor-list ids", async () => {
		const pres = await runSession();
		const tally = await editorResults(pres, "wc");
		const theme = await (await createTheme(pres, "wc", "Money")).json();
		const costId = (tally.answers as AnyJson[]).find(
			(answer) => answer.text === "cost",
		).id;
		expect((await assign(pres, costId, theme.id)).status).toBe(200);
		expect((await listThemes(pres, "wc"))[0].answerIds).toEqual([costId]);
		expect(await editorResults(pres, "wc")).toEqual(tally);
	});

	test("a caller who cannot edit the deck reads and writes nothing", async () => {
		const pres = await runSession();
		const stranger = await runSession();
		const theme = await (await createTheme(pres, "ot", THEME_NAME)).json();
		const [first] = await responseIds(pres);
		const linkResponse = await call(`/presentations/${pres.id}/results-link`, {
			method: "POST",
			token: pres.creatorToken,
		});
		const { resultsToken } = await linkResponse.json();
		const themesPath = `/presentations/${pres.id}/slides/ot/answer-themes`;

		const callers: { token?: string; headers?: Record<string, string> }[] = [
			{},
			{ token: stranger.creatorToken },
			{ headers: { [RESULTS_TOKEN_HEADER]: resultsToken } },
		];
		for (const caller of callers) {
			expect((await call(themesPath, caller)).status).toBe(401);
			const write = await call(themesPath, {
				...caller,
				method: "POST",
				body: JSON.stringify({ name: "Intruder" }),
			});
			expect(write.status).toBe(401);
			const rename = await call(`${themesPath}/${theme.id}`, {
				...caller,
				method: "PATCH",
				body: JSON.stringify({ name: "Intruder" }),
			});
			expect(rename.status).toBe(401);
			const remove = await call(`${themesPath}/${theme.id}`, {
				...caller,
				method: "DELETE",
			});
			expect(remove.status).toBe(401);
			const move = await call(
				`/presentations/${pres.id}/answers/${first}/answer-theme`,
				{ ...caller, method: "PUT", body: JSON.stringify({ themeId: theme.id }) },
			);
			expect(move.status).toBe(401);
		}
		expect(await listThemes(pres, "ot")).toEqual([theme]);
	});

	test("a slide that is not free text is refused", async () => {
		const pres = await runSession();
		const create = await createTheme(pres, "mc", "Nope");
		expect(create.status).toBe(400);
		expect((await create.json()).refused).toBe("slide-type");
		const read = await call(`/presentations/${pres.id}/slides/mc/answer-themes`, {
			token: pres.creatorToken,
		});
		expect(read.status).toBe(400);
		expect((await createTheme(pres, "no-such-slide", "Nope")).status).toBe(404);

		// An answer whose slide has since been authored into a choice slide.
		const [first] = await responseIds(pres);
		const theme = await (await createTheme(pres, "ot", "A")).json();
		const reauthored = await call(`/presentations/${pres.id}`, {
			method: "PATCH",
			token: pres.creatorToken,
			body: JSON.stringify({
				slides: DECK.map((slide) =>
					slide.id === "ot"
						? {
								...DECK[2],
								id: "ot",
								options: [
									{ id: "x", text: "X" },
									{ id: "y", text: "Y" },
								],
							}
						: slide,
				),
			}),
		});
		expect(reauthored.status).toBe(200);
		const refused = await assign(pres, first, theme.id);
		expect(refused.status).toBe(400);
		expect((await refused.json()).refused).toBe("slide-type");
	});

	test("an answer or theme from another slide or deck is refused like an unknown one", async () => {
		const pres = await runSession();
		const other = await runSession();
		const theme = await (await createTheme(pres, "ot", "Here")).json();
		const otherTheme = await (await createTheme(other, "ot", "There")).json();
		const [ownAnswer] = await responseIds(pres);
		const [foreignAnswer] = await responseIds(other);
		const wordId = (await editorResults(pres, "wc")).answers[0].id;

		for (const [answerId, themeId] of [
			[foreignAnswer, theme.id],
			[ownAnswer, otherTheme.id],
			[wordId, theme.id],
			["no-such-answer", theme.id],
			[ownAnswer, "no-such-theme"],
		]) {
			expect((await assign(pres, answerId, themeId)).status).toBe(404);
		}
		const rename = await call(
			`/presentations/${pres.id}/slides/ot/answer-themes/${otherTheme.id}`,
			{
				method: "PATCH",
				token: pres.creatorToken,
				body: JSON.stringify({ name: "Hijack" }),
			},
		);
		expect(rename.status).toBe(404);
		expect((await listThemes(pres, "ot"))[0].answerIds).toEqual([]);
		expect((await listThemes(other, "ot"))[0].name).toBe("There");
	});

	test("deleting one answer (REQ027) takes it out of its theme, and the theme stays", async () => {
		const pres = await runSession();
		const [first, second] = await responseIds(pres);
		const theme = await (await createTheme(pres, "ot", THEME_NAME)).json();
		await assign(pres, first, theme.id);
		await assign(pres, second, theme.id);
		const removed = await call(`/presentations/${pres.id}/answers/${first}`, {
			method: "DELETE",
			token: pres.creatorToken,
		});
		expect(removed.status).toBe(200);
		expect((await listThemes(pres, "ot"))[0].answerIds).toEqual([second]);

		await call(`/presentations/${pres.id}/answers/${second}`, {
			method: "DELETE",
			token: pres.creatorToken,
		});
		const [emptied] = await listThemes(pres, "ot");
		expect(emptied.id).toBe(theme.id);
		expect(emptied.answerIds).toEqual([]);
		// A deleted answer cannot be grouped again.
		expect((await assign(pres, first, theme.id)).status).toBe(404);
	});

	test("a reset and a deck delete erase the deck's themes", async () => {
		const { listAnswerThemes } = await import("./services/answer-themes");
		const reset = await runSession();
		await createTheme(reset, "ot", THEME_NAME);
		await call(`/presentations/${reset.id}/reset`, {
			method: "POST",
			token: reset.creatorToken,
		});
		expect(await listThemes(reset, "ot")).toEqual([]);

		const deleted = await runSession();
		await createTheme(deleted, "wc", THEME_NAME);
		expect(await listAnswerThemes(deleted.id, "wc")).toHaveLength(1);
		const gone = await call(`/presentations/${deleted.id}`, {
			method: "DELETE",
			token: deleted.creatorToken,
		});
		expect(gone.status).toBe(200);
		expect(await listAnswerThemes(deleted.id, "wc")).toEqual([]);
	});

	test("no participant-facing or results-link payload carries a theme", async () => {
		const pres = await runSession();
		const theme = await (await createTheme(pres, "ot", THEME_NAME)).json();
		const [first] = await responseIds(pres);
		await assign(pres, first, theme.id);
		const linkResponse = await call(`/presentations/${pres.id}/results-link`, {
			method: "POST",
			token: pres.creatorToken,
		});
		const { resultsToken } = await linkResponse.json();
		const viaLink = { headers: { [RESULTS_TOKEN_HEADER]: resultsToken } };

		const reads: [string, Record<string, unknown>][] = [
			[`/presentations/${pres.id}`, {}],
			[`/join/${pres.code}`, {}],
			[`/presentations/${pres.id}/results`, {}],
			[`/presentations/${pres.id}/results/ot`, {}],
			[`/presentations/${pres.id}/results`, viaLink],
			[`/presentations/${pres.id}/results/ot`, viaLink],
			// The editor's own tally is unchanged by grouping, too.
			[`/presentations/${pres.id}/results/ot`, { token: pres.creatorToken }],
		];
		for (const [path, caller] of reads) {
			const response = await call(path, caller);
			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).not.toContain(THEME_NAME);
			expect(text).not.toContain(theme.id);
			expect(text).not.toContain("answerIds");
		}
	});
});
