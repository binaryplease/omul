/**
 * The merge a refused deck save is resolved with (REQ126, slice 2). Each test
 * builds the three sides the editor holds — the deck it loaded (`base`), the
 * person's edits (`mine`) and the deck the `409` handed back (`theirs`) — and
 * asserts the merge rules: one-sided changes carried, same-value changes not a
 * conflict, two different changes to one unit an overlap that nothing is saved
 * past until the person chooses. The save loop is driven with a stand-in
 * `write`, so "saved" and "not saved" are what the server would have been sent.
 */

import { describe, expect, test } from "bun:test";
import type { Slide } from "../types";
import {
	type CurrentDeck,
	DECK_MERGE_ROUNDS,
	mergeDeckEdits,
	saveDeckEdits,
	sameValue,
} from "./deckMerge";
import { blankDocument, type EditorDocument } from "./editorDocument";

function slide(id: string, question = id): Slide {
	return { id, type: "word-cloud", question };
}

function deck(slides: Slide[], changes: Partial<EditorDocument> = {}) {
	return { ...blankDocument(), title: "Deck", slides, ...changes };
}

const ids = (document: EditorDocument | null) =>
	document?.slides.map((each) => each.id);

/** A `write` that refuses with each of `refusals` in turn, then saves. */
function writer(refusals: CurrentDeck[]) {
	const sent: { document: EditorDocument; baseRevision: number }[] = [];
	const write = async (document: EditorDocument, baseRevision: number) => {
		sent.push({ document, baseRevision });
		return refusals.shift() ?? null;
	};
	return { sent, write };
}

const base = deck([slide("a"), slide("b"), slide("c")]);

describe("mergeDeckEdits", () => {
	test("a slide edited on each side, different slides, keeps both edits", () => {
		const mine = deck([slide("a", "A mine"), slide("b"), slide("c")]);
		const theirs = deck([slide("a"), slide("b"), slide("c", "C theirs")]);
		const merge = mergeDeckEdits({ base, mine, theirs });
		expect(merge.overlaps).toEqual([]);
		expect(merge.document?.slides).toEqual([
			slide("a", "A mine"),
			slide("b"),
			slide("c", "C theirs"),
		]);
	});

	test("a setting changed on the other side survives the person's save", () => {
		const mine = deck([slide("a", "A mine"), slide("b"), slide("c")]);
		const theirs = deck(base.slides, { qaEnabled: true, chatEnabled: true });
		const merge = mergeDeckEdits({ base, mine, theirs });
		expect(merge.document?.qaEnabled).toBe(true);
		expect(merge.document?.chatEnabled).toBe(true);
		expect(merge.document?.slides[0]).toEqual(slide("a", "A mine"));
	});

	test("a setting changed on both sides to the same value is not a conflict", () => {
		const mine = deck(base.slides, { title: "Renamed" });
		const theirs = deck(base.slides, { title: "Renamed" });
		const merge = mergeDeckEdits({ base, mine, theirs });
		expect(merge.overlaps).toEqual([]);
		expect(merge.document?.title).toBe("Renamed");
	});

	test("a setting changed on both sides differently is an overlap until chosen", () => {
		const mine = deck(base.slides, { title: "Mine" });
		const theirs = deck(base.slides, { title: "Theirs" });
		const merge = mergeDeckEdits({ base, mine, theirs });
		expect(merge.document).toBeNull();
		expect(merge.overlaps).toEqual([
			{ kind: "field", key: "field:title", field: "title", mine: "Mine", theirs: "Theirs" },
		]);
		expect(
			mergeDeckEdits({ base, mine, theirs }, { "field:title": "mine" }).document
				?.title,
		).toBe("Mine");
		expect(
			mergeDeckEdits({ base, mine, theirs }, { "field:title": "theirs" }).document
				?.title,
		).toBe("Theirs");
	});

	test("the same slide edited on both sides is one overlap, not a spliced slide", () => {
		const mine = deck([slide("a"), slide("b", "B mine"), slide("c")]);
		const theirs = deck([slide("a"), { ...slide("b"), skipped: true }, slide("c")]);
		const merge = mergeDeckEdits({ base, mine, theirs });
		expect(merge.document).toBeNull();
		expect(merge.overlaps.map((overlap) => overlap.key)).toEqual(["slide:b"]);
		const chosen = mergeDeckEdits({ base, mine, theirs }, { "slide:b": "mine" });
		expect(chosen.document?.slides[1]).toEqual(slide("b", "B mine"));
	});

	test("a delete against an edit is an overlap, and either choice is honoured", () => {
		const mine = deck([slide("a"), slide("c")]);
		const theirs = deck([slide("a"), slide("b", "B theirs"), slide("c")]);
		const merge = mergeDeckEdits({ base, mine, theirs });
		expect(merge.document).toBeNull();
		expect(merge.overlaps).toEqual([
			{
				kind: "slide",
				key: "slide:b",
				slideId: "b",
				mine: null,
				theirs: slide("b", "B theirs"),
			},
		]);
		expect(ids(mergeDeckEdits({ base, mine, theirs }, { "slide:b": "mine" }).document)).toEqual(["a", "c"]);
		expect(ids(mergeDeckEdits({ base, mine, theirs }, { "slide:b": "theirs" }).document)).toEqual(["a", "b", "c"]);
	});

	test("a delete on one side of a slide the other left alone deletes it", () => {
		const mine = deck([slide("a"), slide("c")]);
		const merge = mergeDeckEdits({ base, mine, theirs: base });
		expect(ids(merge.document)).toEqual(["a", "c"]);
		const theirs = deck([slide("a"), slide("b")]);
		expect(ids(mergeDeckEdits({ base, mine: base, theirs }).document)).toEqual(["a", "b"]);
	});

	test("an add on each side keeps both, each after its own predecessor", () => {
		const mine = deck([slide("a"), slide("mine-new"), slide("b"), slide("c")]);
		const theirs = deck([slide("theirs-first"), slide("a"), slide("b"), slide("c"), slide("theirs-last")]);
		const merge = mergeDeckEdits({ base, mine, theirs });
		expect(merge.overlaps).toEqual([]);
		expect(ids(merge.document)).toEqual([
			"theirs-first",
			"a",
			"mine-new",
			"b",
			"c",
			"theirs-last",
		]);
	});

	test("a reorder on one side is kept, with the other side's add slotted in", () => {
		const mine = deck([slide("c"), slide("a"), slide("b")]);
		const theirs = deck([slide("a"), slide("new"), slide("b"), slide("c")]);
		expect(ids(mergeDeckEdits({ base, mine, theirs }).document)).toEqual([
			"c",
			"a",
			"new",
			"b",
		]);
	});

	test("two different reorders are an overlap over the slide order", () => {
		const mine = deck([slide("c"), slide("a"), slide("b")]);
		const theirs = deck([slide("b"), slide("a"), slide("c")]);
		const merge = mergeDeckEdits({ base, mine, theirs });
		expect(merge.overlaps.map((overlap) => overlap.key)).toEqual(["order"]);
		expect(merge.document).toBeNull();
		expect(ids(mergeDeckEdits({ base, mine, theirs }, { order: "mine" }).document)).toEqual(["c", "a", "b"]);
		expect(ids(mergeDeckEdits({ base, mine, theirs }, { order: "theirs" }).document)).toEqual(["b", "a", "c"]);
	});

	test("no slide is lost or duplicated, whatever both sides did", () => {
		const wide = deck(["a", "b", "c", "d", "e", "f"].map((id) => slide(id)));
		const mine = deck([
			slide("f"),
			slide("m1"),
			slide("a", "A mine"),
			slide("c"),
			slide("e"),
			slide("m2"),
		]);
		const theirs = deck([
			slide("t1"),
			slide("a"),
			slide("b"),
			slide("d"),
			slide("e", "E theirs"),
			slide("t2"),
			slide("f"),
		]);
		const merge = mergeDeckEdits({ base: wide, mine, theirs });
		expect(merge.overlaps).toEqual([]);
		const merged = ids(merge.document) ?? [];
		// b was deleted by mine, d by both; c by theirs — each left alone on the
		// other side, so all three go. Every other slide either side holds is kept.
		expect([...merged].sort()).toEqual(["a", "e", "f", "m1", "m2", "t1", "t2"]);
		expect(new Set(merged).size).toBe(merged.length);
	});

	test("a key holding undefined reads the same as an absent key", () => {
		expect(sameValue({ id: "a", skipped: undefined }, { id: "a" })).toBe(true);
		expect(sameValue({ id: "a", b: 1, c: 2 }, { c: 2, b: 1, id: "a" })).toBe(true);
		expect(sameValue([1, 2], [2, 1])).toBe(false);
	});
});

