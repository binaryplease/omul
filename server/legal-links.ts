/**
 * Where this instance's legal texts live (REQ183).
 *
 * The imprint, the privacy policy and the terms are the **operator's**, not the
 * product's: this repository is published and self-hosted, every deployment has
 * its own, and none of them is in the tree. So their addresses are runtime
 * configuration, read from three environment variables, and the client draws a
 * link only for an address that was configured. An instance that configured none
 * looks and behaves exactly as one built before this existed — no footer, no
 * notice, nothing to click on that leads nowhere.
 *
 * **What a value may be.** An absolute `http(s)://` URL, or a path on this
 * host starting with a single `/` — the second because the app is built to share
 * its host with a marketing site that holds exactly these pages (REQ179), and
 * `/imprint` is how such a deployment names one. Anything else is a fatal
 * startup error rather than a link that is silently dropped: the variable exists
 * so that the link is there, and a `javascript:` URL or a typo that resolves
 * relative to whatever page the visitor is on is worse than no link at all.
 */

import { z } from "zod";

/** The three variables, keyed by the field each one fills. */
export const LEGAL_LINK_ENV = {
	imprintUrl: "OMUL_IMPRINT_URL",
	privacyUrl: "OMUL_PRIVACY_URL",
	termsUrl: "OMUL_TERMS_URL",
} as const;

/**
 * What `GET /api/legal` answers with. Every field is always present, an
 * explicit `null` when unconfigured, so a client sees the whole shape whatever
 * this deployment set.
 */
export const LegalLinksSchema = z.object({
	imprintUrl: z.string().nullable().default(null),
	privacyUrl: z.string().nullable().default(null),
	termsUrl: z.string().nullable().default(null),
});

export type LegalLinks = z.infer<typeof LegalLinksSchema>;

/** A path on this host — one leading slash, so `//elsewhere` is not one. */
const SAME_HOST_PATH = /^\/(?!\/)\S*$/;

function isAcceptedLegalUrl(value: string): boolean {
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
function legalUrlFrom(variable: string, raw: string | undefined): string | null {
	const value = (raw ?? "").trim();
	if (!value) return null;
	if (!isAcceptedLegalUrl(value)) {
		throw new Error(
			`${variable} must be an absolute http(s):// URL or a path on this host starting with "/" — got ${JSON.stringify(raw)}.`,
		);
	}
	return value;
}

/**
 * The legal-text addresses this deployment configured. Read on every call
 * rather than frozen at import, so the route and the boot report cannot
 * disagree and a test can set the environment it describes.
 */
export function resolveLegalLinks(
	environment: Record<string, string | undefined> = process.env,
): LegalLinks {
	return {
		imprintUrl: legalUrlFrom(
			LEGAL_LINK_ENV.imprintUrl,
			environment[LEGAL_LINK_ENV.imprintUrl],
		),
		privacyUrl: legalUrlFrom(
			LEGAL_LINK_ENV.privacyUrl,
			environment[LEGAL_LINK_ENV.privacyUrl],
		),
		termsUrl: legalUrlFrom(
			LEGAL_LINK_ENV.termsUrl,
			environment[LEGAL_LINK_ENV.termsUrl],
		),
	};
}

/**
 * What the boot log says about the legal links, one line per text. Printed
 * because an unconfigured link is invisible from outside — the footer simply is
 * not there — and reading the variables here makes a malformed one fatal at
 * boot rather than a 500 on the first page load.
 */
export function legalLinksStartupReport(
	environment: Record<string, string | undefined> = process.env,
): string[] {
	const links = resolveLegalLinks(environment);
	return (Object.keys(LEGAL_LINK_ENV) as (keyof LegalLinks)[]).map((field) => {
		const variable = LEGAL_LINK_ENV[field];
		const url = links[field];
		return url
			? `[legal] ${variable} = ${url}`
			: `[legal] ${variable} is unset — no link is drawn for it.`;
	});
}
