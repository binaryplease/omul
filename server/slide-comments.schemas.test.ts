/**
 * Unit tests for slide comments' shared vocabulary (REQ074).
 *
 * Four things, and no DB or network between them:
 *   - `canReadDeckComments` / `canWriteDeckComments` — the two halves of who a
 *     thread belongs to. The second is the first thing in this codebase that
 *     tells `view` and `comment` apart, which is the whole reason REQ075 kept
 *     the middle level empty.
 *   - The stored comment — its identity triple carries no default
 *     while the rest does.
 *   - The wire shape — `SlideCommentSchema` declares neither `authorId` nor an
 *     email, so neither can reach a client by being spread into a response; the
 *     same construction that keeps `creatorId` off `PresentationSchema` and
 *     `userId` off a grant.
 *   - The request body — a comment of nothing but whitespace is malformed, not
 *     an empty line in somebody's thread.
 *
 * The round trip over HTTP — who is refused what, and the assertion that no
 * participant-facing payload carries a comment — is
 * `slide-comments.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	canReadDeckComments,
	canWriteDeckComments,
	DECK_ACCESS_LEVELS,
	PostSlideCommentSchema,
	SLIDE_COMMENT_MAX_LENGTH,
	SlideCommentSchema,
	StoredSlideCommentSchema,
} from "./schemas";

describe("who a deck's comment threads belong to (REQ074)", () => {
	test("every level reads them — a grant is standing on the deck", () => {
		for (const level of DECK_ACCESS_LEVELS) {
			expect(canReadDeckComments(level)).toBe(true);
		}
	});

	test("writing starts at `comment` — the level's first consumer", () => {
		expect(canWriteDeckComments("edit")).toBe(true);
		expect(canWriteDeckComments("comment")).toBe(true);
		// The distinction REQ075 reserved the vocabulary for: someone shown the
		// deck, versus someone asked what they think of it.
		expect(canWriteDeckComments("view")).toBe(false);
	});

	test("no standing at all is the withholding answer on both halves", () => {
		// What every participant, every stranger, every anonymous caller and every
		// holder of the deck's edit token resolves to.
		expect(canReadDeckComments(null)).toBe(false);
		expect(canWriteDeckComments(null)).toBe(false);
	});
});

describe("the stored comment", () => {
	const identity = { id: "c1", presentationId: "p1", slideId: "s1", authorId: "u1" };

	test("the identity triple has no default and fails loudly", () => {
		for (const missing of ["presentationId", "slideId", "authorId"] as const) {
			const partial: Record<string, unknown> = { ...identity };
			delete partial[missing];
			expect(() => StoredSlideCommentSchema.parse(partial)).toThrow();
		}
	});

	test("a comment written before a field existed re-parses forward", () => {
		const stored = StoredSlideCommentSchema.parse(identity);
		expect(stored.body).toBe("");
		expect(stored.createdAt).toBe("");
	});
});

describe("the wire shape an account on the deck reads", () => {
	test("the author id is dropped by construction, not by a list", () => {
		const wire = SlideCommentSchema.parse({
			id: "c1",
			presentationId: "p1",
			authorId: "u1",
			// An email cannot travel here even when one is handed in: a thread is
			// read by every account on the deck, and who else is on it is not a
			// collaborator's to enumerate (REQ075).
			authorEmail: "collaborator@example.com",
			slideId: "s1",
			body: "The second option reads ambiguously",
			authorName: "Collaborator",
			mine: false,
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(wire).not.toHaveProperty("authorId");
		expect(wire).not.toHaveProperty("presentationId");
		expect(wire).not.toHaveProperty("authorEmail");
		expect(wire.body).toBe("The second option reads ambiguously");
		expect(wire.slideId).toBe("s1");
	});

	test("a deleted account's comment keeps every key rather than losing them", () => {
		const wire = SlideCommentSchema.parse({ id: "c1" });
		expect(wire.authorName).toBeNull();
		expect(wire.body).toBe("");
		expect(wire.slideId).toBe("");
		// The withholding value: a comment nobody proved is theirs is not theirs.
		expect(wire.mine).toBe(false);
	});
});

describe("the request body", () => {
	test("a comment is trimmed, and whitespace alone is not one", () => {
		expect(
			PostSlideCommentSchema.parse({ slideId: "s1", body: "  looks good  " })
				.body,
		).toBe("looks good");
		expect(() =>
			PostSlideCommentSchema.parse({ slideId: "s1", body: "   " }),
		).toThrow();
		expect(() =>
			PostSlideCommentSchema.parse({ slideId: "s1", body: "" }),
		).toThrow();
	});

	test("a comment is anchored to a slide, and neither field defaults", () => {
		expect(() => PostSlideCommentSchema.parse({ body: "orphan" })).toThrow();
		expect(() =>
			PostSlideCommentSchema.parse({ slideId: "", body: "orphan" }),
		).toThrow();
		expect(() => PostSlideCommentSchema.parse({ slideId: "s1" })).toThrow();
	});

	test("a comment past the cap is refused rather than truncated", () => {
		const atCap = "x".repeat(SLIDE_COMMENT_MAX_LENGTH);
		expect(
			PostSlideCommentSchema.parse({ slideId: "s1", body: atCap }).body.length,
		).toBe(SLIDE_COMMENT_MAX_LENGTH);
		expect(() =>
			PostSlideCommentSchema.parse({ slideId: "s1", body: `${atCap}x` }),
		).toThrow();
	});
});
