// ── Session slice: live-runtime state (server-authoritative) ──────────
//
// This slice owns the *live runtime* domain shared by the Presenter and
// Participant pages: the presentation document as it changes during a live
// session, the per-slide results map, and the participant count. Per the
// triage decision this state is **server-authoritative** — it is mutated only
// by REST responses and by WebSocket broadcasts, never by local CRDT edits
// (that is the editor slice's concern).
//
// The WebSocket event reducers (`apply*`) used to be re-implemented almost
// verbatim in both PresenterPage and ParticipantPage. They now live here once,
// so both pages just select state and `useSessionSocket` routes each broadcast
// to the matching reducer. The reducers are pure (no WS, no React), which is
// what makes the testability goal cheap: seed a presentation, call a reducer,
// assert the new state — no DOM required.

import type { StoreApi } from "zustand";
import { api } from "../api";
import { addReaction, type LiveReaction, readReaction } from "../reactions";
import type { Presentation, QAVisibility, ResultsVisibility } from "../types";
import { isWithheldTally, withSlideParticipation } from "../types";
import type { AppState } from "./store";

type AppSet = StoreApi<AppState>["setState"];
type AppGet = StoreApi<AppState>["getState"];

/**
 * Aggregated results for a single slide. The shape varies by slide type
 * (bar counts, word frequencies, response lists, scale distributions), so it
 * stays untyped here — `ResultsDisplay` narrows it per `slide.type`. This
 * mirrors the pre-existing `any` results typing in the pages and api client.
 */
export type SlideResults = any;

export interface SessionSlice {
	/** The live presentation document, or null before it has loaded. */
	presentation: Presentation | null;
	/** Per-slide aggregated results, keyed by slide id. */
	results: Record<string, SlideResults>;
	/** Live participant count (driven by the `participants.count` broadcast). */
	participantCount: number;
	/**
	 * What the server's clock reads minus what this browser's does, captured
	 * from `serverNow` on the last fetch (REQ057).
	 *
	 * A quiz deadline is written on the server's clock and enforced on it, so
	 * every countdown is rendered against the same instant rather than against
	 * whatever the device believes the time is. Zero until a fetch has answered,
	 * which is also the right reading for the overwhelmingly common case of a
	 * browser whose clock is correct.
	 */
	serverClockOffsetMs: number;
	/**
	 * How many times the deck's Q&A list has moved (REQ036/REQ060) — a question
	 * asked, upvoted or marked answered.
	 *
	 * A counter rather than the list itself, because the list is **not** the same
	 * for everybody: who may read it is settled per request on the server from the
	 * caller's own credentials (REQ037), so what arrives over the socket is only
	 * the news that it changed. Every Q&A surface re-fetches on this number.
	 */
	qaRevision: number;
	/**
	 * How many times the deck's chat has moved (REQ078) — the same counter-and-
	 * refetch shape `qaRevision` has, and for the neighbouring reason: what a
	 * reader sees is settled on the server, per request, so the socket carries
	 * only the news that there is something new. Every chat surface re-fetches on
	 * this number.
	 */
	chatRevision: number;
	/**
	 * How many times this deck's session has been cleared under this browser
	 * (REQ101) — the counter the participant surface forgets the name it stated
	 * on (REQ076).
	 *
	 * A counter rather than a flag, and a counter rather than the name itself:
	 * the name is the browser's own note to itself in local storage, and this
	 * slice has no business holding one. What the socket says is that the run it
	 * was stated in is gone, and every surface remembering something about that
	 * run reads this number and drops it — the same shape `qaRevision` and
	 * `chatRevision` have, one step further, because there is nothing to re-fetch
	 * here: the roster is not a participant's to read.
	 */
	sessionResetRevision: number;
	/**
	 * The reactions currently crossing this screen (REQ077).
	 *
	 * The one piece of state here that is neither fetched nor server-authoritative
	 * in the usual sense: the broadcast *is* the state, it is never stored on
	 * either side, and it ages out on its own. It lives in this slice anyway
	 * because the socket wiring does (`useSessionSocket`) — the alternative was a
	 * component subscribing to the socket directly, which a re-connect would
	 * silently unsubscribe. The rules that bound it live in `src/reactions.ts`.
	 */
	liveReactions: LiveReaction[];
	/** True while the initial presentation fetch is in flight. */
	loading: boolean;
	/** Last fetch/mutation error message, or "" when there is none. */
	error: string;

