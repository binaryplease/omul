/**
 * The form feedback about omul is written in (REQ185).
 *
 * One component for every place that asks: the app menu's "Send feedback"
 * dialog now, and the participant's prompt after a session (REQ186) next. It
 * owns what the sender sees and holds — five optional stars, a comment, the
 * contact box, the send button, the thanks — and nothing about where the
 * answer goes: the caller hands in `onSend`, which is where the surface, the
 * language and the endpoint are decided.
 *
 * **The contact box is drawn only when `contactEmail` names an address**, which
 * the menu does for a signed-in sender and nobody else. Signed out there is no
 * account to write back to, and the participant prompt never draws it at all.
 * It starts ticked; the sender sees it, and the address it would use, before
 * anything is sent. It is a choice about being written back to on this one
 * entry and is used for nothing else — and it is not consent, so nothing here
 * or anywhere else calls it that (see REQ185's Notes). Whether it should start
 * unticked is the operator's call; it is the `contactMe` default in
 * {@link EMPTY_FEEDBACK_DRAFT}.
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
import { FEEDBACK_COMMENT_MAX_LENGTH } from "../types";
import { BRAND_NAME } from "./BrandMark";

/** What a fresh form holds: no rating, no comment, the contact box ticked. */
export const EMPTY_FEEDBACK_DRAFT: FeedbackDraft = {
	rating: null,
	comment: "",
	contactMe: true,
};

/** Who reads this — said first, so nobody mistakes it for the presenter's form. */
const HEADING_LEAD = `Feedback about ${BRAND_NAME}`;
const HEADING_RECIPIENT = `goes to the people who run ${BRAND_NAME} here, not to the presenter or organizer`;

export type FeedbackFormStatus =
	| { phase: "editing" }
	| { phase: "sending" }
	| { phase: "failed"; message: string }
	| { phase: "sent" };

const FIELD_LABEL = "mb-1.5 block text-sm font-medium text-text";

/** The form for a given draft and status — no state of its own. */
export function FeedbackFormView({
	headingId,
	draft,
	contactEmail,
	status,
	onRate,
	onCommentChange,
	onContactChange,
	onSubmit,
	onDone,
}: {
	headingId: string;
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

	const heading = (
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
					<p className="m-0 font-semibold text-text">Thank you — it's sent.</p>
					<p className="m-0 text-sm text-text-muted">
						The people who run {BRAND_NAME} here will read it.
					</p>
				</div>
				{onDone && (
					<button
						type="button"
						className="btn-secondary self-end text-sm"
						onClick={onDone}
						// The send button that held focus is gone; keep it in the form.
						autoFocus
					>
						Close
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
					Rating <span className="font-normal text-text-dim">(optional)</span>
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
								aria-label={`${star} of ${FEEDBACK_RATING_STARS} stars`}
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
					Comment <span className="font-normal text-text-dim">(optional)</span>
				</label>
				<textarea
					id={`${fieldId}-comment`}
					className="input resize-y"
					rows={4}
					maxLength={FEEDBACK_COMMENT_MAX_LENGTH}
					value={draft.comment}
					disabled={sending}
					placeholder="What works, what gets in the way, what's missing?"
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
					{sending ? "Sending…" : "Send feedback"}
				</button>
				{!sendable && (
					<p id={`${fieldId}-why`} className="m-0 text-xs text-text-dim">
						Add a rating or a comment to send.
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
	contactEmail,
	onSend,
	onDone,
}: {
	headingId: string;
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
						? `Not sent: ${sendError.message}`
						: "Not sent. Please try again.",
			});
		}
	};

	return (
		<FeedbackFormView
			headingId={headingId}
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
