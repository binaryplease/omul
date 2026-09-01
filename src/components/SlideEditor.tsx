import {
	BarChart3,
	ChartPie,
	ChevronDown,
	ChevronUp,
	CircleDot,
	Donut,
	Eye,
	EyeOff,
	Keyboard,
	ListChecks,
	Mail,
	MousePointerClick,
	Plus,
	Settings2,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import type {
	DeckThemeSettings,
	FormFieldInput,
	FormFieldType,
	GridAxis,
	McDisplayStyle,
	McValueDisplay,
	PinArea,
	PresentationMode,
	QuizAnswerMode,
	ResultsVisibility,
	Slide,
	SlideLayout,
	SlideResultsVisibility,
	SlideTextSize,
	SlideType,
} from "../types";
import {
	defaultResultsVisibilityFor,
	newFormField,
	newFormFieldOption,
	newOption,
	newQuizAnswer,
	withPinAreaEnabled,
} from "../store/editorDocument";
import {
	acceptedQuizAnswers,
	correctGuessRangeFor,
	effectiveResultsVisibility,
	EMBED_PROVIDERS,
	FORM_FIELD_LIMIT,
	FORM_FIELD_OPTION_LIMIT,
	GRID_ITEM_LIMIT,
	gridAxesFor,
	guessRangeFor,
	guessReferenceFor,
	isContentSlideType,
	isMultiSelect,
	isReachableGuessReference,
	isUsableGuessRange,
	LEADERBOARD_DEFAULT_SIZE,
	LEADERBOARD_SIZE_LIMIT,
	leaderboardSizeFor,
	maxResponsesFor,
	maxSelectionsFor,
	middleGuessValue,
	normalizeQuizAnswer,
	PIN_COORDINATE_MAX,
	pinAreaFor,
	pinImageFor,
	POINTS_BUDGET,
	POINTS_ITEM_LIMIT,
	QUIZ_ANSWER_LIMIT,
	QUIZ_MAX_POINTS,
	quizAnswerModeFor,
	RANKING_ITEM_LIMIT,
	SLIDE_ITEM_TEXT_MAX_LENGTH,
	SLIDE_MEDIA_URL_MAX_LENGTH,
	SLIDE_TEXT_MAX_LENGTH,
	slideAppearanceFor,
	slideEmbedFor,
	slideHasResults,
	slideTextSizeFor,
	slideVideoFor,
} from "../types";
import {
	ChoiceCards,
	type ChoiceOption,
	ColorField,
	DisclosureRow,
	Field,
	REMOVE_BUTTON_HOVER,
	Segmented,
	SettingsGroup,
	Toggle,
} from "./EditorControls";
import { PinCanvas } from "./PinImage";
import { isChoiceShapedSlide } from "./SlideCanvasFields";
import { deckThemeAppearance } from "./DeckTheme";
import { slideLayoutOptions } from "./SlideAppearance";
import { useTheme } from "./ui/Theme";
import { MC_VALUE_DISPLAY_OPTIONS } from "./Results";
import { SLIDE_MARKDOWN_HINT, SLIDE_TEXT_SIZE_OPTIONS } from "./SlideText";
import { SlideTypeIcon } from "./SlideTypeIcon";
import {
	SLIDE_TYPE_LABELS,
	SLIDE_TYPE_SECTIONS,
	SlideTypeMenu,
} from "./SlideTypeMenu";

// ── The slide settings column ─────────────────────────────────────────
//
// Everything about a slide that the canvas cannot show, in one ~300px column
// beside it (REQ155). It replaced two stacked framed panels — Content and
// Settings — that ran to three thousand pixels of scroll for a slide whose
// question and options are now written on the slide itself (REQ153).
//
// The column is a run of groups in the order an author works (REQ155): type →
// content → answers → scoring → results → style. **Which** groups a type owns is
// not decided here: `SLIDE_TYPE_SECTIONS` in `SlideTypeMenu.tsx` declares it
// beside the type's own label, and this column composes that declaration
// (ADR-0026) — the conditionals it replaced could not be read as an answer to
// "what does a grid slide let me author?", and any second consumer would have
// had to guess.
//
// Two invariants the column states visibly, and both of them are why it is a
// *column* rather than a form:
//
//   1. **Departure from a default is marked where it happened.** Each settings
//      group carries the marker and the one gesture back ({@link SettingsGroup}),
//      driven by the four departure readings below. A colour that was never
//      authored reads as the word "Theme" rather than as the hex it currently
//      resolves to, because those two states look identical spelled out and only
//      one of them follows the deck when it is re-themed.
//   2. **Prose is one consequence line per group.** The canvas shows what a
//      setting does — the chart style *as drawn* (REQ154), the text size *as
//      typed* (REQ153) — so the paragraphs that used to describe those outcomes
//      are gone. What is left says what the current choice means, never what the
//      choices not taken would have meant.
//
// The postures the requirement carries over are unchanged: a control that is
// unavailable stays visible, inert and says why (ADR-0025 — the quiz countdown
// on an audience-paced deck, the guess tolerance with no correct answer, the
// four pin corners with no target); every enumerated choice is one shared
// descriptor (ADR-0026); and the reveal override still means what REQ102 says,
// with its inherit option naming the deck default it defers to.
//
// All structural mutations are delegated upward through the editor store (the
// CRDT-ready seam); this component is presentational.

// Re-exported so existing importers (SlideThumbnail, CreatePage) keep their
// `from "./SlideEditor"` path while the descriptor itself lives with the picker.
export { SLIDE_TYPE_LABELS } from "./SlideTypeMenu";

// The three concrete results-visibility modes (REQ102). One descriptor, shared
// by the deck-level default picker (CreatePage's DeckSettings) and the per-slide
// override picker below (ADR-0026) so the two surfaces never drift. The per-slide
// picker prepends an "inherit" option that defers to the deck default.
export const RESULTS_VISIBILITY_OPTIONS: ChoiceOption<ResultsVisibility>[] = [
	{
		value: "instant",
		label: "Instant",
		description: "Results update on the main screen in real time.",
		icon: <Eye size={18} />,
	},
	{
		value: "on-click",
		label: "On click",
		description: "You reveal results manually when ready.",
		icon: <MousePointerClick size={18} />,
	},
	{
		value: "private",
		label: "Private",
		description: "Results are never shown on the main screen.",
		icon: <EyeOff size={18} />,
	},
];

/** Human label for a concrete visibility mode (used in the inherit hint). */
export const RESULTS_VISIBILITY_LABEL: Record<ResultsVisibility, string> = {
	instant: "Instant",
	"on-click": "On click",
	private: "Private",
};

/**
 * What the reveal setting in force actually does, in one line (REQ102, REQ155's
 * second invariant).
 *
 * The *effective* mode, not the authored one: a slide set to inherit behaves
 * like whatever the deck says, and an author reading "follow the presentation
 * default" learns nothing about what the room will see. So the sentence is
 * always about the room, and the deferral is said in front of it.
 */
export function resultsRevealConsequence(
	authored: SlideResultsVisibility | undefined,
	deckDefault: ResultsVisibility,
): string {
	const effective = effectiveResultsVisibility(authored, deckDefault);
	const meaning =
		effective === "instant"
			? "results appear as answers arrive"
			: effective === "on-click"
				? "results wait until you reveal them"
				: "results never reach the shared screen";
	const sentence = `${meaning.charAt(0).toUpperCase()}${meaning.slice(1)}.`;
	return (authored ?? "inherit") === "inherit"
		? `Deck default — ${meaning}.`
		: sentence;
}

/**
 * What the note under a video slide's URL field says (REQ064), and whether it is
 * a complaint.
 *
 * The reading comes from `slideVideoFor` — the same resolver the canvas and both
 * live surfaces play the slide through — so the editor can never promise a
 * playback the room will not get. It says which player the URL will open, because
 * "this is a YouTube link" and "this is a file your browser will play" behave
 * differently in front of an audience and the author is choosing between them.
 */
function videoUrlNote(slide: Slide): { text: string; broken: boolean } {
	if ((slide.mediaUrl ?? "").trim() === "") {
		return {
			text: "A YouTube or Vimeo link, or a direct file. The video stays where it is.",
			broken: false,
		};
	}
	const video = slideVideoFor(slide);
	if (!video) {
		return {
			text: "This link can't be played. Use an http:// or https:// address.",
			broken: true,
		};
	}
	return {
		text:
			video.kind === "embed"
				? "Plays in the video platform's own player."
				: "Plays as a video file in the browser.",
		broken: false,
	};
}

/**
 * What the note under an embed slide's URL field says (REQ066/REQ067/REQ068),
 * and whether it is a complaint.
 *
 * The reading comes from `slideEmbedFor` — the same resolver the canvas and both
 * live surfaces frame the slide through — so the editor can never promise an
 * embed the room will not get. It names the provider, because a link that
 * resolved to a provider the author did not expect is a link they pasted from
 * the wrong tab.
 */
function embedUrlNote(slide: Slide): { text: string; broken: boolean } {
	if ((slide.mediaUrl ?? "").trim() === "") {
		return {
			text: "A Google Slides, PowerPoint or Miro link. The deck stays where it is.",
			broken: false,
		};
	}
	const embed = slideEmbedFor(slide);
	if (!embed) {
		// Named as a refusal rather than as a failure, because it is one: the
		// allowlist is the whole rule, and a link outside it is not framed on a
		// guess.
		return {
			text: "This link can't be embedded — only Google Slides, PowerPoint and Miro, over https.",
			broken: true,
		};
	}
	const { label, interactive } = EMBED_PROVIDERS[embed.provider];
	return {
		text: interactive
			? `Frames this ${label} — participants can work in it.`
			: `Frames this ${label} deck.`,
		broken: false,
	};
}

/**
 * How a quiz question is answered (REQ054, REQ055). One descriptor for the
 * picker; what each mode *means* is enforced by `quizAnswerModeFor` and the
 * vote boundary, so the two can never offer a mode the server does not know.
 */
export const QUIZ_ANSWER_MODE_OPTIONS: ChoiceOption<QuizAnswerMode>[] = [
	{
		value: "select",
		label: "Select",
		description: "Participants pick one of the options you write.",
		icon: <ListChecks size={16} />,
	},
	{
		value: "type",
		label: "Type",
		description:
			"Participants type their answer with nothing to choose from — recall, not recognition.",
		icon: <Keyboard size={16} />,
	},
];

/**
 * What one field of a form asks for (REQ061). One descriptor for the picker
 * (ADR-0026); what each type *accepts* is decided by `decodeFormSubmission` at
 * the vote boundary, so this list can never offer a type the server would not
 * validate.
 */
export const FORM_FIELD_TYPE_OPTIONS: ChoiceOption<FormFieldType>[] = [
	{
		value: "text",
		label: "Text",
		description: "Anything the participant types.",
		icon: <Keyboard size={16} />,
	},
	{
		value: "email",
		label: "Email",
		description: "Only an address — anything else is turned away.",
		icon: <Mail size={16} />,
	},
	{
		value: "choice",
		label: "Choice",
		description: "One of the options you write.",
		icon: <ListChecks size={16} />,
	},
];

/**
 * The four result visualizations a choice slide can wear (REQ010). One
 * descriptor for the picker (ADR-0026); the renderers themselves live in
 * Results.tsx, which is what each of these names — and what the canvas draws
 * with when the picker sends it to the results view (REQ154).
 */
export const MC_DISPLAY_STYLE_OPTIONS: ChoiceOption<McDisplayStyle>[] = [
	{
		value: "bars",
		label: "Bars",
		description: "One horizontal bar per option.",
		icon: <BarChart3 size={18} />,
	},
	{
		value: "donut",
		label: "Donut",
		description: "Proportional ring with the head count in the middle.",
		icon: <Donut size={18} />,
	},
	{
		value: "pie",
		label: "Pie",
		description: "Proportional disc — shares of the whole.",
		icon: <ChartPie size={18} />,
	},
	{
		value: "dots",
		label: "Dots",
		description: "One dot per vote, clustered per option.",
		icon: <CircleDot size={18} />,
	},
];

// ── Departure from the default (REQ155, invariant 1) ──────────────────
//
// One reading per settings group: whether this slide disagrees with the default
// it would otherwise carry, and the single write that puts it back. Pure, so
// "does a fresh slide read as unchanged?" is a test rather than a click-through.
//
// **A reset restores defaults; it never deletes words.** The options, items,
// statements, fields and accepted answers an author typed are the slide's
// substance, not a setting with a default to fall back to — so no reset below
// touches one. What they put back is the product's own answer to a question the
// author has since answered differently.

/**
 * How closed a reveal is (REQ102), as an order rather than three names — the one
 * comparison "does this change loosen what the room can see?" needs. Instant is
 * the most open, private the most closed.
 */
const REVEAL_TIGHTNESS: Record<ResultsVisibility, number> = {
	instant: 0,
	"on-click": 1,
	private: 2,
};

/** Whether a group departs from its default, and the write that undoes it. */
export type SlideSettingsDeparture = {
	departed: boolean;
	/** The change that puts every setting in the group back. */
	reset: Partial<Slide>;
	/**
	 * Whether this group has anything a reset could ever put back on this slide
	 * type. `false` means the control does not exist rather than being
	 * unavailable — the distinction `SettingsGroup` draws, and the reason a type
	 * with no answer rules gets no permanently-inert reset (ADR-0025).
	 */
	resettable: boolean;
};

/** Build a departure from the fields that are off their default. */
function departureFrom(
	changes: [boolean, Partial<Slide>][],
	resettable = true,
): SlideSettingsDeparture {
	const off = changes.filter(([departed]) => departed);
	return {
		departed: off.length > 0,
		reset: off.reduce<Partial<Slide>>(
			(merged, [, change]) => ({ ...merged, ...change }),
			{},
		),
		resettable,
	};
}

/**
 * The answer *rules* — how many may be picked, how many may be written, and
 * whether an item may be skipped (REQ014/REQ024/REQ031/REQ050).
 *
 * Rules are gathered per type rather than filtered out of one flat list, so
 * "does this type have an answer rule at all?" is the same fact as "which rules
 * does it have" — a type with none gets no reset control rather than one that is
 * disabled forever.
 *
 * A quiz's answer *mode* is deliberately not among them (REQ054/REQ055). It is
 * the shape of the question rather than a default it strayed from: switching a
 * typed question back to select does not restore a setting, it retires the
 * answer key the author wrote and promotes the options underneath it — which is
 * exactly the kind of write no reset here may make.
 */
export function slideAnswerRulesDeparture(slide: Slide): SlideSettingsDeparture {
	const rules: [boolean, Partial<Slide>][] = [];
	if (slide.type === "multiple-choice") {
		rules.push([
			maxSelectionsFor(slide) !== 1,
			{ mcMaxSelections: null, allowMultiple: false },
		]);
	}
	if (slide.type === "word-cloud" || slide.type === "open-text") {
		// Through the shared resolver, not `slide.maxResponses` alone: a legacy
		// slide spells "unlimited" as `allowMultiple: true` with no explicit cap,
		// and the marker must report the rule the boundary actually enforces.
		rules.push([
			maxResponsesFor(slide) !== 1,
			{ maxResponses: 1, allowMultiple: false },
		]);
	}
	if (slide.type === "open-text") {
		rules.push([
			slide.allowResponseVotes ?? false,
			{ allowResponseVotes: false },
		]);
	}
	if (slide.type === "scale") {
		rules.push([slide.scaleAllowSkip ?? false, { scaleAllowSkip: false }]);
	}
	if (slide.type === "grid") {
		rules.push([slide.gridAllowSkip ?? false, { gridAllowSkip: false }]);
	}
	return departureFrom(rules, rules.length > 0);
}

/** How a quiz question is scored and timed (REQ054/REQ057). */
export function slideScoringDeparture(slide: Slide): SlideSettingsDeparture {
	return departureFrom([[(slide.timeLimit ?? 30) !== 30, { timeLimit: 30 }]]);
}

/**
 * When the aggregate is shown and how it is drawn (REQ102/REQ010/REQ011/REQ023/
 * REQ059) — the deck-level default among them, which is what makes this the one
 * group whose marker can mean "this slide disagrees with the presentation".
 *
 * The reveal is measured against {@link defaultResultsVisibilityFor}, **not**
 * against a literal `"inherit"`, and that distinction is the whole safety of
 * this group: two slide shapes carry a product default that is deliberately
 * tighter than the deck's — a form opens `private` (REQ061) and a pin slide with
 * a target area is pinned to `on-click` (REQ053). Measured against `"inherit"`
 * they would read as *departing* while sitting exactly on the posture the
 * product gave them, and the "way back" this group offers would have been the
 * way *out*: one click putting a form's submissions or a pin slide's answer key
 * on the shared screen. A reset here can only restore the slide's own default,
 * so on those two shapes it tightens or does nothing — it never loosens.
 */
export function slideResultsDeparture(
	slide: Slide,
	deckResultsVisibility: ResultsVisibility,
): SlideSettingsDeparture {
	const authoredVisibility = slide.resultsVisibility ?? "inherit";
	const defaultVisibility = defaultResultsVisibilityFor(
		slide,
		deckResultsVisibility,
	);
	const revealDeparted = authoredVisibility !== defaultVisibility;
	// Restoring the default is a *tightening* or nothing. A pin slide's target
	// pins it to `on-click` and an author may then go further and make it
	// private; putting the default back there would open a slide the author
	// deliberately closed, so the reveal simply stays out of the bundle. The
	// marker still says the group departs — the way back is the reveal's own
	// control, one gesture above, which is where a loosening belongs.
	const restoringLoosens =
		REVEAL_TIGHTNESS[
			effectiveResultsVisibility(defaultVisibility, deckResultsVisibility)
		] <
		REVEAL_TIGHTNESS[
			effectiveResultsVisibility(authoredVisibility, deckResultsVisibility)
		];
	const bundled = departureFrom([
		[
			revealDeparted && !restoringLoosens,
			{ resultsVisibility: defaultVisibility },
		],
		[
			isChoiceShapedSlide(slide) && (slide.mcDisplayStyle ?? "bars") !== "bars",
			{ mcDisplayStyle: "bars" },
		],
		[
			isChoiceShapedSlide(slide) && (slide.mcValueDisplay ?? "both") !== "both",
			{ mcValueDisplay: "both" },
		],
		[
			slide.type === "open-text" &&
				(slide.openTextLayout ?? "speech-bubbles") !== "speech-bubbles",
			{ openTextLayout: "speech-bubbles" },
		],
		[
			slide.type === "leaderboard" &&
				leaderboardSizeFor(slide) !== LEADERBOARD_DEFAULT_SIZE,
			{ leaderboardSize: LEADERBOARD_DEFAULT_SIZE },
		],
	]);
	// The marker covers the reveal either way — a slide that disagrees with the
	// presentation says so whether or not this group is the place to undo it.
	return { ...bundled, departed: bundled.departed || revealDeparted };
}

/**
 * The slide's own appearance over the deck's theme (REQ087/REQ091) — the group
 * whose whole point is that leaving it alone *is* following the deck.
 */
export function slideStyleDeparture(slide: Slide): SlideSettingsDeparture {
	const appearance = slideAppearanceFor(slide);
	return departureFrom([
		[(slide.layout ?? "inherit") !== "inherit", { layout: "inherit" }],
		[slideTextSizeFor(slide) !== "medium", { textSize: "medium" }],
		// Read through the resolver: a half-typed colour authors nothing on any
		// screen, and a group that called it a departure would offer to reset a
		// slide that is already drawn in the deck's own colours.
		[appearance.backgroundColor !== "", { backgroundColor: "" }],
		[appearance.backgroundImage !== "", { backgroundImage: "" }],
		[appearance.textColor !== "", { textColor: "" }],
		[appearance.chartColor !== "", { chartColor: "" }],
	]);
}

/**
 * Small icon button for removing a repeated row. Its muted → error step is the
 * shared token (ADR-0028), composed rather than re-declared, so this column and
 * the canvas's per-option remove tool (REQ153) warn about deletion in one red.
 */
function RemoveRowButton({
	onClick,
	label,
}: {
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			className={`flex-shrink-0 ${REMOVE_BUTTON_HOVER} transition-colors p-1 rounded-lg hover:bg-surface-hover`}
			onClick={onClick}
			aria-label={label}
			title={label}
		>
			<X size={14} />
		</button>
	);
}

/**
 * Accent text button for adding a repeated row.
 *
 * The accent here is *words*, not a filled surface, so it goes through
 * `accent-text` rather than the raw accent (REQ157): the tangerine is built to
 * sit behind white and reads at 2.59:1 on the light page, while `accent-text`
 * resolves per scheme to something that clears AA in both (6.65:1 dark,
 * 5.55:1 light). Same for its hover — a hover state is still text.
 */
function AddRowButton({
	onClick,
	label,
	disabled,
	disabledLabel,
}: {
	onClick: () => void;
	label: string;
	disabled?: boolean;
	disabledLabel?: string;
}) {
	return (
		<button
			type="button"
			className="inline-flex items-center gap-1.5 text-xs text-accent-text hover:text-accent-text-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			onClick={onClick}
			disabled={disabled}
		>
			<Plus size={14} />
			{disabled && disabledLabel ? disabledLabel : label}
		</button>
	);
}

/**
 * Everything an author states about one dimension of a 2x2 grid: what it
 * measures (REQ048) and where it starts and ends, as numbers and as named
 * poles (REQ049). Written once and composed by both axes (ADR-0026) so the
 * horizontal and the vertical dimension can never offer different settings.
 */
function GridAxisFields({
	axis,
	onChange,
	titlePlaceholder,
	lowPlaceholder,
	highPlaceholder,
}: {
	axis: GridAxis;
	onChange: (changes: Partial<GridAxis>) => void;
	titlePlaceholder: string;
	lowPlaceholder: string;
	highPlaceholder: string;
}) {
	return (
		<>
			<Field label="Axis title">
				<input
					className="input"
					placeholder={titlePlaceholder}
					maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
					value={axis.title}
					onChange={(event) => onChange({ title: event.target.value })}
				/>
			</Field>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Low value">
					<input
						type="number"
						className="input"
						value={axis.min}
						onChange={(event) =>
							onChange({ min: Math.round(Number(event.target.value) || 0) })
						}
					/>
				</Field>
				<Field label="High value">
					<input
						type="number"
						className="input"
						value={axis.max}
						onChange={(event) =>
							onChange({ max: Math.round(Number(event.target.value) || 0) })
						}
					/>
				</Field>
				<Field label={`Low label (${axis.min})`}>
					<input
						className="input"
						placeholder={lowPlaceholder}
						maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
						value={axis.minLabel}
						onChange={(event) => onChange({ minLabel: event.target.value })}
					/>
				</Field>
				<Field label={`High label (${axis.max})`}>
					<input
						className="input"
						placeholder={highPlaceholder}
						maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
						value={axis.maxLabel}
						onChange={(event) => onChange({ maxLabel: event.target.value })}
					/>
				</Field>
			</div>
		</>
	);
}

/**
 * One edge of a Pin on Image target area, authored as a percentage of the image
 * (REQ053). Written once and worn by all four corners (ADR-0026), so no two of
 * them can round, clamp or label a coordinate differently.
 *
 * Percent on screen, per-mille underneath: the schema's lattice is a thousandth
 * of an edge because that is the resolution a *tap* is recorded at, while an
 * author typing a box thinks in percentages of the picture. One decimal is kept
 * so a field never silently rewrites a corner a drag placed between two whole
 * percents.
 */
function PinAreaField({
	label,
	value,
	onChange,
	disabled,
	disabledReason,
}: {
	label: string;
	/** The stored per-mille coordinate. */
	value: number;
	/** Reports the next per-mille coordinate. */
	onChange: (next: number) => void;
	disabled: boolean;
	disabledReason: string;
}) {
	return (
		<Field label={label}>
			<input
				type="number"
				className="input"
				min={0}
				max={100}
				step={0.1}
				value={Math.round(value) / 10}
				disabled={disabled}
				title={disabled ? disabledReason : undefined}
				onChange={(event) => {
					const percent = Number(event.target.value);
					// An empty or unparseable field is mid-typing, not a zero-width
					// target: leave the corner where it is until a number arrives.
					if (!Number.isFinite(percent)) return;
					onChange(
						Math.max(0, Math.min(PIN_COORDINATE_MAX, Math.round(percent * 10))),
					);
				}}
			/>
		</Field>
	);
}

/** What the column writes back with, bound to the slide it is authoring. */
type SlideSettingsProps = {
	slide: Slide;
	onUpdate: (changes: Partial<Slide>) => void;
};

export function SlideEditor({
	slide,
	index,
	total,
	canRemove,
	onUpdate,
	onMove,
	onRemove,
	onPreviewResults,
	deckResultsVisibility,
	deckMode,
	deckQuizCount,
	deck = null,
}: {
	slide: Slide;
	index: number;
	total: number;
	canRemove: boolean;
	onUpdate: (changes: Partial<Slide>) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
	/**
	 * Ask the stage for its results view (REQ154). Called when the author changes
	 * something the room only meets *as a rendering* — the chart style and the
	 * value display — because the choice is between two pictures, and a labelled
	 * card is not one of them.
	 */
	onPreviewResults: () => void;
	/** Deck-level default a slide set to "inherit" follows (REQ102). */
	deckResultsVisibility: ResultsVisibility;
	/**
	 * How the deck is paced (REQ003/REQ082). A quiz question's countdown needs a
	 * shared instant to run from, which only a presenter-paced deck has — see the
	 * scoring group below.
	 */
	deckMode: PresentationMode;
	/**
	 * How many quiz questions the deck holds (REQ059). A leaderboard summarizes
	 * slides it does not own, so it is the one slide whose author needs to be told
	 * something about the rest of the deck: a board in a deck with no quiz
	 * questions is authored correctly and will still be empty.
	 */
	deckQuizCount: number;
	/**
	 * The deck's theming (REQ087) — the layer this slide's own appearance is laid
	 * over. Read for one thing only: what each unauthored colour currently
	 * *inherits*, so the swatch beside each field is the colour that stands.
	 */
	deck?: DeckThemeSettings | null;
}) {
	const sections = SLIDE_TYPE_SECTIONS[slide.type];

	return (
		<div className="slide-in space-y-3">
			<SlideHeader
				slide={slide}
				index={index}
				total={total}
				canRemove={canRemove}
				onUpdate={onUpdate}
				onMove={onMove}
				onRemove={onRemove}
			/>

			<div className="space-y-3">
				{sections.content && (
					<ContentGroup
						slide={slide}
						onUpdate={onUpdate}
						title={sections.content}
					/>
				)}
				{sections.answers && (
					<AnswersGroup
						slide={slide}
						onUpdate={onUpdate}
						title={sections.answers}
						scrolls={sections.scrolls}
						deckResultsVisibility={deckResultsVisibility}
					/>
				)}
				{sections.scoring && (
					<ScoringGroup
						slide={slide}
						onUpdate={onUpdate}
						title={sections.scoring}
						deckMode={deckMode}
					/>
				)}
				{sections.results && (
					<ResultsGroup
						slide={slide}
						onUpdate={onUpdate}
						title={sections.results}
						onPreviewResults={onPreviewResults}
						deckResultsVisibility={deckResultsVisibility}
						deckQuizCount={deckQuizCount}
					/>
				)}
				<StyleGroup slide={slide} onUpdate={onUpdate} deck={deck} />
			</div>
		</div>
	);
}

/**
 * The slide the column is about: which one of the deck it is, what type it is —
 * changeable from here — and the three things that can be done to it as a whole.
 *
 * It is the column's masthead rather than a group of its own: the type is the
 * one setting that decides which groups exist below it (REQ155's order starts
 * with it), and the reorder and delete controls act on the slide, not on any of
 * its settings.
 */
function SlideHeader({
	slide,
	index,
	total,
	canRemove,
	onUpdate,
	onMove,
	onRemove,
}: SlideSettingsProps & {
	index: number;
	total: number;
	canRemove: boolean;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
}) {
	// Ephemeral view state; the component remounts per slide (keyed on id), so
	// switching slides naturally closes the menu.
	const [typeMenuOpen, setTypeMenuOpen] = useState(false);

	const handleTypeChange = (type: SlideType) => {
		const changes: Partial<Slide> = { type };
		if ((type === "multiple-choice" || type === "quiz") && !slide.options) {
			changes.options = [
				{ id: crypto.randomUUID(), text: "" },
				{ id: crypto.randomUUID(), text: "" },
			];
		}
		if (type === "scale" && !slide.scaleMin) {
			changes.scaleMin = 1;
			changes.scaleMax = 5;
		}
		if (type === "ranking" && !slide.rankingItems?.length) {
			changes.rankingItems = [
				{ id: crypto.randomUUID(), text: "" },
				{ id: crypto.randomUUID(), text: "" },
			];
		}
		if (type === "grid" && !slide.gridItems?.length) {
			changes.gridItems = [
				{ id: crypto.randomUUID(), text: "" },
				{ id: crypto.randomUUID(), text: "" },
			];
		}
		if (type === "points" && !slide.pointsItems?.length) {
			changes.pointsItems = [
				{ id: crypto.randomUUID(), text: "" },
				{ id: crypto.randomUUID(), text: "" },
			];
		}
		if (type === "guess-number" && !slide.guessRange) {
			// The frame the schema defaults to (REQ040/REQ043), so converting an
			// existing slide never lands on empty number fields.
			changes.guessRange = { min: 0, max: 100, step: 1 };
		}
		// REQ061 — converting an existing slide into a form lands on the two
		// fields a fresh one opens with, so the author never meets an empty field
		// list with nothing to edit. Its `private` posture is seeded here too: a
		// slide that starts collecting names must not inherit the reveal mode the
		// question it used to be was authored under.
		if (type === "form" && !slide.formFields?.length) {
			changes.formFields = [
				{ ...newFormField("text"), label: "Name" },
				{ ...newFormField("email"), label: "Email" },
			];
			changes.resultsVisibility = "private";
		}
		if (type === "leaderboard" && !slide.leaderboardSize) {
			// The board's default size (REQ059), so converting an existing slide
			// never lands on an empty places field.
			changes.leaderboardSize = LEADERBOARD_DEFAULT_SIZE;
		}
		if (type === "quiz") changes.timeLimit = slide.timeLimit || 30;
		onUpdate(changes);
	};

	return (
		<div className="flex items-center justify-between gap-2">
			{/* Which slide of the deck this is, is not repeated here: the canvas says
			    it in its caption (REQ152), and the column's height is the budget
			    REQ155 spends on controls. */}
			<div className="min-w-0">
				{/* The slide-type changer: a prominent trigger that opens a visual
				    picker of every type, so converting a slide is a discoverable
				    choice rather than a hunt through a native dropdown. */}
				<div className="relative">
					<button
						type="button"
						onClick={() => setTypeMenuOpen((open) => !open)}
						aria-expanded={typeMenuOpen}
						aria-haspopup="menu"
						aria-label="Change slide type"
						className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised py-1 pl-1 pr-2.5 transition-colors hover:border-text-dim"
					>
						<span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-void/50">
							<SlideTypeIcon type={slide.type} />
						</span>
						<span className="truncate text-sm font-semibold text-text">
							{SLIDE_TYPE_LABELS[slide.type]}
						</span>
						<ChevronDown
							size={15}
							className={`flex-shrink-0 text-text-muted transition-transform ${
								typeMenuOpen ? "rotate-180" : ""
							}`}
						/>
					</button>
					{typeMenuOpen && (
						<>
							{/* Click-away backdrop closes the popover. */}
							<button
								type="button"
								aria-label="Close slide type menu"
								className="fixed inset-0 z-20 cursor-default"
								onClick={() => setTypeMenuOpen(false)}
							/>
							<div className="absolute left-0 top-full z-30 mt-2 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-2xl slide-in">
								<p className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
									Change slide type
								</p>
								<SlideTypeMenu
									current={slide.type}
									withHints
									onSelect={(type) => {
										handleTypeChange(type);
										setTypeMenuOpen(false);
									}}
								/>
							</div>
						</>
					)}
				</div>
			</div>
			<div className="flex flex-shrink-0 items-center gap-0.5">
				<button
					type="button"
					className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30 disabled:hover:text-text-muted"
					onClick={() => onMove(-1)}
					disabled={index === 0}
					title="Move slide up"
					aria-label="Move slide up"
				>
					<ChevronUp size={15} />
				</button>
				<button
					type="button"
					className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30 disabled:hover:text-text-muted"
					onClick={() => onMove(1)}
					disabled={index === total - 1}
					title="Move slide down"
					aria-label="Move slide down"
				>
					<ChevronDown size={15} />
				</button>
				<button
					type="button"
					className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-error disabled:opacity-30 disabled:hover:text-text-muted"
					onClick={onRemove}
					disabled={!canRemove}
					title={
						canRemove ? "Delete slide" : "A presentation needs at least one slide"
					}
					aria-label="Delete slide"
				>
					<Trash2 size={15} />
				</button>
			</div>
		</div>
	);
}

/**
 * What the slide shows besides the words written on it: the file or link a
 * content slide is built around (REQ062–REQ068), and the optional picture beside
 * an interactive question (REQ069).
 *
 * No marker and no reset: this group is the slide's substance, not a setting
 * with a default — "reset the video URL" is a deletion, and REQ155's one gesture
 * is for putting a *choice* back, never for throwing away an author's work.
 */
function ContentGroup({
	slide,
	onUpdate,
	title,
}: SlideSettingsProps & { title: string }) {
	const captionLabel =
		slide.type === "image" || slide.type === "video" || slide.type === "embed"
			? "Caption"
			: slide.type === "instruction"
				? "Description"
				: "Body text";
	const videoNote = slide.type === "video" ? videoUrlNote(slide) : null;
	const embedNote = slide.type === "embed" ? embedUrlNote(slide) : null;
	const note = videoNote ?? embedNote;
	const isInteractiveMedia = !isContentSlideType(slide.type);

	const mediaFields = (
		<>
			<Field
				label={
					slide.type === "video"
						? "Video URL"
						: slide.type === "embed"
							? "Deck or board URL"
							: slide.type === "image"
								? "Image URL"
								: "Image / GIF URL"
				}
			>
				<input
					className="input"
					placeholder="https://..."
					maxLength={SLIDE_MEDIA_URL_MAX_LENGTH}
					value={slide.mediaUrl ?? ""}
					onChange={(event) => onUpdate({ mediaUrl: event.target.value })}
				/>
			</Field>
			{/* What the URL will actually open, beside the field that sets it
			    (ADR-0031) and read through the same resolver the room's own surfaces
			    use — so an author who pasted a link this cannot play or frame finds
			    out here rather than in front of a room. */}
			{note && (
				<p className={`text-xs ${note.broken ? "text-error" : "text-text-muted"}`}>
					{note.text}
				</p>
			)}
			{(slide.type === "image" || (slide.mediaUrl ?? "") !== "") && (
				<Field label="Alt text">
					<input
						className="input"
						placeholder="Describe the image"
						maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
						value={slide.mediaAlt ?? ""}
						onChange={(event) => onUpdate({ mediaAlt: event.target.value })}
					/>
				</Field>
			)}
		</>
	);

	return (
		<SettingsGroup title={title}>
			{/* On a content slide the link *is* the slide, so it is open. On a
			    question it is the optional illustration REQ069 offers, touched on a
			    minority of slides — so it rests as a row that says whether there is
			    one, and opens where it sits. */}
			{isInteractiveMedia ? (
				<DisclosureRow
					label="Image / GIF"
					value={(slide.mediaUrl ?? "").trim() === "" ? "None" : "Set"}
					openHint="Open the picture beside this question"
				>
					{mediaFields}
				</DisclosureRow>
			) : (
				(slide.type === "image" ||
					slide.type === "video" ||
					slide.type === "embed") &&
				mediaFields
			)}
			{!isInteractiveMedia && (
				<Field
					label={captionLabel}
					hint={captionLabel === "Body text" ? SLIDE_MARKDOWN_HINT : undefined}
				>
					<textarea
						className="input"
						rows={slide.type === "text" ? 5 : 2}
						placeholder={
							slide.type === "instruction"
								? "Defaults to the room's own joining instructions."
								: "Enter content..."
						}
						maxLength={SLIDE_TEXT_MAX_LENGTH}
						value={slide.body ?? ""}
						onChange={(event) => onUpdate({ body: event.target.value })}
					/>
				</Field>
			)}
			{slide.type === "text" && (
				<Field label="Image URL">
					<input
						className="input"
						placeholder="https://..."
						maxLength={SLIDE_MEDIA_URL_MAX_LENGTH}
						value={slide.mediaUrl ?? ""}
						onChange={(event) => onUpdate({ mediaUrl: event.target.value })}
					/>
				</Field>
			)}
			{slide.type === "instruction" && (
				<p className="text-xs text-text-muted">
					The join code and QR code are generated from the presentation.
				</p>
			)}
		</SettingsGroup>
	);
}

/**
 * The rules the slide's answers follow, and the answer shapes that are a
 * structured field set rather than a list of rows on the canvas: accepted quiz
 * answers, scale statements, grid axes and items, form fields, the guess range,
 * the pin target (REQ153/REQ155).
 *
 * Where that field set can run long the group scrolls inside the column
 * (`scrolls`, declared per type in `SLIDE_TYPE_SECTIONS`), so twenty form fields
 * never push the reveal and the appearance off the bottom of the page.
 */
function AnswersGroup({
	slide,
	onUpdate,
	title,
	scrolls,
	deckResultsVisibility,
}: SlideSettingsProps & {
	title: string;
	scrolls: boolean;
	deckResultsVisibility: ResultsVisibility;
}) {
	const departure = slideAnswerRulesDeparture(slide);
	return (
		<SettingsGroup
			title={title}
			consequence={answersConsequence(slide)}
			departed={departure.departed}
			resetLabel="Put the answer rules back to their defaults"
			// A type with no answer rule at all gets no control, rather than one
			// disabled forever: there is no unavailable action here to explain.
			onReset={
				departure.resettable ? () => onUpdate(departure.reset) : undefined
			}
		>
			<div
				className={
					scrolls ? "max-h-[28rem] space-y-3 overflow-y-auto pr-1" : "space-y-3"
				}
			>
				{slide.type === "multiple-choice" && (
					<McSelectionField slide={slide} onUpdate={onUpdate} />
				)}
				{(slide.type === "word-cloud" || slide.type === "open-text") && (
					<ResponseRulesFields slide={slide} onUpdate={onUpdate} />
				)}
				{slide.type === "quiz" && (
					<QuizAnswerFields slide={slide} onUpdate={onUpdate} />
				)}
				{slide.type === "scale" && (
					<ScaleFields slide={slide} onUpdate={onUpdate} />
				)}
				{slide.type === "ranking" && (
					<RankingItemFields slide={slide} onUpdate={onUpdate} />
				)}
				{slide.type === "points" && (
					<PointsItemFields slide={slide} onUpdate={onUpdate} />
				)}
				{slide.type === "grid" && (
					<GridFields slide={slide} onUpdate={onUpdate} />
				)}
				{slide.type === "form" && (
					<FormFields slide={slide} onUpdate={onUpdate} />
				)}
				{slide.type === "guess-number" && (
					<GuessFields slide={slide} onUpdate={onUpdate} />
				)}
				{slide.type === "pin-image" && (
					<PinFields
						slide={slide}
						onUpdate={onUpdate}
						deckResultsVisibility={deckResultsVisibility}
					/>
				)}
			</div>
		</SettingsGroup>
	);
}

/** The one line the answers group is allowed (REQ155): what the rules do now. */
function answersConsequence(slide: Slide): string | undefined {
	if (slide.type === "multiple-choice") {
		if (!isMultiSelect(slide)) return "Participants pick one option.";
		const limit = maxSelectionsFor(slide);
		return limit === 0
			? "Participants pick as many options as they like."
			: `Participants pick up to ${limit} options.`;
	}
	if (slide.type === "word-cloud" || slide.type === "open-text") {
		const limit = maxResponsesFor(slide);
		return limit === 0
			? "Each participant may send as many answers as they like."
			: `Each participant may send ${limit} answer${limit === 1 ? "" : "s"}.`;
	}
	if (slide.type === "quiz") {
		return quizAnswerModeFor(slide) === "type"
			? "Typed answers count when they match one below."
			: "Pick one option; mark the answer on the slide.";
	}
	if (slide.type === "form") {
		return "Answers go to you only — the room sees how many replied.";
	}
	return undefined;
}

/** REQ014 — how many of the answer set one participant may take. */
function McSelectionField({ slide, onUpdate }: SlideSettingsProps) {
	return (
		<Field label="Selections" inline>
			<Segmented
				compact
				ariaLabel="Options a participant may select"
				value={String(maxSelectionsFor(slide))}
				onChange={(value) => {
					const count = Number(value);
					onUpdate({
						mcMaxSelections: count,
						// Keep the legacy flag in sync for older consumers.
						allowMultiple: count === 0 || count > 1,
					});
				}}
				options={[
					{ value: "1", label: "1" },
					{ value: "2", label: "2" },
					{ value: "3", label: "3" },
					{ value: "4", label: "4" },
					{ value: "5", label: "5" },
					{ value: "0", label: "Any" },
				]}
			/>
		</Field>
	);
}

/** REQ022/REQ024/REQ025 — how much one participant may write, and may upvote. */
function ResponseRulesFields({ slide, onUpdate }: SlideSettingsProps) {
	return (
		<>
			<Field label="Answers each" inline>
				<Segmented
					compact
					ariaLabel="Maximum answers per participant"
					value={String(maxResponsesFor(slide))}
					onChange={(value) => {
						const count = Number(value);
						onUpdate({
							maxResponses: count,
							// Keep legacy flag in sync for older consumers.
							allowMultiple: count === 0 || count > 1,
						});
					}}
					options={[
						{ value: "1", label: "1" },
						{ value: "2", label: "2" },
						{ value: "3", label: "3" },
						{ value: "4", label: "4" },
						{ value: "5", label: "5" },
						{ value: "0", label: "Any" },
					]}
				/>
			</Field>
			{slide.type === "open-text" && (
				<Toggle
					label="Allow upvoting responses"
					checked={slide.allowResponseVotes ?? false}
					onChange={(checked) => onUpdate({ allowResponseVotes: checked })}
				/>
			)}
		</>
	);
}

/**
 * How a quiz question is answered (REQ054 select, REQ055 type) and, when it is
 * typed, the whole answer key — the accepted spellings a typed answer is matched
 * against.
 */
function QuizAnswerFields({ slide, onUpdate }: SlideSettingsProps) {
	const isTyped = quizAnswerModeFor(slide) === "type";
	/**
	 * Two accepted answers that only differ in the ways matching already ignores
	 * (REQ055) — "Paris" and "paris." — are one answer written twice. Flagged
	 * rather than blocked: the organizer is mid-typing more often than mistaken.
	 */
	const duplicates = (() => {
		const seen = new Set<string>();
		let found = 0;
		for (const accepted of acceptedQuizAnswers(slide)) {
			const key = normalizeQuizAnswer(accepted);
			if (seen.has(key)) found++;
			seen.add(key);
		}
		return found;
	})();

	return (
		<>
			{/* No caption: the group is called Answers, its consequence line says
			    what the mode in force does, and the two tiles name themselves. */}
			<ChoiceCards<QuizAnswerMode>
				ariaLabel="How participants answer"
				variant="tile"
				columns={2}
				value={quizAnswerModeFor(slide)}
				onChange={(mode) => {
					const changes: Partial<Slide> = { quizAnswerMode: mode };
					// Switching into typed answers opens on one blank solution rather
					// than an empty list, so the field the question needs to be
					// answerable at all is visible without a click.
					if (mode === "type" && !slide.quizAnswers?.length) {
						changes.quizAnswers = [newQuizAnswer()];
					}
					// Switching back needs options to offer; a quiz converted from
					// another slide type may never have had any.
					if (mode === "select" && !slide.options?.length) {
						changes.options = [newOption("quiz"), newOption("quiz")];
					}
					onUpdate(changes);
				}}
				options={QUIZ_ANSWER_MODE_OPTIONS}
			/>
			{isTyped && (
				<Field label="Accepted answers">
					<div className="space-y-2">
						{(slide.quizAnswers ?? []).map((accepted, answerIndex) => (
							<div key={accepted.id} className="flex items-center gap-1.5">
								<input
									className="input flex-1"
									placeholder={
										answerIndex === 0
											? "The answer, as you would write it"
											: `Also accept ${answerIndex + 1}`
									}
									maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
									value={accepted.text}
									onChange={(event) => {
										const next = [...(slide.quizAnswers ?? [])];
										next[answerIndex] = {
											...next[answerIndex],
											text: event.target.value,
										};
										onUpdate({ quizAnswers: next });
									}}
									aria-label={`Accepted answer ${answerIndex + 1}`}
								/>
								{(slide.quizAnswers?.length ?? 0) > 1 && (
									<RemoveRowButton
										onClick={() => {
											const next = (slide.quizAnswers ?? []).filter(
												(_, position) => position !== answerIndex,
											);
											onUpdate({ quizAnswers: next });
										}}
										label={`Remove accepted answer ${answerIndex + 1}`}
									/>
								)}
							</div>
						))}
						<AddRowButton
							onClick={() =>
								onUpdate({
									quizAnswers: [...(slide.quizAnswers ?? []), newQuizAnswer()],
								})
							}
							label="Add accepted answer"
							disabled={(slide.quizAnswers?.length ?? 0) >= QUIZ_ANSWER_LIMIT}
							disabledLabel={`At most ${QUIZ_ANSWER_LIMIT} accepted answers`}
						/>
						{/* A typed question with no solution scores nobody — the same
						    stance a choice slide takes when nothing is marked correct
						    (REQ013). Said out loud, because unlike a blank option it
						    leaves no visible gap on the participant's screen. */}
						{acceptedQuizAnswers(slide).length === 0 && (
							<p className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
								No accepted answer yet — nobody can score on this question.
							</p>
						)}
						{duplicates > 0 && (
							<p className="text-xs text-text-muted">
								{duplicates === 1
									? "One answer is already accepted by another row — matching ignores case, accents and spacing."
									: `${duplicates} answers are already accepted by another row — matching ignores case, accents and spacing.`}
							</p>
						)}
					</div>
				</Field>
			)}
		</>
	);
}

/** REQ029–REQ032 — the scale itself, the points named on it, and its statements. */
function ScaleFields({ slide, onUpdate }: SlideSettingsProps) {
	return (
		<>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Min value">
					<input
						type="number"
						className="input"
						value={slide.scaleMin ?? 1}
						onChange={(event) =>
							onUpdate({ scaleMin: Number(event.target.value) || 1 })
						}
						min={0}
						max={10}
					/>
				</Field>
				<Field label="Max value">
					<input
						type="number"
						className="input"
						value={slide.scaleMax ?? 5}
						onChange={(event) =>
							onUpdate({ scaleMax: Number(event.target.value) || 5 })
						}
						min={2}
						max={10}
					/>
				</Field>
				<Field label={`Low label (${slide.scaleMin})`}>
					<input
						className="input"
						placeholder="e.g. Disagree"
						maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
						value={slide.scaleMinLabel ?? ""}
						onChange={(event) => onUpdate({ scaleMinLabel: event.target.value })}
					/>
				</Field>
				<Field label={`High label (${slide.scaleMax})`}>
					<input
						className="input"
						placeholder="e.g. Agree"
						maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
						value={slide.scaleMaxLabel ?? ""}
						onChange={(event) => onUpdate({ scaleMaxLabel: event.target.value })}
					/>
				</Field>
			</div>

			{/* REQ032 — points between the endpoints an author may name. */}
			<Field label="Intermediate labels">
				<div className="space-y-2">
					{(slide.scaleLabels ?? []).map((scaleLabel, labelIndex) => (
						<div
							// scale labels carry no stable id
							key={`${slide.id}-lbl-${labelIndex}`}
							className="flex items-center gap-1.5"
						>
							<input
								type="number"
								className="input w-16"
								placeholder="Value"
								value={scaleLabel.value}
								onChange={(event) => {
									const next = [...(slide.scaleLabels ?? [])];
									next[labelIndex] = {
										...next[labelIndex],
										value: Number(event.target.value) || 0,
									};
									onUpdate({ scaleLabels: next });
								}}
								aria-label={`Label ${labelIndex + 1} value`}
							/>
							<input
								className="input flex-1"
								placeholder="Label"
								maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
								value={scaleLabel.label}
								onChange={(event) => {
									const next = [...(slide.scaleLabels ?? [])];
									next[labelIndex] = {
										...next[labelIndex],
										label: event.target.value,
									};
									onUpdate({ scaleLabels: next });
								}}
								aria-label={`Label ${labelIndex + 1} text`}
							/>
							<RemoveRowButton
								onClick={() => {
									const next = (slide.scaleLabels ?? []).filter(
										(_, position) => position !== labelIndex,
									);
									onUpdate({ scaleLabels: next });
								}}
								label={`Remove label ${labelIndex + 1}`}
							/>
						</div>
					))}
					<AddRowButton
						onClick={() => {
							const middle = Math.round(
								((slide.scaleMin ?? 1) + (slide.scaleMax ?? 5)) / 2,
							);
							onUpdate({
								scaleLabels: [
									...(slide.scaleLabels ?? []),
									{ value: middle, label: "" },
								],
							});
						}}
						label="Add label"
					/>
				</div>
			</Field>

			{/* REQ029 — several statements rated on the same scale. */}
			<Field label="Statements">
				<div className="space-y-2">
					{(slide.scaleStatements ?? []).map((statement, statementIndex) => (
						<div key={statement.id} className="flex items-center gap-1.5">
							<input
								className="input flex-1"
								placeholder={`Statement ${statementIndex + 1}`}
								maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
								value={statement.text}
								onChange={(event) => {
									const next = [...(slide.scaleStatements ?? [])];
									next[statementIndex] = {
										...next[statementIndex],
										text: event.target.value,
									};
									onUpdate({ scaleStatements: next });
								}}
								aria-label={`Statement ${statementIndex + 1}`}
							/>
							<RemoveRowButton
								onClick={() => {
									const next = (slide.scaleStatements ?? []).filter(
										(_, position) => position !== statementIndex,
									);
									onUpdate({ scaleStatements: next });
								}}
								label={`Remove statement ${statementIndex + 1}`}
							/>
						</div>
					))}
					<AddRowButton
						onClick={() => {
							const current = slide.scaleStatements ?? [];
							if (current.length >= 5) return;
							// The first statement is seeded with the slide's question so the
							// original question stays a votable row rather than becoming a
							// non-votable title.
							const next =
								current.length === 0 && slide.question
									? [
											{ id: crypto.randomUUID(), text: slide.question },
											{ id: crypto.randomUUID(), text: "" },
										]
									: [...current, { id: crypto.randomUUID(), text: "" }];
							onUpdate({ scaleStatements: next });
						}}
						label="Add statement"
						disabled={(slide.scaleStatements ?? []).length >= 5}
						disabledLabel="Max 5 statements"
					/>
				</div>
			</Field>

			{/* REQ031 */}
			<Toggle
				label="Allow skipping statements"
				checked={slide.scaleAllowSkip ?? false}
				onChange={(checked) => onUpdate({ scaleAllowSkip: checked })}
			/>
		</>
	);
}

/** REQ034 — the list participants put in their own order. */
function RankingItemFields({ slide, onUpdate }: SlideSettingsProps) {
	return (
		<Field label="Items">
			<div className="space-y-2">
				{(slide.rankingItems ?? []).map((item, itemIndex) => (
					<div key={item.id} className="flex items-center gap-1.5">
						<input
							className="input flex-1"
							placeholder={`Item ${itemIndex + 1}`}
							maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
							value={item.text}
							onChange={(event) => {
								const next = [...(slide.rankingItems ?? [])];
								next[itemIndex] = { ...next[itemIndex], text: event.target.value };
								onUpdate({ rankingItems: next });
							}}
							aria-label={`Item ${itemIndex + 1}`}
						/>
						{/* Two items is the floor — one item is not an ordering. */}
						{(slide.rankingItems?.length ?? 0) > 2 && (
							<RemoveRowButton
								onClick={() => {
									const next = (slide.rankingItems ?? []).filter(
										(_, position) => position !== itemIndex,
									);
									onUpdate({ rankingItems: next });
								}}
								label={`Remove item ${itemIndex + 1}`}
							/>
						)}
					</div>
				))}
				<AddRowButton
					onClick={() => {
						const current = slide.rankingItems ?? [];
						if (current.length >= RANKING_ITEM_LIMIT) return;
						onUpdate({
							rankingItems: [...current, { id: crypto.randomUUID(), text: "" }],
						});
					}}
					label="Add item"
					disabled={(slide.rankingItems ?? []).length >= RANKING_ITEM_LIMIT}
					disabledLabel={`Max ${RANKING_ITEM_LIMIT} items`}
				/>
			</div>
		</Field>
	);
}

/** REQ045 — what the hundred-point budget gets split across. */
function PointsItemFields({ slide, onUpdate }: SlideSettingsProps) {
	return (
		<Field label={`Items — ${POINTS_BUDGET} points to split`}>
			<div className="space-y-2">
				{(slide.pointsItems ?? []).map((item, itemIndex) => (
					<div key={item.id} className="flex items-center gap-1.5">
						<input
							className="input flex-1"
							placeholder={`Item ${itemIndex + 1}`}
							maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
							value={item.text}
							onChange={(event) => {
								const next = [...(slide.pointsItems ?? [])];
								next[itemIndex] = { ...next[itemIndex], text: event.target.value };
								onUpdate({ pointsItems: next });
							}}
							aria-label={`Item ${itemIndex + 1}`}
						/>
						{/* Two items is the floor — with one, the whole budget has nowhere
						    else to go, so nothing is traded off. */}
						{(slide.pointsItems?.length ?? 0) > 2 && (
							<RemoveRowButton
								onClick={() => {
									const next = (slide.pointsItems ?? []).filter(
										(_, position) => position !== itemIndex,
									);
									onUpdate({ pointsItems: next });
								}}
								label={`Remove item ${itemIndex + 1}`}
							/>
						)}
					</div>
				))}
				<AddRowButton
					onClick={() => {
						const current = slide.pointsItems ?? [];
						if (current.length >= POINTS_ITEM_LIMIT) return;
						onUpdate({
							pointsItems: [...current, { id: crypto.randomUUID(), text: "" }],
						});
					}}
					label="Add item"
					disabled={(slide.pointsItems ?? []).length >= POINTS_ITEM_LIMIT}
					disabledLabel={`Max ${POINTS_ITEM_LIMIT} items`}
				/>
			</div>
		</Field>
	);
}

/** REQ047–REQ050 — what is placed on the field, and what its two axes mean. */
function GridFields({ slide, onUpdate }: SlideSettingsProps) {
	const { xAxis, yAxis } = gridAxesFor(slide);
	return (
		<>
			<Field label="Items">
				<div className="space-y-2">
					{(slide.gridItems ?? []).map((item, itemIndex) => (
						<div key={item.id} className="flex items-center gap-1.5">
							<input
								className="input flex-1"
								placeholder={`Item ${itemIndex + 1}`}
								maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
								value={item.text}
								onChange={(event) => {
									const next = [...(slide.gridItems ?? [])];
									next[itemIndex] = {
										...next[itemIndex],
										text: event.target.value,
									};
									onUpdate({ gridItems: next });
								}}
								aria-label={`Item ${itemIndex + 1}`}
							/>
							{/* One item is still a grid — unlike a ranking, each item is
							    judged on its own — so the floor is one. */}
							{(slide.gridItems?.length ?? 0) > 1 && (
								<RemoveRowButton
									onClick={() => {
										const next = (slide.gridItems ?? []).filter(
											(_, position) => position !== itemIndex,
										);
										onUpdate({ gridItems: next });
									}}
									label={`Remove item ${itemIndex + 1}`}
								/>
							)}
						</div>
					))}
					<AddRowButton
						onClick={() => {
							const current = slide.gridItems ?? [];
							if (current.length >= GRID_ITEM_LIMIT) return;
							onUpdate({
								gridItems: [...current, { id: crypto.randomUUID(), text: "" }],
							});
						}}
						label="Add item"
						disabled={(slide.gridItems ?? []).length >= GRID_ITEM_LIMIT}
						disabledLabel={`Max ${GRID_ITEM_LIMIT} items`}
					/>
				</div>
			</Field>
			{/* REQ050 */}
			<Toggle
				label="Allow skipping items"
				checked={slide.gridAllowSkip ?? false}
				onChange={(checked) => onUpdate({ gridAllowSkip: checked })}
			/>
			<Field label="Horizontal axis">
				<GridAxisFields
					axis={xAxis}
					onChange={(changes) => onUpdate({ gridXAxis: { ...xAxis, ...changes } })}
					titlePlaceholder="e.g. Effort"
					lowPlaceholder="e.g. Low effort"
					highPlaceholder="e.g. High effort"
				/>
			</Field>
			<Field label="Vertical axis">
				<GridAxisFields
					axis={yAxis}
					onChange={(changes) => onUpdate({ gridYAxis: { ...yAxis, ...changes } })}
					titlePlaceholder="e.g. Impact"
					lowPlaceholder="e.g. Low impact"
					highPlaceholder="e.g. High impact"
				/>
			</Field>
		</>
	);
}

/** REQ061 — the typed questions one participant fills in and sends at once. */
function FormFields({ slide, onUpdate }: SlideSettingsProps) {
	const fields = slide.formFields ?? [];
	return (
		<Field label="Fields">
			<div className="space-y-2.5">
				{fields.map((field, fieldIndex) => {
					const updateField = (changes: Partial<FormFieldInput>) => {
						const next = [...fields];
						next[fieldIndex] = { ...next[fieldIndex], ...changes };
						onUpdate({ formFields: next });
					};
					const fieldOptions = field.options ?? [];
					return (
						<div
							key={field.id}
							className="space-y-2 rounded-xl border border-border bg-surface/40 p-2.5"
						>
							<div className="flex items-center gap-1.5">
								<input
									className="input flex-1"
									placeholder={`Field ${fieldIndex + 1}`}
									maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
									value={field.label ?? ""}
									onChange={(event) => updateField({ label: event.target.value })}
									aria-label={`Field ${fieldIndex + 1} label`}
								/>
								{/* One field is still a form — a signup that only wants an
								    address is a real slide — so there is no floor to keep. */}
								<RemoveRowButton
									onClick={() =>
										onUpdate({
											formFields: fields.filter(
												(_, position) => position !== fieldIndex,
											),
										})
									}
									label={`Remove field ${fieldIndex + 1}`}
								/>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Segmented
									value={(field.type ?? "text") as FormFieldType}
									onChange={(type) =>
										updateField({
											type,
											// Switching *into* a choice field seeds the two blanks it
											// needs to be answerable at all; switching out keeps
											// them, so flipping back and forth does not throw away
											// what the author typed.
											options:
												type === "choice" && fieldOptions.length === 0
													? [newFormFieldOption(), newFormFieldOption()]
													: fieldOptions,
										})
									}
									options={FORM_FIELD_TYPE_OPTIONS}
									ariaLabel={`Field ${fieldIndex + 1} type`}
								/>
								<label className="flex items-center gap-1.5 text-xs text-text-muted">
									<input
										type="checkbox"
										checked={field.required ?? false}
										onChange={(event) =>
											updateField({ required: event.target.checked })
										}
									/>
									Required
								</label>
							</div>
							{field.type === "choice" && (
								<div className="space-y-2 border-t border-border-subtle pt-2">
									{fieldOptions.map((option, optionIndex) => (
										<div key={option.id} className="flex items-center gap-1.5">
											<input
												className="input flex-1"
												placeholder={`Option ${optionIndex + 1}`}
												maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
												value={option.text}
												onChange={(event) => {
													const nextOptions = [...fieldOptions];
													nextOptions[optionIndex] = {
														...nextOptions[optionIndex],
														text: event.target.value,
													};
													updateField({ options: nextOptions });
												}}
												aria-label={`Field ${fieldIndex + 1} option ${optionIndex + 1}`}
											/>
											{/* Two options is the floor — with one there is nothing
											    to choose between. */}
											{fieldOptions.length > 2 && (
												<RemoveRowButton
													onClick={() =>
														updateField({
															options: fieldOptions.filter(
																(_, position) => position !== optionIndex,
															),
														})
													}
													label={`Remove option ${optionIndex + 1}`}
												/>
											)}
										</div>
									))}
									<AddRowButton
										onClick={() => {
											if (fieldOptions.length >= FORM_FIELD_OPTION_LIMIT) return;
											updateField({
												options: [...fieldOptions, newFormFieldOption()],
											});
										}}
										label="Add option"
										disabled={fieldOptions.length >= FORM_FIELD_OPTION_LIMIT}
										disabledLabel={`Max ${FORM_FIELD_OPTION_LIMIT} options`}
									/>
								</div>
							)}
						</div>
					);
				})}
				<AddRowButton
					onClick={() => {
						if (fields.length >= FORM_FIELD_LIMIT) return;
						onUpdate({ formFields: [...fields, newFormField()] });
					}}
					label="Add field"
					disabled={fields.length >= FORM_FIELD_LIMIT}
					disabledLabel={`Max ${FORM_FIELD_LIMIT} fields`}
				/>
			</div>
		</Field>
	);
}

/**
 * REQ040–REQ043 — the frame participants estimate inside, its resolution, and
 * the optional correct number with the tolerance around it.
 */
function GuessFields({ slide, onUpdate }: SlideSettingsProps) {
	const range = guessRangeFor(slide);
	const usable = isUsableGuessRange(range);
	const stepCount = usable
		? Math.floor((range.max - range.min) / range.step) + 1
		: 0;
	const updateRange = (changes: Partial<typeof range>) =>
		onUpdate({ guessRange: { ...range, ...changes } });
	const reference = guessReferenceFor(slide);
	const accepted = correctGuessRangeFor(reference);
	const reason =
		"Turn on a correct answer first — a tolerance around no number accepts nothing.";
	// A reference nobody can reach is worse than no reference: the slide claims a
	// correct answer while every participant is scored wrong forever. Said here,
	// where it can be corrected, and refused at save (CreatePage) so it cannot
	// ship.
	const reachable = isReachableGuessReference(range, reference);

	return (
		<>
			<div className="grid grid-cols-3 gap-2">
				<Field label="Lowest">
					<input
						type="number"
						className="input"
						value={range.min}
						onChange={(event) =>
							updateRange({ min: Math.round(Number(event.target.value) || 0) })
						}
					/>
				</Field>
				<Field label="Highest">
					<input
						type="number"
						className="input"
						value={range.max}
						onChange={(event) =>
							updateRange({ max: Math.round(Number(event.target.value) || 0) })
						}
					/>
				</Field>
				<Field label="Step">
					<input
						type="number"
						className="input"
						min={1}
						value={range.step}
						onChange={(event) =>
							updateRange({
								// Never below 1: a step of zero puts every number both on and
								// off the grid, and the schema rejects it.
								step: Math.max(1, Math.round(Number(event.target.value) || 1)),
							})
						}
					/>
				</Field>
			</div>
			<p className="text-xs text-text-muted">
				{usable
					? `${stepCount} selectable value${stepCount === 1 ? "" : "s"}, ${range.min} to ${range.max}.`
					: "The highest value must be above the lowest, and the step no wider than the range."}
			</p>

			{/* REQ041/REQ042. The reference is optional, and its absence is a real
			    authored state — a slide with no correct number has no notion of
			    correctness at all — so the toggle states it rather than leaving an
			    empty field to be read as "zero is correct". */}
			<Toggle
				label="This question has a correct answer"
				checked={reference !== null}
				onChange={(checked) =>
					onUpdate({
						guessReference: checked
							? {
									// Seeded at the middle *selectable* value, not the arithmetic
									// midpoint: on a 1–10 slide stepping in twos the midpoint is
									// 6, which no participant can submit.
									value: middleGuessValue(range),
									tolerance: 0,
								}
							: null,
					})
				}
			/>
			{/* ADR-0025: the two fields stay on screen when there is no reference,
			    disabled and with the reason spelled out, rather than disappearing
			    and leaving the setting undiscoverable. */}
			<div className="grid grid-cols-2 gap-2">
				<Field label="Correct number">
					<input
						type="number"
						className="input"
						value={reference?.value ?? ""}
						disabled={reference === null}
						title={reference === null ? reason : undefined}
						onChange={(event) =>
							onUpdate({
								guessReference: {
									value: Math.round(Number(event.target.value) || 0),
									tolerance: reference?.tolerance ?? 0,
								},
							})
						}
					/>
				</Field>
				<Field label="Tolerance (±)">
					<input
						type="number"
						className="input"
						min={0}
						value={reference?.tolerance ?? ""}
						disabled={reference === null}
						title={reference === null ? reason : undefined}
						onChange={(event) =>
							onUpdate({
								guessReference: {
									value: reference?.value ?? 0,
									tolerance: Math.max(
										0,
										Math.round(Number(event.target.value) || 0),
									),
								},
							})
						}
					/>
				</Field>
			</div>
			<p className={`text-xs ${reachable ? "text-text-muted" : "text-error"}`}>
				{!accepted
					? reason
					: reachable
						? accepted.min === accepted.max
							? `Only ${accepted.min} counts as correct.`
							: `${accepted.min} to ${accepted.max} counts as correct.`
						: `No selectable value falls inside ${
								accepted.min === accepted.max
									? accepted.min
									: `${accepted.min} to ${accepted.max}`
							} — nobody could ever be right. Pick a number the slide offers, or widen the tolerance.`}
			</p>
		</>
	);
}

/**
 * REQ051–REQ053 — the picture the question is asked on, and the area a pin is
 * meant to land in. Both live under the answers this slide takes, because on
 * this type the image *is* the coordinate space an answer exists in.
 */
function PinFields({
	slide,
	onUpdate,
	deckResultsVisibility,
}: SlideSettingsProps & { deckResultsVisibility: ResultsVisibility }) {
	const image = pinImageFor(slide);
	const area = pinAreaFor(slide);
	// The half-drawn rectangle a drag is still holding: `pinAreaFor` only
	// resolves a usable one, so the picker reads the raw field to keep drawing
	// the box while the pointer is down.
	const drawn = (slide.pinArea ?? null) as PinArea | null;
	const reason =
		"Turn on a correct area first — there is nothing to place without one.";
	const visibility = effectiveResultsVisibility(
		slide.resultsVisibility,
		deckResultsVisibility,
	);
	const moveCorner = (changes: Partial<PinArea>) => {
		const current =
			drawn ??
			// A fresh area opens as a box in the middle of the picture rather than at
			// a corner: it is visible immediately, and an author drags or types from
			// something rather than hunting for a zero-sized target.
			({
				x: Math.round(PIN_COORDINATE_MAX * 0.35),
				y: Math.round(PIN_COORDINATE_MAX * 0.35),
				width: Math.round(PIN_COORDINATE_MAX * 0.3),
				height: Math.round(PIN_COORDINATE_MAX * 0.3),
			} satisfies PinArea);
		onUpdate({ pinArea: { ...current, ...changes } });
	};

	return (
		<>
			<Field label="Image URL">
				<input
					className="input"
					placeholder="https://..."
					value={slide.mediaUrl ?? ""}
					onChange={(event) => onUpdate({ mediaUrl: event.target.value })}
				/>
			</Field>
			<Field label="Alt text">
				<input
					className="input"
					placeholder="Describe the image"
					value={slide.mediaAlt ?? ""}
					onChange={(event) => onUpdate({ mediaAlt: event.target.value })}
				/>
			</Field>
			{/* A pin slide with no image cannot be answered at all — the vote
			    boundary refuses every submission to one — so it is said here, where
			    it can be fixed, and refused at save (CreatePage) so it cannot ship. */}
			{!image.url && (
				<p className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
					No image yet — participants cannot answer this slide.
				</p>
			)}

			{/* REQ053. The area is optional, and its absence is a real authored state
			    — a slide with no target has no notion of correctness at all — so a
			    toggle states it rather than leaving four empty fields to be read as
			    "the top-left corner is correct". */}
			<Toggle
				label="This question has a correct area"
				checked={drawn !== null}
				onChange={(checked) =>
					// Turning a target on also authors the reveal it needs
					// (`withPinAreaEnabled`): a correct area is an answer key drawn on
					// the picture participants are aiming at. Turning it off leaves the
					// visibility where they left it.
					onUpdate(
						checked
							? withPinAreaEnabled(slide, deckResultsVisibility)
							: { pinArea: null },
					)
				}
			/>
			{/* Drawn on the picture, because the target is a region *of the picture*
			    (ADR-0031). The four fields below are the same target reached by
			    keyboard, and the precise path when a drag is a pixel off. */}
			{image.url && drawn && (
				<PinCanvas
					image={image}
					area={drawn}
					areaLabel="Correct area"
					onDragArea={(next) => onUpdate({ pinArea: next })}
					className="mx-auto"
				/>
			)}
			<div className="grid grid-cols-2 gap-2">
				<PinAreaField
					label="Left (%)"
					value={drawn?.x ?? 0}
					onChange={(next) => moveCorner({ x: next })}
					disabled={drawn === null}
					disabledReason={reason}
				/>
				<PinAreaField
					label="Top (%)"
					value={drawn?.y ?? 0}
					onChange={(next) => moveCorner({ y: next })}
					disabled={drawn === null}
					disabledReason={reason}
				/>
				<PinAreaField
					label="Width (%)"
					value={drawn?.width ?? 0}
					onChange={(next) => moveCorner({ width: Math.max(1, next) })}
					disabled={drawn === null}
					disabledReason={reason}
				/>
				<PinAreaField
					label="Height (%)"
					value={drawn?.height ?? 0}
					onChange={(next) => moveCorner({ height: Math.max(1, next) })}
					disabled={drawn === null}
					disabledReason={reason}
				/>
			</div>
			{/* An area that runs off the picture is refused at save: the part of it
			    nobody can reach would make "how many were inside?" a number about the
			    image rather than about the room. */}
			{drawn !== null && area === null && (
				<p className="text-xs text-error">
					This area runs off the image — keep left plus width, and top plus
					height, inside 100%.
				</p>
			)}
			{/* When the room learns where the target is. The reveal is the
			    results-visibility setting this slide already has (REQ102) — a pin
			    slide gets no second reveal switch. */}
			{drawn !== null && visibility === "instant" && (
				<p className="text-xs text-warning">
					Results are instant, so the target is on screen while participants
					aim. Set the reveal to "On click" to hold it back.
				</p>
			)}
		</>
	);
}

/**
 * How a quiz question is scored and timed (REQ054/REQ057) — the window it is
 * open for, which is also what the speed half of the score is measured against.
 */
function ScoringGroup({
	slide,
	onUpdate,
	title,
	deckMode,
}: SlideSettingsProps & { title: string; deckMode: PresentationMode }) {
	const departure = slideScoringDeparture(slide);
	const seconds = slide.timeLimit ?? 30;
	return (
		<SettingsGroup
			title={title}
			consequence={
				seconds === 0
					? "No countdown — every correct answer scores the same."
					: `${seconds}s to answer; sooner scores more, up to ${QUIZ_MAX_POINTS}.`
			}
			departed={departure.departed}
			resetLabel="Put the countdown back to 30 seconds"
			onReset={() => onUpdate(departure.reset)}
		>
			{/* A time limit needs a shared instant to count from, and only a
			    presenter-paced deck has one (REQ057). Rather than hide or disable the
			    field on a survey deck — the author may well switch the deck back —
			    say plainly that what they type here will not fire (ADR-0025). */}
			{deckMode === "survey" && (
				<p className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
					Not in effect: this deck is audience-paced, so the countdown never
					runs and every correct answer scores the full {QUIZ_MAX_POINTS}{" "}
					points.
				</p>
			)}
			{/* The number rests as a row, because the line above already says what
			    it does: the value is legible without opening anything, which is what
			    the column's height buys (REQ155). */}
			<DisclosureRow
				label="Time limit"
				value={seconds === 0 ? "Off" : `${seconds}s`}
				openHint="Open the countdown"
			>
				<Field label="Time limit (seconds)" inline>
					<input
						type="number"
						className="input w-20"
						value={seconds}
						onChange={(event) => {
							// An empty field is mid-typing, not "no limit" — that is what an
							// explicit 0 says, so the two must not collapse.
							const typed = event.target.value.trim();
							const next = typed === "" ? 30 : Number(typed);
							onUpdate({
								timeLimit:
									Number.isFinite(next) && next >= 0 ? Math.floor(next) : 30,
							});
						}}
						min={0}
						max={300}
					/>
				</Field>
			</DisclosureRow>
		</SettingsGroup>
	);
}

/**
 * When the slide's aggregate reaches the room (REQ102) and how it is drawn
 * (REQ010/REQ011/REQ023/REQ059) — the reveal first, then the chart, which is the
 * order REQ155 puts them in and the order an author decides them in.
 *
 * The two chart settings send the canvas to its results view as they are changed
 * (REQ154): what they select is a *rendering*, and the only honest way to offer
 * a choice between two renderings is to draw one.
 */
function ResultsGroup({
	slide,
	onUpdate,
	title,
	onPreviewResults,
	deckResultsVisibility,
	deckQuizCount,
}: SlideSettingsProps & {
	title: string;
	onPreviewResults: () => void;
	deckResultsVisibility: ResultsVisibility;
	deckQuizCount: number;
}) {
	const departure = slideResultsDeparture(slide, deckResultsVisibility);
	const isChoice = isChoiceShapedSlide(slide);
	// Which kind of departure the marker is about: a reveal that is not this
	// slide's own default is a disagreement with the *presentation*, and says so.
	const overridesDeck =
		(slide.resultsVisibility ?? "inherit") !==
		defaultResultsVisibilityFor(slide, deckResultsVisibility);
	return (
		<SettingsGroup
			title={title}
			consequence={resultsRevealConsequence(
				slide.resultsVisibility,
				deckResultsVisibility,
			)}
			departed={departure.departed}
			departureLabel={overridesDeck ? "Overrides deck" : "Changed"}
			// A reveal closed further than this slide's default is marked and not
			// undone from here: the reset only ever tightens, so re-opening a slide
			// is the reveal's own control above (ADR-0025 — the button says so).
			canReset={Object.keys(departure.reset).length > 0}
			resetUnavailableReason="This slide's reveal is tighter than its default — re-open it with the Reveal control above."
			resetLabel="Put the reveal and the chart back to their defaults"
			onReset={() => onUpdate(departure.reset)}
		>
			{slideHasResults(slide.type) && (
				<Field label="Reveal">
					<ChoiceCards<SlideResultsVisibility>
						ariaLabel="When results appear on the shared screen"
						variant="tile"
						columns={2}
						value={slide.resultsVisibility ?? "inherit"}
						onChange={(value) => onUpdate({ resultsVisibility: value })}
						options={[
							{
								value: "inherit",
								label: `Deck (${RESULTS_VISIBILITY_LABEL[deckResultsVisibility]})`,
								icon: <Settings2 size={16} />,
							},
							// The descriptor's own entries, minus the sentence each carries:
							// what a mode does is the group's one consequence line, said
							// once about the mode in force rather than four times about the
							// three that are not (REQ155).
							...RESULTS_VISIBILITY_OPTIONS.map((option) => ({
								...option,
								description: undefined,
							})),
						]}
					/>
				</Field>
			)}
			{isChoice && (
				<>
					<Field label="Chart">
						<ChoiceCards
							ariaLabel="Result style"
							variant="tile"
							columns={2}
							value={slide.mcDisplayStyle ?? "bars"}
							onChange={(value) => {
								onUpdate({ mcDisplayStyle: value });
								onPreviewResults();
							}}
							options={MC_DISPLAY_STYLE_OPTIONS.map((option) => ({
								...option,
								description: undefined,
							}))}
						/>
					</Field>
					<Field label="Values" inline>
						<Segmented<McValueDisplay>
							compact
							ariaLabel="Result values"
							value={slide.mcValueDisplay ?? "both"}
							onChange={(value) => {
								onUpdate({ mcValueDisplay: value });
								onPreviewResults();
							}}
							options={MC_VALUE_DISPLAY_OPTIONS}
						/>
					</Field>
				</>
			)}
			{slide.type === "open-text" && (
				<Field label="Layout">
					<Segmented
						ariaLabel="Result layout"
						value={slide.openTextLayout ?? "speech-bubbles"}
						onChange={(value) => {
							onUpdate({ openTextLayout: value });
							onPreviewResults();
						}}
						options={[
							{ value: "speech-bubbles", label: "Bubbles" },
							{ value: "grid", label: "Grid" },
						]}
					/>
				</Field>
			)}
			{slide.type === "leaderboard" && (
				<>
					<Field label="Places shown">
						<input
							type="number"
							className="input w-24"
							min={1}
							max={LEADERBOARD_SIZE_LIMIT}
							value={leaderboardSizeFor(slide)}
							onChange={(event) => {
								// An empty field is mid-typing; the resolver's clamp decides
								// what a number outside the board's bounds means, so the two
								// never disagree about how many rows this slide shows.
								const typed = event.target.value.trim();
								onUpdate({
									leaderboardSize:
										typed === ""
											? LEADERBOARD_DEFAULT_SIZE
											: leaderboardSizeFor({ leaderboardSize: Number(typed) }),
								});
							}}
						/>
					</Field>
					{/* A board in a deck with nothing to rank is authored correctly and
					    will still be empty. Said here, where a quiz slide can be added,
					    rather than left for the author to discover on the projector. */}
					<p className="text-xs text-text-muted">
						{deckQuizCount === 0
							? "This deck has no quiz slides yet, so the board will be empty."
							: `Ranking the ${deckQuizCount} quiz question${
									deckQuizCount === 1 ? "" : "s"
								} in this deck.`}
					</p>
				</>
			)}
		</SettingsGroup>
	);
}

/**
 * This slide's own appearance over the deck's theme (REQ087/REQ091) — where its
 * elements sit, how big its words are, and the colours it disagrees with the
 * deck about.
 *
 * Every colour is a chip that states what it *is* rather than a picker that
 * takes the column's height (REQ155): an unauthored one reads "Theme", and
 * opening the chip is what brings out the picker, the hex box and the way back.
 */
function StyleGroup({
	slide,
	onUpdate,
	deck,
}: SlideSettingsProps & { deck: DeckThemeSettings | null }) {
	// Which colour scheme the organizer is authoring in — the chips below show
	// what is inherited *now*, and a deck theme carries both.
	const { resolvedTheme } = useTheme();
	const inheritedTokens = deckThemeAppearance(deck)[resolvedTheme].tokens;
	const inherited = {
		canvas: inheritedTokens["--color-surface"] ?? "",
		text: inheritedTokens["--color-text"] ?? "",
		chart: inheritedTokens["--color-poll-1"] ?? "",
	};
	const departure = slideStyleDeparture(slide);
	const hasResults = slideHasResults(slide.type);

	return (
		<SettingsGroup
			title="Style"
			consequence={
				departure.departed
					? "This slide departs from the deck's theme; anything left alone follows it."
					: "Following the deck's theme."
			}
			departed={departure.departed}
			departureLabel="Off theme"
			resetLabel="Put this slide back in the deck's theme"
			onReset={() => onUpdate(departure.reset)}
		>
			<Field label="Layout" inline>
				<Segmented<SlideLayout>
					compact
					ariaLabel="Where this slide's elements sit"
					value={slide.layout ?? "inherit"}
					onChange={(layout) => onUpdate({ layout })}
					options={slideLayoutOptions()}
				/>
			</Field>
			<Field label="Text size" inline>
				<Segmented<SlideTextSize>
					compact
					ariaLabel="Size of this slide's heading and body text"
					value={slideTextSizeFor(slide)}
					onChange={(size) => onUpdate({ textSize: size })}
					options={SLIDE_TEXT_SIZE_OPTIONS}
				/>
			</Field>
			<div className="space-y-1">
				<ColorField
					collapsible
					label="Background"
					placeholder={inherited.canvas}
					value={slide.backgroundColor ?? ""}
					unsetNote="Following the deck's theme."
					onChange={(backgroundColor) => onUpdate({ backgroundColor })}
				/>
				<ColorField
					collapsible
					label="Text"
					placeholder={inherited.text}
					value={slide.textColor ?? ""}
					unsetNote="Following the deck's theme."
					onChange={(textColor) => onUpdate({ textColor })}
				/>
				<ColorField
					collapsible
					label="Chart"
					hint={
						hasResults
							? undefined
							: "This slide draws no chart, so nothing reads this yet."
					}
					placeholder={inherited.chart}
					value={slide.chartColor ?? ""}
					unsetNote="Following the deck's theme."
					onChange={(chartColor) => onUpdate({ chartColor })}
				/>
			</div>
			<DisclosureRow
				label="Background image"
				value={slideAppearanceFor(slide).backgroundImage === "" ? "None" : "Set"}
				openHint="Open the picture behind this slide"
			>
				<Field label="Background image URL">
					<input
						className="input"
						placeholder="https://..."
						maxLength={SLIDE_MEDIA_URL_MAX_LENGTH}
						value={slide.backgroundImage ?? ""}
						onChange={(event) => onUpdate({ backgroundImage: event.target.value })}
					/>
				</Field>
				{/* What the resolver makes of the URL, said here rather than discovered
				    on a projector: a scheme no browser should be pointed at draws no
				    picture at all. */}
				{(slide.backgroundImage ?? "") !== "" &&
					slideAppearanceFor(slide).backgroundImage === "" && (
						<p className="text-xs text-warning">
							That address can't be loaded as a picture — use an http(s) or
							root-relative URL.
						</p>
					)}
				{/* The way back to no picture. It stands whether or not there is one to
				    remove and says why it is unavailable (ADR-0025). */}
				<button
					type="button"
					className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-error disabled:cursor-not-allowed disabled:text-text-dim disabled:hover:text-text-dim"
					onClick={() => onUpdate({ backgroundImage: "" })}
					disabled={(slide.backgroundImage ?? "") === ""}
					title={
						(slide.backgroundImage ?? "") === ""
							? "This slide carries no background image."
							: "Remove this slide's background image."
					}
				>
					<X size={12} />
					Remove background image
				</button>
			</DisclosureRow>
		</SettingsGroup>
	);
}
