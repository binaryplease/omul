// ── Minimal participant-facing i18n (REQ084) ────────────────
//
// Presenters choose a language per presentation (in CreatePage). That
// language is stored on the Presentation and used by ParticipantPage to
// localize UI strings. English is the fallback for any missing key or
// unknown language tag.

export type Lang = "en" | "de" | "fr" | "es" | "it" | "pt" | "nl";

export type Dict = {
	live: string;
	waitingPresenter: string;
	willStartSoon: string;
	presentationEnded: string;
	thankYou: string;
	typeResponse: string;
	submit: string;
	voteSubmitted: string;
	liveResults: string;
	waitingForResponses: string;
	resultsPrivate: string;
	resultsHidden: string;
	answerIndependent: string;
	completeAllToSeeResults: string;
	/** 2x2 Grid (REQ046): what a participant is asked to do with the items. */
	gridInstruction: string;
	/** 2x2 Grid (REQ050): the "I can't judge this one" control and its badge. */
	gridNotAssessable: string;
	gridSkipped: string;
	/** Fallback axis names for a deck whose author left an axis unnamed. */
	gridHorizontal: string;
	gridVertical: string;
	/** 100 Points (REQ044): what a participant is asked to do with the budget. */
	pointsInstruction: string;
	/** The running remainder, shown beside the budget the participant holds. */
	pointsRemaining: string;
	/**
	 * Why a control cannot act right now — the budget is spent, the
	 * item holds nothing to take back, or the ballot is not yet a full spend.
	 */
	pointsNoneLeft: string;
	pointsAtZero: string;
	pointsSpendAll: string;
	pointsSubmit: string;
	pointsUpdate: string;
	pointsSubmitted: string;
	/** Guess the Number (REQ039): what a participant is asked to enter. */
	guessInstruction: string;
	/** The frame the estimate has to sit in (REQ040) and its resolution (REQ043). */
	guessAllowedRange: string;
	guessStepHint: string;
	/**
	 * Why the submit button cannot act right now — nothing entered,
	 * not a whole number, outside the range, or not one of the selectable values.
	 */
	guessEnterNumber: string;
	guessWholeNumber: string;
	guessOutOfRange: string;
	guessOffStep: string;
	/**
	 * The frame itself is unusable, so *no* number can be submitted — a distinct
	 * reason from "outside the range", which would send a participant hunting for
	 * a number that would work when none does.
	 */
	guessNoValues: string;
	guessSubmit: string;
	guessUpdate: string;
	guessSubmitted: string;
	/** Pin on Image (REQ051): what a participant is asked to do with the picture. */
	pinInstruction: string;
	/** The pin the server accepted, and where it sits, once one has landed. */
	pinPlaced: string;
	/**
	 * The two position sliders beside the picture — the keyboard path to the same
	 * answer a tap gives, for a participant who can see the image but cannot tap
	 * a point on it.
	 */
	pinHorizontal: string;
	pinVertical: string;
	/**
	 * The slide carries no image yet (REQ052), so there is nothing to pin on and
	 * nothing the participant can do about it — said plainly rather than shown as
	 * a broken picture.
	 */
	pinNoImage: string;
	/**
	 * Whether this participant's own pin landed in the target area (REQ053). Only
	 * ever shown once the organizer's reveal has made the area known at all.
	 */
	pinInTarget: string;
	pinOutsideTarget: string;
	/**
	 * Form (REQ061): what a participant is asked to do with the fields, and the
	 * mark beside a field they cannot leave blank.
	 */
	formInstruction: string;
	formRequiredMark: string;
	/**
	 * Why the submit button cannot act right now — the slide has no
	 * fields to fill in, nothing has been written, a required field is blank, an
	 * email field holds something that is not an address, or one answer is longer
	 * than the boundary will take.
	 */
	formNoFields: string;
	formEnterSomething: string;
	formRequiredMissing: string;
	formInvalidEmail: string;
	formAnswerTooLong: string;
	formSubmit: string;
	formUpdate: string;
	formSubmitted: string;
	/**
	 * What happens to what they wrote, said on the screen where they write it. A
	 * form asks for a name and an address, so the person handing them over is told
	 * where they go before they do.
	 */
	formPrivacyNote: string;
	/**
	 * Quiz competition (REQ054, REQ056, REQ057). The countdown's unit suffix
	 * ("12s left") and what the closed state says.
	 */
	quizSecondsLeft: string;
	quizTimesUp: string;
	/**
	 * Why the options can no longer be picked (the cards stay visible
	 * and disabled, and say why). The two reasons are kept apart because they
	 * call for different things from the participant: one has answered and is
	 * waiting, the other missed the window entirely.
	 */
	quizAnswerLocked: string;
	quizWindowClosed: string;
	/**
	 * Why the answer control is dead on a slide the presenter has closed to
	 * submissions (REQ111). Distinct from the two quiz reasons above and from
	 * "the presentation has ended": nothing about this participant, this answer
	 * or this session has run out — somebody in the room decided a moment ago
	 * that this question is done, and may decide otherwise a moment from now.
	 */
	participationClosed: string;
	/**
	 * The free-text answer field on a typed quiz question (REQ055) and the
	 * button that sends it. Its own wording rather than the word-cloud's
	 * "type your response": this one is an answer being graded, and it is final.
	 */
	quizTypeAnswer: string;
	quizSubmitAnswer: string;
	/** The participant's own result once the question is over (REQ056). */
	quizCorrect: string;
	quizIncorrect: string;
	quizNoAnswer: string;
	quizPoints: string;
	quizTotalScore: string;
	/**
	 * The leaderboard (REQ059) — the deck's standings across its quiz questions.
	 * `leaderboardOutOf` joins a place to the field it was taken in ("#4 of 31"),
	 * and `leaderboardNotRanked` is what somebody who has not answered anything is
	 * told instead of a place: unranked is a standing too, and a silent board
	 * would leave them wondering whether it had failed to load.
	 */
	leaderboardTitle: string;
	leaderboardEmpty: string;
	leaderboardYou: string;
	leaderboardYourPosition: string;
	leaderboardOutOf: string;
	leaderboardCorrect: string;
	leaderboardMoreRanked: string;
	leaderboardNotRanked: string;
	/**
	 * The Q&A layer (REQ036, REQ037, REQ060) — questions asked from any slide.
	 * `qaModeratedNote` is what a participant is told when the organizer keeps
	 * the list to the moderation view: an empty panel with no explanation reads
	 * as a broken one, and it is also the honest thing to say about where their
	 * question just went. `qaUpvoteOwn` is why the upvote on their own question
	 * is disabled rather than missing.
	 */
	qaTitle: string;
	qaAsk: string;
	qaPlaceholder: string;
	qaSubmit: string;
	qaSubmitted: string;
	/**
	 * What a participant is told when re-asking a question they already asked —
	 * a deliberate no-op, and so the one outcome that must not read as "sent".
	 */
	qaAlreadyAsked: string;
	qaEmpty: string;
	qaEmptyOwn: string;
	qaModeratedNote: string;
	qaUpvote: string;
	qaUpvoteOwn: string;
	qaAnswered: string;
	qaOpen: string;
	/**
	 * Reactions on any slide (REQ077). One label per reaction in the schema's
	 * closed `REACTION_KINDS` set, used as the accessible name of the button that
	 * sends it — the icon carries no text of its own, so this *is* the control's
	 * name rather than a decoration on it. `reactionsTitle` names the row.
	 */
	reactionsTitle: string;
	reactionLike: string;
	reactionLove: string;
	reactionCelebrate: string;
	reactionLaugh: string;
	reactionInsight: string;
	/**
	 * The deck's live chat (REQ078). `chatEmpty` stands in for a channel nobody
	 * has written in yet, and `chatClosed` is what a participant is told when the
	 * organizer has closed it with the transcript still on screen — an unexplained
	 * dead composer reads as broken, and it is also the honest thing to say about
	 * why typing no longer works.
	 */
	chatTitle: string;
	chatPlaceholder: string;
	chatSend: string;
	chatEmpty: string;
	chatClosed: string;
	chatYou: string;
	/**
	 * The name a deck can ask for at its door (REQ076). `nameIntro` says what
	 * becomes of it, because "type your name" with no reason attached is a field
	 * a room is right to hesitate over; `nameEmpty` is the disabled Continue
	 * button's stated reason, never a hidden button. Once stated,
	 * `nameJoinedAs` reports it back beside the slide with `nameChange` next to it
	 * — a name is corrected where it is shown, and a typo the organizer
	 * will read later is worth one control.
	 */
	nameTitle: string;
	nameIntro: string;
	namePlaceholder: string;
	nameContinue: string;
	nameEmpty: string;
	nameJoinedAs: string;
	nameChange: string;
	nameCancel: string;
};

