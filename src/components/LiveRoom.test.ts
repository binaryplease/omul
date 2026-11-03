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
 *   - **Where the presenter's control stands.** The wrapper's classes decide it,
 *     so the view is rendered and those classes are read.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	audienceBlankToggleLabel,
	AUDIENCE_BLANK_TITLE,
	closedAtStartNotice,
	participationLabelsFor,
	sharedScreenView,
	slideParticipationControlText,
	slideParticipationToast,
	slideParticipationToggleLabel,
} from "./LiveRoom";
import { PresenterSlideView } from "./PresenterSlideView";
import { getDict } from "../i18n";
import { newSlide } from "../store/editorDocument";
import type { Presentation, SlideLayout, SlideType } from "../types";
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
			slideParticipationToggleLabel({
				open: true,
				canControl: true,
				live: true,
			}),
		).toContain("Close this slide");
		expect(
			slideParticipationToggleLabel({
				open: false,
				canControl: true,
				live: true,
			}),
		).toContain("Reopen this slide");
	});

	test("says what closing costs the session, which is nothing collected", () => {
		// The reason this is a one-tap switch rather than a confirmed gesture:
		// the label has to carry that, or it reads like Reset.
		expect(
			slideParticipationToggleLabel({
				open: true,
				canControl: true,
				live: true,
			}),
		).toContain("every answer already given is kept");
	});

	test("a spectator is told the state and why it is not theirs", () => {
		const openToSpectator = slideParticipationToggleLabel({
			open: true,
			canControl: false,
			live: true,
		});
		const closedToSpectator = slideParticipationToggleLabel({
			open: false,
			canControl: false,
			live: true,
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

describe("the participation control before the deck is live (REQ198)", () => {
	const states = [
		{ open: true, canControl: true },
		{ open: false, canControl: true },
		{ open: true, canControl: false },
		{ open: false, canControl: false },
	];

	test("on a live deck it reads exactly as it always has", () => {
		expect(slideParticipationControlText({ open: true, live: true })).toBe(
			"Close submissions",
		);
		expect(slideParticipationControlText({ open: false, live: true })).toBe(
			"Submissions closed — reopen",
		);
		expect(
			slideParticipationToggleLabel({
				open: true,
				canControl: true,
				live: true,
			}),
		).toBe(
			"Close this slide — the room stops being able to answer it, and every answer already given is kept",
		);
		expect(
			slideParticipationToggleLabel({
				open: false,
				canControl: true,
				live: true,
			}),
		).toBe(
			"Reopen this slide — the room can answer it again, alongside the answers already collected",
		);
		expect(slideParticipationToast({ open: false, live: true })).toBe(
			"Submissions closed on this slide — the answers already given are kept",
		);
		expect(slideParticipationToast({ open: true, live: true })).toBe(
			"Submissions reopened on this slide",
		);
	});

	test("on a draft or ended deck the slide is said to go live closed", () => {
		expect(slideParticipationControlText({ open: true, live: false })).toBe(
			"Go live closed",
		);
		expect(
			slideParticipationControlText({ open: false, live: false }),
		).toContain("Goes live closed");
		expect(
			slideParticipationToggleLabel({
				open: true,
				canControl: true,
				live: false,
			}),
		).toContain("it will go live closed");
		expect(
			slideParticipationToggleLabel({
				open: false,
				canControl: false,
				live: false,
			}),
		).toContain("will go live closed");
		expect(slideParticipationToast({ open: false, live: false })).toContain(
			"will go live closed",
		);
	});

	test("with no room yet, nothing claims answers already given", () => {
		const said = [
			...states.map((state) =>
				slideParticipationToggleLabel({ ...state, live: false }),
			),
			...states.map((state) =>
				slideParticipationControlText({ open: state.open, live: false }),
			),
			slideParticipationToast({ open: true, live: false }),
			slideParticipationToast({ open: false, live: false }),
		];
		for (const line of said) {
			expect(line).not.toContain("already");
			expect(line).not.toContain("answers");
		}
	});

	test("every state still names a distinct thing", () => {
		const labels = states.map((state) =>
			slideParticipationToggleLabel({ ...state, live: false }),
		);
		expect(new Set(labels).size).toBe(labels.length);
	});
});

describe("closedAtStartNotice — what starting a deck says (REQ198)", () => {
	const slides = ["q1", "q2", "q3", "q4"].map((slideId) => ({ id: slideId }));
	const deck = (closedSlideIds: string[]) =>
		({ slides, closedSlideIds }) as unknown as Parameters<
			typeof closedAtStartNotice
		>[0];

	test("a deck with nothing closed says nothing", () => {
		expect(closedAtStartNotice(deck([]))).toBeNull();
	});

	test("names the one slide that starts closed by its number", () => {
		expect(closedAtStartNotice(deck(["q3"]))).toBe(
			"Slide 3 starts closed — reopen it when you want the room to answer",
		);
	});

	test("names several in deck order, whatever order they were closed in", () => {
		expect(closedAtStartNotice(deck(["q4", "q1", "q2"]))).toBe(
			"Slides 1, 2 and 4 start closed — reopen each when you want the room to answer",
		);
	});

	test("a closed id whose slide is gone names nothing", () => {
		expect(closedAtStartNotice(deck(["deleted"]))).toBeNull();
		expect(closedAtStartNotice(deck(["deleted", "q2"]))).toBe(
			"Slide 2 starts closed — reopen it when you want the room to answer",
		);
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

describe("the participation control's alignment on the presenter screen (REQ111)", () => {
	/** The classes on the box directly around the control, as the view draws it. */
	function controlWrapperClasses(type: SlideType, layout: SlideLayout) {
		const slide = { ...newSlide(type), id: "q1", layout };
		const markup = renderToStaticMarkup(
			createElement(PresenterSlideView, {
				slide,
				pres: {
					id: "deck-1",
					status: "live",
					language: "en",
					resultsVisibility: "instant",
					revealedSlideIds: [],
					closedSlideIds: [],
					slides: [slide],
				} as unknown as Presentation,
				results: null,
				serverClockOffsetMs: 0,
				controls: {
					canControl: true,
					onReveal: () => {},
					onRestartTimer: () => {},
					onSetParticipation: () => {},
					onSetCountdown: () => {},
					onDeleteAnswer: null,
					audioCue: null,
				},
				joinUrl: "https://omul.test/join/123456",
			}),
		);
		const wrapper = markup.match(/<div class="([^"]*)"><button[^>]*aria-pressed/);
		expect(wrapper).not.toBeNull();
		return (wrapper?.[1] ?? "").split(" ");
	}

	const SLIDE_TYPES: SlideType[] = [
		"multiple-choice",
		"word-cloud",
		"open-text",
		"scale",
		"ranking",
		"grid",
		"points",
		"guess-number",
		"pin-image",
		"quiz",
		"form",
	];
	const ALIGNMENT_BY_LAYOUT: [SlideLayout, string][] = [
		["center", "items-center"],
		["left", "items-start"],
		["right", "items-end"],
	];

	for (const type of SLIDE_TYPES) {
		for (const [layout, alignment] of ALIGNMENT_BY_LAYOUT) {
			test(`a ${layout}-placed ${type} slide draws it with ${alignment} across a column`, () => {
				// `items-*` moves a child horizontally only in a column. In a row it
				// moves the child vertically, and the control stands at the left.
				const classes = controlWrapperClasses(type, layout);
				expect(classes).toContain("flex-col");
				expect(classes).toContain(alignment);
			});
		}
	}
});
