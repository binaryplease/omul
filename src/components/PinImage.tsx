import { Crosshair } from "lucide-react";
import { useRef, useState } from "react";
import type { PinArea } from "../types";
import { decodePinPoint, isPinInArea, PIN_COORDINATE_MAX } from "../types";

// ── The image as a coordinate space (REQ051, REQ052, REQ053) ──────────
//
// Everything that turns a picture into something a room can point at lives here:
// the canvas itself, the geometry that maps a tap to a coordinate and a
// coordinate back to a position, the target-area overlay, and the drag that
// authors one.
//
// Four surfaces draw the same canvas — the participant places a pin on it, the
// shared screen shows where the room pointed, the editor previews it, and the
// editor's picker draws a target area on it — and the invariant they share is
// the *coordinate space*, not the marks: the same image, the same
// aspect ratio, the same per-mille lattice, so the pin somebody placed on their
// phone is the pin that appears on the projector. Each surface composes it with
// its own marks.
//
// It lives in its own module rather than inside Results.tsx or the editor
// because it depends on nothing either of them owns — only on the pin helpers
// from the schema. The same reasoning that put `GridPlot` next door.

/** One mark on the image. */
export type PinMark = {
	key: string;
	/** Per-mille from the left / from the top — the schema's own lattice. */
	x: number;
	y: number;
	/**
	 * `solid` is a stated position — this participant's own pin, or the centre of
	 * the room's cloud; `heat` is one anonymous pin in the distribution behind it,
	 * drawn as a soft blob so overlapping answers read as a hotspot.
	 */
	variant?: "solid" | "heat";
	/** Mark colour; falls back to the accent. */
	color?: string;
	/** Drawn beside a solid mark — a short label, e.g. "average". */
	label?: string;
	/** Hover text — what this mark is and where it sits. */
	title?: string;
};

/**
 * Where a coordinate sits along an edge, as a percentage of it.
 *
 * The clamp is a rendering guard only: a pin outside the lattice is rejected at
 * the boundary (`decodePinPoint`), so nothing legitimate needs clamping — but a
 * hand-built value must not escape the picture and float over the page.
 */
export function pinOffsetPercent(value: number): number {
	const clamped = Math.min(Math.max(value, 0), PIN_COORDINATE_MAX);
	return (clamped / PIN_COORDINATE_MAX) * 100;
}

/** How a coordinate reads to a human: a whole percentage of the image's edge. */
export function pinCoordinateLabel(value: number): string {
	return `${Math.round(pinOffsetPercent(value))}%`;
}

/**
 * Where a pointer landed, as a point on the image (REQ051).
 *
 * Pure, and takes the box rather than an event target, for two reasons: it is
 * the one piece of geometry every tap and every authoring drag goes through, so
 * it is the thing worth having a test for; and a rendered box is the *only*
 * place device pixels appear at all — they are converted here and never stored,
 * which is what makes one room's pins comparable across a phone and a projector.
 *
 * A rounded-to-per-mille result rather than a fraction: the lattice is the
 * schema's, so a tap produces a coordinate the boundary will accept without a
 * second rounding decision anywhere else. A zero-sized box (an image that has
 * not laid out yet) yields the top-left rather than a NaN.
 */
export function pinPointFromPointer(
	pointer: { clientX: number; clientY: number },
	box: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
	const along = (offset: number, size: number) => {
		if (size <= 0) return 0;
		const fraction = Math.min(Math.max(offset / size, 0), 1);
		return Math.round(fraction * PIN_COORDINATE_MAX);
	};
	return {
		x: along(pointer.clientX - box.left, box.width),
		y: along(pointer.clientY - box.top, box.height),
	};
}

/**
 * The rectangle two corners describe, normalized so it is a rectangle whichever
 * way the drag went (REQ053) — up-left from the second corner is the same target
 * as down-right from the first.
 *
 * Width and height are at least 1, so a tap that never moved is still a target
 * the schema accepts rather than a zero-area one it rejects: an organizer who
 * clicks once has named a spot, and the numeric fields beside the picker are
 * where they widen it.
 *
 * The top-left corner is therefore pulled in far enough to leave room for that
 * minimum. A click on the picture's far right or bottom edge would otherwise
 * produce `{x: 1000, width: 1}` — an area running one per-mille off the image,
 * which `isUsablePinArea` refuses and `pinAreaFor` reads as no area at all: the
 * picker would have authored a state its own validator rejects, and the author
 * would meet "this area runs off the image" for a click that looked fine.
 */
export function pinAreaBetween(
	from: { x: number; y: number },
	to: { x: number; y: number },
): PinArea {
	const left = Math.min(Math.min(from.x, to.x), PIN_COORDINATE_MAX - 1);
	const top = Math.min(Math.min(from.y, to.y), PIN_COORDINATE_MAX - 1);
	const right = Math.max(from.x, to.x);
	const bottom = Math.max(from.y, to.y);
	return {
		x: left,
		y: top,
		width: Math.max(1, Math.min(right - left, PIN_COORDINATE_MAX - left)),
		height: Math.max(1, Math.min(bottom - top, PIN_COORDINATE_MAX - top)),
	};
}

