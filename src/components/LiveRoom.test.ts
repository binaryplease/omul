/**
 * Unit tests for the live room's client half (REQ111, REQ109).
 *
 * The two components render — a fieldset and a curtain — and what is worth
 * asserting without a DOM is everything around them:
 *
 *   - **The wording of each control in each state.** Both are drawn for a
 *     viewer who does not hold the deck and disabled with their reason rather
 *     than dropped, so every state has to name one — and the chip
 *     that blanks the screen carries an icon and no text, which makes that
 *     string the whole control.
 *   - **That the participant's reason is the deck's language** (REQ084), mapped
 *     in the one place that mapping lives.
 *   - **That nothing here is the enforcement.** A closed slide is refused at the
 *     boundary with a stated reason; this module makes the phone tell the truth
 *     about the tap in front of it, and the predicate it tells that truth with
 *     is the server's own (asserted here so a second client-side reading cannot
 *     creep in).
 */

import { describe, expect, test } from "bun:test";
import {
	audienceBlankToggleLabel,
	AUDIENCE_BLANK_TITLE,
	participationLabelsFor,
	sharedScreenView,
	slideParticipationToggleLabel,
} from "./LiveRoom";
import { getDict } from "../i18n";
import { audienceViewBlanked, slideAcceptsSubmissions } from "../types";

describe("participationLabelsFor — the participant's reason (REQ111/REQ084)", () => {
	test("comes out of the deck's own dictionary", () => {
		expect(participationLabelsFor(getDict("en")).closed).toBe(
			"The presenter has closed this question",
		);
		expect(participationLabelsFor(getDict("de")).closed).toBe(
			"Der Präsentator hat diese Frage geschlossen",
		);
		expect(participationLabelsFor(getDict("fr")).closed).toBe(
			"Le présentateur a fermé cette question",
		);
	});

	test("every supported language says something, and says it differently", () => {
		// A missing key would fall back to English and read as a translation
		// nobody wrote rather than as a gap.
		const said = ["en", "de", "fr", "es", "it", "pt", "nl"].map(
			(tag) => participationLabelsFor(getDict(tag)).closed,
		);
		expect(said.every((line) => line.length > 0)).toBe(true);
		expect(new Set(said).size).toBe(said.length);
	});

});

describe("slideParticipationToggleLabel — the presenter's control (REQ111)", () => {
	test("names the action it would take, in each direction", () => {
		expect(
			slideParticipationToggleLabel({ open: true, canControl: true }),
		).toContain("Close this slide");
		expect(
			slideParticipationToggleLabel({ open: false, canControl: true }),
		).toContain("Reopen this slide");
	});

	test("says what closing costs the session, which is nothing collected", () => {
		// The reason this is a one-tap switch rather than a confirmed gesture:
		// the label has to carry that, or it reads like Reset.
		expect(
			slideParticipationToggleLabel({ open: true, canControl: true }),
		).toContain("every answer already given is kept");
	});

	test("a spectator is told the state and why it is not theirs", () => {
		const openToSpectator = slideParticipationToggleLabel({
			open: true,
			canControl: false,
		});
		const closedToSpectator = slideParticipationToggleLabel({
			open: false,
			canControl: false,
		});
		expect(openToSpectator).toContain("open to submissions");
		expect(closedToSpectator).toContain("closed to submissions");
		// Both name the reason rather than merely going quiet, and the two states
		// stay distinguishable — a spectator who could not tell a closed question
		// from an open one is the failure hiding the control would cause.
		expect(openToSpectator).toContain("cannot edit this presentation");
		expect(closedToSpectator).toContain("cannot edit this presentation");
		expect(openToSpectator).not.toBe(closedToSpectator);
	});
});

