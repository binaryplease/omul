/**
 * The form feedback about omul is written in (REQ185).
 *
 * One component for every place that asks: the app menu's "Send feedback"
 * dialog, and the participant's prompt after a session (REQ186). It
 * owns what the sender sees and holds — five optional stars, a comment, the
 * contact box, the send button, the thanks — and nothing about where the
 * answer goes: the caller hands in `onSend`, which is where the surface, the
 * language and the endpoint are decided.
 *
 * **The contact box is drawn only when `contactEmail` names an address**, which
 * the menu does for a signed-in sender and nobody else. Signed out there is no
 * account to write back to, and the participant prompt never draws it at all.
 * It starts unticked, so an account is attached only when the sender ticks it
 * themselves, having seen the address it would use. It is a choice about being
 * written back to on this one entry and is used for nothing else — and it is
 * not consent, so nothing here or anywhere else calls it that (see REQ185's
 * Notes). The unticked start is the `contactMe` default in
 * {@link EMPTY_FEEDBACK_DRAFT}, and it is not configurable.
 *
 * **Its words are a prop.** The menu draws it in English, as the rest of the
 * app's chrome is; the prompt draws it in the deck's language, because it sits
 * on the participant's screen (REQ186). Both read one table, `Dict` in
 * `src/i18n.ts`, through {@link feedbackFormLabelsFor}. The contact box's two
 * lines are not in it: only the menu draws the box, and the menu is English.
 *
 * **Its heading is optional.** The menu's dialog is labelled by the form's own
 * heading, which names who reads the answer. The prompt's card carries a
 * heading and a sentence of its own above the form — they stay put after the
 * answer is sent — so it passes no `headingId` and the form draws none.
 *
 * The rules — when the button wakes, what a second tap on a star does — are
 * `src/feedback.ts`'s, so the view below is props in, markup out, and is
 * rendered in tests without a DOM.
 */

import { CircleCheck, Star } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import {
	canSendFeedback,
	FEEDBACK_RATING_STARS,
	type FeedbackDraft,
	nextFeedbackRating,
} from "../feedback";
import { type Dict, getDict } from "../i18n";
import { FEEDBACK_COMMENT_MAX_LENGTH } from "../types";
import { BRAND_NAME } from "./BrandMark";

/** What a fresh form holds: no rating, no comment, the contact box unticked. */
export const EMPTY_FEEDBACK_DRAFT: FeedbackDraft = {
	rating: null,
	comment: "",
	contactMe: false,
};

/** Who reads this — said first, so nobody mistakes it for the presenter's form. */
const HEADING_LEAD = `Feedback about ${BRAND_NAME}`;
const HEADING_RECIPIENT = `goes to the people who run ${BRAND_NAME} here, not to the presenter or organizer`;

/** What the form says, in one language. */
export type FeedbackFormLabels = {
	rating: string;
	optional: string;
	/** The accessible name of star `star` out of `total`. */
	starOf: (star: number, total: number) => string;
	comment: string;
	commentPlaceholder: string;
	send: string;
	sending: string;
	/** Why the send button is disabled (ADR-0025). */
	sendWhy: string;
	sent: string;
	sentDetail: string;
	close: string;
	/** Leads the server's reason for a failed send. */
	notSent: string;
	/** Says it alone when there is no reason to give. */
	notSentRetry: string;
};

/** Fill the product's name into a `Dict` string that leaves it as `{brand}`. */
export function withBrandName(text: string): string {
	return text.replaceAll("{brand}", BRAND_NAME);
}

/** The form's words out of a language's dictionary, mapped in one place. */
export function feedbackFormLabelsFor(dict: Dict): FeedbackFormLabels {
	return {
		rating: dict.feedbackRating,
		optional: dict.feedbackOptional,
		starOf: (star, total) =>
			dict.feedbackStarOf
				.replace("{star}", String(star))
				.replace("{total}", String(total)),
		comment: dict.feedbackComment,
		commentPlaceholder: dict.feedbackCommentPlaceholder,
		send: dict.feedbackSend,
		sending: dict.feedbackSending,
		sendWhy: dict.feedbackSendWhy,
		sent: dict.feedbackSent,
		sentDetail: withBrandName(dict.feedbackSentDetail),
		close: dict.feedbackClose,
		notSent: dict.feedbackNotSent,
		notSentRetry: dict.feedbackNotSentRetry,
	};
}

/** The form as the app menu draws it: in English, like the rest of the chrome. */
export const FEEDBACK_FORM_LABELS: FeedbackFormLabels = feedbackFormLabelsFor(
	getDict("en"),
);

export type FeedbackFormStatus =
	| { phase: "editing" }
	| { phase: "sending" }
	| { phase: "failed"; message: string }
	| { phase: "sent" };

const FIELD_LABEL = "mb-1.5 block text-sm font-medium text-text";

