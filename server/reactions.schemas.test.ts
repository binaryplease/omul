/**
 * Unit tests for reactions on any slide (REQ077) — schemas and pure helpers
 * only, no DB and no network.
 *
 * The requirement has three halves and this file covers the two that are
 * decidable without a running server:
 *
 *   - the channel is deck-level state (`reactionsEnabled`), defaulting closed
 *   - the reaction set is **closed**, so nothing outside it reaches the room
 *   - nothing describes a *stored* reaction — the schema module has no shape for
 *     one, which is how "not stored as answers" is enforced rather than checked
 *
 * The third half — that sending one writes nothing and is counted nowhere — is
 * an integration property and lives in `reactions.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import * as schemas from "./schemas";
import {
	CreatePresentationSchema,
	ParticipantChannelsSchema,
	participantChannelsFor,
	PresentationSchema,
	REACTION_KINDS,
	ReactionKindEnum,
	ReactionSchema,
	StoredPresentationSchema,
} from "./schemas";

// ── The channel is deck state, and it fails safe ─────────────────────

describe("presentation schemas — the reaction channel", () => {
	test("a fresh deck has reactions closed", () => {
		const created = CreatePresentationSchema.parse({
			title: "Deck",
			slides: [{ id: "s1", type: "word-cloud", question: "Q" }],
		});
		expect(created.reactionsEnabled).toBe(false);
	});

	test("a document persisted before the channel existed reads forward (ADR-0029)", () => {
		const stored = StoredPresentationSchema.parse({ id: "p1" });
		expect(stored.reactionsEnabled).toBe(false);
	});

	test("the setting survives the response projection", () => {
		const parsed = PresentationSchema.parse({
			id: "p1",
			code: "123456",
			title: "Deck",
			slides: [],
			createdAt: new Date().toISOString(),
			reactionsEnabled: true,
		});
		expect(parsed.reactionsEnabled).toBe(true);
	});

	test("participantChannelsFor fills the value in from any shape", () => {
		expect(participantChannelsFor({})).toEqual({ reactions: false, chat: false });
		expect(participantChannelsFor({ reactionsEnabled: true })).toEqual({
			reactions: true,
			chat: false,
		});
	});

	test("the channels body takes either switch alone — one must not re-assert the other", () => {
		expect(ParticipantChannelsSchema.parse({ reactionsEnabled: true })).toEqual({
			reactionsEnabled: true,
		});
		expect(ParticipantChannelsSchema.parse({})).toEqual({});
	});
});

// ── The reaction set is closed (REQ077) ──────────────────────────────

describe("ReactionSchema — what may reach the room", () => {
	test("every declared kind parses", () => {
		for (const kind of REACTION_KINDS) {
			expect(ReactionSchema.parse({ kind }).kind).toBe(kind);
		}
	});

	test("a kind nobody declared is refused, not passed through", () => {
		// The point of the enum: what the room is painted with is chosen from a
		// list this build ships, never handed to it by a caller.
		expect(() => ReactionSchema.parse({ kind: "shrug" })).toThrow();
		expect(() =>
			ReactionSchema.parse({ kind: "<img src=x onerror=alert(1)>" }),
		).toThrow();
		expect(() => ReactionSchema.parse({ kind: "" })).toThrow();
		expect(() => ReactionSchema.parse({})).toThrow();
	});

	test("the enum and the exported list are the same set", () => {
		expect(ReactionKindEnum.options).toEqual([...REACTION_KINDS]);
	});

	test("the slide a reaction was sent from is optional and passed through", () => {
		expect(ReactionSchema.parse({ kind: "like", slideId: "s4" }).slideId).toBe(
			"s4",
		);
		// A reaction that names no slide is still a reaction — nothing is keyed by
		// it, so it is not required.
		expect(ReactionSchema.parse({ kind: "like" }).slideId).toBeUndefined();
	});
});

// ── Nothing here describes a stored reaction (REQ077) ────────────────

describe("a reaction is not stored", () => {
	test("the schema module declares no stored-reaction shape", () => {
		// The guarantee REQ077 asks for — "not stored as answers or counted in any
		// tally" — is kept by there being nothing to store one *with*. If a
		// `StoredReaction*` schema ever appears, a collection is one line away and
		// an aggregation two, so the absence is asserted rather than assumed.
		const stored = Object.keys(schemas).filter(
			(name) => name.startsWith("Stored") && /reaction/i.test(name),
		);
		expect(stored).toEqual([]);
	});
});
