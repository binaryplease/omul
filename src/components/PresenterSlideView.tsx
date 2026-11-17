import { Play } from "lucide-react";
import { Segmented } from "./EditorControls";
import { ContentSlideView } from "./ContentSlideView";
import { CountdownRunControls, countdownRunFor } from "./CountdownFace";
import {
	leaderboardCaption,
	LeaderboardHeading,
	leaderboardHeadingText,
	readLeaderboard,
} from "./Leaderboard";
import { SlideParticipationControl } from "./LiveRoom";
import { type QuizAudioCue, QuizAudioCueControl } from "./QuizAudioCue";
import {
	QuizTimer,
	quizWindowFor,
	useQuizCountdown,
	useQuizQuestionRunning,
} from "./QuizTimer";
import {
	answerModerationFor,
	describeResponses,
	mcValueDisplayOptions,
	ResultsDisplay,
	type ResultLabels,
	resultLabelsFor,
	type ResultsWording,
} from "./Results";
import { SLIDE_PLACEMENT_CLASSES } from "./SlideAppearance";
import { SlideText } from "./SlideText";
import { SlideTypeIcon } from "./SlideTypeIcon";
import { type ReactNode, useState } from "react";
import { ApiError } from "../api";
import { type Dict, getDict, resolveLang } from "../i18n";
import { useInterfaceText } from "../interface-language";
import { ENGLISH_INTERFACE_TEXT, type InterfaceText } from "../interface-text";
import type {
	CountdownAction,
	McValueDisplay,
	Presentation,
	Slide,
	SlideType,
} from "../types";
import {
	effectiveResultsVisibility,
	isInteractiveSlideType,
	quizAnswerModeFor,
	quizAwaitingStart,
	quizTimerUnavailableReason,
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
//
// Two languages meet on this screen (REQ225, REQ248). What the room reads — the
// slide's results, its response count, its countdown and what stands in for a
// tally not yet shown — is in the deck's language, like every phone in front of
// it, and marked with the deck's `lang`. What only the presenter acts on —
// reveal, hide, restart, the count/percentage switch and the hints beside them —
// is in the interface language, and marked with its own `lang` inside the slide.

/**
 * What this surface is called wherever another one names it: the
 * dry run's presenter pane and the editor's canvas are both pictures of *this*
 * screen, and two spellings of it would be two names for one thing. Not a
 * participant-facing string — it names the screen in the presenter's chrome.
 */
export const SHARED_SCREEN_LABEL = "Shared screen";

/**
 * What restarting a quiz question's timer does, stated where the presenter
 * reaches for it (REQ217): the tooltip and the button's accessible description.
 * A restart moves the question's window and nothing else — every answer already
 * given keeps the points it earned against the window it was given in, and only
 * participants who have not answered get the fresh one. No confirmation guards
 * it: it destroys nothing, and a question the presenter restarted by mistake
 * costs the room nothing it had already won.
 */
export const RESTART_TIMER_HINT = ENGLISH_INTERFACE_TEXT.slideView.restartTimerHint;

/**
 * What starting a waiting quiz question's timer does (REQ226). Going live
 * leaves a timed quiz on the first slide unopened so the room can join first;
 * this is the control that opens it.
 */
export const START_TIMER_HINT = ENGLISH_INTERFACE_TEXT.slideView.startTimerHint;

/**
 * The quiz timer control in its two states — one control, because both call
 * the same endpoint, but named for what it does in each: a question waiting at
 * go-live is *started*, one that has already run is *restarted* (REQ226).
 * Shared by the button on the shared screen and the toast that confirms it, so
 * the two never describe the same click differently.
 */
export function quizTimerControlFor(
	awaitingStart: boolean,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): {
	label: string;
	hint: string;
	confirmation: string;
} {
	const copy = text.slideView;
	return awaitingStart
		? {
				label: copy.startTimer,
				hint: copy.startTimerHint,
				confirmation: copy.timerStarted,
			}
		: {
				label: copy.restartTimer,
				hint: copy.restartTimerHint,
				confirmation: copy.timerRestarted,
			};
}

/**
 * Why the quiz timer control is dead (REQ237), in the interface language:
 * `quizTimerUnavailableReason` decides, and its English words are the
 * server's, so the presenter's are read from the same state here.
 */
export function quizTimerUnavailableText(
	deck: Pick<Presentation, "status" | "mode">,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string | null {
	if (quizTimerUnavailableReason(deck) === null) return null;
	return deck.status === "ended"
		? text.slideView.timerDeckEnded
		: text.slideView.timerNotLive;
}

/**
 * Where a timer start that did not land is reported (REQ237).
 *
 * - **Behind the deck**: the server refused with `presentation-not-live` — this
 *   screen still showed the deck live after it ended or was reset (it missed
 *   the frame). Nothing is wrong but that the screen is stale, so it catches up
 *   and says, beside the slide rather than instead of it, why the timer did not
 *   start — named for the state it caught up to, through the same reason the
 *   disabled control now carries.
 * - **Anything else** keeps the page's own error path.
 */
export async function routeTimerFailure(
	thrown: unknown,
	report: {
		catchUp: () => Promise<Pick<Presentation, "status" | "mode"> | null>;
		notice: (message: string) => void;
		failed: (message: string) => void;
	},
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): Promise<void> {
	if (thrown instanceof ApiError && thrown.movedOn === "presentation-not-live") {
		const deck = await report.catchUp();
		report.notice((deck && quizTimerUnavailableText(deck, text)) ?? thrown.message);
		return;
	}
	report.failed(
		thrown instanceof Error ? thrown.message : text.presenterPage.unknownError,
	);
}

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

/**
 * How wide the shared screen lets a slide run: an open-ended wall gets the room
 * its cards need, everything else a reading column.
 */
export function presenterSlideWidthClass(type: SlideType): string {
	return type === "open-text" ? "max-w-6xl" : "max-w-3xl";
}

/**
 * The top of a question slide on the shared screen: its type, the question, the
 * picture beside it and how many have answered. What the live screen adds under
 * it — the countdown and the switches that govern the room — arrives as
 * `children`.
 */
function PresenterSlideHeading({
	slide,
	results,
	labels,
	children,
	room = getDict("en"),
	lang,
}: {
	slide: Slide;
	results: any;
	/** The room's words, in the deck's language (REQ225). */
	labels: ResultLabels;
	children?: ReactNode;
	/**
	 * The deck's dictionary, for the response count the room reads (REQ248) —
	 * the live screen's; a slide's image keeps English.
	 */
	room?: Dict;
	/** The deck's language, where it is not the page's. */
	lang?: string;
}) {
	// This slide's own appearance over the deck's theme (REQ087) — where its
	// elements sit, and whether it is carrying a picture the words need lifting
	// off. Both off the resolver: a background URL no browser may be pointed at is
	// no picture, so it must not put the words in a picture's colours either.
	const appearance = slideAppearanceFor(slide);
	const placement = SLIDE_PLACEMENT_CLASSES[appearance.placement];
	return (
		<div
			lang={lang}
			className={`${placement.text} mb-4 sm:mb-8 slide-in ${
				appearance.backgroundImage !== "" ? "slide-title-overlay" : ""
			}`}
		>
			<SlideTypeIcon type={slide.type} large labels={room.slideTypeNames} />
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
					{describeResponses(slide, results, labels)}
				</p>
			)}
			{children}
		</div>
	);
}

