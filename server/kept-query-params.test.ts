/**
 * The operator's list of query parameters the address bar keeps (REQ203):
 * empty unless configured, refused at boot when malformed or when it would keep
 * an auth landing's token, and written into the page only when there is
 * something to write.
 */

import { describe, expect, test } from "bun:test";
import {
	injectKeptQueryParams,
	KEPT_QUERY_PARAMS_ENV,
	KEPT_QUERY_PARAMS_META,
	keepsQueryParam,
	keptQueryParamsStartupReport,
	resolveKeptQueryParams,
	splitKeptQueryParams,
} from "./kept-query-params";

const configured = (value: string) => ({ [KEPT_QUERY_PARAMS_ENV]: value });

describe("the list is the operator's, and empty unless set", () => {
	test("unset and blank keep nothing", () => {
		expect(resolveKeptQueryParams({})).toEqual([]);
		expect(resolveKeptQueryParams(configured(""))).toEqual([]);
		expect(resolveKeptQueryParams(configured("  , ,"))).toEqual([]);
	});

	test("names and prefixes are read trimmed, in order", () => {
		expect(resolveKeptQueryParams(configured(" ref , campaign_* ,x.y-z"))).toEqual(
			["ref", "campaign_*", "x.y-z"],
		);
	});

	test("a malformed entry stops the boot, naming the variable", () => {
		for (const entry of ["*", "a b", "a*b", "a<b", 'a"b', "ä", "ref**"]) {
			expect(() => resolveKeptQueryParams(configured(entry))).toThrow(
				KEPT_QUERY_PARAMS_ENV,
			);
		}
	});

	test("an entry that would keep an auth landing's parameters stops the boot", () => {
		for (const entry of ["mode", "token", "error", "t*", "mo*", "e*", "error*"]) {
			expect(() =>
				resolveKeptQueryParams(configured(`ref,${entry}`)),
			).toThrow("auth landing");
		}
		// Names that merely resemble them are the operator's to keep.
		expect(resolveKeptQueryParams(configured("modes,tok,errors"))).toEqual([
			"modes",
			"tok",
			"errors",
		]);
	});

	test("the boot report says which, or that there are none", () => {
		expect(keptQueryParamsStartupReport({})).toEqual([
			`[query] ${KEPT_QUERY_PARAMS_ENV} is unset — no query parameter is kept across navigation.`,
		]);
		expect(keptQueryParamsStartupReport(configured("ref,campaign_*"))).toEqual([
			`[query] ${KEPT_QUERY_PARAMS_ENV} = ref,campaign_*`,
		]);
	});
});

describe("which parameters a list keeps", () => {
	test("a name is kept exactly, a prefix by its start", () => {
		const entries = ["ref", "campaign_*"];
		expect(keepsQueryParam(entries, "ref")).toBe(true);
		expect(keepsQueryParam(entries, "referrer")).toBe(false);
		expect(keepsQueryParam(entries, "campaign_")).toBe(true);
		expect(keepsQueryParam(entries, "campaign_source")).toBe(true);
		expect(keepsQueryParam(entries, "campaign")).toBe(false);
		expect(keepsQueryParam(entries, "xcampaign_a")).toBe(false);
		expect(keepsQueryParam([], "ref")).toBe(false);
	});

	test("a landing parameter is never kept, whatever the list says", () => {
		for (const name of ["mode", "token", "error"]) {
			expect(keepsQueryParam([name, "*", `${name[0]}*`], name)).toBe(false);
		}
	});

	test("the page's copy is split without being judged", () => {
		expect(splitKeptQueryParams(null)).toEqual([]);
		expect(splitKeptQueryParams(undefined)).toEqual([]);
		expect(splitKeptQueryParams("ref, campaign_*,")).toEqual([
			"ref",
			"campaign_*",
		]);
	});
});

describe("the list reaches the client inside index.html", () => {
	const PAGE = "<!doctype html><html><head><title>t</title></head><body></body></html>";

	test("an empty list leaves the page byte for byte as built", () => {
		expect(injectKeptQueryParams(PAGE, [])).toBe(PAGE);
	});

	test("a configured list is one meta tag at the end of the head", () => {
		const page = injectKeptQueryParams(PAGE, ["ref", "campaign_*"]);
		expect(page).toContain(
			`<meta name="${KEPT_QUERY_PARAMS_META}" content="ref,campaign_*" />\n</head>`,
		);
		expect(page.match(/<meta /g)).toHaveLength(1);
	});

	test("what it writes is escaped as an attribute value", () => {
		expect(injectKeptQueryParams(PAGE, ['a"><script>'])).toContain(
			'content="a&quot;&gt;&lt;script&gt;"',
		);
	});

	test("a page without a head is left alone, so the client keeps nothing", () => {
		const page = "<!doctype html><html></html>";
		expect(injectKeptQueryParams(page, ["ref"])).toBe(page);
	});
});
