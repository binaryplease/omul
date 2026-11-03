/**
 * Unit tests for the client half of grouping free-text answers into themes
 * (REQ114).
 *
 * What is worth asserting here is what every rendering of the panel asks of the
 * module, and what it sends:
 *
 *   - **Which answers a tally names** — a word cloud's editor-only `answers`, an
 *     open-ended slide's `responses` — so the list grouped is the list the
 *     delete control (REQ027) points at.
 *   - **The split into themes and ungrouped**, which keeps every answer drawn
 *     exactly once and counts what a theme holds that the list does not name.
 *   - **When a theme can be added, and why not when it cannot** — the control
 *     stays on screen with its reason.
 *   - **The five calls** — method, path and body against the routes in
 *     `docs/api.md`, and a read parsed through the stored shape.
 *   - **Unmounted, with one caller of the routes**: no non-test module imports
 *     the surface, so no page draws it until the Results-page follow-up (REQ114),
 *     and no other module calls a theme route.
 *   - **The surface says it is editor-only**: closed, the strip's one line says
 *     themes are not shown live; open, the panel says they are sorted by hand
 *     for the editor's analysis and names every live surface that leaves them
 *     out — so nobody goes looking for them on the presenter's screen.
 *
 * Who may reach the routes is the server's to decide, and is pinned down in
 * `server/answer-themes.integration.test.ts`, where it can actually fail.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, ApiError } from "../api";
import type { AnswerTheme } from "../types";
import {
	ANSWER_THEMES_PURPOSE,
	ANSWER_THEMES_SCOPE,
	AnswerThemesPanel,
	AnswerThemesStrip,
	answerCountLabel,
	answerThemeCreation,
	answerThemesLoadFailure,
	groupableAnswersOf,
	groupAnswersByTheme,
	themeIdOfAnswer,
} from "./AnswerThemes";

function theme(overrides: Partial<AnswerTheme> = {}): AnswerTheme {
	return {
		id: "t1",
		slideId: "s1",
		name: "Pricing",
		answerIds: [],
		createdAt: "2026-10-22T09:00:00.000Z",
		...overrides,
	};
}

describe("groupableAnswersOf — the answers a tally names", () => {
	test("a word cloud's editor-only list, as written", () => {
		const tally = {
			words: [{ text: "pizza", count: 2 }],
			answers: [
				{ id: "a1", text: "Pizza", createdAt: "" },
				{ id: "a2", text: "pizza ", createdAt: "" },
			],
		};
		expect(groupableAnswersOf("word-cloud", tally)).toEqual([
			{ id: "a1", text: "Pizza" },
			{ id: "a2", text: "pizza " },
		]);
	});

	test("an open-ended slide's responses, in the tally's order", () => {
		const tally = {
			responses: [
				{ id: "r2", text: "Later", upvotes: 0 },
				{ id: "r1", text: "Sooner", upvotes: 3 },
			],
		};
		expect(groupableAnswersOf("open-text", tally).map((one) => one.id)).toEqual(
			["r2", "r1"],
		);
	});

	test("no tally, a list withheld as null, or another type reads as none", () => {
		expect(groupableAnswersOf("word-cloud", null)).toEqual([]);
		expect(groupableAnswersOf("word-cloud", { answers: null })).toEqual([]);
		expect(
			groupableAnswersOf("multiple-choice", { responses: [{ id: "x" }] }),
		).toEqual([]);
	});
});

describe("groupAnswersByTheme — one reading of the grouping", () => {
	const answers = [
		{ id: "a1", text: "Too expensive" },
		{ id: "a2", text: "Slow app" },
		{ id: "a3", text: "Costs a lot" },
		{ id: "a4", text: "Nice people" },
	];

	test("each theme holds its answers in the tally's order; the rest are ungrouped", () => {
		const { groups, ungrouped } = groupAnswersByTheme(answers, [
			theme({ id: "price", answerIds: ["a3", "a1"] }),
			theme({ id: "speed", name: "Speed", answerIds: ["a2"] }),
		]);
		expect(groups.map((group) => group.answers.map((one) => one.id))).toEqual([
			["a1", "a3"],
			["a2"],
		]);
		expect(ungrouped.map((one) => one.id)).toEqual(["a4"]);
	});

	test("no themes leaves every answer ungrouped, and none is lost", () => {
		const { groups, ungrouped } = groupAnswersByTheme(answers, []);
		expect(groups).toEqual([]);
		expect(ungrouped).toEqual(answers);
	});

	test("an empty theme is still drawn — groups may be built ahead of answers", () => {
		const { groups } = groupAnswersByTheme([], [theme()]);
		expect(groups).toHaveLength(1);
		expect(groups[0].answers).toEqual([]);
		expect(groups[0].unlisted).toBe(0);
	});

	test("an answer two themes name is drawn once, under the older", () => {
		const { groups, ungrouped } = groupAnswersByTheme(answers, [
			theme({ id: "first", answerIds: ["a1"] }),
			theme({ id: "second", answerIds: ["a1", "a2"] }),
		]);
		expect(groups[0].answers.map((one) => one.id)).toEqual(["a1"]);
		expect(groups[1].answers.map((one) => one.id)).toEqual(["a2"]);
		expect(ungrouped.map((one) => one.id)).toEqual(["a3", "a4"]);
	});

	test("an id the list does not name is counted rather than dropped", () => {
		const { groups } = groupAnswersByTheme(answers, [
			theme({ answerIds: ["a1", "held-back"] }),
		]);
		expect(groups[0].answers.map((one) => one.id)).toEqual(["a1"]);
		expect(groups[0].unlisted).toBe(1);
	});
});

describe("themeIdOfAnswer — what an answer's picker shows", () => {
	const themes = [
		theme({ id: "price", answerIds: ["a1"] }),
		theme({ id: "speed", answerIds: ["a2"] }),
	];

	test("the theme holding it, or null for an ungrouped answer", () => {
		expect(themeIdOfAnswer(themes, "a2")).toBe("speed");
		expect(themeIdOfAnswer(themes, "a9")).toBe(null);
	});
});

describe("answerThemeCreation — the add control, and why it is idle", () => {
	test("a named theme on a slide with room can be added", () => {
		expect(answerThemeCreation({ name: "Pricing", themeCount: 3 })).toEqual({
			enabled: true,
			reason: "",
		});
	});

	test("a blank name is refused with a reason, not silently", () => {
		const state = answerThemeCreation({ name: "   ", themeCount: 0 });
		expect(state.enabled).toBe(false);
		expect(state.reason).not.toBe("");
	});

	test("at the server's limit the control says so, whatever is typed", () => {
		const state = answerThemeCreation({ name: "One more", themeCount: 50 });
		expect(state.enabled).toBe(false);
		expect(state.reason).toContain("50");
	});
});

describe("answerThemesLoadFailure — a failed read, in words", () => {
	test("a slide not on the stored deck asks for a save", () => {
		expect(
			answerThemesLoadFailure(new ApiError("No such slide on this deck", null, 404)),
		).toContain("Save the deck");
	});

	test("any other refusal is the server's own sentence", () => {
		expect(
			answerThemesLoadFailure(new ApiError("Unauthorized", null, 401)),
		).toBe("Unauthorized");
	});
});

describe("answerCountLabel", () => {
	test("singular and plural", () => {
		expect(answerCountLabel(1)).toBe("1 answer");
		expect(answerCountLabel(0)).toBe("0 answers");
		expect(answerCountLabel(7)).toBe("7 answers");
	});
});

// ── What the surface says about itself ────────────────────────

/** The text a static render shows, with React's escaping undone. */
function renderedText(markup: string): string {
	return markup
		.replace(/<[^>]+>/g, " ")
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

const SLIDE_PROPS = {
	presentationId: "pres-1",
	slideId: "slide-a",
	slideType: "word-cloud" as const,
};

describe("the strip says themes are the editor's, not the room's", () => {
	test("closed, its one line says themes are not shown live", () => {
		const text = renderedText(
			renderToStaticMarkup(createElement(AnswerThemesStrip, SLIDE_PROPS)),
		);
		expect(text).toContain(ANSWER_THEMES_SCOPE);
		expect(ANSWER_THEMES_SCOPE).toContain("not shown live");
	});

	test("open, the panel starts with what themes are for", () => {
		const text = renderedText(
			renderToStaticMarkup(createElement(AnswerThemesPanel, SLIDE_PROPS)),
		);
		expect(text).toContain(ANSWER_THEMES_PURPOSE);
	});

	test("the purpose says by hand, for analysis, and names every live surface", () => {
		for (const phrase of [
			"by hand",
			"analysis",
			"never shown live",
			"presenter screen",
			"shared screen",
			"participants",
			"results link",
		]) {
			expect(ANSWER_THEMES_PURPOSE).toContain(phrase);
		}
	});
});

// ── The five calls ────────────────────────────────────────────

const realFetch = globalThis.fetch;

type SentRequest = { url: string; method: string; body: unknown };

/** Answer every request with `body`, and record what was sent. */
function stubFetch(body: unknown): SentRequest[] {
	const sent: SentRequest[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		sent.push({
			url: String(input),
			method: init?.method ?? "GET",
			body: init?.body ? JSON.parse(String(init.body)) : null,
		});
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
	return sent;
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("the theme calls (REQ114)", () => {
	test("listing reads the slide's themes and parses each through the stored shape", async () => {
		const sent = stubFetch({ themes: [{ id: "t1", name: "Pricing" }] });
		const themes = await api.listAnswerThemes("pres-1", "slide-a");
		expect(sent).toEqual([
			{
				url: "/api/presentations/pres-1/slides/slide-a/answer-themes",
				method: "GET",
				body: null,
			},
		]);
		// Fields the server left out arrive defaulted, not missing.
		expect(themes).toEqual([
			{ id: "t1", slideId: "", name: "Pricing", answerIds: [], createdAt: "" },
		]);
	});

	test("creating posts the name", async () => {
		const sent = stubFetch(theme({ id: "t2", name: "Speed" }));
		const created = await api.createAnswerTheme("pres-1", "slide-a", "Speed");
		expect(sent[0]).toEqual({
			url: "/api/presentations/pres-1/slides/slide-a/answer-themes",
			method: "POST",
			body: { name: "Speed" },
		});
		expect(created.id).toBe("t2");
	});

	test("renaming patches the theme", async () => {
		const sent = stubFetch(theme({ name: "Cost" }));
		await api.renameAnswerTheme("pres-1", "slide-a", "t1", "Cost");
		expect(sent[0]).toEqual({
			url: "/api/presentations/pres-1/slides/slide-a/answer-themes/t1",
			method: "PATCH",
			body: { name: "Cost" },
		});
	});

	test("deleting deletes the theme", async () => {
		const sent = stubFetch({ ok: true });
		await api.deleteAnswerTheme("pres-1", "slide-a", "t1");
		expect(sent[0]).toEqual({
			url: "/api/presentations/pres-1/slides/slide-a/answer-themes/t1",
			method: "DELETE",
			body: null,
		});
	});

	test("assigning puts the answer in a theme, and null takes it out", async () => {
		const sent = stubFetch({ answerId: "a1", themeId: null, slideId: "slide-a" });
		await api.assignAnswerTheme("pres-1", "a1", "t1");
		await api.assignAnswerTheme("pres-1", "a1", null);
		expect(sent).toEqual([
			{
				url: "/api/presentations/pres-1/answers/a1/answer-theme",
				method: "PUT",
				body: { themeId: "t1" },
			},
			{
				url: "/api/presentations/pres-1/answers/a1/answer-theme",
				method: "PUT",
				body: { themeId: null },
			},
		]);
	});
});

// ── Unmounted until the Results-page follow-up ────────────────

const SRC = join(import.meta.dir, "..");

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
	});
}

describe("the grouping surface stays unmounted", () => {
	const files = sourceFiles(SRC).map((path) => ({
		name: relative(SRC, path),
		text: readFileSync(path, "utf8"),
	}));

	// Any way of naming the module counts: a static import, a re-export or a
	// lazy `import(...)`, from any depth.
	test("no non-test module imports the grouping surface", () => {
		const importing = files
			.filter((file) =>
				/(?:from\s+|import\s*\(\s*|import\s+)["'][^"']*\/AnswerThemes(?:\.tsx?)?["']/.test(
					file.text,
				),
			)
			.map((file) => file.name);
		expect(importing).toEqual([]);
	});

	test("no other module calls a theme route", () => {
		const calling = files
			.filter((file) =>
				/api\.(listAnswerThemes|createAnswerTheme|renameAnswerTheme|deleteAnswerTheme|assignAnswerTheme)\b/.test(
					file.text,
				),
			)
			.map((file) => file.name);
		expect(calling).toEqual(["components/AnswerThemes.tsx"]);
	});
});
