/**
 * Participant page logic a test without a DOM can hold. The re-read of a live
 * slide this copy lacks (REQ209) is tested below through `rereadUntilAnswered`,
 * the loop the page's effect runs, with a timer the test steps by hand.
 *
 * The control that starts another pass through an audience-paced deck (REQ083).
 *
 * What a test without a DOM can hold is the descriptor the page draws it from,
 * `newPassControlFor()` — the page itself needs a live store and socket to
 * render at all. Three states, and each is a promise to somebody:
 *
 *  - **absent** on a deck that does not allow another pass, which is every
 *    presenter-paced deck — the deck's own shape rather than a hidden control;
 *  - **drawn disabled, with its reason,** on every slide of one that does until
 *    the participant reaches the last (never hidden, ADR-0025);
 *  - **ready** at the last slide, which is what having finished a deck you may
 *    navigate freely, and leave questions in, means.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOCKET_PULSE_MS } from "../api";
import { createAppStore } from "../store/store";
import type { Presentation } from "../types";
import {
	drawnLiveSlide,
	firstSurveySlideIndex,
	liveSlideMissing,
	missingSlideRetryDelayMs,
	newPassControlFor,
	type RetryScheduler,
	rereadUntilAnswered,
} from "./ParticipantPage";

const THREE_SLIDES = [{}, {}, {}];

describe("newPassControlFor (REQ083)", () => {
	test("a deck that does not allow another pass draws no control", () => {
		for (const deck of [
			{ mode: "survey" as const, allowRepeatPasses: false },
			{ mode: "live" as const, allowRepeatPasses: true },
			{ mode: "live" as const, allowRepeatPasses: false },
			{},
		]) {
			for (const index of [0, 1, 2]) {
				expect(newPassControlFor({ ...deck, slides: THREE_SLIDES }, index)).toBe(
					"absent",
				);
			}
		}
	});

	test("on a deck that does, the control waits for the last slide, drawn but disabled", () => {
		const deck = { mode: "survey" as const, allowRepeatPasses: true, slides: THREE_SLIDES };
		expect(newPassControlFor(deck, 0)).toBe("reach-end");
		expect(newPassControlFor(deck, 1)).toBe("reach-end");
		expect(newPassControlFor(deck, 2)).toBe("ready");
	});

	test("a one-slide deck is finished on its only slide", () => {
		expect(
			newPassControlFor(
				{ mode: "survey", allowRepeatPasses: true, slides: [{}] },
				0,
			),
		).toBe("ready");
	});
});

describe("audience pacing steps over skipped slides (REQ110)", () => {
	const source = readFileSync(join(import.meta.dir, "ParticipantPage.tsx"), "utf8");
	const navigation = source.slice(
		source.indexOf("{/* Survey-mode navigation (REQ003/REQ082) */}"),
		source.indexOf("{/* Going through again (REQ083)"),
	);

	test("Previous and Next land where steppedSlideIndex says, and shut where it says none is left", () => {
		const paging = source.slice(
			source.indexOf("const goToSurveySlide"),
			source.indexOf("const newPassControl ="),
		);
		expect(paging).toContain("steppedSlideIndex(pres.slides, surveyIndex, -1)");
		expect(paging).toContain("steppedSlideIndex(pres.slides, surveyIndex, 1)");
		expect(navigation).toContain("goToSurveySlide(previousSurveyIndex)");
		expect(navigation).toContain("disabled={previousSurveyIndex === null}");
		expect(navigation).toContain("goToSurveySlide(nextSurveyIndex)");
		expect(navigation).toContain("disabled={nextSurveyIndex === null}");
	});

	test("nothing pages the survey by plain plus or minus one any more", () => {
		expect(source).not.toContain("surveyIndex + 1)");
		expect(source).not.toContain("surveyIndex - 1)");
	});

	test("the counter keeps counting every slide", () => {
		expect(navigation).toContain("{surveyIndex + 1} / {pres.slides.length}");
	});

	test("a pass opens on the first slide that is not skipped", () => {
		expect(firstSurveySlideIndex([{ skipped: true }, { skipped: true }, {}])).toBe(2);
		expect(firstSurveySlideIndex([{}, { skipped: true }])).toBe(0);
		// A deck skipped end to end still shows the participant something.
		expect(firstSurveySlideIndex([{ skipped: true }, { skipped: true }])).toBe(0);
		expect(source).toContain("setSurveyIndex(firstSurveySlideIndex(pres.slides));\n\t}, [pres?.id]);");
	});

	test("the deck is finished on the last slide Next reaches, skipped ones past it aside", () => {
		const deck = {
			mode: "survey" as const,
			allowRepeatPasses: true,
			slides: [{}, {}, { skipped: true }, { skipped: true }],
		};
		expect(newPassControlFor(deck, 0)).toBe("reach-end");
		expect(newPassControlFor(deck, 1)).toBe("ready");
	});

	test("a skipped slide in the middle does not finish the deck early", () => {
		const deck = {
			mode: "survey" as const,
			allowRepeatPasses: true,
			slides: [{}, { skipped: true }, {}],
		};
		expect(newPassControlFor(deck, 0)).toBe("reach-end");
		expect(newPassControlFor(deck, 2)).toBe("ready");
	});
});

