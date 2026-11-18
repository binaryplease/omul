// The deck-settings panel in the editor (`DeckSettings` in src/pages/CreatePage.tsx): the deck's audience language, pace and repeat passes, results visibility and the apply-to-every-slide control, the profanity filter, the Q&A layer, the audience channels and the participants — REQ248 slice 7. Its Theme, Your own theme and Logo groups are `deckTheme` (slice 6), and its header is `editor`'s.
// Each language in the two language pickers is named in itself, as a speaker
// of it looks for it, and so is not translated.

import type { PluralText } from "./index";

export const en = {
	eyebrow: "Deck",

	languageTitle: "Language",
	languageDescription: "Participant-facing UI strings are shown in this language.",
	audienceLanguage: "Audience language",

	paceTitle: "Pace",
	paceDescription: "Who advances the slides during the presentation.",
	pacePickerName: "Presentation pace",
	pacePresenter: "Presenter pace",
	pacePresenterDescription: "You control the slide. Participants follow along.",
	paceAudience: "Audience pace",
	paceAudienceDescription:
		"Participants navigate on their own. Great for async surveys. Adds the option to let a device answer more than once.",
	repeatPasses: "Let a device answer more than once",
	repeatPassesDescription:
		"Once a participant reaches the last slide they can go through the deck again. Each pass is kept as its own set of answers rather than replacing the last, and counts as its own respondent in the results and both exports.",

	visibilityTitle: "Results visibility",
	visibilityDescription:
		"When aggregated results reach the audience. Any slide can override this from its own settings.",
	visibilityPickerName: "Results visibility",
	applyToAll: "Apply to every question slide",
	applyNothingToClear:
		"Every question slide already follows this setting — there is no per-slide override left to clear.",
	/** `{mode}` is the deck's reveal mode, as its choice is labelled. */
	applyTitle: {
		one: "Clear the results-visibility override on {count} slide so the whole deck follows “{mode}”.",
		other:
			"Clear the results-visibility override on {count} slides so the whole deck follows “{mode}”.",
	} as PluralText,
	allFollow: "Every question slide follows this setting.",
	overrides: {
		one: "{count} slide overrides it. Applying clears those overrides — including any that were withholding a Pin on Image target area until you reveal it.",
		other:
			"{count} slides override it. Applying clears those overrides — including any that were withholding a Pin on Image target area until you reveal it.",
	} as PluralText,

	profanityTitle: "Profanity filter",
	profanityDescription:
		"Keep offensive free-text answers off the shared screen and every phone.",
	profanityToggle: "Withhold answers containing profanity",
	profanityToggleDescription:
		"A word-cloud, open-ended or typed quiz answer containing a word on the list is kept off the wall and counted instead. It is still recorded and scored — you read it, marked as filtered, on the results page and in both exports.",
	wordList: "Word list",
	wordListHint:
		"Whole words only, ignoring case and accents. Follows the audience language unless you pick one.",
	wordListOff:
		"Not in use while the filter is off — switch it on above to choose a list.",
	wordListPickerName: "Profanity filter word list",
	/** `{language}` is the audience language, named in itself. */
	wordListSameAsAudience: "Same as the audience language ({language})",
	filterOff: "Off — every answer reaches the wall exactly as it was typed.",
	/** `{language}` is the list's language, named in itself. */
	filterOn: "On — answers are held against the word list for {language}.",

	qaTitle: "Q&A",
	qaDescription:
		"Let the audience ask questions from any slide, not only from a Q&A slide.",
	qaToggle: "Questions from the audience",
	qaToggleDescription: "Questions can be asked at any point during the presentation.",
	qaVisibilityPickerName: "Who sees the submitted questions",
	qaPresenter: "Only the presenter",
	qaPresenterDescription:
		"Questions arrive in your moderation panel. Participants see only what they asked themselves.",
	qaEveryone: "Everyone",
	qaEveryoneDescription:
		"The whole room reads the list and upvotes it, which is what orders your queue.",

	channelsTitle: "Audience channels",
	channelsDescription: "What the room can send besides answers to your questions.",
	reactions: "Reactions",
	reactionsDescription:
		"Participants can react to any slide, whatever its type. Reactions are shown live and never stored — counted in no tally, and in no export.",
	chat: "Live chat",
	chatDescription:
		"A channel the room talks in during the session, separate from the Q&A queue and from slide answers. Messages are kept with the session and cleared when you reset it.",

	participantsTitle: "Participants",
	participantsDescription:
		"Whether the people joining this deck say who they are, and whether they must be signed in.",
	askName: "Ask for a name on joining",
	askNameDescription:
		"Everyone joining states a name before their first slide. The name is stored with their answers, listed on your participants panel while you present, and carried into both exports. Names are cleared when you reset the session, and a deck that never asks collects none.",
	requireSignIn: "Require participants to sign in",
	requireSignInDescription:
		"Only people signed in to an account can join and answer. Anyone else is asked to sign in first and comes back to this deck afterwards. Each participant's answers are tied to the account they signed in with.",
};

