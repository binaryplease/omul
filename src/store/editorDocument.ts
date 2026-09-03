// ── Editor document: the CRDT-ready operation surface ─────────────────
//
// This module owns the *document* the author edits — title, language, pace
// mode, and the slide list — and the closed set of structural **operations**
// over it, applied by a single pure reducer (`applyEditorOperation`). The
// editor slice does no slide/option surgery itself; it builds an operation and
// hands it here.
//
// This is the seam a future CRDT (Yjs) binding plugs into. Today the reducer
// rewrites a plain in-memory document; when collaborative editing is scheduled
// a binding replaces *this one function* with one that applies the same
// operation to a shared `Y.Doc` and derives the next document from it — leaving
// the operation set, the slice's action surface, and every component untouched.
// That is why the work stops here and pulls in no Yjs dependency (triage:
// "seam only, no Yjs"; binding choice deferred to scheduling time).
//
// The cardinal CRDT-readiness rule encoded here: every operation that targets
// an existing slide or option addresses it by its **stable id**, never by array
// index. Indices shift under concurrent inserts, removes, and moves, so an
// index captured by one editor would address the wrong element once another
// editor's change merges; stable ids are position-independent and merge
// cleanly. Construction-time ids (`crypto.randomUUID()`) are minted before the
// operation is dispatched so they are identical across every replica.

import {
	DEFAULT_DECK_THEME,
	EMPTY_DECK_BRAND,
	effectiveResultsVisibility,
	LEADERBOARD_DEFAULT_SIZE,
	PIN_COORDINATE_MAX,
	withInheritedResultsVisibility,
} from "../types";
import type {
	DeckBrand,
	DeckThemeId,
	FormFieldInput,
	FormFieldOptionInput,
	FormFieldType,
	GridItem,
	PinAreaInput,
	PointsItem,
	PresentationMode,
	QAVisibility,
	QuizAcceptedAnswer,
	RankingItem,
	ResultsVisibility,
	Slide,
	SlideOption,
	SlideResultsVisibility,
	SlideType,
} from "../types";

/** The collaboratively-edited authoring document (the slice's data, sans actions). */
export interface EditorDocument {
	title: string;
	language: string;
	mode: PresentationMode;
	/** Deck-level default for results visibility; each slide may override it. */
	resultsVisibility: ResultsVisibility;
	/**
	 * Whether questions can be asked from any slide (REQ036) and who may read
	 * them (REQ037). Deck-level, because the layer is: it is not a property of
	 * any one slide, and no slide can turn it on for itself.
	 */
	qaEnabled: boolean;
	qaVisibility: QAVisibility;
	/**
	 * The two participant channels: reactions on any slide (REQ077) and the
	 * deck's live chat (REQ078). Deck-level for the reason the Q&A layer is —
	 * neither belongs to a slide, and no slide can open one for itself.
	 */
	reactionsEnabled: boolean;
	chatEnabled: boolean;
	/**
	 * Whether the people joining this deck state a name (REQ076). Deck-level for
	 * the reason the channels above are: it is a question asked at the deck's
	 * door, and no slide can ask it for itself.
	 */
	requireParticipantName: boolean;
	/**
	 * The theme the deck is drawn in (REQ079/REQ080) — a built-in one, or the one
	 * authored in `themeBrand` — and the organizer's own mark (REQ136), an image
	 * URL and the name it goes by. Deck-level, because that is what a theme is: no
	 * slide picks its own palette.
	 *
	 * The brand is edited whichever theme is selected and applied only while
	 * `theme` is `custom`, so trying a built-in one on does not discard the
	 * colours the organizer authored.
	 */
	theme: DeckThemeId;
	themeBrand: DeckBrand;
	themeLogoUrl: string;
	themeLogoAlt: string;
	slides: Slide[];
}

/**
 * The closed set of structural mutations over an {@link EditorDocument}. Each
 * variant is the unit a CRDT binding intercepts. Operations that touch an
 * existing slide or option address it by stable id, never by index; operations
 * that create one carry the fully-built element (its id already minted) so the
 * same id lands on every replica.
 */
