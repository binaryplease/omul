/**
 * Unit tests for who is asked about omul after a session (REQ186) — the sample,
 * the two records the device keeps, and the one decision that combines them
 * with the instance's switch.
 *
 * What they are protecting: the sample is the operator's promise about how much
 * of a room is interrupted, so it has to give the same answer on a reload and
 * land on the configured share; and the device's records are what keep the
 * prompt away from a phone that was never in the room and from one asked a week
 * ago. `localStorage` is a stub, as in `src/api.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	hasSeenDeckInRoom,
	isInFeedbackSample,
	isOutsideFeedbackPromptCooldown,
	lastAskedForFeedbackAt,
	rememberAskedForFeedback,
	rememberDeckSeenInRoom,
	shouldAskForParticipantFeedback,
} from "./feedback-prompt";
import {
	FEEDBACK_PROMPT_ASKED_AT_KEY,
	FEEDBACK_PROMPT_IN_ROOM_KEY,
} from "./storage";

/** The smallest thing that behaves like `localStorage` for these reads. */
function installStorageStub(): Map<string, string> {
	const entries = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
		removeItem: (key: string) => {
			entries.delete(key);
		},
		clear: () => entries.clear(),
	};
	return entries;
}

// Installed per test and put back after, so another suite's stub in the same
// process is left as it found it.
let storage = new Map<string, string>();
let previousStorage: unknown;

beforeEach(() => {
	previousStorage = (globalThis as { localStorage?: unknown }).localStorage;
	storage = installStorageStub();
});

afterEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = previousStorage;
});

const DAY_MS = 24 * 60 * 60 * 1000;
const STARTED = "2026-10-09T09:00:00.000Z";
const NOW = Date.parse("2026-10-09T10:00:00.000Z");

function participantIds(count: number): string[] {
	return Array.from({ length: count }, (_unused, index) => `participant-${index}`);
}

function shareSampled(
	ids: string[],
	percent: number,
	presentationId = "deck-1",
	sessionStartedAt: string | null = STARTED,
): number {
	const sampled = ids.filter((participantId) =>
		isInFeedbackSample({ participantId, presentationId, sessionStartedAt, percent }),
	);
	return (sampled.length / ids.length) * 100;
}

describe("the sample", () => {
	test("the same participant, deck and run always draw the same answer", () => {
		for (const participantId of participantIds(200)) {
			const draw = {
				participantId,
				presentationId: "deck-1",
				sessionStartedAt: STARTED,
				percent: 37,
			};
			const first = isInFeedbackSample(draw);
			for (let repeat = 0; repeat < 5; repeat++) {
				expect(isInFeedbackSample({ ...draw })).toBe(first);
			}
		}
	});

	test("the share asked converges on the percentage", () => {
		const ids = participantIds(20_000);
		for (const percent of [1, 5, 10, 25, 50, 75, 90]) {
			expect(Math.abs(shareSampled(ids, percent) - percent)).toBeLessThan(1);
		}
	});

	test("100 asks everybody", () => {
		expect(shareSampled(participantIds(2_000), 100)).toBe(100);
	});

	test("the sample grows with the percentage rather than redrawing", () => {
		// A participant asked at 10% is asked at 50% too, so raising the share
		// only adds people to the room's sample.
		for (const participantId of participantIds(2_000)) {
			const draw = { participantId, presentationId: "deck-1", sessionStartedAt: STARTED };
			if (isInFeedbackSample({ ...draw, percent: 10 })) {
				expect(isInFeedbackSample({ ...draw, percent: 50 })).toBe(true);
			}
		}
	});

	test("a deck that never went live asks nobody", () => {
		expect(shareSampled(participantIds(2_000), 100, "deck-1", null)).toBe(0);
	});

	test("another deck, or another run of the same one, is a fresh draw", () => {
		// Independent draws at 50% agree on about half the room; one draw read
		// twice would agree on all of it.
		const ids = participantIds(10_000);
		const sampledIn = (presentationId: string, sessionStartedAt: string) =>
			ids.map((participantId) =>
				isInFeedbackSample({ participantId, presentationId, sessionStartedAt, percent: 50 }),
			);
		const firstRun = sampledIn("deck-1", STARTED);
		for (const other of [
			sampledIn("deck-2", STARTED),
			sampledIn("deck-1", "2026-10-10T09:00:00.000Z"),
		]) {
			const agreeing = firstRun.filter((asked, index) => asked === other[index]).length;
			expect(Math.abs((agreeing / ids.length) * 100 - 50)).toBeLessThan(3);
		}
	});
});

