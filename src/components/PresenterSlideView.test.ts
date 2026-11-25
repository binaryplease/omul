/**
 * The shared screen while a quiz question is being answered (REQ214).
 *
 * The presenter page is what gets projected, and it is held by an editor, so the
 * tally in its hands carries the answer key and every option's count even while
 * the room is still deciding. What is asserted here is that none of it reaches
 * the screen until the question is over: the question, its countdown and how
 * many have answered — and then, once the window has closed (or the slide was
 * closed to answers), the results on the slide's own reveal setting.
 *
 * Rendered to static markup with React's server renderer, which needs no DOM.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PresentationSchema } from "../../server/schemas";
import type { Presentation, Slide } from "../types";
import { createAppStore } from "../store/store";
import {
	QUIZ_TIMER_DECK_ENDED_REASON,
	QUIZ_TIMER_NOT_LIVE_REASON,
	quizTimerUnavailableReason,
} from "../types";
import {
	PresenterSlideView,
	quizTimerControlFor,
	RESTART_TIMER_HINT,
	routeTimerFailure,
	START_TIMER_HINT,
} from "./PresenterSlideView";

const SELECT_QUIZ: Slide = {
	id: "q1",
	type: "quiz",
	question: "Which planet is closest to the sun?",
	timeLimit: 30,
	options: [
		{ id: "mercury", text: "Mercury", isCorrect: true },
		{ id: "mars", text: "Mars" },
	],
};

const TYPED_QUIZ: Slide = {
	id: "q2",
	type: "quiz",
	question: "Which is the largest ocean on Earth?",
	timeLimit: 30,
	quizAnswerMode: "type",
	quizAnswers: [
		{ id: "pacific", text: "Pacific" },
		{ id: "pacific-ocean", text: "Pacific Ocean" },
	],
};

/** What the editor's authenticated poll hands the shared screen for SELECT_QUIZ. */
const SELECT_TALLY = {
	type: "quiz",
	answerMode: "select",
	totalVotes: 2,
	respondentCount: 2,
	maxSelections: 1,
	typedAnswers: null,
	scoring: {
		answeredCount: 2,
		correctCount: 1,
		totalPoints: 836,
		maxPoints: 1000,
		averagePoints: 418,
		correctShare: 0.5,
	},
	options: [
		{ id: "mercury", text: "Mercury", count: 1, isCorrect: true },
		{ id: "mars", text: "Mars", count: 1, isCorrect: false },
	],
};

/** The same for TYPED_QUIZ — the editor reads the key and the groups throughout. */
const TYPED_TALLY = {
	...SELECT_TALLY,
	answerMode: "type",
	options: [],
	typedAnswers: {
		accepted: ["Pacific", "Pacific Ocean"],
		entries: [{ text: "Pacific", count: 2, isCorrect: true }],
		distinctCount: 1,
	},
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

function sharedScreen(slide: Slide, pres: Presentation, results: unknown) {
	return renderToStaticMarkup(
		createElement(PresenterSlideView, {
			slide,
			pres,
			results,
			serverClockOffsetMs: 0,
			controls: {
				canControl: true,
				onReveal: () => {},
				onRestartTimer: () => {},
				onSetParticipation: null,
				onSetCountdown: null,
				onDeleteAnswer: null,
				audioCue: null,
			},
			joinUrl: "http://localhost/join/123456",
		}),
	);
}

/** The opening tag of the button named `label`. */
function buttonNamed(markup: string, label: string): string {
	const tag = markup
		.match(/<button[^>]*>/g)
		?.find((candidate) => candidate.includes(`aria-label="${label}"`));
	if (!tag) throw new Error(`no button named "${label}"`);
	return tag;
}

/**
 * What the button named `label` is described by (`aria-describedby`): the
 * element's text, and whether it is the reason tip (`role="tooltip"`) or a
 * screen-reader-only hint.
 */
function describedBy(
	markup: string,
	label: string,
): { text: string; tip: boolean } | null {
	const id = buttonNamed(markup, label).match(/aria-describedby="([^"]+)"/)?.[1];
	if (!id) return null;
	const element = markup.match(
		new RegExp(`<span id="${id}"([^>]*)>([^<]*)</span>`),
	);
	if (!element) return null;
	const attributes = element[1] ?? "";
	return {
		text: element[2] ?? "",
		tip: attributes.includes('role="tooltip"'),
	};
}

/**
 * The timer control while unavailable (ADR-0025): a focusable
 * button marked `aria-disabled`, its reason in the tip a hover, focus or tap
 * shows — never only in a `title`, which no touch screen shows.
 */
