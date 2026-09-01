import { ArrowUp, Check, Hash, Percent, Trash2 } from "lucide-react";
import { type CSSProperties, useEffect, useRef } from "react";
import { POLL_COLORS } from "../constants";
import type {
	FormFieldType,
	GridAxis,
	GuessRange,
	McValueDisplay,
	PinArea,
	Slide,
	SlideType,
} from "../types";
import { quizAnswerModeFor, slideAnswersAreDeletable } from "../types";
import type { ChoiceOption } from "./EditorControls";
import { type GridMark, GridPlot } from "./GridPlot";
import { type GuessColumn, GuessDistribution } from "./GuessDistribution";
import { ICON_BUTTON_HOVER } from "./ShareCluster";
import {
	PinCanvas,
	pinCoordinateLabel,
	PinHeatLegend,
	type PinMark,
} from "./PinImage";
import {
	Leaderboard,
	LEADERBOARD_LABELS_EN,
	type LeaderboardLabels,
	readLeaderboard,
} from "./Leaderboard";

// ── Moderating what the room submitted (REQ027) ───────────────
//
// Taking one answer off a word cloud or an open-ended slide is one affordance
// worn by two renderings — a card in the response wall, a row in the cloud's
// answer list — so it is one descriptor, one wrapper and one guard (ADR-0026).
// The guard is `slideAnswersAreDeletable` in `server/schemas.ts`, which is also
// what the delete boundary refuses on, so no surface can offer a deletion the
// server would turn away.
//
// The descriptor's presence is what says "this is a moderation surface". A
// participant's phone passes none and draws no control — that is relevance, not
// availability (ADR-0025 §5): the room is never the moderator of the room. A
// spectator on the shared screen passes one whose `onDelete` is `null` and gets
// the control drawn, inert, saying why — they are looking at the very surface
// the action belongs to, and a button that came and went with who was watching
// would teach nobody what this screen can do.

/** What a surface may do to the individual answers it is drawing (REQ027). */
export type AnswerModeration = {
	/**
	 * Delete one answer by its id, or `null` for a viewer who may not — this
	 * deck's spectator, who sees the control disabled with its reason.
	 */
	onDelete: ((answerId: string) => void) | null;
	/** Why it is inert, drawn on the control itself when `onDelete` is `null`. */
	disabledReason: string;
};

/**
 * Why a viewer of the shared screen who does not hold the deck cannot take an
 * answer down. One wording, because the control is worn by two renderings and
 * two spellings of a refusal are two explanations of one rule (ADR-0026).
 */
export const ANSWER_MODERATION_DENIED =
	"Delete this answer — you cannot edit this presentation, so what the room submitted to it is not yours to remove";

/**
 * Whether this surface moderates the answers it is about to draw, and on what
 * terms (REQ027) — the single descriptor every surface composes rather than
 * assembling its own.
 *
 * Two conditions turn it off entirely, and each for its own reason:
 *
 *  - **Nothing stored to delete** (`onDelete: null` at the call site) — the dry
 *    run, whose answers were generated for it and never written. Deleting one
 *    would delete nothing, and regenerating would put it back.
 *  - **A slide type this is not offered on**, decided by
 *    {@link slideAnswersAreDeletable} — the very predicate the delete boundary
 *    refuses on, so no surface can offer a deletion the server would turn away.
 *
 * A **spectator** is not one of them: they keep the control and get it inert
 * with its reason (ADR-0025), because they are looking at the surface the action
 * belongs to. Absent is for the surfaces where the action is not relevant at
 * all — a participant's phone is never the moderator of the room.
 */
export function answerModerationFor({
	slideType,
	canControl,
	onDelete,
}: {
	slideType: SlideType;
	/** Whether this viewer holds the deck. A spectator gets the inert control. */
	canControl: boolean;
	/** The deletion itself, or `null` on a surface with nothing stored behind it. */
	onDelete: ((answerId: string) => void) | null;
}): AnswerModeration | undefined {
	if (!onDelete) return undefined;
	if (!slideAnswersAreDeletable(slideType)) return undefined;
	return {
		onDelete: canControl ? onDelete : null,
		disabledReason: ANSWER_MODERATION_DENIED,
	};
}

/**
 * The one control that takes an answer down, worn by both renderings of one.
 *
 * Always drawn where a moderation surface is drawing answers, and disabled with
 * its reason rather than removed when this viewer cannot use it (ADR-0025).
 * `title` **and** `aria-label` carry the reason, so it reaches a pointer and a
 * screen reader alike; the button keeps its place either way, so enabling it
 * moves nothing on the projector.
 */
export function RemoveAnswerButton({
	answerId,
	answerText,
	moderation,
}: {
	answerId: string;
	/** The text being removed, so the control names what it will take down. */
	answerText: string;
	moderation: AnswerModeration;
}) {
	const label = moderation.onDelete
		? `Delete this answer — "${answerText}" is removed from the tally the room sees and from every export`
		: moderation.disabledReason;
	return (
		<button
			type="button"
			className={`flex-shrink-0 ${ICON_BUTTON_HOVER} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text-muted`}
			title={label}
			aria-label={label}
			aria-disabled={!moderation.onDelete}
			disabled={!moderation.onDelete}
			onClick={() => moderation.onDelete?.(answerId)}
		>
			<Trash2 size={13} />
		</button>
	);
}

/** One individual answer on a word-cloud slide, as an editor reads it (REQ027). */
export type WordCloudAnswer = {
	id: string;
	text: string;
	createdAt: string;
};

/**
 * The individual answers behind a word cloud, listed so one of them can be
 * taken down (REQ027).
 *
 * Drawn only on a moderation surface, and it has to exist at all because the
 * cloud above it is an aggregate: "pizza (3)" names no row, so there is nothing
 * up there for a deletion to point at. Each row shows the text **as it was
 * submitted** rather than the folded lower-case the cloud draws — the decision
 * being taken is about the line somebody actually typed.
 *
 * Sits directly under the cloud it moderates (ADR-0031) and scrolls rather than
 * pushing the slide off the screen, like the response wall beside it.
 */
export function WordCloudAnswerList({
	answers,
	moderation,
}: {
	answers: WordCloudAnswer[];
	moderation: AnswerModeration;
}) {
	if (answers.length === 0) return null;
	return (
		<div className="mt-6 border-t border-border pt-4">
			<p className="text-xs uppercase tracking-wide text-text-dim mb-2">
				{answers.length} submitted {answers.length === 1 ? "answer" : "answers"}
			</p>
			<ul
				className="flex flex-wrap gap-2 overflow-y-auto pr-1"
				style={{ maxHeight: "min(12rem, 30vh)" }}
			>
				{answers.map((answer) => (
					<li
						key={answer.id}
						className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm"
					>
						<span className="min-w-0 break-words">{answer.text}</span>
						<RemoveAnswerButton
							answerId={answer.id}
							answerText={answer.text}
							moderation={moderation}
						/>
					</li>
				))}
			</ul>
		</div>
	);
}

// ── Results display ──────────────────────────────────────────

