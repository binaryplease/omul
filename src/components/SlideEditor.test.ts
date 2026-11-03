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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideTypeEnum } from "../../server/schemas";
import { newSlide } from "../store/editorDocument";
import type { ResultsVisibility, Slide } from "../types";
import { effectiveResultsVisibility } from "../types";
import { QUIZ_AUDIO_PRESETS } from "./QuizAudioCue";
import {
	QuizAudioCueFields,
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

describe("a slide can be skipped from the editor (REQ110)", () => {
	const editor = readFileSync(join(import.meta.dir, "SlideEditor.tsx"), "utf8");
	const thumbnail = readFileSync(join(import.meta.dir, "SlideThumbnail.tsx"), "utf8");
	const header = editor.slice(editor.indexOf("function SlideHeader("));

	test("a fresh slide of every type is not skipped", () => {
		for (const type of SlideTypeEnum.options) {
			expect(newSlide(type).skipped ?? false).toBe(false);
		}
	});

	test("the slide's header toggles it, and says which way it is set", () => {
		expect(header).toContain("onUpdate({ skipped: !slide.skipped })");
		expect(header).toContain("aria-pressed={slide.skipped}");
		expect(header).toContain("${ICON_BUTTON_HOVER}");
		expect(header).toContain("<SkipForward size={15} />");
	});

	test("the type pill stays in its column, so it never covers Skip slide", () => {
		// The pill sits in a `min-w-0` column beside the header's buttons. Without
		// a width cap it overflowed that column at desktop widths and lay over
		// Skip slide, so a click there opened the type menu instead.
		const label = header.slice(header.indexOf('aria-label="Change slide type"'));
		const trigger = /className="([^"]*)"/.exec(label)?.[1] ?? "";
		expect(trigger.split(" ")).toContain("max-w-full");
		expect(label).toMatch(
			/<span className="([^"]* )?min-w-0 [^"]*\btruncate\b[^"]*">\s*\{SLIDE_TYPE_LABELS\[slide\.type\]\}/,
		);
		// The fix is the width, not a z-index over the buttons.
		expect(header).not.toMatch(/flex flex-shrink-0 items-center gap-0\.5[^"]*\bz-/);
	});

	test("the filmstrip marks a skipped slide with the rail's shared marker", () => {
		expect(thumbnail).toContain("{slide.skipped && <SkippedSlideMarker />}");
	});
});

