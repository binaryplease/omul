/**
 * Unit tests for the template catalog and what copying an entry means.
 *
 * Covers the shared vocabulary and its pure functions (no DB, no network):
 *   - REQ005 — a catalog of prebuilt decks exists, every entry is a usable deck,
 *     and the set is narrowed by category and by search
 *   - REQ006 — the slides a template hands a new deck are *copies*: fresh
 *     identities all the way down, and the catalog untouched afterwards
 *
 * Two things are worth pinning here rather than over HTTP. The **catalog
 * itself** is content, and content is what silently rots: an entry whose slides
 * no longer parse, a duplicate id, a quiz with no marked answer, a category
 * nobody filters by. And the **copy**, because "detached from their source" is
 * an invariant about object identity that a round-trip through JSON would hide —
 * a response that merely *looks* right is exactly what a shared reference
 * produces until the second deck is edited. The round trip is in
 * `templates.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	DECK_TEMPLATE_CATEGORIES,
	DeckTemplateSchema,
	deckTemplateMatchesSearch,
	deckTemplateSearchText,
	filterDeckTemplates,
	isContentSlideType,
	SlideSchema,
	slideHasResults,
	withFreshSlideIds,
} from "./schemas";
import {
	copyTemplateSlides,
	DECK_TEMPLATES,
	findDeckTemplate,
	listDeckTemplates,
} from "./templates";

/** Every id carried by a slide, at whatever depth it sits. */
function slideIdentities(slide: Record<string, any>): string[] {
	const identities = [slide.id as string];
	for (const value of Object.values(slide)) {
		if (!Array.isArray(value)) continue;
		for (const row of value) {
			if (!row || typeof row !== "object" || typeof row.id !== "string") continue;
			identities.push(row.id);
			for (const option of Array.isArray(row.options) ? row.options : []) {
				if (typeof option?.id === "string") identities.push(option.id);
			}
		}
	}
	return identities;
}

