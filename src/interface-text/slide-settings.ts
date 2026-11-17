// The slide settings column beside the editor's canvas (src/components/SlideEditor.tsx), the descriptors it offers (SlideAppearance.tsx, SlideText.tsx), the audio cue's note (QuizAudioCue.tsx) and the shared controls it is built from (src/components/EditorControls.tsx) — REQ248 slice 5.
// The controls are shared with the deck-settings panel, whose own words are
// slice 7's; what a control says by itself (a reset's reason, a colour chip,
// Done) is read here by every surface that mounts one.

import type { EmbedProvider } from "../types";
import type { PluralText } from "./index";

/** Each group's heading, as `SLIDE_TYPE_SECTIONS` in SlideTypeMenu.tsx declares it. */
const GROUP_TITLES = {
	Media: "Media",
	Content: "Content",
	Image: "Image",
	Video: "Video",
	"Deck or board": "Deck or board",
	Countdown: "Countdown",
	Answers: "Answers",
	Responses: "Responses",
	Scale: "Scale",
	Items: "Items",
	"Items & axes": "Items & axes",
	"Value range": "Value range",
	"Image & target": "Image & target",
	Fields: "Fields",
	"Scoring & timing": "Scoring & timing",
	Results: "Results",
	"Board & results": "Board & results",
};

/** A settings group's heading — the closed set the slide types declare. */
export type SlideSettingsGroupTitle = keyof typeof GROUP_TITLES;

