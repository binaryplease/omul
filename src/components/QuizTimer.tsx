import { Timer, TimerOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { Presentation, Slide } from "../types";
import { quizDeadlineFor, quizRemainingMs, quizTimeLimitFor } from "../types";

// ── Quiz question countdown (REQ057) ──────────────────────────
//
// A quiz question's remaining time appears on two surfaces — the participant's
// phone, where it decides whether an answer can still be given, and the shared
// screen, where it paces the room — so it is one descriptor
// ({@link quizWindowFor}), one shared wrapper ({@link QuizTimer}), and one
// clock ({@link useQuizCountdown}). Neither surface re-derives when a question
// closes; if they could, they would eventually disagree, and the one thing a
// countdown has to be is the same countdown for everybody.
//
// The window itself is not computed here. It is the server's
// (`slideStartedAt` + the authored `timeLimit`), read back through the same
// schema functions the boundary enforces it with, so what the participant sees
// running out and what the server refuses are the same instant by construction.

/** When a quiz question closes, and the window it is counting down. */
export type QuizWindow = {
	/** Seconds the question stays open, or `null` when it has no limit. */
	timeLimit: number | null;
	/**
	 * When it closes, in epoch milliseconds **on the server's clock** — or
	 * `null` when it never does: an untimed question, or one the presenter has
	 * not opened yet (a survey, or a slide still ahead in a live deck).
	 */
	deadline: number | null;
};

/** A window that never closes — the shape every "no deadline" case takes. */
const OPEN_ENDED: QuizWindow = { timeLimit: null, deadline: null };

/**
 * The window a slide's question is running on (REQ057), read from the
 * presentation the server published. Non-quiz slides have none: a poll or a
 * word cloud stays open for as long as it is on screen.
 */
export function quizWindowFor(
	slide: Pick<Slide, "id" | "type" | "timeLimit"> | null | undefined,
	presentation: Pick<Presentation, "slideStartedAt"> | null | undefined,
): QuizWindow {
	if (!slide || slide.type !== "quiz") return OPEN_ENDED;
	const timeLimit = quizTimeLimitFor(slide);
	return {
		timeLimit,
		deadline: quizDeadlineFor(presentation?.slideStartedAt?.[slide.id], timeLimit),
	};
}

/** How often the countdown re-reads the clock. */
const TICK_MS = 250;

/** Where a countdown currently stands. */
export type QuizCountdown = {
	/** Milliseconds left, floored at zero. */
	remainingMs: number;
	/** Whole seconds left, as the surfaces spell it out. */
	remainingSeconds: number;
	/** Whether the window has closed — the reason a control is disabled. */
	expired: boolean;
	/** How much of the window is left, 0–1, for the bar. */
	remainingShare: number;
	/** Whether there is a window to show at all. */
	timed: boolean;
};

/**
 * Tick a quiz question's countdown down to its deadline.
 *
 * `clockOffsetMs` is what the server's clock reads minus what this browser's
 * does, captured when the presentation was fetched. Every comparison here runs
 * on the server's clock, because the deadline was written on it: a phone whose
 * clock is minutes out would otherwise show a countdown that has nothing to do
 * with the one the boundary is enforcing — and would be refused with time
 * apparently still on the display.
 *
 * The interval stops itself at the deadline rather than running for the rest of
 * the session, and does not start at all for a question with no window.
 */
export function useQuizCountdown(
	quizWindow: QuizWindow,
	clockOffsetMs: number,
): QuizCountdown {
	const { deadline, timeLimit } = quizWindow;
	const serverNow = () => Date.now() + clockOffsetMs;
	const [remainingMs, setRemainingMs] = useState(() =>
		quizRemainingMs(deadline, serverNow()),
	);

	useEffect(() => {
		if (deadline === null) {
			setRemainingMs(0);
			return;
		}
		const read = () => quizRemainingMs(deadline, Date.now() + clockOffsetMs);
		setRemainingMs(read());
		// A question that was already over when this surface opened it — a
		// participant joining late, a presenter paging back — has nothing left to
		// count, so no interval is started at all.
		if (read() <= 0) return;
		const interval = setInterval(() => {
			const left = read();
			setRemainingMs(left);
			if (left <= 0) clearInterval(interval);
		}, TICK_MS);
		return () => clearInterval(interval);
	}, [deadline, clockOffsetMs]);

	const windowMs = timeLimit === null ? 0 : timeLimit * 1000;
	return {
		remainingMs,
		remainingSeconds: Math.ceil(remainingMs / 1000),
		// A question with no deadline is never expired — it is open-ended, which
		// is a different statement from "over" and must not disable anything.
		expired: deadline !== null && remainingMs <= 0,
		remainingShare: windowMs > 0 ? Math.min(1, remainingMs / windowMs) : 1,
		timed: deadline !== null,
	};
}

/**
 * The countdown itself: seconds left over a bar that drains with them, or the
 * closed state once the window is past.
 *
 * Rendered identically on both surfaces so "how long have I got?"
 * reads the same on a phone and on the projector. A question with no window
 * renders nothing at all — there is no time to report, and a "∞" would only
 * invite the reader to look for a number.
 */
export function QuizTimer({
	countdown,
	label,
	expiredLabel,
	className = "",
}: {
	countdown: QuizCountdown;
	/** Unit suffix beside the number, e.g. "s left" — localized by the caller. */
	label: string;
	/** What the closed state says, e.g. "Time's up". */
	expiredLabel: string;
	className?: string;
}) {
	if (!countdown.timed) return null;
	const { expired, remainingSeconds, remainingShare } = countdown;
	// The last quarter of the window reads as urgent, the last tenth as almost
	// gone — the same escalation the room feels, so the colour is information
	// rather than decoration.
	const tone = expired
		? "text-error"
		: remainingShare <= 0.1
			? "text-error"
			: remainingShare <= 0.25
				? "text-warning"
				: "text-accent-text";
	return (
		// The tone sits on the wrapper so the bar can be filled with
		// `currentColor` — one colour decision, worn by the number and the bar
		// together, rather than two that could drift apart.
		<div className={`w-full max-w-xs mx-auto ${tone} ${className}`}>
			<div className="flex items-center justify-center gap-2">
				{expired ? <TimerOff size={16} /> : <Timer size={16} />}
				<span className="font-mono text-sm font-semibold tabular-nums">
					{expired ? expiredLabel : `${remainingSeconds}${label}`}
				</span>
			</div>
			<div className="mt-1.5 h-1.5 rounded-full bg-surface-raised overflow-hidden border border-border">
				<div
					className="h-full rounded-full bar-fill"
					style={{
						width: `${Math.round(remainingShare * 100)}%`,
						background: "currentColor",
					}}
				/>
			</div>
		</div>
	);
}
