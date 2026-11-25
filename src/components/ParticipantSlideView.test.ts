/**
 * A participant's phone at the end of a quiz question (REQ216).
 *
 * The room's results under a quiz question appear on the phone when the question
 * is over — its window run out with the submission grace, or closed to answers
 * by the presenter — the same moment the shared screen shows them (REQ214). Not
 * at the countdown's own deadline: an answer in flight is still accepted for the
 * grace after it, so the room's result is not out yet, and the tally in hand is
 * still the running question's withheld one.
 *
 * Rendered to static markup with React's server renderer, which needs no DOM and
 * runs no effects — so the participant here has not answered, and what is drawn
 * is decided by the deck and the tally alone.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type DeckMovedOnCode,
	PresentationSchema,
	QUIZ_SUBMISSION_GRACE_MS,
	VOTE_REFUSAL_CODES,
	type VoteRefusalCode,
} from "../../server/schemas";
import { ApiError } from "../api";
import { getDict } from "../i18n";
import { createAppStore } from "../store/store";
import type { Presentation, Slide } from "../types";
import {
	choiceCardState,
	liveVoteTransport,
	ownQuizResultFor,
	ParticipantSlideView,
	readScorecardOnce,
	refusalOnStatusLine,
	routeSubmissionFailure,
	type StoredRefusal,
} from "./ParticipantSlideView";

const TIME_LIMIT_SECONDS = 30;

const SELECT_QUIZ: Slide = {
	id: "q1",
	type: "quiz",
	question: "Which planet is closest to the sun?",
	timeLimit: TIME_LIMIT_SECONDS,
	// The phone's copy of the deck: the key is withheld from it (REQ056).
	options: [
		{ id: "mercury", text: "Mercury" },
		{ id: "mars", text: "Mars" },
	],
};

const TYPED_QUIZ: Slide = {
	id: "q2",
	type: "quiz",
	question: "Which is the largest ocean on Earth?",
	timeLimit: TIME_LIMIT_SECONDS,
	quizAnswerMode: "type",
	quizAnswers: [],
};

const SCORING = {
	answeredCount: 2,
	correctCount: 1,
	totalPoints: 836,
	maxPoints: 1000,
	averagePoints: 418,
	correctShare: 0.5,
};

/** The room's frame for SELECT_QUIZ once it is over: the key is in it. */
const SELECT_TALLY_OVER = {
	type: "quiz",
	answerMode: "select",
	totalVotes: 2,
	respondentCount: 2,
	maxSelections: 1,
	typedAnswers: null,
	scoring: SCORING,
	options: [
		{ id: "mercury", text: "Mercury", count: 1, isCorrect: true },
		{ id: "mars", text: "Mars", count: 1, isCorrect: false },
	],
};

/** The room's last frame for TYPED_QUIZ while it ran: the answers withheld. */
const TYPED_TALLY_RUNNING = {
	...SELECT_TALLY_OVER,
	answerMode: "type",
	options: [],
	typedAnswers: { accepted: null, entries: null, distinctCount: 1 },
};

/** A live deck on `slide`, opened `openedAgoMs` before now. */
function liveDeck(
	slide: Slide,
	openedAgoMs: number,
	overrides: Record<string, unknown> = {},
): Presentation {
	return PresentationSchema.parse({
		id: "deck",
		code: "123456",
		title: "Quiz round",
		slides: [slide],
		status: "live",
		createdAt: "2026-10-30T09:00:00.000Z",
		slideStartedAt: {
			[slide.id]: new Date(Date.now() - openedAgoMs).toISOString(),
		},
		...overrides,
	}) as Presentation;
}

function phone(slide: Slide, pres: Presentation, results: unknown) {
	return renderToStaticMarkup(
		createElement(ParticipantSlideView, {
			pres,
			slide,
			results,
			serverClockOffsetMs: 0,
			isSurvey: false,
			transport: {
				participantId: "phone",
				vote: async () => {},
				upvoteResponse: async () => {},
				scorecard: async () => null,
			},
			onError: () => {},
			onDeckMovedOn: () => {},
		}),
	);
}

/** Half a second past the deadline: "Time's up", but still inside the grace. */
const IN_GRACE = TIME_LIMIT_SECONDS * 1000 + 500;
/** Past the deadline and its grace. */
const OVER = TIME_LIMIT_SECONDS * 1000 + QUIZ_SUBMISSION_GRACE_MS + 1000;
/** Five seconds in: the window is open. */
const RUNNING = 5_000;

