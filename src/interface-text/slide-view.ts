// The slide as the presenter screen draws it, and the presenter's controls on it (PresenterSlideView.tsx, Results.tsx and the result views it renders) — REQ248 slices 2 and 3.
//
// Only what the presenter reads is here. What the slide says to the room —
// "Results are private", "Waiting for responses...", a chart's captions — is
// the deck's language, read from the participant `Dict` (`src/i18n.ts`).

import type { PluralText } from "./index";

export const en = {
	revealResults: "Reveal results",
	hideResults: "Hide results",
	revealStandings: "Reveal standings",
	hideStandings: "Hide standings",
	startToCollect: "Start the presentation to collect responses",
	startToRank: "Start the presentation to rank the room",
	restartTimer: "Restart timer",
	/**
	 * The quiz timer control (REQ217, REQ226): a question waiting at go-live is
	 * started, one that has run is restarted. The confirmation is its toast.
	 */
	startTimer: "Start timer",
	startTimerHint: "Opens this question to the room — the countdown starts now",
	timerStarted: "Question timer started",
	restartTimerHint:
		"Reopens this question for participants who have not answered yet — answers already given keep their points",
	timerRestarted: "Question timer restarted",
	/** Why the timer control is dead (REQ237), as the server words it in English. */
	timerNotLive:
		"Start the presentation first — question timers run only while the deck is live",
	timerDeckEnded:
		"The presentation has ended — question timers run only while the deck is live",
	valueDisplayLabel: "Show results as counts or percentages",
	valueCount: "Count",
	valuePercent: "Percent",
	valueBoth: "Both",
	/** `{answer}` is the text being removed. */
	answerDelete:
		'Delete this answer — "{answer}" is removed from the tally the room sees and from every export',
	answerDeleteDenied:
		"Delete this answer — you cannot edit this presentation, so what the room submitted to it is not yours to remove",
	submittedAnswers: {
		one: "{count} submitted answer",
		other: "{count} submitted answers",
	} as PluralText,
	countdownNotEditor: "Only an editor of this deck can run the countdown",
	countdownFinishedLabel: "The countdown reached 0:00. Reset it to run it again",
	countdownNotLive: "Start the presentation to run the countdown",
	countdownPauseLabel: "Pause the countdown at the time left",
	countdownResumeLabel: "Resume the countdown from the time left",
	countdownStartLabel: "Start the countdown for the room",
	countdownPause: "Pause countdown",
	countdownResume: "Resume countdown",
	countdownStart: "Start countdown",
	countdownResetNotEditor: "Only an editor of this deck can reset the countdown",
	countdownResetIdle: "The countdown is already at its full length",
	countdownResetLabel: "Return the countdown to its full length",
	countdownReset: "Reset countdown",
	noBodyText: "No body text",
	noImageUrl: "No image URL set",
	noVideoUrl: "No video URL set",
	videoUnplayable: "That video URL can't be played — use an http(s) link",
	noEmbedUrl: "No embed URL set",
	embedUnusable:
		"That link can't be embedded — use a Google Slides, PowerPoint or Miro link",
	/** A video frame's accessible name when its slide has no heading. */
	videoFrameName: "Video",
	formAnswersNotShown:
		"What people wrote is not shown on screen — download the results to read it.",
	/** Each slide type's name, as the rail's icons are titled (`SlideTypeIcon`). */
	slideTypes: {
		"multiple-choice": "Multiple Choice",
		"word-cloud": "Word Cloud",
		"open-text": "Q&A",
		scale: "Scale",
		ranking: "Ranking",
		grid: "2x2 Grid",
		points: "100 Points",
		"guess-number": "Guess the Number",
		"pin-image": "Pin on Image",
		quiz: "Quiz",
		form: "Form",
		leaderboard: "Leaderboard",
		text: "Text",
		image: "Image",
		video: "Video",
		embed: "Embedded deck",
		instruction: "How to join",
		countdown: "Countdown",
	},

	// The answers the profanity filter withheld (REQ085), listed only to
	// whoever holds the deck — the count beside them is the room's.
	answerFilterShow: "Show",
	answerFilterHide: "Hide",
	answerFilterOwnerOnly:
		"Shown to you because this presentation is yours or shared with you. The room, and anyone reading it through a results link, sees only the count.",
	answerFilterBadge: "Filtered",
};

