// The editor's canvas (src/components/SlideCanvas.tsx, SlidePreview.tsx, the fields written on the slide in SlideCanvasFields.tsx, and the stand-in room of SampleTally.ts): its own chrome and every note it adds for the author — REQ248 slice 6.
// What the slide says to the room is drawn from the deck's `Dict` (REQ084), not
// from here. The stand-in room's own words (`sampleWords` and the rest) are the
// one exception: they are read in the deck's language where that is an
// interface language and in English where it is not, the way the slide image's
// presenter line is (`slideImageWording`).

export const en = {
	// The canvas's caption and its two views (REQ152, REQ154).
	/** The screen the canvas is a picture of, as the presenter screen's group names it. */
	sharedScreen: "Shared screen",
	/** `{screen}` is `sharedScreen`, `{number}` the slide's position, `{total}` the deck's size. */
	stageCaption: "{screen} · Slide {number} of {total}",
	themeNote: "Drawn in the deck's own theme — the editor around it is not.",
	viewName: "What the stage draws — the question or its results",
	viewQuestion: "Question",
	viewResults: "Results",
	noResults: "This slide collects nothing, so it has no results to draw.",

	// The fields written on the slide (REQ153).
	/** What the slide's first authored string is called, per kind of slide. */
	heading: "Heading",
	caption: "Caption",
	question: "Question",
	/** The field's accessible name: `{label}` as above, `{labelLower}` in lower case. */
	fieldName: "Slide {labelLower}",
	optionalHeading: "Optional heading",
	optionalCaption: "Optional caption",
	typeQuestion: "Type your question…",
	/** What a question's heading shows, read-only, while nothing is written. */
	untitledQuestion: "Untitled question",
	/** `{number}` is the option's position, one-based. */
	option: "Option {number}",
	optionMarked: "Option {number} is marked correct",
	markOption: "Mark option {number} correct",
	/** The tool's tooltip: `{state}` is `markedCorrect` or `markAsCorrect`, `{hint}` what it does. */
	correctToolTitle: "{state} — {hint}",
	markedCorrect: "Marked correct",
	markAsCorrect: "Mark as correct answer",
	correctHintQuiz:
		"Participants who pick it score automatically, and the sooner they do the more it is worth.",
	correctHintChoice: "The solution is revealed once results are shown.",
	correct: "Correct",
	addOption: "Add option",
	removeOption: "Remove option {number}",
	removeOptionReason: "Remove option {number} — {reason}",
	/** `{count}` is the floor and the ceiling of an answer set. */
	optionFloor: "A choice slide needs at least {count} options",
	optionCeiling: "A choice slide can hold at most {count} options",

	// The notes the canvas adds under its picture of a slide.
	/** The slide's position under its heading. */
	slideNumber: "Slide {number}",
	pinEmpty: "Add an image for participants to pin on",
	pinTap: "Participants tap a spot",
	pinTapWithArea: "Participants tap a spot · correct area marked",
	correctArea: "Correct area",
	noAcceptedAnswer: "No accepted answer yet",
	/** `{answers}` are the accepted answers, joined by " · ". */
	acceptedAnswers: "Accepted: {answers}",
	item: "Item {number}",
	field: "Field {number}",
	emptyStatement: "(empty statement)",
	/** `{budget}` is the points a participant splits. */
	pointsToDistribute: "{budget} points to distribute",
	guessRange: "{min}–{max}",
	guessSteps: " in steps of {step}",
	guessCorrect: " · correct answer {value}",
	/** `{count}` is how many places the board shows. */
	leaderboardTop: "Top {count} across the deck's quiz questions",

	// The results view's stand-in room (REQ154).
	sampleNoResults: "This slide collects nothing, so there are no results to draw.",
	sampleNothingYet:
		"Nothing to chart yet — write the answers this slide offers and they appear here.",
	sampleNote:
		"Sample results — a stand-in room, so you can see how this slide draws. Nothing here is saved or sent.",
	/** What the stand-in room shouts at a word cloud, and writes into an open question. */
	sampleWords: [
		"clarity",
		"momentum",
		"focus",
		"trust",
		"speed",
		"craft",
		"ownership",
		"curiosity",
	],
	sampleResponses: [
		"The examples made it click.",
		"More time for questions next round.",
		"Best session of the day.",
		"Could we get the slides afterwards?",
		"The live demo was the highlight.",
	],
	/** The question view's few stand-in words and answers. */
	previewWords: ["idea", "creativity", "teamwork", "innovation"],
	previewResponses: ["Great session!", "Very informative"],
};

