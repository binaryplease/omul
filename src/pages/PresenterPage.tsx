import {
	ChevronLeft,
	ChevronRight,
	Download,
	Eye,
	EyeOff,
	Link2,
	MessageCircleQuestion,
	MessageSquare,
	MessagesSquare,
	Pencil,
	RefreshCw,
	StickyNote,
	UserRound,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, getCreatorToken, getParticipantId } from "../api";
import {
	CHAT_LABELS_EN,
	ChatChannelControl,
	chatCountLabel,
	ChatComposer,
	ChatHeading,
	ChatMessageList,
	useChatFeed,
} from "../components/ChatPanel";
import {
	QA_LABELS_EN,
	QAHeading,
	QALayerControls,
	QAQuestionList,
	useQAList,
} from "../components/QAPanel";
import {
	REACTION_LABELS_EN,
	ReactionChannelControl,
	ReactionStream,
	useLiveReactions,
} from "../components/ReactionBar";
import {
	hasPresenterNotes,
	PresenterNotesPanel,
	presenterNotesToggleLabel,
} from "../components/PresenterNotes";
import {
	AudienceBlankCurtain,
	audienceBlankToggleLabel,
	sharedScreenView,
	SlideParticipationControl,
} from "../components/LiveRoom";
import { DeckThemeScope } from "../components/DeckTheme";
import { ExportDialog, exportButtonLabel } from "../components/ExportDialog";
import { PresenterSlideView } from "../components/PresenterSlideView";
import {
	ParticipantRosterPanel,
	participantRosterHeading,
	useParticipantRoster,
} from "../components/ParticipantName";
import { PreviewLink } from "../components/PreviewLink";
import { ResultsLinkDialog } from "../components/ResultsLinkDialog";
import {
	buildShareControls,
	ICON_BUTTON_HOVER,
	ShareCluster,
} from "../components/ShareCluster";
import { SlideAppearanceScope } from "../components/SlideAppearance";
import {
	SlideCommentsPanel,
	slideCommentsFor,
	useSlideComments,
} from "../components/SlideComments";
import { SlideBackground } from "../components/SlideBackground";
import { SlideRailItem } from "../components/SlideRail";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { LoadingState } from "../components/ui/Loading";
import { QRCodeDisplay } from "../components/ui/QRCode";
import { StatusBadge } from "../components/ui/StatusBadge";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import { useSessionSocket, useStore } from "../store";
import {
	audienceViewBlanked,
	callerCanEditDeck,
	canReadDeckComments,
	slideAcceptsSubmissions,
	slideHasResults,
} from "../types";

// ── Presenter Page ────────────────────────────────────────────

