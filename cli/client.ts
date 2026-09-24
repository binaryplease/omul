/**
 * The HTTP client — the only place in this program that talks to a server, and
 * the only place either of its two credentials is attached to anything.
 *
 * It wraps the same `/api` surface the browser client uses (`docs/api.md`) and
 * adds nothing to it. Which credential rides a request follows the server's own
 * model rather than a choice made here:
 *
 *  - the **personal API key** goes in `x-api-key` on every request when one is
 *    configured, because it is what identifies the account across the whole
 *    surface;
 *  - a deck's **edit token** goes in `X-Omul-Edit-Token` when this client holds
 *    one for the presentation the request is about — the dedicated header
 *    rather than the `Authorization: Bearer` slot it is also accepted in, since
 *    the server assigns no account meaning to `Authorization` and reading a
 *    token out of it is a compatibility path rather than the intended one.
 *
 * Both may ride the same request. They are independent standings on the server
 * (owner *or* edit token), and sending the one that happens to apply is what
 * lets a single command work on a deck this client created anonymously and on a
 * deck the account owns.
 *
 * Three things are refused rather than worked around, and each is a way a
 * credential leaves the machine it was meant for:
 *
 *  - **A plaintext hop with a credential on it.** Anything sent to an `http://`
 *    host that is not loopback crosses a network in the clear, and every
 *    observer on the path keeps what it saw. That is refused for **either**
 *    credential, not for the key alone: an API-key create is minted no edit
 *    token, so the caller who holds a token is precisely the caller who has no
 *    key — a refusal that returned early on "no key configured" would wave
 *    through every read of an anonymously-created deck, and an intercepted edit
 *    token is the less recoverable of the two, since no account owns it and
 *    there is nothing to revoke. The opt-out is an explicit environment
 *    variable a self-hoster on a trusted network sets deliberately — the same
 *    shape as the server's own `OMUL_RATE_LIMITS_DISABLED`.
 *  - **A redirect.** `fetch` follows one by default and carries custom headers
 *    across it, including to another origin, so a server (or anything able to
 *    answer as one) could collect the key by answering `302`. Redirects are not
 *    followed; the `Location` is reported and the caller points `--server` at it
 *    themselves.
 *  - **A request that never ends.** Every call carries a fixed timeout, so a
 *    hung proxy is a message rather than a terminal that never comes back.
 *
 * No request header is ever printed. An error names the method, the path and
 * what the server said — never what was sent.
 */

import { CliError } from "./errors";
import { EDIT_TOKEN_HEADER } from "./protocol";
import { readEditToken } from "./edit-tokens";
import type { Settings } from "./config";

/**
 * How long any one call may take. Long enough for a results read on a large
 * deck, short enough that a wedged proxy is a message rather than a hang.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** The deliberate opt-out from the plaintext-credential refusal. */
export const ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE =
	"OMUL_CLI_ALLOW_PLAINTEXT_CREDENTIALS";

/** Options for one call. */
export interface ApiRequestOptions {
	/** The request body, serialized as JSON. */
	body?: unknown;
	/**
	 * The presentation this request is about. When this client holds an edit
	 * token for it, the token rides along — stated per call rather than guessed
	 * from the path, so a route that merely mentions an id cannot pull a secret
	 * into a request nobody meant to authorize.
	 */
	presentationId?: string;
}

/** What the commands call. */
export interface ApiClient {
	readonly baseUrl: string;
	get(path: string, options?: ApiRequestOptions): Promise<unknown>;
	post(path: string, options?: ApiRequestOptions): Promise<unknown>;
}

/**
 * Whether a host is this machine, and so whether `http://` to it ever leaves
 * it. `.localhost` is included because the name is reserved for exactly this
 * and resolvers are required to answer it with a loopback address.
 */
export function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host === "::1") return true;
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Refuse to send a long-lived credential over a hop that does not protect it.
 *
 * Asked of whatever is **about to ride this request**, not of the API key
 * alone: the personal key and a deck's edit token are both long-lived, and the
 * token is the one with no account behind it to revoke. A caller with a token
 * and no key is the ordinary anonymous case rather than an exotic one, so
 * asking only about the key would be a refusal that protects the credential
 * that has a remedy and waves through the credential that has none.
 *
 * The safe posture is the default and loosening it is the caller's explicit,
 * documented decision — so this is a hard stop with an environment variable
 * beside it, not a warning that scrolls past in a CI log.
 */
