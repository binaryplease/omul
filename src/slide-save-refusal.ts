import { isChoiceShapedSlide } from "./components/SlideCanvasFields";
import {
	ENGLISH_INTERFACE_TEXT,
	fillText,
	type InterfaceText,
} from "./interface-text";
import type { Slide } from "./types";
import {
	gridAxesFor,
	guessRangeFor,
	guessReferenceFor,
	isReachableGuessReference,
	pinAreaFor,
	pinImageFor,
	slideEmbedFor,
	slideRequiresQuestion,
	slideVideoFor,
} from "./types";

// ── Why the editor will not save a slide ─────────────────────
//
// The editor's own save rules: the things a deck can hold on the wire and still
// not work in front of a room, refused at Save rather than discovered on a
// projector. They lived inline in `CreatePage.handleSubmit` and are said here,
// as one pure reading, so that what blocks a save can be asserted without a
// page — and so the refusal is one value carrying both halves a surface needs:
// the words, and the slide to put the author in front of (REQ220).
//
// What is *not* here is as deliberate: a quiz with no answer key saves (REQ219).
// It is a draft an author is still writing far more often than a mistake, so it
// is warned about on the slide, in the slide list and at go-live instead — see
// `quizHasAnswerKey`. And the write caps are `slideWriteRefusalFor`'s, checked
// after these against the schema the boundary parses with.
//
// The words are the author's, so they are the interface language's (REQ248,
// `editor` in `src/interface-text/`); the English default is what every caller
// without a provider reads.

/** A slide the editor refuses to save, and why — in the editor's own words. */
export type SlideSaveRefusal = { slideIndex: number; message: string };

/**
 * The first slide in `slides` the editor will not save, or `null` when every
 * slide may be saved.
 *
 * The message names the slide by its rail number (from 1), so a refusal read
 * aloud or in the banner says *which* slide without the author having to find
 * it — the page also selects it, but a banner that says only "All slides need
 * a question" leaves a reader of a long deck to guess which one did not.
 */
export function slideSaveRefusalFor(
	slides: readonly Slide[],
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): SlideSaveRefusal | null {
	for (const [slideIndex, slide] of slides.entries()) {
		const reason = slideRefusalReason(slide, text.editor);
		if (reason) {
			return {
				slideIndex,
				message: fillText(text.editor.saveRefusalOnSlide, {
					number: slideIndex + 1,
					reason,
				}),
			};
		}
	}
	return null;
}

