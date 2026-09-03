import { EyeOff, StickyNote } from "lucide-react";
import { useState } from "react";
import type { Slide } from "../types";
import { SLIDE_TEXT_MAX_LENGTH, slideTextSizeFor } from "../types";
import { SLIDE_MARKDOWN_HINT, SlideText, slideTextToPlain } from "./SlideText";

// ── Presenter notes (REQ090) ──────────────────────────────────────────
//
// What the organizer wrote to themselves about the slide on screen, worn by
// both presenter surfaces — the live presenter page and the dry run's shared-
// screen pane (the invariant is "the notes for this slide as
// their author reads them while presenting", and two surfaces re-assembling that
// from a heading and a paragraph would drift into two different dialects of the
// same panel).
//
// **Nothing here is a security boundary, and that is deliberate.** A note never
// reaches a client that cannot edit the deck — the server empties it on the way
// out (`withAudienceSlides`), and the preview's audience pane re-projects the
// deck through the same function — so this module is only ever handed notes its
// holder authored. A panel that decided for itself who may read a note would be
// a second, weaker copy of a rule that is already settled on the wire.

/**
 * The notes on a slide, trimmed — `""` when the author wrote none.
 *
 * The single read site: a slide is not always a parsed one (the
 * editor holds a half-built slide, a hand-built deck may omit the field
 * entirely) and every surface must agree on what "this slide has notes" means,
 * down to a field holding nothing but whitespace.
 */
export function presenterNotesFor(slide: {
	notes?: string | undefined;
}): string {
	return (slide.notes ?? "").trim();
}

/** Whether this slide carries anything for its presenter to read. */
export function hasPresenterNotes(slide: {
	notes?: string | undefined;
}): boolean {
	return presenterNotesFor(slide).length > 0;
}

/**
 * What the control that opens the notes goes by, given what its viewer may
 * actually do with it (the button is never dropped, so each of its
 * states has to say out loud why it reads the way it does).
 */
export function presenterNotesToggleLabel({
	canRead,
	open,
	hasNotes,
}: {
	canRead: boolean;
	open: boolean;
	hasNotes: boolean;
}): string {
	if (!canRead) {
		// Names the standing rather than the edit token, because the token is only
		// one of the two ways to have it (REQ149): the deck's owner and an `edit`
		// collaborator read these notes holding no token at all, and a viewer who
		// really has neither is not helped by being told to find a token.
		return "Show presenter notes — you don't have edit access to this presentation, so its notes are not yours to read";
	}
	if (open) return "Hide presenter notes";
	return hasNotes
		? "Show presenter notes — what you wrote for yourself about this slide"
		: "Show presenter notes — this slide has none yet";
}

/**
 * What a note reads as on one line (REQ156) — the gist, not the note.
 *
 * `slideTextToPlain`, the same reduction a rail row and a thumbnail take, so a
 * note written with a list or a bold run collapses to its words rather than to
 * the stars it was typed with. `""` for a slide with no note, which is what the
 * strip turns into its invitation.
 */
export function presenterNotesSummary(slide: {
	notes?: string | undefined;
}): string {
	const notes = presenterNotesFor(slide);
	return notes === "" ? "" : slideTextToPlain(notes);
}

/**
 * What the strip says while it is closed: the note's first line, or the
 * invitation that stands in the same place when there is none (REQ156).
 *
 * The affordance does not disappear with its content — an empty strip that drew
 * nothing would be a feature an author finds once and never again.
 */
export function presenterNotesStripLabel(slide: {
	notes?: string | undefined;
}): string {
	return presenterNotesSummary(slide) || "Add presenter notes…";
}

/**
 * The one word this surface says about privacy, and it is a *report*: the server
 * empties the field for every caller that cannot edit the deck (REQ090), so this
 * marker states a fact that already holds on the wire rather than a promise this
 * strip keeps.
 */
export const PRESENTER_NOTES_PRIVACY_LABEL = "Only you";

/**
 * Presenter notes, written where the slide is (REQ156).
 *
 * A strip directly under the canvas rather than a field filed under settings:
 * notes are written in the same pass as the slide's words and read while
 * presenting that slide, so they belong with it — and every adjacent
 * tool an author has used puts them exactly there, which makes this the position
 * their hand already knows.
 *
 * Three states, one position. Collapsed it is a single readable line of what was
 * written; open it is the full editor, in place, with nothing moved; empty it
 * invites in the same place rather than disappearing with its content.
 *
 * Nothing here is a privacy boundary — see {@link PRESENTER_NOTES_PRIVACY_LABEL}
 * and the module note above. What the marker does is put a fact that is settled
 * on the wire in front of the person deciding what to write.
 */
