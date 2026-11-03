import { Play, Square, Volume2, VolumeOff, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Presentation, PresentationMode, Slide } from "../types";
import { quizAudioCueFor, slideAcceptsSubmissions } from "../types";
import { quizWindowFor } from "./QuizTimer";
import { ICON_BUTTON_HOVER } from "./ShareCluster";

// ── Quiz audio cue (REQ058) ───────────────────────────────────
//
// A quiz question's track, played on the presenter's screen for exactly as long
// as the room can answer — and on no other screen. Three parts play it, each with
// one job, and a fourth lets an author hear a bundled track in the editor:
//
//  - {@link quizAudioCueWindow} decides whether the cue should be sounding, as a
//    pure function of the slide, the deck and the server's clock. It reads the
//    window off the descriptor the countdown beside it runs on
//    ({@link quizWindowFor}), so the track stops on the instant the screen reads
//    "Time's up": a cue that outlived the countdown would be a second clock
//    telling the room something different.
//  - {@link useQuizAudioCue} holds the two players a presenter screen plays cues
//    through, one per {@link quizAudioCueLoopPath}, and keeps them in step with
//    that decision.
//  - {@link QuizAudioCueControl} is the mute, drawn beside the countdown it
//    shares a window with.
//  - {@link useQuizAudioPreview} plays one bundled track once for the editor's
//    Audio cue row. It shares no state with the three above and writes nothing
//    to the deck.
//
// Which screens may play a cue is settled before anything here runs. Every
// payload a participant receives has the address emptied on the server
// (`withAudienceSlides`), and no participant surface imports this module. The
// dry run hands its presenter pane no cue. Of the presenter pages, only one that
// can run the deck plays: a view-only spectator is told the cue plays on the
// presenter's screen instead.

/** Where a slide's audio cue stands at one instant, on one presenter screen. */
export type QuizAudioCueWindow = {
	/** The track — `""` for a slide carrying none this screen may play. */
	url: string;
	/**
	 * Whether the deck runs a shared answer window at all. An audience-paced deck
	 * (REQ003/REQ082) does not: everybody moves through it on their own, so there
	 * is no moment a question opens for the room and no window to play over.
	 */
	paced: boolean;
	/** Whether the room can answer the question right now, so the cue should sound. */
	open: boolean;
	/**
	 * Which opening of the question this is — the slide and the instant it was
	 * opened — or `""` while it is not open. A question reopened with a fresh
	 * timer (REQ057) is a new window, and its cue starts again from the top.
	 */
	windowKey: string;
	/**
	 * When the window opened, in epoch milliseconds on the server's clock — what
	 * the track's position is measured from (see {@link quizAudioCueOffsetSeconds})
	 * — or `null` while it is not open.
	 */
	openedAt: number | null;
	/**
	 * When the window closes of its own accord, in epoch milliseconds on the
	 * server's clock — `null` for one only the presenter will close (an untimed
	 * question) and for a window that is not open.
	 */
	closesAt: number | null;
};

/** The parts of a slide the cue is decided from. */
export type QuizAudioCueSlide = Pick<
	Slide,
	"id" | "type" | "timeLimit" | "quizAudioUrl"
>;

/** The parts of the deck the cue is decided from — all of it live state. */
export type QuizAudioCueDeck = Pick<
	Presentation,
	"mode" | "status" | "slideStartedAt" | "closedSlideIds"
>;

/**
 * Whether a slide's audio cue should be sounding at `now` (REQ058) — `now` on
 * the server's clock, the clock the window was written on.
 *
 * The cue sounds for the answer window, and the window is the one the server
 * enforces, so every condition below is one under which an answer is still
 * taken, read through the predicates that take it:
 *
 *  - the deck is presenter-paced and live: a draft has not started, an ended
 *    deck takes nothing, and an audience-paced deck has no shared window;
 *  - the question has been opened — arriving at it stamps that instant (REQ057);
 *  - the presenter has not closed it to submissions (REQ111), which is how a
 *    question is closed early;
 *  - its countdown, if it has one, has not run out. That is the deadline the
 *    countdown shows rather than the boundary's graced one: REQ057's grace is
 *    flight time for a tap already made, not more question, so the music and
 *    the clock stop together.
 *
 * Navigating away needs no condition, because the presenter surface only ever
 * asks about the slide it is showing. Revealing the slide's tally is
 * deliberately not one either: a reveal publishes results, it does not close the
 * question, and while the room can still answer the cue still plays.
 */