describe("the quiz's Audio cue row offers three tracks and Custom (REQ058)", () => {
	const URL_FIELD = 'aria-label="Audio track URL"';

	/** The row's contents for one slide, drawn with no DOM. */
	const drawRow = (slide: Slide, customOpen = false) =>
		renderToStaticMarkup(
			createElement(QuizAudioCueFields, {
				slide,
				onUpdate: () => {},
				deckMode: "live",
				customOpen,
				onCustomOpenChange: () => {},
			}),
		);

	/** The row for a quiz storing one value. */
	const rowFor = (quizAudioUrl: string, customOpen = false) =>
		drawRow({ ...newSlide("quiz"), quizAudioUrl }, customOpen);

	/** The words on each button of the row, narrowed to the pressed ones if asked. */
	const buttonsIn = (markup: string, pressedOnly = false) =>
		markup
			.split("<button")
			.slice(1)
			.filter((button) => !pressedOnly || button.includes('aria-pressed="true"'))
			.map((button) => button.slice(0, button.indexOf("</button>")))
			.map((button) => button.replace(/^[^>]*>/, "").replace(/<[^>]*>/g, ""));

	test("the row offers the three tracks and Custom, in that order, and Remove", () => {
		// A play control has an icon and a name, and no words on its face.
		expect(buttonsIn(rowFor("")).filter((words) => words !== "")).toEqual([
			...QUIZ_AUDIO_PRESETS.map((preset) => preset.label),
			"Custom",
			"Remove audio cue",
		]);
	});

	test("each bundled track has its own play control, right after its tile", () => {
		const names = rowFor("")
			.split("<button")
			.slice(1)
			.map((button) => button.slice(0, button.indexOf(">")))
			.map((tag) => /aria-label="([^"]*)"/.exec(tag)?.[1] ?? "")
			.filter((name) => name.startsWith("Play "));
		expect(names).toEqual(QUIZ_AUDIO_PRESETS.map((preset) => `Play ${preset.label}`));
		for (const preset of QUIZ_AUDIO_PRESETS) {
			const markup = rowFor("");
			expect(markup.indexOf(`aria-label="Play ${preset.label}"`)).toBeGreaterThan(
				markup.indexOf(`>${preset.label}<`),
			);
		}
	});

	test("Custom has no play control", () => {
		expect(rowFor("https://example.com/a.mp3")).not.toContain("Play Custom");
		expect(rowFor("", true)).not.toContain("Play Custom");
	});

	test("a play control is never nested inside a tile's button", () => {
		for (const closedBefore of rowFor("").split("<button").slice(1)) {
			expect(closedBefore).toContain("</button>");
		}
	});

	test("a play control is no selection: it carries no pressed state and sends no update", () => {
		for (const preset of QUIZ_AUDIO_PRESETS) {
			const markup = rowFor(preset.path);
			const control = markup
				.split("<button")
				.find((button) => button.includes(`aria-label="Play ${preset.label}"`));
			expect(control).not.toContain("aria-pressed");
		}
		const editor = readFileSync(join(import.meta.dir, "SlideEditor.tsx"), "utf8");
		const previewButton = editor.slice(
			editor.indexOf("<QuizAudioPreviewButton"),
			editor.indexOf("/>", editor.indexOf("<QuizAudioPreviewButton")),
		);
		expect(previewButton).toContain("onToggle={() => preview.toggle(preset)}");
		expect(previewButton).not.toContain("onUpdate");
		expect(previewButton).not.toContain("selectOption");
	});

	test("a tile selects and plays nothing", () => {
		const editor = readFileSync(join(import.meta.dir, "SlideEditor.tsx"), "utf8");
		const selection = editor.slice(
			editor.indexOf("const selectOption ="),
			editor.indexOf("return (", editor.indexOf("const selectOption =")),
		);
		expect(selection).toContain("onUpdate");
		expect(selection).not.toContain("preview");
	});

	test("a new quiz stores no track, selects nothing and draws no URL field", () => {
		const markup = drawRow(newSlide("quiz"));
		expect(buttonsIn(markup, true)).toEqual([]);
		expect(markup).not.toContain(URL_FIELD);
		expect(markup).toContain("runs in silence");
	});

	test("a preset's path reads as that preset, with no URL field", () => {
		for (const preset of QUIZ_AUDIO_PRESETS) {
			const markup = rowFor(preset.path);
			expect(buttonsIn(markup, true)).toEqual([preset.label]);
			expect(markup).not.toContain(URL_FIELD);
		}
	});

	test("another address reads as Custom, with that address in the field", () => {
		const address = "https://cdn.example.com/audio/my-track.mp3";
		const markup = rowFor(address);
		expect(buttonsIn(markup, true)).toEqual(["Custom"]);
		expect(markup).toContain(URL_FIELD);
		expect(markup).toContain(`value="${address}"`);
	});

	test("opening Custom on an empty value draws an empty field", () => {
		const markup = rowFor("", true);
		expect(buttonsIn(markup, true)).toEqual(["Custom"]);
		expect(markup).toContain(URL_FIELD);
		expect(markup).toContain('value=""');
	});

	test("Remove stays drawn, and is disabled only when there is nothing to remove", () => {
		const removeButton = (markup: string) =>
			markup.split("<button").find((button) => button.includes("Remove audio cue"));
		expect(removeButton(rowFor(""))).toContain("disabled");
		expect(removeButton(rowFor(QUIZ_AUDIO_PRESETS[0].path))).not.toContain(
			'disabled=""',
		);
		expect(removeButton(rowFor("https://example.com/a.mp3"))).not.toContain(
			'disabled=""',
		);
	});
});
