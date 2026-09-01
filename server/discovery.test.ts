/**
 * The `/api` discovery index and the origin it advertises
 * (`server/routes/discovery.ts`, REQ151).
 *
 * The defect these cover: behind a TLS-terminating proxy the request reaches
 * this process over plain HTTP, so the origin it observes is
 * `http://omul.example.com` — the right host with the wrong scheme — and every
 * link went out as `http://`, the WebSocket one as `ws://`. A client that
 * follows them literally fails on a host that only serves 443.
 *
 * Both halves are exercised here: the resolution itself, and the route as it is
 * actually served, over a real socket. No database is involved — the route
 * touches none — so the live half is cheap enough to sit in the same file.
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import {
	configuredPublicOrigin,
	discoveryDocument,
	discoveryRoutes,
	publicOrigin,
	publicOriginStartupReport,
	websocketOrigin,
} from "./routes/discovery";

/** The environment this suite inherits, restored after every case. */
const INHERITED_TRUST_PROXY = process.env.OMUL_TRUST_PROXY;
const INHERITED_BASE_HOST = process.env.OMUL_BASE_HOST;

function restoreEnvironment(): void {
	if (INHERITED_TRUST_PROXY === undefined) delete process.env.OMUL_TRUST_PROXY;
	else process.env.OMUL_TRUST_PROXY = INHERITED_TRUST_PROXY;
	if (INHERITED_BASE_HOST === undefined) delete process.env.OMUL_BASE_HOST;
	else process.env.OMUL_BASE_HOST = INHERITED_BASE_HOST;
}

/** A request as this process sees it, with the headers a proxy would add. */
function requestAt(
	url: string,
	headers: Record<string, string> = {},
): Request {
	return new Request(url, { headers });
}

/**
 * How a proxied deployment arrives: the proxy terminates TLS at the public host
 * and forwards over plain HTTP to loopback, preserving the Host header.
 */
function proxiedRequest(headers: Record<string, string> = {}): Request {
	return requestAt("http://omul.example.com/api", {
		"X-Forwarded-Proto": "https",
		"X-Forwarded-For": "203.0.113.5",
		...headers,
	});
}

