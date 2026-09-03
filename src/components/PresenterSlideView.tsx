import { Segmented } from "./EditorControls";
import { ContentSlideView } from "./ContentSlideView";
import {
	LEADERBOARD_LABELS_EN,
	LeaderboardHeading,
	readLeaderboard,
} from "./Leaderboard";
import { SlideParticipationControl } from "./LiveRoom";
import { QuizTimer, quizWindowFor, useQuizCountdown } from "./QuizTimer";
import {
	answerModerationFor,
	describeResponses,
	MC_VALUE_DISPLAY_OPTIONS,
	ResultsDisplay,
} from "./Results";
import { SLIDE_PLACEMENT_CLASSES } from "./SlideAppearance";
import { SlideText } from "./SlideText";
import { SlideTypeIcon } from "./SlideTypeIcon";
import { useState } from "react";
import type { McValueDisplay, Presentation, Slide, SlideType } from "../types";
import {
	effectiveResultsVisibility,
	isInteractiveSlideType,
	quizAnswerModeFor,
	slideAppearanceFor,
	slideAcceptsSubmissions,
	slideMediaIsInteractionArea,
	slideTextSizeFor,
	tallyVisibleToAudience,
} from "../types";

// ── The shared screen's slide ─────────────────────────────────
//
// One rendering of "what is on the projector", worn by the live presenter page
// and by the preview's presenter pane (the unit of sharing is
// the invariant, and the invariant here is the whole slide — its heading, its
// countdown, its results-visibility gate and its tally are one thing, and a
// preview that re-assembled them from the same primitives in a different order
// would be previewing a screen that does not exist).
//
// What differs between the two surfaces is only *where the controls go*: a live
// presenter reveals results on the deck (and the room sees it), while a preview
// reveals them on a deck state the store never sees. So the reveal and the timer
// restart arrive as callbacks rather than being reached for here.

/**
 * What this surface is called wherever another one names it: the
 * dry run's presenter pane and the editor's canvas are both pictures of *this*
 * screen, and two spellings of it would be two names for one thing. Not a
 * participant-facing string — the shared screen is not translated.
 */
export const SHARED_SCREEN_LABEL = "Shared screen";

/**
 * How the shared screen draws a slide. Three renderings, because three kinds of
 * slide are genuinely different objects on a projector — one that collects
 * answers and shows their tally, one that reports on the questions around it
 * (REQ059), and one that is just content.
 *
 * Named rather than left as a chain of ternaries because the preview needs the
 * same answer this component does — "is every slide type covered?" is a question
 * with a test behind it (`PresenterSlideView.test.ts`), and a new slide type
 * that nobody taught the preview about should fail it rather than render blank.
 */
export type PresenterSlideKind = "results" | "standings" | "content";

export function presenterSlideKind(type: SlideType): PresenterSlideKind {
	if (isInteractiveSlideType(type)) return "results";
	if (type === "leaderboard") return "standings";
	return "content";
}

/** What the presenter's screen may do to the slide it is showing. */
export type PresenterSlideControls = {
	/** Whether this viewer holds the deck — a spectator gets the read-only view. */
	canControl: boolean;
	/** Reveal or hide this slide's aggregate (REQ102). */
	onReveal: (slideId: string, reveal: boolean) => void;
	/**
	 * Hand the room a fresh window on this question (REQ057), or `null` where
	 * there is no such thing to offer — a preview's questions are reopened by
	 * restarting the whole dry run, not one slide of it.
	 */
	onRestartTimer: ((slideId: string) => void) | null;
	/**
	 * Open or close this slide to submissions (REQ111), or `null` on a surface
	 * where there is no room to open it to — a dry run's answers go nowhere, so
	 * closing one would be a switch with nothing behind it.
	 */
	onSetParticipation: ((slideId: string, open: boolean) => void) | null;
	/**
	 * Take one submitted answer off this slide (REQ027), or `null` on a surface
	 * with no stored answer to take: a dry run's responses were generated for it
	 * and never written, so deleting one would delete nothing and the next
	 * regeneration would put it back.
	 */
	onDeleteAnswer: ((slideId: string, answerId: string) => void) | null;
};