/**
 * Where a target area sits on the picture, as CSS percentages.
 *
 * The width it draws spans `width + 1` coordinates, and that `+ 1` is the whole
 * reason this is a function rather than four inline percentages. `isPinInArea`
 * treats the area as **inclusive on every edge** — a pin at exactly `x + width`
 * is on the target — so an overlay drawn `width` wide would stop one per-mille
 * short of its own hit test, and a pin counted as inside would render on or just
 * outside the border the organizer drew. One thousandth of an edge is invisible
 * in a room, but a boundary that means two different things in two places is the
 * kind of drift that gets misdiagnosed later.
 */
export function pinAreaBox(area: PinArea): {
	left: string;
	top: string;
	width: string;
	height: string;
} {
	return {
		left: `${pinOffsetPercent(area.x)}%`,
		top: `${pinOffsetPercent(area.y)}%`,
		width: `${pinOffsetPercent(area.width + 1)}%`,
		height: `${pinOffsetPercent(area.height + 1)}%`,
	};
}

/**
 * The pin the server accepted for this participant, read back out of the value
 * the vote was submitted with — or `null` when there is none.
 *
 * Read from the *submitted* value rather than from wherever the participant last
 * tapped, the same discipline `acceptedGridPoint` keeps next door: a tap moves
 * whether or not the submission landed, so anything fed from it — a marker, a
 * confirmation, an inside-the-target verdict — would assert a pin the server may
 * have refused.
 */
export function acceptedPin(
	submittedValue: string | undefined,
): { x: number; y: number } | null {
	if (!submittedValue) return null;
	return decodePinPoint(submittedValue);
}

/**
 * What this participant's own pin did about the target area (REQ053), or `null`
 * when there is nothing to say — no pin yet, or no target area they may see.
 *
 * The whole verdict, in one place, because two surfaces ask it and both would
 * otherwise re-derive "do I have a pin *and* an area *and* is it inside": the
 * participant's own confirmation line, and the preview's participant pane. A
 * withheld target arrives as `null` on the slide, so "not revealed yet" and "no
 * correct answer at all" collapse into the same silence here — which is exactly
 * what the withholding is for.
 */
export function pinVerdict(
	pin: { x: number; y: number } | null,
	area: PinArea | null,
): "inside" | "outside" | null {
	if (!pin || !area) return null;
	return isPinInArea(pin, area) ? "inside" : "outside";
}

/**
 * The image with whatever a surface wants drawn on it.
 *
 * `onPick` makes the canvas answerable: it turns the picture into a button, so a
 * tap anywhere on it reports the point tapped. Left off, the canvas is a plain
 * picture — which is what the shared screen and the editor's preview want.
 */
