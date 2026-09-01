/**
 * The API discovery index — `GET /api`, and the public origin it advertises.
 *
 * This is the one route whose entire job is to be believed. A client or an AI
 * agent that knows nothing about the route layout reads it and follows the
 * links out of it to the OpenAPI spec, the docs UI, the health probe and the
 * WebSocket. Links that are merely *nearly* right are worse here than
 * elsewhere: a browser survives an `http://` link on a proxy's redirect to
 * `https://`, but a script that follows it literally does not, and a `ws://`
 * connection to a host that serves only 443 fails rather than redirecting.
 *
 * So the origin is resolved rather than observed. Behind a TLS-terminating
 * reverse proxy the request reaches this process over plain HTTP on loopback,
 * and `new URL(request.url).origin` is `http://omul.example.com` — the right
 * host with the wrong scheme, and the wrong thing to hand a client.
 *
 * Three sources, most trustworthy first ({@link publicOrigin}):
 *
 *  1. **`OMUL_BASE_HOST`** — the public host, set by the operator. It is
 *     configuration rather than anything a caller can influence, so it wins
 *     outright, and it is the same variable `server/accounts.ts` already
 *     resolves Better Auth's canonical origin from; both read it as `https://`,
 *     because a public host named in configuration is one that terminates TLS.
 *  2. **`X-Forwarded-Proto` / `X-Forwarded-Host`**, but only as far as
 *     `OMUL_TRUST_PROXY` says a proxy exists (`server/proxy-trust.ts`). This
 *     is the same switch, read the same way, as the abuse limiter's client
 *     address: forwarded headers are caller-supplied, and a directly-exposed
 *     server that believes them lets any caller choose the links it hands the
 *     next one. Unset — the default — they are ignored.
 *  3. **The origin the request actually arrived on.** Correct for `mise run
 *     dev`, for the tests, and for a directly-exposed self-hosted server, which
 *     must keep reporting its own real origin.
 *
 * The failure mode worth naming: a proxied deployment that sets neither
 * variable looks, from inside this process, exactly like a healthy direct one.
 * {@link publicOriginStartupReport} therefore states which of the three is in
 * force on every boot, the same way `rateLimitStartupReport` does for the
 * limiter, rather than leaving an operator to discover it from a wrong link.
 */

import { Elysia } from "elysia";
import { trustedForwardedValue, trustedProxyHops } from "../proxy-trust";

/**
 * A bare host, optionally with a port — `omul.example.com`, `localhost:3000`.
 * What a `Host:` header carries and what a proxy writes into
 * `X-Forwarded-Host`; deliberately not a URL, so neither a configured value nor
 * a forwarded one can smuggle in a scheme, a path, credentials or a query.
 */
const BARE_HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/;

/**
 * The origin named by `OMUL_BASE_HOST`, or `null` when it is unset.
 *
 * Throws on a value that is not a bare host. That is a startup crash rather
 * than a fallback (ADR-0018): the variable exists precisely because the
 * observed origin is wrong here, so silently ignoring a malformed one would
 * serve exactly the broken links it was set to prevent, and say nothing.
 */
export function configuredPublicOrigin(): string | null {
	const raw = process.env.OMUL_BASE_HOST ?? "";
	const host = raw.trim().toLowerCase();
	if (!host) return null;
	if (!BARE_HOST_PATTERN.test(host)) {
		throw new Error(
			`OMUL_BASE_HOST must be a bare host such as "omul.example.com" (a ":port" is allowed) — got ${JSON.stringify(raw)}. Do not include a scheme, a path or a trailing slash.`,
		);
	}
	return `https://${host}`;
}

/**
 * The origin a client should use to reach this server — see the module note
 * for why it is not simply the origin the request arrived on.
 *
 * A forwarded host is taken only when it is a bare host; a trusted proxy writes
 * one, and anything else is not a host, so the observed one is used instead. A
 * forwarded protocol is taken only when it is `http` or `https`, the two this
 * server can be reached over.
 */
