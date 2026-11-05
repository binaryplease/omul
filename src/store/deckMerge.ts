// ── Deck merge: carrying a refused save onto the deck as it now stands ─────
//
// REQ126 — a Save based on a revision someone else has since saved over is
// refused `409` with the deck as it now stands. This module resolves that
// refusal instead of only reporting it: a three-way merge of the deck this
// editor loaded (`base`), the person's edits (`mine`) and the current deck
// (`theirs`).
//
// The units it merges are the ones an editor thinks in: each deck-level field
// the editor saves is one unit, and each slide — identified by its `id` — is
// one. Nothing is merged *inside* a slide, so two edits to one slide are one
// overlap rather than a spliced slide nobody wrote. A unit changed on one side
// takes that side's value; changed on both to the same value it is not a
// conflict; changed on both to different values it is an overlap, and the
// person chooses. A slide is "absent" on a side that does not have it, so an add
// is a change from absent, a delete a change to absent, and a delete against an
// edit is an overlap by the same rule as any other.
//
// The slides' order is one more unit: whichever side reordered the slides they
// both still hold leads, and the other side's slides are slotted in after their
// own predecessor. Both sides reordering differently is an overlap. The order
// is built from the set of slides kept, each placed once, so the merge can
// neither lose nor duplicate one.
//
// Pure apart from the `write` the save loop is handed, so it has no business
// with the API client: the editor page adapts the refusal into a document.

import type { Slide } from "../types";
import type { EditorDocument } from "./editorDocument";

/** A deck-level field the editor saves — every key of the document but its slides. */
export type DeckField = Exclude<keyof EditorDocument, "slides">;

/**
 * Every deck-level merge unit and what the person calls it. A `Record` over the
 * document's keys, so a field added to the editor document does not compile
 * until it says how it merges — a field this list missed would be saved from
 * one side only, silently.
 */
export const DECK_FIELD_LABELS: Record<DeckField, string> = {
	title: "Title",
	language: "Language",
	mode: "Pace",
	allowRepeatPasses: "Repeat passes",
	resultsVisibility: "Results visibility",
	qaEnabled: "Q&A",
	qaVisibility: "Q&A visibility",
	reactionsEnabled: "Reactions",
	chatEnabled: "Chat",
	requireParticipantName: "Ask for names",
	requireParticipantSignIn: "Require sign-in",
	profanityFilterEnabled: "Profanity filter",
	profanityFilterLanguage: "Profanity filter language",
	theme: "Theme",
	themeBrand: "Theme colours and fonts",
	themeLogoUrl: "Logo",
	themeLogoAlt: "Logo description",
};

const DECK_FIELDS = Object.keys(DECK_FIELD_LABELS) as DeckField[];

/** Which side's version of an overlapping unit is kept. */
export type DeckMergeSide = "mine" | "theirs";

/**
 * A unit both sides changed, differently. `key` is stable across merges of the
 * same three documents, so a choice made against it is found again. A slide is
 * `null` on the side that deleted it.
 */
export type DeckOverlap =
	| {
			kind: "field";
			key: string;
			field: DeckField;
			mine: unknown;
			theirs: unknown;
	  }
	| {
			kind: "slide";
			key: string;
			slideId: string;
			mine: Slide | null;
			theirs: Slide | null;
	  }
	| { kind: "order"; key: string; mine: string[]; theirs: string[] };

/** The person's choice per overlap, by its `key`. */
export type DeckMergeChoices = Record<string, DeckMergeSide>;

export type DeckMergeInput = {
	base: EditorDocument;
	mine: EditorDocument;
	theirs: EditorDocument;
};

/**
 * Every overlap, and the merged document — `null` while any overlap has no
 * choice, so nothing can be saved past an undecided one.
 */
export type DeckMerge = {
	overlaps: DeckOverlap[];
	document: EditorDocument | null;
};