	// — plain setters —
	setPresentation: (presentation: Presentation | null) => void;
	setError: (message: string) => void;
	setParticipantCount: (count: number) => void;
	setResultsFor: (slideId: string, results: SlideResults) => void;
	setActiveSlideIndex: (index: number) => void;
	setStatus: (status: Presentation["status"]) => void;

	// — async loaders (call REST, then populate state) —
	loadPresentation: (id: string) => Promise<Presentation | null>;
	loadByCode: (code: string) => Promise<Presentation | null>;
	/**
	 * Re-read the deck as the server projects it *for this caller, now*, patching
	 * only its slides.
	 *
	 * What an audience may see can change without the deck being edited: a reveal
	 * hands the room a slide's withheld solution — a Pin on Image target area
	 * (REQ053) — and **withholding is decided on the server, per request**
	 * (`withAudienceSolutions`). A client cannot un-strip what it was never sent,
	 * so the only way to gain a revealed answer key is to ask again.
	 */
	refreshDeckSlides: (code: string) => Promise<void>;

	// — lifecycle mutations (REST + optimistic update; throw on failure) —
	startPresentation: (id: string) => Promise<void>;
	endPresentation: (id: string) => Promise<void>;
	resetPresentation: (id: string) => Promise<void>;
	goToSlide: (id: string, index: number) => Promise<void>;
	revealResults: (id: string, slideId: string, reveal: boolean) => void;
	/** Reopen one slide's question, restarting its countdown (REQ057). */
	restartSlideTimer: (id: string, slideId: string) => Promise<void>;
	/** Switch the Q&A layer on/off (REQ036) and choose who reads it (REQ037). */
	setQASettings: (
		id: string,
		changes: { enabled?: boolean; visibility?: QAVisibility },
	) => Promise<void>;
	/** Open or close the reaction and chat channels (REQ077/REQ078). */
	setParticipantChannels: (
		id: string,
		changes: { reactionsEnabled?: boolean; chatEnabled?: boolean },
	) => Promise<void>;
	/** Open or close one slide to submissions (REQ111). */
	setSlideParticipation: (
		id: string,
		slideId: string,
		open: boolean,
	) => Promise<void>;
	/** Blank the shared screen, or bring it back (REQ109). */
	setAudienceBlanked: (id: string, blanked: boolean) => Promise<void>;
	/** Take one submitted answer off a word cloud or open-ended slide (REQ027). */
	deleteSubmittedAnswer: (
		id: string,
		slideId: string,
		answerId: string,
	) => Promise<void>;

	// — WebSocket reducers (server-authoritative; pure) —
	applySlideChanged: (payload: { slideIndex: number }) => void;
	applyResultsUpdated: (payload: {
		slideId: string;
		results: SlideResults;
	}) => void;
	applyParticipantCount: (payload: { count: number }) => void;
	applyStarted: () => void;
	applyEnded: () => void;
	applyReset: () => void;
	applyRevealed: (payload: { slideId: string; revealed: boolean }) => void;
	/**
	 * The deck's reveal mode was set for every question slide in it, in one
	 * operation (REQ018).
	 */
	applyDeckResultsVisibility: (payload: {
		resultsVisibility: ResultsVisibility;
	}) => void;
	applySlideStarted: (payload: {
		slideId: string;
		startedAt: string;
	}) => void;
	/** The deck started or stopped asking joiners for a name (REQ076). */
	applyParticipantNameSetting: (payload: {
		requireParticipantName: boolean;
	}) => void;
	/** The Q&A layer was switched on/off or re-scoped (REQ036/REQ037). */
	applyQASettings: (payload: {
		qaEnabled: boolean;
		qaVisibility: QAVisibility;
	}) => void;
	/** The question list moved — see {@link SessionSlice.qaRevision}. */
	applyQAChanged: () => void;
	/** A participant channel was opened or closed (REQ077/REQ078). */
	applyChannelSettings: (payload: {
		reactionsEnabled: boolean;
		chatEnabled: boolean;
	}) => void;
	/** One slide was opened or closed to submissions (REQ111). */
	applySlideParticipation: (payload: {
		slideId: string;
		open: boolean;
	}) => void;
	/** The shared screen was blanked, or brought back (REQ109). */
	applyAudienceBlanked: (payload: { blanked: boolean }) => void;
	/** Somebody reacted to what is on screen (REQ077). */
	applyReaction: (payload: unknown) => void;
	/** The chat has a new message — see {@link SessionSlice.chatRevision}. */
	applyChatChanged: () => void;