/**
 * The heading a leaderboard slide wears on the shared screen (REQ059): the
 * board's title and how many places it shows across how many quiz questions.
 */
function PresenterStandingsHeading({
	slide,
	results,
	labels,
}: {
	slide: Slide;
	results: any;
	/** The room's words, in the deck's language (REQ225). */
	labels: ResultLabels;
}) {
	// The board behind the slide, read once for the caption; the board itself is
	// drawn from the same payload by ResultsDisplay.
	const standings = results ? readLeaderboard(results) : null;
	return (
		<LeaderboardHeading
			title={
				<SlideText
					text={leaderboardHeadingText(slide.question, labels.leaderboard)}
					size={slideTextSizeFor(slide)}
					variant="inline"
				/>
			}
			subtitle={
				standings ? leaderboardCaption(standings, labels.leaderboard) : undefined
			}
		/>
	);
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
	 * Start, pause or reset a countdown slide's clock (REQ107), or `null` on a
	 * surface with no room to run it for — a dry run's clock would count down for
	 * nobody, so its face stays at the full length.
	 */
	onSetCountdown: ((slideId: string, action: CountdownAction) => void) | null;
	/**
	 * Take one submitted answer off this slide (REQ027), or `null` on a surface
	 * with no stored answer to take: a dry run's responses were generated for it
	 * and never written, so deleting one would delete nothing and the next
	 * regeneration would put it back.
	 */
	onDeleteAnswer: ((slideId: string, answerId: string) => void) | null;
	/**
	 * This slide's audio cue as this screen plays it (REQ058), or `null` where
	 * nothing is played: a slide carrying no cue, and a surface that plays none —
	 * the dry run's presenter pane is a rehearsal at a desk, not the screen the
	 * room hears. The page that plays the cue owns it; this view only draws its
	 * switch.
	 */
	audioCue: QuizAudioCue | null;
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

	// Who reads what on this screen (REQ248). It is also the projector, so what
	// the slide says to the room is in the deck's language, read from the
	// participant dictionary (REQ084) and marked with the deck's `lang`; what
	// tells the presenter what to do — the reveal, the timer restart, the
	// count/percentage switch, a note that something is not shown — is in the
	// interface language, and marked with its own `lang` inside the slide.
	const { text, language } = useInterfaceText();
	const copy = text.slideView;
	// The room's words, in the deck's language (REQ084, REQ225).
	const dict = getDict(pres.language);
	const roomLanguage = resolveLang(pres.language);
	const resultLabels = resultLabelsFor(dict);
	const wording: ResultsWording = {
		room: dict,
		presenter: text,
		presenterLanguage: language,
	};

	// The quiz question's countdown (REQ057), on the same window the participants
	// answer against and the boundary enforces — one descriptor, both surfaces.
	const quizCountdown = useQuizCountdown(
		quizWindowFor(slide, pres),
		serverClockOffsetMs,
	);
	/**
	 * Whether this is a quiz question the room is still answering. This screen is
	 * held by an editor, so the payload in hand carries the answer key and the
	 * full tally even now — and it is the screen the whole room is reading. While
	 * the question runs it draws the question, the countdown and the response
	 * count, and nothing of what anybody answered; once it is over, the slide's
	 * reveal setting decides as it does for every other slide.
	 */
	const quizRunning = useQuizQuestionRunning(slide, pres, serverClockOffsetMs);
	// A timed quiz that was on screen when the deck went live, not opened yet
	// (REQ226): it counts as running above, so nothing of its result shows, and
	// the timer control below starts it rather than restarting it.
	const awaitingStart = quizAwaitingStart(slide, pres);
	const timerControl = quizTimerControlFor(awaitingStart, text);
	// Why the timer control cannot be used right now, through the same answer
	// the endpoint refuses with (REQ227): a presenter-paced deck opens questions
	// only while live, so the control is drawn disabled with that reason rather
	// than offering a start the server turns away.
	const timerUnavailable = quizTimerUnavailableText(pres, text);
	const timerHint = timerUnavailable ?? timerControl.hint;

	const {
		canControl,
		onReveal,
		onRestartTimer,
		onSetParticipation,
		onSetCountdown,
		onDeleteAnswer,
		audioCue,
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
	const answerModeration = answerModerationFor(
		{
			slideType: slide.type,
			canControl,
			onDelete: onDeleteAnswer
				? (answerId: string) => onDeleteAnswer(slide.id, answerId)
				: null,
		},
		text,
	);
	// Where this slide's elements sit (REQ087), for the controls under its
	// heading — the heading itself reads the same resolver.
	const placement = SLIDE_PLACEMENT_CLASSES[slideAppearanceFor(slide).placement];
	if (kind === "content") {
		// A countdown slide runs on the room's clock (REQ107): the run the server
		// recorded, read against its clock — the same run every phone reads.
		const countdownRun =
			slide.type === "countdown"
				? countdownRunFor(slide, pres, serverClockOffsetMs)
				: null;
		return (
			<div lang={roomLanguage} className="slide-in py-4">
				<ContentSlideView
					slide={slide}
					joinCode={pres.code}
					joinUrl={joinUrl}
					deck={pres}
					countdownRun={countdownRun}
					wording={wording}
				/>
				{/* The clock's controls under the clock they run, not in the page
				    chrome — they change this slide's face and nothing else. */}
				{countdownRun && onSetCountdown && (
					<div className={`mt-6 flex flex-col ${placement.items}`}>
						<CountdownRunControls
							slide={slide}
							run={countdownRun}
							canControl={canControl}
							live={pres.status === "live"}
							onAction={(action) => onSetCountdown(slide.id, action)}
						/>
					</div>
				)}
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
			<div lang={roomLanguage} className="slide-in py-4 space-y-6">
				<PresenterStandingsHeading
					slide={slide}
					results={results}
					labels={resultLabels}
				/>
				{visibility === "private" ? (
					<div className="text-center text-text-dim py-16">
						{dict.resultsPrivate}
					</div>
				) : !tallyPublished ? (
					<div className="text-center py-16">
						{/* The room reads the state; only the presenter is told to act. */}
						<p className="text-text-dim mb-4">{dict.resultsHidden}</p>
						{canControl && (
							<button
								type="button"
								lang={language}
								className="btn-primary"
								onClick={() => onReveal(slide.id, true)}
							>
								{copy.revealStandings}
							</button>
						)}
					</div>
				) : !results ? (
					pres.status === "live" ? (
						<div className="text-center text-text-dim py-16">
							{dict.waitingForScores}
						</div>
					) : (
						<div lang={language} className="text-center text-text-dim py-16">
							{copy.startToRank}
						</div>
					)
				) : (
					<>
						<ResultsDisplay
							slide={slide}
							results={results}
							labels={resultLabels}
							wording={wording}
						/>
						{visibility === "on-click" && isRevealed && canControl && (
							<div className="text-center mt-4">
								<button
									type="button"
									lang={language}
									className="text-xs text-text-muted hover:text-text underline"
									onClick={() => onReveal(slide.id, false)}
								>
									{copy.hideStandings}
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
			<PresenterSlideHeading
				slide={slide}
				results={results}
				labels={resultLabels}
				room={dict}
				lang={roomLanguage}
			>
				{/* The question's countdown and the control that starts or reopens
				    it, on the question they govern rather than in the page chrome.
				    Both surfaces show the same window (REQ057). The audio cue's
				    switch joins them (REQ058): the cue plays for that same window,
				    so muting it is a decision about this question too. */}
				{slide.type === "quiz" && (
					<div
						lang={language}
						className={`mt-4 flex flex-col gap-2 ${placement.items}`}
					>
						{/* A question waiting at go-live has no countdown yet
						    (REQ226); the room is told whose move it is instead —
						    unless the presenter has also closed it, where starting
						    the timer would not reopen it, so the room reads what
						    every phone reads: that it is closed. */}
						{awaitingStart ? (
							<p lang={roomLanguage} className="text-sm font-semibold text-text-muted">
								{participationOpen
									? dict.quizWaitingToStart
									: dict.participationClosed}
							</p>
						) : (
							<QuizTimer
								countdown={quizCountdown}
								label={dict.quizSecondsLeft}
								spokenLabel={dict.quizSecondsLeftSpoken}
								expiredLabel={dict.quizTimesUp}
								lang={roomLanguage}
							/>
						)}
						{canControl && onRestartTimer && (
							<>
								<button
									type="button"
									// Starting is the one thing left to do on a waiting
									// question, so it wears the primary action; a restart
									// is a correction and stays the quiet link it was. A
									// waiting question the presenter has closed is not
									// waiting on this, so it goes quiet too.
									className={
										awaitingStart && participationOpen
											? "btn-primary inline-flex items-center gap-2"
											: "text-xs text-text-muted hover:text-text underline aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:text-text-muted"
									}
									// Disabled with its reason, never hidden (ADR-0025) —
									// and `aria-disabled` rather than `disabled`, so the
									// control keeps focus and the reason stays reachable.
									aria-disabled={timerUnavailable !== null}
									onClick={() => {
										if (timerUnavailable === null) onRestartTimer(slide.id);
									}}
									title={timerHint}
									aria-describedby={`restart-timer-hint-${slide.id}`}
								>
									{awaitingStart && <Play size={16} aria-hidden="true" />}
									{timerControl.label}
								</button>
								{/* Described as well as tooltipped: a title alone reaches
								    neither every screen reader nor a touch screen. Outside
								    the button, so the name stays the label. */}
								<span id={`restart-timer-hint-${slide.id}`} className="sr-only">
									{timerHint}
								</span>
							</>
						)}
						{audioCue && <QuizAudioCueControl cue={audioCue} />}
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
					<div lang={language} className={`mt-4 flex flex-col ${placement.items}`}>
						<SlideParticipationControl
							open={participationOpen}
							canControl={canControl}
							live={pres.status === "live"}
							onChange={(open) => onSetParticipation(slide.id, open)}
						/>
					</div>
				)}
			</PresenterSlideHeading>

			{/* Results visualization — gated by the effective results visibility:
			    the slide's override, else the deck default (REQ102) — and, on a
			    quiz question, by the question being over: "instant" means at the
			    end of the window, never while the room is still answering. */}
			{visibility === "private" ? (
				<div lang={roomLanguage} className="text-center text-text-dim py-16">
					{dict.resultsPrivate}
				</div>
			) : !tallyPublished ? (
				<div lang={roomLanguage} className="text-center py-16">
					{/* The room reads the state; only the presenter is told to act. */}
					<p className="text-text-dim mb-4">{dict.resultsHidden}</p>
					{canControl && (
						<button
							type="button"
							lang={language}
							className="btn-primary"
							onClick={() => onReveal(slide.id, true)}
						>
							{copy.revealResults}
						</button>
					)}
				</div>
			) : quizRunning ? (
				<div className="text-center text-text-dim py-16">
					{quizCountdown.timed || awaitingStart
						? dict.resultsAppearWhenTimeUp
						: dict.resultsAppearWhenClosed}
				</div>
			) : results ? (
				<>
					{/* Absolute vs. percentage (REQ011) — sits with the results it
					    re-reads, not in the page chrome. */}
					{isChoiceSlide && (
						<div lang={language} className="mb-4 flex justify-center">
							<Segmented<McValueDisplay>
								ariaLabel={copy.valueDisplayLabel}
								value={valueDisplay}
								onChange={(next) =>
									setValueDisplayBySlide((prev) => ({
										...prev,
										[slide.id]: next,
									}))
								}
								options={mcValueDisplayOptions(text)}
							/>
						</div>
					)}
					<div lang={roomLanguage}>
						<ResultsDisplay
							slide={slide}
							results={results}
							valueDisplay={isChoiceSlide ? valueDisplay : undefined}
							moderation={answerModeration}
							labels={resultLabels}
							answerFilterLabel={dict.answersFiltered}
							wording={wording}
						/>
					</div>
					{visibility === "on-click" && isRevealed && canControl && (
						<div className="text-center mt-4">
							<button
								type="button"
								lang={language}
								className="text-xs text-text-muted hover:text-text underline"
								onClick={() => onReveal(slide.id, false)}
							>
								{copy.hideResults}
							</button>
						</div>
					)}
				</>
			) : pres.status === "live" ? (
				<div lang={roomLanguage} className="text-center text-text-dim py-16">
					{dict.waitingForResponses}
				</div>
			) : (
				<div lang={language} className="text-center text-text-dim py-16">
					{copy.startToCollect}
				</div>
			)}
		</>
	);
}
