/**
 * The HTTP client (`cli/client.ts`) — the only place either credential is
 * attached to anything, exercised over a real socket rather than a stubbed
 * `fetch`.
 *
 * Three of these are the reason this file exists at all, and each of them is a
 * way a long-lived credential ends up somewhere it was not meant to be:
 *
 *  - **the plaintext hop.** Either credential on an `http://` request to
 *    anything but this machine is readable by every hop on the path, and
 *    neither expires. The refusal is asked of what is about to ride the
 *    request rather than of the API key alone — the caller holding an edit
 *    token is by construction the caller with no key — and the opt-out is an
 *    environment variable a self-hoster sets deliberately.
 *  - **the redirect.** `fetch` follows one by default and carries custom
 *    headers across it, to another origin included — so a server able to answer
 *    `302` could collect the key. The test asserts the second server is never
 *    called, not merely that an error was raised.
 *  - **the wrong deck's token.** The edit token rides only the requests that
 *    state which presentation they are about, so a route that merely mentions
 *    an id cannot pull a secret into a call nobody meant to authorize.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE,
	assertCredentialTransportIsProtected,
	createApiClient,
	isLoopbackHost,
} from "./client";
import type { Settings } from "./config";
import { storeEditToken } from "./edit-tokens";
import { CliError } from "./errors";

const INHERITED = {
	dataHome: process.env.XDG_DATA_HOME,
	allowPlaintext: process.env[ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE],
};

/** What every request that reached the stub server carried. */
const received: { path: string; headers: Headers }[] = [];

const stub = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	fetch(request) {
		const url = new URL(request.url);
		received.push({ path: url.pathname, headers: request.headers });
		if (url.pathname === "/api/missing") {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		if (url.pathname === "/api/html-error") {
			return new Response("<html><body>502 from a proxy</body></html>", {
				status: 502,
				headers: { "Content-Type": "text/html" },
			});
		}
		if (url.pathname === "/api/redirect") {
			return new Response(null, {
				status: 302,
				headers: { Location: "http://127.0.0.1:1/api/elsewhere" },
			});
		}
		return Response.json({ ok: true, path: url.pathname });
	},
});

const stubOrigin = `http://127.0.0.1:${stub.port}`;

let home = "";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "omul-cli-client-"));
	process.env.XDG_DATA_HOME = home;
	delete process.env[ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE];
	received.length = 0;
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	restore("XDG_DATA_HOME", INHERITED.dataHome);
	restore(ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE, INHERITED.allowPlaintext);
});

afterAll(() => {
	stub.stop(true);
});

