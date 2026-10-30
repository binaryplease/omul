/**
 * Unit tests for keyed one-shot timers (`server/keyed-timers.ts`).
 *
 * The subject is the replacement rule — one pending timer per key, a later
 * schedule cancelling the earlier one — because that is what keeps a quiz
 * question whose timer was restarted from being announced over while its fresh
 * window runs (REQ216). The timer is injected, so every case fires deliberately
 * rather than sleeping.
 *
 * The close itself, end to end over a real socket, is in
 * `server/ws.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { TimerFactory } from "./coalesce";
import { createKeyedTimers } from "./keyed-timers";

/** A timer nothing fires but the test, remembering each delay it was given. */
function manualTimer(): {
	setTimer: TimerFactory;
	fire: () => Promise<void>;
	delays: number[];
	pending: () => number;
} {
	let scheduled: Array<() => void> = [];
	const delays: number[] = [];
	return {
		setTimer: (callback, delayMs) => {
			scheduled.push(callback);
			delays.push(delayMs);
			return () => {
				scheduled = scheduled.filter((queued) => queued !== callback);
			};
		},
		fire: async () => {
			const due = scheduled;
			scheduled = [];
			for (const callback of due) callback();
			await Promise.resolve();
			await Promise.resolve();
		},
		delays,
		pending: () => scheduled.length,
	};
}

describe("keyed timers", () => {
	test("runs the work for a key once its timer fires, and forgets the key", async () => {
		const timer = manualTimer();
		const runs: string[] = [];
		const timers = createKeyedTimers({
			work: async (key) => {
				runs.push(key);
			},
			setTimer: timer.setTimer,
		});
		timers.schedule("deck:qz", 31_501);
		expect(timer.delays).toEqual([31_501]);
		expect(runs).toEqual([]);
		expect(timers.pendingKeys()).toBe(1);

		await timer.fire();
		expect(runs).toEqual(["deck:qz"]);
		expect(timers.pendingKeys()).toBe(0);
	});

	test("a second schedule on the same key replaces the first", async () => {
		const timer = manualTimer();
		const runs: string[] = [];
		const timers = createKeyedTimers({
			work: async (key) => {
				runs.push(key);
			},
			setTimer: timer.setTimer,
		});
		timers.schedule("deck:qz", 1_000);
		timers.schedule("deck:qz", 5_000);
		// The first timer was called off, so only one is left to fire.
		expect(timer.pending()).toBe(1);
		await timer.fire();
		expect(runs).toEqual(["deck:qz"]);
	});

	test("keys are independent of each other", async () => {
		const timer = manualTimer();
		const runs: string[] = [];
		const timers = createKeyedTimers({
			work: async (key) => {
				runs.push(key);
			},
			setTimer: timer.setTimer,
		});
		timers.schedule("deck:q1", 1_000);
		timers.schedule("deck:q2", 1_000);
		await timer.fire();
		expect(runs.sort()).toEqual(["deck:q1", "deck:q2"]);
	});

	test("cancel and reset drop what is pending", async () => {
		const timer = manualTimer();
		const runs: string[] = [];
		const timers = createKeyedTimers({
			work: async (key) => {
				runs.push(key);
			},
			setTimer: timer.setTimer,
		});
		timers.schedule("deck:q1", 1_000);
		timers.schedule("deck:q2", 1_000);
		timers.cancel("deck:q1");
		expect(timers.pendingKeys()).toBe(1);
		timers.reset();
		expect(timers.pendingKeys()).toBe(0);
		await timer.fire();
		expect(runs).toEqual([]);
	});

	test("a delay already past is clamped to zero, never run inline", () => {
		const timer = manualTimer();
		const runs: string[] = [];
		const timers = createKeyedTimers({
			work: async (key) => {
				runs.push(key);
			},
			setTimer: timer.setTimer,
		});
		timers.schedule("deck:qz", -250);
		expect(timer.delays).toEqual([0]);
		expect(runs).toEqual([]);
	});

	test("a failing run is reported, not thrown", async () => {
		const timer = manualTimer();
		const failures: string[] = [];
		const timers = createKeyedTimers({
			work: async () => {
				throw new Error("store gone");
			},
			onError: (key, cause) => failures.push(`${key}: ${(cause as Error).message}`),
			setTimer: timer.setTimer,
		});
		timers.schedule("deck:qz", 10);
		await timer.fire();
		expect(failures).toEqual(["deck:qz: store gone"]);
	});
});
