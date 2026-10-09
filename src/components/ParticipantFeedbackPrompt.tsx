/**
 * The prompt after a session (REQ186): a card on the participant's ended
 * screen asking, once, what they think of omul.
 *
 * Three things make it what it is, and each has one home here:
 *
 *   - **It is visibly not the organizer's.** The ended screen around it wears
 *     the deck's theme under the organizer's logo; the card is a
 *     `DeckThemeScope` with `deck={null}` — omul's built-in default, the scope
 *     the join and loading screens wear — and carries omul's own `BrandMark`.
 *     Being a different surface is what tells the participant whose question
 *     this is; the heading and the sentence under it say it in words, in the
 *     deck's language.
 *   - **It is anonymous.** It draws the shared `FeedbackForm` with no contact
 *     box, whoever is signed in, and sends `{ rating, comment, language }` to
 *     `POST /api/feedback/participant` — nothing naming the participant, the
 *     deck or an account (`buildParticipantFeedbackSubmission()`).
 *   - **It is asked once.** Whether it is drawn at all is
 *     `shouldAskForParticipantFeedback()`'s to say (`src/feedback-prompt.ts`),
 *     read once per run of the deck; nothing here restates a condition. An
 *     answer and a dismissal both record the ask on the device, so a reload
 *     inside the cooldown draws no card.
 */

import { X } from "lucide-react";
import { useId, useState } from "react";
import { api } from "../api";
import {
	buildParticipantFeedbackSubmission,
	type FeedbackDraft,
	useFeedbackConfig,
} from "../feedback";
import {
	rememberAskedForFeedback,
	shouldAskForParticipantFeedback,
} from "../feedback-prompt";
import { type Dict, getDict, type Lang, resolveLang } from "../i18n";
import type {
	FeedbackConfig,
	ParticipantFeedbackSubmission,
	Presentation,
} from "../types";
import { BrandMark } from "./BrandMark";
import { DeckThemeScope } from "./DeckTheme";
import {
	FeedbackForm,
	type FeedbackFormLabels,
	feedbackFormLabelsFor,
	withBrandName,
} from "./FeedbackForm";
import { ICON_BUTTON_HOVER } from "./ShareCluster";

/**
 * The wordmark's height on the card: tall enough that the form rule draws the
 * four letters rather than the ring, so the card names omul in its own mark.
 */
const CARD_MARK_HEIGHT_PX = 24;

/** What the card says, in the deck's language. */
export type FeedbackPromptLabels = {
	heading: string;
	intro: string;
	dismiss: string;
	form: FeedbackFormLabels;
};

/** The card's words out of a language's dictionary, mapped in one place. */
export function feedbackPromptLabelsFor(dict: Dict): FeedbackPromptLabels {
	return {
		heading: withBrandName(dict.feedbackPromptHeading),
		intro: withBrandName(dict.feedbackPromptIntro),
		dismiss: dict.feedbackPromptDismiss,
		form: feedbackFormLabelsFor(dict),
	};
}

/**
 * Send an answer, then record that this device was asked. A send that fails
 * records nothing and rejects, so the form keeps the draft and says why.
 */
export async function answerFeedbackPrompt(
	draft: FeedbackDraft,
	language: Lang,
	send: (
		submission: ParticipantFeedbackSubmission,
	) => Promise<unknown> = api.sendParticipantFeedback,
): Promise<void> {
	await send(buildParticipantFeedbackSubmission(draft, language));
	rememberAskedForFeedback();
}

/** Close the card unanswered — which counts as being asked. */
export function dismissFeedbackPrompt(): void {
	rememberAskedForFeedback();
}

/** The card itself: props in, markup out. */
export function ParticipantFeedbackCard({
	language,
	onSend,
	onDismiss,
	onClose,
}: {
	language: Lang;
	onSend: (draft: FeedbackDraft) => Promise<void>;
	/** The close control on the card's corner. */
	onDismiss: () => void;
	/** The Close button under the thanks, once the answer is stored. */
	onClose: () => void;
}) {
	const headingId = useId();
	const labels = feedbackPromptLabelsFor(getDict(language));
	return (
		<DeckThemeScope deck={null}>
			<section
				aria-labelledby={headingId}
				lang={language}
				className="relative z-10 mt-8 w-full max-w-sm rounded-2xl border border-border bg-surface p-5 text-left text-text shadow-panel"
			>
				<div className="mb-3 flex items-start justify-between gap-2">
					<BrandMark heightPx={CARD_MARK_HEIGHT_PX} />
					<button
						type="button"
						onClick={onDismiss}
						aria-label={labels.dismiss}
						title={labels.dismiss}
						className={`-mr-1 -mt-1 flex size-8 flex-shrink-0 items-center justify-center rounded-lg border-none bg-transparent cursor-pointer ${ICON_BUTTON_HOVER}`}
					>
						<X size={16} aria-hidden />
					</button>
				</div>
				<h2 id={headingId} className="m-0 text-base font-semibold text-text">
					{labels.heading}
				</h2>
				<p className="m-0 mt-1 mb-4 text-sm text-text-muted">{labels.intro}</p>
				{/* No headingId: the card's heading above stands for the form, and
				    stays put after the answer is sent. No address: the prompt never
				    draws the contact box (REQ186). */}
				<FeedbackForm
					labels={labels.form}
					contactEmail={null}
					onSend={onSend}
					onDone={onClose}
				/>
			</section>
		</DeckThemeScope>
	);
}

/**
 * The prompt for one run of one deck under one configuration: decided once, on
 * mount, so recording the ask on an answer does not pull the card — and its
 * thanks — out from under the participant.
 */
export function ParticipantFeedbackPromptFor({
	config,
	deck,
	participantId,
}: {
	config: Pick<FeedbackConfig, "promptPercent" | "promptCooldownDays">;
	deck: Pick<Presentation, "id" | "sessionStartedAt" | "language">;
	participantId: string;
}) {
	const [open, setOpen] = useState(() =>
		shouldAskForParticipantFeedback({ config, deck, participantId }),
	);
	if (!open) return null;
	const language = resolveLang(deck.language);
	return (
		<ParticipantFeedbackCard
			language={language}
			onSend={(draft) => answerFeedbackPrompt(draft, language)}
			onDismiss={() => {
				dismissFeedbackPrompt();
				setOpen(false);
			}}
			onClose={() => setOpen(false)}
		/>
	);
}

/**
 * The prompt on the ended screen. Draws nothing until the instance's
 * configuration has been read — it reads as off until then — and is decided
 * afresh when it arrives, or when the deck or its run changes.
 */
export function ParticipantFeedbackPrompt({
	deck,
	participantId,
}: {
	deck: Pick<Presentation, "id" | "sessionStartedAt" | "language">;
	participantId: string;
}) {
	const { promptPercent, promptCooldownDays } = useFeedbackConfig();
	return (
		<ParticipantFeedbackPromptFor
			key={[
				promptPercent,
				promptCooldownDays,
				deck.id,
				deck.sessionStartedAt,
			].join("|")}
			config={{ promptPercent, promptCooldownDays }}
			deck={deck}
			participantId={participantId}
		/>
	);
}
