/**
 * Unit tests for the presenter screen's audio cue (REQ058) — the decision of
 * when it sounds, what the screen reports about it, what its switch says, and
 * what the editor tells its author.
 *
 * The media element itself is a thin follower of {@link quizAudioCueWindow}, so
 * the window is where the content is. What it has to get right is the
 * requirement's own sentence — *for the duration of its answer window* — in
 * every way a window opens and closes: the presenter arriving at the question,
 * the clock running out, the presenter closing it early, the deck ending, a
 * fresh window on a restarted timer — and the ways a deck has no window at all.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { assetSubpath } from "../../server/app-paths";
import { serveStatic } from "../../server/routes/static";
import { QUIZ_SUBMISSION_GRACE_MS } from "../../server/schemas";
import type { Slide } from "../types";
import {
	type BufferCuePlayerDependencies,
	createBufferCuePlayer,
	type QuizAudioCueDeck,
	type QuizAudioCuePlayerEvents,
	type QuizAudioCueProblem,
	type QuizAudioCueStatus,
	type QuizAudioCueWindow,
	QUIZ_AUDIO_PRESETS,
	quizAudioChoiceFor,
	quizAudioCueAuthoringNote,
	quizAudioCueControlFor,
	quizAudioCueLoopPath,
	quizAudioCueOffsetSeconds,
	quizAudioPreviewControlFor,
	quizAudioCueRowValue,
	quizAudioCueStatusFor,
	quizAudioCueWindow,
	quizAudioUrlForOption,
} from "./QuizAudioCue";
import { quizWindowFor } from "./QuizTimer";

const TRACK = "https://cdn.example.com/audio/thinking-music.mp3";
const OPENED_AT = "2026-01-01T12:00:00.000Z";
const OPENED = Date.parse(OPENED_AT);

function quizSlide(overrides: Partial<Slide> = {}): Slide {
	return {
		id: "qz",
		type: "quiz",
		question: "Which planet is closest to the sun?",
		timeLimit: 30,
		quizAudioUrl: TRACK,
		...overrides,
	} as Slide;
}

/** A live, presenter-paced deck whose question `qz` opened at {@link OPENED_AT}. */
function liveDeck(overrides: Partial<QuizAudioCueDeck> = {}): QuizAudioCueDeck {
	return {
		mode: "live",
		status: "live",
		slideStartedAt: { qz: OPENED_AT },
		closedSlideIds: [],
		...overrides,
	};
}