describe("the origin the discovery index advertises (REQ151)", () => {
	afterEach(restoreEnvironment);

	test("a directly-exposed server reports the origin the request arrived on", () => {
		delete process.env.OMUL_BASE_HOST;
		delete process.env.OMUL_TRUST_PROXY;

		expect(publicOrigin(requestAt("http://localhost:3000/api"))).toBe(
			"http://localhost:3000",
		);
		expect(publicOrigin(requestAt("http://127.0.0.1:5173/api"))).toBe(
			"http://127.0.0.1:5173",
		);
		// A server that does terminate its own TLS keeps saying so.
		expect(publicOrigin(requestAt("https://self.hosted.example/api"))).toBe(
			"https://self.hosted.example",
		);
	});

	test("OMUL_BASE_HOST names the public origin outright", () => {
		process.env.OMUL_BASE_HOST = "omul.example.com";
		delete process.env.OMUL_TRUST_PROXY;

		expect(publicOrigin(proxiedRequest())).toBe("https://omul.example.com");
		// Configuration beats what the socket saw, proxy headers or not: it is
		// the only source no caller can influence.
		expect(publicOrigin(requestAt("http://localhost:3000/api"))).toBe(
			"https://omul.example.com",
		);
		expect(configuredPublicOrigin()).toBe("https://omul.example.com");
	});

	test("a trusted proxy hop's X-Forwarded-Proto is believed", () => {
		delete process.env.OMUL_BASE_HOST;
		process.env.OMUL_TRUST_PROXY = "true";

		expect(publicOrigin(proxiedRequest())).toBe("https://omul.example.com");
	});

	test("an untrusted X-Forwarded-Proto is ignored — the default", () => {
		delete process.env.OMUL_BASE_HOST;
		delete process.env.OMUL_TRUST_PROXY;

		// The header is caller-supplied. A directly-exposed server that believed
		// it would let any caller choose the links handed to the next one.
		expect(publicOrigin(proxiedRequest())).toBe("http://omul.example.com");
		expect(
			publicOrigin(
				requestAt("http://localhost:3000/api", {
					"X-Forwarded-Proto": "https",
					"X-Forwarded-Host": "evil.example",
				}),
			),
		).toBe("http://localhost:3000");
	});

	test("a caller-prepended forwarded hop buys no say in the scheme", () => {
		delete process.env.OMUL_BASE_HOST;
		process.env.OMUL_TRUST_PROXY = "true";

		// Only the right-hand end — what the trusted hop itself observed — counts;
		// everything left of it is whatever the caller wrote.
		expect(
			publicOrigin(proxiedRequest({ "X-Forwarded-Proto": "gopher, https" })),
		).toBe("https://omul.example.com");
		expect(
			publicOrigin(proxiedRequest({ "X-Forwarded-Proto": "https, http" })),
		).toBe("http://omul.example.com");
	});

	test("a longer trusted chain reads that many hops in from the right", () => {
		delete process.env.OMUL_BASE_HOST;
		process.env.OMUL_TRUST_PROXY = "2";

		expect(
			publicOrigin(
				proxiedRequest({ "X-Forwarded-Proto": "http, https, http" }),
			),
		).toBe("https://omul.example.com");
		// Fewer entries than trusted hops: nothing to believe, observed origin.
		expect(publicOrigin(proxiedRequest())).toBe("http://omul.example.com");
	});

	test("a trusted X-Forwarded-Host replaces a rewritten Host, if it is a host", () => {
		delete process.env.OMUL_BASE_HOST;
		process.env.OMUL_TRUST_PROXY = "true";

		expect(
			publicOrigin(
				requestAt("http://127.0.0.1:3200/api", {
					"X-Forwarded-Proto": "https",
					"X-Forwarded-Host": "omul.example.com",
				}),
			),
		).toBe("https://omul.example.com");

		// Read like every other forwarded header: the trusted hop's own entry,
		// not whatever the caller prepended to it.
		expect(
			publicOrigin(
				requestAt("http://127.0.0.1:3200/api", {
					"X-Forwarded-Proto": "https",
					"X-Forwarded-Host": "evil.example, omul.example.com",
				}),
			),
		).toBe("https://omul.example.com");

		for (const notAHost of [
			"https://omul.example.com",
			"omul.example.com/api",
			"user@omul.example.com",
		]) {
			expect(
				publicOrigin(
					requestAt("http://127.0.0.1:3200/api", {
						"X-Forwarded-Proto": "https",
						"X-Forwarded-Host": notAHost,
					}),
				),
			).toBe("https://127.0.0.1:3200");
		}
	});

	test("an unusable forwarded scheme leaves the observed one standing", () => {
		delete process.env.OMUL_BASE_HOST;
		process.env.OMUL_TRUST_PROXY = "true";

		for (const scheme of ["", "gopher", "javascript", "HTTPS://"]) {
			expect(publicOrigin(proxiedRequest({ "X-Forwarded-Proto": scheme }))).toBe(
				"http://omul.example.com",
			);
		}
		// Case is the proxy's business, not the client's.
		expect(publicOrigin(proxiedRequest({ "X-Forwarded-Proto": "HTTPS" }))).toBe(
			"https://omul.example.com",
		);
	});

	test("a malformed OMUL_BASE_HOST is fatal, not ignored", () => {
		delete process.env.OMUL_TRUST_PROXY;
		for (const malformed of [
			"https://omul.example.com",
			"omul.example.com/",
			"omul.example.com/api",
			"omul example com",
		]) {
			process.env.OMUL_BASE_HOST = malformed;
			expect(() => configuredPublicOrigin()).toThrow(/OMUL_BASE_HOST/);
			expect(() => publicOriginStartupReport()).toThrow(/OMUL_BASE_HOST/);
		}

		// A blank value is "unset", not "malformed".
		process.env.OMUL_BASE_HOST = "   ";
		expect(configuredPublicOrigin()).toBeNull();

		// A port is allowed — a self-hoster on a non-standard one.
		process.env.OMUL_BASE_HOST = "Omul.Example:8443";
		expect(configuredPublicOrigin()).toBe("https://omul.example:8443");
	});

	test("the startup report names which source is in force", () => {
		delete process.env.OMUL_BASE_HOST;
		delete process.env.OMUL_TRUST_PROXY;
		expect(publicOriginStartupReport().join(" ")).toContain("OMUL_BASE_HOST");

		process.env.OMUL_TRUST_PROXY = "true";
		expect(publicOriginStartupReport().join(" ")).toContain("X-Forwarded-Proto");

		process.env.OMUL_BASE_HOST = "omul.example.com";
		expect(publicOriginStartupReport().join(" ")).toContain(
			"https://omul.example.com",
		);
	});
});