export const en = {
	groupTitles: GROUP_TITLES as Record<SlideSettingsGroupTitle, string>,

	// The column's masthead: the type changer and what can be done to the slide.
	changeSlideType: "Change slide type",
	closeSlideTypeMenu: "Close slide type menu",
	skipSlide: "Skip slide",
	skippedTitle:
		"Skipped — Next and Previous step over this slide. Click to include it again",
	skipTitle: "Skip slide — Next and Previous step over it; it stays in the deck",
	moveSlideUp: "Move slide up",
	alreadyFirst: "Already the first slide",
	moveSlideDown: "Move slide down",
	alreadyLast: "Already the last slide",
	deleteSlide: "Delete slide",

	// What the slide shows besides its words.
	caption: "Caption",
	description: "Description",
	bodyText: "Body text",
	altText: "Alt text",
	describeImage: "Describe the image",
	videoUrl: "Video URL",
	deckOrBoardUrl: "Deck or board URL",
	imageUrl: "Image URL",
	imageOrGifUrl: "Image / GIF URL",
	imageOrGif: "Image / GIF",
	/** What a resting row says when nothing is set, and when something is. */
	none: "None",
	set: "Set",
	openQuestionPicture: "Open the picture beside this question",
	instructionBodyPlaceholder: "Defaults to the room's own joining instructions.",
	bodyPlaceholder: "Enter content...",
	instructionNote:
		"The join code and QR code are generated from the presentation.",
	videoNoteEmpty:
		"A YouTube or Vimeo link, or a direct file. The video stays where it is.",
	videoNoteBroken:
		"This link can't be played. Use an http:// or https:// address.",
	videoNoteEmbed: "Plays in the video platform's own player.",
	videoNoteFile: "Plays as a video file in the browser.",
	embedNoteEmpty:
		"A Google Slides, PowerPoint or Miro link. The deck stays where it is.",
	embedNoteBroken:
		"This link can't be embedded — only Google Slides, PowerPoint and Miro, over https.",
	/** What a resolved embed link frames, per provider. */
	embedFrames: {
		powerpoint: "Frames this PowerPoint deck.",
		"google-slides": "Frames this Google Slides deck.",
		miro: "Frames this Miro board — participants can work in it.",
	} as Record<EmbedProvider, string>,

	// A countdown slide's length (REQ107).
	minutes: "Minutes",
	seconds: "Seconds",
	countdownMinutes: "Countdown minutes",
	countdownSeconds: "Countdown seconds",
	/** `{length}` and `{max}` are clock readings, "5:00" and "60:00". */
	countsDownFrom: "Counts down from {length} — up to {max}.",

	// The answers group.
	resetAnswerRules: "Put the answer rules back to their defaults",
	pickOne: "Participants pick one option.",
	pickAny: "Participants pick as many options as they like.",
	/** `{limit}` is 2 or more. */
	pickUpTo: "Participants pick up to {limit} options.",
	responsesAny: "Each participant may send as many answers as they like.",
	responsesLimit: {
		one: "Each participant may send {count} answer.",
		other: "Each participant may send {count} answers.",
	} as PluralText,
	quizTypedConsequence: "Typed answers count when they match one below.",
	quizSelectConsequence: "Pick one option; mark the answer on the slide.",
	formConsequence: "Answers go to you only — the room sees how many replied.",
	selections: "Selections",
	selectionsName: "Options a participant may select",
	any: "Any",
	answersEach: "Answers each",
	answersEachName: "Maximum answers per participant",
	allowUpvoting: "Allow upvoting responses",

	// A quiz question's answers (REQ054, REQ055).
	quizModeName: "How participants answer",
	modeSelect: "Select",
	modeSelectDescription: "Participants pick one of the options you write.",
	modeType: "Type",
	modeTypeDescription:
		"Participants type their answer with nothing to choose from — recall, not recognition.",
	acceptedAnswers: "Accepted answers",
	acceptedFirstPlaceholder: "The answer, as you would write it",
	/** `{number}` is the row's position, one-based. */
	acceptedMorePlaceholder: "Also accept {number}",
	acceptedAnswerName: "Accepted answer {number}",
	removeAcceptedAnswer: "Remove accepted answer {number}",
	addAcceptedAnswer: "Add accepted answer",
	acceptedAnswerLimit: "At most {limit} accepted answers",
	duplicateAnswers: {
		one: "One answer is already accepted by another row — matching ignores case, accents and spacing.",
		other:
			"{count} answers are already accepted by another row — matching ignores case, accents and spacing.",
	} as PluralText,

	// A scale (REQ029–REQ032).
	minValue: "Min value",
	maxValue: "Max value",
	/** `{value}` is the end of the scale the label names. */
	lowLabel: "Low label ({value})",
	highLabel: "High label ({value})",
	disagreeExample: "e.g. Disagree",
	agreeExample: "e.g. Agree",
	intermediateLabels: "Intermediate labels",
	value: "Value",
	label: "Label",
	labelValueName: "Label {number} value",
	labelTextName: "Label {number} text",
	removeLabel: "Remove label {number}",
	addLabel: "Add label",
	statements: "Statements",
	statement: "Statement {number}",
	removeStatement: "Remove statement {number}",
	addStatement: "Add statement",
	statementLimit: "Max {limit} statements",
	allowSkippingStatements: "Allow skipping statements",

	// Ranking, 100 points and the grid (REQ034, REQ045, REQ047–REQ050).
	items: "Items",
	item: "Item {number}",
	removeItem: "Remove item {number}",
	addItem: "Add item",
	itemLimit: "Max {limit} items",
	/** `{budget}` is the points a participant splits. */
	pointsItems: "Items — {budget} points to split",
	allowSkippingItems: "Allow skipping items",
	horizontalAxis: "Horizontal axis",
	verticalAxis: "Vertical axis",
	axisTitle: "Axis title",
	lowValue: "Low value",
	highValue: "High value",
	effortExample: "e.g. Effort",
	lowEffortExample: "e.g. Low effort",
	highEffortExample: "e.g. High effort",
	impactExample: "e.g. Impact",
	lowImpactExample: "e.g. Low impact",
	highImpactExample: "e.g. High impact",

	// A form (REQ061).
	fields: "Fields",
	field: "Field {number}",
	fieldLabelName: "Field {number} label",
	removeField: "Remove field {number}",
	fieldTypeName: "Field {number} type",
	required: "Required",
	option: "Option {number}",
	/** `{field}` is the field's position, `{number}` the option's. */
	fieldOptionName: "Field {field} option {number}",
	removeOption: "Remove option {number}",
	addOption: "Add option",
	optionLimit: "Max {limit} options",
	addField: "Add field",
	fieldLimit: "Max {limit} fields",
	fieldText: "Text",
	fieldTextDescription: "Anything the participant types.",
	fieldEmail: "Email",
	fieldEmailDescription: "Only an address — anything else is turned away.",
	fieldChoice: "Choice",
	fieldChoiceDescription: "One of the options you write.",

	// Guess the number (REQ040–REQ043).
	lowest: "Lowest",
	highest: "Highest",
	step: "Step",
	selectableValues: {
		one: "{count} selectable value, {min} to {max}.",
		other: "{count} selectable values, {min} to {max}.",
	} as PluralText,
	guessRangeUnusable:
		"The highest value must be above the lowest, and the step no wider than the range.",
	hasCorrectAnswer: "This question has a correct answer",
	correctNumber: "Correct number",
	tolerance: "Tolerance (±)",
	guessReferenceOff:
		"Turn on a correct answer first — a tolerance around no number accepts nothing.",
	onlyCorrect: "Only {value} counts as correct.",
	rangeCorrect: "{min} to {max} counts as correct.",
	/** `{range}` is one number, or `rangeSpan`. */
	guessUnreachable:
		"No selectable value falls inside {range} — nobody could ever be right. Pick a number the slide offers, or widen the tolerance.",
	rangeSpan: "{min} to {max}",

	// Pin on image (REQ051–REQ053).
	noPinImage: "No image yet — participants cannot answer this slide.",
	hasCorrectArea: "This question has a correct area",
	correctArea: "Correct area",
	areaLeft: "Left (%)",
	areaTop: "Top (%)",
	areaWidth: "Width (%)",
	areaHeight: "Height (%)",
	pinAreaOff:
		"Turn on a correct area first — there is nothing to place without one.",
	pinAreaOffImage:
		"This area runs off the image — keep left plus width, and top plus height, inside 100%.",
	/** `{onClick}` is the reveal's "On click" choice, as it is labelled. */
	pinAreaInstant:
		'Results are instant, so the target is on screen while participants aim. Set the reveal to "{onClick}" to hold it back.',

	// A quiz question's scoring and timing (REQ054, REQ057, REQ058).
	noCountdown: "No countdown — every correct answer scores the same.",
	/** `{seconds}` is the window, `{points}` the most an answer scores. */
	countdownConsequence: "{seconds}s to answer; sooner scores more, up to {points}.",
	resetCountdown: "Put the countdown back to {seconds} seconds",
	countdownNotInEffect:
		"Not in effect: this deck is audience-paced, so the countdown never runs and every correct answer scores the full {points} points.",
	timeLimit: "Time limit",
	off: "Off",
	secondsShort: "{seconds}s",
	openCountdown: "Open the countdown",
	timeLimitSeconds: "Time limit (seconds)",
	audioCue: "Audio cue",
	openAudioCue: "Open the track played while the question is open",
	audioTrackUrl: "Audio track URL",
	/** The track picker (REQ058): its caption, and each tile's name. */
	audioTrack: "Audio track",
	/** `{track}` is a bundled track's name or Custom. */
	audioTrackNamed: "Audio track: {track}",
	audioCustom: "Custom",
	/** The closed row's value for a question with no playable cue. */
	audioNone: "None",
	/** The bundled tracks' names, by id; the license file keeps the English. */
	audioPresets: {
		"quiz-cue-1": "Ticking clock",
		"quiz-cue-2": "Heartbeat",
		"quiz-cue-3": "Plucked notes",
	} as Record<string, string>,
	/** The play control beside a track's tile; `{track}` is its name. */
	audioPreviewPlay: "Play {track}",
	audioPreviewStop: "Stop {track}",
	audioPreviewFailed: "{track} could not be loaded. Press play to try again.",
	noAudioCue: "This question carries no audio cue.",
	removeAudioCueTitle: "Remove this question's audio cue.",
	removeAudioCue: "Remove audio cue",
	audioNoteEmpty:
		"A link to an audio file, played on your presenter screen while the question is open — never on participants' phones. Nothing is uploaded.",
	/** The note while no track is chosen and the URL field is closed. */
	audioNoteSilent:
		"No track: this question runs in silence. A track you pick plays on your presenter screen while the question is open — never on participants' phones.",
	audioNoteUnplayable:
		"That address can't be played — use an http(s) or root-relative URL.",
	audioNoteNotInEffect:
		"Not in effect: this deck is audience-paced, so there is no shared answer window and the cue never plays.",
	audioNotePlays:
		"Plays on your presenter screen from the moment the question opens until it closes, looping — never on participants' phones.",

	// When the results reach the room, and how they are drawn (REQ102, REQ010).
	visibilityInstant: "Instant",
	visibilityInstantDescription: "Results update on the main screen in real time.",
	visibilityOnClick: "On click",
	visibilityOnClickDescription: "You reveal results manually when ready.",
	visibilityPrivate: "Private",
	visibilityPrivateDescription: "Results are never shown on the main screen.",
	/** What the reveal in force does, lower-case: it also follows `revealDeckDefault`. */
	revealInstant: "results appear as answers arrive",
	/** A quiz question's instant: its results wait for it to end (REQ215). */
	revealInstantQuiz:
		"results appear once the question is over (time up or submissions closed)",
	revealOnClick: "results wait until you reveal them",
	revealPrivate: "results never reach the shared screen",
	revealDeckDefault: "Deck default — {meaning}.",
	overridesDeck: "Overrides deck",
	resetRevealUnavailable:
		"This slide's reveal is tighter than its default — re-open it with the Reveal control above.",
	resetResults: "Put the reveal and the chart back to their defaults",
	reveal: "Reveal",
	revealName: "When results appear on the shared screen",
	/**
	 * The tile that follows the deck default; `{mode}` is that default's label.
	 * The tile is narrow (about 14 characters), so a language may leave `{mode}`
	 * out — the consequence line says what the default does.
	 */
	deckInherit: "Deck ({mode})",
	chart: "Chart",
	chartName: "Result style",
	chartBars: "Bars",
	chartBarsDescription: "One horizontal bar per option.",
	chartDonut: "Donut",
	chartDonutDescription: "Proportional ring with the head count in the middle.",
	chartPie: "Pie",
	chartPieDescription: "Proportional disc — shares of the whole.",
	chartDots: "Dots",
	chartDotsDescription: "One dot per vote, clustered per option.",
	values: "Values",
	valuesName: "Result values",
	layout: "Layout",
	resultLayoutName: "Result layout",
	bubbles: "Bubbles",
	grid: "Grid",
	placesShown: "Places shown",
	noQuizSlides: "This deck has no quiz slides yet, so the board will be empty.",
	rankingQuizQuestions: {
		one: "Ranking the {count} quiz question in this deck.",
		other: "Ranking the {count} quiz questions in this deck.",
	} as PluralText,

	// The slide's own appearance (REQ087, REQ091).
	style: "Style",
	departsTheme:
		"This slide departs from the deck's theme; anything left alone follows it.",
	followsTheme: "Following the deck's theme.",
	offTheme: "Off theme",
	resetStyle: "Put this slide back in the deck's theme",
	slideLayoutName: "Where this slide's elements sit",
	layoutInherit: "Theme default",
	layoutInheritDescription: "Lay this slide out the way the deck's theme does.",
	layoutCenter: "Centred",
	layoutCenterDescription: "Heading, media and answers stacked down the middle.",
	layoutLeft: "Left",
	layoutLeftDescription: "Everything aligned to the leading edge.",
	layoutRight: "Right",
	layoutRightDescription: "Everything aligned to the trailing edge.",
	textSize: "Text size",
	textSizeName: "Size of this slide's heading and body text",
	sizeSmall: "Small",
	sizeMedium: "Medium",
	sizeLarge: "Large",
	sizeHuge: "Huge",
	background: "Background",
	textColour: "Text",
	chartColour: "Chart",
	noChartHint: "This slide draws no chart, so nothing reads this yet.",
	backgroundImage: "Background image",
	openBackgroundImage: "Open the picture behind this slide",
	backgroundImageUrl: "Background image URL",
	backgroundImageUnloadable:
		"That address can't be loaded as a picture — use an http(s) or root-relative URL.",
	noBackgroundImage: "This slide carries no background image.",
	removeBackgroundImageTitle: "Remove this slide's background image.",
	removeBackgroundImage: "Remove background image",

	// The shared controls (EditorControls.tsx). `{title}` is a group's heading
	// as drawn, `{titleLower}` the same in lower case, for a language that
	// lower-cases a heading inside a sentence.
	changed: "Changed",
	nothingToReset: "Nothing to reset — {titleLower} is at its default.",
	resetUnavailable: "Reset {titleLower} — {reason}",
	openColourPicker: "Open the colour picker",
	/** `{label}` is the colour field's name. */
	colourPicker: "{label} picker",
	nothingAuthored: "Nothing is authored on this field.",
	clearColour: "Clear this colour and go back to the inherited one.",
	clear: "Clear",
	/** `{example}` is the inherited colour, as a hex. */
	notAColourHelp:
		"Not a colour — write it as {example} or #f63. The inherited value stands until it is fixed.",
	done: "Done",
	/** What a colour chip says when nothing is authored, and when it is unreadable. */
	colourTheme: "Theme",
	notAColour: "Not a colour",
};