	/** Clear all live-runtime state (called on page unmount). */
	resetSession: () => void;
}

const initialSessionState = {
	presentation: null,
	results: {},
	participantCount: 0,
	serverClockOffsetMs: 0,
	qaRevision: 0,
	chatRevision: 0,
	sessionResetRevision: 0,
	liveReactions: [],
	loading: false,
	error: "",
} satisfies Pick<
	SessionSlice,
	| "presentation"
	| "results"
	| "participantCount"
	| "serverClockOffsetMs"
	| "qaRevision"
	| "chatRevision"
	| "sessionResetRevision"
	| "liveReactions"
	| "loading"
	| "error"
>;

/**
 * The offset to run quiz countdowns on, from a fetch response's `serverNow`
 * (REQ057). A response without one — an older server, or a cached body — leaves
 * the offset where it was rather than resetting it to a guess.
 */
export function clockOffsetFrom(
	serverNow: unknown,
	receivedAtMs: number,
	current: number,
): number {
	if (typeof serverNow !== "string") return current;
	const serverMs = Date.parse(serverNow);
	return Number.isNaN(serverMs) ? current : serverMs - receivedAtMs;
}

/**
 * The question-opening stamps carried by a mutation response (REQ057), as a
 * patch — empty when the response has none, so a patch built from it never
 * clears the stamps a client already holds.
 */
function startedStampsIn(
	response: unknown,
): Pick<Presentation, "slideStartedAt"> | Record<string, never> {
	const stamps = (response as { slideStartedAt?: unknown } | null)
		?.slideStartedAt;
	return stamps && typeof stamps === "object"
		? { slideStartedAt: stamps as Presentation["slideStartedAt"] }
		: {};
}

/**
 * The blocks a tally carries **only** for a caller who can edit the deck: a word
 * cloud's individual answers (REQ027) and a form's per-participant rows
 * (REQ061). Both are `null` in the copy the room is sent, by the same
 * construction and in the same aggregation (`opts.canEdit`).
 */
const EDITOR_ONLY_TALLY_BLOCKS = ["answers", "submissions"] as const;

/**
 * One tally frame off the socket, folded onto the one this client already holds.
 *
 * The frame is the **room's** copy of the tally — read without `canEdit`,
 * deliberately, because it goes to every phone in the room (see
 * `broadcastResults`). So where it says an editor-only block is `null`, that
 * means "not in this frame", not "gone": an editor's own credentialed poll is
 * the only read that ever carries one, and letting the broadcast blank it would
 * make the presenter's moderation list vanish and come back on every vote the
 * room casts.
 *
 * The numbers are always the frame's — a fold that kept a stale count would be
 * worse than the flicker it fixes. What is carried over is the held-back block
 * alone, and only onto a frame of the same tally type, until the next poll (or
 * the delete below) replaces it.
 */
export function withHeldEditorBlocks(
	previous: SlideResults,
	incoming: SlideResults,
): SlideResults {
	if (!previous || !incoming) return incoming;
	if (previous.type !== incoming.type) return incoming;
	let folded = incoming;
	for (const block of EDITOR_ONLY_TALLY_BLOCKS) {
		if (incoming[block] === null && previous[block] != null) {
			folded = { ...folded, [block]: previous[block] };
		}
	}
	return folded;
}

