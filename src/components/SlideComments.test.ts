/**
 * Unit tests for the slide-comment panel's client half (REQ074).
 *
 * The panel renders a list and a box; what is worth asserting here is the four
 * pure answers every surface that draws a thread asks it for:
 *
 *   - **Which comments belong to the slide on screen** — one read site, so the
 *     count on the presenter's chip and the thread under it cannot disagree.
 *   - **What an author is called**, including the two cases nobody authors: the
 *     reader's own comments, and a comment whose account has since been deleted.
 *   - **What the closed strip says** with a thread and without one (ADR-0025 —
 *     the affordance stays in place when there is nothing in it).
 *   - **Whether the composer is live, and why not when it is not.** The `view`
 *     case is the level distinction REQ075 reserved the vocabulary for; the
 *     `error` case is why a browser holding the deck's edit link but no account
 *     is told to sign in rather than shown a live box that would 401.
 *   - **That a half-written comment stays on the slide it was written about**
 *     (REQ160) — the composer keeps no loose draft string for a slide change to
 *     carry onto the next slide's thread.
 *
 * Nothing here is a privacy boundary and none of it is asserted as one: a
 * comment reaches this module only when the server sent it, and the server sends
 * one only to an account with standing on the deck. That rule is pinned down in
 * `server/slide-comments.integration.test.ts`, where it can actually fail.
 */

import { describe, expect, test } from "bun:test";
import type { SlideComment } from "../types";
import {
	slideCommentAuthorLabel,
	slideCommentComposerState,
	slideCommentDraftFor,
	slideCommentStripLabel,
	slideCommentTimeLabel,
	slideCommentsFor,
	withSlideCommentDraft,
} from "./SlideComments";

function comment(overrides: Partial<SlideComment> = {}): SlideComment {
	return {
		id: "c1",
		slideId: "s1",
		body: "Looks good",
		authorName: "Collaborator",
		mine: false,
		createdAt: "2026-01-01T09:00:00.000Z",
		...overrides,
	};
}

describe("slideCommentsFor — the thread on one slide", () => {
	const deck = [
		comment({ id: "a", slideId: "s1" }),
		comment({ id: "b", slideId: "s2" }),
		comment({ id: "c", slideId: "s1" }),
	];

	test("keeps the deck's order within the slide it filters to", () => {
		expect(slideCommentsFor(deck, "s1").map((one) => one.id)).toEqual(["a", "c"]);
		expect(slideCommentsFor(deck, "s2").map((one) => one.id)).toEqual(["b"]);
	});

	test("a slide with no thread, and no slide at all, are both empty", () => {
		expect(slideCommentsFor(deck, "s3")).toEqual([]);
		// The editor holds no slide while the deck-settings panel is open.
		expect(slideCommentsFor(deck, null)).toEqual([]);
	});
});

describe("slideCommentAuthorLabel — who said it", () => {
	test("the reader's own comments are theirs, by name", () => {
		expect(slideCommentAuthorLabel(comment({ mine: true }))).toBe("You");
		// Even when the account carries a name — "You" is what a reader looks for.
		expect(
			slideCommentAuthorLabel(comment({ mine: true, authorName: "Owner" })),
		).toBe("You");
	});

	test("somebody else is named", () => {
		expect(slideCommentAuthorLabel(comment({ authorName: "Reviewer" }))).toBe(
			"Reviewer",
		);
	});

	test("an account that is gone is said rather than papered over", () => {
		// A deleted account leaves its comments standing (the server keeps the row
		// and sends a null name), so the line has to be attributable to *something*
		// — a reply answering nothing is worse than an unnamed line.
		expect(slideCommentAuthorLabel(comment({ authorName: null }))).toBe(
			"Deleted account",
		);
		expect(slideCommentAuthorLabel(comment({ authorName: "   " }))).toBe(
			"Deleted account",
		);
	});
});

describe("slideCommentStripLabel — what the closed strip says", () => {
	test("counts, singular and plural", () => {
		expect(slideCommentStripLabel(1)).toBe("1 comment");
		expect(slideCommentStripLabel(4)).toBe("4 comments");
	});

	test("an empty thread invites in the same place rather than disappearing", () => {
		expect(slideCommentStripLabel(0)).toBe("No comments on this slide yet");
	});
});

describe("slideCommentTimeLabel — when it was written", () => {
	test("an unstamped row draws no time rather than an invalid one", () => {
		expect(slideCommentTimeLabel("")).toBe("");
		expect(slideCommentTimeLabel("not a date")).toBe("");
	});

	test("a real stamp reads as something", () => {
		expect(slideCommentTimeLabel("2026-01-01T09:00:00.000Z").length).toBeGreaterThan(
			0,
		);
	});
});

