import type { DeckThemeSettings, Slide, SlideEmbed, SlideVideo } from "../types";
import {
	EMBED_PROVIDERS,
	slideEmbedFor,
	slideTextSizeFor,
	slideVideoFor,
} from "../types";
import { DeckMark } from "./DeckTheme";
import {
	INSTRUCTION_FALLBACK_HEADING,
	type SlideCanvasEditing,
	SlideQuestion,
} from "./SlideCanvasFields";
import { slidePlacementClasses } from "./SlideAppearance";
import { SlideText, slideTextToPlain } from "./SlideText";
import { QRCodeDisplay } from "./ui/QRCode";

// ── Shared renderer for content slides (text/image/video/embed/instruction) ─
//
// REQ062 (text), REQ063 (image), REQ064 (video), REQ066/REQ067/REQ068 (an
// externally hosted PowerPoint or Google Slides deck, or a Miro board),
// REQ065/REQ118 (instruction slide with auto-generated join code + QR). Used by
// SlidePreview, PresenterPage and ParticipantPage so the three views stay
// visually in sync.
//
// Every authored string here goes through <SlideText/> (REQ088/REQ089/REQ091):
// the heading as one inline run, the body as blocks, both at the organizer's
// chosen step. The surface keeps its own base sizes — `compact` is still a
// preview pane and the live view is still a projector — and the step scales
// each of them from there.
//
// The heading itself goes through <SlideQuestion/> (REQ153), which is the same
// inline run in the same slot plus one thing this surface never uses: handed the
// editor's layer, it becomes the field that authors it. Five branches drew that
// heading five identical ways before, which is one drift away from a caption
// that is bold on a video slide and not on an image.

