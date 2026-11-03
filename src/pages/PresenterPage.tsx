import {
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Download,
	GalleryHorizontalEnd,
	Link2,
	type LucideIcon,
	MessageCircleQuestion,
	MessageSquare,
	MessagesSquare,
	Monitor,
	MonitorOff,
	PanelRight,
	Pencil,
	RefreshCw,
	StickyNote,
	UserRound,
	Users,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
	closedAtStartNotice,
	sharedScreenView,
	SlideParticipationControl,
	slideParticipationToast,
} from "../components/LiveRoom";
import { DeckThemeScope } from "../components/DeckTheme";
import { ExportDialog, exportButtonLabel } from "../components/ExportDialog";
import {
	PresenterSlideView,
	presenterSlideWidthClass,
} from "../components/PresenterSlideView";
import {
	ParticipantRosterPanel,
	participantRosterHeading,
	useParticipantRoster,
} from "../components/ParticipantName";
import { PreviewLink } from "../components/PreviewLink";
import {
	QuizAudioCueControl,
	useQuizAudioCue,
} from "../components/QuizAudioCue";
import { ResultsLinkDialog } from "../components/ResultsLinkDialog";
import { SessionClock, sessionElapsedMs } from "../components/SessionClock";
import {
	BAR_CONTROL_HEIGHT,
	BAR_CONTROL_SIZE,
	BAR_GROUP,
	BAR_GROUP_ITEM,
	BAR_GROUP_ITEM_PRIMARY,
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
import { AppMenu } from "../components/ui/AppMenu";
import {
	BarMenu,
	BarMenuRow,
	disabledReason,
	MENU_DIVIDER,
} from "../components/ui/BarMenu";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { LoadingState } from "../components/ui/Loading";
import { QRCodeDisplay } from "../components/ui/QRCode";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useToast } from "../components/ui/Toast";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import { useSessionSocket, useStore } from "../store";
import type { CountdownAction } from "../types";
import {
	audienceViewBlanked,
	callerCanEditDeck,
	canReadDeckComments,
	slideAcceptsSubmissions,
	slideHasResults,
	steppedSlideIndex,
} from "../types";

// ── Presenter Page ────────────────────────────────────────────

/** One panel beside the slide, as the top bar offers it (REQ190). */
type PanelToggle = {
	key: string;
	Icon: LucideIcon;
	/** Visible text of its row in the Panels menu. */
	label: string;
	ariaLabel: string;
	pressed: boolean;
	disabled: boolean;
	/** `null` for a panel with nothing to count; "—" for nothing to report. */
	count: number | string | null;
	onToggle: () => void;
};

const BAR_COUNT = "font-mono text-xs tabular-nums";

/**
 * A panel's count: plain for a positive number, muted for `0` and "—", and
 * the pressed item's own accent text while its panel is open. Muted, not dim:
 * at 12px the count needs 4.5:1 in both themes (WCAG 1.4.3), and `text-dim`
 * reaches 3.5:1.
 */
export function panelCountTone(toggle: Pick<PanelToggle, "pressed" | "count">): string {
	return toggle.pressed
		? ""
		: typeof toggle.count === "number" && toggle.count > 0
			? "text-text"
			: "text-text-muted";
}

function PanelCount({ toggle }: { toggle: PanelToggle }) {
	const tone = panelCountTone(toggle);
	return (
		toggle.count !== null && (
			<span className={`${BAR_COUNT} ${tone}`}>{toggle.count}</span>
		)
	);
}

/**
 * Below `sm` the open panels stack in one sheet above the dock (REQ199), so a
 * panel opened while another is open would open out of sight below it. As its
 * ref, this scrolls a panel into the sheet's view when it is drawn; from `sm`
 * the panels lay out beside the slide and nothing is scrolled.
 */
function revealInPanelSheet(panel: HTMLElement | null) {
	if (panel && window.matchMedia("(width < 40rem)").matches) {
		panel.scrollIntoView({ block: "nearest" });
	}
}

/** One paging direction of the presenter's deck (REQ199, REQ110). */
export interface SlidePagingDirection {
	/** The slide it lands on, or `null` when it is shut. */
	index: number | null;
	disabled: boolean;
	label: string;
}

/**
 * Whether each paging direction is open, where it lands and what it is called
 * (REQ199) — held once for every place that pages: the in-slide row and the
 * phone dock's Slides group. `refusal` shuts both, with the reason in the name.
 *
 * Skipped slides are stepped over (REQ110): each direction lands on the nearest
 * slide that is not skipped, and is shut — as it is at the deck's ends — when
 * only skipped slides lie that way. The label counts every slide, skipped or
 * not, so "slide 4 of 6" is the same 4 the rail shows.
 */
export function slidePagingFor({
	slides,
	activeSlideIndex,
	refusal,
}: {
	slides: readonly { skipped?: boolean | undefined }[];
	activeSlideIndex: number;
	refusal: string | null;
}): { previous: SlidePagingDirection; next: SlidePagingDirection } {
	const slideCount = slides.length;
	const previousIndex = steppedSlideIndex(slides, activeSlideIndex, -1);
	const nextIndex = steppedSlideIndex(slides, activeSlideIndex, 1);
	return {
		previous: {
			index: previousIndex,
			disabled: refusal !== null || previousIndex === null,
			label: `Previous slide — ${
				refusal ??
				(previousIndex === null
					? activeSlideIndex <= 0
						? "this is the first slide"
						: "every earlier slide is skipped"
					: `slide ${previousIndex + 1} of ${slideCount}`)
			}`,
		},
		next: {
			index: nextIndex,
			disabled: refusal !== null || nextIndex === null,
			label: `Next slide — ${
				refusal ??
				(nextIndex === null
					? activeSlideIndex >= slideCount - 1
						? "this is the last slide"
						: "every later slide is skipped"
					: `slide ${nextIndex + 1} of ${slideCount}`)
			}`,
		},
	};
}

