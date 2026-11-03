/**
 * Unit tests for the countdown slide's rules in server/schemas.ts (REQ107,
 * slice 1) — the authored half of the type, in isolation from the store and the
 * HTTP surface:
 *   - the length a slide stores, its default, and the bounds a write is held to
 *   - what a hand-built deck's out-of-range length means when it is read
 *   - how a length is spelled on a clock face
 *   - that the slide is content: it collects nothing and has no aggregate
 *   - that the PDF export, which walks every slide of a deck, says its length
 *
 * and the run's half (slice 2): the time a running clock shows against the
 * server's clock, and the per-slide map the run is recorded in.
 */

import { describe, expect, test } from "bun:test";
import { questionBlocksFor } from "./deck-pdf";
import { aggregateRowsFor } from "./results-export";
import {
	COUNTDOWN_DEFAULT_SECONDS,
	COUNTDOWN_MAX_SECONDS,
	countdownPhase,
	countdownRemainingSeconds,
	countdownSecondsFor,
	formatCountdown,
	isContentSlideType,
	isInteractiveSlideType,
	SLIDE_TYPE_LABELS,
	SlideInputSchema,
	SlideSchema,
	slideHasResults,
	SlideTypeEnum,
	StoredPresentationSchema,
	nextCountdownRun,
	withCountdownRun,
} from "./schemas";

function countdown(fields: Record<string, unknown> = {}) {
	return { id: "c1", type: "countdown", question: "", ...fields };
}

describe("the countdown slide type (REQ107)", () => {
	test("it is a slide type with a name", () => {
		expect(SlideTypeEnum.safeParse("countdown").success).toBe(true);
		expect(SLIDE_TYPE_LABELS.countdown).toBe("Countdown");
	});

	test("it is content: it collects nothing and has no aggregate", () => {
		expect(isContentSlideType("countdown")).toBe(true);
		expect(isInteractiveSlideType("countdown")).toBe(false);
		expect(slideHasResults("countdown")).toBe(false);
	});
});

