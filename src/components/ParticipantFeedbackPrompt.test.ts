/**
 * The prompt after a session on the participant's ended screen (REQ186 slice
 * 3) — the card, and what it sends.
 *
 * What they are protecting: the card is drawn only where the decision in
 * `src/feedback-prompt.ts` says so, it is visibly omul's rather than the
 * organizer's, it speaks the deck's language, it never offers a contact box,
 * the body it sends names nobody, and both ways out of it — an answer and a
 * dismissal — record the ask, so a reload does not ask again. Rendered to
 * static markup with React's server renderer, which needs no DOM;
 * `localStorage` is a stub, as in `src/feedback-prompt.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ParticipantFeedbackSubmissionSchema } from "../../server/schemas";
import { buildParticipantFeedbackSubmission } from "../feedback";
import { rememberAskedForFeedback, rememberDeckSeenInRoom } from "../feedback-prompt";
import { getDict, type Lang, resolveLang } from "../i18n";
import { FEEDBACK_PROMPT_ASKED_AT_KEY } from "../storage";
import type { ParticipantFeedbackSubmission } from "../types";
import { EMPTY_FEEDBACK_DRAFT } from "./FeedbackForm";
import {
	answerFeedbackPrompt,
	dismissFeedbackPrompt,
	feedbackPromptLabelsFor,
	ParticipantFeedbackCard,
	ParticipantFeedbackPromptFor,
} from "./ParticipantFeedbackPrompt";

/** The smallest thing that behaves like `localStorage` for these reads. */
function installStorageStub(): Map<string, string> {
	const entries = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
		removeItem: (key: string) => {
			entries.delete(key);
		},
		clear: () => entries.clear(),
	};
	return entries;
}

let storage = new Map<string, string>();
let previousStorage: unknown;

beforeEach(() => {
	previousStorage = (globalThis as { localStorage?: unknown }).localStorage;
	storage = installStorageStub();
});

afterEach(() => {
	(globalThis as { localStorage?: unknown }).localStorage = previousStorage;
});

const LANGUAGES: Lang[] = ["en", "de", "fr", "es", "it", "pt", "nl"];
const ON = { promptPercent: 100, promptCooldownDays: 30 };
const OFF = { promptPercent: null, promptCooldownDays: 30 };
const DECK: { id: string; sessionStartedAt: string | null; language: string } = {
	id: "deck-1",
	sessionStartedAt: "2026-10-09T09:00:00.000Z",
	language: "en",
};

/** The prompt as the ended screen draws it, for this config and deck. */
function prompt(
	config: { promptPercent: number | null; promptCooldownDays: number },
	deck: typeof DECK = DECK,
): string {
	return renderToStaticMarkup(
		createElement(ParticipantFeedbackPromptFor, {
			config,
			deck,
			participantId: "participant-1",
		}),
	);
}

/** The card alone, in one language. */
function card(language: Lang): string {
	return renderToStaticMarkup(
		createElement(ParticipantFeedbackCard, {
			language,
			onSend: async () => {},
			onDismiss: () => {},
			onClose: () => {},
		}),
	);
}

