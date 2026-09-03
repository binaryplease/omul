/**
 * Unit tests for the settings column's two stated invariants (REQ155).
 *
 * The column is markup over the readings below, so the readings are where the
 * content is. Five claims:
 *
 *   - **A fresh slide is at its defaults — every type, no exceptions.** Every
 *     marker in the column means "this slide disagrees with something", so a
 *     slide nobody has touched must wear none of them. A form opens `private`
 *     (REQ061) and that *is* its default, not a departure from one.
 *   - **A reset never loosens a reveal the product tightened.** The two shapes
 *     with a safety posture — a form's `private`, and the `on-click` a pin
 *     slide is pinned to when it acquires a target area (REQ053) — must not be
 *     handed a one-click "back to defaults" that puts their submissions or
 *     their answer key on the shared screen.
 *   - **The way back works.** Applying a group's reset puts the group back at
 *     its default — a one-gesture undo that left something behind would be worse
 *     than none, because the marker would stay lit with nothing to explain it.
 *   - **A reset restores defaults and never deletes words.** The options, items,
 *     statements, fields and accepted answers an author typed are the slide's
 *     substance; no reset may write one.
 *   - **The reveal's one line is about the room.** A slide following the deck
 *     says what the *deck* will do, because "follow the presentation default"
 *     tells an author nothing about what the audience will see (REQ102).
 */

import { describe, expect, test } from "bun:test";
import { SlideTypeEnum } from "../../server/schemas";
import { newSlide } from "../store/editorDocument";
import type { ResultsVisibility, Slide } from "../types";
import { effectiveResultsVisibility } from "../types";
import {
	resultsRevealConsequence,
	slideAnswerRulesDeparture,
	slideResultsDeparture,
	slideScoringDeparture,
	slideStyleDeparture,
} from "./SlideEditor";

const EVERY_SLIDE_TYPE = SlideTypeEnum.options;

/** The deck default a slide is read against unless a test says otherwise. */
const DECK_DEFAULT: ResultsVisibility = "instant";

/** The four group readings, applied to one slide. */
function everyDeparture(slide: Slide, deckDefault = DECK_DEFAULT) {
	return {
		answers: slideAnswerRulesDeparture(slide),
		scoring: slideScoringDeparture(slide),
		results: slideResultsDeparture(slide, deckDefault),
		style: slideStyleDeparture(slide),
	};
}

/** Every setting of a slide moved off its default, whatever its type. */
function offEveryDefault(
	type: Slide["type"],
	resultsVisibility: Slide["resultsVisibility"] = "instant",
): Slide {
	return {
		...newSlide(type),
		resultsVisibility,
		mcMaxSelections: 0,
		allowMultiple: true,
		maxResponses: 3,
		allowResponseVotes: true,
		scaleAllowSkip: true,
		gridAllowSkip: true,
		quizAnswerMode: "type",
		timeLimit: 45,
		mcDisplayStyle: "pie",
		mcValueDisplay: "count",
		openTextLayout: "grid",
		leaderboardSize: 9,
		layout: "left",
		textSize: "large",
		backgroundColor: "#123456",
		backgroundImage: "https://example.com/backdrop.png",
		textColor: "#abcabc",
		chartColor: "#00ff00",
	};
}

describe("a slide nobody has touched wears no marker (REQ155)", () => {
	test("every fresh slide reads as unchanged in every group", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			// Including a form: it opens `private` (REQ061), and that posture *is*
			// its default. Marking it as departing would light a marker on a slide
			// nobody has touched — and arm a "reset" that loosens it.
			const departures = everyDeparture(newSlide(type));
			const marked = Object.entries(departures)
				.filter(([, departure]) => departure.departed)
				.map(([group]) => group);
			expect([type, marked]).toEqual([type, []]);
		}
	});

	test("a half-typed colour is not a departure", () => {
		// The resolver leaves the layer underneath standing, so the slide is still
		// drawn in the deck's own colours — a marker here would offer to reset a
		// slide that never left.
		const departure = slideStyleDeparture({
			...newSlide("text"),
			backgroundColor: "not-a-colour",
		});
		expect(departure.departed).toBe(false);
	});

	test("a URL no browser may be pointed at is not a background image", () => {
		const departure = slideStyleDeparture({
			...newSlide("text"),
			backgroundImage: "javascript:alert(1)",
		});
		expect(departure.departed).toBe(false);
	});
});

describe("the one gesture back puts the group back (REQ155)", () => {
	/** One pass of every group's reset over one slide. */
	function afterReset(slide: Slide): Slide {
		const departures = everyDeparture(slide);
		return {
			...slide,
			...departures.answers.reset,
			...departures.scoring.reset,
			...departures.results.reset,
			...departures.style.reset,
		};
	}

	test("applying each reset clears every marker on every type", () => {
		for (const type of EVERY_SLIDE_TYPE) {
			const after = everyDeparture(afterReset(offEveryDefault(type)));
			expect([
				type,
				Object.values(after).some((departure) => departure.departed),
			]).toEqual([type, false]);
		}
	});

	test("a reveal the reset will not loosen leaves nothing else behind", () => {
		// A slide closed further than its default keeps its marker on purpose (the
		// reset only tightens), so the property that has to hold is that a second
		// press would write nothing: everything this column *can* put back, it did.
		for (const type of EVERY_SLIDE_TYPE) {
			const closed = offEveryDefault(type, "private");
			const after = everyDeparture(afterReset(closed));
			for (const [group, departure] of Object.entries(after)) {
				expect([type, group, departure.reset]).toEqual([type, group, {}]);
			}
			// And the reveal the author closed is still exactly as they left it.
			expect([type, afterReset(closed).resultsVisibility]).toEqual([
				type,
				"private",
			]);
		}
	});

	test("a reset writes settings only — never a word the author typed", () => {
		const authored = new Set([
			"question",
			"body",
			"notes",
			"options",
			"quizAnswers",
			"rankingItems",
			"pointsItems",
			"gridItems",
			"gridXAxis",
			"gridYAxis",
			"scaleStatements",
			"scaleLabels",
			"scaleMin",
			"scaleMax",
			"scaleMinLabel",
			"scaleMaxLabel",
			"formFields",
			"guessRange",
			"guessReference",
			"pinArea",
			"mediaUrl",
			"mediaAlt",
			"type",
			"id",
		]);
		for (const type of EVERY_SLIDE_TYPE) {
			const departures = everyDeparture(offEveryDefault(type));
			const written = Object.values(departures).flatMap((departure) =>
				Object.keys(departure.reset),
			);
			expect([type, written.filter((key) => authored.has(key))]).toEqual([
				type,
				[],
			]);
		}
	});

	test("a group at its default has nothing to write", () => {
		expect(slideScoringDeparture(newSlide("quiz"))).toEqual({
			departed: false,
			reset: {},
			resettable: true,
		});
	});
});

