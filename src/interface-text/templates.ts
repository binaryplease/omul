// The template gallery (src/pages/TemplatesPage.tsx, REQ005, REQ006): its header, search and category filter, the match count, the empty result and the create toasts — REQ248 slice 10. The card and its Use template button are the workspaces section's, which slice 9 turned.

import type { PluralText } from "./index";

export const en = {
	pageTitle: "Templates",
	back: "Back",
	eyebrow: "templates",
	/** `{accent}` is `titleAccent`, drawn in the accent colour. */
	title: "Start from a {accent}",
	titleAccent: "prebuilt deck",
	intro:
		"Every template is a full deck you own from the moment you pick it — the slides are copied into a new presentation and are yours to edit, reorder or throw away.",

	searchPlaceholder: "Search templates",
	clearSearch: "Clear the search",
	clearSearchEmpty: "Nothing to clear — the search box is empty.",
	categoryFilter: "Filter templates by category",
	allCategories: "All",

	templateCount: { one: "{count} template", other: "{count} templates" } as PluralText,
	/** `{total}` is how many the catalog holds; the count is how many match. */
	matchCount: {
		one: "{count} of {total} templates match",
		other: "{count} of {total} templates match",
	} as PluralText,

	noMatch: "No template matches",
	noMatchBody:
		"Nothing in the catalog answers both filters. Clear them to see every template again.",
	clearFilters: "Clear filters",

	/** `{title}` is the template's title. */
	useTemplateLabel: "Create a new deck from “{title}”",
	createdFrom: "Created from “{title}”",
	createFailed: "Failed to create from this template",
};

export const de: Partial<typeof en> = {
	pageTitle: "Vorlagen",
	back: "Zurück",
	eyebrow: "Vorlagen",
	title: "Starte mit einer {accent}",
	titleAccent: "fertigen Präsentation",
	intro:
		"Jede Vorlage ist eine vollständige Präsentation, die dir gehört, sobald du sie auswählst — die Folien werden in eine neue Präsentation kopiert, und du kannst sie bearbeiten, umsortieren oder verwerfen.",

	searchPlaceholder: "Vorlagen durchsuchen",
	clearSearch: "Suche leeren",
	clearSearchEmpty: "Nichts zu leeren — das Suchfeld ist leer.",
	categoryFilter: "Vorlagen nach Kategorie filtern",
	allCategories: "Alle",

	templateCount: { one: "{count} Vorlage", other: "{count} Vorlagen" },
	matchCount: {
		one: "{count} von {total} Vorlagen passt",
		other: "{count} von {total} Vorlagen passen",
	},

	noMatch: "Keine Vorlage passt",
	noMatchBody:
		"Nichts im Katalog erfüllt beide Filter. Setze sie zurück, um wieder alle Vorlagen zu sehen.",
	clearFilters: "Filter zurücksetzen",

	useTemplateLabel: "Eine neue Präsentation aus „{title}“ erstellen",
	createdFrom: "Aus „{title}“ erstellt",
	createFailed: "Aus dieser Vorlage konnte keine Präsentation erstellt werden",
};
