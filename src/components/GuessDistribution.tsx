import type { GuessRange } from "../types";

// ── Guess the Number distribution (REQ039–REQ043) ─────────────────────
//
// The picture the slide exists to produce: where the room's estimates piled up,
// how far they spread, and — when the organizer named one — where the correct
// number sits among them. Two surfaces draw the same histogram: the editor
// preview shows the empty frame the author is building, and the shared screen
// fills it with the room's guesses. What they share is the *frame* — identical
// columns, identical axis, identical reference band — so the picture
// an author previews is the picture the audience reads. Each composes it with
// its own data.
//
// It lives in its own module rather than inside Results.tsx because it depends
// on nothing that file owns — only on the range and bucket shapes from the
// schema.

/** One column as the results endpoint reports it — or an empty preview column. */
export type GuessColumn = {
	/** Lowest selectable value in the column. */
	from: number;
	/** Highest selectable value in the column; equal to `from` for a single value. */
	to: number;
	/** Guesses that landed in it. */
	count: number;
};

/**
 * What a column is called on the axis: a single value reads as itself, a grouped
 * one as the span it covers. Shared by the bars' hover text and the axis labels
 * so a column can never be named two ways in the same picture.
 */
export function guessColumnLabel(column: { from: number; to: number }): string {
	return column.from === column.to
		? String(column.from)
		: `${column.from}–${column.to}`;
}

/**
 * How tall a column is drawn, as a percentage of the plot.
 *
 * Scaled to the **busiest column**, not to the response count: the histogram's
 * job is the shape of the distribution, and scaling to the total would flatten
 * every bar towards nothing as more people guess — the one moment the shape
 * matters most. An empty column is drawn at zero rather than at a minimum
 * sliver, so "nobody guessed here" stays visibly different from "one person
 * did".
 */
export function guessColumnHeight(count: number, busiest: number): number {
	if (busiest <= 0 || count <= 0) return 0;
	// A floor of 4% so a single guess in a tall room is still visible as a mark
	// rather than a hairline that reads as an empty column.
	return Math.max(4, (count / busiest) * 100);
}

/**
 * Whether a column overlaps the window of numbers that count as correct
 * (REQ042). `null` — no reference at all (REQ041) — highlights nothing: a slide
 * with no correct answer must not paint one column as the right one.
 */
export function isColumnCorrect(
	column: { from: number; to: number },
	correctRange: { min: number; max: number } | null,
): boolean {
	if (!correctRange) return false;
	return column.from <= correctRange.max && column.to >= correctRange.min;
}

// The reference marker and the tolerance band are placed in **column space**,
// not in value space. The columns are equal-width slots across the plot, so a
// marker positioned by its share of the range would drift up to half a column
// away from the bar it names — and "the correct answer line points between two
// bars" is exactly the misreading the reveal exists to avoid. Everything below
// therefore addresses columns, and the two helpers are pure so the placement can
// be checked without rendering.

/**
 * Which column a value belongs to, or `-1` when no column holds it — a
 * reference the organizer put outside the range they offered, which nothing
 * forbids.
 */
export function guessColumnIndex(
	value: number,
	columns: { from: number; to: number }[],
): number {
	return columns.findIndex(
		(column) => value >= column.from && value <= column.to,
	);
}

/** The middle of one column, as a percentage across the plot. */
export function guessColumnCenter(index: number, columnCount: number): number {
	if (columnCount <= 0) return 0;
	return ((index + 0.5) / columnCount) * 100;
}

/**
 * Where a run of columns starts and how wide it is, as percentages across the
 * plot — the band drawn behind the columns the tolerance accepts (REQ042).
 */
export function guessColumnSpan(
	firstIndex: number,
	lastIndex: number,
	columnCount: number,
): { left: number; width: number } {
	if (columnCount <= 0 || firstIndex < 0 || lastIndex < firstIndex) {
		return { left: 0, width: 0 };
	}
	return {
		left: (firstIndex / columnCount) * 100,
		width: ((lastIndex - firstIndex + 1) / columnCount) * 100,
	};
}

export function GuessDistribution({
	range,
	columns,
	correctRange = null,
	reference = null,
	className = "",
}: {
	range: GuessRange;
	columns: GuessColumn[];
	/** The accepted window (REQ042); null when the slide has no reference. */
	correctRange?: { min: number; max: number } | null;
	/** The correct number itself (REQ041); null when there is none. */
	reference?: number | null;
	className?: string;
}) {
	const busiest = columns.reduce(
		(highest, column) => Math.max(highest, column.count),
		0,
	);

	// The columns the tolerance accepts, as a run: the band spans whole columns
	// so its edges land on bar edges. A window narrower than one column still
	// highlights that column — a bucketed histogram cannot draw finer than its
	// own resolution — and the exact window is spelled out in words beside the
	// plot, so nothing is lost.
	const correctIndexes = columns
		.map((column, columnIndex) => ({ column, columnIndex }))
		.filter(({ column }) => isColumnCorrect(column, correctRange))
		.map(({ columnIndex }) => columnIndex);
	const band = guessColumnSpan(
		correctIndexes[0] ?? -1,
		correctIndexes[correctIndexes.length - 1] ?? -1,
		columns.length,
	);
	const referenceIndex =
		reference === null ? -1 : guessColumnIndex(reference, columns);

	return (
		<div className={`w-full ${className}`}>
			<div className="relative h-40 rounded-xl border border-border bg-surface-raised/40 px-2 pt-2">
				{/* The tolerance band, drawn behind the columns so a bar sitting
				    inside it still reads as a bar (REQ042). Only when a reference
				    exists — a slide without one has no band and no right answer. */}
				{band.width > 0 && (
					<span
						className="absolute inset-y-0 rounded-md bg-success/10 border-x border-success/30"
						style={{ left: `${band.left}%`, width: `${band.width}%` }}
					/>
				)}
				{/* The reference itself (REQ041) — a line through the column holding
				    the correct number, so the audience reads their own cluster
				    against it. A reference the organizer put outside the range they
				    offered has no column to mark, and is left to the caption. */}
				{referenceIndex >= 0 && (
					<span
						className="absolute inset-y-0 w-px bg-success"
						style={{
							left: `${guessColumnCenter(referenceIndex, columns.length)}%`,
						}}
					/>
				)}
				<div className="relative flex h-full items-end gap-px">
					{columns.map((column) => {
						const height = guessColumnHeight(column.count, busiest);
						const correct = isColumnCorrect(column, correctRange);
						return (
							<span
								key={`${column.from}-${column.to}`}
								className="flex h-full flex-1 items-end"
								title={`${guessColumnLabel(column)} — ${column.count} guess${
									column.count === 1 ? "" : "es"
								}`}
							>
								<span
									className={`w-full rounded-t transition-[height] duration-300 ${
										correct ? "bg-success" : "bg-accent"
									}`}
									style={{ height: `${height}%` }}
								/>
							</span>
						);
					})}
				</div>
			</div>
			{/* The axis reads as its two ends: every column label would collide at
			    two dozen columns on a phone, and the ends are what frame the
			    estimate (REQ040). The per-column value lives in the hover text. */}
			<div className="mt-1 flex justify-between gap-2 font-mono text-[10px] leading-tight text-text-dim">
				<span>{range.min}</span>
				<span>{range.max}</span>
			</div>
		</div>
	);
}
