/**
 * Unit tests for the session slice — the live-runtime WebSocket reducers that
 * used to be duplicated across PresenterPage and ParticipantPage.
 *
 * Each test creates its own store via the factory, so module-singleton state
 * never bleeds between tests (the isolation strategy from the triage decision).
 * The reducers are pure, so we can seed a presentation, apply an event, and
 * assert the new state without any DOM, React, or WebSocket.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Presentation } from "../types";
import { slideAcceptsSubmissions } from "../types";
import { clockOffsetFrom } from "./session";
import { createAppStore } from "./store";

/** Two instants a deck's questions could have been opened at (REQ057). */
const FIRST_OPENED = "2026-01-01T12:00:00.000Z";
const SECOND_OPENED = "2026-01-01T12:00:30.000Z";

/** A minimal live presentation, enough to exercise the reducers. */
function makePresentation(overrides: Partial<Presentation> = {}): Presentation {
	return {
		id: "pres-1",
		code: "123456",
		title: "Test",
		status: "live",
		activeSlideIndex: 0,
		revealedSlideIds: [],
		slides: [
			{ id: "slide-a", type: "multiple-choice", question: "A" },
			{ id: "slide-b", type: "multiple-choice", question: "B" },
		],
		createdAt: new Date(0).toISOString(),
		mode: "live",
		language: "en",
		...overrides,
	} as Presentation;
}

/** A store seeded with a loaded presentation. */
function seededStore(overrides: Partial<Presentation> = {}) {
	const store = createAppStore();
	store.getState().setPresentation(makePresentation(overrides));
	return store;
}

describe("session slice — factory isolation", () => {
	test("two stores do not share state", () => {
		const first = createAppStore();
		const second = createAppStore();
		first.getState().setParticipantCount(5);
		expect(first.getState().participantCount).toBe(5);
		expect(second.getState().participantCount).toBe(0);
	});

	test("seeding via createAppStore overrides defaults", () => {
		const store = createAppStore({ participantCount: 42 });
		expect(store.getState().participantCount).toBe(42);
	});
});

