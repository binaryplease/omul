/**
 * The deck document a create sends (`cli/deck.ts`).
 *
 * The one liberty this client takes with a deck is filling in the opaque ids
 * the schema requires and nobody reads, so what is held here is the boundary of
 * that liberty: an id that was authored is kept (a deck referring to its own
 * slide ids must survive the trip), a list whose entries carry no identity in
 * the schema is not given one, and nothing else about the document is touched —
 * a deck the server would refuse is still refused, by the server, with its own
 * message.
 */

import { describe, expect, test } from "bun:test";
import { withGeneratedIds } from "./deck";

describe("withGeneratedIds", () => {
	test("gives every slide and every option an id", () => {
		const deck = withGeneratedIds({
			title: "Retro",
			slides: [
				{
					type: "multiple-choice",
					question: "How did it go?",
					options: [{ text: "Great" }, { text: "Rough" }],
				},
			],
		});
		const slides = deck.slides as Record<string, unknown>[];
		expect(typeof slides[0]?.id).toBe("string");
		expect(slides[0]?.id).not.toBe("");
		const options = slides[0]?.options as Record<string, unknown>[];
		expect(typeof options[0]?.id).toBe("string");
		expect(options[0]?.id).not.toBe(options[1]?.id);
	});

	test("keeps an id the author wrote", () => {
		const deck = withGeneratedIds({
			slides: [{ id: "intro", type: "text", question: "Welcome" }],
		});
		expect((deck.slides as Record<string, unknown>[])[0]?.id).toBe("intro");
	});

	test("leaves a list whose entries have no identity alone", () => {
		const deck = withGeneratedIds({
			slides: [
				{
					type: "scale",
					question: "Rate it",
					scaleLabels: [{ value: 1, label: "Low" }],
				},
			],
		});
		const slide = (deck.slides as Record<string, unknown>[])[0];
		expect((slide?.scaleLabels as Record<string, unknown>[])[0]).toEqual({
			value: 1,
			label: "Low",
		});
	});

	test("changes nothing else about the document", () => {
		const deck = withGeneratedIds({
			title: "Retro",
			language: "de",
			slides: [{ id: "one", type: "word-cloud", question: "Ein Wort?" }],
		});
		expect(deck.title).toBe("Retro");
		expect(deck.language).toBe("de");
		expect((deck.slides as Record<string, unknown>[])[0]?.question).toBe(
			"Ein Wort?",
		);
	});

	test("a body with no slides at all is passed through untouched", () => {
		expect(withGeneratedIds({ templateId: "retrospective" })).toEqual({
			templateId: "retrospective",
		});
	});
});
