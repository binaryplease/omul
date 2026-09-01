import { SLIDE_TYPE_LABELS, type SlideType } from "../types";
import { SlideTypeIcon } from "./SlideTypeIcon";

// ── Slide type picker ─────────────────────────────────────────────────
//
// The single descriptor for "choose a slide type" (ADR-0026). The same list
// of types — icon, label, one-line hint — drives two surfaces: the editor's
// "Add slide" menu (pick a type to create) and the slide editor's header
// type-changer popover (convert the current slide). Expressed once here so the
// two never drift; each surface composes it with its own selection handler.

// The **labels** are no longer this module's own: the PDF export names a slide
// type too (REQ096), and the server cannot import an editor component, so the
// one descriptor moved to `server/schemas.ts` — the module both sides already
// compose their shared rules from — and is re-exported here for the surfaces
// that have always imported it from this file (ADR-0026/ADR-0032). The icon and
// the hint stay: both are the picker's own, and neither means anything to a
// printed page.
export { SLIDE_TYPE_LABELS };

/** One-line descriptions so the picker explains each type, not just names it. */
export const SLIDE_TYPE_HINTS: Record<SlideType, string> = {
	"multiple-choice": "Vote on preset options",
	"word-cloud": "Crowd words into a live cloud",
	"open-text": "Collect open responses & questions",
	scale: "Rate statements on a numeric scale",
	ranking: "Put options in order of priority",
	grid: "Place items along two dimensions",
	points: "Split 100 points across the options",
	"guess-number": "Estimate a number within a range",
	"pin-image": "Mark a spot on your image",
	quiz: "Scored question against the clock",
	form: "Collect several answers in one submission",
	leaderboard: "Top scores across the deck's quiz questions",
	text: "A heading with body copy",
	image: "Show an image with a caption",
	video: "Play a video from a link",
	embed: "Frame a PowerPoint, Google Slides or Miro link",
	instruction: "Join code & QR for the audience",
};

/**
 * Which groups of the settings column a slide type owns, and what each is
 * called (REQ155).
 *
 * Declared here, beside the type's own label and hint, because it is the same
 * kind of fact about a slide type as those two — and because the alternative is
 * what this replaced: a column of `slide.type === "grid" && …` conditionals,
 * one per field group, which no reader could turn into an answer to "what does
 * a grid slide let me author?" without reading two thousand lines.
 *
 * The column composes it; nothing else re-derives it. A `null` is a group this
 * type does not own, and a string is both "it owns it" and the heading it wears
 * — a name is part of what a group *is*, and two declarations would let the two
 * disagree.
 *
 * The order the column draws them in is REQ155's authoring flow — type →
 * content → answers → scoring → results → style — with **content** the one
 * addition to the requirement's list. What a slide *shows* besides the words on
 * the canvas (a video's link, a caption, the optional image beside a question,
 * REQ069) is neither an answer rule nor an appearance, and it is authored before
 * the answers rather than after them; the requirement's order is otherwise
 * untouched. Two types own no content group at all: a leaderboard shows nothing
 * of its own, and a pin slide's picture *is* its question, so it is authored
 * under the answers it makes possible (REQ052).
 *
 * The `style` group is not listed: every slide is drawn, so every type owns it.
 */
export type SlideSettingsSections = {
	/** What this slide shows besides its canvas-authored words. */
	content: string | null;
	/** The rules and shapes its answers follow. */
	answers: string | null;
	/** How it is scored and timed (REQ054/REQ057) — a quiz, and nothing else. */
	scoring: string | null;
	/** When its aggregate is shown, and how it is drawn (REQ102/REQ010/REQ011). */
	results: string | null;
	/**
	 * Whether this type's answer shape is a structured field set that may run
	 * past the column's height (REQ155). Where it does, the group scrolls inside
	 * the column rather than pushing the reveal and the appearance off the
	 * bottom of it.
	 *
	 * A **quiz is marked**, and deliberately: a question answered by typing
	 * (REQ055) authors its whole answer key here as an accepted-answer list, and
	 * that is a structured field set by any reading. What stays true of it as a
	 * common type is the rest of the column — a select-answer quiz's groups are
	 * as short as a choice slide's, and the marking costs it nothing until the
	 * list it allows for actually grows. The two types that are short in every
	 * state are the choice slide and the word cloud, and neither is marked.
	 */
	scrolls: boolean;
};