export function PinCanvas({
	image,
	marks = [],
	area = null,
	areaLabel,
	onPick,
	onDragArea,
	className = "",
	emptyLabel,
}: {
	image: { url: string; alt: string };
	marks?: PinMark[];
	/** The target area to outline, when this surface may draw one (REQ053). */
	area?: PinArea | null;
	/** Caption for the outlined area — what the organizer called the target. */
	areaLabel?: string;
	/** Report the point a tap landed on. Absent on a read-only canvas. */
	onPick?: (point: { x: number; y: number }) => void;
	/**
	 * Report a rectangle dragged across the image (REQ053) — the editor's target
	 * picker. `pending` is true while the pointer is still down, so a caller can
	 * show the box forming without committing it.
	 */
	onDragArea?: (next: PinArea, pending: boolean) => void;
	className?: string;
	/** What to say when the slide has no image yet. */
	emptyLabel?: string;
}) {
	const frameRef = useRef<HTMLDivElement | null>(null);
	/** The corner a target-area drag started from; null when no drag is running. */
	const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(
		null,
	);

	/** The point under a pointer event, in the image's own coordinates. */
	const pointFor = (event: { clientX: number; clientY: number }) => {
		const frame = frameRef.current;
		if (!frame) return { x: 0, y: 0 };
		return pinPointFromPointer(event, frame.getBoundingClientRect());
	};

	if (!image.url) {
		return (
			<div
				className={`flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-border bg-surface-raised/40 px-4 text-center text-xs text-text-dim ${className}`}
			>
				{emptyLabel ?? "No image yet"}
			</div>
		);
	}

	const interactive = !!onPick || !!onDragArea;

	const overlay = (
		<>
			{/* The target area (REQ053) — outlined rather than filled solid, so the
			    part of the picture it covers stays readable: an organizer marks the
			    heart on a diagram, and a filled box would hide the heart. */}
			{area && (
				<span
					className="pointer-events-none absolute rounded-sm border-2 border-dashed border-success bg-success/15"
					style={pinAreaBox(area)}
				>
					{areaLabel && (
						<span className="absolute -top-0.5 left-0 -translate-y-full whitespace-nowrap rounded bg-success px-1 py-px text-[10px] font-medium text-void">
							{areaLabel}
						</span>
					)}
				</span>
			)}
			{marks.map((mark) => {
				const heat = mark.variant === "heat";
				const color = mark.color ?? "var(--color-accent)";
				return (
					// The positioned box is the *mark itself*, with its label hanging
					// out of flow beside it: translating a mark-plus-label row would
					// centre the row on the coordinate, leaving the mark half a
					// label-width off the point it claims.
					<span
						key={mark.key}
						className="pointer-events-none absolute"
						style={{
							left: `${pinOffsetPercent(mark.x)}%`,
							top: `${pinOffsetPercent(mark.y)}%`,
						}}
						title={mark.title}
					>
						{heat ? (
							// One soft blob per pin, blended: where the room agreed the
							// blobs stack into a bright spot, and that stacking *is* the
							// heatmap REQ051 asks for. Bucketing the pins into cells first
							// would quantize the picture to a grid resolution nobody
							// authored, and would put a made-up boundary between two
							// answers a hand's width apart.
							// Plain alpha rather than a blend mode: two translucent blobs
							// of the same colour composite to a stronger one in light and
							// dark alike, where `screen` would wash out over a pale image.
							<span
								className="block h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40"
								style={{
									background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
								}}
							/>
						) : (
							<>
								<span
									className="block h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow"
									style={{
										background: color,
										boxShadow: "0 0 0 2px var(--color-void)",
									}}
								/>
								{mark.label && (
									<span className="absolute left-2.5 top-0 -translate-y-1/2 whitespace-nowrap rounded bg-void/80 px-1 text-[10px] font-medium text-text">
										{mark.label}
									</span>
								)}
							</>
						)}
					</span>
				);
			})}
		</>
	);

	return (
		<div
			ref={frameRef}
			className={`relative w-full overflow-hidden rounded-xl border border-border bg-surface-raised/40 ${
				interactive ? "cursor-crosshair touch-none" : ""
			} ${className}`}
			onPointerDown={
				onDragArea
					? (event) => {
							// Capture, so a drag that leaves the picture still ends here
							// rather than freezing a box the organizer let go of.
							event.currentTarget.setPointerCapture(event.pointerId);
							const origin = pointFor(event);
							setDragOrigin(origin);
							onDragArea(pinAreaBetween(origin, origin), true);
						}
					: undefined
			}
			onPointerMove={
				onDragArea
					? (event) => {
							if (!dragOrigin) return;
							onDragArea(pinAreaBetween(dragOrigin, pointFor(event)), true);
						}
					: undefined
			}
			onPointerUp={
				onDragArea
					? (event) => {
							if (!dragOrigin) return;
							onDragArea(pinAreaBetween(dragOrigin, pointFor(event)), false);
							setDragOrigin(null);
						}
					: undefined
			}
			// A drag the browser takes away — a scroll takeover, an incoming call, a
			// cancelled gesture — never sends `pointerup`. Without these the origin
			// would stay set and every later pointer *move* across the picture, with
			// nothing held down, would keep resizing the target area. Both events are
			// listened for because they fire in different cases: `pointercancel` when
			// the gesture is abandoned, `lostpointercapture` when the capture taken
			// above is released some other way.
			onPointerCancel={onDragArea ? () => setDragOrigin(null) : undefined}
			onLostPointerCapture={onDragArea ? () => setDragOrigin(null) : undefined}
		>
			{/* The picture sets the box's aspect ratio, so the coordinate space is
			    the image's own and a pin never drifts against what it was placed on.
			    `block` because an inline image would leave a baseline gap under it
			    that every percentage below would then be measured against. */}
			<img src={image.url} alt={image.alt} className="block w-full" />
			{onPick ? (
				// The whole picture is the control. A button rather than a div with a
				// click handler, so it is in the tab order and announces itself — and
				// keyboard operation is the pair of sliders the caller draws beside
				// this canvas, since a position is not something Enter can express.
				<button
					type="button"
					className="absolute inset-0 h-full w-full cursor-crosshair"
					onClick={(event) => onPick(pointFor(event))}
					aria-label={image.alt || "Place your pin on the image"}
				>
					{overlay}
				</button>
			) : (
				overlay
			)}
		</div>
	);
}

/**
 * The marker legend a surface can put under the canvas: what a bright spot means
 * and what the single dot on it is. Shared by the shared screen and the
 * participant's own view of the room, so the picture is explained the same way
 * on both.
 */
export function PinHeatLegend({ label }: { label: string }) {
	return (
		<p className="flex items-center justify-center gap-1.5 text-center text-xs text-text-dim">
			<Crosshair size={12} />
			{label}
		</p>
	);
}
