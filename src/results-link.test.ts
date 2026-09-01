/**
 * Unit tests for the results link's client half (REQ098).
 *
 * Three pure pieces and one fetch projection, no DOM and no server:
 *
 *   - `resultsLinkUrl` — the one spelling of what a minted link points at, built
 *     by the presenter surface and parsed by `App.tsx`. Its fragment is the
 *     whole reason the secret stays out of server logs, so it is asserted rather
 *     than assumed.
 *   - `resultsLinkView` — what the organizer's dialog can offer. The state that
 *     matters is the one nobody expects: a link that is active but not held
 *     *here*, which cannot be copied and can only be replaced.
 *   - `readSharedResultsFailure` — the read-only page's distinction between a
 *     revoked link and a deck that is simply not publishing, which is the
 *     difference between "ask for a new link" and "there is nothing to see".
 *   - `api.getSharedResults` — the whole-deck projection, which must read a
 *     withheld entry back as `null` exactly as `getAllResults` does.
 *
 * What the token actually buys is a claim about the server and is tested there,
 * over HTTP, in `server/results-link.integration.test.ts`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { api, RESULTS_LINK_FRAGMENT, resultsLinkUrl } from "./api";
import {
	resultsLinkIssuedLabel,
	resultsLinkView,
} from "./components/ResultsLinkDialog";
import { readSharedResultsFailure } from "./pages/SharedResultsPage";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("resultsLinkUrl — where a minted link points", () => {
	test("carries the token in the fragment, not the query", () => {
		const url = resultsLinkUrl("https://omul.example", "pres-1", "tok-1");
		expect(url).toBe(
			`https://omul.example/results/pres-1#${RESULTS_LINK_FRAGMENT}=tok-1`,
		);
		// The fragment is never sent to the server, which is what keeps the secret
		// out of access logs, proxy logs and the `Referer` of anything the page
		// links to. A query parameter would put it in all three.
		expect(new URL(url).search).toBe("");
		expect(new URL(url).pathname).toBe("/results/pres-1");
	});

	test("escapes a token that would otherwise change the fragment's meaning", () => {
		const url = resultsLinkUrl("https://omul.example", "pres-1", "a&b=c d");
		expect(url).toContain("a%26b%3Dc%20d");
		expect(
			new URLSearchParams(new URL(url).hash.slice(1)).get(RESULTS_LINK_FRAGMENT),
		).toBe("a&b=c d");
	});
});

describe("resultsLinkView — what the organizer's browser can offer", () => {
	const origin = "https://omul.example";

	test("no link at all", () => {
		expect(resultsLinkView(null, null, origin, "pres-1")).toEqual({
			kind: "none",
		});
		expect(
			resultsLinkView(
				{ active: false, issuedAt: null, resultsToken: null },
				{ token: "stale", issuedAt: "2026-01-01T00:00:00.000Z" },
				origin,
				"pres-1",
			),
		).toEqual({ kind: "none" });
	});

	test("a link this browser holds is one it can copy", () => {
		const issuedAt = "2026-08-11T09:00:00.000Z";
		expect(
			resultsLinkView(
				{ active: true, issuedAt, resultsToken: null },
				{ token: "tok-1", issuedAt },
				origin,
				"pres-1",
			),
		).toEqual({
			kind: "held",
			url: resultsLinkUrl(origin, "pres-1", "tok-1"),
			issuedAt,
		});
	});

	test("a link minted elsewhere cannot be copied, only replaced", () => {
		// The secret is stored hashed, so nothing can hand it back. The dialog has
		// to say so, or an organizer clicks Copy and quietly replaces a link they
		// had already sent to somebody.
		const issuedAt = "2026-08-11T09:00:00.000Z";
		expect(
			resultsLinkView(
				{ active: true, issuedAt, resultsToken: null },
				null,
				origin,
				"pres-1",
			),
		).toEqual({ kind: "elsewhere", issuedAt });
	});

	test("a held token from an older mint is not the current link", () => {
		// `issuedAt` is the discriminator: two browsers can both hold a token and
		// only one of them holds the one the server would still answer.
		expect(
			resultsLinkView(
				{
					active: true,
					issuedAt: "2026-08-11T10:00:00.000Z",
					resultsToken: null,
				},
				{ token: "older", issuedAt: "2026-08-11T09:00:00.000Z" },
				origin,
				"pres-1",
			),
		).toEqual({ kind: "elsewhere", issuedAt: "2026-08-11T10:00:00.000Z" });
	});

	test("a token accepted from a link is never offered for copying", () => {
		// `acceptResultsLinkToken()` stamps `""`, because a recipient has no status
		// endpoint to learn the real instant from. An unstamped token must not read
		// as "matches whatever the server says" — an empty stamp is the absence of
		// a claim, not agreement with one.
		expect(
			resultsLinkView(
				{
					active: true,
					issuedAt: "2026-08-11T10:00:00.000Z",
					resultsToken: null,
				},
				{ token: "from-a-link", issuedAt: "" },
				origin,
				"pres-1",
			),
		).toEqual({ kind: "elsewhere", issuedAt: "2026-08-11T10:00:00.000Z" });
	});

	test("the organizer who opened their own link is not shown a retired token", () => {
		// The whole scenario, in the order it happens. Browser A mints and can copy.
		// Its organizer then opens that link in the same browser to see what a
		// recipient sees, which overwrites the stamp with `""`. Browser B re-mints.
		// Back in A, the server now reports the *new* mint — and A still holds the
		// old secret. Offering Copy here would label a dead token with a live link's
		// mint time and send somebody a URL that answers 401.
		const firstMint = "2026-08-11T09:00:00.000Z";
		const active = {
			active: true,
			issuedAt: firstMint,
			resultsToken: null,
		} as const;

		const afterMinting = resultsLinkView(
			active,
			{ token: "tok-A", issuedAt: firstMint },
			origin,
			"pres-1",
		);
		expect(afterMinting.kind).toBe("held");

		// Same token, stamp flattened by having accepted the link locally, and the
		// server has moved on.
		const afterReMintElsewhere = resultsLinkView(
			{ ...active, issuedAt: "2026-08-11T11:00:00.000Z" },
			{ token: "tok-A", issuedAt: "" },
			origin,
			"pres-1",
		);
		expect(afterReMintElsewhere).toEqual({
			kind: "elsewhere",
			issuedAt: "2026-08-11T11:00:00.000Z",
		});
		expect(afterReMintElsewhere).not.toHaveProperty("url");
	});
});

describe("resultsLinkIssuedLabel", () => {
	test("an unusable instant reads as one, never as a date", () => {
		// A minting time nobody recorded and one that will not parse are the same
		// news; inventing "1 Jan 1970" out of either would be worse than saying so.
		expect(resultsLinkIssuedLabel(null)).toBe(
			"Active — minted at an unrecorded time.",
		);
		expect(resultsLinkIssuedLabel("not-a-date")).toBe(
			"Active — minted at an unrecorded time.",
		);
	});

	test("a real instant is named", () => {
		expect(resultsLinkIssuedLabel("2026-08-11T09:00:00.000Z")).toStartWith(
			"Active since ",
		);
	});
});

describe("readSharedResultsFailure — why a results page is empty", () => {
	test("a refused link is told apart from everything else", () => {
		expect(
			readSharedResultsFailure(new Error("This results link is no longer valid")),
		).toEqual({ kind: "revoked" });
		expect(readSharedResultsFailure(new Error("Not found"))).toEqual({
			kind: "missing",
		});
		expect(readSharedResultsFailure(new Error("Failed to fetch"))).toEqual({
			kind: "failed",
			message: "Failed to fetch",
		});
	});

	test("a thrown non-Error still produces a statement", () => {
		expect(readSharedResultsFailure("boom")).toEqual({
			kind: "failed",
			message: "Unknown error",
		});
	});
});

describe("api.getSharedResults — the read-only page's one call", () => {
	test("reads withheld entries back as null and keeps the published ones", async () => {
		// The same projection `getAllResults` applies, because it is the same
		// function — a page whose renderer met `{ withheld: true }` would draw
		// "0 of 0 answered" under a question the room has answered.
		globalThis.fetch = (async (_input: RequestInfo | URL) =>
			new Response(
				JSON.stringify([
					{ slideId: "open", question: "Open one", type: "scale", totalVotes: 4 },
					{ slideId: "shut", question: "Shut one", type: "quiz", withheld: true },
				]),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as typeof fetch;

		const rows = await api.getSharedResults("pres-1");
		expect(rows).toEqual([
			{
				slideId: "open",
				question: "Open one",
				results: { type: "scale", totalVotes: 4 },
			},
			{ slideId: "shut", question: "Shut one", results: null },
		]);
	});

	test("a refusal surfaces as the error the page reads", async () => {
		globalThis.fetch = (async (_input: RequestInfo | URL) =>
			new Response(
				JSON.stringify({ error: "This results link is no longer valid" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			)) as typeof fetch;

		expect(api.getSharedResults("pres-1")).rejects.toThrow(
			"This results link is no longer valid",
		);
	});
});
