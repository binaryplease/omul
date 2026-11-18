// The presenter screen itself (src/pages/PresenterPage.tsx): its top bar, dock, menus, toasts and dialogs — REQ248 slice 2.
// Also the small parts it composes that carry text of their own: the status
// badge, the session clock, the preview row, the slide rail and the
// confirmation dialog's buttons.

export const en = {
	/** The page title while the deck is loading. */
	pageTitle: "Presenter",
	unknownError: "Unknown error",

	// Toasts.
	presentationStarted: "Presentation started",
	presentationEnded: "Presentation ended",
	resultsCleared: "Results cleared — the deck is a fresh draft",
	timerRestarted: "Question timer restarted",
	answerDeleted: "Answer deleted — the room's tally has been updated",
	joinCodeCopied: "Join code copied to clipboard",
	joinLinkCopied: "Join link copied to clipboard",
	embedCodeCopied: "Embed code copied to clipboard",
	editLinkCopied: "Edit link copied to clipboard",
	noEditRights: "You don't have edit rights for this presentation",

	// The identity zone.
	back: "Back",
	participantsInRoom: "Participants in the room",
	/** Read before the head-count by a screen reader. */
	participantsPrefix: "Participants: ",

	// The room console.
	sharedScreenGroup: "Shared screen",
	panelsGroup: "Panels",
	slidesGroup: "Slides",
	/** The Panels menu's name below `sm`: what its rows are. */
	panelsMenuLabel: "Panels — Q&A, audience, notes, comments, who took part",
	panels: "Panels",
	hidePanels: "Hide panels",
	present: "Present",
	presentLabel: "Present — show only the slide, full screen (F)",
	/** What the Present rows offer, for the Present and More triggers' names. */
	presentMenuOffers:
		"present, open presenting window, preview, blank the shared screen",
	/** `{offers}` is `presentMenuOffers`. */
	presentMenuLabel: "Present — {offers}",
	/**
	 * The blank's row in the Present menu (REQ109). Its accessible name is
	 * `audienceBlankToggleLabel`'s, which states the action in either state.
	 */
	blankRow: "Blank the shared screen",

	// The panels, as the bar and the Panels menu name them.
	qaPanel: "Q&A",
	audiencePanel: "Audience",
	notesPanel: "Presenter notes",
	commentsPanel: "Comments",
	rosterPanel: "Who took part",
	// Each panel's accessible name. A disabled one names its reason after " — ".
	qaRefused:
		"Show the Q&A queue — you cannot edit this presentation, so the room's questions are not yours to read",
	qaHide: "Hide the Q&A queue",
	/** `{count}` is the number of open questions. */
	qaShowOpen: "Show the Q&A queue — {count} open",
	qaShowOff: "Show the Q&A queue — the layer is currently off",
	audienceRefused:
		"Show the audience panel — you cannot edit this presentation, so its channels are not yours to open",
	audienceHide: "Hide the audience panel",
	/** `{messages}` is how many chat messages there are, as the chat names it. */
	audienceShowMessages: "Show the audience panel — {messages}",
	audienceShowOff: "Show the audience panel — the chat is currently off",
	rosterRefused:
		"Show who took part — you cannot edit this presentation, so its participants are not yours to read",
	rosterNoNames:
		"Show who took part — this deck does not ask participants for a name",
	rosterHide: "Hide who took part",
	rosterShow: "Show who took part — the names stated on this deck",
	commentsRefused:
		"Show comments — this deck has not been shared with your account, so its comments are not yours to read",
	commentsHide: "Hide comments",
	/** `{count}` is the number of comments on the slide on screen. */
	commentsShowCount: "Show comments — {count} on this slide",

	// The panels' own text.
	/** `{number}` is the slide on screen. */
	commentsScope:
		"On slide {number}. Only the accounts this deck is shared with — never the room.",
	/** `{reactions}` is the reactions' name, as the reaction controls give it. */
	channelsNote:
		"{reactions} are broadcast and never stored, so they count towards nothing and appear in no export. Chat messages are kept with the session and cleared when you reset it.",
	rosterNote: "Only you — the room never sees this list.",

	// Paging (`slidePagingFor`). `{reason}` is where it lands or why it is shut.
	previousSlideLabel: "Previous slide — {reason}",
	nextSlideLabel: "Next slide — {reason}",
	firstSlide: "this is the first slide",
	earlierSlidesSkipped: "every earlier slide is skipped",
	lastSlide: "this is the last slide",
	laterSlidesSkipped: "every later slide is skipped",
	slideOfCount: "slide {number} of {count}",
	pagingRefusedNotEditor:
		"you cannot edit this presentation, so its slides are not yours to move",
	pagingRefusedDraft: "start the presentation to page through it",
	pagingRefusedEnded: "the session has ended; restart it to page through it",
	previous: "Previous",
	next: "Next",
	pagingHint: "(arrow keys · F to present)",
	noSlides: "No slides",

	// The Deck menu, and More below `sm`.
	deck: "Deck",
	/** What the Deck rows offer, for the Deck and More triggers' names. */
	deckMenuOffers: "share results, export, reset",
	deckMenuOffersWithEdit: "edit, share results, export, reset",
	/** `{offers}` is `deckMenuOffers` or `deckMenuOffersWithEdit`. */
	deckMenuLabel: "Deck — {offers}",
	more: "More",
	/**
	 * `{present}` is `presentMenuOffers` and `{offers}` the Deck's, as above; the
	 * app menu adds its own sections after them.
	 */
	moreMenuLabel: "More — {present}, {offers}",
	editPresentation: "Edit presentation",
	openPresentingWindow: "Open presenting window",
	openPresentingWindowTitle:
		"Open presenting window — the slide alone, in a window for the projector",
	shareResultsRow: "Share results…",
	shareResultsLabel:
		"Share the results — create, copy or revoke a read-only link to this deck's results",
	shareResultsRefused:
		"Share the results — you cannot edit this presentation, so its results are not yours to share",
	exportRow: "Export…",
	resetRow: "Reset results…",
	resetLabel:
		"Reset results — clear every response and return the deck to draft, so it can be run again",
	resetRefused:
		"Reset results — you cannot edit this presentation, so its results are not yours to clear",

	// The lifecycle.
	viewOnly: "View only",
	viewOnlyTitle: "You don't have edit access to this presentation",
	startPresentation: "Start Presentation",
	/** The lifecycle button below `sm`. */
	start: "Start",
	end: "End",
	restart: "Restart",

	// The QR dialog's presenter part; the rest is the room's.
	close: "Close",

	// The confirmations.
	shareEditTitle: "Share with edit permissions",
	shareEditMessage:
		"Anyone with this link can edit, reset, start, or end this presentation. Only share it with people you trust.",
	shareEditConfirm: "Copy edit link",
	resetTitle: "Clear the results",
	resetMessage:
		"Every response, upvote, Q&A question and chat message from this session is deleted, and the deck returns to draft so it can be run again. This cannot be undone — export the results first if you need them.",
	resetConfirm: "Clear results",
	/** `ConfirmModal`'s own buttons. */
	confirmCancel: "Cancel",
	confirmConfirm: "Confirm",

	// `StatusBadge`.
	statusDraft: "Draft",
	statusLive: "LIVE",
	statusEnded: "Ended",

	// `SessionClock`. `{time}` is the elapsed time.
	sessionRunning: "Session running for {time}",
	sessionRan: "Session ran for {time}",

	// `PreviewLink`.
	preview: "Preview",
	previewTitle:
		"Preview the deck with test votes — nothing is saved and no session is started",
	previewRefused:
		"You don't have edit access to this presentation, so its preview is not yours to open",

	// The slide rail (`SlideRail`).
	untitledSlide: "Untitled",
	skippedTitle: "Skipped — Next and Previous step over this slide",
	/** Read after the slide's number by a screen reader. */
	skippedSuffix: ", skipped",
};