/** Where focus goes as the phone's panel sheet closes (REQ199). */
export type PanelSheetFocus = "dock" | "stay";

/** Input types a key acts on as on a button: nothing is being typed into them. */
const UNTYPED_INPUT_TYPES = ["checkbox", "radio", "button", "submit", "range"];

/**
 * Whether a key press is the field's rather than the page's (REQ199): an IME
 * is composing, or the key went to a text input, a textarea, a select or
 * editable content. Space types a space there, the arrows move the caret and
 * Escape is the field's own, so the presenter's shortcuts leave it alone.
 */
export function keyBelongsToField({
	isComposing,
	target,
}: {
	isComposing: boolean;
	target: EventTarget | null;
}): boolean {
	if (isComposing) return true;
	const element = target as {
		tagName?: string;
		type?: string;
		isContentEditable?: boolean;
	} | null;
	const tagName = element?.tagName?.toLowerCase();
	if (tagName === "input") {
		return !UNTYPED_INPUT_TYPES.includes(element?.type ?? "text");
	}
	return (
		tagName === "textarea" || tagName === "select" || element?.isContentEditable === true
	);
}

/**
 * What Escape does to the phone's panel sheet (REQ199). The sheet covers the
 * lower part of the page, so a control tabbed to there can sit wholly behind
 * it (WCAG 2.4.11); Escape takes the sheet down and leaves focus on that
 * control. Pressed inside the sheet it hands focus to the dock's Panels
 * trigger instead, as the sheet's own close does, since what held focus goes
 * with the sheet. `null` when the sheet is not up, or when the Escape is
 * already somebody else's — a menu that answered it, an open dialog, an IME
 * that is composing, or a field inside the sheet, which is never covered by
 * it and would lose its draft with it. A field behind the sheet still takes
 * it down: that is the covered control the Escape is for.
 */
