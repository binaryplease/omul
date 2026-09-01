import {
	Check,
	ChevronDown,
	ChevronUp,
	Minus,
	Plus,
	Square,
	SquareCheck,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { ContentSlideView } from "./ContentSlideView";
import { acceptedGridPoint, gridEndLabel, GridPlot, ownGridMarks } from "./GridPlot";
import {
	acceptedPin,
	PinCanvas,
	pinCoordinateLabel,
	pinVerdict,
} from "./PinImage";
import {
	LeaderboardHeading,
	LeaderboardStandingView,
	leaderboardLabelsFor,
} from "./Leaderboard";
import { ParticipationGate, participationLabelsFor } from "./LiveRoom";
import { QuizTimer, quizWindowFor, useQuizCountdown } from "./QuizTimer";
import { ResultsDisplay } from "./Results";
import { SLIDE_PLACEMENT_CLASSES } from "./SlideAppearance";
import { SlideText } from "./SlideText";
import { useToast } from "./ui/Toast";
import { POLL_COLORS } from "../constants";
import { getDict } from "../i18n";
import type {
	FormField,
	GridAxis,
	GuessRange,
	Presentation,
	Slide,
	SlideType,
} from "../types";
import {
	effectiveResultsVisibility,
	encodeFormSubmission,
	encodeGridPoint,
	encodeGuess,
	encodePinPoint,
	encodePoints,
	encodeRanking,
	FORM_ANSWER_MAX_LENGTH,
	formFieldsFor,
	gridAxesFor,
	guessRangeFor,
	isFormEmail,
	isInteractiveSlideType,
	isUsableGuessRange,
	maxResponsesFor,
	maxSelectionsFor,
	middleGuessValue,
	PIN_COORDINATE_MAX,
	pinAreaFor,
	pinImageFor,
	POINTS_BUDGET,
	quizAnswerModeFor,
	slideAcceptsSubmissions,
	slideAppearanceFor,
	slideMediaIsInteractionArea,
	slideTextSizeFor,
	snapGuessToGrid,
	tallyVisibleToAudience,
	VOTE_VALUE_MAX_LENGTH,
} from "../types";

// ── A participant's slide ─────────────────────────────────────
//
// Everything a phone does with the slide it has been handed: the question, the
// control that answers it, the lock and the verdict on a quiz question, and the
// room's results once the participant may see them. Written once and worn by
// both surfaces that need it (ADR-0026/ADR-0027) — the live participant page,
// and the preview's participant pane (REQ103), which is the whole reason it is
// a component rather than the body of a page.
//
// The seam between the two is one object: **the transport** (below). A live
// participant's answer goes to the vote endpoint; a preview's answer goes
// nowhere at all. Because that is the only difference, a preview cannot drift
// from the thing it previews — and, just as importantly, a preview *cannot vote*,
// since the surface has no other way to reach the network (REQ104).
/**
 * One participant's own verdict on a quiz question they have just been through
 * (REQ056): whether they were right, what it scored, and where that leaves them
 * across the deck.
 *
 * Written once and worn by both answer modes (ADR-0026). What a quiz question
 * *asks* differs between picking an option (REQ054) and typing an answer
 * (REQ055); what it *tells you afterwards* does not, and two copies of this
 * would eventually tell the same participant two different things.
 *
 * Renders nothing until the question is over — the caller decides that, on the
 * gate that also keeps a verdict from outrunning the presenter's reveal.
 */
function QuizVerdict({
	result,
	scorecard,
	dict,
}: {
	/** This participant's entry on the scorecard, or null while it is withheld. */
	result: {
		answered: boolean;
		isCorrect: boolean | null;
		points: number;
	} | null;
	scorecard: { quizCount?: number; totalPoints?: number; maxPoints?: number } | null;
	dict: ReturnType<typeof getDict>;
}) {
	if (!result) return null;
	return (
		<div className="vote-pop pt-2 text-center">
			<p
				className={`flex items-center justify-center gap-2 text-lg font-semibold ${
					result.isCorrect ? "text-success" : "text-text-muted"
				}`}
			>
				{result.answered &&
					(result.isCorrect ? <Check size={18} /> : <X size={18} />)}
				{result.answered
					? result.isCorrect
						? dict.quizCorrect
						: dict.quizIncorrect
					: dict.quizNoAnswer}
			</p>
			<p className="mt-1 font-mono text-sm text-text-muted">
				{`+${result.points} ${dict.quizPoints}`}
			</p>
			{/* The running total only reads as a total once there is more than one
			    question to have totalled. */}
			{(scorecard?.quizCount ?? 0) > 1 && (
				<p className="mt-2 text-xs text-text-dim">
					{`${dict.quizTotalScore}: ${scorecard?.totalPoints} / ${scorecard?.maxPoints}`}
				</p>
			)}
		</div>
	);
}

/**
 * The order a ranking slide's items are currently shown in (REQ033): the order
 * the participant has arranged so far, reconciled against the slide as it
 * stands now. Reconciling matters because the organizer can re-author the item
 * list while the slide is on screen — ids that are gone drop out, ids that are
 * new join the end — so a half-arranged order never renders a stale item or
 * hides a fresh one. With no arrangement yet, the authored order is the start.
 */
function rankingOrderFor(
	items: { id: string }[],
	arranged: string[] | undefined,
): string[] {
	const authored = items.map((item) => item.id);
	if (!arranged) return authored;
	const known = new Set(authored);
	const kept = arranged.filter((itemId) => known.has(itemId));
	const placed = new Set(kept);
	return [...kept, ...authored.filter((itemId) => !placed.has(itemId))];
}

/**
 * Where an unplaced grid item starts (REQ046): the middle of both axes, so a
 * participant nudges outward from a neutral position rather than dragging every
 * item off a corner the slide never meant to suggest.
 */
function gridStartPoint(xAxis: GridAxis, yAxis: GridAxis) {
	return {
		x: Math.round((xAxis.min + xAxis.max) / 2),
		y: Math.round((yAxis.min + yAxis.max) / 2),
	};
}

// ── Pin on Image entry (REQ051) ───────────────────────────────
//
// The answer is a tap on the picture, which is the gesture the slide type is for:
// nothing else expresses "there" as directly, and on a phone it is one movement
// rather than two aimed drags.
//
// Beside the picture sit two sliders, and they are not decoration. The 2x2 grid
// deliberately refused a two-dimensional drag because it has no keyboard
// equivalent — here the drag is the whole point of the slide, so the equivalent is
// offered next to it instead of instead of it: a participant who can see the
// image but cannot land a tap on a coordinate moves the pin with the arrow keys.
// What the sliders do *not* claim to fix is the other half — somebody who cannot
// see the picture cannot answer a question about where things are on it, and no
// control changes that. Saying so is more honest than a slider that pretends.

/**
 * How far one arrow-key press moves the pin: a hundredth of the image's edge.
 *
 * Coarser than the per-mille lattice a tap lands on, deliberately. The lattice
 * exists so a *tap* is recorded where it happened; a keyboard user crossing the
 * picture one thousandth at a time would need a thousand presses, and a
 * percentage of the image is as fine as anybody can aim by eye anyway.
 */
const PIN_STEP = PIN_COORDINATE_MAX / 100;

/**
 * Where an unplaced pin starts: the middle of the picture, so the sliders nudge
 * outward from the centre rather than from a corner the slide never suggested —
 * the same reasoning behind `gridStartPoint`. It is an input default and not an
 * answer: nothing is submitted until the participant taps or moves a slider, and
 * no marker is drawn until a pin has actually been accepted.
 */
function pinStartPoint(): { x: number; y: number } {
	return { x: PIN_COORDINATE_MAX / 2, y: PIN_COORDINATE_MAX / 2 };
}

/**
 * The points a participant has on each item of a 100 Points slide (REQ044),
 * reconciled against the slide as it stands now — the same reconciliation
 * `rankingOrderFor` does, and for the same reason: the organizer can re-author
 * the item list while the slide is on screen. Items that are gone drop out
 * (freeing what they held back into the remainder), items that are new arrive
 * unfunded, and every item is present with an explicit number so no read site
 * below has to reach for `??`.
 */
function pointsAllocationFor(
	items: { id: string }[],
	allocated: Record<string, number> | undefined,
): Record<string, number> {
	const allocation: Record<string, number> = {};
	for (const item of items) allocation[item.id] = allocated?.[item.id] ?? 0;
	return allocation;
}

/** What is left of the budget once an allocation is counted. */
function pointsRemainingIn(allocation: Record<string, number>): number {
	const spent = Object.values(allocation).reduce(
		(sum, points) => sum + points,
		0,
	);
	return POINTS_BUDGET - spent;
}

/**
 * How much one tap of the +/− controls moves (REQ044). Five rather than one: a
 * hundred-point budget across a handful of items is authored in chunks — a
 * participant thinks "about a third", not "thirty-four" — and single steps
 * would make a full allocation twenty taps per item. The number field beside
 * the controls is there for the participant who does mean thirty-four.
 */
const POINTS_STEP = 5;

/**
 * Move `delta` points onto an item, bounded by what the participant actually
 * has: never below zero, and never past the unspent remainder. A step larger
 * than what is left spends exactly what is left rather than being refused, so
 * the last few points can always be placed.
 */
function withPointsAdjusted(
	allocation: Record<string, number>,
	itemId: string,
	delta: number,
): Record<string, number> {
	const current = allocation[itemId] ?? 0;
	const ceiling = current + pointsRemainingIn(allocation);
	return {
		...allocation,
		[itemId]: Math.max(0, Math.min(current + delta, ceiling)),
	};
}

// ── Guess the Number entry (REQ039–REQ043) ────────────────────
//
// A guess is typed, not dragged: the range an organizer authors can span four
// digits, where a slider offers neither the precision the estimate needs nor a
// readable set of stops — and a number field is what every phone answers with a
// numeric keypad. The ± controls beside it make the authored step tangible
// (REQ043) for the participant who is nudging rather than typing.
//
// What the participant has typed is kept as *text*, not as a number: "", "-" and
// "1e" are all real intermediate states of typing a number, and coercing them to
// 0 as they are typed would silently answer the question for them. The text is
// judged as a whole below, once, and the same judgement decides what the submit
// button says and whether it can act.

/** Why an entry is not yet a submittable guess, or `null` when it is one. */
type GuessEntryIssue =
	| "unusable-range"
	| "empty"
	| "not-whole"
	| "out-of-range"
	| "off-step"
	| null;

/**
 * Judge what the participant has typed against the frame the organizer authored.
 *
 * The reasons are distinguished rather than collapsed into one "invalid" because
 * they call for different corrections — 11 on a 0–10 slide is a different
 * mistake from 5 on a slide that steps in twos — and ADR-0025 asks a disabled
 * control to say *why*. The server re-checks all of it independently
 * (`decodeGuess`); this only keeps a doomed request from going out.
 */
function guessEntryIssue(text: string, range: GuessRange): GuessEntryIssue {
	if (!isUsableGuessRange(range)) return "unusable-range";
	const trimmed = text.trim();
	if (trimmed.length === 0) return "empty";
	const guess = Number(trimmed);
	if (!Number.isFinite(guess)) return "empty";
	if (!Number.isInteger(guess)) return "not-whole";
	if (guess < range.min || guess > range.max) return "out-of-range";
	if ((guess - range.min) % range.step !== 0) return "off-step";
	return null;
}

/**
 * The entry after one tap of a ± control. A tap from an off-grid or empty entry
 * lands *on* the grid rather than stepping past it, so the controls always leave
 * a number the slide will accept.
 *
 * An untouched slide starts from {@link middleGuessValue} — a value the slide
 * genuinely offers, which is why the snapping lives in the schema beside the
 * boundary that judges it (ADR-0026) rather than here. A starting number is an
 * input default and not an answer: nothing is submitted until the participant
 * presses the button, and the field itself stays empty until they type or step,
 * so the slide never *shows* a guess nobody made.
 */
function withGuessAdjusted(
	text: string,
	range: GuessRange,
	direction: -1 | 1,
): string {
	const trimmed = text.trim();
	const current = Number(trimmed);
	if (trimmed.length === 0 || !Number.isInteger(current)) {
		return String(middleGuessValue(range));
	}
	const snapped = snapGuessToGrid(current, range);
	if (snapped !== current) return String(snapped);
	return String(snapGuessToGrid(current + direction * range.step, range));
}

/** Move the item at `index` one place up (-1) or down (1); ends stay put. */
// ── Form entry (REQ061) ──────────────────────────────────────
//
// The one control on a phone that is a *form* rather than an answer: several
// inputs filled in together and sent once. Everything below exists because the
// submission is atomic — there is a submit button rather than the auto-submit a
// slider or a tap has, and the button says why it cannot act rather than sitting
// dead (ADR-0025).

/** Why a filled-in form cannot be sent yet, or `null` when it can. */
export type FormEntryIssue =
	| "no-fields"
	| "empty"
	| "required"
	| "email"
	| "too-long";

/**
 * What is standing between this form and the submit button, judged against the
 * same rules `decodeFormSubmission` enforces at the boundary (ADR-0026) — so the
 * button is disabled for exactly the reasons the server would refuse the row,
 * and never for one it would have accepted.
 *
 * Ordered by what the participant should fix first: a slide with nothing to fill
 * in is not their problem at all, an untouched form needs a first answer before
 * any per-field complaint is fair, and only then are the fields themselves
 * judged. `null` means the form is sendable.
 */
export function formEntryIssue(
	fields: FormField[],
	answers: Record<string, string>,
): FormEntryIssue | null {
	if (fields.length === 0) return "no-fields";
	const written = (field: FormField) => (answers[field.id] ?? "").trim();
	if (fields.every((field) => written(field).length === 0)) return "empty";
	for (const field of fields) {
		const answer = written(field);
		if (field.required && answer.length === 0) return "required";
		if (answer.length > FORM_ANSWER_MAX_LENGTH) return "too-long";
		if (field.type === "email" && answer.length > 0 && !isFormEmail(answer)) {
			return "email";
		}
	}
	return null;
}

function moveInOrder(order: string[], index: number, direction: -1 | 1) {
	const target = index + direction;
	if (target < 0 || target >= order.length) return order;
	const next = [...order];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}
// ── The transport ────────────────────────────────────────────

/**
 * What a participant surface does with an answer (REQ103, REQ104).
 *
 * A factory-shaped seam (ADR-0007) rather than a `preview` boolean, because the
 * two implementations differ in *what they are*, not in a flag: one posts to the
 * vote endpoint, the other keeps the answer in the browser and forgets it. A
 * boolean would leave the network call sitting in the component with an `if`
 * around it — one edit away from a preview that voted.
 */
export type ParticipantVoteTransport = {
	/** Who is answering. A preview's id never leaves the browser. */
	participantId: string;
	/** Submit one answer; rejects with a message the surface may show. */
	vote: (input: {
		slideId: string;
		value: string;
		statementId?: string;
		skip?: boolean;
	}) => Promise<void>;
	/** Toggle this participant's upvote on an open-ended response (REQ025). */
	upvoteResponse: (input: {
		slideId: string;
		responseId: string;
	}) => Promise<void>;
	/**
	 * This participant's own quiz standing (REQ056) — what they answered, whether
	 * it was right, what it scored and where it places them.
	 */
	scorecard: () => Promise<any>;
};

/** The live transport: the answer goes to the room. */
export function liveVoteTransport(
	presentationId: string,
	participantId: string,
): ParticipantVoteTransport {
	return {
		participantId,
		vote: async ({ slideId, value, statementId, skip }) => {
			await api.vote(presentationId, slideId, value, participantId, {
				statementId,
				skip,
			});
		},
		upvoteResponse: async ({ slideId, responseId }) => {
			await api.voteOnResponse(presentationId, slideId, responseId, participantId);
		},
		scorecard: () => api.getScorecard(presentationId, participantId),
	};
}

// ── What a phone draws ───────────────────────────────────────

/**
 * How a participant's screen draws a slide. The mirror of `presenterSlideKind`,
 * and named for the same reason: "does the preview cover every slide type?" is a
 * question with a test behind it, and a slide type nobody taught this surface
 * about should fail that test rather than render a blank phone.
 */
export type ParticipantSlideKind = "answer" | "standings" | "content";

export function participantSlideKind(type: SlideType): ParticipantSlideKind {
	if (type === "leaderboard") return "standings";
	if (isInteractiveSlideType(type)) return "answer";
	return "content";
}

export function ParticipantSlideView({
	pres,
	slide,
	results,
	serverClockOffsetMs,
	isSurvey,
	transport,
	onError,
}: {
	pres: Presentation;
	slide: Slide;
	results: any;
	serverClockOffsetMs: number;
	/** Survey decks gate results until the whole deck is answered (REQ003/REQ082). */
	isSurvey: boolean;
	transport: ParticipantVoteTransport;
	/** Where a refused submission is reported — the page owns its own banner. */
	onError: (message: string) => void;
}) {
	const [voted, setVoted] = useState<Record<string, string>>({});
	/**
	 * Options currently selected on a multi-select choice slide (REQ014), keyed
	 * by slide id. Single-select slides keep using `voted`, which holds the one
	 * option a participant last picked.
	 */
	const [choiceSelections, setChoiceSelections] = useState<
		Record<string, string[]>
	>({});
	/**
	 * Per-slide submission counts for WC/OE with `maxResponses > 1` (REQ022/26).
	 * Key is slide.id, value is the number of responses the user has sent.
	 */
	const [submitCount, setSubmitCount] = useState<Record<string, number>>({});
	/**
	 * Per-statement submissions for multi-statement scales (REQ029).
	 * Key is `${slideId}:${statementId}`, value is the submitted value (or "skip").
	 */
	const [statementVotes, setStatementVotes] = useState<Record<string, string>>(
		{},
	);
	/** Per-statement current slider value (scale input state). */
	const [statementValues, setStatementValues] = useState<
		Record<string, number>
	>({});
	/**
	 * The order a participant has arranged a ranking slide's items into (REQ033),
	 * keyed by slide id and holding item ids, best first. Seeded from the slide's
	 * authored order the first time the slide is shown, then moved by the
	 * up/down controls until the participant submits it.
	 */
	const [rankingOrders, setRankingOrders] = useState<Record<string, string[]>>(
		{},
	);
	/**
	 * Where the participant currently has each 2x2 grid item (REQ046), keyed
	 * `${slideId}:${itemId}` like the scale slider values next door — a grid item
	 * is a scale statement judged on two axes at once. This is the *input* state;
	 * what has actually been submitted lives in `statementVotes` under the same
	 * key, since both surfaces answer one sub-item of a slide at a time.
	 */
	const [gridPoints, setGridPoints] = useState<
		Record<string, { x: number; y: number }>
	>({});
	/**
	 * How a participant has split a 100 Points slide's budget (REQ044), keyed by
	 * slide id and holding item id → points. Unlike the grid's per-item state
	 * this is one record per *slide*, not per item, because the items share one
	 * budget: what one item holds is only meaningful against what the others do.
	 */
	const [pointsAllocations, setPointsAllocations] = useState<
		Record<string, Record<string, number>>
	>({});
	/**
	 * What a participant has typed into a Guess the Number slide (REQ039), keyed
	 * by slide id. Kept as the raw text they typed rather than as a number — see
	 * the entry helpers above — and empty until they touch the field, so an
	 * untouched slide never shows a guess nobody made.
	 */
	const [guessEntries, setGuessEntries] = useState<Record<string, string>>({});
	/**
	 * Where the participant currently has the pin on a Pin on Image slide
	 * (REQ051), keyed by slide id. The *input* state — what the sliders are
	 * holding, and where the last tap landed — while what has actually been
	 * accepted lives in `voted` under the same key, the way a guess's entry and
	 * its submitted number are kept apart. One record per slide, not per sub-item:
	 * a pin slide takes exactly one answer.
	 */
	const [pinPoints, setPinPoints] = useState<
		Record<string, { x: number; y: number }>
	>({});
	/**
	 * What a participant has written into a Form slide (REQ061), keyed by slide id
	 * and holding field id → answer. One record per *slide* rather than per field,
	 * like the points allocation above and for the same reason: the fields are
	 * sent together, so what one holds is only meaningful beside the others.
	 * A choice field holds the id of the option picked, which is what is stored.
	 */
	const [formEntries, setFormEntries] = useState<
		Record<string, Record<string, string>>
	>({});
	/** Response IDs the participant has upvoted (REQ025). */
	const [upvoted, setUpvoted] = useState<Set<string>>(new Set());
	/**
	 * This participant's own quiz standing (REQ056) — what they answered, whether
	 * it was right and what it scored, fetched once the question is over. It is
	 * theirs alone: the room's results payload reports quiz scores without naming
	 * anyone, so this is the only place a participant sees their own.
	 */
	const [scorecard, setScorecard] = useState<any>(null);
	const [inputValue, setInputValue] = useState("");
	const textInputRef = useRef<HTMLInputElement | null>(null);
	const [scaleValue, setScaleValue] = useState(3);
	const [submitting, setSubmitting] = useState(false);
	const { addToast } = useToast();

	const t = getDict(pres.language);
	// The board's wording in the deck's language (REQ059/REQ084), mapped in the
	// one place that mapping lives.
	const leaderboardLabels = leaderboardLabelsFor(t);
	// Which of the three things this screen is, read through the one descriptor
	// the preview reads too — so "does every slide type render?" is a question
	// about one function rather than about a ternary chain in two components.
	const kind = participantSlideKind(slide.type);
	// This slide's own appearance over the deck's theme (REQ087) — the same
	// answer the shared screen gets, off the same resolver, including whether
	// there is really a picture behind the words.
	const appearance = slideAppearanceFor(slide);
	const placement = SLIDE_PLACEMENT_CLASSES[appearance.placement];

	/**
	 * A new identity every time the *standings* move (REQ059) — the payload
	 * itself, and only while a leaderboard is on screen. It is what re-reads this
	 * participant's own place below, so the number under "your position" tracks
	 * the board it sits above rather than the moment they arrived.
	 */
	const standingsRevision = slide.type === "leaderboard" ? results : null;

	// Reset transient input state whenever the slide on screen changes (presenter
	// navigation in live mode, local navigation in survey mode or a preview).
	useEffect(() => {
		setInputValue("");
		setScaleValue(3);
		// The scorecard is per question on screen; carrying the last one over
		// would show the previous question's verdict under this one.
		setScorecard(null);
	}, [slide.id]);

	// ── Quiz competition (REQ054, REQ056, REQ057) ───────────────
	//
	// The countdown runs on the server's window, read through the descriptor
	// both surfaces share (ADR-0026) rather than timed locally: the boundary
	// refuses a late answer on exactly this deadline, so a phone that counted
	// its own would eventually disagree with what it is allowed to submit.
	const quizWindow = quizWindowFor(slide, pres);
	const quizCountdown = useQuizCountdown(quizWindow, serverClockOffsetMs);
	const isQuizSlide = slide.type === "quiz";
	// REQ055 — the same question with a text box instead of cards. Everything
	// around the answer (the countdown, the lock, the verdict) is shared; only
	// the control that takes the answer differs.
	const isTypedQuizSlide = isQuizSlide && quizAnswerModeFor(slide) === "type";
	const answeredQuiz = Boolean(isQuizSlide && slide.id in voted);

	// ── Participation (REQ111) ──────────────────────────────────
	//
	// Whether the presenter currently has this slide open, read through the very
	// predicate the boundary refuses on (ADR-0026): a second reading here is how
	// a phone comes to draw a live control over an answer the server is already
	// turning away.
	//
	// The gate below turns the form controls off; this pair is what covers the
	// two surfaces a `<fieldset>` cannot reach — the pin canvas and the grid
	// plot, both answered by tapping a picture — and what makes a tap that
	// arrived a moment before the broadcast say the same thing the disabled
	// control would have.
	const participationOpen = slideAcceptsSubmissions(pres, slide.id);
	const participationLabels = participationLabelsFor(t);

	/**
	 * Turn a submission away here rather than sending it, and say why in the
	 * deck's own language. Returns whether it was refused.
	 *
	 * The server's answer is the authority and this changes none of it — what it
	 * buys the participant is the *localized* reason (REQ084) instead of the
	 * English one the API hands a caller, which is the same trade the quiz
	 * refusals next door make.
	 */
	const refusedWhileClosed = (): boolean => {
		if (participationOpen) return false;
		onError(participationLabels.closed);
		addToast(participationLabels.closed, "error");
		return true;
	};

	/**
	 * What a thrown submission error should read as on this screen. A stated
	 * refusal carries its machine-readable `refused` code over the wire
	 * (REQ054/REQ057/REQ111) exactly so this surface can name the reason in the
	 * deck's own language (REQ084) instead of guessing it back out of local
	 * state — a tap that races the `slide.participation` broadcast is refused
	 * for a reason this phone does not know yet. An error with no code (the
	 * deck not live, a value the boundary rejected) keeps the message it came
	 * with.
	 */
	const submissionErrorMessage = (thrown: unknown): string => {
		const refused = thrown instanceof ApiError ? thrown.refused : null;
		if (refused === "participation-closed") return participationLabels.closed;
		if (refused === "quiz-window-closed") return t.quizWindowClosed;
		if (refused === "quiz-already-answered") return t.quizAnswerLocked;
		return (thrown as Error).message;
	};

	/**
	 * Whether this slide's tally may be shown to the participant at all
	 * (REQ015/REQ016/REQ017): the slide's own override, else the deck default.
	 * Read once here because two things below ask the same question — the
	 * aggregated tally, and the participant's own quiz verdict, which reveals the
	 * solution just as plainly and so cannot outrun the organizer's reveal.
	 *
	 * The **same function the server gates the payload with**, not a second
	 * reading of the same three modes (ADR-0026). Under a withholding mode this
	 * screen is never sent a tally at all, so a rule that drifted from the
	 * server's would not leak anything — it would strand the participant, drawing
	 * "waiting for responses" over a question the room finished answering, or
	 * clearing a placeholder for numbers that are never coming.
	 */
	const resultsVisibleHere = tallyVisibleToAudience(slide, pres);

	/**
	 * When a participant learns how they did: once the question is over, never
	 * while it is still running. A verdict on screen mid-question is the answer
	 * itself, one whispered row away from the people still deciding.
	 *
	 * A question with no window — untimed, or a survey nobody paces — has no
	 * "over" to wait for, so its verdict lands as soon as this participant has
	 * answered. Not before: with no deadline there is nothing to have missed, and
	 * a "no answer in time" under a question that is still open would be a
	 * verdict on somebody who is still reading it.
	 */
	const quizResultReady =
		isQuizSlide &&
		resultsVisibleHere &&
		(quizCountdown.expired || (!quizCountdown.timed && answeredQuiz));

	/**
	 * Whether the room's aggregated tally may be shown here. On every other slide
	 * type that is just the visibility rule; on a quiz it waits for the question
	 * to close as well, because the tally carries the marked solution (REQ013) —
	 * an early answerer would otherwise be reading the answer off their own phone
	 * while the row beside them is still deciding.
	 */
	const resultsReadyHere = isQuizSlide ? quizResultReady : resultsVisibleHere;

	// The scorecard is fetched as soon as a quiz question is on screen, not only
	// once its verdict may be shown. It is the record of what this participant
	// answered, and it is the only thing that survives a reload: `voted` is
	// in-memory, so without this a participant who refreshes mid-question would
	// be offered cards they have already spent their one answer on. What the
	// fetch feeds is the *lock*; the verdict below still waits for
	// `quizResultReady`.
	// It is also what tells this phone which row of the anonymous leaderboard is
	// its own (REQ059) — the board names nobody, so a client that was not told
	// its handle could not find itself on it — and it is re-read whenever those
	// standings move (`standingsRevision` below), because the board beside this
	// number is redrawn live by `results.updated` and a place fetched on arrival
	// would sit still under a race that has not.
	useEffect(() => {
		if (slide.type !== "quiz" && slide.type !== "leaderboard") return;
		const slideId = slide.id;
		transport
			.scorecard()
			.then((card) => {
				setScorecard(card);
				const own = (card?.slides ?? []).find(
					(entry: { slideId: string }) => entry.slideId === slideId,
				);
				// Whichever way the question was answered (REQ054 option id, REQ055
				// typed text), the record of *having* answered is the same lock.
				const submitted = own?.optionId ?? own?.answer ?? null;
				if (own?.answered && submitted) {
					setVoted((prev) =>
						prev[slideId] === submitted
							? prev
							: { ...prev, [slideId]: submitted },
					);
				}
			})
			.catch(() => {});
		// `standingsRevision` is the board payload's identity, and only on a
		// leaderboard slide: a quiz slide's tally changes on every answer in the
		// room, and depending on it there would re-fetch this card once per vote
		// cast by anybody.
	}, [slide, transport, answeredQuiz, quizResultReady, standingsRevision]);

	const handleVote = async (
		value: string,
		opts: { statementId?: string; skip?: boolean } = {},
	) => {
		if (submitting) return;
		if (refusedWhileClosed()) return;
		setSubmitting(true);
		try {
			await transport.vote({ slideId: slide.id, value, ...opts });
			if (opts.statementId) {
				const key = `${slide.id}:${opts.statementId}`;
				setStatementVotes((prev) => ({
					...prev,
					[key]: opts.skip ? "__skip__" : value,
				}));
			} else {
				setVoted((prev) => ({ ...prev, [slide.id]: value }));
				setSubmitCount((prev) => ({
					...prev,
					[slide.id]: (prev[slide.id] ?? 0) + 1,
				}));
			}
			addToast(t.voteSubmitted, "success");
		} catch (voteError: unknown) {
			const message = submissionErrorMessage(voteError);
			onError(message);
			addToast(message, "error");
		} finally {
			setSubmitting(false);
		}
	};

	/**
	 * Pick (or un-pick) an option on a choice slide.
	 *
	 * Single choice keeps the existing path: one submission replaces the last.
	 * Multi-select (REQ014) sends the same endpoint one option at a time — the
	 * server toggles a selection it already holds — and mirrors the result
	 * locally so the cards reflect what the server now stores. The cap is
	 * enforced server-side; the UI disables what would exceed it rather than
	 * letting a doomed request go out.
	 */
	const handleChoiceSelect = async (optionId: string) => {
		if (submitting) return;
		// Multi-select posts straight to the transport below rather than through
		// `handleVote`, so the closed-slide guard is repeated here rather than
		// inherited (REQ111).
		if (refusedWhileClosed()) return;
		if (maxSelectionsFor(slide) === 1) {
			await handleVote(optionId);
			return;
		}
		const current = choiceSelections[slide.id] ?? [];
		const next = current.includes(optionId)
			? current.filter((id) => id !== optionId)
			: [...current, optionId];

		setSubmitting(true);
		try {
			await transport.vote({ slideId: slide.id, value: optionId });
			setChoiceSelections((prev) => ({ ...prev, [slide.id]: next }));
			// `voted` drives the results gate below and survey completeness: a
			// participant has answered while at least one selection stands.
			setVoted((prev) => {
				const updated = { ...prev };
				if (next.length > 0) updated[slide.id] = next[0];
				else delete updated[slide.id];
				return updated;
			});
			if (next.length > current.length) {
				addToast(t.voteSubmitted, "success");
			}
		} catch (voteError: unknown) {
			const message = submissionErrorMessage(voteError);
			onError(message);
			addToast(message, "error");
		} finally {
			setSubmitting(false);
		}
	};

	const handleTextSubmit = async () => {
		if (!inputValue.trim()) return;
		await handleVote(inputValue.trim());
		setInputValue("");
		// Keep keyboard focus in the input so participants can keep typing
		// without re-clicking the field (relevant for word-cloud / Q&A where
		// multiple submissions are common).
		requestAnimationFrame(() => textInputRef.current?.focus());
	};

	const handleStatementSubmit = async (
		statementId: string,
		value: number,
		skip = false,
	) => {
		await handleVote(skip ? "0" : String(value), { statementId, skip });
	};

	/**
	 * Submit the arranged order as one vote (REQ033). The whole ordering travels
	 * as a single value — a ranking is one answer, not one answer per item — and
	 * re-submitting replaces it server-side, so a participant can keep adjusting.
	 */
	const handleRankingSubmit = async (order: string[]) => {
		await handleVote(encodeRanking(order));
	};

	/**
	 * Submit the whole allocation as one vote (REQ044). The budget travels as a
	 * single value — the items only mean anything against the 100 they share —
	 * and re-submitting replaces it server-side, so a participant can keep moving
	 * points around. The server re-checks the full spend independently
	 * (ADR-0013); the button below is disabled until then only so a doomed
	 * request never goes out.
	 */
	const handlePointsSubmit = async (allocation: Record<string, number>) => {
		await handleVote(encodePoints(allocation));
	};

	/**
	 * Submit the typed estimate as one vote (REQ039). One participant holds one
	 * guess and re-submitting replaces it server-side, so a participant can
	 * revise until the reveal. The number is sent exactly as entered — the server
	 * re-checks it against the authored range and step (ADR-0013) and rejects
	 * anything off-frame rather than rounding it in.
	 */
	const handleGuessSubmit = async (guess: number) => {
		await handleVote(encodeGuess(guess));
	};

	/**
	 * Submit (or re-submit) where one grid item sits (REQ046, REQ047), or mark it
	 * not assessable (REQ050). One item is one vote row — the same shape a scale
	 * statement uses — so items are answered independently and a re-placement
	 * replaces only that item.
	 */
	const handleGridSubmit = async (
		itemId: string,
		point: { x: number; y: number },
		skip = false,
	) => {
		await handleVote(encodeGridPoint(point), { statementId: itemId, skip });
	};

	/**
	 * Submit the whole filled-in form as one vote (REQ061). Every field travels in
	 * a single value — the answers were given together and belong together — and
	 * re-submitting replaces the previous submission server-side, so correcting a
	 * mistyped address is a correction rather than a second person in the
	 * organizer's export. The server re-checks every field independently
	 * (ADR-0013); the button below is disabled until then only so a doomed request
	 * never goes out.
	 */
	const handleFormSubmit = async (answers: Record<string, string>) => {
		await handleVote(encodeFormSubmission(answers));
	};

	/**
	 * Submit (or move) the pin on a Pin on Image slide (REQ051). One participant
	 * holds one pin and re-submitting replaces it server-side, so a tap in a better
	 * spot is a correction rather than a second answer. The coordinates are sent
	 * exactly as the tap produced them — the server re-checks them against the
	 * image's lattice (ADR-0013) and refuses anything off it rather than pulling it
	 * onto the edge.
	 */
	const handlePinSubmit = async (point: { x: number; y: number }) => {
		setPinPoints((prev) => ({ ...prev, [slide.id]: point }));
		await handleVote(encodePinPoint(point));
	};

	const handleUpvote = async (responseId: string) => {
		// An upvote is a submission to this slide, so a closed slide refuses it on
		// the same terms a vote gets (REQ111) — the boundary does too.
		if (refusedWhileClosed()) return;
		try {
			await transport.upvoteResponse({ slideId: slide.id, responseId });
			setUpvoted((prev) => {
				const next = new Set(prev);
				if (next.has(responseId)) next.delete(responseId);
				else next.add(responseId);
				return next;
			});
		} catch (upvoteError) {
			addToast(submissionErrorMessage(upvoteError), "error");
		}
	};

	const hasVoted = slide.id in voted;

	// REQ054/REQ057: a quiz answer is final and only counts inside the question's
	// window, so the control that takes it stops accepting once either is true —
	// disabled and saying why, never hidden (ADR-0025). The server enforces both
	// independently; this only keeps a doomed request from going out. Resolved
	// here rather than inside either branch below because the two answer modes
	// (REQ055) are locked by exactly the same two rules.
	const quizLockReason = !isQuizSlide
		? null
		: answeredQuiz
			? t.quizAnswerLocked
			: quizCountdown.expired
				? t.quizWindowClosed
				: null;

	/**
	 * This participant's own verdict on this question, once the question is over
	 * and the deck's results visibility allows it (REQ056). Absent on a plain
	 * choice slide, which reveals a solution but keeps no score.
	 */
	const ownQuizResult = quizResultReady
		? ((scorecard?.slides ?? []).find(
				(entry: { slideId: string }) => entry.slideId === slide.id,
			) ?? null)
		: null;

	/**
	 * In survey mode, results are only revealed once every interactive slide
	 * has been answered or skipped. This prevents participants from peeking at
	 * results before they have completed the full survey.
	 *
	 * In live mode the presenter drives navigation, so results are shown as
	 * soon as the participant answers the current slide (existing behaviour).
	 */
	const allSlidesAnswered =
		!isSurvey ||
		pres.slides
			.filter((s) => isInteractiveSlideType(s.type))
			.every((s) => {
				if (s.type === "scale" && (s.scaleStatements ?? []).length > 0) {
					// Multi-statement scale: every statement must be answered or skipped
					return (s.scaleStatements ?? []).every(
						(st) => `${s.id}:${st.id}` in statementVotes,
					);
				}
				// 2x2 Grid: every item must be placed or marked not assessable —
				// the same per-sub-item completeness a multi-statement scale has.
				if (s.type === "grid") {
					return (s.gridItems ?? []).every(
						(item) => `${s.id}:${item.id}` in statementVotes,
					);
				}
				// Word-cloud / open-text: at least one submission counts as answered
				if (s.type === "word-cloud" || s.type === "open-text") {
					return (submitCount[s.id] ?? 0) > 0;
				}
				// Multiple-choice, quiz, single-statement scale
				return s.id in voted;
			});

	return (
		<>
		{/* The standings, on the participant's own screen (REQ059). The same
		    board the shared screen shows — no phone gets a private ordering —
		    with two things only this screen can add: their own row picked out,
		    and their place spelled out even when it is below the projected cut,
		    which is the whole reason a participant is shown a leaderboard they
		    are not winning.

		    Behind the deck's results-visibility gate (REQ102), like every other
		    aggregate here: a board is an aggregated result, and this is the
		    screen that rule exists for — an organizer who does not want the room
		    reading standings off their phones must be able to say so. Nothing
		    about the standings is shown when it is closed, the participant's own
		    place included: that number *is* the board, seen from one row. */}
		{kind === "standings" ? (
			<div className="w-full slide-in flex flex-col gap-4">
				<LeaderboardHeading
					title={
						<SlideText
							text={slide.question || t.leaderboardTitle}
							size={slideTextSizeFor(slide)}
							variant="inline"
						/>
					}
					compact
				/>
				{!resultsVisibleHere ? (
					<p className="text-center text-sm text-text-dim">
						{effectiveResultsVisibility(
							slide.resultsVisibility,
							pres.resultsVisibility,
						) === "private"
							? t.resultsPrivate
							: t.resultsHidden}
					</p>
				) : (
					<>
						<LeaderboardStandingView
							standing={
								scorecard
									? {
											rank: scorecard.rank ?? null,
											rankedCount: scorecard.rankedCount ?? 0,
											totalPoints: scorecard.totalPoints ?? 0,
											maxPoints: scorecard.maxPoints ?? 0,
										}
									: null
							}
							labels={leaderboardLabels}
						/>
						{results ? (
							<ResultsDisplay
								slide={slide}
								results={results}
								leaderboardLabels={leaderboardLabels}
								highlightEntryId={scorecard?.entryId ?? null}
							/>
						) : (
							<p className="text-center text-sm text-text-dim">
								{t.waitingForResponses}
							</p>
						)}
					</>
				)}
			</div>
		) : /* Content slides: render full view, no voting */
		kind === "content" ? (
			<div className="w-full slide-in">
				<ContentSlideView
					slide={slide}
					joinCode={pres.code}
					joinUrl={`${window.location.origin}/join/${pres.code}`}
					deck={pres}
				/>
			</div>
		) : (
			/* REQ111 — the answer controls, dead while the presenter has this slide
			   closed, and saying so above the question rather than under whichever
			   control somebody reached first: what is closed is the whole slide.
			   The results below stay drawn and stay readable — closing a question
			   stops the room adding to a tally, not looking at it — and every answer
			   already given is still on screen and still counted. */
			<ParticipationGate open={participationOpen} labels={participationLabels}>
				{/* The question exactly as the shared screen draws it — same authored
				    string, same markup, same step (REQ088/REQ089/REQ091). A link that
				    is clickable on a projector nobody can reach and dead on the phones
				    in the room's hands would be the wrong way round. */}
				<h2
					className={`w-full text-2xl font-bold mb-4 slide-in ${placement.text} ${
						appearance.backgroundImage !== "" ? "slide-title-overlay" : ""
					}`}
				>
					<SlideText
						text={slide.question}
						size={slideTextSizeFor(slide)}
						variant="inline"
					/>
				</h2>

				{/* Optional media (image/GIF). Not on a slide whose media *is* the
				    control (REQ052): a pin slide would otherwise show the picture
				    twice — once as decoration nobody can tap, once as the thing being
				    answered — and the tappable one is drawn below. */}
				{slide.mediaUrl && !slideMediaIsInteractionArea(slide.type) ? (
					<img
						src={slide.mediaUrl}
						alt={slide.mediaAlt ?? ""}
						className={`${placement.media} mb-6 max-h-48 w-full rounded-xl object-contain slide-in`}
					/>
				) : (
					<div className="mb-4" />
				)}

				{/* Voting UI */}
				{isTypedQuizSlide ? (
					/* Typed quiz answer (REQ055) — the same question, answered from
					   memory. The countdown, the lock and the verdict are the ones
					   the select-answer question uses; only the control that takes
					   the answer is a text field. */
					<div className="w-full space-y-3">
						<QuizTimer
							countdown={quizCountdown}
							label={t.quizSecondsLeft}
							expiredLabel={t.quizTimesUp}
							className="mb-5"
						/>
						<div className="flex gap-2">
							<input
								ref={textInputRef}
								className="input flex-1 text-lg"
								placeholder={t.quizTypeAnswer}
								value={
									// Once the answer is final it is the answer, not a
									// draft: the field keeps showing what was sent rather
									// than emptying out from under the participant.
									answeredQuiz ? (voted[slide.id] ?? "") : inputValue
								}
								// The same bound the vote boundary enforces, so the cap arrives
								// as a key that does nothing rather than as a raw validation
								// failure in place of this surface's own wording.
								maxLength={VOTE_VALUE_MAX_LENGTH}
								onChange={(event) => setInputValue(event.target.value)}
								onKeyDown={(event) =>
									event.key === "Enter" &&
									!quizLockReason &&
									inputValue.trim() &&
									handleVote(inputValue.trim())
								}
								disabled={submitting || quizLockReason !== null}
								title={quizLockReason ?? undefined}
								aria-label={t.quizTypeAnswer}
							/>
							<button
								type="button"
								className="btn-primary px-6"
								onClick={() => handleVote(inputValue.trim())}
								disabled={
									submitting ||
									!inputValue.trim() ||
									quizLockReason !== null
								}
								title={quizLockReason ?? undefined}
							>
								{t.quizSubmitAnswer}
							</button>
						</div>
						{/* The disabled control's reason, spelled out rather than left
						    to a tooltip a touch device never shows (ADR-0025). */}
						{quizLockReason && (
							<p className="pt-1 text-center text-sm text-text-muted">
								{quizLockReason}
							</p>
						)}
						<QuizVerdict
							result={ownQuizResult}
							scorecard={scorecard}
							dict={t}
						/>
					</div>
				) : slide.type === "multiple-choice" ||
					slide.type === "quiz" ? (
					(() => {
							// REQ014: one slide can be single choice or "all that apply",
							// capped or unlimited. The limit resolved here is the same one
							// the server enforces.
							const limit = maxSelectionsFor(slide);
							const isMulti = limit !== 1;
							const selected = isMulti
								? (choiceSelections[slide.id] ?? [])
								: voted[slide.id]
									? [voted[slide.id]]
									: [];
							const capReached =
								isMulti && limit > 0 && selected.length >= limit;
							return (
								<div className="w-full space-y-3">
									{isQuizSlide && (
										<QuizTimer
											countdown={quizCountdown}
											label={t.quizSecondsLeft}
											expiredLabel={t.quizTimesUp}
											className="mb-5"
										/>
									)}
									{isMulti && (
										<p className="text-sm text-text-muted text-center">
											{limit === 0
												? "Select all that apply"
												: `Select up to ${limit} options`}
											{selected.length > 0 &&
												` · ${selected.length} selected`}
										</p>
									)}
									{slide.options?.map((opt, i) => {
										const isSelected = selected.includes(opt.id);
										// ADR-0025: a card that would exceed the cap stays
										// visible and disabled, and says why.
										const blockedByCap = capReached && !isSelected;
										return (
											<button
												key={opt.id}
												type="button"
												aria-pressed={isSelected}
												className={`option-card ${isSelected ? "selected" : ""} ${
													blockedByCap || (quizLockReason && !isSelected)
														? "opacity-50 cursor-not-allowed"
														: ""
												}`}
												style={{
													borderColor: isSelected
														? POLL_COLORS[i % POLL_COLORS.length]
														: undefined,
												}}
												onClick={() => handleChoiceSelect(opt.id)}
												disabled={
													submitting || blockedByCap || quizLockReason !== null
												}
												title={
													blockedByCap
														? `You can select at most ${limit} options — deselect one first`
														: (quizLockReason ?? undefined)
												}
											>
												<div className="flex items-center gap-3">
													<div
														className="w-4 h-4 rounded-sm flex-shrink-0"
														style={{
															background:
																POLL_COLORS[i % POLL_COLORS.length],
														}}
													/>
													<span className="flex-1 text-left">
														{opt.text}
													</span>
													{isMulti &&
														(isSelected ? (
															<SquareCheck
																size={18}
																className="flex-shrink-0 text-accent"
															/>
														) : (
															<Square
																size={18}
																className="flex-shrink-0 text-text-dim"
															/>
														))}
												</div>
											</button>
										);
									})}
									{/* The disabled cards' reason, spelled out rather than
									    left to a tooltip a touch device never shows
									    (ADR-0025). */}
									{quizLockReason && (
										<p className="pt-1 text-center text-sm text-text-muted">
											{quizLockReason}
										</p>
									)}
									<QuizVerdict
										result={ownQuizResult}
										scorecard={scorecard}
										dict={t}
									/>
								</div>
							);
						})()
				) : slide.type === "word-cloud" ||
							slide.type === "open-text"
						? (() => {
								const cap = maxResponsesFor(slide);
								const sent = submitCount[slide.id] ?? 0;
								const canSubmitMore = cap === 0 || sent < cap;
								const remaining = cap === 0 ? null : cap - sent;
								return (
									<div className="w-full">
										<div className="flex gap-2">
											<input
												ref={textInputRef}
												className="input flex-1 text-lg"
												placeholder={
													slide.type === "word-cloud"
														? "Enter a word..."
														: t.typeResponse
												}
												value={inputValue}
												onChange={(e) => setInputValue(e.target.value)}
												onKeyDown={(e) =>
													e.key === "Enter" &&
													canSubmitMore &&
													handleTextSubmit()
												}
												disabled={submitting || !canSubmitMore}
											/>
											<button
												type="button"
												className="btn-primary px-6"
												onClick={handleTextSubmit}
												disabled={
													submitting || !inputValue.trim() || !canSubmitMore
												}
											>
												Send
											</button>
										</div>
										{sent > 0 && (
											<p className="text-sm text-success mt-3 text-center vote-pop">
												{cap === 1
													? "Response submitted!"
													: canSubmitMore
														? `${sent} sent${remaining !== null ? ` · ${remaining} remaining` : ""}`
														: `All ${sent} responses submitted!`}
											</p>
										)}
									</div>
								);
							})()
						: slide.type === "scale"
							? (() => {
									const statements = slide.scaleStatements ?? [];
									const min = slide.scaleMin ?? 1;
									const max = slide.scaleMax ?? 5;
									const allowSkip = !!slide.scaleAllowSkip;
									const minLabel = slide.scaleMinLabel || String(min);
									const maxLabel = slide.scaleMaxLabel || String(max);

									// Multi-statement (REQ029): compact omul-style layout —
									// one slim slider per statement, single shared label row.
									// Each slider auto-submits on release (onPointerUp/onKeyUp).
									if (statements.length > 0) {
										// Re-edit support: `isDirty` tracks whether the current slider
										// value differs from what was last submitted (used for the ✓ indicator).
										const sliderValueFor = (stId: string) => {
											const key = `${slide.id}:${stId}`;
											return (
												statementValues[key] ?? Math.round((min + max) / 2)
											);
										};
										const isDirty = (stId: string) => {
											const key = `${slide.id}:${stId}`;
											const submitted = statementVotes[key];
											if (!submitted || submitted === "__skip__")
												return true;
											return String(sliderValueFor(stId)) !== submitted;
										};
										return (
											<div className="w-full space-y-6">
												<div className="space-y-5">
													{statements.map((st) => {
														const key = `${slide.id}:${st.id}`;
														const submitted = statementVotes[key];
														const val = sliderValueFor(st.id);
														const skipped = submitted === "__skip__";
														const dirty = isDirty(st.id);
														return (
															<div
																key={st.id}
																className={`space-y-1.5 transition-opacity duration-200${skipped ? " opacity-40" : ""}`}
															>
																<div className="flex items-center justify-between gap-3">
																	<p className="text-sm sm:text-base text-text">
																		{st.text}
																	</p>
																	<div className="flex items-center gap-2 shrink-0">
																		{submitted && !dirty && !skipped && (
																			<span className="inline-flex items-center gap-1 text-xs text-success">
																				<Check size={12} />
																				{submitted}
																			</span>
																		)}
																		{skipped && (
																			<span className="text-xs text-text-muted">
																				Skipped
																			</span>
																		)}
																		{allowSkip && (
																			<button
																				type="button"
																				className="text-xs text-text-muted hover:text-text underline"
																				onClick={() =>
																					handleStatementSubmit(
																						st.id,
																						0,
																						true,
																					)
																				}
																				disabled={submitting}
																			>
																				Skip
																			</button>
																		)}
																	</div>
																</div>
																<input
																	type="range"
																	min={min}
																	max={max}
																	value={val}
																	onChange={(e) =>
																		setStatementValues((prev) => ({
																			...prev,
																			[key]: Number(e.target.value),
																		}))
																	}
																	onPointerUp={(e) =>
																		handleStatementSubmit(
																			st.id,
																			Number(
																				(e.target as HTMLInputElement)
																					.value,
																			),
																		)
																	}
																	onKeyUp={(e) =>
																		handleStatementSubmit(
																			st.id,
																			Number(
																				(e.target as HTMLInputElement)
																					.value,
																			),
																		)
																	}
																	className="w-full"
																	aria-label={st.text}
																/>
															</div>
														);
													})}
												</div>

												{/* Single shared label row */}
												<div className="flex justify-between text-xs sm:text-sm text-text-muted">
													<span>{minLabel}</span>
													<span>{maxLabel}</span>
												</div>
											</div>
										);
									}

									// Single-statement (legacy behaviour)
									return (
										<div className="w-full space-y-6">
											<div className="text-center">
												<span className="text-5xl font-bold text-accent-text">
													{scaleValue}
												</span>
											</div>
											<input
												type="range"
												min={min}
												max={max}
												value={scaleValue}
												onChange={(e) =>
													setScaleValue(Number(e.target.value))
												}
												onPointerUp={(e) =>
													handleVote((e.target as HTMLInputElement).value)
												}
												onKeyUp={(e) =>
													handleVote((e.target as HTMLInputElement).value)
												}
												className="w-full"
											/>
											<div className="flex justify-between text-sm text-text-muted">
												<span>{slide.scaleMinLabel || min}</span>
												<span>{slide.scaleMaxLabel || max}</span>
											</div>
											{allowSkip && (
												<div className="flex justify-end">
													<button
														type="button"
														className="btn-secondary px-4 py-3"
														onClick={() => handleVote("0", { skip: true })}
														disabled={submitting}
													>
														Skip
													</button>
												</div>
											)}
											{hasVoted && (
												<p className="text-sm text-success text-center vote-pop">
													Rating submitted!
												</p>
											)}
										</div>
									);
								})()
							: slide.type === "ranking"
								? (() => {
										// REQ033/REQ034: the participant arranges the slide's
										// items into their own order and submits it as one
										// answer. Reordering is done with per-item up/down
										// controls rather than drag-and-drop: this surface is
										// used on phones, where a drag competes with the page
										// scroll, and buttons are reachable by keyboard and
										// screen reader without a second interaction model.
										const items = slide.rankingItems ?? [];
										const order = rankingOrderFor(
											items,
											rankingOrders[slide.id],
										);
										const textById = new Map(
											items.map((item) => [item.id, item.text]),
										);
										const setOrder = (next: string[]) =>
											setRankingOrders((prev) => ({
												...prev,
												[slide.id]: next,
											}));
										return (
											<div className="w-full space-y-4">
												<p className="text-sm text-text-muted text-center">
													Put these in order — most important at the top.
												</p>
												<ol className="space-y-2">
													{order.map((itemId, position) => {
														const isFirst = position === 0;
														const isLast = position === order.length - 1;
														const text = textById.get(itemId) ?? "";
														return (
															<li
																key={itemId}
																className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5"
															>
																<span className="w-6 shrink-0 text-center font-mono text-sm font-bold text-accent-text">
																	{position + 1}
																</span>
																<span
																	className={`min-w-0 flex-1 break-words text-left ${
																		text ? "" : "text-text-dim italic"
																	}`}
																>
																	{text || `Item ${position + 1}`}
																</span>
																{/* ADR-0025: an item already at an end keeps
																    both controls, disabled, and says why. */}
																<div className="flex shrink-0 items-center gap-0.5">
																	<button
																		type="button"
																		className="text-text-dim hover:text-text disabled:opacity-30 disabled:hover:text-text-dim transition-colors p-2 rounded-lg hover:bg-surface-hover"
																		onClick={() =>
																			setOrder(
																				moveInOrder(order, position, -1),
																			)
																		}
																		disabled={isFirst}
																		title={
																			isFirst
																				? "Already ranked first"
																				: `Move "${text}" up`
																		}
																		aria-label={`Move ${text || `item ${position + 1}`} up`}
																	>
																		<ChevronUp size={16} />
																	</button>
																	<button
																		type="button"
																		className="text-text-dim hover:text-text disabled:opacity-30 disabled:hover:text-text-dim transition-colors p-2 rounded-lg hover:bg-surface-hover"
																		onClick={() =>
																			setOrder(
																				moveInOrder(order, position, 1),
																			)
																		}
																		disabled={isLast}
																		title={
																			isLast
																				? "Already ranked last"
																				: `Move "${text}" down`
																		}
																		aria-label={`Move ${text || `item ${position + 1}`} down`}
																	>
																		<ChevronDown size={16} />
																	</button>
																</div>
															</li>
														);
													})}
												</ol>
												<button
													type="button"
													className="btn-primary w-full"
													onClick={() => handleRankingSubmit(order)}
													disabled={submitting || order.length === 0}
												>
													{hasVoted ? "Update ranking" : "Submit ranking"}
												</button>
												{hasVoted && (
													<p className="text-sm text-success text-center vote-pop">
														Ranking submitted!
													</p>
												)}
											</div>
										);
									})()
								: slide.type === "grid"
									? (() => {
											// REQ046/REQ047: each item is judged on two
											// dimensions at once. The item is placed with one
											// slider per axis rather than by dragging it onto
											// the field: the same reasoning that kept ranking
											// off drag applies twice over here — on a phone a
											// drag inside a plot competes with the page scroll,
											// and a two-dimensional drag has no keyboard or
											// screen-reader equivalent at all, while a pair of
											// range inputs is reachable by both and states the
											// coordinate it produces. The field above is the
											// picture of the answer as submitted: an item lands
											// on it once its placement has been accepted, so a
											// participant reads their own answer the way the
											// room will — and never reads a dot the server
											// never took.
											const items = slide.gridItems ?? [];
											const { xAxis, yAxis } = gridAxesFor(slide);
											const allowSkip = !!slide.gridAllowSkip;
											const xTitle = xAxis.title.trim() || t.gridHorizontal;
											const yTitle = yAxis.title.trim() || t.gridVertical;
											const keyFor = (itemId: string) =>
												`${slide.id}:${itemId}`;
											const pointFor = (itemId: string) =>
												gridPoints[keyFor(itemId)] ??
												gridStartPoint(xAxis, yAxis);
											const isSkipped = (itemId: string) =>
												statementVotes[keyFor(itemId)] === "__skip__";
											/**
											 * Where the server has this item — decoded from the
											 * value the vote was accepted with, never from the
											 * slider, which moves whether or not a submission
											 * landed. Null until the participant has placed it.
											 */
											const acceptedFor = (itemId: string) =>
												acceptedGridPoint(
													statementVotes[keyFor(itemId)],
													xAxis,
													yAxis,
												);
											const setPoint = (
												itemId: string,
												next: { x: number; y: number },
											) =>
												setGridPoints((prev) => ({
													...prev,
													[keyFor(itemId)]: next,
												}));
											return (
												<div className="w-full space-y-5">
													<p className="text-sm text-text-muted text-center">
														{t.gridInstruction}
													</p>
													<GridPlot
														xAxis={xAxis}
														yAxis={yAxis}
														className="mx-auto max-w-xs"
														marks={ownGridMarks({
															items,
															submittedValueFor: (itemId) =>
																statementVotes[keyFor(itemId)],
															xAxis,
															yAxis,
															titleFor: (item, point) =>
																`${item.text} — ${xTitle} ${point.x}, ${yTitle} ${point.y}`,
														})}
													/>
													<ol className="space-y-4">
														{items.map((item, itemIndex) => {
															const point = pointFor(item.id);
															const skipped = isSkipped(item.id);
															const accepted = acceptedFor(item.id);
															return (
																<li
																	key={item.id}
																	className={`space-y-2.5 rounded-lg border border-border bg-surface-raised px-3 py-3 transition-opacity duration-200${
																		skipped ? " opacity-40" : ""
																	}`}
																>
																	<div className="flex items-start justify-between gap-3">
																		<span className="flex min-w-0 items-baseline gap-2">
																			<span className="font-mono text-sm font-bold text-accent-text">
																				{itemIndex + 1}
																			</span>
																			<span className="min-w-0 break-words text-sm sm:text-base">
																				{item.text}
																			</span>
																		</span>
																		<div className="flex shrink-0 items-center gap-2">
																			{/* The confirmation states the placement
																			    the server accepted, not the one the
																			    slider is currently showing — a
																			    rejected or in-flight move must not
																			    wear a green check. */}
																			{accepted && !skipped && (
																				<span className="inline-flex items-center gap-1 text-xs text-success">
																					<Check size={12} />
																					{accepted.x}, {accepted.y}
																				</span>
																			)}
																			{skipped && (
																				<span className="text-xs text-text-muted">
																					{t.gridSkipped}
																				</span>
																			)}
																			{/* REQ050 — offered only where the
																			    organizer allowed it. */}
																			{allowSkip && (
																				<button
																					type="button"
																					className="text-xs text-text-muted hover:text-text underline"
																					onClick={() =>
																						handleGridSubmit(
																							item.id,
																							point,
																							true,
																						)
																					}
																					disabled={submitting}
																				>
																					{t.gridNotAssessable}
																				</button>
																			)}
																		</div>
																	</div>

																	{/* One slider per dimension. Each submits
																	    the whole coordinate on release, the way
																	    a scale statement submits on release. */}
																	{(
																		[
																			{
																				axisKey: "x",
																				axis: xAxis,
																				title: xTitle,
																				value: point.x,
																				withValue: (next: number) => ({
																					x: next,
																					y: point.y,
																				}),
																			},
																			{
																				axisKey: "y",
																				axis: yAxis,
																				title: yTitle,
																				value: point.y,
																				withValue: (next: number) => ({
																					x: point.x,
																					y: next,
																				}),
																			},
																		] as const
																	).map((dimension) => (
																		<div
																			// Keyed on the axis rather than its title:
																			// an author may name both dimensions the
																			// same thing, and two children may not
																			// share a key.
																			key={dimension.axisKey}
																			className="space-y-1"
																		>
																			<div className="flex items-baseline justify-between gap-2 text-xs">
																				<span className="min-w-0 truncate text-text-muted">
																					{dimension.title}
																				</span>
																				<span className="font-mono text-text">
																					{dimension.value}
																				</span>
																			</div>
																			<input
																				type="range"
																				min={dimension.axis.min}
																				max={dimension.axis.max}
																				value={dimension.value}
																				onChange={(event) =>
																					setPoint(
																						item.id,
																						dimension.withValue(
																							Number(event.target.value),
																						),
																					)
																				}
																				onPointerUp={(event) =>
																					handleGridSubmit(
																						item.id,
																						dimension.withValue(
																							Number(
																								(
																									event.target as HTMLInputElement
																								).value,
																							),
																						),
																					)
																				}
																				onKeyUp={(event) =>
																					handleGridSubmit(
																						item.id,
																						dimension.withValue(
																							Number(
																								(
																									event.target as HTMLInputElement
																								).value,
																							),
																						),
																					)
																				}
																				className="w-full"
																				aria-label={`${item.text} — ${dimension.title}`}
																			/>
																			{/* The poles, named or numeric
																			    (REQ049). */}
																			<div className="flex justify-between gap-2 text-[11px] text-text-dim">
																				<span className="truncate">
																					{gridEndLabel(
																						dimension.axis.minLabel,
																						dimension.axis.min,
																					)}
																				</span>
																				<span className="truncate">
																					{gridEndLabel(
																						dimension.axis.maxLabel,
																						dimension.axis.max,
																					)}
																				</span>
																			</div>
																		</div>
																	))}
																</li>
															);
														})}
													</ol>
												</div>
											);
										})()
									: slide.type === "points"
										? (() => {
												// REQ044/REQ045: the participant splits one fixed
												// budget across the items. Points are moved with
												// +/− steppers and a number field rather than with
												// per-item sliders: sliders would each look
												// independent while in fact competing for the same
												// 100, so dragging one would silently have to move
												// the others — and on a phone a row of sliders
												// competes with the page scroll besides. The
												// running remainder sits above the list, adjacent
												// to what it governs (ADR-0031), because it is the
												// only number that tells a participant whether they
												// are done.
												const items = slide.pointsItems ?? [];
												const allocation = pointsAllocationFor(
													items,
													pointsAllocations[slide.id],
												);
												const remaining = pointsRemainingIn(allocation);
												const setAllocation = (
													next: Record<string, number>,
												) =>
													setPointsAllocations((prev) => ({
														...prev,
														[slide.id]: next,
													}));
												const adjust = (itemId: string, delta: number) =>
													setAllocation(
														withPointsAdjusted(allocation, itemId, delta),
													);
												return (
													<div className="w-full space-y-4">
														<p className="text-sm text-text-muted text-center">
															{t.pointsInstruction}
														</p>
														{/* The budget, and what is left of it. */}
														<div className="flex items-baseline justify-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2">
															<span className="font-mono text-2xl font-bold text-accent-text tabular-nums">
																{remaining}
															</span>
															<span className="text-sm text-text-muted">
																/ {POINTS_BUDGET} {t.pointsRemaining}
															</span>
														</div>
														<ol className="space-y-2">
															{items.map((item, itemIndex) => {
																const points = allocation[item.id];
																const atZero = points === 0;
																const budgetSpent = remaining === 0;
																return (
																	<li
																		key={item.id}
																		className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2.5"
																	>
																		<span
																			className={`min-w-0 flex-1 break-words text-left ${
																				item.text ? "" : "text-text-dim italic"
																			}`}
																		>
																			{item.text || `Item ${itemIndex + 1}`}
																		</span>
																		{/* ADR-0025: a stepper that cannot act
																		    right now stays put, disabled, and says
																		    why — an item at zero has nothing to
																		    take back, and a spent budget has
																		    nothing left to give. */}
																		<div className="flex shrink-0 items-center gap-1">
																			<button
																				type="button"
																				className="text-text-dim hover:text-text disabled:opacity-30 disabled:hover:text-text-dim transition-colors p-2 rounded-lg hover:bg-surface-hover"
																				onClick={() =>
																					adjust(item.id, -POINTS_STEP)
																				}
																				disabled={atZero}
																				title={
																					atZero
																						? t.pointsAtZero
																						: `Take ${POINTS_STEP} points back`
																				}
																				aria-label={`Take ${POINTS_STEP} points from ${
																					item.text || `item ${itemIndex + 1}`
																				}`}
																			>
																				<Minus size={16} />
																			</button>
																			<input
																				type="number"
																				min={0}
																				max={points + remaining}
																				value={points}
																				onChange={(event) =>
																					adjust(
																						item.id,
																						Math.round(
																							Number(event.target.value) || 0,
																						) - points,
																					)
																				}
																				className="input w-16 text-center font-mono tabular-nums"
																				aria-label={`Points for ${
																					item.text || `item ${itemIndex + 1}`
																				}`}
																			/>
																			<button
																				type="button"
																				className="text-text-dim hover:text-text disabled:opacity-30 disabled:hover:text-text-dim transition-colors p-2 rounded-lg hover:bg-surface-hover"
																				onClick={() =>
																					adjust(item.id, POINTS_STEP)
																				}
																				disabled={budgetSpent}
																				title={
																					budgetSpent
																						? t.pointsNoneLeft
																						: `Give ${POINTS_STEP} points`
																				}
																				aria-label={`Give ${POINTS_STEP} points to ${
																					item.text || `item ${itemIndex + 1}`
																				}`}
																			>
																				<Plus size={16} />
																			</button>
																		</div>
																	</li>
																);
															})}
														</ol>
														<button
															type="button"
															className="btn-primary w-full"
															onClick={() => handlePointsSubmit(allocation)}
															disabled={submitting || remaining !== 0}
															title={
																remaining === 0 ? undefined : t.pointsSpendAll
															}
														>
															{hasVoted ? t.pointsUpdate : t.pointsSubmit}
														</button>
														{/* The disabled button's reason, spelled out
														    rather than left to a tooltip a touch device
														    never shows (ADR-0025). */}
														{remaining !== 0 && (
															<p className="text-center text-xs text-text-dim">
																{t.pointsSpendAll}
															</p>
														)}
														{hasVoted && remaining === 0 && (
															<p className="text-sm text-success text-center vote-pop">
																{t.pointsSubmitted}
															</p>
														)}
													</div>
												);
											})()
										: slide.type === "guess-number"
											? (() => {
												// REQ039–REQ043: one number, typed inside the frame
												// the organizer authored. The range and the step are
												// stated above the field rather than left to be
												// discovered by a rejected submission, and the plus
												// and minus controls move by exactly one authored
												// step so the selectable values are something the
												// participant can feel.
												const range = guessRangeFor(slide);
												const entry = guessEntries[slide.id] ?? "";
												const issue = guessEntryIssue(entry, range);
												const issueMessage: Record<
													NonNullable<GuessEntryIssue>,
													string
												> = {
													"unusable-range": t.guessNoValues,
													empty: t.guessEnterNumber,
													"not-whole": t.guessWholeNumber,
													"out-of-range": t.guessOutOfRange,
													"off-step": t.guessOffStep,
												};
												const setEntry = (next: string) =>
													setGuessEntries((prev) => ({
														...prev,
														[slide.id]: next,
													}));
												const adjust = (direction: -1 | 1) =>
													setEntry(withGuessAdjusted(entry, range, direction));
												return (
													<div className="w-full space-y-4">
														<p className="text-sm text-text-muted text-center">
															{t.guessInstruction}
														</p>
														<div className="flex items-center justify-center gap-2">
															{/* ADR-0025: the steppers are always actionable —
															    they clamp to the ends of the range rather than
															    switching off at them, so neither ever sits
															    dead. */}
															<button
																type="button"
																className="text-text-dim hover:text-text transition-colors p-3 rounded-lg hover:bg-surface-hover"
																onClick={() => adjust(-1)}
																title={`−${range.step}`}
																aria-label={`Lower the guess by ${range.step}`}
															>
																<Minus size={18} />
															</button>
															<input
																type="number"
																inputMode="numeric"
																min={range.min}
																max={range.max}
																step={range.step}
																value={entry}
																placeholder={String(middleGuessValue(range))}
																onChange={(event) => setEntry(event.target.value)}
																className="input w-32 text-center font-mono text-2xl tabular-nums"
																aria-label={t.guessInstruction}
															/>
															<button
																type="button"
																className="text-text-dim hover:text-text transition-colors p-3 rounded-lg hover:bg-surface-hover"
																onClick={() => adjust(1)}
																title={`+${range.step}`}
																aria-label={`Raise the guess by ${range.step}`}
															>
																<Plus size={18} />
															</button>
														</div>
														{/* The frame, stated before it is hit — a
														    participant should not have to discover the range
														    or the step by being refused (REQ040/REQ043). */}
														<p className="text-center text-xs text-text-dim">
															{`${t.guessAllowedRange}: ${range.min}–${range.max}`}
															{range.step > 1
																? ` · ${t.guessStepHint} ${range.step}`
																: ""}
														</p>
														<button
															type="button"
															className="btn-primary w-full"
															onClick={() => handleGuessSubmit(Number(entry.trim()))}
															disabled={submitting || issue !== null}
															title={issue ? issueMessage[issue] : undefined}
														>
															{hasVoted ? t.guessUpdate : t.guessSubmit}
														</button>
														{/* The disabled button's reason, spelled out rather
														    than left to a tooltip a touch device never shows
														    (ADR-0025). */}
														{issue !== null && (
															<p className="text-center text-xs text-text-dim">
																{issueMessage[issue]}
															</p>
														)}
														{hasVoted && issue === null && (
															<p className="text-sm text-success text-center vote-pop">
																{t.guessSubmitted}
															</p>
														)}
													</div>
												);
											})()
											: slide.type === "pin-image"
												? (() => {
													// REQ051/REQ052: one point on the organizer's image.
													// The picture is the control — a tap on it *is* the
													// answer — and the pair of sliders under it is the
													// same answer reached by keyboard (see PIN_STEP above
													// for why that is offered beside the tap rather than
													// instead of it).
													//
													// The marker shows the pin the *server accepted*, never
													// where the participant last touched: a tap that was
													// refused, or is still in flight, must not wear a
													// confirmed pin — the same discipline the grid's dots
													// keep.
													const image = pinImageFor(slide);
													// REQ053 — present only once the organizer's reveal has
													// sent it at all (`withAudienceSolutions`), so a
													// participant aiming at the target cannot read it off
													// their own screen beforehand.
													const area = pinAreaFor(slide);
													const accepted = acceptedPin(voted[slide.id]);
													const point =
														pinPoints[slide.id] ?? accepted ?? pinStartPoint();
													const verdict = pinVerdict(accepted, area);
													const movePin = (next: { x: number; y: number }) =>
														setPinPoints((prev) => ({
															...prev,
															[slide.id]: next,
														}));
													return (
														<div className="w-full space-y-4">
															<p className="text-sm text-text-muted text-center">
																{image.url ? t.pinInstruction : t.pinNoImage}
															</p>
															<PinCanvas
																image={image}
																area={area}
																emptyLabel={t.pinNoImage}
																onPick={(picked) => handlePinSubmit(picked)}
																marks={
																	accepted
																		? [
																				{
																					key: "own",
																					x: accepted.x,
																					y: accepted.y,
																					title: `${t.pinPlaced} — ${pinCoordinateLabel(
																						accepted.x,
																					)}, ${pinCoordinateLabel(accepted.y)}`,
																				},
																			]
																		: []
																}
															/>
															{/* The keyboard path to the same answer. Each
															    slider submits on release, the way a grid
															    item's does. */}
															{image.url && (
																<div className="space-y-3">
																	{(
																		[
																			{
																				axisKey: "x",
																				title: t.pinHorizontal,
																				value: point.x,
																				withValue: (next: number) => ({
																					x: next,
																					y: point.y,
																				}),
																			},
																			{
																				axisKey: "y",
																				title: t.pinVertical,
																				value: point.y,
																				withValue: (next: number) => ({
																					x: point.x,
																					y: next,
																				}),
																			},
																		] as const
																	).map((dimension) => (
																		<div
																			key={dimension.axisKey}
																			className="space-y-1"
																		>
																			<div className="flex items-baseline justify-between gap-2 text-xs">
																				<span className="min-w-0 truncate text-text-muted">
																					{dimension.title}
																				</span>
																				<span className="font-mono text-text">
																					{pinCoordinateLabel(dimension.value)}
																				</span>
																			</div>
																			<input
																				type="range"
																				min={0}
																				max={PIN_COORDINATE_MAX}
																				step={PIN_STEP}
																				value={dimension.value}
																				onChange={(event) =>
																					movePin(
																						dimension.withValue(
																							Number(event.target.value),
																						),
																					)
																				}
																				onPointerUp={(event) =>
																					handlePinSubmit(
																						dimension.withValue(
																							Number(
																								(
																									event.target as HTMLInputElement
																								).value,
																							),
																						),
																					)
																				}
																				onKeyUp={(event) =>
																					handlePinSubmit(
																						dimension.withValue(
																							Number(
																								(
																									event.target as HTMLInputElement
																								).value,
																							),
																						),
																					)
																				}
																				className="w-full"
																				aria-label={dimension.title}
																			/>
																		</div>
																	))}
																</div>
															)}
															{/* What the server holds, and — once the target
															    area is known at all — what it did about it
															    (REQ053). */}
															{accepted && (
																<p className="flex items-center justify-center gap-1.5 text-sm text-success text-center vote-pop">
																	<Check size={14} />
																	{`${t.pinPlaced} — ${pinCoordinateLabel(
																		accepted.x,
																	)}, ${pinCoordinateLabel(accepted.y)}`}
																</p>
															)}
															{verdict && (
																<p
																	className={`flex items-center justify-center gap-1.5 text-center text-sm font-semibold ${
																		verdict === "inside"
																			? "text-success"
																			: "text-text-muted"
																	}`}
																>
																	{verdict === "inside" ? (
																		<Check size={16} />
																	) : (
																		<X size={16} />
																	)}
																	{verdict === "inside"
																		? t.pinInTarget
																		: t.pinOutsideTarget}
																</p>
															)}
														</div>
													);
												})()
												: slide.type === "form"
													? (() => {
														// REQ061 — several typed fields, filled in and sent
														// once. Unlike every other control here, nothing is
														// submitted as it is touched: the fields are one
														// answer, and half a form is a person interrupted.
														//
														// The submit button is disabled until the form is
														// one the boundary would accept, and always says
														// which rule is holding it (ADR-0025) — a form that
														// refuses to send without saying why is the worst
														// version of this slide type.
														const fields = formFieldsFor(slide);
														const answers = formEntries[slide.id] ?? {};
														const issue = formEntryIssue(fields, answers);
														const issueMessage: Record<FormEntryIssue, string> =
															{
																"no-fields": t.formNoFields,
																empty: t.formEnterSomething,
																required: t.formRequiredMissing,
																email: t.formInvalidEmail,
																"too-long": t.formAnswerTooLong,
															};
														const setAnswer = (
															fieldId: string,
															answer: string,
														) =>
															setFormEntries((prev) => ({
																...prev,
																[slide.id]: {
																	...(prev[slide.id] ?? {}),
																	[fieldId]: answer,
																},
															}));
														return (
															<div className="w-full space-y-4">
																{/* The instruction, whatever state the slide is in
																    — the same shape the guess branch keeps. A slide
																    with no fields yet is told so once, by the issue
																    line under the button, rather than twice by this
																    paragraph echoing it. */}
																<p className="text-sm text-text-muted text-center">
																	{t.formInstruction}
																</p>
																{fields.map((field) => {
																	const answer = answers[field.id] ?? "";
																	return (
																		<div key={field.id} className="space-y-1.5">
																			<label
																				className="block text-sm text-text"
																				htmlFor={`form-${slide.id}-${field.id}`}
																			>
																				{field.label}
																				{field.required && (
																					<span className="ml-1 text-accent-text">
																						{t.formRequiredMark}
																					</span>
																				)}
																			</label>
																			{field.type === "choice" ? (
																				<div className="flex flex-wrap gap-2">
																					{field.options.map((option) => {
																						const picked =
																							answer === option.id;
																						return (
																							<button
																								key={option.id}
																								type="button"
																								aria-pressed={picked}
																								onClick={() =>
																									setAnswer(
																										field.id,
																										// Tapping the picked
																										// option clears it, so
																										// an optional choice
																										// can be un-answered
																										// without reloading.
																										picked ? "" : option.id,
																									)
																								}
																								className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
																									picked
																										? "border-accent/50 bg-accent-dim text-text"
																										: "border-border bg-surface/40 text-text-muted hover:border-text-dim hover:text-text"
																								}`}
																							>
																								{option.text}
																							</button>
																						);
																					})}
																				</div>
																			) : (
																				<input
																					id={`form-${slide.id}-${field.id}`}
																					className="input w-full"
																					type={
																						field.type === "email"
																							? "email"
																							: "text"
																					}
																					inputMode={
																						field.type === "email"
																							? "email"
																							: undefined
																					}
																					autoComplete={
																						field.type === "email"
																							? "email"
																							: "off"
																					}
																					// The same bound the boundary enforces,
																					// so the cap arrives as a key that does
																					// nothing rather than as a rejected
																					// submission.
																					maxLength={FORM_ANSWER_MAX_LENGTH}
																					value={answer}
																					placeholder={field.label}
																					onChange={(event) =>
																						setAnswer(
																							field.id,
																							event.target.value,
																						)
																					}
																				/>
																			)}
																		</div>
																	);
																})}
																{/* Always rendered, never hidden (ADR-0025) —
																    including on a slide with no fields yet, where
																    it sits disabled and the line below says why.
																    A control that vanishes leaves a participant
																    with nothing to read the reason off. */}
																<button
																	type="button"
																	className="btn-primary w-full"
																	onClick={() => handleFormSubmit(answers)}
																	disabled={submitting || issue !== null}
																	title={issue ? issueMessage[issue] : undefined}
																>
																	{hasVoted ? t.formUpdate : t.formSubmit}
																</button>
																{/* The disabled button's reason, spelled out
																    rather than left to a tooltip a touch device
																    never shows (ADR-0025). */}
																{issue !== null && (
																	<p className="text-center text-xs text-text-dim">
																		{issueMessage[issue]}
																	</p>
																)}
																{hasVoted && issue === null && (
																	<p className="text-sm text-success text-center vote-pop">
																		{t.formSubmitted}
																	</p>
																)}
																{/* What happens to what they wrote, said on the
																    screen where they write it. A form asks for a
																    name and an address; the person handing them
																    over is owed the sentence. */}
																<p className="text-center text-xs text-text-dim">
																	{t.formPrivacyNote}
																</p>
															</div>
														);
													})()
													: null}

				{/* Show results after voting (for multiple-choice / quiz / scale).
		    Nothing is drawn here under a mode that never publishes a tally
		    (REQ017) or has not published this one yet (REQ016) — and under
		    those modes nothing was sent either, so there is nothing to draw.
		    Scale note: single-statement votes land in `voted`; multi-
		    statement votes land in `statementVotes` keyed by slideId —
		    so we check both to decide whether the participant has voted.
		    Multi-statement: results only shown once ALL statements have
		    been answered or skipped.
		    Survey mode: results on any slide are gated until ALL
		    interactive slides have been answered or skipped, so
		    participants cannot peek at results mid-survey. */}
				{(hasVoted ||
					// Quiz: once the question closes the tally is shown to
					// everyone in the room, including whoever did not answer in
					// time — being late is not a reason to be kept from the
					// solution the rest of the room is now looking at.
					(isQuizSlide && quizCountdown.expired) ||
					(slide.type === "scale" &&
						(slide.scaleStatements ?? []).length > 0 &&
						(slide.scaleStatements ?? []).every(
							(st) => `${slide.id}:${st.id}` in statementVotes,
						)) ||
					// 2x2 Grid: every item placed or marked not assessable —
					// its votes land in `statementVotes` per item, never in
					// `voted`, exactly like a multi-statement scale's.
					(slide.type === "grid" &&
						(slide.gridItems ?? []).length > 0 &&
						(slide.gridItems ?? []).every(
							(item) => `${slide.id}:${item.id}` in statementVotes,
						))) &&
					// A form slide is deliberately absent from this list (REQ061): its
					// tally is per-field answer counts, which tells the person who just
					// filled it in nothing they did not already know, and its
					// submissions are never sent to a phone at all.
					(slide.type === "multiple-choice" ||
						slide.type === "quiz" ||
						slide.type === "open-text" ||
						slide.type === "word-cloud" ||
						slide.type === "scale" ||
						slide.type === "ranking" ||
						slide.type === "grid" ||
						slide.type === "points" ||
						slide.type === "guess-number" ||
						slide.type === "pin-image") &&
					(() => {
						if (!resultsReadyHere) return null;

						// Survey mode: show a hint until all slides are answered
						if (!allSlidesAnswered) {
							return (
								<div className="w-full mt-8 pt-6 border-t border-border text-center">
									<p className="text-sm text-text-muted">
										{t.completeAllToSeeResults}
									</p>
								</div>
							);
						}

						if (!results) return null;
						return (
							<div className="w-full mt-8 pt-6 border-t border-border">
								<p className="text-sm text-text-muted mb-4 text-center">
									{t.liveResults}
								</p>
								<ResultsDisplay
									slide={slide}
									results={results}
									onUpvote={handleUpvote}
									upvotedIds={upvoted}
								/>
							</div>
						);
					})()}
			</ParticipationGate>
		)}		</>
	);
}