const en: Dict = {
	live: "LIVE",
	waitingPresenter: "Waiting for presenter...",
	willStartSoon: "The presentation will start soon",
	presentationEnded: "Presentation Ended",
	thankYou: "Thank you for participating!",
	typeResponse: "Type your response...",
	submit: "Submit",
	voteSubmitted: "Vote submitted!",
	liveResults: "Live results",
	waitingForResponses: "Waiting for responses...",
	resultsPrivate: "Results are private",
	resultsHidden: "Results are hidden",
	answerIndependent: "Answer independently",
	completeAllToSeeResults: "Answer all questions to see results",
	gridInstruction: "Place each item on the grid",
	gridNotAssessable: "Not assessable",
	gridSkipped: "Skipped",
	gridHorizontal: "Horizontal",
	gridVertical: "Vertical",
	pointsInstruction: "Spread your points across the items",
	pointsRemaining: "left",
	pointsNoneLeft: "No points left — take some back from another item first",
	pointsAtZero: "This item has no points to take back",
	pointsSpendAll: "Spend all your points to submit",
	pointsSubmit: "Submit points",
	pointsUpdate: "Update points",
	pointsSubmitted: "Points submitted!",
	guessInstruction: "Enter your estimate",
	guessAllowedRange: "Allowed range",
	guessStepHint: "In steps of",
	guessEnterNumber: "Enter a number to submit",
	guessWholeNumber: "Enter a whole number",
	guessOutOfRange: "That number is outside the allowed range",
	guessOffStep: "That number is not one of the selectable values",
	guessNoValues:
		"This question has no valid answers — ask the organizer to fix its range",
	guessSubmit: "Submit guess",
	guessUpdate: "Update guess",
	guessSubmitted: "Guess submitted!",
	pinInstruction: "Tap the image to place your pin",
	pinPlaced: "Pin placed",
	pinHorizontal: "Horizontal position",
	pinVertical: "Vertical position",
	pinNoImage: "This slide has no image yet — nothing to pin on",
	pinInTarget: "Your pin is in the target area",
	pinOutsideTarget: "Your pin is outside the target area",
	formInstruction: "Fill in the form and send it",
	formRequiredMark: "*",
	formNoFields: "This slide has no fields yet \u2014 nothing to fill in",
	formEnterSomething: "Fill in at least one field to send",
	formRequiredMissing: "Fill in every required field to send",
	formInvalidEmail: "That doesn't look like an email address",
	formAnswerTooLong: "One of your answers is too long",
	formSubmit: "Send",
	formUpdate: "Update your answers",
	formSubmitted: "Sent \u2014 thank you!",
	formPrivacyNote: "Only the organizer can read what you write here.",
	quizSecondsLeft: "s left",
	quizTimesUp: "Time's up",
	quizAnswerLocked: "Your answer is locked in",
	quizWindowClosed: "The time for this question is over",
	participationClosed: "The presenter has closed this question",
	quizTypeAnswer: "Type your answer...",
	quizSubmitAnswer: "Submit answer",
	quizCorrect: "Correct!",
	quizIncorrect: "Not quite",
	quizNoAnswer: "No answer in time",
	quizPoints: "points",
	quizTotalScore: "Your score so far",
	leaderboardTitle: "Leaderboard",
	leaderboardEmpty:
		"No scores yet — the standings fill in as quiz questions are answered.",
	leaderboardYou: "You",
	leaderboardYourPosition: "Your position",
	leaderboardOutOf: "of",
	leaderboardCorrect: "correct",
	leaderboardMoreRanked: "more ranked",
	leaderboardNotRanked: "Answer a quiz question to join the leaderboard",
	qaTitle: "Questions",
	qaAsk: "Ask a question",
	qaPlaceholder: "Type your question...",
	qaSubmit: "Send",
	qaSubmitted: "Question sent!",
	qaAlreadyAsked: "You already asked that one.",
	qaEmpty: "No questions yet — ask the first one.",
	qaEmptyOwn: "You haven't asked anything yet.",
	qaModeratedNote: "Your questions go to the presenter only.",
	qaUpvote: "Upvote this question",
	qaUpvoteOwn: "You asked this one — it already counts",
	qaAnswered: "Answered",
	qaOpen: "open",
	reactionsTitle: "Reactions",
	reactionLike: "Nice",
	reactionLove: "Love it",
	reactionCelebrate: "Celebrate",
	reactionLaugh: "Funny",
	reactionInsight: "Good point",
	chatTitle: "Chat",
	chatPlaceholder: "Say something...",
	chatSend: "Send",
	chatEmpty: "Nothing said yet — start the conversation.",
	chatClosed: "The chat is closed. You can still read what was said.",
	chatYou: "You",
	nameTitle: "What's your name?",
	nameIntro:
		"This presentation asks everyone joining to say who they are. Your name is stored with your answers and shown to the organizer.",
	namePlaceholder: "Your name",
	nameContinue: "Continue",
	nameEmpty: "Enter your name to continue",
	nameJoinedAs: "Joined as",
	nameChange: "Change",
	nameCancel: "Cancel",
};