describe("slideCommentComposerState — whether the box is live (ADR-0025)", () => {
	test("`comment` and `edit` write; the owner is `edit` by construction", () => {
		for (const accessLevel of ["comment", "edit"] as const) {
			expect(slideCommentComposerState({ accessLevel, error: null })).toEqual({
				enabled: true,
				reason: "",
			});
		}
	});

	test("`view` reads and is told what it would take to write", () => {
		const state = slideCommentComposerState({ accessLevel: "view", error: null });
		expect(state.enabled).toBe(false);
		expect(state.reason).toContain("comment access");
	});

	test("no standing at all is refused, and says so", () => {
		for (const accessLevel of [null, undefined]) {
			expect(
				slideCommentComposerState({ accessLevel, error: null }).enabled,
			).toBe(false);
		}
	});

	test("the server's own refusal wins over any level a client resolved", () => {
		// The case this rule exists for: a browser holding the deck's edit link is
		// reported `edit` — it can run the whole deck — and has no account, so the
		// comment routes refuse it. Reading the level alone would draw a live box
		// that answers 401 on the first keystroke sent.
		const state = slideCommentComposerState({
			accessLevel: "edit",
			error: "Sign in to read this deck's comments",
		});
		expect(state.enabled).toBe(false);
		expect(state.reason).toBe("Sign in to read this deck's comments");
	});
});

describe("the draft belongs to its slide (REQ160)", () => {
	test("what was typed about one slide is not offered on the next", () => {
		// The defect this exists for: the author selects slide 3, opens the strip,
		// types, clicks slide 4 in the rail and presses Comment. Held as one loose
		// string the words survive the slide change and land on slide 4's thread —
		// which is why the composer reads its body *by slide*, and finds none.
		const drafts = withSlideCommentDraft({}, "s3", "this chart is misleading");
		expect(slideCommentDraftFor(drafts, "s3")).toBe("this chart is misleading");
		expect(slideCommentDraftFor(drafts, "s4")).toBe("");
	});

	test("and is still there on the way back — nothing is silently dropped", () => {
		// The other half of the choice: a stray click on the rail must not destroy
		// a sentence somebody was still writing, so paging away parks the draft
		// rather than discarding it, and paging back restores it in place.
		const drafts = withSlideCommentDraft({}, "s3", "this chart is misleading");
		expect(slideCommentDraftFor(drafts, "s4")).toBe("");
		expect(slideCommentDraftFor(drafts, "s3")).toBe("this chart is misleading");
	});

	test("two slides are written on at once without either reading the other", () => {
		let drafts = withSlideCommentDraft({}, "s3", "this chart is misleading");
		drafts = withSlideCommentDraft(drafts, "s4", "this one is fine");
		expect(slideCommentDraftFor(drafts, "s3")).toBe("this chart is misleading");
		expect(slideCommentDraftFor(drafts, "s4")).toBe("this one is fine");
	});

	test("a posted comment clears its own slide's draft and no other", () => {
		// What `submit` does on the way out, addressed with the slide the body was
		// typed on rather than whichever one is on screen when the post comes back:
		// a slow write must not empty the box the author has since moved to.
		let drafts = withSlideCommentDraft({}, "s3", "this chart is misleading");
		drafts = withSlideCommentDraft(drafts, "s4", "this one is fine");
		drafts = withSlideCommentDraft(drafts, "s3", "");
		expect(slideCommentDraftFor(drafts, "s3")).toBe("");
		expect(slideCommentDraftFor(drafts, "s4")).toBe("this one is fine");
		// Emptied rather than parked: the map holds only what is half-written.
		expect(Object.keys(drafts)).toEqual(["s4"]);
	});

	test("no slide holds no draft, and taking one is a no-op", () => {
		// The editor is in this state while the deck-settings panel has the rail,
		// and the presenter's is before the room's first slide resolves.
		expect(slideCommentDraftFor({}, null)).toBe("");
		expect(slideCommentDraftFor({ s3: "kept" }, null)).toBe("");
		expect(withSlideCommentDraft({ s3: "kept" }, null, "stray")).toEqual({
			s3: "kept",
		});
	});

	test("the drafts it is handed are never mutated in place", () => {
		// React reads state by identity; writing through the old map would leave a
		// composer drawing a body it no longer holds.
		const before = withSlideCommentDraft({}, "s3", "this chart is misleading");
		const after = withSlideCommentDraft(before, "s3", "this chart misleads");
		expect(before.s3).toBe("this chart is misleading");
		expect(after.s3).toBe("this chart misleads");
		expect(after).not.toBe(before);
	});
});