describe("the countdown's length (REQ107)", () => {
	test("a slide that names no length runs for the default minute", () => {
		expect(COUNTDOWN_DEFAULT_SECONDS).toBe(60);
		expect(SlideSchema.parse(countdown()).countdownSeconds).toBe(60);
		expect(SlideInputSchema.parse(countdown()).countdownSeconds).toBe(60);
	});

	test("every slide carries the field, so a deck stored before it re-parses", () => {
		// A deck written before the field existed has no `countdownSeconds` on any
		// slide; the declared default is what lets it read forward unmigrated.
		const stored = StoredPresentationSchema.parse({
			id: "deck-1",
			code: "123456",
			title: "Before REQ107",
			slides: [{ id: "s1", type: "text", question: "Hello" }],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(stored.slides[0].countdownSeconds).toBe(COUNTDOWN_DEFAULT_SECONDS);
	});

	test("a length from one second to an hour is kept as written", () => {
		for (const seconds of [1, 45, 300, COUNTDOWN_MAX_SECONDS]) {
			expect(
				SlideInputSchema.parse(countdown({ countdownSeconds: seconds }))
					.countdownSeconds,
			).toBe(seconds);
		}
	});

	test("a write outside 1…3600 whole seconds is refused", () => {
		expect(COUNTDOWN_MAX_SECONDS).toBe(3600);
		for (const seconds of [0, -5, COUNTDOWN_MAX_SECONDS + 1, 1.5, "60"]) {
			expect(
				SlideInputSchema.safeParse(countdown({ countdownSeconds: seconds }))
					.success,
			).toBe(false);
			expect(
				SlideSchema.safeParse(countdown({ countdownSeconds: seconds })).success,
			).toBe(false);
		}
	});

	test("the read site brings a hand-built length back inside the bounds", () => {
		expect(countdownSecondsFor({ countdownSeconds: 90 })).toBe(90);
		expect(countdownSecondsFor({})).toBe(COUNTDOWN_DEFAULT_SECONDS);
		expect(countdownSecondsFor({ countdownSeconds: Number.NaN })).toBe(
			COUNTDOWN_DEFAULT_SECONDS,
		);
		expect(countdownSecondsFor({ countdownSeconds: 0 })).toBe(1);
		expect(countdownSecondsFor({ countdownSeconds: 99_999 })).toBe(
			COUNTDOWN_MAX_SECONDS,
		);
		expect(countdownSecondsFor({ countdownSeconds: 29.6 })).toBe(30);
	});
});

describe("how a countdown length is spelled (REQ107)", () => {
	test("minutes unpadded, seconds always two digits", () => {
		expect(formatCountdown(0)).toBe("0:00");
		expect(formatCountdown(5)).toBe("0:05");
		expect(formatCountdown(60)).toBe("1:00");
		expect(formatCountdown(125)).toBe("2:05");
		expect(formatCountdown(600)).toBe("10:00");
		expect(formatCountdown(COUNTDOWN_MAX_SECONDS)).toBe("60:00");
	});

	test("a face never shows a negative or fractional second", () => {
		expect(formatCountdown(-3)).toBe("0:00");
		expect(formatCountdown(59.9)).toBe("0:59");
	});
});

describe("the exports walk a countdown slide (REQ107)", () => {
	test("the PDF says how long it runs", () => {
		const blocks = questionBlocksFor(
			SlideSchema.parse(countdown({ countdownSeconds: 300 })),
		);
		expect(blocks).toContainEqual({
			kind: "note",
			text: "Counts down from 5:00.",
		});
	});

	test("the results workbook accounts for it with an explicit zero", () => {
		const rows = aggregateRowsFor(SlideSchema.parse(countdown()), {
			type: "countdown",
			totalVotes: 0,
		});
		expect(rows).toHaveLength(1);
	});
});

describe("the time a countdown shows (REQ107)", () => {
	const STARTED = "2026-10-22T10:00:00.000Z";
	const startedMs = Date.parse(STARTED);
	const fiveMinutes = { countdownSeconds: 300 };
	const running = { remainingMs: 300_000, resumedAt: STARTED };

	test("a clock with no run shows its full authored length", () => {
		expect(countdownRemainingSeconds(fiveMinutes, null, startedMs)).toBe(300);
		expect(countdownRemainingSeconds(fiveMinutes, undefined, startedMs)).toBe(300);
		expect(countdownRemainingSeconds({}, null, startedMs)).toBe(
			COUNTDOWN_DEFAULT_SECONDS,
		);
	});

	test("it counts down from the instant the run set off", () => {
		expect(countdownRemainingSeconds(fiveMinutes, running, startedMs)).toBe(300);
		expect(
			countdownRemainingSeconds(fiveMinutes, running, startedMs + 90_000),
		).toBe(210);
		// Rounded up: a part-second left still shows as a second, so the face
		// reads 0:00 only once the run is really over.
		expect(
			countdownRemainingSeconds(fiveMinutes, running, startedMs + 299_500),
		).toBe(1);
	});

	test("it reaches 0:00 and stays there", () => {
		expect(
			countdownRemainingSeconds(fiveMinutes, running, startedMs + 300_000),
		).toBe(0);
		expect(
			countdownRemainingSeconds(fiveMinutes, running, startedMs + 3_600_000),
		).toBe(0);
		expect(formatCountdown(0)).toBe("0:00");
	});

	test("a clock read before its start instant never shows more than the run holds", () => {
		// A device a moment behind the server, before its offset is known.
		expect(
			countdownRemainingSeconds(fiveMinutes, running, startedMs - 5_000),
		).toBe(300);
	});

	test("a paused clock shows its frozen time at any later reading", () => {
		const paused = { remainingMs: 209_500, resumedAt: null };
		expect(countdownRemainingSeconds(fiveMinutes, paused, startedMs)).toBe(210);
		expect(
			countdownRemainingSeconds(fiveMinutes, paused, startedMs + 3_600_000),
		).toBe(210);
	});

	test("a run keeps its time when the authored length is edited", () => {
		const paused = { remainingMs: 120_000, resumedAt: null };
		expect(countdownRemainingSeconds({ countdownSeconds: 30 }, paused, startedMs)).toBe(
			120,
		);
	});

	test("an instant that does not parse reads as a frozen clock", () => {
		const garbled = { remainingMs: 300_000, resumedAt: "not a time" };
		expect(countdownRemainingSeconds(fiveMinutes, garbled, startedMs)).toBe(300);
		expect(countdownPhase(garbled, startedMs)).toBe("paused");
	});
});

describe("where a countdown's clock stands (REQ107)", () => {
	const STARTED = "2026-10-22T10:00:00.000Z";
	const startedMs = Date.parse(STARTED);

	test("no run is idle", () => {
		expect(countdownPhase(null, startedMs)).toBe("idle");
		expect(countdownPhase(undefined, startedMs)).toBe("idle");
	});

	test("a run with time left is running, and frozen time is paused", () => {
		expect(
			countdownPhase({ remainingMs: 1_000, resumedAt: STARTED }, startedMs + 999),
		).toBe("running");
		expect(countdownPhase({ remainingMs: 1, resumedAt: null }, startedMs)).toBe(
			"paused",
		);
	});

	test("a run with no time left is finished", () => {
		expect(
			countdownPhase({ remainingMs: 1_000, resumedAt: STARTED }, startedMs + 1_000),
		).toBe("finished");
		expect(countdownPhase({ remainingMs: 0, resumedAt: null }, startedMs)).toBe(
			"finished",
		);
	});
});

describe("what an action does to a countdown's run (REQ107)", () => {
	const STARTED = "2026-10-22T10:00:00.000Z";
	const startedMs = Date.parse(STARTED);
	const slide = { countdownSeconds: 300 };
	const running = { remainingMs: 300_000, resumedAt: STARTED };
	const paused = { remainingMs: 209_500, resumedAt: null };

	test("start sets off a clock with no run from its full length", () => {
		expect(nextCountdownRun(slide, null, "start", startedMs)).toEqual(running);
	});

	test("start continues a paused clock from its frozen time", () => {
		expect(nextCountdownRun(slide, paused, "start", startedMs + 60_000)).toEqual({
			remainingMs: 209_500,
			resumedAt: new Date(startedMs + 60_000).toISOString(),
		});
	});

	test("pause freezes a running clock at the time left", () => {
		expect(nextCountdownRun(slide, running, "pause", startedMs + 90_500)).toEqual(
			paused,
		);
	});

	test("pause, then resume, then pause adds up the time run across both spells", () => {
		const first = nextCountdownRun(slide, null, "start", startedMs);
		const frozen = nextCountdownRun(slide, first, "pause", startedMs + 10_000);
		const resumed = nextCountdownRun(slide, frozen, "start", startedMs + 500_000);
		const again = nextCountdownRun(slide, resumed, "pause", startedMs + 505_000);
		expect(again).toEqual({ remainingMs: 285_000, resumedAt: null });
	});

	test("reset removes the run from any state", () => {
		expect(nextCountdownRun(slide, running, "reset", startedMs)).toBeNull();
		expect(nextCountdownRun(slide, paused, "reset", startedMs)).toBeNull();
		expect(nextCountdownRun(slide, running, "reset", startedMs + 900_000)).toBeNull();
		expect(nextCountdownRun(slide, null, "reset", startedMs)).toBeNull();
	});

	test("a retried action returns the same run, by identity", () => {
		expect(nextCountdownRun(slide, running, "start", startedMs + 5_000)).toBe(running);
		expect(nextCountdownRun(slide, paused, "pause", startedMs + 5_000)).toBe(paused);
		expect(nextCountdownRun(slide, null, "pause", startedMs)).toBeNull();
	});

	test("a finished clock moves only on a reset", () => {
		const over = startedMs + 300_000;
		expect(nextCountdownRun(slide, running, "pause", over)).toBe(running);
		expect(nextCountdownRun(slide, running, "start", over)).toBe(running);
		expect(nextCountdownRun(slide, running, "reset", over)).toBeNull();
	});
});

describe("the run is recorded per slide (REQ107)", () => {
	const elsewhere = { remainingMs: 1_000, resumedAt: null };
	const here = { remainingMs: 2_000, resumedAt: "2026-10-22T10:00:00.000Z" };

	test("recording a run adds the slide's and leaves the others", () => {
		expect(withCountdownRun({ other: elsewhere }, "cd", here)).toEqual({
			other: elsewhere,
			cd: here,
		});
	});

	test("clearing removes only that slide's run", () => {
		expect(withCountdownRun({ other: elsewhere, cd: here }, "cd", null)).toEqual({
			other: elsewhere,
		});
	});

	test("a deck stored before runs existed reads as no clock moved", () => {
		const parsed = StoredPresentationSchema.parse({ id: "deck-1" });
		expect(parsed.countdownRuns).toEqual({});
	});
});
