/**
 * Unit tests for the WebSocket broadcaster (server/ws.ts).
 *
 * These tests don't spin up Elysia — they exercise the broadcaster directly
 * using fake ws objects that capture the messages they receive. The module
 * keeps a module-level client Map, so each test carefully registers and
 * removes its own clients to stay isolated.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	broadcastToAll,
	broadcastToPresentation,
	getParticipantCount,
	joinRoom,
	registerClient,
	removeClient,
} from "./ws";

type Sent = string;

/** A fake ws object that records every message sent to it. */
function makeFakeWs(): {
	send: (data: string | ArrayBuffer) => void;
	sent: Sent[];
} {
	const sent: Sent[] = [];
	return {
		sent,
		send(data: string | ArrayBuffer) {
			sent.push(
				typeof data === "string" ? data : new TextDecoder().decode(data),
			);
		},
	};
}

/** Parse a JSON message as an {event, data} envelope. */
function parseEnvelope(raw: string): { event: string; data: unknown } {
	return JSON.parse(raw);
}

// Track every client registered during a test so we can always clean up.
const activeIds = new Set<string>();
const origRegister = registerClient;

describe("ws broadcaster", () => {
	beforeEach(() => {
		// Remove any clients left over from the previous test.
		for (const id of activeIds) removeClient(id);
		activeIds.clear();
	});

	// Helper that wraps registerClient + tracks the id.
	function spawn() {
		const fake = makeFakeWs();
		const id = origRegister(fake);
		activeIds.add(id);
		return { id, sent: fake.sent };
	}

	test("registerClient returns a unique UUID per connection", () => {
		const a = spawn();
		const b = spawn();
		expect(a.id).not.toBe(b.id);
		expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	test("a freshly-registered client is not counted as a participant until it joins", () => {
		spawn();
		expect(getParticipantCount("pres-1")).toBe(0);
	});

	test("joinRoom registers the client as a participant and bumps the count", () => {
		const c = spawn();
		joinRoom(c.id, "pres-A", "participant");
		expect(getParticipantCount("pres-A")).toBe(1);
	});

	test("presenters are not counted towards the participant count", () => {
		const presenter = spawn();
		const participant = spawn();
		joinRoom(presenter.id, "pres-B", "presenter");
		joinRoom(participant.id, "pres-B", "participant");
		expect(getParticipantCount("pres-B")).toBe(1);
	});

	test("participant count is scoped per presentation", () => {
		const a = spawn();
		const b = spawn();
		joinRoom(a.id, "pres-X", "participant");
		joinRoom(b.id, "pres-Y", "participant");
		expect(getParticipantCount("pres-X")).toBe(1);
		expect(getParticipantCount("pres-Y")).toBe(1);
		expect(getParticipantCount("pres-Z")).toBe(0);
	});

	test("removeClient decrements the participant count", () => {
		const a = spawn();
		const b = spawn();
		joinRoom(a.id, "pres-R", "participant");
		joinRoom(b.id, "pres-R", "participant");
		expect(getParticipantCount("pres-R")).toBe(2);

		removeClient(a.id);
		activeIds.delete(a.id);
		expect(getParticipantCount("pres-R")).toBe(1);
	});

	test("joining a room broadcasts participants.count to everyone in that room", () => {
		const a = spawn();
		const b = spawn();
		joinRoom(a.id, "pres-P", "participant");
		// a just received its own join event (count=1)
		expect(a.sent).toHaveLength(1);
		const first = parseEnvelope(a.sent[0]);
		expect(first.event).toBe("participants.count");
		expect(first.data).toEqual({ count: 1, presentationId: "pres-P" });

		// When b joins, both should get a count=2 event.
		joinRoom(b.id, "pres-P", "participant");
		expect(a.sent).toHaveLength(2);
		expect(b.sent).toHaveLength(1);
		expect(parseEnvelope(a.sent[1])).toEqual({
			event: "participants.count",
			data: { count: 2, presentationId: "pres-P" },
		});
		expect(parseEnvelope(b.sent[0])).toEqual({
			event: "participants.count",
			data: { count: 2, presentationId: "pres-P" },
		});
	});

	test("removeClient broadcasts a decremented participants.count", () => {
		const a = spawn();
		const b = spawn();
		joinRoom(a.id, "pres-Q", "participant");
		joinRoom(b.id, "pres-Q", "participant");
		const beforeLen = a.sent.length;

		removeClient(b.id);
		activeIds.delete(b.id);

		// a should have received one more update with count=1.
		expect(a.sent.length).toBe(beforeLen + 1);
		const last = parseEnvelope(a.sent[a.sent.length - 1]);
		expect(last).toEqual({
			event: "participants.count",
			data: { count: 1, presentationId: "pres-Q" },
		});
	});

	test("removeClient on an unjoined client does NOT broadcast", () => {
		const joined = spawn();
		joinRoom(joined.id, "pres-S", "participant");
		const baseline = joined.sent.length;

		const unjoined = spawn();
		removeClient(unjoined.id);
		activeIds.delete(unjoined.id);

		expect(joined.sent.length).toBe(baseline);
	});

	test("joinRoom with an unknown client id is a no-op and does not throw", () => {
		expect(() =>
			joinRoom("not-a-real-id", "pres-Z", "participant"),
		).not.toThrow();
		expect(getParticipantCount("pres-Z")).toBe(0);
	});

	test("broadcastToPresentation delivers the event only to clients in that room", () => {
		const inRoom = spawn();
		const alsoInRoom = spawn();
		const elsewhere = spawn();
		joinRoom(inRoom.id, "pres-T", "participant");
		joinRoom(alsoInRoom.id, "pres-T", "participant");
		joinRoom(elsewhere.id, "pres-other", "participant");

		// Reset the sent buffers after the join spam.
		inRoom.sent.length = 0;
		alsoInRoom.sent.length = 0;
		elsewhere.sent.length = 0;

		broadcastToPresentation("pres-T", "slide.changed", {
			presentationId: "pres-T",
			slideIndex: 2,
		});

		expect(inRoom.sent).toHaveLength(1);
		expect(alsoInRoom.sent).toHaveLength(1);
		expect(elsewhere.sent).toHaveLength(0);

		const env = parseEnvelope(inRoom.sent[0]);
		expect(env.event).toBe("slide.changed");
		expect(env.data).toEqual({ presentationId: "pres-T", slideIndex: 2 });
	});

	test("broadcastToPresentation includes presenters (not just participants)", () => {
		const presenter = spawn();
		const participant = spawn();
		joinRoom(presenter.id, "pres-U", "presenter");
		joinRoom(participant.id, "pres-U", "participant");
		presenter.sent.length = 0;
		participant.sent.length = 0;

		broadcastToPresentation("pres-U", "results.updated", { foo: "bar" });

		expect(presenter.sent).toHaveLength(1);
		expect(participant.sent).toHaveLength(1);
	});

	test("broadcastToAll fans out to every connected client regardless of room", () => {
		const joined = spawn();
		const other = spawn();
		const unjoined = spawn();
		joinRoom(joined.id, "pres-V", "participant");
		joinRoom(other.id, "pres-W", "participant");
		joined.sent.length = 0;
		other.sent.length = 0;
		unjoined.sent.length = 0;

		broadcastToAll("server.ping", { ts: 123 });

		expect(parseEnvelope(joined.sent[0])).toEqual({
			event: "server.ping",
			data: { ts: 123 },
		});
		expect(parseEnvelope(other.sent[0])).toEqual({
			event: "server.ping",
			data: { ts: 123 },
		});
		expect(parseEnvelope(unjoined.sent[0])).toEqual({
			event: "server.ping",
			data: { ts: 123 },
		});
	});

	test("re-joining a different room leaves the old room's count stable", () => {
		const c = spawn();
		joinRoom(c.id, "pres-OLD", "participant");
		expect(getParticipantCount("pres-OLD")).toBe(1);

		// Move this client to a different presentation.
		joinRoom(c.id, "pres-NEW", "participant");

		// The client is now counted against pres-NEW, not pres-OLD.
		expect(getParticipantCount("pres-NEW")).toBe(1);
		expect(getParticipantCount("pres-OLD")).toBe(0);
	});

	test("joinRoom defaults to participant when role is falsy", () => {
		const c = spawn();
		// @ts-expect-error — intentionally passing an empty string
		joinRoom(c.id, "pres-DEF", "");
		expect(getParticipantCount("pres-DEF")).toBe(1);
	});
});