const de: Dict = {
	live: "LIVE",
	waitingPresenter: "Warte auf Moderator...",
	willStartSoon: "Die Präsentation beginnt gleich",
	presentationEnded: "Präsentation beendet",
	thankYou: "Danke für deine Teilnahme!",
	typeResponse: "Antwort eingeben...",
	submit: "Absenden",
	voteSubmitted: "Antwort gesendet!",
	liveResults: "Live-Ergebnisse",
	waitingForResponses: "Warte auf Antworten...",
	resultsPrivate: "Ergebnisse sind privat",
	resultsHidden: "Ergebnisse ausgeblendet",
	answerIndependent: "Unabhängig antworten",
	completeAllToSeeResults: "Beantworte alle Fragen, um die Ergebnisse zu sehen",
	gridInstruction: "Ordne jedes Element im Raster ein",
	gridNotAssessable: "Nicht bewertbar",
	gridSkipped: "Übersprungen",
	gridHorizontal: "Horizontal",
	gridVertical: "Vertikal",
	pointsInstruction: "Verteile deine Punkte auf die Elemente",
	pointsRemaining: "übrig",
	pointsNoneLeft:
		"Keine Punkte mehr übrig — nimm zuerst welche von einem anderen Element zurück",
	pointsAtZero: "Dieses Element hat keine Punkte zum Zurücknehmen",
	pointsSpendAll: "Verteile alle Punkte, um abzusenden",
	pointsSubmit: "Punkte absenden",
	pointsUpdate: "Punkte ändern",
	pointsSubmitted: "Punkte gesendet!",
	guessInstruction: "Gib deine Schätzung ein",
	guessAllowedRange: "Erlaubter Bereich",
	guessStepHint: "In Schritten von",
	guessEnterNumber: "Gib eine Zahl ein, um abzusenden",
	guessWholeNumber: "Gib eine ganze Zahl ein",
	guessOutOfRange: "Diese Zahl liegt außerhalb des erlaubten Bereichs",
	guessOffStep: "Diese Zahl gehört nicht zu den wählbaren Werten",
	guessNoValues:
		"Diese Frage hat keine gültigen Antworten — bitte den Moderator, den Bereich zu korrigieren",
	guessSubmit: "Schätzung absenden",
	guessUpdate: "Schätzung ändern",
	guessSubmitted: "Schätzung gesendet!",
	pinInstruction: "Tippe auf das Bild, um deine Markierung zu setzen",
	pinPlaced: "Markierung gesetzt",
	pinHorizontal: "Horizontale Position",
	pinVertical: "Vertikale Position",
	pinNoImage: "Diese Folie hat noch kein Bild — es gibt nichts zu markieren",
	pinInTarget: "Deine Markierung liegt im Zielbereich",
	pinOutsideTarget: "Deine Markierung liegt außerhalb des Zielbereichs",
	formInstruction: "F\u00fclle das Formular aus und sende es ab",
	formRequiredMark: "*",
	formNoFields: "Diese Folie hat noch keine Felder \u2014 es gibt nichts auszuf\u00fcllen",
	formEnterSomething: "F\u00fclle mindestens ein Feld aus, um abzusenden",
	formRequiredMissing: "F\u00fclle alle Pflichtfelder aus, um abzusenden",
	formInvalidEmail: "Das sieht nicht nach einer E-Mail-Adresse aus",
	formAnswerTooLong: "Eine deiner Antworten ist zu lang",
	formSubmit: "Absenden",
	formUpdate: "Antworten \u00e4ndern",
	formSubmitted: "Gesendet \u2014 danke!",
	formPrivacyNote: "Nur der Moderator kann lesen, was du hier schreibst.",
	quizSecondsLeft: "s übrig",
	quizTimesUp: "Zeit abgelaufen",
	quizAnswerLocked: "Deine Antwort steht fest",
	quizWindowClosed: "Die Zeit für diese Frage ist vorbei",
	participationClosed: "Der Präsentator hat diese Frage geschlossen",
	quizTypeAnswer: "Antwort eingeben...",
	quizSubmitAnswer: "Antwort absenden",
	quizCorrect: "Richtig!",
	quizIncorrect: "Leider falsch",
	quizNoAnswer: "Keine Antwort in der Zeit",
	quizPoints: "Punkte",
	quizTotalScore: "Dein bisheriger Punktestand",
	leaderboardTitle: "Bestenliste",
	leaderboardEmpty:
		"Noch keine Punkte — die Wertung füllt sich, sobald Quizfragen beantwortet werden.",
	leaderboardYou: "Du",
	leaderboardYourPosition: "Dein Platz",
	leaderboardOutOf: "von",
	leaderboardCorrect: "richtig",
	leaderboardMoreRanked: "weitere in der Wertung",
	leaderboardNotRanked:
		"Beantworte eine Quizfrage, um in die Wertung zu kommen",
	qaTitle: "Fragen",
	qaAsk: "Frage stellen",
	qaPlaceholder: "Frage eingeben...",
	qaSubmit: "Senden",
	qaSubmitted: "Frage gesendet!",
	qaAlreadyAsked: "Das hast du schon gefragt.",
	qaEmpty: "Noch keine Fragen — stell die erste.",
	qaEmptyOwn: "Du hast noch nichts gefragt.",
	qaModeratedNote: "Deine Fragen gehen nur an den Moderator.",
	qaUpvote: "Diese Frage unterstützen",
	qaUpvoteOwn: "Deine eigene Frage — sie zählt bereits",
	qaAnswered: "Beantwortet",
	qaOpen: "offen",
	reactionsTitle: "Reaktionen",
	reactionLike: "Stark",
	reactionLove: "Liebe ich",
	reactionCelebrate: "Feiern",
	reactionLaugh: "Witzig",
	reactionInsight: "Guter Punkt",
	chatTitle: "Chat",
	chatPlaceholder: "Schreib etwas...",
	chatSend: "Senden",
	chatEmpty: "Noch nichts gesagt — fang das Gespräch an.",
	chatClosed: "Der Chat ist geschlossen. Du kannst weiterhin mitlesen.",
	chatYou: "Du",
	nameTitle: "Wie heißt du?",
	nameIntro:
		"Diese Präsentation bittet alle Teilnehmenden, ihren Namen anzugeben. Dein Name wird mit deinen Antworten gespeichert und dem Organisator angezeigt.",
	namePlaceholder: "Dein Name",
	nameContinue: "Weiter",
	nameEmpty: "Gib deinen Namen ein, um fortzufahren",
	nameJoinedAs: "Beigetreten als",
	nameChange: "Ändern",
	nameCancel: "Abbrechen",
};

