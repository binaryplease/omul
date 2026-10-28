/**
 * Where this instance's product website has its home (REQ200).
 *
 * A participant's last screen — the deck has ended — carries one way onward:
 * a link home. Which home is the deployment's to say. An instance that runs
 * next to a product website can send the participant there, in the deck's
 * language where the website has it; a self-hosted instance with no website
 * keeps the app's own home. So the addresses are runtime configuration, read
 * from two environment variables, and **unset is the default**: the button
 * then leads to the app's home page as it always did.
 *
 * Two, not one per participant language, because that is what a website is
 * likely to carry: a German home and an English one. Which of the two a deck
 * gets is the client's rule (`src/components/WebsiteHomeLink.tsx`): a German
 * deck the German home, every other language the English one, and the one that
 * is set when only one is.
 *
 * A value is an absolute `http(s)://` URL or a path on this host, the same rule
 * the legal texts follow (`server/configured-url.ts`), and a malformed one is a
 * fatal startup error naming the variable.
 *
 * The address is used exactly as written: nothing is appended to it, and the
 * participant reaches it only by clicking a link — no redirect is derived from
 * it anywhere.
 */

import { z } from "zod";
import { configuredUrlFrom } from "./configured-url";

/** The two variables, keyed by the field each one fills. */
export const WEBSITE_LINK_ENV = {
	homeUrlEn: "OMUL_WEBSITE_HOME_URL_EN",
	homeUrlDe: "OMUL_WEBSITE_HOME_URL_DE",
} as const;

/**
 * What `GET /api/website` answers with. Both fields are always present, an
 * explicit `null` when unconfigured, so a client sees the whole shape whatever
 * this deployment set.
 */
export const WebsiteLinksSchema = z.object({
	homeUrlEn: z.string().nullable().default(null),
	homeUrlDe: z.string().nullable().default(null),
});

export type WebsiteLinks = z.infer<typeof WebsiteLinksSchema>;

/**
 * The website addresses this deployment configured. Read on every call rather
 * than frozen at import, so the route and the boot report cannot disagree and a
 * test can set the environment it describes.
 */
export function resolveWebsiteLinks(
	environment: Record<string, string | undefined> = process.env,
): WebsiteLinks {
	return {
		homeUrlEn: configuredUrlFrom(
			WEBSITE_LINK_ENV.homeUrlEn,
			environment[WEBSITE_LINK_ENV.homeUrlEn],
		),
		homeUrlDe: configuredUrlFrom(
			WEBSITE_LINK_ENV.homeUrlDe,
			environment[WEBSITE_LINK_ENV.homeUrlDe],
		),
	};
}

/**
 * What the boot log says about the website's home, one line per variable.
 * Printed because an unset one is indistinguishable from outside — the ended
 * screen's link simply leads to the app's home — and reading the variables here
 * makes a malformed one fatal at boot rather than a 500 on the first page load.
 */
export function websiteLinksStartupReport(
	environment: Record<string, string | undefined> = process.env,
): string[] {
	const links = resolveWebsiteLinks(environment);
	return (Object.keys(WEBSITE_LINK_ENV) as (keyof WebsiteLinks)[]).map(
		(field) => {
			const variable = WEBSITE_LINK_ENV[field];
			const url = links[field];
			return url
				? `[website] ${variable} = ${url}`
				: `[website] ${variable} is unset.`;
		},
	);
}
