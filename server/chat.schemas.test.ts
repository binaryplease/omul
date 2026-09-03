/**
 * Unit tests for the deck's live chat (REQ078) — schemas and pure helpers only,
 * no DB and no network.
 *
 *   - the channel is deck-level state (`chatEnabled`), defaulting closed
 *   - the stored message shape, and what it deliberately does *not* carry: no
 *     slide id, so a message is not an answer to anything
 *   - the order a transcript is read in, and the cap on how much comes back
 */

import { describe, expect, test } from "bun:test";
import {
	CHAT_HISTORY_LIMIT,
	CHAT_TEXT_MAX_LENGTH,
	ChatMessageSchema,
	CreatePresentationSchema,
	orderChatMessages,
	ParticipantChannelsSchema,
	participantChannelsFor,
	PresentationSchema,
	recentChatMessages,
	StoredChatMessageSchema,
	StoredPresentationSchema,
} from "./schemas";

/** A feed entry with every key present — the shape the order helpers take. */
function entry(id: string, createdAt: string, text = id) {
	return { id, text, createdAt, own: false };
}

// ── The channel is deck state, and it fails safe ─────────────────────

describe("presentation schemas — the chat channel", () => {
	test("a fresh deck carries no chat", () => {
		const created = CreatePresentationSchema.parse({
			title: "Deck",
			slides: [{ id: "s1", type: "word-cloud", question: "Q" }],
		});
		expect(created.chatEnabled).toBe(false);
	});

	test("a document persisted before the channel existed reads forward", () => {
		const stored = StoredPresentationSchema.parse({ id: "p1" });
		expect(stored.chatEnabled).toBe(false);
	});

	test("the setting survives the response projection", () => {
		const parsed = PresentationSchema.parse({
			id: "p1",
			code: "123456",
			title: "Deck",
			slides: [],
			createdAt: new Date().toISOString(),
			chatEnabled: true,
		});
		expect(parsed.chatEnabled).toBe(true);
	});

	test("the channels body moves the chat switch without touching reactions", () => {
		expect(ParticipantChannelsSchema.parse({ chatEnabled: true })).toEqual({
			chatEnabled: true,
		});
		expect(participantChannelsFor({ chatEnabled: true })).toEqual({
			reactions: false,
			chat: true,
		});
	});
});

// ── What a message is, and what it is not ────────────────────────────

describe("StoredChatMessageSchema", () => {
	test("a message is scoped to the presentation and to nothing else", () => {
		const stored = StoredChatMessageSchema.parse({
			id: "m1",
			presentationId: "p1",
		});
		expect(stored).toEqual({
			id: "m1",
			presentationId: "p1",
			text: "",
			participantId: "",
			createdAt: "",
		});
		// The point of the assertion above being exhaustive: **no `slideId`**. A
		// chat message is not an answer to the question on screen, and a slide
		// reference is the one field that would let something start treating it as
		// one.
		expect("slideId" in stored).toBe(false);
	});

	test("the presentation reference is an identity field and fails loudly", () => {
		expect(() => StoredChatMessageSchema.parse({ id: "m1" })).toThrow();
	});
});

describe("ChatMessageSchema — the request body", () => {
	test("takes text and an optional participant id", () => {
		expect(ChatMessageSchema.parse({ text: "hello" })).toEqual({
			text: "hello",
		});
		expect(
			ChatMessageSchema.parse({ text: "hello", participantId: "p" })
				.participantId,
		).toBe("p");
	});

	test("an empty message is refused", () => {
		expect(() => ChatMessageSchema.parse({ text: "" })).toThrow();
	});

	test("the cap is the one the composer stops at", () => {
		expect(
			ChatMessageSchema.parse({ text: "x".repeat(CHAT_TEXT_MAX_LENGTH) }).text
				.length,
		).toBe(CHAT_TEXT_MAX_LENGTH);
		expect(() =>
			ChatMessageSchema.parse({ text: "x".repeat(CHAT_TEXT_MAX_LENGTH + 1) }),
		).toThrow();
	});
});

// ── A transcript is read in the order it happened ────────────────────

describe("orderChatMessages", () => {
	test("oldest first — a conversation, not a queue", () => {
		const ordered = orderChatMessages([
			entry("c", "2024-01-01T00:00:03.000Z"),
			entry("a", "2024-01-01T00:00:01.000Z"),
			entry("b", "2024-01-01T00:00:02.000Z"),
		]);
		expect(ordered.map((message) => message.id)).toEqual(["a", "b", "c"]);
	});

	test("two messages in the same millisecond are drawn the same way everywhere", () => {
		const sameInstant = "2024-01-01T00:00:01.000Z";
		const ordered = orderChatMessages([
			entry("z", sameInstant),
			entry("a", sameInstant),
		]);
		expect(ordered.map((message) => message.id)).toEqual(["a", "z"]);
	});

	test("the input array is not mutated", () => {
		const input = [
			entry("b", "2024-01-01T00:00:02.000Z"),
			entry("a", "2024-01-01T00:00:01.000Z"),
		];
		orderChatMessages(input);
		expect(input.map((message) => message.id)).toEqual(["b", "a"]);
	});
});

describe("recentChatMessages", () => {
	const many = Array.from({ length: 12 }, (unused, index) =>
		entry(
			`m${String(index).padStart(2, "0")}`,
			`2024-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
		),
	);

	test("keeps the newest end, still oldest-first", () => {
		const recent = recentChatMessages(many, 3);
		expect(recent.map((message) => message.id)).toEqual(["m09", "m10", "m11"]);
	});

	test("a short transcript comes back whole", () => {
		expect(recentChatMessages(many.slice(0, 2), 3)).toHaveLength(2);
	});

	test("defaults to the documented history cap", () => {
		expect(CHAT_HISTORY_LIMIT).toBe(200);
		expect(recentChatMessages(many)).toHaveLength(many.length);
	});
});