const fr: Dict = {
	live: "EN DIRECT",
	waitingPresenter: "En attente du présentateur...",
	willStartSoon: "La présentation va commencer",
	presentationEnded: "Présentation terminée",
	thankYou: "Merci d'avoir participé !",
	typeResponse: "Tapez votre réponse...",
	submit: "Envoyer",
	voteSubmitted: "Réponse envoyée !",
	liveResults: "Résultats en direct",
	waitingForResponses: "En attente de réponses...",
	resultsPrivate: "Les résultats sont privés",
	resultsHidden: "Résultats masqués",
	answerIndependent: "Répondez de façon indépendante",
	completeAllToSeeResults:
		"Répondez à toutes les questions pour voir les résultats",
	gridInstruction: "Placez chaque élément sur la grille",
	gridNotAssessable: "Non évaluable",
	gridSkipped: "Ignoré",
	gridHorizontal: "Horizontal",
	gridVertical: "Vertical",
	pointsInstruction: "Répartissez vos points entre les éléments",
	pointsRemaining: "restant",
	pointsNoneLeft:
		"Plus de points disponibles — reprenez-en d'abord sur un autre élément",
	pointsAtZero: "Cet élément n'a aucun point à reprendre",
	pointsSpendAll: "Répartissez tous vos points pour envoyer",
	pointsSubmit: "Envoyer les points",
	pointsUpdate: "Modifier les points",
	pointsSubmitted: "Points envoyés !",
	guessInstruction: "Saisissez votre estimation",
	guessAllowedRange: "Plage autorisée",
	guessStepHint: "Par pas de",
	guessEnterNumber: "Saisissez un nombre pour envoyer",
	guessWholeNumber: "Saisissez un nombre entier",
	guessOutOfRange: "Ce nombre est en dehors de la plage autorisée",
	guessOffStep: "Ce nombre ne fait pas partie des valeurs sélectionnables",
	guessNoValues:
		"Cette question n'a aucune réponse valide — demandez à l'organisateur de corriger sa plage",
	guessSubmit: "Envoyer l'estimation",
	guessUpdate: "Modifier l'estimation",
	guessSubmitted: "Estimation envoyée !",
	pinInstruction: "Touchez l'image pour placer votre repère",
	pinPlaced: "Repère placé",
	pinHorizontal: "Position horizontale",
	pinVertical: "Position verticale",
	pinNoImage: "Cette diapositive n'a pas encore d'image — rien à repérer",
	pinInTarget: "Votre repère est dans la zone cible",
	pinOutsideTarget: "Votre repère est en dehors de la zone cible",
	formInstruction: "Remplissez le formulaire et envoyez-le",
	formRequiredMark: "*",
	formNoFields: "Cette diapositive n'a pas encore de champs \u2014 rien \u00e0 remplir",
	formEnterSomething: "Remplissez au moins un champ pour envoyer",
	formRequiredMissing: "Remplissez tous les champs obligatoires pour envoyer",
	formInvalidEmail: "Cela ne ressemble pas \u00e0 une adresse e-mail",
	formAnswerTooLong: "Une de vos r\u00e9ponses est trop longue",
	formSubmit: "Envoyer",
	formUpdate: "Modifier vos r\u00e9ponses",
	formSubmitted: "Envoy\u00e9 \u2014 merci !",
	formPrivacyNote: "Seul l'organisateur peut lire ce que vous \u00e9crivez ici.",
	quizSecondsLeft: "s restantes",
	quizTimesUp: "Temps écoulé",
	quizAnswerLocked: "Votre réponse est définitive",
	quizWindowClosed: "Le temps pour cette question est écoulé",
	participationClosed: "Le présentateur a fermé cette question",
	quizTypeAnswer: "Tapez votre réponse...",
	quizSubmitAnswer: "Envoyer la réponse",
	quizCorrect: "Correct !",
	quizIncorrect: "Pas tout à fait",
	quizNoAnswer: "Pas de réponse à temps",
	quizPoints: "points",
	quizTotalScore: "Votre score actuel",
	leaderboardTitle: "Classement",
	leaderboardEmpty:
		"Pas encore de scores — le classement se remplit à mesure que les questions du quiz sont répondues.",
	leaderboardYou: "Vous",
	leaderboardYourPosition: "Votre place",
	leaderboardOutOf: "sur",
	leaderboardCorrect: "correctes",
	leaderboardMoreRanked: "autres classés",
	leaderboardNotRanked:
		"Répondez à une question du quiz pour entrer au classement",
	qaTitle: "Questions",
	qaAsk: "Poser une question",
	qaPlaceholder: "Saisissez votre question...",
	qaSubmit: "Envoyer",
	qaSubmitted: "Question envoyée !",
	qaAlreadyAsked: "Vous avez déjà posé cette question.",
	qaEmpty: "Aucune question pour l'instant — posez la première.",
	qaEmptyOwn: "Vous n'avez encore rien demandé.",
	qaModeratedNote: "Vos questions vont uniquement au présentateur.",
	qaUpvote: "Soutenir cette question",
	qaUpvoteOwn: "Votre propre question — elle compte déjà",
	qaAnswered: "Traitée",
	qaOpen: "en attente",
	reactionsTitle: "Réactions",
	reactionLike: "Bien",
	reactionLove: "J'adore",
	reactionCelebrate: "Bravo",
	reactionLaugh: "Drôle",
	reactionInsight: "Bien vu",
	chatTitle: "Chat",
	chatPlaceholder: "Dites quelque chose...",
	chatSend: "Envoyer",
	chatEmpty: "Rien encore — lancez la conversation.",
	chatClosed: "Le chat est fermé. Vous pouvez toujours lire les messages.",
	chatYou: "Vous",
	nameTitle: "Comment vous appelez-vous ?",
	nameIntro:
		"Cette présentation demande à chaque participant de donner son nom. Votre nom est enregistré avec vos réponses et affiché à l'organisateur.",
	namePlaceholder: "Votre nom",
	nameContinue: "Continuer",
	nameEmpty: "Saisissez votre nom pour continuer",
	nameJoinedAs: "Connecté en tant que",
	nameChange: "Modifier",
	nameCancel: "Annuler",
};

