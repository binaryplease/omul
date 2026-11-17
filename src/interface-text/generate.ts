// Drafting a deck from a prompt (src/pages/GeneratePage.tsx, REQ007): its header, the draft caveat, the brief's box and counter, the button with every reason it is disabled, the slide types it may use, and its toasts — REQ248 slice 10.
// The server's refusals of a generation it attempted (a provider failure, the
// rate limit) are its own messages and stay English (REQ248, out of scope).
// "Not configured" is the one reason the availability report gives, and it is
// worded here, so it reads in the interface language.

export const en = {
	pageTitle: "Generate a deck",
	back: "Back",
	eyebrow: "generate",
	/** `{accent}` is `titleAccent`, drawn in the accent colour. */
	title: "Describe the session, get a {accent}",
	titleAccent: "draft deck",
	intro:
		"Say what the session is for and who is in the room. You get a full deck you own from the moment it lands — the slides are yours to edit, reorder or throw away.",

	draftNotice:
		"Everything it writes is a starting point — read it before you run it. No answer comes back marked correct, so mark the answer key yourself on any quiz or knowledge-check slide.",
	promptLabel: "What is the session for?",
	promptPlaceholder:
		"A 30-minute retrospective for a team of eight that just shipped a rough release — how it went, what to keep, what to change.",
	/** The counter under the box; `{count}` and `{limit}` are characters. */
	promptCount: "{count} / {limit}",

	generate: "Generate draft deck",
	generating: "Drafting…",
	generateTitle: "Draft a deck from this brief",
	/** `{reason}` is why the server could not be asked. */
	blockedLoadFailed: "Could not ask this server whether it can generate: {reason}",
	blockedUnavailable:
		"This server is not configured to generate decks — no generation provider key is set.",
	blockedSignIn:
		"Sign in to generate a deck — this server only drafts for account holders.",
	blockedGenerating: "Drafting your deck — this takes a few seconds.",
	blockedEmpty: "Describe the session you want first.",
	/** `{count}` is the brief's length, `{limit}` the most it may be. */
	blockedTooLong: "That brief is {count} characters; the limit is {limit}.",

	mayUse: "it may use",

	/** `{title}` is the drafted deck's title. */
	drafted: "Drafted “{title}” — review it before you run it",
	generateFailed: "Could not generate a deck from that prompt",
};

export const de: Partial<typeof en> = {
	pageTitle: "Präsentation generieren",
	back: "Zurück",
	eyebrow: "generieren",
	title: "Beschreibe die Sitzung, erhalte einen {accent}",
	titleAccent: "Entwurf",
	intro:
		"Sag, wofür die Sitzung ist und wer im Raum sitzt. Du bekommst eine vollständige Präsentation, die dir gehört, sobald sie da ist — die Folien kannst du bearbeiten, umsortieren oder verwerfen.",

	draftNotice:
		"Alles, was dabei entsteht, ist ein Ausgangspunkt — lies es, bevor du es verwendest. Keine Antwort kommt als richtig markiert zurück, also lege die Lösungen auf jeder Quiz- oder Wissensfrage selbst fest.",
	promptLabel: "Wofür ist die Sitzung?",
	promptPlaceholder:
		"Eine 30-minütige Retrospektive für ein Team von acht Leuten, das gerade ein holpriges Release ausgeliefert hat — wie es lief, was bleiben soll, was sich ändern soll.",
	promptCount: "{count} / {limit}",

	generate: "Entwurf generieren",
	generating: "Wird entworfen…",
	generateTitle: "Aus dieser Beschreibung einen Entwurf erstellen",
	blockedLoadFailed:
		"Dieser Server konnte nicht gefragt werden, ob er generieren kann: {reason}",
	blockedUnavailable:
		"Dieser Server ist nicht zum Generieren von Präsentationen eingerichtet — es ist kein Schlüssel für einen Generierungsdienst gesetzt.",
	blockedSignIn:
		"Melde dich an, um eine Präsentation zu generieren — dieser Server erstellt Entwürfe nur für Kontoinhaber.",
	blockedGenerating: "Deine Präsentation wird entworfen — das dauert ein paar Sekunden.",
	blockedEmpty: "Beschreibe zuerst die Sitzung, die du möchtest.",
	blockedTooLong:
		"Diese Beschreibung hat {count} Zeichen; erlaubt sind höchstens {limit}.",

	mayUse: "kann verwenden",

	drafted:
		"„{title}“ ist entworfen — sieh dir die Präsentation an, bevor du sie verwendest",
	generateFailed: "Aus dieser Beschreibung konnte keine Präsentation generiert werden",
};
