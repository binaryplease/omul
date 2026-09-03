import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	api,
	forgetStatedParticipantName,
	getParticipantId,
	getStatedParticipantName,
	rememberStatedParticipantName,
} from "../api";
import {
	liveVoteTransport,
	ParticipantSlideView,
} from "../components/ParticipantSlideView";
import { DeckMark, DeckThemeScope } from "../components/DeckTheme";
import {
	ChatComposer,
	ChatHeading,
	ChatMessageList,
	chatLabelsFor,
	isChatSurfaceVisible,
	useChatFeed,
} from "../components/ChatPanel";
import {
	ParticipantNameBadge,
	ParticipantNameGate,
	participantNameLabelsFor,
	participantNameOutstanding,
} from "../components/ParticipantName";
import { QAComposer, QAHeading, QAQuestionList, qaLabelsFor, useQAList } from "../components/QAPanel";
import {
	ReactionBar,
	ReactionStream,
	reactionLabelsFor,
	useLiveReactions,
} from "../components/ReactionBar";
import { SlideAppearanceScope } from "../components/SlideAppearance";
import { SlideBackground } from "../components/SlideBackground";
import { LoadingState } from "../components/ui/Loading";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
import { getDict } from "../i18n";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import { useSessionSocket, useStore } from "../store";
import type { ReactionKind, Slide } from "../types";
import { slideHasResults } from "../types";

// ── Participant Page ──────────────────────────────────────────
//
// The page around a participant's slide: joining by code, the socket that keeps
// it in step with the room, the waiting/ended screens, survey-mode navigation
// (REQ003/REQ082) and the deck-wide Q&A layer (REQ036).
//
// The slide itself — the question, the control that answers it, and the results
// once they may be seen — is `ParticipantSlideView`, shared with the preview's
// participant pane (REQ103). What that component does with an answer arrives as
// a transport: here, the live one, which posts to the vote endpoint.
//
// Below the slide sit the three things a participant sends that are **not** an
// answer to it — a reaction (REQ077), a question (REQ036) and a chat message
// (REQ078). They are outside `ParticipantSlideView` for exactly that reason: none
// of them belongs to the slide on screen, and putting them inside it would tie
// them to a question they are not about.