/** The form for a given draft and status — no state of its own. */
export function FeedbackFormView({
	headingId,
	labels = FEEDBACK_FORM_LABELS,
	draft,
	contactEmail,
	status,
	onRate,
	onCommentChange,
	onContactChange,
	onSubmit,
	onDone,
}: {
	/** The id of the form's own heading, or none to draw no heading at all. */
	headingId?: string;
	labels?: FeedbackFormLabels;
	draft: FeedbackDraft;
	/** The address the contact box names, or `null` to draw no box at all. */
	contactEmail: string | null;
	status: FeedbackFormStatus;
	onRate: (star: number) => void;
	onCommentChange: (comment: string) => void;
	onContactChange: (contactMe: boolean) => void;
	onSubmit: () => void;
	/** Shown as a Close button under the thanks; none is drawn without it. */
	onDone?: () => void;
}) {
	const fieldId = useId();
	const sendable = canSendFeedback(draft);
	const sending = status.phase === "sending";

	const heading = headingId !== undefined && (
		<h2 id={headingId} className="m-0 text-base font-semibold text-text">
			{HEADING_LEAD}{" "}
			<span className="font-normal text-text-muted">— {HEADING_RECIPIENT}</span>
		</h2>
	);

	if (status.phase === "sent") {
		return (
			<div className="flex flex-col gap-4">
				{heading}
				<div
					role="status"
					className="flex flex-col items-center gap-2 py-4 text-center"
				>
					<CircleCheck size={32} aria-hidden className="text-accent" />
					<p className="m-0 font-semibold text-text">{labels.sent}</p>
					<p className="m-0 text-sm text-text-muted">{labels.sentDetail}</p>
				</div>
				{onDone && (
					<button
						type="button"
						className="btn-secondary self-end text-sm"
						onClick={onDone}
						// The send button that held focus is gone; keep it in the form.
						autoFocus
					>
						{labels.close}
					</button>
				)}
			</div>
		);
	}

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (sendable && !sending) onSubmit();
	};

	return (
		<form className="flex flex-col gap-4" onSubmit={submit} noValidate>
			{heading}

			<div>
				<p id={`${fieldId}-rating`} className={FIELD_LABEL}>
					{labels.rating}{" "}
					<span className="font-normal text-text-dim">{labels.optional}</span>
				</p>
				<div
					role="group"
					aria-labelledby={`${fieldId}-rating`}
					className="flex gap-1"
				>
					{Array.from({ length: FEEDBACK_RATING_STARS }, (_unused, index) => {
						const star = index + 1;
						const lit = draft.rating !== null && star <= draft.rating;
						return (
							<button
								key={star}
								type="button"
								aria-label={labels.starOf(star, FEEDBACK_RATING_STARS)}
								aria-pressed={draft.rating === star}
								disabled={sending}
								onClick={() => onRate(star)}
								className={`flex size-9 items-center justify-center rounded-lg border-none bg-transparent transition-colors cursor-pointer hover:bg-surface-hover ${
									lit ? "text-accent" : "text-text-dim"
								}`}
							>
								<Star
									size={22}
									aria-hidden
									fill={lit ? "currentColor" : "none"}
								/>
							</button>
						);
					})}
				</div>
			</div>

			<div>
				<label htmlFor={`${fieldId}-comment`} className={FIELD_LABEL}>
					{labels.comment}{" "}
					<span className="font-normal text-text-dim">{labels.optional}</span>
				</label>
				<textarea
					id={`${fieldId}-comment`}
					className="input resize-y"
					rows={4}
					maxLength={FEEDBACK_COMMENT_MAX_LENGTH}
					value={draft.comment}
					disabled={sending}
					placeholder={labels.commentPlaceholder}
					onChange={(event) => onCommentChange(event.target.value)}
				/>
			</div>

			{contactEmail !== null && (
				<div>
					<label className="flex items-center gap-2 text-sm text-text cursor-pointer">
						<input
							type="checkbox"
							checked={draft.contactMe}
							disabled={sending}
							aria-describedby={`${fieldId}-address`}
							onChange={(event) => onContactChange(event.target.checked)}
						/>
						You can contact me about this
					</label>
					<p
						id={`${fieldId}-address`}
						className="m-0 mt-1 pl-6 text-xs text-text-dim break-words"
					>
						We'd write to {contactEmail} (your account email)
					</p>
				</div>
			)}

			{status.phase === "failed" && (
				<p role="alert" className="m-0 text-sm text-error">
					{status.message}
				</p>
			)}

			<div className="flex flex-col items-end gap-1.5">
				<button
					type="submit"
					className="btn-primary text-sm"
					disabled={!sendable || sending}
					aria-describedby={sendable ? undefined : `${fieldId}-why`}
				>
					{sending ? labels.sending : labels.send}
				</button>
				{!sendable && (
					<p id={`${fieldId}-why`} className="m-0 text-xs text-text-dim">
						{labels.sendWhy}
					</p>
				)}
			</div>
		</form>
	);
}

/**
 * The form with its state. `onSend` gets the draft and settles when the answer
 * is stored; a rejection is shown under the fields and leaves the draft as it
 * was, so nothing typed is lost to a failed send.
 */
export function FeedbackForm({
	headingId,
	labels = FEEDBACK_FORM_LABELS,
	contactEmail,
	onSend,
	onDone,
}: {
	headingId?: string;
	labels?: FeedbackFormLabels;
	contactEmail: string | null;
	onSend: (draft: FeedbackDraft) => Promise<void>;
	onDone?: () => void;
}) {
	const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_FEEDBACK_DRAFT);
	const [status, setStatus] = useState<FeedbackFormStatus>({
		phase: "editing",
	});

	const send = async () => {
		setStatus({ phase: "sending" });
		try {
			await onSend(draft);
			setStatus({ phase: "sent" });
		} catch (sendError) {
			setStatus({
				phase: "failed",
				message:
					sendError instanceof Error && sendError.message
						? `${labels.notSent}: ${sendError.message}`
						: labels.notSentRetry,
			});
		}
	};

	return (
		<FeedbackFormView
			headingId={headingId}
			labels={labels}
			draft={draft}
			contactEmail={contactEmail}
			status={status}
			onRate={(star) =>
				setDraft((current) => ({
					...current,
					rating: nextFeedbackRating(current.rating, star),
				}))
			}
			onCommentChange={(comment) =>
				setDraft((current) => ({ ...current, comment }))
			}
			onContactChange={(contactMe) =>
				setDraft((current) => ({ ...current, contactMe }))
			}
			onSubmit={() => void send()}
			onDone={onDone}
		/>
	);
}
