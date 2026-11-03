/**
 * Unit tests for the countdown slide's client half (REQ107).
 *
 * The slide is authored and drawn, and nothing more yet: an author can add one
 * and set its length, and every surface that draws a slide draws it at that
 * full length, standing still. What is asserted here is that slice:
 *
 *   - **authoring** — a fresh countdown opens on the default length, and an
 *     edit to the length lands on the slide through the one editor operation
 *     every field writes through;
 *   - **drawing** — the editor canvas, the rail's thumbnail, the shared screen,
 *     a phone and the results surface each take the slide without throwing, and
 *     every one that draws a clock draws the authored length on it.
 *
 * and slice 2's half, the run:
 *
 *   - **running** — the shared screen and a phone holding a run the server
 *     recorded draw the time left on it, read against the server's clock (so a
 *     phone that opens mid-run, or whose own clock is out, draws the room's
 *     time), and a run that has passed its length draws 0:00;
 *   - **pausing** — a paused clock draws its frozen time on both surfaces, however
 *     long the pause has lasted;
 *   - **the controls** — the presenter starts, pauses, resumes and resets it from
 *     beside the clock, and each control is drawn disabled, with its reason, where
 *     it cannot act.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyEditorOperation, blankDocument, newSlide } from "../store/editorDocument";
import type { Presentation, Slide } from "../types";
import { COUNTDOWN_DEFAULT_SECONDS, isContentSlideType } from "../types";
import { ContentSlideView } from "./ContentSlideView";
import { countdownControlLabel, countdownResetLabel } from "./CountdownFace";
import { ParticipantSlideView, participantSlideKind } from "./ParticipantSlideView";
import {
	PresenterSlideView,
	presenterSlideKind,
	type PresenterSlideControls,
} from "./PresenterSlideView";
import { ResultsDisplay } from "./Results";
import { SlidePreview } from "./SlidePreview";
import { SlideThumbnail } from "./SlideThumbnail";
import { SLIDE_TYPE_HINTS, SLIDE_TYPE_SECTIONS } from "./SlideTypeMenu";

/** A countdown slide as the client holds it, five minutes long unless told. */
function countdownSlide(overrides: Partial<Slide> = {}): Slide {
	return {
		...newSlide("countdown"),
		id: "countdown-1",
		question: "Coffee break",
		countdownSeconds: 300,
		...overrides,
	};
}

/** A live deck as the client holds it, with only the fields the views read. */
function deckWith(slide: Slide): Presentation {
	return {
		id: "deck-1",
		code: "123456",
		title: "Workshop",
		status: "live",
		language: "en",
		resultsVisibility: "instant",
		revealedSlideIds: [],
		closedSlideIds: [],
		slides: [slide],
	} as unknown as Presentation;
}

const PRESENTER_CONTROLS: PresenterSlideControls = {
	canControl: true,
	onReveal: () => {},
	onRestartTimer: () => {},
	onSetParticipation: () => {},
	onSetCountdown: () => {},
	onDeleteAnswer: null,
	audioCue: null,
};

describe("authoring a countdown slide (REQ107)", () => {
	test("it is offered in the slide-type picker, with its own settings group", () => {
		expect(SLIDE_TYPE_HINTS.countdown.length).toBeGreaterThan(0);
		expect(SLIDE_TYPE_SECTIONS.countdown).toEqual({
			content: "Countdown",
			answers: null,
			scoring: null,
			results: null,
			scrolls: false,
		});
	});

	test("a fresh countdown opens on the default length", () => {
		const slide = newSlide("countdown");
		expect(slide.type).toBe("countdown");
		expect(slide.countdownSeconds).toBe(COUNTDOWN_DEFAULT_SECONDS);
		expect(COUNTDOWN_DEFAULT_SECONDS).toBe(60);
	});

	test("it can be added to a deck and its length edited", () => {
		const slide = newSlide("countdown");
		const added = applyEditorOperation(blankDocument(), {
			type: "add-slide",
			slide,
		});
		const edited = applyEditorOperation(added, {
			type: "update-slide",
			slideId: slide.id,
			changes: { countdownSeconds: 150 },
		});
		const stored = edited.slides.find((candidate) => candidate.id === slide.id);
		expect(stored?.type).toBe("countdown");
		expect(stored?.countdownSeconds).toBe(150);
	});

	test("it is a content slide: no question is required and nothing is collected", () => {
		expect(isContentSlideType("countdown")).toBe(true);
		expect(presenterSlideKind("countdown")).toBe("content");
		expect(participantSlideKind("countdown")).toBe("content");
	});
});

