// ── Minimal participant-facing i18n (REQ084) ────────────────
//
// Presenters choose a language per presentation (in CreatePage). That
// language is stored on the Presentation and used by ParticipantPage to
// localize UI strings. English is the fallback for any missing key or
// unknown language tag.

import { participantLanguageFor } from "./types";

export type Lang = "en" | "de" | "fr" | "es" | "it" | "pt" | "nl";

/**
 * A counted phrase in its two forms (REQ225). `{count}` is the number. Every
 * supported language words a count as "one" or "other" — French and
 * Portuguese read 0 as "one", and the "many" some of them use for round
 * millions is worded as "other" — so the forms are chosen by the language's
 * own plural rules ({@link countPhrase}), never by `count === 1`.
 */
export type PluralForms = { one: string; other: string };

export type Dict = {
	/** The dictionary's own language: what {@link countPhrase} reads plurals by. */
	locale: Lang;
	live: string;
	waitingPresenter: string;
	willStartSoon: string;
	presentationEnded: string;
	thankYou: string;
	/**
	 * The ended screen's way onward (REQ200): to the product website's home in
	 * the deck's language when the instance names one, the app's own home
	 * otherwise. Neutral and navigational. `{brand}` is the product's name.
	 */
	goToHomepage: string;
	typeResponse: string;
	submit: string;
	voteSubmitted: string;
	liveResults: string;
	waitingForResponses: string;
	resultsPrivate: string;
	resultsHidden: string;
	/**
	 * The profanity filter's line under a free-text tally (REQ085), followed by
	 * the count: "Answers withheld by the profanity filter: 2". A label and a
	 * number rather than a sentence, so no language needs a plural form.
	 */
	answersFiltered: string;
	answerIndependent: string;
	completeAllToSeeResults: string;
	/**
	 * Going through an audience-paced deck again (REQ083). `passIntro` is what
	 * the end of the deck says when the organizer allows it — that what was just
	 * answered is kept, so answering again cannot read as starting over;
	 * `passReachEnd` is why the control is disabled until the participant gets
	 * there, never a hidden button; `passStarted` confirms the new pass; and
	 * `passOff` is what a phone is told when the organizer has just stopped
	 * allowing it, rather than a control that silently does nothing.
	 */
	passIntro: string;
	passStartAgain: string;
	passReachEnd: string;
	passStarted: string;
	passOff: string;
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
	 * What a screen reader hears when the countdown crosses a threshold
	 * (REQ221) — spelled out in full, because the visible "12s left" is read as
	 * a letter. `{seconds}` is the number.
	 */
	quizSecondsLeftSpoken: string;
	/**
	 * The short state an answer is in between the tap and the server's reply
	 * (REQ224): drawn on the chosen card and announced, so a slow network is
	 * not a screen that has simply stopped responding.
	 */
	answerSending: string;
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
	 * What a row is called when its holder stated no name (REQ059, REQ218):
	 * the derived handle, worded in the deck's language. `{handle}` is the six
	 * characters the server derived.
	 */
	leaderboardPlayer: string;
	/**
	 * The caption under the board's heading on the shared screen. Counted by the
	 * quiz questions; `{shown}` is how many rows the board draws.
	 */
	leaderboardTopAcross: PluralForms;
	/**
	 * A slide's results as the room reads them, on the phone and on the shared
	 * screen alike (REQ225) — the response count over the tally, the solution
	 * mark, and the quiz's score note. `resultsFromParticipants` follows the
	 * count on an "all that apply" slide (REQ014).
	 */
	resultsResponseCount: PluralForms;
	resultsFromParticipants: PluralForms;
	resultsCorrectMark: string;
	resultsCorrectAnswer: string;
	/** The accessible names of the drawn charts: a dot cluster's option, a disc. */
	resultsVoteCount: PluralForms;
	resultsPieChart: string;
	resultsDonutChart: string;
	/**
	 * What the shared screen shows in place of a quiz question's tally while the
	 * room is still answering it (REQ214) — timed, or open until closed by hand —
	 * and in place of a leaderboard nobody has scored on yet.
	 */
	resultsAppearWhenTimeUp: string;
	resultsAppearWhenClosed: string;
	waitingForScores: string;
	/**
	 * A typed quiz question's results (REQ055): nothing yet, how many answers
	 * are in while they are withheld, and the key once it may be shown —
	 * `{answers}` is the accepted spellings, already joined.
	 */
	quizNoAnswersYet: string;
	quizAnswersPending: PluralForms;
	quizAccepted: string;
	/**
	 * The room's score under a quiz question (REQ056): "{correct} of {answered}"
	 * is drawn highlighted, and the words after it agree with `{correct}` —
	 * counted by the right answers, so a language whose verb takes the number
	 * says so.
	 */
	quizScoreCorrect: string;
	quizScoreAnsweredCorrectly: PluralForms;
	quizScoreAverage: string;
	/**
	 * The app menu where the room meets it (REQ183, REQ185): the trigger's name
	 * with and without the feedback item, the backdrop that closes it, and what
	 * the panel holds. The legal texts' names are the operator's documents,
	 * worded as each language calls them.
	 */
	menuName: string;
	menuNameWithFeedback: string;
	menuClose: string;
	menuCloseWithFeedback: string;
	menuAppearance: string;
	themeLight: string;
	themeDark: string;
	themeAuto: string;
	menuSendFeedback: string;
	menuLegal: string;
	legalImprint: string;
	legalPrivacy: string;
	legalTerms: string;
	opensInNewTab: string;
	feedbackDialogClose: string;
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
	/**
	 * The prompt after a session (REQ186): the card on the ended screen that asks
	 * about omul itself, not about the deck. `feedbackPromptIntro` says who reads
	 * the answer and that it is anonymous — the card's own look says it is not
	 * the organizer's question, and this sentence says it in words.
	 * `feedbackPromptDismiss` names the card's close control, which has no text
	 * of its own.
	 */
	feedbackPromptHeading: string;
	feedbackPromptIntro: string;
	feedbackPromptDismiss: string;
	/**
	 * The shared feedback form's own words (REQ185), as the card shows them.
	 * `feedbackStarOf` is a template: `{star}` and `{total}` are replaced, since
	 * word order and case differ per language. Every `{brand}` in these keys is
	 * the product's name, filled from `BRAND_NAME` where it is read. `feedbackNotSent` leads the
	 * server's reason; `feedbackNotSentRetry` stands alone when there is none.
	 */
	feedbackRating: string;
	feedbackOptional: string;
	feedbackStarOf: string;
	feedbackComment: string;
	feedbackCommentPlaceholder: string;
	feedbackSend: string;
	feedbackSending: string;
	feedbackSendWhy: string;
	feedbackSent: string;
	feedbackSentDetail: string;
	feedbackClose: string;
	feedbackNotSent: string;
	feedbackNotSentRetry: string;
	/**
	 * The home page's offer to add an email address (REQ194), shown to a
	 * browser that holds decks without an account. `emailRecoveryDismiss` names
	 * the notice's close control, which has no text of its own — and the close is
	 * remembered, so it says "hide", never "not now".
	 */
	emailRecoveryText: string;
	emailRecoveryAction: string;
	/**
	 * The same offer to a browser that has had an account: it asks to sign in,
	 * since creating an account would refuse the address already registered.
	 */
	emailRecoverySignInText: string;
	emailRecoverySignInAction: string;
	emailRecoveryDismiss: string;
	/**
	 * A deck that requires signing in (REQ134), turning away a participant with
	 * no account: what it asks, and the control that opens the sign-in dialog —
	 * which brings them back to this deck. `signInMismatch*` is what a device is
	 * told when it already took part here under another account, and
	 * `signInSwitchAccount` signs out so the right one can sign in.
	 */
	signInTitle: string;
	signInIntro: string;
	signInAction: string;
	signInMismatchTitle: string;
	signInMismatchIntro: string;
	signInSwitchAccount: string;
};