export function ResultsDisplay({
	slide,
	results,
	onUpvote,
	upvotedIds,
	moderation,
	valueDisplay,
	leaderboardLabels = LEADERBOARD_LABELS_EN,
	highlightEntryId = null,
}: {
	slide: Slide;
	results: any;
	/** Optional callback to upvote an open-text response (REQ025). */
	onUpvote?: (responseId: string) => void;
	/** IDs of responses the current participant has upvoted. */
	upvotedIds?: Set<string>;
	/**
	 * What this surface may do to the individual answers it draws (REQ027).
	 * Absent on every surface that is not an editor's — a participant's phone,
	 * a segment breakdown, the read-only results page — which is why the control
	 * is not there at all rather than there and inert (ADR-0025 §5).
	 */
	moderation?: AnswerModeration;
	/**
	 * Live override of the slide's authored count/percentage setting (REQ011) —
	 * what the presenter switched the shared screen to. Absent everywhere else,
	 * where the authored default stands.
	 */
	valueDisplay?: McValueDisplay;
	/**
	 * The leaderboard's wording (REQ059). The shared screen keeps the English
	 * default; a participant's phone passes the deck's language (REQ084).
	 */
	leaderboardLabels?: LeaderboardLabels;
	/**
	 * The reader's own row on the leaderboard, when they have one. `null` on the
	 * shared screen, which has nobody to pick out.
	 */
	highlightEntryId?: string | null;
}) {
	switch (slide.type) {
		case "multiple-choice":
		case "quiz":
			// A quiz answered by typing (REQ055) has no options to draw bars for:
			// its result is what the room wrote. The score note underneath is the
			// same one either way, so both go through the same block.
			if (quizAnswerModeFor(slide) === "type") {
				return <TypedQuizResults results={results} />;
			}
			return (
				<ChoiceResults
					style={slide.mcDisplayStyle ?? "bars"}
					results={results}
					valueDisplay={valueDisplay ?? slide.mcValueDisplay ?? "both"}
					authoredOptions={slide.options}
				/>
			);
		case "word-cloud":
			return (
				<WordCloudResults
					words={results.words}
					// The per-answer list is on the payload only for a caller who can
					// edit the deck, so a moderation surface reading a tally it fetched
					// without credentials simply has no list to draw (ADR-0024 — the
					// key is there and null, not missing).
					answers={results.answers ?? null}
					moderation={moderation}
				/>
			);
		case "open-text":
			return (
				<OpenTextResults
					responses={results.responses}
					layout={results.layout ?? slide.openTextLayout ?? "speech-bubbles"}
					allowVotes={
						!!(results.allowResponseVotes ?? slide.allowResponseVotes)
					}
					onUpvote={onUpvote}
					upvotedIds={upvotedIds}
					moderation={moderation}
				/>
			);
		case "scale":
			return <ScaleResults results={results} />;
		case "ranking":
			return <RankingResults results={results} />;
		case "grid":
			return <GridResults results={results} />;
		case "points":
			return <PointsResults results={results} />;
		case "guess-number":
			return <GuessNumberResults results={results} />;
		case "pin-image":
			return <PinImageResults results={results} />;
		case "form":
			// REQ061 — the fill rate. What people wrote never reaches a screen; see
			// the block above FormResults for why the rendering does not exist.
			return <FormResults results={results} />;
		case "leaderboard":
			// REQ059 — the one slide whose "results" are not its own votes but the
			// deck's standings across every quiz question before it.
			return (
				<Leaderboard
					board={readLeaderboard(results)}
					labels={leaderboardLabels}
					highlightEntryId={highlightEntryId}
				/>
			);
		case "text":
		case "image":
		case "video":
		case "embed":
		case "instruction":
			// Content slides have no aggregated results — presenter/participant
			// render the slide body directly.
			return null;
		default:
			return <div className="text-text-dim">Unknown slide type</div>;
	}
}

// ── Choice results (multiple-choice / quiz) ───────────────────
//
// One tally, four visualizations (REQ010). Everything the four share — the
// per-option datum, the percentage basis, how a value is spelled out (REQ011),
// and the correct-answer mark (REQ013) — lives here once and is composed by
// each renderer (ADR-0026), so switching style never changes what a result
// *says*, only how it is drawn.

/** One option's tally as the results endpoint reports it. */
export type ChoiceResultOption = {
	id: string;
	text: string;
	count: number;
	/**
	 * REQ013 — `true`/`false` once the slide has a solution to reveal, and an
	 * explicit `null` when it has no notion of correctness at all (ADR-0024).
	 */
	isCorrect: boolean | null;
};

/**
 * How the room scored on a quiz question (REQ056), as the results endpoint
 * reports it — anonymously: how many answered, how many were right, and what
 * they averaged, never who. `null` on a plain choice slide, which can reveal a
 * solution (REQ013) without keeping score.
 */
export type ChoiceScoring = {
	answeredCount: number;
	correctCount: number;
	totalPoints: number;
	maxPoints: number;
	/** Both `null` until somebody has answered (ADR-0024). */
	averagePoints: number | null;
	correctShare: number | null;
};

/** The whole choice tally, normalized from the untyped results payload. */
type ChoiceTally = {
	options: ChoiceResultOption[];
	/** Selections cast. With multi-select this exceeds the head count. */
	totalVotes: number;
	/** Distinct participants who answered — the percentage denominator. */
	respondentCount: number;
	/** Options one participant may select: 1 single, 0 unlimited, n capped. */
	maxSelections: number;
	/** The quiz score behind those answers, or `null` on a plain choice slide. */
	scoring: ChoiceScoring | null;
};

/**
 * The count / percentage / both descriptor (REQ011). One list, worn by the
 * editor's authored default and by the presenter's live switch on the shared
 * screen (ADR-0026), so the two can never offer different choices.
 */
export const MC_VALUE_DISPLAY_OPTIONS: ChoiceOption<McValueDisplay>[] = [
	{ value: "count", label: "Count", icon: <Hash size={14} /> },
	{ value: "percentage", label: "Percent", icon: <Percent size={14} /> },
	{ value: "both", label: "Both" },
];

/**
 * A choice tally as it arrives over the wire: JSON, so every field is nominally
 * optional until it has been read through {@link readChoiceTally}.
 */
type ChoiceTallyPayload = Partial<ChoiceTally> | null | undefined;

/**
 * Read the wire payload into a tally with every field present.
 *
 * `authored` is the slide this client already holds, and it is the fallback for
 * a solution the payload withholds (REQ056). A quiz tally reports `isCorrect`
 * as `null` while the question is running, and the broadcast that follows every
 * answer carries that same withheld shape to *everyone* — including the
 * presenter, whose authenticated poll had just supplied the real one. Falling
 * back to the deck in hand keeps the shared screen's correct mark steady
 * between the two, and tells a participant nothing new: their copy of the deck
 * is redacted by the same rule.
 */
function readChoiceTally(
	results: ChoiceTallyPayload,
	authored: { id: string; isCorrect?: boolean | undefined }[] = [],
): ChoiceTally {
	const totalVotes = results?.totalVotes ?? 0;
	const authoredCorrect = new Map(
		authored.map((option) => [option.id, option.isCorrect === true]),
	);
	return {
		options: (results?.options ?? []).map((option) => ({
			...option,
			isCorrect:
				option.isCorrect ?? (authoredCorrect.get(option.id) ? true : null),
		})),
		totalVotes,
		// A payload from before REQ014 carries no head count; single-select made
		// one vote one participant, so the two were the same number.
		respondentCount: results?.respondentCount ?? totalVotes,
		maxSelections: results?.maxSelections ?? 1,
		// A payload from before quiz scoring carries none, which reads the same as
		// a plain choice slide's: this tally keeps no score.
		scoring: results?.scoring ?? null,
	};
}

/**
 * An option's share, as a percentage of the **participants who answered** —
 * not of the selections cast. On an "all that apply" slide (REQ014) a person
 * contributes several selections, and "62% of the room picked this" is the
 * figure that survives that; a share of selections would silently shrink every
 * option as participants tick more boxes. On a single-select slide the two
 * denominators are equal, so this is the familiar number.
 */
function shareOfRespondents(count: number, respondentCount: number): number {
	return respondentCount > 0 ? (count / respondentCount) * 100 : 0;
}

/** Spell an option's tally the way the slide (or the presenter) asked (REQ011). */
export function formatChoiceValue(
	count: number,
	share: number,
	display: McValueDisplay,
): string {
	const percentage = `${Math.round(share)}%`;
	if (display === "count") return String(count);
	if (display === "percentage") return percentage;
	return `${count} (${percentage})`;
}