describe("saveDeckEdits", () => {
	test("a non-overlapping refusal is merged and saved on the current revision", async () => {
		const mine = deck([slide("a", "A mine"), slide("b"), slide("c")]);
		const theirs = deck([slide("a"), slide("b", "B theirs"), slide("c")], {
			qaEnabled: true,
		});
		const { sent, write } = writer([{ revision: 8, document: theirs }]);
		const outcome = await saveDeckEdits({ document: mine, base, revision: 7, write });
		expect(outcome.status).toBe("saved");
		expect(sent.map((each) => each.baseRevision)).toEqual([7, 8]);
		expect(sent[1].document.slides).toEqual([
			slide("a", "A mine"),
			slide("b", "B theirs"),
			slide("c"),
		]);
		expect(sent[1].document.qaEnabled).toBe(true);
		expect(outcome).toMatchObject({ merged: 1, revision: 8, base: theirs });
	});

	test("an overlapping refusal saves nothing and hands back the overlap", async () => {
		const mine = deck([slide("a", "A mine"), slide("b"), slide("c")]);
		const theirs = deck([slide("a", "A theirs"), slide("b"), slide("c")]);
		const { sent, write } = writer([{ revision: 8, document: theirs }]);
		const outcome = await saveDeckEdits({ document: mine, base, revision: 7, write });
		expect(sent).toHaveLength(1);
		expect(outcome.status).toBe("overlap");
		if (outcome.status !== "overlap") return;
		expect(outcome.overlaps.map((overlap) => overlap.key)).toEqual(["slide:a"]);
		expect(outcome.current.revision).toBe(8);
		// The edits stay the person's, based where they were.
		expect(outcome.document).toBe(mine);
		expect(outcome.revision).toBe(7);
	});

	test("a deck that keeps moving stops the save in sight instead of looping", async () => {
		const refusals = Array.from({ length: DECK_MERGE_ROUNDS }, (_, index) => ({
			revision: 8 + index,
			document: deck(base.slides, { title: `Theirs ${index}` }),
		}));
		const mine = deck([slide("a", "A mine"), slide("b"), slide("c")]);
		const { sent, write } = writer(refusals);
		const outcome = await saveDeckEdits({ document: mine, base, revision: 7, write });
		expect(outcome.status).toBe("still-moving");
		expect(sent).toHaveLength(DECK_MERGE_ROUNDS);
		// Every carried-over round kept the person's edit and the newest title.
		expect(outcome.document.slides[0]).toEqual(slide("a", "A mine"));
		expect(outcome.document.title).toBe(`Theirs ${DECK_MERGE_ROUNDS - 1}`);
		expect(outcome.revision).toBe(7 + DECK_MERGE_ROUNDS);
	});
});