describe("session slice — WebSocket reducers", () => {
	test("applySlideChanged updates the active slide index", () => {
		const store = seededStore();
		store.getState().applySlideChanged({ slideIndex: 1 });
		expect(store.getState().presentation?.activeSlideIndex).toBe(1);
	});

	test("applyStarted sets status to live", () => {
		const store = seededStore({ status: "draft" });
		store.getState().applyStarted();
		expect(store.getState().presentation?.status).toBe("live");
	});

	test("applyEnded sets status to ended", () => {
		const store = seededStore();
		store.getState().applyEnded();
		expect(store.getState().presentation?.status).toBe("ended");
	});

	test("applyReset returns to draft, clears index, reveals, and results", () => {
		const store = seededStore({
			status: "live",
			activeSlideIndex: 1,
			revealedSlideIds: ["slide-a"],
		});
		store.getState().setResultsFor("slide-a", { totalVotes: 3 });
		store.getState().applyReset();

		const presentation = store.getState().presentation;
		expect(presentation?.status).toBe("draft");
		expect(presentation?.activeSlideIndex).toBe(0);
		expect(presentation?.revealedSlideIds).toEqual([]);
		expect(store.getState().results).toEqual({});
	});

	test("applyResultsUpdated stores results per slide id", () => {
		const store = seededStore();
		store.getState().applyResultsUpdated({
			slideId: "slide-a",
			results: { totalVotes: 7 },
		});
		store.getState().applyResultsUpdated({
			slideId: "slide-b",
			results: { totalVotes: 2 },
		});
		expect(store.getState().results).toEqual({
			"slide-a": { totalVotes: 7 },
			"slide-b": { totalVotes: 2 },
		});
	});

	test("applyResultsUpdated drops a frame the reveal mode withheld", () => {
		// A withheld frame says "this is not yours to draw", which is not the same
		// as "there is nothing here" (REQ016/REQ017). Storing it would clear a
		// tally the receiving client may separately be entitled to — the
		// presenter's screen, whose credentialed poll reads every tally, is the
		// case that proves it, since one room-wide broadcast per vote would
		// otherwise blank the count under the question between two polls.
		const store = seededStore();
		store.getState().applyResultsUpdated({
			slideId: "slide-a",
			results: { totalVotes: 7 },
		});
		store.getState().applyResultsUpdated({
			slideId: "slide-a",
			results: { type: "multiple-choice", withheld: true },
		});
		expect(store.getState().results).toEqual({ "slide-a": { totalVotes: 7 } });
	});

	test("applyResultsUpdated keeps the editor-only block the frame withholds (REQ027)", () => {
		// The frame is the *room's* copy of the tally — read without `canEdit`
		// because it goes to every phone in the room — so a word cloud's own
		// answers are `null` in it. That is "not in this frame", not "gone": the
		// list is what the presenter's moderation control is pointed at, and
		// letting each vote the room casts blank it would make the control vanish
		// and come back between two polls.
		const store = seededStore();
		store.getState().applyResultsUpdated({
			slideId: "slide-a",
			results: {
				type: "word-cloud",
				totalVotes: 2,
				words: [{ text: "momentum", count: 2 }],
				answers: [
					{ id: "v1", text: "momentum", createdAt: FIRST_OPENED },
					{ id: "v2", text: "Momentum", createdAt: SECOND_OPENED },
				],
			},
		});
		store.getState().applyResultsUpdated({
			slideId: "slide-a",
			results: {
				type: "word-cloud",
				totalVotes: 3,
				words: [{ text: "momentum", count: 3 }],
				answers: null,
			},
		});
		const tally = store.getState().results["slide-a"];
		// The numbers are always the frame's — a fold that kept a stale count
		// would be worse than the flicker it fixes.
		expect(tally.totalVotes).toBe(3);
		expect(tally.answers).toHaveLength(2);
	});

	test("a fresh editor-only block replaces the held one", () => {
		// The credentialed poll (and the delete's own re-read) is what moves the
		// list; the fold only stops a broadcast from clearing it.
		const store = seededStore();
		store.getState().applyResultsUpdated({
			slideId: "slide-a",
			results: { type: "word-cloud", answers: [{ id: "v1" }] },
		});
		store.getState().setResultsFor("slide-a", {
			type: "word-cloud",
			answers: [],
		});
		expect(store.getState().results["slide-a"].answers).toEqual([]);
	});

	test("a frame of another tally type does not inherit the block", () => {
		// A slide whose type was changed under an open screen: the previous type's
		// editor-only list is not this one's, and carrying it across would draw a
		// word cloud's answers under something else.
		const store = seededStore();
		store.getState().applyResultsUpdated({
			slideId: "slide-a",
			results: { type: "word-cloud", answers: [{ id: "v1" }] },
		});
		store.getState().applyResultsUpdated({
			slideId: "slide-a",
			results: { type: "form", submissions: null },
		});
		expect(store.getState().results["slide-a"]).toEqual({
			type: "form",
			submissions: null,
		});
	});

	test("applyDeckResultsVisibility patches the deck's mode (REQ015–REQ018)", () => {
		// The organizer's decision has to reach the room without a reload: a phone
		// told the deck is now `private` stops drawing the tally it was last sent
		// rather than leaving it frozen on screen under a question that is no
		// longer publishing one.
		const store = seededStore({ resultsVisibility: "instant" });
		store.getState().applyDeckResultsVisibility({
			resultsVisibility: "private",
		});
		expect(store.getState().presentation?.resultsVisibility).toBe("private");
	});

	test("applyDeckResultsVisibility leaves the per-slide overrides alone", () => {
		// The frame carries the deck-level setting and says nothing about the
		// overrides, because what became of them depends on which writer sent it:
		// the deck-wide operation (REQ018) clears them, while the editor's ordinary
		// Save may move the deck default with every override left standing.
		// Re-deriving them here would be right for one writer and wrong for the
		// other — it would drop, on this client only, an override the server still
		// holds. The deck re-read the participant surface triggers settles the
		// slides from the server instead.
		const store = seededStore({
			resultsVisibility: "private",
			slides: [
				{
					id: "slide-a",
					type: "multiple-choice",
					question: "A",
					resultsVisibility: "private",
				},
				{ id: "slide-t", type: "text", question: "T" },
			],
		} as Partial<Presentation>);

		store.getState().applyDeckResultsVisibility({
			resultsVisibility: "instant",
		});

		const next = store.getState().presentation;
		expect(next?.resultsVisibility).toBe("instant");
		expect(next?.slides.map((slide) => slide.resultsVisibility)).toEqual([
			"private",
			undefined,
		]);
	});

	test("applyParticipantCount sets the live count", () => {
		const store = seededStore();
		store.getState().applyParticipantCount({ count: 12 });
		expect(store.getState().participantCount).toBe(12);
	});

	test("applyRevealed adds and removes slide ids without duplicates", () => {
		const store = seededStore();
		store.getState().applyRevealed({ slideId: "slide-a", revealed: true });
		store.getState().applyRevealed({ slideId: "slide-a", revealed: true });
		expect(store.getState().presentation?.revealedSlideIds).toEqual([
			"slide-a",
		]);

		store.getState().applyRevealed({ slideId: "slide-a", revealed: false });
		expect(store.getState().presentation?.revealedSlideIds).toEqual([]);
	});

	test("applySlideStarted records when a question opened (REQ057)", () => {
		const store = seededStore({ slideStartedAt: { "slide-a": FIRST_OPENED } });
		store.getState().applySlideStarted({
			slideId: "slide-b",
			startedAt: SECOND_OPENED,
		});
		// The stamp arrives per slide and never disturbs its neighbours: a deck's
		// earlier questions keep the windows their scores were measured against.
		expect(store.getState().presentation?.slideStartedAt).toEqual({
			"slide-a": FIRST_OPENED,
			"slide-b": SECOND_OPENED,
		});
	});

	test("applySlideStarted moves a stamp when the presenter reopens a question", () => {
		const store = seededStore({ slideStartedAt: { "slide-a": FIRST_OPENED } });
		store.getState().applySlideStarted({
			slideId: "slide-a",
			startedAt: SECOND_OPENED,
		});
		expect(store.getState().presentation?.slideStartedAt).toEqual({
			"slide-a": SECOND_OPENED,
		});
	});

	test("applyReset clears the windows along with the votes they timed", () => {
		const store = seededStore({ slideStartedAt: { "slide-a": FIRST_OPENED } });
		store.getState().setResultsFor("slide-a", { totalVotes: 3 });
		store.getState().applyReset();
		// A re-run opens every question afresh; keeping the old stamps would open
		// the deck with every countdown already expired.
		expect(store.getState().presentation?.slideStartedAt).toEqual({});
		expect(store.getState().results).toEqual({});
	});

	test("reducers are no-ops when no presentation is loaded", () => {
		const store = createAppStore();
		store.getState().applySlideChanged({ slideIndex: 3 });
		store.getState().applyStarted();
		store.getState().applyRevealed({ slideId: "x", revealed: true });
		store
			.getState()
			.applySlideStarted({ slideId: "x", startedAt: FIRST_OPENED });
		expect(store.getState().presentation).toBeNull();
	});
});