export const de: Partial<typeof en> = {
	revealResults: "Ergebnisse aufdecken",
	hideResults: "Ergebnisse ausblenden",
	revealStandings: "Bestenliste aufdecken",
	hideStandings: "Bestenliste ausblenden",
	startToCollect: "Starte die Präsentation, um Antworten zu sammeln",
	startToRank: "Starte die Präsentation, um eine Bestenliste zu erstellen",
	restartTimer: "Timer neu starten",
	startTimer: "Timer starten",
	startTimerHint: "Öffnet diese Frage für den Raum — der Countdown läuft ab jetzt",
	timerStarted: "Timer der Frage gestartet",
	restartTimerHint:
		"Öffnet diese Frage wieder für alle, die noch nicht geantwortet haben — bereits gegebene Antworten behalten ihre Punkte",
	timerRestarted: "Timer der Frage neu gestartet",
	timerNotLive:
		"Starte zuerst die Präsentation — Timer für Fragen laufen nur, solange die Präsentation live ist",
	timerDeckEnded:
		"Die Präsentation ist beendet — Timer für Fragen laufen nur, solange die Präsentation live ist",
	valueDisplayLabel: "Ergebnisse als Anzahl oder Prozent zeigen",
	valueCount: "Anzahl",
	valuePercent: "Prozent",
	valueBoth: "Beides",
	answerDelete:
		"Diese Antwort löschen — „{answer}“ verschwindet aus der Auswertung, die der Raum sieht, und aus jedem Export",
	answerDeleteDenied:
		"Diese Antwort löschen — du kannst diese Präsentation nicht bearbeiten, darum kannst du nicht entfernen, was der Raum dazu eingereicht hat",
	submittedAnswers: {
		one: "{count} eingereichte Antwort",
		other: "{count} eingereichte Antworten",
	},
	countdownNotEditor:
		"Nur wer diese Präsentation bearbeiten kann, kann den Countdown steuern",
	countdownFinishedLabel:
		"Der Countdown hat 0:00 erreicht. Setze ihn zurück, um ihn erneut laufen zu lassen",
	countdownNotLive: "Starte die Präsentation, um den Countdown laufen zu lassen",
	countdownPauseLabel: "Den Countdown bei der verbleibenden Zeit anhalten",
	countdownResumeLabel: "Den Countdown mit der verbleibenden Zeit fortsetzen",
	countdownStartLabel: "Countdown für den Raum starten",
	countdownPause: "Countdown anhalten",
	countdownResume: "Countdown fortsetzen",
	countdownStart: "Countdown starten",
	countdownResetNotEditor:
		"Nur wer diese Präsentation bearbeiten kann, kann den Countdown zurücksetzen",
	countdownResetIdle: "Der Countdown steht schon auf seiner vollen Länge",
	countdownResetLabel: "Den Countdown auf seine volle Länge zurücksetzen",
	countdownReset: "Countdown zurücksetzen",
	noBodyText: "Kein Text",
	noImageUrl: "Keine Bild-URL angegeben",
	noVideoUrl: "Keine Video-URL angegeben",
	videoUnplayable:
		"Diese Video-URL lässt sich nicht abspielen — nutze einen http(s)-Link",
	noEmbedUrl: "Keine URL zum Einbetten angegeben",
	embedUnusable:
		"Dieser Link lässt sich nicht einbetten — nutze einen Link zu Google Slides, PowerPoint oder Miro",
	videoFrameName: "Video",
	formAnswersNotShown:
		"Was die Leute geschrieben haben, steht nicht auf dem Bildschirm — lade die Ergebnisse herunter, um es zu lesen.",
	slideTypes: {
		"multiple-choice": "Multiple Choice",
		"word-cloud": "Wortwolke",
		"open-text": "Fragen",
		scale: "Skala",
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

	answerFilterShow: "Anzeigen",
	answerFilterHide: "Ausblenden",
	answerFilterOwnerOnly:
		"Du siehst sie, weil diese Präsentation dir gehört oder mit dir geteilt ist. Der Raum und alle, die sie über einen Ergebnislink lesen, sehen nur die Anzahl.",
	answerFilterBadge: "Gefiltert",
};