const es: Dict = {
	live: "EN VIVO",
	waitingPresenter: "Esperando al presentador...",
	willStartSoon: "La presentación comenzará pronto",
	presentationEnded: "Presentación finalizada",
	thankYou: "¡Gracias por participar!",
	typeResponse: "Escribe tu respuesta...",
	submit: "Enviar",
	voteSubmitted: "¡Respuesta enviada!",
	liveResults: "Resultados en vivo",
	waitingForResponses: "Esperando respuestas...",
	resultsPrivate: "Los resultados son privados",
	resultsHidden: "Resultados ocultos",
	answerIndependent: "Responde de forma independiente",
	completeAllToSeeResults:
		"Responde todas las preguntas para ver los resultados",
	gridInstruction: "Coloca cada elemento en la cuadrícula",
	gridNotAssessable: "No evaluable",
	gridSkipped: "Omitido",
	gridHorizontal: "Horizontal",
	gridVertical: "Vertical",
	pointsInstruction: "Reparte tus puntos entre los elementos",
	pointsRemaining: "restantes",
	pointsNoneLeft:
		"No quedan puntos — recupera algunos de otro elemento primero",
	pointsAtZero: "Este elemento no tiene puntos que recuperar",
	pointsSpendAll: "Reparte todos tus puntos para enviar",
	pointsSubmit: "Enviar puntos",
	pointsUpdate: "Actualizar puntos",
	pointsSubmitted: "¡Puntos enviados!",
	guessInstruction: "Introduce tu estimación",
	guessAllowedRange: "Rango permitido",
	guessStepHint: "En pasos de",
	guessEnterNumber: "Introduce un número para enviar",
	guessWholeNumber: "Introduce un número entero",
	guessOutOfRange: "Ese número está fuera del rango permitido",
	guessOffStep: "Ese número no es uno de los valores seleccionables",
	guessNoValues:
		"Esta pregunta no tiene respuestas válidas — pide al organizador que corrija su rango",
	guessSubmit: "Enviar estimación",
	guessUpdate: "Actualizar estimación",
	guessSubmitted: "¡Estimación enviada!",
	pinInstruction: "Toca la imagen para colocar tu marca",
	pinPlaced: "Marca colocada",
	pinHorizontal: "Posición horizontal",
	pinVertical: "Posición vertical",
	pinNoImage: "Esta diapositiva aún no tiene imagen — nada que marcar",
	pinInTarget: "Tu marca está en el área correcta",
	pinOutsideTarget: "Tu marca está fuera del área correcta",
	formInstruction: "Rellena el formulario y env\u00edalo",
	formRequiredMark: "*",
	formNoFields: "Esta diapositiva a\u00fan no tiene campos \u2014 no hay nada que rellenar",
	formEnterSomething: "Rellena al menos un campo para enviar",
	formRequiredMissing: "Rellena todos los campos obligatorios para enviar",
	formInvalidEmail: "Eso no parece una direcci\u00f3n de correo",
	formAnswerTooLong: "Una de tus respuestas es demasiado larga",
	formSubmit: "Enviar",
	formUpdate: "Actualizar tus respuestas",
	formSubmitted: "\u00a1Enviado, gracias!",
	formPrivacyNote: "Solo el organizador puede leer lo que escribes aqu\u00ed.",
	quizSecondsLeft: "s restantes",
	quizTimesUp: "Tiempo agotado",
	quizAnswerLocked: "Tu respuesta es definitiva",
	quizWindowClosed: "El tiempo para esta pregunta ha terminado",
	participationClosed: "El presentador ha cerrado esta pregunta",
	quizTypeAnswer: "Escribe tu respuesta...",
	quizSubmitAnswer: "Enviar respuesta",
	quizCorrect: "¡Correcto!",
	quizIncorrect: "No es correcto",
	quizNoAnswer: "Sin respuesta a tiempo",
	quizPoints: "puntos",
	quizTotalScore: "Tu puntuación hasta ahora",
	leaderboardTitle: "Clasificación",
	leaderboardEmpty:
		"Aún no hay puntuaciones — la clasificación se llena a medida que se responden las preguntas del quiz.",
	leaderboardYou: "Tú",
	leaderboardYourPosition: "Tu posición",
	leaderboardOutOf: "de",
	leaderboardCorrect: "correctas",
	leaderboardMoreRanked: "más clasificados",
	leaderboardNotRanked:
		"Responde una pregunta del quiz para entrar en la clasificación",
	qaTitle: "Preguntas",
	qaAsk: "Hacer una pregunta",
	qaPlaceholder: "Escribe tu pregunta...",
	qaSubmit: "Enviar",
	qaSubmitted: "¡Pregunta enviada!",
	qaAlreadyAsked: "Ya hiciste esa pregunta.",
	qaEmpty: "Aún no hay preguntas — haz la primera.",
	qaEmptyOwn: "Todavía no has preguntado nada.",
	qaModeratedNote: "Tus preguntas van solo al presentador.",
	qaUpvote: "Apoyar esta pregunta",
	qaUpvoteOwn: "Tu propia pregunta — ya cuenta",
	qaAnswered: "Respondida",
	qaOpen: "pendientes",
	reactionsTitle: "Reacciones",
	reactionLike: "Genial",
	reactionLove: "Me encanta",
	reactionCelebrate: "Celebrar",
	reactionLaugh: "Divertido",
	reactionInsight: "Buen punto",
	chatTitle: "Chat",
	chatPlaceholder: "Di algo...",
	chatSend: "Enviar",
	chatEmpty: "Nada todavía — empieza la conversación.",
	chatClosed: "El chat está cerrado. Aún puedes leer lo que se dijo.",
	chatYou: "Tú",
	nameTitle: "¿Cómo te llamas?",
	nameIntro:
		"Esta presentación pide a cada participante que indique su nombre. Tu nombre se guarda con tus respuestas y se muestra al organizador.",
	namePlaceholder: "Tu nombre",
	nameContinue: "Continuar",
	nameEmpty: "Escribe tu nombre para continuar",
	nameJoinedAs: "Te uniste como",
	nameChange: "Cambiar",
	nameCancel: "Cancelar",
};

