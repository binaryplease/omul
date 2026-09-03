/**
 * Unit tests for the Q&A layer's schemas and pure helpers (no DB, no network).
 *
 *   - REQ036 — the layer is deck-level state: `qaEnabled` on the presentation
 *              and stored-presentation schemas, defaulting off
 *   - REQ037 — `qaVisibility`, its withholding default, and the two predicates
 *              that decide who reads which questions
 *   - REQ060 — the stored question/upvote shapes and the order a queue is
 *              worked in
 */

import { describe, expect, test } from "bun:test";
import {
	CreatePresentationSchema,
	normalizeQuestionText,
	PresentationSchema,
	QAAnsweredSchema,
	QAQuestionSchema,
	QASettingsSchema,
	QA_TEXT_MAX_LENGTH,
	QAUpvoteSchema,
	qaListVisibleToAudience,
	qaQuestionsVisibleTo,
	qaSettingsFor,
	rankQAQuestions,
	StoredPresentationSchema,
	StoredQAQuestionSchema,
	StoredQAUpvoteSchema,
} from "./schemas";

// ── REQ036 / REQ037 — the layer is deck state, and it fails safe ──────

describe("presentation schemas — the Q&A layer's two settings", () => {
	test("a fresh deck has the layer off and its questions unpublished", () => {
		const created = CreatePresentationSchema.parse({
			title: "Deck",
			slides: [{ id: "s1", type: "word-cloud", question: "Q" }],
		});
		expect(created.qaEnabled).toBe(false);
		expect(created.qaVisibility).toBe("presenter");
	});

	test("a document persisted before the layer existed reads forward", () => {
		const stored = StoredPresentationSchema.parse({ id: "p1" });
		expect(stored.qaEnabled).toBe(false);
		expect(stored.qaVisibility).toBe("presenter");
	});

	test("both settings survive the response projection", () => {
		const parsed = PresentationSchema.parse({
			id: "p1",
			code: "123456",
			title: "Deck",
			slides: [],
			createdAt: new Date().toISOString(),
			qaEnabled: true,
			qaVisibility: "everyone",
		});
		expect(parsed.qaEnabled).toBe(true);
		expect(parsed.qaVisibility).toBe("everyone");
	});

	test("an unknown visibility is rejected rather than coerced", () => {
		expect(() =>
			CreatePresentationSchema.parse({
				title: "Deck",
				slides: [{ id: "s1", type: "word-cloud", question: "Q" }],
				qaVisibility: "moderators",
			}),
		).toThrow();
	});

	test("qaSettingsFor fills both values in from any shape", () => {
		expect(qaSettingsFor({})).toEqual({
			enabled: false,
			visibility: "presenter",
		});
		expect(qaSettingsFor({ qaEnabled: true, qaVisibility: "everyone" })).toEqual(
			{ enabled: true, visibility: "everyone" },
		);
	});
});

// ── REQ037 — who may read the list ───────────────────────────────────

describe("qaListVisibleToAudience", () => {
	test("whoever can edit the deck always reads it — layer off included", () => {
		expect(qaListVisibleToAudience({}, true)).toBe(true);
		expect(
			qaListVisibleToAudience(
				{ qaEnabled: false, qaVisibility: "presenter" },
				true,
			),
		).toBe(true);
	});

	test("the room reads it only when the layer is on AND published", () => {
		expect(
			qaListVisibleToAudience(
				{ qaEnabled: true, qaVisibility: "everyone" },
				false,
			),
		).toBe(true);
		expect(
			qaListVisibleToAudience(
				{ qaEnabled: true, qaVisibility: "presenter" },
				false,
			),
		).toBe(false);
		// On but moderated is the interesting half; off but published must not
		// leak either — a layer nobody switched on has no audience.
		expect(
			qaListVisibleToAudience(
				{ qaEnabled: false, qaVisibility: "everyone" },
				false,
			),
		).toBe(false);
	});
});

describe("qaQuestionsVisibleTo", () => {
	const questions = [
		{ id: "q1", participantId: "alice" },
		{ id: "q2", participantId: "bob" },
		{ id: "q3", participantId: "" },
	];

	test("a published list comes back whole", () => {
		const visible = qaQuestionsVisibleTo(
			questions,
			{ qaEnabled: true, qaVisibility: "everyone" },
			{ canEdit: false, participantId: "alice" },
		);
		expect(visible.map((question) => question.id)).toEqual(["q1", "q2", "q3"]);
	});

	test("a moderated list comes back as the caller's own questions only", () => {
		const visible = qaQuestionsVisibleTo(
			questions,
			{ qaEnabled: true, qaVisibility: "presenter" },
			{ canEdit: false, participantId: "alice" },
		);
		expect(visible.map((question) => question.id)).toEqual(["q1"]);
	});

	test("an id-less caller owns nothing rather than matching every id-less row", () => {
		const visible = qaQuestionsVisibleTo(
			questions,
			{ qaEnabled: true, qaVisibility: "presenter" },
			{ canEdit: false, participantId: "" },
		);
		expect(visible).toEqual([]);
	});

	test("the presenter reads all of it whatever the visibility", () => {
		const visible = qaQuestionsVisibleTo(
			questions,
			{ qaEnabled: true, qaVisibility: "presenter" },
			{ canEdit: true, participantId: "" },
		);
		expect(visible).toHaveLength(3);
	});
});