describe("quizAudioCueWindow — when the cue sounds (REQ058)", () => {
	test("from the moment the question opens, for its whole window", () => {
		for (const now of [OPENED, OPENED + 1, OPENED + 29_999]) {
			const cue = quizAudioCueWindow(quizSlide(), liveDeck(), now);
			expect(cue.url).toBe(TRACK);
			expect(cue.open).toBe(true);
			expect(cue.closesAt).toBe(OPENED + 30_000);
		}
	});

	test("it stops on the instant the countdown runs out — not at the boundary's grace", () => {
		// The grace (REQ057) is flight time for a tap already made, not more
		// question: the room hears the music stop when the screen says time's up.
		for (const now of [
			OPENED + 30_000,
			OPENED + 30_000 + QUIZ_SUBMISSION_GRACE_MS - 1,
			OPENED + 10 * 60_000,
		]) {
			expect(quizAudioCueWindow(quizSlide(), liveDeck(), now).open).toBe(false);
		}
	});

	test("its deadline is the countdown's own, so the music and the clock stop together", () => {
		const slide = quizSlide({ timeLimit: 45 });
		const deck = liveDeck();
		expect(quizAudioCueWindow(slide, deck, OPENED).closesAt).toBe(
			quizWindowFor(slide, deck).deadline,
		);
	});

	test("an untimed question plays for as long as it stays open", () => {
		const cue = quizAudioCueWindow(
			quizSlide({ timeLimit: 0 }),
			liveDeck(),
			OPENED + 24 * 60 * 60_000,
		);
		expect(cue.open).toBe(true);
		// Nothing but the presenter will close it, so no clock is set against it.
		expect(cue.closesAt).toBe(null);
	});

	test("the presenter closing the question early stops it (REQ111)", () => {
		const cue = quizAudioCueWindow(
			quizSlide(),
			liveDeck({ closedSlideIds: ["qz"] }),
			OPENED + 1_000,
		);
		expect(cue.open).toBe(false);
		// Closing a *different* question does not.
		expect(
			quizAudioCueWindow(
				quizSlide(),
				liveDeck({ closedSlideIds: ["another"] }),
				OPENED + 1_000,
			).open,
		).toBe(true);
	});

	test("reopening the question is a new window, so the track starts again from the top", () => {
		const first = quizAudioCueWindow(quizSlide(), liveDeck(), OPENED + 1_000);
		const reopenedAt = "2026-01-01T12:05:00.000Z";
		const reopened = Date.parse(reopenedAt);
		const second = quizAudioCueWindow(
			quizSlide(),
			liveDeck({ slideStartedAt: { qz: reopenedAt } }),
			reopened,
		);
		expect(first.open).toBe(true);
		expect(second.open).toBe(true);
		expect(second.windowKey).not.toBe(first.windowKey);
		expect(second.openedAt).toBe(reopened);
		expect(quizAudioCueOffsetSeconds(reopened, reopened, 90)).toBe(0);
		// And the same opening asked about twice is the same window — paging away
		// and back does not restart anything: the track is where the window is.
		const returned = quizAudioCueWindow(quizSlide(), liveDeck(), OPENED + 20_000);
		expect(returned.windowKey).toBe(first.windowKey);
		expect(
			quizAudioCueOffsetSeconds(returned.openedAt ?? 0, OPENED + 20_000, 90),
		).toBe(20);
	});

	test("a question the presenter has not reached plays nothing", () => {
		expect(
			quizAudioCueWindow(quizSlide(), liveDeck({ slideStartedAt: {} }), OPENED)
				.open,
		).toBe(false);
		// Only the slide's own opening opens it.
		expect(
			quizAudioCueWindow(
				quizSlide(),
				liveDeck({ slideStartedAt: { neighbour: OPENED_AT } }),
				OPENED,
			).open,
		).toBe(false);
	});

	test("a deck that is not live plays nothing — before it starts, and once it ends", () => {
		for (const status of ["draft", "ended"] as const) {
			const cue = quizAudioCueWindow(
				quizSlide(),
				liveDeck({ status }),
				OPENED + 1_000,
			);
			expect(cue.open).toBe(false);
			// The cue still exists — the switch for it is still drawn.
			expect(cue.url).toBe(TRACK);
		}
	});

	test("an audience-paced deck has no window to play over at all", () => {
		const cue = quizAudioCueWindow(
			quizSlide(),
			liveDeck({ mode: "survey" }),
			OPENED + 1_000,
		);
		expect(cue.paced).toBe(false);
		expect(cue.open).toBe(false);
	});

	test("revealing the tally does not close the question, so the cue plays on", () => {
		// A reveal publishes results; the room can still answer until the window
		// closes, and the cue is the window's.
		const revealed = { ...liveDeck(), revealedSlideIds: ["qz"] };
		expect(quizAudioCueWindow(quizSlide(), revealed, OPENED + 1_000).open).toBe(
			true,
		);
	});

	test("blanking the shared screen does not stop it (REQ109)", () => {
		// A blank stops nothing — the question's window least of all.
		const blanked = { ...liveDeck(), audienceBlanked: true };
		expect(quizAudioCueWindow(quizSlide(), blanked, OPENED + 1_000).open).toBe(
			true,
		);
	});

	test("a slide with no cue, or with one no player may load, has nothing to play", () => {
		for (const quizAudioUrl of ["", "   ", "javascript:alert(1)", "//cdn.example.com/a.mp3"]) {
			const cue = quizAudioCueWindow(
				quizSlide({ quizAudioUrl }),
				liveDeck(),
				OPENED + 1_000,
			);
			expect(cue.url).toBe("");
			expect(cue.open).toBe(false);
		}
	});

	test("a cue left on a slide that is no longer a quiz never plays", () => {
		const cue = quizAudioCueWindow(
			quizSlide({ type: "multiple-choice" }),
			liveDeck(),
			OPENED + 1_000,
		);
		expect(cue.url).toBe("");
		expect(cue.open).toBe(false);
	});

	test("a question whose opening instant cannot be read stays silent, timed or not", () => {
		// No deadline to stop on and no position to play from.
		for (const timeLimit of [30, 0]) {
			const cue = quizAudioCueWindow(
				quizSlide({ timeLimit }),
				liveDeck({ slideStartedAt: { qz: "not a date" } }),
				OPENED + 1_000,
			);
			expect(cue.open).toBe(false);
			expect(cue.openedAt).toBe(null);
		}
	});

	test("an open window carries the instant it opened; a closed one carries none", () => {
		expect(quizAudioCueWindow(quizSlide(), liveDeck(), OPENED + 1_000).openedAt).toBe(
			OPENED,
		);
		expect(
			quizAudioCueWindow(quizSlide(), liveDeck(), OPENED + 60_000).openedAt,
		).toBe(null);
	});

	test("no slide, or no deck, is silence", () => {
		expect(quizAudioCueWindow(null, liveDeck(), OPENED).open).toBe(false);
		expect(quizAudioCueWindow(quizSlide(), null, OPENED).open).toBe(false);
	});
});

