import {
	ArrowUp,
	Check,
	Eye,
	EyeOff,
	MessageCircleQuestion,
	RotateCcw,
	Send,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { getDict } from "../i18n";
import { useStore } from "../store";
import type { QAListEntry, QAVisibility } from "../types";
import { QA_TEXT_MAX_LENGTH } from "../types";
import { Segmented, Toggle } from "./EditorControls";

// ── Q&A layer (REQ036, REQ037, REQ060) ────────────────────────────────
//
// Q&A here is not a slide — it is a layer switched on for the whole deck, so a
// question can be asked from whatever is on screen (REQ036). That makes it a
// cross-surface affordance in the plainest sense: the presenter reads a
// moderation queue, the participant reads (some of) the same list and asks into
// it, and both must agree about what a question says, how many people are behind
// it and whether it has been dealt with. Per ADR-0026 that is one descriptor
// (`readQAList`), one shared wrapper (`QAQuestionList`) and one set of labels.
//
// It lives in its own module rather than inside Results.tsx or either page
// because it depends on nothing either of them owns (ADR-0032): only on the Q&A
// payload, the api client, and the session slice's `qaRevision`.
//
// **The list is fetched, never broadcast.** Who may read it is settled on the
// server, per request, from the caller's own credentials (REQ037) — see
// `useQAList` below. Nothing here filters questions for display: a client that
// held a question it must not show would be one network tab away from showing
// it anyway.

/** One question, as `GET /api/presentations/:id/qa` reports it. */
export type QAQuestion = QAListEntry;

/** The whole payload that endpoint answers with. */
export type QAList = {
	/** Whether the layer is switched on for this deck (REQ036). */
	enabled: boolean;
	/** Who may read the list (REQ037). */
	visibility: QAVisibility;
	/** Whether this reader has the room's list, or only their own questions. */
	canSeeAll: boolean;
	questions: QAQuestion[];
	totalCount: number;
	openCount: number;
	answeredCount: number;
};

/**
 * The words the Q&A surfaces wear. Both draw the same list and only one of them
 * is translated (the participant's, REQ084), so the strings arrive as a
 * parameter rather than being reached for inside — the shape `Leaderboard` and
 * `QuizTimer` already take theirs in.
 */
export type QALabels = {
	title: string;
	/** The composer's heading — what the participant is invited to do. */
	ask: string;
	askPlaceholder: string;
	submit: string;
	submitted: string;
	/** Stands in for a list nobody has asked into yet. */
	empty: string;
	/** The same, for a reader who is only shown their own questions. */
	emptyOwn: string;
	/** Says where a question goes when the organizer keeps the list back. */
	moderatedNote: string;
	/** The upvote control (REQ060). */
	upvote: string;
	/** Why it cannot act on a question the reader asked themselves (ADR-0025). */
	upvoteOwn: string;
	/** The badge on a question the presenter has dealt with (REQ060). */
	answered: string;
	/** Counts what is still waiting, beside the heading: "7 <open>". */
	open: string;
};

/** The presenter's wording — the shared screen is not translated. */
export const QA_LABELS_EN: QALabels = {
	title: "Q&A",
	ask: "Ask a question",
	askPlaceholder: "Type your question...",
	submit: "Send",
	submitted: "Question sent!",
	empty: "No questions yet.",
	emptyOwn: "You haven't asked anything yet.",
	moderatedNote: "Questions go to the presenter only.",
	upvote: "Upvote this question",
	upvoteOwn: "You asked this one — it already counts",
	answered: "Answered",
	open: "open",
};

/**
 * The same list, in the deck's language (REQ084) — the one place the
 * participant-facing dictionary is mapped onto these labels, so the phone and
 * the presenter's queue wear the same wording in two languages rather than two
 * wordings (ADR-0026).
 */
export function qaLabelsFor(dict: ReturnType<typeof getDict>): QALabels {
	return {
		title: dict.qaTitle,
		ask: dict.qaAsk,
		askPlaceholder: dict.qaPlaceholder,
		submit: dict.qaSubmit,
		submitted: dict.qaSubmitted,
		empty: dict.qaEmpty,
		emptyOwn: dict.qaEmptyOwn,
		moderatedNote: dict.qaModeratedNote,
		upvote: dict.qaUpvote,
		upvoteOwn: dict.qaUpvoteOwn,
		answered: dict.qaAnswered,
		open: dict.qaOpen,
	};
}

/**
 * Read a Q&A payload off the wire with every field present.
 *
 * JSON, so nothing is guaranteed until it has been through here — the single
 * read site both surfaces use, so neither ends up reaching for `??` around a
 * count or an `answered` flag. The server's **order** is kept as it arrived
 * (open first, then most upvoted, then longest waiting): a phone that re-sorted
 * would disagree with the queue the presenter is working from.
 */
export function readQAList(payload: unknown): QAList | null {
	if (!payload || typeof payload !== "object") return null;
	const raw = payload as Partial<QAList> & { questions?: Partial<QAQuestion>[] };
	const questions = (raw.questions ?? []).map((question) => ({
		id: String(question.id ?? ""),
		text: String(question.text ?? ""),
		upvotes: question.upvotes ?? 0,
		answered: !!question.answered,
		answeredAt: question.answeredAt ?? null,
		createdAt: question.createdAt ?? "",
		own: !!question.own,
		upvoted: !!question.upvoted,
	}));
	return {
		enabled: !!raw.enabled,
		visibility: raw.visibility === "everyone" ? "everyone" : "presenter",
		canSeeAll: !!raw.canSeeAll,
		questions,
		totalCount: raw.totalCount ?? questions.length,
		openCount:
			raw.openCount ?? questions.filter((question) => !question.answered).length,
		answeredCount:
			raw.answeredCount ??
			questions.filter((question) => question.answered).length,
	};
}

/**
 * The deck's Q&A list as this browser is entitled to see it, kept current.
 *
 * The single fetch-and-subscribe wiring both pages use (ADR-0026). It refetches
 * on the session slice's `qaRevision`, which the `qa.updated` broadcast bumps —
 * the socket says only *that* the list moved, because who may read it is decided
 * per request from the credentials this fetch carries (REQ037). It also
 * refetches when the layer's settings change, since flipping a deck from
 * moderated to public turns one reader's own two questions into the room's
 * forty without a single new question being asked.
 */
export function useQAList(
	presentationId: string | null,
	participantId: string,
): QAList | null {
	const qaRevision = useStore((state) => state.qaRevision);
	const qaEnabled = useStore((state) => state.presentation?.qaEnabled ?? false);
	const qaVisibility = useStore(
		(state) => state.presentation?.qaVisibility ?? "presenter",
	);
	const [list, setList] = useState<QAList | null>(null);

	useEffect(() => {
		if (!presentationId) {
			setList(null);
			return;
		}
		let current = true;
		api
			.getQA(presentationId, participantId)
			.then((payload) => {
				if (current) setList(readQAList(payload));
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [presentationId, participantId, qaRevision, qaEnabled, qaVisibility]);

	return list;
}

/**
 * One question in the list, worn by both surfaces.
 *
 * What differs between them is which affordances they are handed — a participant
 * gets the upvote, the presenter gets "mark answered" — not what a question
 * looks like or what its numbers mean (ADR-0027).
 */
function QAQuestionRow({
	question,
	labels,
	onUpvote,
	onToggleAnswered,
}: {
	question: QAQuestion;
	labels: QALabels;
	/** Offered only where the room may actually vote (REQ037/REQ060). */
	onUpvote?: (questionId: string) => void;
	/** Offered only to whoever can edit the deck (REQ060). */
	onToggleAnswered?: (questionId: string, answered: boolean) => void;
}) {
	return (
		<li
			className={`rounded-lg border p-3 flex items-start gap-3 transition-colors ${
				question.answered
					? "border-border bg-surface/40 opacity-70"
					: "border-border bg-surface-raised"
			}`}
		>
			<div className="min-w-0 flex-1">
				<p
					className={`break-words leading-snug text-sm ${
						question.answered ? "text-text-muted line-through" : "text-text"
					}`}
				>
					{question.text}
				</p>
				{question.answered && (
					<span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-success">
						<Check size={10} />
						{labels.answered}
					</span>
				)}
			</div>

			<div className="flex flex-shrink-0 items-center gap-1.5">
				{/* The upvote (REQ060). Disabled rather than removed on a question the
				    reader asked themselves — the count is still the thing they want to
				    read, and a control that vanished would look like a bug (ADR-0025). */}
				{onUpvote && (
					<button
						type="button"
						onClick={() => !question.own && onUpvote(question.id)}
						disabled={question.own}
						title={question.own ? labels.upvoteOwn : labels.upvote}
						aria-label={question.own ? labels.upvoteOwn : labels.upvote}
						className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs transition ${
							question.upvoted
								? "border-accent bg-accent text-on-accent"
								: "border-border bg-surface text-text-muted hover:border-accent"
						} ${question.own ? "cursor-default opacity-60" : ""}`}
					>
						<ArrowUp size={11} />
						{question.upvotes}
					</button>
				)}
				{!onUpvote && (
					<span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-text-muted">
						<ArrowUp size={11} />
						{question.upvotes}
					</span>
				)}
				{onToggleAnswered && (
					<button
						type="button"
						onClick={() => onToggleAnswered(question.id, !question.answered)}
						title={
							question.answered
								? "Put this question back in the queue"
								: "Mark this question answered"
						}
						aria-label={
							question.answered
								? "Put this question back in the queue"
								: "Mark this question answered"
						}
						className={`inline-flex items-center rounded-md border p-1.5 transition ${
							question.answered
								? "border-border bg-surface text-text-muted hover:border-accent hover:text-text"
								: "border-border bg-surface text-text-muted hover:border-success hover:text-success"
						}`}
					>
						{question.answered ? <RotateCcw size={13} /> : <Check size={13} />}
					</button>
				)}
			</div>
		</li>
	);
}

/**
 * The question list itself — the one rendering worn by the presenter's queue and
 * every participant's phone (ADR-0026).
 *
 * The order is the server's and is not touched here: open questions first, then
 * the most upvoted, then the ones that have waited longest (REQ060). Two
 * surfaces that each sorted would eventually put a different question at the top
 * of the projector and of the presenter's own screen.
 */
export function QAQuestionList({
	list,
	labels,
	onUpvote,
	onToggleAnswered,
}: {
	list: QAList | null;
	labels: QALabels;
	onUpvote?: (questionId: string) => void;
	onToggleAnswered?: (questionId: string, answered: boolean) => void;
}) {
	if (!list) return null;
	if (list.questions.length === 0) {
		return (
			<p className="py-6 text-center text-sm text-text-dim">
				{list.canSeeAll ? labels.empty : labels.emptyOwn}
			</p>
		);
	}
	return (
		<ul className="flex flex-col gap-2">
			{list.questions.map((question) => (
				<QAQuestionRow
					key={question.id}
					question={question}
					labels={labels}
					onUpvote={onUpvote}
					onToggleAnswered={onToggleAnswered}
				/>
			))}
		</ul>
	);
}

/**
 * The box a question is asked in (REQ036).
 *
 * Capped at the same number the boundary refuses past, so a participant meets
 * the limit as a key that does nothing rather than as a rejected submission.
 */
export function QAComposer({
	labels,
	onAsk,
	busy = false,
}: {
	labels: QALabels;
	onAsk: (text: string) => Promise<void>;
	busy?: boolean;
}) {
	const [text, setText] = useState("");
	const trimmed = text.trim();

	const send = async () => {
		if (!trimmed || busy) return;
		await onAsk(trimmed);
		setText("");
	};

	return (
		<form
			className="flex items-center gap-2"
			onSubmit={(submitEvent) => {
				submitEvent.preventDefault();
				send();
			}}
		>
			<input
				className="input flex-1"
				value={text}
				maxLength={QA_TEXT_MAX_LENGTH}
				placeholder={labels.askPlaceholder}
				onChange={(changeEvent) => setText(changeEvent.target.value)}
				aria-label={labels.ask}
			/>
			<button
				type="submit"
				className="btn-primary flex flex-shrink-0 items-center gap-1.5 px-4"
				disabled={!trimmed || busy}
				title={trimmed ? labels.submit : labels.askPlaceholder}
			>
				<Send size={14} />
				<span className="hidden sm:inline">{labels.submit}</span>
			</button>
		</form>
	);
}

/**
 * The two switches that govern the layer (REQ036/REQ037), placed on the panel
 * they govern rather than in the page's chrome (ADR-0031).
 *
 * Visibility is offered whether or not the layer is on, because a presenter
 * about to open the floor wants to decide where the questions will go *before*
 * they start arriving — not after the first one is already on the projector.
 */
export function QALayerControls({
	enabled,
	visibility,
	onChange,
}: {
	enabled: boolean;
	visibility: QAVisibility;
	onChange: (changes: {
		enabled?: boolean;
		visibility?: QAVisibility;
	}) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<Toggle
				label="Questions from the audience"
				description="When on, participants can ask from any slide — not only from a Q&A slide."
				checked={enabled}
				onChange={(next) => onChange({ enabled: next })}
			/>
			<div className="flex flex-col gap-1.5">
				<span className="text-xs font-medium uppercase tracking-wider text-text-muted">
					Who sees the questions
				</span>
				<Segmented<QAVisibility>
					ariaLabel="Who sees the submitted questions"
					value={visibility}
					onChange={(next) => onChange({ visibility: next })}
					options={[
						{
							value: "presenter",
							label: "Only me",
							icon: <EyeOff size={14} />,
						},
						{
							value: "everyone",
							label: "Everyone",
							icon: <Eye size={14} />,
						},
					]}
				/>
				<p className="text-xs text-text-dim">
					{visibility === "everyone"
						? "Participants see the whole list and can upvote it, which is what orders your queue."
						: "Participants see only the questions they asked themselves. Nobody can upvote."}
				</p>
			</div>
		</div>
	);
}

/**
 * The heading a Q&A surface wears, with the queue's two counts beside it
 * (REQ060) so a presenter reads "how much is left" without counting rows.
 */
export function QAHeading({
	labels,
	list,
	compact = false,
}: {
	labels: QALabels;
	list: QAList | null;
	compact?: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<h3
				className={`flex items-center gap-2 font-semibold ${
					compact ? "text-sm" : "text-base"
				}`}
			>
				<MessageCircleQuestion size={compact ? 15 : 17} />
				{labels.title}
			</h3>
			{list && list.totalCount > 0 && (
				<span className="flex items-center gap-2 font-mono text-xs text-text-muted">
					<span>
						{list.openCount} {labels.open}
					</span>
					{list.answeredCount > 0 && (
						<span
							className="inline-flex items-center gap-0.5 text-success"
							title={labels.answered}
						>
							<Check size={11} />
							{list.answeredCount}
						</span>
					)}
				</span>
			)}
		</div>
	);
}
