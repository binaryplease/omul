import { Trophy } from "lucide-react";
import type { ReactNode } from "react";
import type { getDict } from "../i18n";
import { LEADERBOARD_DEFAULT_SIZE, leaderboardEntryLabel } from "../types";

// ── Leaderboard (REQ059) ──────────────────────────────────────────────
//
// The deck's standings across its quiz questions, drawn once and worn by both
// screens (ADR-0026): the shared screen shows the top of the field, and a
// participant's phone shows the same board with their own row picked out. What
// makes a leaderboard a leaderboard — the order, the places, the ties sharing
// one — is decided on the server; this module only draws it.
//
// It lives in its own module rather than inside Results.tsx because it depends
// on nothing that file owns: only on the board payload and the label helper
// from the schema (ADR-0032).
//
// **Nobody is named.** Every row carries a one-way handle the server derived
// from a participant id, never the id itself — no catalog entry asks
// participants to register or pick a nickname, so the board ranks the identity
// the system already has and calls it something a room can read out loud. The
// one person who learns which row is theirs is the person holding that id, and
// they learn it from their own scorecard.

/** One row of the standings, as the results endpoint reports it. */
export type LeaderboardRow = {
	/** 1-based place, with ties sharing one — the server's, never re-derived. */
	rank: number;
	/** The row's anonymous handle: what a client matches its own row against. */
	entryId: string;
	label: string;
	totalPoints: number;
	correctCount: number;
	/** Quiz questions this row answered — the denominator behind its correct count. */
	answeredCount: number;
};

/** The whole board a leaderboard slide shows. */
export type LeaderboardBoard = {
	/** Quiz questions the standings are summed over. */
	quizCount: number;
	/** What those questions are worth at best — the scale a total is read against. */
	maxPoints: number;
	/** Everyone ranked, including the rows below the cut. */
	rankedCount: number;
	/** How many rows this slide asked to show. */
	size: number;
	entries: LeaderboardRow[];
};

/**
 * The words the board wears. Both surfaces draw the same leaderboard, and only
 * one of them is translated (the participant's, REQ084), so the strings arrive
 * as a parameter rather than being reached for inside — the same shape
 * `QuizTimer` takes its countdown labels in.
 */
export type LeaderboardLabels = {
	title: string;
	/** Stands in for the board while nobody has answered a quiz question yet. */
	empty: string;
	/** The unit under a score. */
	points: string;
	/** The badge on the reader's own row. */
	you: string;
	/** Lead-in to the reader's own place, e.g. "Your position". */
	yourPosition: string;
	/** Joins a place to the field it was taken in: "4 <of> 31". */
	outOf: string;
	/** Reads a row's hit rate under its name: "3 / 5 <correct>". */
	correct: string;
	/** Counts the ranked rows below the cut: "+7 <more ranked>". */
	moreRanked: string;
	/** What a participant with no answers yet is told instead of a place. */
	notRanked: string;
};

/** The shared screen's wording — the presenter's surface is not translated. */
export const LEADERBOARD_LABELS_EN: LeaderboardLabels = {
	title: "Leaderboard",
	empty: "No scores yet — the standings fill in as quiz questions are answered.",
	points: "points",
	you: "You",
	yourPosition: "Your position",
	outOf: "of",
	correct: "correct",
	moreRanked: "more ranked",
	notRanked: "Answer a quiz question to join the leaderboard",
};

/**
 * The same board, in the deck's language (REQ084) — the one place the
 * participant-facing dictionary is mapped onto the board's labels, so the
 * phone and the shared screen wear the same wording in two languages rather
 * than two wordings (ADR-0026).
 */
export function leaderboardLabelsFor(
	dict: ReturnType<typeof getDict>,
): LeaderboardLabels {
	return {
		title: dict.leaderboardTitle,
		empty: dict.leaderboardEmpty,
		// The unit a quiz answer is already scored in — the same word under a
		// verdict and under a place.
		points: dict.quizPoints,
		you: dict.leaderboardYou,
		yourPosition: dict.leaderboardYourPosition,
		outOf: dict.leaderboardOutOf,
		correct: dict.leaderboardCorrect,
		moreRanked: dict.leaderboardMoreRanked,
		notRanked: dict.leaderboardNotRanked,
	};
}

/**
 * A board payload as it arrives over the wire: JSON, so every field is nominally
 * optional until it has been read through {@link readLeaderboard}.
 */
type LeaderboardPayload =
	| (Omit<Partial<LeaderboardBoard>, "entries"> & {
			entries?: Partial<LeaderboardRow>[];
	  })
	| null
	| undefined;

