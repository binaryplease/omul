/**
 * Every link the presenter screen puts on the clipboard parses to an `http:` or
 * `https:` URL.
 *
 * Two routes reach the clipboard. A copy control writes a value built in
 * `share-links.ts` (or `resultsLinkUrl` in `api.ts`); a copy of the on-screen
 * join address goes through the element's `onCopy={copyAddressAs(…)}`, which
 * writes the absolute link in place of the bare host the screen shows. The
 * first block checks the values both routes write, on an HTTPS deploy and on a
 * plain-HTTP LAN deploy (REQ212). The second reads the surfaces' source, the
 * way `PresenterPage.test.ts` does, so a copy that bypasses those builders, or
 * an address drawn without the copy handler, fails here: the page needs a live
 * store and socket to render at all, and this repo renders no DOM in tests.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS_LINK_FRAGMENT, resultsLinkUrl } from "./api";
import {
	type AddressCopyEvent,
	type AddressSelection,
	addressCopyText,
	copyAddressAs,
	editLinkUrl,
	embedSnippet,
	isHttpLink,
	type JoinAddress,
	joinAddressFor,
	joinLinkUrl,
} from "./share-links";

const ORIGINS = [
	{ origin: "https://omul.example", host: "omul.example" },
	{ origin: "http://192.168.1.20:3000", host: "192.168.1.20:3000" },
	{ origin: "http://localhost:5173", host: "localhost:5173" },
];

/** The check: `new URL()` parses it, to `http:` or `https:`. */
function expectHttpLink(value: string) {
	expect(isHttpLink(value)).toBe(true);
	expect(["http:", "https:"]).toContain(new URL(value).protocol);
}

/** The `src` of the embed snippet, the one link it carries. */
function embedSource(snippet: string): string {
	const match = snippet.match(/<iframe src="([^"]*)"/);
	expect(match).not.toBeNull();
	return match?.[1] ?? "";
}

/**
 * A copy event on an element whose text node is `inside`, with a selection of
 * `selectedText` that either lies in that node or starts outside it. Returns
 * what the handler wrote, or `null` when it left the copy to the browser.
 */
function copySelection(
	address: JoinAddress,
	selectedText: string,
	selectionInside: boolean,
): string | null {
	const inside = { name: "address text" } as unknown as Node;
	const outside = { name: "page text" } as unknown as Node;
	let written: string | null = null;
	let prevented = false;
	const selection: AddressSelection = {
		anchorNode: selectionInside ? inside : outside,
		focusNode: inside,
		toString: () => selectedText,
	};
	const event: AddressCopyEvent = {
		currentTarget: { contains: (node) => node === inside },
		clipboardData: {
			setData: (format, data) => {
				expect(format).toBe("text/plain");
				written = data;
			},
		},
		preventDefault: () => {
			prevented = true;
		},
	};
	copyAddressAs(address, () => selection)(event);
	expect(prevented).toBe(written !== null);
	return written;
}

describe("every link the presenter screen copies parses to http(s)", () => {
	test("the reported defect fails the check: a bare host is no http(s) URL", () => {
		expect(isHttpLink("omul.example/join/123456")).toBe(false);
		// `new URL` parses this one, with the host as its protocol.
		expect(isHttpLink("192.168.1.20:3000/join/123456")).toBe(false);
		expect(isHttpLink("localhost:5173/join/123456")).toBe(false);
		expect(isHttpLink("javascript:alert(1)")).toBe(false);
		expect(isHttpLink("https://omul.example/join/123456")).toBe(true);
	});

	for (const { origin, host } of ORIGINS) {
		describe(`on ${origin}`, () => {
			const address = joinAddressFor({ origin, host }, "123456");

			test("Copy join link and the QR code", () => {
				const url = joinLinkUrl(origin, "123456");
				expectHttpLink(url);
				expect(url).toBe(`${origin}/join/123456`);
				expect(address).toEqual({ host, url });
			});

			test("Copy embed code: the snippet's src", () => {
				const source = embedSource(embedSnippet(joinLinkUrl(origin, "123456")));
				expectHttpLink(source);
				expect(new URL(source).pathname).toBe("/join/123456");
			});

			test("Copy share link with edit permissions", () => {
				const url = editLinkUrl(origin, "pres-1", "tok/en+=&");
				expectHttpLink(url);
				expect(new URL(url).pathname).toBe("/edit/pres-1");
				expect(
					new URLSearchParams(new URL(url).hash.slice(1)).get("share"),
				).toBe("tok/en+=&");
			});

			test("the results link, on mint and on Copy", () => {
				const url = resultsLinkUrl(origin, "pres-1", "tok-1");
				expectHttpLink(url);
				expect(new URL(url).hash).toBe(`#${RESULTS_LINK_FRAGMENT}=tok-1`);
			});

			test("the QR dialog's address, selected and copied", () => {
				const written = copySelection(address, `${host}/join/123456`, true);
				expect(written).toBe(address.url);
				expectHttpLink(written ?? "");
			});

			test("the join chip's and the presenting view's line, selected and copied", () => {
				for (const line of [`Join at ${host} 123456`, `${host} 123456`, host]) {
					const written = copySelection(address, line, true);
					expect(written).toBe(address.url);
					expectHttpLink(written ?? "");
				}
			});
		});
	}
});

