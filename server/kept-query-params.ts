/**
 * Which query parameters the address bar keeps across in-app navigation
 * (REQ203).
 *
 * The list is the **operator's**, not the product's: which parameters a
 * deployment wants carried — and so sent along in the same-origin `Referer` of
 * every request the app makes while they are in the bar — depends on what reads
 * that header at the deployment's edge, and nothing in this repository knows
 * that. So it is runtime configuration, read from one environment variable, and
 * **unset means empty**: an instance that configured nothing keeps no query
 * parameter at all, exactly as one built before this existed.
 *
 * **What a value may be.** A comma-separated list of entries, each a parameter
 * name (`ref`) or a name prefix ending in `*` (`campaign_*`). Anything else — a
 * bare `*`, a character outside `A–Z a–z 0–9 _ . -` — is a fatal startup error
 * rather than an entry that is silently dropped. So is any entry that would
 * keep one of the {@link LANDING_QUERY_PARAMS}: those carry a one-time token,
 * and a token kept in the bar would ride along in the `Referer` of every
 * request after it.
 *
 * **How it reaches the client.** Not over `/api`: `navigate()` can run before
 * any response arrives, and a parameter dropped by that first navigation is gone
 * for good. So the server writes the list into the `index.html` it hands out,
 * as a `<meta>` tag ({@link injectKeptQueryParams}), and the client reads it
 * synchronously from there. This module has no runtime imports so the client
 * can import the parts it shares.
 */

/** The variable the list is read from. */
export const KEPT_QUERY_PARAMS_ENV = "OMUL_KEPT_QUERY_PARAMS";

/** The `name` of the `<meta>` tag that carries the list to the client. */
export const KEPT_QUERY_PARAMS_META = "omul-kept-query-params";

/**
 * The query parameters an auth landing arrives with (`/?mode=…&token=…`). No
 * configuration can keep them, and `src/auth.tsx` strips exactly these once the
 * landing has been read.
 */
export const LANDING_QUERY_PARAMS: readonly string[] = ["mode", "token", "error"];

/** A name, or a name prefix ending in `*` — never a bare `*`. */
const ENTRY_PATTERN = /^[A-Za-z0-9_.-]+\*?$/;

/** Whether one entry names `name`: equal to it, or a `prefix*` it starts with. */
function entryMatches(entry: string, name: string): boolean {
	return entry.endsWith("*")
		? name.startsWith(entry.slice(0, -1))
		: name === entry;
}

/**
 * Whether `entries` keeps the parameter called `name`. A landing parameter is
 * never kept, whatever `entries` says — the startup check refuses such an entry
 * already, and this is the second lock on the same door.
 */
export function keepsQueryParam(
	entries: readonly string[],
	name: string,
): boolean {
	if (LANDING_QUERY_PARAMS.includes(name)) return false;
	return entries.some((entry) => entryMatches(entry, name));
}

/**
 * The entries of a comma-separated list, trimmed, blanks dropped — without
 * judging them. The client reads the `<meta>` tag with this alone: the server
 * already refused a malformed list at boot.
 */
export function splitKeptQueryParams(raw: string | null | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/**
 * The list this deployment configured. Blank is unset, and unset is empty; a
 * malformed entry, or one that would keep a landing parameter, throws, naming
 * the variable and what it accepts. Read on every call rather than frozen at
 * import, so the page and the boot report cannot disagree and a test can set
 * the environment it describes.
 */
export function resolveKeptQueryParams(
	environment: Record<string, string | undefined> = process.env,
): string[] {
	const entries = splitKeptQueryParams(environment[KEPT_QUERY_PARAMS_ENV]);
	for (const entry of entries) {
		if (!ENTRY_PATTERN.test(entry)) {
			throw new Error(
				`${KEPT_QUERY_PARAMS_ENV} entries must be a parameter name or a name prefix ending in "*", of A–Z, a–z, 0–9, "_", "." and "-" — got ${JSON.stringify(entry)}.`,
			);
		}
		const landing = LANDING_QUERY_PARAMS.find((name) =>
			entryMatches(entry, name),
		);
		if (landing) {
			throw new Error(
				`${KEPT_QUERY_PARAMS_ENV} must not keep "${landing}", which carries an auth landing — got ${JSON.stringify(entry)}.`,
			);
		}
	}
	return entries;
}

/** `&`, `"`, `<` and `>` as the entities an attribute value spells them with. */
function escapeAttribute(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/**
 * `html` with the list written into its `<head>` as a `<meta>` tag the client
 * reads ({@link KEPT_QUERY_PARAMS_META}).
 *
 * An empty list writes nothing, so an unconfigured instance serves its
 * `index.html` byte for byte as built. A page with no `</head>` is returned
 * unchanged too: the client then finds no tag and keeps nothing, which is the
 * safe way for this to be wrong. The entries are escaped although the startup
 * check already confines them to characters that need none — the page is HTML,
 * and what goes into it is escaped as HTML regardless.
 */
export function injectKeptQueryParams(
	html: string,
	entries: readonly string[],
): string {
	if (entries.length === 0 || !html.includes("</head>")) return html;
	const tag = `<meta name="${KEPT_QUERY_PARAMS_META}" content="${escapeAttribute(entries.join(","))}" />`;
	return html.replace("</head>", `  ${tag}\n</head>`);
}

/**
 * What the boot log says about the list. Printed because an empty list is
 * invisible from outside — every parameter is simply dropped on the first
 * navigation — and reading the variable here makes a malformed one fatal at
 * boot rather than a 500 on the first page load.
 */
export function keptQueryParamsStartupReport(
	environment: Record<string, string | undefined> = process.env,
): string[] {
	const entries = resolveKeptQueryParams(environment);
	return entries.length > 0
		? [`[query] ${KEPT_QUERY_PARAMS_ENV} = ${entries.join(",")}`]
		: [
				`[query] ${KEPT_QUERY_PARAMS_ENV} is unset — no query parameter is kept across navigation.`,
			];
}