export function quizAudioCueWindow(
	slide: QuizAudioCueSlide | null | undefined,
	deck: QuizAudioCueDeck | null | undefined,
	now: number,
): QuizAudioCueWindow {
	const url = slide ? quizAudioCueFor(slide) : "";
	const paced = (deck?.mode ?? "live") === "live";
	const silent: QuizAudioCueWindow = {
		url,
		paced,
		open: false,
		windowKey: "",
		openedAt: null,
		closesAt: null,
	};
	if (!slide || !deck || url === "" || !paced) return silent;
	if (deck.status !== "live") return silent;
	if (!slideAcceptsSubmissions(deck, slide.id)) return silent;
	const stamp = deck.slideStartedAt?.[slide.id] ?? "";
	const openedAt = Date.parse(stamp);
	// A question whose opening instant cannot be read has no window this screen
	// can honour — no deadline to stop on, no position to play from — and the
	// safe reading of that is silence.
	if (stamp === "" || Number.isNaN(openedAt)) return silent;
	const { timeLimit, deadline } = quizWindowFor(slide, deck);
	const windowKey = `${slide.id}@${stamp}`;
	if (timeLimit === null) {
		return { url, paced, open: true, windowKey, openedAt, closesAt: null };
	}
	if (deadline === null || now >= deadline) return silent;
	return { url, paced, open: true, windowKey, openedAt, closesAt: deadline };
}

/**
 * Where in the track a window has got to at `now` — the seconds it has been open,
 * wrapped round the track's length, since a cue loops — or `null` when that
 * cannot be said: a track whose length is not known yet, or a stream that has
 * none.
 *
 * This is what makes the cue keep the window's time rather than its own. A
 * question paged back to, reopened to submissions or still open after a reload
 * is heard where it would have been had it played throughout, so the track is a
 * function of the window exactly as the countdown is — and a question reopened
 * with a fresh timer, whose window has just begun, starts it from the top.
 */
export function quizAudioCueOffsetSeconds(
	openedAt: number,
	now: number,
	durationSeconds: number,
): number | null {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
	const elapsedSeconds = Math.max(0, (now - openedAt) / 1000);
	return elapsedSeconds % durationSeconds;
}

/**
 * What a presenter screen is doing with the cue of the slide it shows:
 *
 *  - `playing` — the window is open and the track is running, muted or not;
 *  - `waiting` — the window is not open: not reached yet, run out, closed by
 *    the presenter, or the deck is not live;
 *  - `blocked` — the window is open, but this browser will not start sound
 *    until somebody clicks on the page (every browser's autoplay rule);
 *  - `unavailable` — the track at the address could not be loaded or played;
 *  - `unpaced` — the deck is audience-paced, so there is no window to play over;
 *  - `elsewhere` — this screen cannot run the deck, so the cue plays on the
 *    presenter's screen and not here.
 */
export type QuizAudioCueStatus =
	| "playing"
	| "waiting"
	| "blocked"
	| "unavailable"
	| "unpaced"
	| "elsewhere";

/** Why the media element last refused, and for which track. */
export type QuizAudioCueProblem = {
	url: string;
	kind: "blocked" | "unavailable";
};

/**
 * The status a screen reports for its cue — pure, so every state the control
 * can be in is a test rather than a click-through.
 *
 * A refusal is only ever about the track it was given: one recorded against
 * another address says nothing about this one.
 */
export function quizAudioCueStatusFor({
	canPlay,
	cueWindow,
	problem,
}: {
	canPlay: boolean;
	cueWindow: QuizAudioCueWindow;
	problem: QuizAudioCueProblem | null;
}): QuizAudioCueStatus {
	if (!canPlay) return "elsewhere";
	if (!cueWindow.paced) return "unpaced";
	const refusal =
		problem !== null && problem.url === cueWindow.url ? problem.kind : null;
	if (refusal === "unavailable") return "unavailable";
	if (!cueWindow.open) return "waiting";
	return refusal === "blocked" ? "blocked" : "playing";
}

/** What the cue control says, and what pressing it does, in one state. */
export type QuizAudioCueControlState = {
	/** The words beside the icon. */
	text: string;
	/** The whole control, spoken: the state it is in and what pressing it does. */
	label: string;
	/** What pressing it does — `null` for a control that stays visible but inert. */
	action: "toggle-mute" | "play" | null;
	/** Whether the state is one the presenter has to act on or know about. */
	attention: boolean;
};

/**
 * The cue control in one state (REQ058) — the one descriptor of what the mute
 * says and does, so the slide view and the blanked screen draw the same switch.
 *
 * Never dropped: a state with nothing to press is drawn disabled and says why,
 * which on a projector is the difference between "there is no cue" and "the cue
 * cannot play here".
 */