describe("a participant's phone when a quiz question ends (REQ216)", () => {
	test("inside the grace after the buzzer, the running question's tally is not drawn", () => {
		// The countdown already reads "Time's up", but the result is not out: the
		// withheld frame in hand would read "…they appear once the question is
		// over" under it, which is exactly what stayed on screen.
		const markup = phone(
			TYPED_QUIZ,
			liveDeck(TYPED_QUIZ, IN_GRACE),
			TYPED_TALLY_RUNNING,
		);
		expect(markup).toContain("Time&#x27;s up");
		expect(markup).not.toContain("they appear once the question is over");
		expect(markup).not.toContain("Live results");
	});

	test("once the window and its grace are over, the room's results and the key appear", () => {
		const markup = phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, OVER), SELECT_TALLY_OVER);
		expect(markup).toContain("Live results");
		expect(markup).toContain("correct</span>");
		expect(markup).toContain("answered correctly");
	});

	test("closing the question to answers ends it with time still on the clock", () => {
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING, {
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date().toISOString() },
			}),
			SELECT_TALLY_OVER,
		);
		expect(markup).toContain("Live results");
		expect(markup).toContain("correct</span>");
	});

	test("a question closed before it opened is not over (REQ216)", () => {
		// A close made ahead of time ended nothing, so the phone does not switch to
		// the results of a question the room has not been asked yet.
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING, {
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date(Date.now() - 60_000).toISOString() },
			}),
			SELECT_TALLY_OVER,
		);
		expect(markup).not.toContain("Live results");
	});

	test("while the window is open, nothing of the room's answers is drawn", () => {
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING),
			SELECT_TALLY_OVER,
		);
		expect(markup).toContain("s left");
		expect(markup).not.toContain("Live results");
	});

	test("On click still waits for the presenter's reveal", () => {
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, { resultsVisibility: "on-click" }),
			SELECT_TALLY_OVER,
		);
		expect(markup).not.toContain("Live results");
		expect(markup).not.toContain("correct</span>");
	});

	test("and shows them once the presenter has revealed", () => {
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, {
				resultsVisibility: "on-click",
				revealedSlideIds: ["q1"],
			}),
			SELECT_TALLY_OVER,
		);
		expect(markup).toContain("Live results");
		expect(markup).toContain("correct</span>");
	});
});

describe("a participant's phone while a quiz question waits at go-live (REQ226)", () => {
	/** The deck has just gone live on the quiz; nobody has started its timer. */
	const waiting = (slide: Slide, overrides: Record<string, unknown> = {}) =>
		liveDeck(slide, RUNNING, { slideStartedAt: {}, ...overrides });

	test("the question and its options are shown, locked, with the reason", () => {
		const markup = phone(SELECT_QUIZ, waiting(SELECT_QUIZ), null);
		expect(markup).toContain("Which planet is closest to the sun?");
		const cards = markup.match(/<button[^>]*option-card[^>]*>/g) ?? [];
		expect(cards).toHaveLength(2);
		for (const card of cards) expect(card).toContain('aria-disabled="true"');
		// Said in the polite region, so it is announced and not only tooltipped.
		expect(markup).toMatch(
			/<div role="status" aria-atomic="false"><p[^>]*>Waiting for the presenter to start this question<\/p>/,
		);
		// No countdown before the window opens, and no verdict on a question
		// nobody could have answered yet.
		expect(markup).not.toContain("s left");
		expect(markup).not.toContain("No answer in time");
		expect(markup).not.toContain("Live results");
	});

	test("a typed question's field is locked the same way", () => {
		const markup = phone(TYPED_QUIZ, waiting(TYPED_QUIZ), null);
		const field = markup.match(/<input[^>]*>/)?.[0] ?? "";
		expect(field).toContain('aria-disabled="true"');
		expect(markup).toContain("Waiting for the presenter to start this question");
	});

	test("the reason is in the deck's language", () => {
		const markup = phone(
			SELECT_QUIZ,
			waiting(SELECT_QUIZ, { language: "de" }),
			null,
		);
		expect(markup).toContain("Warten, bis diese Frage gestartet wird");
	});

	test("a waiting question the presenter has also closed says closed, not waiting (REQ227)", () => {
		// Starting the timer does not reopen a closed slide, so "waiting for the
		// presenter to start" would promise something that is not coming.
		const markup = phone(
			SELECT_QUIZ,
			waiting(SELECT_QUIZ, {
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date().toISOString() },
			}),
			null,
		);
		expect(markup).toContain("The presenter has closed this question");
		expect(markup).not.toContain("Waiting for the presenter");
	});

	test("once the presenter starts it, the countdown runs and the options open", () => {
		const markup = phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, RUNNING), null);
		expect(markup).toContain("s left");
		expect(markup).not.toContain("Waiting for the presenter");
		const cards = markup.match(/<button[^>]*option-card[^>]*>/g) ?? [];
		for (const card of cards) expect(card).not.toContain("aria-disabled");
	});
});