export function ContentSlideView({
	slide,
	joinCode,
	joinUrl,
	deck,
	compact,
	editing = null,
}: {
	slide: Slide;
	/** Required for "instruction" slides to render the join info. */
	joinCode?: string;
	joinUrl?: string;
	/**
	 * The deck an instruction slide's join screen belongs to (REQ136) — it is the
	 * screen a room reads the code off, so it wears the organizer's mark. Absent
	 * on every other slide type, which has no mark of its own to carry.
	 */
	deck?: DeckThemeSettings | null;
	/** Shrinks fonts/sizes for preview panels. */
	compact?: boolean;
	/**
	 * The editor's authoring layer (REQ153), when this rendering *is* the canvas.
	 * Absent — and unreachable — on the presenter's screen and every phone: those
	 * two call sites pass nothing, and the guard in
	 * `scripts/guard-frontend-conventions.ts` is what keeps it that way.
	 */
	editing?: SlideCanvasEditing | null;
}) {
	const textSize = slideTextSizeFor(slide);
	// The typographic slot the heading sits in on this surface — the one place
	// `compact` decides how big a caption is, composed by all five branches.
	const headingClass = compact
		? "w-full text-lg font-bold break-words"
		: "w-full text-3xl font-bold break-words";
	// Where this slide's elements sit (REQ087) — the slide's own layout over the
	// theme's, read through the one resolver every surface reads it through.
	const placement = slidePlacementClasses(slide);

	if (slide.type === "text") {
		return (
			<div className={`w-full flex flex-col gap-4 ${placement.items} ${placement.text}`}>
				<SlideQuestion
					slide={slide}
					className={headingClass}
					editing={editing}
				/>
				{slide.body ? (
					<div
						className={
							compact
								? "text-sm text-text-muted break-words"
								: "text-lg text-text break-words max-w-2xl"
						}
					>
						<SlideText text={slide.body} size={textSize} variant="blocks" />
					</div>
				) : (
					<p className="text-text-dim italic text-sm">No body text</p>
				)}
				{slide.mediaUrl && (
					<img
						src={slide.mediaUrl}
						alt={slide.mediaAlt ?? ""}
						className={
							compact
								? "max-h-40 rounded-lg object-contain"
								: "max-h-80 rounded-xl object-contain"
						}
					/>
				)}
			</div>
		);
	}

	if (slide.type === "image") {
		return (
			<div className={`w-full flex flex-col gap-4 ${placement.items} ${placement.text}`}>
				<SlideQuestion
					slide={slide}
					className={headingClass}
					editing={editing}
				/>
				{slide.mediaUrl ? (
					/* An accessible name *names* the slide rather than showing it, so
					   the heading falls back through slideTextToPlain() the way the
					   rail and the thumbnail do — a screen reader reading out the
					   stars and brackets of `**Q3** — see [the report](https://…)`
					   says less than the words alone do. */
					<img
						src={slide.mediaUrl}
						alt={slide.mediaAlt ?? slideTextToPlain(slide.question ?? "")}
						className={
							compact
								? "max-h-56 rounded-lg object-contain"
								: "max-h-[70vh] rounded-xl object-contain"
						}
					/>
				) : (
					<div className="px-6 py-12 rounded-xl border border-dashed border-border text-text-dim text-sm">
						No image URL set
					</div>
				)}
				{slide.body && (
					<div
						className={
							compact
								? "text-xs text-text-muted"
								: "text-base text-text-muted max-w-2xl"
						}
					>
						<SlideText text={slide.body} size={textSize} variant="blocks" />
					</div>
				)}
			</div>
		);
	}

	if (slide.type === "video") {
		// REQ064 — the slide's central element is a video played from an external
		// URL. Which player it gets is decided once, in the schema, so the editor
		// preview and the two live surfaces never disagree about whether a link is
		// a file or a platform's page.
		const video = slideVideoFor(slide);
		return (
			<div className={`w-full flex flex-col gap-4 ${placement.items} ${placement.text}`}>
				<SlideQuestion
					slide={slide}
					className={headingClass}
					editing={editing}
				/>
				{video ? (
					<VideoPlayer
						video={video}
						title={
							/* The frame's accessible name *names* the video rather than
							   showing it, so the heading falls back through
							   slideTextToPlain() the way the image slide's alt text does. */
							slideTextToPlain(slide.question ?? "") || "Video"
						}
						compact={compact}
					/>
				) : (
					<div className="px-6 py-12 rounded-xl border border-dashed border-border text-text-dim text-sm">
						{(slide.mediaUrl ?? "").trim()
							? "That video URL can't be played — use an http(s) link"
							: "No video URL set"}
					</div>
				)}
				{slide.body && (
					<div
						className={
							compact
								? "text-xs text-text-muted"
								: "text-base text-text-muted max-w-2xl"
						}
					>
						<SlideText text={slide.body} size={textSize} variant="blocks" />
					</div>
				)}
			</div>
		);
	}

	if (slide.type === "embed") {
		// REQ066/REQ067/REQ068 — the slide *is* the external deck or board. Whose
		// viewer it opens, and at which URL, is decided once in the schema, so the
		// editor preview and the two live surfaces frame the same thing — and so
		// nothing here is ever pointed at the raw string somebody pasted.
		const embed = slideEmbedFor(slide);
		return (
			<div className={`w-full flex flex-col gap-4 ${placement.items} ${placement.text}`}>
				<SlideQuestion
					slide={slide}
					className={headingClass}
					editing={editing}
				/>
				{embed ? (
					<EmbedFrame
						embed={embed}
						title={
							/* The frame's accessible name *names* what is embedded rather
							   than showing it, so the heading falls back through
							   slideTextToPlain() the way the video slide's does — and when
							   there is no heading, the provider is what there is to say. */
							slideTextToPlain(slide.question ?? "") ||
							EMBED_PROVIDERS[embed.provider].label
						}
						compact={compact}
					/>
				) : (
					<div className="px-6 py-12 rounded-xl border border-dashed border-border text-text-dim text-sm">
						{(slide.mediaUrl ?? "").trim()
							? "That link can't be embedded — use a Google Slides, PowerPoint or Miro link"
							: "No embed URL set"}
					</div>
				)}
				{slide.body && (
					<div
						className={
							compact
								? "text-xs text-text-muted"
								: "text-base text-text-muted max-w-2xl"
						}
					>
						<SlideText text={slide.body} size={textSize} variant="blocks" />
					</div>
				)}
			</div>
		);
	}

	if (slide.type === "instruction") {
		// REQ065 + REQ118: auto-generated how-to-join slide with code + QR.
		const fallbackBody =
			"Go to the URL below or scan the QR code, then enter the code.";
		return (
			<div className={`w-full flex flex-col gap-5 ${placement.items} ${placement.text}`}>
				{/* REQ136 — the organizer's mark above the code, on the one slide whose
				    whole job is to be the room's front door. Nothing is drawn when the
				    deck carries no logo: this slide has no default mark to stand in
				    for, and an accent dot invented here would appear on every deck. */}
				<DeckMark deck={deck ?? null} size={compact ? "sm" : "lg"} fallback="none" />
				{/* The one heading with a default the room really shows, so the
				    fallback is passed as text rather than as a placeholder: an
				    unauthored front door reads "Join the presentation" on the
				    projector, and the canvas says so in the muted colour while it can
				    still be typed over (REQ153). */}
				<SlideQuestion
					slide={slide}
					className={headingClass}
					fallback={INSTRUCTION_FALLBACK_HEADING}
					editing={editing}
				/>
				<div
					className={
						compact
							? "text-xs text-text-muted"
							: "text-base text-text-muted max-w-xl"
					}
				>
					<SlideText
						text={slide.body || fallbackBody}
						size={textSize}
						variant="blocks"
					/>
				</div>

				{/* QR code (shown full-size in live, shrunken in compact/preview) */}
				<div className="bg-white rounded-xl p-3">
					<QRCodeDisplay
						url={joinUrl ?? "https://example.com/join/000000"}
						size={compact ? 96 : 200}
					/>
				</div>

				{/* Join code (big + monospace) */}
				<div className="flex flex-col items-center gap-1">
					<span className="text-xs uppercase tracking-widest text-text-dim">
						Code
					</span>
					<span
						className={
							compact
								? "font-mono font-bold text-accent-text text-xl tracking-widest"
								: "font-mono font-bold text-accent-text text-5xl tracking-widest"
						}
					>
						{joinCode ?? "------"}
					</span>
				</div>

				{joinUrl && (
					<span
						className={
							compact
								? "font-mono text-[10px] text-text-dim break-all"
								: "font-mono text-sm text-text-muted break-all"
						}
					>
						{joinUrl}
					</span>
				)}
			</div>
		);
	}

	return null;
}