export const SLIDE_TYPE_SECTIONS: Record<SlideType, SlideSettingsSections> = {
	"multiple-choice": {
		content: "Media",
		answers: "Answers",
		scoring: null,
		results: "Results",
		scrolls: false,
	},
	"word-cloud": {
		content: "Media",
		answers: "Responses",
		scoring: null,
		results: "Results",
		scrolls: false,
	},
	"open-text": {
		content: "Media",
		answers: "Responses",
		scoring: null,
		results: "Results",
		scrolls: false,
	},
	scale: {
		content: "Media",
		answers: "Scale",
		scoring: null,
		results: "Results",
		scrolls: true,
	},
	ranking: {
		content: "Media",
		answers: "Items",
		scoring: null,
		results: "Results",
		scrolls: true,
	},
	grid: {
		content: "Media",
		answers: "Items & axes",
		scoring: null,
		results: "Results",
		scrolls: true,
	},
	points: {
		content: "Media",
		answers: "Items",
		scoring: null,
		results: "Results",
		scrolls: true,
	},
	"guess-number": {
		content: "Media",
		answers: "Value range",
		scoring: null,
		results: "Results",
		scrolls: true,
	},
	"pin-image": {
		content: null,
		answers: "Image & target",
		scoring: null,
		results: "Results",
		scrolls: true,
	},
	quiz: {
		content: "Media",
		answers: "Answers",
		scoring: "Scoring & timing",
		results: "Results",
		scrolls: true,
	},
	form: {
		content: "Media",
		answers: "Fields",
		scoring: null,
		results: "Results",
		scrolls: true,
	},
	leaderboard: {
		content: null,
		answers: null,
		scoring: null,
		results: "Board & results",
		scrolls: false,
	},
	text: {
		content: "Content",
		answers: null,
		scoring: null,
		results: null,
		scrolls: false,
	},
	image: {
		content: "Image",
		answers: null,
		scoring: null,
		results: null,
		scrolls: false,
	},
	video: {
		content: "Video",
		answers: null,
		scoring: null,
		results: null,
		scrolls: false,
	},
	embed: {
		content: "Deck or board",
		answers: null,
		scoring: null,
		results: null,
		scrolls: false,
	},
	instruction: {
		content: "Content",
		answers: null,
		scoring: null,
		results: null,
		scrolls: false,
	},
};

/**
 * Shared selected/idle surface for a slide-type choice (ADR-0028): the
 * highlight a type tile wears when it is the current type versus when it is an
 * idle, pickable option. Owned here, composed by both picker surfaces.
 */
export function slideTypeItemSurface(active: boolean): string {
	return active
		? "border-accent/40 bg-accent-dim text-text"
		: "border-transparent bg-transparent text-text-muted hover:bg-surface-hover hover:text-text";
}

/**
 * A list of every slide type as selectable tiles. `current` (when given) marks
 * the active type with the shared highlight; `withHints` adds the one-line
 * description for discoverability. Layout is owned by the caller via
 * `className` (e.g. the grid-column count), so the narrow rail and the wider
 * header popover can each lay the same tiles out to fit.
 */
export function SlideTypeMenu({
	current,
	onSelect,
	withHints = false,
	className = "",
}: {
	current?: SlideType;
	onSelect: (type: SlideType) => void;
	withHints?: boolean;
	className?: string;
}) {
	return (
		<div className={`grid gap-1 ${className}`}>
			{(Object.entries(SLIDE_TYPE_LABELS) as [SlideType, string][]).map(
				([type, label]) => (
					<button
						key={type}
						type="button"
						onClick={() => onSelect(type)}
						aria-pressed={current === type}
						className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${slideTypeItemSurface(
							current === type,
						)}`}
					>
						<span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-surface-raised border border-border-subtle">
							<SlideTypeIcon type={type} />
						</span>
						<span className="min-w-0">
							<span className="block text-sm font-medium leading-tight text-text">
								{label}
							</span>
							{withHints && (
								<span className="mt-0.5 block text-xs leading-tight text-text-muted">
									{SLIDE_TYPE_HINTS[type]}
								</span>
							)}
						</span>
					</button>
				),
			)}
		</div>
	);
}
