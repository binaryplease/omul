// The accessibility findings under the editor's canvas (`AccessibilityFindingsStrip` in src/components/AccessibilityFindings.tsx) and the words of each finding (src/components/DeckAccessibility.ts) — REQ248 slice 6.
//
// A finding's stored `message` is the English below, built by the check
// itself; the strip rebuilds the sentence in the interface language from the
// finding's risk and measurement (`accessibilityFindingMessage`).

export const en = {
	// The field a finding goes to, as the control that goes to it names it. A
	// slide's heading is named by `slideQuestionLabel` (slide-canvas section).
	fieldDeckTheme: "Deck theme",
	fieldOwnTheme: "Your own theme",
	fieldTextColor: "Text colour",
	fieldBackgroundColor: "Background colour",
	fieldBackgroundImage: "Background image",
	fieldTextSize: "Text size",
	fieldMediaAlt: "Alt text",
	/**
	 * The control's accessible name. `{field}` is the field's name as the
	 * control shows it, `{fieldLowercase}` the same in lower case, for a
	 * language that does not capitalise a noun mid-sentence.
	 */
	goToField: "Go to {fieldLowercase}",

	// The strip.
	/** The region's name while the slide has findings. */
	findingsName: "Accessibility findings on this slide",
	/** `{findings}` is the count, as `editor.accessibilityFindingCount` says it. */
	findingsOnSlide: "{findings} on this slide",
	/** `{count}` is how many the rest of the deck holds. */
	findingsElsewhere: "{count} on other slides — marked in the rail.",
	noFindingsElsewhere: "None on other slides.",
	noFindings: "No accessibility risks found on this slide.",

	// The findings themselves.
	/**
	 * `{ratio}` is the lowest ratio reached, `{schemes}` the colour schemes it
	 * falls short in (`schemeDark`, `schemeLight`, joined by `schemeJoin`),
	 * `{textKind}` `bodyText` or `largeText`, and `{required}` the minimum.
	 */
	lowContrast:
		"The words on this slide reach {ratio}:1 against what is behind them in {schemes} mode; {textKind} text needs {required}:1.",
	schemeDark: "dark",
	schemeLight: "light",
	schemeJoin: " and ",
	bodyText: "body",
	largeText: "large",
	smallText:
		"This slide's text is set Small, which is hard to read on a phone at arm's length or from the back of the room.",
	missingAlt:
		"This slide's image has no alt text, so a screen reader announces nothing for it.",
	missingHeading:
		"This slide has no heading, so nothing tells a screen-reader user what it is about.",
};

export const de: Partial<typeof en> = {
	fieldDeckTheme: "Design der Präsentation",
	fieldOwnTheme: "Eigenes Design",
	fieldTextColor: "Textfarbe",
	fieldBackgroundColor: "Hintergrundfarbe",
	fieldBackgroundImage: "Hintergrundbild",
	fieldTextSize: "Textgröße",
	fieldMediaAlt: "Alternativtext",
	goToField: "Zum Feld „{field}“",

	findingsName: "Hinweise zur Barrierefreiheit auf dieser Folie",
	findingsOnSlide: "{findings} auf dieser Folie",
	findingsElsewhere:
		"{count} auf anderen Folien — in der Folienleiste markiert.",
	noFindingsElsewhere: "Keine auf anderen Folien.",
	noFindings: "Keine Risiken für die Barrierefreiheit auf dieser Folie.",

	lowContrast:
		"Die Schrift auf dieser Folie erreicht im {schemes} Modus {ratio}:1 gegenüber ihrem Hintergrund; {textKind} Text braucht {required}:1.",
	schemeDark: "dunklen",
	schemeLight: "hellen",
	schemeJoin: " und ",
	bodyText: "normaler",
	largeText: "großer",
	smallText:
		"Der Text dieser Folie ist auf „Klein“ gesetzt — auf einem Handy auf Armlänge oder aus der letzten Reihe ist er schwer zu lesen.",
	missingAlt:
		"Das Bild dieser Folie hat keinen Alternativtext, ein Screenreader sagt dazu also nichts an.",
	missingHeading:
		"Diese Folie hat keine Überschrift, also erfährt niemand mit Screenreader, worum es auf ihr geht.",
};
