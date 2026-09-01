/**
 * Unit tests for the coalescer (`server/coalesce.ts`).
 *
 * The subject is the folding itself: that the first caller of a quiet key is not
 * made to wait, that callers arriving inside a window are merged rather than
 * dropped, that the last one's change always reaches a run, that a sustained
 * burst keeps its cadence instead of going quiet after one trailing run, and
 * that runs on one key never overlap.
 *
 * The timer is injected throughout, so every case fires its trailing run
 * deliberately rather than sleeping — a suite that waited out real windows would
 * be slow and would still only prove the timing on the machine that ran it.
 *
 * Its reason for existing — the deck-wide standings recount on the path every
 * answer in the room walks (REQ059) — is exercised end to end in
 * `server/leaderboard.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { createCoalescer, type TimerFactory } from "./coalesce";

/** Yield to the event loop `turns` times, the way an awaited store call does. */
async function yieldTurns(turns: number): Promise<void> {
	for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

/**
 * A timer nothing fires but the test. `pending` holds the callbacks currently
 * scheduled; `fire()` runs them, which is what "the window elapsed" means here.
 */
function manualTimer(): {
	setTimer: TimerFactory;
	fire: () => Promise<void>;
	pending: () => number;
} {
	let scheduled: Array<() => void> = [];
	return {
		setTimer: (callback) => {
			scheduled.push(callback);
			return () => {
				scheduled = scheduled.filter((queued) => queued !== callback);
			};
		},
		fire: async () => {
			const due = scheduled;
			scheduled = [];
			for (const callback of due) callback();
			// Let the run the callback started settle before the test looks.
			await yieldTurns(8);
		},
		pending: () => scheduled.length,
	};
}

describe("coalescer", () => {
	test("the first caller of a quiet key runs immediately, and is awaited", async () => {
		const timer = manualTimer();
		const runs: string[] = [];
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async (key) => {
				runs.push(key);
			},
		});

		await coalescer.run("deck");

		// Not "eventually" — by the time `run` resolves the work is done, which is
		// what keeps a lone change as immediate as it was before any of this.
		expect(runs).toEqual(["deck"]);
	});

	test("callers inside the window are folded into one trailing run", async () => {
		const timer = manualTimer();
		let runs = 0;
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async () => {
				runs++;
			},
		});

		// One leading run, then a whole room's worth of answers behind it.
		await coalescer.run("deck");
		expect(runs).toBe(1);
		for (let answer = 0; answer < 300; answer++) await coalescer.run("deck");

		// Still one: the 300 were absorbed, not queued.
		expect(runs).toBe(1);

		await timer.fire();

		// And exactly one more carries all 300 of them. This is the whole point —
		// 301 triggers, 2 rescans.
		expect(runs).toBe(2);
	});

	test("a quiet window releases the key without running again", async () => {
		const timer = manualTimer();
		let runs = 0;
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async () => {
				runs++;
			},
		});

		await coalescer.run("deck");
		expect(coalescer.pendingKeys()).toBe(1);

		await timer.fire();

		// Nothing moved during the window, so there was nothing to send — and the
		// key is let go rather than held by a timer that reschedules forever.
		expect(runs).toBe(1);
		expect(coalescer.pendingKeys()).toBe(0);
		expect(timer.pending()).toBe(0);
	});

	test("a sustained burst keeps one run per window rather than going quiet", async () => {
		const timer = manualTimer();
		let runs = 0;
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async () => {
				runs++;
			},
		});

		await coalescer.run("deck");
		// Three windows, each with answers still landing in it — a room working
		// through a question rather than one that answered all at once.
		for (let window = 0; window < 3; window++) {
			await coalescer.run("deck");
			await coalescer.run("deck");
			await timer.fire();
		}

		// Leading run plus one per window: the board moves *throughout* the burst.
		// A debounce would have sent one frame at the very end and nothing before.
		expect(runs).toBe(4);
	});

	test("a change landing mid-run earns its own trailing run", async () => {
		const timer = manualTimer();
		let runs = 0;
		let release = () => {};
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async () => {
				runs++;
				// Hold the run open so the test can land a change inside it.
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			},
		});

		const leading = coalescer.run("deck");
		await yieldTurns(2);
		expect(runs).toBe(1);

		// The store moved while the leading run was already reading it, so this
		// change is not in the result that run is about to produce.
		await coalescer.run("deck");
		release();
		await leading;

		await timer.fire();
		// Which means it has to be carried by a further run, not folded into the
		// one that predated it.
		expect(runs).toBe(2);
	});

	test("runs on one key never overlap", async () => {
		const timer = manualTimer();
		const trace: string[] = [];
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async (key) => {
				trace.push(`${key}:start`);
				await yieldTurns(4);
				trace.push(`${key}:end`);
			},
		});

		await coalescer.run("deck");
		await coalescer.run("deck");
		await timer.fire();

		// Serialized by construction — which is what stops an older board being
		// broadcast after a newer one.
		expect(trace).toEqual([
			"deck:start",
			"deck:end",
			"deck:start",
			"deck:end",
		]);
	});

	test("different keys do not share a window", async () => {
		const timer = manualTimer();
		const runs: string[] = [];
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async (key) => {
				runs.push(key);
			},
		});

		// Two decks running at once must not throttle each other.
		await coalescer.run("deck-one");
		await coalescer.run("deck-two");

		expect(runs).toEqual(["deck-one", "deck-two"]);
		expect(coalescer.pendingKeys()).toBe(2);
	});

	test("a leading run's failure reaches its caller", async () => {
		const timer = manualTimer();
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async () => {
				throw new Error("recount failed");
			},
		});

		// The caller is still awaiting it, so it is theirs to hear about — the
		// direct call this replaced threw the same way.
		await expect(coalescer.run("deck")).rejects.toThrow("recount failed");

		// And the failure does not wedge the key: the window still opens behind it,
		// so the next change is not stranded by one that went wrong.
		expect(coalescer.pendingKeys()).toBe(1);
	});

	test("a trailing run's failure is reported, not thrown into the void", async () => {
		const timer = manualTimer();
		const failures: string[] = [];
		let attempts = 0;
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			onError: (key) => failures.push(key),
			work: async () => {
				attempts++;
				// The leading run succeeds; the trailing one does not.
				if (attempts > 1) throw new Error("recount failed");
			},
		});

		await coalescer.run("deck");
		await coalescer.run("deck");
		await timer.fire();

		// Detached from any request, so an unhandled rejection here would take the
		// process with it.
		expect(failures).toEqual(["deck"]);
	});

	test("a failed trailing run still hands the window on", async () => {
		const timer = manualTimer();
		let runs = 0;
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			onError: () => {},
			work: async () => {
				runs++;
				if (runs === 2) throw new Error("recount failed");
			},
		});

		await coalescer.run("deck");
		await coalescer.run("deck");
		await timer.fire();
		expect(runs).toBe(2);

		// A throw must not wedge the key: the next change still gets a recount.
		await coalescer.run("deck");
		await timer.fire();
		expect(runs).toBe(3);
	});

	test("reset cancels pending work and forgets every key", async () => {
		const timer = manualTimer();
		let runs = 0;
		const coalescer = createCoalescer({
			windowMs: 500,
			setTimer: timer.setTimer,
			work: async () => {
				runs++;
			},
		});

		await coalescer.run("deck");
		await coalescer.run("deck");
		expect(coalescer.pendingKeys()).toBe(1);

		coalescer.reset();

		expect(coalescer.pendingKeys()).toBe(0);
		expect(timer.pending()).toBe(0);
		await timer.fire();
		expect(runs).toBe(1);
	});
});