describe("the quiz view to a screen reader (REQ221)", () => {
	test("the answer controls are a group named by the question", () => {
		// An unnamed group is announced as just "group".
		const markup = phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, RUNNING), null);
		const labelledBy = markup.match(/<fieldset aria-labelledby="([^"]+)"/)?.[1];
		expect(labelledBy).toBeTruthy();
		expect(markup).toContain(`<h2 id="${labelledBy}"`);
	});

	test("a locked option keeps focus: aria-disabled, never disabled", () => {
		// A disabled button gives up focus, so the card just pressed dropped the
		// participant onto <body> the moment the answer locked.
		const markup = phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, OVER), null);
		const cards = markup.match(/<button[^>]*option-card[^>]*>/g) ?? [];
		expect(cards).toHaveLength(2);
		for (const card of cards) {
			expect(card).toContain('aria-disabled="true"');
			expect(card).not.toContain("disabled=\"\"");
		}
	});

	test("the lock reason sits in a polite region mounted before it is needed", () => {
		// Running: the region is already there, empty, so what lands in it later
		// is announced.
		expect(phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, RUNNING), null)).toContain(
			'<div role="status" aria-atomic="false"><p class="text-center text-sm text-text-muted "></p>',
		);
		expect(phone(SELECT_QUIZ, liveDeck(SELECT_QUIZ, OVER), null)).toMatch(
			/<div role="status" aria-atomic="false"><p[^>]*>The time for this question is over<\/p>/,
		);
	});

	test("the typed answer keeps focus too", () => {
		const markup = phone(TYPED_QUIZ, liveDeck(TYPED_QUIZ, OVER), null);
		const field = markup.match(/<input[^>]*>/)?.[0] ?? "";
		expect(field).toContain("readOnly");
		expect(field).toContain('aria-disabled="true"');
		expect(field).not.toContain(" disabled=");
		expect(markup).toContain('role="timer"');
	});
});

describe("choiceCardState (REQ221, REQ223, REQ224)", () => {
	const base = {
		selectedIds: [] as string[],
		pendingOptionId: null,
		submitting: false,
		blockedByCap: false,
		locked: false,
	};

	test("the card just tapped is drawn as the choice while its answer is sent", () => {
		const sending = { ...base, pendingOptionId: "mercury", submitting: true };
		expect(choiceCardState({ ...sending, optionId: "mercury" })).toEqual({
			selected: true,
			pending: true,
			unavailable: true,
			dimmed: false,
		});
		// The others step back, so which one was picked is not in doubt.
		expect(choiceCardState({ ...sending, optionId: "mars" })).toEqual({
			selected: false,
			pending: false,
			unavailable: true,
			dimmed: true,
		});
	});

	test("a changed single-choice vote shows one chosen card while it is sent, not two", () => {
		const changing = {
			...base,
			selectedIds: ["mars"],
			pendingOptionId: "mercury",
			submitting: true,
		};
		expect(choiceCardState({ ...changing, optionId: "mercury" }).selected).toBe(
			true,
		);
		expect(choiceCardState({ ...changing, optionId: "mars" })).toEqual({
			selected: false,
			pending: false,
			unavailable: true,
			dimmed: true,
		});
	});

	test("an open card answers a tap; a locked one does not, and the chosen one stands out", () => {
		expect(choiceCardState({ ...base, optionId: "mars" }).unavailable).toBe(false);
		const locked = { ...base, selectedIds: ["mercury"], locked: true };
		expect(choiceCardState({ ...locked, optionId: "mercury" })).toEqual({
			selected: true,
			pending: false,
			unavailable: true,
			dimmed: false,
		});
		expect(choiceCardState({ ...locked, optionId: "mars" }).dimmed).toBe(true);
	});
});

