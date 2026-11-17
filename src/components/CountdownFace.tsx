import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useInterfaceText } from "../interface-language";
import { ENGLISH_INTERFACE_TEXT, type InterfaceText } from "../interface-text";
import type {
	CountdownAction,
	CountdownPhase,
	CountdownRunState,
	Presentation,
	Slide,
} from "../types";
import {
	countdownPhase,
	countdownRemainingSeconds,
	formatCountdown,
} from "../types";

// ── The countdown's clock face (REQ107) ───────────────────────────────
//
// One face for every surface that draws a countdown slide — the editor canvas,
// the shared screen and every phone — so the length an author set reads the
// same digits at the same weight wherever the room looks. It draws whatever
// number of seconds it is handed and nothing else: the slide's authored length
// outside a session, and the time left or the frozen time once the presenter
// has started one.
//
// The running clock is one descriptor ({@link countdownRunFor}), one ticking
// hook ({@link useCountdownSeconds}) and one wrapper ({@link CountdownSlideFace}),
// composed by the presenter's screen and the participant's phone alike — the
// same shape REQ057's quiz countdown has, and for its reason: a clock two
// surfaces re-derived would eventually be two clocks.

export function CountdownFace({
	seconds,
	compact = false,
}: {
	/** The seconds to show — never negative on the face, whatever arrives. */
	seconds: number;
	/** Shrinks the face for preview panels. */
	compact?: boolean;
}) {
	return (
		<span
			role="timer"
			className={`font-mono font-bold tabular-nums leading-none text-accent-text ${
				compact ? "text-5xl" : "text-[9rem] max-sm:text-7xl"
			}`}
		>
			{formatCountdown(seconds)}
		</span>
	);
}

/**
 * A countdown slide's run as a live surface draws it: the run the server recorded
 * — `null` with none — and the offset to the server's clock it was written on.
 */
export type CountdownRun = {
	state: CountdownRunState | null;
	/** What the server's clock reads minus this browser's (REQ057). */
	clockOffsetMs: number;
};

/**
 * The run the presentation the server published records for this slide — the
 * one read of `countdownRuns`, composed by the shared screen and the phone.
 */
export function countdownRunFor(
	slide: Pick<Slide, "id">,
	presentation: Pick<Presentation, "countdownRuns"> | null | undefined,
	clockOffsetMs: number,
): CountdownRun {
	return {
		state: presentation?.countdownRuns?.[slide.id] ?? null,
		clockOffsetMs,
	};
}

/** How often a running countdown re-reads the clock. */
const TICK_MS = 250;

/**
 * The seconds a countdown slide's face shows now, ticking while it runs.
 *
 * Every reading is on the server's clock, the one the run was stamped on, so a
 * phone whose clock is out still shows the time the projector shows — and a
 * surface that opens mid-run (a late join, a reload) starts from the time left
 * rather than from the top. No interval runs for a clock that is not running,
 * and a running one stops ticking once it reads zero.
 */
export function useCountdownSeconds(
	slide: Pick<Slide, "countdownSeconds">,
	run: CountdownRun | null,
): number {
	const state = run?.state ?? null;
	const hasRun = state !== null;
	const remainingMs = state?.remainingMs ?? 0;
	const resumedAt = state?.resumedAt ?? null;
	const clockOffsetMs = run?.clockOffsetMs ?? 0;
	const countdownSeconds = slide.countdownSeconds;
	const read = () =>
		countdownRemainingSeconds(
			{ countdownSeconds },
			hasRun ? { remainingMs, resumedAt } : null,
			Date.now() + clockOffsetMs,
		);
	const [seconds, setSeconds] = useState(read);

	useEffect(() => {
		setSeconds(read());
		if (resumedAt === null || read() <= 0) return;
		const interval = setInterval(() => {
			const left = read();
			setSeconds(left);
			if (left <= 0) clearInterval(interval);
		}, TICK_MS);
		return () => clearInterval(interval);
		// `read` closes over exactly the values listed.
	}, [hasRun, remainingMs, resumedAt, clockOffsetMs, countdownSeconds]);

	return seconds;
}

/**
 * A countdown slide's face: reading the server's clock when handed a run, and at
 * the full authored length when not — the editor canvas, the rail and every
 * surface outside a session hand it none.
 */
export function CountdownSlideFace({
	slide,
	run,
	compact = false,
}: {
	slide: Pick<Slide, "countdownSeconds">;
	run: CountdownRun | null;
	compact?: boolean;
}) {
	return <CountdownFace seconds={useCountdownSeconds(slide, run)} compact={compact} />;
}

/**
 * What the presenter's start/pause control says, as its accessible name and its
 * tooltip — including why it is dead when it is (ADR-0025). In the interface
 * language (REQ248): the control is the presenter's.
 */
export function countdownControlLabel(
	{
		phase,
		canControl,
		live,
	}: {
		phase: CountdownPhase;
		canControl: boolean;
		live: boolean;
	},
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string {
	const { slideView } = text;
	if (!canControl) return slideView.countdownNotEditor;
	if (phase === "finished") return slideView.countdownFinishedLabel;
	if (!live) return slideView.countdownNotLive;
	if (phase === "running") return slideView.countdownPauseLabel;
	if (phase === "paused") return slideView.countdownResumeLabel;
	return slideView.countdownStartLabel;
}

/**
 * What the presenter's reset control says, as its accessible name and its
 * tooltip — including why it is dead when it is (ADR-0025).
 */
export function countdownResetLabel(
	{
		phase,
		canControl,
	}: {
		phase: CountdownPhase;
		canControl: boolean;
	},
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string {
	const { slideView } = text;
	if (!canControl) return slideView.countdownResetNotEditor;
	if (phase === "idle") return slideView.countdownResetIdle;
	return slideView.countdownResetLabel;
}

/**
 * The presenter's controls, beside the clock they run (REQ107): start, pause or
 * resume as one button, and reset as another. Composes the same ticking hook as
 * the face, so the controls change to the finished state when the clock reads
 * 0:00, with no message from the server.
 */
export function CountdownRunControls({
	slide,
	run,
	canControl,
	live,
	onAction,
}: {
	slide: Pick<Slide, "countdownSeconds">;
	run: CountdownRun;
	canControl: boolean;
	live: boolean;
	onAction: (action: CountdownAction) => void;
}) {
	const { text, language } = useInterfaceText();
	useCountdownSeconds(slide, run);
	const phase = countdownPhase(run.state, Date.now() + run.clockOffsetMs);
	const running = phase === "running";
	const label = countdownControlLabel({ phase, canControl, live }, text);
	const resetLabel = countdownResetLabel({ phase, canControl }, text);
	return (
		<div className="flex flex-wrap items-center gap-3" lang={language}>
			<button
				type="button"
				onClick={() => onAction(running ? "pause" : "start")}
				disabled={!canControl || !live || phase === "finished"}
				aria-label={label}
				title={label}
				className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{running ? <Pause size={16} /> : <Play size={16} />}
				{running
					? text.slideView.countdownPause
					: phase === "paused"
						? text.slideView.countdownResume
						: text.slideView.countdownStart}
			</button>
			<button
				type="button"
				onClick={() => onAction("reset")}
				disabled={!canControl || phase === "idle"}
				aria-label={resetLabel}
				title={resetLabel}
				className="btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<RotateCcw size={16} />
				{text.slideView.countdownReset}
			</button>
		</div>
	);
}
