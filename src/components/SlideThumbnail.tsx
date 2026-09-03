import {
	GripVertical,
	Image as ImageIcon,
	PlayCircle,
	Presentation,
	QrCode,
} from "lucide-react";
import type { DragEvent } from "react";
import { POLL_COLORS } from "../constants";
import type { Slide } from "../types";
import {
	EMBED_PROVIDERS,
	quizAnswerModeFor,
	slideAppearanceFor,
	slideEmbedFor,
} from "../types";
import { SLIDE_PLACEMENT_CLASSES } from "./SlideAppearance";
import { SLIDE_TYPE_LABELS } from "./SlideEditor";
import { slideRailItemSurface } from "./SlideRail";
import { slideTextToPlain } from "./SlideText";
import { SlideTypeIcon } from "./SlideTypeIcon";

// ── Slide thumbnail (editor rail filmstrip) ───────────────────────────
//
// A miniature visual of a slide for the editor's left rail — a scannable
// filmstrip, the way mature deck editors render their slide list. This is a
// different content shape from the presenter's compact `SlideRailItem` (label
// only), but the two share the one real invariant: the selected/idle highlight
// token (`slideRailItemSurface`), composed here on the wrapper.

/** A slim, type-specific gist of the slide content shown inside the canvas. */
function ThumbnailGist({ slide }: { slide: Slide }) {
	switch (slide.type) {
		case "multiple-choice":
		case "quiz": {
			// A typed quiz (REQ055) has no options to gist, and its shape is the
			// point: an empty field with a caret, not a list to pick from.
			if (quizAnswerModeFor(slide) === "type") {
				return (
					<div className="flex items-center gap-1 rounded-sm border border-text-dim/40 px-1 py-0.5">
						<span className="h-2 w-px bg-accent" />
						<span className="h-1 w-2/3 rounded-full bg-text-dim/25" />
					</div>
				);
			}
			const options = (slide.options ?? []).slice(0, 3);
			return (
				<div className="flex flex-col gap-1">
					{options.map((option, optionIndex) => (
						<div key={option.id} className="flex items-center gap-1">
							<span
								className="h-1.5 w-1.5 flex-shrink-0 rounded-sm"
								style={{
									background: POLL_COLORS[optionIndex % POLL_COLORS.length],
								}}
							/>
							<span
								className="h-1 rounded-full bg-text-dim/40"
								style={{ width: `${52 - optionIndex * 12}%` }}
							/>
						</div>
					))}
				</div>
			);
		}
		case "word-cloud":
			return (
				<div className="flex flex-wrap items-center gap-1">
					{[0, 1, 2, 3].map((chipIndex) => (
						<span
							key={chipIndex}
							className="h-1.5 rounded-full"
							style={{
								width: `${16 + (chipIndex % 3) * 8}px`,
								background: POLL_COLORS[chipIndex % POLL_COLORS.length],
								opacity: 0.7,
							}}
						/>
					))}
				</div>
			);
		case "open-text":
			return (
				<div className="flex flex-col gap-1">
					<span className="h-1.5 w-4/5 rounded-full bg-text-dim/40" />
					<span className="h-1.5 w-3/5 rounded-full bg-text-dim/40" />
				</div>
			);
		case "scale":
			return (
				<div className="flex items-center gap-1">
					<span className="h-1 flex-1 rounded-full bg-text-dim/40" />
					<span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
				</div>
			);
		case "ranking": {
			// The gist is the *ordering*, so the rows step down in length behind
			// their ordinals rather than carrying per-item colours.
			const items = (slide.rankingItems ?? []).slice(0, 3);
			return (
				<div className="flex flex-col gap-1">
					{items.map((item, itemIndex) => (
						<div key={item.id} className="flex items-center gap-1">
							<span className="font-mono text-[8px] leading-none text-accent-text">
								{itemIndex + 1}
							</span>
							<span
								className="h-1 rounded-full bg-text-dim/40"
								style={{ width: `${56 - itemIndex * 12}%` }}
							/>
						</div>
					))}
				</div>
			);
		}
		case "grid":
			// The gist is the quadrant field itself — a cross with a couple of
			// placed dots — since a grid slide is recognised by its shape, not by
			// its item names.
			return (
				<div className="relative h-6 w-6 rounded-sm border border-text-dim/40">
					<span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-text-dim/40" />
					<span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-text-dim/40" />
					<span className="absolute left-[22%] top-[26%] h-1 w-1 rounded-full bg-accent" />
					<span className="absolute left-[64%] top-[66%] h-1 w-1 rounded-full bg-accent/60" />
				</div>
			);
		case "points": {
			// The gist is the *split* of one budget, so the rows read as unequal
			// slices of the same width rather than as an order or a field.
			const shares = [52, 30, 18];
			return (
				<div className="flex flex-col gap-1">
					{(slide.pointsItems ?? []).slice(0, 3).map((item, itemIndex) => (
						<div key={item.id} className="flex items-center gap-1">
							<span
								className="h-1.5 rounded-full bg-accent"
								style={{ width: `${shares[itemIndex]}%` }}
							/>
							<span className="h-1.5 flex-1 rounded-full bg-text-dim/25" />
						</div>
					))}
				</div>
			);
		}
		case "guess-number": {
			// The gist is the *distribution*: a run of columns peaking somewhere in
			// the middle, with the reference line beside the peak once the slide
			// has one. Recognised by its shape, like the grid's field, not by any
			// authored text.
			const heights = [20, 45, 80, 100, 65, 30];
			return (
				<div className="relative flex h-6 items-end gap-[2px]">
					{heights.map((height, columnIndex) => (
						<span
							// The bars are a fixed silhouette, not authored data — their
							// position in the run is the only identity they have.
							key={`${slide.id}-col-${columnIndex}`}
							className="w-1 rounded-t-sm bg-accent/70"
							style={{ height: `${height}%` }}
						/>
					))}
					{slide.guessReference && (
						<span className="absolute inset-y-0 left-[52%] w-px bg-success" />
					)}
				</div>
			);
		}
		case "pin-image":
			// The gist is a marked spot on a frame: the picture's outline with a pin
			// on it, and the target area behind it once the slide names one. Like the
			// grid's field, the shape is what makes the slide recognisable — the
			// image itself is drawn full-size on the canvas above.
			return (
				<div className="relative h-6 w-9 rounded-sm border border-text-dim/40">
					{slide.pinArea && (
						<span className="absolute left-[45%] top-[20%] h-2.5 w-3 rounded-sm border border-dashed border-success/70" />
					)}
					<span className="absolute left-[30%] top-[55%] h-1 w-1 rounded-full bg-accent" />
					<span className="absolute left-[58%] top-[38%] h-1.5 w-1.5 rounded-full bg-accent" />
				</div>
			);
		case "form": {
			// The gist is the *stack of inputs* (REQ061): a caption over an empty
			// box, once per field, and a submit bar under them. The shape is what
			// makes a form recognisable in the rail — a row of labelled boxes reads
			// as one thing to fill in, which no other slide type here looks like.
			const fields = (slide.formFields ?? []).slice(0, 3);
			return (
				<div className="flex flex-col gap-1">
					{fields.map((field) => (
						<div key={field.id} className="flex flex-col gap-[2px]">
							<span className="h-[3px] w-1/3 rounded-full bg-text-dim/40" />
							<span className="h-[5px] w-full rounded-sm border border-text-dim/40" />
						</div>
					))}
					<span className="mt-[1px] h-1.5 w-1/3 rounded-full bg-accent" />
				</div>
			);
		}
		case "leaderboard": {
			// The gist is the *podium* (REQ059): three rows, longest first, the top
			// one picked out. A silhouette rather than authored data — a board has
			// nothing to author beyond how many rows it shows.
			const places = [
				{ width: "78%", tone: "bg-warning/80" },
				{ width: "58%", tone: "bg-text-dim/50" },
				{ width: "40%", tone: "bg-accent/60" },
			];
			return (
				<div className="flex flex-col gap-1">
					{places.map((place) => (
						<span
							key={place.width}
							className={`h-1.5 rounded-full ${place.tone}`}
							style={{ width: place.width }}
						/>
					))}
				</div>
			);
		}
		case "image":
			return (
				<div className="flex items-center gap-1 text-text-dim">
					<ImageIcon size={12} />
					<span className="h-1 w-1/2 rounded-full bg-text-dim/40" />
				</div>
			);
		case "video":
			// REQ064 — a frame with a play button on it. There is no still to draw:
			// the file lives on somebody else's server and the rail has no way to ask
			// it for one, so the gist says *video* rather than showing this video.
			return (
				<div className="flex items-center gap-1 text-text-dim">
					<PlayCircle size={12} />
					<span className="h-1 w-1/2 rounded-full bg-text-dim/40" />
				</div>
			);
		case "embed": {
			// REQ066/REQ067/REQ068 — whose deck or board this frames, said in the
			// rail. There is nothing to draw: the material lives in somebody else's
			// viewer and the filmstrip has no way to ask it for a still, so the gist
			// names the provider a resolvable link points at — which is also the
			// quickest way to spot the slide whose link the deck cannot embed.
			const embed = slideEmbedFor(slide);
			return (
				<div className="flex items-center gap-1 text-text-dim">
					<Presentation size={12} />
					<span className="truncate text-[9px]">
						{embed ? EMBED_PROVIDERS[embed.provider].label : "No embed link"}
					</span>
				</div>
			);
		}
		case "instruction":
			return (
				<div className="flex items-center gap-1 text-text-dim">
					<QrCode size={12} />
					<span className="font-mono text-[9px] tracking-widest">······</span>
				</div>
			);
		default:
			// text and any future content type — paragraph lines.
			return (
				<div className="flex flex-col gap-1">
					<span className="h-1 w-full rounded-full bg-text-dim/40" />
					<span className="h-1 w-2/3 rounded-full bg-text-dim/40" />
				</div>
			);
	}
}

