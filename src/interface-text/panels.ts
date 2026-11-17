// The panels beside the slide on the presenter screen: Q\&A, chat and reactions, who took part, comments, notes — REQ248 slice 2.
//
// The Q&A, chat and reaction labels are the presenter's reading of components
// the participant screen shares; the phone keeps reading the deck's `Dict`
// (REQ084) through `qaLabelsFor`, `chatLabelsFor` and `reactionLabelsFor`.

export const en = {
	qaTitle: "Q&A",
	qaAsk: "Ask a question",
	qaAskPlaceholder: "Type your question...",
	qaSubmit: "Send",
	qaSubmitted: "Question sent!",
	qaEmpty: "No questions yet.",
	qaEmptyOwn: "You haven't asked anything yet.",
	qaModeratedNote: "Questions go to the presenter only.",
	qaUpvote: "Upvote this question",
	qaUpvoteOwn: "You asked this one — it already counts",
	qaAnswered: "Answered",
	/** Follows the count of questions still waiting: "7 open". */
	qaOpen: "open",
	qaAwaitingApproval: "Awaiting approval",
	qaMarkAnswered: "Mark this question answered",
	qaPutBack: "Put this question back in the queue",
	qaApprove: "Approve — show this question to the room",
	qaAlreadyApproved: "Already visible to the room",
	qaLayerToggle: "Questions from the audience",
	qaLayerToggleDescription:
		"When on, participants can ask from any slide — not only from a Q&A slide.",
	qaVisibilityHeading: "Who sees the questions",
	qaVisibilityName: "Who sees the submitted questions",
	qaVisibilityPresenter: "Only me",
	qaVisibilityEveryone: "Everyone",
	qaVisibilityEveryoneNote:
		"Participants see the whole list and can upvote it, which is what orders your queue.",
	qaVisibilityPresenterNote:
		"Participants see only the questions they asked themselves. Nobody can upvote.",
	qaApprovalToggle: "Approve questions first",
	qaApprovalOnDescription:
		"New questions wait here until you approve them — nobody else sees or upvotes them before that, not even whoever asked.",
	qaApprovalOffDescription:
		"When on, each new question waits for your approval before anyone else can see or upvote it.",

	chatTitle: "Chat",
	chatPlaceholder: "Say something...",
	chatSend: "Send",
	chatEmpty: "Nothing said yet — start the conversation.",
	chatClosed: "The chat is closed. You can still read what was said.",
	chatYou: "You",
	/** The transcript's length, below the history cap. */
	chatCount: {
		one: "{count} chat message",
		other: "{count} chat messages",
	},
	/** At the history cap, where the count is the list's and not the room's. */
	chatCountNewest: "the newest {count} chat messages",
	chatChannelToggle: "Live chat",
	chatChannelDescription:
		"A channel the room talks in during the session — separate from the Q&A queue and from slide answers.",

	reactionsTitle: "Reactions",
	reactionLike: "Nice",
	reactionLove: "Love it",
	reactionCelebrate: "Celebrate",
	reactionLaugh: "Funny",
	reactionInsight: "Good point",
	reactionsUnavailable: "Reactions are closed for this presentation",
	reactionChannelToggle: "Reactions from the audience",
	reactionChannelDescription:
		"Participants can react to any slide. Reactions are shown live and are never stored or counted.",

	rosterHeading: "Participants",
	rosterHeadingCount: "Participants ({count})",
	rosterNotAsked:
		"This deck does not ask participants for a name, so there is no roster. Turn it on in the editor to collect one.",
	rosterLoading: "Loading participants...",
	rosterEmpty:
		"Nobody has stated a name yet — the question is asked as each participant joins.",
	/** How many slides one named participant answered. */
	rosterAnsweredSlides: {
		one: "{count} slide",
		other: "{count} slides",
	},
	rosterUnnamedNote:
		"Anyone who answered without stating a name is not listed here — they are in the results export, under their participant id.",

	commentAuthorYou: "You",
	commentAuthorDeleted: "Deleted account",
	commentReadOnly:
		"You can read this deck's comments. Ask its owner for comment access to write on them.",
	commentsLoading: "Loading comments…",
	commentDelete: "Delete this comment",
	commentsEmpty:
		"Nothing here yet. Comments stay between the accounts this deck is shared with — the room never sees them.",
	commentPlaceholder: "Comment on this slide…",
	commentFieldName: "Write a comment on this slide",
	commentPosting: "Posting…",
	commentSubmit: "Comment",

	notesToggleNoAccess:
		"Show presenter notes — you don't have edit access to this presentation, so its notes are not yours to read",
	notesToggleHide: "Hide presenter notes",
	notesToggleShow:
		"Show presenter notes — what you wrote for yourself about this slide",
	notesToggleShowEmpty: "Show presenter notes — this slide has none yet",
	notesHeading: "Presenter notes",
	notesPrivacy: "Yours only — never sent to participants or exported.",
	notesEmpty:
		"No notes on this slide. Add them in the editor — they follow the slide and only ever appear here.",
};

