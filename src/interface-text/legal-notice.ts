// The sentence naming the terms and the privacy policy where a contract is concluded (`LegalNoticeText` in src/components/LegalLinks.tsx, REQ183) — REQ248 slice 4, where it sits under the editor's Create button.
// Each point that mounts the notice names its own action here: the editor's
// Create (slice 4), and sign-up, joining with a code, the template gallery and
// generate (slice 10). Taking part is the participant screen's, which speaks
// the deck's language, and stays English there.

export const en = {
	/** `{action}` is one of the actions below, `{terms}` the link to the terms. */
	agreement: "By {action}, you agree to the {terms}.",
	termsOfService: "Terms of Service",
	/** `{privacy}` is the link to the privacy policy. */
	privacyExplains: "The {privacy} explains how your data is processed.",
	privacyPolicy: "Privacy Policy",
	/** The action under the editor's Create button. */
	creatingPresentation: "creating this presentation",
	/** The action under the sign-up form's Create account button. */
	creatingAccount: "creating an account",
	/** The action under the join page's two ways in. */
	joining: "joining",
	/** The action under the template gallery's header. */
	usingTemplate: "using a template",
	/** The action under generate's button. */
	generatingDraft: "generating a draft",
};

export const de: Partial<typeof en> = {
	agreement: "Mit {action} stimmst du den {terms} zu.",
	termsOfService: "Nutzungsbedingungen",
	privacyExplains: "In der {privacy} steht, wie deine Daten verarbeitet werden.",
	privacyPolicy: "Datenschutzerklärung",
	creatingPresentation: "dem Erstellen dieser Präsentation",
	creatingAccount: "dem Anlegen eines Kontos",
	joining: "dem Beitreten",
	usingTemplate: "der Verwendung einer Vorlage",
	generatingDraft: "dem Generieren eines Entwurfs",
};
