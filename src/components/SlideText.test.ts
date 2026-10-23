/**
 * Unit tests for authored slide text (REQ088 hyperlinks, REQ089 markdown,
 * REQ091 text size, REQ093 mathematical notation, REQ133 passage language).
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
 *     must render character for character as it did, line breaks included —
 *     and one written before formulas existed must too, prices and all.
 *
 * What KaTeX makes of a formula once it is found is `SlideMath.test.ts`'s.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { plainTextFromMarkdown } from "../../server/deck-pdf";
import { SlideTextSizeEnum } from "../../server/schemas";
import {
	isSlideLanguageTag,
	parseSlideInline,
	parseSlideText,
	safeSlideLinkHref,
	SLIDE_MARKDOWN_HINT,
	SLIDE_TEXT_SCALE,
	SLIDE_TEXT_SIZE_OPTIONS,
	SlideText,
	type SlideInlineNode,
	type SlideTextBlock,
	slideInlineHasMath,
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
				case "language":
					return `[${writeBack(node.children)}]{lang=${node.lang}}`;
				case "math":
					return node.display ? `$$${node.tex}$$` : `$${node.tex}$`;
			}
		})
		.join("");
}

/** The same, for a whole body: one line per block, list items prefixed. */
function writeBackBlocks(blocks: SlideTextBlock[]): string[] {
	return blocks.flatMap((block) => {
		if (block.kind === "math") return [`math: ${block.tex}`];
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
		if (
			node.kind === "strong" ||
			node.kind === "emphasis" ||
			node.kind === "language"
		) {
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

describe("formulas — TeX between dollar signs (REQ093)", () => {
	test("an inline formula is read out of the text, as typed and as TeX", () => {
		expect(parseSlideInline("What is $\\frac{1}{2}$?")).toEqual([
			{ kind: "text", text: "What is " },
			{
				kind: "math",
				tex: "\\frac{1}{2}",
				display: false,
				source: "$\\frac{1}{2}$",
			},
			{ kind: "text", text: "?" },
		]);
	});

	test("a display formula may pad itself with spaces", () => {
		expect(parseSlideInline("$$ E = mc^2 $$")).toEqual([
			{
				kind: "math",
				tex: "E = mc^2",
				display: true,
				source: "$$ E = mc^2 $$",
			},
		]);
		expect(writeBack(parseSlideInline("$$a$$ and $$ b $$"))).toBe(
			"$$a$$ and $$b$$",
		);
	});

	test("prose with prices in it stays exactly the prose it was", () => {
		// Pandoc's rules: a formula opens onto a non-space, closes after one, and
		// is not followed by a digit. Every deck written before formulas existed
		// renders as it did, dollar signs included.
		for (const written of [
			"Tickets cost $5 and $10.",
			"$5-$10 a ticket",
			"It costs 5$ or 6$.",
			"Set $PATH and $HOME first",
			"$x$5",
			"price $ 5 $",
			"$",
			"Only $",
			"$$5",
			"$$$$",
			"$$ $$",
		]) {
			expect(parseSlideInline(written)).toEqual([
				{ kind: "text", text: written },
			]);
		}
	});

	test("an inline formula does not cross a line; a display one may", () => {
		expect(parseSlideInline("a $x\ny$ b")).toEqual([
			{ kind: "text", text: "a $x\ny$ b" },
		]);
		expect(writeBack(parseSlideInline("$$x\n+ y$$"))).toBe("$$x\n+ y$$");
	});

	test("\\$ writes a dollar sign, beside a formula or anywhere else", () => {
		expect(writeBack(parseSlideInline("\\$5 and $x$"))).toBe("$5 and $x$");
		expect(parseSlideInline("\\$5 or \\$10")).toEqual([
			{ kind: "text", text: "$5 or $10" },
		]);
	});

	test("inside a formula a backslash belongs to TeX", () => {
		// `\$` is a dollar sign in the formula rather than its end, and `\\` is
		// TeX's line break — not an escape this parser gets to take.
		expect(parseSlideInline("$\\$5$")).toEqual([
			{ kind: "math", tex: "\\$5", display: false, source: "$\\$5$" },
		]);
		expect(writeBack(parseSlideInline("$a\\\\$ b"))).toBe("$a\\\\$ b");
		expect(writeBack(parseSlideInline("$\\{x\\}$"))).toBe("$\\{x\\}$");
	});

	test("code wins, and an address keeps its dollar signs", () => {
		expect(parseSlideInline("`$HOME` and `$x$`")).toEqual([
			{ kind: "code", text: "$HOME" },
			{ kind: "text", text: " and " },
			{ kind: "code", text: "$x$" },
		]);
		expect(linksIn(parseSlideInline("https://example.com/$x$"))).toEqual([
			["https://example.com/$x$", "https://example.com/$x$"],
		]);
	});

	test("emphasis steps over a formula rather than ending inside it", () => {
		// `_` and `*` are TeX's subscript and asterisk as often as they are
		// emphasis markers.
		expect(writeBack(parseSlideInline("_the root $x_1$ is real_"))).toBe(
			"*the root $x_1$ is real*",
		);
		expect(writeBack(parseSlideInline("**bold $a**b$ end**"))).toBe(
			"**bold $a**b$ end**",
		);
		// An escaped dollar opens nothing, so it cannot carry a run past its end.
		expect(writeBack(parseSlideInline("*a \\$x* b$*"))).toBe("*a $x* b$*");
	});

	test("emphasis without a dollar sign closes exactly where it always did", () => {
		expect(parseSlideInline("*a \\* b*")).toEqual([
			{ kind: "emphasis", children: [{ kind: "text", text: "a \\" }] },
			{ kind: "text", text: " b*" },
		]);
		expect(parseSlideInline("***x***")).toEqual([
			{ kind: "strong", children: [{ kind: "text", text: "*x" }] },
			{ kind: "text", text: "*" },
		]);
		expect(parseSlideInline("__a__b__")).toEqual([
			{ kind: "strong", children: [{ kind: "text", text: "a" }] },
			{ kind: "text", text: "b__" },
		]);
	});

	test("a formula may sit in a link's label and in a list item", () => {
		expect(
			writeBack(parseSlideInline("[the $x$ link](https://example.com)")),
		).toBe("[the $x$ link](https://example.com/)");
		expect(writeBackBlocks(parseSlideText("- $a^2$\n- $b^2$"))).toEqual([
			"- $a^2$",
			"- $b^2$",
		]);
	});
});

describe("a display formula on lines of its own (REQ093)", () => {
	test("its lines are TeX — not list items, not headings", () => {
		const written = "$$\nx = 1\n+ 2\n- 3\n# 4\n$$";
		expect(parseSlideText(written)).toEqual([
			{ kind: "math", tex: "x = 1\n+ 2\n- 3\n# 4", source: written },
		]);
	});

	test("a paragraph ends where a formula block starts", () => {
		expect(
			writeBackBlocks(parseSlideText("Solve:\n$$\nx^2\n$$\nand then")),
		).toEqual(["Solve:", "math: x^2", "and then"]);
	});

	test("it keeps the lines it was typed on, indentation and all", () => {
		expect(parseSlideText("  $$\\int_0^1 x\\,dx$$   ")).toEqual([
			{
				kind: "math",
				tex: "\\int_0^1 x\\,dx",
				source: "  $$\\int_0^1 x\\,dx$$   ",
			},
		]);
	});

	test("words after the closing $$ keep the formula in its paragraph", () => {
		expect(parseSlideText("$$a$$ trailing")).toEqual([
			{
				kind: "paragraph",
				content: [
					{ kind: "math", tex: "a", display: true, source: "$$a$$" },
					{ kind: "text", text: " trailing" },
				],
			},
		]);
	});

	test("it may not cross a blank line, and is then just text", () => {
		expect(writeBackBlocks(parseSlideText("$$\nx\n\ny\n$$"))).toEqual([
			"$$\nx",
			"y\n$$",
		]);
	});

	test("CRLF line endings read the same as LF", () => {
		expect(writeBackBlocks(parseSlideText("Solve:\r\n$$\r\nx^2\r\n$$"))).toEqual(
			["Solve:", "math: x^2"],
		);
	});

	test("adversarial dollar signs at the field's length still parse in a blink", () => {
		// The field holds 5000 characters (SLIDE_TEXT_MAX_LENGTH); every pattern
		// here is a run of openers that close late or never, the shape that would
		// make a careless scanner quadratic.
		const fill = (unit: string) => unit.repeat(5000 / unit.length);
		const started = performance.now();
		for (const written of [
			fill("$a"),
			fill("$$a"),
			fill("$$\nx\n"),
			`*${fill("$a\\$b")}`,
			`_${fill("$x_1 ")}`,
		]) {
			parseSlideInline(written);
			parseSlideText(written);
		}
		expect(performance.now() - started).toBeLessThan(500);
	});
});

describe("formulas reduced to a gist, and named for the canvas (REQ093)", () => {
	test("a gist keeps a formula's TeX and drops its dollar signs", () => {
		expect(slideTextToPlain("What is $\\frac{1}{2}$?")).toBe(
			"What is \\frac{1}{2}?",
		);
		expect(slideTextToPlain("Intro\n$$\nx^2\n$$")).toBe("Intro x^2");
	});

	test("slideInlineHasMath finds a formula wherever it sits in a heading", () => {
		for (const heading of [
			"$x$",
			"What is $$x$$?",
			"**bold $x$**",
			"*$x$*",
			"[the $x$](https://example.com)",
		]) {
			expect(slideInlineHasMath(heading)).toBe(true);
		}
		for (const heading of ["plain", "$5 and $10", "`$x$`", "\\$x\\$", ""]) {
			expect(slideInlineHasMath(heading)).toBe(false);
		}
	});

	test("the editor's hint names the notation the parser reads", () => {
		// The hint is the promise; these are the three things it promises.
		expect(SLIDE_MARKDOWN_HINT).toContain("$x^2$");
		expect(SLIDE_MARKDOWN_HINT).toContain("$$x^2$$");
		expect(SLIDE_MARKDOWN_HINT).toContain("\\$");
		expect(writeBack(parseSlideInline("$x^2$"))).toBe("$x^2$");
		expect(parseSlideText("$$x^2$$")[0]?.kind).toBe("math");
	});
});

describe("a passage in another language (REQ133)", () => {
	/** The tag's shape alone, without the length bound. */
	const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

	/** A heading as the room's screen draws it. */
	const markupOf = (text: string, variant: "inline" | "blocks" = "inline") =>
		renderToStaticMarkup(
			createElement(SlideText, { text, size: "medium", variant }),
		);

	test("a span renders its passage inside an element carrying the tag", () => {
		expect(parseSlideInline("She said [bonjour]{lang=fr} twice")).toEqual([
			{ kind: "text", text: "She said " },
			{
				kind: "language",
				lang: "fr",
				children: [{ kind: "text", text: "bonjour" }],
			},
			{ kind: "text", text: " twice" },
		]);
		expect(markupOf("She said [bonjour]{lang=fr} twice")).toContain(
			'She said <span lang="fr">bonjour</span> twice',
		);
		expect(markupOf("- [Grüezi]{lang=de-CH}", "blocks")).toContain(
			'<li><span lang="de-CH">Grüezi</span></li>',
		);
	});

	test("only lang reaches the element — no class, no style, no dir", () => {
		const markup = markupOf("[bonjour]{lang=fr}");
		expect(markup).toMatch(/<span lang="fr">bonjour<\/span>/);
		expect(markup).not.toContain("{");
	});

	test("markup inside the passage renders as it does anywhere else", () => {
		expect(
			writeBack(
				parseSlideInline(
					"[**très** *bien* `code` [la doc](https://example.com/fr)]{lang=fr}",
				),
			),
		).toBe(
			"[**très** *bien* `code` [la doc](https://example.com/fr)]{lang=fr}",
		);
		expect(
			linksIn(parseSlideInline("[voir [la doc](https://example.com)]{lang=fr}")),
		).toEqual([["la doc", "https://example.com/"]]);
		expect(slideInlineHasMath("[la racine $x_1$]{lang=fr}")).toBe(true);
		// A bracket inside code or a formula does not close the passage.
		expect(writeBack(parseSlideInline("[`a]` et $[0,1)$]{lang=fr}"))).toBe(
			"[`a]` et $[0,1)$]{lang=fr}",
		);
		// Spans nest, as a quotation inside a quotation does.
		expect(writeBack(parseSlideInline("[il dit [ja]{lang=de}]{lang=fr}"))).toBe(
			"[il dit [ja]{lang=de}]{lang=fr}",
		);
	});

	test("a tag that is not shaped like one leaves the span as typed", () => {
		for (const written of [
			"[bonjour]{lang=1}",
			"[bonjour]{lang=english}",
			"[bonjour]{lang=fr_FR}",
			'[bonjour]{lang="fr"}',
			"[bonjour]{lang=}",
			"[bonjour]{lang=fr-}",
			`[bonjour]{lang=fr-${"a".repeat(40)}}`,
			'[bonjour]{lang=fr" onclick="x}',
		]) {
			expect(parseSlideInline(written)).toEqual([
				{ kind: "text", text: written },
			]);
			expect(markupOf(written)).not.toContain("<span lang");
		}
	});

	test("anything but lang= in the braces leaves the span as typed", () => {
		for (const written of [
			"[**bonjour**]{dir=rtl}",
			"[bonjour]{lang=fr dir=rtl}",
			"[bonjour]{.fr}",
			"[bonjour]{ lang=fr}",
			"[bonjour]{class=x}",
			"[bonjour]{}",
		]) {
			// Nothing half-applied: not even the bold inside it.
			expect(parseSlideInline(written)).toEqual([
				{ kind: "text", text: written },
			]);
		}
	});

	test("what was never a span reads exactly as it did", () => {
		expect(parseSlideInline("[bonjour] {lang=fr}")).toEqual([
			{ kind: "text", text: "[bonjour] {lang=fr}" },
		]);
		expect(parseSlideInline("[bonjour]\\{lang=fr}")).toEqual([
			{ kind: "text", text: "[bonjour]{lang=fr}" },
		]);
		expect(parseSlideInline("[ ]{lang=fr}")).toEqual([
			{ kind: "text", text: "[ ]{lang=fr}" },
		]);
		expect(linksIn(parseSlideInline("[a [b](https://example.com)"))).toEqual([
			["a [b", "https://example.com/"],
		]);
	});

	test("a gist keeps the passage's words", () => {
		expect(slideTextToPlain("Say [**merci**]{lang=fr}.")).toBe("Say merci.");
	});

	test("the editor's hint names the syntax the parser reads", () => {
		const written = /\[like this\]\{lang=fr\}/.exec(SLIDE_MARKDOWN_HINT);
		expect(written).not.toBeNull();
		expect(parseSlideInline(written?.[0] ?? "")[0]?.kind).toBe("language");
	});

	test("the tag rule is BCP 47's shape, and the PDF holds the same one", () => {
		const accepted = ["fr", "de-CH", "zh-Hant-TW", "sr-Latn", "es-419", "haw"];
		const refused = ["f", "fren", "1", "fr_FR", "fr-", "-fr", "fr--CH", ""];
		for (const tag of accepted) expect(isSlideLanguageTag(tag)).toBe(true);
		for (const tag of refused) expect(isSlideLanguageTag(tag)).toBe(false);
		// Well shaped, and past the 35 characters BCP 47 asks a reader to hold.
		const tooLong = `en-${"a1b2c3d4-".repeat(4)}x`;
		expect(LANGUAGE_TAG_SHAPE.test(tooLong)).toBe(true);
		expect(isSlideLanguageTag(tooLong)).toBe(false);

		// The server restates the rule; a tag the slide marks is a tag the PDF
		// unmarks, and a tag the slide shows as typed the PDF shows as typed.
		for (const tag of [...accepted, ...refused, tooLong]) {
			const written = `[merci]{lang=${tag}}`;
			expect(plainTextFromMarkdown(written)).toBe(
				isSlideLanguageTag(tag) ? "merci" : written,
			);
		}
	});

	test("adversarial brackets at the field's length still parse in a blink", () => {
		const fill = (unit: string) => unit.repeat(5000 / unit.length);
		const started = performance.now();
		for (const written of [
			fill("["),
			fill("[a"),
			fill("[$a"),
			fill("[`a"),
			fill("[a]{lang=fr}"),
			`${fill("[")}a${fill("]{lang=fr}")}`,
		]) {
			parseSlideInline(written);
			parseSlideText(written);
		}
		expect(performance.now() - started).toBeLessThan(500);
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