describe("quizAudioCueOffsetSeconds — the track keeps the window's time (REQ058)", () => {
	test("a window just opened plays from the top", () => {
		expect(quizAudioCueOffsetSeconds(OPENED, OPENED, 60)).toBe(0);
	});

	test("a window under way is heard where it has got to", () => {
		// Paged back to, reopened to submissions, or reloaded 12.5s in.
		expect(quizAudioCueOffsetSeconds(OPENED, OPENED + 12_500, 60)).toBe(12.5);
	});

	test("a window longer than the track wraps round it, as the loop does", () => {
		expect(quizAudioCueOffsetSeconds(OPENED, OPENED + 75_000, 30)).toBe(15);
		expect(quizAudioCueOffsetSeconds(OPENED, OPENED + 60_000, 30)).toBe(0);
	});

	test("a clock a little behind the opening is the top, never a negative position", () => {
		expect(quizAudioCueOffsetSeconds(OPENED, OPENED - 400, 60)).toBe(0);
	});

	test("a track whose length is not known — not loaded yet, or a stream — is left where it is", () => {
		for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
			expect(quizAudioCueOffsetSeconds(OPENED, OPENED + 5_000, duration)).toBe(
				null,
			);
		}
	});
});

/** A window as the status reading takes it. */
function cueWindow(overrides: Partial<QuizAudioCueWindow> = {}): QuizAudioCueWindow {
	return {
		url: TRACK,
		paced: true,
		open: true,
		windowKey: `qz@${OPENED_AT}`,
		openedAt: OPENED,
		closesAt: OPENED + 30_000,
		...overrides,
	};
}

const CLOSED = cueWindow({
	open: false,
	windowKey: "",
	openedAt: null,
	closesAt: null,
});

describe("quizAudioCueStatusFor — what the screen reports (REQ058)", () => {
	test("an open window is playing until something refuses it", () => {
		expect(
			quizAudioCueStatusFor({ canPlay: true, cueWindow: cueWindow(), problem: null }),
		).toBe("playing");
		expect(
			quizAudioCueStatusFor({ canPlay: true, cueWindow: CLOSED, problem: null }),
		).toBe("waiting");
	});

	test("a screen that cannot run the deck plays nothing, whatever the window", () => {
		for (const answerWindow of [cueWindow(), CLOSED]) {
			expect(
				quizAudioCueStatusFor({
					canPlay: false,
					cueWindow: answerWindow,
					problem: null,
				}),
			).toBe("elsewhere");
		}
	});

	test("a browser holding sound back is reported — but only while there is a window", () => {
		const problem = { url: TRACK, kind: "blocked" as const };
		expect(
			quizAudioCueStatusFor({ canPlay: true, cueWindow: cueWindow(), problem }),
		).toBe("blocked");
		expect(quizAudioCueStatusFor({ canPlay: true, cueWindow: CLOSED, problem })).toBe(
			"waiting",
		);
	});

	test("a track that failed to load is unavailable, open or not", () => {
		const problem = { url: TRACK, kind: "unavailable" as const };
		for (const answerWindow of [cueWindow(), CLOSED]) {
			expect(
				quizAudioCueStatusFor({ canPlay: true, cueWindow: answerWindow, problem }),
			).toBe("unavailable");
		}
	});

	test("a refusal recorded against another track says nothing about this one", () => {
		for (const kind of ["blocked", "unavailable"] as const) {
			expect(
				quizAudioCueStatusFor({
					canPlay: true,
					cueWindow: cueWindow(),
					problem: { url: "https://example.com/other.mp3", kind },
				}),
			).toBe("playing");
		}
	});

	test("an audience-paced deck reports that before anything else", () => {
		expect(
			quizAudioCueStatusFor({
				canPlay: true,
				cueWindow: cueWindow({ paced: false, open: false }),
				problem: { url: TRACK, kind: "unavailable" },
			}),
		).toBe("unpaced");
	});
});