export function PresenterSlideView({
	slide,
	pres,
	results,
	serverClockOffsetMs,
	controls,
	joinUrl,
}: {
	slide: Slide;
	pres: Presentation;
	results: any;
	serverClockOffsetMs: number;
	controls: PresenterSlideControls;
	joinUrl: string;
}) {
	/**
	 * REQ011 — the presenter's live count/percentage switch for choice results,
	 * per slide. It overrides the slide's authored `mcValueDisplay` for this
	 * screen only: nothing is written back to the deck, so a switch made to suit
	 * the room in front of you doesn't quietly re-author the presentation.
	 */
	const [valueDisplayBySlide, setValueDisplayBySlide] = useState<
		Record<string, McValueDisplay>
	>({});

	// The quiz question's countdown (REQ057), on the same window the participants
	// answer against and the boundary enforces — one descriptor, both surfaces.
	const quizCountdown = useQuizCountdown(
		quizWindowFor(slide, pres),
		serverClockOffsetMs,
	);

	const {
		canControl,
		onReveal,
		onRestartTimer,
		onSetParticipation,
		onDeleteAnswer,
	} = controls;
	// Whether the room can still answer this slide (REQ111), read through the
	// very predicate the boundary refuses on rather than off the field — the
	// shared screen tells the presenter what the server is doing, so a second
	// reading here would let the projector claim a question is open that every
	// phone is being refused on.
	const participationOpen = slideAcceptsSubmissions(pres, slide.id);
	const visibility = effectiveResultsVisibility(
		slide.resultsVisibility,
		pres.resultsVisibility,
	);
	const isRevealed = (pres.revealedSlideIds ?? []).includes(slide.id);
	/**
	 * Whether this slide's tally is published to the room (REQ015/REQ016/REQ017),
	 * read through the very function the server gates the payload with rather
	 * than re-derived from the three modes here. The shared screen is
	 * an audience-facing surface: a rule that drifted from the server's would put
	 * this projector out of step with every phone in front of it. `visibility`
	 * stays beside it because the two withholding modes are not the same message
	 * — "never on screen" and "not yet" ask different things of the presenter.
	 */
	const tallyPublished = tallyVisibleToAudience(slide, pres);
	const kind = presenterSlideKind(slide.type);
	// Whether this screen moderates the answers it draws (REQ027), through the one
	// descriptor every surface composes — never assembled here, or the shared
	// screen and the wall it draws would answer "may this come down?" separately.
	const answerModeration = answerModerationFor({
		slideType: slide.type,
		canControl,
		onDelete: onDeleteAnswer
			? (answerId: string) => onDeleteAnswer(slide.id, answerId)
			: null,
	});
	// This slide's own appearance over the deck's theme (REQ087) — where its
	// elements sit, and whether it is carrying a picture the words need lifting
	// off. Both off the resolver: a background URL no browser may be pointed at is
	// no picture, so it must not put the words in a picture's colours either.
	const appearance = slideAppearanceFor(slide);
	const placement = SLIDE_PLACEMENT_CLASSES[appearance.placement];

	// The board behind a leaderboard slide (REQ059), read once for the caption
	// above it; the board itself is drawn from the same payload by ResultsDisplay.
	const standings = kind === "standings" && results ? readLeaderboard(results) : null;

	if (kind === "content") {
		return (
			<div className="slide-in py-4">
				<ContentSlideView
					slide={slide}
					joinCode={pres.code}
					joinUrl={joinUrl}
					deck={pres}
				/>
			</div>
		);
	}

	if (kind === "standings") {
		/* The standings on the shared screen (REQ059), behind the same
		   results-visibility gate every other aggregate passes (REQ102): a
		   leaderboard *is* an aggregated result, so the organizer's "when and if"
		   applies to it as it does to a tally. The slide carries its own override,
		   so a deck defaulted to private still holds a board that can be turned on
		   for this slide alone — the setting is a control, not a slide that can
		   never show anything. */
		return (
			<div className="slide-in py-4 space-y-6">
				<LeaderboardHeading
					title={
						<SlideText
							text={slide.question || LEADERBOARD_LABELS_EN.title}
							size={slideTextSizeFor(slide)}
							variant="inline"
						/>
					}
					subtitle={
						standings
							? `Top ${Math.min(
									standings.size,
									standings.entries.length,
								)} across ${standings.quizCount} quiz question${
									standings.quizCount === 1 ? "" : "s"
								}`
							: undefined
					}
				/>
				{visibility === "private" ? (
					<div className="text-center text-text-dim py-16">
						Standings are private — not shown on the shared screen.
					</div>
				) : !tallyPublished ? (
					<div className="text-center py-16">
						<p className="text-text-dim mb-4">
							Standings are hidden.
							{canControl ? " Reveal when you're ready." : ""}
						</p>
						{canControl && (
							<button
								type="button"
								className="btn-primary"
								onClick={() => onReveal(slide.id, true)}
							>
								Reveal standings
							</button>
						)}
					</div>
				) : !results ? (
					<div className="text-center text-text-dim py-16">
						{pres.status === "live"
							? "Waiting for scores..."
							: "Start the presentation to rank the room"}
					</div>
				) : (
					<>
						<ResultsDisplay slide={slide} results={results} />
						{visibility === "on-click" && isRevealed && canControl && (
							<div className="text-center mt-4">
								<button
									type="button"
									className="text-xs text-text-muted hover:text-text underline"
									onClick={() => onReveal(slide.id, false)}
								>
									Hide standings
								</button>
							</div>
						)}
					</>
				)}
			</div>
		);
	}

	// A quiz answered by typing (REQ055) has no per-option tally, so the
	// count/percentage switch below has nothing to re-read — it belongs to option
	// bars.
	const isChoiceSlide =
		(slide.type === "multiple-choice" || slide.type === "quiz") &&
		quizAnswerModeFor(slide) !== "type";
	const valueDisplay =
		valueDisplayBySlide[slide.id] ?? slide.mcValueDisplay ?? "both";

	return (
		<>
			<div
				className={`${placement.text} mb-4 sm:mb-8 slide-in ${
					appearance.backgroundImage !== "" ? "slide-title-overlay" : ""
				}`}
			>
				<SlideTypeIcon type={slide.type} large />
				{/* The question as its author wrote it (REQ088/REQ089), at the step
				    they chose (REQ091) — the same string the room's phones render
				    through the same component. */}
				<h2 className="text-xl sm:text-3xl font-bold mt-3 sm:mt-4 mb-2">
					<SlideText
						text={slide.question}
						size={slideTextSizeFor(slide)}
						variant="inline"
					/>
				</h2>
				{/* The slide's illustration (REQ069) — but not on a slide whose media
				    *is* its result surface (REQ052): a pin slide's picture is drawn
				    below with the room's pins on it, and a copy up here would be the
				    same image twice with the answers on only one of them. */}
				{slide.mediaUrl && !slideMediaIsInteractionArea(slide.type) && (
					<img
						src={slide.mediaUrl}
						alt={slide.mediaAlt ?? ""}
						className={`${placement.media} mt-4 max-h-64 rounded-xl object-contain`}
					/>
				)}
				{results && (
					<p className="text-text-muted mt-3">
						{describeResponses(slide, results)}
					</p>
				)}
				{/* The question's countdown and the control that reopens it, on the
				    question they govern rather than in the page chrome.
				    Both surfaces show the same window (REQ057). */}
				{slide.type === "quiz" && (
					<div className={`mt-4 flex flex-col gap-2 ${placement.items}`}>
						<QuizTimer
							countdown={quizCountdown}
							label="s left"
							expiredLabel="Time's up"
						/>
						{canControl && onRestartTimer && (
							<button
								type="button"
								className="text-xs text-text-muted hover:text-text underline"
								onClick={() => onRestartTimer(slide.id)}
								title="Reopen this question with a fresh window — answers already given stand"
							>
								Restart timer
							</button>
						)}
					</div>
				)}
				{/* Whether the room can still answer this question (REQ111), on the
				    question it governs rather than in the page's chrome —
				    beside the reveal and the timer restart, because all three are
				    decisions about *this slide* taken with a room in front of you.

				    Drawn for a spectator too, disabled with its reason: a
				    closed question is a fact about the session, and a control that
				    vanished would leave them unable to tell a closed question from an
				    open one. A quiz question is deliberately governed by this *and* by
				    its own window (REQ057) — the clock closes it on time, this closes
				    it on the presenter's word, and neither speaks for the other. */}
				{onSetParticipation && (
					<div className={`mt-4 flex ${placement.items}`}>
						<SlideParticipationControl
							open={participationOpen}
							canControl={canControl}
							onChange={(open) => onSetParticipation(slide.id, open)}
						/>
					</div>
				)}
			</div>

			{/* Results visualization — gated by the effective results visibility:
			    the slide's override, else the deck default (REQ102) */}
			{visibility === "private" ? (
				<div className="text-center text-text-dim py-16">
					Results are private — not shown on the shared screen.
				</div>
			) : !tallyPublished ? (
				<div className="text-center py-16">
					<p className="text-text-dim mb-4">
						Results are hidden.
						{canControl ? " Reveal when you're ready." : ""}
					</p>
					{canControl && (
						<button
							type="button"
							className="btn-primary"
							onClick={() => onReveal(slide.id, true)}
						>
							Reveal results
						</button>
					)}
				</div>
			) : results ? (
				<>
					{/* Absolute vs. percentage (REQ011) — sits with the results it
					    re-reads, not in the page chrome. */}
					{isChoiceSlide && (
						<div className="mb-4 flex justify-center">
							<Segmented<McValueDisplay>
								ariaLabel="Show results as counts or percentages"
								value={valueDisplay}
								onChange={(next) =>
									setValueDisplayBySlide((prev) => ({
										...prev,
										[slide.id]: next,
									}))
								}
								options={MC_VALUE_DISPLAY_OPTIONS}
							/>
						</div>
					)}
					<ResultsDisplay
						slide={slide}
						results={results}
						valueDisplay={isChoiceSlide ? valueDisplay : undefined}
						moderation={answerModeration}
					/>
					{visibility === "on-click" && isRevealed && canControl && (
						<div className="text-center mt-4">
							<button
								type="button"
								className="text-xs text-text-muted hover:text-text underline"
								onClick={() => onReveal(slide.id, false)}
							>
								Hide results
							</button>
						</div>
					)}
				</>
			) : (
				<div className="text-center text-text-dim py-16">
					{pres.status === "live"
						? "Waiting for responses..."
						: "Start the presentation to collect responses"}
				</div>
			)}
		</>
	);
}
