/**
 * Unit tests for the reaction surface's descriptor and labels (REQ077).
 *
 * The interesting property here is a **completeness** one. Which reactions exist
 * is the server's decision — a Zod enum validated at the boundary — and this
 * module is what draws and names them. So the risk is drift: a reaction added to
 * the schema and not given an icon would be a value the boundary accepts, the
 * socket delivers, and no screen can draw.
 *
 * TypeScript catches the descriptor half of that (`Record<ReactionKind, …>` is a
 * type error when a key is missing); nothing catches the *label* half, or a
 * dictionary that gained a language and not the strings, which is what the
 * assertions below are for.
 */

import { describe, expect, test } from "bun:test";
import { getDict } from "../i18n";
import { REACTION_KINDS } from "../types";
import {
	REACTION_ICONS,
	REACTION_LABELS_EN,
	reactionLabelsFor,
} from "./ReactionBar";

describe("REACTION_ICONS (REQ077)", () => {
	test("every reaction the schema declares can be drawn", () => {
		expect(Object.keys(REACTION_ICONS).sort()).toEqual(
			[...REACTION_KINDS].sort(),
		);
	});

	test("nothing is drawn that the boundary would refuse", () => {
		// The other direction of the same rule: an icon for a kind the server does
		// not accept is a control that fails every time it is pressed.
		for (const kind of Object.keys(REACTION_ICONS)) {
			expect(REACTION_KINDS).toContain(kind as (typeof REACTION_KINDS)[number]);
		}
	});

	test("each one has a name, a tint and something to draw", () => {
		for (const kind of REACTION_KINDS) {
			const descriptor = REACTION_ICONS[kind];
			expect(descriptor.label.length).toBeGreaterThan(0);
			expect(descriptor.tone.length).toBeGreaterThan(0);
			// A component rather than a rendered element, so the row can draw it at
			// a phone's size and the overlay at a projector's. lucide-react's are
			// `forwardRef` objects, so this asks "renderable", not "is a function".
			expect(["function", "object"]).toContain(typeof descriptor.Icon);
			expect(descriptor.Icon).toBeTruthy();
		}
	});

	test("no two reactions share a name", () => {
		// The name is the button's accessible name — the icon carries no text — so
		// two reactions called the same thing are two controls a screen reader
		// cannot tell apart.
		const names = REACTION_KINDS.map((kind) => REACTION_ICONS[kind].label);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe("reactionLabelsFor (REQ084)", () => {
	test("maps the participant dictionary onto every reaction", () => {
		const labels = reactionLabelsFor(getDict("de"));
		expect(labels.title).toBe(getDict("de").reactionsTitle);
		expect(labels.kinds.like).toBe(getDict("de").reactionLike);
		expect(labels.kinds.love).toBe(getDict("de").reactionLove);
		expect(labels.kinds.celebrate).toBe(getDict("de").reactionCelebrate);
		expect(labels.kinds.laugh).toBe(getDict("de").reactionLaugh);
		expect(labels.kinds.insight).toBe(getDict("de").reactionInsight);
	});

	test("the English mapping and the presenter's own wording agree", () => {
		// Two surfaces, one wording.
		expect(reactionLabelsFor(getDict("en"))).toEqual(REACTION_LABELS_EN);
	});

	test("every supported language names every reaction", () => {
		for (const language of ["en", "de", "fr", "es", "it", "pt", "nl"]) {
			const labels = reactionLabelsFor(getDict(language));
			expect(labels.title.length).toBeGreaterThan(0);
			for (const kind of REACTION_KINDS) {
				expect(labels.kinds[kind].length).toBeGreaterThan(0);
			}
		}
	});

	test("a translated row still names one control per reaction", () => {
		const labels = reactionLabelsFor(getDict("fr"));
		expect(Object.keys(labels.kinds).sort()).toEqual([...REACTION_KINDS].sort());
	});
});
