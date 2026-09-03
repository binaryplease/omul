import {
	ChevronLeft,
	ChevronRight,
	Eye,
	Monitor,
	Pencil,
	RefreshCw,
	Smartphone,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getCreatorToken } from "../api";
import { DeckThemeScope } from "../components/DeckTheme";
import { type ChoiceOption, Segmented } from "../components/EditorControls";
import {
	type ParticipantVoteTransport,
	ParticipantSlideView,
} from "../components/ParticipantSlideView";
import { PresenterNotesPanel } from "../components/PresenterNotes";
import {
	PresenterSlideView,
	SHARED_SCREEN_LABEL,
} from "../components/PresenterSlideView";
import { SlideAppearanceScope } from "../components/SlideAppearance";
import { SlideBackground } from "../components/SlideBackground";
import { ICON_BUTTON_HOVER } from "../components/ShareCluster";
import { SlideRailItem } from "../components/SlideRail";
import { LoadingState } from "../components/ui/Loading";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import type { Presentation, Slide } from "../types";
import {
	callerCanEditDeck,
	isCorrectQuizAnswer,
	PREVIEW_DEFAULT_RESPONDENTS,
	PREVIEW_RESPONDENT_LIMIT,
	QUIZ_MAX_POINTS,
	quizAnswerModeFor,
	quizTimeLimitFor,
	scoreQuizAnswer,
	withAudienceSlides,
} from "../types";

// ── Preview mode (REQ103) with test votes (REQ104) ────────────
//
// The dry run an organizer does before a room exists: walk the deck, see every
// slide on the shared screen *and* on a participant's phone, populated with
// generated responses so the charts are the charts the room will produce.
//
// Three decisions shape the page.
//
//  - **Both perspectives at once, side by side.** The point of a preview is that
//    the two disagree — a quiz question shows the presenter the answer key and
//    the room a countdown — and an organizer checking "does this read right"
//    has to see the pair, not flip between them.
//  - **Nothing here touches the deck.** Navigation is local state, not
//    `POST /slide`; the reveal (REQ102) is local state, not `POST /reveal`; and
//    a test vote is generated, drawn and forgotten. A preview that moved the
//    real presentation would end the dry run by beginning the session — so this
//    page has no store to write to and no mutation to send.
//  - **The participant pane really answers.** Its control is the same component
//    a phone runs (`ParticipantSlideView`); only its *transport* differs, and
//    the preview transport keeps the answer in this browser. That is what makes
//    it a preview of the interaction rather than a picture of it.

/** How long between refreshes of the run, matching the presenter's poll. */
const PREVIEW_POLL_MS = 3000;

/**
 * The room sizes offered as one tap (REQ104). Presets rather than a bare number
 * field because the question an organizer is asking is categorical — "does this
 * work empty / with a handful / with a real room / with far too many" — and the
 * field beside them is there for whoever means thirty-one.
 */
const RESPONDENT_PRESETS: ChoiceOption<string>[] = [
	{ value: "0", label: "None" },
	{ value: "5", label: "5" },
	{ value: String(PREVIEW_DEFAULT_RESPONDENTS), label: String(PREVIEW_DEFAULT_RESPONDENTS) },
	{ value: "100", label: "100" },
	{ value: String(PREVIEW_RESPONDENT_LIMIT), label: String(PREVIEW_RESPONDENT_LIMIT) },
];

/** One answer the organizer gave in the participant pane. Never leaves the tab. */
type PreviewAnswer = { value: string; skip: boolean; answeredAtMs: number };

/**
 * The organizer's own quiz standing inside a preview, derived here rather than
 * fetched (REQ056).
 *
 * There is no server-side score to ask for — the answer was never submitted —
 * so it is computed from the very functions the server scores with
 * (`isCorrectQuizAnswer`, `scoreQuizAnswer`, re-exported through `src/types.ts`
 * from the single source of truth). Two copies of "what is this answer worth"
 * would eventually disagree, and the one on the preview would be the one nobody
 * noticed was wrong.
 *
 * `rank` is `null` and `entryId` is absent on purpose: nobody previewing is in
 * the synthetic room, so they hold no place on its board and no row of it is
 * theirs. Claiming otherwise would be the preview inventing a participant.
 */
