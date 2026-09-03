import { Check, Plus, X } from "lucide-react";
import { POLL_COLORS } from "../constants";
import type { Slide, SlideOption } from "../types";
import {
	isMultiSelect,
	maxSelectionsFor,
	quizAnswerModeFor,
	SLIDE_ITEM_TEXT_MAX_LENGTH,
	SLIDE_OPTION_LIMIT,
	SLIDE_TEXT_MAX_LENGTH,
	slideTextSizeFor,
} from "../types";
import { REMOVE_BUTTON_HOVER } from "./EditorControls";
import { LEADERBOARD_LABELS_EN } from "./Leaderboard";
import { SLIDE_TEXT_LEADING, SLIDE_TEXT_SCALE, SlideText } from "./SlideText";

// ── Authoring, on the slide itself ────────────────────────────────────
//
// REQ153. The question and the option rows are written where they will be read:
// on the canvas REQ152 promoted to the centre of the Create/Edit page, at the
// size, colour and position the room will get. An authored text size is larger
// text under the author's cursor rather than a control's claim about it, which
// is a property no field in a settings column can have.
//
// The module owns the three things a cross-surface affordance is made of, and
// nothing else owns any of them:
//
//   - **One descriptor** — {@link SlideCanvasEditing}, the four editor-store
//     actions the canvas may reach. A surface either holds it or it does not;
//     there is no `editable` boolean to get wrong halfway down a tree.
//   - **One wrapper per authored thing** — {@link SlideQuestion} draws a slide's
//     heading and {@link SlideOptionList} its option cards, *whether or not*
//     they are being authored. The same component draws the room's reading and
//     the author's field, so the two cannot drift into different slides.
//   - **One guard** — `scripts/guard-frontend-conventions.ts` refuses the
//     descriptor anywhere outside the canvas's own chain, because the editing
//     layer is exactly what no participant, presenter or shared-results surface
//     may ever render.
//
// The interaction states these fields wear are shared tokens:
// {@link CANVAS_FIELD_SURFACE} is what "this text is editable" looks like, and
// {@link CANVAS_TOOL_REVEAL} what a per-row tool does when it is not being
// pointed at. Both reveal on `focus-within` as well as on hover — a tool that
// only appears under a pointer is a tool a keyboard cannot find.

/**
 * The editor-only layer, as one value.
 *
 * Every mutation goes through the editor store's own actions (`updateSlide`,
 * `addOption`, `updateOption`, `removeOption`) with the slide already bound, so
 * the CRDT-ready seam in `src/store/editor.ts` is unchanged and the canvas stays
 * presentational: it reports what the author did and renders what came back.
 */
export type SlideCanvasEditing = {
	/** Write a change to the slide being authored (the question, here). */
	onUpdate: (changes: Partial<Slide>) => void;
	/** Append a blank option to the slide's answer set (REQ012). */
	onAddOption: () => void;
	/** Write a change to one option — its text, or its solution flag (REQ013). */
	onUpdateOption: (optionId: string, changes: Partial<SlideOption>) => void;
	/** Drop one option from the answer set (REQ012). */
	onRemoveOption: (optionId: string) => void;
};

/**
 * What an editable run of slide text looks like at rest, under a pointer, and
 * under the caret — the one answer to "which of these words can I
 * type into?", composed by the question field and by every option row.
 *
 * Transparent at rest on purpose: the canvas is a picture of the room's screen
 * (REQ152), so the field only draws itself when it is being addressed. The focus
 * treatment is the standard one rather than a canvas-specific invention — a
 * keyboard user has to be able to see where they are without being told this
 * surface is special.
 */
export const CANVAS_FIELD_SURFACE =
	"rounded-md outline-none ring-1 ring-transparent transition-shadow hover:ring-border focus:ring-2 focus:ring-accent";

/**
 * A per-row tool that steps back until it is wanted (it is never
 * removed, only quietened). It comes back for the pointer *and* for the caret —
 * `group-focus-within` is what makes the remove button reachable by tab rather
 * than only by mouse.
 */