// ── REQ060 — the queue's order and its stored shapes ─────────────────

describe("rankQAQuestions", () => {
	function entry(
		id: string,
		overrides: {
			upvotes?: number;
			answered?: boolean;
			createdAt?: string;
		} = {},
	) {
		return {
			id,
			text: id,
			upvotes: overrides.upvotes ?? 0,
			answered: overrides.answered ?? false,
			answeredAt: null,
			createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
			own: false,
			upvoted: false,
		};
	}

	test("open questions come before answered ones, however popular", () => {
		const ordered = rankQAQuestions([
			entry("answered-hit", { upvotes: 99, answered: true }),
			entry("open-quiet", { upvotes: 0 }),
		]);
		expect(ordered.map((question) => question.id)).toEqual([
			"open-quiet",
			"answered-hit",
		]);
	});

	test("among open questions the room's upvotes decide", () => {
		const ordered = rankQAQuestions([
			entry("one", { upvotes: 1 }),
			entry("five", { upvotes: 5 }),
			entry("three", { upvotes: 3 }),
		]);
		expect(ordered.map((question) => question.id)).toEqual([
			"five",
			"three",
			"one",
		]);
	});

	test("a tie on upvotes goes to whoever asked first", () => {
		const ordered = rankQAQuestions([
			entry("later", { upvotes: 2, createdAt: "2026-01-01T00:05:00.000Z" }),
			entry("earlier", { upvotes: 2, createdAt: "2026-01-01T00:01:00.000Z" }),
		]);
		expect(ordered.map((question) => question.id)).toEqual([
			"earlier",
			"later",
		]);
	});

	test("a full tie falls back to the id, so the same list draws the same way", () => {
		const entries = [entry("bbb"), entry("aaa")];
		expect(rankQAQuestions(entries).map((question) => question.id)).toEqual([
			"aaa",
			"bbb",
		]);
		// And it does not reorder the caller's array underneath them.
		expect(entries.map((question) => question.id)).toEqual(["bbb", "aaa"]);
	});
});

describe("StoredQAQuestionSchema / StoredQAUpvoteSchema", () => {
	test("every non-identity field defaults, so the shape can grow", () => {
		const question = StoredQAQuestionSchema.parse({
			id: "q1",
			presentationId: "p1",
		});
		expect(question.text).toBe("");
		expect(question.participantId).toBe("");
		expect(question.answered).toBe(false);
		// An explicit null, not a missing key: "still open" is a value.
		expect(question.answeredAt).toBeNull();
	});

	test("the identity fields fail loudly rather than being fabricated", () => {
		expect(() => StoredQAQuestionSchema.parse({ id: "q1" })).toThrow();
		expect(() =>
			StoredQAUpvoteSchema.parse({ id: "u1", presentationId: "p1" }),
		).toThrow();
	});

	test("an upvote row defaults its participant and timestamp", () => {
		const upvote = StoredQAUpvoteSchema.parse({
			id: "u1",
			presentationId: "p1",
			questionId: "q1",
		});
		expect(upvote.participantId).toBe("");
		expect(upvote.createdAt).toBe("");
	});
});

// ── Request bodies and the duplicate fold ────────────────────────────

describe("Q&A request schemas", () => {
	test("a question must say something, and stops at the declared cap", () => {
		expect(() => QAQuestionSchema.parse({ text: "" })).toThrow();
		expect(() =>
			QAQuestionSchema.parse({ text: "x".repeat(QA_TEXT_MAX_LENGTH + 1) }),
		).toThrow();
		expect(
			QAQuestionSchema.parse({ text: "x".repeat(QA_TEXT_MAX_LENGTH) }).text,
		).toHaveLength(QA_TEXT_MAX_LENGTH);
	});

	test("the settings body leaves an absent key alone rather than defaulting it", () => {
		const partial = QASettingsSchema.parse({ enabled: true });
		expect(partial.enabled).toBe(true);
		expect(partial.visibility).toBeUndefined();
	});

	test("the answered and upvote bodies are equally partial", () => {
		expect(QAAnsweredSchema.parse({}).answered).toBeUndefined();
		expect(QAUpvoteSchema.parse({}).participantId).toBeUndefined();
	});
});

describe("normalizeQuestionText", () => {
	test("folds case, edge whitespace and runs of spaces onto one key", () => {
		expect(normalizeQuestionText("  When   is Lunch? ")).toBe(
			"when is lunch?",
		);
		expect(normalizeQuestionText("WHEN IS LUNCH?")).toBe(
			normalizeQuestionText("when is lunch?"),
		);
	});

	test("folds nothing else — punctuation and accents are part of the question", () => {
		expect(normalizeQuestionText("Café?")).toBe("café?");
		expect(normalizeQuestionText("when is lunch")).not.toBe(
			normalizeQuestionText("when is lunch?"),
		);
	});
});