export function quizAudioCueControlFor({
	status,
	muted,
}: {
	status: QuizAudioCueStatus;
	muted: boolean;
}): QuizAudioCueControlState {
	switch (status) {
		case "elsewhere":
			return {
				text: "Audio cue plays on the presenter's screen",
				label:
					"Audio cue — it plays on the presenter's screen, not this one: you cannot edit this presentation",
				action: null,
				attention: false,
			};
		case "unpaced":
			return {
				text: "Audio cue off — audience-paced deck",
				label:
					"Audio cue — this deck is audience-paced, so there is no shared answer window for it to play over",
				action: null,
				attention: false,
			};
		case "unavailable":
			// Said as a failure to load rather than a bad link: a network that
			// dropped for a moment reads the same, and the track is asked for
			// again the next time the question's window opens.
			return {
				text: "Audio cue unavailable",
				label:
					"Audio cue — the track at this address could not be loaded. It is tried again the next time the question opens; if it keeps failing, check its link in the editor",
				action: null,
				attention: true,
			};
		case "blocked":
			return {
				text: "Play audio cue",
				label:
					"Play the audio cue — this browser holds sound back until somebody clicks on this screen",
				action: "play",
				attention: true,
			};
		case "playing":
			return muted
				? {
						text: "Audio cue muted — unmute",
						label:
							"Unmute the audio cue — it has kept running silently while the question is open",
						action: "toggle-mute",
						attention: false,
					}
				: {
						text: "Mute audio cue",
						label:
							"Mute the audio cue playing on this screen — the question stays open",
						action: "toggle-mute",
						attention: false,
					};
		case "waiting":
			return muted
				? {
						text: "Audio cue muted — unmute",
						label:
							"Unmute the audio cue — it plays on this screen while the question is open",
						action: "toggle-mute",
						attention: false,
					}
				: {
						text: "Mute audio cue",
						label:
							"Mute the audio cue — it plays on this screen while the question is open",
						action: "toggle-mute",
						attention: false,
					};
	}
}

/**
 * The tracks this product ships for a quiz's audio cue (REQ058).
 *
 * Choosing one stores its `path` in `quizAudioUrl`, as an ordinary root-relative
 * address, so a preset needs no field, no route and no case in
 * {@link quizAudioCueFor}. The file is under `public/audio/`, which the server
 * answers under `/app/` and Vite's `base` answers in development.
 *
 * Every stored deck holds this path, so it never changes. It names no track
 * content, because replacing a track means replacing the file at that path and
 * updating `public/licenses/quiz-audio-tracks.txt`. A replacement that sounds
 * different changes `label` here, and no stored deck needs touching.
 */
export const QUIZ_AUDIO_PRESETS = [
	{ id: "quiz-cue-1", label: "Ticking clock", path: "/app/audio/quiz-cue-1.mp3" },
	{ id: "quiz-cue-2", label: "Heartbeat", path: "/app/audio/quiz-cue-2.mp3" },
	{ id: "quiz-cue-3", label: "Plucked notes", path: "/app/audio/quiz-cue-3.mp3" },
] as const;

/** What the editor's Audio cue row can offer: a bundled track or the URL field. */
export type QuizAudioOption = (typeof QUIZ_AUDIO_PRESETS)[number]["id"] | "custom";

/** What the row reads as. `none` is a question with no track and no field open. */
export type QuizAudioChoice = QuizAudioOption | "none";

/** The bundled track stored at `authored`, if it is one. An exact match only. */
function quizAudioPresetAt(authored: string) {
	return QUIZ_AUDIO_PRESETS.find((preset) => preset.path === authored);
}

/** How a track goes round for a window longer than the track. */
export type QuizAudioCueLoopPath = "buffer" | "element";

/**
 * Which player loops a track. A bundled track is decoded into a buffer, because
 * a media element's `loop` restart inserts silence (see `## Notes` in REQ058 for
 * the measured gap) and a looping buffer source goes round on the next sample. A
 * Custom address keeps the media element, because it may be on another host that
 * sends no CORS headers, and `fetch` cannot read such a file for decoding.
 */
export function quizAudioCueLoopPath(url: string): QuizAudioCueLoopPath {
	return quizAudioPresetAt(url) ? "buffer" : "element";
}

/**
 * Which option the row reads as. A preset's path reads as that preset and any
 * other non-empty value as `custom`, so a deck authored with a URL keeps its
 * address in the field. An empty value reads as `custom` only while the author
 * has that option open, which is the one fact the stored field cannot carry.
 */
export function quizAudioChoiceFor(
	authored: string,
	customOpen: boolean,
): QuizAudioChoice {
	const preset = quizAudioPresetAt(authored);
	if (preset) return preset.id;
	if (authored !== "") return "custom";
	return customOpen ? "custom" : "none";
}

/**
 * The value `quizAudioUrl` takes when `option` is chosen. Custom keeps an address
 * already authored and drops a preset's path, so the field opens empty rather
 * than showing a path the author never typed.
 */
export function quizAudioUrlForOption(
	option: QuizAudioOption,
	authored: string,
): string {
	if (option !== "custom") {
		return QUIZ_AUDIO_PRESETS.find((preset) => preset.id === option)?.path ?? "";
	}
	return quizAudioPresetAt(authored) ? "" : authored;
}

/**
 * What the Audio cue row says while it is closed: `None` for a question with no
 * cue the room would hear, which includes a refused address, otherwise the
 * preset's label or `Custom`.
 */