/** The visible text of rendered markup, tags dropped and entities read. */
function textOf(markup: string): string {
	return markup
		.replace(/<[^>]+>/g, "")
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

describe("whether the card is drawn", () => {
	test("drawn for a sampled device that was in the room and was never asked", () => {
		rememberDeckSeenInRoom(DECK.id);
		expect(textOf(prompt(ON))).toContain(
			"How did you find omul, the tool behind this session?",
		);
	});

	test("not drawn while the prompt is off — the ended screen is as before", () => {
		rememberDeckSeenInRoom(DECK.id);
		expect(prompt(OFF)).toBe("");
	});

	test("not drawn on a device that first opened the deck after it ended", () => {
		expect(prompt(ON)).toBe("");
	});

	test("not drawn inside the cooldown", () => {
		rememberDeckSeenInRoom(DECK.id);
		rememberAskedForFeedback();
		expect(prompt(ON)).toBe("");
	});

	test("not drawn for a deck that never went live", () => {
		rememberDeckSeenInRoom(DECK.id);
		expect(prompt(ON, { ...DECK, sessionStartedAt: null })).toBe("");
	});
});

describe("the card", () => {
	test("wears omul's default theme, not the deck's, and omul's mark", () => {
		const markup = card("en");
		const scope = markup.match(/^<div[^>]*data-deck-theme-scope=""[^>]*>/);
		expect(scope?.[0]).toBeDefined();
		// The class a deck with its own accent carries is absent: this is the
		// house scope, the one `deck={null}` paints.
		expect(scope?.[0]).not.toContain("deck-theme\"");
		expect(markup).toMatch(/<svg[^>]*aria-label="omul"/);
	});

	test("never draws the contact box", () => {
		for (const language of LANGUAGES) {
			const markup = card(language);
			expect(markup).not.toContain('type="checkbox"');
			expect(textOf(markup)).not.toContain("contact me");
		}
	});

	test("says who reads the answer, and that it is anonymous", () => {
		const text = textOf(card("en"));
		expect(text).toContain(
			"Your answer is anonymous and goes to the people who run omul here, not to the organizers of this event.",
		);
	});

	test("has a dismiss control with an accessible name", () => {
		const markup = card("en");
		expect(markup).toMatch(
			/<button[^>]*aria-label="Close without answering"[^>]*>/,
		);
	});
});

describe("the card's language is the deck's", () => {
	test("heading, sentence, dismiss and the form's own words, in German", () => {
		const markup = card("de");
		const text = textOf(markup);
		expect(markup).toContain('lang="de"');
		expect(text).toContain("Wie fandest du omul, das Tool hinter dieser Session?");
		expect(text).toContain("Deine Antwort ist anonym");
		expect(markup).toContain('aria-label="Schließen, ohne zu antworten"');
		expect(text).toContain("Bewertung");
		expect(text).toContain("Kommentar");
		expect(text).toContain("Feedback senden");
		expect(text).toContain(
			"Gib eine Bewertung oder einen Kommentar ein, um zu senden.",
		);
		expect(markup).toContain('aria-label="1 von 5 Sternen"');
		expect(text).not.toContain("Send feedback");
	});

	test("every language names omul and leaves no placeholder behind", () => {
		for (const language of LANGUAGES) {
			const labels = feedbackPromptLabelsFor(getDict(language));
			for (const text of [labels.heading, labels.intro, labels.form.sentDetail]) {
				expect(text).toContain("omul");
				expect(text).not.toContain("{");
			}
			expect(labels.form.starOf(3, 5)).toMatch(/^3 \S+ 5 /);
		}
	});

	test("the deck's language tag is narrowed to one of the seven", () => {
		expect(resolveLang("de")).toBe("de");
		expect(resolveLang("pt-BR")).toBe("pt");
		expect(resolveLang("NL")).toBe("nl");
		expect(resolveLang("klingon")).toBe("en");
		expect(resolveLang("")).toBe("en");
		expect(resolveLang("constructor")).toBe("en");
	});

	test("a deck in French draws the card in French", () => {
		rememberDeckSeenInRoom(DECK.id);
		const markup = prompt(ON, { ...DECK, language: "fr-CA" });
		expect(markup).toContain('lang="fr"');
		expect(textOf(markup)).toContain("Qu'avez-vous pensé d'omul");
	});
});

describe("the body sent to POST /api/feedback/participant", () => {
	test("holds the rating, the trimmed comment and the language, and nothing else", () => {
		const body = buildParticipantFeedbackSubmission(
			{ rating: 4, comment: "  Quick and clear  " },
			"de",
		);
		expect(body).toEqual({ rating: 4, comment: "Quick and clear", language: "de" });
	});

	test("an answer sends exactly that body, whatever else the draft holds", async () => {
		const sent: ParticipantFeedbackSubmission[] = [];
		await answerFeedbackPrompt(
			{ ...EMPTY_FEEDBACK_DRAFT, comment: "Only words", contactMe: true },
			"it",
			async (submission) => {
				sent.push(submission);
			},
		);
		expect(sent).toHaveLength(1);
		expect(Object.keys(sent[0] ?? {}).sort()).toEqual([
			"comment",
			"language",
			"rating",
		]);
		expect(sent[0]).toEqual({ rating: null, comment: "Only words", language: "it" });
	});

	test("is what the route's schema accepts, unchanged", () => {
		for (const draft of [
			{ rating: 3, comment: "" },
			{ rating: null, comment: "Only words" },
			{ rating: 1, comment: "Both" },
		]) {
			for (const language of LANGUAGES) {
				const body = buildParticipantFeedbackSubmission(draft, language);
				expect(ParticipantFeedbackSubmissionSchema.parse(body)).toEqual(body);
			}
		}
	});
});

describe("both ways out record the ask", () => {
	test("an answer, once it is stored", async () => {
		expect(storage.has(FEEDBACK_PROMPT_ASKED_AT_KEY)).toBe(false);
		await answerFeedbackPrompt(
			{ ...EMPTY_FEEDBACK_DRAFT, rating: 5 },
			"en",
			async () => ({ id: "entry" }),
		);
		expect(Number(storage.get(FEEDBACK_PROMPT_ASKED_AT_KEY))).toBeGreaterThan(0);
	});

	test("a failed send records nothing and says so", async () => {
		await expect(
			answerFeedbackPrompt({ ...EMPTY_FEEDBACK_DRAFT, rating: 5 }, "en", () =>
				Promise.reject(new Error("Too many requests")),
			),
		).rejects.toThrow("Too many requests");
		expect(storage.has(FEEDBACK_PROMPT_ASKED_AT_KEY)).toBe(false);
	});

	test("a dismissal", () => {
		dismissFeedbackPrompt();
		expect(Number(storage.get(FEEDBACK_PROMPT_ASKED_AT_KEY))).toBeGreaterThan(0);
	});

	test("after either, the card is not drawn again", () => {
		rememberDeckSeenInRoom(DECK.id);
		expect(prompt(ON)).not.toBe("");
		dismissFeedbackPrompt();
		expect(prompt(ON)).toBe("");
	});
});
