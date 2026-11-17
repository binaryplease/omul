// The editor's frame (src/pages/CreatePage.tsx at /create and /edit/<id>): its top bar, the save refusals and toasts, the slide rail and its thumbnails, the slide-type menu, the bulk-selection bar and the presenter-notes strip — REQ248 slice 4.
// The per-slide form, the canvas and the deck-settings panel are other slices'
// (2b, 2c) and read their own sections.

import { SLIDE_TYPE_LABELS, type SlideType } from "../types";
import type { PluralText } from "./index";

export const en = {
	pageTitleCreate: "Create Presentation",
	pageTitleEdit: "Edit Presentation",

	// The top bar.
	titlePlaceholder: "Untitled presentation",
	titleName: "Presentation title",
	cancel: "Cancel",
	create: "Create",
	creating: "Creating…",
	saveChanges: "Save Changes",
	saving: "Saving…",

	// Toasts.
	presentationUpdated: "Presentation updated",
	presentationUpdatedMerged:
		"Presentation updated, together with the changes someone else saved meanwhile",

	// Why a save did not happen, in the bar's error line.
	saveRaced:
		"Not saved: this deck kept being saved by someone else while yours was on its way. Your edits, combined with theirs, are still here — save again.",
	saveOverlapCancelled:
		"Not saved: someone else saved this deck after you opened it, and you both changed the same things. Your edits are still here — save again to choose.",
	titleRequired: "Title is required",
	/** `{count}` is the deck's size, `{limit}` the most a deck may hold. */
	deckOverLimit:
		"This deck holds {count} slides; a deck can hold at most {limit}.",
	/**
	 * A field a save would be refused for (`slideWriteRefusalFor`). `{number}`
	 * is the slide's place, `{field}` the field's path, `{maximum}` its ceiling.
	 */
	writeRefusalCharacters: "Slide {number}, {field}: at most {maximum} characters.",
	writeRefusalItems: "Slide {number}, {field}: at most {maximum} entries.",
	writeRefusalInvalid: "Slide {number}, {field}: this value cannot be saved.",
	/** Stands in for `{field}` when the refusal is of the slide as a whole. */
	writeRefusalWholeSlide: "this slide",
	/** A save refusal, naming the slide by its rail number; `{reason}` is one below. */
	saveRefusalOnSlide: "Slide {number}: {reason}",
	questionRequired: "Slides that collect answers need a question",
	imageUrlRequired: "Image slides need an image URL",
	videoUrlRequired: "Video slides need a video URL",
	videoUnplayable: "That video link can't be played — use an http(s) address",
	embedUrlRequired: "Embed slides need a deck or board URL",
	embedUnusable:
		"That link can't be embedded — use an https Google Slides, PowerPoint or Miro address",
	optionTextRequired: "All options need text",
	rankingItemTextRequired: "All ranking items need text",
	pointsItemsTooFew: "100 Points slides need at least two items",
	pointsItemTextRequired: "All 100 Points items need text",
	guessRangeInverted:
		"A Guess the Number slide needs a highest value above its lowest",
	guessStepInvalid: "The step must be at least 1 and no wider than the range",
	guessReferenceUnreachable:
		"The correct answer is out of reach — no selectable value falls inside its tolerance",
	formFieldRequired: "Form slides need at least one field",
	formFieldLabelRequired: "All form fields need a label",
	choiceFieldOptionRequired: "Choice fields need at least one option with text",
	pinImageRequired: "Pin on Image slides need an image URL",
	pinAreaOffImage:
		"The correct area runs off the image — keep it inside the picture",
	gridItemTextRequired: "All grid items need text",
	gridAxisTitleRequired: "Both grid axes need a title",
	gridAxisRangeInverted: "Each grid axis needs a low value below its high value",

	// The rail.
	/** The rail's row for the deck's own settings, and the column's name while it is open. */
	presentationSettings: "Presentation settings",
	/** The column's name while it holds a slide's form. */
	slideSettings: "Slide settings",
	slides: "Slides",
	addSlide: "Add slide",
	closeSlideTypes: "Close",
	noEmbedLink: "No embed link",
	/** How many accessibility findings a slide carries, as the rail and the strip say it. */
	accessibilityFindingCount: {
		one: "{count} accessibility finding",
		other: "{count} accessibility findings",
	} as PluralText,
	/** Each slide type's name in the slide-type menu and the rail's tooltips. */
	slideTypeNames: SLIDE_TYPE_LABELS as Record<SlideType, string>,
	/** One line under each name in the slide-type menu. */
	slideTypeHints: {
		"multiple-choice": "Vote on preset options",
		"word-cloud": "Crowd words into a live cloud",
		"open-text": "Collect open responses & questions",
		scale: "Rate statements on a numeric scale",
		ranking: "Put options in order of priority",
		grid: "Place items along two dimensions",
		points: "Split 100 points across the options",
		"guess-number": "Estimate a number within a range",
		"pin-image": "Mark a spot on your image",
		quiz: "Scored question against the clock",
		form: "Collect several answers in one submission",
		leaderboard: "Top scores across the deck's quiz questions",
		text: "A heading with body copy",
		image: "Show an image with a caption",
		video: "Play a video from a link",
		embed: "Frame a PowerPoint, Google Slides or Miro link",
		instruction: "Join code & QR for the audience",
		countdown: "A clock counting down a set length",
	} as Record<SlideType, string>,

	// The bulk-selection bar (REQ127). `{slides}` is `slideCount`, or
	// `selectedSlides` before anything is ticked.
	slideCount: { one: "{count} slide", other: "{count} slides" } as PluralText,
	selectedSlides: "selected slides",
	selectSlidesFirst: "Select slides first",
	selectAllSlides: "Select all slides",
	clearSelection: "Clear selection",
	select: "Select",
	selectedCount: "{count} selected",
	moveUp: "Move {slides} up",
	alreadyAtTop: "Already at the top",
	moveDown: "Move {slides} down",
	alreadyAtBottom: "Already at the bottom",
	skip: "Skip {slides}",
	skipStepOver: "Skip {slides} — Next and Previous step over them",
	/** `{skipped}` is how many of the selection are skipped already. */
	skipAllSomeSkipped: "Skip all {slides} — {skipped} already skipped",
	includeAgain: "Include {slides} again",
	copy: "Copy {slides}",
	copyAfterLast: "Copy {slides} — the copies follow the last one",
	/** `{limit}` is the most slides a deck may hold. */
	slideLimitReached: "A presentation holds at most {limit} slides",
	delete: "Delete {slides}",
	slideRemovalFloor: "A presentation needs at least one slide",
	deleteConfirmTitle: "Delete {slides}?",
	deleteConfirmMessage: {
		one: "The {count} slide you selected leaves the deck. Nothing is stored until you save, and there is no undo.",
		other:
			"The {count} slides you selected leave the deck. Nothing is stored until you save, and there is no undo.",
	} as PluralText,
	/** `{number}` is the slide's position in the deck. */
	selectSlide: "Select slide {number}",
	selectSlideTitle:
		"Select this slide — or Ctrl- or Cmd-click it; Shift-click selects a range",

	// The presenter-notes strip under the canvas (REQ156).
	notesInvitation: "Add presenter notes…",
	notesAddName: "Add presenter notes for this slide",
	notesEditName: "Edit presenter notes for this slide",
	notesHeading: "Presenter notes",
	/** The marker beside the strip: the notes are read by nobody else. */
	notesPrivacy: "Only you",
	notesPlaceholder: "Cues, timings, the number you never remember…",
	notesFieldName: "Presenter notes for this slide",
	notesDone: "Done",
	/** What authored text may be written in, under the notes and the slide's body text. */
	markdownHint:
		"Heading and body take simple markdown: **bold**, *italic*, `code`, # sub-headings, and - or 1. lists. Links are written [like this](https://example.com) — or just paste an address starting with https://. They open in a new tab. Math is TeX between dollar signs: $x^2$ within a line, $$x^2$$ on a line of its own, and \\$ for a plain dollar sign. A passage in another language is written [like this]{lang=fr}, so a screen reader pronounces it in that language.",

	// The comments strip under the canvas (`SlideCommentStrip`, REQ074); the
	// thread it opens is the panels section's.
	commentStripShow: "Show comments on this slide",
	commentStripHide: "Hide comments on this slide",
	commentStripOpen: "Comments on this slide",
	commentStripEmpty: "No comments on this slide yet",
	commentStripCount: { one: "{count} comment", other: "{count} comments" } as PluralText,
	commentStripAudience: "Only the accounts this deck is shared with",
};

