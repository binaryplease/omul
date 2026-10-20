/**
 * Where this instance's product website has its home
 * (`server/website-links.ts`, REQ200).
 *
 * The addresses are the operator's, so what is held here is the reading of the
 * two variables and the route that hands them to the client:
 *
 *   - **Unset is the default.** No variable, a blank one, or whitespace all
 *     read as `null`, and the route still emits the field — the ended screen
 *     then leads to the app's own home, as before.
 *   - **A malformed value is refused, loudly**, naming the variable, which the
 *     boot report turns into a startup crash.
 *   - **The address is reported exactly as written** — nothing is appended.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { websiteRoutes } from "./routes/website";
import {
	resolveWebsiteLinks,
	WEBSITE_LINK_ENV,
	websiteLinksStartupReport,
} from "./website-links";

const VARIABLES = Object.values(WEBSITE_LINK_ENV);
const INHERITED = Object.fromEntries(
	VARIABLES.map((variable) => [variable, process.env[variable]]),
);

function restoreEnvironment(): void {
	for (const variable of VARIABLES) {
		const inherited = INHERITED[variable];
		if (inherited === undefined) delete process.env[variable];
		else process.env[variable] = inherited;
	}
}

async function fetchWebsite(): Promise<{ status: number; body: unknown }> {
	const response = await websiteRoutes.handle(
		new Request("http://localhost/api/website"),
	);
	return { status: response.status, body: await response.json() };
}

describe("reading the website's home addresses (REQ200)", () => {
	test("the two variables are the documented ones", () => {
		expect(WEBSITE_LINK_ENV).toEqual({
			homeUrlEn: "OMUL_WEBSITE_HOME_URL_EN",
			homeUrlDe: "OMUL_WEBSITE_HOME_URL_DE",
		});
	});

	test("unset, blank and whitespace all read as unconfigured", () => {
		expect(resolveWebsiteLinks({})).toEqual({
			homeUrlEn: null,
			homeUrlDe: null,
		});
		expect(
			resolveWebsiteLinks({
				OMUL_WEBSITE_HOME_URL_EN: "",
				OMUL_WEBSITE_HOME_URL_DE: "   ",
			}),
		).toEqual({ homeUrlEn: null, homeUrlDe: null });
	});

	test("a configured address is kept exactly as written, trimmed", () => {
		expect(
			resolveWebsiteLinks({
				OMUL_WEBSITE_HOME_URL_EN: " https://omul.app/en ",
				OMUL_WEBSITE_HOME_URL_DE: "https://omul.app/",
			}),
		).toEqual({
			homeUrlEn: "https://omul.app/en",
			homeUrlDe: "https://omul.app/",
		});
	});

	test("a path on this host is accepted, like the legal texts'", () => {
		expect(
			resolveWebsiteLinks({ OMUL_WEBSITE_HOME_URL_DE: "/" }).homeUrlDe,
		).toBe("/");
	});

	for (const malformed of [
		"javascript:alert(1)",
		"omul.app",
		"//elsewhere.example",
		"/\\elsewhere.example",
		"ftp://example.com/",
	]) {
		test(`refuses ${JSON.stringify(malformed)}, naming the variable`, () => {
			expect(() =>
				resolveWebsiteLinks({ OMUL_WEBSITE_HOME_URL_EN: malformed }),
			).toThrow("OMUL_WEBSITE_HOME_URL_EN");
		});
	}

	test("the boot report names each variable and what it holds", () => {
		expect(
			websiteLinksStartupReport({
				OMUL_WEBSITE_HOME_URL_DE: "https://omul.app/",
			}),
		).toEqual([
			"[website] OMUL_WEBSITE_HOME_URL_EN is unset.",
			"[website] OMUL_WEBSITE_HOME_URL_DE = https://omul.app/",
		]);
	});

	test("a malformed value makes the boot report throw", () => {
		expect(() =>
			websiteLinksStartupReport({ OMUL_WEBSITE_HOME_URL_DE: "javascript:0" }),
		).toThrow("OMUL_WEBSITE_HOME_URL_DE");
	});
});

describe("GET /api/website (REQ200)", () => {
	afterEach(restoreEnvironment);

	test("an instance that configured nothing answers both fields as null", async () => {
		for (const variable of VARIABLES) delete process.env[variable];
		const { status, body } = await fetchWebsite();
		expect(status).toBe(200);
		expect(body).toEqual({ homeUrlEn: null, homeUrlDe: null });
	});

	test("configured addresses are reported as set", async () => {
		process.env.OMUL_WEBSITE_HOME_URL_EN = "https://omul.app/en";
		process.env.OMUL_WEBSITE_HOME_URL_DE = "https://omul.app/";
		const { status, body } = await fetchWebsite();
		expect(status).toBe(200);
		expect(body).toEqual({
			homeUrlEn: "https://omul.app/en",
			homeUrlDe: "https://omul.app/",
		});
	});
});