export const de: Partial<typeof en> = {
	eyebrow: "Präsentation",

	languageTitle: "Sprache",
	languageDescription:
		"In dieser Sprache sieht das Publikum die Texte auf seinen Bildschirmen.",
	audienceLanguage: "Sprache des Publikums",

	paceTitle: "Tempo",
	paceDescription: "Wer während der Präsentation die Folien weiterschaltet.",
	pacePickerName: "Tempo der Präsentation",
	pacePresenter: "Tempo der Vortragenden",
	pacePresenterDescription: "Du steuerst die Folie. Teilnehmende folgen.",
	paceAudience: "Tempo des Publikums",
	paceAudienceDescription:
		"Teilnehmende gehen selbst durch die Folien. Gut für Umfragen ohne Live-Termin. Bietet die Option, ein Gerät mehr als einmal antworten zu lassen.",
	repeatPasses: "Ein Gerät mehr als einmal antworten lassen",
	repeatPassesDescription:
		"Wer die letzte Folie erreicht hat, kann die Präsentation noch einmal durchgehen. Jeder Durchgang wird als eigener Satz Antworten gespeichert, statt den letzten zu ersetzen, und zählt in den Ergebnissen und in beiden Exporten als eigene Person.",

	visibilityTitle: "Sichtbarkeit der Ergebnisse",
	visibilityDescription:
		"Wann das Publikum die zusammengefassten Ergebnisse sieht. Jede Folie kann das in ihren eigenen Einstellungen abweichend festlegen.",
	visibilityPickerName: "Sichtbarkeit der Ergebnisse",
	applyToAll: "Für jede Fragefolie übernehmen",
	applyNothingToClear:
		"Jede Fragefolie folgt dieser Einstellung schon — es gibt keine abweichende Folie, die zurückzusetzen wäre.",
	applyTitle: {
		one: "Die abweichende Sichtbarkeit auf {count} Folie zurücksetzen, damit die ganze Präsentation „{mode}“ folgt.",
		other:
			"Die abweichende Sichtbarkeit auf {count} Folien zurücksetzen, damit die ganze Präsentation „{mode}“ folgt.",
	},
	allFollow: "Jede Fragefolie folgt dieser Einstellung.",
	overrides: {
		one: "{count} Folie weicht davon ab. Übernehmen setzt diese Abweichungen zurück — auch solche, die bei „Markierung im Bild“ den Zielbereich bis zum Aufdecken zurückhalten.",
		other:
			"{count} Folien weichen davon ab. Übernehmen setzt diese Abweichungen zurück — auch solche, die bei „Markierung im Bild“ den Zielbereich bis zum Aufdecken zurückhalten.",
	},

	profanityTitle: "Schimpfwortfilter",
	profanityDescription:
		"Hält beleidigende Freitextantworten vom geteilten Bildschirm und von jedem Handy fern.",
	profanityToggle: "Antworten mit Schimpfwörtern zurückhalten",
	profanityToggleDescription:
		"Eine Antwort in einer Wortwolke, einer offenen Frage oder einer getippten Quizfrage, die ein Wort von der Liste enthält, bleibt von der Wand fern und wird stattdessen gezählt. Sie wird trotzdem gespeichert und gewertet — du liest sie, als gefiltert markiert, auf der Ergebnisseite und in beiden Exporten.",
	wordList: "Wortliste",
	wordListHint:
		"Nur ganze Wörter, ohne Rücksicht auf Groß- und Kleinschreibung oder Akzente. Folgt der Sprache des Publikums, wenn du keine wählst.",
	wordListOff:
		"Nicht in Gebrauch, solange der Filter aus ist — schalte ihn oben ein, um eine Liste zu wählen.",
	wordListPickerName: "Wortliste des Schimpfwortfilters",
	wordListSameAsAudience: "Wie die Sprache des Publikums ({language})",
	filterOff: "Aus — jede Antwort erscheint genau so an der Wand, wie sie getippt wurde.",
	filterOn: "An — Antworten werden mit der Wortliste für {language} abgeglichen.",

	qaTitle: "Fragen",
	qaDescription:
		"Lass das Publikum auf jeder Folie Fragen stellen, nicht nur auf einer Fragen-Folie.",
	qaToggle: "Fragen aus dem Publikum",
	qaToggleDescription: "Fragen können jederzeit während der Präsentation gestellt werden.",
	qaVisibilityPickerName: "Wer die gestellten Fragen sieht",
	qaPresenter: "Nur die Vortragenden",
	qaPresenterDescription:
		"Fragen landen in deinem Moderationsbereich. Teilnehmende sehen nur, was sie selbst gefragt haben.",
	qaEveryone: "Alle",
	qaEveryoneDescription:
		"Der ganze Raum liest die Liste und unterstützt Fragen — danach ordnet sich deine Warteschlange.",

	channelsTitle: "Kanäle des Publikums",
	channelsDescription: "Was der Raum außer Antworten auf deine Fragen senden kann.",
	reactions: "Reaktionen",
	reactionsDescription:
		"Teilnehmende können auf jede Folie reagieren, egal welcher Art. Reaktionen werden live gezeigt und nie gespeichert — sie zählen in keinem Ergebnis und in keinem Export.",
	chat: "Live-Chat",
	chatDescription:
		"Ein Kanal, in dem sich der Raum während der Sitzung unterhält, getrennt von der Fragen-Warteschlange und von den Antworten auf Folien. Nachrichten bleiben bei der Sitzung und werden gelöscht, wenn du sie zurücksetzt.",

	participantsTitle: "Teilnehmende",
	participantsDescription:
		"Ob die Leute, die dieser Präsentation beitreten, sagen, wer sie sind, und ob sie angemeldet sein müssen.",
	askName: "Beim Beitreten nach einem Namen fragen",
	askNameDescription:
		"Alle, die beitreten, nennen vor ihrer ersten Folie einen Namen. Der Name wird mit ihren Antworten gespeichert, beim Präsentieren in deinem Bereich für Teilnehmende gezeigt und in beide Exporte übernommen. Namen werden gelöscht, wenn du die Sitzung zurücksetzt, und eine Präsentation, die nie fragt, sammelt keine.",
	requireSignIn: "Anmeldung der Teilnehmenden verlangen",
	requireSignInDescription:
		"Nur Personen, die mit einem Konto angemeldet sind, können beitreten und antworten. Alle anderen werden zuerst zur Anmeldung gebeten und kommen danach zu dieser Präsentation zurück. Die Antworten jeder Person sind mit dem Konto verknüpft, mit dem sie sich angemeldet hat.",
};