export const de: Partial<typeof en> = {
	pageTitleCreate: "Präsentation erstellen",
	pageTitleEdit: "Präsentation bearbeiten",

	titlePlaceholder: "Ohne Titel",
	titleName: "Titel der Präsentation",
	cancel: "Abbrechen",
	create: "Erstellen",
	creating: "Erstellen…",
	saveChanges: "Speichern",
	saving: "Speichern…",

	presentationUpdated: "Präsentation gespeichert",
	presentationUpdatedMerged:
		"Präsentation gespeichert, zusammen mit den Änderungen, die jemand anderes inzwischen gespeichert hat",

	saveRaced:
		"Nicht gespeichert: Jemand anderes hat diese Präsentation immer wieder gespeichert, während deine Änderungen unterwegs waren. Deine Änderungen sind, mit den anderen zusammengeführt, noch da — speichere noch einmal.",
	saveOverlapCancelled:
		"Nicht gespeichert: Jemand anderes hat diese Präsentation gespeichert, nachdem du sie geöffnet hast, und ihr habt beide dieselben Dinge geändert. Deine Änderungen sind noch da — speichere noch einmal, um zu wählen.",
	titleRequired: "Ein Titel ist erforderlich",
	deckOverLimit:
		"Diese Präsentation hat {count} Folien; eine Präsentation kann höchstens {limit} haben.",
	writeRefusalCharacters: "Folie {number}, {field}: höchstens {maximum} Zeichen.",
	writeRefusalItems: "Folie {number}, {field}: höchstens {maximum} Einträge.",
	writeRefusalInvalid:
		"Folie {number}, {field}: Dieser Wert lässt sich nicht speichern.",
	writeRefusalWholeSlide: "diese Folie",
	saveRefusalOnSlide: "Folie {number}: {reason}",
	questionRequired: "Folien, die Antworten sammeln, brauchen eine Frage",
	imageUrlRequired: "Bildfolien brauchen eine Bild-URL",
	videoUrlRequired: "Videofolien brauchen eine Video-URL",
	videoUnplayable:
		"Dieser Videolink lässt sich nicht abspielen — nutze eine http(s)-Adresse",
	embedUrlRequired:
		"Eingebettete Folien brauchen die URL einer Präsentation oder eines Boards",
	embedUnusable:
		"Dieser Link lässt sich nicht einbetten — nutze eine https-Adresse von Google Slides, PowerPoint oder Miro",
	optionTextRequired: "Jede Option braucht einen Text",
	rankingItemTextRequired: "Jedes Element der Rangfolge braucht einen Text",
	pointsItemsTooFew: "100-Punkte-Folien brauchen mindestens zwei Elemente",
	pointsItemTextRequired: "Jedes Element einer 100-Punkte-Folie braucht einen Text",
	guessRangeInverted:
		"Eine „Zahl schätzen“-Folie braucht einen Höchstwert über ihrem Mindestwert",
	guessStepInvalid:
		"Die Schrittweite muss mindestens 1 sein und darf nicht größer als der Bereich sein",
	guessReferenceUnreachable:
		"Die richtige Antwort ist nicht erreichbar — kein auswählbarer Wert liegt innerhalb ihrer Toleranz",
	formFieldRequired: "Formularfolien brauchen mindestens ein Feld",
	formFieldLabelRequired: "Jedes Formularfeld braucht eine Beschriftung",
	choiceFieldOptionRequired:
		"Auswahlfelder brauchen mindestens eine Option mit Text",
	pinImageRequired: "„Markierung im Bild“-Folien brauchen eine Bild-URL",
	pinAreaOffImage:
		"Der richtige Bereich ragt über das Bild hinaus — halte ihn innerhalb des Bildes",
	gridItemTextRequired: "Jedes Element im Raster braucht einen Text",
	gridAxisTitleRequired: "Beide Achsen des Rasters brauchen einen Titel",
	gridAxisRangeInverted:
		"Jede Achse des Rasters braucht einen unteren Wert unter ihrem oberen",

	presentationSettings: "Präsentationseinstellungen",
	slideSettings: "Folieneinstellungen",
	slides: "Folien",
	addSlide: "Folie hinzufügen",
	closeSlideTypes: "Schließen",
	noEmbedLink: "Kein Link zum Einbetten",
	accessibilityFindingCount: {
		one: "{count} Hinweis zur Barrierefreiheit",
		other: "{count} Hinweise zur Barrierefreiheit",
	},
	slideTypeNames: {
		"multiple-choice": "Multiple Choice",
		"word-cloud": "Wortwolke",
		"open-text": "Offener Text / Fragen",
		scale: "Skala / Bewertung",
		ranking: "Rangfolge",
		grid: "2x2-Raster",
		points: "100 Punkte",
		"guess-number": "Zahl schätzen",
		"pin-image": "Markierung im Bild",
		quiz: "Quiz",
		form: "Formular",
		leaderboard: "Bestenliste",
		text: "Text",
		image: "Bild",
		video: "Video",
		embed: "Eingebettete Präsentation",
		instruction: "So machst du mit",
		countdown: "Countdown",
	},
	slideTypeHints: {
		"multiple-choice": "Über vorgegebene Optionen abstimmen",
		"word-cloud": "Wörter zu einer Live-Wolke sammeln",
		"open-text": "Offene Antworten und Fragen sammeln",
		scale: "Aussagen auf einer Zahlenskala bewerten",
		ranking: "Optionen nach Priorität ordnen",
		grid: "Elemente entlang zweier Dimensionen einordnen",
		points: "100 Punkte auf die Optionen verteilen",
		"guess-number": "Eine Zahl innerhalb eines Bereichs schätzen",
		"pin-image": "Eine Stelle auf deinem Bild markieren",
		quiz: "Gewertete Frage gegen die Zeit",
		form: "Mehrere Antworten in einer Einsendung sammeln",
		leaderboard: "Die besten Punktzahlen aus den Quizfragen der Präsentation",
		text: "Eine Überschrift mit Fließtext",
		image: "Ein Bild mit Bildunterschrift zeigen",
		video: "Ein Video über einen Link abspielen",
		embed: "Einen Link zu PowerPoint, Google Slides oder Miro einbetten",
		instruction: "Code zum Mitmachen und QR-Code für das Publikum",
		countdown: "Eine Uhr, die eine festgelegte Zeit herunterzählt",
	},

	slideCount: { one: "{count} Folie", other: "{count} Folien" },
	selectedSlides: "ausgewählte Folien",
	selectSlidesFirst: "Wähle zuerst Folien aus",
	selectAllSlides: "Alle Folien auswählen",
	clearSelection: "Auswahl aufheben",
	select: "Alle",
	selectedCount: "{count} ausgewählt",
	moveUp: "{slides} nach oben verschieben",
	alreadyAtTop: "Schon ganz oben",
	moveDown: "{slides} nach unten verschieben",
	alreadyAtBottom: "Schon ganz unten",
	skip: "{slides} überspringen",
	skipStepOver: "{slides} überspringen — Weiter und Zurück überspringen sie",
	skipAllSomeSkipped:
		"Alle {slides} überspringen — {skipped} schon übersprungen",
	includeAgain: "{slides} wieder aufnehmen",
	copy: "{slides} kopieren",
	copyAfterLast: "{slides} kopieren — die Kopien folgen auf die letzte",
	slideLimitReached: "Eine Präsentation hat höchstens {limit} Folien",
	delete: "{slides} löschen",
	slideRemovalFloor: "Eine Präsentation braucht mindestens eine Folie",
	deleteConfirmTitle: "{slides} löschen?",
	deleteConfirmMessage: {
		one: "Die ausgewählte Folie wird aus der Präsentation entfernt. Gespeichert wird erst, wenn du speicherst, und rückgängig machen lässt es sich nicht.",
		other:
			"Die {count} ausgewählten Folien werden aus der Präsentation entfernt. Gespeichert wird erst, wenn du speicherst, und rückgängig machen lässt es sich nicht.",
	},
	selectSlide: "Folie {number} auswählen",
	selectSlideTitle:
		"Diese Folie auswählen — oder mit Strg- oder Cmd-Klick; Umschalt-Klick wählt einen Bereich aus",

	notesInvitation: "Notizen hinzufügen…",
	notesAddName: "Notizen für diese Folie hinzufügen",
	notesEditName: "Notizen für diese Folie bearbeiten",
	notesHeading: "Notizen",
	notesPrivacy: "Nur für dich",
	notesPlaceholder: "Stichworte, Zeiten, die Zahl, die du nie im Kopf hast…",
	notesFieldName: "Notizen für diese Folie",
	notesDone: "Fertig",
	markdownHint:
		"Überschrift und Text verstehen einfaches Markdown: **fett**, *kursiv*, `Code`, # Zwischenüberschriften und - oder 1. für Listen. Links schreibst du [so](https://example.com) — oder füge einfach eine Adresse ein, die mit https:// beginnt. Sie öffnen sich in einem neuen Tab. Mathematik ist TeX zwischen Dollarzeichen: $x^2$ innerhalb einer Zeile, $$x^2$$ in einer eigenen Zeile und \\$ für ein einfaches Dollarzeichen. Eine Passage in einer anderen Sprache schreibst du [so]{lang=fr}, damit ein Screenreader sie in dieser Sprache ausspricht.",

	commentStripShow: "Kommentare zu dieser Folie anzeigen",
	commentStripHide: "Kommentare zu dieser Folie ausblenden",
	commentStripOpen: "Kommentare zu dieser Folie",
	commentStripEmpty: "Noch keine Kommentare zu dieser Folie",
	commentStripCount: { one: "{count} Kommentar", other: "{count} Kommentare" },
	commentStripAudience: "Nur Konten mit Zugriff",
};
