/**
 * Unit tests for authored slide text (REQ088 hyperlinks, REQ089 markdown,
 * REQ091 text size).
 *
 * Everything a surface renders goes through the two parsers and the size token
 * in `SlideText.tsx`, so pinning them down is pinning down all four surfaces at
 * once — no DOM needed, the same way `PinImage.test.ts` pins the pin canvas's
 * geometry. Three things are worth the assertions:
 *
 *   - **What the markup means.** Bold, italic, code, lists, sub-headings and
 *     links, plus the cases where a marker is *not* markup: an underscore
 *     inside a word, a backslash-escaped star, a list marker that is really a
 *     dash. A parser that silently formats a file name is a parser an organizer
 *     cannot trust with plain prose.
 *   - **What may become a link.** The one attacker-controlled attribute this
 *     module can emit is an `href`, so the scheme allowlist is tested with the
 *     evasions that make a pattern match and a URL parser disagree — casing,
 *     leading space, an embedded newline.
 *   - **That plain text stays plain.** A deck written before markdown existed
 *     must render character for character as it did, line breaks included.
 */

import { describe, expect, test } from "bun:test";
import { SlideTextSizeEnum } from "../../server/schemas";
import {
	parseSlideInline,
	parseSlideText,
	safeSlideLinkHref,
	SLIDE_TEXT_SCALE,
	SLIDE_TEXT_SIZE_OPTIONS,
	type SlideInlineNode,
	type SlideTextBlock,
	slideTextToPlain,
} from "./SlideText";

/**
 * A parsed run written back as a compact string — `*` for emphasis, `**` for
 * strong, `` ` `` for code, `[label](href)` for a link — so an assertion reads
 * as the markup it is about rather than as a tree literal. Round-tripping
 * through the *parsed* shape is the point: it fails if a marker was left in the
 * text, and it shows the resolved `href` rather than the authored one.
 */
function writeBack(nodes: SlideInlineNode[]): string {
	return nodes
		.map((node) => {
			switch (node.kind) {
				case "text":
					return node.text;
				case "code":
					return `\`${node.text}\``;
				case "strong":
					return `**${writeBack(node.children)}**`;
				case "emphasis":
					return `*${writeBack(node.children)}*`;
				case "link":
					return `[${writeBack(node.children)}](${node.href})`;
			}
		})
		.join("");
}

/** The same, for a whole body: one line per block, list items prefixed. */
function writeBackBlocks(blocks: SlideTextBlock[]): string[] {
	return blocks.flatMap((block) => {
		if (block.kind === "heading") {
			return [`h${block.level}: ${writeBack(block.content)}`];
		}
		if (block.kind === "list") {
			const marker = block.ordered ? `${block.start}.` : "-";
			return block.items.map((item) => `${marker} ${writeBack(item)}`);
		}
		return [writeBack(block.content)];
	});
}

/** Every link a run produced, as `[label, href]` pairs. */
function linksIn(nodes: SlideInlineNode[]): [string, string][] {
	return nodes.flatMap((node): [string, string][] => {
		if (node.kind === "link") return [[writeBack(node.children), node.href]];
		if (node.kind === "strong" || node.kind === "emphasis") {
			return linksIn(node.children);
		}
		return [];
	});
}

