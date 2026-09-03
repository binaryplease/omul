/**
 * Unit tests for the presenter-notes panel's client half (REQ090).
 *
 * The panel itself renders markdown through `SlideText`, which is pinned down
 * by its own suite; what is worth asserting here is the two pure answers every
 * presenter surface asks it for, plus the one property that keeps the client
 * honest about what it is *not* doing:
 *
 *   - **What counts as "this slide has notes"** — one read site, so the live
 *     presenter's toggle and the dry run's panel cannot disagree about a field
 *     holding nothing but whitespace.
 *   - **What the toggle says in each of its states** (it is disabled
 *     with its reason rather than hidden, so every state has to name one).
 *   - **That the client withholds nothing.** A note reaches this module only
 *     when the server sent it, and the server sends it only to a caller that can
 *     edit the deck. A panel that filtered notes itself would be a second,
 *     weaker copy of a rule already settled on the wire — so the read site is
 *     deliberately unconditional, and this pins that down.
 */

import { describe, expect, test } from "bun:test";
import {
	hasPresenterNotes,
	PRESENTER_NOTES_PRIVACY_LABEL,
	presenterNotesFor,
	presenterNotesStripLabel,
	presenterNotesSummary,
	presenterNotesToggleLabel,
} from "./PresenterNotes";

describe("presenterNotesFor — the single read site (REQ090)", () => {
	test("gives back what the author wrote, trimmed", () => {
		expect(presenterNotesFor({ notes: "  Pause here.  " })).toBe("Pause here.");
	});

	test("a slide with no notes, or a field of whitespace, reads empty", () => {
		expect(presenterNotesFor({ notes: "" })).toBe("");
		expect(presenterNotesFor({ notes: "   \n\t " })).toBe("");
		// A half-built slide in the editor, and a hand-built deck, both omit it.
		expect(presenterNotesFor({})).toBe("");
	});

	test("hasPresenterNotes agrees with it, whitespace included", () => {
		expect(hasPresenterNotes({ notes: "Cue" })).toBe(true);
		expect(hasPresenterNotes({ notes: "   " })).toBe(false);
		expect(hasPresenterNotes({})).toBe(false);
	});

	test("the read site does not decide who may see a note", () => {
		// Deliberately unconditional: withholding happens on the wire, and a
		// second rule here would be one more place for the two to drift apart.
		expect(presenterNotesFor({ notes: "Secret cue" })).toBe("Secret cue");
	});
});

describe("presenterNotesToggleLabel — every state names itself", () => {
	test("a viewer who does not hold the deck is told why, not shown nothing", () => {
		const label = presenterNotesToggleLabel({
			canRead: false,
			open: false,
			hasNotes: true,
		});
		// Names the standing, not the token: the token is one of two ways to have
		// it (REQ149), so a label that asked for one would be wrong for the owner
		// who never held it and unhelpful to the viewer who cannot get one.
		expect(label).toContain("edit access");
	});

	test("an open panel offers to close itself", () => {
		expect(
			presenterNotesToggleLabel({ canRead: true, open: true, hasNotes: true }),
		).toBe("Hide presenter notes");
	});

	test("a slide with no notes says so before it is opened", () => {
		expect(
			presenterNotesToggleLabel({ canRead: true, open: false, hasNotes: false }),
		).toContain("none yet");
	});

	test("every state produces a non-empty accessible name", () => {
		for (const canRead of [true, false]) {
			for (const open of [true, false]) {
				for (const hasNotes of [true, false]) {
					const label = presenterNotesToggleLabel({ canRead, open, hasNotes });
					expect(label.length).toBeGreaterThan(0);
					expect(label).toContain("presenter notes");
				}
			}
		}
	});
});

describe("the strip under the canvas (REQ156)", () => {
	test("a note collapses to its words, not to the stars it was typed with", () => {
		expect(
			presenterNotesSummary({ notes: "**Slow down** here\n\n- breathe\n- ask" }),
		).toBe("Slow down here breathe ask");
	});

	test("a slide with no note has no summary to show", () => {
		expect(presenterNotesSummary({ notes: "   " })).toBe("");
		expect(presenterNotesSummary({})).toBe("");
	});

	test("an empty strip invites in the same position rather than disappearing", () => {
		// The affordance must not vanish with its content — a control an author
		// finds once and never again is one they stop looking for.
		expect(presenterNotesStripLabel({})).toBe("Add presenter notes…");
		expect(presenterNotesStripLabel({ notes: "Pause here." })).toBe("Pause here.");
	});

	test("the privacy marker is one word about a fact the wire already keeps", () => {
		expect(PRESENTER_NOTES_PRIVACY_LABEL).toBe("Only you");
	});
});