const en: Dict = {
	locale: "en",
	live: "LIVE",
	waitingPresenter: "Waiting for presenter...",
	willStartSoon: "The presentation will start soon",
	presentationEnded: "Presentation Ended",
	thankYou: "Thank you for participating!",
	goToHomepage: "Go to the {brand} homepage",
	typeResponse: "Type your response...",
	submit: "Submit",
	voteSubmitted: "Vote submitted!",
	liveResults: "Live results",
	waitingForResponses: "Waiting for responses...",
	resultsPrivate: "Results are private",
	resultsHidden: "Results are hidden",
	answersFiltered: "Answers withheld by the profanity filter",
	answerIndependent: "Answer independently",
	completeAllToSeeResults: "Answer all questions to see results",
	passIntro:
		"You've reached the end. Your answers are saved — you can go through this presentation again, and your new answers are kept as a separate response.",
	passStartAgain: "Answer again",
	passReachEnd: "Reach the last slide to answer again",
	passStarted: "Starting again — your earlier answers are kept",
	passOff: "The organizer no longer allows answering again",
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
	quizSecondsLeftSpoken: "{seconds} seconds left",
	answerSending: "Sending…",
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
	leaderboardPlayer: "Player {handle}",
	leaderboardTopAcross: {
		one: "Top {shown} across {count} quiz question",
		other: "Top {shown} across {count} quiz questions",
	},
	resultsResponseCount: {
		one: "{count} response",
		other: "{count} responses",
	},
	resultsFromParticipants: {
		one: "from {count} participant",
		other: "from {count} participants",
	},
	resultsCorrectMark: "correct",
	resultsCorrectAnswer: "Correct answer",
	resultsVoteCount: {
		one: "{count} vote",
		other: "{count} votes",
	},
	resultsPieChart: "Pie chart of results",
	resultsDonutChart: "Donut chart of results",
	resultsAppearWhenTimeUp: "Results appear when the time is up.",
	resultsAppearWhenClosed: "Results appear once the question is closed to answers.",
	waitingForScores: "Waiting for scores...",
	quizNoAnswersYet: "No answers yet",
	quizAnswersPending: {
		one: "{count} answer in — it appears once the question is over.",
		other: "{count} answers in — they appear once the question is over.",
	},
	quizAccepted: "Accepted: {answers}",
	quizScoreCorrect: "{correct} of {answered}",
	quizScoreAnsweredCorrectly: {
		one: "answered correctly",
		other: "answered correctly",
	},
	quizScoreAverage: "{average} of {max} points on average",
	menuName: "Appearance and legal",
	menuNameWithFeedback: "Appearance, feedback and legal",
	menuClose: "Close appearance and legal menu",
	menuCloseWithFeedback: "Close appearance, feedback and legal menu",
	menuAppearance: "Appearance",
	themeLight: "Light",
	themeDark: "Dark",
	themeAuto: "Auto",
	menuSendFeedback: "Send feedback",
	menuLegal: "Legal",
	legalImprint: "Imprint",
	legalPrivacy: "Privacy Policy",
	legalTerms: "Terms of Service",
	opensInNewTab: "(opens in a new tab)",
	feedbackDialogClose: "Close feedback",
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
	feedbackPromptHeading: "How did you find {brand}, the tool behind this session?",
	feedbackPromptIntro: "Your answer is anonymous and goes to the people who run {brand} here, not to the organizers of this event.",
	feedbackPromptDismiss: "Close without answering",
	feedbackRating: "Rating",
	feedbackOptional: "(optional)",
	feedbackStarOf: "{star} of {total} stars",
	feedbackComment: "Comment",
	feedbackCommentPlaceholder: "What works, what gets in the way, what's missing?",
	feedbackSend: "Send feedback",
	feedbackSending: "Sending…",
	feedbackSendWhy: "Add a rating or a comment to send.",
	feedbackSent: "Thank you — it's sent.",
	feedbackSentDetail: "The people who run {brand} here will read it.",
	feedbackClose: "Close",
	feedbackNotSent: "Not sent",
	feedbackNotSentRetry: "Not sent. Please try again.",
	emailRecoveryText:
		"Your presentations are saved only in this browser. If its data is cleared, they are gone for good. Add your email to keep them in an account.",
	emailRecoveryAction: "Add email",
	emailRecoverySignInText:
		"These presentations are saved only in this browser. If its data is cleared, they are gone for good. Sign in to keep them in your account.",
	emailRecoverySignInAction: "Sign in",
	emailRecoveryDismiss: "Hide this notice",
	signInTitle: "Sign in to take part",
	signInIntro:
		"This presentation is open to signed-in participants only. Sign in or create an account, and you will come straight back here.",
	signInAction: "Sign in",
	signInMismatchTitle: "Signed in as someone else",
	signInMismatchIntro:
		"This device already took part in this presentation under a different account. Switch to that account to continue.",
	signInSwitchAccount: "Switch account",
};