export type EditorOperation =
	| { type: "set-meta"; changes: Partial<Omit<EditorDocument, "slides">> }
	| { type: "set-brand"; changes: Partial<DeckBrand> }
	| { type: "apply-results-visibility"; resultsVisibility: ResultsVisibility }
	| { type: "add-slide"; slide: Slide }
	| { type: "update-slide"; slideId: string; changes: Partial<Slide> }
	| { type: "remove-slide"; slideId: string }
	| { type: "move-slide"; slideId: string; direction: -1 | 1 }
	| { type: "reorder-slide"; slideId: string; toIndex: number }
	| { type: "add-option"; slideId: string; option: SlideOption }
	| {
			type: "update-option";
			slideId: string;
			optionId: string;
			changes: Partial<SlideOption>;
	  }
	| { type: "remove-option"; slideId: string; optionId: string };

/**
 * A blank answer option for a choice slide. Choice slides carry an explicit
 * `isCorrect: false` because either type can have its solution marked (REQ013);
 * any other slide type has no options at all, so the flag stays absent.
 */
export function newOption(type: SlideType): SlideOption {
	const isChoice = type === "multiple-choice" || type === "quiz";
	return {
		id: crypto.randomUUID(),
		text: "",
		isCorrect: isChoice ? false : undefined,
	};
}

/**
 * A blank item on a ranking slide (REQ034). Ranking items are their own list —
 * not the `options` a choice slide carries — because nothing about them is a
 * choice: they have no correctness and no selection limit, only an order.
 */
export function newRankingItem(): RankingItem {
	return { id: crypto.randomUUID(), text: "" };
}

/**
 * A blank item on a 2x2 Grid slide (REQ047). Its own list for the same reason
 * ranking items are: an item carries no correctness and no selection limit,
 * only the position a participant gives it.
 */
export function newGridItem(): GridItem {
	return { id: crypto.randomUUID(), text: "" };
}

/**
 * A blank item on a 100 Points slide (REQ045). Its own list for the same reason
 * ranking and grid items are: an item carries no correctness and no selection
 * limit, only the share of the budget a participant hands it.
 */
export function newPointsItem(): PointsItem {
	return { id: crypto.randomUUID(), text: "" };
}

/**
 * A blank accepted solution on a typed quiz question (REQ055). Its own list
 * rather than the `options` a select-answer quiz carries: an accepted answer is
 * never offered to anyone, so it has no colour, no position and no selection —
 * it is only ever compared against what a participant wrote.
 */
export function newQuizAnswer(): QuizAcceptedAnswer {
	return { id: crypto.randomUUID(), text: "" };
}

/**
 * A blank field on a Form slide (REQ061). Its own list rather than the `options`
 * a choice slide carries, and rather than the flat `{id, text}` every other item
 * list here holds: a form field is the only authored item that carries a *type*,
 * and the type is what decides both the control the participant is given and
 * what the boundary will accept as an answer to it.
 *
 * Opens as free text and optional — the two states that ask the least of the
 * participant. Making a field required, or narrowing it to an address, is a
 * decision the organizer takes deliberately about that one field; neither is
 * something they should have to undo on every field they add.
 */
export function newFormField(type: FormFieldType = "text"): FormFieldInput {
	return {
		id: crypto.randomUUID(),
		label: "",
		type,
		required: false,
		// A choice field is unanswerable until it offers something, so it opens
		// with two blanks the way a choice slide's options do — one option is not
		// a choice.
		options:
			type === "choice" ? [newFormFieldOption(), newFormFieldOption()] : [],
	};
}

/** A blank option offered by a `choice` field on a Form slide (REQ061). */
export function newFormFieldOption(): FormFieldOptionInput {
	return { id: crypto.randomUUID(), text: "" };
}

/**
 * The reveal a Form slide is authored with (REQ061).
 *
 * Named rather than written twice: {@link newSlide} seeds it, and the settings
 * column measures the slide's reveal against it — a form sitting exactly on this
 * posture is *at* its default, not departing from one, and must not be offered a
 * "reset" that would loosen it (REQ155).
 */
export const FORM_RESULTS_VISIBILITY: SlideResultsVisibility = "private";

/**
 * The reveal this slide would be authored with if nobody had touched it — the
 * product's own posture for a slide of this shape, which is what REQ155 means by
 * a *product* default beside the deck-level one.
 *
 * Two types have one that is not "follow the deck", and both are safety
 * postures rather than preferences:
 *
 * - A **form** collects what people wrote about themselves, so it opens
 *   `private` ({@link FORM_RESULTS_VISIBILITY}). Loosening it is the organizer's
 *   explicit choice; nothing may loosen it *for* them.
 * - A **pin slide carrying a target area** has an answer key drawn on the
 *   picture participants are aiming at, so its posture is whatever
 *   {@link withPinAreaEnabled} would author — asked of that function rather than
 *   restated, so the rule that tightens the reveal and the rule that reads it
 *   back cannot drift apart.
 */