export function PresenterPage({
	id,
	go,
}: {
	id: string;
	go: (r: Route) => void;
}) {
	// Live-runtime state lives in the session slice (server-authoritative);
	// both this page and the participant page select from it.
	const pres = useStore((state) => state.presentation);
	const results = useStore((state) => state.results);
	const participantCount = useStore((state) => state.participantCount);
	const serverClockOffsetMs = useStore((state) => state.serverClockOffsetMs);
	const loading = useStore((state) => state.loading);
	const error = useStore((state) => state.error);
	const loadPresentation = useStore((state) => state.loadPresentation);
	const resetSession = useStore((state) => state.resetSession);
	const setError = useStore((state) => state.setError);
	const setResultsFor = useStore((state) => state.setResultsFor);
	const startPresentation = useStore((state) => state.startPresentation);
	const endPresentation = useStore((state) => state.endPresentation);
	const resetPresentation = useStore((state) => state.resetPresentation);
	const goToSlide = useStore((state) => state.goToSlide);
	const revealResults = useStore((state) => state.revealResults);
	const restartSlideTimer = useStore((state) => state.restartSlideTimer);
	const setQASettings = useStore((state) => state.setQASettings);
	const setParticipantChannels = useStore(
		(state) => state.setParticipantChannels,
	);
	const setSlideParticipation = useStore(
		(state) => state.setSlideParticipation,
	);
	const setAudienceBlanked = useStore((state) => state.setAudienceBlanked);
	const deleteSubmittedAnswer = useStore(
		(state) => state.deleteSubmittedAnswer,
	);

	// Ephemeral, single-component UI state stays local (triage decision).
	const [codeCopied, setCodeCopied] = useState(false);
	const [linkCopied, setLinkCopied] = useState(false);
	const [embedCopied, setEmbedCopied] = useState(false);
	const [editLinkCopied, setEditLinkCopied] = useState(false);
	const [showQr, setShowQr] = useState(false);
	const [confirmShareEdit, setConfirmShareEdit] = useState(false);
	/** Whether the "this clears every response" prompt is up (REQ101). */
	const [confirmReset, setConfirmReset] = useState(false);
	/** Whether the export dialog is up (REQ095/REQ096). */
	const [exportOpen, setExportOpen] = useState(false);
	/** Whether the results-link dialog is up (REQ098). */
	const [resultsLinkOpen, setResultsLinkOpen] = useState(false);
	/** Whether the Q&A queue is open beside the slide (REQ036/REQ060). */
	const [qaOpen, setQaOpen] = useState(false);
	/**
	 * Whether the audience panel — the two participant channels and the chat
	 * transcript — is open beside the slide (REQ077/REQ078). Closed until asked
	 * for, like the Q&A queue and the presenter's notes: this screen is the one
	 * being projected, and a chat that opened itself would put the room's
	 * conversation on the wall the first time the page loaded.
	 */
	const [audienceOpen, setAudienceOpen] = useState(false);
	/** Whether a chat post is in flight, so the composer cannot fire twice. */
	const [sendingMessage, setSendingMessage] = useState(false);
	/**
	 * Whether the presenter's own notes are open beside the slide (REQ090).
	 *
	 * Closed until asked for, like the Q&A queue: this screen is the one being
	 * projected, and notes that opened themselves would put a presenter's private
	 * cue on the wall in front of the room the first time they loaded the page.
	 */
	const [notesOpen, setNotesOpen] = useState(false);
	/**
	 * Whether the slide's comment thread is open beside it (REQ074). Closed until
	 * asked for, and here that is not only about clutter: this screen is the one
	 * being projected, and a thread that opened itself would put what the deck's
	 * authors said about a slide on the wall in front of the room.
	 */
	const [commentsOpen, setCommentsOpen] = useState(false);
	/**
	 * Whether the roster of who took part is open beside the slide (REQ076).
	 *
	 * Closed until asked for, like every other panel on this screen and for the
	 * sharpest version of the same reason: this is the screen being projected, and
	 * a list of the room's own names must not put itself on a wall.
	 */
	const [rosterOpen, setRosterOpen] = useState(false);
	const { addToast } = useToast();

	// Whether the current browser holds the creator token for this presentation.
	// It is one of the two ways to control the deck — and the only one that can
	// mint an edit link, since minting one means copying the token itself.
	const heldEditToken = !!getCreatorToken(id);

	// Whether this viewer may actually run the deck. Two ways, and the server
	// honours both: the stored edit token above, or its own answer that this
	// account may edit the deck — its owner, or an account it is shared with at
	// `edit` (REQ075). Every control below is gated on this rather than on the
	// token alone, so neither a collaborator nor an owner on a browser that never
	// held the token is shown a screen of dead buttons (REQ149). Read through the
	// shared predicate rather than by comparing level strings, since three
	// surfaces ask it; the server re-checks each call from the request's own
	// credentials, so a wrong answer here mis-draws a button and nothing more.
	const isOwner = callerCanEditDeck({
		heldEditToken,
		accessLevel: pres?.accessLevel,
	});

	// Whether this viewer's **account** has standing on the deck, which is what
	// its comment threads are gated on (REQ074) — a different question from
	// `isOwner` above, and deliberately so at both ends: an account holding `view`
	// or `comment` reads the threads and cannot run the deck, while the holder of
	// the edit token runs the deck and reads no thread, because a comment has an
	// author and that capability has no account behind it. Which is why this reads
	// `commentAccess` — the server's answer to exactly that question — and not
	// `accessLevel`, which reports `edit` for the token holder the comment routes
	// refuse. Read through the shared predicate rather than by comparing level
	// strings.
	const canReadComments = canReadDeckComments(pres?.commentAccess ?? null);

	usePageTitle(pres?.title ?? "Presenter");

	// Fetch presentation into the session slice; clear it on unmount.
	useEffect(() => {
		loadPresentation(id);
		return () => resetSession();
	}, [id, loadPresentation, resetSession]);

	// One shared WebSocket → session-reducer wiring (see useSessionSocket).
	useSessionSocket(pres?.id ?? null, "presenter");

	// The deck's Q&A queue (REQ036/REQ060). The stored edit token rides this
	// fetch, which is what makes it the *whole* list — including on a deck whose
	// questions the room is not shown (REQ037), and including while the layer is
	// switched off, since working through what was collected during a Q&A phase is
	// most of why a presenter switches it off again.
	const qaList = useQAList(pres?.id ?? null, getParticipantId());

	// The deck's chat (REQ078) and the reactions crossing the screen (REQ077).
	// The chat feed is the same one every phone reads — a chat has one projection,
	// unlike the Q&A list — and the reaction stream is not fetched at all.
	const chatFeed = useChatFeed(pres?.id ?? null, getParticipantId());
	const liveReactions = useLiveReactions();

	// The deck's comment threads (REQ074) — the whole conversation in one read,
	// and only for a caller whose account has standing on the deck. A viewer with
	// none is not asked for on their behalf: the server would refuse it, and the
	// panel that would show the refusal is disabled for them anyway.
	const {
		comments,
		loading: commentsLoading,
		error: commentsError,
		addComment,
		removeComment,
	} = useSlideComments(canReadComments ? (pres?.id ?? null) : null);

	// Who took part, by name (REQ076) — read only while the panel is open and
	// only by a browser that can edit the deck, since the endpoint is gated as a
	// mutation is and would refuse anybody else on every tick.
	const roster = useParticipantRoster(
		pres?.id ?? null,
		isOwner && rosterOpen,
	);

	// Fetch results for active slide (initial + 3s poll)
	// The dep list is deliberately narrower than the captures: the 3s poll must
	// restart only when the *identity* of what is being polled changes
	// (presentation, active slide, live/not-live), not on every new `pres`
	// object the session store hands back. Depending on the whole `pres` would
	// let unrelated store updates tear down and re-create the interval
	// mid-flight.
	useEffect(() => {
		if (!pres || pres.status !== "live") return;
		const slide = pres.slides[pres.activeSlideIndex];
		if (!slide) return;
		// Content slides have no aggregate to poll; a leaderboard has one without
		// collecting a single answer of its own (REQ059), which is why the gate is
		// "does this slide have results" rather than "does it take votes".
		if (!slideHasResults(slide.type)) return;

		const fetchResults = () =>
			api
				.getResults(pres.id, slide.id)
				.then((data) => setResultsFor(slide.id, data))
				.catch(console.error);

		fetchResults();
		const interval = setInterval(fetchResults, 3000);

		return () => clearInterval(interval);
	}, [pres?.id, pres?.activeSlideIndex, pres?.status, setResultsFor]);

	const handleStart = async () => {
		try {
			await startPresentation(id);
			addToast("Presentation started", "success");
		} catch (startError: unknown) {
			setError(
				startError instanceof Error ? startError.message : "Unknown error",
			);
		}
	};

	const handleEnd = async () => {
		try {
			await endPresentation(id);
			addToast("Presentation ended", "info");
		} catch (endError: unknown) {
			setError(endError instanceof Error ? endError.message : "Unknown error");
		}
	};

	/**
	 * Clear the session's results so the deck can be run again (REQ101).
	 *
	 * Confirmed rather than immediate, and irreversibly so: this drops every
	 * response the room submitted, the Q&A queue beside them, and returns the
	 * deck to `draft`. Keeping the old results is a different feature (REQ100),
	 * so there is nothing to undo it with.
	 */
	const handleReset = async () => {
		setConfirmReset(false);
		try {
			await resetPresentation(id);
			addToast("Results cleared — the deck is a fresh draft", "success");
		} catch (resetError: unknown) {
			setError(
				resetError instanceof Error ? resetError.message : "Unknown error",
			);
		}
	};

	/**
	 * Hand the room a fresh window on the question on screen (REQ057) — the way
	 * back from a mis-navigation that burned it, or from a room that was not
	 * ready when the clock started. Answers already given stand; clearing those
	 * is what Reset is for.
	 */
	const handleRestartTimer = async (slideId: string) => {
		try {
			await restartSlideTimer(id, slideId);
			addToast("Question timer restarted", "success");
		} catch (timerError: unknown) {
			setError(
				timerError instanceof Error ? timerError.message : "Unknown error",
			);
		}
	};

	/**
	 * Open or close the slide on screen to submissions (REQ111).
	 *
	 * Confirmed by nothing and undone by pressing it again: closing a question
	 * costs the session nothing — every answer already given stays, the tally
	 * goes on being readable, and reopening it lets the people who were still
	 * typing finish. That is why it is a one-tap switch rather than the
	 * confirmed, irreversible gesture Reset is.
	 */
	const handleSetParticipation = async (slideId: string, open: boolean) => {
		try {
			await setSlideParticipation(id, slideId, open);
			addToast(
				open
					? "Submissions reopened on this slide"
					: "Submissions closed on this slide — the answers already given are kept",
				open ? "success" : "info",
			);
		} catch (participationError: unknown) {
			setError(
				participationError instanceof Error
					? participationError.message
					: "Unknown error",
			);
		}
	};

	/**
	 * Take one submitted answer off the word cloud or open-ended slide on screen
	 * (REQ027) — the manual half of moderation, done while the room is looking at
	 * the thing being moderated.
	 *
	 * **Not confirmed, and deliberately.** Every other irreversible gesture on
	 * this page is (Reset, deleting the deck), and this one is not for two
	 * reasons that both come from the room being in front of you: what a presenter
	 * reaches for this control about is on the projector *now*, and a modal
	 * standing between them and it would put the line they are trying to remove
	 * beside a dialog about removing it — on the same screen the room is reading.
	 * The control itself says what it will do before it is pressed, and the toast
	 * says what it did.
	 */
	const handleDeleteAnswer = async (slideId: string, answerId: string) => {
		try {
			await deleteSubmittedAnswer(id, slideId, answerId);
			addToast("Answer deleted — the room's tally has been updated", "success");
		} catch (deleteError: unknown) {
			setError(
				deleteError instanceof Error ? deleteError.message : "Unknown error",
			);
		}
	};

	/**
	 * Take the deck off the shared screen, or put it back (REQ109).
	 *
	 * No toast: the whole point of this control is that the presenter is looking
	 * at what it did, and a notification about a screen that has visibly just
	 * gone dark is one more thing on a projector that is supposed to be showing
	 * nothing.
	 */
	const handleSetBlanked = async (blanked: boolean) => {
		try {
			await setAudienceBlanked(id, blanked);
		} catch (blankError: unknown) {
			setError(
				blankError instanceof Error ? blankError.message : "Unknown error",
			);
		}
	};

	/**
	 * Switch the Q&A layer on/off (REQ036) or change who reads it (REQ037). Both
	 * land on the same endpoint and the same broadcast, so a room learns the
	 * floor is open — or has just been closed — without reloading anything.
	 */
	const handleQASettings = async (changes: {
		enabled?: boolean;
		visibility?: "presenter" | "everyone";
	}) => {
		try {
			await setQASettings(id, changes);
		} catch (qaError: unknown) {
			setError(qaError instanceof Error ? qaError.message : "Unknown error");
		}
	};

	/** Mark a question dealt with, or put it back in the queue (REQ060). */
	const handleQuestionAnswered = async (
		questionId: string,
		answered: boolean,
	) => {
		try {
			await api.setQuestionAnswered(id, questionId, answered);
		} catch (answeredError: unknown) {
			setError(
				answeredError instanceof Error
					? answeredError.message
					: "Unknown error",
			);
		}
	};

	/**
	 * Open or close the two participant channels (REQ077/REQ078). One endpoint and
	 * one broadcast for both, so a room learns a channel has been closed rather
	 * than discovering it by having a post refused.
	 */
	const handleChannelSettings = async (changes: {
		reactionsEnabled?: boolean;
		chatEnabled?: boolean;
	}) => {
		try {
			await setParticipantChannels(id, changes);
		} catch (channelError: unknown) {
			setError(
				channelError instanceof Error ? channelError.message : "Unknown error",
			);
		}
	};

	/** Say something in the deck's chat from the presenter's own screen (REQ078). */
	const handleSendMessage = async (text: string) => {
		setSendingMessage(true);
		try {
			await api.postChatMessage(id, text, getParticipantId());
		} catch (sendError: unknown) {
			setError(
				sendError instanceof Error ? sendError.message : "Unknown error",
			);
		} finally {
			setSendingMessage(false);
		}
	};

	const handleSlide = async (index: number) => {
		try {
			await goToSlide(id, index);
		} catch (slideError: unknown) {
			setError(
				slideError instanceof Error ? slideError.message : "Unknown error",
			);
		}
	};

	const copyCode = async () => {
		if (!pres) return;
		await navigator.clipboard.writeText(pres.code);
		setCodeCopied(true);
		addToast("Join code copied to clipboard", "success");
		setTimeout(() => setCodeCopied(false), 2000);
	};

	const copyLink = async () => {
		if (!pres) return;
		const url = `${window.location.origin}/join/${pres.code}`;
		await navigator.clipboard.writeText(url);
		setLinkCopied(true);
		addToast("Join link copied to clipboard", "success");
		setTimeout(() => setLinkCopied(false), 2000);
	};

	const copyEmbed = async () => {
		if (!pres) return;
		const url = `${window.location.origin}/join/${pres.code}`;
		const snippet = `<iframe src="${url}" width="100%" height="600" frameborder="0" allow="clipboard-write" style="border:0;border-radius:12px;"></iframe>`;
		await navigator.clipboard.writeText(snippet);
		setEmbedCopied(true);
		addToast("Embed code copied to clipboard", "success");
		setTimeout(() => setEmbedCopied(false), 2000);
	};

	const copyEditLink = async () => {
		if (!pres) return;
		const token = getCreatorToken(pres.id);
		if (!token) {
			addToast("You don't have edit rights for this presentation", "error");
			setConfirmShareEdit(false);
			return;
		}
		const url = `${window.location.origin}/edit/${pres.id}#share=${encodeURIComponent(token)}`;
		await navigator.clipboard.writeText(url);
		setEditLinkCopied(true);
		setConfirmShareEdit(false);
		addToast("Edit link copied to clipboard", "success");
		setTimeout(() => setEditLinkCopied(false), 2000);
	};

	// Keyboard shortcuts for slide navigation — only when the viewer owns
	// the presentation (the server would 401 the underlying setSlide call
	// otherwise).
	// `handleSlide` is redefined on every render, so listing it would give this
	// callback a new identity every render and re-subscribe the window keydown
	// listener each time. The list tracks the `pres?.*` fields the shortcuts
	// branch on instead of the whole object; the remaining gap
	// (`pres.slides.length`) is pre-existing and left as written.
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (!pres || pres.status !== "live" || !isOwner) return;
			if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
				e.preventDefault();
				if (pres.activeSlideIndex < pres.slides.length - 1) {
					handleSlide(pres.activeSlideIndex + 1);
				}
			}
			if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
				e.preventDefault();
				if (pres.activeSlideIndex > 0) {
					handleSlide(pres.activeSlideIndex - 1);
				}
			}
		},
		[pres?.id, pres?.activeSlideIndex, pres?.status, isOwner],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	/**
	 * The shared screen, drawn in the deck's theme (REQ079). This is the surface
	 * the theme was chosen for — it is the one being projected — so the scope goes
	 * around the whole page rather than around the slide: the rail, the header and
	 * the panels are all part of what the room is looking at when a laptop is on
	 * the projector.
	 */
	const themed = (screen: React.ReactNode) => (
		<DeckThemeScope deck={pres}>{screen}</DeckThemeScope>
	);

	if (loading)
		return themed(
			<div className="min-h-screen bg-void flex items-center justify-center">
				<LoadingState />
			</div>,
		);
	if (error)
		return themed(
			<div className="min-h-screen bg-void flex items-center justify-center text-error">
				{error}
			</div>,
		);
	if (!pres) return null;

	const activeSlide = pres.slides[pres.activeSlideIndex];
	const slideResults = activeSlide ? results[activeSlide.id] : null;

	// REQ109 — whether the room is currently looking at a blank screen. Read
	// through the shared predicate rather than off the field, so this screen and
	// a second browser projecting the same deck cannot disagree about it.
	const screenBlanked = audienceViewBlanked(pres);
	const blankButtonLabel = audienceBlankToggleLabel({
		blanked: screenBlanked,
		canControl: isOwner,
	});

	// Spelled out rather than left to the count inside the button: on its own,
	// "4" is the whole accessible name, and a screen reader would announce a
	// number with nothing to hang it on.
	// Spelled out for the same reason the Q&A counter below is: these two carry
	// an icon and no text, so the accessible name is the whole control, and
	// "Export" on its own says nothing about what leaves the building
	// (REQ095/REQ096) or what a reset costs (REQ101). The export's own name is
	// `exportButtonLabel` in `ExportDialog`, beside the formats it opens onto —
	// what the control is called is part of what the affordance is (ADR-0026).
	const exportControlLabel = exportButtonLabel(isOwner);

	// REQ098 — the read-only results link. Offered whatever the deck's status, for
	// the reason the export beside it is: a link minted mid-session is a
	// legitimate thing to hand somebody, and a survey deck collects answers while
	// it is still a draft. Disabled with its reason for a viewer who does not hold
	// the deck (ADR-0025) — minting one is a decision about somebody else's
	// results.
	const resultsLinkButtonLabel = isOwner
		? "Share the results — create, copy or revoke a read-only link to this deck's results"
		: "Share the results — you cannot edit this presentation, so its results are not yours to share";

	const resetButtonLabel = isOwner
		? "Reset results — clear every response and return the deck to draft, so it can be run again"
		: "Reset results — you cannot edit this presentation, so its results are not yours to clear";

	const qaButtonLabel = !isOwner
		? "Show the Q&A queue — you cannot edit this presentation, so the room's questions are not yours to read"
		: qaOpen
			? "Hide the Q&A queue"
			: pres.qaEnabled
				? `Show the Q&A queue — ${qaList?.openCount ?? 0} open`
				: "Show the Q&A queue — the layer is currently off";

	// REQ077/REQ078 — the audience panel: the two participant-channel switches and
	// the chat transcript. Named for what it holds rather than for the chat alone,
	// because the reaction channel has no panel of its own — it is drawn over the
	// whole slide — so its switch lives beside the chat's, in the one place a
	// presenter goes to decide what this room may send besides answers. Offered to
	// a viewer who does not hold the deck too, disabled with its reason rather than
	// dropped (ADR-0025).
	const audienceButtonLabel = !isOwner
		? "Show the audience panel — you cannot edit this presentation, so its channels are not yours to open"
		: audienceOpen
			? "Hide the audience panel"
			: pres.chatEnabled
				? `Show the audience panel — ${chatCountLabel(chatFeed)}`
				: "Show the audience panel — the chat is currently off";

	// REQ090 — the notes for the slide on screen. Offered to a viewer who does
	// not hold the deck too, disabled with its reason rather than dropped
	// (ADR-0025): what they are missing is the organizer's private script, and
	// the server never sent it to them in the first place.
	const notesButtonLabel = presenterNotesToggleLabel({
		canRead: isOwner,
		open: notesOpen,
		hasNotes: Boolean(activeSlide) && hasPresenterNotes(activeSlide),
	});

	// REQ074 — the thread on the slide currently on screen. The count is this
	// slide's rather than the deck's: the panel draws one thread, so a deck-wide
	// number would be a truthful count of something the panel does not show.
	const slideCommentCount = slideCommentsFor(
		comments,
		activeSlide?.id ?? null,
	).length;

	// REQ076 — the roster of who took part. Named for what is behind it rather
	// than for the count, and it states the two things a presenter needs to decide
	// whether to open it: whether this deck asks for names at all, and how many
	// have been stated. Spelled out for the reason the counters above are — the
	// chip carries an icon and a number, so its accessible name is the whole
	// control.
	const rosterButtonLabel = !isOwner
		? "Show who took part — you cannot edit this presentation, so its participants are not yours to read"
		: !pres.requireParticipantName
			? "Show who took part — this deck does not ask participants for a name"
			: rosterOpen
				? "Hide who took part"
				: // The roster is only fetched while the panel is open, so a closed one
					// has no count to report — and `?? 0` would announce an empty room on
					// a deck this browser has not asked about, which is exactly what the
					// visible chip's "—" refuses to claim (ADR-0024). The two have to say
					// the same thing; a screen-reader user is not reading the number.
					"Show who took part — the names stated on this deck";

	const commentsButtonLabel = !canReadComments
		? "Show comments — this deck has not been shared with your account, so its comments are not yours to read"
		: commentsOpen
			? "Hide comments"
			: `Show comments — ${slideCommentCount} on this slide`;

	/**
	 * Paging through the deck — gated on ownership; a spectator gets the
	 * read-only view.
	 *
	 * Lifted out of the slide because the blanked screen (REQ109) draws it too:
	 * the whole point of a blank that survives navigation is that the presenter
	 * lines the next slide up behind it, which a curtain with no Next button
	 * cannot do. One definition rather than two, so the two states cannot come to
	 * page through the deck differently (ADR-0026). It names a *position* and
	 * never a question, which is what lets it stay on a blanked screen.
	 */
	const slideNavigation = pres.status === "live" && isOwner && (
		<div className="flex w-full items-center justify-between mt-8">
			<button
				type="button"
				className="btn-secondary flex items-center gap-2"
				disabled={pres.activeSlideIndex <= 0}
				onClick={() => handleSlide(pres.activeSlideIndex - 1)}
			>
				<ChevronLeft size={16} />
				Previous
			</button>
			<div className="flex items-center gap-3">
				<span className="text-text-muted font-mono text-sm">
					{pres.activeSlideIndex + 1} / {pres.slides.length}
				</span>
				<span className="text-text-dim text-xs hidden sm:inline">
					(arrow keys)
				</span>
			</div>
			<button
				type="button"
				className="btn-primary flex items-center gap-2"
				disabled={pres.activeSlideIndex >= pres.slides.length - 1}
				onClick={() => handleSlide(pres.activeSlideIndex + 1)}
			>
				Next
				<ChevronRight size={16} />
			</button>
		</div>
	);

	/**
	 * REQ109 — the blanked shared screen, and it is an **early return** rather
	 * than a branch inside the layout.
	 *
	 * That is the whole fix for what "blank the audience view" means here. This
	 * page is the product's only shared screen, and the presenter's laptop *is*
	 * the projector — so every pixel still drawn beside a curtain is drawn in
	 * front of the room. Swapping only the centre column left the rail listing
	 * every slide's question in text, the header carrying the deck's title and
	 * join code, and any open panel showing the room's own chat and Q&A, under a
	 * curtain reading "The room sees nothing on the shared screen". Returning
	 * early means there is no deck-bearing JSX on this path to have forgotten.
	 *
	 * What survives is **controls and only controls**, and the distinction is
	 * `AudienceBlankCurtain`'s: a control names what it does, never what the deck
	 * says. Paging keeps working, so the presenter can still line up what comes
	 * next behind a dark screen — which is most of why the blank is sticky — and
	 * this slide's participation switch (REQ111) comes with it, so blanking to
	 * talk over a question and then closing it does not force the question back
	 * in front of the room first. A spectator gets the curtain with neither.
	 */
	if (sharedScreenView(pres) === "blank") {
		return themed(
			<div className="min-h-screen w-full bg-void bg-grid bg-noise flex flex-col">
				<main className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-8">
					<div className="w-full max-w-3xl">
						<AudienceBlankCurtain
							deck={pres}
							canControl={isOwner}
							onShow={() => handleSetBlanked(false)}
							controls={
								<>
									{activeSlide && (
										<SlideParticipationControl
											open={slideAcceptsSubmissions(pres, activeSlide.id)}
											canControl={isOwner}
											onChange={(open) =>
												handleSetParticipation(activeSlide.id, open)
											}
										/>
									)}
									{slideNavigation}
								</>
							}
						/>
					</div>
				</main>
			</div>,
		);
	}

	const shareControls = buildShareControls({
		code: pres.code,
		// The edit-link control alone stays on the token rather than on control of
		// the deck: the link *is* the token, so a collaborator who was never given
		// one has nothing to copy into it (see `buildShareControls`).
		isOwner: heldEditToken,
		copied: {
			code: codeCopied,
			link: linkCopied,
			embed: embedCopied,
			editLink: editLinkCopied,
		},
		onCopyCode: copyCode,
		onCopyLink: copyLink,
		onShowQr: () => setShowQr((visible) => !visible),
		onCopyEmbed: copyEmbed,
		onShareEdit: () => setConfirmShareEdit(true),
	});

	return themed(
		<div className="min-h-screen w-full bg-void bg-grid bg-noise flex flex-col">
			<div className="relative z-10 flex flex-col flex-1">
				{/* Top bar */}
				<header className="border-b border-border bg-surface/80 backdrop-blur-sm">
					{/* Header row — stays on a single line; scrolls horizontally on
					    narrow viewports rather than wrapping the controls. */}
					<div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-2 sm:py-3 overflow-x-auto whitespace-nowrap">
						<div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-shrink">
							<button
								type="button"
								className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors flex-shrink-0"
								onClick={() => go({ page: "home" })}
							>
								<ChevronLeft size={16} />
								<span className="hidden sm:inline">Back</span>
							</button>
							<div className="w-px h-5 bg-border hidden sm:block" />
							<h1 className="font-semibold truncate max-w-[120px] sm:max-w-xs">
								{pres.title}
							</h1>
							<StatusBadge status={pres.status} />
						</div>

						<div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
							{/* Join code cluster — only inline on very wide viewports.
							    On md..lg the controls take priority and the join code is
							    shown on its own row below (see below). */}
							<ShareCluster
								variant="bar"
								className="hidden xl:flex"
								controls={shareControls}
							/>

							{/* Participant count */}
							<div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border border-border text-sm text-text-muted">
								<Users size={16} />
								<span className="font-mono">{participantCount}</span>
							</div>

							{/* The Q&A queue (REQ036/REQ060). The count is what is still
							    open, because that is the number a presenter is actually
							    watching — a total that never went down would say nothing
							    about how much of the room is still waiting.

							    Offered to a viewer who does not hold the deck too, disabled
							    with its reason rather than dropped (ADR-0025), exactly as the
							    export and reset chips below it are: the queue and the
							    switches behind it are the deck's, and that is a thing to say
							    out loud rather than a control to make vanish.

							    What such a viewer must not be shown is the *number*. Their
							    own fetch answers with their own questions rather than the
							    room's (REQ037), so the count beside the icon would be a
							    truthful number about the wrong list. It reads as an explicit
							    "no count to report" instead (ADR-0024) — never a `0`, which
							    would claim an empty queue — and the chip keeps its width, so
							    nothing reflows when the same screen is opened by the
							    organizer. */}
							<button
								type="button"
								onClick={() => setQaOpen((open) => !open)}
								disabled={!isOwner}
								aria-pressed={qaOpen}
								aria-label={qaButtonLabel}
								title={qaButtonLabel}
								className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border text-sm ${
									qaOpen ? "border-accent" : "border-border"
								} ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								<MessageCircleQuestion size={16} />
								<span className="font-mono">
									{isOwner ? (qaList?.openCount ?? 0) : "—"}
								</span>
							</button>

							{/* The audience panel (REQ077/REQ078) — the two participant
							    channels and the chat transcript. The count is what has been
							    said, because that is the number a presenter glances at to
							    decide whether the panel is worth opening.

							    Offered to a viewer who does not hold the deck too, disabled
							    with its reason rather than dropped (ADR-0025), like the Q&A
							    chip beside it. Unlike that one it may still show a number: a
							    chat has one projection and every reader of this deck reads
							    the same feed, so the count is not a truthful number about
							    somebody else's list — it is the same list. */}
							<button
								type="button"
								onClick={() => setAudienceOpen((open) => !open)}
								disabled={!isOwner}
								aria-pressed={audienceOpen}
								aria-label={audienceButtonLabel}
								title={audienceButtonLabel}
								className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border text-sm ${
									audienceOpen ? "border-accent" : "border-border"
								} ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								<MessagesSquare size={16} />
								<span className="font-mono">{chatFeed?.messageCount ?? 0}</span>
							</button>

							{/* The presenter's own notes (REQ090), beside the slide they
							    belong to. A chip rather than a labelled button, like the
							    counters it sits between, and it carries no count: what a note
							    says is the whole of it, so a number would only announce that
							    there is one. */}
							<button
								type="button"
								onClick={() => setNotesOpen((open) => !open)}
								disabled={!isOwner}
								aria-pressed={notesOpen}
								aria-label={notesButtonLabel}
								title={notesButtonLabel}
								className={`flex items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border text-sm ${
									notesOpen ? "border-accent" : "border-border"
								} ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								<StickyNote size={16} />
							</button>

							{/* The slide's comment thread (REQ074). This screen carries it
							    because it is the only one a `view` or `comment` collaborator
							    can reach — the editor turns them away — and a level whose
							    feature has no door is a level with no feature.

							    The count is this slide's, because that is the number somebody
							    glances at to decide whether to open the panel. Disabled with
							    its reason rather than dropped for a viewer with no account on
							    the deck (ADR-0025), and it reads "—" rather than `0` for them
							    (ADR-0024): a zero would claim an empty thread on a deck whose
							    threads they were never sent. */}
							<button
								type="button"
								onClick={() => setCommentsOpen((open) => !open)}
								disabled={!canReadComments}
								aria-pressed={commentsOpen}
								aria-label={commentsButtonLabel}
								title={commentsButtonLabel}
								className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border text-sm ${
									commentsOpen ? "border-accent" : "border-border"
								} ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								<MessageSquare size={16} />
								<span className="font-mono">
									{canReadComments ? slideCommentCount : "—"}
								</span>
							</button>

							{/* Who took part, by name (REQ076). A chip beside the other panels
							    rather than a screen of its own, because that is what it is: a
							    thing the presenter glances at during the session and closes
							    again.

							    Offered whatever the deck's switch says and disabled with its
							    reason for a viewer who does not hold the deck (ADR-0025) — a
							    control that vanished on a deck with names switched off would
							    leave an organizer wondering where the roster went rather than
							    being told the deck never asked. The count is the roster's own
							    length while the panel is open and "—" the rest of the time
							    (ADR-0024): a `0` would claim an empty room on a deck this
							    browser has not asked about. */}
							<button
								type="button"
								onClick={() => setRosterOpen((open) => !open)}
								disabled={!isOwner}
								aria-pressed={rosterOpen}
								aria-label={rosterButtonLabel}
								title={rosterButtonLabel}
								className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border text-sm ${
									rosterOpen ? "border-accent" : "border-border"
								} ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								<UserRound size={16} />
								<span className="font-mono">{roster ? roster.length : "—"}</span>
							</button>

							{/* REQ109 — take the deck off the shared screen without leaving
							    the slide. In this row rather than on the slide itself, and
							    that is ADR-0031's own exception rather than a departure from
							    it: what this governs is the *whole* projected view, so there
							    is no sub-region to sit beside — and the way back is drawn on
							    the curtain itself, where the presenter is already looking.

							    Offered to a viewer who does not hold the deck too, disabled
							    with its reason (ADR-0025), like every chip beside it. Its
							    pressed state is the room's, not this browser's: a second
							    browser projecting the same deck reads the same field off the
							    same broadcast. */}
							<button
								type="button"
								onClick={() => handleSetBlanked(!screenBlanked)}
								disabled={!isOwner}
								aria-pressed={screenBlanked}
								aria-label={blankButtonLabel}
								title={blankButtonLabel}
								className={`flex items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border text-sm ${
									screenBlanked ? "border-accent" : "border-border"
								} ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
							>
								{screenBlanked ? <EyeOff size={16} /> : <Eye size={16} />}
							</button>

							{/* Theme toggle */}
							<ThemeToggle />

							{/* The dry run (REQ103). Offered whatever the deck's status —
							    a preview writes nothing and starts nothing, so there is no
							    state in which opening one costs the room anything — and
							    disabled with its reason for a viewer who does not hold the
							    deck (ADR-0025). */}
							<PreviewLink presentationId={pres.id} go={go} canPreview={isOwner} />

							{/* The two ends of the organizer's session workflow, beside the
							    results they act on (ADR-0031): take the data out
							    (REQ095/REQ096), then clear it so the deck runs clean again
							    (REQ101).

							    Both are offered whatever the deck's status — an export of a
							    session still running is a legitimate snapshot, and a survey
							    deck (REQ003/REQ082) collects answers while it is still a
							    draft, so no status is reliably "nothing to reset" — and both
							    are disabled with their reason rather than dropped for a
							    viewer who does not hold the deck (ADR-0025).

							    Icon chips rather than labelled buttons, like the participant
							    and Q&A counters they sit beside: this row stays on one line
							    and already fills a laptop's width, and two more labelled
							    controls pushed the Back link and the primary lifecycle
							    button off the end of it. The name each one goes by lives in
							    `aria-label`/`title`, so nothing is hidden — only spelled
							    where the row has space for it.

							    The read-only results link (REQ098) opens the group, ahead of
							    both: it is the third thing an organizer does with a session —
							    hand it to somebody who was not in the room — and it belongs
							    beside the results it delegates rather than in the join-code
							    cluster, which hands out ways *into* the deck (ADR-0031). */}
							<button
								type="button"
								className={`flex items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border border-border ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
								onClick={() => setResultsLinkOpen(true)}
								disabled={!isOwner}
								aria-label={resultsLinkButtonLabel}
								title={resultsLinkButtonLabel}
							>
								<Link2 size={16} />
							</button>
							{/* One chip for every shape the session leaves in — a workbook to
							    analyse (REQ095) and the deck rendered to PDF with or without
							    its results (REQ096). The choice is the dialog's, because
							    three chips in this row would be three answers to one
							    question with no room left to say what any of them is. */}
							<button
								type="button"
								className={`flex items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border border-border ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
								onClick={() => setExportOpen(true)}
								disabled={!isOwner}
								aria-label={exportControlLabel}
								title={exportControlLabel}
							>
								<Download size={16} />
							</button>
							<button
								type="button"
								className={`flex items-center px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg bg-surface-raised border border-border ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
								onClick={() => setConfirmReset(true)}
								disabled={!isOwner}
								aria-label={resetButtonLabel}
								title={resetButtonLabel}
							>
								<RefreshCw size={16} />
							</button>

							{/* Lifecycle controls — only a viewer who may edit the deck sees
							    these: its owner, the holder of its edit token, or an `edit`
							    collaborator (REQ149). Everyone else gets a read-only view; the
							    server would reject mutation calls with 401 anyway. */}
							{!isOwner && (
								<span
									className="text-xs text-text-dim font-mono uppercase tracking-wider px-2 py-1 rounded bg-surface-raised border border-border"
									title="You don't have edit access to this presentation"
								>
									View only
								</span>
							)}
							{isOwner && pres.status === "draft" && (
								<>
									<button
										type="button"
										className="btn-secondary text-sm flex items-center gap-1.5"
										onClick={() => go({ page: "edit", id: pres.id })}
										title="Edit presentation"
									>
										<Pencil size={14} />
										<span className="hidden sm:inline">Edit</span>
									</button>
									<button
										type="button"
										className="btn-primary text-sm"
										onClick={handleStart}
									>
										<span className="hidden sm:inline">Start Presentation</span>
										<span className="sm:hidden">Start</span>
									</button>
								</>
							)}
							{isOwner && pres.status === "live" && (
								<>
									<button
										type="button"
										className="btn-secondary text-sm border-error text-error hover:bg-error/10"
										onClick={handleEnd}
									>
										End
									</button>
								</>
							)}
							{isOwner && pres.status === "ended" && (
								<>
									<button
										type="button"
										className="btn-secondary text-sm flex items-center gap-1.5"
										onClick={() => go({ page: "edit", id: pres.id })}
										title="Edit presentation"
									>
										<Pencil size={14} />
										<span className="hidden sm:inline">Edit</span>
									</button>
									<button
										type="button"
										className="btn-primary text-sm"
										onClick={handleStart}
									>
										Restart
									</button>
								</>
							)}
						</div>
					</div>

					{/* Join code row — visible below xl (where the cluster above is hidden). */}
					<ShareCluster
						variant="compact"
						className="xl:hidden px-4 pb-2 flex"
						controls={shareControls}
					/>
				</header>

				{/* QR Code overlay */}
				{showQr && (
					// Overlay backdrop — a click anywhere outside the panel closes it.
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-void/80 backdrop-blur-sm"
						onClick={() => setShowQr(false)}
					>
						{/* Stops content clicks from reaching the backdrop's dismiss handler. */}
						<div
							className="bg-surface-raised border border-border rounded-2xl p-8 flex flex-col items-center gap-4 shadow-lg max-w-sm mx-4 slide-in"
							onClick={(e) => e.stopPropagation()}
						>
							<h3 className="text-lg font-semibold">Scan to Join</h3>
							<p className="text-sm text-text-muted text-center">
								Point your phone camera at the QR code
							</p>
							<div className="bg-white rounded-xl p-3">
								<QRCodeDisplay
									url={`${window.location.origin}/join/${pres.code}`}
									size={220}
								/>
							</div>
							<div className="flex items-center gap-2 text-text-muted text-sm">
								<span>or go to</span>
								<span className="font-mono text-accent-text">
									{window.location.host}/join/{pres.code}
								</span>
							</div>
							<button
								type="button"
								className="btn-secondary text-sm mt-2"
								onClick={() => setShowQr(false)}
							>
								Close
							</button>
						</div>
					</div>
				)}

				{/* Main content area */}
				<div className="flex-1 flex flex-col md:flex-row">
					{/* Slide navigation sidebar */}
					<nav className="md:w-56 flex-shrink-0 border-b md:border-b-0 md:border-r border-border bg-surface/50 overflow-x-auto md:overflow-y-auto p-2 md:p-3 flex md:flex-col gap-2 md:space-y-0">
						{pres.slides.map((slide, i) => (
							<SlideRailItem
								key={slide.id}
								index={i}
								type={slide.type}
								title={slide.question}
								active={i === pres.activeSlideIndex}
								disabled={!isOwner}
								className={`md:w-full ${isOwner ? "" : "cursor-default opacity-80"}`}
								onClick={() => isOwner && handleSlide(i)}
							/>
						))}
					</nav>

					{/* Active slide + results */}
					<main className="flex-1 flex items-center justify-center p-4 sm:p-8 relative">
						{/* The slide's own appearance over the deck's theme (REQ087),
						    wrapping what is drawn behind the slide as well as the slide
						    itself so the scrim and the words on it are given one answer.
						    Generates no box, so this changes no layout. */}
						<SlideAppearanceScope deck={pres} slide={activeSlide ?? {}}>
							{activeSlide && <SlideBackground slide={activeSlide} />}
							{/* The room's reactions, over the slide they are aimed at (REQ077).
							    This is the screen the room is looking at, so it is the screen a
							    reaction is *for* — and the reason the participant surface draws
							    them too is that a phone which showed nothing back would leave
							    the sender wondering whether the tap did anything.
							    Pointer-transparent, so a burst never eats a reveal click. */}
							<ReactionStream reactions={liveReactions} />
							{activeSlide ? (
								<div
									className={`w-full relative z-10 ${
										activeSlide.type === "open-text" ? "max-w-6xl" : "max-w-3xl"
									}`}
								>
									<PresenterSlideView
										slide={activeSlide}
										pres={pres}
										results={slideResults}
										serverClockOffsetMs={serverClockOffsetMs}
										joinUrl={`${window.location.origin}/join/${pres.code}`}
										controls={{
											canControl: isOwner,
											onReveal: (slideId, reveal) =>
												revealResults(pres.id, slideId, reveal),
											onRestartTimer: handleRestartTimer,
											onSetParticipation: handleSetParticipation,
											onDeleteAnswer: handleDeleteAnswer,
										}}
									/>

									{slideNavigation}
								</div>
							) : (
								<div className="text-text-dim">No slides</div>
							)}
						</SlideAppearanceScope>
					</main>

					{/* The presenter's notes for the slide on screen (REQ090), beside it
					    rather than over it (ADR-0031): a cue is read while the room is
					    still looking at the question, so a panel that covered the slide
					    would make reading one cost the other.

					    Rendered only for a viewer who holds the deck, and that is not the
					    thing keeping the notes private — the server empties them for
					    everybody else, so a spectator's copy of this deck has nothing in
					    the field to draw. What the gate here buys is an honest panel: a
					    spectator would be shown an empty one and told the slide has no
					    notes, which is a claim about the deck this screen cannot make. */}
					{isOwner && notesOpen && activeSlide && (
						<aside className="md:w-72 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4">
							<PresenterNotesPanel slide={activeSlide} />
						</aside>
					)}

					{/* What the accounts this deck is shared with have said about the
					    slide on screen (REQ074), beside it rather than over it for the
					    reason the notes are: a comment is written while looking at the
					    slide it is about.

					    Gated on the caller's own standing rather than on `isOwner`,
					    which is the difference this panel exists for: an account holding
					    `view` or `comment` reads the thread here, and a `comment` grant
					    writes on it, while the holder of the deck's edit token — who is
					    an editor by every other measure on this screen — reads nothing,
					    because the server refuses a credential with no account behind it
					    and the panel says so in the server's own words. */}
					{commentsOpen && canReadComments && (
						<aside className="md:w-80 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4 flex flex-col gap-4">
							<h3 className="flex items-center gap-2 text-base font-semibold">
								<MessageSquare size={17} />
								Comments
							</h3>
							<p className="text-xs text-text-dim">
								On slide {pres.activeSlideIndex + 1}. Only the accounts this
								deck is shared with — never the room.
							</p>
							<SlideCommentsPanel
								comments={comments}
								slideId={activeSlide?.id ?? null}
								accessLevel={pres.commentAccess}
								error={commentsError}
								loading={commentsLoading}
								onSubmit={addComment}
								onDelete={removeComment}
							/>
						</aside>
					)}

					{/* The Q&A queue and the switches that govern it (REQ036/REQ037/
					    REQ060), beside the slide rather than over it: a presenter works
					    the queue while the room is still looking at the question on
					    screen, and a panel that covered it would make reading one cost
					    the other.

					    The layer's two controls sit inside this panel, on the list they
					    govern (ADR-0031) — turning Q&A on and deciding who reads it are
					    changes to *this*, not to the deck's chrome. Both are offered
					    whether or not the layer is on, so the question of where the
					    questions will go is settled before the first one arrives. */}
					{isOwner && qaOpen && (
						<aside className="md:w-80 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4 flex flex-col gap-4">
							<QAHeading labels={QA_LABELS_EN} list={qaList} />
							<QALayerControls
								enabled={pres.qaEnabled}
								visibility={pres.qaVisibility}
								onChange={handleQASettings}
							/>
							<div className="border-t border-border pt-4">
								<QAQuestionList
									list={qaList}
									labels={QA_LABELS_EN}
									onToggleAnswered={handleQuestionAnswered}
								/>
							</div>
						</aside>
					)}

					{/* The audience panel (REQ077/REQ078), beside the slide rather than
					    over it for the reason the Q&A queue is: a presenter reads the
					    room while the room is still looking at the question.

					    Both channel switches sit at the top of it, on what they govern
					    (ADR-0031). The reaction one is here rather than beside the
					    reaction overlay because that overlay is the whole slide — there
					    is no region to put a control next to — and the two switches
					    answer the same question anyway: what may this room send besides
					    answers?

					    The transcript below them is the same feed every phone reads. It
					    stays readable with the channel closed, and only the composer
					    goes dead, saying why (ADR-0025). */}
					{isOwner && audienceOpen && (
						<aside className="md:w-80 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4 flex flex-col gap-4">
							<h3 className="flex items-center gap-2 text-base font-semibold">
								<Users size={17} />
								Audience
							</h3>
							<div className="flex flex-col gap-3">
								<ReactionChannelControl
									enabled={pres.reactionsEnabled}
									onChange={(reactionsEnabled) =>
										handleChannelSettings({ reactionsEnabled })
									}
								/>
								<ChatChannelControl
									enabled={pres.chatEnabled}
									onChange={(chatEnabled) =>
										handleChannelSettings({ chatEnabled })
									}
								/>
								<p className="text-xs text-text-dim">
									{`${REACTION_LABELS_EN.title} are broadcast and never stored, so they count towards nothing and appear in no export. Chat messages are kept with the session and cleared when you reset it.`}
								</p>
							</div>
							<div className="border-t border-border pt-4 flex flex-col gap-3">
								<ChatHeading labels={CHAT_LABELS_EN} feed={chatFeed} />
								<ChatMessageList feed={chatFeed} labels={CHAT_LABELS_EN} />
								<ChatComposer
									labels={CHAT_LABELS_EN}
									onSend={handleSendMessage}
									busy={sendingMessage}
									closed={chatFeed ? !chatFeed.enabled : false}
								/>
							</div>
						</aside>
					)}

					{/* Who took part, by name (REQ076) — beside the slide like every other
					    panel here, and closed until asked for like every other one too.

					    The names themselves never reach a participant's phone and never
					    ride a broadcast: this panel is fed by its own credentialed read of
					    an endpoint gated on editing the deck, which is why a spectator's
					    browser is not even asked to fetch it. */}
					{isOwner && rosterOpen && (
						<aside className="md:w-80 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4 flex flex-col gap-4">
							<div>
								<h3 className="flex items-center gap-2 text-base font-semibold">
									<UserRound size={17} />
									{participantRosterHeading(roster)}
								</h3>
								<p className="text-xs text-text-dim">
									Only you — the room never sees this list.
								</p>
							</div>
							<ParticipantRosterPanel
								roster={roster}
								requiresName={pres.requireParticipantName}
							/>
						</aside>
					)}
				</div>
			</div>

			{/* REQ098 — minting, copying and revoking the deck's read-only results
			    link, in one dialog behind the chip above. */}
			{resultsLinkOpen && (
				<ResultsLinkDialog
					presentationId={pres.id}
					onClose={() => setResultsLinkOpen(false)}
					onNotify={addToast}
				/>
			)}

			{/* REQ095/REQ096 — every shape the session leaves in, behind the chip
			    above. The dialog owns the download and the toast, so the page holds
			    nothing but whether it is open. */}
			{exportOpen && (
				<ExportDialog
					presentationId={pres.id}
					onClose={() => setExportOpen(false)}
				/>
			)}

			<ConfirmModal
				open={confirmShareEdit}
				title="Share with edit permissions"
				message="Anyone with this link can edit, reset, start, or end this presentation. Only share it with people you trust."
				confirmLabel="Copy edit link"
				onConfirm={copyEditLink}
				onCancel={() => setConfirmShareEdit(false)}
			/>

			{/* REQ101 — what a reset actually costs, spelled out before it happens.
			    The export sitting next to it is the answer to "can I keep this?",
			    so the prompt names it rather than leaving the organizer to
			    discover afterwards that it was the way out. */}
			<ConfirmModal
				open={confirmReset}
				title="Clear the results"
				message="Every response, upvote, Q&A question and chat message from this session is deleted, and the deck returns to draft so it can be run again. This cannot be undone — export the results first if you need them."
				confirmLabel="Clear results"
				variant="danger"
				onConfirm={handleReset}
				onCancel={() => setConfirmReset(false)}
			/>
		</div>,
	);
}