export function assertCredentialTransportIsProtected(
	baseUrl: string,
	carriesCredential: boolean,
): void {
	if (!carriesCredential) return;
	const url = new URL(baseUrl);
	if (url.protocol === "https:") return;
	if (isLoopbackHost(url.hostname)) return;
	if (process.env[ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE] === "true") return;
	throw new CliError(
		`Refusing to send a credential in the clear to ${url.origin}. ` +
			"An API key and a deck's edit token are both long-lived, and an edit token cannot be revoked. " +
			"Use https://, or set " +
			`${ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE}=true if that host is reached over a network you trust.`,
	);
}

/**
 * Build the client for one invocation. A factory over a closure, like every
 * other service module in this repository.
 */
export function createApiClient(settings: Settings): ApiClient {
	// A configured key fails here rather than on the first request: the whole
	// client is unusable in that configuration, and saying so before anything is
	// attempted is a clearer answer than one refusal per command. The edit token
	// cannot be asked about yet — which deck a call is about is per request — so
	// the same question is asked again below, where the answer is complete.
	assertCredentialTransportIsProtected(
		settings.baseUrl,
		settings.apiKey !== null,
	);

	async function request(
		method: "GET" | "POST",
		path: string,
		options: ApiRequestOptions,
	): Promise<unknown> {
		// Resolved before the assertion and before any header is set, so what the
		// guard is asked about is exactly what would go out.
		const editToken = options.presentationId
			? readEditToken(options.presentationId)
			: null;
		assertCredentialTransportIsProtected(
			settings.baseUrl,
			settings.apiKey !== null || editToken !== null,
		);

		const headers = new Headers({ Accept: "application/json" });
		if (settings.apiKey) headers.set("x-api-key", settings.apiKey);
		if (editToken) headers.set(EDIT_TOKEN_HEADER, editToken);
		if (options.body !== undefined) {
			headers.set("Content-Type", "application/json");
		}

		const url = `${settings.baseUrl}${path}`;
		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers,
				body:
					options.body === undefined ? undefined : JSON.stringify(options.body),
				redirect: "manual",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			throw new CliError(
				`Cannot reach ${settings.baseUrl} (${method} ${path}): ${
					(error as Error).message
				}. Is the server running, and is --server pointing at it?`,
			);
		}

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location") ?? "(none)";
			throw new CliError(
				`${settings.baseUrl} redirected ${method} ${path} to ${location}. ` +
					"Redirects are not followed, because a request carrying credentials must not be " +
					"replayed against a host this client was not pointed at. Point --server at that URL instead.",
			);
		}

		const raw = await response.text();
		const payload = parseJsonBody(raw, response);

		if (!response.ok) {
			throw new CliError(
				`${method} ${path} failed: HTTP ${response.status} — ${describeFailure(
					payload,
					raw,
				)}`,
			);
		}
		return payload;
	}

	return {
		baseUrl: settings.baseUrl,
		get: (path, options = {}) => request("GET", path, options),
		post: (path, options = {}) => request("POST", path, options),
	};
}

/**
 * The body as JSON, or `undefined` when it is not JSON at all — which is what a
 * proxy's HTML error page looks like, and is worth reporting as "that was not
 * this API" rather than as a parse error nobody can act on.
 */
function parseJsonBody(raw: string, response: Response): unknown {
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json")) return undefined;
	if (raw.trim() === "") return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * What to say about a failed call. The server states its refusals as
 * `{ "error": "…" }`; anything else is reported as a short excerpt, capped,
 * because a reverse proxy's error page is an unbounded HTML document.
 */
function describeFailure(payload: unknown, raw: string): string {
	if (typeof payload === "object" && payload !== null) {
		const stated = (payload as { error?: unknown; message?: unknown });
		if (typeof stated.error === "string") return stated.error;
		if (typeof stated.message === "string") return stated.message;
		return JSON.stringify(payload).slice(0, 400);
	}
	const excerpt = raw.trim().replace(/\s+/g, " ").slice(0, 200);
	return excerpt === "" ? "(no response body)" : excerpt;
}