export function defaultResultsVisibilityFor(
	slide: Pick<Slide, "type" | "pinArea">,
	deckVisibility: ResultsVisibility,
): SlideResultsVisibility {
	if (slide.type === "form") return FORM_RESULTS_VISIBILITY;
	if (slide.type === "pin-image" && (slide.pinArea ?? null) !== null) {
		return (
			withPinAreaEnabled({ resultsVisibility: "inherit" }, deckVisibility)
				.resultsVisibility ?? "inherit"
		);
	}
	return "inherit";
}

/**
 * The changes that turn a correct area on for a Pin on Image slide (REQ053) —
 * the target itself, and the results visibility it should be authored with.
 *
 * A target area is an **answer key drawn on the picture the participant is
 * aiming at**, so the moment a slide acquires one it stops being "show the room
 * the cluster as it forms" and becomes a knowledge check. Enabling it therefore
 * also pins the slide to `on-click` — the reveal it needs — rather than leaving
 * it on a deck default that shows the target from the start. The safe posture is
 * the one the organizer gets without having to remember it; showing the answer
 * up front stays available, as an explicit choice in the Visibility section
 * directly below the control that made this one.
 *
 * It only ever **tightens**. A slide already on an explicit setting is left
 * alone, and a deck defaulting to `on-click` or `private` is inherited
 * unchanged: turning a target on must never make a private slide revealable.
 */
export function withPinAreaEnabled(
	slide: Pick<Slide, "resultsVisibility">,
	deckVisibility: ResultsVisibility,
): Partial<Slide> {
	const area: PinAreaInput = {
		// A box in the middle of the picture rather than at a corner: it is visible
		// the instant it exists, so the author drags or types from something.
		x: Math.round(PIN_COORDINATE_MAX * 0.35),
		y: Math.round(PIN_COORDINATE_MAX * 0.35),
		width: Math.round(PIN_COORDINATE_MAX * 0.3),
		height: Math.round(PIN_COORDINATE_MAX * 0.3),
	};
	const current = slide.resultsVisibility ?? "inherit";
	const needsReveal =
		current === "inherit" &&
		effectiveResultsVisibility(current, deckVisibility) === "instant";
	return needsReveal
		? { pinArea: area, resultsVisibility: "on-click" }
		: { pinArea: area };
}

/** A fresh blank multiple-choice slide — the default starting point. */
export function blankSlide(): Slide {
	return {
		id: crypto.randomUUID(),
		type: "multiple-choice",
		question: "",
		options: [newOption("multiple-choice"), newOption("multiple-choice")],
	};
}