export const CANVAS_TOOL_REVEAL =
	"opacity-0 transition-[opacity,color] group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100";

/** The floor an answer set may not be edited below (REQ012). */
export const MIN_CHOICE_OPTIONS = 2;

/**
 * The heading an instruction slide falls back to (REQ065) — the room's own
 * default, so the canvas's placeholder and the join screen agree on what an
 * unauthored front door says.
 */
export const INSTRUCTION_FALLBACK_HEADING = "Join the presentation";

/**
 * What the slide's first authored string is called, per type — a heading on a
 * content slide, a caption on a picture, a video or an embedded deck, the prompt
 * on a question. One reading, composed by the field's accessible name here and
 * by anything else that has to name it, so the canvas and a screen reader do not
 * call the same box two things.
 */
export function slideQuestionLabel(slide: Slide): string {
	if (
		slide.type === "text" ||
		slide.type === "instruction" ||
		slide.type === "leaderboard"
	) {
		return "Heading";
	}
	if (
		slide.type === "image" ||
		slide.type === "video" ||
		slide.type === "embed"
	) {
		return "Caption";
	}
	return "Question";
}

/**
 * What an unauthored question shows on the canvas (REQ153) — drawn in the muted
 * deck-theme colour, so an untitled slide is visibly untitled rather than blank.
 *
 * Where the room has a real default for an empty heading, the placeholder *is*
 * that default: an instruction slide reads "Join the presentation" and a
 * leaderboard its own board title, because that is literally what the audience
 * will see. Everywhere else the room shows nothing, so the placeholder says what
 * to write instead of pretending to be content.
 *
 * And it says whether it *has* to be written. `CreatePage.handleSubmit` requires
 * a question on every non-content slide and on none of the content ones, so a
 * heading or a caption reads "Optional" — the word the field carried before it
 * moved onto the slide. A placeholder implying a rule that does not exist is a
 * worse blank than no placeholder at all.
 */
export function slideQuestionPlaceholder(slide: Slide): string {
	if (slide.type === "instruction") return INSTRUCTION_FALLBACK_HEADING;
	if (slide.type === "leaderboard") return LEADERBOARD_LABELS_EN.title;
	if (slide.type === "text") return "Optional heading";
	if (
		slide.type === "image" ||
		slide.type === "video" ||
		slide.type === "embed"
	) {
		return "Optional caption";
	}
	return "Type your question…";
}

/**
 * The authored heading, reduced to what a heading can actually be: one line.
 *
 * A heading is parsed as a single inline run (`parseSlideInline`) and drawn in a
 * `<span>` with no whitespace rule, so every room surface — the projector, every
 * phone, the dry run — collapses a line break in it to a single space. The
 * canvas is a `<textarea>`, which would happily *show* that break and let the
 * author leave believing the room will honour it. It will not, so the break
 * never reaches the field: what is typed here is what will be read there
 * (REQ153), which is the whole promise of authoring on the slide.
 *
 * A space rather than nothing, because that is precisely what the room renders
 * a break as — the two words either side stay two words. This is also what the
 * `<input>` this field replaced did with a multi-line paste, so the rule is
 * restored rather than invented.
 */
export function singleLineQuestion(authored: string): string {
	return authored.replace(/\r\n?|\n/g, " ");
}

/**
 * What marking an option correct will actually do, in the organizer's terms
 * (REQ013) — carried by the tool itself, since that is where the affordance now
 * lives. A quiz scores it and rewards answering it quickly (REQ054);
 * a plain choice slide reveals it as the solution once results are shown.
 */
export function correctOptionHint(slide: Slide): string {
	return slide.type === "quiz"
		? "Participants who pick it score automatically, and the sooner they do the more it is worth."
		: "The solution is revealed once results are shown.";
}

/**
 * Whether this slide's answers are a list of visible rows an author writes on
 * the canvas — as opposed to a structured field group that keeps its home in the
 * settings column (REQ153/REQ155).
 *
 * One predicate rather than the two spellings that used to sit either side of
 * this surface: a quiz answered by typing (REQ055) has an accepted-answer list
 * and no options at all, so "is this a choice?" has to be asked of the answer
 * mode and not of the slide type alone.
 */
