/**
 * The administrators' feedback page (REQ185 slice 4).
 *
 * Two halves:
 *
 *   - **The readings** — which refusal of `GET /api/admin/feedback` is which
 *     screen, how a further page joins the ones shown, and the `mailto:` an
 *     address is written to. Pure functions, asserted directly.
 *   - **The screens** (`AdminFeedbackScreen`) — rendered to static markup with
 *     React's own server renderer, which needs no DOM: the three contact states
 *     of a user entry, the summary, paging, and each refusal drawn as a screen
 *     that mounts the app menu. The page shapes are run through the endpoint's
 *     own response schema first, so a drift between what the server answers and
 *     what the page draws fails here.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminFeedbackPageSchema } from "../../server/schemas";
import { ApiError } from "../api";
import type { AdminFeedbackPage, FeedbackChannel } from "../types";
import {
	type AdminFeedbackState,
	AdminFeedbackScreen,
	appendAdminFeedbackPage,
	feedbackMailto,
	readAdminFeedbackFailure,
} from "./AdminFeedbackPage";

const USER_PAGE: AdminFeedbackPage = AdminFeedbackPageSchema.parse({
	channel: "user",
	total: 4,
	ratingCounts: { "1": 0, "2": 1, "3": 0, "4": 1, "5": 1 },
	unratedCount: 1,
	nextCursor: "entry-3",
	entries: [
		{
			id: "entry-1",
			rating: 5,
			comment: "Loved the word cloud",
			surface: "presenter",
			language: "en",
			createdOn: "2026-10-09",
			contact: { status: "email", email: "maria.keller@example.org" },
		},
		{
			id: "entry-2",
			rating: null,
			comment: "<script>alert(1)</script>",
			surface: "participant",
			language: "de",
			createdOn: "2026-10-08",
			contact: null,
		},
		{
			id: "entry-3",
			rating: 2,
			comment: null,
			surface: "other",
			language: "en",
			createdOn: "2026-10-07",
			contact: { status: "deleted" },
		},
	],
});

const EMPTY_PARTICIPANT_PAGE: AdminFeedbackPage = AdminFeedbackPageSchema.parse(
	{ channel: "participant", ratingCounts: {} },
);

function screen(
	state: AdminFeedbackState,
	channel: FeedbackChannel = "user",
): string {
	return renderToStaticMarkup(
		createElement(AdminFeedbackScreen, {
			channel,
			state,
			loadingMore: false,
			onChannelChange: () => {},
			onLoadMore: () => {},
			onBack: () => {},
		}),
	);
}

/** The visible text of rendered markup, tags dropped and entities read. */
function textOf(markup: string): string {
	return markup
		.replace(/<[^>]+>/g, " ")
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ");
}

/** The markup of one entry, found by a piece of its text. */
function entryContaining(markup: string, needle: string): string {
	const entry = [...markup.matchAll(/<li\b[\s\S]*?<\/li>/g)]
		.map((match) => match[0])
		.find((item) => item.includes(needle));
	if (!entry) throw new Error(`no entry containing ${needle}`);
	return entry;
}

const MENU_TRIGGER = 'aria-label="Appearance and legal"';

describe("reading the endpoint's refusals", () => {
	test("401 asks to sign in, 403 is not an admin, 404 is the channel off", () => {
		expect(readAdminFeedbackFailure(new ApiError("x", null, 401))).toEqual({
			kind: "signedOut",
		});
		expect(readAdminFeedbackFailure(new ApiError("x", null, 403))).toEqual({
			kind: "forbidden",
		});
		expect(readAdminFeedbackFailure(new ApiError("x", null, 404))).toEqual({
			kind: "off",
		});
	});

	test("anything else is a failure that keeps its message", () => {
		expect(
			readAdminFeedbackFailure(new ApiError("Unknown cursor", null, 400)),
		).toEqual({ kind: "failed", message: "Unknown cursor" });
		expect(readAdminFeedbackFailure(new TypeError("Failed to fetch"))).toEqual({
			kind: "failed",
			message: "Failed to fetch",
		});
	});
});

