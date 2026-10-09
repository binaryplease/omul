/**
 * Feedback about omul from the app menu (REQ185 slice 2).
 *
 * Three halves:
 *
 *   - **The rules** (`src/feedback.ts`) — when the send button wakes, what a
 *     second tap on the chosen star does, which kind of screen a route is, and
 *     the body `POST /api/feedback` is sent. Pure functions, asserted directly;
 *     the body is also run through the route's own schema, so a drift between
 *     what the client sends and what the server takes fails here.
 *   - **The form** (`FeedbackFormView`) — rendered to static markup with React's
 *     own server renderer, which needs no DOM: the contact box is drawn only for
 *     an address, the button's disabled state follows the rules, the heading
 *     names the recipient.
 *   - **The menu item** (`AppMenuPanel`) — drawn between Appearance and Legal
 *     when the deployment collects feedback, and not at all when it does not.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserFeedbackSubmissionSchema } from "../../server/schemas";
import {
	buildUserFeedbackSubmission,
	canSendFeedback,
	type FeedbackDraft,
	feedbackSurfaceForRoute,
	nextFeedbackRating,
	screenLanguage,
} from "../feedback";
import type { LegalLinks } from "../types";
import {
	EMPTY_FEEDBACK_DRAFT,
	type FeedbackFormStatus,
	FeedbackFormView,
} from "./FeedbackForm";
import { AppMenuPanel } from "./ui/AppMenu";

const EDITING: FeedbackFormStatus = { phase: "editing" };

function draftOf(overrides: Partial<FeedbackDraft>): FeedbackDraft {
	return { ...EMPTY_FEEDBACK_DRAFT, ...overrides };
}

function form(
	draft: FeedbackDraft,
	contactEmail: string | null,
	status: FeedbackFormStatus = EDITING,
): string {
	return renderToStaticMarkup(
		createElement(FeedbackFormView, {
			headingId: "feedback-heading",
			draft,
			contactEmail,
			status,
			onRate: () => {},
			onCommentChange: () => {},
			onContactChange: () => {},
			onSubmit: () => {},
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

/** The opening tag of the form's submit button. */
function sendButton(markup: string): string {
	const match = markup.match(/<button[^>]*type="submit"[^>]*>/);
	if (!match) throw new Error("no send button rendered");
	return match[0];
}

describe("when feedback can be sent", () => {
	test("a rating alone is enough", () => {
		expect(canSendFeedback({ rating: 4, comment: "" })).toBe(true);
	});

	test("a comment alone is enough", () => {
		expect(canSendFeedback({ rating: null, comment: "Lovely" })).toBe(true);
	});

	test("both together", () => {
		expect(canSendFeedback({ rating: 2, comment: "Slow" })).toBe(true);
	});

	test("neither, or a comment of blanks, is not", () => {
		expect(canSendFeedback({ rating: null, comment: "" })).toBe(false);
		expect(canSendFeedback({ rating: null, comment: "  \n\t " })).toBe(false);
	});

	test("the send button follows the same rule", () => {
		expect(sendButton(form(draftOf({ rating: 5 }), null))).not.toContain(
			"disabled",
		);
		expect(
			sendButton(form(draftOf({ comment: "Works well" }), null)),
		).not.toContain("disabled");
		expect(
			sendButton(form(draftOf({ rating: 1, comment: "Hmm" }), null)),
		).not.toContain("disabled");
		const empty = form(draftOf({}), null);
		expect(sendButton(empty)).toContain("disabled");
		expect(sendButton(form(draftOf({ comment: "   " }), null))).toContain(
			"disabled",
		);
		// Disabled with its reason, not just greyed out (ADR-0025).
		expect(textOf(empty)).toContain("Add a rating or a comment to send.");
	});

	test("the button is inert while a send is under way", () => {
		const markup = form(draftOf({ rating: 3 }), null, { phase: "sending" });
		expect(sendButton(markup)).toContain("disabled");
	});
});