export function isChoiceShapedSlide(slide: Slide): boolean {
	if (slide.type === "multiple-choice") return true;
	return slide.type === "quiz" && quizAnswerModeFor(slide) === "select";
}

/**
 * Whether one option may be removed from an answer set of this size, and what to
 * say when it may not (REQ012's floor, unchanged: a choice slide keeps two
 * options, because one option is not a choice).
 *
 * The control it answers for stays on screen either way — the reason
 * travels with the answer so it can reach a tooltip *and* an accessible name,
 * rather than being a button that quietly is not there.
 */
export function canvasOptionRemoval(optionCount: number): {
	enabled: boolean;
	reason: string;
} {
	return optionCount > MIN_CHOICE_OPTIONS
		? { enabled: true, reason: "" }
		: {
				enabled: false,
				reason: `A choice slide needs at least ${MIN_CHOICE_OPTIONS} options`,
			};
}

/**
 * Whether the add tool may grow the option list, and — at the write boundary's
 * ceiling (REQ159) — the sentence saying why it may not. The store's
 * `addOption` holds the same ceiling; this is the reason the dead control gives.
 */
export function canvasOptionAddition(optionCount: number): {
	enabled: boolean;
	reason: string;
} {
	return optionCount < SLIDE_OPTION_LIMIT
		? { enabled: true, reason: "" }
		: {
				enabled: false,
				reason: `A choice slide can hold at most ${SLIDE_OPTION_LIMIT} options`,
			};
}

/**
 * The slide's heading, as the room reads it — and, when the editor handed this
 * surface its layer, as the author types it.
 *
 * The two renderings share a box on purpose: the invariant is *the
 * heading of this slide*, at the author's own step (REQ091) and in the colours
 * the appearance layer resolved, so an authored size is bigger text under the
 * caret rather than a number in a picker. The field is a textarea sized by a
 * mirrored copy of its own value — CSS only, no measurement on every keystroke —
 * which is what lets a long question wrap on the canvas the way it will wrap on
 * the projector.
 *
 * `fallback` is what the *room* shows when nothing is authored (an instruction
 * slide's front-door heading, a leaderboard's board title) and it renders as
 * real text, because it is real text. The muted placeholder is the editor's
 * reading of the same emptiness and never leaves this surface.
 */
export function SlideQuestion({
	slide,
	className = "",
	fallback = "",
	editing = null,
}: {
	slide: Slide;
	/** The typographic slot the heading sits in on this surface. */
	className?: string;
	/** What the room shows when the heading is unauthored, if anything. */
	fallback?: string;
	editing?: SlideCanvasEditing | null;
}) {
	const text = slide.question ?? "";
	const size = slideTextSizeFor(slide);
	const scale = `${SLIDE_TEXT_SCALE[size]} ${SLIDE_TEXT_LEADING.inline}`;

	if (editing) {
		const label = slideQuestionLabel(slide).toLowerCase();
		const placeholder = slideQuestionPlaceholder(slide);
		// What the field shows is what the room will read, break for break — so a
		// heading that arrived carrying one (a deck saved before this rule, a JSON
		// import) is drawn the way every screen is about to draw it rather than the
		// way it happens to be stored. Caret-safe: the displayed string never
		// changes shape under an edit, because it is already the normalised one.
		const authored = singleLineQuestion(text);
		return (
			<h3 className={className}>
				{/* The field and a hidden copy of its value share one grid cell, so the
				    box is exactly as tall as the text in it. The trailing space is what
				    keeps the mirror a line ahead of a value that ends in one.

				    `text-align` is set rather than left to inherit: a form control does
				    not take the alignment of the box it sits in, so a right-placed
				    slide (REQ087) would have been authored down the left of a heading
				    that renders down the right.

				    Enter does nothing, and a pasted break arrives as the space the room
				    would render it as ({@link singleLineQuestion}) — a textarea that
				    kept the break would be showing the author a slide no screen will
				    draw. Both ends, because a value can arrive by paste, drop or
				    autofill without a keystroke ever being seen. */}
				<span className={`grid w-full ${scale}`}>
					<span
						aria-hidden="true"
						className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words px-1 py-0.5"
					>
						{`${authored || placeholder} `}
					</span>
					<textarea
						className={`col-start-1 row-start-1 w-full resize-none overflow-hidden border-0 bg-transparent px-1 py-0.5 text-inherit [font:inherit] [text-align:inherit] placeholder:text-text-muted placeholder:italic ${CANVAS_FIELD_SURFACE}`}
						rows={1}
						maxLength={SLIDE_TEXT_MAX_LENGTH}
						value={authored}
						placeholder={placeholder}
						aria-label={`Slide ${label}`}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.preventDefault();
						}}
						onChange={(event) =>
							editing.onUpdate({
								question: singleLineQuestion(event.target.value),
							})
						}
					/>
				</span>
			</h3>
		);
	}

	const shown = text || fallback;
	if (!shown) return null;
	return (
		<h3 className={className}>
			<SlideText text={shown} size={size} variant="inline" />
		</h3>
	);
}

