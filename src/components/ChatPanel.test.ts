/**
 * Unit tests for the chat surface's client-side reading of the feed (REQ078).
 *
 * `readChatFeed` is the one place both surfaces turn the endpoint's payload into
 * a transcript, so what it has to get right is everything the payload can be
 * missing — a feed is rendered before anybody has typed, and on a deck whose
 * channel was closed between the fetch being sent and it landing.
 *
 * `chatLabelsFor` is the one mapping from the participant dictionary onto the
 * panel's wording (REQ084), so the phone and the presenter's panel say the same
 * thing in two languages rather than two things.
 */

import { describe, expect, test } from "bun:test";
import { getDict } from "../i18n";
import { CHAT_HISTORY_LIMIT } from "../types";
import {
	CHAT_LABELS_EN,
	chatCountLabel,
	chatLabelsFor,
	isChatSurfaceVisible,
	readChatFeed,
} from "./ChatPanel";

/** A feed of `count` messages, as the endpoint would report it. */
function feedOf(count: number, enabled = true) {
	return readChatFeed({
		enabled,
		messageCount: count,
		messages: Array.from({ length: count }, (unused, index) => ({
			id: `m${index}`,
			text: `line ${index}`,
			createdAt: `2024-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
			own: false,
		})),
	});
}

describe("readChatFeed (REQ078)", () => {
	test("reads the transcript the server sent, in the order it sent it", () => {
		const feed = readChatFeed({
			enabled: true,
			messageCount: 2,
			messages: [
				{ id: "m1", text: "first", createdAt: "2024-01-01T00:00:01.000Z", own: true },
				{ id: "m2", text: "second", createdAt: "2024-01-01T00:00:02.000Z", own: false },
			],
		});
		expect(feed?.enabled).toBe(true);
		expect(feed?.messageCount).toBe(2);
		// The server's order is kept as it arrived — a client that re-sorted would
		// be rewriting the conversation.
		expect(feed?.messages.map((message) => message.text)).toEqual([
			"first",
			"second",
		]);
		expect(feed?.messages.map((message) => message.own)).toEqual([true, false]);
	});

	test("an empty channel reads as an empty transcript, not as null", () => {
		const feed = readChatFeed({ enabled: true, messages: [] });
		expect(feed?.messages).toEqual([]);
		expect(feed?.messageCount).toBe(0);
	});

	test("a payload with nothing in it still has every field", () => {
		// JSON, so nothing is guaranteed until it has been through here — which is
		// what keeps `??` out of both surfaces.
		const feed = readChatFeed({});
		expect(feed).toEqual({ enabled: false, messages: [], messageCount: 0 });
	});

	test("a half-built message is filled in rather than dropped", () => {
		const feed = readChatFeed({ enabled: true, messages: [{ id: "m1" }] });
		expect(feed?.messages[0]).toEqual({
			id: "m1",
			text: "",
			createdAt: "",
			own: false,
		});
	});

	test("`own` defaults to false — an unmarked line is somebody else's", () => {
		// The safe direction: a line wrongly marked as yours would put the reader's
		// name on words they did not write.
		const feed = readChatFeed({
			enabled: true,
			messages: [{ id: "m1", text: "hi", own: undefined }],
		});
		expect(feed?.messages[0].own).toBe(false);
	});

	test("the count falls back to the transcript's own length", () => {
		const feed = readChatFeed({
			enabled: true,
			messages: [{ id: "m1" }, { id: "m2" }],
		});
		expect(feed?.messageCount).toBe(2);
	});

	test("a closed channel still reports the transcript", () => {
		// Closing the channel stops posting, not reading — the composer goes dead
		// and says why, and what was said stays on screen.
		const feed = readChatFeed({
			enabled: false,
			messages: [{ id: "m1", text: "before it closed" }],
		});
		expect(feed?.enabled).toBe(false);
		expect(feed?.messages).toHaveLength(1);
	});

	test("anything that is not a payload reads as no feed at all", () => {
		expect(readChatFeed(null)).toBeNull();
		expect(readChatFeed(undefined)).toBeNull();
		expect(readChatFeed("nope")).toBeNull();
	});
});

describe("chatLabelsFor (REQ084)", () => {
	test("maps the participant dictionary onto every label the panel wears", () => {
		const labels = chatLabelsFor(getDict("de"));
		expect(labels.title).toBe(getDict("de").chatTitle);
		expect(labels.placeholder).toBe(getDict("de").chatPlaceholder);
		expect(labels.send).toBe(getDict("de").chatSend);
		expect(labels.empty).toBe(getDict("de").chatEmpty);
		expect(labels.closed).toBe(getDict("de").chatClosed);
		expect(labels.you).toBe(getDict("de").chatYou);
	});

	test("the English mapping and the presenter's own wording agree", () => {
		// Two surfaces, one wording (ADR-0026): the shared screen is not translated
		// and the phone is, and they must not drift into two different products.
		expect(chatLabelsFor(getDict("en"))).toEqual(CHAT_LABELS_EN);
	});

	test("every supported language fills in every label", () => {
		for (const language of ["en", "de", "fr", "es", "it", "pt", "nl"]) {
			const labels = chatLabelsFor(getDict(language));
			for (const value of Object.values(labels)) {
				expect(value.length).toBeGreaterThan(0);
			}
		}
	});
});

// ── Closing the channel stops posting, not reading (REQ078) ──────────

describe("isChatSurfaceVisible (REQ078)", () => {
	test("an open channel draws the chat, transcript or not", () => {
		expect(isChatSurfaceVisible(true, feedOf(0))).toBe(true);
		expect(isChatSurfaceVisible(true, feedOf(3))).toBe(true);
		// Before the first fetch has landed there is no feed yet, and the deck's
		// own switch is enough to draw the section.
		expect(isChatSurfaceVisible(true, null)).toBe(true);
	});

	test("closing the channel does not take the transcript off the screen", () => {
		// The regression this exists for: the presenter closes the chat mid-session,
		// `channels.settings` patches `chatEnabled` to false on every phone, and a
		// surface gated on that switch would unmount the whole section — including
		// the participant's own last line, which then reads as having been deleted.
		// The server keeps answering with the transcript precisely so it does not.
		expect(isChatSurfaceVisible(false, feedOf(3, false))).toBe(true);
	});

	test("a deck that never carried a chat shows nothing", () => {
		// Not a control hidden because it is unavailable (ADR-0025) — there is no
		// channel and nothing was ever said, which is the deck's own shape.
		expect(isChatSurfaceVisible(false, feedOf(0, false))).toBe(false);
		expect(isChatSurfaceVisible(false, null)).toBe(false);
	});
});

// ── The count a surface reports is the one it actually has ───────────

describe("chatCountLabel (REQ078)", () => {
	test("below the cap it is a plain count", () => {
		expect(chatCountLabel(feedOf(0))).toBe("0 chat messages");
		expect(chatCountLabel(feedOf(7))).toBe("7 chat messages");
		expect(chatCountLabel(null)).toBe("0 chat messages");
	});

	test("at the cap it stops claiming to be a total", () => {
		// `messageCount` counts the list that came back, and the feed is capped, so
		// a two-thousand-message session would otherwise report "200 chat messages"
		// for the rest of the hour — a number that is true about the payload and
		// false about the room.
		expect(chatCountLabel(feedOf(CHAT_HISTORY_LIMIT))).toBe(
			`the newest ${CHAT_HISTORY_LIMIT} chat messages`,
		);
	});
});
