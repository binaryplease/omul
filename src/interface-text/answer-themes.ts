// Grouping a free-text slide's answers into themes, under the editor's canvas (src/components/AnswerThemes.tsx, REQ114): the strip's closed line, the open panel, its rows and headings, the delete confirmation and every reason a control is idle — REQ248 slice 7.
// The answers and the theme names are the deck's and the editor's own words,
// and are drawn as written. A refusal of a read or a write other than "this
// slide is not saved yet" is the server's own message and stays as it words it.

import type { PluralText } from "./index";

export const en = {
	/** The strip's closed line: who sees themes, and that the room does not. */
	scope: "Editors only, not shown live",
	/** What themes are for, at the top of the open panel. */
	purpose:
		"Sort this slide's answers into themes by hand, for your own analysis here in the editor. Themes are never shown live: the presenter screen, the shared screen, participants' phones and the results link show the answers without them.",
	stripShow: "Show this slide's answers grouped into themes",
	stripHide: "Hide this slide's answer themes",
	stripClosed: "Group this slide's answers into themes",
	stripOpen: "Answer themes",

	answerCount: { one: "{count} answer", other: "{count} answers" } as PluralText,
	loading: "Loading answers…",
	noAnswers:
		"Nobody has answered this slide yet. Themes can be set up ahead of the answers.",
	/** `{answers}` is the answer count, `{ungrouped}` how many are in no theme. */
	summary:
		"{answers}, {ungrouped} ungrouped. Grouping changes no answer. Answers sent since this list was read appear on refresh.",
	refresh: "Read this slide's answers and themes again",
	notSaved:
		"This slide is not saved yet, so nobody can have answered it. Save the deck to group its answers.",
	unknownError: "Unknown error",

	newThemePlaceholder: "New theme…",
	newThemeName: "Name of a new theme",
	addTheme: "Add theme",
	/** `{limit}` is the most themes a slide holds. */
	tooManyThemes: "A slide holds at most {limit} themes. Delete one to add another.",
	nameFirst: "Name the theme to add it.",

	ungrouped: "Ungrouped",
	/** `{answer}` is the answer as it was written. */
	themeFor: 'Theme for "{answer}"',
	/** `{name}` is the theme's name. */
	renameField: 'New name for the theme "{name}"',
	saveName: "Save the new name",
	keepName: "Keep the old name",
	rename: 'Rename the theme "{name}"',
	delete: 'Delete the theme "{name}" — its answers become ungrouped',
	/** `{answers}` is the answer count, as `answerCount` words it. */
	heldBack: "{answers} held back by the profanity filter, not listed here",
	themeEmpty: "No answers in this theme yet.",

	deleteTitle: "Delete this theme?",
	deleteMessage: '"{name}" goes, and its answers become ungrouped. No answer is deleted.',
	deleteConfirm: "Delete theme",
};

export const de: Partial<typeof en> = {
	scope: "Nur Bearbeitende, nie live",
	purpose:
		"Ordne die Antworten dieser Folie von Hand Themen zu, für deine eigene Auswertung hier im Editor. Themen sind nie live zu sehen: Der Bildschirm der Vortragenden, der geteilte Bildschirm, die Handys der Teilnehmenden und der Ergebnislink zeigen die Antworten ohne sie.",
	stripShow: "Die Antworten dieser Folie nach Themen gruppiert anzeigen",
	stripHide: "Die Antwortthemen dieser Folie ausblenden",
	stripClosed: "Die Antworten dieser Folie nach Themen gruppieren",
	stripOpen: "Antwortthemen",

	answerCount: { one: "{count} Antwort", other: "{count} Antworten" },
	loading: "Antworten werden geladen…",
	noAnswers:
		"Noch hat niemand diese Folie beantwortet. Themen kannst du schon vor den Antworten anlegen.",
	summary:
		"{answers}, {ungrouped} ohne Thema. Das Gruppieren ändert keine Antwort. Antworten, die seit dem Laden dieser Liste eingegangen sind, erscheinen nach dem Aktualisieren.",
	refresh: "Antworten und Themen dieser Folie neu laden",
	notSaved:
		"Diese Folie ist noch nicht gespeichert, also kann sie noch niemand beantwortet haben. Speichere die Präsentation, um ihre Antworten zu gruppieren.",
	unknownError: "Unbekannter Fehler",

	newThemePlaceholder: "Neues Thema…",
	newThemeName: "Name eines neuen Themas",
	addTheme: "Thema hinzufügen",
	tooManyThemes:
		"Eine Folie hat höchstens {limit} Themen. Lösche eines, um ein weiteres hinzuzufügen.",
	nameFirst: "Gib dem Thema einen Namen, um es hinzuzufügen.",

	ungrouped: "Ohne Thema",
	themeFor: "Thema für „{answer}“",
	renameField: "Neuer Name für das Thema „{name}“",
	saveName: "Den neuen Namen speichern",
	keepName: "Den alten Namen behalten",
	rename: "Das Thema „{name}“ umbenennen",
	delete: "Das Thema „{name}“ löschen — seine Antworten sind danach ohne Thema",
	heldBack: "{answers} vom Schimpfwortfilter zurückgehalten, hier nicht aufgeführt",
	themeEmpty: "Noch keine Antworten in diesem Thema.",

	deleteTitle: "Dieses Thema löschen?",
	deleteMessage:
		"„{name}“ wird entfernt, und seine Antworten sind danach ohne Thema. Keine Antwort wird gelöscht.",
	deleteConfirm: "Thema löschen",
};
