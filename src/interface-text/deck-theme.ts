// The deck's theme and logo controls (the Theme and Logo groups of `DeckSettings` in src/pages/CreatePage.tsx, and the theme and typeface descriptors in src/components/DeckTheme.tsx) — REQ248 slice 6.
//
// The built-in themes' names (Signal, Pulse, Ember, Editorial, Broadcast) and
// the Figtree face are proper names and stay in `DeckTheme.tsx`; what is said
// about them is here. `DECK_THEME_APPEARANCE` and `DECK_FONT_STACKS` read their
// English from this file, so the catalog and the picker cannot drift apart.

import type { BuiltInDeckThemeId, DeckFontId } from "../types";

export const en = {
	/** One line beside each built-in theme in the picker. */
	themeDescriptions: {
		signal: "The house look — signal blue on a neutral canvas, set in Figtree.",
		pulse: "The house palette — Pulse Blue on a Deep Ink canvas.",
		ember: "Amber into tangerine over a warm canvas — the Warmth row.",
		editorial: "A serif face and Data Spectrum violet — quiet and typeset.",
		broadcast: "Control-room monospace and emerald signal on near-black.",
	} as Record<BuiltInDeckThemeId, string>,
	/** Each face's name in the typeface picker. */
	fontLabels: {
		figtree: "Figtree",
		system: "System sans",
		serif: "Serif",
		mono: "Mono",
	} as Record<DeckFontId, string>,
	/** One line under each face in the typeface picker. */
	fontDescriptions: {
		figtree: "The house face — bundled with the app.",
		system: "Whatever this device sets its own interface in.",
		serif: "A typeset look for text-heavy decks.",
		mono: "Control-room monospace — bundled with the app.",
	} as Record<DeckFontId, string>,
	/** What the picker calls a theme the organizer has not named, and the name field's placeholder. */
	unnamedTheme: "Custom",
	customThemeDescription: "This deck's own colours and typeface, authored below.",

	// The Theme group.
	themeTitle: "Theme",
	themeDescription:
		"Colours, typeface and slide backgrounds, across the presenter, participant and join surfaces.",
	themePickerName: "Deck theme",

	// The "Your own theme" group (REQ080, REQ092, REQ135).
	ownThemeTitle: "Your own theme",
	ownThemeDescription:
		"An organization's colours and typeface, authored on this deck and applied exactly as a built-in theme is.",
	themeNameLabel: "Theme name",
	themeNameHint: "What this theme is called in the picker above.",
	brandColorLabel: "Brand colour",
	brandColorHint: "Everything live: bars, links, the wash behind a slide.",
	canvasLabel: "Canvas",
	canvasHint:
		"The surface a slide is drawn on. How light it is decides which colour scheme these colours were authored for — the other one is derived from them, so a reader who prefers the opposite still gets your brand.",
	textColorLabel: "Text",
	textColorHint:
		"The words on that canvas. Left empty, it is derived from the canvas.",
	typefaceLabel: "Typeface",
	typefaceHint:
		"Only faces this build ships, so every screen in the room resolves the same one.",
	typefacePickerName: "Theme typeface",
	ownThemeInUse: "This deck is drawn in the theme above.",
	ownThemeNotInUse:
		"Stored with the deck, but not what the room sees — it currently wears the built-in theme selected above.",
	useOwnTheme: "Use this theme",
	/** Why "Use this theme" is unavailable. */
	ownThemeAlreadyInUse: "This deck already wears its own theme.",

	// The Logo group (REQ136).
	logoTitle: "Logo",
	logoDescription:
		"Shown on the join, waiting and participant screens in place of the default mark.",
	logoUrlLabel: "Logo image URL",
	logoUrlHint:
		"An http(s) link, or a path this deployment serves. Leave empty to keep the default mark.",
	logoAltLabel: "Logo description",
	/** The description's hint when the mark would have no name at all. */
	logoAltHintDecorative:
		"Read out by screen readers. With no description and no deck title, the mark is treated as decorative.",
	logoAltHint: "Read out by screen readers. Defaults to the deck's title.",
	/** Why the description field is unavailable. */
	logoAltNoLogo: "There is no logo to describe yet — add an image URL above.",
	logoShown: "This is the mark the audience sees.",
	logoNone: "No logo set — the audience sees the default mark.",
	logoUnusable:
		"That link can't be used as an image — use an http(s) address or a path starting with “/”. The audience sees the default mark until it is fixed.",
};