export function quizAudioCueRowValue(
	slide: Pick<Slide, "type" | "quizAudioUrl">,
): string {
	if (quizAudioCueFor(slide) === "") return "None";
	return quizAudioPresetAt(slide.quizAudioUrl ?? "")?.label ?? "Custom";
}

/**
 * What the note under the editor's audio cue choices says (REQ058), and whether
 * it is a warning. `customOpen` is whether the URL field is drawn, which changes
 * what an empty value needs explaining.
 *
 * Read through {@link quizAudioCueFor} — the resolver the presenter's screen
 * plays the cue through — so the editor cannot promise a cue the room will not
 * hear. A refused address is said to be one while the author can still fix it,
 * and an audience-paced deck is said to have no window for a cue to play over,
 * rather than the field going quietly dead.
 */
export function quizAudioCueAuthoringNote(
	slide: Pick<Slide, "type" | "quizAudioUrl">,
	deckMode: PresentationMode,
	customOpen = false,
): { text: string; warning: boolean } {
	if ((slide.quizAudioUrl ?? "").trim() === "") {
		return {
			text: customOpen
				? "A link to an audio file, played on your presenter screen while the question is open — never on participants' phones. Nothing is uploaded."
				: "No track: this question runs in silence. A track you pick plays on your presenter screen while the question is open — never on participants' phones.",
			warning: false,
		};
	}
	if (quizAudioCueFor(slide) === "") {
		return {
			text: "That address can't be played — use an http(s) or root-relative URL.",
			warning: true,
		};
	}
	if (deckMode === "survey") {
		return {
			text: "Not in effect: this deck is audience-paced, so there is no shared answer window and the cue never plays.",
			warning: true,
		};
	}
	return {
		text: "Plays on your presenter screen from the moment the question opens until it closes, looping — never on participants' phones.",
		warning: false,
	};
}

/** The cue of the slide on screen, as one presenter screen holds it. */
export type QuizAudioCue = {
	status: QuizAudioCueStatus;
	/** Whether this slide's cue is muted on this screen. */
	muted: boolean;
	/** Mute or unmute this slide's cue on this screen. */
	toggleMuted: () => void;
	/** Start the track from a click — the way past a browser that held sound back. */
	playNow: () => void;
};

/** The longest delay a browser timer honours; past it a timer fires at once. */
const LONGEST_TIMEOUT_MS = 2_147_483_647;

/** The name a rejected `play()` reports, read defensively. */
function refusalName(error: unknown): string {
	return typeof error === "object" && error !== null && "name" in error
		? String((error as { name: unknown }).name)
		: "";
}

/** What a player needs from the screen that holds it. */
export type QuizAudioCuePlayerEvents = {
	/** The server's clock now, the clock a window's opening is stamped on. */
	now: () => number;
	/** Whether this slide's cue is muted on this screen right now. */
	muted: () => boolean;
	/** The track is running. */
	onStarted: () => void;
	/** The track was refused, for the reason `problem.kind` names. */
	onRefused: (problem: QuizAudioCueProblem) => void;
};

/** One way of playing a looping track on a presenter screen. */
export type QuizAudioCuePlayer = {
	/** Play `url` from where the window opened at `openedAt` has got to. */
	start: (url: string, openedAt: number) => void;
	/** Stop at once, keeping the track ready for the next window. */
	silence: () => void;
	/** Apply a mute to a running track without restarting it. */
	setMuted: (muted: boolean) => void;
	/** Stop and let go of the track and everything holding it. */
	release: () => void;
};

/**
 * Play a Custom address through one media element, pointed at each track in turn
 * and created the first time a cue needs it, so a deck with no such cue never
 * makes one. Reusing it is deliberate: some browsers grant sound to an *element*
 * once a click has started it, so the element a presenter unblocked once stays
 * unblocked for every question after.
 *
 * A muted element may start without a click, so its mute reaches the browser
 * before `play()` does.
 */