/**
 * The answer set of a choice-shaped slide (REQ012/REQ013/REQ014), drawn as the
 * cards the room will meet — and authored inside those cards when the editor
 * handed this surface its layer.
 *
 * Every affordance hangs off the row it acts on: the solution flag
 * and the remove tool sit on their option, and the add row sits at the end of
 * the list it grows. The solution flag is the one that never quietens, because
 * the answer key is part of what an author needs to read at a glance — a marked
 * option wears its check at rest, and an unmarked one still shows the control
 * that would mark it.
 */
export function SlideOptionList({
	slide,
	editing = null,
}: {
	slide: Slide;
	editing?: SlideCanvasEditing | null;
}) {
	const options = slide.options ?? [];
	const removal = canvasOptionRemoval(options.length);
	const addition = canvasOptionAddition(options.length);
	// What marking one correct will do (REQ013). Read once for the whole list: it
	// is a property of the slide, and the tool it travels on is per row.
	const correctHint = correctOptionHint(slide);

	return (
		<div className="w-full space-y-2 px-2">
			{/* REQ014 — say up front when the slide takes more than one answer, since
			    the option rows look identical. */}
			{isMultiSelect(slide) && (
				<p className="text-[10px] uppercase tracking-wider text-text-muted">
					{maxSelectionsFor(slide) === 0
						? "Select all that apply"
						: `Select up to ${maxSelectionsFor(slide)}`}
				</p>
			)}
			{options.map((option, optionIndex) => (
				<div
					key={option.id}
					className="group flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-left text-sm"
				>
					<div
						className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
						style={{
							background: POLL_COLORS[optionIndex % POLL_COLORS.length],
						}}
					/>
					{/* Left, explicitly and on every placement: an option's words start at
					    its colour chip in the card the room gets, whichever way the slide
					    as a whole reads (REQ087). */}
					{editing ? (
						<input
							className={`min-w-0 flex-1 border-0 bg-transparent px-1 py-0.5 text-left text-inherit [font:inherit] placeholder:text-text-muted placeholder:italic ${CANVAS_FIELD_SURFACE}`}
							maxLength={SLIDE_ITEM_TEXT_MAX_LENGTH}
							value={option.text}
							placeholder={`Option ${optionIndex + 1}`}
							aria-label={`Option ${optionIndex + 1}`}
							onChange={(event) =>
								editing.onUpdateOption(option.id, { text: event.target.value })
							}
						/>
					) : (
						<span
							className={option.text ? "text-text" : "text-text-muted italic"}
						>
							{option.text || `Option ${optionIndex + 1}`}
						</span>
					)}
					{editing ? (
						<>
							<CorrectOptionToggle
								marked={option.isCorrect ?? false}
								position={optionIndex + 1}
								hint={correctHint}
								onToggle={() =>
									editing.onUpdateOption(option.id, {
										isCorrect: !(option.isCorrect ?? false),
									})
								}
							/>
							<RemoveOptionButton
								position={optionIndex + 1}
								removal={removal}
								onRemove={() => editing.onRemoveOption(option.id)}
							/>
						</>
					) : (
						/* REQ013 — a marked solution previews on choice slides too, not
						   just quiz. */
						option.isCorrect && (
							<span className="ml-auto text-xs font-medium text-success">
								Correct
							</span>
						)
					)}
				</div>
			))}
			{editing && (
				<button
					type="button"
					onClick={editing.onAddOption}
					disabled={!addition.enabled}
					title={addition.enabled ? undefined : addition.reason}
					className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent/60 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text-muted"
				>
					<Plus size={14} className="flex-shrink-0" />
					Add option
				</button>
			)}
		</div>
	);
}

