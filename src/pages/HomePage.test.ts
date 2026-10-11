/**
 * Unit tests for a card under "Your Presentations" (REQ184).
 *
 * The defect was a width one — five hover-faded action buttons kept their
 * width beside the title, so a two-column card truncated the title to one
 * letter and wrapped "1 slide" — and a width cannot be measured without a
 * layout engine. What can be asserted from the markup is the structure that
 * keeps it fixed:
 *
 *   - **The actions are not in the title's row, and not invisible.** They sit
 *     in a row of their own, at rest, so nothing beside the title takes its
 *     width and a touch screen can see what it can tap.
 *   - **No metadata item can break inside itself.** Code, slide count and date
 *     are each `whitespace-nowrap`; the row may wrap *between* them.
 *   - **All five actions are still drawn**, in their order, each named — and the
 *     two owner-only ones disabled with their reason rather than dropped.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Presentation } from "../types";
import { OwnDeckCard } from "./HomePage";

const LONG_TITLE = "Quarterly All-Hands Retrospective and Planning";

function deck(overrides: Partial<Presentation> = {}): Presentation {
	return {
		id: "deck-1",
		title: LONG_TITLE,
		code: "ABC123",
		status: "draft",
		slides: [{ id: "slide-1" }],
		createdAt: "2026-10-11T09:00:00.000Z",
		...overrides,
	} as Presentation;
}

function renderCard({
	owned = true,
	signedIn = true,
	duplicating = false,
	pres = deck(),
} = {}) {
	const noop = () => {};
	return renderToStaticMarkup(
		createElement(OwnDeckCard, {
			pres,
			enterDelay: 1,
			owned,
			signedIn,
			duplicating,
			onOpen: noop,
			onShare: noop,
			onMove: noop,
			onExport: noop,
			onDuplicate: noop,
			onDelete: noop,
		}),
	);
}

/** Every `<button …>` opening tag in render order. */
function buttonTags(markup: string): string[] {
	return markup.match(/<button[^>]*>/g) ?? [];
}

describe("OwnDeckCard — the title keeps its width (REQ184)", () => {
	test("the title is rendered whole, truncating only at the card's edge", () => {
		const markup = renderCard();
		expect(markup).toMatch(
			new RegExp(`<h3 class="[^"]*\\btruncate\\b[^"]*" title="${LONG_TITLE}">`),
		);
		expect(markup).toContain(`>${LONG_TITLE}</h3>`);
	});

	test("no action shares the title's row", () => {
		const markup = renderCard();
		const titleRowEnd = markup.indexOf("</div>", markup.indexOf("</h3>"));
		expect(markup.indexOf("<button")).toBeGreaterThan(titleRowEnd);
	});

	test("no action is faded out until hover", () => {
		const markup = renderCard();
		expect(markup).not.toContain("opacity-0");
		expect(markup).not.toContain("group-hover:");
	});
});

describe("OwnDeckCard — the metadata row (REQ184)", () => {
	test("code, slide count and date each stay on one line", () => {
		const markup = renderCard();
		for (const item of [
			"ABC123",
			"1 slide",
			new Date("2026-10-11T09:00:00.000Z").toLocaleDateString(),
		]) {
			expect(markup).toMatch(
				new RegExp(`<span class="[^"]*\\bwhitespace-nowrap\\b[^"]*">${item}</span>`),
			);
		}
	});

	test("the slide count is said once, in the singular for one slide", () => {
		expect(renderCard().match(/slides?</g)).toEqual(["slide<"]);
		const threeSlides = renderCard({
			pres: deck({
				slides: [{ id: "a" }, { id: "b" }, { id: "c" }],
			} as Partial<Presentation>),
		});
		expect(threeSlides).toContain(">3 slides</span>");
	});
});

describe("OwnDeckCard — all five actions stay reachable (REQ184)", () => {
	test("drawn in order, each with its name", () => {
		const titles = buttonTags(renderCard()).map(
			(tag) => tag.match(/title="([^"]*)"/)?.[1],
		);
		expect(titles).toEqual([
			"Share this deck with another account",
			"Move this deck into a workspace",
			"Export presentation as JSON",
			"Duplicate presentation",
			"Delete presentation",
		]);
	});

	test("an owned deck's actions are all live", () => {
		for (const tag of buttonTags(renderCard())) {
			expect(tag).not.toContain("disabled=");
		}
	});

	test("the owner-only pair stays drawn, disabled with its reason", () => {
		const signedIn = buttonTags(renderCard({ owned: false }));
		expect(signedIn).toHaveLength(5);
		expect(signedIn[0]).toContain('disabled=""');
		expect(signedIn[0]).toContain("this account does not own it");
		expect(signedIn[1]).toContain('disabled=""');
		expect(signedIn[1]).toContain("this account does not own it");

		const signedOut = buttonTags(renderCard({ owned: false, signedIn: false }));
		expect(signedOut[0]).toContain("sign in with the account that owns it");
		expect(signedOut[1]).toContain("sign in with the account that owns it");
		for (const tag of signedOut.slice(2)) {
			expect(tag).not.toContain("disabled=");
		}
	});

	test("a duplicate in flight disables only the duplicate control", () => {
		const tags = buttonTags(renderCard({ duplicating: true }));
		expect(tags.map((tag) => tag.includes('disabled=""'))).toEqual([
			false,
			false,
			false,
			true,
			false,
		]);
	});
});