const EVERY_STATUS: QuizAudioCueStatus[] = [
	"playing",
	"waiting",
	"blocked",
	"unavailable",
	"unpaced",
	"elsewhere",
];

describe("quizAudioCueControlFor — the switch beside the countdown (REQ058)", () => {
	test("every state names itself and what pressing it does", () => {
		for (const status of EVERY_STATUS) {
			for (const muted of [false, true]) {
				const control = quizAudioCueControlFor({ status, muted });
				expect(control.text.trim()).not.toBe("");
				expect(control.label.trim()).not.toBe("");
				// The spoken name carries more than the visible words: it says why.
				expect(control.label.length).toBeGreaterThan(control.text.length);
			}
		}
	});

	test("a state with nothing to press stays drawn, disabled, and says why", () => {
		for (const status of ["unavailable", "unpaced", "elsewhere"] as const) {
			const control = quizAudioCueControlFor({ status, muted: false });
			expect(control.action).toBe(null);
		}
		// Said as a failed load, not a bad link — a dropped network reads the same —
		// and with the retry that follows it.
		const unavailable = quizAudioCueControlFor({
			status: "unavailable",
			muted: false,
		}).label;
		expect(unavailable).toContain("could not be loaded");
		expect(unavailable).toContain("tried again");
		expect(
			quizAudioCueControlFor({ status: "unpaced", muted: false }).label,
		).toContain("audience-paced");
		expect(
			quizAudioCueControlFor({ status: "elsewhere", muted: false }).label,
		).toContain("presenter's screen");
	});

	test("a cue the browser held back is started by the click, not muted by it", () => {
		const control = quizAudioCueControlFor({ status: "blocked", muted: false });
		expect(control.action).toBe("play");
		expect(control.attention).toBe(true);
	});

	test("the mute is offered whenever the cue could sound, and says which way it goes", () => {
		for (const status of ["playing", "waiting"] as const) {
			const audible = quizAudioCueControlFor({ status, muted: false });
			const muted = quizAudioCueControlFor({ status, muted: true });
			expect(audible.action).toBe("toggle-mute");
			expect(muted.action).toBe("toggle-mute");
			expect(audible.label.startsWith("Mute")).toBe(true);
			expect(muted.label.startsWith("Unmute")).toBe(true);
			expect(muted.text).not.toBe(audible.text);
		}
	});

	test("a failed track wants the presenter's attention; an ordinary state does not", () => {
		expect(
			quizAudioCueControlFor({ status: "unavailable", muted: false }).attention,
		).toBe(true);
		for (const status of ["playing", "waiting", "unpaced", "elsewhere"] as const) {
			expect(quizAudioCueControlFor({ status, muted: false }).attention).toBe(
				false,
			);
		}
	});
});

describe("quizAudioCueAuthoringNote — what the editor tells its author (REQ058)", () => {
	const slideWith = (quizAudioUrl: string) =>
		({ type: "quiz", quizAudioUrl }) as Pick<Slide, "type" | "quizAudioUrl">;

	test("no track says the question is silent — the presenter's screen, never the phones", () => {
		const note = quizAudioCueAuthoringNote(slideWith(""), "live");
		expect(note.warning).toBe(false);
		expect(note.text).toContain("runs in silence");
		expect(note.text).toContain("never on participants' phones");
	});

	test("an empty URL field under Custom asks for a link and says nothing is uploaded", () => {
		const note = quizAudioCueAuthoringNote(slideWith(""), "live", true);
		expect(note.warning).toBe(false);
		expect(note.text).toContain("A link to an audio file");
		expect(note.text).toContain("Nothing is uploaded");
	});

	test("a preset's path is a playable address and says when it plays", () => {
		const note = quizAudioCueAuthoringNote(
			slideWith(QUIZ_AUDIO_PRESETS[0].path),
			"live",
		);
		expect(note.warning).toBe(false);
		expect(note.text).toContain("until it closes");
	});

	test("an address no player may load is said to be one while it can still be fixed", () => {
		for (const refused of ["javascript:alert(1)", "ftp://example.com/a.mp3", "not a url"]) {
			const note = quizAudioCueAuthoringNote(slideWith(refused), "live");
			expect(note.warning).toBe(true);
			expect(note.text).toContain("can't be played");
		}
	});

	test("an audience-paced deck is told the cue will never play", () => {
		const note = quizAudioCueAuthoringNote(slideWith(TRACK), "survey");
		expect(note.warning).toBe(true);
		expect(note.text).toContain("Not in effect");
	});

	test("a playable address says when it plays", () => {
		for (const playable of [TRACK, "/media/countdown.mp3"]) {
			const note = quizAudioCueAuthoringNote(slideWith(playable), "live");
			expect(note.warning).toBe(false);
			expect(note.text).toContain("until it closes");
		}
	});
});