export function ParticipantPage({
	code,
	go,
}: {
	code: string;
	go: (r: Route) => void;
}) {
	// Live-runtime state lives in the session slice (shared with the presenter
	// page); the per-participant interaction state lives in the slide view.
	const pres = useStore((state) => state.presentation);
	const resultsMap = useStore((state) => state.results);
	const serverClockOffsetMs = useStore((state) => state.serverClockOffsetMs);
	const loading = useStore((state) => state.loading);
	const error = useStore((state) => state.error);
	const loadByCode = useStore((state) => state.loadByCode);
	const refreshDeckSlides = useStore((state) => state.refreshDeckSlides);
	const setResultsFor = useStore((state) => state.setResultsFor);
	const setError = useStore((state) => state.setError);
	const resetSession = useStore((state) => state.resetSession);
	/** Bumped when the presenter clears the session (REQ101) — see below. */
	const sessionResetRevision = useStore((state) => state.sessionResetRevision);

	/** Survey-mode only: local slide index (audience-paced navigation, REQ003/REQ082). */
	const [surveyIndex, setSurveyIndex] = useState(0);
	/** Whether an ask is in flight, so the composer cannot fire twice (REQ036). */
	const [askingQuestion, setAskingQuestion] = useState(false);
	/** The same, for a chat message (REQ078). */
	const [sendingMessage, setSendingMessage] = useState(false);
	/**
	 * Why the last reaction did not land, or `""` when it did (REQ077). One line
	 * that is replaced rather than a toast that stacks — see {@link handleReact}.
	 */
	const [reactionNotice, setReactionNotice] = useState("");
	/**
	 * The name this browser has stated on this deck (REQ076), `""` while it has
	 * stated none. Seeded from local storage so a reload does not re-ask a
	 * question already answered, and replaced with what the **server** kept —
	 * which may differ, since the normalisation is the server's.
	 */
	const [statedName, setStatedName] = useState("");
	/** Whether the correction form is open over an already-stated name. */
	const [changingName, setChangingName] = useState(false);
	/** Whether a name is in flight, and why the last one did not land. */
	const [statingName, setStatingName] = useState(false);
	const [nameError, setNameError] = useState("");
	const participantId = useRef(getParticipantId());
	/**
	 * The projection this browser last read its deck against — see the re-read
	 * effect below. `null` means "not read yet", which is what makes the join
	 * fetch's own value a starting point rather than a change to act on.
	 */
	const lastProjectionKey = useRef<string | null>(null);
	const { addToast } = useToast();

	usePageTitle(pres ? `${pres.title} - Participate` : "Participate");

	const isSurvey = pres?.mode === "survey";

	// The displayed slide: survey mode is audience-paced (local index); live
	// mode follows the presenter via the session slice's activeSlideIndex.
	const activeSlide: Slide | null = pres
		? ((isSurvey
				? pres.slides[surveyIndex]
				: pres.slides[pres.activeSlideIndex ?? 0]) ?? null)
		: null;

	// Results for the active slide come from the shared per-slide results map.
	const results = activeSlide ? (resultsMap[activeSlide.id] ?? null) : null;

	// One transport per deck, and stable across renders: the slide view lists it
	// among the dependencies of its scorecard fetch, and a fresh object every
	// render would re-fetch that card on every keystroke.
	const transport = useMemo(
		() => liveVoteTransport(pres?.id ?? "", participantId.current),
		[pres?.id],
	);

	// Join presentation into the session slice; clear it on unmount.
	useEffect(() => {
		// A different deck starts a fresh projection history — see below.
		lastProjectionKey.current = null;
		loadByCode(code);
		return () => resetSession();
	}, [code, loadByCode, resetSession]);

	/**
	 * Re-read the deck whenever what the server will *send* this browser changes
	 * (REQ053, REQ015–REQ018).
	 *
	 * The deck is otherwise fetched exactly once, at join, and it arrives already
	 * projected for the audience — so anything the projection depends on is a
	 * trigger to fetch it again. Two things are:
	 *
	 *  - **The reveal set** (REQ053). A Pin on Image slide's target area is
	 *    stripped from the audience's deck until it is revealed
	 *    (`withAudienceSolutions`). Without this the socket's `slide.revealed`
	 *    would move `revealedSlideIds` while every slide still carried
	 *    `pinArea: null` — so the room would see the target appear in the
	 *    aggregate below and no participant would ever be told about their own
	 *    pin, until they reloaded the page.
	 *  - **The deck's reveal mode** (REQ018). Setting it deck-wide clears the
	 *    per-slide overrides, and loosening it makes a withheld pin target
	 *    publishable — neither of which rides the `presentation.results-visibility`
	 *    frame, which carries the deck-level setting alone. Without this a phone
	 *    would keep overrides the server has dropped, and would draw a freshly
	 *    published tally over a picture it still holds no target for: the very
	 *    failure the reveal re-read above exists to prevent, reached through the
	 *    second door.
	 *
	 * Both are folded into one key, held as a string: the re-read replaces the
	 * presentation object, so depending on the object itself would re-fetch
	 * forever. The first value is the one the join fetch already answered with, so
	 * it is recorded rather than acted on — a fresh participant must not spend a
	 * second request re-asking for the deck they just received. A save that leaves
	 * both unchanged leaves the key unchanged, so an editor's ordinary Save costs
	 * the room no fetch at all.
	 */
	const projectionKey = `${pres?.resultsVisibility ?? ""}|${(
		pres?.revealedSlideIds ?? []
	).join(",")}`;
	useEffect(() => {
		if (!pres) return;
		if (lastProjectionKey.current === projectionKey) return;
		const isFirstRead = lastProjectionKey.current === null;
		lastProjectionKey.current = projectionKey;
		if (isFirstRead) return;
		refreshDeckSlides(code);
	}, [pres, projectionKey, code, refreshDeckSlides]);

	/**
	 * Recall the name this browser stated on *this* deck (REQ076).
	 *
	 * An effect rather than a lazy initial state because the deck is joined by
	 * code: its id — which the name is filed under, since a name is stated on a
	 * deck and not on a browser — is not known until the join lookup answers. It
	 * runs on the deck id alone, so the re-read below (`refreshDeckSlides`)
	 * replaces the presentation object without replacing what the participant
	 * typed.
	 */
	useEffect(() => {
		if (!pres?.id) return;
		setStatedName(getStatedParticipantName(pres.id));
	}, [pres?.id]);

	/**
	 * Forget it when the session is cleared (REQ076 + REQ101).
	 *
	 * The server drops the whole roster on a reset — a re-run is a different room
	 * — so a browser that kept believing it had answered the question at the door
	 * would never be asked again, and every answer it gave in the re-run would be
	 * stored under nobody: missing from the presenter's roster, empty in both
	 * exports, and silent on both sides.
	 *
	 * Keyed on `sessionResetRevision` rather than on `status === "draft"`, which
	 * is the same shape the Q&A and chat surfaces re-read on: a deck can be in
	 * draft for reasons that are not a reset (a survey deck collects there), and
	 * only the socket frame says the run this name belonged to is gone. The first
	 * value is recorded rather than acted on, so a phone that joins a deck which
	 * was reset before it arrived keeps the name it has just stated.
	 */
	const lastResetRevision = useRef<number | null>(null);
	useEffect(() => {
		if (!pres?.id) return;
		const isFirstRead = lastResetRevision.current === null;
		if (lastResetRevision.current === sessionResetRevision) return;
		lastResetRevision.current = sessionResetRevision;
		if (isFirstRead) return;
		forgetStatedParticipantName(pres.id);
		setStatedName("");
		setChangingName(false);
		setNameError("");
	}, [pres?.id, sessionResetRevision]);

	/**
	 * State a name, or correct the one already stated (REQ076).
	 *
	 * What is kept is the server's answer, not what was typed: the endpoint trims
	 * and folds the value to a single line, so echoing the local string back would
	 * leave this screen showing a name the roster does not have.
	 */
	const handleStateName = async (name: string) => {
		if (!pres) return;
		setStatingName(true);
		setNameError("");
		try {
			const stored = await api.stateParticipantName(
				pres.id,
				participantId.current,
				name,
			);
			rememberStatedParticipantName(pres.id, stored.name);
			setStatedName(stored.name);
			setChangingName(false);
		} catch (nameFailure) {
			setNameError((nameFailure as Error).message);
		} finally {
			setStatingName(false);
		}
	};

	// One shared WebSocket → session-reducer wiring (see useSessionSocket).
	// Survey mode ignores presenter-driven slide changes simply by deriving
	// `activeSlide` from the local `surveyIndex` instead of activeSlideIndex.
	useSessionSocket(pres?.id ?? null, "participant");

	// The deck's Q&A layer (REQ036), which is not tied to the slide on screen —
	// that is the whole point of it. What comes back is what *this* browser is
	// entitled to read (REQ037): the room's list on a published deck, and its own
	// submissions alone on a moderated one.
	const qaList = useQAList(pres?.id ?? null, participantId.current);

	// The deck's chat (REQ078) and the reactions crossing the screen (REQ077).
	// Neither is tied to the slide on screen — see the note at the top — and the
	// reaction stream is not fetched at all: it is the broadcast itself.
	const chatFeed = useChatFeed(pres?.id ?? null, participantId.current);
	const liveReactions = useLiveReactions();

	// Fetch results for current slide (to show after voting). A leaderboard slide
	// takes no votes and still has an aggregate to fetch (REQ059), so the gate is
	// "does this slide have results" rather than "does it collect answers".
	useEffect(() => {
		if (!pres || !activeSlide) return;
		if (!slideHasResults(activeSlide.type)) return;
		api
			.getResults(pres.id, activeSlide.id)
			.then((data) => setResultsFor(activeSlide.id, data))
			.catch(() => {});
	}, [pres, activeSlide, setResultsFor]);

	/**
	 * Ask a question on the deck's Q&A layer (REQ036). No slide id: a question is
	 * asked *of the presentation*, from wherever the participant happens to be.
	 * The list itself refreshes off the `qa.updated` broadcast, so nothing is
	 * appended optimistically here — a moderated deck would otherwise show the
	 * asker a row the server never put in their list.
	 */
	const handleAskQuestion = async (text: string) => {
		if (!pres) return;
		setAskingQuestion(true);
		try {
			const outcome = await api.askQuestion(
				pres.id,
				text,
				participantId.current,
			);
			// Re-asking your own question changes nothing on purpose, and the server
			// says so (`stored: false, merged: false`). Announcing "question sent"
			// over that would tell somebody their words landed when they did not.
			const dict = getDict(pres.language);
			const landed = !!outcome?.stored || !!outcome?.merged;
			addToast(
				landed ? dict.qaSubmitted : dict.qaAlreadyAsked,
				landed ? "success" : "info",
			);
		} catch (askError) {
			addToast((askError as Error).message, "error");
		} finally {
			setAskingQuestion(false);
		}
	};

	/**
	 * React to whatever is on screen (REQ077).
	 *
	 * Nothing is stored on either side, so a *successful* send has no outcome to
	 * report and no state to reconcile — the reaction the sender sees is the one
	 * the broadcast brings back, exactly like everybody else's.
	 *
	 * A **refusal** is a different matter and is not swallowed. The one a
	 * participant can actually meet is the reaction budget (REQ145), and a control
	 * that silently stopped working would read as a broken feature rather than as
	 * a limit. It is held as a single replaceable line beside the row rather than
	 * raised as a toast: a burst of taps produces a burst of refusals, and a
	 * stack of twenty identical toasts is its own defect.
	 */
	const handleReact = (kind: ReactionKind) => {
		if (!pres) return;
		setReactionNotice("");
		api
			.sendReaction(pres.id, kind, activeSlide?.id ?? null, participantId.current)
			.catch((reactError) => setReactionNotice((reactError as Error).message));
	};

	/**
	 * Say something in the deck's chat (REQ078). Nothing is appended optimistically
	 * — the feed refreshes off the `chat.updated` broadcast — so what the sender
	 * sees is the transcript the server actually holds, in the order it holds it.
	 */
	const handleSendMessage = async (text: string) => {
		if (!pres) return;
		setSendingMessage(true);
		try {
			await api.postChatMessage(pres.id, text, participantId.current);
		} catch (sendError) {
			addToast((sendError as Error).message, "error");
		} finally {
			setSendingMessage(false);
		}
	};

	/** Toggle this participant's upvote on a submitted question (REQ060). */
	const handleUpvoteQuestion = async (questionId: string) => {
		if (!pres) return;
		try {
			await api.upvoteQuestion(pres.id, questionId, participantId.current);
		} catch (upvoteError) {
			addToast((upvoteError as Error).message, "error");
		}
	};

	/**
	 * Every screen this page can be on is the room's screen, so all of them are
	 * drawn in the deck's theme (REQ079) — the join wait, the ended notice and the
	 * slide itself alike. One wrapper rather than one per branch: a participant
	 * who watched the palette change as the presenter pressed Start would be
	 * looking at two different presentations.
	 *
	 * `pres` is null until the join lookup answers, and the scope takes that: the
	 * loading and error screens wear the built-in default, because there is not
	 * yet a deck whose theme they could be in.
	 */
	const themed = (screen: React.ReactNode) => (
		<DeckThemeScope deck={pres}>{screen}</DeckThemeScope>
	);

	if (loading)
		return themed(
			<div className="participant-view bg-void">
				<LoadingState />
			</div>,
		);
	if (error)
		return themed(
			<div className="participant-view bg-void bg-noise">
				<div className="relative z-10 text-center">
					<p className="text-error mb-4">{error}</p>
					<button
						type="button"
						className="btn-secondary"
						onClick={() => go({ page: "join" })}
					>
						Try again
					</button>
				</div>
			</div>,
		);
	if (!pres) return null;

	const t = getDict(pres.language);
	// The Q&A layer's wording in the deck's language (REQ036/REQ084), mapped in
	// the one place that mapping lives.
	const qaLabels = qaLabelsFor(t);
	// The same mapping for the two participant channels (REQ077/REQ078/REQ084).
	const reactionLabels = reactionLabelsFor(t);
	const chatLabels = chatLabelsFor(t);

	if (pres.status === "ended") {
		return themed(
			<div className="participant-view bg-void bg-noise">
				<div className="absolute top-4 right-4 z-20">
					<ThemeToggle />
				</div>
				<div className="relative z-10 flex flex-col items-center text-center">
					{/* REQ136 — the organizer's mark on the last screen the room sees,
					    in place of ours. */}
					<DeckMark deck={pres} className="mb-4" />
					<h2 className="text-2xl font-bold mb-2">{t.presentationEnded}</h2>
					<p className="text-text-muted mb-6">{t.thankYou}</p>
					<button
						type="button"
						className="btn-secondary"
						onClick={() => go({ page: "home" })}
					>
						Back to home
					</button>
				</div>
			</div>,
		);
	}

	// The deck's own wording for the question at its door (REQ076/REQ084).
	const nameLabels = participantNameLabelsFor(t);

	/**
	 * REQ076 — the name gate, and it is an **early return** rather than an
	 * overlay on the slide.
	 *
	 * A deck that *requires* a name has to be able to say the room stated one, and
	 * a question drawn beside an answerable slide is a question a participant can
	 * scroll past. So nothing else is on this screen: no slide, no Q&A box, no
	 * chat, no reaction row.
	 *
	 * It sits **after** the ended branch and **before** the waiting one, which is
	 * exactly what "on joining" means here: a deck that is over asks nobody
	 * anything, and a participant standing in front of a deck the presenter has
	 * not started yet is precisely who this is asked of — the endpoint takes it on
	 * a draft deck for the same reason.
	 */
	const nameOutstanding = participantNameOutstanding(pres, statedName);
	if (nameOutstanding || changingName) {
		return themed(
			<div className="participant-view bg-void bg-noise">
				<div className="absolute top-4 right-4 z-20">
					<ThemeToggle />
				</div>
				<div className="relative z-10 flex flex-col items-center px-4">
					<DeckMark deck={pres} className="mb-6" />
					{/* One form for both, which is the point: correcting a name is the
					    same write as stating one (one row per participant, overwritten
					    in place), so it must not be a second form with second rules. The
					    only difference is that a correction has somewhere to go back to
					    — and a participant who has not stated one yet has not. */}
					<ParticipantNameGate
						labels={nameLabels}
						initialName={changingName ? statedName : ""}
						busy={statingName}
						error={nameError}
						onSubmit={handleStateName}
						onCancel={
							nameOutstanding
								? undefined
								: () => {
										setNameError("");
										setChangingName(false);
									}
						}
					/>
				</div>
			</div>,
		);
	}

	/**
	 * The stated name, reported back wherever this participant is standing — the
	 * waiting screen and the slide alike. `null` on a deck that asks for none, so
	 * an anonymous room's screen is exactly what it was.
	 */
	const nameBadge = statedName ? (
		<ParticipantNameBadge
			labels={nameLabels}
			name={statedName}
			onChange={() => setChangingName(true)}
		/>
	) : null;

	// Live mode: presenter must have started the presentation.
	// Survey mode: participants can start responding regardless of status.
	if (!isSurvey && (pres.status === "draft" || !activeSlide)) {
		return themed(
			<div className="participant-view bg-void bg-noise">
				<div className="absolute top-4 right-4 z-20">
					<ThemeToggle />
				</div>
				<div className="relative z-10 flex flex-col items-center text-center">
					{/* REQ136 — the join screen's mark: the organizer's logo when the
					    deck carries one, and otherwise the amber pulse this screen has
					    always waited under. */}
					<DeckMark deck={pres} tone="warning" className="mb-4" />
					<h2 className="text-2xl font-bold mb-2">{t.waitingPresenter}</h2>
					<p className="text-text-muted">{t.willStartSoon}</p>
					{/* REQ076 — a participant who stated a name before the deck started
					    is told it landed, and can correct it here rather than having to
					    wait for a slide to appear before the control does. */}
					{nameBadge && <div className="mt-4">{nameBadge}</div>}
				</div>
			</div>,
		);
	}

	if (!activeSlide) return null;

	const goToSurveySlide = (idx: number) => {
		if (!pres.slides || idx < 0 || idx >= pres.slides.length) return;
		// Input reset and results lookup follow from the derived active slide.
		setSurveyIndex(idx);
	};

	return themed(
		/* The slide's own appearance over the deck's theme (REQ087), around the
		   whole screen rather than around the question alone: on a phone the slide
		   *is* the screen, so a canvas this slide recoloured has to reach the room
		   behind it too. Generates no box, so this changes no layout. */
		<SlideAppearanceScope deck={pres} slide={activeSlide}>
			<div className="participant-view bg-void bg-noise">
				{activeSlide && <SlideBackground slide={activeSlide} />}
				{/* The room's reactions, over the whole screen (REQ077) — including this
				    participant's own, which arrive by the same broadcast as everybody
				    else's rather than being drawn locally, so what one phone shows is
				    what the room is doing. Pointer-transparent, so a burst of hearts
				    cannot swallow a tap meant for the answer below it. */}
				<ReactionStream reactions={liveReactions} />
				<div className="absolute top-4 right-4 z-20">
					<ThemeToggle />
				</div>
				<div
					className={`relative z-10 w-full ${
						activeSlide?.type === "open-text" ? "max-w-4xl" : "max-w-lg"
					} flex flex-col items-center`}
				>
					{/* REQ136 — the organizer's mark above the question, beside the status
					    line rather than in place of it: a LIVE dot reports on the session
					    and is not a mark to be branded over. `fallback="none"` because
					    this screen has no default mark of its own, so a deck with no logo
					    adds nothing here rather than acquiring a dot it never had. */}
					<DeckMark deck={pres} size="sm" fallback="none" className="mb-4" />

					{/* Status indicator: LIVE (live mode) or slide counter (survey mode) —
					    and, on a deck that asked for one, the name this phone answers
					    under (REQ076). Beside the status line rather than over the
					    question: it reports on the session, like the LIVE dot does, and
					    it is where the name is corrected because it is where the name is
					    shown. */}
					<div className="flex flex-col items-center gap-2 mb-6">
						<div className="flex items-center gap-2">
							{isSurvey ? (
								<span className="text-sm text-text-muted">
									{surveyIndex + 1} / {pres.slides.length}
								</span>
							) : (
								<>
									<span className="live-dot" />
									<span className="text-sm text-text-muted">{t.live}</span>
								</>
							)}
						</div>
						{nameBadge}
					</div>

					<ParticipantSlideView
						pres={pres}
						slide={activeSlide}
						results={results}
						serverClockOffsetMs={serverClockOffsetMs}
						isSurvey={!!isSurvey}
						transport={transport}
						onError={setError}
					/>

					{/* Survey-mode navigation (REQ003/REQ082) */}
					{isSurvey && (
						<div className="flex items-center justify-between w-full mt-8 pt-6 border-t border-border gap-3">
							<button
								type="button"
								className="btn-secondary px-5 flex items-center gap-2"
								onClick={() => goToSurveySlide(surveyIndex - 1)}
								disabled={surveyIndex === 0}
							>
								<ChevronLeft size={16} />
								Previous
							</button>
							<span className="text-xs text-text-dim">
								{surveyIndex + 1} / {pres.slides.length}
							</span>
							<button
								type="button"
								className="btn-primary px-5 flex items-center gap-2"
								onClick={() => goToSurveySlide(surveyIndex + 1)}
								disabled={surveyIndex >= pres.slides.length - 1}
							>
								Next
								<ChevronRight size={16} />
							</button>
						</div>
					)}

					{/* The Q&A layer (REQ036). Below whatever slide is on screen rather
					    than inside it, because that is exactly what the layer is: the deck
					    takes questions at any point, so the box that asks them is not a
					    property of the question currently being voted on.

					    It appears only on a deck whose presenter switched the layer on —
					    which is not "hidden because unavailable" but the deck's
					    own shape, the same way a deck with no leaderboard slide shows no
					    standings. Once it is on, everything inside it stays visible and
					    explains itself: a list the organizer keeps back (REQ037) says so
					    rather than reading as empty, and the upvote on a question you asked
					    yourself is disabled with its reason rather than dropped. */}
					{pres.qaEnabled && (
						<section className="w-full mt-8 pt-6 border-t border-border flex flex-col gap-3">
							<QAHeading labels={qaLabels} list={qaList} compact />
							<QAComposer
								labels={qaLabels}
								onAsk={handleAskQuestion}
								busy={askingQuestion}
							/>
							{qaList && !qaList.canSeeAll && (
								<p className="text-xs text-text-dim">{qaLabels.moderatedNote}</p>
							)}
							<QAQuestionList
								list={qaList}
								labels={qaLabels}
								onUpvote={handleUpvoteQuestion}
							/>
						</section>
					)}

					{/* Reactions (REQ077). Below the slide and on every slide type, which
					    is the requirement: a reaction is not an answer to the question on
					    screen, so nothing about that question decides whether it can be
					    sent — a content slide takes them exactly as a quiz does.

					    Shown only on a deck whose presenter opened the channel, which is
					    the deck's own shape rather than "hidden because
					    unavailable" — the same way a deck with Q&A switched off shows no
					    Q&A box. Once the row is there, it stays there and explains
					    itself. */}
					{pres.reactionsEnabled && (
						<section className="w-full mt-8 pt-6 border-t border-border flex flex-col gap-3 items-center">
							<span className="text-xs font-medium uppercase tracking-wider text-text-muted">
								{reactionLabels.title}
							</span>
							<ReactionBar labels={reactionLabels} onReact={handleReact} />
							{reactionNotice && (
								<p className="text-xs text-error text-center">{reactionNotice}</p>
							)}
						</section>
					)}

					{/* The live chat (REQ078), below the slide for the same reason the Q&A
					    box is: the channel belongs to the session, not to whatever
					    question happens to be up. It is deliberately a *separate* section
					    from the Q&A above — two channels, two lists, two endpoints — so
					    that "ask the presenter something" and "talk to the room" never
					    read as one box with two moods.

					    **The section is gated on there being a transcript, not on the
					    channel being open**, and that is the whole of REQ078's "closing it
					    stops posting, not reading". `GET /chat` keeps answering with what
					    was said once the presenter closes the channel — deliberately, so a
					    participant's own last line does not vanish and read as deleted —
					    and gating this on `pres.chatEnabled` would have thrown that away
					    on the one surface the guarantee was written about: the
					    `channels.settings` broadcast patches the deck and the whole
					    section would unmount mid-sentence.

					    So: drawn while the channel is open, and drawn afterwards for as
					    long as there is anything to read. Only the composer goes dead, and
					    it says why. A deck that never carried a chat and never
					    collected one shows nothing, which is the deck's own shape rather
					    than a hidden control. */}
					{isChatSurfaceVisible(pres.chatEnabled, chatFeed) && (
						<section className="w-full mt-8 pt-6 border-t border-border flex flex-col gap-3">
							<ChatHeading labels={chatLabels} feed={chatFeed} compact />
							<ChatMessageList feed={chatFeed} labels={chatLabels} />
							<ChatComposer
								labels={chatLabels}
								onSend={handleSendMessage}
								busy={sendingMessage}
								closed={chatFeed ? !chatFeed.enabled : false}
							/>
						</section>
					)}
				</div>
			</div>
		</SlideAppearanceScope>,
	);
}
