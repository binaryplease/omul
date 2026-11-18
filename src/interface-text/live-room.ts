// The live-room controls on the presenter screen (LiveRoom.tsx, QuizAudioCue.tsx) — REQ248 slice 2.
//
// The participant's half of the participation switch (`ParticipationGate`) and
// the curtain's title, which the room reads, stay with the deck's `Dict`.

export const en = {
	/** The participation control's name, for somebody who cannot edit the deck. */
	participationSpectatorDraftOpen:
		"This slide will go live open to submissions — you cannot edit this presentation, so it is not yours to close",
	participationSpectatorDraftClosed:
		"This slide will go live closed to submissions — you cannot edit this presentation, so it is not yours to reopen",
	participationSpectatorOpen:
		"This slide is open to submissions — you cannot edit this presentation, so it is not yours to close",
	participationSpectatorClosed:
		"This slide is closed to submissions — you cannot edit this presentation, so it is not yours to reopen",
	/** The participation control's name before the start (or after the end). */
	participationDraftClose:
		"Close this slide before the start — it will go live closed, and the room can answer it only once you reopen it",
	participationDraftReopen:
		"Reopen this slide — it will go live open, so the room can answer it from the start",
	participationClose:
		"Close this slide — the room stops being able to answer it, and every answer already given is kept",
	participationReopen:
		"Reopen this slide — the room can answer it again, alongside the answers already collected",
	/** The words on the participation control itself. */
	participationControlDraftOpen: "Go live closed",
	participationControlDraftClosed: "Goes live closed — reopen",
	participationControlOpen: "Close submissions",
	participationControlClosed: "Submissions closed — reopen",
	participationToastDraftOpen: "This slide will go live open to submissions",
	participationToastDraftClosed:
		"This slide will go live closed — reopen it when you want the room to answer",
	participationToastOpen: "Submissions reopened on this slide",
	participationToastClosed:
		"Submissions closed on this slide — the answers already given are kept",
	/** What starting a deck says about the slides that begin closed. */
	closedAtStartOne:
		"Slide {number} starts closed — reopen it when you want the room to answer",
	/** `{numbers}` is every number but the last, joined with ", ". */
	closedAtStartMany:
		"Slides {numbers} and {last} start closed — reopen each when you want the room to answer",

	blankSpectatorBlanked:
		"The shared screen is blanked — you cannot edit this presentation, so it is not yours to bring back",
	blankSpectatorShown:
		"Blank the shared screen — you cannot edit this presentation, so its screen is not yours to blank",
	blankShow:
		"Show the slide again — the shared screen comes back exactly where it was",
	blankHide:
		"Blank the shared screen — the room's screen goes dark on this slide, and nothing else changes: the deck stays here, submissions are left as they are and every answer is kept",
	/** The curtain's note to the presenter, under the title the room reads. */
	blankCurtainNote:
		"The room sees nothing on the shared screen. Nothing else changed — the deck has not moved, submissions are as you left them, and every answer is still here.",
	blankCurtainShow: "Show the slide again",

	/** The quiz audio cue's control: `…Text` on the control, `…Label` its name. */
	audioCueElsewhereText: "Audio cue plays on the presenter's screen",
	audioCueElsewhereLabel:
		"Audio cue — it plays on the presenter's screen, not this one: you cannot edit this presentation",
	audioCueUnpacedText: "Audio cue off — audience-paced deck",
	audioCueUnpacedLabel:
		"Audio cue — this deck is audience-paced, so there is no shared answer window for it to play over",
	audioCueUnavailableText: "Audio cue unavailable",
	audioCueUnavailableLabel:
		"Audio cue — the track at this address could not be loaded. It is tried again the next time the question opens; if it keeps failing, check its link in the editor",
	audioCueBlockedText: "Play audio cue",
	audioCueBlockedLabel:
		"Play the audio cue — this browser holds sound back until somebody clicks on this screen",
	audioCueMutedText: "Audio cue muted — unmute",
	audioCueMuteText: "Mute audio cue",
	audioCuePlayingMutedLabel:
		"Unmute the audio cue — it has kept running silently while the question is open",
	audioCuePlayingLabel:
		"Mute the audio cue playing on this screen — the question stays open",
	audioCueWaitingMutedLabel:
		"Unmute the audio cue — it plays on this screen while the question is open",
	audioCueWaitingLabel:
		"Mute the audio cue — it plays on this screen while the question is open",
};