const it: Dict = {
	live: "LIVE",
	waitingPresenter: "In attesa del presentatore...",
	willStartSoon: "La presentazione inizierà a breve",
	presentationEnded: "Presentazione terminata",
	thankYou: "Grazie per aver partecipato!",
	typeResponse: "Scrivi la tua risposta...",
	submit: "Invia",
	voteSubmitted: "Risposta inviata!",
	liveResults: "Risultati in diretta",
	waitingForResponses: "In attesa di risposte...",
	resultsPrivate: "I risultati sono privati",
	resultsHidden: "Risultati nascosti",
	answerIndependent: "Rispondi in modo indipendente",
	completeAllToSeeResults: "Rispondi a tutte le domande per vedere i risultati",
	gridInstruction: "Posiziona ogni elemento sulla griglia",
	gridNotAssessable: "Non valutabile",
	gridSkipped: "Saltato",
	gridHorizontal: "Orizzontale",
	gridVertical: "Verticale",
	pointsInstruction: "Distribuisci i tuoi punti tra gli elementi",
	pointsRemaining: "rimasti",
	pointsNoneLeft:
		"Nessun punto rimasto — riprendine prima qualcuno da un altro elemento",
	pointsAtZero: "Questo elemento non ha punti da riprendere",
	pointsSpendAll: "Distribuisci tutti i punti per inviare",
	pointsSubmit: "Invia i punti",
	pointsUpdate: "Aggiorna i punti",
	pointsSubmitted: "Punti inviati!",
	guessInstruction: "Inserisci la tua stima",
	guessAllowedRange: "Intervallo consentito",
	guessStepHint: "A passi di",
	guessEnterNumber: "Inserisci un numero per inviare",
	guessWholeNumber: "Inserisci un numero intero",
	guessOutOfRange: "Questo numero è fuori dall'intervallo consentito",
	guessOffStep: "Questo numero non è tra i valori selezionabili",
	guessNoValues:
		"Questa domanda non ha risposte valide — chiedi all'organizzatore di correggere l'intervallo",
	guessSubmit: "Invia la stima",
	guessUpdate: "Aggiorna la stima",
	guessSubmitted: "Stima inviata!",
	pinInstruction: "Tocca l'immagine per posizionare il tuo segnaposto",
	pinPlaced: "Segnaposto posizionato",
	pinHorizontal: "Posizione orizzontale",
	pinVertical: "Posizione verticale",
	pinNoImage: "Questa slide non ha ancora un'immagine — niente da segnare",
	pinInTarget: "Il tuo segnaposto è nell'area corretta",
	pinOutsideTarget: "Il tuo segnaposto è fuori dall'area corretta",
	formInstruction: "Compila il modulo e invialo",
	formRequiredMark: "*",
	formNoFields: "Questa slide non ha ancora campi \u2014 non c'\u00e8 nulla da compilare",
	formEnterSomething: "Compila almeno un campo per inviare",
	formRequiredMissing: "Compila tutti i campi obbligatori per inviare",
	formInvalidEmail: "Non sembra un indirizzo email",
	formAnswerTooLong: "Una delle tue risposte \u00e8 troppo lunga",
	formSubmit: "Invia",
	formUpdate: "Aggiorna le tue risposte",
	formSubmitted: "Inviato \u2014 grazie!",
	formPrivacyNote: "Solo l'organizzatore pu\u00f2 leggere ci\u00f2 che scrivi qui.",
	quizSecondsLeft: "s rimasti",
	quizTimesUp: "Tempo scaduto",
	quizAnswerLocked: "La tua risposta è definitiva",
	quizWindowClosed: "Il tempo per questa domanda è finito",
	participationClosed: "Il relatore ha chiuso questa domanda",
	quizTypeAnswer: "Scrivi la tua risposta...",
	quizSubmitAnswer: "Invia risposta",
	quizCorrect: "Corretto!",
	quizIncorrect: "Non proprio",
	quizNoAnswer: "Nessuna risposta in tempo",
	quizPoints: "punti",
	quizTotalScore: "Il tuo punteggio finora",
	leaderboardTitle: "Classifica",
	leaderboardEmpty:
		"Ancora nessun punteggio — la classifica si riempie man mano che si risponde alle domande del quiz.",
	leaderboardYou: "Tu",
	leaderboardYourPosition: "La tua posizione",
	leaderboardOutOf: "su",
	leaderboardCorrect: "corrette",
	leaderboardMoreRanked: "altri in classifica",
	leaderboardNotRanked:
		"Rispondi a una domanda del quiz per entrare in classifica",
	qaTitle: "Domande",
	qaAsk: "Fai una domanda",
	qaPlaceholder: "Scrivi la tua domanda...",
	qaSubmit: "Invia",
	qaSubmitted: "Domanda inviata!",
	qaAlreadyAsked: "L'hai già chiesta.",
	qaEmpty: "Ancora nessuna domanda — fai la prima.",
	qaEmptyOwn: "Non hai ancora chiesto nulla.",
	qaModeratedNote: "Le tue domande vanno solo al presentatore.",
	qaUpvote: "Sostieni questa domanda",
	qaUpvoteOwn: "La tua domanda — conta già",
	qaAnswered: "Trattata",
	qaOpen: "in attesa",
	reactionsTitle: "Reazioni",
	reactionLike: "Bello",
	reactionLove: "Lo adoro",
	reactionCelebrate: "Festeggia",
	reactionLaugh: "Divertente",
	reactionInsight: "Ottimo punto",
	chatTitle: "Chat",
	chatPlaceholder: "Scrivi qualcosa...",
	chatSend: "Invia",
	chatEmpty: "Ancora niente — inizia la conversazione.",
	chatClosed: "La chat è chiusa. Puoi ancora leggere quello che è stato detto.",
	chatYou: "Tu",
	nameTitle: "Come ti chiami?",
	nameIntro:
		"Questa presentazione chiede a ogni partecipante di indicare il proprio nome. Il tuo nome viene salvato con le tue risposte e mostrato all'organizzatore.",
	namePlaceholder: "Il tuo nome",
	nameContinue: "Continua",
	nameEmpty: "Inserisci il tuo nome per continuare",
	nameJoinedAs: "Sei entrato come",
	nameChange: "Modifica",
	nameCancel: "Annulla",
};

