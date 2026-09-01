/**
 * Unit tests for the client half of answer moderation (REQ027).
 *
 * Taking one answer off a word cloud or an open-ended slide is one affordance
 * worn by two renderings — a card in the response wall, a row under the cloud —
 * so what is asserted here is the single descriptor both of them compose
 * (ADR-0026) and the three answers it has to get right:
 *
 *   - **an editor** gets a live control;
 *   - **a spectator** gets the control drawn and inert, carrying the reason
 *     (ADR-0025) — not a screen quietly missing a button;
 *   - **a surface with nothing stored behind it**, or a slide type the boundary
 *     refuses, gets no control at all — that is relevance, not availability.
 *
 * The guard the last of those reads (`slideAnswersAreDeletable`) is the server's
 * own, and is pinned down beside the boundary that refuses on it in
 * `server/answer-deletion.schemas.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { SlideType } from "../types";
import { SLIDE_TYPE_LABELS } from "../types";
import { ANSWER_MODERATION_DENIED, answerModerationFor } from "./Results";

/** The two types an answer is *text somebody wrote* on. */
const DELETABLE: SlideType[] = ["word-cloud", "open-text"];

/** Every slide type there is, read off the one descriptor that lists them all. */
const EVERY_SLIDE_TYPE = Object.keys(SLIDE_TYPE_LABELS) as SlideType[];

describe("answerModerationFor (REQ027)", () => {
	const onDelete = () => {};

	test("an editor on a word cloud gets the live control", () => {
		const moderation = answerModerationFor({
			slideType: "word-cloud",
			canControl: true,
			onDelete,
		});
		expect(moderation?.onDelete).toBe(onDelete);
	});

	test("an editor on an open-ended slide gets it too", () => {
		const moderation = answerModerationFor({
			slideType: "open-text",
			canControl: true,
			onDelete,
		});
		expect(moderation?.onDelete).toBe(onDelete);
	});

	test("a spectator gets the control, inert, with the reason on it (ADR-0025)", () => {
		const moderation = answerModerationFor({
			slideType: "open-text",
			canControl: false,
			onDelete,
		});
		// Present, so the control keeps its place and explains itself rather than
		// coming and going with who is watching.
		expect(moderation).toBeDefined();
		expect(moderation?.onDelete).toBeNull();
		expect(moderation?.disabledReason).toBe(ANSWER_MODERATION_DENIED);
	});

	test("a surface with nothing stored behind it draws nothing at all", () => {
		// The dry run (REQ103/REQ104): its answers were generated for it and never
		// written, so deleting one would delete nothing. Relevance, not
		// availability (ADR-0025 §5).
		expect(
			answerModerationFor({
				slideType: "word-cloud",
				canControl: true,
				onDelete: null,
			}),
		).toBeUndefined();
	});

	test("a slide type the boundary refuses is never offered the control", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			if (DELETABLE.includes(type)) continue;
			expect(
				answerModerationFor({ slideType: type, canControl: true, onDelete }),
			).toBeUndefined();
		}
	});

	test("the refusal is one wording, wherever it is drawn", () => {
		const cloud = answerModerationFor({
			slideType: "word-cloud",
			canControl: false,
			onDelete,
		});
		const wall = answerModerationFor({
			slideType: "open-text",
			canControl: false,
			onDelete,
		});
		expect(cloud?.disabledReason).toBe(wall?.disabledReason as string);
	});

	test("the reason names the action and why it is unavailable", () => {
		// ADR-0025 §2: a disabled control states why, not merely that.
		expect(ANSWER_MODERATION_DENIED).toContain("Delete this answer");
		expect(ANSWER_MODERATION_DENIED).toContain("cannot edit this presentation");
	});
});