/** Build a new slide of the given type with its type-specific defaults. */
export function newSlide(type: SlideType): Slide {
	const slide: Slide = { id: crypto.randomUUID(), type, question: "" };
	if (type === "multiple-choice" || type === "quiz") {
		slide.options = [newOption(type), newOption(type)];
	}
	if (type === "scale") {
		slide.scaleMin = 1;
		slide.scaleMax = 5;
		slide.scaleMinLabel = "";
		slide.scaleMaxLabel = "";
	}
	if (type === "ranking") {
		// Two items, mirroring a choice slide's two blank options: an ordering
		// needs at least a pair to be an ordering at all.
		slide.rankingItems = [newRankingItem(), newRankingItem()];
	}
	if (type === "grid") {
		// Two blank items to place, and both axes seeded with the 0–10 range the
		// schema defaults to (REQ049) so the number fields open on real values.
		// Titles stay empty: naming the dimensions is the authoring decision the
		// slide is built around (REQ048), and a placeholder title would let it
		// ship unmade.
		slide.gridItems = [newGridItem(), newGridItem()];
		slide.gridXAxis = { title: "", min: 0, max: 10, minLabel: "", maxLabel: "" };
		slide.gridYAxis = { title: "", min: 0, max: 10, minLabel: "", maxLabel: "" };
	}
	if (type === "points") {
		// Two items, like a ranking's: one item is no trade-off at all — the
		// whole budget has nowhere else to go — so the editor never opens on a
		// slide that cannot be answered meaningfully.
		slide.pointsItems = [newPointsItem(), newPointsItem()];
	}
	if (type === "guess-number") {
		// The 0–100 range in steps of 1 the schema defaults to (REQ040/REQ043), so
		// the number fields open on a real frame the author can narrow. No
		// reference: a correct number is a decision the organizer makes about this
		// particular question (REQ041), and seeding one would ship a right answer
		// nobody chose.
		slide.guessRange = { min: 0, max: 100, step: 1 };
		slide.guessReference = null;
	}
	if (type === "pin-image") {
		// Nothing is seeded, and both blanks are the point. The image is the one
		// thing the author has to supply for the question to exist at all (REQ052),
		// so it opens empty and the editor refuses to save without it — a
		// placeholder URL would ship a slide asking about somebody else's picture.
		// The target area stays `null` because a correct area is a decision about
		// this particular question (REQ053): most pin slides are "where would you
		// put it?", which has no right answer, and a seeded box would claim one.
		slide.mediaUrl = "";
		slide.mediaAlt = "";
		slide.pinArea = null;
	}
	if (type === "form") {
		// A name and an address to reach somebody at — the two fields nearly every
		// form opens with, so the author starts by editing rather than by building
		// the shape out of nothing. Both optional: what makes a submission complete
		// is the organizer's decision (REQ061), not this seed's.
		slide.formFields = [
			{ ...newFormField("text"), label: "Name" },
			{ ...newFormField("email"), label: "Email" },
		];
		// **A form's submitted rows are never published to the room** — the
		// aggregation hands them only to a caller who can edit the deck — and the
		// slide is authored `private` on top of that. Belt and braces, and each
		// does a different job: the gate is what makes a stranger's address
		// unpublishable at all, while this makes the safe posture *visible* in the
		// Visibility section, where the organizer can see that the slide is not
		// feeding the shared screen. Loosening it is then their explicit choice,
		// and even loosened it only publishes counts.
		slide.resultsVisibility = FORM_RESULTS_VISIBILITY;
	}
	if (type === "leaderboard") {
		// The top five (REQ059) — the board's default size, seeded so the setting
		// opens on the number the slide actually shows rather than on nothing.
		slide.leaderboardSize = LEADERBOARD_DEFAULT_SIZE;
	}
	if (type === "quiz") {
		slide.timeLimit = 30;
		// Select-answer is the mode a fresh quiz opens in (REQ054): it is the one
		// that is complete the moment its options are filled in, while a typed
		// question (REQ055) is only answerable once the organizer has named a
		// solution — so the author switches into it deliberately rather than
		// finding themselves in it.
		slide.quizAnswerMode = "select";
		slide.quizAnswers = [];
	}
	return slide;
}

/** A blank single-slide draft — the document a Create session starts from. */
export function blankDocument(): EditorDocument {
	return {
		title: "",
		language: "en",
		mode: "live",
		resultsVisibility: "instant",
		qaEnabled: false,
		qaVisibility: "presenter",
		// Both participant channels closed (REQ077/REQ078) — what an unstated one
		// means everywhere else too, so a fresh deck opens neither by default.
		reactionsEnabled: false,
		chatEnabled: false,
		// REQ076 — a fresh deck asks nobody for a name, which is the same default
		// the schema and the create endpoint hold and the only one that fails safe:
		// a deck that was never authored to collect names collects none.
		requireParticipantName: false,
		// The house theme, no authored brand and no logo — what an unstated theme
		// means everywhere else too, read from the schema rather than restated here
		// (REQ079/REQ080/REQ136).
		theme: DEFAULT_DECK_THEME,
		themeBrand: EMPTY_DECK_BRAND,
		themeLogoUrl: "",
		themeLogoAlt: "",
		slides: [blankSlide()],
	};
}

/** Replace the slide carrying `slideId`; other slides pass through untouched. */
function mapSlide(
	slides: Slide[],
	slideId: string,
	change: (slide: Slide) => Slide,
): Slide[] {
	return slides.map((slide) => (slide.id === slideId ? change(slide) : slide));
}