export function publicOrigin(request: Request): string {
	const configured = configuredPublicOrigin();
	if (configured) return configured;

	const observed = new URL(request.url);
	let scheme = observed.protocol.replace(/:$/, "");
	let host = observed.host;

	if (trustedProxyHops() > 0) {
		const forwardedScheme = trustedForwardedValue(
			request,
			"x-forwarded-proto",
		)?.toLowerCase();
		if (forwardedScheme === "http" || forwardedScheme === "https") {
			scheme = forwardedScheme;
		}
		const forwardedHost = trustedForwardedValue(
			request,
			"x-forwarded-host",
		)?.toLowerCase();
		if (forwardedHost && BARE_HOST_PATTERN.test(forwardedHost)) {
			host = forwardedHost;
		}
	}

	return `${scheme}://${host}`;
}

/**
 * The `ws(s)://` form of an origin. Derived from the resolved origin rather
 * than assembled separately, so the WebSocket link cannot disagree with the
 * links beside it about which scheme this server is reachable on — an
 * `https://` page whose socket link says `ws://` is the mismatch this route
 * shipped with.
 */
export function websocketOrigin(origin: string): string {
	return origin.startsWith("https://")
		? `wss://${origin.slice("https://".length)}`
		: `ws://${origin.slice("http://".length)}`;
}

/** The discovery document as served, for a request that asked for it. */
export function discoveryDocument(request: Request) {
	const base = publicOrigin(request);
	return {
		name: "omul API",
		version: "0.0.0",
		description:
			"REST API for live interactive presentations. Mutation routes require an `Authorization: Bearer <creatorToken>` header (returned once on creation).",
		links: {
			self: `${base}/api`,
			openapi: `${base}/api/docs/json`,
			docs: `${base}/api/docs`,
			health: `${base}/api/health`,
			websocket: `${websocketOrigin(base)}/ws`,
		},
	};
}

/**
 * Which of the three sources is in force, as lines for the startup log.
 *
 * Printed unconditionally, like the limiter's report: a line that appeared only
 * in the broken case would teach an operator that silence means nothing rather
 * than that silence means healthy. Also the point at which a malformed
 * `OMUL_BASE_HOST` becomes fatal — it is read here, at boot, rather than
 * first failing on a request days later.
 */
export function publicOriginStartupReport(): string[] {
	const configured = configuredPublicOrigin();
	if (configured) {
		return [
			`[discovery] /api advertises ${configured} (OMUL_BASE_HOST).`,
		];
	}
	const hops = trustedProxyHops();
	if (hops > 0) {
		return [
			`[discovery] /api advertises the scheme and host ${hops} proxy hop(s) in from the right of X-Forwarded-Proto / X-Forwarded-Host,`,
			"[discovery] falling back to the origin the request arrived on when the proxy sends neither.",
		];
	}
	return [
		"[discovery] /api advertises the origin each request arrives on; forwarded headers are ignored (OMUL_TRUST_PROXY=0).",
		"[discovery] Behind a TLS-terminating proxy this hands clients http:// and ws:// links for an https-only host:",
		"[discovery] set OMUL_BASE_HOST to the public host. Correct as it stands for a directly-exposed server.",
	];
}

/**
 * Machine- and human-readable index of the API surface. Lets clients (and AI
 * agents) find the OpenAPI spec, docs UI, health probe and websocket without
 * prior knowledge of route layout.
 */
export const discoveryRoutes = new Elysia()
	.get("/api", ({ request }) => discoveryDocument(request), {
		detail: {
			tags: ["Discovery"],
			summary: "API discovery index",
			description:
				"Returns a JSON document with links to the OpenAPI specification, interactive docs, health probe, and WebSocket endpoint. Acts as the root entry point for service discovery. Links are absolute and carry the origin a client should use to reach this server: the public host behind a reverse proxy (OMUL_BASE_HOST / trusted X-Forwarded-Proto), the origin the request arrived on otherwise.",
		},
	})

	// The health probe travels with the index that links to it: it is the one
	// link a client follows to check the service before anything else, and a
	// followable link is the claim this route makes.
	.get("/api/health", () => ({ ok: true }), {
		detail: {
			tags: ["Discovery"],
			summary: "Liveness probe",
			description:
				"Returns `{ ok: true }` if the HTTP server is up. Does not verify database connectivity.",
		},
	});