describe("the reveal's one line is about the room (REQ102/REQ155)", () => {
	test("a slide following the deck says what the deck will do", () => {
		expect(resultsRevealConsequence("inherit", "on-click")).toBe(
			"Deck default — results wait until you reveal them.",
		);
		expect(resultsRevealConsequence(undefined, "instant")).toBe(
			"Deck default — results appear as answers arrive.",
		);
	});

	test("a slide of its own says its own", () => {
		expect(resultsRevealConsequence("private", "instant")).toBe(
			"Results never reach the shared screen.",
		);
		expect(resultsRevealConsequence("instant", "private")).toBe(
			"Results appear as answers arrive.",
		);
	});
});

describe("a reset never loosens a reveal the product tightened (REQ155)", () => {
	test("a fresh form is at its default, with nothing to reset", () => {
		// The failure this pins down: a brand-new form drew an enabled reset
		// captioned "put the reveal back", and one click wrote `inherit` — on a
		// default deck that is `instant`, i.e. the fill-rate tally starts feeding
		// the shared screen (REQ061 authors `private` precisely to stop that).
		const form = newSlide("form");
		const departure = slideResultsDeparture(form, "instant");
		expect(departure.departed).toBe(false);
		expect(departure.reset).toEqual({});
	});

	test("a form the author loosened resets back to private, never to inherit", () => {
		const departure = slideResultsDeparture(
			{ ...newSlide("form"), resultsVisibility: "instant" },
			"instant",
		);
		expect(departure.departed).toBe(true);
		expect(departure.reset.resultsVisibility).toBe("private");
	});

	test("a pin slide pinned to on-click by its target area is at its default", () => {
		// `withPinAreaEnabled` pins the slide to on-click when a target is turned
		// on over an instant deck (REQ053), so that posture is the slide's own
		// default — the reset must not offer to undo it while the target stays.
		const pinned: Slide = {
			...newSlide("pin-image"),
			pinArea: { x: 200, y: 200, width: 300, height: 300 },
			resultsVisibility: "on-click",
		};
		const departure = slideResultsDeparture(pinned, "instant");
		expect(departure.departed).toBe(false);
		expect(departure.reset.resultsVisibility).toBe(undefined);
	});

	test("no reset loosens a form or a targeted pin slide, on any deck", () => {
		// The general rule behind both cases above, swept over every authored
		// reveal and every deck default. It is scoped to the two shapes the
		// *product* tightened: undoing an override the author typed themselves is
		// what this group's reset is for, and on an ordinary slide the deck
		// default is the way back. On these two it would be the way out.
		const tightness: Record<ResultsVisibility, number> = {
			instant: 0,
			"on-click": 1,
			private: 2,
		};
		const reveals: Slide["resultsVisibility"][] = [
			"inherit",
			"instant",
			"on-click",
			"private",
		];
		const deckDefaults: ResultsVisibility[] = ["instant", "on-click", "private"];
		const tightened: [string, Slide][] = [
			["form", newSlide("form")],
			[
				"pin-image with a target",
				{
					...newSlide("pin-image"),
					pinArea: { x: 200, y: 200, width: 300, height: 300 },
				},
			],
		];
		for (const [name, base] of tightened) {
			for (const deckDefault of deckDefaults) {
				for (const reveal of reveals) {
					const authored: Slide = { ...base, resultsVisibility: reveal };
					const { reset } = slideResultsDeparture(authored, deckDefault);
					const after = reset.resultsVisibility ?? reveal;
					expect([
						name,
						deckDefault,
						reveal,
						tightness[effectiveResultsVisibility(after, deckDefault)] >=
							tightness[effectiveResultsVisibility(reveal, deckDefault)],
					]).toEqual([name, deckDefault, reveal, true]);
				}
			}
		}
	});
});

describe("a group with nothing to reset draws no reset", () => {
	test("only the types that own an answer rule offer one", () => {
		// Not the disabled-with-a-reason case: there is no unavailable action to
		// explain here,
		// only an action that does not exist — so a quiz, a ranking or a form must
		// not draw a control that is disabled forever.
		const resettable = EVERY_SLIDE_TYPE.filter(
			(type) => slideAnswerRulesDeparture(newSlide(type)).resettable,
		);
		expect([...resettable].sort().join(" ")).toBe(
			"grid multiple-choice open-text scale word-cloud",
		);
	});

	test("a type that owns a rule still offers it while sitting at the default", () => {
		const rules = slideAnswerRulesDeparture(newSlide("multiple-choice"));
		expect([rules.resettable, rules.departed]).toEqual([true, false]);
	});
});