export function panelSheetEscape({
	sheetShown,
	answered,
	focusInSheet,
	composing,
	inField,
}: {
	sheetShown: boolean;
	answered: boolean;
	focusInSheet: boolean;
	composing: boolean;
	inField: boolean;
}): PanelSheetFocus | null {
	// One expression rather than an early `return null`: a top-level one in a
	// routed page reads to REQ183's guard as a page that renders nothing.
	const ownsEscape =
		sheetShown && !answered && !composing && !(inField && focusInSheet);
	return ownsEscape ? (focusInSheet ? "dock" : "stay") : null;
}

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
	const controlCountdown = useStore((state) => state.controlCountdown);
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
	/** What opened the QR overlay, so closing it hands focus back (REQ191). */
	const qrOpenerRef = useRef<HTMLElement | null>(null);
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
	// The dock's Panels group, where focus goes when the phone's panel sheet is
	// closed from the sheet (REQ199).
	const phonePanelsRef = useRef<HTMLDivElement>(null);
	// The phone's panel sheet, and the way to take it down, for the window's
	// Escape (REQ199): the page's keydown handler is bound before the panels'
	// descriptor exists, so it reaches `hidePanels` through here.
	const panelSheetRef = useRef<HTMLDivElement>(null);
	const hidePanelsRef = useRef<(focus: PanelSheetFocus) => void>(() => {});
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

	// REQ058 — the audio cue of the quiz question on screen, played by this page
	// and by no other surface, for as long as the room can answer. Only a screen
	// that runs the deck makes a sound: a spectator holding the authored deck is
	// told the cue plays on the presenter's screen instead. Called here rather
	// than beside the slide so it keeps time while the screen is blanked
	// (REQ109), which stops nothing — the question's window included.
	const audioCue = useQuizAudioCue({
		slide: pres ? pres.slides[pres.activeSlideIndex] : null,
		deck: pres,
		clockOffsetMs: serverClockOffsetMs,
		canPlay: isOwner,
	});

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
			// Start keeps the closed slides (REQ111), so a slide closed on the
			// draft — or by the last session — refuses the room until reopened.
			const startsClosed = pres ? closedAtStartNotice(pres) : null;
			if (startsClosed) addToast(startsClosed, "info");
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
	 * Start, pause or reset the countdown on screen (REQ107). No toast: the clock
	 * itself moving, freezing or going back to its full length is the confirmation.
	 */
	const handleSetCountdown = async (slideId: string, action: CountdownAction) => {
		try {
			await controlCountdown(id, slideId, action);
		} catch (countdownError: unknown) {
			setError(
				countdownError instanceof Error
					? countdownError.message
					: "Unknown error",
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
	 * confirmed, irreversible gesture Reset is. On a deck that is not live the
	 * same switch decides whether the slide goes live closed (REQ198), and the
	 * toast says that instead.
	 */
	const handleSetParticipation = async (slideId: string, open: boolean) => {
		try {
			await setSlideParticipation(id, slideId, open);
			addToast(
				slideParticipationToast({ open, live: pres?.status === "live" }),
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
		approvalRequired?: boolean;
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

	/** Let a question awaiting approval through to the room (REQ038). */
	const handleQuestionApproved = async (questionId: string) => {
		try {
			await api.approveQuestion(id, questionId);
		} catch (approveError: unknown) {
			setError(
				approveError instanceof Error ? approveError.message : "Unknown error",
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

	/**
	 * Put the room-sized QR code up (REQ191), remembering what opened it, and
	 * take it down again with focus handed back there. The backdrop, Close and
	 * every paging key all close it through `closeQr`.
	 */
	const openQr = () => {
		qrOpenerRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setShowQr(true);
	};
	const closeQr = () => {
		setShowQr(false);
		qrOpenerRef.current?.focus();
	};

	// Keyboard shortcuts for slide navigation — only when the viewer owns
	// the presentation (the server would 401 the underlying setSlide call
	// otherwise).
	// `handleSlide` is redefined on every render, so listing it would give this
	// callback a new identity every render and re-subscribe the window keydown
	// listener each time. The list tracks the `pres?.*` fields the shortcuts
	// branch on instead of the whole object — `pres?.slides` among them, since
	// which slides are skipped decides where a key lands (REQ110).
	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			// While the QR code is up, Esc or a clicker press takes it down and
			// never pages the deck behind it (REQ191) — whoever is viewing.
			if (showQr) {
				if (
					["Escape", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", " "].includes(
						e.key,
					)
				) {
					e.preventDefault();
					closeQr();
				}
				return;
			}
			// Below `sm`, Escape takes down the panel sheet that may be covering
			// the focused control (REQ199). The sheet is up when its wrapper is
			// the fixed box it only is below `sm` and holds a panel; a menu that
			// answered this Escape marks it handled, and a dialog owns it. An
			// Escape typed in a field inside the sheet is the field's.
			if (e.key === "Escape") {
				const sheet = panelSheetRef.current;
				const focus = panelSheetEscape({
					sheetShown:
						sheet !== null &&
						getComputedStyle(sheet).position === "fixed" &&
						sheet.querySelector("aside") !== null,
					answered:
						e.defaultPrevented ||
						confirmShareEdit ||
						confirmReset ||
						exportOpen ||
						resultsLinkOpen,
					focusInSheet: sheet?.contains(document.activeElement) ?? false,
					composing: e.isComposing,
					inField: keyBelongsToField({ isComposing: false, target: e.target }),
				});
				if (focus) {
					e.preventDefault();
					hidePanelsRef.current(focus);
					return;
				}
			}
			// Space and the arrows typed into a field — the chat, a note — type
			// and move the caret there; they never page the deck behind it.
			if (keyBelongsToField(e)) return;
			if (!pres || pres.status !== "live" || !isOwner) return;
			// Skipped slides are stepped over (REQ110), exactly as the buttons do.
			if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
				e.preventDefault();
				const nextIndex = steppedSlideIndex(pres.slides, pres.activeSlideIndex, 1);
				if (nextIndex !== null) handleSlide(nextIndex);
			}
			if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
				e.preventDefault();
				const previousIndex = steppedSlideIndex(
					pres.slides,
					pres.activeSlideIndex,
					-1,
				);
				if (previousIndex !== null) handleSlide(previousIndex);
			}
		},
		[
			pres?.id,
			pres?.activeSlideIndex,
			pres?.slides,
			pres?.status,
			isOwner,
			showQr,
			confirmShareEdit,
			confirmReset,
			exportOpen,
			resultsLinkOpen,
		],
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
				<div className="absolute top-4 right-4 z-20">
					<AppMenu />
				</div>
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
	// Spelled out for the same reason the Q&A counter below is: the accessible
	// name is what a screen reader announces in place of the Deck menu's short
	// row text, and "Export" on its own says nothing about what leaves the building
	// (REQ095/REQ096) or what a reset costs (REQ101). The export's own name is
	// `exportButtonLabel` in `ExportDialog`, beside the formats it opens onto —
	// what the control is called is part of what the affordance is.
	const exportControlLabel = exportButtonLabel(isOwner);

	// REQ098 — the read-only results link. Offered whatever the deck's status, for
	// the reason the export beside it is: a link minted mid-session is a
	// legitimate thing to hand somebody, and a survey deck collects answers while
	// it is still a draft. Disabled with its reason for a viewer who does not hold
	// the deck — minting one is a decision about somebody else's
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
	// dropped.
	const audienceButtonLabel = !isOwner
		? "Show the audience panel — you cannot edit this presentation, so its channels are not yours to open"
		: audienceOpen
			? "Hide the audience panel"
			: pres.chatEnabled
				? `Show the audience panel — ${chatCountLabel(chatFeed)}`
				: "Show the audience panel — the chat is currently off";

	// REQ090 — the notes for the slide on screen. Offered to a viewer who does
	// not hold the deck too, disabled with its reason rather than dropped:
	// what they are missing is the organizer's private script, and
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
					// visible chip's "—" refuses to claim. The two have to say
					// the same thing; a screen-reader user is not reading the number.
					"Show who took part — the names stated on this deck";

	const commentsButtonLabel = !canReadComments
		? "Show comments — this deck has not been shared with your account, so its comments are not yours to read"
		: commentsOpen
			? "Hide comments"
			: `Show comments — ${slideCommentCount} on this slide`;

	/**
	 * REQ199 — whether each paging direction is open, and what it is called
	 * (see {@link slidePagingFor}). A viewer who may not move the deck, and a
	 * deck that is not live, get both directions shut with the reason in the
	 * name, so the dock keeps its shape rather than dropping the pair.
	 */
	const pagingRefusal = !isOwner
		? "you cannot edit this presentation, so its slides are not yours to move"
		: pres.status === "draft"
			? "start the presentation to page through it"
			: pres.status === "ended"
				? "the session has ended; restart it to page through it"
				: null;
	const slidePaging = slidePagingFor({
		slides: pres.slides,
		activeSlideIndex: pres.activeSlideIndex,
		refusal: pagingRefusal,
	});
	const pageTo = (target: number | null) => {
		if (target !== null) handleSlide(target);
	};

	/**
	 * Paging through the deck — gated on ownership; a spectator gets the
	 * read-only view.
	 *
	 * Lifted out of the slide because the blanked screen (REQ109) draws it too:
	 * the whole point of a blank that survives navigation is that the presenter
	 * lines the next slide up behind it, which a curtain with no Next button
	 * cannot do. One definition rather than two, so the two states cannot come to
	 * page through the deck differently. It names a *position* and
	 * never a question, which is what lets it stay on a blanked screen.
	 */
	const slideNavigation = pres.status === "live" && isOwner && (
		<div className="flex w-full items-center justify-between mt-8">
			<button
				type="button"
				className="btn-secondary flex items-center gap-2"
				disabled={slidePaging.previous.disabled}
				aria-label={slidePaging.previous.label}
				title={slidePaging.previous.label}
				onClick={() => pageTo(slidePaging.previous.index)}
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
				disabled={slidePaging.next.disabled}
				aria-label={slidePaging.next.label}
				title={slidePaging.next.label}
				onClick={() => pageTo(slidePaging.next.index)}
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
	 * in front of the room first. So does its audio cue's (REQ058): a blank stops
	 * nothing, the cue included, and talking over a question is when a presenter
	 * reaches for the mute. A spectator gets the curtain with none of them.
	 */
	if (sharedScreenView(pres) === "blank") {
		return themed(
			<div className="min-h-screen w-full bg-void bg-grid bg-noise flex flex-col">
				{/* The theme switch and the legal texts (REQ183): a control, and
				    one that shows nothing of the deck, so it stays. */}
				<div className="absolute top-4 right-4 z-20">
					<AppMenu />
				</div>
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
											live={pres.status === "live"}
											onChange={(open) =>
												handleSetParticipation(activeSlide.id, open)
											}
										/>
									)}
									{audioCue && <QuizAudioCueControl cue={audioCue} />}
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
		host: window.location.host,
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
		onShowQr: openQr,
		onCopyEmbed: copyEmbed,
		onShareEdit: () => setConfirmShareEdit(true),
	});

	// REQ190 — the five panels beside the slide, as one descriptor: drawn as a
	// group of chips from `sm` and as the rows of one menu below it, so the two
	// cannot come to disagree about what a panel is called or who may open it.
	// Each is offered to a viewer who does not hold the deck too, disabled with
	// its reason rather than dropped, and they stay independent: several may be
	// open at once.
	const panelToggles: PanelToggle[] = [
		{
			// The Q&A queue (REQ036/REQ060). The count is what is still open, the
			// number a presenter is actually watching. A viewer who does not hold the
			// deck gets "—" rather than their own fetch's count: it answers with their
			// own questions rather than the room's (REQ037), so a number there would
			// be a truthful number about the wrong list, and a `0` would claim an empty
			// queue.
			key: "qa",
			Icon: MessageCircleQuestion,
			label: "Q&A",
			ariaLabel: qaButtonLabel,
			pressed: qaOpen,
			disabled: !isOwner,
			count: isOwner ? (qaList?.openCount ?? 0) : "—",
			onToggle: () => setQaOpen((open) => !open),
		},
		{
			// The audience panel (REQ077/REQ078): the two participant channels and the
			// chat transcript. A chat has one projection, so every reader of this deck
			// reads the same feed and the count is the same list for all of them.
			key: "audience",
			Icon: MessagesSquare,
			label: "Audience",
			ariaLabel: audienceButtonLabel,
			pressed: audienceOpen,
			disabled: !isOwner,
			count: chatFeed?.messageCount ?? 0,
			onToggle: () => setAudienceOpen((open) => !open),
		},
		{
			// The presenter's own notes (REQ090). No count: what a note says is the
			// whole of it, so a number would only announce that there is one.
			key: "notes",
			Icon: StickyNote,
			label: "Presenter notes",
			ariaLabel: notesButtonLabel,
			pressed: notesOpen,
			disabled: !isOwner,
			count: null,
			onToggle: () => setNotesOpen((open) => !open),
		},
		{
			// The slide's comment thread (REQ074) — the one door a `view` or `comment`
			// collaborator has to it, so it follows `canReadComments` rather than edit
			// access. "—" rather than `0` for a viewer with no account on the deck: a
			// zero would claim an empty thread they were never sent.
			key: "comments",
			Icon: MessageSquare,
			label: "Comments",
			ariaLabel: commentsButtonLabel,
			pressed: commentsOpen,
			disabled: !canReadComments,
			count: canReadComments ? slideCommentCount : "—",
			onToggle: () => setCommentsOpen((open) => !open),
		},
		{
			// Who took part, by name (REQ076). The roster is only fetched while the
			// panel is open, so a closed one reads "—": a `0` would claim an empty room
			// on a deck this browser has not asked about.
			key: "roster",
			Icon: UserRound,
			label: "Who took part",
			ariaLabel: rosterButtonLabel,
			pressed: rosterOpen,
			disabled: !isOwner,
			count: roster ? roster.length : "—",
			onToggle: () => setRosterOpen((open) => !open),
		},
	];
	const openPanelCount = panelToggles.filter((toggle) => toggle.pressed).length;

	// Closes every open panel from the phone's sheet (REQ199). From the sheet's
	// close, and from an Escape pressed inside the sheet, focus goes to the
	// dock's Panels trigger, where panels are opened, rather than dropping on the
	// page as the sheet goes; from an Escape elsewhere it stays on the control
	// the sheet was covering (`panelSheetEscape`).
	const hidePanels = (focus: PanelSheetFocus) => {
		for (const toggle of panelToggles) {
			if (toggle.pressed) toggle.onToggle();
		}
		if (focus === "dock") phonePanelsRef.current?.querySelector("button")?.focus();
	};
	hidePanelsRef.current = hidePanels;

	// The Deck menu's first row: the editor, for whoever may edit a deck that is
	// not running — exactly who saw the Edit button before REQ190.
	const deckEditable =
		isOwner && (pres.status === "draft" || pres.status === "ended");
	// What the Deck rows offer, named once for the two triggers that open them:
	// the Deck menu from `sm`, and More below it, where `AppMenu` adds its own
	// sections to the name (REQ199).
	const deckMenuOffers = `${deckEditable ? "edit, " : ""}preview, share results, export, reset`;
	const deckMenuLabel = `Deck — ${deckMenuOffers}`;

	/**
	 * Everything about the deck that is not its lifecycle, as rows: drawn by the
	 * Deck menu from `sm` and at the head of the phone's More menu below it
	 * (REQ199), one definition so the two cannot come to differ. Each row is
	 * offered whatever the deck's status — a preview writes nothing (REQ103),
	 * an export of a running session is a legitimate snapshot (REQ095/REQ096),
	 * a results link minted mid-session is a thing to hand somebody (REQ098),
	 * and a survey deck collects answers while it is still a draft, so no status
	 * is reliably "nothing to reset" (REQ101) — and disabled with its reason,
	 * spelled out under it, for a viewer who does not hold the deck. A row that
	 * hands off to a dialog or a page closes the menu first.
	 */
	const deckMenuRows = (close: () => void) => (
		<>
			{deckEditable && (
				<>
					<BarMenuRow
						icon={<Pencil size={16} />}
						label="Edit presentation"
						title="Edit presentation"
						onClick={() => {
							close();
							go({ page: "edit", id: pres.id });
						}}
					/>
					<div aria-hidden className={MENU_DIVIDER} />
				</>
			)}
			<PreviewLink
				variant="menu-row"
				presentationId={pres.id}
				go={(route) => {
					close();
					go(route);
				}}
				canPreview={isOwner}
			/>
			<div aria-hidden className={MENU_DIVIDER} />
			<BarMenuRow
				icon={<Link2 size={16} />}
				label="Share results…"
				reason={disabledReason(resultsLinkButtonLabel)}
				disabled={!isOwner}
				ariaLabel={resultsLinkButtonLabel}
				title={resultsLinkButtonLabel}
				onClick={() => {
					close();
					setResultsLinkOpen(true);
				}}
			/>
			<BarMenuRow
				icon={<Download size={16} />}
				label="Export…"
				reason={disabledReason(exportControlLabel)}
				disabled={!isOwner}
				ariaLabel={exportControlLabel}
				title={exportControlLabel}
				onClick={() => {
					close();
					setExportOpen(true);
				}}
			/>
			<div aria-hidden className={MENU_DIVIDER} />
			<BarMenuRow
				icon={<RefreshCw size={16} />}
				label="Reset results…"
				tone="danger"
				reason={disabledReason(resetButtonLabel)}
				disabled={!isOwner}
				ariaLabel={resetButtonLabel}
				title={resetButtonLabel}
				onClick={() => {
					close();
					setConfirmReset(true);
				}}
			/>
		</>
	);

	// The status line's separators sit between the items that are drawn, and the
	// clock is not drawn on a deck that has no session to time.
	const sessionClockShown = sessionElapsedMs(pres, Date.now()) !== null;
	const statusSeparator = (
		<span aria-hidden className="hidden sm:block size-[3px] rounded-full bg-text-dim" />
	);

	return themed(
		// The page's end scrolls clear of the phone dock (REQ199), whose height
		// `index.css` publishes while it is drawn.
		<div className="min-h-screen w-full bg-void bg-grid bg-noise flex flex-col pb-[var(--bottom-dock-height,0px)]">
			<div className="relative z-10 flex flex-col flex-1">
				{/* Top bar (REQ190) — three zones sorted by what each control is
				    for, and exactly one primary button. Identity is which deck this
				    is and how it is doing; the room console is how people get in,
				    what the projector shows and the panels the presenter reads;
				    command is running the deck. The zones keep that DOM order at
				    every width (so the tab order is REQ190's); what changes below
				    `xl` is where the console sits (REQ199), and every bordered or
				    filled control is one height per width — 44px below `sm`, 40px
				    to `xl` — through the shared tokens:
				    - From `xl`, one line, exactly as REQ190/REQ191 drew it.
				    - From `sm` to `xl`, a tablet on a lectern or a narrow laptop
				      window that may be mirrored to the room: two lines with two
				      shared edges — the door under the title, flush with Back, and
				      the screen and panel switches under the command zone, flush
				      with the app menu.
				    - Below `sm`, a phone used as a remote while the room screen
				      runs elsewhere: one line of Back, title, lifecycle and one More
				      menu, and the console docked to the bottom edge with paging,
				      in reach of the thumb holding the phone.
				    Nothing wraps or scrolls sideways at any width from 360px: the
				    title is the one thing that gives way, and everything about the
				    deck that is not its lifecycle is one tap deep in the Deck menu,
				    or in More on a phone.

				    The header's blur starts at `sm`: a `backdrop-filter` makes an
				    element the containing block of its `fixed` descendants, which
				    would pin the dock to the header rather than to the viewport. */}
				<header className="border-b border-border bg-surface/80 sm:backdrop-blur-sm">
					<div className="grid grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 sm:gap-x-3 xl:gap-x-6 gap-y-2 px-4 sm:px-6 py-2">
						{/* Identity zone */}
						<div className="col-start-1 row-start-1 flex items-center gap-1.5 sm:gap-3 min-w-0">
							<button
								type="button"
								className="flex min-h-9 items-center gap-1 text-sm text-text-muted hover:text-text transition-colors flex-shrink-0 max-sm:size-11 max-sm:justify-center max-sm:-ml-3.5 max-sm:-mr-1.5"
								onClick={() => go({ page: "home" })}
							>
								<ChevronLeft size={16} />
								<span className="hidden sm:inline">Back</span>
							</button>
							<div className="w-px h-7 bg-border hidden sm:block flex-shrink-0" />
							<div className="flex flex-col min-w-0">
								<h1 className="font-semibold truncate min-w-0" title={pres.title}>
									{pres.title}
								</h1>
								{/* Reading matter rather than buttons. Below `sm` it may
								    take a second line — an ended deck, a view-only
								    viewer, a session past an hour — rather than squeeze
								    the lifecycle button. */}
								<div className="flex sm:flex-nowrap max-sm:flex-wrap items-center gap-x-1.5 sm:gap-x-2 text-xs text-text-muted">
									<span className="flex flex-shrink-0">
										<StatusBadge status={pres.status} />
									</span>
									{/* REQ108 — how long this session has been running,
									    beside the status it measures. */}
									{sessionClockShown && statusSeparator}
									<SessionClock deck={pres} clockOffsetMs={serverClockOffsetMs} />
									{statusSeparator}
									<span
										className="inline-flex items-center gap-1 font-mono tabular-nums flex-shrink-0"
										title="Participants in the room"
									>
										<Users size={14} aria-hidden />
										<span className="sr-only">Participants: </span>
										{participantCount}
									</span>
								</div>
							</div>
						</div>

						{/* Room console */}
						{/* Below `sm` it is the phone's bottom dock (REQ199): the
						    same element, moved to the bottom edge by CSS rather than
						    drawn twice, so no control has a second copy to drift.
						    `data-bottom-dock` is what `index.css` reads to give the
						    page and the toasts room for it. It sits above the page
						    and below every menu, the QR dialog and the toasts. */}
						<div
							data-bottom-dock
							className="col-span-2 row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1 flex items-center gap-2 sm:gap-3 min-w-0 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:gap-1.5 max-sm:border-t max-sm:border-border max-sm:bg-surface/95 max-sm:backdrop-blur-sm max-sm:px-3 max-sm:pt-2 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]"
						>
							{/* The door: the join code, the QR code and every other way
							    in. Always drawn (REQ191): this screen is the projector,
							    so the door is the room's standing invitation rather than
							    a setting, and the one way to take it off the wall is the
							    blank, which takes everything else with it. */}
							<ShareCluster variant="menu" controls={shareControls} />

							{/* The one switch that takes the projected screen away.
							    Pressed means taken off, and the pressed state is the
							    room's rather than this browser's: a second browser
							    projecting the deck reads the same field off the same
							    broadcast. The blank (REQ109) governs the whole projected
							    view, so there is no sub-region to sit beside, and the
							    way back is drawn on the curtain itself.

							    From `sm` to `xl` it starts the second line's right
							    edge, so the door holds Back's edge and the switches hold
							    the app menu's (REQ199). */}
							<div role="group" aria-label="Shared screen" className={`${BAR_GROUP} sm:max-xl:ml-auto`}>
								<button
									type="button"
									onClick={() => handleSetBlanked(!screenBlanked)}
									disabled={!isOwner}
									aria-pressed={screenBlanked}
									aria-label={blankButtonLabel}
									title={blankButtonLabel}
									className={BAR_GROUP_ITEM}
								>
									{screenBlanked ? <MonitorOff size={16} /> : <Monitor size={16} />}
								</button>
							</div>

							{/* The panels beside the slide: chips from `sm`, one menu
							    in the phone's dock below it, where five chips would not
							    fit beside the door. None earns a place of its own on a
							    phone, and none is withdrawn either: Notes and the Q&A
							    queue are what a remote is for (REQ199). */}
							<div role="group" aria-label="Panels" className={`${BAR_GROUP} max-sm:hidden`}>
								{panelToggles.map((toggle) => (
									<button
										key={toggle.key}
										type="button"
										onClick={toggle.onToggle}
										disabled={toggle.disabled}
										aria-pressed={toggle.pressed}
										aria-label={toggle.ariaLabel}
										title={toggle.ariaLabel}
										className={BAR_GROUP_ITEM}
									>
										<toggle.Icon size={16} />
										<PanelCount toggle={toggle} />
									</button>
								))}
							</div>
							<div
								ref={phonePanelsRef}
								role="group"
								aria-label="Panels"
								className={`${BAR_GROUP} sm:hidden`}
							>
								<BarMenu
									label="Panels — Q&A, audience, notes, comments, who took part"
									title="Panels"
									heading="Panels"
									triggerClassName={BAR_GROUP_ITEM}
									trigger={
										<>
											<PanelRight size={16} aria-hidden />
											{openPanelCount > 0 && (
												<span className={`${BAR_COUNT} text-text`}>
													{openPanelCount}
												</span>
											)}
											<ChevronDown size={14} aria-hidden />
										</>
									}
								>
									{() =>
										panelToggles.map((toggle) => (
											<BarMenuRow
												key={toggle.key}
												icon={<toggle.Icon size={16} />}
												label={toggle.label}
												reason={disabledReason(toggle.ariaLabel)}
												disabled={toggle.disabled}
												pressed={toggle.pressed}
												ariaLabel={toggle.ariaLabel}
												title={toggle.ariaLabel}
												onClick={toggle.onToggle}
												trailing={
													<>
														<PanelCount toggle={toggle} />
														{toggle.pressed && <Check size={14} aria-hidden />}
													</>
												}
											/>
										))
									}
								</BarMenu>
							</div>

							{/* Paging, in the bar on a phone only (REQ199). Below
							    `sm` this screen is a remote in the presenter's hand,
							    paging is the one thing done over and over while
							    talking, and under a tall slide the in-slide row starts
							    below the fold — so it is docked here, in thumb reach,
							    and the in-slide row is not drawn. From `sm` the
							    screen may be the room's, paging stays on the keyboard
							    and under the slide, and this group is not drawn. The
							    pair is disabled rather than dropped when the deck
							    cannot be paged from here, so the dock keeps its
							    shape; Next carries the deck's one primary fill while
							    it can be pressed. */}
							<div role="group" aria-label="Slides" className={`${BAR_GROUP} ml-auto sm:hidden`}>
								<button
									type="button"
									onClick={() => pageTo(slidePaging.previous.index)}
									disabled={slidePaging.previous.disabled}
									aria-label={slidePaging.previous.label}
									title={slidePaging.previous.label}
									className={`${BAR_GROUP_ITEM} min-w-10!`}
								>
									<ChevronLeft size={18} aria-hidden />
								</button>
								<button
									type="button"
									onClick={() => pageTo(slidePaging.next.index)}
									disabled={slidePaging.next.disabled}
									aria-label={slidePaging.next.label}
									title={slidePaging.next.label}
									className={`${BAR_GROUP_ITEM_PRIMARY} min-w-10!`}
								>
									<ChevronRight size={18} aria-hidden />
								</button>
							</div>
						</div>

						{/* Command zone */}
						<div className="col-start-2 row-start-1 xl:col-start-3 flex items-center gap-1.5 sm:gap-2">
							{/* Everything about the deck that is not its lifecycle
							    (`deckMenuRows`). From `sm` only: below it the rows
							    lead the More menu instead (REQ199). */}
							<BarMenu
								label={deckMenuLabel}
								title="Deck"
								heading="Deck"
								triggerClassName={`flex ${BAR_CONTROL_HEIGHT} flex-shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-text cursor-pointer transition-colors hover:bg-surface-hover aria-expanded:border-accent aria-expanded:bg-accent-dim aria-expanded:text-accent-text max-sm:hidden`}
								trigger={
									<>
										<GalleryHorizontalEnd size={16} aria-hidden />
										<span>Deck</span>
										<ChevronDown size={14} aria-hidden className="text-text-dim" />
									</>
								}
							>
								{deckMenuRows}
							</BarMenu>

							{/* Lifecycle — the bar's one primary button, for a viewer
							    who may edit the deck: its owner, the holder of its edit
							    token, or an `edit` collaborator (REQ149). Everyone else
							    gets a read-only view; the server would reject mutation
							    calls with 401 anyway. */}
							{!isOwner && (
								<span
									className={`inline-flex ${BAR_CONTROL_HEIGHT} flex-shrink-0 items-center text-xs text-text-dim font-mono uppercase tracking-wider px-2 rounded bg-surface-raised border border-border`}
									title="You don't have edit access to this presentation"
								>
									View only
								</span>
							)}
							{isOwner && pres.status === "draft" && (
								<button
									type="button"
									className={`btn-primary text-sm ${BAR_CONTROL_HEIGHT} py-0! px-3! sm:px-4!`}
									onClick={handleStart}
								>
									<span className="hidden sm:inline">Start Presentation</span>
									<span className="sm:hidden">Start</span>
								</button>
							)}
							{isOwner && pres.status === "live" && (
								<button
									type="button"
									className={`btn-secondary text-sm ${BAR_CONTROL_HEIGHT} py-0! px-3! sm:px-4! border-error! text-error! hover:bg-error/10!`}
									onClick={handleEnd}
								>
									End
								</button>
							)}
							{isOwner && pres.status === "ended" && (
								<button
									type="button"
									className={`btn-primary text-sm ${BAR_CONTROL_HEIGHT} py-0! px-3! sm:px-4!`}
									onClick={handleStart}
								>
									Restart
								</button>
							)}

							{/* Theme switch and legal texts (REQ183), last in the bar.
							    From `sm` it stands beside the Deck trigger; below it,
							    where the two would be unlabelled menus side by side on
							    the narrowest row, one More menu carries the Deck rows
							    above the app menu's own sections, each under its
							    heading so its scope still reads (REQ199). */}
							<AppMenu className={`max-sm:hidden ${BAR_CONTROL_SIZE}`} />
							<AppMenu
								className={`sm:hidden ${BAR_CONTROL_SIZE}`}
								leading={{
									label: `More — ${deckMenuOffers}`,
									title: "More",
									heading: "Deck",
									rows: deckMenuRows,
								}}
							/>
						</div>
					</div>
				</header>

				{/* QR Code overlay (REQ191) — sized for the back row of the room,
				    with the address and the code for whoever would rather type,
				    and the head-count so the presenter can watch the room fill. */}
				{showQr && (
					// Overlay backdrop — a click anywhere outside the panel closes it.
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-void/90 backdrop-blur-sm p-4"
						onClick={closeQr}
					>
						{/* Stops content clicks from reaching the backdrop's dismiss handler. */}
						<div
							role="dialog"
							aria-modal="true"
							aria-labelledby="presenter-qr-heading"
							className="slide-in flex w-full max-w-2xl lg:max-w-5xl max-h-full flex-col lg:flex-row items-center gap-4 sm:gap-5 lg:gap-10 overflow-y-auto rounded-2xl border border-border bg-surface-raised p-6 sm:p-10 text-center lg:text-left shadow-lg"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="flex-none rounded-xl bg-white p-3 sm:p-4 *:size-[min(44vh,calc(100vw-6rem),28rem)] lg:*:size-[min(60vh,28rem)]">
								<QRCodeDisplay
									url={`${window.location.origin}/join/${pres.code}`}
									size={448}
								/>
							</div>
							<div className="flex flex-col items-center lg:items-start gap-4 sm:gap-5">
								<h3
									id="presenter-qr-heading"
									className="text-2xl sm:text-4xl font-semibold"
								>
									Scan to join
								</h3>
								<p className="flex flex-wrap items-baseline justify-center lg:justify-start gap-x-2 text-sm sm:text-lg text-text-muted">
									<span>or go to</span>
									{/* May break before `/join` and nowhere else. */}
									<span className="font-mono text-accent-text [overflow-wrap:anywhere]">
										{window.location.host}
										<wbr />
										<span className="whitespace-nowrap">/join/{pres.code}</span>
									</span>
								</p>
								<div>
									<p className="text-xs uppercase tracking-wider text-text-muted">
										Join code
									</p>
									<p className="font-mono font-bold text-4xl sm:text-6xl tracking-widest text-text">
										{pres.code}
									</p>
								</div>
								<div className="flex flex-wrap items-center justify-center gap-4">
									<span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-sm text-text-muted">
										<Users size={16} aria-hidden />
										{participantCount} in the room
									</span>
									<button
										type="button"
										className="btn-secondary text-sm"
										onClick={closeQr}
										autoFocus
									>
										Close
									</button>
								</div>
							</div>
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
								skipped={slide.skipped}
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
									className={`w-full relative z-10 ${presenterSlideWidthClass(
										activeSlide.type,
									)}`}
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
											onSetCountdown: handleSetCountdown,
											onDeleteAnswer: handleDeleteAnswer,
											audioCue,
										}}
									/>

									{/* Below `sm` paging is in the dock instead, in
									    reach of the thumb rather than under a slide
									    that may run past the fold (REQ199). */}
									<div className="max-sm:hidden">{slideNavigation}</div>
								</div>
							) : (
								<div className="text-text-dim">No slides</div>
							)}
						</SlideAppearanceScope>
					</main>

					{/* The panels beside the slide. Below `sm` they are a sheet above
					    the phone's dock instead (REQ199): in the page's flow they would
					    open under the slide, out of sight of a presenter who has just
					    asked for one from the dock, so the open ones stack in one sheet
					    over the lower part of the slide — scrolling inside it when they
					    outgrow it, the newest scrolled into view — and close from the
					    sheet itself. The sheet is drawn only while a panel is. From `sm`
					    the wrapper generates no box and its header is not drawn, so the
					    panels lay out beside or under the slide exactly as before. */}
					<div ref={panelSheetRef} className="sm:contents max-sm:hidden max-sm:has-[aside]:flex max-sm:flex-col max-sm:fixed max-sm:inset-x-0 max-sm:bottom-[var(--bottom-dock-height,0px)] max-sm:z-20 max-sm:max-h-[55dvh] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:scroll-pt-12 max-sm:border-t max-sm:border-border max-sm:bg-surface max-sm:shadow-2xl">
						<div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface py-1 pl-4 pr-1 sm:hidden">
							<h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
								Panels
							</h2>
							<button
								type="button"
								onClick={() => hidePanels("dock")}
								aria-label="Hide panels"
								title="Hide panels"
								className={`flex size-10 items-center justify-center rounded-lg border-none bg-transparent hover:bg-surface-hover ${ICON_BUTTON_HOVER}`}
							>
								<X size={18} aria-hidden />
							</button>
						</div>

						{/* The presenter's notes for the slide on screen (REQ090), beside it
						    rather than over it: a cue is read while the room is
						    still looking at the question, so a panel that covered the slide
						    would make reading one cost the other.

						    Rendered only for a viewer who holds the deck, and that is not the
						    thing keeping the notes private — the server empties them for
						    everybody else, so a spectator's copy of this deck has nothing in
						    the field to draw. What the gate here buys is an honest panel: a
						    spectator would be shown an empty one and told the slide has no
						    notes, which is a claim about the deck this screen cannot make. */}
						{isOwner && notesOpen && activeSlide && (
							<aside ref={revealInPanelSheet} className="md:w-72 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4">
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
							<aside ref={revealInPanelSheet} className="md:w-80 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4 flex flex-col gap-4">
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

						    The layer's controls sit inside this panel, on the list they
						    govern — turning Q&A on, deciding who reads it and whether each
						    question waits for approval (REQ038) are changes to *this*, not
						    to the deck's chrome. All are offered whether or not the layer is
						    on, so the question of where the questions will go is settled
						    before the first one arrives. The approve control rides the rows
						    only while approval is in play — the setting on, or a question
						    still waiting from when it was — the way the upvote is offered
						    only where the room may vote. */}
						{isOwner && qaOpen && (
							<aside ref={revealInPanelSheet} className="md:w-80 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4 flex flex-col gap-4">
								<QAHeading labels={QA_LABELS_EN} list={qaList} />
								<QALayerControls
									enabled={pres.qaEnabled}
									visibility={pres.qaVisibility}
									approvalRequired={pres.qaApprovalRequired}
									onChange={handleQASettings}
								/>
								<div className="border-t border-border pt-4">
									<QAQuestionList
										list={qaList}
										labels={QA_LABELS_EN}
										onToggleAnswered={handleQuestionAnswered}
										onApprove={
											pres.qaApprovalRequired || (qaList?.pendingCount ?? 0) > 0
												? handleQuestionApproved
												: undefined
										}
									/>
								</div>
							</aside>
						)}

						{/* The audience panel (REQ077/REQ078), beside the slide rather than
						    over it for the reason the Q&A queue is: a presenter reads the
						    room while the room is still looking at the question.

						    Both channel switches sit at the top of it, on what they govern.
						    The reaction one is here rather than beside the
						    reaction overlay because that overlay is the whole slide — there
						    is no region to put a control next to — and the two switches
						    answer the same question anyway: what may this room send besides
						    answers?

						    The transcript below them is the same feed every phone reads. It
						    stays readable with the channel closed, and only the composer
						    goes dead, saying why. */}
						{isOwner && audienceOpen && (
							<aside ref={revealInPanelSheet} className="md:w-80 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4 flex flex-col gap-4">
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
							<aside ref={revealInPanelSheet} className="md:w-80 flex-shrink-0 border-t md:border-t-0 md:border-l border-border bg-surface/50 overflow-y-auto p-4 flex flex-col gap-4">
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
			</div>

			{/* REQ098 — minting, copying and revoking the deck's read-only results
			    link, in one dialog behind the Deck menu's row. */}
			{resultsLinkOpen && (
				<ResultsLinkDialog
					presentationId={pres.id}
					onClose={() => setResultsLinkOpen(false)}
					onNotify={addToast}
				/>
			)}

			{/* REQ095/REQ096 — every shape the session leaves in, behind the Deck
			    menu's row. The dialog owns the download and the toast, so the page holds
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