describe("the bundled quiz audio tracks (REQ058)", () => {
	const PUBLIC_DIR = resolve(import.meta.dir, "..", "..", "public");
	const MEBIBYTE = 1024 * 1024;

	/** The file under `public/` a preset's stored path addresses. */
	const fileOf = (path: string) => join(PUBLIC_DIR, assetSubpath(path) ?? "no-asset");

	test("there are exactly three, and no two share an id, a label or a path", () => {
		expect(QUIZ_AUDIO_PRESETS).toHaveLength(3);
		for (const key of ["id", "label", "path"] as const) {
			expect(new Set(QUIZ_AUDIO_PRESETS.map((preset) => preset[key])).size).toBe(3);
		}
	});

	test("each names a file under public/ of at most 1 MiB", () => {
		for (const preset of QUIZ_AUDIO_PRESETS) {
			const { size } = statSync(fileOf(preset.path));
			expect(size).toBeGreaterThan(0);
			expect(size).toBeLessThanOrEqual(MEBIBYTE);
		}
	});

	test("each path names the slot and no track content, so a new file needs no code", () => {
		QUIZ_AUDIO_PRESETS.forEach((preset, position) => {
			expect<string>(preset.path).toBe(`/app/audio/quiz-cue-${position + 1}.mp3`);
		});
	});

	test("the license file names each track with its label, source and license", () => {
		const license = readFileSync(
			join(PUBLIC_DIR, "licenses", "quiz-audio-tracks.txt"),
			"utf8",
		);
		for (const preset of QUIZ_AUDIO_PRESETS) {
			expect(license).toContain(`public/audio/${basename(preset.path)}`);
			expect(license).toContain(preset.label);
		}
		expect(license).toContain("Source: original work");
		expect(license).toContain("AGPL-3.0-only OR LicenseRef-omul-Commercial");
	});

	test("the static route answers each with an audio content type", async () => {
		for (const preset of QUIZ_AUDIO_PRESETS) {
			const response = await serveStatic(preset.path, { staticDir: PUBLIC_DIR });
			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
		}
	});

	test("the static route answers a HEAD's byte range with 206 and those bytes", async () => {
		const { path } = QUIZ_AUDIO_PRESETS[0];
		const fileSize = statSync(fileOf(path)).size;
		const response = await serveStatic(path, {
			staticDir: PUBLIC_DIR,
			headRange: "bytes=0-99",
		});
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
		expect(response.headers.get("Content-Range")).toBe(`bytes 0-99/${fileSize}`);
		expect((await response.arrayBuffer()).byteLength).toBe(100);
	});

	test("a HEAD's range reads an open end and a suffix, and clamps to the file", async () => {
		const { path } = QUIZ_AUDIO_PRESETS[0];
		const fileSize = statSync(fileOf(path)).size;
		const rangeOf = async (headRange: string) =>
			(await serveStatic(path, { staticDir: PUBLIC_DIR, headRange })).headers.get(
				"Content-Range",
			);
		expect(await rangeOf("bytes=100-")).toBe(
			`bytes 100-${fileSize - 1}/${fileSize}`,
		);
		expect(await rangeOf("bytes=-100")).toBe(
			`bytes ${fileSize - 100}-${fileSize - 1}/${fileSize}`,
		);
		expect(await rangeOf(`bytes=0-${fileSize + 500}`)).toBe(
			`bytes 0-${fileSize - 1}/${fileSize}`,
		);
	});

	test("a range that is unsatisfiable or not a single one leaves the ordinary answer", async () => {
		const { path } = QUIZ_AUDIO_PRESETS[0];
		const fileSize = statSync(fileOf(path)).size;
		for (const headRange of [
			`bytes=${fileSize}-`,
			"bytes=-",
			"bytes=50-10",
			"bytes=0-1,5-9",
			"items=0-99",
		]) {
			const response = await serveStatic(path, { staticDir: PUBLIC_DIR, headRange });
			expect(response.status).toBe(200);
		}
	});
});