describe("paging", () => {
	test("a further page follows the entries shown, with its own cursor", () => {
		const next = AdminFeedbackPageSchema.parse({
			...USER_PAGE,
			nextCursor: null,
			entries: [{ ...USER_PAGE.entries[0], id: "entry-4" }],
		});
		const joined = appendAdminFeedbackPage(USER_PAGE, next);
		expect(joined.entries.map((entry) => entry.id)).toEqual([
			"entry-1",
			"entry-2",
			"entry-3",
			"entry-4",
		]);
		expect(joined.nextCursor).toBeNull();
		expect(joined.total).toBe(4);
	});

	test("a page of another channel replaces what was shown", () => {
		expect(appendAdminFeedbackPage(USER_PAGE, EMPTY_PARTICIPANT_PAGE)).toBe(
			EMPTY_PARTICIPANT_PAGE,
		);
	});

	test("the page offers the next one only while there is a cursor", () => {
		expect(textOf(screen({ kind: "ready", page: USER_PAGE }))).toContain(
			"Show older feedback",
		);
		const last = { ...USER_PAGE, nextCursor: null };
		expect(textOf(screen({ kind: "ready", page: last }))).not.toContain(
			"Show older feedback",
		);
	});
});

describe("the contact on a user entry", () => {
	const markup = screen({ kind: "ready", page: USER_PAGE });

	test("an address is a mailto: link to it", () => {
		const entry = entryContaining(markup, "Loved the word cloud");
		expect(entry).toContain('href="mailto:maria.keller@example.org"');
		expect(textOf(entry)).toContain("maria.keller@example.org");
	});

	test("no tick, no contact line at all", () => {
		const entry = entryContaining(markup, "&lt;script&gt;");
		expect(entry).not.toContain("mailto:");
		expect(textOf(entry)).not.toContain("account deleted");
	});

	test("a deleted account reads as account deleted, no contact", () => {
		const entry = entryContaining(markup, "Rated 2 of 5");
		expect(textOf(entry)).toContain("account deleted, no contact");
		expect(entry).not.toContain("mailto:");
	});

	test("the mailto: names a recipient and nothing else", () => {
		expect(feedbackMailto("a@example.org")).toBe("mailto:a@example.org");
		expect(feedbackMailto("a@example.org?bcc=b@example.org")).toBe(
			"mailto:a@example.org%3Fbcc%3Db@example.org",
		);
	});
});

describe("the ready page", () => {
	const markup = screen({ kind: "ready", page: USER_PAGE });

	test("a comment is drawn as text, never as markup", () => {
		expect(markup).not.toContain("<script>");
		expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	test("the summary carries the total, each rating and the unrated count", () => {
		const summary = markup.match(/<section aria-label="Summary"[\s\S]*?<\/section>/);
		if (!summary) throw new Error("no summary rendered");
		const text = textOf(summary[0]);
		expect(text).toContain("4 in total");
		expect(text).toContain("5 stars 1");
		expect(text).toContain("3 stars 0");
		expect(text).toContain("No rating 1");
	});

	test("one tab per channel, the shown one selected", () => {
		expect(markup).toContain('role="tablist"');
		expect(markup.match(/role="tab"/g)).toHaveLength(2);
		expect(markup).toMatch(/role="tab" aria-selected="true"[^>]*>App menu/);
		const participant = screen(
			{ kind: "ready", page: EMPTY_PARTICIPANT_PAGE },
			"participant",
		);
		expect(participant).toMatch(
			/role="tab" aria-selected="true"[^>]*>After a session/,
		);
		expect(textOf(participant)).toContain("No feedback in this channel yet.");
		expect(participant).not.toContain("mailto:");
	});

	test("it mounts the app menu", () => {
		expect(markup).toContain(MENU_TRIGGER);
	});
});

describe("each refusal is a screen with the app menu on it", () => {
	const cases: [AdminFeedbackState, string][] = [
		[{ kind: "signedOut" }, "Sign in to read feedback"],
		[{ kind: "forbidden" }, "This page is for administrators"],
		[{ kind: "off" }, "Feedback is not collected on this server"],
		[{ kind: "failed", message: "Unknown cursor" }, "Unknown cursor"],
	];
	for (const [state, words] of cases) {
		test(`${state.kind}: "${words}"`, () => {
			const markup = screen(state);
			expect(textOf(markup)).toContain(words);
			expect(markup).toContain(MENU_TRIGGER);
			expect(markup).not.toContain('role="tablist"');
		});
	}
});
