/**
 * A link address an operator writes into an environment variable.
 *
 * Shared by every variable that names a page the app links to without owning
 * it — the legal texts (REQ183, `server/legal-links.ts`) and the product
 * website's home (REQ200, `server/website-links.ts`). They accept the same two
 * forms and fail the same way, so the rule is written once.
 *
 * **What a value may be.** An absolute `http(s)://` URL, or a path on this
 * host starting with a single `/` — the second because the app is built to share
 * its host with a marketing site (REQ179), and `/imprint` is how such a
 * deployment names one of its pages. Anything else is a fatal startup error
 * rather than a link that is silently dropped: the variable exists so that the
 * link is there, and a `javascript:` URL or a typo that resolves relative to
 * whatever page the visitor is on is worse than no link at all.
 */

/**
 * A path on this host — one leading slash, and no backslash anywhere: a browser
 * reads `\` as `/`, so `//elsewhere`, `/\elsewhere` and `\\elsewhere` all leave
 * the host, and none of them is a path on it.
 */
const SAME_HOST_PATH = /^\/(?!\/)[^\s\\]*$/;

function isAcceptedLinkUrl(value: string): boolean {
	if (SAME_HOST_PATH.test(value)) return true;
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === "https:" || parsed.protocol === "http:") &&
			parsed.host.length > 0
		);
	} catch {
		return false;
	}
}

/**
 * One variable, read. Blank and whitespace are unset; a malformed value throws,
 * naming the variable and what it accepts.
 */
export function configuredUrlFrom(
	variable: string,
	raw: string | undefined,
): string | null {
	const value = (raw ?? "").trim();
	if (!value) return null;
	if (!isAcceptedLinkUrl(value)) {
		throw new Error(
			`${variable} must be an absolute http(s):// URL or a path on this host starting with "/" — got ${JSON.stringify(raw)}.`,
		);
	}
	return value;
}