describe("how the editor reads a stored track (REQ058)", () => {
	const [firstPreset, secondPreset] = QUIZ_AUDIO_PRESETS;

	test("a preset's path reads as that preset, whatever the URL field's state", () => {
		for (const preset of QUIZ_AUDIO_PRESETS) {
			expect(quizAudioChoiceFor(preset.path, false)).toBe(preset.id);
			expect(quizAudioChoiceFor(preset.path, true)).toBe(preset.id);
		}
	});

	test("any other non-empty value reads as Custom, including a refused one", () => {
		for (const authored of [
			TRACK,
			"/media/countdown.mp3",
			"javascript:alert(1)",
			` ${firstPreset.path}`,
			"   ",
		]) {
			expect(quizAudioChoiceFor(authored, false)).toBe("custom");
		}
	});

	test("an empty value selects nothing until the author opens Custom", () => {
		expect(quizAudioChoiceFor("", false)).toBe("none");
		expect(quizAudioChoiceFor("", true)).toBe("custom");
	});

	test("choosing a preset stores its path, replacing whatever was there", () => {
		for (const authored of ["", TRACK, secondPreset.path]) {
			expect(quizAudioUrlForOption(firstPreset.id, authored)).toBe(firstPreset.path);
		}
	});

	test("choosing Custom keeps an authored address and drops a preset's path", () => {
		expect(quizAudioUrlForOption("custom", TRACK)).toBe(TRACK);
		expect(quizAudioUrlForOption("custom", "")).toBe("");
		expect(quizAudioUrlForOption("custom", firstPreset.path)).toBe("");
	});

	test("the closed row names the preset, Custom, or None for no playable cue", () => {
		const rowValue = (quizAudioUrl: string) =>
			quizAudioCueRowValue({ type: "quiz", quizAudioUrl });
		expect(rowValue(firstPreset.path)).toBe(firstPreset.label);
		expect(rowValue(TRACK)).toBe("Custom");
		expect(rowValue("")).toBe("None");
		expect(rowValue("javascript:alert(1)")).toBe("None");
	});
});

describe("which player loops a track (REQ058)", () => {
	test("a bundled track loops as a buffer, so it goes round on the next sample", () => {
		for (const preset of QUIZ_AUDIO_PRESETS) {
			expect(quizAudioCueLoopPath(preset.path)).toBe("buffer");
		}
	});

	test("any other address keeps the media element, which needs no CORS answer", () => {
		for (const address of [
			TRACK,
			"/media/countdown.mp3",
			"/app/audio/quiz-cue-4.mp3",
			`https://cdn.example.com${QUIZ_AUDIO_PRESETS[0].path}`,
		]) {
			expect(quizAudioCueLoopPath(address)).toBe("element");
		}
	});

	const source = readFileSync(join(import.meta.dir, "QuizAudioCue.tsx"), "utf8");
	const between = (from: string, to: string) =>
		source.slice(source.indexOf(from), source.indexOf(to));

	test("the hook picks each cue's player through that decision", () => {
		const hook = between("export function useQuizAudioCue", "export function QuizAudioCueControl");
		expect(hook).toContain("const path = quizAudioCueLoopPath(cueWindow.url)");
		expect(hook).toContain("playerFor(quizAudioCueLoopPath(cueWindow.url))");
	});

	test("the element player keeps the element's own loop for a Custom address", () => {
		const elementPlayer = between(
			"export function createElementCuePlayer",
			"export type BufferCuePlayerDependencies",
		);
		expect(elementPlayer).toContain("created.loop = true");
		expect(elementPlayer).not.toContain("fetch(");
	});
});