describe("the stars", () => {
	test("a tap chooses that star", () => {
		expect(nextFeedbackRating(null, 3)).toBe(3);
		expect(nextFeedbackRating(3, 5)).toBe(5);
		expect(nextFeedbackRating(5, 1)).toBe(1);
	});

	test("a second tap on the chosen star clears the rating", () => {
		expect(nextFeedbackRating(4, 4)).toBeNull();
	});

	test("five, the chosen one pressed and those up to it lit", () => {
		const markup = form(draftOf({ rating: 2 }), null);
		const stars = [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"/g)];
		expect(stars).toHaveLength(5);
		expect(stars.map((star) => star[1])).toEqual([
			"false",
			"true",
			"false",
			"false",
			"false",
		]);
		expect(markup.match(/fill="currentColor"/g)).toHaveLength(2);
	});
});

describe("the contact box", () => {
	test("signed in: drawn ticked, naming the account's address", () => {
		const markup = form(draftOf({}), "maria.keller@example.org");
		expect(markup).toContain('type="checkbox"');
		expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
		expect(textOf(markup)).toContain("You can contact me about this");
		expect(textOf(markup)).toContain(
			"We'd write to maria.keller@example.org (your account email)",
		);
	});

	test("unticked, it is drawn unticked", () => {
		const markup = form(draftOf({ contactMe: false }), "a@example.org");
		expect(markup).toContain('type="checkbox"');
		expect(markup).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
	});

	test("without an address — signed out, or the participant prompt — not drawn at all", () => {
		const markup = form(draftOf({}), null);
		expect(markup).not.toContain('type="checkbox"');
		expect(textOf(markup)).not.toContain("contact me");
		expect(textOf(markup)).not.toContain("We'd write to");
	});

	test("starts ticked", () => {
		expect(EMPTY_FEEDBACK_DRAFT.contactMe).toBe(true);
	});

	test("is never called consent", () => {
		expect(form(draftOf({}), "a@example.org").toLowerCase()).not.toContain(
			"consent",
		);
	});
});

describe("the form's words", () => {
	test("the heading names who reads it", () => {
		const markup = form(draftOf({}), null);
		const heading = markup.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
		expect(heading?.[0]).toContain('id="feedback-heading"');
		expect(textOf(heading?.[1] ?? "")).toBe(
			"Feedback about omul — goes to the people who run omul here, not to the presenter or organizer",
		);
	});

	test("after sending: a confirmation in place of the fields", () => {
		const markup = form(draftOf({ rating: 5 }), "a@example.org", {
			phase: "sent",
		});
		expect(markup).toContain('role="status"');
		expect(markup).not.toContain("<textarea");
		expect(markup).not.toContain('type="submit"');
	});

	test("a failed send says so and keeps the fields", () => {
		const markup = form(draftOf({ comment: "Kept" }), null, {
			phase: "failed",
			message: "Not sent: Too many requests",
		});
		expect(markup).toContain('role="alert"');
		expect(textOf(markup)).toContain("Not sent: Too many requests");
		expect(markup).toContain(">Kept</textarea>");
	});
});

describe("the body sent to POST /api/feedback", () => {
	const ORIGIN = { surface: "presenter", language: "en" } as const;

	test("rating, trimmed comment, surface, language and the tick", () => {
		const body = buildUserFeedbackSubmission(
			draftOf({ rating: 4, comment: "  Clear and quick  ", contactMe: true }),
			{ ...ORIGIN, contactOffered: true },
		);
		expect(body).toEqual({
			rating: 4,
			comment: "Clear and quick",
			surface: "presenter",
			language: "en",
			contactMe: true,
		});
	});

	test("an unticked box sends contactMe: false", () => {
		const body = buildUserFeedbackSubmission(
			draftOf({ rating: 2, contactMe: false }),
			{ ...ORIGIN, contactOffered: true },
		);
		expect(body.contactMe).toBe(false);
	});

	test("a box that was never drawn cannot have been left ticked", () => {
		const body = buildUserFeedbackSubmission(
			draftOf({ comment: "Signed out", contactMe: true }),
			{ surface: "participant", language: "de", contactOffered: false },
		);
		expect(body).toEqual({
			rating: null,
			comment: "Signed out",
			surface: "participant",
			language: "de",
			contactMe: false,
		});
	});

	test("never names an account", () => {
		const body = buildUserFeedbackSubmission(draftOf({ rating: 5 }), {
			...ORIGIN,
			contactOffered: true,
		});
		expect(Object.keys(body).sort()).toEqual([
			"comment",
			"contactMe",
			"language",
			"rating",
			"surface",
		]);
	});

	test("is what the route's schema accepts, unchanged", () => {
		for (const draft of [
			draftOf({ rating: 3 }),
			draftOf({ comment: "Only words" }),
			draftOf({ rating: 1, comment: "Both", contactMe: false }),
		]) {
			const body = buildUserFeedbackSubmission(draft, {
				...ORIGIN,
				contactOffered: true,
			});
			expect(UserFeedbackSubmissionSchema.parse(body)).toEqual(body);
		}
	});
});

describe("which kind of screen the menu was opened on", () => {
	test("building, previewing and presenting a deck are the presenter's", () => {
		for (const route of [
			{ page: "create" },
			{ page: "edit", id: "deck" },
			{ page: "preview", id: "deck" },
			{ page: "present", id: "deck" },
		] as const) {
			expect(feedbackSurfaceForRoute(route)).toBe("presenter");
		}
	});

	test("entering a code and the room are the participant's", () => {
		expect(feedbackSurfaceForRoute({ page: "join" })).toBe("participant");
		expect(feedbackSurfaceForRoute({ page: "participate", code: "ABC" })).toBe(
			"participant",
		);
	});

	test("everything else is other", () => {
		for (const route of [
			{ page: "home" },
			{ page: "templates" },
			{ page: "generate" },
			{ page: "workspaces" },
			{ page: "workspace", id: "team" },
			{ page: "results", id: "deck" },
		] as const) {
			expect(feedbackSurfaceForRoute(route)).toBe("other");
		}
	});
});

describe("the language a screen is in", () => {
	/** An element whose nearest `lang` ancestor declares `declared`. */
	function under(declared: string | null): Element {
		const holder = declared === null ? null : { getAttribute: () => declared };
		return { closest: () => holder } as unknown as Element;
	}

	test("the nearest lang above the trigger", () => {
		expect(screenLanguage(under("de"))).toBe("de");
	});

	test("English where nothing, or nothing usable, is declared", () => {
		expect(screenLanguage(null)).toBe("en");
		expect(screenLanguage(under(null))).toBe("en");
		expect(screenLanguage(under("  "))).toBe("en");
	});
});

describe("Send feedback in the app menu", () => {
	const LINKS: LegalLinks = {
		imprintUrl: "https://example.com/imprint",
		privacyUrl: null,
		termsUrl: null,
	};

	function panel(feedbackEnabled: boolean): string {
		return renderToStaticMarkup(
			createElement(AppMenuPanel, {
				id: "app-menu",
				links: LINKS,
				theme: "dark",
				onThemeChange: () => {},
				feedbackEnabled,
				onSendFeedback: () => {},
			}),
		);
	}

	test("drawn between Appearance and Legal when the config says enabled", () => {
		const text = textOf(panel(true));
		const appearance = text.indexOf("Appearance");
		const item = text.indexOf("Send feedback");
		const legal = text.indexOf("Legal");
		expect(item).toBeGreaterThan(appearance);
		expect(legal).toBeGreaterThan(item);
	});

	test("a button opening a dialog, not a link leaving the app", () => {
		const markup = panel(true);
		const item = markup.match(/<(\w+)[^>]*data-app-menu-item[^>]*>/);
		expect(item?.[1]).toBe("button");
		expect(item?.[0]).not.toContain("href");
	});

	test("absent when the config says enabled: false", () => {
		expect(textOf(panel(false))).not.toContain("Send feedback");
	});

	test("absent when nobody says anything, as before REQ185", () => {
		const markup = renderToStaticMarkup(
			createElement(AppMenuPanel, {
				id: "app-menu",
				links: LINKS,
				theme: "dark",
				onThemeChange: () => {},
			}),
		);
		expect(textOf(markup)).not.toContain("Send feedback");
	});
});