/**
 * Read the wire payload into a board with every field present.
 *
 * Places are taken from the payload rather than from each row's position,
 * because the two are deliberately not the same: level scores share a place, so
 * a board drawing "1, 2, 3" down its own rows would break the one tie the
 * server took care to keep.
 */
export function readLeaderboard(results: LeaderboardPayload): LeaderboardBoard {
	const entries = (results?.entries ?? []).map((entry, position) => ({
		rank: entry?.rank ?? position + 1,
		entryId: entry?.entryId ?? "",
		label: entry?.label ?? leaderboardEntryLabel(entry?.entryId ?? ""),
		totalPoints: entry?.totalPoints ?? 0,
		correctCount: entry?.correctCount ?? 0,
		answeredCount: entry?.answeredCount ?? 0,
	}));
	return {
		quizCount: results?.quizCount ?? 0,
		maxPoints: results?.maxPoints ?? 0,
		// A board that reported no total falls back to the rows in hand: the rows
		// shown are never more than everyone ranked, so this cannot claim a field
		// smaller than the one on screen.
		rankedCount: Math.max(results?.rankedCount ?? 0, entries.length),
		size: results?.size ?? LEADERBOARD_DEFAULT_SIZE,
		entries,
	};
}

/**
 * How long a row's bar is drawn, as a percentage of the board.
 *
 * Scaled to the **leader**, not to what the deck was worth: the picture is the
 * gap between the people at the top, and a room where the best score is a third
 * of the maximum would otherwise draw every bar as a stub. A zero score draws
 * nothing at all — a row that scored nothing has nothing to show, and a minimum
 * sliver would claim otherwise.
 */
export function leaderboardBarWidth(points: number, leaderPoints: number): number {
	if (leaderPoints <= 0 || points <= 0) return 0;
	return Math.max(6, (points / leaderPoints) * 100);
}

/**
 * The place badge's treatment — the shared token for "this row is on the
 * podium" (ADR-0028), owned here and composed by every row that draws one.
 * Fourth place down wears the plain surface: a podium that extended to
 * everybody would mark nothing.
 */
export function leaderboardRankSurface(rank: number): string {
	if (rank === 1) return "bg-warning/20 text-warning border-warning/40";
	if (rank === 2) return "bg-text-muted/20 text-text border-text-muted/40";
	if (rank === 3) return "bg-accent/20 text-accent-text border-accent/40";
	return "bg-surface-raised text-text-muted border-border-subtle";
}

/** One row of the board. */
function LeaderboardRowView({
	row,
	leaderPoints,
	labels,
	isYou,
	compact,
}: {
	row: LeaderboardRow;
	leaderPoints: number;
	labels: LeaderboardLabels;
	isYou: boolean;
	compact: boolean;
}) {
	return (
		<li
			className={`relative overflow-hidden rounded-xl border px-3 py-2.5 transition-colors ${
				isYou
					? "border-accent/50 bg-accent-dim"
					: "border-border-subtle bg-surface-raised/60"
			}`}
		>
			{/* The score as a length, behind the row rather than beside it: the gap
			    between the top places is the thing a leaderboard is read for, and it
			    reads faster as a shape than as two numbers to subtract. */}
			<span
				className="absolute inset-y-0 left-0 bg-accent/10"
				style={{ width: `${leaderboardBarWidth(row.totalPoints, leaderPoints)}%` }}
			/>
			<div className="relative flex items-center gap-3">
				<span
					className={`flex flex-shrink-0 items-center justify-center rounded-lg border font-mono font-bold ${
						compact ? "h-7 w-8 text-xs" : "h-9 w-11 text-base"
					} ${leaderboardRankSurface(row.rank)}`}
				>
					{row.rank}
				</span>
				<span className="min-w-0 flex-1">
					<span
						className={`flex items-center gap-2 font-medium ${
							compact ? "text-sm" : "text-lg"
						}`}
					>
						<span className="truncate">{row.label}</span>
						{isYou && (
							<span className="flex-shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-void">
								{labels.you}
							</span>
						)}
					</span>
					<span className="block text-xs text-text-dim">
						{`${row.correctCount} / ${row.answeredCount} ${labels.correct}`}
					</span>
				</span>
				<span className="flex-shrink-0 text-right">
					<span
						className={`block font-mono font-bold text-accent-text ${
							compact ? "text-sm" : "text-xl"
						}`}
					>
						{row.totalPoints}
					</span>
					<span className="block text-[10px] uppercase tracking-wide text-text-dim">
						{labels.points}
					</span>
				</span>
			</div>
		</li>
	);
}