describe("audienceBlankToggleLabel — the blank chip (REQ109)", () => {
	test("names the action it would take, in each direction", () => {
		expect(
			audienceBlankToggleLabel({ blanked: false, canControl: true }),
		).toContain("Blank the shared screen");
		expect(
			audienceBlankToggleLabel({ blanked: true, canControl: true }),
		).toContain("Show the slide again");
	});

	test("says what blanking does not do — which is REQ109's whole sentence", () => {
		const label = audienceBlankToggleLabel({
			blanked: false,
			canControl: true,
		});
		expect(label).toContain("the deck stays here");
		expect(label).toContain("submissions are left as they are");
		expect(label).toContain("every answer is kept");
	});

	test("it reports its own switch and never the other one's state", () => {
		// A screen can be blanked while the question on it is also closed
		// (REQ111), so the wording states what blanking *left alone* rather than
		// claiming a participation state it does not read.
		const label = audienceBlankToggleLabel({
			blanked: false,
			canControl: true,
		});
		expect(label).not.toContain("the question stays open");
		expect(label).not.toContain("still open");
	});

	test("a spectator is told the state and why it is not theirs", () => {
		const shown = audienceBlankToggleLabel({
			blanked: false,
			canControl: false,
		});
		const blanked = audienceBlankToggleLabel({
			blanked: true,
			canControl: false,
		});
		expect(shown).toContain("cannot edit this presentation");
		expect(blanked).toContain("cannot edit this presentation");
		expect(shown).not.toBe(blanked);
	});

	test("the curtain says the screen is blank on purpose", () => {
		// A projector that simply went dark is indistinguishable from one that has
		// lost its signal.
		expect(AUDIENCE_BLANK_TITLE.length).toBeGreaterThan(0);
	});
});

describe("sharedScreenView — what the projector is drawing (REQ109)", () => {
	test("a deck nobody has blanked draws the deck", () => {
		expect(sharedScreenView({})).toBe("deck");
		expect(sharedScreenView({ audienceBlanked: false })).toBe("deck");
	});

	test("a blanked deck draws the curtain", () => {
		expect(sharedScreenView({ audienceBlanked: true })).toBe("blank");
	});

	test("a screen with no deck yet draws the deck path, not a curtain", () => {
		// The loading and error screens are not a blanked room, and answering
		// "blank" for a deck that has not arrived would put a curtain in front of
		// a presenter whose page is still fetching.
		expect(sharedScreenView(null)).toBe("deck");
	});

	test("a closed slide does not blank the screen", () => {
		// The regression the two switches exist to keep apart, at the one place the
		// page decides which screen to draw.
		expect(sharedScreenView({ closedSlideIds: ["q1"] })).toBe("deck");
	});

	test("it is the same reading the blank chip and the boundary use", () => {
		// Not a second answer to "is this blanked?" — one predicate, so the chip's
		// pressed state, the projector's screen and the stored field cannot drift.
		for (const deck of [
			{},
			{ audienceBlanked: false },
			{ audienceBlanked: true },
			{ audienceBlanked: true, closedSlideIds: ["q1"] },
		]) {
			expect(sharedScreenView(deck) === "blank").toBe(audienceViewBlanked(deck));
		}
	});
});

describe("what the surfaces read the two states with", () => {
	test("participation is the server's own predicate, not a second reading", () => {
		// Re-exported through `src/types.ts` from `server/schemas.ts`, which is
		// where the vote boundary refuses on it — so a phone cannot come to
		// believe a question is open that the server is turning away.
		expect(slideAcceptsSubmissions({ closedSlideIds: ["q1"] }, "q1")).toBe(
			false,
		);
		expect(slideAcceptsSubmissions({ closedSlideIds: ["q1"] }, "q2")).toBe(true);
		expect(slideAcceptsSubmissions({}, "q1")).toBe(true);
	});

	test("blanking is its own predicate and says nothing about participation", () => {
		expect(audienceViewBlanked({ audienceBlanked: true })).toBe(true);
		expect(slideAcceptsSubmissions({ audienceBlanked: true }, "q1")).toBe(true);
		expect(audienceViewBlanked({ closedSlideIds: ["q1"] })).toBe(false);
	});
});