export function previewScorecard(
	slides: Slide[],
	answers: Map<string, PreviewAnswer>,
	startedAt: string,
) {
	const opened = Date.parse(startedAt);
	const scored = slides
		.filter((slide) => slide.type === "quiz")
		.map((slide) => {
			const answer = answers.get(slide.id ?? "");
			const answerMode = quizAnswerModeFor(slide);
			const timeLimit = quizTimeLimitFor(slide);
			const isCorrect = answer
				? isCorrectQuizAnswer(slide, answer.value)
				: null;
			const elapsedMs = answer ? answer.answeredAtMs - opened : null;
			return {
				slideId: slide.id,
				question: slide.question,
				answerMode,
				timeLimit,
				startedAt,
				maxPoints: QUIZ_MAX_POINTS,
				answered: !!answer,
				optionId: answer && answerMode === "select" ? answer.value : null,
				answer: answer && answerMode === "type" ? answer.value : null,
				isCorrect,
				elapsedMs,
				points: answer
					? scoreQuizAnswer({
							isCorrect: !!isCorrect,
							elapsedMs,
							timeLimitSeconds: timeLimit,
						})
					: 0,
			};
		});
	return {
		slides: scored,
		quizCount: scored.length,
		answeredCount: scored.filter((entry) => entry.answered).length,
		correctCount: scored.filter((entry) => entry.isCorrect === true).length,
		totalPoints: scored.reduce((sum, entry) => sum + entry.points, 0),
		maxPoints: scored.length * QUIZ_MAX_POINTS,
		rank: null,
		rankedCount: 0,
	};
}

/**
 * The transport the preview's participant pane answers through (REQ104).
 *
 * Its whole implementation is "remember it here". There is no network call in
 * this function, which is the isolation guarantee stated as code: the pane has
 * no other way to submit, so a preview *cannot* vote — the alternative, a live
 * transport with a `if (preview) return` in front of it, is one refactor away
 * from a dry run that filled a real deck with fake responses.
 */
export function previewVoteTransport(
	authoredSlides: Slide[],
	answers: Map<string, PreviewAnswer>,
	startedAt: string,
	onAnswered: () => void,
): ParticipantVoteTransport {
	return {
		participantId: "preview",
		vote: async ({ slideId, value, statementId, skip }) => {
			answers.set(statementId ? `${slideId}:${statementId}` : slideId, {
				value,
				skip: !!skip,
				answeredAtMs: Date.now(),
			});
			onAnswered();
		},
		// Upvoting a synthetic response is the same gesture and the same nowhere:
		// the pane tracks its own toggle, and nothing is counted.
		upvoteResponse: async () => {},
		scorecard: async () =>
			previewScorecard(authoredSlides, answers, startedAt),
	};
}