export function createElementCuePlayer(
	events: QuizAudioCuePlayerEvents,
): QuizAudioCuePlayer {
	let audio: HTMLAudioElement | null = null;
	/** The address the element was last pointed at — `""` for none. */
	let loadedUrl = "";
	/** Which `play()` is current; an older one's outcome is stale. */
	let attempt = 0;
	/** A placement waiting for the track's length, so a newer start can drop it. */
	let pendingPlacement: (() => void) | null = null;

	const dropPendingPlacement = (element: HTMLAudioElement) => {
		if (!pendingPlacement) return;
		element.removeEventListener("loadedmetadata", pendingPlacement);
		pendingPlacement = null;
	};

	const elementForCues = () => {
		if (audio) return audio;
		const created = new Audio();
		// The window lasts as long as the question is open, not as long as the
		// track, so a short sting goes round until the room's time is up.
		created.loop = true;
		created.preload = "auto";
		created.addEventListener("error", () => {
			// An element let go of on unmount reports its empty source as an
			// error; there is nothing left to tell anybody.
			if (loadedUrl !== "") {
				events.onRefused({ url: loadedUrl, kind: "unavailable" });
			}
		});
		audio = created;
		return created;
	};

	return {
		start: (url, openedAt) => {
			const element = elementForCues();
			if (loadedUrl !== url) {
				element.src = url;
				loadedUrl = url;
			} else if (element.error) {
				// A track that failed before is asked for again: the failure may have
				// been the network's rather than the address's, and an element keeps
				// its error — refusing every later `play()` — until it is told to
				// reload.
				element.load();
			}
			element.muted = events.muted();
			const thisAttempt = ++attempt;
			// Where the window has got to, read once the track's length is known —
			// at once for a track already loaded, otherwise as soon as it is.
			const placeAtWindow = () => {
				if (thisAttempt !== attempt) return;
				const offset = quizAudioCueOffsetSeconds(
					openedAt,
					events.now(),
					element.duration,
				);
				if (offset !== null) element.currentTime = offset;
			};
			dropPendingPlacement(element);
			if (element.readyState >= HTMLMediaElement.HAVE_METADATA) {
				placeAtWindow();
			} else {
				pendingPlacement = placeAtWindow;
				element.addEventListener("loadedmetadata", placeAtWindow, { once: true });
			}
			element.play().then(
				() => {
					if (thisAttempt === attempt) events.onStarted();
				},
				(error: unknown) => {
					if (thisAttempt !== attempt) return;
					const name = refusalName(error);
					// Interrupted by a pause or a new track: the decision that
					// interrupted it stands, and it is not a fault of this one.
					if (name === "AbortError") return;
					events.onRefused({
						url,
						kind: name === "NotAllowedError" ? "blocked" : "unavailable",
					});
				},
			);
		},
		silence: () => {
			if (!audio || audio.paused) return;
			attempt += 1;
			audio.pause();
		},
		setMuted: (muted) => {
			if (audio) audio.muted = muted;
		},
		release: () => {
			if (!audio) return;
			attempt += 1;
			loadedUrl = "";
			dropPendingPlacement(audio);
			audio.pause();
			audio.removeAttribute("src");
			audio.load();
			audio = null;
		},
	};
}

/** What {@link createBufferCuePlayer} reaches outside itself for. */
export type BufferCuePlayerDependencies = {
	/** Make the audio context, the first time a bundled track is wanted. */
	makeContext: () => AudioContext;
	/** Read a track's bytes, rejecting when it cannot be read. */
	loadBytes: (url: string) => Promise<ArrayBuffer>;
	/**
	 * How long a context may take to start before it counts as held back. A
	 * browser leaves a held-back context's `resume()` pending rather than
	 * rejecting it, so a timer is the only way to tell.
	 */
	startGraceMs: number;
};

