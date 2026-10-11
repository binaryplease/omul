/**
 * The session clock's arithmetic (REQ108): what the presenter surface shows for
 * a deck that has not gone live, one that is running, one that has ended, and
 * one that has been reset.
 */

import { describe, expect, test } from "bun:test";
import { formatSessionElapsed, sessionElapsedMs } from "./SessionClock";

const STARTED = "2026-01-01T12:00:00.000Z";
const ENDED = "2026-01-01T12:45:30.000Z";
const STARTED_MS = Date.parse(STARTED);

describe("sessionElapsedMs", () => {
	test("a deck that has never gone live has no session to time", () => {
		expect(
			sessionElapsedMs(
				{ status: "draft", sessionStartedAt: null, sessionEndedAt: null },
				STARTED_MS + 1000,
			),
		).toBeNull();
		expect(sessionElapsedMs(null, STARTED_MS)).toBeNull();
	});

	test("a live session runs from its start to now", () => {
		expect(
			sessionElapsedMs(
				{ status: "live", sessionStartedAt: STARTED, sessionEndedAt: null },
				STARTED_MS + 90_000,
			),
		).toBe(90_000);
	});

	test("an ended session stops at its end however late it is read", () => {
		const ended = {
			status: "ended" as const,
			sessionStartedAt: STARTED,
			sessionEndedAt: ENDED,
		};
		const expected = Date.parse(ENDED) - STARTED_MS;
		expect(sessionElapsedMs(ended, Date.parse(ENDED) + 1000)).toBe(expected);
		expect(sessionElapsedMs(ended, Date.parse(ENDED) + 86_400_000)).toBe(
			expected,
		);
	});

	test("a reset deck — both stamps cleared — reads as no session", () => {
		expect(
			sessionElapsedMs(
				{ status: "draft", sessionStartedAt: null, sessionEndedAt: null },
				STARTED_MS,
			),
		).toBeNull();
	});

	test("a live deck with no recorded start reports nothing rather than a guess", () => {
		expect(
			sessionElapsedMs(
				{ status: "live", sessionStartedAt: null, sessionEndedAt: null },
				STARTED_MS,
			),
		).toBeNull();
	});

	test("an ended deck with no end instant does not keep counting", () => {
		expect(
			sessionElapsedMs(
				{ status: "ended", sessionStartedAt: STARTED, sessionEndedAt: null },
				STARTED_MS + 60_000,
			),
		).toBeNull();
	});

	test("a clock a moment behind the server's never shows a negative duration", () => {
		expect(
			sessionElapsedMs(
				{ status: "live", sessionStartedAt: STARTED, sessionEndedAt: null },
				STARTED_MS - 500,
			),
		).toBe(0);
	});
});

describe("formatSessionElapsed", () => {
	test("under an hour reads as minutes and seconds", () => {
		expect(formatSessionElapsed(0)).toBe("0:00");
		expect(formatSessionElapsed(9_999)).toBe("0:09");
		expect(formatSessionElapsed(754_000)).toBe("12:34");
	});

	test("from an hour on it carries the hours", () => {
		expect(formatSessionElapsed(3_600_000)).toBe("1:00:00");
		expect(formatSessionElapsed(3_600_000 + 5 * 60_000 + 7_000)).toBe(
			"1:05:07",
		);
	});
});
