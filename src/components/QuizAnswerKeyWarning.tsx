import { AlertTriangle } from "lucide-react";
import type { Slide } from "../types";
import {
	quizAnswerModeFor,
	quizHasAnswerKey,
	quizSlidesWithoutAnswerKey,
} from "../types";
import { slideTextToPlain } from "./SlideText";

// ── A quiz question nobody can get right ─────────────────────
//
// A quiz with no option marked correct, or no accepted answer to a typed one,
// saves — it is a draft far more often than a mistake — but every answer to it
// scores 0, and nothing on a participant's phone says why (REQ219). So the
// editor says it in three places, each where the author will meet it: on the
// slide's own settings, on its thumbnail in the slide list, and when the deck
// goes live. One wording, said here and composed by all three, so the slide list
// cannot call the slide something its settings do not.

/** What is wrong with such a slide, in one line. */
export const QUIZ_NO_ANSWER_KEY_WARNING =
	"No correct answer yet — every answer to this question scores 0.";

/**
 * What to do about it, by answer mode: a select-answer question is fixed on the
 * slide, where the options are marked; a typed one in the field below.
 */
export function quizAnswerKeyRemedy(slide: Slide): string {
	return quizAnswerModeFor(slide) === "type"
		? "Add an accepted answer below."
		: "Mark the correct option on the slide.";
}

/**
 * The warning on the slide's own settings. A polite status region that is
 * always in the tree, so marking an answer and taking it back again is heard as
 * the warning going and coming rather than happening silently — a live region
 * only announces what changes inside it after it exists.
 */
export function QuizAnswerKeyWarning({ slide }: { slide: Slide }) {
	return (
		<div role="status">
			{!quizHasAnswerKey(slide) && (
				<p className="flex gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
					<AlertTriangle size={13} className="mt-px flex-shrink-0" aria-hidden />
					<span>
						{QUIZ_NO_ANSWER_KEY_WARNING} {quizAnswerKeyRemedy(slide)}
					</span>
				</p>
			)}
		</div>
	);
}

/**
 * What the presenter is told before going live on a deck whose quiz questions
 * include some nobody can get right, or `null` when there are none (REQ219).
 *
 * Each one is named by its slide number and its question, the way the rail
 * shows it, so the presenter can decide whether to start anyway without
 * opening the editor to find out which slides were meant.
 */
export function quizAnswerKeyGoLiveWarning(
	slides: readonly Slide[],
): { title: string; message: string } | null {
	const missingIndexes = quizSlidesWithoutAnswerKey(slides);
	if (missingIndexes.length === 0) return null;
	const named = missingIndexes.map((slideIndex, position) => {
		const ordinal = `${position === 0 ? "Slide" : "slide"} ${slideIndex + 1}`;
		const question = slideTextToPlain(slides[slideIndex].question);
		return question ? `${ordinal} (“${question}”)` : ordinal;
	});
	const list = new Intl.ListFormat("en", {
		style: "long",
		type: "conjunction",
	}).format(named);
	const single = missingIndexes.length === 1;
	return {
		title: single
			? "A quiz question has no correct answer"
			: "Some quiz questions have no correct answer",
		message: `${list} ${single ? "has" : "have"} no correct answer, so every answer to ${
			single ? "it" : "them"
		} scores 0. Start anyway, or cancel and mark the answers in the editor.`,
	};
}