describe("an option card under the pointer (REQ223)", () => {
	test("only a card that can still be picked takes the hover style", () => {
		// A locked card under a pointer the layout moved there wore the accent
		// border, which reads as "selected".
		const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");
		const hoverRules = css.match(/\.option-card:hover[^{]*\{/g) ?? [];
		expect(hoverRules.length).toBeGreaterThan(0);
		for (const rule of hoverRules) {
			expect(rule).toContain(':not(:disabled, [aria-disabled="true"])');
		}
	});

	test("the hover guard adds no specificity, so a selected card keeps its tint under the pointer", () => {
		// `.option-card:hover:not(...)` outranks `.option-card.selected`, and a
		// phone keeps hover on the card just tapped.
		const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");
		const hoverRules = css.match(/\.option-card:hover[^{]*\{/g) ?? [];
		for (const rule of hoverRules) {
			expect(rule).toContain(":where(:not(");
		}
	});
});

describe("a participant's own verdict while the server withholds it (REQ228)", () => {
	/** One question's entry as the scorecard sends it before the solution is out. */
	const WITHHELD = {
		slideId: "q1",
		answered: true,
		optionId: "mercury",
		answer: null,
		isCorrect: null,
		points: null,
	};

	test("a withheld entry is no verdict, so nothing reads 'Not quite'", () => {
		expect(ownQuizResultFor({ slides: [WITHHELD] }, "q1")).toBe(null);
	});

	test("the entry released after the question reads as the verdict", () => {
		const released = { ...WITHHELD, isCorrect: true, points: 943 };
		expect(ownQuizResultFor({ slides: [released] }, "q1")).toEqual(released);
	});

	test("a released question left unanswered still reads, as zero points", () => {
		const unanswered = {
			...WITHHELD,
			answered: false,
			optionId: null,
			points: 0,
		};
		expect(ownQuizResultFor({ slides: [unanswered] }, "q1")).toEqual(unanswered);
	});

	test("no card, or no entry for this question, is no verdict", () => {
		expect(ownQuizResultFor(null, "q1")).toBe(null);
		expect(ownQuizResultFor({ slides: [WITHHELD] }, "q2")).toBe(null);
	});
});

describe("a scorecard read overtaken by a newer one (REQ228)", () => {
	const WITHHELD_CARD = {
		slides: [
			{ slideId: "q1", answered: true, optionId: "mercury", isCorrect: null, points: null },
		],
	};
	const RELEASED_CARD = {
		slides: [
			{ slideId: "q1", answered: true, optionId: "mercury", isCorrect: true, points: 943 },
		],
	};

	/**
	 * A transport stand-in whose reads resolve only when the test says so, in
	 * whatever order it says so.
	 */
	function delayedTransport() {
		const pending: Array<(card: unknown) => void> = [];
		return {
			pending,
			transport: {
				scorecard: () =>
					new Promise<unknown>((resolve) => {
						pending.push(resolve);
					}),
			},
		};
	}

	function recordingApply() {
		const applied: unknown[] = [];
		let voted: Record<string, string> = {};
		return {
			applied,
			voted: () => voted,
			apply: {
				setScorecard: (card: unknown) => applied.push(card),
				setVoted: (
					update: (previous: Record<string, string>) => Record<string, string>,
				) => {
					voted = update(voted);
				},
			},
		};
	}

	test("the earlier read resolving last leaves the later read's card applied", async () => {
		const { pending, transport } = delayedTransport();
		const { applied, voted, apply } = recordingApply();
		// Two effect runs: the first read is sent while the verdict is withheld;
		// the release re-runs the effect, whose cleanup marks the first read
		// stale before the second is sent.
		const cleanupFirst = readScorecardOnce(transport, "q1", apply);
		cleanupFirst();
		readScorecardOnce(transport, "q1", apply);
		expect(pending).toHaveLength(2);

		pending[1](RELEASED_CARD);
		await Promise.resolve();
		await Promise.resolve();
		pending[0](WITHHELD_CARD);
		await Promise.resolve();
		await Promise.resolve();

		expect(applied).toEqual([RELEASED_CARD]);
		expect(voted()).toEqual({ q1: "mercury" });
	});

	test("a read that is not overtaken applies its card and the answer lock", async () => {
		const { pending, transport } = delayedTransport();
		const { applied, voted, apply } = recordingApply();
		readScorecardOnce(transport, "q1", apply);
		pending[0](WITHHELD_CARD);
		await Promise.resolve();
		await Promise.resolve();
		expect(applied).toEqual([WITHHELD_CARD]);
		expect(voted()).toEqual({ q1: "mercury" });
	});

	test("the scorecard effect returns the read's cleanup", () => {
		const source = readFileSync(join(import.meta.dir, "ParticipantSlideView.tsx"), "utf8");
		expect(source).toContain(
			"return readScorecardOnce(transport, slide.id, { setScorecard, setVoted });",
		);
	});
});

describe("a connected phone after the presenter edits and saves the deck (REQ229)", () => {
	/**
	 * A phone that joined while the deck ran on `instant` with this question on
	 * `inherit`, and stays connected through everything below — no reload.
	 */
	function connectedPhone(slides: Slide[]) {
		const store = createAppStore();
		store.getState().setPresentation(
			PresentationSchema.parse({
				id: "deck",
				code: "123456",
				title: "Quiz round",
				slides,
				status: "live",
				resultsVisibility: "instant",
				createdAt: "2026-10-30T09:00:00.000Z",
			}) as Presentation,
		);
		return store;
	}

	/** What the phone draws for whichever slide the presenter has on screen. */
	function onScreen(store: ReturnType<typeof createAppStore>, results: unknown) {
		const pres = store.getState().presentation as Presentation;
		return phone(pres.slides[pres.activeSlideIndex], pres, results);
	}

	test("reset, switched to On click and saved: no result before the reveal", () => {
		const store = connectedPhone([SELECT_QUIZ]);
		// Reset → Edit → "On click" → Save → Start, the phone connected all along.
		store.getState().applyReset();
		store.getState().applyDeckSlides({
			slides: [{ ...SELECT_QUIZ, resultsVisibility: "on-click" }],
		});
		store.getState().applyStarted({ slideStartedAt: {} });
		store.getState().applySlideStarted({
			slideId: "q1",
			startedAt: new Date(Date.now() - OVER).toISOString(),
		});

		// The window and its grace are over. The tally is drawn behind the same
		// gate the participant's own verdict and points are (`quizResultReady`),
		// so neither the room's results nor the solution is on this screen.
		const markup = onScreen(store, SELECT_TALLY_OVER);
		expect(markup).toContain("Time&#x27;s up");
		expect(markup).not.toContain("Live results");
		expect(markup).not.toContain("correct</span>");
		expect(markup).not.toContain("answered correctly");

		// And the reveal still brings them, without a reload.
		store.getState().applyRevealed({ slideId: "q1", revealed: true });
		const revealed = onScreen(store, SELECT_TALLY_OVER);
		expect(revealed).toContain("Live results");
		expect(revealed).toContain("correct</span>");
	});

	test("a slide moved to the front is the one shown when its question starts", () => {
		const intro: Slide = {
			id: "intro",
			type: "instruction",
			question: "Join the quiz",
		};
		const store = connectedPhone([intro, SELECT_QUIZ]);
		store.getState().applyReset();
		// "Move slide up" on the quiz, Save, Start, Start timer.
		store.getState().applyDeckSlides({ slides: [SELECT_QUIZ, intro] });
		store.getState().applyStarted({ slideStartedAt: {} });
		store.getState().applySlideStarted({
			slideId: "q1",
			startedAt: new Date(Date.now() - RUNNING).toISOString(),
		});

		const markup = onScreen(store, null);
		expect(markup).toContain("Which planet is closest to the sun?");
		expect(markup).toContain("s left");
		expect(markup).not.toContain("Join the quiz");
	});

	test("a saved time limit is the one the phone counts down", () => {
		const store = connectedPhone([SELECT_QUIZ]);
		store.getState().applyDeckSlides({
			slides: [{ ...SELECT_QUIZ, timeLimit: 120 }],
		});
		store.getState().applySlideStarted({
			slideId: "q1",
			startedAt: new Date(Date.now() - 60_000).toISOString(),
		});

		// A minute in: over on the 30 seconds the phone loaded, running on the
		// 120 the presenter saved.
		const markup = onScreen(store, null);
		expect(markup).toContain("s left");
		expect(markup).not.toContain("Time&#x27;s up");
	});
});

describe("a phone that followed the draft when the deck goes live (REQ230)", () => {
	test("is on the slide the deck went live on, not the quiz picked in the draft", () => {
		const warmUp: Slide = {
			id: "warm-up",
			type: "multiple-choice",
			question: "Ready to play?",
			options: [
				{ id: "yes", text: "Yes" },
				{ id: "no", text: "No" },
			],
		};
		const store = createAppStore();
		store.getState().setPresentation(
			PresentationSchema.parse({
				id: "deck",
				code: "123456",
				title: "Quiz round",
				slides: [warmUp, SELECT_QUIZ],
				status: "draft",
				createdAt: "2026-10-30T09:00:00.000Z",
			}) as Presentation,
		);
		// The presenter looks at the quiz question in the draft, the phone follows.
		store.getState().applySlideChanged({ slideIndex: 1 });
		// Start: the server and the presenter are on the first slide.
		store
			.getState()
			.applyStarted({ slideIndex: 0, slideId: "warm-up", slideStartedAt: {} });

		const pres = store.getState().presentation as Presentation;
		const markup = phone(pres.slides[pres.activeSlideIndex], pres, null);
		expect(markup).toContain("Ready to play?");
		expect(markup).not.toContain("Which planet is closest to the sun?");
	});
});

describe("a refused quiz answer keeps the participant on the slide (REQ232)", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	/** The English the vote route sends beside each code — never what is shown. */
	const ROUTE_ERROR: Record<VoteRefusalCode, string> = {
		"quiz-not-started": "This quiz question has not started yet",
		"quiz-window-closed": "The time for this quiz question is over",
		"quiz-already-answered": "Your answer to this quiz question is final",
		"participation-closed": "The presenter has closed this slide to submissions",
		"repeat-passes-off": "This presentation does not let a device answer it again",
	};

	/** What a German deck's participant reads for each of them. */
	const GERMAN_REASON: Record<VoteRefusalCode, string> = {
		"quiz-not-started": "Warten, bis diese Frage gestartet wird",
		"quiz-window-closed": "Die Zeit für diese Frage ist vorbei",
		"quiz-already-answered": "Deine Antwort steht fest",
		"participation-closed": "Der Präsentator hat diese Frage geschlossen",
		"repeat-passes-off": "Der Veranstalter erlaubt kein erneutes Antworten mehr",
	};

	/** The vote route answering every request with `status` and `body`. */
	function voteRouteAnswers(status: number, body: unknown) {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			})) as unknown as typeof fetch;
	}

	/**
	 * Send `value` as this phone's answer through the live transport, and report
	 * a failure the way the live page does: a stated refusal to the slide's own
	 * line, anything else to the store's `setError` — the one value the page's
	 * error screen is drawn from.
	 */
	async function answerOnLivePage(slideId: string, value: string) {
		const store = createAppStore();
		const shownOnSlide: string[] = [];
		await liveVoteTransport("deck", "phone")
			.vote({ slideId, value })
			.catch((thrown: unknown) =>
				routeSubmissionFailure(thrown, getDict("de"), {
					refused: (message) => shownOnSlide.push(message),
					movedOn: () => {},
					failed: store.getState().setError,
				}),
			);
		return { pageError: store.getState().error, shownOnSlide };
	}

	const ANSWERS = [
		{ mode: "select", slide: SELECT_QUIZ, value: "mars" },
		{ mode: "typed", slide: TYPED_QUIZ, value: "Atlantic" },
	];

	for (const refused of VOTE_REFUSAL_CODES) {
		for (const answer of ANSWERS) {
			test(`${refused}, ${answer.mode} answer: no error screen, the reason in the deck's language`, async () => {
				voteRouteAnswers(400, { error: ROUTE_ERROR[refused], refused });
				const outcome = await answerOnLivePage(answer.slide.id, answer.value);
				expect(outcome.pageError).toBe("");
				expect(outcome.shownOnSlide).toEqual([GERMAN_REASON[refused]]);
			});
		}
	}

	test("a failure without any code still reaches the page's error path", async () => {
		// A value the boundary rejected, a deck that no longer exists: nothing the
		// participant's screen can catch up to.
		voteRouteAnswers(400, {
			error: "Cannot vote – presentation not found or answer not valid for this slide",
		});
		const outcome = await answerOnLivePage("q1", "mars");
		expect(outcome.pageError).toBe(
			"Cannot vote – presentation not found or answer not valid for this slide",
		);
		expect(outcome.shownOnSlide).toEqual([]);
	});

	/**
	 * What the answer status line under the control reads (REQ221): the text of
	 * the first paragraph in the polite region, where a refusal is shown.
	 */
	function answerStatusLine(markup: string): string | null {
		return (
			markup.match(/<div role="status" aria-atomic="false"><p[^>]*>([^<]*)<\/p>/)?.[1] ??
			null
		);
	}

	/**
	 * The phone once it has caught up with the state each refusal reports. The
	 * refusal arrives after the broadcast that caused it — a close lands as a
	 * `slide.participation` frame while the answer is still in flight — so this
	 * is what the line reads when "Sending…" gives way. Not `quiz-already-answered`:
	 * that state is the scorecard's re-read, an effect a static render runs none of.
	 */
	const CAUGHT_UP: Partial<Record<VoteRefusalCode, (slide: Slide) => Presentation>> = {
		"quiz-not-started": (slide) =>
			liveDeck(slide, RUNNING, { slideStartedAt: {}, language: "de" }),
		"quiz-window-closed": (slide) => liveDeck(slide, OVER, { language: "de" }),
		"participation-closed": (slide) =>
			liveDeck(slide, RUNNING, {
				language: "de",
				closedSlideIds: [slide.id],
				slideClosedAt: { [slide.id]: new Date().toISOString() },
			}),
	};

	for (const refused of Object.keys(CAUGHT_UP) as VoteRefusalCode[]) {
		for (const answer of ANSWERS) {
			test(`${refused}, ${answer.mode} answer: the line under the control reads the reason (REQ234)`, () => {
				// The refusal is dropped from the line once the question is over, and
				// closing a quiz ends it (REQ216), so what stands there is the lock
				// reason. For a close that was nothing: the line went from "Sending…"
				// to empty, and the reason was only in the banner above the question.
				const shown: string[] = [];
				routeSubmissionFailure(
					new ApiError(ROUTE_ERROR[refused], refused, 400),
					getDict("de"),
					{
					refused: (message) => shown.push(message),
					movedOn: () => {},
					failed: () => {},
				},
				);
				const deckFor = CAUGHT_UP[refused] as (slide: Slide) => Presentation;
				const markup = phone(answer.slide, deckFor(answer.slide), null);
				expect(shown).toEqual([GERMAN_REASON[refused]]);
				expect(answerStatusLine(markup)).toBe(GERMAN_REASON[refused]);
			});
		}
	}

	test("a closed question keeps saying closed after its countdown runs out (REQ234)", () => {
		// The countdown goes on after "Close submissions"; the close is what holds
		// the answer, so the line does not switch to "time is over" under it.
		const markup = phone(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, {
				language: "de",
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date(Date.now() - 5_000).toISOString() },
			}),
			null,
		);
		expect(answerStatusLine(markup)).toBe("Der Präsentator hat diese Frage geschlossen");
	});

	test("every path in the slide view reaches the page's error callback through the router", () => {
		// The live page passes the store's `setError` as `onError`, and that is
		// what swaps the slide for the error screen. A second call site — a catch
		// block or the local closed-slide guard calling it directly — would send a
		// stated refusal there again, which is the defect this pins.
		const source = readFileSync(join(import.meta.dir, "ParticipantSlideView.tsx"), "utf8");
		const calls = source.match(/\bonError\(/g) ?? [];
		expect(calls).toHaveLength(1);
		expect(source).toMatch(/const reportFailure = \(message: string\) => \{\s*onError\(message\);/);
		const page = readFileSync(join(import.meta.dir, "..", "pages", "ParticipantPage.tsx"), "utf8");
		expect(page).toContain("onError={setError}");
	});
});