describe("createBufferCuePlayer — a bundled track on a presenter screen (REQ058)", () => {
	const URL_ONE = QUIZ_AUDIO_PRESETS[0].path;
	const URL_TWO = QUIZ_AUDIO_PRESETS[1].path;
	const OPENED_MS = 1_000_000;
	const TRACK_SECONDS = 8;

	type FakeSource = {
		buffer: { duration: number } | null;
		loop: boolean;
		startedAt: number | null;
		stopped: boolean;
		connect: () => void;
		disconnect: () => void;
		start: (when: number, offset: number) => void;
		stop: () => void;
	};

	/** A stand-in for the browser's context, whose state a test moves by hand. */
	function fakeGraph(initialState: "running" | "suspended") {
		const sources: FakeSource[] = [];
		const gain = { gain: { value: 1 }, connect: () => {} };
		const stateListeners: (() => void)[] = [];
		const graph = {
			state: initialState as string,
			closed: false,
			destination: {},
			resume: () => new Promise<void>(() => {}),
			close: async () => {
				graph.closed = true;
			},
			decodeAudioData: async () => ({ duration: TRACK_SECONDS }),
			createGain: () => gain,
			createBufferSource: () => {
				const created: FakeSource = {
					buffer: null,
					loop: false,
					startedAt: null,
					stopped: false,
					connect: () => {},
					disconnect: () => {},
					start: (_when, offset) => {
						created.startedAt = offset;
					},
					stop: () => {
						created.stopped = true;
					},
				};
				sources.push(created);
				return created;
			},
			addEventListener: (_type: string, listener: () => void) => {
				stateListeners.push(listener);
			},
		};
		const moveTo = (state: string) => {
			graph.state = state;
			for (const listener of stateListeners) listener();
		};
		return { graph, gain, sources, moveTo };
	}

	/** A player over a fake context, with everything it reports collected. */
	function playerOver(
		initialState: "running" | "suspended",
		loadBytes: BufferCuePlayerDependencies["loadBytes"] = async () =>
			new ArrayBuffer(8),
	) {
		const fake = fakeGraph(initialState);
		const reported = {
			started: 0,
			refused: [] as QuizAudioCueProblem[],
			nowMs: OPENED_MS + 11_000,
			muted: false,
		};
		const events: QuizAudioCuePlayerEvents = {
			now: () => reported.nowMs,
			muted: () => reported.muted,
			onStarted: () => {
				reported.started += 1;
			},
			onRefused: (problem) => {
				reported.refused.push(problem);
			},
		};
		const player = createBufferCuePlayer(events, {
			makeContext: () =>
				fake.graph as unknown as ReturnType<
					BufferCuePlayerDependencies["makeContext"]
				>,
			loadBytes,
			startGraceMs: 5,
		});
		return { ...fake, player, reported };
	}

	const settle = (milliseconds = 0) =>
		new Promise((resolve) => setTimeout(resolve, milliseconds));

	test("it loops the buffer from where the window has got to", async () => {
		const { player, sources, reported } = playerOver("running");
		player.start(URL_ONE, OPENED_MS);
		await settle();
		expect(sources).toHaveLength(1);
		expect(sources[0].loop).toBe(true);
		// 11 seconds into an 8-second track is 3 seconds into its second pass.
		expect(sources[0].startedAt).toBe(3);
		expect(reported.started).toBe(1);
		expect(reported.refused).toEqual([]);
	});

	test("it stops at once when the window closes, and a late decode stays silent", async () => {
		const { player, sources } = playerOver("running");
		player.start(URL_ONE, OPENED_MS);
		await settle();
		player.silence();
		expect(sources[0].stopped).toBe(true);
		player.start(URL_TWO, OPENED_MS);
		player.silence();
		await settle();
		expect(sources).toHaveLength(1);
	});

	test("a mute sets the gain and leaves the source running in place", async () => {
		const { player, sources, gain } = playerOver("running");
		player.start(URL_ONE, OPENED_MS);
		await settle();
		player.setMuted(true);
		expect(gain.gain.value).toBe(0);
		player.setMuted(false);
		expect(gain.gain.value).toBe(1);
		expect(sources).toHaveLength(1);
		expect(sources[0].stopped).toBe(false);
	});

	test("a cue started muted starts silent", async () => {
		const { player, gain, reported } = playerOver("running");
		reported.muted = true;
		player.start(URL_ONE, OPENED_MS);
		await settle();
		expect(gain.gain.value).toBe(0);
	});

	test("a context the browser holds back reports blocked and starts no source", async () => {
		const { player, sources, reported } = playerOver("suspended");
		player.start(URL_ONE, OPENED_MS);
		await settle(20);
		expect(reported.refused).toEqual([{ url: URL_ONE, kind: "blocked" }]);
		expect(sources).toHaveLength(0);
		expect(reported.started).toBe(0);
	});

	test("a context that then starts places the track where the window has got to by then", async () => {
		const { player, sources, reported, moveTo } = playerOver("suspended");
		player.start(URL_ONE, OPENED_MS);
		await settle(20);
		reported.nowMs = OPENED_MS + 21_000;
		moveTo("running");
		expect(sources[0].startedAt).toBe(5);
		expect(reported.started).toBe(1);
	});

	test("a context that stops running under a track reports blocked, then rejoins the window", async () => {
		const { player, sources, reported, moveTo } = playerOver("running");
		player.start(URL_ONE, OPENED_MS);
		await settle();
		moveTo("interrupted");
		expect(sources[0].stopped).toBe(true);
		expect(reported.refused).toEqual([{ url: URL_ONE, kind: "blocked" }]);
		reported.nowMs = OPENED_MS + 12_000;
		moveTo("running");
		expect(sources[1].startedAt).toBe(4);
	});

	test("a track that fails to load is unavailable and is asked for again at the next window", async () => {
		let reads = 0;
		const { player, sources, reported } = playerOver("running", async () => {
			reads += 1;
			if (reads === 1) throw new Error("network dropped");
			return new ArrayBuffer(8);
		});
		player.start(URL_ONE, OPENED_MS);
		await settle();
		expect(reported.refused).toEqual([{ url: URL_ONE, kind: "unavailable" }]);
		expect(sources).toHaveLength(0);
		player.silence();
		player.start(URL_ONE, OPENED_MS);
		await settle();
		expect(reads).toBe(2);
		expect(sources).toHaveLength(1);
	});

	test("a decoded track is read once, however many windows play it", async () => {
		let reads = 0;
		const { player } = playerOver("running", async () => {
			reads += 1;
			return new ArrayBuffer(8);
		});
		player.start(URL_ONE, OPENED_MS);
		await settle();
		player.silence();
		player.start(URL_ONE, OPENED_MS);
		await settle();
		expect(reads).toBe(1);
	});

	test("release stops the track and closes the context", async () => {
		const { player, sources, graph } = playerOver("running");
		player.start(URL_ONE, OPENED_MS);
		await settle();
		player.release();
		expect(sources[0].stopped).toBe(true);
		expect(graph.closed).toBe(true);
	});
});