describe("inline markup — the emphasis an organizer writes (REQ089)", () => {
	test("bold, italic and code are read out of the text", () => {
		expect(writeBack(parseSlideInline("a **bold** and *italic* word"))).toBe(
			"a **bold** and *italic* word",
		);
		expect(parseSlideInline("**bold**")).toEqual([
			{ kind: "strong", children: [{ kind: "text", text: "bold" }] },
		]);
		expect(parseSlideInline("`code`")).toEqual([
			{ kind: "code", text: "code" },
		]);
	});

	test("underscores mark emphasis too, but not inside a word", () => {
		expect(parseSlideInline("_stressed_")).toEqual([
			{ kind: "emphasis", children: [{ kind: "text", text: "stressed" }] },
		]);
		// A file name is a file name: an organizer writing `annual_report_2026`
		// wrote three words joined by underscores, not one emphasised middle.
		expect(parseSlideInline("annual_report_2026")).toEqual([
			{ kind: "text", text: "annual_report_2026" },
		]);
	});

	test("emphasis nests", () => {
		expect(parseSlideInline("**bold with *italic* inside**")).toEqual([
			{
				kind: "strong",
				children: [
					{ kind: "text", text: "bold with " },
					{ kind: "emphasis", children: [{ kind: "text", text: "italic" }] },
					{ kind: "text", text: " inside" },
				],
			},
		]);
	});

	test("a backslash takes the marker back", () => {
		expect(parseSlideInline("2 \\* 3 \\* 4")).toEqual([
			{ kind: "text", text: "2 * 3 * 4" },
		]);
		expect(parseSlideInline("\\**not bold*\\*")).toEqual([
			{ kind: "text", text: "*" },
			{ kind: "emphasis", children: [{ kind: "text", text: "not bold" }] },
			{ kind: "text", text: "*" },
		]);
	});

	test("an unclosed marker is just a character on the slide", () => {
		expect(parseSlideInline("5 * 4 = 20")).toEqual([
			{ kind: "text", text: "5 * 4 = 20" },
		]);
		expect(parseSlideInline("**never closed")).toEqual([
			{ kind: "text", text: "**never closed" },
		]);
	});

	test("code is verbatim — a marker inside it is not markup", () => {
		expect(parseSlideInline("`a * b`")).toEqual([
			{ kind: "code", text: "a * b" },
		]);
	});
});

describe("links — clickable, and only where they may be (REQ088)", () => {
	test("a markdown link carries its label and its target", () => {
		expect(linksIn(parseSlideInline("see [the docs](https://example.com/a)"))).toEqual(
			[["the docs", "https://example.com/a"]],
		);
	});

	test("a bare address typed into the text is clickable as it stands", () => {
		expect(linksIn(parseSlideInline("go to https://example.com/docs now"))).toEqual(
			[["https://example.com/docs", "https://example.com/docs"]],
		);
	});

	test("a full stop ends the sentence, not the address", () => {
		const nodes = parseSlideInline("Read https://example.com/a.");
		expect(linksIn(nodes)).toEqual([
			["https://example.com/a", "https://example.com/a"],
		]);
		expect(writeBack(nodes)).toBe(
			"Read [https://example.com/a](https://example.com/a).",
		);
	});

	test("a link may be emphasised, and emphasis may hold a link", () => {
		expect(linksIn(parseSlideInline("**[docs](https://example.com)**"))).toEqual(
			[["docs", "https://example.com/"]],
		);
	});

	test("a label-less link falls back to showing its address", () => {
		expect(linksIn(parseSlideInline("[](https://example.com/a)"))).toEqual([
			["https://example.com/a", "https://example.com/a"],
		]);
	});

	test("an address with parentheses in it is linked whole, not cut at the first one", () => {
		// Wikipedia, SharePoint and Confluence all hand out addresses like this.
		// A link cut at the `(` is not a shorter link — it is a blue, clickable
		// link that goes somewhere else, which is the one failure this module
		// promises never to produce: what is not honoured stays as text.
		const address = "https://en.wikipedia.org/wiki/Nirvana_(band)";
		expect(linksIn(parseSlideInline(address))).toEqual([[address, address]]);
		expect(
			linksIn(parseSlideInline(`See [the page](${address}) today`)),
		).toEqual([["the page", address]]);
		expect(
			linksIn(parseSlideInline("[a](https://example.com/x_(y)_(z))")),
		).toEqual([["a", "https://example.com/x_(y)_(z)"]]);
	});

	test("a paren the sentence opened is given back to the sentence", () => {
		// The other half of the same rule: only the parens the *address* opened
		// belong to it.
		const nodes = parseSlideInline("(see https://example.com/a)");
		expect(linksIn(nodes)).toEqual([
			["https://example.com/a", "https://example.com/a"],
		]);
		expect(writeBack(nodes)).toBe(
			"(see [https://example.com/a](https://example.com/a))",
		);
		expect(
			linksIn(parseSlideInline("(see https://example.com/a.)")),
		).toEqual([["https://example.com/a", "https://example.com/a"]]);
	});

	test("a target with a space in it is not a link the label wears", () => {
		// The `[a](…)` never becomes a link; what is left is ordinary text with a
		// bare address in it, which autolinks as any bare address does.
		const nodes = parseSlideInline("[a](https://example.com/x y)");
		expect(linksIn(nodes).map(([label]) => label)).not.toContain("a");
	});

	test("a `[label](` that nothing closes on the line stays text", () => {
		expect(linksIn(parseSlideInline("[unclosed](see below"))).toEqual([]);
	});

	test("a scheme this surface will not open never becomes a link", () => {
		// It stays on the slide as the text it was typed as — visible to its
		// author, inert to the room.
		for (const written of [
			"[click](javascript:alert(1))",
			"[click](JavaScript:alert(1))",
			"[click](  javascript:alert(1))",
			"[click](data:text/html,<script>alert(1)</script>)",
			"[click](vbscript:msgbox)",
			"[click](file:///etc/passwd)",
		]) {
			const nodes = parseSlideInline(written);
			expect(linksIn(nodes)).toEqual([]);
			expect(nodes.every((node) => node.kind === "text")).toBe(true);
		}
	});
});

