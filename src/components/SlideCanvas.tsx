import { BarChart3, Monitor, SquarePen } from "lucide-react";
import { useId } from "react";
import type { DeckThemeSettings, Slide } from "../types";
import { slideHasResults } from "../types";
import { DeckThemeScope } from "./DeckTheme";
import { type ChoiceOption, Segmented } from "./EditorControls";
import { SHARED_SCREEN_LABEL } from "./PresenterSlideView";
import type { SlideCanvasEditing } from "./SlideCanvasFields";
import { SlidePreview, type SlideCanvasView } from "./SlidePreview";

// ── The editor's stage ────────────────────────────────────────
//
// The slide being authored, as the room will see it, at the centre of the
// Create/Edit page and at every viewport width (REQ152).
//
// This is `SlidePreview` *promoted*, not a second renderer. It used to sit in a
// 384px `hidden xl:flex` aside beside a form that ran to three thousand pixels
// of scroll, so the thing being authored was the least visible object on the
// page that authors it — and below 1280px it was not on the page at all. Moving
// that one rendering path to the centre is what makes the stage the slide; a
// canvas that drew the slide its own way would be an editor that can show a
// slide the room would not get (one rendering path before, one after).
//
// The frame is also the theming boundary, made visible rather than explained
// (REQ079). Everything inside `<DeckThemeScope/>` wears the deck's colours and
// face; the caption above it, and all the chrome the page draws around this
// component, stay in the app's own scheme. The caption is what names which of
// the two the reader is looking at, where they are looking at it.
//
// It is also where the slide is *written* (REQ153). `editing` is the editor's
// own layer — the four store actions the fields on the slide report through —
// and it stops here: it is handed down into the one rendering path, never
// assembled by it, so the surface stays presentational and the question of
// "can this screen be typed on?" is answered by whether it was given one.
//
// And it is where the slide's *results* are looked at (REQ154). The stage has
// two views, switched on the frame itself rather than from the page's chrome,
// because the switch changes what this frame draws and nothing else.
// The question view is the authoring one; the results view is read-only, which
// is why the layer above is withheld from it rather than merely ignored.

/**
 * What the canvas calls itself: the screen it is a picture of, and which slide
 * of the deck is currently on it. One reading, composed from the same label the
 * dry run's presenter pane wears, so no two surfaces name that screen
 * differently.
 */
export function slideCanvasCaption(index: number, total: number): string {
	return `${SHARED_SCREEN_LABEL} · Slide ${index + 1} of ${total}`;
}

/** Why a slide type cannot be looked at through its results. */
export const NO_RESULTS_REASON =
	"This slide collects nothing, so it has no results to draw.";

/**
 * The stage's two views as one descriptor — the switch on the frame
 * is built from it, and so is anything else that ever offers the choice.
 *
 * The results entry carries its own unavailability rather than being dropped
 * from the list: a content slide draws no tally, and an author who
 * cannot find the switch on a text slide learns nothing about *why* it is not
 * there. The reason travels on the option, so it can reach a tooltip and an
 * accessible name rather than only a pointer.
 */
export function slideCanvasViewOptions(
	slide: Slide,
): ChoiceOption<SlideCanvasView>[] {
	const hasResults = slideHasResults(slide.type);
	return [
		{
			value: "question",
			label: "Question",
			icon: <SquarePen size={14} />,
		},
		{
			value: "results",
			label: "Results",
			icon: <BarChart3 size={14} />,
			disabled: !hasResults,
			disabledReason: hasResults ? undefined : NO_RESULTS_REASON,
		},
	];
}

/**
 * Which view the stage actually draws, given the one that was asked for.
 *
 * A slide that draws no tally falls back to its question — the rail selects
 * slides and the type picker converts them, so the view outlives the slide it
 * was chosen on, and a results view of a text slide would be an empty frame
 * where a slide used to be.
 */
export function slideCanvasViewFor(
	slide: Slide,
	view: SlideCanvasView,
): SlideCanvasView {
	return view === "results" && slideHasResults(slide.type)
		? "results"
		: "question";
}

export function SlideCanvas({
	slide,
	index,
	total,
	deck = null,
	editing = null,
	view = "question",
	onViewChange,
	deckQuizCount = 0,
}: {
	slide: Slide;
	index: number;
	total: number;
	/**
	 * The deck the slide is drawn against — its theme (REQ079/REQ080) and the
	 * layer the slide's own appearance is laid over (REQ087). `null` draws the
	 * built-in default, the way `DeckThemeScope` and `SlidePreview` take one.
	 */
	deck?: DeckThemeSettings | null;
	/**
	 * How this stage writes back (REQ153). `null` draws a stage that can only be
	 * read — which is what a canvas asked for before a slide is editable is.
	 */
	editing?: SlideCanvasEditing | null;
	/** Which of the stage's two views is being asked for (REQ154). */
	view?: SlideCanvasView;
	/** Where the switch on the frame reports to. */
	onViewChange: (view: SlideCanvasView) => void;
	/**
	 * How many quiz questions the deck holds (REQ059) — read only by the results
	 * view of a leaderboard slide, which sums the deck around it.
	 */
	deckQuizCount?: number;
}) {
	// The stage is a landmark of its own, named by the caption that already names
	// it on screen — a reader arriving here by landmark is told which screen this
	// is a picture of, the same thing a reader arriving by eye is told.
	const captionId = useId();
	const shown = slideCanvasViewFor(slide, view);
	return (
		<section
			aria-labelledby={captionId}
			className="mx-auto flex w-full max-w-3xl flex-col"
		>
			<div className="mb-2 flex items-center justify-between gap-3 px-1">
				<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
					<h2
						id={captionId}
						className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-text-muted"
					>
						<Monitor size={14} className="flex-shrink-0 self-center" />
						{slideCanvasCaption(index, total)}
					</h2>
					<p className="text-xs text-text-muted">
						Drawn in the deck's own theme — the editor around it is not.
					</p>
				</div>
				{/* On the frame it governs, not in the page's chrome: this
				    switch changes what the box below it draws and nothing else on the
				    page. */}
				<Segmented<SlideCanvasView>
					ariaLabel="What the stage draws — the question or its results"
					value={shown}
					onChange={onViewChange}
					options={slideCanvasViewOptions(slide)}
				/>
			</div>
			<DeckThemeScope deck={deck}>
				<SlidePreview
					slide={slide}
					index={index}
					deck={deck}
					// Withheld rather than ignored: the results view is a picture of a
					// screen nobody types on, and a layer handed to it would be one
					// conditional away from a field on a tally (REQ154).
					editing={shown === "results" ? null : editing}
					view={shown}
					deckQuizCount={deckQuizCount}
				/>
			</DeckThemeScope>
		</section>
	);
}