export const de: Partial<typeof en> = {
	groupTitles: {
		Media: "Medien",
		Content: "Inhalt",
		Image: "Bild",
		Video: "Video",
		"Deck or board": "Präsentation oder Board",
		Countdown: "Countdown",
		Answers: "Antworten",
		Responses: "Antworten",
		Scale: "Skala",
		Items: "Elemente",
		"Items & axes": "Elemente & Achsen",
		"Value range": "Wertebereich",
		"Image & target": "Bild & Ziel",
		Fields: "Felder",
		"Scoring & timing": "Punkte & Zeit",
		Results: "Ergebnisse",
		"Board & results": "Bestenliste & Ergebnisse",
	},

	changeSlideType: "Folientyp ändern",
	closeSlideTypeMenu: "Menü der Folientypen schließen",
	skipSlide: "Folie überspringen",
	skippedTitle:
		"Übersprungen — Weiter und Zurück überspringen diese Folie. Klicke, um sie wieder aufzunehmen",
	skipTitle:
		"Folie überspringen — Weiter und Zurück überspringen sie; sie bleibt in der Präsentation",
	moveSlideUp: "Folie nach oben verschieben",
	alreadyFirst: "Schon die erste Folie",
	moveSlideDown: "Folie nach unten verschieben",
	alreadyLast: "Schon die letzte Folie",
	deleteSlide: "Folie löschen",

	caption: "Bildunterschrift",
	description: "Beschreibung",
	bodyText: "Text",
	altText: "Alternativtext",
	describeImage: "Beschreibe das Bild",
	videoUrl: "Video-URL",
	deckOrBoardUrl: "URL der Präsentation oder des Boards",
	imageUrl: "Bild-URL",
	imageOrGifUrl: "Bild- / GIF-URL",
	imageOrGif: "Bild / GIF",
	none: "Keins",
	set: "Gesetzt",
	openQuestionPicture: "Das Bild neben dieser Frage öffnen",
	instructionBodyPlaceholder:
		"Ohne Text gilt die Anleitung zum Mitmachen, die der Raum ohnehin sieht.",
	bodyPlaceholder: "Inhalt eingeben…",
	instructionNote:
		"Code zum Mitmachen und QR-Code werden aus der Präsentation erzeugt.",
	videoNoteEmpty:
		"Ein Link zu YouTube oder Vimeo oder direkt zu einer Datei. Das Video bleibt, wo es ist.",
	videoNoteBroken:
		"Dieser Link lässt sich nicht abspielen. Nutze eine Adresse mit http:// oder https://.",
	videoNoteEmbed: "Läuft im Player der Videoplattform.",
	videoNoteFile: "Läuft als Videodatei im Browser.",
	embedNoteEmpty:
		"Ein Link zu Google Slides, PowerPoint oder Miro. Die Präsentation bleibt, wo sie ist.",
	embedNoteBroken:
		"Dieser Link lässt sich nicht einbetten — nur Google Slides, PowerPoint und Miro, über https.",
	embedFrames: {
		powerpoint: "Bettet diese PowerPoint-Präsentation ein.",
		"google-slides": "Bettet diese Google-Slides-Präsentation ein.",
		miro: "Bettet dieses Miro-Board ein — Teilnehmende können darin arbeiten.",
	},

	minutes: "Minuten",
	seconds: "Sekunden",
	countdownMinutes: "Minuten des Countdowns",
	countdownSeconds: "Sekunden des Countdowns",
	countsDownFrom: "Zählt von {length} herunter — höchstens {max}.",

	resetAnswerRules: "Die Antwortregeln auf ihre Standards zurücksetzen",
	pickOne: "Teilnehmende wählen eine Option.",
	pickAny: "Teilnehmende wählen so viele Optionen, wie sie wollen.",
	pickUpTo: "Teilnehmende wählen bis zu {limit} Optionen.",
	responsesAny: "Alle dürfen so viele Antworten schicken, wie sie wollen.",
	responsesLimit: {
		one: "Jede Person darf {count} Antwort schicken.",
		other: "Jede Person darf {count} Antworten schicken.",
	},
	quizTypedConsequence:
		"Getippte Antworten zählen, wenn sie einer der Antworten unten entsprechen.",
	quizSelectConsequence:
		"Eine Option wird gewählt; markiere die richtige auf der Folie.",
	formConsequence:
		"Die Antworten gehen nur an dich — der Raum sieht, wie viele geantwortet haben.",
	selections: "Auswahl",
	selectionsName: "Wie viele Optionen Teilnehmende wählen dürfen",
	any: "Alle",
	answersEach: "Antworten pro Person",
	answersEachName: "Höchstzahl der Antworten pro Person",
	allowUpvoting: "Unterstützen von Antworten erlauben",

	quizModeName: "Wie Teilnehmende antworten",
	modeSelect: "Auswählen",
	modeSelectDescription: "Teilnehmende wählen eine der Optionen, die du schreibst.",
	modeType: "Tippen",
	modeTypeDescription:
		"Teilnehmende tippen ihre Antwort, ohne Auswahl — erinnern statt wiedererkennen.",
	acceptedAnswers: "Akzeptierte Antworten",
	acceptedFirstPlaceholder: "Die Antwort, wie du sie schreiben würdest",
	acceptedMorePlaceholder: "Auch akzeptieren ({number})",
	acceptedAnswerName: "Akzeptierte Antwort {number}",
	removeAcceptedAnswer: "Akzeptierte Antwort {number} entfernen",
	addAcceptedAnswer: "Akzeptierte Antwort hinzufügen",
	acceptedAnswerLimit: "Höchstens {limit} akzeptierte Antworten",
	duplicateAnswers: {
		one: "Eine Antwort wird schon von einer anderen Zeile akzeptiert — beim Vergleich zählen Groß- und Kleinschreibung, Akzente und Leerzeichen nicht.",
		other:
			"{count} Antworten werden schon von einer anderen Zeile akzeptiert — beim Vergleich zählen Groß- und Kleinschreibung, Akzente und Leerzeichen nicht.",
	},

	minValue: "Mindestwert",
	maxValue: "Höchstwert",
	lowLabel: "Beschriftung unten ({value})",
	highLabel: "Beschriftung oben ({value})",
	disagreeExample: "z. B. Stimme nicht zu",
	agreeExample: "z. B. Stimme zu",
	intermediateLabels: "Beschriftungen dazwischen",
	value: "Wert",
	label: "Beschriftung",
	labelValueName: "Wert der Beschriftung {number}",
	labelTextName: "Text der Beschriftung {number}",
	removeLabel: "Beschriftung {number} entfernen",
	addLabel: "Beschriftung hinzufügen",
	statements: "Aussagen",
	statement: "Aussage {number}",
	removeStatement: "Aussage {number} entfernen",
	addStatement: "Aussage hinzufügen",
	statementLimit: "Höchstens {limit} Aussagen",
	allowSkippingStatements: "Überspringen von Aussagen erlauben",

	items: "Elemente",
	item: "Element {number}",
	removeItem: "Element {number} entfernen",
	addItem: "Element hinzufügen",
	itemLimit: "Höchstens {limit} Elemente",
	pointsItems: "Elemente — {budget} Punkte zu verteilen",
	allowSkippingItems: "Überspringen von Elementen erlauben",
	horizontalAxis: "Waagerechte Achse",
	verticalAxis: "Senkrechte Achse",
	axisTitle: "Titel der Achse",
	lowValue: "Unterer Wert",
	highValue: "Oberer Wert",
	effortExample: "z. B. Aufwand",
	lowEffortExample: "z. B. Wenig Aufwand",
	highEffortExample: "z. B. Viel Aufwand",
	impactExample: "z. B. Wirkung",
	lowImpactExample: "z. B. Wenig Wirkung",
	highImpactExample: "z. B. Viel Wirkung",

	fields: "Felder",
	field: "Feld {number}",
	fieldLabelName: "Beschriftung von Feld {number}",
	removeField: "Feld {number} entfernen",
	fieldTypeName: "Art von Feld {number}",
	required: "Pflichtfeld",
	option: "Option {number}",
	fieldOptionName: "Feld {field}, Option {number}",
	removeOption: "Option {number} entfernen",
	addOption: "Option hinzufügen",
	optionLimit: "Höchstens {limit} Optionen",
	addField: "Feld hinzufügen",
	fieldLimit: "Höchstens {limit} Felder",
	fieldText: "Text",
	fieldTextDescription: "Alles, was Teilnehmende tippen.",
	fieldEmail: "E-Mail",
	fieldEmailDescription: "Nur eine Adresse — alles andere wird abgewiesen.",
	fieldChoice: "Auswahl",
	fieldChoiceDescription: "Eine der Optionen, die du schreibst.",

	lowest: "Kleinster Wert",
	highest: "Größter Wert",
	step: "Schritt",
	selectableValues: {
		one: "{count} auswählbarer Wert, {min} bis {max}.",
		other: "{count} auswählbare Werte, {min} bis {max}.",
	},
	guessRangeUnusable:
		"Der größte Wert muss über dem kleinsten liegen, und der Schritt darf nicht größer als der Bereich sein.",
	hasCorrectAnswer: "Diese Frage hat eine richtige Antwort",
	correctNumber: "Richtige Zahl",
	tolerance: "Toleranz (±)",
	guessReferenceOff:
		"Schalte zuerst eine richtige Antwort ein — eine Toleranz um keine Zahl akzeptiert nichts.",
	onlyCorrect: "Nur {value} zählt als richtig.",
	rangeCorrect: "{min} bis {max} zählt als richtig.",
	guessUnreachable:
		"Kein auswählbarer Wert liegt in {range} — niemand könnte je richtig liegen. Nimm eine Zahl, die die Folie anbietet, oder vergrößere die Toleranz.",
	rangeSpan: "{min} bis {max}",

	noPinImage:
		"Noch kein Bild — Teilnehmende können diese Folie nicht beantworten.",
	hasCorrectArea: "Diese Frage hat einen richtigen Bereich",
	correctArea: "Richtiger Bereich",
	areaLeft: "Links (%)",
	areaTop: "Oben (%)",
	areaWidth: "Breite (%)",
	areaHeight: "Höhe (%)",
	pinAreaOff:
		"Schalte zuerst einen richtigen Bereich ein — ohne ihn gibt es nichts zu platzieren.",
	pinAreaOffImage:
		"Dieser Bereich ragt über das Bild hinaus — Links plus Breite und Oben plus Höhe müssen innerhalb von 100 % bleiben.",
	pinAreaInstant:
		"Die Ergebnisse erscheinen sofort, also ist das Ziel zu sehen, während Teilnehmende zielen. Stell das Aufdecken auf „{onClick}“, um es zurückzuhalten.",

	noCountdown: "Kein Countdown — jede richtige Antwort bekommt gleich viele Punkte.",
	countdownConsequence:
		"{seconds} s zum Antworten; wer schneller ist, bekommt mehr, bis zu {points}.",
	resetCountdown: "Den Countdown auf {seconds} Sekunden zurücksetzen",
	countdownNotInEffect:
		"Nicht wirksam: Teilnehmende gehen diese Präsentation im eigenen Tempo durch, also läuft der Countdown nie, und jede richtige Antwort bekommt die vollen {points} Punkte.",
	timeLimit: "Zeitlimit",
	off: "Aus",
	secondsShort: "{seconds} s",
	openCountdown: "Den Countdown öffnen",
	timeLimitSeconds: "Zeitlimit (Sekunden)",
	audioCue: "Audio",
	openAudioCue: "Den Track öffnen, der läuft, solange die Frage offen ist",
	audioTrackUrl: "URL des Audiotracks",
	audioTrack: "Audiotrack",
	audioTrackNamed: "Audiotrack: {track}",
	audioCustom: "Eigener",
	audioNone: "Keiner",
	audioPresets: {
		"quiz-cue-1": "Tickende Uhr",
		"quiz-cue-2": "Herzschlag",
		"quiz-cue-3": "Gezupfte Töne",
	},
	audioPreviewPlay: "{track} abspielen",
	audioPreviewStop: "{track} stoppen",
	audioPreviewFailed:
		"{track} konnte nicht geladen werden. Drück auf Abspielen, um es erneut zu versuchen.",
	noAudioCue: "Diese Frage hat kein Audio.",
	removeAudioCueTitle: "Das Audio dieser Frage entfernen.",
	removeAudioCue: "Audio entfernen",
	audioNoteEmpty:
		"Ein Link zu einer Audiodatei, die auf deinem Präsentationsbildschirm läuft, solange die Frage offen ist — nie auf den Handys der Teilnehmenden. Hochgeladen wird nichts.",
	audioNoteSilent:
		"Kein Track: Diese Frage läuft ohne Ton. Ein Track, den du wählst, spielt auf deinem Präsentationsbildschirm, solange die Frage offen ist — nie auf den Handys der Teilnehmenden.",
	audioNoteUnplayable:
		"Diese Adresse lässt sich nicht abspielen — nutze eine http(s)-URL oder einen Pfad ab der Wurzel dieser Installation.",
	audioNoteNotInEffect:
		"Nicht wirksam: Teilnehmende gehen diese Präsentation im eigenen Tempo durch, also gibt es kein gemeinsames Antwortfenster, und das Audio läuft nie.",
	audioNotePlays:
		"Läuft in Schleife auf deinem Präsentationsbildschirm, vom Öffnen der Frage bis zu ihrem Schließen — nie auf den Handys der Teilnehmenden.",

	visibilityInstant: "Sofort",
	visibilityInstantDescription:
		"Die Ergebnisse erscheinen live auf dem Hauptbildschirm.",
	visibilityOnClick: "Auf Klick",
	visibilityOnClickDescription: "Du deckst die Ergebnisse selbst auf, wenn du so weit bist.",
	visibilityPrivate: "Privat",
	visibilityPrivateDescription:
		"Die Ergebnisse erscheinen nie auf dem Hauptbildschirm.",
	revealInstant: "Ergebnisse erscheinen, sobald Antworten eintreffen",
	revealInstantQuiz:
		"Ergebnisse erscheinen, sobald die Frage vorbei ist (Zeit abgelaufen oder Antworten geschlossen)",
	revealOnClick: "Ergebnisse warten, bis du sie aufdeckst",
	revealPrivate: "Ergebnisse erscheinen nie auf dem geteilten Bildschirm",
	revealDeckDefault: "Standard der Präsentation — {meaning}.",
	overridesDeck: "Weicht ab",
	resetRevealUnavailable:
		"Das Aufdecken dieser Folie ist strenger als ihr Standard — öffne es mit dem Regler „Aufdecken“ oben wieder.",
	resetResults: "Aufdecken und Diagramm auf ihre Standards zurücksetzen",
	reveal: "Aufdecken",
	revealName: "Wann Ergebnisse auf dem geteilten Bildschirm erscheinen",
	// The mode is left out: the tile is 84px wide, no German "default (mode)"
	// fits it, and the group's consequence line names the default's effect
	// whenever this tile is the one chosen.
	deckInherit: "Standard",
	chart: "Diagramm",
	chartName: "Darstellung der Ergebnisse",
	chartBars: "Balken",
	chartBarsDescription: "Ein waagerechter Balken pro Option.",
	chartDonut: "Ring",
	chartDonutDescription: "Ein anteiliger Ring mit der Kopfzahl in der Mitte.",
	chartPie: "Torte",
	chartPieDescription: "Eine anteilige Scheibe — Anteile am Ganzen.",
	chartDots: "Punkte",
	chartDotsDescription: "Ein Punkt pro Stimme, nach Option gruppiert.",
	values: "Werte",
	valuesName: "Werte der Ergebnisse",
	layout: "Anordnung",
	resultLayoutName: "Anordnung der Ergebnisse",
	bubbles: "Blasen",
	grid: "Raster",
	placesShown: "Gezeigte Plätze",
	noQuizSlides:
		"Diese Präsentation hat noch keine Quizfolien, also bleibt die Bestenliste leer.",
	rankingQuizQuestions: {
		one: "Wertet die {count} Quizfrage dieser Präsentation aus.",
		other: "Wertet die {count} Quizfragen dieser Präsentation aus.",
	},

	style: "Stil",
	departsTheme:
		"Diese Folie weicht vom Design der Präsentation ab; alles Unveränderte folgt ihm.",
	followsTheme: "Folgt dem Design der Präsentation.",
	offTheme: "Eigener Stil",
	resetStyle: "Diese Folie auf das Design der Präsentation zurücksetzen",
	slideLayoutName: "Wo die Elemente dieser Folie sitzen",
	layoutInherit: "Wie das Design",
	layoutInheritDescription: "Diese Folie so anordnen, wie es das Design der Präsentation tut.",
	layoutCenter: "Mittig",
	layoutCenterDescription: "Überschrift, Medien und Antworten mittig untereinander.",
	layoutLeft: "Links",
	layoutLeftDescription: "Alles an der vorderen Kante ausgerichtet.",
	layoutRight: "Rechts",
	layoutRightDescription: "Alles an der hinteren Kante ausgerichtet.",
	textSize: "Textgröße",
	textSizeName: "Größe von Überschrift und Text dieser Folie",
	sizeSmall: "Klein",
	sizeMedium: "Mittel",
	sizeLarge: "Groß",
	sizeHuge: "Riesig",
	background: "Hintergrund",
	textColour: "Text",
	chartColour: "Diagramm",
	noChartHint: "Diese Folie zeichnet kein Diagramm, also liest das hier noch nichts.",
	backgroundImage: "Hintergrundbild",
	openBackgroundImage: "Das Bild hinter dieser Folie öffnen",
	backgroundImageUrl: "URL des Hintergrundbilds",
	backgroundImageUnloadable:
		"Diese Adresse lässt sich nicht als Bild laden — nutze eine http(s)-URL oder einen Pfad ab der Wurzel dieser Installation.",
	noBackgroundImage: "Diese Folie hat kein Hintergrundbild.",
	removeBackgroundImageTitle: "Das Hintergrundbild dieser Folie entfernen.",
	removeBackgroundImage: "Hintergrundbild entfernen",

	changed: "Geändert",
	nothingToReset: "Nichts zurückzusetzen — „{title}“ steht auf dem Standard.",
	resetUnavailable: "„{title}“ zurücksetzen — {reason}",
	openColourPicker: "Die Farbauswahl öffnen",
	colourPicker: "Farbauswahl für {label}",
	nothingAuthored: "In diesem Feld ist nichts festgelegt.",
	clearColour: "Diese Farbe entfernen und zur geerbten zurückkehren.",
	clear: "Entfernen",
	notAColourHelp:
		"Keine Farbe — schreib sie als {example} oder #f63. Bis dahin gilt der geerbte Wert.",
	done: "Fertig",
	colourTheme: "Design",
	notAColour: "Keine Farbe",
};