/**
 * The answer key, on the row it belongs to (REQ013).
 *
 * It is the one tool here that does not fade out: a marked option shows its
 * check and its word at rest, because "which of these is right?" is something an
 * author reads off the slide rather than goes hunting for. An unmarked option
 * keeps the control that would mark it — quieter, never absent.
 *
 * It carries the *consequence* of marking with it (`hint`), because the sentence
 * that used to explain it lived on the settings column's Options group and the
 * affordance no longer does: an explanation left behind where the control used
 * to be is an explanation nobody reads.
 */
function CorrectOptionToggle({
	marked,
	position,
	hint,
	onToggle,
}: {
	marked: boolean;
	/** The option's place in the list, one-based, as the author counts it. */
	position: number;
	/** What marking it will do, in one sentence — {@link correctOptionHint}. */
	hint: string;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={marked}
			onClick={onToggle}
			aria-label={
				marked
					? `Option ${position} is marked correct`
					: `Mark option ${position} correct`
			}
			title={`${marked ? "Marked correct" : "Mark as correct answer"} — ${hint}`}
			className={`ml-auto inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
				marked
					? "border-success/40 bg-success-dim text-success"
					: "border-transparent text-text-muted opacity-70 hover:border-border hover:text-text hover:opacity-100 focus-visible:opacity-100"
			}`}
		>
			<Check size={13} />
			{marked && "Correct"}
		</button>
	);
}

/**
 * Dropping one option from the answer set (REQ012), on the row it drops.
 *
 * At the two-option floor it stays on screen, inert, carrying its reason in both
 * the tooltip and the accessible name.
 *
 * `aria-disabled` rather than `disabled`, and that is the whole point: a
 * `disabled` button leaves the tab order, and this one also rests at zero
 * opacity, so its reason would have been reachable by hovering the row and by
 * nothing else. Kept focusable, it reveals itself to the caret like every other
 * tool on the row (REQ153 asks for exactly that), announces itself as
 * unavailable, and says why. The click is guarded here instead, because
 * `aria-disabled` is a statement to assistive tech and not an inert switch.
 *
 * Its muted → error step is the shared token, composed rather than
 * re-declared — the settings column's `RemoveRowButton` wears the same red.
 */
function RemoveOptionButton({
	position,
	removal,
	onRemove,
}: {
	position: number;
	removal: { enabled: boolean; reason: string };
	onRemove: () => void;
}) {
	return (
		<button
			type="button"
			onClick={() => {
				if (removal.enabled) onRemove();
			}}
			aria-disabled={!removal.enabled}
			title={removal.enabled ? `Remove option ${position}` : removal.reason}
			aria-label={
				removal.enabled
					? `Remove option ${position}`
					: `Remove option ${position} — ${removal.reason}`
			}
			className={`flex-shrink-0 rounded-md p-1 ${REMOVE_BUTTON_HOVER} aria-disabled:cursor-not-allowed aria-disabled:text-text-dim aria-disabled:hover:text-text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${CANVAS_TOOL_REVEAL}`}
		>
			<X size={14} />
		</button>
	);
}