describe("safeSlideLinkHref — the scheme allowlist (REQ088)", () => {
	test("the four schemes a slide's link may use are accepted", () => {
		expect(safeSlideLinkHref("https://example.com/a")).toBe(
			"https://example.com/a",
		);
		expect(safeSlideLinkHref("http://example.com/a")).toBe(
			"http://example.com/a",
		);
		expect(safeSlideLinkHref("mailto:team@example.com")).toBe(
			"mailto:team@example.com",
		);
		expect(safeSlideLinkHref("tel:+41441234567")).toBe("tel:+41441234567");
	});

	test("everything else is refused, however it is spelled", () => {
		// Casing, leading whitespace and an embedded newline are one scheme to a
		// browser and three different strings to a pattern — which is exactly why
		// the protocol is read off the parsed URL rather than matched.
		for (const target of [
			"javascript:alert(1)",
			"JAVASCRIPT:alert(1)",
			"  javascript:alert(1)",
			"java\nscript:alert(1)",
			"java\tscript:alert(1)",
			"data:text/html;base64,PHNjcmlwdD4=",
			"vbscript:msgbox",
			"file:///etc/passwd",
			"blob:https://example.com/abc",
		]) {
			expect(safeSlideLinkHref(target)).toBeNull();
		}
	});

	test("a target with no scheme is refused rather than guessed at", () => {
		for (const target of ["example.com/docs", "/join/123456", "#section", ""]) {
			expect(safeSlideLinkHref(target)).toBeNull();
		}
	});
});