/**
 * Structural equality as a merge needs it: key order is not a change, and a key
 * holding `undefined` is the same as a key not there — a slide that went through
 * the server and one that did not differ in both ways without anyone editing it.
 */
export function sameValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) return false;
		if (left.length !== right.length) return false;
		return left.every((item, index) => sameValue(item, right[index]));
	}
	if (!isRecord(left) || !isRecord(right)) return false;
	const keys = new Set([...definedKeys(left), ...definedKeys(right)]);
	for (const key of keys) {
		if (!sameValue(left[key], right[key])) return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function definedKeys(record: Record<string, unknown>): string[] {
	return Object.keys(record).filter((key) => record[key] !== undefined);
}

/**
 * One unit's three-way outcome: whether it is an overlap, whether it is
 * decided (an overlap is once the person has chosen), and the value it keeps.
 */
type UnitMerge<Value> = { overlap: boolean; decided: boolean; kept: Value };

function mergeUnit<Value>(
	base: Value,
	mine: Value,
	theirs: Value,
	choice: DeckMergeSide | undefined,
): UnitMerge<Value> {
	if (sameValue(mine, base)) return { overlap: false, decided: true, kept: theirs };
	if (sameValue(theirs, base)) return { overlap: false, decided: true, kept: mine };
	if (sameValue(mine, theirs)) return { overlap: false, decided: true, kept: mine };
	return {
		overlap: true,
		decided: choice !== undefined,
		kept: choice === "mine" ? mine : theirs,
	};
}

function slidesById(slides: Slide[]): Map<string, Slide> {
	return new Map(slides.map((slide) => [slide.id, slide]));
}

/**
 * The order of the kept slides: `leading` side's order, with each kept slide
 * only `following` has placed after the nearest slide before it on its own side
 * — or first, when nothing before it was placed. Each id is placed once.
 */
function interleaveOrder(
	leading: string[],
	following: string[],
	kept: Set<string>,
): string[] {
	const order = leading.filter((slideId) => kept.has(slideId));
	following.forEach((slideId, index) => {
		if (!kept.has(slideId) || order.includes(slideId)) return;
		const anchor = following
			.slice(0, index)
			.reverse()
			.find((earlier) => order.includes(earlier));
		order.splice(anchor === undefined ? 0 : order.indexOf(anchor) + 1, 0, slideId);
	});
	return order;
}

/**
 * Merge the person's edits onto the current deck. With `choices` covering
 * every overlap, `document` is the deck to save; without, it is `null` and
 * `overlaps` says what is left to choose.
 */
export function mergeDeckEdits(
	{ base, mine, theirs }: DeckMergeInput,
	choices: DeckMergeChoices = {},
): DeckMerge {
	const overlaps: DeckOverlap[] = [];
	let decided = true;

	const fields: Partial<Record<DeckField, unknown>> = {};
	for (const field of DECK_FIELDS) {
		const key = `field:${field}`;
		const unit = mergeUnit(base[field], mine[field], theirs[field], choices[key]);
		if (unit.overlap) {
			overlaps.push({
				kind: "field",
				key,
				field,
				mine: mine[field],
				theirs: theirs[field],
			});
		}
		decided &&= unit.decided;
		fields[field] = unit.kept;
	}

	const baseSlides = slidesById(base.slides);
	const mineSlides = slidesById(mine.slides);
	const theirsSlides = slidesById(theirs.slides);
	const keptSlides = new Map<string, Slide>();
	for (const slideId of new Set([...theirsSlides.keys(), ...mineSlides.keys()])) {
		const key = `slide:${slideId}`;
		const mineSlide = mineSlides.get(slideId) ?? null;
		const theirsSlide = theirsSlides.get(slideId) ?? null;
		const unit = mergeUnit(
			baseSlides.get(slideId) ?? null,
			mineSlide,
			theirsSlide,
			choices[key],
		);
		if (unit.overlap) {
			overlaps.push({
				kind: "slide",
				key,
				slideId,
				mine: mineSlide,
				theirs: theirsSlide,
			});
		}
		decided &&= unit.decided;
		if (unit.kept) keptSlides.set(slideId, unit.kept);
	}

	// Who reordered is read off the slides all three hold: an add or a delete
	// on one side moves nobody else's slide.
	const sharedOrder = (slides: Slide[]) =>
		slides
			.map((slide) => slide.id)
			.filter(
				(slideId) =>
					baseSlides.has(slideId) &&
					mineSlides.has(slideId) &&
					theirsSlides.has(slideId),
			);
	const mineOrder = mine.slides.map((slide) => slide.id);
	const theirsOrder = theirs.slides.map((slide) => slide.id);
	const order = mergeUnit(
		sharedOrder(base.slides),
		sharedOrder(mine.slides),
		sharedOrder(theirs.slides),
		choices.order,
	);
	if (order.overlap) {
		overlaps.push({ kind: "order", key: "order", mine: mineOrder, theirs: theirsOrder });
	}
	decided &&= order.decided;
	if (!decided) return { overlaps, document: null };

	const mineLeads = order.overlap
		? choices.order === "mine"
		: !sameValue(sharedOrder(mine.slides), sharedOrder(base.slides));
	const kept = new Set(keptSlides.keys());
	const slideOrder = mineLeads
		? interleaveOrder(mineOrder, theirsOrder, kept)
		: interleaveOrder(theirsOrder, mineOrder, kept);
	return {
		overlaps,
		document: {
			...(fields as Omit<EditorDocument, "slides">),
			slides: slideOrder.map((slideId) => keptSlides.get(slideId) as Slide),
		},
	};
}

/** The deck as it stood when a save was refused, and its revision. */
export type CurrentDeck = { revision: number; document: EditorDocument };

/**
 * How many times one Save carries its edits onto a deck that moved again
 * between the merge and the write before it stops and says so. Each round is
 * a write somebody else landed in that gap, so this is never reached by one
 * slow person — and the save must not spin out of the person's sight.
 */
export const DECK_MERGE_ROUNDS = 3;

/**
 * Where a save ended. Every outcome carries the edits as they now stand
 * (`document`, carried onto every deck that refused them so far), the deck
 * they are based on and its revision — what the editor should hold next.
 *
 * - `saved`: written; `merged` counts the refusals carried over on the way.
 * - `overlap`: the deck at `current` changed some unit the edits change too,
 *   differently. Nothing was written; the person chooses and saves again.
 * - `still-moving`: every round was refused. Nothing was written.
 */
export type DeckSaveOutcome = {
	document: EditorDocument;
	base: EditorDocument;
	revision: number;
} & (
	| { status: "saved"; merged: number }
	| { status: "overlap"; current: CurrentDeck; overlaps: DeckOverlap[] }
	| { status: "still-moving" }
);

/**
 * Save `document`, based on `base` at `revision`, merging it onto the current
 * deck each time the write is refused as stale. `write` resolves `null` once
 * written and the current deck when refused; any other failure it throws.
 */
export async function saveDeckEdits({
	document,
	base,
	revision,
	write,
}: {
	document: EditorDocument;
	base: EditorDocument;
	revision: number;
	write: (
		document: EditorDocument,
		baseRevision: number,
	) => Promise<CurrentDeck | null>;
}): Promise<DeckSaveOutcome> {
	let edits = { document, base, revision };
	for (let round = 0; round < DECK_MERGE_ROUNDS; round++) {
		const current = await write(edits.document, edits.revision);
		if (current === null) return { ...edits, status: "saved", merged: round };
		const merge = mergeDeckEdits({
			base: edits.base,
			mine: edits.document,
			theirs: current.document,
		});
		if (merge.document === null) {
			return { ...edits, status: "overlap", current, overlaps: merge.overlaps };
		}
		edits = {
			document: merge.document,
			base: current.document,
			revision: current.revision,
		};
	}
	return { ...edits, status: "still-moving" };
}
