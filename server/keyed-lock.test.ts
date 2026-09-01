/**
 * Unit tests for the keyed lock (`server/keyed-lock.ts`).
 *
 * The subject is the queueing itself: that two sections sharing a key never
 * overlap, that two sections on different keys still do, that a throwing
 * section hands the key on rather than wedging it, and that the map does not
 * grow by every key ever locked.
 *
 * Its reason for existing — a quiz answer's read-modify-write under concurrent
 * submissions (REQ054) — is exercised end to end in
 * `server/quiz.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { createKeyedLock } from "./keyed-lock";

/** Yield to the event loop `turns` times, the way an awaited store call does. */
async function yieldTurns(turns: number): Promise<void> {
	for (let turn = 0; turn < turns; turn++) await Promise.resolve();
}

describe("keyed lock", () => {
	test("two sections on one key do not overlap", async () => {
		const lock = createKeyedLock();
		const trace: string[] = [];

		// Each section reads, yields (the gap an `await store.find()` opens), then
		// writes. Un-queued, the two reads would both see the same "before".
		const section = (name: string) => async () => {
			trace.push(`${name}:read`);
			await yieldTurns(3);
			trace.push(`${name}:write`);
		};

		await Promise.all([
			lock.run("same", section("first")),
			lock.run("same", section("second")),
		]);

		expect(trace).toEqual([
			"first:read",
			"first:write",
			"second:read",
			"second:write",
		]);
	});

	test("sections on different keys still run concurrently", async () => {
		const lock = createKeyedLock();
		const trace: string[] = [];

		const section = (name: string) => async () => {
			trace.push(`${name}:read`);
			await yieldTurns(3);
			trace.push(`${name}:write`);
		};

		await Promise.all([
			lock.run("one", section("first")),
			lock.run("two", section("second")),
		]);

		// Interleaved, which is the whole point of keying it: a room answering
		// together must not queue behind itself.
		expect(trace).toEqual([
			"first:read",
			"second:read",
			"first:write",
			"second:write",
		]);
	});

	test("a section's result reaches its own caller", async () => {
		const lock = createKeyedLock();
		const [first, second] = await Promise.all([
			lock.run("same", async () => "first"),
			lock.run("same", async () => "second"),
		]);
		expect(first).toBe("first");
		expect(second).toBe("second");
	});

	test("a throwing section releases the key and does not fail the next one", async () => {
		const lock = createKeyedLock();
		const outcomes = await Promise.allSettled([
			lock.run("same", async () => {
				await yieldTurns(2);
				throw new Error("boom");
			}),
			lock.run("same", async () => "ran anyway"),
		]);

		expect(outcomes[0].status).toBe("rejected");
		expect((outcomes[0] as PromiseRejectedResult).reason.message).toBe("boom");
		expect(outcomes[1]).toEqual({ status: "fulfilled", value: "ran anyway" });
	});

	test("a key is forgotten once nothing is queued under it", async () => {
		const lock = createKeyedLock();
		expect(lock.trackedKeys()).toBe(0);

		const running = Promise.all([
			lock.run("same", () => yieldTurns(2)),
			lock.run("same", () => yieldTurns(2)),
			lock.run("other", () => yieldTurns(2)),
		]);
		expect(lock.trackedKeys()).toBe(2);

		await running;
		// Memory tracks contended keys, not every key ever locked.
		expect(lock.trackedKeys()).toBe(0);
	});
});