/** Why one slide cannot be saved, or `null` when it can. */
function slideRefusalReason(
	slide: Slide,
	words: InterfaceText["editor"],
): string | null {
	// Only a slide that collects answers needs a question (REQ220): a content
	// slide shows something, and a leaderboard's empty heading is drawn as the
	// board's own title on every surface.
	if (slideRequiresQuestion(slide.type) && !slide.question.trim()) {
		return words.questionRequired;
	}
	if (slide.type === "image" && !slide.mediaUrl?.trim()) {
		return words.imageUrlRequired;
	}
	// REQ064 — a video slide is the video, so a deck cannot ship one that
	// points at nothing, and it is refused here rather than discovered as a
	// dead rectangle on a projector. Both failures are the same failure: the
	// resolver is what the three rendering surfaces ask, so a URL it will not
	// play is a slide that will not play.
	if (slide.type === "video" && !slide.mediaUrl?.trim()) {
		return words.videoUrlRequired;
	}
	if (slide.type === "video" && !slideVideoFor(slide)) {
		return words.videoUnplayable;
	}
	// REQ066/REQ067/REQ068 — an embed slide is the external deck or board, so
	// the same rule applies for the same reason, against the same resolver
	// the three rendering surfaces ask. A link outside the three providers is
	// refused here rather than framed on a guess later.
	if (slide.type === "embed" && !slide.mediaUrl?.trim()) {
		return words.embedUrlRequired;
	}
	if (slide.type === "embed" && !slideEmbedFor(slide)) {
		return words.embedUnusable;
	}
	// Only the option rows the author can see (REQ220): a quiz answered by
	// typing keeps the options it was created with but never shows them, so a
	// blank one there is not a row anybody could fill in.
	if (
		isChoiceShapedSlide(slide) &&
		slide.options?.some((option) => !option.text.trim())
	) {
		return words.optionTextRequired;
	}
	// REQ034: a nameless item is unrankable — participants would be
	// ordering a blank row against the ones they can read.
	if (
		slide.type === "ranking" &&
		slide.rankingItems?.some((item) => !item.text.trim())
	) {
		return words.rankingItemTextRequired;
	}
	// REQ045: a nameless item cannot be funded — participants would be
	// weighing a blank row against the ones they can read. Two items is
	// the floor: with one, the whole budget has nowhere else to go, so
	// there is no trade-off to force (REQ044).
	if (slide.type === "points") {
		if ((slide.pointsItems?.length ?? 0) < 2) {
			return words.pointsItemsTooFew;
		}
		if (slide.pointsItems?.some((item) => !item.text.trim())) {
			return words.pointsItemTextRequired;
		}
	}
	// REQ040/REQ043 — the frame is what makes an estimate an estimate, so
	// an unusable one is refused before it can be answered rather than
	// leaving participants to discover it by having every guess rejected.
	if (slide.type === "guess-number") {
		const range = guessRangeFor(slide);
		if (range.max <= range.min) {
			return words.guessRangeInverted;
		}
		if (range.step < 1 || range.step > range.max - range.min) {
			return words.guessStepInvalid;
		}
		// REQ041/REQ042 — a reference no selectable value can reach claims a
		// correct answer while scoring every participant wrong forever, which
		// is worse than having no reference at all. The reference itself need
		// not sit on the step grid (a true figure of 517 on a slide stepping
		// in tens is a fine question at ±10); what must hold is that the
		// tolerance window contains at least one value the slide offers.
		if (!isReachableGuessReference(range, guessReferenceFor(slide))) {
			return words.guessReferenceUnreachable;
		}
	}
	// REQ061 — a form with no answerable field asks nothing: the vote
	// boundary refuses every submission to it, and the slide would meet the
	// room as a heading over a submit button. Both failures are the same
	// failure — `isUsableFormField` is what the boundary, the phone and the
	// tally all read, so a field it will not accept is a field that is not
	// there. Refused at save rather than discovered in front of an audience.
	if (slide.type === "form") {
		const fields = slide.formFields ?? [];
		if (fields.length === 0) {
			return words.formFieldRequired;
		}
		if (fields.some((field) => !(field.label ?? "").trim())) {
			return words.formFieldLabelRequired;
		}
		// A choice field with nothing to choose between is the one way a
		// labelled field can still be unanswerable.
		if (
			fields.some(
				(field) =>
					field.type === "choice" &&
					!(field.options ?? []).some((option) => option.text.trim()),
			)
		) {
			return words.choiceFieldOptionRequired;
		}
	}
	// REQ052 — the image *is* the question here: without it there is no
	// coordinate space for a pin, the vote boundary refuses every submission,
	// and the slide would meet the room as a blank frame. Refused at save
	// rather than left to be discovered on the projector.
	if (slide.type === "pin-image") {
		if (!pinImageFor(slide).url) {
			return words.pinImageRequired;
		}
		// REQ053 — an area part of which nobody can reach makes "how many were
		// inside?" a number about the picture rather than about the room, so a
		// target that runs off the image is refused the way an unreachable
		// guess reference is. A slide with no area at all is fine: it simply
		// claims no correct answer.
		if (slide.pinArea && !pinAreaFor(slide)) {
			return words.pinAreaOffImage;
		}
	}
	if (slide.type === "grid") {
		// REQ047 — a nameless item cannot be judged on either dimension.
		if (
			!slide.gridItems?.length ||
			slide.gridItems.some((item) => !item.text.trim())
		) {
			return words.gridItemTextRequired;
		}
		// REQ048 — an unnamed axis leaves "left vs right" to guesswork,
		// which is exactly the misreading axis titles exist to prevent.
		const { xAxis, yAxis } = gridAxesFor(slide);
		if (!xAxis.title.trim() || !yAxis.title.trim()) {
			return words.gridAxisTitleRequired;
		}
		// REQ049 — endpoints must describe a range to place items along.
		if (xAxis.min >= xAxis.max || yAxis.min >= yAxis.max) {
			return words.gridAxisRangeInverted;
		}
	}
	return null;
}