describe("quizAudioPreviewControlFor — the editor's play control (REQ058)", () => {
	test("idle offers to play the named track and gives no reason", () => {
		expect(quizAudioPreviewControlFor("Ticking clock", "idle")).toEqual({
			name: "Play Ticking clock",
			icon: "play",
			reason: null,
		});
	});

	test("playing offers to stop the named track", () => {
		expect(quizAudioPreviewControlFor("Heartbeat", "playing")).toEqual({
			name: "Stop Heartbeat",
			icon: "stop",
			reason: null,
		});
	});

	test("failed offers play again and says why in words", () => {
		const control = quizAudioPreviewControlFor("Plucked notes", "failed");
		expect(control.name).toBe("Play Plucked notes");
		expect(control.icon).toBe("play");
		expect(control.reason).toBe(
			"Plucked notes could not be loaded. Press play to try again.",
		);
	});

	const source = readFileSync(join(import.meta.dir, "QuizAudioCue.tsx"), "utf8");
	const previewHook = source.slice(
		source.indexOf("export function useQuizAudioPreview"),
		source.indexOf("export function QuizAudioPreviewButton"),
	);

	test("the preview plays once, and never drives the presenter's cue", () => {
		expect(previewHook).not.toContain(".loop");
		expect(previewHook).toContain('addEventListener("ended"');
		expect(previewHook).not.toContain("useQuizAudioCue");
	});

	test("the preview takes no slide, so it has nothing to write to the deck", () => {
		expect(previewHook).toContain("useQuizAudioPreview(): QuizAudioPreview");
		expect(previewHook).not.toContain("onUpdate");
		expect(previewHook).not.toContain("quizAudioUrl");
	});
});
