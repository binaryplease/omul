/**
 * Where this instance's legal texts live (`server/legal-links.ts`, REQ183).
 *
 * The addresses are the operator's, so what is held here is the reading of the
 * three variables and the route that hands them to the client:
 *
 *   - **Unset is absent.** No variable, a blank one, or whitespace all read as
 *     `null`, and the route still emits the field — the client draws no link
 *     for it, and an instance that set none renders exactly as before.
 *   - **A malformed value is refused, loudly.** A `javascript:` URL, a bare
 *     host or a protocol-relative `//elsewhere` throws naming the variable,
 *     which the boot report turns into a startup crash.
 *   - **The route says what was configured**, field by field.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	LEGAL_LINK_ENV,
	legalLinksStartupReport,
	resolveLegalLinks,
} from "./legal-links";
import { legalRoutes } from "./routes/legal";

const VARIABLES = Object.values(LEGAL_LINK_ENV);
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

async function fetchLegal(): Promise<{ status: number; body: unknown }> {
	const response = await legalRoutes.handle(
		new Request("http://localhost/api/legal"),
	);
	return { status: response.status, body: await response.json() };
}

describe("reading the legal-text addresses (REQ183)", () => {
	test("the three variables are the documented ones", () => {
		expect(LEGAL_LINK_ENV).toEqual({
			imprintUrl: "OMUL_IMPRINT_URL",
			privacyUrl: "OMUL_PRIVACY_URL",
			termsUrl: "OMUL_TERMS_URL",
		});
	});

	test("unset, blank and whitespace all read as no link", () => {
		expect(resolveLegalLinks({})).toEqual({
			imprintUrl: null,
			privacyUrl: null,
			termsUrl: null,
		});
		expect(
			resolveLegalLinks({
				OMUL_IMPRINT_URL: "",
				OMUL_PRIVACY_URL: "   ",
				OMUL_TERMS_URL: undefined,
			}),
		).toEqual({ imprintUrl: null, privacyUrl: null, termsUrl: null });
	});

	test("each variable fills its own field, trimmed", () => {
		expect(
			resolveLegalLinks({
				OMUL_IMPRINT_URL: " https://example.com/imprint ",
				OMUL_PRIVACY_URL: "/privacy",
				OMUL_TERMS_URL: "http://example.com/terms?lang=en#top",
			}),
		).toEqual({
			imprintUrl: "https://example.com/imprint",
			privacyUrl: "/privacy",
			termsUrl: "http://example.com/terms?lang=en#top",
		});
	});

	test("one configured text leaves the other two absent", () => {
		expect(
			resolveLegalLinks({ OMUL_TERMS_URL: "https://example.com/terms" }),
		).toEqual({
			imprintUrl: null,
			privacyUrl: null,
			termsUrl: "https://example.com/terms",
		});
	});

	for (const malformed of [
		"javascript:alert(1)",
		"data:text/html,hi",
		"example.com/imprint",
		"imprint",
		"//example.com/imprint",
		// A browser reads "\\" as "/", so each of these leaves the host too.
		"/\\example.com/imprint",
		"/\\\\example.com/imprint",
		"\\\\example.com/imprint",
		"/imprint\\..\\elsewhere",
		"https://",
		"/with space",
	]) {
		test(`${JSON.stringify(malformed)} is refused, naming the variable`, () => {
			expect(() => resolveLegalLinks({ OMUL_PRIVACY_URL: malformed })).toThrow(
				"OMUL_PRIVACY_URL",
			);
		});
	}

	test("the boot report names each variable and whether it is set", () => {
		expect(
			legalLinksStartupReport({ OMUL_TERMS_URL: "https://example.com/terms" }),
		).toEqual([
			"[legal] OMUL_IMPRINT_URL is unset — no link is drawn for it.",
			"[legal] OMUL_PRIVACY_URL is unset — no link is drawn for it.",
			"[legal] OMUL_TERMS_URL = https://example.com/terms",
		]);
	});

	test("the boot report is where a malformed value stops the server", () => {
		expect(() =>
			legalLinksStartupReport({ OMUL_IMPRINT_URL: "javascript:void 0" }),
		).toThrow("OMUL_IMPRINT_URL");
	});
});

describe("GET /api/legal (REQ183)", () => {
	afterEach(restoreEnvironment);

	test("an instance that configured nothing answers every field as null", async () => {
		for (const variable of VARIABLES) delete process.env[variable];
		const { status, body } = await fetchLegal();
		expect(status).toBe(200);
		expect(body).toEqual({ imprintUrl: null, privacyUrl: null, termsUrl: null });
	});

	test("configured addresses are reported as set", async () => {
		process.env.OMUL_IMPRINT_URL = "/imprint";
		process.env.OMUL_PRIVACY_URL = "https://example.com/privacy";
		process.env.OMUL_TERMS_URL = "https://example.com/terms";
		const { status, body } = await fetchLegal();
		expect(status).toBe(200);
		expect(body).toEqual({
			imprintUrl: "/imprint",
			privacyUrl: "https://example.com/privacy",
			termsUrl: "https://example.com/terms",
		});
	});
});