export function PresenterNotesStrip({
	slide,
	onUpdate,
}: {
	slide: Slide;
	/** Writes the note back through the editor store's own action. */
	onUpdate: (changes: Partial<Slide>) => void;
}) {
	const [open, setOpen] = useState(false);
	const notes = presenterNotesFor(slide);

	if (!open) {
		return (
			<div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-xl border border-border bg-surface/40 px-3 py-2">
				<StickyNote size={14} className="flex-shrink-0 text-text-muted" />
				<button
					type="button"
					aria-expanded={false}
					aria-label={
						notes
							? "Edit presenter notes for this slide"
							: "Add presenter notes for this slide"
					}
					onClick={() => setOpen(true)}
					className={`min-w-0 flex-1 truncate text-left text-sm transition-colors hover:text-text ${
						notes ? "text-text-muted" : "text-text-muted italic"
					}`}
				>
					{presenterNotesStripLabel(slide)}
				</button>
				<span className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-xs text-text-muted">
					<EyeOff size={12} />
					{PRESENTER_NOTES_PRIVACY_LABEL}
				</span>
			</div>
		);
	}

	return (
		<div className="mx-auto w-full max-w-3xl space-y-2 rounded-xl border border-border bg-surface/40 px-3 py-2.5">
			<div className="flex items-center gap-2">
				<StickyNote size={14} className="flex-shrink-0 text-text-muted" />
				<span className="min-w-0 flex-1 text-sm font-medium text-text">
					Presenter notes
				</span>
				<span className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-xs text-text-muted">
					<EyeOff size={12} />
					{PRESENTER_NOTES_PRIVACY_LABEL}
				</span>
			</div>
			<textarea
				className="input"
				rows={4}
				// The caret belongs in the box the click just opened: this control
				// exists only because the author asked for it, so focusing it is
				// finishing their gesture rather than stealing it (see the deliberate
				// deviations table in docs/frontend.md).
				autoFocus
				maxLength={SLIDE_TEXT_MAX_LENGTH}
				placeholder="Cues, timings, the number you never remember…"
				value={slide.notes ?? ""}
				onChange={(event) => onUpdate({ notes: event.target.value })}
				aria-label="Presenter notes for this slide"
			/>
			<div className="flex items-center justify-between gap-3">
				<p className="min-w-0 text-xs text-text-muted">{SLIDE_MARKDOWN_HINT}</p>
				<button
					type="button"
					className="flex-shrink-0 text-xs text-text-muted transition-colors hover:text-text"
					onClick={() => setOpen(false)}
				>
					Done
				</button>
			</div>
		</div>
	);
}

/**
 * The notes for one slide, as their author reads them mid-presentation.
 *
 * Rendered through the same markup the slide's own words go through (REQ088/
 * REQ089), because a note is written in the same editor as everything else and
 * a list that is a list in the editor's preview must be a list here too. The
 * size step is the slide's, so a deck set large stays readable across the room
 * in the panel as well.
 *
 * An empty slide is not a blank panel: it says so, which is what tells an
 * organizer who opened the panel expecting a cue that they never wrote one —
 * rather than leaving them to wonder whether it failed to load.
 */
export function PresenterNotesPanel({
	slide,
	className = "",
}: {
	slide: Slide;
	className?: string;
}) {
	const notes = presenterNotesFor(slide);
	return (
		<section className={`flex flex-col gap-3 ${className}`}>
			<div className="flex items-center gap-2">
				<span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-accent">
					<StickyNote size={14} />
				</span>
				<div className="min-w-0">
					<h3 className="text-sm font-semibold text-text">Presenter notes</h3>
					<p className="text-xs text-text-dim">
						Yours only — never sent to participants or exported.
					</p>
				</div>
			</div>
			{notes ? (
				<div className="rounded-xl border border-border bg-surface/40 p-3 text-sm text-text-muted">
					<SlideText
						text={notes}
						size={slideTextSizeFor(slide)}
						variant="blocks"
					/>
				</div>
			) : (
				<p className="rounded-xl border border-dashed border-border px-3 py-4 text-xs text-text-dim">
					No notes on this slide. Add them in the editor — they follow the slide
					and only ever appear here.
				</p>
			)}
		</section>
	);
}