/** The solution mark a correct option wears once results are on screen (REQ013). */
function CorrectMark({ compact = false }: { compact?: boolean }) {
	if (compact) {
		return (
			<span className="text-success" title="Correct answer">
				<Check size={12} />
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-xs text-success font-mono">
			<Check size={12} />
			correct
		</span>
	);
}

/**
 * The footnote a multi-select slide needs so its percentages read correctly:
 * they are shares of the people who answered and deliberately sum past 100%.
 */
function MultiSelectNote({ tally }: { tally: ChoiceTally }) {
	if (tally.maxSelections === 1) return null;
	const limit =
		tally.maxSelections === 0
			? "any number of options"
			: `up to ${tally.maxSelections} options`;
	return (
		<p className="mt-4 text-center text-xs text-text-dim">
			Participants could select {limit} — percentages are of the{" "}
			{tally.respondentCount} who answered, so they add up to more than 100%.
		</p>
	);
}

/**
 * How the room scored, under a quiz question's tally (REQ056).
 *
 * The two numbers are deliberately both there: how many knew it, and what the
 * room averaged — which the first cannot give, because the speed component
 * (REQ054) separates two rooms that both answered correctly. Nobody is named;
 * a participant's own result is theirs alone, on their own screen.
 */
function QuizScoreNote({ scoring }: { scoring: ChoiceScoring | null }) {
	if (!scoring) return null;
	// Before anyone has answered there is nothing to report — and an "0 of 0
	// correct" would read as a room that answered and got everything wrong.
	if (scoring.answeredCount === 0) return null;
	const average = scoring.averagePoints ?? 0;
	return (
		<p className="mt-4 text-center text-sm text-text-muted">
			<span className="text-success font-semibold">
				{scoring.correctCount} of {scoring.answeredCount}
			</span>{" "}
			answered correctly · {Math.round(average)} of {scoring.maxPoints} points
			on average
		</p>
	);
}

/**
 * The one-line response count shown above a slide's results. Multi-select
 * choice slides (REQ014) say both numbers, because "7 responses" from four
 * people reads as seven people otherwise.
 */
export function describeResponses(
	slide: Slide,
	results: ChoiceTallyPayload,
): string {
	const total = results?.totalVotes ?? 0;
	const responses = `${total} response${total === 1 ? "" : "s"}`;
	if (slide.type !== "multiple-choice" && slide.type !== "quiz") {
		return responses;
	}
	const tally = readChoiceTally(results);
	if (tally.maxSelections === 1) return responses;
	const people = tally.respondentCount;
	return `${responses} from ${people} participant${people === 1 ? "" : "s"}`;
}

/** Pick a visualization for the tally and render it (REQ010). */
export function ChoiceResults({
	style,
	results,
	valueDisplay,
	authoredOptions,
}: {
	style: NonNullable<Slide["mcDisplayStyle"]>;
	results: ChoiceTallyPayload;
	valueDisplay: McValueDisplay;
	/** The slide's own options — the fallback for a withheld solution (REQ056). */
	authoredOptions?: { id: string; isCorrect?: boolean | undefined }[];
}) {
	const tally = readChoiceTally(results, authoredOptions);
	return (
		<div>
			{style === "dots" ? (
				<DotsResults tally={tally} valueDisplay={valueDisplay} />
			) : style === "pie" || style === "donut" ? (
				<SliceResults tally={tally} valueDisplay={valueDisplay} shape={style} />
			) : (
				<BarChartResults tally={tally} valueDisplay={valueDisplay} />
			)}
			<MultiSelectNote tally={tally} />
			<QuizScoreNote scoring={tally.scoring} />
		</div>
	);
}

// ── Typed quiz answers (REQ055) ───────────────────────────────

/** One answer the room typed, as the results endpoint groups them. */
type TypedQuizEntry = {
	/** The first spelling that arrived in this group — words somebody typed. */
	text: string;
	count: number;
	/** `true`/`false` once the key may be seen; the whole list is withheld before. */
	isCorrect: boolean | null;
};

/**
 * What the room typed on a free-text quiz question (REQ055), as the endpoint
 * reports it. `accepted` and `entries` are `null` together while the question is
 * still running: on a typed question the answer most of the room gave *is* the
 * answer, so it is withheld on the same gate as the key itself (ADR-0024 —
 * withheld is an explicit `null`, not an empty list that would claim nobody
 * answered).
 */
type TypedQuizTally = {
	accepted: string[] | null;
	entries: TypedQuizEntry[] | null;
	distinctCount: number;
};

/**
 * The room's typed answers, most-given first, each with the verdict the score
 * was computed from.
 *
 * Before the question is over there is nothing to draw and that is deliberate,
 * not a loading state: this is a shared screen, and a list of typed answers on
 * the projector would hand the room the answer it is being scored on. The score
 * line still reports how many have answered, which is what a presenter is
 * actually watching for.
 */
function TypedQuizResults({ results }: { results: any }) {
	const tally: TypedQuizTally = results?.typedAnswers ?? {
		accepted: null,
		entries: null,
		distinctCount: 0,
	};
	const scoring: ChoiceScoring | null = results?.scoring ?? null;
	const answeredCount = scoring?.answeredCount ?? results?.totalVotes ?? 0;

	if (!tally.entries) {
		return (
			<div>
				<p className="py-10 text-center text-text-dim">
					{answeredCount === 0
						? "No answers yet"
						: `${answeredCount} answer${answeredCount === 1 ? "" : "s"} in — they appear once the question is over.`}
				</p>
				<QuizScoreNote scoring={scoring} />
			</div>
		);
	}

	const mostGiven = tally.entries[0]?.count ?? 0;
	return (
		<div>
			{tally.entries.length === 0 ? (
				<p className="py-10 text-center text-text-dim">No answers yet</p>
			) : (
				<div className="space-y-3">
					{tally.entries.map((entry) => (
						<div key={entry.text} className="slide-in">
							<div className="mb-1 flex items-center justify-between gap-3">
								<span className="flex min-w-0 items-center gap-2">
									<span className="truncate font-medium">{entry.text}</span>
									{entry.isCorrect && <CorrectMark />}
								</span>
								<span className="flex-shrink-0 font-mono text-sm text-text-muted">
									{entry.count}
								</span>
							</div>
							<div className="h-2.5 overflow-hidden rounded-full border border-border bg-surface-raised">
								<div
									className={`h-full rounded-full bar-fill ${
										entry.isCorrect ? "bg-success" : "bg-text-dim/40"
									}`}
									style={{
										width: `${mostGiven > 0 ? (entry.count / mostGiven) * 100 : 0}%`,
									}}
								/>
							</div>
						</div>
					))}
				</div>
			)}
			{/* The answer key itself, once it may be shown — an accepted answer
			    nobody gave is as much a part of the result as the ones they did. */}
			{tally.accepted && tally.accepted.length > 0 && (
				<p className="mt-4 text-center text-xs text-text-dim">
					Accepted: {tally.accepted.join(" · ")}
				</p>
			)}
			<QuizScoreNote scoring={scoring} />
		</div>
	);
}

// ── Bar chart results ─────────────────────────────────────────

export function BarChartResults({
	tally,
	valueDisplay,
}: {
	tally: ChoiceTally;
	valueDisplay: McValueDisplay;
}) {
	return (
		<div className="space-y-3">
			{tally.options.map((opt, i) => {
				const share = shareOfRespondents(opt.count, tally.respondentCount);
				const color = POLL_COLORS[i % POLL_COLORS.length];
				return (
					<div
						key={opt.id}
						className="slide-in"
						style={{ animationDelay: `${i * 0.05}s` }}
					>
						<div className="flex items-center justify-between mb-1">
							<span className="font-medium flex items-center gap-2">
								{opt.text}
								{opt.isCorrect && <CorrectMark />}
							</span>
							<span className="font-mono text-sm text-text-muted">
								{formatChoiceValue(opt.count, share, valueDisplay)}
							</span>
						</div>
						<div className="h-10 rounded-lg bg-surface-raised overflow-hidden border border-border">
							<div
								className="h-full rounded-lg bar-fill flex items-center pl-3"
								style={{ width: `${Math.max(share, 2)}%`, background: color }}
							/>
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ── Pie / donut results ───────────────────────────────────────
//
// A pie is a donut whose ring is as thick as its radius, so both shapes are the
// same drawing with two numbers changed (ADR-0027): a circle stroked segment by
// segment via `pathLength={100}`, which lets each slice be expressed directly
// in percent without touching trigonometry.
//
// Slice geometry divides by the **selections cast**, so the disc always closes;
// the printed value stays on the shared per-participant basis (see
// `shareOfRespondents`) and the multi-select footnote explains the difference.

const SLICE_VIEWBOX = 200;
const SLICE_CENTER = SLICE_VIEWBOX / 2;
/** Ring radius and thickness per shape — a pie's ring reaches the centre. */
const SLICE_GEOMETRY = {
	donut: { radius: 70, width: 40 },
	pie: { radius: 45, width: 90 },
} as const;

export function SliceResults({
	tally,
	valueDisplay,
	shape,
}: {
	tally: ChoiceTally;
	valueDisplay: McValueDisplay;
	shape: "pie" | "donut";
}) {
	const { radius, width } = SLICE_GEOMETRY[shape];
	// Slices are drawn clockwise from twelve o'clock; each one starts where the
	// previous ended, tracked as a running offset in the same percent units.
	let offset = 0;
	const slices = tally.options.map((opt, index) => {
		const length =
			tally.totalVotes > 0 ? (opt.count / tally.totalVotes) * 100 : 0;
		const slice = {
			option: opt,
			color: POLL_COLORS[index % POLL_COLORS.length],
			length,
			offset,
		};
		offset += length;
		return slice;
	});

	return (
		<div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-center sm:gap-8">
			<svg
				viewBox={`0 0 ${SLICE_VIEWBOX} ${SLICE_VIEWBOX}`}
				className="w-full max-w-[16rem] shrink-0"
				style={{ aspectRatio: "1 / 1" }}
				role="img"
				aria-label={`${shape === "pie" ? "Pie" : "Donut"} chart of results`}
			>
				<title>
					{tally.options
						.map(
							(opt) =>
								`${opt.text}: ${formatChoiceValue(
									opt.count,
									shareOfRespondents(opt.count, tally.respondentCount),
									valueDisplay,
								)}`,
						)
						.join(", ")}
				</title>
				{/* Track: keeps the shape readable before the first vote lands. */}
				<circle
					cx={SLICE_CENTER}
					cy={SLICE_CENTER}
					r={radius}
					fill="none"
					stroke="var(--color-surface-raised)"
					strokeWidth={width}
				/>
				<g transform={`rotate(-90 ${SLICE_CENTER} ${SLICE_CENTER})`}>
					{slices.map((slice) =>
						slice.length > 0 ? (
							<circle
								key={slice.option.id}
								cx={SLICE_CENTER}
								cy={SLICE_CENTER}
								r={radius}
								fill="none"
								stroke={slice.color}
								strokeWidth={width}
								pathLength={100}
								strokeDasharray={`${slice.length} ${100 - slice.length}`}
								strokeDashoffset={-slice.offset}
								className="slice-grow"
							/>
						) : null,
					)}
				</g>
				{shape === "donut" && (
					<text
						x={SLICE_CENTER}
						y={SLICE_CENTER}
						textAnchor="middle"
						dominantBaseline="central"
						className="fill-text"
						style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
						fontSize={28}
					>
						{tally.respondentCount}
					</text>
				)}
			</svg>

			{/* Legend — the tally in words, so the chart never has to be decoded. */}
			<ul className="w-full max-w-xs space-y-2">
				{slices.map((slice) => (
					<li
						key={slice.option.id}
						className="flex items-center justify-between gap-3"
					>
						<span className="flex min-w-0 items-center gap-2">
							<span
								className="h-2.5 w-2.5 shrink-0 rounded-full"
								style={{ background: slice.color }}
								aria-hidden
							/>
							<span className="truncate font-medium">{slice.option.text}</span>
							{slice.option.isCorrect && <CorrectMark compact />}
						</span>
						<span className="shrink-0 font-mono text-sm text-text-muted">
							{formatChoiceValue(
								slice.option.count,
								shareOfRespondents(slice.option.count, tally.respondentCount),
								valueDisplay,
							)}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

// ── Dots results (omul-style) ─────────────────────────────
//
// Renders one small coloured dot per vote per option, packed into a circular
// cluster using a Fibonacci/sunflower spiral so positions are deterministic
// per vote-index and the cluster grows organically as votes come in.
// The newest dots animate in with a pop so live votes are visible.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DOT_R = 7; // dot radius in svg units
// Spacing factor of 2.05 packs dots almost touching (2.0 = exactly touching for
// a sunflower lattice with the golden angle), giving a dense, magnetic cluster.
const DOT_SPACING = 2.05;

function dotPosition(i: number) {
	// Sunflower: r = c * sqrt(i), theta = i * GOLDEN_ANGLE.
	const r = DOT_R * DOT_SPACING * Math.sqrt(i + 0.5);
	const theta = i * GOLDEN_ANGLE;
	return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

function clusterRadius(count: number) {
	if (count <= 0) return DOT_R * 2;
	return DOT_R * DOT_SPACING * Math.sqrt(count) + DOT_R + 2;
}

export function DotsResults({
	tally,
	valueDisplay,
}: {
	tally: ChoiceTally;
	valueDisplay: McValueDisplay;
}) {
	const options = tally.options;
	// Track previous per-option counts. Read BEFORE the effect overwrites the
	// ref so the current render can mark indices >= prior as "new" and run the
	// pop-in animation exactly once. After paint, the effect snapshots the
	// current counts so the next render compares against them.
	const prevCountsRef = useRef<Record<string, number>>({});
	const priorCounts = prevCountsRef.current;
	useEffect(() => {
		const next: Record<string, number> = {};
		for (const opt of options) next[opt.id] = opt.count;
		prevCountsRef.current = next;
	});

	// Cluster size scales with the largest option so all clusters share a
	// consistent visual scale.
	const maxCount = Math.max(1, ...options.map((o) => o.count));
	const sharedRadius = clusterRadius(maxCount);
	const viewBox = sharedRadius * 2 + DOT_R * 4;
	const center = viewBox / 2;
	// New dots start outside the cluster and "fly in" toward their position.
	// Distance is relative to the cluster radius so the entry feels consistent.
	const flyDist = sharedRadius * 1.6 + DOT_R * 4;

	return (
		<div
			className="grid gap-4"
			style={{
				gridTemplateColumns: `repeat(auto-fit, minmax(min(14rem, 100%), 1fr))`,
			}}
		>
			{options.map((opt, i) => {
				const color = POLL_COLORS[i % POLL_COLORS.length];
				const share = shareOfRespondents(opt.count, tally.respondentCount);
				const prior = priorCounts[opt.id] ?? 0;
				return (
					<div
						key={opt.id}
						className="flex flex-col items-center gap-2 p-3 rounded-lg bg-surface-raised border border-border slide-in"
						style={{ animationDelay: `${i * 0.05}s` }}
					>
						<svg
							viewBox={`0 0 ${viewBox} ${viewBox}`}
							className="w-full max-w-[14rem] dots-cluster"
							style={{ aspectRatio: "1 / 1" }}
							role="img"
							aria-label={`${opt.text}: ${opt.count} votes`}
						>
							{/* Soft halo behind the cluster — gives the dots something to
							    sit on and reinforces the "they belong together" feel. */}
							{opt.count > 0 && (
								<circle
									cx={center}
									cy={center}
									r={clusterRadius(opt.count)}
									fill={color}
									opacity={0.08}
									className="dots-halo"
								/>
							)}
							{Array.from({ length: opt.count }, (_, k) => {
								const { x, y } = dotPosition(k);
								// k >= prior ⇒ this dot did not exist in the previous render
								// for this option. Fresh DOM node ⇒ animation runs once.
								const isNew = k >= prior;
								// Fly in from outside the cluster along the dot's own radial
								// direction — looks like the dot is being magnetically pulled
								// into the swarm. For the very first dot (no direction) we fall
								// back to dropping from above.
								const len = Math.hypot(x, y) || 1;
								const dirX = len > 0.001 ? x / len : 0;
								const dirY = len > 0.001 ? y / len : -1;
								const fromX = dirX * flyDist;
								const fromY = dirY * flyDist;
								return (
									// These dots are generated from a bare count, so there is no
									// entity — and no stable id — behind them; the index *is* the
									// identity. The fly-in animation depends on that: `isNew =
									// k >= prior` only holds while dot k keeps the same DOM node
									// across renders.
									<circle
										key={k}
										cx={center + x}
										cy={center + y}
										r={DOT_R}
										fill={color}
										className={isNew ? "dot-fly" : "dot"}
										style={
											isNew
												? ({
														transformOrigin: `${center + x}px ${center + y}px`,
														animationDelay: `${(k - prior) * 0.05}s`,
														"--from-x": `${fromX}px`,
														"--from-y": `${fromY}px`,
													} as CSSProperties)
												: undefined
										}
									/>
								);
							})}
							{opt.count === 0 && (
								<circle
									cx={center}
									cy={center}
									r={DOT_R * 1.4}
									fill="none"
									stroke="var(--color-border)"
									strokeWidth={1.5}
									strokeDasharray="3 3"
								/>
							)}
						</svg>
						<div className="text-center w-full">
							<div className="font-medium text-sm leading-tight flex items-center justify-center gap-1.5">
								<span
									className="w-2.5 h-2.5 rounded-full flex-shrink-0"
									style={{ background: color }}
									aria-hidden
								/>
								<span className="truncate">{opt.text}</span>
								{opt.isCorrect && <CorrectMark compact />}
							</div>
							<div className="font-mono text-xs text-text-muted mt-1">
								{formatChoiceValue(opt.count, share, valueDisplay)}
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ── Word cloud results ────────────────────────────────────────
//
// Lays words out in 2D using a simple spiral placement with bounding-box
// collision detection so the most frequent words sit near the center and the
// rest spiral outward, producing a recognizable "cloud" shape.

type CloudWord = {
	text: string;
	count: number;
	x: number;
	y: number;
	w: number;
	h: number;
	fontSize: number;
	color: string;
};

function layoutCloud(words: { text: string; count: number }[]): {
	items: CloudWord[];
	width: number;
	height: number;
} {
	if (words.length === 0) return { items: [], width: 0, height: 0 };
	const maxCount = Math.max(...words.map((w) => w.count));
	const minCount = Math.min(...words.map((w) => w.count));
	const sorted = [...words].sort((a, b) => b.count - a.count);

	// Crude width/height estimation in px (assumes ~0.55em average glyph width).
	const PAD_X = 14;
	const PAD_Y = 8;
	const measure = (text: string, fontSize: number) => ({
		w: Math.ceil(text.length * fontSize * 0.55) + PAD_X * 2,
		h: Math.ceil(fontSize * 1.2) + PAD_Y * 2,
	});

	const placed: CloudWord[] = [];
	const intersects = (a: CloudWord, b: CloudWord) =>
		!(
			a.x + a.w / 2 < b.x - b.w / 2 ||
			a.x - a.w / 2 > b.x + b.w / 2 ||
			a.y + a.h / 2 < b.y - b.h / 2 ||
			a.y - a.h / 2 > b.y + b.h / 2
		);

	let bbMinX = 0;
	let bbMaxX = 0;
	let bbMinY = 0;
	let bbMaxY = 0;

	for (let i = 0; i < sorted.length; i++) {
		const word = sorted[i];
		// Font scale: 16px..56px, exponential bias toward larger for top words.
		const norm =
			maxCount === minCount
				? 1
				: (word.count - minCount) / (maxCount - minCount);
		const fontSize = Math.round(16 + norm ** 0.7 * 40);
		const { w, h } = measure(word.text, fontSize);
		const color = POLL_COLORS[i % POLL_COLORS.length];

		// Archimedean spiral: r = a + b*theta. Try increasing radii until we find a free spot.
		let placedItem: CloudWord | null = null;
		const step = 0.25;
		const a = 0;
		const b = 4;
		for (let theta = 0; theta < 400; theta += step) {
			const r = a + b * theta;
			const cx = r * Math.cos(theta);
			const cy = r * Math.sin(theta) * 0.7; // squash vertically for a wider cloud
			const candidate: CloudWord = {
				text: word.text,
				count: word.count,
				x: cx,
				y: cy,
				w,
				h,
				fontSize,
				color,
			};
			if (placed.every((p) => !intersects(candidate, p))) {
				placedItem = candidate;
				break;
			}
		}
		if (!placedItem) {
			// Fallback: just place outside everything
			placedItem = {
				text: word.text,
				count: word.count,
				x: bbMaxX + w,
				y: 0,
				w,
				h,
				fontSize,
				color,
			};
		}
		placed.push(placedItem);
		bbMinX = Math.min(bbMinX, placedItem.x - placedItem.w / 2);
		bbMaxX = Math.max(bbMaxX, placedItem.x + placedItem.w / 2);
		bbMinY = Math.min(bbMinY, placedItem.y - placedItem.h / 2);
		bbMaxY = Math.max(bbMaxY, placedItem.y + placedItem.h / 2);
	}

	const width = Math.max(1, bbMaxX - bbMinX);
	const height = Math.max(1, bbMaxY - bbMinY);
	// Translate so origin is top-left (0,0).
	const items = placed.map((p) => ({
		...p,
		x: p.x - bbMinX,
		y: p.y - bbMinY,
	}));
	return { items, width, height };
}

export function WordCloudResults({
	words,
	answers = null,
	moderation,
}: {
	words: { text: string; count: number }[];
	/**
	 * The individual answers behind the cloud (REQ027) — `null` for a caller the
	 * payload withholds them from, which is everybody who cannot edit the deck.
	 */
	answers?: WordCloudAnswer[] | null;
	moderation?: AnswerModeration;
}) {
	if (!words || words.length === 0) {
		return (
			<div className="text-center text-text-dim py-8">
				Waiting for responses...
			</div>
		);
	}

	const { items, width, height } = layoutCloud(words);
	const aspect = height === 0 ? 1 : width / height;

	return (
		<div className="w-full">
			<div
				className="relative mx-auto"
				style={{
					aspectRatio: `${aspect}`,
					width: "100%",
					maxWidth: `${Math.min(960, width)}px`,
				}}
			>
				<svg
					viewBox={`0 0 ${width} ${height}`}
					preserveAspectRatio="xMidYMid meet"
					width="100%"
					height="100%"
					role="img"
					aria-label="Word cloud"
				>
					{items.map((it, i) => (
						<g
							key={it.text}
							className="word-cloud-word"
							style={{ animationDelay: `${i * 0.04}s` }}
						>
							<text
								x={it.x}
								y={it.y}
								fontSize={it.fontSize}
								fill={it.color}
								textAnchor="middle"
								dominantBaseline="central"
								style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}
							>
								{it.text}
							</text>
							<title>
								{it.text} ({it.count})
							</title>
						</g>
					))}
				</svg>
			</div>
			{moderation && answers && (
				<WordCloudAnswerList answers={answers} moderation={moderation} />
			)}
		</div>
	);
}

// ── Open text results ─────────────────────────────────────────

type OpenTextResponse = {
	id: string;
	text: string;
	createdAt: string;
	upvotes: number;
};

export function OpenTextResults({
	responses,
	layout,
	allowVotes,
	onUpvote,
	upvotedIds,
	moderation,
}: {
	responses: OpenTextResponse[];
	layout: "speech-bubbles" | "grid";
	allowVotes: boolean;
	onUpvote?: (responseId: string) => void;
	upvotedIds?: Set<string>;
	/**
	 * What this surface may do to the responses it draws (REQ027). A card *is*
	 * one submitted answer, so the control sits on the card rather than in a
	 * list of its own (ADR-0031) — the cloud beside it needs a list only because
	 * it draws no individual answer to hang one on.
	 */
	moderation?: AnswerModeration;
}) {
	if (!responses || responses.length === 0) {
		return (
			<div className="text-center text-text-dim py-8">
				Waiting for responses...
			</div>
		);
	}

	// Sort by upvotes when voting is enabled so popular responses bubble up.
	const ordered = allowVotes
		? [...responses].sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0))
		: responses;

	// Both layouts use a responsive auto-fill grid so the slide width is fully
	// utilized on presenter and participant views. "speech-bubbles" uses wider
	// cards (better for short reactions); "grid" uses denser cards (better for
	// many short Q&A responses).
	const minCardWidth = layout === "grid" ? "14rem" : "18rem";

	return (
		<div
			className="grid gap-3 overflow-y-auto pr-1"
			style={{
				gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}, 1fr))`,
				gridAutoRows: "min-content",
				// Cap the height to a fraction of the viewport so the grid starts
				// scrolling as soon as it would otherwise push the rest of the slide
				// off-screen, rather than waiting for an absolute pixel threshold.
				maxHeight: "min(22rem, 55vh)",
			}}
		>
			{ordered.map((r, i) => {
				const isUpvoted = upvotedIds?.has(r.id) ?? false;
				return (
					<div
						key={r.id ?? i}
						className="p-4 rounded-lg bg-surface-raised border border-border slide-in flex items-start justify-between gap-3"
						style={{ animationDelay: `${i * 0.03}s` }}
					>
						<p className="flex-1 min-w-0 break-words leading-snug">{r.text}</p>
						{moderation && (
							<RemoveAnswerButton
								answerId={r.id}
								answerText={r.text}
								moderation={moderation}
							/>
						)}
						{allowVotes && (
							<button
								type="button"
								onClick={() => onUpvote?.(r.id)}
								disabled={!onUpvote}
								className={`shrink-0 px-2 py-1 rounded-md text-xs font-mono border transition ${
									isUpvoted
										? "bg-accent border-accent text-on-accent"
										: "bg-surface border-border text-text-muted hover:border-accent"
								} ${!onUpvote ? "opacity-70 cursor-default" : ""}`}
								aria-label={isUpvoted ? "Remove upvote" : "Upvote"}
							>
								<span className="inline-flex items-center gap-1">
									<ArrowUp size={11} />
									{r.upvotes ?? 0}
								</span>
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}

// ── Ranking results (REQ033) ──────────────────────────────────
//
// The aggregated order, best first — the one thing a ranking slide exists to
// produce. The bar length is the item's Borda points as a share of the leader's,
// so the gap between first and second is legible at a glance rather than
// something the audience has to compute from two numbers.

/** One item's standing as the results endpoint reports it. */
type RankingResultItem = {
	id: string;
	text: string;
	/** 1-indexed place in the aggregated ranking. */
	rank: number;
	points: number;
	rankedCount: number;
	notRanked: number;
	/** Mean position among the ballots that placed it; `null` if none did. */
	averageRank: number | null;
};

type RankingTally = {
	items: RankingResultItem[];
	/** Orderings submitted — the denominator behind "didn't rank it". */
	ballots: number;
};

export function RankingResults({ results }: { results: RankingTally }) {
	const items = results?.items ?? [];
	const ballots = results?.ballots ?? 0;

	if (ballots === 0 || items.length === 0) {
		return (
			<div className="text-center text-text-dim py-8">
				Waiting for responses...
			</div>
		);
	}

	// The leader sets the scale. Guarded against a zero leader (every ballot
	// unreadable) so the bars degrade to empty rather than to NaN widths.
	const topPoints = Math.max(...items.map((item) => item.points), 0);

	return (
		<div className="space-y-3">
			{items.map((item, index) => {
				const share = topPoints > 0 ? (item.points / topPoints) * 100 : 0;
				const color = POLL_COLORS[index % POLL_COLORS.length];
				return (
					<div
						key={item.id}
						className="slide-in"
						style={{ animationDelay: `${index * 0.05}s` }}
					>
						<div className="flex items-baseline justify-between gap-3 mb-1">
							<span className="flex min-w-0 items-baseline gap-2">
								<span className="font-mono text-sm font-bold text-accent-text shrink-0">
									#{item.rank}
								</span>
								<span className="truncate font-medium">{item.text}</span>
							</span>
							<span className="shrink-0 font-mono text-sm text-text-muted">
								{item.points} pt{item.points === 1 ? "" : "s"}
							</span>
						</div>
						<div className="h-8 rounded-lg bg-surface-raised overflow-hidden border border-border">
							<div
								className="h-full rounded-lg bar-fill"
								style={{
									width: `${Math.max(share, item.points > 0 ? 2 : 0)}%`,
									background: color,
								}}
							/>
						</div>
						<p className="mt-1 text-xs text-text-dim">
							{/* `averageRank` is null when no ballot placed this item at
							    all (ADR-0024) — say that, rather than print a position
							    nobody gave it. */}
							{item.averageRank === null
								? "not ranked by anyone"
								: `average position ${item.averageRank}`}
							{item.notRanked > 0 &&
								` · left out by ${item.notRanked} of ${ballots}`}
						</p>
					</div>
				);
			})}
			<p className="pt-1 text-center text-xs text-text-dim">
				Points are awarded by position on each ranking — the higher an item is
				placed, the more it scores.
			</p>
		</div>
	);
}

// ── 100 Points results (REQ044) ───────────────────────────────
//
// The room's budget as one split. The bar is the item's *share of everything
// distributed*, not its share of the leader's total the way the ranking bars
// are: here the shares add up to 100%, so a bar spanning a quarter of the track
// means "a quarter of the room's money", which is a number the audience can act
// on. Scaling to the leader would inflate every item and lose exactly that.

/** One item's standing as the results endpoint reports it. */
type PointsResultItem = {
	id: string;
	text: string;
	/** 1-indexed place in the aggregated priority order. */
	rank: number;
	points: number;
	/** Percentage of everything the room distributed. */
	share: number;
	funderCount: number;
	notFunded: number;
	/** Mean points among the ballots that funded it; `null` if none did. */
	averagePoints: number | null;
};

type PointsTally = {
	items: PointsResultItem[];
	/** Allocations submitted — the denominator behind "nobody funded it". */
	ballots: number;
	/** The budget each of those ballots spent, in full. */
	budget: number;
	/** Points actually distributed across the room. */
	totalPoints: number;
};

export function PointsResults({ results }: { results: PointsTally }) {
	const items = results?.items ?? [];
	const ballots = results?.ballots ?? 0;

	if (ballots === 0 || items.length === 0) {
		return (
			<div className="text-center text-text-dim py-8">
				Waiting for responses...
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{items.map((item, index) => {
				const color = POLL_COLORS[index % POLL_COLORS.length];
				return (
					<div
						key={item.id}
						className="slide-in"
						style={{ animationDelay: `${index * 0.05}s` }}
					>
						<div className="flex items-baseline justify-between gap-3 mb-1">
							<span className="flex min-w-0 items-baseline gap-2">
								<span className="font-mono text-sm font-bold text-accent-text shrink-0">
									#{item.rank}
								</span>
								<span className="truncate font-medium">{item.text}</span>
							</span>
							<span className="shrink-0 font-mono text-sm text-text-muted">
								{item.points} pt{item.points === 1 ? "" : "s"} ·{" "}
								{Math.round(item.share)}%
							</span>
						</div>
						<div className="h-8 rounded-lg bg-surface-raised overflow-hidden border border-border">
							<div
								className="h-full rounded-lg bar-fill"
								style={{
									width: `${Math.max(item.share, item.points > 0 ? 2 : 0)}%`,
									background: color,
								}}
							/>
						</div>
						<p className="mt-1 text-xs text-text-dim">
							{/* `averagePoints` is null when no ballot funded this item at
							    all (ADR-0024) — say that, rather than print an average
							    nobody's budget produced. The two numbers together are the
							    trade-off the slide exists to show: a low share with a high
							    average is a few people betting heavily, a high share with a
							    low one is the whole room tipping. */}
							{item.averagePoints === null
								? "nobody spent points on this"
								: `${item.funderCount} of ${ballots} funded it · ${item.averagePoints} pts each on average`}
							{item.notFunded > 0 &&
								item.averagePoints !== null &&
								` · ${item.notFunded} gave it nothing`}
						</p>
					</div>
				);
			})}
			<p className="pt-1 text-center text-xs text-text-dim">
				Every participant spread {results.budget} points across these items —{" "}
				{results.totalPoints} points from {ballots} response
				{ballots === 1 ? "" : "s"} in total.
			</p>
		</div>
	);
}

// ── Guess the Number results (REQ039–REQ043) ──────────────────
//
// The distribution first, the numbers under it. That order is the requirement:
// REQ039 asks for the *shape* of the room's estimates — did everybody cluster,
// or did the room split in two? — which a mean would hide behind a single
// number. The statistics are the caption on the picture, not the result.
//
// The reference (REQ041) and its tolerance window (REQ042) are drawn into the
// same picture rather than reported beside it, because the learning moment the
// requirement describes is spatial: "we were all high" is something an audience
// reads off the gap between their cluster and the line, not off two numbers.

/** One column of the distribution as the results endpoint reports it. */
type GuessResultBucket = GuessColumn & {
	/** Percentage of the guesses that landed in this column. */
	share: number;
};

type GuessTally = {
	/** Guesses the tally could read — the denominator behind every share. */
	guessCount: number;
	/** The frame the columns were built from (REQ040, REQ043). */
	range: GuessRange;
	buckets: GuessResultBucket[];
	/** Summary statistics; all null until somebody has guessed (ADR-0024). */
	lowestGuess: number | null;
	highestGuess: number | null;
	averageGuess: number | null;
	medianGuess: number | null;
	/** REQ041/REQ042 — all null together when the slide has no reference. */
	reference: number | null;
	tolerance: number | null;
	correctRange: { min: number; max: number } | null;
	correctCount: number | null;
	correctShare: number | null;
};

/** One labelled number under the distribution. */
function GuessStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col items-center gap-0.5">
			<span className="font-mono text-xl font-bold text-text tabular-nums">
				{value}
			</span>
			<span className="text-[11px] uppercase tracking-wide text-text-dim">
				{label}
			</span>
		</div>
	);
}

export function GuessNumberResults({ results }: { results: GuessTally }) {
	const guessCount = results?.guessCount ?? 0;
	const range = results?.range;
	const buckets = results?.buckets ?? [];

	if (!range || buckets.length === 0) {
		return (
			<div className="text-center text-text-dim py-8">
				Waiting for responses...
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* The frame is drawn from the first render, empty — a Guess the Number
			    slide's picture is the range itself, so the audience sees what they
			    are estimating within before the first guess lands. */}
			<GuessDistribution
				range={range}
				columns={buckets}
				correctRange={results.correctRange ?? null}
				reference={results.reference ?? null}
			/>

			{guessCount === 0 ? (
				<p className="text-center text-text-dim">Waiting for responses...</p>
			) : (
				<div className="grid grid-cols-4 gap-2">
					<GuessStat label="Guesses" value={String(guessCount)} />
					{/* Mean and median side by side: they part company exactly when a
					    single wild estimate drags the average somewhere nobody guessed,
					    and the gap between them is worth a sentence on stage. */}
					<GuessStat label="Average" value={String(results.averageGuess)} />
					<GuessStat label="Median" value={String(results.medianGuess)} />
					<GuessStat
						label="Range"
						value={`${results.lowestGuess}–${results.highestGuess}`}
					/>
				</div>
			)}

			{/* REQ041/REQ042 — only once the organizer named a correct number. A
			    slide without one has no notion of correctness at all, so there is
			    nothing here to report, not a zero score to print. */}
			{results.reference !== null && (
				<div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-center">
					<p className="text-sm text-text">
						Correct answer:{" "}
						<span className="font-mono font-bold text-success">
							{results.reference}
						</span>
						{results.correctRange &&
							results.correctRange.min !== results.correctRange.max && (
								<span className="text-text-muted">
									{` (±${results.tolerance} counts — ${results.correctRange.min}–${results.correctRange.max})`}
								</span>
							)}
					</p>
					<p className="mt-0.5 text-xs text-text-dim">
						{/* `correctShare` is null when nobody has guessed yet (ADR-0024) —
						    say so, rather than print a 0% no responses produced. */}
						{results.correctShare === null
							? "No guesses yet"
							: `${results.correctCount} of ${guessCount} landed inside it · ${Math.round(
									results.correctShare,
								)}%`}
					</p>
				</div>
			)}
		</div>
	);
}

// ── 2x2 Grid results (REQ046, REQ047) ─────────────────────────
//
// One field, one dot per item at the room's average coordinate, with the
// individual placements behind it as a faint cloud — so the audience reads both
// where an item landed and how much the room agreed about it. The field is the
// same GridPlot the participant answered on, so the picture is recognisably the
// question.

/** One item's standing as the results endpoint reports it. */
type GridResultItem = {
	itemId: string;
	text: string;
	/** Placements the tally could read. */
	placed: number;
	/** Participants who marked the item not assessable (REQ050). */
	skipped: number;
	/** Mean coordinate among the placements; `null` when nobody placed it. */
	averageX: number | null;
	averageY: number | null;
	/** Every readable placement — the cloud behind the average. */
	placements: { x: number; y: number }[];
};

type GridTally = {
	items: GridResultItem[];
	xAxis: GridAxis;
	yAxis: GridAxis;
	allowSkip: boolean;
	totalVotes: number;
};

export function GridResults({ results }: { results: GridTally }) {
	const items = results?.items ?? [];
	const placedItems = items.filter((item) => item.averageX !== null);

	if (placedItems.length === 0) {
		return (
			<div className="text-center text-text-dim py-8">
				Waiting for responses...
			</div>
		);
	}

	const { xAxis, yAxis } = results;
	const colorFor = (index: number) => POLL_COLORS[index % POLL_COLORS.length];

	// The cloud is drawn first so the averages sit on top of their own votes.
	const marks: GridMark[] = [
		...items.flatMap((item, index) =>
			item.placements.map((placement, placementIndex) => ({
				key: `${item.itemId}-${placementIndex}`,
				x: placement.x,
				y: placement.y,
				label: "",
				variant: "faint" as const,
				color: colorFor(index),
			})),
		),
		...items.flatMap((item, index) =>
			item.averageX === null || item.averageY === null
				? []
				: [
						{
							key: item.itemId,
							x: item.averageX,
							y: item.averageY,
							label: String(index + 1),
							color: colorFor(index),
							title: `${item.text} — ${item.averageX}, ${item.averageY}`,
						},
					],
		),
	];

	return (
		<div className="space-y-4">
			<GridPlot
				xAxis={xAxis}
				yAxis={yAxis}
				marks={marks}
				className="mx-auto max-w-md"
			/>
			<ol className="space-y-1.5">
				{items.map((item, index) => (
					<li
						key={item.itemId}
						className="flex items-baseline justify-between gap-3 slide-in"
						style={{ animationDelay: `${index * 0.05}s` }}
					>
						<span className="flex min-w-0 items-baseline gap-2">
							<span
								className="h-2.5 w-2.5 flex-shrink-0 translate-y-px rounded-full"
								style={{ background: colorFor(index) }}
							/>
							<span className="font-mono text-xs text-text-dim">
								{index + 1}
							</span>
							<span className="truncate">{item.text}</span>
						</span>
						<span className="shrink-0 text-right font-mono text-xs text-text-muted">
							{/* ADR-0024: an item nobody placed has no coordinate at all —
							    the payload says so with an explicit null, and so does
							    this row, rather than printing a 0,0 nobody voted for. */}
							{item.averageX === null || item.averageY === null
								? "not placed"
								: `${item.averageX}, ${item.averageY}`}
							{item.skipped > 0 && (
								<span className="text-text-dim">
									{` · ${item.skipped} not assessable`}
								</span>
							)}
						</span>
					</li>
				))}
			</ol>
			<p className="pt-1 text-center text-xs text-text-dim">
				Each numbered dot is where the room put that item on average; the faint
				dots are the individual placements behind it.
			</p>
		</div>
	);
}

// ── Pin on Image results (REQ051, REQ053) ─────────────────────
//
// The room's pins on the organizer's picture, on the same canvas the participant
// answered on so the result is recognisably the question. Every pin is drawn as a
// soft blob, so where the room agreed the blobs stack into a hotspot — that
// stacking is the "heatmap-like distribution" REQ051 asks for, and it is the
// picture the slide exists to produce. The centre of the cloud rides on top of
// it as one labelled dot, and the target area (REQ053) is outlined over both
// whenever this payload carries one.
//
// The average is drawn *beside* the distribution rather than instead of it, and
// that is the whole point: on a picture, the mean of two opposite hotspots names
// a spot nobody chose, so a payload that reported only the average would report
// agreement that does not exist.

/** A pin tally as the results endpoint reports it. */
type PinTally = {
	/** The image the pins are positions on (REQ052). */
	image: { url: string; alt: string };
	/** Pins the tally read — the denominator behind the share. */
	pinCount: number;
	pins: { x: number; y: number }[];
	/** The centre of the cloud, or null before anyone has pinned. */
	averageX: number | null;
	averageY: number | null;
	/**
	 * The target area (REQ053) — `null` both when the slide names none and while
	 * it is withheld from this reader, which is deliberately the same shape.
	 */
	correctArea: PinArea | null;
	correctCount: number | null;
	correctShare: number | null;
	totalVotes: number;
};

export function PinImageResults({ results }: { results: PinTally }) {
	const pins = results?.pins ?? [];
	const image = results?.image ?? { url: "", alt: "" };
	const area = results?.correctArea ?? null;

	// A slide with no image has no picture to show a distribution on, and it is
	// also a slide the vote boundary accepts nothing for — so say that rather
	// than wait for responses that can never arrive.
	if (!image.url) {
		return (
			<div className="py-8 text-center text-text-dim">
				This slide has no image yet — nothing to pin on.
			</div>
		);
	}

	const marks: PinMark[] = [
		// The cloud first, so the average sits on top of the pins behind it.
		...pins.map((pin, pinIndex) => ({
			key: `pin-${pinIndex}`,
			x: pin.x,
			y: pin.y,
			variant: "heat" as const,
		})),
		...(results.averageX === null || results.averageY === null
			? []
			: [
					{
						key: "average",
						x: results.averageX,
						y: results.averageY,
						label: "average",
						title: `Average pin — ${pinCoordinateLabel(
							results.averageX,
						)}, ${pinCoordinateLabel(results.averageY)}`,
					},
				]),
	];

	return (
		<div className="space-y-3">
			<PinCanvas
				image={image}
				marks={marks}
				area={area}
				areaLabel={area ? "Target area" : undefined}
				className="mx-auto max-w-2xl"
			/>
			{results.pinCount === 0 ? (
				<p className="text-center text-text-dim">Waiting for responses...</p>
			) : (
				<>
					<p className="text-center text-sm text-text-muted">
						{`${results.pinCount} pin${results.pinCount === 1 ? "" : "s"}`}
						{/* REQ053 — the hit rate, but only when this reader has the target
						    area at all. A count without the area would announce that a
						    target exists and how hard it is to hit, which is exactly what
						    withholding it prevents. */}
						{results.correctCount !== null && (
							<span className="text-success">
								{` · ${results.correctCount} in the target area`}
								{results.correctShare !== null
									? ` (${results.correctShare}%)`
									: ""}
							</span>
						)}
					</p>
					<PinHeatLegend label="Brighter areas are where more of the room pointed." />
				</>
			)}
		</div>
	);
}

// ── Form results (REQ061) ─────────────────────────────────────
//
// **The fill rate, and nothing else.** How many complete submissions there were,
// how many people answered each field, and — for a choice field, the one part of
// a form that really is a distribution — how the picks split. That is what a
// form looks like on a screen: filling up.
//
// What it deliberately does *not* draw is the answers, and the reason is what
// this component is attached to. Every surface that renders a tally here is a
// screen pointed at a room — the projector, and a participant's phone, which is
// the projector seen from a seat. A form asks for a name and an address; there
// is no reveal mode, no credential and no click that makes putting those on a
// wall the right thing to do, so the rendering simply does not exist rather than
// existing behind a gate somebody could open.
//
// The submissions still travel — the results payload carries them for a caller
// who can edit the deck (see the aggregation's `form` case) — because that is
// the credentialed read an integrator makes, and it is what the spreadsheet
// export is built from (REQ095). The organizer reads what the room wrote in the
// file they download, not off the screen the room is looking at.

/** One field's fill rate as the results endpoint reports it. */
type FormResultField = {
	fieldId: string;
	label: string;
	type: FormFieldType;
	required: boolean;
	/** How many readable submissions wrote something into this field. */
	answered: number;
	/** Per-option counts on a choice field; empty on text and email fields. */
	options: { optionId: string; text: string; count: number }[];
};

type FormTally = {
	/** Rows the tally could read — the denominator behind every count. */
	submissionCount: number;
	fieldCount: number;
	fields: FormResultField[];
	totalVotes: number;
};

export function FormResults({ results }: { results: FormTally }) {
	const fields = results?.fields ?? [];
	const submissionCount = results?.submissionCount ?? 0;

	if (fields.length === 0) {
		return (
			<div className="py-8 text-center text-text-dim">
				This slide has no fields yet — nothing to fill in.
			</div>
		);
	}

	if (submissionCount === 0) {
		return (
			<div className="py-8 text-center text-text-dim">
				Waiting for responses...
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<p className="text-center text-sm text-text-muted">
				{`${submissionCount} submission${submissionCount === 1 ? "" : "s"}`}
			</p>

			{/* The fill rate, field by field. */}
			<div className="space-y-3">
				{fields.map((field, fieldIndex) => {
					const share =
						submissionCount > 0 ? (field.answered / submissionCount) * 100 : 0;
					const color = POLL_COLORS[fieldIndex % POLL_COLORS.length];
					return (
						<div key={field.fieldId} className="space-y-1">
							<div className="flex items-baseline justify-between gap-3">
								<span className="min-w-0 truncate font-medium">
									{field.label}
								</span>
								<span className="shrink-0 font-mono text-sm text-text-muted">
									{`${field.answered} of ${submissionCount}`}
								</span>
							</div>
							<div className="h-2 overflow-hidden rounded-full border border-border bg-surface-raised">
								<div
									className="h-full rounded-full bar-fill"
									style={{
										width: `${Math.max(share, field.answered > 0 ? 2 : 0)}%`,
										background: color,
									}}
								/>
							</div>
							{/* A choice field's picks — the one part of a form worth
							    charting, and the one part that says something about the room
							    rather than about an individual. */}
							{field.options.length > 0 && (
								<div className="flex flex-wrap gap-1.5 pt-1">
									{field.options.map((option) => (
										<span
											key={option.optionId}
											className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-xs"
										>
											<span className="text-text-muted">{option.text}</span>
											<span className="font-mono text-text">{option.count}</span>
										</span>
									))}
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Where the answers are, said plainly. The rows are not drawn on any
			    screen this component reaches — see the block above — so the sentence
			    that replaces them has to point at the thing that does carry them,
			    rather than leaving an organizer looking for a control. */}
			<p className="border-t border-border pt-3 text-center text-xs text-text-dim">
				What people wrote is not shown on screen — download the results to read
				it.
			</p>
		</div>
	);
}

// ── Scale results ─────────────────────────────────────────────
//
// Single horizontal bar per statement showing the average position along the
// scale. Matches the preview's compact look — no extra histogram bars, no
// intermediate tick numbers when min/max labels are set.

function ScaleAxisBar({
	min,
	max,
	average,
	totalVotes,
	labels,
	minLabel,
	maxLabel,
}: {
	min: number;
	max: number;
	average: number;
	totalVotes: number;
	labels?: { value: number; label: string }[];
	minLabel?: string;
	maxLabel?: string;
}) {
	const range = Math.max(1, max - min);
	const avgPct = totalVotes > 0 ? ((average - min) / range) * 100 : 0;

	// Suppress numeric intermediate ticks when the user has provided custom
	// word-labels for min/max — only show the labelled endpoints (and any
	// explicit per-value labels). With no custom labels, fall back to numbers.
	const hasCustomEndpointLabels = !!(minLabel || maxLabel);
	const ticks: { value: number; label: string }[] = [];
	for (let v = min; v <= max; v++) {
		const m = labels?.find((l) => l.value === v);
		if (v === min) {
			ticks.push({ value: v, label: minLabel ?? m?.label ?? String(v) });
		} else if (v === max) {
			ticks.push({ value: v, label: maxLabel ?? m?.label ?? String(v) });
		} else if (m) {
			ticks.push({ value: v, label: m.label });
		} else if (!hasCustomEndpointLabels) {
			ticks.push({ value: v, label: String(v) });
		} else {
			ticks.push({ value: v, label: "" });
		}
	}

	return (
		<div className="w-full">
			<div className="relative h-3 rounded-full bg-surface-raised border border-border overflow-visible">
				<div
					className="h-full rounded-full bar-fill"
					style={{
						width: `${Math.max(avgPct, totalVotes > 0 ? 2 : 0)}%`,
						background: "var(--color-accent)",
					}}
				/>
				{totalVotes > 0 && (
					<div
						className="absolute top-1/2 w-4 h-4 rounded-full -translate-y-1/2 -translate-x-1/2 shadow"
						style={{
							left: `${avgPct}%`,
							background: "var(--color-accent)",
							// Ring matches the page background so the dot reads as a
							// crisp marker punched out of the bar in both light and
							// dark mode (previously fell back to #000 because
							// `--color-bg` doesn't exist — the token is `--color-void`).
							boxShadow:
								"0 0 0 2px var(--color-void), 0 0 8px var(--color-accent-glow)",
						}}
						title={`Average ${average}`}
					/>
				)}
			</div>

			<div
				className="grid mt-2 text-xs text-text-muted"
				style={{
					gridTemplateColumns: `repeat(${ticks.length}, minmax(0, 1fr))`,
				}}
			>
				{ticks.map((t) => (
					<span
						key={t.value}
						className="text-center truncate px-1"
						title={t.label || String(t.value)}
					>
						{t.label}
					</span>
				))}
			</div>
		</div>
	);
}

export function ScaleResults({ results }: { results: any }) {
	const {
		min,
		max,
		minLabel,
		maxLabel,
		labels,
		statements,
		average,
		totalVotes,
		skipped,
	} = results;

	// REQ029/REQ030: multi-statement results.
	if (Array.isArray(statements) && statements.length > 0) {
		return (
			<div className="space-y-4">
				{statements.map((st: any, i: number) => (
					<div
						key={st.statementId}
						className="p-4 rounded-lg bg-surface-raised border border-border slide-in space-y-3"
						style={{ animationDelay: `${i * 0.05}s` }}
					>
						<div className="flex items-baseline justify-between gap-3">
							<h4 className="font-medium">{st.text}</h4>
							<div className="text-right shrink-0">
								<div className="text-2xl font-bold text-accent-text count-up">
									{st.average}
								</div>
								<div className="text-xs text-text-muted">
									{st.answered} answered
									{st.skipped > 0 && ` · ${st.skipped} skipped`}
								</div>
							</div>
						</div>
						<ScaleAxisBar
							min={min}
							max={max}
							average={st.average}
							totalVotes={st.answered}
							labels={labels}
							minLabel={minLabel}
							maxLabel={maxLabel}
						/>
					</div>
				))}
			</div>
		);
	}

	// Legacy single-statement scale.
	return (
		<div className="space-y-6">
			<div className="text-center">
				<div className="text-6xl font-bold text-accent-text count-up">{average}</div>
				<div className="text-text-muted text-sm mt-1">
					average of {totalVotes} responses
					{skipped > 0 && ` (${skipped} skipped)`}
				</div>
			</div>
			<ScaleAxisBar
				min={min}
				max={max}
				average={average ?? min}
				totalVotes={totalVotes ?? 0}
				labels={labels}
				minLabel={minLabel}
				maxLabel={maxLabel}
			/>
		</div>
	);
}