describe("the catalog is a set of usable decks (REQ005)", () => {
	test("it is not empty, and every entry re-parses as authored", () => {
		expect(DECK_TEMPLATES.length).toBeGreaterThan(0);
		for (const template of DECK_TEMPLATES) {
			expect(DeckTemplateSchema.safeParse(template).success).toBe(true);
		}
	});

	test("every entry is addressable by an id of its own", () => {
		// The id is what a create names (REQ006), so two entries sharing one would
		// make which deck you get a matter of array order.
		const ids = DECK_TEMPLATES.map((template) => template.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(findDeckTemplate(id)?.id).toBe(id);
		}
		expect(findDeckTemplate("no-such-template")).toBeNull();
	});

	test("every entry is named, described, filed and tagged", () => {
		// A card the gallery cannot fill is an entry nobody picks. The tags matter
		// for the same reason the description does: they are what the search reads.
		for (const template of DECK_TEMPLATES) {
			expect(template.title.trim()).not.toBe("");
			expect(template.description.trim()).not.toBe("");
			expect(DECK_TEMPLATE_CATEGORIES).toContain(template.category);
			expect(template.tags.length).toBeGreaterThan(0);
			for (const tag of template.tags) expect(tag.trim()).not.toBe("");
		}
	});

	test("every category has at least one entry behind it", () => {
		// A filter chip that can only ever produce an empty gallery is a promise
		// the catalog does not keep.
		for (const category of DECK_TEMPLATE_CATEGORIES) {
			expect(listDeckTemplates({ category }).length).toBeGreaterThan(0);
		}
	});

	test("every entry's slides are slides the rest of the app accepts", () => {
		// The whole point of a template is that what comes out of it is an
		// ordinary deck: these slides go through the same schema a hand-authored
		// one does, and every question slide actually asks something.
		for (const template of DECK_TEMPLATES) {
			expect(template.slides.length).toBeGreaterThan(0);
			for (const slide of template.slides) {
				expect(SlideSchema.safeParse(slide).success).toBe(true);
				expect(slide.question.trim()).not.toBe("");
			}
			const slideIds = template.slides.map((slide) => slide.id);
			expect(new Set(slideIds).size).toBe(slideIds.length);
		}
	});

	test("no entry points at media this deployment would have to fetch", () => {
		// A template that shipped an image URL would make a first-run deck depend
		// on somebody else's asset host — and render as a blank frame offline.
		for (const template of DECK_TEMPLATES) {
			for (const slide of template.slides) {
				expect(slide.mediaUrl).toBe("");
				expect(slide.backgroundImage).toBe("");
			}
		}
	});

	test("a choice or quiz slide offers something to choose between", () => {
		for (const template of DECK_TEMPLATES) {
			for (const slide of template.slides) {
				if (slide.type === "quiz" && slide.quizAnswerMode === "type") {
					expect(slide.quizAnswers.length).toBeGreaterThan(0);
					continue;
				}
				if (slide.type !== "multiple-choice" && slide.type !== "quiz") continue;
				expect(slide.options.length).toBeGreaterThan(1);
				for (const option of slide.options) {
					expect(option.text.trim()).not.toBe("");
				}
			}
		}
	});

	test("a scored quiz question has an answer key", () => {
		// A quiz slide nobody can be right on scores the whole room zero, which is
		// not a starting point — it is a slide the organizer has to notice and fix.
		for (const template of DECK_TEMPLATES) {
			for (const slide of template.slides) {
				if (slide.type !== "quiz") continue;
				const marked =
					slide.quizAnswerMode === "type"
						? slide.quizAnswers.length
						: slide.options.filter((option) => option.isCorrect).length;
				expect(marked).toBeGreaterThan(0);
			}
		}
	});

	test("a content slide is content and a question slide has a tally", () => {
		// Not an assertion about the catalog so much as a check that these are
		// real slides of the app's own two kinds, not a third thing.
		for (const template of DECK_TEMPLATES) {
			for (const slide of template.slides) {
				expect(
					isContentSlideType(slide.type) || slideHasResults(slide.type),
				).toBe(true);
			}
		}
	});
});

describe("filtering the catalog (REQ005)", () => {
	test("no query is the whole catalog, in the order it was authored", () => {
		expect(listDeckTemplates()).toEqual([...DECK_TEMPLATES]);
		expect(filterDeckTemplates(DECK_TEMPLATES, {})).toEqual([...DECK_TEMPLATES]);
		expect(filterDeckTemplates(DECK_TEMPLATES, { search: "   " })).toEqual([
			...DECK_TEMPLATES,
		]);
	});

	test("a category keeps only the entries filed under it", () => {
		const meetings = listDeckTemplates({ category: "meeting" });
		expect(meetings.length).toBeGreaterThan(0);
		for (const template of meetings) expect(template.category).toBe("meeting");
		expect(meetings.length).toBeLessThan(DECK_TEMPLATES.length);
	});

	test("a search reads the title, the description, the category and the tags", () => {
		const template = DECK_TEMPLATES[0];
		expect(deckTemplateMatchesSearch(template, template.title)).toBe(true);
		expect(deckTemplateMatchesSearch(template, template.tags[0])).toBe(true);
		expect(deckTemplateMatchesSearch(template, template.category)).toBe(true);
		expect(
			deckTemplateMatchesSearch(
				template,
				template.description.split(" ")[0] ?? template.title,
			),
		).toBe(true);
		expect(deckTemplateSearchText(template)).toContain(
			template.title.toLowerCase(),
		);
	});

	test("case and surrounding space are not part of the search", () => {
		const template = DECK_TEMPLATES[0];
		expect(
			deckTemplateMatchesSearch(template, `  ${template.title.toUpperCase()}  `),
		).toBe(true);
	});

	test("a search nothing answers returns nothing rather than everything", () => {
		expect(listDeckTemplates({ search: "zzzzz-nothing-here" })).toEqual([]);
	});

	test("the two filters narrow together, not one or the other", () => {
		const quizzes = listDeckTemplates({
			category: "engagement",
			search: "quiz",
		});
		for (const template of quizzes) {
			expect(template.category).toBe("engagement");
			expect(deckTemplateMatchesSearch(template, "quiz")).toBe(true);
		}
		// The same search under a category the match is not filed under finds it
		// nowhere — an AND, not an OR.
		expect(listDeckTemplates({ category: "meeting", search: "quiz" })).toEqual(
			[],
		);
	});
});