/** The browser's own context and `fetch`, for a presenter screen. */
const BROWSER_BUFFER_CUE_DEPENDENCIES: BufferCuePlayerDependencies = {
	makeContext: () => new AudioContext(),
	loadBytes: async (url) => {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${url} answered ${response.status}`);
		return response.arrayBuffer();
	},
	startGraceMs: 300,
};

/**
 * Play a bundled track as a looping buffer source, which goes round on the next
 * sample (REQ058). One audio context for the life of the screen, created the
 * first time a bundled cue needs it: once a click has started it, it stays
 * started for every question after, as the element does.
 *
 * A source starts only on a running context, because a suspended context's clock
 * stands still and the position would be stale by however long the browser held
 * it. A context that stops running under a track (a phone call on some devices)
 * reports `blocked` and takes the window's position again when it runs.
 *
 * A mute sets the gain and leaves the source running, so unmuting picks the track
 * up where the window has got to. Unlike a muted element, a muted source still
 * needs a running context, so a page nobody has clicked on reports `blocked` for
 * a muted cue too — which takes a click to reach, since the mute is itself one.
 *
 * Decoded tracks are kept until release. There are three bundled tracks, so that
 * is bounded. A failed read or decode is forgotten, so the next window asks again.
 */
export function createBufferCuePlayer(
	events: QuizAudioCuePlayerEvents,
	dependencies: BufferCuePlayerDependencies = BROWSER_BUFFER_CUE_DEPENDENCIES,
): QuizAudioCuePlayer {
	let context: AudioContext | null = null;
	let gain: GainNode | null = null;
	let source: AudioBufferSourceNode | null = null;
	/** What should be sounding, and its buffer once that has been decoded. */
	let wanted: {
		url: string;
		openedAt: number;
		buffer: AudioBuffer | null;
	} | null = null;
	/** Which start is current; an older one's outcome is stale. */
	let attempt = 0;
	let startGraceTimer: ReturnType<typeof setTimeout> | null = null;
	const decoded = new Map<string, Promise<AudioBuffer>>();

	const stopSource = () => {
		if (!source) return;
		source.stop();
		source.disconnect();
		source = null;
	};

	const clearStartGrace = () => {
		if (startGraceTimer !== null) clearTimeout(startGraceTimer);
		startGraceTimer = null;
	};

	/** Start the wanted track where the window has got to, on a running context. */
	const launch = () => {
		if (!context || !gain || !wanted?.buffer) return;
		clearStartGrace();
		stopSource();
		const created = context.createBufferSource();
		created.buffer = wanted.buffer;
		created.loop = true;
		created.connect(gain);
		created.start(
			0,
			quizAudioCueOffsetSeconds(
				wanted.openedAt,
				events.now(),
				wanted.buffer.duration,
			) ?? 0,
		);
		source = created;
		events.onStarted();
	};

	const contextForCues = () => {
		if (context) return context;
		const created = dependencies.makeContext();
		const createdGain = created.createGain();
		createdGain.connect(created.destination);
		created.addEventListener("statechange", () => {
			if (!wanted) return;
			if (created.state === "running") {
				if (!source) launch();
				return;
			}
			if (created.state === "closed") return;
			stopSource();
			events.onRefused({ url: wanted.url, kind: "blocked" });
		});
		context = created;
		gain = createdGain;
		return created;
	};

	const decodedTrack = (cueContext: AudioContext, url: string) => {
		const known = decoded.get(url);
		if (known) return known;
		const decoding = dependencies
			.loadBytes(url)
			.then((bytes) => cueContext.decodeAudioData(bytes));
		decoded.set(url, decoding);
		decoding.catch(() => decoded.delete(url));
		return decoding;
	};

	return {
		start: (url, openedAt) => {
			const thisAttempt = ++attempt;
			clearStartGrace();
			stopSource();
			wanted = { url, openedAt, buffer: null };
			const cueContext = contextForCues();
			if (gain) gain.gain.value = events.muted() ? 0 : 1;
			// Called here rather than after the decode, because inside a click is
			// the one moment every browser lets a context start.
			cueContext.resume().catch(() => {});
			decodedTrack(cueContext, url).then(
				(buffer) => {
					if (thisAttempt !== attempt || !wanted) return;
					wanted.buffer = buffer;
					if (cueContext.state === "running") {
						launch();
						return;
					}
					// A context that starts after this reports it through `statechange`,
					// which launches the track and clears the refusal.
					startGraceTimer = setTimeout(() => {
						startGraceTimer = null;
						if (thisAttempt !== attempt || cueContext.state === "running") return;
						events.onRefused({ url, kind: "blocked" });
					}, dependencies.startGraceMs);
				},
				() => {
					if (thisAttempt !== attempt) return;
					events.onRefused({ url, kind: "unavailable" });
				},
			);
		},
		silence: () => {
			attempt += 1;
			wanted = null;
			clearStartGrace();
			stopSource();
		},
		setMuted: (muted) => {
			if (gain) gain.gain.value = muted ? 0 : 1;
		},
		release: () => {
			attempt += 1;
			wanted = null;
			clearStartGrace();
			stopSource();
			decoded.clear();
			context?.close().catch(() => {});
			context = null;
			gain = null;
		},
	};
}

/**
 * Play the cue of the slide on screen for as long as its answer window is open
 * (REQ058), or `null` when that slide carries no cue this screen holds.
 *
 * Each track goes through the player {@link quizAudioCueLoopPath} names. A player
 * is made the first time a cue needs it rather than on load, so a deck with no
 * cues makes neither.
 *
 * The track keeps the window's time: whenever it starts, it starts where the
 * window has got to ({@link quizAudioCueOffsetSeconds}), so a question paged
 * back to, reopened to submissions or still open after a reload is heard where
 * it would have been, and a fresh window starts it from the top.
 *
 * Muting is per slide and lasts as long as this screen is open: the switch sits
 * beside one question's countdown, so it governs that question's cue, and a
 * question paged back to remembers it. A muted cue keeps running silently, so
 * unmuting it mid-question picks it up where the window has got to.
 *
 * `canPlay` is whether this screen may run the deck. A screen that may not never
 * makes a sound and reports `elsewhere`, whatever the payload it holds carries.
 */
export function useQuizAudioCue({
	slide,
	deck,
	clockOffsetMs,
	canPlay,
}: {
	slide: QuizAudioCueSlide | null | undefined;
	deck: QuizAudioCueDeck | null | undefined;
	clockOffsetMs: number;
	canPlay: boolean;
}): QuizAudioCue | null {
	// Bumped when a window runs out, so the decision is taken again at that
	// instant rather than at the next render something else happened to cause.
	const [clockTick, setClockTick] = useState(0);
	const [mutedSlideIds, setMutedSlideIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [problem, setProblem] = useState<QuizAudioCueProblem | null>(null);
	const playersRef = useRef<
		Partial<Record<QuizAudioCueLoopPath, QuizAudioCuePlayer>>
	>({});

	const cueWindow = quizAudioCueWindow(slide, deck, Date.now() + clockOffsetMs);
	const sounding = canPlay && cueWindow.open;
	const slideId = slide?.id ?? "";
	const muted = mutedSlideIds.has(slideId);
	const mutedRef = useRef(muted);
	mutedRef.current = muted;
	const clockOffsetRef = useRef(clockOffsetMs);
	clockOffsetRef.current = clockOffsetMs;

	const playerFor = useCallback((path: QuizAudioCueLoopPath) => {
		const existing = playersRef.current[path];
		if (existing) return existing;
		const events: QuizAudioCuePlayerEvents = {
			now: () => Date.now() + clockOffsetRef.current,
			muted: () => mutedRef.current,
			onStarted: () => setProblem(null),
			onRefused: setProblem,
		};
		const created =
			path === "buffer"
				? createBufferCuePlayer(events)
				: createElementCuePlayer(events);
		playersRef.current[path] = created;
		return created;
	}, []);

	// The window running out on its own. The tick is a dependency so a timer
	// that fired a millisecond early — a timer's clock and `Date.now()` round
	// differently — finds the window still open and sets itself again for what
	// is left, instead of leaving the cue playing until something else renders.
	useEffect(() => {
		if (!sounding || cueWindow.closesAt === null) return;
		const delay = cueWindow.closesAt - (Date.now() + clockOffsetMs);
		const timer = setTimeout(
			() => setClockTick((tick) => tick + 1),
			Math.min(LONGEST_TIMEOUT_MS, Math.max(0, delay)),
		);
		return () => clearTimeout(timer);
	}, [sounding, cueWindow.closesAt, clockOffsetMs, clockTick]);

	// The players following the decision: silent whenever the window is not open
	// on this screen, and the slide's track playing, from wherever the window has
	// got to, while it is.
	useEffect(() => {
		const { buffer, element } = playersRef.current;
		if (!sounding || cueWindow.openedAt === null) {
			buffer?.silence();
			element?.silence();
			return;
		}
		const path = quizAudioCueLoopPath(cueWindow.url);
		(path === "buffer" ? element : buffer)?.silence();
		playerFor(path).start(cueWindow.url, cueWindow.openedAt);
	}, [
		sounding,
		cueWindow.url,
		cueWindow.windowKey,
		cueWindow.openedAt,
		playerFor,
	]);

	// A mute takes effect on the running track without restarting it.
	useEffect(() => {
		playersRef.current.buffer?.setMuted(muted);
		playersRef.current.element?.setMuted(muted);
	}, [muted]);

	// Leaving the presenter screen stops the cue and lets go of the track: an
	// element that kept its source would keep its connection and its buffer, and a
	// context would keep its audio device.
	useEffect(
		() => () => {
			playersRef.current.buffer?.release();
			playersRef.current.element?.release();
			playersRef.current = {};
		},
		[],
	);

	if (cueWindow.url === "") return null;

	return {
		status: quizAudioCueStatusFor({ canPlay, cueWindow, problem }),
		muted,
		toggleMuted: () => {
			if (slideId === "") return;
			const nextMuted = !muted;
			// Applied inside the click as well as by the effect, because a click is
			// the one moment every browser lets a page start making a sound.
			playersRef.current.buffer?.setMuted(nextMuted);
			playersRef.current.element?.setMuted(nextMuted);
			setMutedSlideIds((current) => {
				const next = new Set(current);
				if (nextMuted) next.add(slideId);
				else next.delete(slideId);
				return next;
			});
		},
		playNow: () => {
			if (!sounding || cueWindow.openedAt === null) return;
			playerFor(quizAudioCueLoopPath(cueWindow.url)).start(
				cueWindow.url,
				cueWindow.openedAt,
			);
		},
	};
}

/**
 * The presenter's switch for the cue (REQ058), in whatever state it is in.
 *
 * Drawn beside the question's countdown — the cue and the countdown are the same
 * window, so the control for one sits with the other — and on the blanked screen
 * too, where it names what it does and nothing the deck says.
 */
export function QuizAudioCueControl({ cue }: { cue: QuizAudioCue }) {
	const control = quizAudioCueControlFor({
		status: cue.status,
		muted: cue.muted,
	});
	const icon =
		control.action === "play" ? (
			<Play size={13} />
		) : control.action === null ? (
			<VolumeOff size={13} />
		) : cue.muted ? (
			<VolumeX size={13} />
		) : (
			<Volume2 size={13} />
		);
	return (
		<button
			type="button"
			onClick={control.action === "play" ? cue.playNow : cue.toggleMuted}
			disabled={control.action === null}
			aria-pressed={control.action === "toggle-mute" ? cue.muted : undefined}
			aria-label={control.label}
			title={control.label}
			className={`inline-flex items-center gap-1.5 text-xs underline transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
				control.attention ? "text-warning" : "text-text-muted hover:text-text"
			}`}
		>
			{icon}
			{control.text}
		</button>
	);
}

/** Where one bundled track's play control stands in the editor. */
export type QuizAudioPreviewState = "idle" | "playing" | "failed";

/** What one track's play control says and shows, in one state. */
export type QuizAudioPreviewControl = {
	/** The control's accessible name: what pressing it does, and to which track. */
	name: string;
	icon: "play" | "stop";
	/** The words drawn at the control when the track failed, otherwise `null`. */
	reason: string | null;
};

/**
 * One track's play control in one state (REQ058). A track that failed is offered
 * again rather than disabled, because the failure may have been the network's and
 * pressing play is how an author asks again.
 */
export function quizAudioPreviewControlFor(
	trackLabel: string,
	state: QuizAudioPreviewState,
): QuizAudioPreviewControl {
	switch (state) {
		case "idle":
			return { name: `Play ${trackLabel}`, icon: "play", reason: null };
		case "playing":
			return { name: `Stop ${trackLabel}`, icon: "stop", reason: null };
		case "failed":
			return {
				name: `Play ${trackLabel}`,
				icon: "play",
				reason: `${trackLabel} could not be loaded. Press play to try again.`,
			};
	}
}

/** The editor's preview of the bundled tracks, as one Audio cue row holds it. */
export type QuizAudioPreview = {
	/** Where a track stands, by its id in {@link QUIZ_AUDIO_PRESETS}. */
	stateOf: (trackId: string) => QuizAudioPreviewState;
	/** Play a track once, replacing any other, or stop it if it is the one playing. */
	toggle: (track: { id: string; path: string }) => void;
};

/**
 * Let an author hear a bundled track while choosing it (REQ058). One media element,
 * made on the first press, plays one track once and goes back to idle. It does not
 * loop, because the question here is what the track sounds like, and a media element
 * is enough for that.
 *
 * The caller's mount is the preview's lifetime: "Done" and leaving the slide both
 * unmount the row, and that stops the track. Nothing here reads or writes the
 * slide, so pressing play leaves the stored value alone.
 */
export function useQuizAudioPreview(): QuizAudioPreview {
	const [playingId, setPlayingId] = useState<string | null>(null);
	const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	/** The track the element is on, which a late event is checked against. */
	const currentIdRef = useRef<string | null>(null);

	const markFailed = useCallback((trackId: string) => {
		setPlayingId((current) => (current === trackId ? null : current));
		setFailedIds((current) => new Set(current).add(trackId));
	}, []);

	const elementForPreview = useCallback(() => {
		if (audioRef.current) return audioRef.current;
		const created = new Audio();
		created.preload = "auto";
		created.addEventListener("ended", () => {
			currentIdRef.current = null;
			setPlayingId(null);
		});
		created.addEventListener("error", () => {
			const failedId = currentIdRef.current;
			// Letting go of the source reports an error too, and by then no track
			// is current.
			if (failedId === null) return;
			currentIdRef.current = null;
			markFailed(failedId);
		});
		audioRef.current = created;
		return created;
	}, [markFailed]);

	const stop = useCallback(() => {
		currentIdRef.current = null;
		const audio = audioRef.current;
		if (!audio) return;
		audio.pause();
		audio.removeAttribute("src");
		audio.load();
	}, []);

	useEffect(
		() => () => {
			stop();
			audioRef.current = null;
		},
		[stop],
	);

	return {
		stateOf: (trackId) => {
			if (trackId === playingId) return "playing";
			return failedIds.has(trackId) ? "failed" : "idle";
		},
		toggle: (track) => {
			if (track.id === playingId) {
				stop();
				setPlayingId(null);
				return;
			}
			const audio = elementForPreview();
			currentIdRef.current = track.id;
			setPlayingId(track.id);
			setFailedIds((current) => {
				const next = new Set(current);
				next.delete(track.id);
				return next;
			});
			audio.src = track.path;
			audio.play().catch((error: unknown) => {
				// Interrupted by a stop or another track, whose press stands.
				if (refusalName(error) === "AbortError") return;
				if (currentIdRef.current !== track.id) return;
				currentIdRef.current = null;
				markFailed(track.id);
			});
		},
	};
}

/**
 * The play control beside one bundled track's tile (REQ058). It is a button of its
 * own, so pressing it never selects the track and selecting the track never plays
 * it. 44px square on a phone and 28px from `sm`, where the settings column is
 * pointer-driven and short of height.
 */
export function QuizAudioPreviewButton({
	trackLabel,
	state,
	reasonId,
	onToggle,
}: {
	trackLabel: string;
	state: QuizAudioPreviewState;
	/** The id of the element drawing the failure reason, which describes this button. */
	reasonId: string;
	onToggle: () => void;
}) {
	const control = quizAudioPreviewControlFor(trackLabel, state);
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-label={control.name}
			aria-describedby={control.reason === null ? undefined : reasonId}
			title={control.name}
			className={`flex size-11 flex-shrink-0 items-center justify-center rounded-lg border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:size-7 ${ICON_BUTTON_HOVER}`}
		>
			{control.icon === "stop" ? <Square size={14} /> : <Play size={14} />}
		</button>
	);
}