const de: Dict = {
	locale: "de",
	live: "LIVE",
	waitingPresenter: "Warte auf Moderator...",
	willStartSoon: "Die Präsentation beginnt gleich",
	presentationEnded: "Präsentation beendet",
	thankYou: "Danke für deine Teilnahme!",
	goToHomepage: "Zur {brand}-Startseite",
	typeResponse: "Antwort eingeben...",
	submit: "Absenden",
	voteSubmitted: "Antwort gesendet!",
	liveResults: "Live-Ergebnisse",
	waitingForResponses: "Warte auf Antworten...",
	resultsPrivate: "Ergebnisse sind privat",
	resultsHidden: "Ergebnisse ausgeblendet",
	answersFiltered: "Vom Schimpfwortfilter zurückgehaltene Antworten",
	answerIndependent: "Unabhängig antworten",
	completeAllToSeeResults: "Beantworte alle Fragen, um die Ergebnisse zu sehen",
	passIntro:
		"Du bist am Ende angekommen. Deine Antworten sind gespeichert – du kannst die Präsentation noch einmal durchgehen, und deine neuen Antworten werden getrennt davon gespeichert.",
	passStartAgain: "Erneut antworten",
	passReachEnd: "Geh bis zur letzten Folie, um erneut zu antworten",
	passStarted: "Neuer Durchgang – deine bisherigen Antworten bleiben erhalten",
	passOff: "Der Veranstalter erlaubt kein erneutes Antworten mehr",
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
	quizSecondsLeftSpoken: "Noch {seconds} Sekunden",
	answerSending: "Wird gesendet …",
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
	leaderboardPlayer: "Spieler {handle}",
	leaderboardTopAcross: {
		one: "Top {shown} aus {count} Quizfrage",
		other: "Top {shown} aus {count} Quizfragen",
	},
	resultsResponseCount: {
		one: "{count} Antwort",
		other: "{count} Antworten",
	},
	resultsFromParticipants: {
		one: "von {count} Person",
		other: "von {count} Personen",
	},
	resultsCorrectMark: "richtig",
	resultsCorrectAnswer: "Richtige Antwort",
	resultsVoteCount: {
		one: "{count} Stimme",
		other: "{count} Stimmen",
	},
	resultsPieChart: "Kreisdiagramm der Ergebnisse",
	resultsDonutChart: "Ringdiagramm der Ergebnisse",
	resultsAppearWhenTimeUp: "Die Ergebnisse erscheinen, wenn die Zeit abgelaufen ist.",
	resultsAppearWhenClosed: "Die Ergebnisse erscheinen, sobald die Frage für Antworten geschlossen ist.",
	waitingForScores: "Warte auf Punkte...",
	quizNoAnswersYet: "Noch keine Antworten",
	quizAnswersPending: {
		one: "{count} Antwort eingegangen — sie erscheint, sobald die Frage vorbei ist.",
		other: "{count} Antworten eingegangen — sie erscheinen, sobald die Frage vorbei ist.",
	},
	quizAccepted: "Akzeptiert: {answers}",
	quizScoreCorrect: "{correct} von {answered}",
	quizScoreAnsweredCorrectly: {
		one: "richtig beantwortet",
		other: "richtig beantwortet",
	},
	quizScoreAverage: "im Schnitt {average} von {max} Punkten",
	menuName: "Darstellung und Rechtliches",
	menuNameWithFeedback: "Darstellung, Feedback und Rechtliches",
	menuClose: "Menü „Darstellung und Rechtliches“ schließen",
	menuCloseWithFeedback: "Menü „Darstellung, Feedback und Rechtliches“ schließen",
	menuAppearance: "Darstellung",
	themeLight: "Hell",
	themeDark: "Dunkel",
	themeAuto: "Auto",
	menuSendFeedback: "Feedback senden",
	menuLegal: "Rechtliches",
	legalImprint: "Impressum",
	legalPrivacy: "Datenschutzerklärung",
	legalTerms: "Nutzungsbedingungen",
	opensInNewTab: "(öffnet in einem neuen Tab)",
	feedbackDialogClose: "Feedback schließen",
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
	feedbackPromptHeading: "Wie fandest du {brand}, das Tool hinter dieser Session?",
	feedbackPromptIntro: "Deine Antwort ist anonym und geht an die Betreiber von {brand} hier, nicht an die Veranstalter dieses Events.",
	feedbackPromptDismiss: "Schließen, ohne zu antworten",
	feedbackRating: "Bewertung",
	feedbackOptional: "(optional)",
	feedbackStarOf: "{star} von {total} Sternen",
	feedbackComment: "Kommentar",
	feedbackCommentPlaceholder: "Was funktioniert, was stört, was fehlt?",
	feedbackSend: "Feedback senden",
	feedbackSending: "Wird gesendet…",
	feedbackSendWhy: "Gib eine Bewertung oder einen Kommentar ein, um zu senden.",
	feedbackSent: "Danke — ist gesendet.",
	feedbackSentDetail: "Die Betreiber von {brand} hier werden es lesen.",
	feedbackClose: "Schließen",
	feedbackNotSent: "Nicht gesendet",
	feedbackNotSentRetry: "Nicht gesendet. Bitte versuch es noch einmal.",
	emailRecoveryText:
		"Deine Präsentationen sind nur in diesem Browser gespeichert. Werden seine Daten gelöscht, sind sie unwiederbringlich verloren. Hinterlege deine E-Mail-Adresse, um sie in einem Konto zu behalten.",
	emailRecoveryAction: "E-Mail hinterlegen",
	emailRecoverySignInText:
		"Diese Präsentationen sind nur in diesem Browser gespeichert. Werden seine Daten gelöscht, sind sie unwiederbringlich verloren. Melde dich an, um sie in deinem Konto zu behalten.",
	emailRecoverySignInAction: "Anmelden",
	emailRecoveryDismiss: "Hinweis ausblenden",
	signInTitle: "Melde dich an, um teilzunehmen",
	signInIntro:
		"An dieser Präsentation können nur angemeldete Personen teilnehmen. Melde dich an oder erstelle ein Konto, dann kommst du direkt hierher zurück.",
	signInAction: "Anmelden",
	signInMismatchTitle: "Mit einem anderen Konto angemeldet",
	signInMismatchIntro:
		"Dieses Gerät hat an dieser Präsentation bereits mit einem anderen Konto teilgenommen. Wechsle zu diesem Konto, um fortzufahren.",
	signInSwitchAccount: "Konto wechseln",
};