const pt: Dict = {
	live: "AO VIVO",
	waitingPresenter: "Aguardando o apresentador...",
	willStartSoon: "A apresentação começará em breve",
	presentationEnded: "Apresentação encerrada",
	thankYou: "Obrigado por participar!",
	typeResponse: "Digite sua resposta...",
	submit: "Enviar",
	voteSubmitted: "Resposta enviada!",
	liveResults: "Resultados ao vivo",
	waitingForResponses: "Aguardando respostas...",
	resultsPrivate: "Os resultados são privados",
	resultsHidden: "Resultados ocultos",
	answerIndependent: "Responda de forma independente",
	completeAllToSeeResults: "Responda todas as perguntas para ver os resultados",
	gridInstruction: "Posicione cada item na grade",
	gridNotAssessable: "Não avaliável",
	gridSkipped: "Ignorado",
	gridHorizontal: "Horizontal",
	gridVertical: "Vertical",
	pointsInstruction: "Distribua seus pontos entre os itens",
	pointsRemaining: "restantes",
	pointsNoneLeft:
		"Não há mais pontos — retome alguns de outro item primeiro",
	pointsAtZero: "Este item não tem pontos para retomar",
	pointsSpendAll: "Distribua todos os seus pontos para enviar",
	pointsSubmit: "Enviar pontos",
	pointsUpdate: "Atualizar pontos",
	pointsSubmitted: "Pontos enviados!",
	guessInstruction: "Digite sua estimativa",
	guessAllowedRange: "Intervalo permitido",
	guessStepHint: "Em passos de",
	guessEnterNumber: "Digite um número para enviar",
	guessWholeNumber: "Digite um número inteiro",
	guessOutOfRange: "Esse número está fora do intervalo permitido",
	guessOffStep: "Esse número não é um dos valores selecionáveis",
	guessNoValues:
		"Esta pergunta não tem respostas válidas — peça ao organizador para corrigir o intervalo",
	guessSubmit: "Enviar estimativa",
	guessUpdate: "Atualizar estimativa",
	guessSubmitted: "Estimativa enviada!",
	pinInstruction: "Toque na imagem para colocar o seu marcador",
	pinPlaced: "Marcador colocado",
	pinHorizontal: "Posição horizontal",
	pinVertical: "Posição vertical",
	pinNoImage: "Este slide ainda não tem imagem — nada para marcar",
	pinInTarget: "O seu marcador está na área correta",
	pinOutsideTarget: "O seu marcador está fora da área correta",
	formInstruction: "Preencha o formul\u00e1rio e envie",
	formRequiredMark: "*",
	formNoFields: "Este slide ainda n\u00e3o tem campos \u2014 n\u00e3o h\u00e1 nada a preencher",
	formEnterSomething: "Preencha pelo menos um campo para enviar",
	formRequiredMissing: "Preencha todos os campos obrigat\u00f3rios para enviar",
	formInvalidEmail: "Isso n\u00e3o parece um endere\u00e7o de e-mail",
	formAnswerTooLong: "Uma das suas respostas \u00e9 demasiado longa",
	formSubmit: "Enviar",
	formUpdate: "Atualizar as suas respostas",
	formSubmitted: "Enviado \u2014 obrigado!",
	formPrivacyNote: "S\u00f3 o organizador pode ler o que escreve aqui.",
	quizSecondsLeft: "s restantes",
	quizTimesUp: "Tempo esgotado",
	quizAnswerLocked: "A tua resposta é definitiva",
	quizWindowClosed: "O tempo para esta pergunta acabou",
	participationClosed: "O apresentador fechou esta pergunta",
	quizTypeAnswer: "Escreve a tua resposta...",
	quizSubmitAnswer: "Enviar resposta",
	quizCorrect: "Correto!",
	quizIncorrect: "Não é bem isso",
	quizNoAnswer: "Sem resposta a tempo",
	quizPoints: "pontos",
	quizTotalScore: "A tua pontuação até agora",
	leaderboardTitle: "Classificação",
	leaderboardEmpty:
		"Ainda sem pontuações — a classificação preenche-se à medida que as perguntas do quiz são respondidas.",
	leaderboardYou: "Tu",
	leaderboardYourPosition: "A tua posição",
	leaderboardOutOf: "de",
	leaderboardCorrect: "corretas",
	leaderboardMoreRanked: "outros classificados",
	leaderboardNotRanked:
		"Responde a uma pergunta do quiz para entrar na classificação",
	qaTitle: "Perguntas",
	qaAsk: "Fazer uma pergunta",
	qaPlaceholder: "Escreve a tua pergunta...",
	qaSubmit: "Enviar",
	qaSubmitted: "Pergunta enviada!",
	qaAlreadyAsked: "Já fizeste essa pergunta.",
	qaEmpty: "Ainda sem perguntas — faz a primeira.",
	qaEmptyOwn: "Ainda não perguntaste nada.",
	qaModeratedNote: "As tuas perguntas vão apenas para o apresentador.",
	qaUpvote: "Apoiar esta pergunta",
	qaUpvoteOwn: "A tua própria pergunta — já conta",
	qaAnswered: "Respondida",
	qaOpen: "por tratar",
	reactionsTitle: "Reações",
	reactionLike: "Boa",
	reactionLove: "Adorei",
	reactionCelebrate: "Comemorar",
	reactionLaugh: "Engraçado",
	reactionInsight: "Bem observado",
	chatTitle: "Chat",
	chatPlaceholder: "Diga alguma coisa...",
	chatSend: "Enviar",
	chatEmpty: "Nada ainda — comece a conversa.",
	chatClosed: "O chat está fechado. Você ainda pode ler o que foi dito.",
	chatYou: "Você",
	nameTitle: "Como você se chama?",
	nameIntro:
		"Esta apresentação pede que todos os participantes informem o seu nome. O seu nome é guardado com as suas respostas e mostrado ao organizador.",
	namePlaceholder: "O seu nome",
	nameContinue: "Continuar",
	nameEmpty: "Escreva o seu nome para continuar",
	nameJoinedAs: "Entrou como",
	nameChange: "Alterar",
	nameCancel: "Cancelar",
};