/**
 * The player a video slide's URL is opened in (REQ064) — a provider's frame or
 * the browser's own media element, whichever {@link slideVideoFor} resolved.
 *
 * Neither autoplays. A deck is read on a projector *and* on every phone in the
 * room at the same time, so a video that started itself would start in dozens of
 * places at once, out of sync and each with its own audio; the presenter presses
 * play on the screen the room is looking at. It is also the only behaviour that
 * survives contact with browsers, which refuse unmuted autoplay anyway.
 *
 * The frame is sandboxed to what a player needs and nothing more. `allow-scripts`
 * and `allow-same-origin` are the platform's own player running against its own
 * origin — not ours — while everything the sandbox withholds by default is the
 * point: an embedded page cannot navigate the deck away from under the audience,
 * open a window, or submit a form.
 */
function VideoPlayer({
	video,
	title,
	compact,
}: {
	video: SlideVideo;
	title: string;
	compact?: boolean;
}) {
	const frame = `w-full ${compact ? "max-w-sm" : "max-w-4xl"} aspect-video rounded-xl overflow-hidden bg-black`;
	if (video.kind === "embed") {
		return (
			<iframe
				src={video.url}
				title={title}
				className={frame}
				allow="accelerometer; encrypted-media; fullscreen; picture-in-picture"
				sandbox="allow-scripts allow-same-origin allow-presentation"
				referrerPolicy="strict-origin-when-cross-origin"
				loading="lazy"
			/>
		);
	}
	return (
		// No <track>: captions travel with a file, and this service hosts neither
		// the file nor anything alongside it (REQ064).
		<video
			src={video.url}
			title={title}
			className={`${frame} object-contain`}
			controls
			playsInline
			preload="metadata"
		/>
	);
}

/**
 * The provider's viewer an embed slide frames (REQ066/REQ067/REQ068), at the URL
 * {@link slideEmbedFor} resolved — never at the string the organizer typed.
 *
 * The controls are the provider's own and that is the whole shape of the
 * feature: a deck is paged through with the arrows inside the frame, a board is
 * panned and worked in, and both happen without the room leaving the deck flow.
 * Nothing here drives the embedded deck, and nothing reads its state back.
 *
 * The frame is sandboxed to what a viewer needs and nothing more, like the video
 * player above. `allow-scripts` and `allow-same-origin` are the provider's own
 * viewer running against its own origin — not ours — while what the sandbox
 * withholds by default is the point: an embedded page cannot navigate the deck
 * away from under the audience, open a window, or submit a form. Capabilities on
 * top of that are granted by what is embedded rather than by surface: a board is
 * worked in, so it may put a copied sticky on the clipboard; a deck is read, so
 * it may not.
 */
function EmbedFrame({
	embed,
	title,
	compact,
}: {
	embed: SlideEmbed;
	title: string;
	compact?: boolean;
}) {
	const { interactive } = EMBED_PROVIDERS[embed.provider];
	// A board is worked in rather than read, so it gets the squarer frame it is
	// drawn on; a deck keeps the 16:9 it was authored at.
	const shape = interactive ? "aspect-[4/3]" : "aspect-video";
	return (
		<iframe
			src={embed.url}
			title={title}
			className={`w-full ${compact ? "max-w-sm" : "max-w-4xl"} ${shape} rounded-xl overflow-hidden bg-void border border-border-subtle`}
			allow={interactive ? "clipboard-write; fullscreen" : "fullscreen"}
			sandbox="allow-scripts allow-same-origin allow-presentation"
			referrerPolicy="strict-origin-when-cross-origin"
			loading="lazy"
		/>
	);
}