const fr: Dict = {
	locale: "fr",
	live: "EN DIRECT",
	waitingPresenter: "En attente du présentateur...",
	willStartSoon: "La présentation va commencer",
	presentationEnded: "Présentation terminée",
	thankYou: "Merci d'avoir participé !",
	goToHomepage: "Aller à la page d'accueil de {brand}",
	typeResponse: "Tapez votre réponse...",
	submit: "Envoyer",
	voteSubmitted: "Réponse envoyée !",
	liveResults: "Résultats en direct",
	waitingForResponses: "En attente de réponses...",
	resultsPrivate: "Les résultats sont privés",
	resultsHidden: "Résultats masqués",
	answersFiltered: "Réponses retenues par le filtre anti-grossièretés",
	answerIndependent: "Répondez de façon indépendante",
	completeAllToSeeResults:
		"Répondez à toutes les questions pour voir les résultats",
	passIntro:
		"Vous êtes arrivé à la fin. Vos réponses sont enregistrées — vous pouvez parcourir à nouveau cette présentation, et vos nouvelles réponses seront conservées séparément.",
	passStartAgain: "Répondre à nouveau",
	passReachEnd: "Allez jusqu'à la dernière diapositive pour répondre à nouveau",
	passStarted: "Nouveau passage — vos réponses précédentes sont conservées",
	passOff: "L'organisateur ne permet plus de répondre à nouveau",
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
	quizSecondsLeftSpoken: "Plus que {seconds} secondes",
	answerSending: "Envoi…",
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
	leaderboardPlayer: "Joueur {handle}",
	leaderboardTopAcross: {
		one: "Top {shown} sur {count} question de quiz",
		other: "Top {shown} sur {count} questions de quiz",
	},
	resultsResponseCount: {
		one: "{count} réponse",
		other: "{count} réponses",
	},
	resultsFromParticipants: {
		one: "de {count} participant",
		other: "de {count} participants",
	},
	resultsCorrectMark: "correct",
	resultsCorrectAnswer: "Bonne réponse",
	resultsVoteCount: {
		one: "{count} vote",
		other: "{count} votes",
	},
	resultsPieChart: "Graphique en secteurs des résultats",
	resultsDonutChart: "Graphique en anneau des résultats",
	resultsAppearWhenTimeUp: "Les résultats s'affichent quand le temps est écoulé.",
	resultsAppearWhenClosed: "Les résultats s'affichent une fois la question fermée aux réponses.",
	waitingForScores: "En attente des scores...",
	quizNoAnswersYet: "Pas encore de réponse",
	quizAnswersPending: {
		one: "{count} réponse reçue — elle s'affichera à la fin de la question.",
		other: "{count} réponses reçues — elles s'afficheront à la fin de la question.",
	},
	quizAccepted: "Réponses acceptées : {answers}",
	quizScoreCorrect: "{correct} sur {answered}",
	quizScoreAnsweredCorrectly: {
		one: "a bien répondu",
		other: "ont bien répondu",
	},
	quizScoreAverage: "{average} points sur {max} en moyenne",
	menuName: "Apparence et informations légales",
	menuNameWithFeedback: "Apparence, avis et informations légales",
	menuClose: "Fermer le menu Apparence et informations légales",
	menuCloseWithFeedback: "Fermer le menu Apparence, avis et informations légales",
	menuAppearance: "Apparence",
	themeLight: "Clair",
	themeDark: "Sombre",
	themeAuto: "Auto",
	menuSendFeedback: "Envoyer un avis",
	menuLegal: "Informations légales",
	legalImprint: "Mentions légales",
	legalPrivacy: "Politique de confidentialité",
	legalTerms: "Conditions d'utilisation",
	opensInNewTab: "(s'ouvre dans un nouvel onglet)",
	feedbackDialogClose: "Fermer l'avis",
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
	feedbackPromptHeading: "Qu'avez-vous pensé d'{brand}, l'outil derrière cette session ?",
	feedbackPromptIntro: "Votre réponse est anonyme et va aux personnes qui gèrent {brand} ici, pas aux organisateurs de cet événement.",
	feedbackPromptDismiss: "Fermer sans répondre",
	feedbackRating: "Note",
	feedbackOptional: "(facultatif)",
	feedbackStarOf: "{star} sur {total} étoiles",
	feedbackComment: "Commentaire",
	feedbackCommentPlaceholder: "Qu'est-ce qui fonctionne, qu'est-ce qui gêne, qu'est-ce qui manque ?",
	feedbackSend: "Envoyer l'avis",
	feedbackSending: "Envoi…",
	feedbackSendWhy: "Ajoutez une note ou un commentaire pour envoyer.",
	feedbackSent: "Merci — c'est envoyé.",
	feedbackSentDetail: "Les personnes qui gèrent {brand} ici le liront.",
	feedbackClose: "Fermer",
	feedbackNotSent: "Non envoyé",
	feedbackNotSentRetry: "Non envoyé. Veuillez réessayer.",
	emailRecoveryText:
		"Vos présentations sont enregistrées uniquement dans ce navigateur. Si ses données sont effacées, elles sont perdues définitivement. Ajoutez votre adresse e-mail pour les conserver dans un compte.",
	emailRecoveryAction: "Ajouter un e-mail",
	emailRecoverySignInText:
		"Ces présentations sont enregistrées uniquement dans ce navigateur. Si ses données sont effacées, elles sont perdues définitivement. Connectez-vous pour les conserver dans votre compte.",
	emailRecoverySignInAction: "Se connecter",
	emailRecoveryDismiss: "Masquer ce message",
	signInTitle: "Connectez-vous pour participer",
	signInIntro:
		"Cette présentation est réservée aux participants connectés. Connectez-vous ou créez un compte, puis vous reviendrez directement ici.",
	signInAction: "Se connecter",
	signInMismatchTitle: "Connecté avec un autre compte",
	signInMismatchIntro:
		"Cet appareil a déjà participé à cette présentation avec un autre compte. Passez à ce compte pour continuer.",
	signInSwitchAccount: "Changer de compte",
};

