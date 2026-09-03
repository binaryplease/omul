import type { GridAxis, GridItem } from "../types";
import { decodeGridPoint } from "../types";

// ── 2x2 Grid field (REQ046, REQ048, REQ049) ───────────────────────────
//
// The coordinate field itself: two labelled dimensions, the quadrant cross
// that makes a "2x2" a 2x2, and whatever dots a surface wants drawn on it.
// Two surfaces plot the same field — the participant places items on it and
// the shared screen shows where the room put them — and the invariant they
// share is the *field*, not the dots: identical axes, identical
// endpoint labels, identical geometry, so a participant recognises the picture
// they answered when it appears on the big screen. Each surface composes it
// with its own marks.
//
// It lives in its own module rather than inside Results.tsx because it depends
// on nothing that file owns — only on the axis shape from the schema.

/** One dot on the field. */
export type GridMark = {
	key: string;
	x: number;
	y: number;
	/** Drawn beside a solid dot — an ordinal or a short item name. */
	label: string;
	/**
	 * `solid` is a stated position (an item's average, or this participant's own
	 * placement); `faint` is one anonymous vote in the cloud behind an average.
	 */
	variant?: "solid" | "faint";
	/** Dot colour; falls back to the accent. */
	color?: string;
	/** Hover text — the full item name and its coordinates. */
	title?: string;
};

/**
 * How far along an axis a coordinate sits, as a percentage of its span. The
 * clamp is a rendering guard only: a point outside the axis is rejected at the
 * boundary (`decodeGridPoint`), so nothing legitimate ever needs clamping — but
 * a stale value must not escape the field and float over the page.
 */
function offsetPercent(value: number, axis: GridAxis): number {
	const span = Math.max(1, axis.max - axis.min);
	const clamped = Math.min(Math.max(value, axis.min), axis.max);
	return ((clamped - axis.min) / span) * 100;
}

/**
 * What one end of an axis reads as (REQ049): the pole the organizer named, or
 * its number when they left it unnamed — so the same axis serves a qualitative
 * low/high pair and a plain 0–10 range. Shared by the plot and the participant
 * sliders so an end never reads one way here and another way there.
 */
export function gridEndLabel(label: string, value: number): string {
	return label.trim() || String(value);
}

// ── A participant's own answers, read onto the field ──────────────────
//
// What a participant has actually placed is derived here, once, so the field
// and the numbered list beside it can never disagree about which items are on
// the grid or about which item a dot's number refers to. Both surfaces of that
// disagreement were real defects; keeping the derivation in one pure function
// is what stops them recurring.

/**
 * The placement the server accepted for one item, read back out of the value
 * the vote was submitted with — or `null` when there is none: the item is still
 * unanswered, was marked not assessable (REQ050), or its slide has since been
 * re-authored onto a grid the submitted point is no longer on.
 *
 * Read from the *submitted* value rather than from the slider the participant
 * is holding. A slider moves on every drag, accepted or not, so anything fed
 * from it — a dot, a confirmation badge — would assert a placement the server
 * may have rejected, or may never have been asked for.
 */
export function acceptedGridPoint(
	submittedValue: string | undefined,
	xAxis: GridAxis,
	yAxis: GridAxis,
): { x: number; y: number } | null {
	// A skipped item's sentinel is not a coordinate pair, so it decodes to null
	// like any other non-placement.
	if (!submittedValue) return null;
	return decodeGridPoint(submittedValue, xAxis, yAxis);
}

/**
 * The dots a participant's own answers put on the field: one per item they have
 * actually placed, labelled with that item's position in the **authored** list.
 *
 * Both halves matter. Only accepted placements are drawn, so an untouched slide
 * is an empty field rather than a stack of dots at the midpoint the sliders
 * happen to start on. And an ordinal is the item's index in `items`, never its
 * index among the drawn ones, so it always names the same item as the numbered
 * row below it — skipping an item must not renumber the items after it.
 */