function restore(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

function settingsFor(baseUrl: string, apiKey: string | null): Settings {
	return {
		baseUrl,
		baseUrlSource: "--server",
		apiKey,
		apiKeySource: apiKey ? "config file" : "none",
	};
}

describe("what counts as this machine", () => {
	test("loopback names and addresses", () => {
		expect(isLoopbackHost("localhost")).toBe(true);
		expect(isLoopbackHost("omul.localhost")).toBe(true);
		expect(isLoopbackHost("127.0.0.1")).toBe(true);
		expect(isLoopbackHost("127.1.2.3")).toBe(true);
		expect(isLoopbackHost("[::1]")).toBe(true);
	});

	test("anything else is a network", () => {
		expect(isLoopbackHost("omul.example.com")).toBe(false);
		expect(isLoopbackHost("192.168.1.10")).toBe(false);
		// The trap: a hostname that merely *contains* a loopback name.
		expect(isLoopbackHost("localhost.evil.example")).toBe(false);
		expect(isLoopbackHost("127.0.0.1.evil.example")).toBe(false);
	});
});

describe("no credential is sent in the clear", () => {
	test("http to another host is refused", () => {
		expect(() =>
			assertCredentialTransportIsProtected("http://omul.example.com", true),
		).toThrow(CliError);
	});

	test("https, loopback, and carrying nothing at all are all fine", () => {
		expect(() =>
			assertCredentialTransportIsProtected("https://omul.example.com", true),
		).not.toThrow();
		expect(() =>
			assertCredentialTransportIsProtected("http://localhost:3000", true),
		).not.toThrow();
		// A request with no credential on it has nothing to protect: a join-code
		// lookup or an anonymous create over plaintext is the caller's own
		// business, and refusing it would refuse the whole client.
		expect(() =>
			assertCredentialTransportIsProtected("http://omul.example.com", false),
		).not.toThrow();
	});

	test("the opt-out is explicit, and only the exact value opens it", () => {
		process.env[ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE] = "yes";
		expect(() =>
			assertCredentialTransportIsProtected("http://omul.example.com", true),
		).toThrow(CliError);
		process.env[ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE] = "true";
		expect(() =>
			assertCredentialTransportIsProtected("http://omul.example.com", true),
		).not.toThrow();
	});

	test("the client refuses to exist in that configuration at all", () => {
		expect(() =>
			createApiClient(settingsFor("http://omul.example.com", "secret")),
		).toThrow(CliError);
	});

	// The hole this pair closes: the guard used to return early when no API key
	// was configured, and an API-key create is minted no edit token — so the
	// caller holding a token is exactly the caller the guard waved through.
	// Every read of an anonymously-created deck then sent the deck's only
	// credential, one that no account can revoke, over the wire in the clear.
	test("a held edit token is a credential, even with no key configured", async () => {
		storeEditToken("deck-1", "token-1");
		const client = createApiClient(settingsFor("http://omul.example.com", null));
		let raised: Error | null = null;
		try {
			await client.get("/api/presentations/deck-1", {
				presentationId: "deck-1",
			});
		} catch (error) {
			raised = error as Error;
		}
		expect(raised).toBeInstanceOf(CliError);
		expect(raised?.message).toContain(ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE);
		expect(raised?.message).not.toContain("token-1");
		// Refused before the request was built, so nothing went anywhere.
		expect(received).toHaveLength(0);
	});

	test("a request about a deck no token is held for still goes out", async () => {
		storeEditToken("deck-1", "token-1");
		const client = createApiClient(settingsFor(stubOrigin, null));
		await client.get("/api/presentations/deck-2", { presentationId: "deck-2" });
		expect(received).toHaveLength(1);
	});
});

describe("which credential rides which request", () => {
	test("the API key rides every request when one is configured", async () => {
		const client = createApiClient(settingsFor(stubOrigin, "secret-key"));
		await client.get("/api/health");
		expect(received[0]?.headers.get("x-api-key")).toBe("secret-key");
	});

	test("no key configured means no key header", async () => {
		const client = createApiClient(settingsFor(stubOrigin, null));
		await client.get("/api/health");
		expect(received[0]?.headers.get("x-api-key")).toBeNull();
	});

	test("a held edit token rides the request that names its deck", async () => {
		storeEditToken("deck-1", "token-1");
		const client = createApiClient(settingsFor(stubOrigin, null));
		await client.get("/api/presentations/deck-1", { presentationId: "deck-1" });
		expect(received[0]?.headers.get("x-omul-edit-token")).toBe("token-1");
	});

	test("a request about a deck this client holds no token for carries none", async () => {
		storeEditToken("deck-1", "token-1");
		const client = createApiClient(settingsFor(stubOrigin, null));
		await client.get("/api/presentations/deck-2", { presentationId: "deck-2" });
		expect(received[0]?.headers.get("x-omul-edit-token")).toBeNull();
	});

	test("a request that names no deck carries no token, whatever is held", async () => {
		storeEditToken("deck-1", "token-1");
		const client = createApiClient(settingsFor(stubOrigin, null));
		await client.get("/api/presentations/mine");
		expect(received[0]?.headers.get("x-omul-edit-token")).toBeNull();
	});
});

describe("a redirect is reported, not followed", () => {
	test("the credential is never replayed against the target", async () => {
		const client = createApiClient(settingsFor(stubOrigin, "secret-key"));
		let raised: Error | null = null;
		try {
			await client.get("/api/redirect");
		} catch (error) {
			raised = error as Error;
		}
		expect(raised).toBeInstanceOf(CliError);
		expect(raised?.message).toContain("127.0.0.1:1/api/elsewhere");
		// One request in, and it is the one that was asked for: nothing followed.
		expect(received.map((entry) => entry.path)).toEqual(["/api/redirect"]);
	});
});

describe("what a failure says", () => {
	test("the server's own refusal is the message", async () => {
		const client = createApiClient(settingsFor(stubOrigin, null));
		await expect(client.get("/api/missing")).rejects.toThrow(/404 — Not found/);
	});

	test("a proxy's HTML page is excerpted rather than parsed", async () => {
		const client = createApiClient(settingsFor(stubOrigin, null));
		await expect(client.get("/api/html-error")).rejects.toThrow(/502 from a proxy/);
	});

	test("an unreachable server names the base URL and what to check", async () => {
		const client = createApiClient(settingsFor("http://127.0.0.1:1", null));
		await expect(client.get("/api/health")).rejects.toThrow(/--server/);
	});

	test("no message carries a credential", async () => {
		storeEditToken("deck-1", "token-1");
		const client = createApiClient(settingsFor(stubOrigin, "secret-key"));
		let raised: Error | null = null;
		try {
			await client.get("/api/missing", { presentationId: "deck-1" });
		} catch (error) {
			raised = error as Error;
		}
		expect(raised?.message).not.toContain("secret-key");
		expect(raised?.message).not.toContain("token-1");
	});
});