const es: Dict = {
	locale: "es",
	live: "EN VIVO",
	waitingPresenter: "Esperando al presentador...",
	willStartSoon: "La presentación comenzará pronto",
	presentationEnded: "Presentación finalizada",
	thankYou: "¡Gracias por participar!",
	goToHomepage: "Ir a la página de inicio de {brand}",
	typeResponse: "Escribe tu respuesta...",
	submit: "Enviar",
	voteSubmitted: "¡Respuesta enviada!",
	liveResults: "Resultados en vivo",
	waitingForResponses: "Esperando respuestas...",
	resultsPrivate: "Los resultados son privados",
	resultsHidden: "Resultados ocultos",
	answersFiltered: "Respuestas retenidas por el filtro de palabrotas",
	answerIndependent: "Responde de forma independiente",
	completeAllToSeeResults:
		"Responde todas las preguntas para ver los resultados",
	passIntro:
		"Has llegado al final. Tus respuestas están guardadas: puedes recorrer de nuevo esta presentación y tus nuevas respuestas se guardarán por separado.",
	passStartAgain: "Responder de nuevo",
	passReachEnd: "Llega a la última diapositiva para responder de nuevo",
	passStarted: "Nueva ronda: tus respuestas anteriores se conservan",
	passOff: "El organizador ya no permite responder de nuevo",
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
	quizSecondsLeftSpoken: "Quedan {seconds} segundos",
	answerSending: "Enviando…",
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
	leaderboardPlayer: "Jugador {handle}",
	leaderboardTopAcross: {
		one: "Top {shown} de {count} pregunta de quiz",
		other: "Top {shown} de {count} preguntas de quiz",
	},
	resultsResponseCount: {
		one: "{count} respuesta",
		other: "{count} respuestas",
	},
	resultsFromParticipants: {
		one: "de {count} participante",
		other: "de {count} participantes",
	},
	resultsCorrectMark: "correcta",
	resultsCorrectAnswer: "Respuesta correcta",
	resultsVoteCount: {
		one: "{count} voto",
		other: "{count} votos",
	},
	resultsPieChart: "Gráfico circular de los resultados",
	resultsDonutChart: "Gráfico de anillo de los resultados",
	resultsAppearWhenTimeUp: "Los resultados aparecen cuando se acaba el tiempo.",
	resultsAppearWhenClosed: "Los resultados aparecen cuando la pregunta se cierra a las respuestas.",
	waitingForScores: "Esperando puntuaciones...",
	quizNoAnswersYet: "Aún no hay respuestas",
	quizAnswersPending: {
		one: "{count} respuesta recibida — aparecerá cuando termine la pregunta.",
		other: "{count} respuestas recibidas — aparecerán cuando termine la pregunta.",
	},
	quizAccepted: "Respuestas aceptadas: {answers}",
	quizScoreCorrect: "{correct} de {answered}",
	quizScoreAnsweredCorrectly: {
		one: "respondió correctamente",
		other: "respondieron correctamente",
	},
	quizScoreAverage: "{average} de {max} puntos de media",
	menuName: "Apariencia e información legal",
	menuNameWithFeedback: "Apariencia, opinión e información legal",
	menuClose: "Cerrar el menú Apariencia e información legal",
	menuCloseWithFeedback: "Cerrar el menú Apariencia, opinión e información legal",
	menuAppearance: "Apariencia",
	themeLight: "Claro",
	themeDark: "Oscuro",
	themeAuto: "Auto",
	menuSendFeedback: "Enviar opinión",
	menuLegal: "Información legal",
	legalImprint: "Aviso legal",
	legalPrivacy: "Política de privacidad",
	legalTerms: "Condiciones de uso",
	opensInNewTab: "(se abre en una pestaña nueva)",
	feedbackDialogClose: "Cerrar la opinión",
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
	feedbackPromptHeading: "¿Qué te ha parecido {brand}, la herramienta detrás de esta sesión?",
	feedbackPromptIntro: "Tu respuesta es anónima y llega a quienes gestionan {brand} aquí, no a los organizadores de este evento.",
	feedbackPromptDismiss: "Cerrar sin responder",
	feedbackRating: "Valoración",
	feedbackOptional: "(opcional)",
	feedbackStarOf: "{star} de {total} estrellas",
	feedbackComment: "Comentario",
	feedbackCommentPlaceholder: "¿Qué funciona, qué estorba, qué falta?",
	feedbackSend: "Enviar opinión",
	feedbackSending: "Enviando…",
	feedbackSendWhy: "Añade una valoración o un comentario para enviar.",
	feedbackSent: "Gracias — ya está enviado.",
	feedbackSentDetail: "Quienes gestionan {brand} aquí lo leerán.",
	feedbackClose: "Cerrar",
	feedbackNotSent: "No enviado",
	feedbackNotSentRetry: "No enviado. Inténtalo de nuevo.",
	emailRecoveryText:
		"Tus presentaciones solo se guardan en este navegador. Si se borran sus datos, se pierden para siempre. Añade tu correo electrónico para conservarlas en una cuenta.",
	emailRecoveryAction: "Añadir correo",
	emailRecoverySignInText:
		"Estas presentaciones solo se guardan en este navegador. Si se borran sus datos, se pierden para siempre. Inicia sesión para conservarlas en tu cuenta.",
	emailRecoverySignInAction: "Iniciar sesión",
	emailRecoveryDismiss: "Ocultar este aviso",
	signInTitle: "Inicia sesión para participar",
	signInIntro:
		"Esta presentación solo está abierta a participantes con sesión iniciada. Inicia sesión o crea una cuenta y volverás directamente aquí.",
	signInAction: "Iniciar sesión",
	signInMismatchTitle: "Sesión iniciada con otra cuenta",
	signInMismatchIntro:
		"Este dispositivo ya participó en esta presentación con otra cuenta. Cambia a esa cuenta para continuar.",
	signInSwitchAccount: "Cambiar de cuenta",
};

