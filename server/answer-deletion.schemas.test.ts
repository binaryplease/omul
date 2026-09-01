/**
 * Unit tests for the guard behind deleting one submitted answer (REQ027) — no
 * DB, no network.
 *
 * It is tested here rather than only through the API because it is the contract
 * both ends share (ADR-0013/ADR-0026): the delete boundary refuses on it, and
 * the shared screen decides whether to draw the control from the very same
 * function. If the two ever disagreed, the presenter would be offered a deletion
 * the server turns away — or, worse the other way round, an answer that can be
 * removed with no control anywhere that says so.
 *
 * The client half of that pair — the descriptor the two renderings of the
 * control compose — is tested in `src/components/Results.test.ts`, and the
 * integration half (the row is really gone, from the room's tally and from both
 * exports) in `answer-deletion.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	INTERACTIVE_SLIDE_TYPES,
	SlideTypeEnum,
	slideAnswersAreDeletable,
	type SlideType,
} from "./schemas";

/** The two types an answer is *text somebody wrote* on. */
const DELETABLE: SlideType[] = ["word-cloud", "open-text"];

describe("slideAnswersAreDeletable (REQ027)", () => {
	test("the two slide types whose answers are the room's own words", () => {
		for (const type of DELETABLE) {
			expect(slideAnswersAreDeletable(type)).toBe(true);
		}
	});

	test("every other slide type is refused — including a typed quiz answer", () => {
		// A typed quiz answer (REQ055) is free text too, and it is deliberately not
		// here: that row is scored, so removing it would move a competitor's
		// standing rather than take a line off a wall. The set is listed for
		// exactly this reason rather than derived from "does this take text".
		for (const type of SlideTypeEnum.options) {
			if (DELETABLE.includes(type)) continue;
			expect(slideAnswersAreDeletable(type)).toBe(false);
		}
		expect(slideAnswersAreDeletable("quiz")).toBe(false);
	});

	test("every deletable type is one that collects answers at all", () => {
		// A guard that admitted a content slide would be a control offered where
		// there is nothing to moderate.
		for (const type of DELETABLE) {
			expect(INTERACTIVE_SLIDE_TYPES).toContain(type);
		}
	});
});