describe("a stored refusal once the slide no longer says what it reported (REQ232)", () => {
	const GERMAN = getDict("de");
	const CLOSED_REASON = "Der Präsentator hat diese Frage geschlossen";
	const STARTED_AT = "2026-11-25T10:00:00.000Z";
	const RESTARTED_AT = "2026-11-25T10:05:00.000Z";

	/**
	 * The refusal the slide view stores for a code the server sent, on `slideId`
	 * with the quiz window `quizStartedAt` the answer was sent into — the same
	 * fields `reportRefusal` writes, with the wording the router picked.
	 */
	function refusedByServer(
		code: VoteRefusalCode,
		slideId: string,
		quizStartedAt: string | null,
	): StoredRefusal {
		const stored: StoredRefusal[] = [];
		routeSubmissionFailure(new ApiError("refused", code, 400), GERMAN, {
			refused: (message, refusedCode) => {
				stored.push({ slideId, code: refusedCode, message, quizStartedAt });
			},
			movedOn: () => {},
			failed: () => {},
		});
		if (stored.length !== 1) throw new Error(`${code} was not routed as a refusal`);
		return stored[0];
	}

	/** A multiple-choice slide: never a quiz, so never "over". */
	function choiceSlideNow(participationOpen: boolean) {
		return { slideId: "mc", quizOver: false, participationOpen, quizStartedAt: null };
	}

	test("close, tap, reopen on a choice slide: the line drops the closed refusal without a new tap", () => {
		// The tap on the closed slide stores the refusal (`refusedWhileClosed`).
		const refusal: StoredRefusal = {
			slideId: "mc",
			code: "participation-closed",
			message: CLOSED_REASON,
			quizStartedAt: null,
		};
		expect(refusalOnStatusLine(refusal, choiceSlideNow(false))).toBe(CLOSED_REASON);
		// The presenter reopens the slide; the refusal is still stored.
		expect(refusalOnStatusLine(refusal, choiceSlideNow(true))).toBe(null);
	});

	test("the server's participation-closed refusal is dropped by a reopen the same way", () => {
		const refusal = refusedByServer("participation-closed", "mc", null);
		expect(refusal.message).toBe(CLOSED_REASON);
		expect(refusalOnStatusLine(refusal, choiceSlideNow(false))).toBe(CLOSED_REASON);
		expect(refusalOnStatusLine(refusal, choiceSlideNow(true))).toBe(null);
	});

	test("a quiz closed and reopened inside its window drops the closed refusal", () => {
		const refusal = refusedByServer("participation-closed", "q1", STARTED_AT);
		// Closing a quiz ends it (REQ216); the reopen lets it run again.
		const reopened = {
			slideId: "q1",
			quizOver: false,
			participationOpen: true,
			quizStartedAt: STARTED_AT,
		};
		expect(refusalOnStatusLine(refusal, reopened)).toBe(null);
	});

	test("a refusal of another kind is not dropped by a reopen", () => {
		const refusal = refusedByServer("quiz-already-answered", "q1", STARTED_AT);
		const closed = {
			slideId: "q1",
			quizOver: false,
			participationOpen: false,
			quizStartedAt: STARTED_AT,
		};
		const reopened = { ...closed, participationOpen: true };
		expect(refusalOnStatusLine(refusal, reopened)).toBe(
			refusalOnStatusLine(refusal, closed),
		);
		expect(refusalOnStatusLine(refusal, reopened)).toBe("Deine Antwort steht fest");
	});

	test("a quiz the presenter starts drops the not-started refusal", () => {
		const refusal = refusedByServer("quiz-not-started", "q1", null);
		const waiting = { slideId: "q1", quizOver: false, participationOpen: true, quizStartedAt: null };
		expect(refusalOnStatusLine(refusal, waiting)).toBe(
			"Warten, bis diese Frage gestartet wird",
		);
		expect(refusalOnStatusLine(refusal, { ...waiting, quizStartedAt: STARTED_AT })).toBe(null);
	});

	test("a quiz the presenter restarts drops a refusal from the window before", () => {
		const refusal = refusedByServer("quiz-window-closed", "q1", STARTED_AT);
		const restarted = {
			slideId: "q1",
			quizOver: false,
			participationOpen: true,
			quizStartedAt: RESTARTED_AT,
		};
		expect(refusalOnStatusLine(refusal, restarted)).toBe(null);
		// In the same window, still running (the grace), it stays.
		expect(refusalOnStatusLine(refusal, { ...restarted, quizStartedAt: STARTED_AT })).toBe(
			"Die Zeit für diese Frage ist vorbei",
		);
	});

	test("an ended question or another slide shows no refusal", () => {
		const refusal = refusedByServer("quiz-window-closed", "q1", STARTED_AT);
		const now = { slideId: "q1", quizOver: true, participationOpen: true, quizStartedAt: STARTED_AT };
		expect(refusalOnStatusLine(refusal, now)).toBe(null);
		expect(refusalOnStatusLine(refusal, { ...now, slideId: "q2", quizOver: false })).toBe(null);
		expect(refusalOnStatusLine(null, now)).toBe(null);
	});

	test("the slide view stores the kind and window and derives its line through the rule", () => {
		const source = readFileSync(join(import.meta.dir, "ParticipantSlideView.tsx"), "utf8");
		expect(source).toContain(
			'reportRefusal(participationLabels.closed, "participation-closed");',
		);
		expect(source).toContain(
			"setRefusal({ slideId: slide.id, code, message, quizStartedAt });",
		);
		expect(source).toMatch(
			/const refusalShown = refusalOnStatusLine\(refusal, \{\s*slideId: slide\.id,\s*quizOver,\s*participationOpen,\s*quizStartedAt,\s*\}\);/,
		);
	});
});