export function SlideThumbnail({
	index,
	slide,
	active,
	onClick,
	dragging = false,
	dropTarget = false,
	onDragStart,
	onDragEnter,
	onDragOver,
	onDrop,
	onDragEnd,
}: {
	index: number;
	slide: Slide;
	active: boolean;
	onClick: () => void;
	/** This thumbnail is the one currently being dragged. */
	dragging?: boolean;
	/** A dragged slide is hovering this thumbnail — it is the pending drop slot. */
	dropTarget?: boolean;
	onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
	onDragEnter?: (event: DragEvent<HTMLButtonElement>) => void;
	onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
	onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
	onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void;
}) {
	// The slide's own background (REQ070/REQ071) as the filmstrip shows it, read
	// through the one resolver so the rail cannot draw a picture the room would
	// refuse to load — this value goes straight into a `background-image`.
	//
	// Only the background is worn here, not the slide's whole appearance: the rail
	// is editor chrome and stays in the app's own theme (the same decision the
	// preview pane states in reverse), so its text and its gist keep the colours
	// of the surface they sit on rather than of the deck.
	const appearance = slideAppearanceFor(slide);
	const placement = SLIDE_PLACEMENT_CLASSES[appearance.placement];
	const hasBackground =
		appearance.backgroundImage !== "" || appearance.backgroundColor !== "";
	// The rail's gist, not the slide: markup comes off (REQ089) for the same
	// reason it does in SlideRailItem — two lines of clamped text name a slide
	// better as words than as the stars and brackets they were typed with.
	const title =
		slideTextToPlain(slide.question ?? "") || SLIDE_TYPE_LABELS[slide.type];

	// Drag interaction states are local to this editor-only rail (no second
	// surface drags slides), so they live here rather than in a shared token:
	// the lifted slide fades; the pending drop slot wears an accent ring.
	const dragState = dragging
		? "opacity-40"
		: dropTarget
			? "ring-2 ring-accent ring-offset-2 ring-offset-surface"
			: "";

	return (
		<button
			type="button"
			onClick={onClick}
			draggable
			onDragStart={onDragStart}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDrop={onDrop}
			onDragEnd={onDragEnd}
			className={`group relative w-36 md:w-full flex-shrink-0 cursor-grab rounded-lg border p-1.5 text-left transition-all active:cursor-grabbing ${dragState} ${slideRailItemSurface(
				active,
			)}`}
			title={title}
		>
			{/* Meta row: ordinal + type icon + drag handle */}
			<div className="flex items-center gap-1.5 px-0.5 pb-1">
				<span className="font-mono text-[11px] text-text-muted">{index + 1}</span>
				<SlideTypeIcon type={slide.type} />
				<GripVertical
					size={13}
					className="ml-auto text-text-dim opacity-0 transition-opacity group-hover:opacity-100"
					aria-hidden
				/>
			</div>

			{/* Mini canvas */}
			<div
				className="relative h-16 overflow-hidden rounded-md border border-border-subtle bg-void/70 p-2"
				style={{
					...(appearance.backgroundColor !== ""
						? { backgroundColor: appearance.backgroundColor }
						: {}),
					...(appearance.backgroundImage !== ""
						? {
								backgroundImage: `url(${JSON.stringify(appearance.backgroundImage)})`,
								backgroundSize: "cover",
								backgroundPosition: "center",
							}
						: {}),
				}}
			>
				{slide.mediaUrl && slide.type === "image" ? (
					<img
						src={slide.mediaUrl}
						alt=""
						className="absolute inset-0 h-full w-full object-cover"
					/>
				) : (
					<div
						className={`relative flex h-full flex-col gap-1.5 ${
							hasBackground ? "rounded-sm bg-void/50 p-1" : ""
						}`}
					>
						<p
							className={`line-clamp-2 text-[10px] font-medium leading-snug text-text ${placement.text}`}
						>
							{title}
						</p>
						<div className="mt-auto">
							<ThumbnailGist slide={slide} />
						</div>
					</div>
				)}
			</div>
		</button>
	);
}