describe("every surface draws a countdown at its full length (REQ107)", () => {
	const originalWindow = globalThis.window;

	beforeEach(() => {
		// The editor canvas and a phone both build a join address off the page's
		// origin; that is all of the browser either reads while rendering.
		globalThis.window = {
			location: new URL("https://omul.test/edit/deck-1"),
		} as unknown as Window & typeof globalThis;
	});

	afterEach(() => {
		globalThis.window = originalWindow;
	});

	test("the shared content renderer draws the clock, not running", () => {
		const markup = renderToStaticMarkup(
			createElement(ContentSlideView, { slide: countdownSlide() }),
		);
		expect(markup).toContain('role="timer"');
		expect(markup).toContain("5:00");
		expect(markup).toContain("Coffee break");
	});

	test("the editor's canvas draws it", () => {
		const markup = renderToStaticMarkup(
			createElement(SlidePreview, { slide: countdownSlide(), index: 0 }),
		);
		expect(markup).toContain("5:00");
	});

	test("the rail's thumbnail shows the length", () => {
		const markup = renderToStaticMarkup(
			createElement(SlideThumbnail, {
				index: 0,
				slide: countdownSlide({ countdownSeconds: 45 }),
				active: false,
				onClick: () => {},
			}),
		);
		expect(markup).toContain("0:45");
	});

	test("the shared screen draws it", () => {
		const slide = countdownSlide();
		const markup = renderToStaticMarkup(
			createElement(PresenterSlideView, {
				slide,
				pres: deckWith(slide),
				results: null,
				serverClockOffsetMs: 0,
				controls: PRESENTER_CONTROLS,
				joinUrl: "https://omul.test/join/123456",
			}),
		);
		expect(markup).toContain("5:00");
	});

	test("a participant's phone draws it", () => {
		const slide = countdownSlide();
		const markup = renderToStaticMarkup(
			createElement(ParticipantSlideView, {
				pres: deckWith(slide),
				slide,
				results: null,
				serverClockOffsetMs: 0,
				isSurvey: false,
				transport: {
					participantId: "participant-1",
					vote: async () => {},
					upvoteResponse: async () => {},
				} as never,
				onError: () => {},
			}),
		);
		expect(markup).toContain("5:00");
	});

	test("the results surface has no tally to draw, and says nothing wrong", () => {
		const markup = renderToStaticMarkup(
			createElement(ResultsDisplay, {
				slide: countdownSlide(),
				results: { type: "countdown", totalVotes: 0 },
			}),
		);
		expect(markup).not.toContain("Unknown slide type");
	});

	test("a hand-built length outside the bounds is drawn inside them", () => {
		const tooLong = renderToStaticMarkup(
			createElement(ContentSlideView, {
				slide: countdownSlide({ countdownSeconds: 99_999 }),
			}),
		);
		expect(tooLong).toContain("60:00");
		const missing = renderToStaticMarkup(
			createElement(ContentSlideView, {
				slide: countdownSlide({ countdownSeconds: undefined }),
			}),
		);
		expect(missing).toContain("1:00");
	});
});