describe("an answer the deck moved on under keeps the participant in the deck (REQ236)", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	/** What the vote route says for each, and what a German deck's phone reads. */
	const MOVED_ON: Record<DeckMovedOnCode, { error: string; notice: string }> = {
		"presentation-not-live": {
			error: "Cannot vote – this presentation is not live",
			notice:
				"Deine Antwort wurde nicht angenommen: Die Präsentation nimmt keine Antworten mehr an",
		},
		"slide-not-found": {
			error: "Cannot vote – this slide is no longer in the presentation",
			notice:
				"Deine Antwort wurde nicht angenommen: Diese Frage wurde aus der Präsentation entfernt",
		},
	};

	/**
	 * The server after the room moved on: the vote route answers with `refused`,
	 * and the join lookup — what the page re-reads to catch up — with `deck`.
	 */
	function serverAfter(refused: DeckMovedOnCode, deck: Presentation) {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			const body = url.includes("/vote")
				? { error: MOVED_ON[refused].error, refused }
				: deck;
			return new Response(JSON.stringify(body), {
				status: url.includes("/vote") ? 400 : 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;
	}

	/**
	 * Answer on the live page as it is wired: a moved-on answer catches the
	 * store's deck up (`onDeckMovedOn` → `catchUpWithRoom`) and is noticed in
	 * the deck's language; anything else goes to `setError`, which is what draws
	 * the page's error screen.
	 */
	async function answerOnLivePage(
		store: ReturnType<typeof createAppStore>,
		slideId: string,
	) {
		const notices: string[] = [];
		let catchingUp: Promise<void> = Promise.resolve();
		await liveVoteTransport("deck", "phone")
			.vote({ slideId, value: "mars" })
			.catch((thrown: unknown) =>
				routeSubmissionFailure(thrown, getDict("de"), {
					refused: () => {},
					movedOn: (message) => {
						notices.push(message);
						catchingUp = store.getState().catchUpWithRoom("123456");
					},
					failed: store.getState().setError,
				}),
			);
		await catchingUp;
		return { pageError: store.getState().error, notices };
	}

	test("D1 — the presenter ended the deck mid-flight: the room's ended screen, not an error", async () => {
		const store = createAppStore();
		store.getState().setPresentation(liveDeck(SELECT_QUIZ, RUNNING, { language: "de" }));
		// The `ended` frame lands before the refused answer comes back, as it did
		// in the re-test.
		store.getState().applyEnded({ endedAt: new Date().toISOString() });
		serverAfter(
			"presentation-not-live",
			liveDeck(SELECT_QUIZ, RUNNING, { language: "de", status: "ended" }),
		);

		const outcome = await answerOnLivePage(store, SELECT_QUIZ.id);
		expect(outcome.pageError).toBe("");
		expect(outcome.notices).toEqual([MOVED_ON["presentation-not-live"].notice]);
		expect(store.getState().presentation?.status).toBe("ended");
	});

	test("the ended frame was missed: the refusal itself brings the phone to the ended screen", async () => {
		const store = createAppStore();
		store.getState().setPresentation(liveDeck(SELECT_QUIZ, RUNNING, { language: "de" }));
		serverAfter(
			"presentation-not-live",
			liveDeck(SELECT_QUIZ, RUNNING, { language: "de", status: "ended" }),
		);

		const outcome = await answerOnLivePage(store, SELECT_QUIZ.id);
		expect(outcome.pageError).toBe("");
		expect(store.getState().presentation?.status).toBe("ended");
	});

	test("the slide was deleted mid-flight: the deck as it stands now, and a notice", async () => {
		const store = createAppStore();
		store.getState().setPresentation(
			liveDeck(SELECT_QUIZ, RUNNING, {
				language: "de",
				slides: [SELECT_QUIZ, TYPED_QUIZ],
			}),
		);
		serverAfter(
			"slide-not-found",
			liveDeck(TYPED_QUIZ, RUNNING, { language: "de", slides: [TYPED_QUIZ] }),
		);

		const outcome = await answerOnLivePage(store, SELECT_QUIZ.id);
		expect(outcome.pageError).toBe("");
		expect(outcome.notices).toEqual([MOVED_ON["slide-not-found"].notice]);
		const deck = store.getState().presentation as Presentation;
		expect(deck.status).toBe("live");
		expect(deck.slides.map((slide) => slide.id)).toEqual([TYPED_QUIZ.id]);
		expect(deck.slides[deck.activeSlideIndex ?? 0]?.id).toBe(TYPED_QUIZ.id);
	});

	test("the notice is the deck's language, never the route's English", () => {
		for (const refused of Object.keys(MOVED_ON) as DeckMovedOnCode[]) {
			const notices: string[] = [];
			routeSubmissionFailure(
				new ApiError(MOVED_ON[refused].error, null, 400, null, refused),
				getDict("de"),
				{
					refused: () => {},
					movedOn: (message) => notices.push(message),
					failed: () => {},
				},
			);
			expect(notices).toEqual([MOVED_ON[refused].notice]);
		}
	});

	test("the live page catches up on a moved-on answer, and the slide view toasts it", () => {
		const source = readFileSync(join(import.meta.dir, "ParticipantSlideView.tsx"), "utf8");
		expect(source).toMatch(
			/const reportMovedOn = \(message: string\) => \{\s*onDeckMovedOn\(\);\s*addToast\(message, "info"\);/,
		);
		expect(source).toContain("movedOn: reportMovedOn,");
		const page = readFileSync(join(import.meta.dir, "..", "pages", "ParticipantPage.tsx"), "utf8");
		expect(page).toContain("onDeckMovedOn={() => catchUpWithRoom(code)}");
	});
});