function expectTimerExplained(markup: string, label: string, reason: string) {
	const button = buttonNamed(markup, label);
	expect(button).not.toContain(" disabled=");
	expect(button).toContain('aria-disabled="true"');
	expect(button).not.toContain("title=");
	expect(describedBy(markup, label)).toEqual({ text: reason, tip: true });
}

/** The timer control while available: usable, its hint tooltipped and described. */
function expectTimerHinted(markup: string, label: string, hint: string) {
	const button = buttonNamed(markup, label);
	expect(button).toContain('aria-disabled="false"');
	expect(button).toContain(`title="${hint}"`);
	expect(describedBy(markup, label)).toEqual({ text: hint, tip: false });
}

/** Five seconds in: the window is open. */
const RUNNING = 5_000;
/** A minute in: the 30-second window and its grace are long gone. */
const OVER = 60_000;

describe("the shared screen while a quiz question runs (REQ214)", () => {
	test("a choice question shows its countdown and response count, and no answer", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING),
			SELECT_TALLY,
		);
		expect(markup).toContain("s left");
		expect(markup).toContain("2 responses");
		expect(markup).toContain("Results appear when the time is up.");
		// No correct mark, no bars to copy the majority off, no score line.
		expect(markup).not.toContain("correct</span>");
		expect(markup).not.toContain("Mercury");
		expect(markup).not.toContain("Mars");
		expect(markup).not.toContain("answered correctly");
	});

	test("a typed question shows neither the accepted answers nor what the room typed", () => {
		const markup = sharedScreen(
			TYPED_QUIZ,
			liveDeck(TYPED_QUIZ, RUNNING),
			TYPED_TALLY,
		);
		expect(markup).toContain("s left");
		expect(markup).not.toContain("Accepted:");
		expect(markup).not.toContain("Pacific");
		expect(markup).not.toContain("answered correctly");
	});

	test("an untimed question waits for the presenter to close it", () => {
		const untimed = { ...SELECT_QUIZ, timeLimit: 0 };
		const markup = sharedScreen(untimed, liveDeck(untimed, OVER), SELECT_TALLY);
		expect(markup).toContain(
			"Results appear once the question is closed to answers.",
		);
		expect(markup).not.toContain("Mercury");
	});
});

describe("the shared screen before a quiz question is asked (REQ216)", () => {
	test("a draft deck says to start the presentation, not that the question is being answered", () => {
		const draft = PresentationSchema.parse({
			id: "deck",
			code: "123456",
			title: "Quiz round",
			slides: [SELECT_QUIZ],
			status: "draft",
			createdAt: "2026-10-30T09:00:00.000Z",
		}) as Presentation;
		const markup = sharedScreen(SELECT_QUIZ, draft, null);
		expect(markup).toContain("Start the presentation to collect responses");
		expect(markup).not.toContain("Results appear");
	});
});

describe("the shared screen once a quiz question is over (REQ214)", () => {
	test("Instant shows the results and the solution when the window has closed", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER),
			SELECT_TALLY,
		);
		expect(markup).toContain("Time&#x27;s up");
		expect(markup).toContain("Mercury");
		expect(markup).toContain("correct</span>");
		expect(markup).toContain("answered correctly");
	});

	test("Instant shows a typed question's key and answers when the window has closed", () => {
		const markup = sharedScreen(
			TYPED_QUIZ,
			liveDeck(TYPED_QUIZ, OVER),
			TYPED_TALLY,
		);
		expect(markup).toContain("Accepted: Pacific · Pacific Ocean");
	});

	test("closing the question to answers ends it, with time still on the clock", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING, {
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date().toISOString() },
			}),
			SELECT_TALLY,
		);
		expect(markup).toContain("Mercury");
		expect(markup).toContain("correct</span>");
	});

	test("a question closed before it opened shows no result (REQ216)", () => {
		// Closing ahead of time ended nothing: the presenter will reopen it, and the
		// room must not be shown the answer first.
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING, {
				closedSlideIds: ["q1"],
				slideClosedAt: { q1: new Date(Date.now() - 60_000).toISOString() },
			}),
			SELECT_TALLY,
		);
		expect(markup).not.toContain("correct</span>");
	});

	test("Private keeps them off the shared screen even then", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, { resultsVisibility: "private" }),
			SELECT_TALLY,
		);
		expect(markup).toContain("Results are private");
		expect(markup).not.toContain("Mercury");
	});

	test("On click still waits for the presenter's reveal", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, { resultsVisibility: "on-click" }),
			SELECT_TALLY,
		);
		expect(markup).toContain("Reveal results");
		expect(markup).not.toContain("Mercury");
	});
});

