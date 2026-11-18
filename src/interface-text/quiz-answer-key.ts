// A quiz question nobody can get right (`src/components/QuizAnswerKeyWarning.tsx`,
// REQ219): the warning on the slide's settings and its thumbnail, and the
// question the presenter screen asks before going live — REQ248 slice 5, whose
// slide settings hold the warning first.

export const en = {
	/** What is wrong with such a slide, in one line. */
	noAnswerKey: "No correct answer yet — every answer to this question scores 0.",
	/** What to do about it on a typed question, and on a select-answer one. */
	remedyTyped: "Add an accepted answer below.",
	remedySelect: "Mark the correct option on the slide.",
	/** A slide named in the go-live list: first, and after the first. */
	slideFirst: "Slide {number}",
	slideLater: "slide {number}",
	/** `{slide}` is the name above, `{question}` its question in plain text. */
	slideWithQuestion: "{slide} (“{question}”)",
	titleOne: "A quiz question has no correct answer",
	titleOther: "Some quiz questions have no correct answer",
	/** `{list}` is the slides named, joined as the language lists things. */
	messageOne:
		"{list} has no correct answer, so every answer to it scores 0. Start anyway, or cancel and mark the answers in the editor.",
	messageOther:
		"{list} have no correct answer, so every answer to them scores 0. Start anyway, or cancel and mark the answers in the editor.",
	startAnyway: "Start anyway",
};

export const de: Partial<typeof en> = {
	noAnswerKey:
		"Noch keine richtige Antwort — jede Antwort auf diese Frage bekommt 0 Punkte.",
	remedyTyped: "Füge unten eine akzeptierte Antwort hinzu.",
	remedySelect: "Markiere die richtige Option auf der Folie.",
	slideFirst: "Folie {number}",
	slideLater: "Folie {number}",
	slideWithQuestion: "{slide} („{question}“)",
	titleOne: "Eine Quizfrage hat keine richtige Antwort",
	titleOther: "Einige Quizfragen haben keine richtige Antwort",
	messageOne:
		"{list} hat keine richtige Antwort, also bekommt jede Antwort darauf 0 Punkte. Starte trotzdem, oder brich ab und markiere die Antworten im Editor.",
	messageOther:
		"{list} haben keine richtige Antwort, also bekommt jede Antwort darauf 0 Punkte. Starte trotzdem, oder brich ab und markiere die Antworten im Editor.",
	startAnyway: "Trotzdem starten",
};
