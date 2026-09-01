/**
 * How a per-deck credential is read off a request.
 *
 * Two of them ride their own headers — the edit token and the results-link
 * token — and each is a different capability, which is why they have a header
 * each rather than sharing the `Authorization` slot: a server that read one out
 * of the other's slot would be deciding which it held by trying both.
 *
 * The property held here is that a header is only *where* a token was put and
 * never *what* it proves. Reading is one rule for both — a present-but-blank
 * header is no claim, and no claim must not shadow the fallback behind it — and
 * whatever is found is checked against the deck's stored hash by the same code.
 */

import { describe, expect, test } from "bun:test";
import { EDIT_TOKEN_HEADER, RESULTS_TOKEN_HEADER } from "./schemas";
import {
	authorizeResultsLink,
	editTokenFromHeaders,
} from "./services/presentations";

/** The stored hash of `token`, the way the deck stores it. */
function hashOf(token: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(token);
	return hasher.digest("hex");
}

describe("the header names themselves", () => {
	test("both carry the product's name and are kept apart", () => {
		expect(EDIT_TOKEN_HEADER).toBe("x-omul-edit-token");
		expect(RESULTS_TOKEN_HEADER).toBe("x-omul-results-token");
		expect(EDIT_TOKEN_HEADER).not.toBe(RESULTS_TOKEN_HEADER);
	});
});

describe("editTokenFromHeaders", () => {
	test("reads the dedicated header", () => {
		const headers = new Headers({ [EDIT_TOKEN_HEADER]: "tok-1" });
		expect(editTokenFromHeaders(headers)).toBe("tok-1");
	});

	test("the `Authorization: Bearer` slot the web UI uses is read too", () => {
		const headers = new Headers({ authorization: "Bearer tok-1" });
		expect(editTokenFromHeaders(headers)).toBe("tok-1");
	});

	test("the dedicated header wins over the Bearer slot", () => {
		const headers = new Headers({
			[EDIT_TOKEN_HEADER]: "dedicated",
			authorization: "Bearer bearer",
		});
		expect(editTokenFromHeaders(headers)).toBe("dedicated");
	});

	test("a blank header is no claim, exactly as an absent one is", () => {
		expect(
			editTokenFromHeaders(new Headers({ [EDIT_TOKEN_HEADER]: "  " })),
		).toBeNull();
		expect(editTokenFromHeaders(new Headers())).toBeNull();
	});

	test("a blank header does not shadow a stated Bearer token", () => {
		// A header that is present but blank is no claim, so it must not suppress
		// the fallback either — a proxy or client that always sets the header,
		// empty when it has nothing, would otherwise silently demote a caller that
		// did state its token to a 401.
		const headers = new Headers({
			[EDIT_TOKEN_HEADER]: "",
			authorization: "Bearer tok-1",
		});
		expect(editTokenFromHeaders(headers)).toBe("tok-1");
	});
});

describe("authorizeResultsLink reads its own header on the same rule", () => {
	const stored = { resultsTokenHash: hashOf("res-1") };

	test("the right token is accepted", () => {
		expect(
			authorizeResultsLink(stored, new Headers({ [RESULTS_TOKEN_HEADER]: "res-1" })),
		).toEqual({ presented: true, valid: true });
	});

	test("a wrong token is refused", () => {
		expect(
			authorizeResultsLink(stored, new Headers({ [RESULTS_TOKEN_HEADER]: "wrong" })),
		).toEqual({ presented: true, valid: false });
	});

	test("a blank header is no claim", () => {
		expect(
			authorizeResultsLink(stored, new Headers({ [RESULTS_TOKEN_HEADER]: "   " })),
		).toEqual({ presented: false, valid: false });
	});

	test("a revoked link stays revoked", () => {
		// Revoking is clearing the hash. A presented token against no hash has to
		// be refused rather than falling through to the public read, or a retired
		// link would quietly keep working for anyone who had not reloaded.
		expect(
			authorizeResultsLink(
				{ resultsTokenHash: null },
				new Headers({ [RESULTS_TOKEN_HEADER]: "res-1" }),
			),
		).toEqual({ presented: true, valid: false });
	});
});