describe("a plain choice slide with a marked option (REQ013)", () => {
	test("is not a quiz, and keeps showing its tally and solution as answers land", () => {
		const poll: Slide = {
			...SELECT_QUIZ,
			type: "multiple-choice",
			timeLimit: undefined,
		};
		const markup = sharedScreen(poll, liveDeck(poll, RUNNING), {
			...SELECT_TALLY,
			type: "multiple-choice",
			scoring: null,
		});
		expect(markup).toContain("Mercury");
		expect(markup).toContain("correct</span>");
	});
});

describe("restarting a quiz question's timer (REQ217)", () => {
	test("states that answers already given keep their points", () => {
		const markup = sharedScreen(SELECT_QUIZ, liveDeck(SELECT_QUIZ, OVER), SELECT_TALLY);
		// The tooltip and the accessible description say the same thing, and the
		// button's name stays the words on it.
		expectTimerHinted(markup, "Restart timer", RESTART_TIMER_HINT);
		expect(markup).toContain(">Restart timer</button>");
		// A restart is a correction: the quiet link, not the primary action.
		expect(buttonNamed(markup, "Restart timer")).not.toContain("btn-primary");
		expect(RESTART_TIMER_HINT).toContain("answers already given keep their points");
		expect(RESTART_TIMER_HINT).toContain("who have not answered");
	});
});

describe("a quiz question waiting at go-live (REQ226)", () => {
	/** The deck has just gone live on the quiz; nobody has started its timer. */
	const waiting = (overrides: Record<string, unknown> = {}) =>
		liveDeck(SELECT_QUIZ, RUNNING, { slideStartedAt: {}, ...overrides });

	test("offers Start timer, not Restart timer, and says so to the room", () => {
		const markup = sharedScreen(SELECT_QUIZ, waiting(), SELECT_TALLY);
		expect(markup).toContain("Start timer");
		expect(markup).not.toContain("Restart timer");
		expectTimerHinted(markup, "Start timer", START_TIMER_HINT);
		// Starting is the one thing left to do, so it wears the primary action
		// and the play icon.
		const button = buttonNamed(markup, "Start timer");
		expect(button).toContain("btn-primary inline-flex");
		expect(markup).toMatch(/lucide-play[^>]*>.*Start timer<\/button>/);
		expect(markup).toContain("Waiting for the presenter to start this question");
		// No countdown runs before the window does.
		expect(markup).not.toContain("s left");
		expect(markup).not.toContain("Time&#x27;s up");
	});

	test("shows nothing of the result while it waits", () => {
		// "Not opened" must not read as "over": that would put the key on the
		// projector before anybody had been asked.
		const markup = sharedScreen(SELECT_QUIZ, waiting(), SELECT_TALLY);
		expect(markup).not.toContain("correct</span>");
		expect(markup).toContain("Results appear when the time is up.");
	});

	test("the room's line is in the deck's language; the control stays the app's", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			waiting({ language: "de" }),
			SELECT_TALLY,
		);
		expect(markup).toContain("Warten, bis diese Frage gestartet wird");
		expect(markup).toContain("Start timer");
	});

	test("once started, the control is a restart again", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING),
			SELECT_TALLY,
		);
		expect(markup).toContain("Restart timer");
		expect(markup).not.toContain("Start timer<");
		expect(quizTimerControlFor(true).confirmation).toBe("Question timer started");
		expect(quizTimerControlFor(false).confirmation).toBe(
			"Question timer restarted",
		);
	});

	test("one the presenter has also closed says closed, as the phones do", () => {
		// Starting the timer does not reopen a closed slide, so "waiting" would
		// promise the room something that will not come.
		const markup = sharedScreen(
			SELECT_QUIZ,
			waiting({ closedSlideIds: ["q1"] }),
			SELECT_TALLY,
		);
		expect(markup).toContain("The presenter has closed this question");
		expect(markup).not.toContain("Waiting for the presenter to start");
		expect(markup).not.toContain("btn-primary inline-flex");
	});
});