const nl: Dict = {
	live: "LIVE",
	waitingPresenter: "Wachten op presentator...",
	willStartSoon: "De presentatie begint zo",
	presentationEnded: "Presentatie beëindigd",
	thankYou: "Bedankt voor je deelname!",
	typeResponse: "Typ je antwoord...",
	submit: "Verzenden",
	voteSubmitted: "Antwoord verzonden!",
	liveResults: "Live-resultaten",
	waitingForResponses: "Wachten op antwoorden...",
	resultsPrivate: "Resultaten zijn privé",
	resultsHidden: "Resultaten verborgen",
	answerIndependent: "Onafhankelijk antwoorden",
	completeAllToSeeResults: "Beantwoord alle vragen om de resultaten te zien",
	gridInstruction: "Plaats elk item in het raster",
	gridNotAssessable: "Niet te beoordelen",
	gridSkipped: "Overgeslagen",
	gridHorizontal: "Horizontaal",
	gridVertical: "Verticaal",
	pointsInstruction: "Verdeel je punten over de items",
	pointsRemaining: "over",
	pointsNoneLeft:
		"Geen punten meer over — haal er eerst wat weg bij een ander item",
	pointsAtZero: "Dit item heeft geen punten om terug te nemen",
	pointsSpendAll: "Verdeel al je punten om te verzenden",
	pointsSubmit: "Punten verzenden",
	pointsUpdate: "Punten bijwerken",
	pointsSubmitted: "Punten verzonden!",
	guessInstruction: "Vul je schatting in",
	guessAllowedRange: "Toegestaan bereik",
	guessStepHint: "In stappen van",
	guessEnterNumber: "Vul een getal in om te verzenden",
	guessWholeNumber: "Vul een heel getal in",
	guessOutOfRange: "Dat getal valt buiten het toegestane bereik",
	guessOffStep: "Dat getal is niet een van de selecteerbare waarden",
	guessNoValues:
		"Deze vraag heeft geen geldige antwoorden — vraag de presentator het bereik te corrigeren",
	guessSubmit: "Schatting verzenden",
	guessUpdate: "Schatting bijwerken",
	guessSubmitted: "Schatting verzonden!",
	pinInstruction: "Tik op de afbeelding om je speld te plaatsen",
	pinPlaced: "Speld geplaatst",
	pinHorizontal: "Horizontale positie",
	pinVertical: "Verticale positie",
	pinNoImage: "Deze slide heeft nog geen afbeelding — niets om te spelden",
	pinInTarget: "Je speld ligt in het doelgebied",
	pinOutsideTarget: "Je speld ligt buiten het doelgebied",
	formInstruction: "Vul het formulier in en verstuur het",
	formRequiredMark: "*",
	formNoFields: "Deze slide heeft nog geen velden \u2014 er is niets in te vullen",
	formEnterSomething: "Vul minstens \u00e9\u00e9n veld in om te versturen",
	formRequiredMissing: "Vul alle verplichte velden in om te versturen",
	formInvalidEmail: "Dat lijkt geen e-mailadres",
	formAnswerTooLong: "Een van je antwoorden is te lang",
	formSubmit: "Versturen",
	formUpdate: "Je antwoorden bijwerken",
	formSubmitted: "Verstuurd \u2014 bedankt!",
	formPrivacyNote: "Alleen de organisator kan lezen wat je hier schrijft.",
	quizSecondsLeft: "s over",
	quizTimesUp: "Tijd voorbij",
	quizAnswerLocked: "Je antwoord staat vast",
	quizWindowClosed: "De tijd voor deze vraag is voorbij",
	participationClosed: "De presentator heeft deze vraag gesloten",
	quizTypeAnswer: "Typ je antwoord...",
	quizSubmitAnswer: "Antwoord verzenden",
	quizCorrect: "Goed!",
	quizIncorrect: "Net niet",
	quizNoAnswer: "Geen antwoord op tijd",
	quizPoints: "punten",
	quizTotalScore: "Je score tot nu toe",
	leaderboardTitle: "Ranglijst",
	leaderboardEmpty:
		"Nog geen scores — de ranglijst vult zich zodra quizvragen beantwoord worden.",
	leaderboardYou: "Jij",
	leaderboardYourPosition: "Jouw positie",
	leaderboardOutOf: "van",
	leaderboardCorrect: "goed",
	leaderboardMoreRanked: "anderen op de ranglijst",
	leaderboardNotRanked: "Beantwoord een quizvraag om op de ranglijst te komen",
	qaTitle: "Vragen",
	qaAsk: "Stel een vraag",
	qaPlaceholder: "Typ je vraag...",
	qaSubmit: "Versturen",
	qaSubmitted: "Vraag verstuurd!",
	qaAlreadyAsked: "Die vraag heb je al gesteld.",
	qaEmpty: "Nog geen vragen — stel de eerste.",
	qaEmptyOwn: "Je hebt nog niets gevraagd.",
	qaModeratedNote: "Je vragen gaan alleen naar de presentator.",
	qaUpvote: "Deze vraag steunen",
	qaUpvoteOwn: "Je eigen vraag — die telt al mee",
	qaAnswered: "Behandeld",
	qaOpen: "open",
	reactionsTitle: "Reacties",
	reactionLike: "Mooi",
	reactionLove: "Geweldig",
	reactionCelebrate: "Vieren",
	reactionLaugh: "Grappig",
	reactionInsight: "Goed punt",
	chatTitle: "Chat",
	chatPlaceholder: "Zeg iets...",
	chatSend: "Verzenden",
	chatEmpty: "Nog niets gezegd — begin het gesprek.",
	chatClosed: "De chat is gesloten. Je kunt nog wel meelezen.",
	chatYou: "Jij",
	nameTitle: "Hoe heet je?",
	nameIntro:
		"Deze presentatie vraagt iedereen die deelneemt om een naam. Je naam wordt bij je antwoorden bewaard en aan de organisator getoond.",
	namePlaceholder: "Je naam",
	nameContinue: "Doorgaan",
	nameEmpty: "Vul je naam in om door te gaan",
	nameJoinedAs: "Deelgenomen als",
	nameChange: "Wijzigen",
	nameCancel: "Annuleren",
};

const dicts: Record<string, Dict> = { en, de, fr, es, it, pt, nl };

/** Resolve a translation dictionary for a BCP-47-ish language tag. */
export function getDict(lang?: string): Dict {
	if (!lang) return en;
	// Accept both "en" and "en-US" style tags.
	const primary = lang.toLowerCase().split("-")[0];
	return dicts[primary] ?? en;
}
