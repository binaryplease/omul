/**
 * The command-line client against the real routes (REQ180).
 *
 * The outcome this requirement is finished by is a round trip — create a
 * presentation and read its results back with the client alone — so that is
 * what runs here, over a socket, against the same Elysia routes the browser
 * talks to, on a throw-away in-memory store. Nothing is stubbed but the
 * credential the account path would need: an API key is minted by Better Auth
 * against a real account, which is a browser's errand, so the key-authenticated
 * half is covered by `cli/client.test.ts` (the header is attached, and to what)
 * and the whole round trip is exercised here on the **anonymous** path — the
 * one that returns an edit token and so exercises the store too.
 *
 * `runCommand` is called rather than the executable spawned: the commands hand
 * back both readings of their result, and asserting on a printed string would
 * test the formatter rather than the client.
 */

// IMPORTANT: set DATABASE_PATH before any import of ../server/db — it opens the
// store at load time. ":memory:" gives this suite its own throw-away store.
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "./args";
import { runCommand } from "./commands";
import { heldPresentationIds, readEditToken } from "./edit-tokens";
import { CliError } from "./errors";

const INHERITED = {
	configHome: process.env.XDG_CONFIG_HOME,
	dataHome: process.env.XDG_DATA_HOME,
	apiKey: process.env.OMUL_API_KEY,
	serverUrl: process.env.OMUL_SERVER_URL,
};

let baseUrl = "";
let home = "";
let stop: (() => Promise<void>) | null = null;

/** Run one command line, with `--server` pointed at this suite's server. */
async function omul(...argv: string[]) {
	return runCommand(parseArguments([...argv, "--server", baseUrl]));
}

/** A two-slide deck, written the way a person writes one: no ids anywhere. */
const DECK = {
	title: "Sprint retro",
	slides: [
		{
			type: "multiple-choice",
			question: "How did the sprint go?",
			options: [{ text: "Great" }, { text: "Rough" }],
		},
		{ type: "word-cloud", question: "One word for it?" },
	],
};

async function createDeck(): Promise<Record<string, unknown>> {
	const deckPath = join(home, "deck.json");
	await Bun.write(deckPath, JSON.stringify(DECK));
	const created = await omul("create", "--deck", deckPath);
	return created.data as Record<string, unknown>;
}

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "omul-cli-integration-"));
	process.env.XDG_CONFIG_HOME = join(home, "config");
	process.env.XDG_DATA_HOME = join(home, "data");
	// A key or a server inherited from the developer's own environment would
	// point this suite at their account and their server.
	delete process.env.OMUL_API_KEY;
	delete process.env.OMUL_SERVER_URL;

	const { connectDb } = await import("../server/db");
	const { presentationRoutes } = await import("../server/routes/presentations");
	const { discoveryRoutes } = await import("../server/routes/discovery");
	const { templateRoutes } = await import("../server/routes/templates");
	const { Elysia } = await import("elysia");

	await connectDb();

	const app = new Elysia()
		.use(discoveryRoutes)
		.use(templateRoutes)
		.use(presentationRoutes);
	app.listen({ port: 0, hostname: "127.0.0.1" });
	const server = (app as unknown as { server: { hostname: string; port: number; stop: (closeActive?: boolean) => Promise<void> } }).server;
	if (!server) throw new Error("Elysia did not expose a Bun server");
	stop = () => server.stop(true);
	baseUrl = `http://${server.hostname}:${server.port}`;
});

afterAll(async () => {
	if (stop) await stop();
	rmSync(home, { recursive: true, force: true });
	restore("XDG_CONFIG_HOME", INHERITED.configHome);
	restore("XDG_DATA_HOME", INHERITED.dataHome);
	restore("OMUL_API_KEY", INHERITED.apiKey);
	restore("OMUL_SERVER_URL", INHERITED.serverUrl);
});