const it: Dict = {
	locale: "it",
	live: "LIVE",
	waitingPresenter: "In attesa del presentatore...",
	willStartSoon: "La presentazione inizierà a breve",
	presentationEnded: "Presentazione terminata",
	thankYou: "Grazie per aver partecipato!",
	goToHomepage: "Vai alla home page di {brand}",
	typeResponse: "Scrivi la tua risposta...",
	submit: "Invia",
	voteSubmitted: "Risposta inviata!",
	liveResults: "Risultati in diretta",
	waitingForResponses: "In attesa di risposte...",
	resultsPrivate: "I risultati sono privati",
	resultsHidden: "Risultati nascosti",
	answersFiltered: "Risposte trattenute dal filtro antivolgarità",
	answerIndependent: "Rispondi in modo indipendente",
	completeAllToSeeResults: "Rispondi a tutte le domande per vedere i risultati",
	passIntro:
		"Sei arrivato alla fine. Le tue risposte sono salvate: puoi ripercorrere questa presentazione e le nuove risposte verranno conservate separatamente.",
	passStartAgain: "Rispondi di nuovo",
	passReachEnd: "Arriva all'ultima slide per rispondere di nuovo",
	passStarted: "Nuovo giro: le tue risposte precedenti restano salvate",
	passOff: "L'organizzatore non consente più di rispondere di nuovo",
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
	quizSecondsLeftSpoken: "Mancano {seconds} secondi",
	answerSending: "Invio in corso…",
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
	leaderboardPlayer: "Giocatore {handle}",
	leaderboardTopAcross: {
		one: "Top {shown} su {count} domanda del quiz",
		other: "Top {shown} su {count} domande del quiz",
	},
	resultsResponseCount: {
		one: "{count} risposta",
		other: "{count} risposte",
	},
	resultsFromParticipants: {
		one: "da {count} partecipante",
		other: "da {count} partecipanti",
	},
	resultsCorrectMark: "corretta",
	resultsCorrectAnswer: "Risposta corretta",
	resultsVoteCount: {
		one: "{count} voto",
		other: "{count} voti",
	},
	resultsPieChart: "Grafico a torta dei risultati",
	resultsDonutChart: "Grafico ad anello dei risultati",
	resultsAppearWhenTimeUp: "I risultati compaiono allo scadere del tempo.",
	resultsAppearWhenClosed: "I risultati compaiono quando la domanda viene chiusa alle risposte.",
	waitingForScores: "In attesa dei punteggi...",
	quizNoAnswersYet: "Ancora nessuna risposta",
	quizAnswersPending: {
		one: "{count} risposta arrivata — comparirà al termine della domanda.",
		other: "{count} risposte arrivate — compariranno al termine della domanda.",
	},
	quizAccepted: "Risposte accettate: {answers}",
	quizScoreCorrect: "{correct} su {answered}",
	quizScoreAnsweredCorrectly: {
		one: "ha risposto correttamente",
		other: "hanno risposto correttamente",
	},
	quizScoreAverage: "{average} punti su {max} in media",
	menuName: "Aspetto e note legali",
	menuNameWithFeedback: "Aspetto, feedback e note legali",
	menuClose: "Chiudi il menu Aspetto e note legali",
	menuCloseWithFeedback: "Chiudi il menu Aspetto, feedback e note legali",
	menuAppearance: "Aspetto",
	themeLight: "Chiaro",
	themeDark: "Scuro",
	themeAuto: "Auto",
	menuSendFeedback: "Invia feedback",
	menuLegal: "Note legali",
	legalImprint: "Colophon",
	legalPrivacy: "Informativa sulla privacy",
	legalTerms: "Termini di servizio",
	opensInNewTab: "(si apre in una nuova scheda)",
	feedbackDialogClose: "Chiudi il feedback",
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
	feedbackPromptHeading: "Cosa ne pensi di {brand}, lo strumento dietro questa sessione?",
	feedbackPromptIntro: "La tua risposta è anonima e va a chi gestisce {brand} qui, non agli organizzatori di questo evento.",
	feedbackPromptDismiss: "Chiudi senza rispondere",
	feedbackRating: "Valutazione",
	feedbackOptional: "(facoltativo)",
	feedbackStarOf: "{star} su {total} stelle",
	feedbackComment: "Commento",
	feedbackCommentPlaceholder: "Cosa funziona, cosa ostacola, cosa manca?",
	feedbackSend: "Invia feedback",
	feedbackSending: "Invio…",
	feedbackSendWhy: "Aggiungi una valutazione o un commento per inviare.",
	feedbackSent: "Grazie — è stato inviato.",
	feedbackSentDetail: "Chi gestisce {brand} qui lo leggerà.",
	feedbackClose: "Chiudi",
	feedbackNotSent: "Non inviato",
	feedbackNotSentRetry: "Non inviato. Riprova.",
	emailRecoveryText:
		"Le tue presentazioni sono salvate solo in questo browser. Se i suoi dati vengono cancellati, sono perse per sempre. Aggiungi la tua email per conservarle in un account.",
	emailRecoveryAction: "Aggiungi email",
	emailRecoverySignInText:
		"Queste presentazioni sono salvate solo in questo browser. Se i suoi dati vengono cancellati, sono perse per sempre. Accedi per conservarle nel tuo account.",
	emailRecoverySignInAction: "Accedi",
	emailRecoveryDismiss: "Nascondi questo avviso",
	signInTitle: "Accedi per partecipare",
	signInIntro:
		"Questa presentazione è aperta solo ai partecipanti che hanno effettuato l'accesso. Accedi o crea un account e tornerai direttamente qui.",
	signInAction: "Accedi",
	signInMismatchTitle: "Accesso con un altro account",
	signInMismatchIntro:
		"Questo dispositivo ha già partecipato a questa presentazione con un altro account. Passa a quell'account per continuare.",
	signInSwitchAccount: "Cambia account",
};

