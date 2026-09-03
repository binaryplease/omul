/**
 * Unit tests for the shareable results link's shared vocabulary (REQ098).
 *
 * Three things, and no DB or network between them:
 *   - `tallyVisibleToCaller` — the one gate that composes the deck's reveal mode
 *     with the two credentials a results read can carry. The link lifts that
 *     gate and only that gate.
 *   - The stored fields — a deck written before the link existed re-parses
 *     forward onto "no link", and neither the hash nor the instant
 *     can reach a client through `PresentationSchema`.
 *   - `resultsLinkStatus` — what an organizer reads about their own link, and
 *     the explicit `null` that says the secret is not in this payload.
 *
 * The round trip over HTTP — who is refused, and what a revoke actually costs a
 * link already in someone's hands — is `results-link.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	PresentationSchema,
	RESULTS_TOKEN_HEADER,
	ResultsLinkSchema,
	SlideSchema,
	StoredPresentationSchema,
	tallyVisibleToAudience,
	tallyVisibleToCaller,
} from "./schemas";
import { authorizeResultsLink, resultsLinkStatus } from "./services/presentations";

/** A question slide, optionally carrying its own override of the deck mode. */
function questionSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "q1",
		type: "multiple-choice",
		question: "Pick",
		options: [
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
		],
		...overrides,
	});
}

describe("tallyVisibleToCaller — who reads a tally (REQ098)", () => {
	test("a results link reads every mode, exactly as an editor does", () => {
		const slide = questionSlide();
		for (const mode of ["instant", "on-click", "private"] as const) {
			const deck = { resultsVisibility: mode };
			expect(tallyVisibleToCaller(slide, deck, { hasResultsLink: true })).toBe(
				true,
			);
			expect(tallyVisibleToCaller(slide, deck, { canEdit: true })).toBe(true);
		}
	});

	test("a caller with neither credential still meets the reveal mode", () => {
		const slide = questionSlide();
		// The public read is unchanged by this slice: it is the audience gate,
		// answered by the audience function, and the composition adds nothing to it.
		for (const mode of ["instant", "on-click", "private"] as const) {
			const deck = { resultsVisibility: mode };
			expect(tallyVisibleToCaller(slide, deck, {})).toBe(
				tallyVisibleToAudience(slide, deck),
			);
		}
	});

	test("an unstated caller is the withholding one", () => {
		// The default has to be the one that publishes nothing, because the
		// broadcast path reaches a whole room and says who it is by omission.
		const slide = questionSlide();
		expect(tallyVisibleToCaller(slide, { resultsVisibility: "private" }, {})).toBe(
			false,
		);
		expect(
			tallyVisibleToCaller(
				slide,
				{ resultsVisibility: "private" },
				{ canEdit: false, hasResultsLink: false },
			),
		).toBe(false);
	});

	test("a per-slide override is still what the mode resolves to", () => {
		// The link lifts the gate; it does not re-resolve which gate applies. A
		// slide pinned to `private` inside an `instant` deck is withheld from the
		// room and read by the link holder — the same two answers as everywhere.
		const slide = questionSlide({ resultsVisibility: "private" });
		const deck = { resultsVisibility: "instant" as const };
		expect(tallyVisibleToCaller(slide, deck, {})).toBe(false);
		expect(tallyVisibleToCaller(slide, deck, { hasResultsLink: true })).toBe(true);
	});
});

describe("the stored link fields (REQ098)", () => {
	test("a deck written before the link existed re-parses onto no link", () => {
		const legacy = StoredPresentationSchema.parse({
			id: "pres-1",
			code: "123456",
			title: "Old deck",
		});
		expect(legacy.resultsTokenHash).toBe(null);
		expect(legacy.resultsTokenIssuedAt).toBe(null);
	});

	test("neither field can reach a client", () => {
		// The same construction that keeps `creatorTokenHash` in: the public schema
		// does not declare them, and Zod drops what it does not declare.
		const projected = PresentationSchema.parse({
			id: "pres-1",
			code: "123456",
			title: "Deck",
			slides: [],
			createdAt: new Date(0).toISOString(),
			resultsTokenHash: "not-a-real-hash",
			resultsTokenIssuedAt: "2026-01-01T00:00:00.000Z",
			creatorTokenHash: "also-not-real",
		}) as Record<string, unknown>;
		expect(projected.resultsTokenHash).toBeUndefined();
		expect(projected.resultsTokenIssuedAt).toBeUndefined();
		expect(projected.creatorTokenHash).toBeUndefined();
	});
});

describe("resultsLinkStatus — what an organizer reads", () => {
	test("a deck with no link says so, with every key present", () => {
		const status = resultsLinkStatus({});
		expect(status).toEqual({ active: false, issuedAt: null, resultsToken: null });
		// The wire shape is declared, not improvised.
		expect(ResultsLinkSchema.parse(status)).toEqual(status);
	});

	test("a deck with a link reports it without being able to report the secret", () => {
		const status = resultsLinkStatus({
			resultsTokenHash: "deadbeef",
			resultsTokenIssuedAt: "2026-08-11T09:00:00.000Z",
		});
		expect(status.active).toBe(true);
		expect(status.issuedAt).toBe("2026-08-11T09:00:00.000Z");
		// Only the hash is stored, so no read after the mint can produce the token.
		// Emitted as an explicit null rather than dropped.
		expect(status.resultsToken).toBe(null);
	});
});

describe("authorizeResultsLink — reading the credential off a request", () => {
	const headersWith = (token: string) =>
		new Headers({ [RESULTS_TOKEN_HEADER]: token });

	test("no header is no claim at all", () => {
		expect(authorizeResultsLink({ resultsTokenHash: "x" }, new Headers())).toEqual({
			presented: false,
			valid: false,
		});
	});

	test("a deck with no link grants nothing to anybody", () => {
		// Deliberately unlike `authorizeEdit`, which grandfathers a pre-auth deck:
		// this capability never existed before it was stored, so there is no deck it
		// can be owed to.
		expect(authorizeResultsLink({}, headersWith("anything"))).toEqual({
			presented: true,
			valid: false,
		});
	});

	test("a token that does not match is presented and refused, not ignored", () => {
		const refused = authorizeResultsLink(
			{ resultsTokenHash: "not-the-hash-of-this" },
			headersWith("some-token"),
		);
		// The distinction is what lets the route answer 401 rather than silently
		// demoting a revoked link to the public read.
		expect(refused).toEqual({ presented: true, valid: false });
	});

	test("the Authorization slot is not a second door to this capability", () => {
		// An edit token and a results token authorize different things; a server
		// that read one out of the other's slot would decide which it held by
		// trying both.
		const viaBearer = new Headers({ Authorization: "Bearer some-token" });
		expect(
			authorizeResultsLink({ resultsTokenHash: "x" }, viaBearer),
		).toEqual({ presented: false, valid: false });
	});
});