describe("the participant page's wiring (REQ083)", () => {
	const source = readFileSync(join(import.meta.dir, "ParticipantPage.tsx"), "utf8");

	test("the slide view is keyed by pass, so a new pass starts from a blank screen", () => {
		expect(source).toContain("key={`${pass}:${passesStarted}`}");
	});

	test("the disabled control states its reason, never only a dead button", () => {
		const control = source.slice(source.indexOf('newPassControl !== "absent"'));
		expect(control).toContain("t.passReachEnd");
		expect(control).toContain('disabled={newPassControl !== "ready" || startingPass}');
	});

	test("a refusal to start a pass takes the control away, as the missed broadcast would have", () => {
		const handler = source.slice(
			source.indexOf("const handleStartPass"),
			source.indexOf("const handleUpvoteQuestion"),
		);
		expect(handler).toContain('refused === "repeat-passes-off"');
		expect(handler).toContain("applyRepeatPassesSetting({ allowRepeatPasses: false })");
		expect(handler).toContain("passOff");
	});

	test("the pass number comes from the server's answer and is remembered", () => {
		const handler = source.slice(
			source.indexOf("const handleStartPass"),
			source.indexOf("const handleUpvoteQuestion"),
		);
		expect(handler).toContain("api.startPass(pres.id, participantId.current)");
		expect(handler).toContain("rememberParticipantPass(pres.id, started.pass)");
		expect(handler).toContain("setSurveyIndex(firstSurveySlideIndex(pres.slides))");
	});

	test("a reset forgets the pass along with the stated name", () => {
		const resetEffect = source.slice(
			source.indexOf("const lastResetRevision"),
			source.indexOf("}, [pres?.id, sessionResetRevision]);"),
		);
		expect(resetEffect).toContain("forgetStatedParticipantName(pres.id)");
		expect(resetEffect).toContain("forgetParticipantPass(pres.id)");
	});
});

describe("liveSlideMissing (REQ209)", () => {
	const TWO_SLIDES = [{}, {}];

	test("live on a slide this copy of the deck does not have", () => {
		// The presenter added a third slide to the running deck and went to it;
		// this phone read the deck when it had two.
		expect(
			liveSlideMissing({
				mode: "live",
				status: "live",
				activeSlideIndex: 2,
				slides: TWO_SLIDES,
			}),
		).toBe(true);
	});

	test("not missing on a slide the copy has, before the start, or on an audience-paced deck", () => {
		expect(
			liveSlideMissing({
				mode: "live",
				status: "live",
				activeSlideIndex: 1,
				slides: TWO_SLIDES,
			}),
		).toBe(false);
		expect(
			liveSlideMissing({
				mode: "live",
				status: "draft",
				activeSlideIndex: 2,
				slides: TWO_SLIDES,
			}),
		).toBe(false);
		expect(
			liveSlideMissing({
				mode: "survey",
				status: "live",
				activeSlideIndex: 2,
				slides: TWO_SLIDES,
			}),
		).toBe(false);
	});

	test("the page re-reads the deck when it is, until a read is answered", () => {
		const source = readFileSync(join(import.meta.dir, "ParticipantPage.tsx"), "utf8");
		const effect = source.slice(
			source.indexOf("const missingLiveSlide"),
			source.indexOf("pres?.slides.length,"),
		);
		expect(effect).toContain("liveSlideMissing(pres, liveSlideId)");
		expect(effect).toContain("if (!missingLiveSlide) return;");
		expect(effect).toContain(
			"return rereadUntilAnswered(() => refreshDeckSlides(code));",
		);
		expect(effect).toContain("pres?.activeSlideIndex,");
		expect(effect).toContain("liveSlideId,");
	});

	test("missing, and not drawn, when the copy holds another slide than the live one", () => {
		// The first slide was deleted while the deck was stopped; the restart
		// names the old second slide, which this copy still holds at index 1.
		const staleCopy = {
			mode: "live" as const,
			status: "live" as const,
			activeSlideIndex: 0,
			slides: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
		};
		expect(liveSlideMissing(staleCopy, "s2")).toBe(true);
		expect(drawnLiveSlide(staleCopy, "s2")).toBeNull();
		expect(liveSlideMissing(staleCopy, "s1")).toBe(false);
		expect(drawnLiveSlide(staleCopy, null)?.id).toBe("s1");
	});
});