const pt: Dict = {
	locale: "pt",
	live: "AO VIVO",
	waitingPresenter: "Aguardando o apresentador...",
	willStartSoon: "A apresentação começará em breve",
	presentationEnded: "Apresentação encerrada",
	thankYou: "Obrigado por participar!",
	goToHomepage: "Ir para a página inicial de {brand}",
	typeResponse: "Digite sua resposta...",
	submit: "Enviar",
	voteSubmitted: "Resposta enviada!",
	liveResults: "Resultados ao vivo",
	waitingForResponses: "Aguardando respostas...",
	resultsPrivate: "Os resultados são privados",
	resultsHidden: "Resultados ocultos",
	answersFiltered: "Respostas retidas pelo filtro de palavrões",
	answerIndependent: "Responda de forma independente",
	completeAllToSeeResults: "Responda todas as perguntas para ver os resultados",
	passIntro:
		"Chegou ao fim. As suas respostas estão guardadas — pode percorrer esta apresentação novamente, e as suas novas respostas são guardadas à parte.",
	passStartAgain: "Responder novamente",
	passReachEnd: "Chegue ao último diapositivo para responder novamente",
	passStarted: "Nova ronda — as suas respostas anteriores ficam guardadas",
	passOff: "O organizador já não permite responder novamente",
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
	quizSecondsLeftSpoken: "Faltam {seconds} segundos",
	answerSending: "A enviar…",
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
	leaderboardPlayer: "Jogador {handle}",
	leaderboardTopAcross: {
		one: "Top {shown} em {count} pergunta do quiz",
		other: "Top {shown} em {count} perguntas do quiz",
	},
	resultsResponseCount: {
		one: "{count} resposta",
		other: "{count} respostas",
	},
	resultsFromParticipants: {
		one: "de {count} participante",
		other: "de {count} participantes",
	},
	resultsCorrectMark: "correta",
	resultsCorrectAnswer: "Resposta correta",
	resultsVoteCount: {
		one: "{count} voto",
		other: "{count} votos",
	},
	resultsPieChart: "Gráfico de pizza dos resultados",
	resultsDonutChart: "Gráfico de rosca dos resultados",
	resultsAppearWhenTimeUp: "Os resultados aparecem quando o tempo acabar.",
	resultsAppearWhenClosed: "Os resultados aparecem quando a pergunta for fechada a respostas.",
	waitingForScores: "Aguardando pontuações...",
	quizNoAnswersYet: "Ainda não há respostas",
	quizAnswersPending: {
		one: "{count} resposta recebida — ela aparece quando a pergunta terminar.",
		other: "{count} respostas recebidas — elas aparecem quando a pergunta terminar.",
	},
	quizAccepted: "Respostas aceitas: {answers}",
	quizScoreCorrect: "{correct} de {answered}",
	quizScoreAnsweredCorrectly: {
		one: "acertou",
		other: "acertaram",
	},
	quizScoreAverage: "{average} de {max} pontos em média",
	menuName: "Aparência e informações legais",
	menuNameWithFeedback: "Aparência, opinião e informações legais",
	menuClose: "Fechar o menu Aparência e informações legais",
	menuCloseWithFeedback: "Fechar o menu Aparência, opinião e informações legais",
	menuAppearance: "Aparência",
	themeLight: "Claro",
	themeDark: "Escuro",
	themeAuto: "Auto",
	menuSendFeedback: "Enviar opinião",
	menuLegal: "Informações legais",
	legalImprint: "Aviso legal",
	legalPrivacy: "Política de privacidade",
	legalTerms: "Termos de uso",
	opensInNewTab: "(abre em uma nova aba)",
	feedbackDialogClose: "Fechar a opinião",
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
	feedbackPromptHeading: "O que achaste do {brand}, a ferramenta por trás desta sessão?",
	feedbackPromptIntro: "A tua resposta é anónima e vai para quem gere o {brand} aqui, não para os organizadores deste evento.",
	feedbackPromptDismiss: "Fechar sem responder",
	feedbackRating: "Avaliação",
	feedbackOptional: "(opcional)",
	feedbackStarOf: "{star} de {total} estrelas",
	feedbackComment: "Comentário",
	feedbackCommentPlaceholder: "O que funciona, o que atrapalha, o que falta?",
	feedbackSend: "Enviar opinião",
	feedbackSending: "A enviar…",
	feedbackSendWhy: "Adiciona uma avaliação ou um comentário para enviar.",
	feedbackSent: "Obrigado — foi enviado.",
	feedbackSentDetail: "Quem gere o {brand} aqui vai lê-lo.",
	feedbackClose: "Fechar",
	feedbackNotSent: "Não enviado",
	feedbackNotSentRetry: "Não enviado. Tenta novamente.",
	emailRecoveryText:
		"As tuas apresentações estão guardadas apenas neste navegador. Se os dados dele forem apagados, perdem-se para sempre. Adiciona o teu email para as guardar numa conta.",
	emailRecoveryAction: "Adicionar email",
	emailRecoverySignInText:
		"Estas apresentações estão guardadas apenas neste navegador. Se os dados dele forem apagados, perdem-se para sempre. Inicia sessão para as guardar na tua conta.",
	emailRecoverySignInAction: "Iniciar sessão",
	emailRecoveryDismiss: "Ocultar este aviso",
	signInTitle: "Inicie sessão para participar",
	signInIntro:
		"Esta apresentação está aberta apenas a participantes com sessão iniciada. Inicie sessão ou crie uma conta e voltará diretamente aqui.",
	signInAction: "Iniciar sessão",
	signInMismatchTitle: "Sessão iniciada com outra conta",
	signInMismatchIntro:
		"Este dispositivo já participou nesta apresentação com outra conta. Mude para essa conta para continuar.",
	signInSwitchAccount: "Mudar de conta",
};