describe("the discovery document (REQ151)", () => {
	afterEach(restoreEnvironment);

	test("the websocket link always carries the scheme of the links beside it", () => {
		delete process.env.OMUL_BASE_HOST;
		delete process.env.OMUL_TRUST_PROXY;
		expect(websocketOrigin("http://localhost:3000")).toBe("ws://localhost:3000");
		expect(websocketOrigin("https://omul.example.com")).toBe(
			"wss://omul.example.com",
		);

		const direct = discoveryDocument(requestAt("http://localhost:3000/api"));
		expect(direct.links.websocket).toBe("ws://localhost:3000/ws");

		process.env.OMUL_BASE_HOST = "omul.example.com";
		const proxied = discoveryDocument(proxiedRequest());
		expect(proxied.links.websocket).toBe("wss://omul.example.com/ws");
	});

	test("every link is emitted, absolute, and on the resolved origin (ADR-0024)", () => {
		process.env.OMUL_BASE_HOST = "omul.example.com";
		const { links } = discoveryDocument(proxiedRequest());

		expect(Object.keys(links).sort()).toEqual([
			"docs",
			"health",
			"openapi",
			"self",
			"websocket",
		]);
		expect(links).toEqual({
			self: "https://omul.example.com/api",
			openapi: "https://omul.example.com/api/docs/json",
			docs: "https://omul.example.com/api/docs",
			health: "https://omul.example.com/api/health",
			websocket: "wss://omul.example.com/ws",
		});
	});
});

describe("GET /api as actually served (REQ151)", () => {
	let baseUrl = "";
	let stop: () => void = () => {};

	beforeAll(() => {
		const app = discoveryRoutes.listen(0);
		baseUrl = `http://localhost:${app.server?.port}`;
		stop = () => void app.stop();
	});

	afterAll(() => {
		stop();
		restoreEnvironment();
	});

	afterEach(restoreEnvironment);

	test("a plain local server hands out its own origin", async () => {
		delete process.env.OMUL_BASE_HOST;
		delete process.env.OMUL_TRUST_PROXY;

		const response = await fetch(`${baseUrl}/api`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			links: Record<string, string>;
		};
		expect(body.links.self).toBe(`${baseUrl}/api`);
		expect(body.links.websocket).toBe(`${baseUrl.replace("http://", "ws://")}/ws`);

		// The links are followable, which is the whole point of the route.
		const health = await fetch(body.links.health as string);
		expect(await health.json()).toEqual({ ok: true });
	});

	test("behind the configured public host every link is https/wss", async () => {
		process.env.OMUL_BASE_HOST = "omul.example.com";

		const body = (await (
			await fetch(`${baseUrl}/api`, {
				headers: { "X-Forwarded-Proto": "https" },
			})
		).json()) as { links: Record<string, string> };

		expect(body.links.self).toBe("https://omul.example.com/api");
		expect(body.links.docs).toBe("https://omul.example.com/api/docs");
		expect(body.links.websocket).toBe("wss://omul.example.com/ws");
	});
});
