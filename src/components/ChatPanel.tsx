import { MessagesSquare, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { getDict } from "../i18n";
import { useStore } from "../store";
import type { ChatMessageEntry } from "../types";
import { CHAT_HISTORY_LIMIT, CHAT_TEXT_MAX_LENGTH } from "../types";
import { Toggle } from "./EditorControls";

// ── The deck's live chat (REQ078) ─────────────────────────────────────
//
// A channel the room talks in during the session, and — this is the whole of the
// requirement — **separate from the Q&A queue and from slide answers**. The
// separation is structural rather than cosmetic: its own endpoint, its own
// collection, its own broadcast, no slide id anywhere, and no tally that reads
// it. Nothing here shares a code path with `QAPanel` beyond the conventions both
// follow, and that is deliberate — a chat message is not a question waiting to
// be taken and not an answer waiting to be counted.
//
// It lives in its own module for the reason `QAPanel` does: it
// depends on nothing either page owns — only on the chat payload, the api
// client, and the session slice's `chatRevision`.
//
// **The feed is fetched, never broadcast.** The socket says only that something
// was said; what came back and which lines are yours is settled on the server,
// per request. One authority is what keeps `own` honest and the transcript in
// one order on every screen.

/** One message, as `GET /api/presentations/:id/chat` reports it. */
export type ChatMessage = ChatMessageEntry;

/** The whole payload that endpoint answers with. */
export type ChatFeed = {
	/** Whether the channel is open for posting (REQ078). */
	enabled: boolean;
	messages: ChatMessage[];
	messageCount: number;
};

/**
 * The words a chat surface wears. The participant's is translated (REQ084) and
 * the presenter's is not, so they arrive as a parameter — the shape `QAPanel`
 * and `Leaderboard` already take theirs in.
 */
export type ChatLabels = {
	title: string;
	placeholder: string;
	send: string;
	/** Stands in for a channel nobody has written in yet. */
	empty: string;
	/** Why the composer is disabled while the transcript is still readable. */
	closed: string;
	/** Marks the reader's own lines. */
	you: string;
};

/** The presenter's wording — the shared screen is not translated. */
export const CHAT_LABELS_EN: ChatLabels = {
	title: "Chat",
	placeholder: "Say something...",
	send: "Send",
	empty: "Nothing said yet — start the conversation.",
	closed: "The chat is closed. You can still read what was said.",
	you: "You",
};

/**
 * The same labels in the deck's language (REQ084) — the one place the
 * participant-facing dictionary is mapped onto them, so the phone and the
 * presenter's panel wear the same wording in two languages rather than two
 * wordings.
 */
export function chatLabelsFor(dict: ReturnType<typeof getDict>): ChatLabels {
	return {
		title: dict.chatTitle,
		placeholder: dict.chatPlaceholder,
		send: dict.chatSend,
		empty: dict.chatEmpty,
		closed: dict.chatClosed,
		you: dict.chatYou,
	};
}

/**
 * Read a chat payload off the wire with every field present.
 *
 * JSON, so nothing is guaranteed until it has been through here — the single
 * read site both surfaces use, so neither ends up reaching for `??` around a
 * message or a count. The server's **order** is kept as it arrived (oldest
 * first): a client that re-sorted would be rewriting the conversation.
 */
export function readChatFeed(payload: unknown): ChatFeed | null {
	if (!payload || typeof payload !== "object") return null;
	const raw = payload as Partial<ChatFeed> & {
		messages?: Partial<ChatMessage>[];
	};
	const messages = (raw.messages ?? []).map((message) => ({
		id: String(message.id ?? ""),
		text: String(message.text ?? ""),
		createdAt: message.createdAt ?? "",
		own: !!message.own,
	}));
	return {
		enabled: !!raw.enabled,
		messages,
		messageCount: raw.messageCount ?? messages.length,
	};
}

/**
 * Whether a participant surface draws the chat at all (REQ078).
 *
 * **Not `chatEnabled`**, and that is the point. The server keeps answering
 * `GET /chat` with the transcript once the presenter closes the channel — on
 * purpose, so a participant's own last line does not vanish and read as deleted
 * — and a surface that unmounted on the switch would throw that guarantee away
 * on the one screen it was written about: the `channels.settings` broadcast
 * patches the deck, and the whole section would disappear mid-sentence.
 *
 * So the rule is "the channel is open, **or** there is something to read", and
 * it lives here rather than inline in a page because it is the client half of a
 * server guarantee — one place to read it, one place to test it.
 * A deck that never carried a chat has neither, and shows nothing: that is the
 * deck's own shape, not a control hidden because it is unavailable.
 */
export function isChatSurfaceVisible(
	channelOpen: boolean,
	feed: ChatFeed | null,
): boolean {
	return channelOpen || (feed?.messages.length ?? 0) > 0;
}

/**
 * How a surface names the size of the transcript it is showing.
 *
 * `messageCount` counts **the list that came back**, and the feed is capped at
 * {@link CHAT_HISTORY_LIMIT}, so past the cap a bare number would claim a total
 * it is not — a two-thousand-message session would report "200 chat messages"
 * for the rest of the hour. At the cap the phrasing says what the number
 * actually is instead of inventing a total the endpoint never sent.
 */
export function chatCountLabel(feed: ChatFeed | null): string {
	const count = feed?.messageCount ?? 0;
	return count >= CHAT_HISTORY_LIMIT
		? `the newest ${count} chat messages`
		: `${count} chat messages`;
}

/**
 * The deck's chat, kept current.
 *
 * The single fetch-and-subscribe wiring both pages use. It refetches
 * on the session slice's `chatRevision`, which the `chat.updated` broadcast
 * bumps, and on the channel's own switch — reopening a closed chat has to bring
 * the composer back without waiting for somebody else to type first.
 */
export function useChatFeed(
	presentationId: string | null,
	participantId: string,
): ChatFeed | null {
	const chatRevision = useStore((state) => state.chatRevision);
	const chatEnabled = useStore(
		(state) => state.presentation?.chatEnabled ?? false,
	);
	const [feed, setFeed] = useState<ChatFeed | null>(null);

	useEffect(() => {
		if (!presentationId) {
			setFeed(null);
			return;
		}
		let current = true;
		api
			.getChat(presentationId, participantId)
			.then((payload) => {
				if (current) setFeed(readChatFeed(payload));
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [presentationId, participantId, chatRevision, chatEnabled]);

	return feed;
}

/**
 * The transcript (REQ078), worn by both surfaces.
 *
 * Own lines are marked rather than moved: a chat drawn as two columns needs to
 * know who each side is, and a chat channel that carries no names (REQ076 is a
 * separate requirement and is not this one) has nobody to put on the other side.
 * So the reader's own lines are tinted and labelled, and everybody else's are
 * one anonymous voice — which is an honest drawing of what the server actually
 * knows about this channel today.
 *
 * It scrolls to the newest message as they arrive, because that is where a
 * conversation is. Deliberately *not* while the reader has scrolled up: somebody
 * reading back through what was said must not be yanked to the bottom every time
 * anybody types.
 */
export function ChatMessageList({
	feed,
	labels,
}: {
	feed: ChatFeed | null;
	labels: ChatLabels;
}) {
	// An `<li>`, not a `<div>`: `<ul>` permits list items and nothing else, and a
	// scroll anchor is no reason to hand the browser a content model it has to
	// repair.
	const bottom = useRef<HTMLLIElement | null>(null);
	const messageCount = feed?.messages.length ?? 0;

	useEffect(() => {
		const anchor = bottom.current;
		if (!anchor) return;
		const scroller = anchor.parentElement;
		if (!scroller) return;
		// "Near the bottom" rather than "at it": a list that has just grown by one
		// row is already a few pixels off, and a strict check would stop following
		// the conversation after the first message.
		const distanceFromBottom =
			scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
		if (distanceFromBottom > 120) return;
		anchor.scrollIntoView({ block: "end" });
	}, [messageCount]);

	if (!feed) return null;
	if (feed.messages.length === 0) {
		return <p className="py-6 text-center text-sm text-text-dim">{labels.empty}</p>;
	}
	return (
		<ul className="flex flex-col gap-2">
			{feed.messages.map((message) => (
				<li
					key={message.id}
					className={`rounded-lg border p-2.5 text-sm leading-snug break-words ${
						message.own
							? "border-accent/40 bg-accent/10 text-text"
							: "border-border bg-surface-raised text-text"
					}`}
				>
					{message.own && (
						<span className="mr-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-accent-text">
							{labels.you}
						</span>
					)}
					{message.text}
				</li>
			))}
			<li ref={bottom} aria-hidden="true" />
		</ul>
	);
}

/**
 * The box a message is typed in (REQ078).
 *
 * Capped at the same number the boundary refuses past, so a participant meets
 * the limit as a key that does nothing rather than as a rejected post. Disabled
 * with its reason when the organizer has closed the channel, rather than removed:
 * the transcript above it is still there to read, and a composer
 * that vanished would read as the chat having been deleted.
 */
export function ChatComposer({
	labels,
	onSend,
	busy = false,
	closed = false,
}: {
	labels: ChatLabels;
	onSend: (text: string) => Promise<void>;
	busy?: boolean;
	closed?: boolean;
}) {
	const [text, setText] = useState("");
	const trimmed = text.trim();
	const blocked = closed || busy;

	const send = async () => {
		if (!trimmed || blocked) return;
		await onSend(trimmed);
		setText("");
	};

	return (
		<form
			className="flex flex-col gap-1.5"
			onSubmit={(submitEvent) => {
				submitEvent.preventDefault();
				send();
			}}
		>
			<div className="flex items-center gap-2">
				<input
					className="input flex-1"
					value={text}
					maxLength={CHAT_TEXT_MAX_LENGTH}
					placeholder={closed ? labels.closed : labels.placeholder}
					disabled={closed}
					onChange={(changeEvent) => setText(changeEvent.target.value)}
					aria-label={closed ? labels.closed : labels.title}
				/>
				<button
					type="submit"
					className="btn-primary flex flex-shrink-0 items-center gap-1.5 px-4"
					disabled={!trimmed || blocked}
					title={closed ? labels.closed : labels.send}
				>
					<Send size={14} />
					<span className="hidden sm:inline">{labels.send}</span>
				</button>
			</div>
			{closed && <p className="text-xs text-text-dim">{labels.closed}</p>}
		</form>
	);
}

/**
 * The heading a chat surface wears, with the transcript's length beside it so a
 * presenter reads "how much has been said" without counting rows.
 */
export function ChatHeading({
	labels,
	feed,
	compact = false,
}: {
	labels: ChatLabels;
	feed: ChatFeed | null;
	compact?: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<h3
				className={`flex items-center gap-2 font-semibold ${
					compact ? "text-sm" : "text-base"
				}`}
			>
				<MessagesSquare size={compact ? 15 : 17} />
				{labels.title}
			</h3>
			{feed && feed.messageCount > 0 && (
				<span className="font-mono text-xs text-text-muted">
					{feed.messageCount}
				</span>
			)}
		</div>
	);
}

/**
 * The switch that opens the channel (REQ078), placed on the panel it governs
 * rather than in the page's chrome.
 */
export function ChatChannelControl({
	enabled,
	onChange,
}: {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<Toggle
			label="Live chat"
			description="A channel the room talks in during the session — separate from the Q&A queue and from slide answers."
			checked={enabled}
			onChange={onChange}
		/>
	);
}
