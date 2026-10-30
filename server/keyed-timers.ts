/**
 * One pending one-shot timer per key: schedule work for a moment in the future,
 * and let a later schedule on the same key replace the earlier one.
 *
 * What this exists for is a quiz question's window closing (REQ216). The window
 * is defined on the server — `slideStartedAt` plus the time limit plus the
 * submission grace — and when it runs out nothing else happens: no answer
 * lands, no presenter clicks, so nothing would tell the room the question is
 * over. The server marks that instant itself, by scheduling a run for it when
 * the question opens.
 *
 * The properties that matter, and why:
 *
 *  - **A key holds at most one timer.** Scheduling a key that is already
 *    pending cancels the old timer first. A presenter restarting a question's
 *    timer moves its close, and the close that was scheduled for the old window
 *    must not fire into the new one.
 *  - **The work re-reads, it does not trust the schedule.** Nothing here knows
 *    what the key means; the caller's `work` is handed the key alone and decides
 *    from what is stored whether there is anything to do. A timer that outlives
 *    the state it was scheduled for — a deck reset, ended or deleted — therefore
 *    costs one read and does nothing.
 *  - **Unref'd**, through {@link scheduleWithTimeout}: a pending close never
 *    holds a test run or a stopping server open.
 *  - **Detached failures are routed, never thrown.** A run fires from a timer,
 *    so there is no caller to hand an error to; without `onError` an unhandled
 *    rejection would take the process with it.
 *
 * In memory, so a restart loses every pending timer. That is the caller's to
 * re-arm from the store on boot — the store is the truth, this is only a
 * reminder of when to look at it.
 */

import { scheduleWithTimeout, type TimerFactory } from "./coalesce";

interface KeyedTimersOptions {
	/** What runs when a key's timer fires. Handed the key and nothing else. */
	work: (key: string) => Promise<void>;
	/** What a run's failure is reported to. */
	onError?: (key: string, cause: unknown) => void;
	/** Timer override, so tests fire a run instead of waiting for it. */
	setTimer?: TimerFactory;
}

/** Pending one-shot timers, at most one per key. */
export interface KeyedTimers {
	/**
	 * Run the work for `key` in `delayMs`, replacing whatever was pending for it.
	 * A delay at or below zero runs on the next turn of the event loop rather
	 * than inline, so a caller never runs the work inside its own write. A delay
	 * past {@link MAX_TIMER_DELAY_MS} is capped to it — the work fires early and
	 * is expected to re-read and schedule the remainder.
	 */
	schedule(key: string, delayMs: number): void;
	/** Drop the pending timer for `key`, if there is one. */
	cancel(key: string): void;
	/** Drop every pending timer (tests). */
	reset(): void;
	/** How many keys hold a pending timer (tests, introspection). */
	pendingKeys(): number;
}

/**
 * The longest delay a timer can be handed as it was asked: 2³¹−1 ms, about 24.8
 * days. Past it the runtime does not wait longer, it fires after **one**
 * millisecond — so a work function that finds its moment still ahead and
 * schedules the rest again (as a quiz close does for a window that has moved
 * later) would spin on the store once per millisecond for as long as the delay
 * stays out of range. A delay past this is waited out in steps of it instead:
 * the work re-reads when the step fires and schedules what is left.
 */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** Ignore a run's failure when the caller supplied no handler. */
function ignoreError(): void {}

/**
 * Keyed one-shot timers (factory over class). A key is in the map exactly while
 * its timer is pending, so the map is the size of what is scheduled rather than
 * of everything ever scheduled.
 */
export function createKeyedTimers(options: KeyedTimersOptions): KeyedTimers {
	const { work } = options;
	const setTimer = options.setTimer ?? scheduleWithTimeout;
	const onError = options.onError ?? ignoreError;
	const cancelByKey = new Map<string, () => void>();

	function cancel(key: string): void {
		const pending = cancelByKey.get(key);
		if (!pending) return;
		pending();
		cancelByKey.delete(key);
	}

	function schedule(key: string, delayMs: number): void {
		cancel(key);
		const cancelTimer = setTimer(
			() => {
				// Only the timer that is still the key's own may clear it: a
				// schedule made while this one was being fired owns the key now.
				if (cancelByKey.get(key) === cancelTimer) cancelByKey.delete(key);
				work(key).catch((cause: unknown) => onError(key, cause));
			},
			Math.min(MAX_TIMER_DELAY_MS, Math.max(0, delayMs)),
		);
		cancelByKey.set(key, cancelTimer);
	}

	function reset(): void {
		for (const pending of cancelByKey.values()) pending();
		cancelByKey.clear();
	}

	return {
		schedule,
		cancel,
		reset,
		pendingKeys: () => cancelByKey.size,
	};
}