describe("the timer control before the deck is live (REQ227)", () => {
	const draft = (overrides: Record<string, unknown> = {}) =>
		PresentationSchema.parse({
			id: "deck",
			code: "123456",
			title: "Quiz round",
			slides: [SELECT_QUIZ],
			status: "draft",
			createdAt: "2026-10-30T09:00:00.000Z",
			...overrides,
		}) as Presentation;

	test("is drawn disabled with its reason on a draft, never hidden", () => {
		const markup = sharedScreen(SELECT_QUIZ, draft(), null);
		expect(markup).toContain("Restart timer");
		expectTimerExplained(markup, "Restart timer", QUIZ_TIMER_NOT_LIVE_REASON);
	});

	test("is disabled on an ended deck too, saying it has ended (REQ237)", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, { status: "ended" }),
			SELECT_TALLY,
		);
		expectTimerExplained(markup, "Restart timer", QUIZ_TIMER_DECK_ENDED_REASON);
		expect(markup).not.toContain(QUIZ_TIMER_NOT_LIVE_REASON);
	});

	test("stays usable on a live deck and on a survey draft", () => {
		const live = sharedScreen(SELECT_QUIZ, liveDeck(SELECT_QUIZ, OVER), SELECT_TALLY);
		expectTimerHinted(live, "Restart timer", RESTART_TIMER_HINT);
		const survey = sharedScreen(SELECT_QUIZ, draft({ mode: "survey" }), null);
		expectTimerHinted(survey, "Restart timer", RESTART_TIMER_HINT);
		expect(survey).not.toContain(QUIZ_TIMER_NOT_LIVE_REASON);
	});

	test("the reason is the one the endpoint refuses with", () => {
		expect(quizTimerUnavailableReason({ status: "draft", mode: "live" })).toBe(
			QUIZ_TIMER_NOT_LIVE_REASON,
		);
		expect(quizTimerUnavailableReason({ status: "ended", mode: "live" })).toBe(
			QUIZ_TIMER_DECK_ENDED_REASON,
		);
		expect(quizTimerUnavailableReason({ status: "live", mode: "live" })).toBeNull();
		expect(
			quizTimerUnavailableReason({ status: "draft", mode: "survey" }),
		).toBeNull();
	});
});

// ── A timer start refused on a screen that missed the deck ending (REQ237) ─
//
// Re-Test D: a second editor whose screen still showed the deck live after it
// ended clicked "Restart timer", got the 409, and the whole presenter view gave
// way to "Start the presentation first …". The failure is routed as the page
// routes it, against a store answering the way the server does.

/**
 * Stand in for the server: the timer call refuses with `presentation-not-live`,
 * and the deck read answers with the deck as it really stands. The refusal's
 * prose is the draft wording the server sent before REQ237, so the notice is
 * seen to come from the state caught up to, not from that prose.
 */
function stubStaleScreenServer(realDeck: Presentation) {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input instanceof Request ? input.url : input);
		const refused = url.endsWith("/timer");
		return new Response(
			JSON.stringify(
				refused
					? { error: QUIZ_TIMER_NOT_LIVE_REASON, refused: "presentation-not-live" }
					: realDeck,
			),
			{ status: refused ? 409 : 200, headers: { "Content-Type": "application/json" } },
		);
	}) as unknown as typeof fetch;
}

/** Click the timer on the store's deck and route the failure as PresenterPage does. */
async function clickTimer(store: ReturnType<typeof createAppStore>) {
	const notices: string[] = [];
	try {
		await store.getState().restartSlideTimer("deck", "q1");
	} catch (timerError) {
		await routeTimerFailure(timerError, {
			catchUp: () => store.getState().catchUpPresenterDeck("deck"),
			notice: (message) => notices.push(message),
			failed: store.getState().setError,
		});
	}
	return notices;
}