const nl: Dict = {
	locale: "nl",
	live: "LIVE",
	waitingPresenter: "Wachten op presentator...",
	willStartSoon: "De presentatie begint zo",
	presentationEnded: "Presentatie beëindigd",
	thankYou: "Bedankt voor je deelname!",
	goToHomepage: "Naar de startpagina van {brand}",
	typeResponse: "Typ je antwoord...",
	submit: "Verzenden",
	voteSubmitted: "Antwoord verzonden!",
	liveResults: "Live-resultaten",
	waitingForResponses: "Wachten op antwoorden...",
	resultsPrivate: "Resultaten zijn privé",
	resultsHidden: "Resultaten verborgen",
	answersFiltered: "Antwoorden tegengehouden door het scheldwoordenfilter",
	answerIndependent: "Onafhankelijk antwoorden",
	completeAllToSeeResults: "Beantwoord alle vragen om de resultaten te zien",
	passIntro:
		"Je bent aan het einde. Je antwoorden zijn opgeslagen — je kunt deze presentatie nog een keer doorlopen, en je nieuwe antwoorden worden apart bewaard.",
	passStartAgain: "Opnieuw antwoorden",
	passReachEnd: "Ga naar de laatste dia om opnieuw te antwoorden",
	passStarted: "Nieuwe ronde — je eerdere antwoorden blijven bewaard",
	passOff: "De organisator staat opnieuw antwoorden niet meer toe",
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
	quizSecondsLeftSpoken: "Nog {seconds} seconden",
	answerSending: "Wordt verzonden…",
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
	leaderboardPlayer: "Speler {handle}",
	leaderboardTopAcross: {
		one: "Top {shown} uit {count} quizvraag",
		other: "Top {shown} uit {count} quizvragen",
	},
	resultsResponseCount: {
		one: "{count} antwoord",
		other: "{count} antwoorden",
	},
	resultsFromParticipants: {
		one: "van {count} deelnemer",
		other: "van {count} deelnemers",
	},
	resultsCorrectMark: "goed",
	resultsCorrectAnswer: "Goed antwoord",
	resultsVoteCount: {
		one: "{count} stem",
		other: "{count} stemmen",
	},
	resultsPieChart: "Taartdiagram van de resultaten",
	resultsDonutChart: "Ringdiagram van de resultaten",
	resultsAppearWhenTimeUp: "De resultaten verschijnen als de tijd om is.",
	resultsAppearWhenClosed: "De resultaten verschijnen zodra de vraag gesloten is voor antwoorden.",
	waitingForScores: "Wachten op scores...",
	quizNoAnswersYet: "Nog geen antwoorden",
	quizAnswersPending: {
		one: "{count} antwoord binnen — het verschijnt zodra de vraag voorbij is.",
		other: "{count} antwoorden binnen — ze verschijnen zodra de vraag voorbij is.",
	},
	quizAccepted: "Goedgekeurd: {answers}",
	quizScoreCorrect: "{correct} van {answered}",
	quizScoreAnsweredCorrectly: {
		one: "had het goed",
		other: "hadden het goed",
	},
	quizScoreAverage: "gemiddeld {average} van {max} punten",
	menuName: "Weergave en juridisch",
	menuNameWithFeedback: "Weergave, feedback en juridisch",
	menuClose: "Menu Weergave en juridisch sluiten",
	menuCloseWithFeedback: "Menu Weergave, feedback en juridisch sluiten",
	menuAppearance: "Weergave",
	themeLight: "Licht",
	themeDark: "Donker",
	themeAuto: "Auto",
	menuSendFeedback: "Feedback versturen",
	menuLegal: "Juridisch",
	legalImprint: "Colofon",
	legalPrivacy: "Privacyverklaring",
	legalTerms: "Gebruiksvoorwaarden",
	opensInNewTab: "(opent in een nieuw tabblad)",
	feedbackDialogClose: "Feedback sluiten",
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
	feedbackPromptHeading: "Wat vond je van {brand}, de tool achter deze sessie?",
	feedbackPromptIntro: "Je antwoord is anoniem en gaat naar de beheerders van {brand} hier, niet naar de organisatoren van dit evenement.",
	feedbackPromptDismiss: "Sluiten zonder te antwoorden",
	feedbackRating: "Beoordeling",
	feedbackOptional: "(optioneel)",
	feedbackStarOf: "{star} van {total} sterren",
	feedbackComment: "Opmerking",
	feedbackCommentPlaceholder: "Wat werkt er, wat zit in de weg, wat ontbreekt er?",
	feedbackSend: "Feedback versturen",
	feedbackSending: "Versturen…",
	feedbackSendWhy: "Geef een beoordeling of een opmerking om te versturen.",
	feedbackSent: "Bedankt — het is verstuurd.",
	feedbackSentDetail: "De beheerders van {brand} hier lezen het.",
	feedbackClose: "Sluiten",
	feedbackNotSent: "Niet verstuurd",
	feedbackNotSentRetry: "Niet verstuurd. Probeer het opnieuw.",
	emailRecoveryText:
		"Je presentaties zijn alleen in deze browser opgeslagen. Als de gegevens ervan worden gewist, ben je ze voorgoed kwijt. Voeg je e-mailadres toe om ze in een account te bewaren.",
	emailRecoveryAction: "E-mail toevoegen",
	emailRecoverySignInText:
		"Deze presentaties zijn alleen in deze browser opgeslagen. Als de gegevens ervan worden gewist, ben je ze voorgoed kwijt. Log in om ze in je account te bewaren.",
	emailRecoverySignInAction: "Inloggen",
	emailRecoveryDismiss: "Melding verbergen",
	signInTitle: "Meld je aan om mee te doen",
	signInIntro:
		"Aan deze presentatie kunnen alleen aangemelde deelnemers meedoen. Meld je aan of maak een account aan, dan kom je direct hier terug.",
	signInAction: "Aanmelden",
	signInMismatchTitle: "Aangemeld met een ander account",
	signInMismatchIntro:
		"Dit apparaat heeft al aan deze presentatie meegedaan met een ander account. Wissel naar dat account om verder te gaan.",
	signInSwitchAccount: "Account wisselen",
};

const dicts: Record<Lang, Dict> = { en, de, fr, es, it, pt, nl };

/**
 * The supported language a BCP-47-ish tag is spoken in: its primary subtag when
 * that is one of ours, English otherwise — the same reading `getDict` makes, so
 * a value recorded as "the deck's language" names the dictionary its screen
 * was actually drawn in.
 *
 * The reading itself is `participantLanguageFor` in `server/schemas.ts`, which
 * the profanity filter chooses its list with (REQ085): one function, so a phone
 * drawn in German is never in a room filtered against the English list.
 */
export function resolveLang(lang?: string): Lang {
	return participantLanguageFor(lang);
}

/**
 * The browser's language tag, for words drawn before any deck is known (REQ134),
 * and `undefined` outside a browser. It chooses words only: where the ended
 * screen's control leads is the deck's language alone (REQ200).
 */
export function browserLanguage(): string | undefined {
	return typeof navigator === "undefined" ? undefined : navigator.language;
}

/** Resolve a translation dictionary for a BCP-47-ish language tag. */
export function getDict(lang?: string): Dict {
	return dicts[resolveLang(lang)];
}

/**
 * Fill a template's `{name}` slots. A slot with no value is left as written,
 * so a missing one shows up on screen rather than vanishing.
 */
export function fillTemplate(
	template: string,
	values: Record<string, string | number>,
): string {
	return template.replace(/\{(\w+)\}/g, (slot, name: string) =>
		Object.hasOwn(values, name) ? String(values[name]) : slot,
	);
}

/**
 * A counted phrase in the dictionary's language (REQ225): the form its plural
 * rules choose for `count`, with `{count}` and any other slot filled.
 */
export function countPhrase(
	dict: Pick<Dict, "locale">,
	forms: PluralForms,
	count: number,
	values: Record<string, string | number> = {},
): string {
	const category = new Intl.PluralRules(dict.locale).select(count);
	return fillTemplate(category === "one" ? forms.one : forms.other, {
		...values,
		count,
	});
}