export const de: Partial<typeof en> = {
	participationSpectatorDraftOpen:
		"Diese Folie startet offen für Antworten — du kannst diese Präsentation nicht bearbeiten, also kannst du sie nicht schließen",
	participationSpectatorDraftClosed:
		"Diese Folie startet geschlossen für Antworten — du kannst diese Präsentation nicht bearbeiten, also kannst du sie nicht wieder öffnen",
	participationSpectatorOpen:
		"Diese Folie ist offen für Antworten — du kannst diese Präsentation nicht bearbeiten, also kannst du sie nicht schließen",
	participationSpectatorClosed:
		"Diese Folie ist für Antworten geschlossen — du kannst diese Präsentation nicht bearbeiten, also kannst du sie nicht wieder öffnen",
	participationDraftClose:
		"Diese Folie vor dem Start schließen — sie startet geschlossen, und der Raum kann sie erst beantworten, wenn du sie wieder öffnest",
	participationDraftReopen:
		"Diese Folie wieder öffnen — sie startet offen, sodass der Raum sie von Anfang an beantworten kann",
	participationClose:
		"Diese Folie schließen — der Raum kann sie nicht mehr beantworten, und jede bisherige Antwort bleibt erhalten",
	participationReopen:
		"Diese Folie wieder öffnen — der Raum kann sie wieder beantworten, zusätzlich zu den bisherigen Antworten",
	participationControlDraftOpen: "Geschlossen starten",
	participationControlDraftClosed: "Startet geschlossen — wieder öffnen",
	participationControlOpen: "Antworten schließen",
	participationControlClosed: "Antworten geschlossen — wieder öffnen",
	participationToastDraftOpen: "Diese Folie startet offen für Antworten",
	participationToastDraftClosed:
		"Diese Folie startet geschlossen — öffne sie wieder, wenn der Raum antworten soll",
	participationToastOpen: "Antworten auf dieser Folie wieder geöffnet",
	participationToastClosed:
		"Antworten auf dieser Folie geschlossen — die bisherigen Antworten bleiben erhalten",
	closedAtStartOne:
		"Folie {number} startet geschlossen — öffne sie wieder, wenn der Raum antworten soll",
	closedAtStartMany:
		"Folien {numbers} und {last} starten geschlossen — öffne jede wieder, wenn der Raum antworten soll",

	blankSpectatorBlanked:
		"Der geteilte Bildschirm ist ausgeblendet — du kannst diese Präsentation nicht bearbeiten, also kannst du ihn nicht zurückholen",
	blankSpectatorShown:
		"Geteilten Bildschirm ausblenden — du kannst diese Präsentation nicht bearbeiten, also kannst du ihren Bildschirm nicht ausblenden",
	blankShow:
		"Folie wieder zeigen — der geteilte Bildschirm kommt genau dort zurück, wo er war",
	blankHide:
		"Geteilten Bildschirm ausblenden — der Bildschirm des Raums wird auf dieser Folie dunkel, und sonst ändert sich nichts: die Präsentation bleibt hier, die Teilnahme bleibt, wie sie ist, und jede Antwort bleibt erhalten",
	blankCurtainNote:
		"Der Raum sieht nichts auf dem geteilten Bildschirm. Sonst hat sich nichts geändert — die Präsentation steht an derselben Stelle, die Teilnahme ist so, wie du sie gelassen hast, und jede Antwort ist noch da.",
	blankCurtainShow: "Folie wieder zeigen",

	audioCueElsewhereText: "Audiospur läuft auf dem Präsentationsbildschirm",
	audioCueElsewhereLabel:
		"Audiospur — sie läuft auf dem Präsentationsbildschirm, nicht auf diesem: du kannst diese Präsentation nicht bearbeiten",
	audioCueUnpacedText: "Audiospur aus — Präsentation im eigenen Tempo",
	audioCueUnpacedLabel:
		"Audiospur — in dieser Präsentation geht das Publikum im eigenen Tempo vor, daher gibt es kein gemeinsames Antwortfenster, in dem sie laufen kann",
	audioCueUnavailableText: "Audiospur nicht verfügbar",
	audioCueUnavailableLabel:
		"Audiospur — die Spur unter dieser Adresse konnte nicht geladen werden. Sie wird beim nächsten Öffnen der Frage erneut versucht; wenn es weiter fehlschlägt, prüfe ihren Link im Editor",
	audioCueBlockedText: "Audiospur abspielen",
	audioCueBlockedLabel:
		"Audiospur abspielen — dieser Browser hält Ton zurück, bis jemand auf diesen Bildschirm klickt",
	audioCueMutedText: "Audiospur stumm — Ton an",
	audioCueMuteText: "Audiospur stummschalten",
	audioCuePlayingMutedLabel:
		"Ton der Audiospur einschalten — sie ist lautlos weitergelaufen, solange die Frage offen ist",
	audioCuePlayingLabel:
		"Die Audiospur auf diesem Bildschirm stummschalten — die Frage bleibt offen",
	audioCueWaitingMutedLabel:
		"Ton der Audiospur einschalten — sie läuft auf diesem Bildschirm, solange die Frage offen ist",
	audioCueWaitingLabel:
		"Audiospur stummschalten — sie läuft auf diesem Bildschirm, solange die Frage offen ist",
};