/**
 * The standings themselves (REQ059). `highlightEntryId` is the reader's own
 * handle when they have one — a participant's phone knows it from their
 * scorecard, the shared screen has nobody to pick out and passes `null`.
 */
export function Leaderboard({
	board,
	labels = LEADERBOARD_LABELS_EN,
	highlightEntryId = null,
	compact = false,
}: {
	board: LeaderboardBoard;
	labels?: LeaderboardLabels;
	highlightEntryId?: string | null;
	compact?: boolean;
}) {
	if (board.entries.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-text-dim">
				{labels.empty}
			</div>
		);
	}
	const leaderPoints = board.entries[0]?.totalPoints ?? 0;
	const hidden = board.rankedCount - board.entries.length;
	return (
		<div className="w-full">
			<ul className={`flex flex-col ${compact ? "gap-1.5" : "gap-2"}`}>
				{board.entries.map((row) => (
					<LeaderboardRowView
						key={row.entryId}
						row={row}
						leaderPoints={leaderPoints}
						labels={labels}
						isYou={!!highlightEntryId && row.entryId === highlightEntryId}
						compact={compact}
					/>
				))}
			</ul>
			{/* The rows below the cut are counted rather than dropped in silence: a
			    board that showed five of thirty-one without saying so would read as a
			    room of five. */}
			{hidden > 0 && (
				<p className="mt-3 text-center text-xs text-text-dim">
					{`+${hidden} ${labels.moreRanked}`}
				</p>
			)}
		</div>
	);
}

/** The heading a leaderboard slide wears on either screen. */
export function LeaderboardHeading({
	title,
	subtitle,
	compact = false,
}: {
	/* A node rather than a string: on a slide whose heading the organizer wrote,
	   the board's title is authored text like any other and arrives already
	   rendered through <SlideText/> (REQ088/REQ089/REQ091). The board's own
	   default name is still a plain string. */
	title: ReactNode;
	subtitle?: string;
	compact?: boolean;
}) {
	return (
		<div className="flex flex-col items-center gap-1 text-center">
			<span className="inline-flex items-center gap-2 text-accent-text">
				<Trophy size={compact ? 18 : 28} />
				<span className={compact ? "text-lg font-bold" : "text-3xl font-bold"}>
					{title}
				</span>
			</span>
			{subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
		</div>
	);
}

/** One participant's own place, as their scorecard reports it (REQ059). */
export type LeaderboardStanding = {
	/** `null` until they have answered something — unranked is a standing too. */
	rank: number | null;
	rankedCount: number;
	totalPoints: number;
	maxPoints: number;
};

/**
 * Where the reader stands, on their own screen.
 *
 * The board is anonymous, so this is the only place a participant is told which
 * race they are in — and it is told to them wherever they sit in it, not only
 * when they make the projected top five. "14th of 31" is the whole point of
 * showing somebody a leaderboard they are not winning.
 *
 * Three states, and the first two are **not** the same: a `null` standing is a
 * card still in flight — nothing is known yet — while a standing whose `rank` is
 * `null` is a card that arrived and says this participant has answered nothing.
 * Collapsing them tells somebody sitting in 3rd place to go and answer a
 * question for as long as a fetch takes, which is both wrong and the one thing
 * they would act on.
 */
export function LeaderboardStandingView({
	standing,
	labels,
}: {
	/** `null` while their card is still loading — not yet known, not unranked. */
	standing: LeaderboardStanding | null;
	labels: LeaderboardLabels;
}) {
	if (!standing) {
		// A placeholder in the shape of the answer, so the row does not jump when
		// it lands — and it asserts nothing about where they stand.
		return (
			<p className="text-center text-xs text-text-dim">
				{`${labels.yourPosition} …`}
			</p>
		);
	}
	if (standing.rank === null) {
		return (
			<p className="text-center text-xs text-text-dim">{labels.notRanked}</p>
		);
	}
	return (
		<div className="flex items-center justify-center gap-3 rounded-xl border border-accent/40 bg-accent-dim px-4 py-2.5">
			<span className="text-xs uppercase tracking-wide text-text-muted">
				{labels.yourPosition}
			</span>
			<span className="font-mono text-xl font-bold text-accent-text">
				{standing.rank}
			</span>
			<span className="text-xs text-text-muted">
				{`${labels.outOf} ${standing.rankedCount}`}
			</span>
			<span className="font-mono text-sm text-text">
				{`${standing.totalPoints} / ${standing.maxPoints} ${labels.points}`}
			</span>
		</div>
	);
}