/**
 * A stand-in for the timer: records what would run and after how long, and runs
 * it only when the test says so.
 */
function manualScheduler() {
	const pending: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
	const schedule: RetryScheduler = (run, delayMs) => {
		const entry = { run, delayMs, cancelled: false };
		pending.push(entry);
		return () => {
			entry.cancelled = true;
		};
	};
	/** Fire the oldest scheduled run, and let the read it starts settle. */
	const fireNext = async () => {
		const entry = pending.shift();
		if (!entry) throw new Error("nothing scheduled");
		if (!entry.cancelled) entry.run();
		await flushReads();
	};
	return { schedule, pending, fireNext };
}

/** Let every settled read's continuation run. */
const flushReads = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("rereadUntilAnswered (REQ209)", () => {
	test("a failed re-read is retried with backoff until one is answered", async () => {
		// The reported sequence: the presenter adds a slide and moves to it, and a
		// phone on a weak link loses the re-read. Nothing the page watches moves,
		// so only the retry can bring the slide in.
		const outcomes = [false, false, true];
		let reads = 0;
		const scheduler = manualScheduler();
		rereadUntilAnswered(async () => outcomes[reads++] ?? true, scheduler.schedule);
		await flushReads();
		expect(reads).toBe(1);
		expect(scheduler.pending.map((entry) => entry.delayMs)).toEqual([1_000]);

		await scheduler.fireNext();
		expect(reads).toBe(2);
		expect(scheduler.pending.map((entry) => entry.delayMs)).toEqual([2_000]);

		await scheduler.fireNext();
		expect(reads).toBe(3);
		// Answered: nothing more is asked.
		expect(scheduler.pending).toHaveLength(0);
	});

	test("stopping it cancels the scheduled retry and ignores a read still out", async () => {
		const scheduler = manualScheduler();
		let reads = 0;
		const stop = rereadUntilAnswered(async () => {
			reads++;
			return false;
		}, scheduler.schedule);
		await flushReads();
		stop();
		await scheduler.fireNext();
		expect(reads).toBe(1);

		// A read in flight when the page moves on schedules nothing on landing.
		let settle: (answered: boolean) => void = () => {};
		const lateScheduler = manualScheduler();
		const stopLate = rereadUntilAnswered(
			() => new Promise<boolean>((resolve) => (settle = resolve)),
			lateScheduler.schedule,
		);
		stopLate();
		settle(false);
		await flushReads();
		expect(lateScheduler.pending).toHaveLength(0);
	});

	test("the backoff doubles from a second and holds at the socket heartbeat", () => {
		expect(missingSlideRetryDelayMs(1)).toBe(1_000);
		expect(missingSlideRetryDelayMs(2)).toBe(2_000);
		expect(missingSlideRetryDelayMs(4)).toBe(8_000);
		expect(missingSlideRetryDelayMs(5)).toBe(SOCKET_PULSE_MS);
		expect(missingSlideRetryDelayMs(40)).toBe(SOCKET_PULSE_MS);
	});

	test("through the store: a lost re-read is retried and the live slide arrives", async () => {
		// End to end through `refreshDeckSlides`: the phone's copy has two slides,
		// the presenter is live on a third, the first read is lost and the retry
		// brings the slide in without the presenter doing anything.
		const store = createAppStore();
		store.getState().setPresentation({
			id: "pres-1",
			code: "123456",
			title: "Test",
			status: "live",
			mode: "live",
			activeSlideIndex: 2,
			revealedSlideIds: [],
			slides: [
				{ id: "slide-a", type: "multiple-choice", question: "A" },
				{ id: "slide-b", type: "multiple-choice", question: "B" },
			],
		} as unknown as Presentation);
		const originalFetch = globalThis.fetch;
		let fetches = 0;
		globalThis.fetch = (async () => {
			fetches++;
			if (fetches === 1) throw new Error("offline");
			return new Response(
				JSON.stringify({
					slides: [
						{ id: "slide-a", type: "multiple-choice", question: "A" },
						{ id: "slide-b", type: "multiple-choice", question: "B" },
						{ id: "slide-c", type: "multiple-choice", question: "C" },
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof fetch;
		try {
			const scheduler = manualScheduler();
			rereadUntilAnswered(
				() => store.getState().refreshDeckSlides("123456"),
				scheduler.schedule,
			);
			await flushReads();
			const deck = () => store.getState().presentation as Presentation;
			expect(liveSlideMissing(deck())).toBe(true);
			expect(scheduler.pending).toHaveLength(1);

			await scheduler.fireNext();
			expect(fetches).toBe(2);
			expect(liveSlideMissing(deck())).toBe(false);
			expect(deck().slides[2].id).toBe("slide-c");
			expect(scheduler.pending).toHaveLength(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