describe("a copy of the on-screen address", () => {
	const address: JoinAddress = {
		host: "omul.example",
		url: "https://omul.example/join/123456",
	};

	test("a selection that holds the whole host writes the absolute link", () => {
		expect(
			addressCopyText({ text: "omul.example/join/123456", insideAddress: true }, address),
		).toBe(address.url);
	});

	test("the code alone, or part of the host, is copied as selected", () => {
		expect(addressCopyText({ text: "123456", insideAddress: true }, address)).toBeNull();
		expect(addressCopyText({ text: "/join/123456", insideAddress: true }, address)).toBeNull();
		expect(addressCopyText({ text: "omul", insideAddress: true }, address)).toBeNull();
		expect(copySelection(address, "123456", true)).toBeNull();
	});

	test("a selection that runs past the address is left to the browser", () => {
		expect(
			addressCopyText({ text: "Deck title omul.example/join/123456", insideAddress: false }, address),
		).toBeNull();
		expect(copySelection(address, "Deck title omul.example/join/123456", false)).toBeNull();
	});

	test("with no selection or no clipboard data the handler does nothing", () => {
		const event: AddressCopyEvent = {
			currentTarget: { contains: () => true },
			clipboardData: null,
			preventDefault: () => {
				throw new Error("a copy without clipboard data must not be cancelled");
			},
		};
		const selection: AddressSelection = {
			anchorNode: null,
			focusNode: null,
			toString: () => "omul.example",
		};
		expect(() => copyAddressAs(address, () => selection)(event)).not.toThrow();
		expect(() => copyAddressAs(address, () => null)(event)).not.toThrow();
	});
});

const read = (...path: string[]) =>
	readFileSync(join(import.meta.dir, ...path), "utf8");
const presenterPage = read("pages", "PresenterPage.tsx");
const shareCluster = read("components", "ShareCluster.tsx");
const presentingView = read("components", "PresentingView.tsx");
const resultsLinkDialog = read("components", "ResultsLinkDialog.tsx");
const surfaces = {
	"PresenterPage.tsx": presenterPage,
	"ShareCluster.tsx": shareCluster,
	"PresentingView.tsx": presentingView,
	"ResultsLinkDialog.tsx": resultsLinkDialog,
};

/** The JSX element (opening tag to closing tag) that contains `marker`. */
function enclosingElement(source: string, marker: string, tag: string): string {
	const at = source.indexOf(marker);
	expect(at).toBeGreaterThan(-1);
	const start = source.lastIndexOf(`<${tag}`, at);
	const end = source.indexOf(`</${tag}>`, at);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(at);
	return source.slice(start, end);
}

describe("the presenter surfaces copy only what the builders made", () => {
	test("no surface writes to navigator.clipboard itself", () => {
		for (const [file, source] of Object.entries(surfaces)) {
			expect({ file, writes: source.includes("navigator.clipboard") }).toEqual({
				file,
				writes: false,
			});
		}
	});

	test("no surface spells a link out of the origin by hand", () => {
		for (const [file, source] of Object.entries(surfaces)) {
			expect({ file, spelled: /\$\{window\.location\.origin\}/.test(source) }).toEqual({
				file,
				spelled: false,
			});
		}
	});

	test("the presenter's four copy controls copy the code and the three built links", () => {
		const calls = [...presenterPage.matchAll(/await copyShareValue\(([^,]+),/g)].map(
			(match) => match[1],
		);
		expect(calls).toEqual(["pres.code", "url", "snippet", "url"]);
		expect(presenterPage).toContain(
			"const url = joinLinkUrl(window.location.origin, pres.code);",
		);
		expect(presenterPage).toContain(
			"const snippet = embedSnippet(joinLinkUrl(window.location.origin, pres.code));",
		);
		expect(presenterPage).toContain(
			"const url = editLinkUrl(window.location.origin, pres.id, token);",
		);
		expect(presenterPage).toContain(
			"const joinAddress = joinAddressFor(window.location, pres.code);",
		);
	});

	test("the results dialog copies the link `resultsLinkUrl` built", () => {
		expect(resultsLinkDialog).toContain("value: view.url,");
		expect(resultsLinkDialog).toContain(
			"url: resultsLinkUrl(origin, presentationId, held.token),",
		);
		expect(resultsLinkDialog).toMatch(
			/await writeClipboardText\(\s*resultsLinkUrl\(/,
		);
	});

	test("every element that shows the join host copies it as the absolute link", () => {
		// The page reads the host only through the join address.
		expect(presenterPage).not.toContain("window.location.host");
		expect(presenterPage.match(/\{joinAddress\.host\}/g)?.length).toBe(1);
		expect(
			enclosingElement(presenterPage, "{joinAddress.host}", "span"),
		).toContain("onCopy={copyAddressAs(joinAddress)}");
		// The bar's join chip, from `2xl`.
		expect(shareCluster.match(/\{join\.address\.host\}/g)?.length).toBe(1);
		expect(
			enclosingElement(shareCluster, "{join.address.host}", "button"),
		).toContain("onCopy={copyAddressAs(join.address)}");
		// The presenting view's join line.
		expect(presentingView.match(/\{join\.address\.host\}/g)?.length).toBe(1);
		expect(
			enclosingElement(presentingView, "{join.address.host}", "p"),
		).toContain("onCopy={copyAddressAs(join.address)}");
	});
});
