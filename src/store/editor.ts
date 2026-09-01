// ── Editor slice: authoring state (local-first) ───────────────────────
//
// This slice owns the *authoring* domain used by the Create / Edit page: the
// presentation title, language, pace mode, and the slide list, plus every
// structural mutation over them. Unlike the session slice this state is
// **local-first** — it is the document the author is building before it is
// persisted.
//
// The slice itself does no slide/option surgery. Each action builds an
// `EditorOperation` and dispatches it through the pure reducer in
// `editorDocument.ts`; that reducer is the CRDT-ready seam (see its header).
// Two consequences shape this file:
//   • Mutations address slides and options by **stable id**, never by array
//     index — the property that lets concurrent edits merge correctly.
//   • `loadEditor` / `resetEditor` are document *lifecycle* (initial sync, new
//     draft), not collaborative edits, so they replace the document directly
//     rather than going through an operation.
//
// Ephemeral, single-component editor UI (the preview cursor, the saving flag,
// validation errors) deliberately stays in the page's local `useState` per the
// triage decision — only the document itself lives here.

import type { StoreApi } from "zustand";
import type {
	DeckBrand,
	DeckThemeId,
	PresentationMode,
	QAVisibility,
	ResultsVisibility,
	Slide,
	SlideOption,
	SlideType,
} from "../types";
import {
	CUSTOM_DECK_THEME_ID,
	deckBrandFor,
	deckThemeIdFor,
	EMPTY_DECK_BRAND,
	SLIDE_LIMIT,
	SLIDE_OPTION_LIMIT,
} from "../types";
import {
	applyEditorOperation,
	blankDocument,
	type EditorDocument,
	type EditorOperation,
	newOption,
	newSlide,
} from "./editorDocument";
import type { AppState } from "./store";

type AppSet = StoreApi<AppState>["setState"];
type AppGet = StoreApi<AppState>["getState"];

export interface EditorSlice extends EditorDocument {
	setTitle: (title: string) => void;
	setLanguage: (language: string) => void;
	setMode: (mode: PresentationMode) => void;
	setResultsVisibility: (resultsVisibility: ResultsVisibility) => void;
	/**
	 * Set the deck's reveal mode **and** apply it to every question slide in one
	 * operation (REQ018) — the per-slide overrides authored from each slide's own
	 * Visibility section are cleared, so the setting governs the whole deck
	 * rather than only the slides nobody had overridden.
	 */
	applyResultsVisibilityToDeck: (resultsVisibility: ResultsVisibility) => void;
	/** Author the Q&A layer's deck-level defaults (REQ036/REQ037). */
	setQAEnabled: (qaEnabled: boolean) => void;
	setQAVisibility: (qaVisibility: QAVisibility) => void;
	/** Author the participant channels the deck starts with (REQ077/REQ078). */
	setReactionsEnabled: (reactionsEnabled: boolean) => void;
	setChatEnabled: (chatEnabled: boolean) => void;
	/** Author whether the room states its names on joining (REQ076). */
	setRequireParticipantName: (requireParticipantName: boolean) => void;
	/** Choose the deck's theme — one of the built-in set, or its own (REQ079/REQ080). */
	setTheme: (theme: DeckThemeId) => void;
	/**
	 * Author the deck's own theme (REQ080/REQ092/REQ135) — merged field by field,
	 * because the five of them are one theme and a picker that replaced the whole
	 * brand would clear the canvas every time the accent moved.
	 */
	setThemeBrand: (changes: Partial<DeckBrand>) => void;
	/** Author the logo the participant-facing surfaces wear (REQ136). */
	setThemeLogoUrl: (themeLogoUrl: string) => void;
	setThemeLogoAlt: (themeLogoAlt: string) => void;

	/** Populate the editor from a fetched presentation (Edit mode). */
	loadEditor: (input: {
		title: string;
		slides: Slide[];
		language?: string;
		mode?: PresentationMode;
		resultsVisibility?: ResultsVisibility;
		qaEnabled?: boolean;
		qaVisibility?: QAVisibility;
		reactionsEnabled?: boolean;
		chatEnabled?: boolean;
		requireParticipantName?: boolean;
		theme?: string;
		themeBrand?: Partial<DeckBrand> | null;
		themeLogoUrl?: string;
		themeLogoAlt?: string;
	}) => void;
	/** Reset to a blank single-slide draft (Create mode). */
	resetEditor: () => void;

	addSlide: (type: SlideType) => void;
	updateSlide: (slideId: string, changes: Partial<Slide>) => void;
	removeSlide: (slideId: string) => void;
	moveSlide: (slideId: string, direction: -1 | 1) => void;
	/** Drag-to-reorder: lift a slide (by id) and drop it at an absolute index. */
	reorderSlide: (slideId: string, toIndex: number) => void;

	addOption: (slideId: string) => void;
	updateOption: (
		slideId: string,
		optionId: string,
		changes: Partial<SlideOption>,
	) => void;
	removeOption: (slideId: string, optionId: string) => void;
}

