import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import type { Presentation } from "../types";

// ── Session clock (REQ108) ────────────────────────────────────
//
// How long the current session has been running, on the presenter surface
// alone. The two instants it reads are the server's (`sessionStartedAt`, written
// when the deck goes live, and `sessionEndedAt`, written when it ends), so a
// refreshed presenter page picks the clock up where it stood rather than
// starting it over, and a reset — which clears both — starts it again from
// nothing.

/** The fields of a deck the clock is derived from. */
export type SessionClockDeck = Pick<
	Presentation,
	"status" | "sessionStartedAt" | "sessionEndedAt"
>;

/**
 * Milliseconds the session has been running at `nowMs` (on the server's clock),
 * or `null` when there is no session to time — a deck that has never gone live,
 * or one reset since.
 *
 * An ended session stops at its end instant rather than running on, and a live
 * one runs to `nowMs`. Floored at zero, so a browser clock a moment behind the
 * server's never shows a negative duration.
 */
export function sessionElapsedMs(
	deck: SessionClockDeck | null | undefined,
	nowMs: number,
): number | null {
	if (!deck || deck.status === "draft") return null;
	const startedMs = parseInstant(deck.sessionStartedAt);
	if (startedMs === null) return null;
	const endedMs =
		deck.status === "ended" ? parseInstant(deck.sessionEndedAt) : null;
	// An ended deck with no end instant has nothing truthful to stop at, so it
	// reports no duration rather than one that keeps counting after the end.
	if (deck.status === "ended" && endedMs === null) return null;
	return Math.max(0, (endedMs ?? nowMs) - startedMs);
}

function parseInstant(instant: string | null | undefined): number | null {
	if (typeof instant !== "string") return null;
	const parsed = Date.parse(instant);
	return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A duration as the clock spells it: `M:SS` under an hour, `H:MM:SS` from
 * there on, whole seconds, rounded down so the display never runs ahead.
 */
export function formatSessionElapsed(elapsedMs: number): string {
	const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const paddedSeconds = String(seconds).padStart(2, "0");
	if (hours === 0) return `${minutes}:${paddedSeconds}`;
	return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
}

/** How often a running clock re-reads the time. */
const TICK_MS = 1000;

/**
 * Tick the session clock. `clockOffsetMs` is what the server's clock reads minus
 * this browser's, as for the quiz countdown: the start instant was written on
 * the server's clock, so the comparison runs on it too.
 *
 * Only a live session ticks; a stopped or absent one is read once and left.
 */
export function useSessionElapsed(
	deck: SessionClockDeck | null | undefined,
	clockOffsetMs: number,
): number | null {
	const status = deck?.status;
	const startedAt = deck?.sessionStartedAt ?? null;
	const endedAt = deck?.sessionEndedAt ?? null;
	const read = () =>
		sessionElapsedMs(
			status
				? { status, sessionStartedAt: startedAt, sessionEndedAt: endedAt }
				: null,
			Date.now() + clockOffsetMs,
		);
	const [elapsedMs, setElapsedMs] = useState(read);

	useEffect(() => {
		setElapsedMs(read());
		if (status !== "live" || startedAt === null) return;
		const interval = setInterval(() => setElapsedMs(read()), TICK_MS);
		return () => clearInterval(interval);
		// `read` closes over exactly the values listed here.
	}, [status, startedAt, endedAt, clockOffsetMs]);

	return elapsedMs;
}

/**
 * The presenter's session clock: elapsed time beside a clock icon. Renders
 * nothing when there is no session to time — a "0:00" on a draft deck would
 * claim a session that has not begun.
 */
export function SessionClock({
	deck,
	clockOffsetMs,
	className = "",
}: {
	deck: SessionClockDeck | null | undefined;
	clockOffsetMs: number;
	className?: string;
}) {
	const elapsedMs = useSessionElapsed(deck, clockOffsetMs);
	if (elapsedMs === null) return null;
	const formatted = formatSessionElapsed(elapsedMs);
	const label =
		deck?.status === "ended"
			? `Session ran for ${formatted}`
			: `Session running for ${formatted}`;
	return (
		<span
			role="timer"
			aria-label={label}
			title={label}
			className={`inline-flex items-center gap-1.5 text-xs font-mono tabular-nums text-text-muted flex-shrink-0 ${className}`}
		>
			<Clock size={14} />
			{formatted}
		</span>
	);
}