export function ownGridMarks({
	items,
	submittedValueFor,
	xAxis,
	yAxis,
	titleFor,
}: {
	items: GridItem[];
	/** The value this item's vote was last accepted with, if any. */
	submittedValueFor: (itemId: string) => string | undefined;
	xAxis: GridAxis;
	yAxis: GridAxis;
	/** Hover text for a placed item, e.g. `Alpha — Effort 3, Impact 7`. */
	titleFor?: (item: GridItem, point: { x: number; y: number }) => string;
}): GridMark[] {
	return items.flatMap((item, itemIndex) => {
		const point = acceptedGridPoint(submittedValueFor(item.id), xAxis, yAxis);
		if (!point) return [];
		return [
			{
				key: item.id,
				x: point.x,
				y: point.y,
				label: String(itemIndex + 1),
				title: titleFor?.(item, point),
			},
		];
	});
}

export function GridPlot({
	xAxis,
	yAxis,
	marks,
	className = "",
}: {
	xAxis: GridAxis;
	yAxis: GridAxis;
	marks: GridMark[];
	className?: string;
}) {
	return (
		<div className={`w-full ${className}`}>
			<div className="flex items-stretch gap-1.5">
				{/* Vertical axis title, reading bottom-to-top along the axis it
				    names. Only rendered when named — an unnamed axis has nothing
				    to say, and its ends still read as numbers below. */}
				{yAxis.title.trim() && (
					<div className="flex items-center">
						<span className="[writing-mode:vertical-rl] rotate-180 text-xs font-medium text-text-muted">
							{yAxis.title}
						</span>
					</div>
				)}
				{/* Vertical endpoints: high at the top, low at the bottom. */}
				<div className="flex flex-col justify-between py-0.5 text-right text-[10px] leading-tight text-text-dim">
					<span className="max-w-[5rem] truncate">
						{gridEndLabel(yAxis.maxLabel, yAxis.max)}
					</span>
					<span className="max-w-[5rem] truncate">
						{gridEndLabel(yAxis.minLabel, yAxis.min)}
					</span>
				</div>
				{/* Overflow stays visible: a dot at an axis maximum sits *on* the
				    boundary, and clipping would slice it — and its label — in half
				    exactly where a placement is most emphatic. The scale results
				    bar keeps its average marker visible for the same reason. */}
				<div className="relative aspect-square flex-1 overflow-visible rounded-xl border border-border bg-surface-raised/40">
					{/* The quadrant cross — what makes the field a 2x2 rather than a
					    plain scatter. */}
					<div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
					<div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
					{marks.map((mark) => {
						const faint = mark.variant === "faint";
						const color = mark.color ?? "var(--color-accent)";
						return (
							// The positioned box is the *dot*, and the label hangs off it
							// out of flow: translating a dot-plus-label row would centre
							// the row on the coordinate, leaving the dot itself half a
							// label-width to the left of the point it claims — and off by
							// a different amount than an unlabelled faint dot.
							<span
								key={mark.key}
								className="absolute"
								style={{
									left: `${offsetPercent(mark.x, xAxis)}%`,
									bottom: `${offsetPercent(mark.y, yAxis)}%`,
								}}
								title={mark.title}
							>
								<span
									className={`block translate-x-[-50%] translate-y-[50%] rounded-full ${
										faint ? "h-1.5 w-1.5 opacity-40" : "h-3 w-3 shadow"
									}`}
									style={{
										background: color,
										boxShadow: faint
											? undefined
											: "0 0 0 2px var(--color-void)",
									}}
								/>
								{!faint && (
									<span className="absolute bottom-0 left-2 translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-text">
										{mark.label}
									</span>
								)}
							</span>
						);
					})}
				</div>
			</div>
			{/* Horizontal endpoints sit under the field, low left, high right. */}
			<div className="mt-1 flex justify-between gap-2 text-[10px] leading-tight text-text-dim">
				<span className="truncate">
					{gridEndLabel(xAxis.minLabel, xAxis.min)}
				</span>
				<span className="truncate">
					{gridEndLabel(xAxis.maxLabel, xAxis.max)}
				</span>
			</div>
			{xAxis.title.trim() && (
				<p className="mt-0.5 text-center text-xs font-medium text-text-muted">
					{xAxis.title}
				</p>
			)}
		</div>
	);
}