describe("a timer refused on a screen behind the deck (REQ237)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("a deck that ended: the view stays, catches up, and says it has ended", async () => {
		const store = createAppStore();
		store.getState().setPresentation(liveDeck(SELECT_QUIZ, OVER));
		stubStaleScreenServer(
			liveDeck(SELECT_QUIZ, OVER, {
				status: "ended",
				sessionEndedAt: "2026-10-30T10:00:00.000Z",
			}),
		);
		const notices = await clickTimer(store);
		const { presentation, error } = store.getState();
		expect(error).toBe("");
		expect(presentation?.status).toBe("ended");
		expect(presentation?.sessionEndedAt).toBe("2026-10-30T10:00:00.000Z");
		expect(notices).toEqual([QUIZ_TIMER_DECK_ENDED_REASON]);
		const markup = sharedScreen(SELECT_QUIZ, presentation as Presentation, SELECT_TALLY);
		expectTimerExplained(markup, "Restart timer", QUIZ_TIMER_DECK_ENDED_REASON);
	});

	test("a deck that was reset: the view catches up to the draft and keeps the draft wording", async () => {
		const store = createAppStore();
		store.getState().setPresentation(liveDeck(SELECT_QUIZ, OVER));
		stubStaleScreenServer(liveDeck(SELECT_QUIZ, OVER, { status: "draft", slideStartedAt: {} }));
		const notices = await clickTimer(store);
		const { presentation, error } = store.getState();
		expect(error).toBe("");
		expect(presentation?.status).toBe("draft");
		expect(presentation?.slideStartedAt).toEqual({});
		expect(notices).toEqual([QUIZ_TIMER_NOT_LIVE_REASON]);
	});

	test("any other failure keeps the page's error path", async () => {
		const store = createAppStore();
		store.getState().setPresentation(liveDeck(SELECT_QUIZ, OVER));
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: "Not found" }), {
				status: 404,
			})) as unknown as typeof fetch;
		const notices = await clickTimer(store);
		expect(notices).toEqual([]);
		expect(store.getState().error).toBe("Not found");
	});

	test("a frame that lands while the deck is re-read wins", async () => {
		const store = createAppStore();
		store.getState().setPresentation(liveDeck(SELECT_QUIZ, OVER));
		stubStaleScreenServer(liveDeck(SELECT_QUIZ, OVER, { status: "ended" }));
		const catchingUp = store.getState().catchUpPresenterDeck("deck");
		// Meanwhile a reset reaches the screen: newer than the read's "ended".
		store.getState().applyReset();
		const deck = await catchingUp;
		expect(deck?.status).toBe("draft");
		expect(store.getState().presentation?.status).toBe("draft");
	});
});

describe("the shared screen in the deck's language (REQ225)", () => {
	const GERMAN = { language: "de" };

	test("a running question's countdown, count and waiting line are the deck's", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, RUNNING, GERMAN),
			SELECT_TALLY,
		);
		expect(markup).toContain("s übrig");
		expect(markup).toContain("2 Antworten");
		expect(markup).toContain(
			"Die Ergebnisse erscheinen, wenn die Zeit abgelaufen ist.",
		);
		expect(markup).not.toContain("s left");
		expect(markup).not.toContain("2 responses");
	});

	test("a finished choice question's solution mark and score note are the deck's", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, GERMAN),
			SELECT_TALLY,
		);
		expect(markup).toContain("Zeit abgelaufen");
		expect(markup).toContain("richtig</span>");
		expect(markup).toContain("1 von 2");
		expect(markup).toContain("richtig beantwortet");
		expect(markup).toContain("im Schnitt 418 von 1000 Punkten");
		expect(markup).not.toContain("correct</span>");
		expect(markup).not.toContain("answered correctly");
		expect(markup).not.toContain("on average");
	});

	test("a finished typed question's key is the deck's", () => {
		const markup = sharedScreen(
			TYPED_QUIZ,
			liveDeck(TYPED_QUIZ, OVER, GERMAN),
			TYPED_TALLY,
		);
		expect(markup).toContain("Akzeptiert: Pacific · Pacific Ocean");
		expect(markup).not.toContain("Accepted:");
	});

	test("the presenter's own controls stay in the app's language", () => {
		const markup = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, GERMAN),
			SELECT_TALLY,
		);
		expect(markup).toContain("Restart timer");
		expectTimerHinted(markup, "Restart timer", RESTART_TIMER_HINT);
		expect(markup).toContain("Show results as counts or percentages");
		const onClick = sharedScreen(
			SELECT_QUIZ,
			liveDeck(SELECT_QUIZ, OVER, { ...GERMAN, resultsVisibility: "on-click" }),
			SELECT_TALLY,
		);
		expect(onClick).toContain("Ergebnisse ausgeblendet");
		expect(onClick).toContain("Reveal results");
	});

	test("a leaderboard's caption and nameless rows are the deck's", () => {
		const board: Slide = { id: "lb", type: "leaderboard", question: "" };
		const markup = sharedScreen(board, liveDeck(board, OVER, GERMAN), {
			type: "leaderboard",
			quizCount: 1,
			maxPoints: 1000,
			rankedCount: 1,
			size: 5,
			entries: [
				{
					rank: 1,
					entryId: "db5452aa01",
					label: "Player DB5452",
					totalPoints: 0,
					correctCount: 0,
					answeredCount: 1,
				},
			],
		});
		expect(markup).toContain("Bestenliste");
		expect(markup).toContain("Top 1 aus 1 Quizfrage");
		expect(markup).toContain("Spieler DB5452");
		expect(markup).toContain("0 / 1 richtig");
		expect(markup).toContain(">Punkte<");
		expect(markup).not.toContain("Player DB5452");
		expect(markup).not.toContain("across");
	});
});