export function createSessionSlice(set: AppSet, get: AppGet): SessionSlice {
	/** Apply a shallow patch to the presentation, no-op when none is loaded. */
	const patchPresentation = (changes: Partial<Presentation>): void => {
		const current = get().presentation;
		if (!current) return;
		set({ presentation: { ...current, ...changes } });
	};

	return {
		...initialSessionState,

		setPresentation: (presentation) => set({ presentation }),
		setError: (error) => set({ error }),
		setParticipantCount: (participantCount) => set({ participantCount }),
		setResultsFor: (slideId, results) =>
			set({ results: { ...get().results, [slideId]: results } }),
		setActiveSlideIndex: (index) =>
			patchPresentation({ activeSlideIndex: index }),
		setStatus: (status) => patchPresentation({ status }),

		loadPresentation: async (id) => {
			set({ loading: true, error: "" });
			try {
				const data = await api.getPresentation(id);
				set({
					presentation: data,
					participantCount: data.participantCount ?? 0,
					serverClockOffsetMs: clockOffsetFrom(
						data.serverNow,
						Date.now(),
						get().serverClockOffsetMs,
					),
					loading: false,
				});
				return data;
			} catch (fetchError) {
				set({
					error:
						fetchError instanceof Error ? fetchError.message : "Unknown error",
					loading: false,
				});
				return null;
			}
		},

		loadByCode: async (code) => {
			set({ loading: true, error: "" });
			try {
				const data = await api.joinByCode(code);
				set({
					presentation: data,
					serverClockOffsetMs: clockOffsetFrom(
						data.serverNow,
						Date.now(),
						get().serverClockOffsetMs,
					),
					loading: false,
				});
				return data;
			} catch (joinError) {
				set({
					error:
						joinError instanceof Error ? joinError.message : "Unknown error",
					loading: false,
				});
				return null;
			}
		},

		/**
		 * See {@link SessionSlice.refreshDeckSlides}. Deliberately **not**
		 * `loadByCode`, and the differences are the point:
		 *
		 *  - It never raises `loading`. This runs mid-session, on a screen the
		 *    participant is already reading and answering on; the page blanks to a
		 *    spinner while `loading` is true, so re-using the join loader would
		 *    flash the room's screens every time the presenter revealed a slide.
		 *  - It patches **only** `slides`. Every runtime field — the active index,
		 *    the status, the reveal set, the question stamps — is already kept in
		 *    step by the socket reducers, and overwriting them from a response that
		 *    raced a broadcast would undo what the broadcast just applied.
		 *  - A failed re-read leaves the deck exactly as it was, which fails in the
		 *    safe direction: the withheld target stays withheld.
		 *  - A response that the **projection has moved past is discarded** — where
		 *    the projection is everything the audience's view of the deck is
		 *    computed from: the reveal set (REQ053) and the deck's reveal mode
		 *    (REQ018). Two changes in quick succession put two fetches in flight,
		 *    and each one answers with the projection as it stood when it was
		 *    asked — so letting a stale one land could re-strip a target that is
		 *    currently revealed, or restore an override the deck-wide operation
		 *    has just cleared, until the next change happened to correct it. The
		 *    change that moved on has its own re-read already running.
		 */
		refreshDeckSlides: async (code) => {
			// The same pair the participant surface triggers on, read here from the
			// store so the guard cannot drift from the trigger.
			const projectionKey = () => {
				const deck = get().presentation;
				return `${deck?.resultsVisibility ?? ""}|${(
					deck?.revealedSlideIds ?? []
				).join(",")}`;
			};
			if (!get().presentation) return;
			const askedAgainst = projectionKey();
			try {
				const data = await api.joinByCode(code);
				if (!Array.isArray(data?.slides)) return;
				if (projectionKey() !== askedAgainst) return;
				patchPresentation({ slides: data.slides });
			} catch {
				// Nothing to report: the deck the participant holds is still usable,
				// and the next change will try again.
			}
		},

		startPresentation: async (id) => {
			const updated = await api.startPresentation(id);
			patchPresentation({
				status: "live",
				activeSlideIndex: 0,
				// Going live opens the first question (REQ057). The stamp also
				// arrives over the socket, but taking it from the response the
				// presenter already has in hand means their own countdown never waits
				// on a broadcast to start running.
				...startedStampsIn(updated),
			});
		},

		endPresentation: async (id) => {
			await api.endPresentation(id);
			patchPresentation({ status: "ended" });
		},

		resetPresentation: async (id) => {
			await api.resetPresentation(id);
			get().applyReset();
		},

		goToSlide: async (id, index) => {
			const updated = await api.setSlide(id, index);
			patchPresentation({
				activeSlideIndex: index,
				...startedStampsIn(updated),
			});
		},

		revealResults: (id, slideId, reveal) => {
			api.revealSlide(id, slideId, reveal).catch(() => {});
		},

		restartSlideTimer: async (id, slideId) => {
			const updated = await api.restartSlideTimer(id, slideId);
			patchPresentation(startedStampsIn(updated));
		},

		setQASettings: async (id, changes) => {
			const updated = await api.setQASettings(id, changes);
			// Both values come back from the response the presenter already holds,
			// so their own switch lands without waiting on the broadcast that tells
			// the room. The broadcast is what moves every other screen.
			patchPresentation({
				qaEnabled: !!updated?.qaEnabled,
				qaVisibility: (updated?.qaVisibility as QAVisibility) ?? "presenter",
			});
		},

		setParticipantChannels: async (id, changes) => {
			const updated = await api.setParticipantChannels(id, changes);
			// Read back off the response the presenter already holds, like the Q&A
			// settings above: their own switch lands without waiting on the broadcast
			// that moves every other screen in the room.
			patchPresentation({
				reactionsEnabled: !!updated?.reactionsEnabled,
				chatEnabled: !!updated?.chatEnabled,
			});
		},

		setSlideParticipation: async (id, slideId, open) => {
			const updated = await api.setSlideParticipation(id, slideId, open);
			// Read back off the response the presenter already holds, like the Q&A
			// settings and the channels above: their own switch lands without waiting
			// on the broadcast that moves every phone in the room. The whole set is
			// taken rather than patched locally, so two toggles in flight cannot
			// leave this screen holding an order the server never applied.
			patchPresentation({
				closedSlideIds: Array.isArray(updated?.closedSlideIds)
					? (updated.closedSlideIds as string[])
					: withSlideParticipation(
							get().presentation?.closedSlideIds ?? [],
							slideId,
							open,
						),
			});
		},

		setAudienceBlanked: async (id, blanked) => {
			const updated = await api.setAudienceBlanked(id, blanked);
			patchPresentation({ audienceBlanked: updated?.audienceBlanked === true });
		},

		/**
		 * Take one submitted answer off the slide (REQ027), then re-read the slide's
		 * tally on this browser's own credentials.
		 *
		 * The re-read is the point of doing it here rather than in the page: the
		 * broadcast the server sends the room a moment later is the *audience's*
		 * copy, and the editor's copy is the only one carrying the list this
		 * deletion was made from (a word cloud's `answers`). Waiting for the 3s poll
		 * would leave the deleted line under the presenter's cursor; re-reading now
		 * makes the screen that took it down the first to show it gone.
		 */
		deleteSubmittedAnswer: async (id, slideId, answerId) => {
			await api.deleteAnswer(id, answerId);
			get().setResultsFor(slideId, await api.getResults(id, slideId));
		},

		applySlideChanged: ({ slideIndex }) =>
			patchPresentation({ activeSlideIndex: slideIndex }),

		/**
		 * A slide's tally moved.
		 *
		 * A frame the deck's reveal mode withheld (REQ016/REQ017) carries the
		 * marker instead of numbers, and is **dropped rather than stored**: it says
		 * "this is not yours to draw", which is not the same as "there is nothing
		 * here", and writing it over the map would blank a tally this client is
		 * separately entitled to. The presenter's screen is the case that proves
		 * it — its own credentialed poll of the results endpoint reads every tally
		 * whatever the mode, and one room-wide broadcast per vote would otherwise
		 * clear the response count under the question between two polls.
		 */
		applyResultsUpdated: ({ slideId, results }) => {
			if (isWithheldTally(results)) return;
			set({
				results: {
					...get().results,
					[slideId]: withHeldEditorBlocks(get().results[slideId], results),
				},
			});
		},

		applyParticipantCount: ({ count }) => set({ participantCount: count }),

		applyStarted: () => patchPresentation({ status: "live" }),

		applyEnded: () => patchPresentation({ status: "ended" }),

		applyReset: () => {
			const current = get().presentation;
			if (current) {
				set({
					presentation: {
						...current,
						status: "draft",
						activeSlideIndex: 0,
						revealedSlideIds: [],
						// The question-opening stamps go with the votes they timed
						// (REQ057) — a re-run opens every question afresh.
						slideStartedAt: {},
						// And so do the live-room switches (REQ111/REQ109): the server
						// clears both on a reset, so a screen that kept them would draw a
						// closed question over an open one and a curtain over a deck the
						// room can already see.
						closedSlideIds: [],
						audienceBlanked: false,
					},
				});
			}
			// A reset clears the questions the room asked along with its votes
			// (REQ036) and the chat it held (REQ078), so every open Q&A and chat
			// surface has to go and read the empty list rather than keep drawing the
			// last session's queue and transcript. The reactions on screen go too:
			// they belong to the run that has just been cleared.
			// The name the room stated goes with them (REQ076). The server has
			// already dropped the roster — a re-run is a different room — so a phone
			// that kept believing it had answered the question at the door would
			// never be asked again, and every answer it gives in the re-run would be
			// stored under nobody: missing from the presenter's roster and empty in
			// both exports, with no signal on either side.
			set({
				results: {},
				qaRevision: get().qaRevision + 1,
				chatRevision: get().chatRevision + 1,
				sessionResetRevision: get().sessionResetRevision + 1,
				liveReactions: [],
			});
		},

		applySlideStarted: ({ slideId, startedAt }) => {
			const current = get().presentation;
			if (!current) return;
			set({
				presentation: {
					...current,
					slideStartedAt: {
						...(current.slideStartedAt ?? {}),
						[slideId]: startedAt,
					},
				},
			});
		},

		applyParticipantNameSetting: ({ requireParticipantName }) =>
			patchPresentation({ requireParticipantName }),

		applyQASettings: ({ qaEnabled, qaVisibility }) =>
			patchPresentation({ qaEnabled, qaVisibility }),

		applyQAChanged: () => set({ qaRevision: get().qaRevision + 1 }),

		applyChannelSettings: ({ reactionsEnabled, chatEnabled }) =>
			patchPresentation({ reactionsEnabled, chatEnabled }),

		/**
		 * A slide was opened or closed to submissions (REQ111).
		 *
		 * The set arithmetic is `withSlideParticipation`, the same function the
		 * server writes the field with — a second copy here is how a
		 * phone comes to believe a question is open that the boundary is refusing,
		 * and then draws a live control over a refusal.
		 */
		applySlideParticipation: ({ slideId, open }) => {
			const current = get().presentation;
			if (!current) return;
			patchPresentation({
				closedSlideIds: withSlideParticipation(
					current.closedSlideIds ?? [],
					slideId,
					open,
				),
			});
		},

		/**
		 * The shared screen was blanked, or brought back (REQ109).
		 *
		 * Patches the one field and nothing beside it — which is the reducer half
		 * of the same guarantee the endpoint keeps: a blank moves no slide, closes
		 * no question and drops no tally, so a client that also cleared its results
		 * map here would lose what the requirement says must survive.
		 */
		applyAudienceBlanked: ({ blanked }) =>
			patchPresentation({ audienceBlanked: blanked }),

		/**
		 * A reaction arrived (REQ077).
		 *
		 * The frame is read here rather than at the socket wiring, so an unknown
		 * reaction kind is dropped once, in the place that also decides what a
		 * stream is — see `src/reactions.ts`. Nothing is fetched and nothing is
		 * stored: this frame is the whole of it.
		 */
		applyReaction: (payload) => {
			const now = Date.now();
			const reaction = readReaction(payload, now);
			if (!reaction) return;
			set({ liveReactions: addReaction(get().liveReactions, reaction, now) });
		},

		applyChatChanged: () => set({ chatRevision: get().chatRevision + 1 }),

		applyRevealed: ({ slideId, revealed }) => {
			const current = get().presentation;
			if (!current) return;
			const existing = current.revealedSlideIds ?? [];
			const next = revealed
				? Array.from(new Set([...existing, slideId]))
				: existing.filter((revealedId) => revealedId !== slideId);
			set({ presentation: { ...current, revealedSlideIds: next } });
		},

		/**
		 * The deck's reveal mode moved (REQ015–REQ018) — so a phone stops drawing
		 * a tally the organizer has just made private without waiting for a
		 * reload, and starts drawing one they have just opened up.
		 *
		 * **Only the deck-level field is patched, and the slides are left alone.**
		 * The frame does not say what became of the per-slide overrides, because
		 * that depends on which writer sent it: the deck-wide operation (REQ018)
		 * clears them, while the editor's ordinary Save may move the deck default
		 * with every override left standing. Re-deriving them here would be right
		 * for the first writer and wrong for the second — it would clear, on this
		 * client only, an override the server still holds, leaving the phone's
		 * model of the deck disagreeing with the payloads it is being sent. The
		 * deck re-read this triggers on the participant surface is what settles
		 * the slides, from the server rather than from a guess.
		 */
		applyDeckResultsVisibility: ({ resultsVisibility }) =>
			patchPresentation({ resultsVisibility }),

		resetSession: () => set({ ...initialSessionState }),
	};
}