describe("body blocks — hierarchy and lists (REQ089)", () => {
	test("blank lines separate paragraphs; single line breaks stay inside one", () => {
		expect(
			writeBackBlocks(parseSlideText("first line\nsecond line\n\nnew paragraph")),
		).toEqual(["first line\nsecond line", "new paragraph"]);
	});

	test("a bulleted list is a list, whichever marker it was written with", () => {
		expect(writeBackBlocks(parseSlideText("- one\n* two\n+ three"))).toEqual([
			"- one",
			"- two",
			"- three",
		]);
	});

	test("a numbered list keeps the number it starts on", () => {
		const blocks = parseSlideText("3. third\n4. fourth");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({ kind: "list", ordered: true, start: 3 });
		expect(writeBackBlocks(blocks)).toEqual(["3. third", "3. fourth"]);
	});

	test("list items carry their own markup, links included", () => {
		const blocks = parseSlideText("- **bold** item\n- [docs](https://example.com/d)");
		expect(writeBackBlocks(blocks)).toEqual([
			"- **bold** item",
			"- [docs](https://example.com/d)",
		]);
	});

	test("up to three levels of sub-heading, and a fourth hash is text", () => {
		expect(
			writeBackBlocks(parseSlideText("# one\n## two\n### three\n#### four")),
		).toEqual(["h1: one", "h2: two", "h3: three", "#### four"]);
	});

	test("a paragraph ends where a list or heading starts", () => {
		expect(writeBackBlocks(parseSlideText("intro\n- one\nafter"))).toEqual([
			"intro",
			"- one",
			"after",
		]);
	});

	test("a rule of dashes is not an empty list item", () => {
		expect(writeBackBlocks(parseSlideText("---"))).toEqual(["---"]);
	});

	test("a body of plain prose is one paragraph of exactly what was typed", () => {
		// The compatibility case: every deck authored before markdown existed.
		const written = "Welcome!\nGrab a coffee (2 CHF) & find a seat.";
		expect(parseSlideText(written)).toEqual([
			{ kind: "paragraph", content: [{ kind: "text", text: written }] },
		]);
	});

	test("empty text is no blocks at all", () => {
		expect(parseSlideText("")).toEqual([]);
		expect(parseSlideText("\n\n  \n")).toEqual([]);
	});
});

describe("slideTextToPlain — the gist a rail item shows (REQ089)", () => {
	test("markup comes off and the words stay", () => {
		expect(slideTextToPlain("**Q3** results *so far*")).toBe(
			"Q3 results so far",
		);
	});

	test("a link becomes its label, never its address", () => {
		expect(slideTextToPlain("Read [the handbook](https://example.com/h)")).toBe(
			"Read the handbook",
		);
	});

	test("blocks collapse onto one line", () => {
		expect(slideTextToPlain("# Agenda\n- one\n- two")).toBe("Agenda one two");
	});
});

describe("text size — the organizer's step (REQ091)", () => {
	test("every step in the schema has a scale and an editor option", () => {
		// A step added to the schema and to nothing else would be a size the
		// organizer cannot pick and no surface knows how to draw.
		const steps = SlideTextSizeEnum.options;
		expect(Object.keys(SLIDE_TEXT_SCALE).sort()).toEqual([...steps].sort());
		expect(SLIDE_TEXT_SIZE_OPTIONS.map((option) => option.value)).toEqual([
			...steps,
		]);
	});

	test("the steps are ordered, and medium leaves a surface untouched", () => {
		// `1em` is the identity: a deck nobody has resized renders exactly as it
		// did before this setting existed, on every surface.
		expect(SLIDE_TEXT_SCALE.medium).toBe("text-[1em]");
		const ratioOf = (token: string) =>
			Number.parseFloat(token.replace(/[^\d.]/g, ""));
		expect(ratioOf(SLIDE_TEXT_SCALE.small)).toBeLessThan(1);
		expect(ratioOf(SLIDE_TEXT_SCALE.large)).toBeGreaterThan(1);
		expect(ratioOf(SLIDE_TEXT_SCALE["x-large"])).toBeGreaterThan(
			ratioOf(SLIDE_TEXT_SCALE.large),
		);
	});

	test("the scale is relative, so a surface keeps its own base size", () => {
		// `em`, never `rem` or `px`: the same slide is a projector heading and a
		// preview-pane heading, and a fixed size would flatten the two into one.
		for (const token of Object.values(SLIDE_TEXT_SCALE)) {
			expect(token).toMatch(/^text-\[\d+(\.\d+)?em\]$/);
		}
	});
});