export const de: Partial<typeof en> = {
	qaTitle: "Fragen",
	qaAsk: "Frage stellen",
	qaAskPlaceholder: "Frage eingeben...",
	qaSubmit: "Senden",
	qaSubmitted: "Frage gesendet!",
	qaEmpty: "Noch keine Fragen.",
	qaEmptyOwn: "Du hast noch nichts gefragt.",
	qaModeratedNote: "Fragen gehen nur an die Moderation.",
	qaUpvote: "Diese Frage unterstützen",
	qaUpvoteOwn: "Deine eigene Frage — sie zählt bereits",
	qaAnswered: "Beantwortet",
	qaOpen: "offen",
	qaAwaitingApproval: "Wartet auf Freigabe",
	qaMarkAnswered: "Diese Frage als beantwortet markieren",
	qaPutBack: "Diese Frage zurück in die Warteschlange stellen",
	qaApprove: "Freigeben — diese Frage dem Raum zeigen",
	qaAlreadyApproved: "Für den Raum schon sichtbar",
	qaLayerToggle: "Fragen aus dem Publikum",
	qaLayerToggleDescription:
		"Wenn an, können Teilnehmende von jeder Folie aus fragen — nicht nur von einer Fragen-Folie.",
	qaVisibilityHeading: "Wer die Fragen sieht",
	qaVisibilityName: "Wer die eingereichten Fragen sieht",
	qaVisibilityPresenter: "Nur ich",
	qaVisibilityEveryone: "Alle",
	qaVisibilityEveryoneNote:
		"Teilnehmende sehen die ganze Liste und können Fragen unterstützen — danach ordnet sich deine Warteschlange.",
	qaVisibilityPresenterNote:
		"Teilnehmende sehen nur die Fragen, die sie selbst gestellt haben. Niemand kann unterstützen.",
	qaApprovalToggle: "Fragen zuerst freigeben",
	qaApprovalOnDescription:
		"Neue Fragen warten hier, bis du sie freigibst — vorher sieht oder unterstützt sie niemand sonst, nicht einmal, wer sie gestellt hat.",
	qaApprovalOffDescription:
		"Wenn an, wartet jede neue Frage auf deine Freigabe, bevor jemand anderes sie sehen oder unterstützen kann.",

	chatTitle: "Chat",
	chatPlaceholder: "Schreib etwas...",
	chatSend: "Senden",
	chatEmpty: "Noch nichts gesagt — fang das Gespräch an.",
	chatClosed: "Der Chat ist geschlossen. Du kannst weiterhin mitlesen.",
	chatYou: "Du",
	chatCount: {
		one: "{count} Chatnachricht",
		other: "{count} Chatnachrichten",
	},
	chatCountNewest: "die neuesten {count} Chatnachrichten",
	chatChannelToggle: "Live-Chat",
	chatChannelDescription:
		"Ein Kanal, in dem sich der Raum während der Sitzung austauscht — getrennt von den Fragen und von den Antworten auf Folien.",

	reactionsTitle: "Reaktionen",
	reactionLike: "Stark",
	reactionLove: "Liebe ich",
	reactionCelebrate: "Feiern",
	reactionLaugh: "Witzig",
	reactionInsight: "Guter Punkt",
	reactionsUnavailable: "Reaktionen sind für diese Präsentation geschlossen",
	reactionChannelToggle: "Reaktionen aus dem Publikum",
	reactionChannelDescription:
		"Teilnehmende können auf jede Folie reagieren. Reaktionen werden live gezeigt und nie gespeichert oder gezählt.",

	rosterHeading: "Teilnehmende",
	rosterHeadingCount: "Teilnehmende ({count})",
	rosterNotAsked:
		"Diese Präsentation fragt Teilnehmende nicht nach einem Namen, daher gibt es keine Liste. Schalte es im Editor ein, um Namen zu sammeln.",
	rosterLoading: "Teilnehmende werden geladen...",
	rosterEmpty:
		"Noch hat niemand einen Namen angegeben — die Frage kommt, sobald jemand mitmacht.",
	rosterAnsweredSlides: {
		one: "{count} Folie",
		other: "{count} Folien",
	},
	rosterUnnamedNote:
		"Wer ohne Namen geantwortet hat, steht nicht hier — diese Teilnehmenden sind im Ergebnis-Export, unter ihrer Teilnehmer-ID.",

	commentAuthorYou: "Du",
	commentAuthorDeleted: "Gelöschtes Konto",
	commentReadOnly:
		"Du kannst die Kommentare dieser Präsentation lesen. Bitte die Person, der sie gehört, um Kommentarzugriff, um selbst zu schreiben.",
	commentsLoading: "Kommentare werden geladen…",
	commentDelete: "Diesen Kommentar löschen",
	commentsEmpty:
		"Noch nichts hier. Kommentare bleiben unter den Konten, mit denen diese Präsentation geteilt ist — der Raum sieht sie nie.",
	commentPlaceholder: "Diese Folie kommentieren…",
	commentFieldName: "Einen Kommentar zu dieser Folie schreiben",
	commentPosting: "Wird gesendet…",
	commentSubmit: "Kommentieren",

	notesToggleNoAccess:
		"Notizen zeigen — du hast keinen Bearbeitungszugriff auf diese Präsentation, also sind ihre Notizen nicht für dich",
	notesToggleHide: "Notizen ausblenden",
	notesToggleShow:
		"Notizen zeigen — was du dir selbst zu dieser Folie notiert hast",
	notesToggleShowEmpty: "Notizen zeigen — diese Folie hat noch keine",
	notesHeading: "Notizen",
	notesPrivacy: "Nur für dich — nie an Teilnehmende gesendet oder exportiert.",
	notesEmpty:
		"Keine Notizen auf dieser Folie. Füge sie im Editor hinzu — sie gehören zur Folie und erscheinen nur hier.",
};