describe("the cooldown", () => {
	test("never asked is outside it", () => {
		expect(isOutsideFeedbackPromptCooldown(null, 30, NOW)).toBe(true);
	});

	test("inside it until the configured days have passed, outside from then", () => {
		expect(isOutsideFeedbackPromptCooldown(NOW - 29 * DAY_MS, 30, NOW)).toBe(false);
		expect(isOutsideFeedbackPromptCooldown(NOW - 30 * DAY_MS + 1, 30, NOW)).toBe(false);
		expect(isOutsideFeedbackPromptCooldown(NOW - 30 * DAY_MS, 30, NOW)).toBe(true);
		expect(isOutsideFeedbackPromptCooldown(NOW - 2 * DAY_MS, 1, NOW)).toBe(true);
	});

	test("being asked is remembered on the device", () => {
		expect(lastAskedForFeedbackAt()).toBeNull();
		rememberAskedForFeedback(NOW);
		expect(lastAskedForFeedbackAt()).toBe(NOW);
		expect(storage.get(FEEDBACK_PROMPT_ASKED_AT_KEY)).toBe(String(NOW));
	});

	test("a stored value that is not a time reads as never asked", () => {
		for (const stored of ["", "soon", "-5", "0", "NaN"]) {
			storage.set(FEEDBACK_PROMPT_ASKED_AT_KEY, stored);
			expect(lastAskedForFeedbackAt()).toBeNull();
		}
	});
});

describe("being in the room", () => {
	test("a deck is remembered per deck", () => {
		rememberDeckSeenInRoom("deck-1", NOW);
		expect(hasSeenDeckInRoom("deck-1")).toBe(true);
		expect(hasSeenDeckInRoom("deck-2")).toBe(false);
	});

	test("seeing it again does not stack entries", () => {
		rememberDeckSeenInRoom("deck-1", NOW);
		rememberDeckSeenInRoom("deck-1", NOW + 1);
		expect(
			JSON.parse(storage.get(FEEDBACK_PROMPT_IN_ROOM_KEY) as string),
		).toEqual({ "deck-1": NOW + 1 });
	});

	test("a stored value this browser did not write reads as never in the room", () => {
		for (const stored of ["{not json", "null", "[1,2]", "42", '{"deck-1":"yes"}']) {
			storage.set(FEEDBACK_PROMPT_IN_ROOM_KEY, stored);
			expect(hasSeenDeckInRoom("deck-1")).toBe(false);
		}
	});

	test("a bad map is replaced rather than inherited on the next write", () => {
		storage.set(FEEDBACK_PROMPT_IN_ROOM_KEY, "null");
		rememberDeckSeenInRoom("deck-1", NOW);
		expect(hasSeenDeckInRoom("deck-1")).toBe(true);
	});
});

describe("the decision", () => {
	const deck = { id: "deck-1", sessionStartedAt: STARTED };
	const on = { promptPercent: 100, promptCooldownDays: 30 };

	function ask(
		overrides: Partial<Parameters<typeof shouldAskForParticipantFeedback>[0]> = {},
	): boolean {
		return shouldAskForParticipantFeedback({
			config: on,
			deck,
			participantId: "participant-1",
			now: NOW,
			...overrides,
		});
	}

	test("asked when all four hold", () => {
		rememberDeckSeenInRoom(deck.id, NOW - DAY_MS);
		expect(ask()).toBe(true);
	});

	test("never asked while the prompt is off, and the device is not read", () => {
		rememberDeckSeenInRoom(deck.id, NOW - DAY_MS);
		const reads: string[] = [];
		const original = globalThis.localStorage.getItem;
		globalThis.localStorage.getItem = (key: string) => {
			reads.push(key);
			return original(key);
		};
		try {
			expect(ask({ config: { promptPercent: null, promptCooldownDays: 30 } })).toBe(false);
		} finally {
			globalThis.localStorage.getItem = original;
		}
		expect(reads).toEqual([]);
	});

	test("a device that first opened the deck after it ended is never asked", () => {
		expect(ask()).toBe(false);
		rememberDeckSeenInRoom("deck-2", NOW - DAY_MS);
		expect(ask()).toBe(false);
	});

	test("a deck that never went live asks nobody, even at 100%", () => {
		rememberDeckSeenInRoom(deck.id, NOW - DAY_MS);
		expect(ask({ deck: { id: deck.id, sessionStartedAt: null } })).toBe(false);
	});

	test("a participant outside the sample is not asked", () => {
		rememberDeckSeenInRoom(deck.id, NOW - DAY_MS);
		const outside = participantIds(100).find(
			(participantId) =>
				!isInFeedbackSample({
					participantId,
					presentationId: deck.id,
					sessionStartedAt: STARTED,
					percent: 10,
				}),
		) as string;
		expect(
			ask({ participantId: outside, config: { promptPercent: 10, promptCooldownDays: 30 } }),
		).toBe(false);
	});

	test("asked again only once the cooldown has passed", () => {
		rememberDeckSeenInRoom(deck.id, NOW - DAY_MS);
		rememberAskedForFeedback(NOW);
		expect(ask()).toBe(false);
		expect(ask({ now: NOW + 29 * DAY_MS })).toBe(false);
		expect(ask({ now: NOW + 30 * DAY_MS })).toBe(true);
		expect(
			ask({ now: NOW + 2 * DAY_MS, config: { promptPercent: 100, promptCooldownDays: 1 } }),
		).toBe(true);
	});
});
