// The app menu's interface text (`src/components/ui/AppMenu.tsx`, REQ183,
// REQ248): the Language section, the names the menu takes while it holds one,
// and the feedback dialog's heading and contact box. The menu's other words —
// Appearance and its themes, "Send feedback", the Legal section, the feedback
// form's fields — are in every deck dictionary already
// (REQ225, `src/i18n.ts`), so an organizer's menu reads them from the
// dictionary of the interface language and they are not restated here.

export const en = {
	language: "Language",
	/** Followed by the language "Automatic" currently resolves to, in brackets. */
	languageAutomatic: "Automatic",
	/** The trigger's name while the menu holds the Language section. */
	menuNameWithLanguage: "Appearance, language and legal",
	menuNameWithLanguageAndFeedback: "Appearance, language, feedback and legal",
	/** The click-away backdrop's name while the menu holds the Language section. */
	closeWithLanguage: "Close appearance, language and legal menu",
	closeWithLanguageAndFeedback:
		"Close appearance, language, feedback and legal menu",
	/**
	 * The menu's name where it follows a leading section's (REQ199): "More —
	 * preview, export, appearance and legal". English lowercases it; German
	 * keeps its nouns capitalised.
	 */
	nameInList: (name: string) => name.toLowerCase(),
	/**
	 * A bar menu's backdrop (`BarMenu.tsx`, REQ190); `{menu}` is the menu's name
	 * as `nameInList` gives it.
	 */
	closeMenu: "Close {menu} menu",
	/**
	 * The feedback dialog's heading and contact box (REQ185), which no deck
	 * dictionary holds: only an organizer's menu draws them in a language other
	 * than English. The heading says first who reads it; `{brand}` is the
	 * product.
	 */
	feedbackHeadingLead: "Feedback about {brand}",
	feedbackHeadingRecipient:
		"goes to the people who run {brand} here, not to the presenter or organizer",
	contactMe: "You can contact me about this",
	/** `{email}` is the signed-in account's address. */
	contactAddress: "We'd write to {email} (your account email)",
};

export const de: Partial<typeof en> = {
	language: "Sprache",
	languageAutomatic: "Automatisch",
	menuNameWithLanguage: "Darstellung, Sprache und Rechtliches",
	menuNameWithLanguageAndFeedback:
		"Darstellung, Sprache, Feedback und Rechtliches",
	closeWithLanguage: "Menü „Darstellung, Sprache und Rechtliches“ schließen",
	closeWithLanguageAndFeedback:
		"Menü „Darstellung, Sprache, Feedback und Rechtliches“ schließen",
	nameInList: (name: string) => name,
	closeMenu: "Menü „{menu}“ schließen",
	feedbackHeadingLead: "Feedback zu {brand}",
	feedbackHeadingRecipient:
		"geht an die Betreiber von {brand} hier, nicht an die Vortragenden oder Veranstalter",
	contactMe: "Ihr dürft mich dazu kontaktieren",
	contactAddress:
		"Wir würden an {email} schreiben (die E-Mail-Adresse deines Kontos)",
};