/** Swap the slide carrying `slideId` with its neighbour; clamp at the ends. */
function moveSlideById(
	slides: Slide[],
	slideId: string,
	direction: -1 | 1,
): Slide[] {
	const index = slides.findIndex((slide) => slide.id === slideId);
	if (index === -1) return slides;
	const target = index + direction;
	if (target < 0 || target >= slides.length) return slides;
	const next = [...slides];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}

/**
 * Lift the slide carrying `slideId` out of the list and drop it back at
 * `toIndex` (clamped into range). Drag-to-reorder's many-position move, where
 * `move-slide`'s single neighbour swap is the keyboard/button equivalent. The
 * moved slide is addressed by stable id (CRDT-safe); only the landing position
 * is an index, which is unavoidable for an explicit "put it here" gesture.
 */
function reorderSlideById(
	slides: Slide[],
	slideId: string,
	toIndex: number,
): Slide[] {
	const fromIndex = slides.findIndex((slide) => slide.id === slideId);
	if (fromIndex === -1) return slides;
	const target = Math.max(0, Math.min(toIndex, slides.length - 1));
	if (fromIndex === target) return slides;
	const next = [...slides];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(target, 0, moved);
	return next;
}

/**
 * Apply one {@link EditorOperation} to a document, returning the next document.
 * Pure (no `set`/`get`, no mutation of the input) so it is trivially testable
 * and is the single function a CRDT binding swaps. Invariants that must hold on
 * every replica live here, not in the UI: a slide list never empties, and
 * choice-style slides keep at least two options.
 */
export function applyEditorOperation(
	document: EditorDocument,
	operation: EditorOperation,
): EditorDocument {
	switch (operation.type) {
		case "set-meta":
			return { ...document, ...operation.changes };

		// REQ080 — one field of the deck's own theme. Its own variant rather than a
		// `set-meta` carrying a whole brand: the five fields are one theme authored
		// five controls at a time, so what a CRDT binding has to see is "the accent
		// moved", not "the brand was replaced by this copy of it" — which is how two
		// organizers picking different colours at once lose one of them.
		case "set-brand":
			return {
				...document,
				themeBrand: { ...document.themeBrand, ...operation.changes },
			};

		// REQ018 — the deck's reveal mode, applied to every question slide in one
		// operation. Its own variant rather than a `set-meta` that happens to
		// touch the slides: `set-meta` is by definition the half of the document
		// that is not the slide list, and a CRDT binding intercepting these has to
		// see "the whole deck was made uniform" as the single intent it was,
		// rather than as a meta write racing a slide rewrite.
		case "apply-results-visibility":
			return {
				...document,
				resultsVisibility: operation.resultsVisibility,
				slides: withInheritedResultsVisibility(document.slides),
			};

		case "add-slide":
			return { ...document, slides: [...document.slides, operation.slide] };

		case "update-slide":
			return {
				...document,
				slides: mapSlide(document.slides, operation.slideId, (slide) => ({
					...slide,
					...operation.changes,
				})),
			};

		case "remove-slide":
			// The editor always holds at least one slide.
			if (document.slides.length <= 1) return document;
			return {
				...document,
				slides: document.slides.filter(
					(slide) => slide.id !== operation.slideId,
				),
			};

		case "move-slide":
			return {
				...document,
				slides: moveSlideById(
					document.slides,
					operation.slideId,
					operation.direction,
				),
			};

		case "reorder-slide":
			return {
				...document,
				slides: reorderSlideById(
					document.slides,
					operation.slideId,
					operation.toIndex,
				),
			};

		case "add-option":
			return {
				...document,
				slides: mapSlide(document.slides, operation.slideId, (slide) =>
					slide.options
						? { ...slide, options: [...slide.options, operation.option] }
						: slide,
				),
			};

		case "update-option":
			return {
				...document,
				slides: mapSlide(document.slides, operation.slideId, (slide) =>
					slide.options
						? {
								...slide,
								options: slide.options.map((option) =>
									option.id === operation.optionId
										? { ...option, ...operation.changes }
										: option,
								),
							}
						: slide,
				),
			};

		case "remove-option":
			return {
				...document,
				slides: mapSlide(document.slides, operation.slideId, (slide) => {
					// Choice-style slides keep at least two options.
					if (!slide.options || slide.options.length <= 2) return slide;
					return {
						...slide,
						options: slide.options.filter(
							(option) => option.id !== operation.optionId,
						),
					};
				}),
			};
	}
}