export const de: Partial<typeof en> = {
	sharedScreen: "Geteilter Bildschirm",
	stageCaption: "{screen} · Folie {number} von {total}",
	themeNote:
		"Im Design der Präsentation gezeichnet — der Editor drumherum nicht.",
	viewName: "Was die Bühne zeigt — die Frage oder ihre Ergebnisse",
	viewQuestion: "Frage",
	viewResults: "Ergebnisse",
	noResults:
		"Diese Folie sammelt nichts, also gibt es keine Ergebnisse zu zeigen.",

	heading: "Überschrift",
	caption: "Bildunterschrift",
	question: "Frage",
	fieldName: "{label} der Folie",
	optionalHeading: "Überschrift (optional)",
	optionalCaption: "Bildunterschrift (optional)",
	typeQuestion: "Schreib deine Frage…",
	untitledQuestion: "Frage ohne Titel",
	option: "Option {number}",
	optionMarked: "Option {number} ist als richtig markiert",
	markOption: "Option {number} als richtig markieren",
	correctToolTitle: "{state} — {hint}",
	markedCorrect: "Als richtig markiert",
	markAsCorrect: "Als richtige Antwort markieren",
	correctHintQuiz:
		"Wer sie wählt, punktet automatisch — und je schneller, desto mehr ist sie wert.",
	correctHintChoice: "Die Lösung wird aufgedeckt, sobald die Ergebnisse zu sehen sind.",
	correct: "Richtig",
	addOption: "Option hinzufügen",
	removeOption: "Option {number} entfernen",
	removeOptionReason: "Option {number} entfernen — {reason}",
	optionFloor: "Eine Auswahlfolie braucht mindestens {count} Optionen",
	optionCeiling: "Eine Auswahlfolie hat höchstens {count} Optionen",

	slideNumber: "Folie {number}",
	pinEmpty: "Füge ein Bild hinzu, auf dem Teilnehmende markieren",
	pinTap: "Teilnehmende tippen auf eine Stelle",
	pinTapWithArea:
		"Teilnehmende tippen auf eine Stelle · richtiger Bereich markiert",
	correctArea: "Richtiger Bereich",
	noAcceptedAnswer: "Noch keine akzeptierte Antwort",
	acceptedAnswers: "Akzeptiert: {answers}",
	item: "Element {number}",
	field: "Feld {number}",
	emptyStatement: "(leere Aussage)",
	pointsToDistribute: "{budget} Punkte zu verteilen",
	guessRange: "{min}–{max}",
	guessSteps: " in Schritten von {step}",
	guessCorrect: " · richtige Antwort {value}",
	leaderboardTop: "Die besten {count} aus den Quizfragen der Präsentation",

	sampleNoResults:
		"Diese Folie sammelt nichts, also gibt es keine Ergebnisse zu zeigen.",
	sampleNothingYet:
		"Noch nichts zu zeigen — schreib die Antworten, die diese Folie anbietet, dann erscheinen sie hier.",
	sampleNote:
		"Beispielergebnisse — ein gedachter Raum, damit du siehst, wie diese Folie aussieht. Nichts davon wird gespeichert oder gesendet.",
	sampleWords: [
		"Klarheit",
		"Schwung",
		"Fokus",
		"Vertrauen",
		"Tempo",
		"Handwerk",
		"Verantwortung",
		"Neugier",
	],
	sampleResponses: [
		"Die Beispiele haben es greifbar gemacht.",
		"Nächstes Mal mehr Zeit für Fragen.",
		"Die beste Session des Tages.",
		"Bekommen wir die Folien danach?",
		"Die Live-Demo war das Highlight.",
	],
	previewWords: ["Idee", "Kreativität", "Teamwork", "Innovation"],
	previewResponses: ["Tolle Session!", "Sehr informativ"],
};