function restore(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

describe("finding the server", () => {
	test("health follows the discovery index", async () => {
		const output = await omul("health");
		const data = output.data as { health: { ok: boolean }; discovery: unknown };
		expect(data.health.ok).toBe(true);
		expect(output.lines.join("\n")).toContain("Health");
		expect(output.lines.join("\n")).toContain(`${baseUrl}/api/docs/json`);
	});

	test("the template catalog is listed by id", async () => {
		const output = await omul("templates");
		expect(output.lines.join("\n")).toContain("retrospective");
	});
});

describe("create, then read it back", () => {
	test("a deck written without ids is created, and the token is stored not printed", async () => {
		const created = await createDeck();
		const presentationId = created.id as string;

		// The token the server returns exactly once reaches the store…
		expect(readEditToken(presentationId)).toMatch(/\S/);
		expect(heldPresentationIds()).toContain(presentationId);
		// …and reaches nothing else. Not the payload `--json` prints,
		expect(created).not.toHaveProperty("creatorToken");
		expect(created.editTokenStored).toBe(true);
		// nor any line a person reads.
		const token = readEditToken(presentationId) as string;
		const printed = JSON.stringify(created);
		expect(printed).not.toContain(token);
	});

	test("the ids the client filled in are the ones the deck was created with", async () => {
		const created = await createDeck();
		const slides = created.slides as Record<string, unknown>[];
		expect(slides).toHaveLength(2);
		expect(slides[0]?.id).toMatch(/\S/);
		const options = slides[0]?.options as Record<string, unknown>[];
		expect(options.map((option) => option.id)).toHaveLength(2);
		expect(options[0]?.id).not.toBe(options[1]?.id);
	});

	test("show reads the deck back as its editor, on the stored token alone", async () => {
		const created = await createDeck();
		const output = await omul("show", created.id as string);
		const deck = output.data as Record<string, unknown>;
		expect(deck.title).toBe("Sprint retro");
		// `edit` is the deck's own standing resolved from the token this client
		// stored: without it this would read `null`.
		expect(deck.accessLevel).toBe("edit");
		expect(output.lines.join("\n")).toContain("Join link");
		expect(output.lines.join("\n")).toContain(`${baseUrl}/join/${deck.code}`);
	});

	test("results come back for every slide, and count what the room answered", async () => {
		const created = await createDeck();
		const presentationId = created.id as string;
		const slides = created.slides as Record<string, unknown>[];
		const slideId = slides[0]?.id as string;
		const optionId = (slides[0]?.options as Record<string, unknown>[])[0]
			?.id as string;

		const token = readEditToken(presentationId) as string;
		const start = await fetch(
			`${baseUrl}/api/presentations/${presentationId}/start`,
			{ method: "POST", headers: { "x-omul-edit-token": token } },
		);
		expect(start.status).toBe(200);
		const vote = await fetch(`${baseUrl}/api/presentations/${presentationId}/vote`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slideId, value: optionId, participantId: "p1" }),
		});
		expect(vote.status).toBe(200);

		const output = await omul("results", presentationId);
		const results = output.data as Record<string, unknown>[];
		expect(results).toHaveLength(2);
		expect(results[0]?.slideId).toBe(slideId);
		expect(results[0]?.totalVotes).toBe(1);
		const printed = output.lines.join("\n");
		expect(printed).toContain("How did the sprint go?");
		expect(printed).toContain("1 vote");
		expect(printed).toContain("One word for it?");
	});

	test("a create from a template needs no deck file", async () => {
		const output = await omul("create", "--template", "retrospective");
		const created = output.data as Record<string, unknown>;
		expect((created.slides as unknown[]).length).toBeGreaterThan(0);
		expect(created.title).toBe("Retrospective");
	});

	test("a template that does not exist is the server's refusal, not a guess", async () => {
		await expect(omul("create", "--template", "no-such-template")).rejects.toThrow(
			/No such template/,
		);
	});
});

describe("what the client refuses before it asks", () => {
	test("listing an account's decks without a key says where a key goes", async () => {
		let raised: Error | null = null;
		try {
			await omul("list");
		} catch (error) {
			raised = error as Error;
		}
		expect(raised).toBeInstanceOf(CliError);
		expect(raised?.message).toContain("OMUL_API_KEY");
		expect(raised?.message).toContain("auth login");
	});

	test("a create with nothing to create from never reaches the server", async () => {
		await expect(omul("create", "--title", "Nothing")).rejects.toThrow(
			/--deck <file>|--template/,
		);
	});
});
