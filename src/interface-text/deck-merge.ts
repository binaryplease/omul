// The editor's dialog for a refused save whose edits overlap someone else's (src/components/DeckMergeDialog.tsx, REQ126) — REQ248 slice 4.

import { DECK_FIELD_LABELS, type DeckField } from "../store/deckMerge";
import type { PluralText } from "./index";

export const en = {
	title: "Someone else saved this deck",
	intro: {
		one: "Everything only one of you changed is kept. You both changed the thing below — choose which version to keep.",
		other:
			"Everything only one of you changed is kept. You both changed the things below — choose which version to keep.",
	} as PluralText,
	/** Each deck setting, as the heading of an overlap on it. */
	fieldNames: DECK_FIELD_LABELS as Record<DeckField, string>,
	slideOrder: "Slide order",
	/** `{name}` is the slide's gist, or its type. */
	slideNamed: "Slide: {name}",
	slide: "Slide",
	keepMyOrder: "Keep my order",
	keepCurrentOrder: "Keep the current order",
	keepMine: "Keep mine",
	keepCurrentOne: "Keep the current one",
	slideEdited: "Edited: {name}",
	slideDeleted: "Deleted",
	// A deck setting's value, under the version that holds it.
	valueOn: "On",
	valueOff: "Off",
	valueAutomatic: "Automatic",
	valueEmpty: "Empty",
	/** Why Save is unavailable; `{count}` is how many overlaps are undecided. */
	chooseRemaining: {
		one: "Choose a version for the change above to save.",
		other: "Choose a version for all {count} changes above to save.",
	} as PluralText,
	saving: "Saving…",
	cancel: "Cancel",
	save: "Save",
};

export const de: Partial<typeof en> = {
	title: "Jemand anderes hat diese Präsentation gespeichert",
	intro: {
		one: "Was nur auf einer Seite geändert wurde, bleibt erhalten. Das Folgende habt ihr beide geändert — wähle, welche Fassung bleibt.",
		other:
			"Was nur auf einer Seite geändert wurde, bleibt erhalten. Die folgenden Dinge habt ihr beide geändert — wähle jeweils, welche Fassung bleibt.",
	},
	fieldNames: {
		title: "Titel",
		language: "Sprache",
		mode: "Tempo",
		allowRepeatPasses: "Mehrere Durchgänge",
		resultsVisibility: "Sichtbarkeit der Ergebnisse",
		qaEnabled: "Fragen",
		qaVisibility: "Sichtbarkeit der Fragen",
		reactionsEnabled: "Reaktionen",
		chatEnabled: "Chat",
		requireParticipantName: "Nach Namen fragen",
		requireParticipantSignIn: "Anmeldung verlangen",
		profanityFilterEnabled: "Filter für Schimpfwörter",
		profanityFilterLanguage: "Sprache des Filters für Schimpfwörter",
		theme: "Design",
		themeBrand: "Farben und Schriften des Designs",
		themeLogoUrl: "Logo",
		themeLogoAlt: "Beschreibung des Logos",
	},
	slideOrder: "Reihenfolge der Folien",
	slideNamed: "Folie: {name}",
	slide: "Folie",
	keepMyOrder: "Meine Reihenfolge behalten",
	keepCurrentOrder: "Die aktuelle Reihenfolge behalten",
	keepMine: "Meine behalten",
	keepCurrentOne: "Die aktuelle behalten",
	slideEdited: "Bearbeitet: {name}",
	slideDeleted: "Gelöscht",
	valueOn: "An",
	valueOff: "Aus",
	valueAutomatic: "Automatisch",
	valueEmpty: "Leer",
	chooseRemaining: {
		one: "Wähle für die Änderung oben eine Fassung, um zu speichern.",
		other: "Wähle für alle {count} Änderungen oben eine Fassung, um zu speichern.",
	},
	saving: "Speichern…",
	cancel: "Abbrechen",
	save: "Speichern",
};