export function PreviewPage({
	id,
	go,
}: {
	id: string;
	go: (r: Route) => void;
}) {
	const [pres, setPres] = useState<Presentation | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	/** The run: how big a room, which one, and when its questions opened. */
	const [respondents, setRespondents] = useState(PREVIEW_DEFAULT_RESPONDENTS);
	const [seed, setSeed] = useState(1);
	const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
	const [preview, setPreview] = useState<any>(null);

	/** Where the organizer is in the deck — local, so the real deck never moves. */
	const [activeIndex, setActiveIndex] = useState(0);
	/**
	 * Slides the organizer has revealed in this dry run (REQ102). Local for the
	 * same reason: rehearsing the reveal must not reveal anything to a room.
	 */
	const [revealedSlideIds, setRevealedSlideIds] = useState<string[]>([]);
	/** What the organizer answered in the participant pane; never submitted. */
	const previewAnswers = useRef(new Map<string, PreviewAnswer>());
	const [answerRevision, setAnswerRevision] = useState(0);

	const { addToast } = useToast();
	// Whether this viewer may edit the deck they are rehearsing — which is what
	// the Edit control beside the title is gated on, and the same question the
	// presenter screen asks. Two proofs, because the server honours two: the edit
	// token this browser holds, or the standing the fetched deck reported for the
	// caller's own credentials (REQ075). Asking only the first is how the owner of
	// a deck created through the API — which is minted no edit token at all — was
	// shown their own deck with the Edit button dead (REQ149).
	const isOwner = callerCanEditDeck({
		heldEditToken: !!getCreatorToken(id),
		accessLevel: pres?.accessLevel,
	});

	usePageTitle(pres ? `${pres.title} - Preview` : "Preview");

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api
			.getPresentation(id)
			.then((deck) => {
				if (cancelled) return;
				setPres(deck);
				setError("");
			})
			.catch((loadError: unknown) =>
				setError(
					loadError instanceof Error ? loadError.message : "Unknown error",
				),
			)
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [id]);

	// The run, refreshed on the presenter's own cadence. Polling is what keeps a
	// quiz countdown honest against the tally beside it — the payload says whether
	// the question is closed, and the answer key appears when it is. Sending the
	// same seed and the same `startedAt` back every time is what makes a poll a
	// refresh rather than a new room every three seconds.
	useEffect(() => {
		let cancelled = false;
		const load = () =>
			api
				.getPreview(id, { respondents, seed, startedAt })
				.then((payload) => !cancelled && setPreview(payload))
				.catch((previewError: unknown) => {
					if (cancelled) return;
					setError(
						previewError instanceof Error
							? previewError.message
							: "Unknown error",
					);
				});
		load();
		const interval = setInterval(load, PREVIEW_POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [id, respondents, seed, startedAt]);

	/**
	 * A fresh run: new test votes, and a new instant for every question to have
	 * opened at. Both move together on purpose — a quiz whose window elapsed
	 * while the organizer was three slides away is reopened by rehearsing the
	 * deck again, which is the honest thing a dry run offers instead of the live
	 * `restart timer` control (that one hands a real room a real window).
	 */
	const restartRun = useCallback(() => {
		setSeed((current) => current + 1);
		setStartedAt(new Date().toISOString());
		setRevealedSlideIds([]);
		previewAnswers.current.clear();
		setAnswerRevision((revision) => revision + 1);
		addToast("Fresh test votes generated", "success");
	}, [addToast]);

	/**
	 * The deck as this dry run stands: live, with every question opened at the
	 * run's instant, and revealing whatever the organizer has revealed here.
	 * Built and thrown away in this component — the stored presentation is
	 * untouched, which is exactly what the server does for the tally beside it.
	 */
	const previewPres: Presentation | null = useMemo(() => {
		if (!pres || !preview) return null;
		const slideStartedAt: Record<string, string> = {};
		for (const slide of pres.slides) {
			if (slide.id) slideStartedAt[slide.id] = preview.startedAt;
		}
		return {
			...pres,
			status: "live",
			activeSlideIndex: activeIndex,
			slideStartedAt,
			revealedSlideIds,
		};
	}, [pres, preview, activeIndex, revealedSlideIds]);

	/**
	 * The same deck as a participant receives it: a quiz question that is still
	 * running arrives without its answer key (REQ056) and no slide arrives with
	 * the presenter's notes on it (REQ090), through the very function the server
	 * projects it with. A preview that handed the phone pane the authored deck
	 * would be showing the organizer a participant view no participant will ever
	 * get.
	 */
	const audiencePres: Presentation | null = useMemo(() => {
		if (!previewPres) return null;
		return {
			...previewPres,
			slides: withAudienceSlides(
				previewPres.slides as any[],
				previewPres,
				Date.now(),
			) as Slide[],
		};
		// The audience deck is re-projected whenever the run refreshes, which is
		// what lets a key appear on the phone pane the moment its question closes.
	}, [previewPres, preview]);

	const transport = useMemo(
		() =>
			previewVoteTransport(
				pres?.slides ?? [],
				previewAnswers.current,
				preview?.startedAt ?? startedAt,
				() => setAnswerRevision((revision) => revision + 1),
			),
		[pres, preview?.startedAt, startedAt, answerRevision],
	);

	/**
	 * A dry run is a rehearsal of the room's screens, so it is drawn in the deck's
	 * own theme (REQ079) — otherwise the one thing a preview exists to answer,
	 * "what will they see?", would be answered in the wrong colours.
	 */
	const themed = (screen: React.ReactNode) => (
		<DeckThemeScope deck={pres}>{screen}</DeckThemeScope>
	);

	if (loading) {
		return themed(
			<div className="min-h-screen bg-void flex items-center justify-center">
				<LoadingState />
			</div>,
		);
	}
	if (error && !pres) {
		return themed(
			<div className="min-h-screen bg-void flex items-center justify-center text-error">
				{error}
			</div>,
		);
	}
	if (!pres || !previewPres || !audiencePres || !preview) return null;

	const activeSlide = pres.slides[activeIndex];
	const audienceSlide = audiencePres.slides[activeIndex];
	const slidePreview = preview.slides?.[activeIndex] ?? null;
	const joinUrl = `${window.location.origin}/join/${pres.code}`;

	return themed(
		<div className="min-h-screen w-full bg-void bg-grid bg-noise flex flex-col">
			<div className="relative z-10 flex flex-col flex-1">
				<header className="border-b border-border bg-surface/80 backdrop-blur-sm">
					<div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-2 sm:py-3 overflow-x-auto whitespace-nowrap">
						<div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-shrink">
							<button
								type="button"
								className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors flex-shrink-0"
								onClick={() => go({ page: "present", id: pres.id })}
							>
								<ChevronLeft size={16} />
								<span className="hidden sm:inline">Back</span>
							</button>
							<div className="w-px h-5 bg-border hidden sm:block" />
							<h1 className="font-semibold truncate max-w-[120px] sm:max-w-xs">
								{pres.title}
							</h1>
							{/* A badge rather than a word in the title: what makes this page
							    safe to click around in is that it is a rehearsal, and that
							    has to be legible at a glance from the far side of the room. */}
							<span className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2 py-1 rounded bg-accent-dim border border-accent/30 text-accent-text flex-shrink-0">
								<Eye size={13} />
								Preview
							</span>
						</div>

						<div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
							<ThemeToggle />
							<button
								type="button"
								className="btn-secondary text-sm flex items-center gap-1.5"
								onClick={() => go({ page: "edit", id: pres.id })}
								disabled={!isOwner}
								title={
									isOwner
										? "Edit the deck"
										: "You don't have edit access to this presentation"
								}
							>
								<Pencil size={14} />
								<span className="hidden sm:inline">Edit</span>
							</button>
						</div>
					</div>

					{/* The test-vote controls (REQ104), on the run they govern rather
					    than tucked into a settings panel elsewhere: both panes
					    below redraw from exactly these three numbers. */}
					<div className="flex items-center gap-3 flex-wrap px-4 sm:px-6 pb-2.5 border-t border-border pt-2.5">
						<span className="flex items-center gap-1.5 text-sm text-text-muted">
							<Users size={15} />
							Test votes
						</span>
						<Segmented<string>
							ariaLabel="How many test responses to simulate"
							value={
								RESPONDENT_PRESETS.some(
									(preset) => preset.value === String(respondents),
								)
									? String(respondents)
									: ""
							}
							onChange={(next) => setRespondents(Number(next))}
							options={RESPONDENT_PRESETS}
						/>
						<label className="flex items-center gap-2 text-sm text-text-muted">
							<span className="hidden sm:inline">or</span>
							<input
								type="number"
								min={0}
								max={PREVIEW_RESPONDENT_LIMIT}
								value={respondents}
								onChange={(event) =>
									setRespondents(
										Math.max(
											0,
											Math.min(
												PREVIEW_RESPONDENT_LIMIT,
												Math.round(Number(event.target.value) || 0),
											),
										),
									)
								}
								className="input w-20 text-center font-mono tabular-nums"
								aria-label="Number of test responses to simulate"
							/>
						</label>
						<button
							type="button"
							className={`flex items-center gap-1.5 text-sm px-2 py-1.5 rounded-lg border border-border bg-surface-raised ${ICON_BUTTON_HOVER}`}
							onClick={restartRun}
							title="Generate a different set of test votes and reopen every question"
						>
							<RefreshCw size={14} />
							Regenerate
						</button>
						<span className="text-xs text-text-dim">
							{preview.testVoteCount === 0
								? "No test responses — every slide previews empty."
								: `${preview.testVoteCount} generated responses. Nothing here is stored, and none of it reaches a live session.`}
						</span>
					</div>
				</header>

				<div className="flex-1 flex flex-col md:flex-row">
					{/* The deck, navigated locally: clicking a slide here moves the
					    rehearsal, never the presentation. */}
					<nav className="md:w-56 flex-shrink-0 border-b md:border-b-0 md:border-r border-border bg-surface/50 overflow-x-auto md:overflow-y-auto p-2 md:p-3 flex md:flex-col gap-2">
						{pres.slides.map((slide, index) => (
							<SlideRailItem
								key={slide.id}
								index={index}
								type={slide.type}
								title={slide.question}
								active={index === activeIndex}
								className="md:w-full"
								onClick={() => setActiveIndex(index)}
							/>
						))}
					</nav>

					<main className="flex-1 flex flex-col min-w-0">
						{activeSlide && audienceSlide ? (
							<div className="flex-1 flex flex-col xl:flex-row min-w-0">
								{/* The shared screen. */}
								<section className="flex-1 min-w-0 flex flex-col border-b xl:border-b-0 xl:border-r border-border">
									<h2 className="flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider text-text-muted border-b border-border bg-surface/40">
										<Monitor size={14} />
										{SHARED_SCREEN_LABEL}
									</h2>
									<div className="relative flex-1 flex items-center justify-center p-4 sm:p-8">
										{/* The slide's own appearance (REQ087) — the pane is a
										    picture of the room's screen, so it is drawn in the
										    slide's colours and placement as well as the deck's
										    theme, or a rehearsal would rehearse a screen that does
										    not exist. */}
										<SlideAppearanceScope deck={previewPres} slide={activeSlide}>
											<SlideBackground slide={activeSlide} />
											<div
												className={`w-full relative z-10 ${
													activeSlide.type === "open-text"
														? "max-w-4xl"
														: "max-w-2xl"
												}`}
											>
												<PresenterSlideView
													slide={activeSlide}
													pres={previewPres}
													results={slidePreview?.presenterResults ?? null}
													serverClockOffsetMs={0}
													joinUrl={joinUrl}
													controls={{
														canControl: true,
														onReveal: (slideId, reveal) =>
															setRevealedSlideIds((current) =>
																reveal
																	? Array.from(new Set([...current, slideId]))
																	: current.filter((one) => one !== slideId),
															),
														// A dry run has no room to hand a fresh window to;
														// "Regenerate" above reopens every question at once,
														// which is what rehearsing again actually means.
														onRestartTimer: null,
														// And no room to close either (REQ111): the pane beside
														// this one answers into the browser rather than into the
														// deck, so a switch that stopped it would be stopping
														// nothing. What closing a question does to a real room is
														// the one thing a dry run cannot rehearse.
														onSetParticipation: null,
														// And nothing to take down (REQ027): a dry run's answers
														// were generated for it and never written, so deleting one
														// would delete nothing — and "Regenerate" would put it
														// straight back. Moderation is about what a real room
														// really said.
														onDeleteAnswer: null,
													}}
												/>
												{/* REQ090 — the notes for this slide, on the presenter
												    pane and nowhere else. A dry run is where an organizer
												    finds out whether the cue they wrote is the cue they
												    needed, so the panel stands open here rather than behind
												    a toggle: this screen is a rehearsal, not the projector,
												    and there is no room to keep it from. */}
												<PresenterNotesPanel
													slide={activeSlide}
													className="mt-8 border-t border-border pt-6"
												/>
											</div>
										</SlideAppearanceScope>
									</div>
								</section>

								{/* A participant's phone. */}
								<section className="flex-1 min-w-0 flex flex-col xl:max-w-md">
									<h2 className="flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-wider text-text-muted border-b border-border bg-surface/40">
										<Smartphone size={14} />
										Participant
									</h2>
									<div className="flex-1 flex items-start justify-center p-4 sm:p-6">
										<SlideAppearanceScope deck={audiencePres} slide={audienceSlide}>
											{/* Opaque, unlike the pane around it: this frame *is* the phone's
											    screen, so it wears the slide's own canvas (REQ070) at full
											    strength rather than letting the editor's dark chrome muddy
											    a colour the room will see clean. */}
											<div className="relative w-full max-w-sm rounded-3xl border border-border bg-surface p-4 sm:p-5 overflow-y-auto">
												{/* Whatever this slide carries behind it (REQ070/REQ071),
												    exactly as the phone will draw it — a rehearsal that left
												    the picture out would be rehearsing a screen nobody gets. */}
												<SlideBackground slide={audienceSlide} />
												<div className="relative z-10 flex items-center gap-2 mb-6 justify-center">
													<span className="live-dot" />
													<span className="text-sm text-text-muted">
														{previewPres.mode === "survey" ? "SURVEY" : "LIVE"}
													</span>
												</div>
												<div className="relative z-10 flex flex-col items-center">
													{/* Deliberately not keyed on the slide: the live page keeps a
													    participant's per-slide answers across navigation, and a preview
													    that wiped them on every step would rehearse a phone that forgets
													    what it just answered. */}
													<ParticipantSlideView
														pres={audiencePres}
														slide={audienceSlide}
														results={slidePreview?.audienceResults ?? null}
														serverClockOffsetMs={0}
														isSurvey={false}
														transport={transport}
														onError={(message) => addToast(message, "error")}
													/>
												</div>
											</div>
										</SlideAppearanceScope>
									</div>
									<p className="px-4 pb-4 text-center text-xs text-text-dim">
										Answer here to try the interaction — it stays in this
										browser and is never counted into the results above.
									</p>
								</section>
							</div>
						) : (
							<div className="flex-1 flex items-center justify-center text-text-dim">
								No slides
							</div>
						)}

						{/* Walking the deck is what a dry run is for, so the same
						    previous/next pair the presenter uses sits under both panes. */}
						<div className="flex items-center justify-between gap-3 border-t border-border px-4 sm:px-8 py-3">
							<button
								type="button"
								className="btn-secondary flex items-center gap-2"
								disabled={activeIndex <= 0}
								onClick={() => setActiveIndex((index) => index - 1)}
							>
								<ChevronLeft size={16} />
								Previous
							</button>
							<span className="text-text-muted font-mono text-sm">
								{activeIndex + 1} / {pres.slides.length}
							</span>
							<button
								type="button"
								className="btn-primary flex items-center gap-2"
								disabled={activeIndex >= pres.slides.length - 1}
								onClick={() => setActiveIndex((index) => index + 1)}
							>
								Next
								<ChevronRight size={16} />
							</button>
						</div>
					</main>
				</div>
			</div>
		</div>,
	);
}