// ── Re-reading the deck a reveal changed (REQ053) ──────────────
//
// The regression this suite exists for: a reveal moves `revealedSlideIds`, but a
// Pin on Image slide's target area was stripped from the audience's deck on the
// server (`withAudienceSolutions`) and the deck is fetched once, at join. Without
// a re-read the participant's canvas would draw `pinArea: null` forever — the
// room would watch the target appear in the aggregate while nobody was told
// anything about their own pin.

/** The target area a revealed pin slide comes back carrying. */
const TARGET_AREA = { x: 400, y: 300, width: 200, height: 150 };

/** Stand in for the join endpoint, and report whether it was asked. */
function stubJoinFetch(body: unknown): { calls: () => number } {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return { calls: () => calls };
}

describe("session slice — refreshDeckSlides (REQ053)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("a re-read hands the participant the revealed target area", async () => {
		const store = seededStore({
			slides: [{ id: "pn", type: "pin-image", question: "Where?", pinArea: null }],
			revealedSlideIds: ["pn"],
		});
		stubJoinFetch({
			slides: [
				{ id: "pn", type: "pin-image", question: "Where?", pinArea: TARGET_AREA },
			],
		});

		await store.getState().refreshDeckSlides("123456");
		expect(store.getState().presentation?.slides[0].pinArea).toEqual(TARGET_AREA);
	});

	test("hiding a slide again re-strips the target the server withholds", async () => {
		// The mirror case, and the one that matters for the answer key: un-revealing
		// must take the target back off every participant's picture, not leave the
		// last revealed copy sitting in the client.
		const store = seededStore({
			slides: [
				{ id: "pn", type: "pin-image", question: "Where?", pinArea: TARGET_AREA },
			],
		});
		stubJoinFetch({
			slides: [{ id: "pn", type: "pin-image", question: "Where?", pinArea: null }],
		});

		await store.getState().refreshDeckSlides("123456");
		expect(store.getState().presentation?.slides[0].pinArea).toBe(null);
	});

	test("only the slides move — the runtime state the socket owns is untouched", async () => {
		const store = seededStore({
			activeSlideIndex: 1,
			revealedSlideIds: ["slide-b"],
			slideStartedAt: { "slide-b": FIRST_OPENED },
		});
		stubJoinFetch({
			// A response that raced a broadcast: it still reports slide 0, an empty
			// reveal set and no stamps. None of that may overwrite what the socket
			// has already applied.
			slides: [{ id: "slide-a", type: "multiple-choice", question: "A" }],
			activeSlideIndex: 0,
			status: "draft",
			revealedSlideIds: [],
			slideStartedAt: {},
		});

		await store.getState().refreshDeckSlides("123456");
		const pres = store.getState().presentation;
		expect(pres?.slides).toHaveLength(1);
		expect(pres?.activeSlideIndex).toBe(1);
		expect(pres?.status).toBe("live");
		expect(pres?.revealedSlideIds).toEqual(["slide-b"]);
		expect(pres?.slideStartedAt).toEqual({ "slide-b": FIRST_OPENED });
	});

	test("it never raises `loading` — the participant's screen must not blank", async () => {
		// The page renders a spinner in place of the slide while `loading` is true,
		// so re-using the join loader here would flash every phone in the room on
		// each reveal.
		const store = seededStore();
		stubJoinFetch({ slides: [] });
		const pending = store.getState().refreshDeckSlides("123456");
		expect(store.getState().loading).toBe(false);
		await pending;
		expect(store.getState().loading).toBe(false);
	});

	test("a failed re-read leaves the deck as it was, and says nothing", async () => {
		// Failing closed: the withheld target stays withheld, and an error banner
		// over a working screen would be worse than the missing outline.
		const store = seededStore({
			slides: [{ id: "pn", type: "pin-image", question: "Where?", pinArea: null }],
		});
		globalThis.fetch = (() => {
			throw new Error("offline");
		}) as unknown as typeof fetch;

		await store.getState().refreshDeckSlides("123456");
		expect(store.getState().presentation?.slides[0].pinArea).toBe(null);
		expect(store.getState().error).toBe("");
	});

	test("a response with no slides at all changes nothing", async () => {
		const store = seededStore();
		stubJoinFetch({ error: "Presentation not found" });
		await store.getState().refreshDeckSlides("123456");
		expect(store.getState().presentation?.slides).toHaveLength(2);
	});

	test("a response the reveal set has moved past is discarded", async () => {
		// Two reveals in quick succession put two fetches in flight, each answering
		// with the projection as it stood when it was asked. Letting the first land
		// late would re-strip a target that is currently revealed — the answer key
		// disappearing from the room's screens for no reason they could see.
		const store = seededStore({
			slides: [
				{ id: "pn", type: "pin-image", question: "Where?", pinArea: TARGET_AREA },
			],
			revealedSlideIds: ["pn"],
		});
		// Initialised to a no-op rather than null so its type stays callable: the
		// assignment below happens inside a callback the compiler cannot follow.
		let release: () => void = () => {};
		globalThis.fetch = (async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return new Response(
				JSON.stringify({
					slides: [
						{ id: "pn", type: "pin-image", question: "Where?", pinArea: null },
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const inFlight = store.getState().refreshDeckSlides("123456");
		// The presenter reveals another slide while that request is out.
		store.getState().applyRevealed({ slideId: "other", revealed: true });
		release();
		await inFlight;

		expect(store.getState().presentation?.slides[0].pinArea).toEqual(TARGET_AREA);
	});

	test("it does not fetch before a deck has been joined", async () => {
		const store = createAppStore();
		const join = stubJoinFetch({ slides: [] });
		await store.getState().refreshDeckSlides("123456");
		expect(join.calls()).toBe(0);
		expect(store.getState().presentation).toBeNull();
	});
});

describe("session slice — server clock offset (REQ057)", () => {
	test("reads the offset a fetch response's serverNow implies", () => {
		// A quiz deadline is written on the server's clock, so a browser two
		// minutes behind has to render its countdown two minutes ahead of its own.
		const receivedAt = Date.parse("2026-01-01T12:00:00.000Z");
		expect(
			clockOffsetFrom("2026-01-01T12:02:00.000Z", receivedAt, 0),
		).toBe(120_000);
		expect(clockOffsetFrom("2026-01-01T11:58:00.000Z", receivedAt, 0)).toBe(
			-120_000,
		);
	});

	test("a response without a usable serverNow leaves the offset standing", () => {
		// Better the last measured offset than a fresh guess of zero.
		expect(clockOffsetFrom(undefined, Date.now(), 4_000)).toBe(4_000);
		expect(clockOffsetFrom(42, Date.now(), 4_000)).toBe(4_000);
		expect(clockOffsetFrom("not a date", Date.now(), 4_000)).toBe(4_000);
	});
});

describe("session slice — resetSession", () => {
	test("clears presentation, results, and counts", () => {
		const store = seededStore();
		store.getState().setParticipantCount(9);
		store.getState().setResultsFor("slide-a", { totalVotes: 1 });
		store.getState().resetSession();

		expect(store.getState().presentation).toBeNull();
		expect(store.getState().results).toEqual({});
		expect(store.getState().participantCount).toBe(0);
	});
});

// ── Participant channels: reactions and live chat (REQ077, REQ078) ────
//
// Three frames, three shapes, and the differences are the design: the channel
// settings patch the deck (they are already on the public document every phone
// holds), a chat message bumps a counter every surface refetches on (the feed
// has one authority), and a reaction *is* its own payload (it is stored nowhere
// for a later read to disagree with).

describe("session slice — participant names (REQ076)", () => {
	test("the switch lands on the deck both surfaces read", () => {
		// Turned on mid-session. Without the frame nothing re-evaluates the gate,
		// so nobody already in the room is ever asked and every answer they go on
		// to give is stored under nobody — absent from the roster, empty in both
		// exports, and silent on either side.
		const store = seededStore({ requireParticipantName: false });
		store.getState().applyParticipantNameSetting({ requireParticipantName: true });
		expect(store.getState().presentation?.requireParticipantName).toBe(true);
	});

	test("the frame is authoritative both ways, so turning it off releases the gate", () => {
		// Turned off mid-session. The boundary starts refusing the write; a
		// participant still standing at the door is let through by the deck
		// changing under them, which is the only thing that can release them —
		// the gate has no Cancel while a name is still owed.
		const store = seededStore({ requireParticipantName: true });
		store
			.getState()
			.applyParticipantNameSetting({ requireParticipantName: false });
		expect(store.getState().presentation?.requireParticipantName).toBe(false);
	});

	test("the switch before a deck has loaded is a no-op", () => {
		const store = createAppStore();
		store.getState().applyParticipantNameSetting({ requireParticipantName: true });
		expect(store.getState().presentation).toBeNull();
	});

	test("a reset bumps the revision the stated name is forgotten on", () => {
		// The server drops the whole roster on a reset (REQ101), so a browser that
		// kept believing it had answered the question at the door would never be
		// asked again — and every answer it gave in the re-run would be stored
		// under nobody. This counter is what tells it the run is gone.
		const store = seededStore({ requireParticipantName: true });
		expect(store.getState().sessionResetRevision).toBe(0);
		store.getState().applyReset();
		store.getState().applyReset();
		expect(store.getState().sessionResetRevision).toBe(2);
	});

	test("nothing but a reset moves it", () => {
		// It says "the run this name belonged to is gone", not "something
		// happened": an ended deck, a new slide or a chat message must not make a
		// room re-state its names mid-session.
		const store = seededStore({ requireParticipantName: true });
		store.getState().applyEnded();
		store.getState().applySlideChanged({ slideIndex: 1 });
		store.getState().applyChatChanged();
		store.getState().applyQAChanged();
		expect(store.getState().sessionResetRevision).toBe(0);
	});
});

describe("session slice — the participant channels (REQ077/REQ078)", () => {
	test("channel settings land on the deck both surfaces read", () => {
		const store = seededStore({ reactionsEnabled: false, chatEnabled: false });
		store
			.getState()
			.applyChannelSettings({ reactionsEnabled: true, chatEnabled: true });

		expect(store.getState().presentation?.reactionsEnabled).toBe(true);
		expect(store.getState().presentation?.chatEnabled).toBe(true);
	});

	test("a channel closing takes it back — the frame is authoritative both ways", () => {
		const store = seededStore({ reactionsEnabled: true, chatEnabled: true });
		store
			.getState()
			.applyChannelSettings({ reactionsEnabled: false, chatEnabled: false });

		expect(store.getState().presentation?.reactionsEnabled).toBe(false);
		expect(store.getState().presentation?.chatEnabled).toBe(false);
	});

	test("channel settings before a deck has loaded are a no-op", () => {
		const store = createAppStore();
		store
			.getState()
			.applyChannelSettings({ reactionsEnabled: true, chatEnabled: true });
		expect(store.getState().presentation).toBeNull();
	});

	test("a new chat message bumps the revision every surface refetches on", () => {
		const store = seededStore({ chatEnabled: true });
		expect(store.getState().chatRevision).toBe(0);
		store.getState().applyChatChanged();
		store.getState().applyChatChanged();
		expect(store.getState().chatRevision).toBe(2);
		// And it moves nothing else — the feed itself is fetched, never broadcast.
		expect(store.getState().qaRevision).toBe(0);
	});

	test("a reaction lands on screen from the frame alone", () => {
		const store = seededStore({ reactionsEnabled: true });
		store.getState().applyReaction({
			presentationId: "pres-1",
			id: "r1",
			kind: "love",
			slideId: "slide-a",
			at: new Date().toISOString(),
		});

		expect(store.getState().liveReactions).toHaveLength(1);
		expect(store.getState().liveReactions[0].kind).toBe("love");
		// Nothing was fetched and no revision moved: this frame is the whole of it.
		expect(store.getState().chatRevision).toBe(0);
	});

	test("a reaction is not a vote — it touches no tally", () => {
		const store = seededStore({ reactionsEnabled: true });
		store.getState().setResultsFor("slide-a", { totalVotes: 3 });
		store
			.getState()
			.applyReaction({ id: "r1", kind: "like", slideId: "slide-a" });

		expect(store.getState().results["slide-a"]).toEqual({ totalVotes: 3 });
	});

	test("a frame naming a reaction this build cannot draw is dropped", () => {
		const store = seededStore({ reactionsEnabled: true });
		store.getState().applyReaction({ id: "r1", kind: "shrug" });
		store.getState().applyReaction({ id: "r2" });
		store.getState().applyReaction(null);

		expect(store.getState().liveReactions).toEqual([]);
	});

	test("a reset clears the transcript, the queue and the screen together", () => {
		const store = seededStore({ chatEnabled: true, reactionsEnabled: true });
		store.getState().applyReaction({ id: "r1", kind: "like" });
		store.getState().setResultsFor("slide-a", { totalVotes: 3 });

		store.getState().applyReset();

		// The audience in front of you is not the one that was talking, so every
		// open chat surface has to go and read the empty channel …
		expect(store.getState().chatRevision).toBe(1);
		expect(store.getState().qaRevision).toBe(1);
		// … and the reactions belonging to the cleared run go with it.
		expect(store.getState().liveReactions).toEqual([]);
		expect(store.getState().results).toEqual({});
	});

	test("resetSession clears the channels' own state too", () => {
		const store = seededStore({ chatEnabled: true, reactionsEnabled: true });
		store.getState().applyChatChanged();
		store.getState().applyReaction({ id: "r1", kind: "like" });

		store.getState().resetSession();

		expect(store.getState().chatRevision).toBe(0);
		expect(store.getState().liveReactions).toEqual([]);
	});
});

// ── The live room's two switches (REQ111/REQ109) ───────────────
//
// Both arrive over the socket while a room is watching, and both have to land
// on every screen rather than on the next reload — a phone that had not heard
// would offer a control the boundary is refusing, and a projector that had not
// heard would keep showing what the presenter just took off the wall.

describe("session slice — the live room (REQ111/REQ109)", () => {
	test("applySlideParticipation closes one slide and leaves the rest", () => {
		const store = seededStore();
		store
			.getState()
			.applySlideParticipation({ slideId: "slide-a", open: false });
		expect(store.getState().presentation?.closedSlideIds).toEqual(["slide-a"]);
		expect(
			slideAcceptsSubmissions(store.getState().presentation!, "slide-b"),
		).toBe(true);
	});

	test("applySlideParticipation reopens what it closed", () => {
		const store = seededStore({ closedSlideIds: ["slide-a", "slide-b"] });
		store
			.getState()
			.applySlideParticipation({ slideId: "slide-a", open: true });
		expect(store.getState().presentation?.closedSlideIds).toEqual(["slide-b"]);
	});

	test("a frame that arrives twice lands on the state it asked for", () => {
		// The set arithmetic is the server's own function, so a redelivered
		// broadcast cannot stack a duplicate the reopen would then miss.
		const store = seededStore();
		store
			.getState()
			.applySlideParticipation({ slideId: "slide-a", open: false });
		store
			.getState()
			.applySlideParticipation({ slideId: "slide-a", open: false });
		expect(store.getState().presentation?.closedSlideIds).toEqual(["slide-a"]);
	});

	test("applyAudienceBlanked blanks the screen and touches nothing else", () => {
		// REQ109's whole sentence, at the reducer: the slide does not move, the
		// closed set does not change, and the tallies already collected stay.
		const store = seededStore({ activeSlideIndex: 1 });
		store.getState().setResultsFor("slide-b", { totalVotes: 4 });
		store.getState().applyAudienceBlanked({ blanked: true });

		const deck = store.getState().presentation;
		expect(deck?.audienceBlanked).toBe(true);
		expect(deck?.activeSlideIndex).toBe(1);
		expect(deck?.status).toBe("live");
		expect(slideAcceptsSubmissions(deck!, "slide-b")).toBe(true);
		expect(store.getState().results["slide-b"]).toEqual({ totalVotes: 4 });
	});

	test("applyAudienceBlanked brings the screen back", () => {
		const store = seededStore({ audienceBlanked: true });
		store.getState().applyAudienceBlanked({ blanked: false });
		expect(store.getState().presentation?.audienceBlanked).toBe(false);
	});

	test("a reset reopens every slide and brings the screen back", () => {
		const store = seededStore({
			closedSlideIds: ["slide-a"],
			audienceBlanked: true,
		});
		store.getState().applyReset();
		expect(store.getState().presentation?.closedSlideIds).toEqual([]);
		expect(store.getState().presentation?.audienceBlanked).toBe(false);
	});

	test("both reducers are no-ops when no presentation is loaded", () => {
		const store = createAppStore();
		store.getState().applySlideParticipation({ slideId: "x", open: false });
		store.getState().applyAudienceBlanked({ blanked: true });
		expect(store.getState().presentation).toBeNull();
	});
});