export const de: Partial<typeof en> = {
	pageTitle: "Präsentieren",
	unknownError: "Unbekannter Fehler",

	presentationStarted: "Präsentation gestartet",
	presentationEnded: "Präsentation beendet",
	resultsCleared:
		"Ergebnisse gelöscht — die Präsentation ist wieder ein Entwurf",
	timerRestarted: "Timer der Frage neu gestartet",
	answerDeleted: "Antwort gelöscht — die Auswertung im Raum ist aktualisiert",
	joinCodeCopied: "Code zum Mitmachen in die Zwischenablage kopiert",
	joinLinkCopied: "Link zum Mitmachen in die Zwischenablage kopiert",
	embedCodeCopied: "Einbettungscode in die Zwischenablage kopiert",
	editLinkCopied: "Bearbeitungslink in die Zwischenablage kopiert",
	noEditRights: "Du kannst diese Präsentation nicht bearbeiten",

	back: "Zurück",
	participantsInRoom: "Teilnehmende im Raum",
	participantsPrefix: "Teilnehmende: ",

	sharedScreenGroup: "Geteilter Bildschirm",
	panelsGroup: "Bereiche",
	slidesGroup: "Folien",
	panelsMenuLabel:
		"Bereiche — Fragen, Publikum, Notizen, Kommentare, wer mitgemacht hat",
	panels: "Bereiche",
	hidePanels: "Bereiche ausblenden",
	present: "Präsentieren",
	presentLabel: "Präsentieren — nur die Folie zeigen, im Vollbild (F)",
	presentMenuOffers:
		"Präsentieren, Präsentationsfenster öffnen, Vorschau, geteilten Bildschirm ausblenden",
	presentMenuLabel: "Präsentieren — {offers}",
	blankRow: "Geteilten Bildschirm ausblenden",

	qaPanel: "Fragen",
	audiencePanel: "Publikum",
	notesPanel: "Notizen",
	commentsPanel: "Kommentare",
	rosterPanel: "Wer mitgemacht hat",
	qaRefused:
		"Fragen zeigen — du kannst diese Präsentation nicht bearbeiten, also kannst du die Fragen aus dem Raum nicht lesen",
	qaHide: "Fragen ausblenden",
	qaShowOpen: "Fragen zeigen — {count} offen",
	qaShowOff: "Fragen zeigen — Fragen sind gerade ausgeschaltet",
	audienceRefused:
		"Publikumsbereich zeigen — du kannst diese Präsentation nicht bearbeiten, also kannst du ihre Kanäle nicht öffnen",
	audienceHide: "Publikumsbereich ausblenden",
	audienceShowMessages: "Publikumsbereich zeigen — {messages}",
	audienceShowOff: "Publikumsbereich zeigen — der Chat ist gerade ausgeschaltet",
	rosterRefused:
		"Zeigen, wer mitgemacht hat — du kannst diese Präsentation nicht bearbeiten, also kannst du ihre Teilnehmenden nicht sehen",
	rosterNoNames:
		"Zeigen, wer mitgemacht hat — diese Präsentation fragt Teilnehmende nicht nach einem Namen",
	rosterHide: "Ausblenden, wer mitgemacht hat",
	rosterShow:
		"Zeigen, wer mitgemacht hat — die Namen, die bei dieser Präsentation angegeben wurden",
	commentsRefused:
		"Kommentare zeigen — diese Präsentation ist nicht mit deinem Konto geteilt, also kannst du ihre Kommentare nicht lesen",
	commentsHide: "Kommentare ausblenden",
	commentsShowCount: "Kommentare zeigen — {count} auf dieser Folie",

	commentsScope:
		"Auf Folie {number}. Nur die Konten, mit denen diese Präsentation geteilt ist — nie der Raum.",
	channelsNote:
		"{reactions} werden nur übertragen und nie gespeichert, sie zählen also nirgends mit und erscheinen in keinem Export. Chatnachrichten bleiben bei der Sitzung und werden gelöscht, wenn du sie zurücksetzt.",
	rosterNote: "Nur für dich — der Raum sieht diese Liste nie.",

	previousSlideLabel: "Vorherige Folie — {reason}",
	nextSlideLabel: "Nächste Folie — {reason}",
	firstSlide: "das ist die erste Folie",
	earlierSlidesSkipped: "alle früheren Folien werden übersprungen",
	lastSlide: "das ist die letzte Folie",
	laterSlidesSkipped: "alle späteren Folien werden übersprungen",
	slideOfCount: "Folie {number} von {count}",
	pagingRefusedNotEditor:
		"du kannst diese Präsentation nicht bearbeiten, also kannst du ihre Folien nicht wechseln",
	pagingRefusedDraft: "starte die Präsentation, um durch die Folien zu blättern",
	pagingRefusedEnded:
		"die Sitzung ist beendet; starte sie neu, um durch die Folien zu blättern",
	previous: "Zurück",
	next: "Weiter",
	pagingHint: "(Pfeiltasten · F zum Präsentieren)",
	noSlides: "Keine Folien",

	deck: "Präsentation",
	deckMenuOffers: "Ergebnisse teilen, Exportieren, Zurücksetzen",
	deckMenuOffersWithEdit:
		"Bearbeiten, Ergebnisse teilen, Exportieren, Zurücksetzen",
	deckMenuLabel: "Präsentation — {offers}",
	more: "Mehr",
	moreMenuLabel: "Mehr — {present}, {offers}",
	editPresentation: "Präsentation bearbeiten",
	openPresentingWindow: "Präsentationsfenster öffnen",
	openPresentingWindowTitle:
		"Präsentationsfenster öffnen — nur die Folie, in einem Fenster für den Projektor",
	shareResultsRow: "Ergebnisse teilen…",
	shareResultsLabel:
		"Ergebnisse teilen — einen Link zum Ansehen der Ergebnisse dieser Präsentation erstellen, kopieren oder widerrufen",
	shareResultsRefused:
		"Ergebnisse teilen — du kannst diese Präsentation nicht bearbeiten, also kannst du ihre Ergebnisse nicht teilen",
	exportRow: "Exportieren…",
	resetRow: "Ergebnisse zurücksetzen…",
	resetLabel:
		"Ergebnisse zurücksetzen — alle Antworten löschen und die Präsentation wieder zum Entwurf machen, damit sie neu laufen kann",
	resetRefused:
		"Ergebnisse zurücksetzen — du kannst diese Präsentation nicht bearbeiten, also kannst du ihre Ergebnisse nicht löschen",

	viewOnly: "Nur ansehen",
	viewOnlyTitle: "Du kannst diese Präsentation nicht bearbeiten",
	startPresentation: "Präsentation starten",
	start: "Starten",
	end: "Beenden",
	restart: "Neu starten",

	close: "Schließen",

	shareEditTitle: "Mit Bearbeitungsrechten teilen",
	shareEditMessage:
		"Wer diesen Link hat, kann diese Präsentation bearbeiten, zurücksetzen, starten oder beenden. Teile ihn nur mit Menschen, denen du vertraust.",
	shareEditConfirm: "Bearbeitungslink kopieren",
	resetTitle: "Ergebnisse löschen",
	resetMessage:
		"Alle Antworten, Stimmen für Fragen, Fragen und Chatnachrichten dieser Sitzung werden gelöscht, und die Präsentation wird wieder ein Entwurf, damit sie neu laufen kann. Das lässt sich nicht rückgängig machen — exportiere die Ergebnisse vorher, wenn du sie brauchst.",
	resetConfirm: "Ergebnisse löschen",
	confirmCancel: "Abbrechen",
	confirmConfirm: "Bestätigen",

	statusDraft: "Entwurf",
	statusLive: "LIVE",
	statusEnded: "Beendet",

	sessionRunning: "Sitzung läuft seit {time}",
	sessionRan: "Sitzung dauerte {time}",

	preview: "Vorschau",
	previewTitle:
		"Vorschau der Präsentation mit Teststimmen — nichts wird gespeichert und keine Sitzung gestartet",
	previewRefused:
		"Du kannst diese Präsentation nicht bearbeiten, also kannst du ihre Vorschau nicht öffnen",

	untitledSlide: "Ohne Titel",
	skippedTitle: "Übersprungen — Weiter und Zurück überspringen diese Folie",
	skippedSuffix: ", übersprungen",
};