export function createEditorSlice(set: AppSet, get: AppGet): EditorSlice {
	// The single mutation path: read the current document, fold the operation
	// through the pure reducer, write the result back. A CRDT binding replaces
	// this dispatch (apply the operation to a shared Y.Doc, derive the next
	// document from it) and nothing below — nor any component — has to change.
	const dispatch = (operation: EditorOperation) => {
		const {
			title,
			language,
			mode,
			resultsVisibility,
			qaEnabled,
			qaVisibility,
			reactionsEnabled,
			chatEnabled,
			requireParticipantName,
			theme,
			themeBrand,
			themeLogoUrl,
			themeLogoAlt,
			slides,
		} = get();
		set(
			applyEditorOperation(
				{
					title,
					language,
					mode,
					resultsVisibility,
					qaEnabled,
					qaVisibility,
					reactionsEnabled,
					chatEnabled,
					requireParticipantName,
					theme,
					themeBrand,
					themeLogoUrl,
					themeLogoAlt,
					slides,
				},
				operation,
			),
		);
	};

	return {
		...blankDocument(),

		setTitle: (title) => dispatch({ type: "set-meta", changes: { title } }),
		setLanguage: (language) =>
			dispatch({ type: "set-meta", changes: { language } }),
		setMode: (mode) => dispatch({ type: "set-meta", changes: { mode } }),
		setResultsVisibility: (resultsVisibility) =>
			dispatch({ type: "set-meta", changes: { resultsVisibility } }),

		applyResultsVisibilityToDeck: (resultsVisibility) =>
			dispatch({ type: "apply-results-visibility", resultsVisibility }),
		setQAEnabled: (qaEnabled) =>
			dispatch({ type: "set-meta", changes: { qaEnabled } }),
		setQAVisibility: (qaVisibility) =>
			dispatch({ type: "set-meta", changes: { qaVisibility } }),
		setReactionsEnabled: (reactionsEnabled) =>
			dispatch({ type: "set-meta", changes: { reactionsEnabled } }),
		setChatEnabled: (chatEnabled) =>
			dispatch({ type: "set-meta", changes: { chatEnabled } }),
		setRequireParticipantName: (requireParticipantName) =>
			dispatch({ type: "set-meta", changes: { requireParticipantName } }),
		setTheme: (theme) => dispatch({ type: "set-meta", changes: { theme } }),
		setThemeBrand: (changes) => dispatch({ type: "set-brand", changes }),
		setThemeLogoUrl: (themeLogoUrl) =>
			dispatch({ type: "set-meta", changes: { themeLogoUrl } }),
		setThemeLogoAlt: (themeLogoAlt) =>
			dispatch({ type: "set-meta", changes: { themeLogoAlt } }),

		loadEditor: ({
			title,
			slides,
			language,
			mode,
			resultsVisibility,
			qaEnabled,
			qaVisibility,
			reactionsEnabled,
			chatEnabled,
			requireParticipantName,
			theme,
			themeBrand,
			themeLogoUrl,
			themeLogoAlt,
		}) =>
			set({
				title,
				slides,
				language: language ?? "en",
				mode: mode ?? "live",
				resultsVisibility: resultsVisibility ?? "instant",
				// The theme arrives as a bare string from the wire, so it lands through
				// the same resolver every render surface uses (REQ079): a deck holding a
				// palette this build does not know opens in the house theme rather than
				// putting an unrenderable id into the picker.
				theme: deckThemeIdFor({ theme }),
				// And the brand it may carry lands through the schema's own reader
				// (REQ080): a colour outside the grammar, or a face this build does not
				// ship, opens as unauthored rather than as a value the editor would
				// write straight back out.
				themeBrand:
					deckBrandFor({ theme: CUSTOM_DECK_THEME_ID, themeBrand }) ??
					EMPTY_DECK_BRAND,
				themeLogoUrl: themeLogoUrl ?? "",
				themeLogoAlt: themeLogoAlt ?? "",
				// The withholding value is what an unknown deck reads as, the same way
				// the schema defaults it (REQ037): a deck loaded from anywhere must not
				// arrive in the editor already publishing its room's questions.
				qaEnabled: qaEnabled ?? false,
				qaVisibility: qaVisibility ?? "presenter",
				// Closed is what an unknown deck reads as here too (REQ077/REQ078): a
				// deck loaded from anywhere must not arrive in the editor already
				// carrying a chat channel its author never opened.
				reactionsEnabled: reactionsEnabled ?? false,
				chatEnabled: chatEnabled ?? false,
				// And off is what an unknown deck reads as here (REQ076), for the
				// sharpest version of the same reason: an editor that opened somebody
				// else's deck with this switched on would put a question at the door of
				// a room its organizer never meant to ask.
				requireParticipantName: requireParticipantName ?? false,
			}),

		resetEditor: () => set(blankDocument()),

		addSlide: (type) => {
			// The write boundary refuses a deck past SLIDE_LIMIT (REQ159), so the
			// editor must not build one — the same stance the remove-option floor
			// takes in `editorDocument.ts`.
			if (get().slides.length >= SLIDE_LIMIT) return;
			dispatch({ type: "add-slide", slide: newSlide(type) });
		},

		updateSlide: (slideId, changes) =>
			dispatch({ type: "update-slide", slideId, changes }),

		removeSlide: (slideId) => dispatch({ type: "remove-slide", slideId }),

		moveSlide: (slideId, direction) =>
			dispatch({ type: "move-slide", slideId, direction }),

		reorderSlide: (slideId, toIndex) =>
			dispatch({ type: "reorder-slide", slideId, toIndex }),

		addOption: (slideId) => {
			const slide = get().slides.find((candidate) => candidate.id === slideId);
			if (!slide?.options) return;
			// The write boundary caps the option list (REQ159); an editor that
			// grew past it would be building a slide no save can land.
			if (slide.options.length >= SLIDE_OPTION_LIMIT) return;
			dispatch({
				type: "add-option",
				slideId,
				option: newOption(slide.type),
			});
		},

		updateOption: (slideId, optionId, changes) =>
			dispatch({ type: "update-option", slideId, optionId, changes }),

		removeOption: (slideId, optionId) =>
			dispatch({ type: "remove-option", slideId, optionId }),
	};
}