export const de: Partial<typeof en> = {
	themeDescriptions: {
		signal:
			"Der Hausstil — Signalblau auf neutralem Grund, gesetzt in Figtree.",
		pulse: "Die Hauspalette — Pulse Blue auf einem Deep-Ink-Grund.",
		ember: "Bernstein bis Mandarine auf warmem Grund — die Warmth-Reihe.",
		editorial:
			"Eine Serifenschrift und Data-Spectrum-Violett — ruhig und typografisch.",
		broadcast: "Regieraum-Monospace und smaragdgrünes Signal auf Fast-Schwarz.",
	},
	fontLabels: {
		figtree: "Figtree",
		system: "Systemschrift",
		serif: "Serifenschrift",
		mono: "Mono",
	},
	fontDescriptions: {
		figtree: "Die Hausschrift — in der App enthalten.",
		system: "Die Schrift, in der dieses Gerät seine eigene Oberfläche zeigt.",
		serif: "Ein klassischer Satz für textlastige Präsentationen.",
		mono: "Regieraum-Monospace — in der App enthalten.",
	},
	unnamedTheme: "Eigenes Design",
	customThemeDescription:
		"Die eigenen Farben und die Schrift dieser Präsentation, unten festgelegt.",

	themeTitle: "Design",
	themeDescription:
		"Farben, Schrift und Folienhintergründe — in der Präsentationsansicht, bei den Teilnehmenden und auf der Beitrittsseite.",
	themePickerName: "Design der Präsentation",

	ownThemeTitle: "Eigenes Design",
	ownThemeDescription:
		"Die Farben und die Schrift einer Organisation, in dieser Präsentation festgelegt und genau wie ein eingebautes Design angewendet.",
	themeNameLabel: "Name des Designs",
	themeNameHint: "So heißt das Design in der Auswahl oben.",
	brandColorLabel: "Markenfarbe",
	brandColorHint:
		"Alles, was live ist: Balken, Links, der Farbschimmer hinter einer Folie.",
	canvasLabel: "Grundfläche",
	canvasHint:
		"Die Fläche, auf der eine Folie gezeichnet wird. Wie hell sie ist, entscheidet, für welches Farbschema diese Farben gedacht sind — das andere wird daraus abgeleitet, sodass auch jemand, der das andere Schema bevorzugt, deine Marke sieht.",
	textColorLabel: "Textfarbe",
	textColorHint:
		"Die Schrift auf dieser Fläche. Bleibt das Feld leer, wird sie aus der Grundfläche abgeleitet.",
	typefaceLabel: "Schrift",
	typefaceHint:
		"Nur Schriften, die in dieser Version enthalten sind — so zeigt jeder Bildschirm im Raum dieselbe.",
	typefacePickerName: "Schrift des Designs",
	ownThemeInUse: "Diese Präsentation wird im Design oben dargestellt.",
	ownThemeNotInUse:
		"Mit der Präsentation gespeichert, aber nicht das, was der Raum sieht — sie trägt gerade das oben gewählte eingebaute Design.",
	useOwnTheme: "Dieses Design verwenden",
	ownThemeAlreadyInUse: "Diese Präsentation trägt schon ihr eigenes Design.",

	logoTitle: "Logo",
	logoDescription:
		"Erscheint auf der Beitrittsseite, auf dem Wartebildschirm und bei den Teilnehmenden anstelle des Standardzeichens.",
	logoUrlLabel: "Bild-URL des Logos",
	logoUrlHint:
		"Ein http(s)-Link oder ein Pfad, den diese Installation ausliefert. Leer lassen, um das Standardzeichen zu behalten.",
	logoAltLabel: "Beschreibung des Logos",
	logoAltHintDecorative:
		"Wird von Screenreadern vorgelesen. Ohne Beschreibung und ohne Titel der Präsentation gilt das Zeichen als dekorativ.",
	logoAltHint:
		"Wird von Screenreadern vorgelesen. Ohne Angabe ist es der Titel der Präsentation.",
	logoAltNoLogo:
		"Es gibt noch kein Logo zu beschreiben — füge oben eine Bild-URL hinzu.",
	logoShown: "Dieses Zeichen sieht das Publikum.",
	logoNone: "Kein Logo festgelegt — das Publikum sieht das Standardzeichen.",
	logoUnusable:
		"Dieser Link lässt sich nicht als Bild verwenden — nutze eine http(s)-Adresse oder einen Pfad, der mit „/“ beginnt. Bis dahin sieht das Publikum das Standardzeichen.",
};
