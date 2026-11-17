// The app menu's interface text (`src/components/ui/AppMenu.tsx`, REQ183,
// REQ248): the Language section and the names the menu takes while it holds
// one. The menu's other words — Appearance and its themes, "Send feedback", the
// Legal section, the feedback dialog — are in every deck dictionary already
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
};