describe("a running countdown is drawn in step on the live surfaces (REQ107)", () => {
	const originalWindow = globalThis.window;

	beforeEach(() => {
		globalThis.window = {
			location: new URL("https://omul.test/join/123456"),
		} as unknown as Window & typeof globalThis;
	});

	afterEach(() => {
		globalThis.window = originalWindow;
	});

	/** A deck whose countdown the presenter started at the instant `startedAt`. */
	function runningDeck(slide: Slide, startedAt: string, status = "live") {
		return {
			...deckWith(slide),
			status,
			countdownRuns: {
				[slide.id]: {
					remainingMs: (slide.countdownSeconds ?? 0) * 1000,
					resumedAt: startedAt,
				},
			},
		} as unknown as Presentation;
	}

	/** A deck whose countdown the presenter paused with `remainingMs` left. */
	function pausedDeck(slide: Slide, remainingMs: number, status = "live") {
		return {
			...deckWith(slide),
			status,
			countdownRuns: { [slide.id]: { remainingMs, resumedAt: null } },
		} as unknown as Presentation;
	}

	/** An instant `ago` milliseconds before the given clock reading. */
	function instantBefore(clockMs: number, ago: number): string {
		return new Date(clockMs - ago).toISOString();
	}

	function sharedScreen(
		pres: Presentation,
		slide: Slide,
		serverClockOffsetMs = 0,
		controls: PresenterSlideControls = PRESENTER_CONTROLS,
	) {
		return renderToStaticMarkup(
			createElement(PresenterSlideView, {
				slide,
				pres,
				results: null,
				serverClockOffsetMs,
				controls,
				joinUrl: "https://omul.test/join/123456",
			}),
		);
	}

	function phone(pres: Presentation, slide: Slide, serverClockOffsetMs = 0) {
		return renderToStaticMarkup(
			createElement(ParticipantSlideView, {
				pres,
				slide,
				results: null,
				serverClockOffsetMs,
				isSurvey: false,
				transport: {
					participantId: "participant-1",
					vote: async () => {},
					upvoteResponse: async () => {},
				} as never,
				onError: () => {},
			}),
		);
	}

	test("the shared screen draws the time left, not the full length", () => {
		const slide = countdownSlide();
		// Ninety and a half seconds into a five-minute run: 209.5s left, shown as
		// 3:30 because a part-second still on the clock reads as a second.
		const pres = runningDeck(slide, instantBefore(Date.now(), 90_500));
		const markup = sharedScreen(pres, slide);
		expect(markup).toContain("3:30");
		expect(markup).not.toContain("5:00");
	});

	test("a phone that joins or reloads mid-run draws the running clock", () => {
		const slide = countdownSlide();
		const pres = runningDeck(slide, instantBefore(Date.now(), 90_500));
		const markup = phone(pres, slide);
		expect(markup).toContain("3:30");
		expect(markup).not.toContain("5:00");
	});

	test("the time left is read on the server's clock, not the device's", () => {
		const slide = countdownSlide();
		// This device's clock is a minute behind the server's. The run started
		// thirty and a half seconds ago *on the server's clock* — which, read on the
		// device's own, is half a minute in the future and would show 5:00.
		const offset = 60_000;
		const pres = runningDeck(slide, instantBefore(Date.now() + offset, 30_500));
		expect(phone(pres, slide, offset)).toContain("4:30");
		expect(sharedScreen(pres, slide, offset)).toContain("4:30");
		expect(phone(pres, slide, 0)).toContain("5:00");
	});

	test("a run past its length reads 0:00 and stays there", () => {
		const slide = countdownSlide();
		const pres = runningDeck(slide, instantBefore(Date.now(), 10 * 60_000));
		expect(sharedScreen(pres, slide)).toContain("0:00");
		expect(phone(pres, slide)).toContain("0:00");
	});

	test("a paused clock draws its frozen time on the shared screen and the phone", () => {
		const slide = countdownSlide();
		const pres = pausedDeck(slide, 209_500);
		expect(sharedScreen(pres, slide)).toContain("3:30");
		expect(phone(pres, slide)).toContain("3:30");
		expect(phone(pres, slide)).not.toContain("5:00");
	});

	test("a phone with a wrong clock draws the same frozen time", () => {
		const slide = countdownSlide();
		const pres = pausedDeck(slide, 209_500);
		expect(phone(pres, slide, 60 * 60_000)).toContain("3:30");
		expect(phone(pres, slide, -60 * 60_000)).toContain("3:30");
	});

	test("a resumed clock counts down from the time it was frozen at", () => {
		const slide = countdownSlide();
		const pres = {
			...deckWith(slide),
			status: "live",
			countdownRuns: {
				[slide.id]: {
					remainingMs: 209_500,
					resumedAt: instantBefore(Date.now(), 10_000),
				},
			},
		} as unknown as Presentation;
		expect(sharedScreen(pres, slide)).toContain("3:20");
		expect(phone(pres, slide)).toContain("3:20");
	});

	test("a clock with no run shows the full length", () => {
		const slide = countdownSlide();
		const pres = { ...deckWith(slide), countdownRuns: {} } as Presentation;
		expect(sharedScreen(pres, slide)).toContain("5:00");
		expect(phone(pres, slide)).toContain("5:00");
	});

	test("another slide's run does not move this slide's clock", () => {
		const slide = countdownSlide();
		const pres = {
			...deckWith(slide),
			countdownRuns: {
				elsewhere: {
					remainingMs: 300_000,
					resumedAt: instantBefore(Date.now(), 90_500),
				},
			},
		} as unknown as Presentation;
		expect(sharedScreen(pres, slide)).toContain("5:00");
	});

	test("the shared content renderer draws the full length without a run", () => {
		// The editor canvas, the rail and the results view hand it none.
		const markup = renderToStaticMarkup(
			createElement(ContentSlideView, { slide: countdownSlide(), countdownRun: null }),
		);
		expect(markup).toContain("5:00");
	});

	/** The attribute a disabled button renders, not the `disabled:` utility classes. */
	const DISABLED = 'disabled=""';

	/** The opening tag of the button with this visible text, or the empty string. */
	function buttonTag(markup: string, text: string): string {
		const buttons = markup.match(/<button[^>]*>.*?<\/button>/gs) ?? [];
		const button = buttons.find((candidate) => candidate.includes(text));
		return button?.slice(0, button.indexOf(">") + 1) ?? "";
	}

	test("the presenter starts an idle clock from beside it, and its reset is dead", () => {
		const slide = countdownSlide();
		const markup = sharedScreen({ ...deckWith(slide) } as Presentation, slide);
		expect(buttonTag(markup, "Start countdown")).not.toContain(DISABLED);
		const reset = buttonTag(markup, "Reset countdown");
		expect(reset).toContain(DISABLED);
		expect(reset).toContain("The countdown is already at its full length");
	});

	test("a running clock offers pause and reset", () => {
		const slide = countdownSlide();
		const markup = sharedScreen(
			runningDeck(slide, instantBefore(Date.now(), 1_000)),
			slide,
		);
		expect(buttonTag(markup, "Pause countdown")).not.toContain(DISABLED);
		expect(buttonTag(markup, "Reset countdown")).not.toContain(DISABLED);
		expect(markup).not.toContain("Start countdown");
	});

	test("a paused clock offers resume and reset", () => {
		const slide = countdownSlide();
		const markup = sharedScreen(pausedDeck(slide, 209_500), slide);
		expect(buttonTag(markup, "Resume countdown")).not.toContain(DISABLED);
		expect(buttonTag(markup, "Reset countdown")).not.toContain(DISABLED);
		expect(markup).not.toContain("Pause countdown");
	});

	test("a finished clock offers only reset, and says why", () => {
		const slide = countdownSlide();
		const markup = sharedScreen(
			runningDeck(slide, instantBefore(Date.now(), 10 * 60_000)),
			slide,
		);
		const start = buttonTag(markup, "Start countdown");
		expect(start).toContain(DISABLED);
		expect(start).toContain("The countdown reached 0:00. Reset it to run it again");
		expect(buttonTag(markup, "Reset countdown")).not.toContain(DISABLED);
	});

	test("the start control is drawn disabled, with its reason, before the deck is live", () => {
		const slide = countdownSlide();
		const pres = { ...deckWith(slide), status: "draft" } as Presentation;
		const start = buttonTag(sharedScreen(pres, slide), "Start countdown");
		expect(start).toContain(DISABLED);
		expect(start).toContain("Start the presentation to run the countdown");
	});

	test("a clock left paused on an ended deck can still be reset", () => {
		const slide = countdownSlide();
		const markup = sharedScreen(pausedDeck(slide, 209_500, "ended"), slide);
		expect(buttonTag(markup, "Resume countdown")).toContain(DISABLED);
		expect(buttonTag(markup, "Reset countdown")).not.toContain(DISABLED);
	});

	test("a spectator sees both controls disabled with their reasons", () => {
		const slide = countdownSlide();
		const markup = sharedScreen(pausedDeck(slide, 209_500), slide, 0, {
			...PRESENTER_CONTROLS,
			canControl: false,
		});
		const resume = buttonTag(markup, "Resume countdown");
		expect(resume).toContain(DISABLED);
		expect(resume).toContain("Only an editor of this deck can run the countdown");
		const reset = buttonTag(markup, "Reset countdown");
		expect(reset).toContain(DISABLED);
		expect(reset).toContain("Only an editor of this deck can reset the countdown");
	});

	test("a dry run has no room to run a clock for, so it offers no control", () => {
		const slide = countdownSlide();
		const markup = sharedScreen(deckWith(slide), slide, 0, {
			...PRESENTER_CONTROLS,
			onSetCountdown: null,
		});
		expect(markup).toContain("5:00");
		expect(markup).not.toContain("Start countdown");
		expect(markup).not.toContain("Reset countdown");
	});

	test("the start control's label says what pressing it does, or why it cannot", () => {
		const editor = { canControl: true, live: true };
		expect(countdownControlLabel({ ...editor, phase: "idle" })).toBe(
			"Start the countdown for the room",
		);
		expect(countdownControlLabel({ ...editor, phase: "running" })).toBe(
			"Pause the countdown at the time left",
		);
		expect(countdownControlLabel({ ...editor, phase: "paused" })).toBe(
			"Resume the countdown from the time left",
		);
		expect(countdownControlLabel({ ...editor, phase: "finished" })).toBe(
			"The countdown reached 0:00. Reset it to run it again",
		);
		expect(
			countdownControlLabel({ canControl: true, live: false, phase: "idle" }),
		).toBe("Start the presentation to run the countdown");
	});

	test("the reset control's label says what pressing it does, or why it cannot", () => {
		expect(countdownResetLabel({ canControl: true, phase: "idle" })).toBe(
			"The countdown is already at its full length",
		);
		for (const phase of ["running", "paused", "finished"] as const) {
			expect(countdownResetLabel({ canControl: true, phase })).toBe(
				"Return the countdown to its full length",
			);
		}
	});
});