describe("a copy is a copy (REQ006)", () => {
	const template = DECK_TEMPLATES.find(
		(entry) => entry.id === "quiz-round",
	) as (typeof DECK_TEMPLATES)[number];

	test("the copy has the same slides in the same order", () => {
		const copies = copyTemplateSlides(template);
		expect(copies.length).toBe(template.slides.length);
		copies.forEach((copy, index) => {
			expect(copy.type).toBe(template.slides[index].type);
			expect(copy.question).toBe(template.slides[index].question);
		});
	});

	test("no identity is shared with the entry it came from", () => {
		const copies = copyTemplateSlides(template);
		const source = new Set(template.slides.flatMap(slideIdentities));
		expect(source.size).toBeGreaterThan(template.slides.length);
		for (const identity of copies.flatMap(slideIdentities)) {
			expect(source.has(identity)).toBe(false);
		}
	});

	test("two copies of one entry are detached from each other too", () => {
		const first = copyTemplateSlides(template).flatMap(slideIdentities);
		const second = copyTemplateSlides(template).flatMap(slideIdentities);
		for (const identity of second) expect(first).not.toContain(identity);
	});

	test("copying does not reach back into the catalog", () => {
		// The failure this guards is a shallow copy: mutate the copy, and the entry
		// every later create reads from has quietly changed for the lifetime of the
		// process.
		const before = JSON.stringify(template);
		const copies = copyTemplateSlides(template) as Record<string, any>[];
		copies[1].question = "Edited by the organizer";
		if (Array.isArray(copies[1].options) && copies[1].options.length > 0) {
			copies[1].options[0].text = "Edited too";
		}
		expect(JSON.stringify(findDeckTemplate(template.id))).toBe(before);
	});

	test("the nested rows are re-identified, not only the slide", () => {
		// The one that regresses silently: ids at the top look fresh while a form
		// field's own options still carry the template's.
		const nested = withFreshSlideIds([
			{
				id: "source",
				type: "form",
				question: "Sign up",
				formFields: [
					{
						id: "field",
						label: "Track",
						type: "choice",
						options: [{ id: "option", text: "Morning" }],
					},
				],
			},
		])[0] as Record<string, any>;
		expect(nested.id).not.toBe("source");
		expect(nested.formFields[0].id).not.toBe("field");
		expect(nested.formFields[0].options[0].id).not.toBe("option");
		// Everything that is not an identity comes through untouched.
		expect(nested.formFields[0].label).toBe("Track");
		expect(nested.formFields[0].options[0].text).toBe("Morning");
	});

	test("a scale's value-keyed labels are left alone", () => {
		// `scaleLabels` are keyed by the value they sit on rather than by an id, so
		// there is nothing to regenerate — and inventing one would detach a label
		// from the point on the axis it names.
		const copy = withFreshSlideIds([
			{
				id: "source",
				type: "scale",
				question: "Rate it",
				scaleLabels: [{ value: 3, label: "Neutral" }],
			},
		])[0] as Record<string, any>;
		expect(copy.scaleLabels).toEqual([{ value: 3, label: "Neutral" }]);
	});

	test("an empty deck copies to an empty deck", () => {
		expect(withFreshSlideIds([])).toEqual([]);
	});
});
