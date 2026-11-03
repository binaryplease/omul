/**
 * Unit tests for typeset formulas (REQ093).
 *
 * `SlideText.test.ts` pins down where a formula is found; this file pins down
 * what KaTeX is allowed to make of one. The component itself hands a formula to
 * KaTeX's `render()`, which builds DOM nodes and needs a browser — so what is
 * asserted here is the same call with the same options through
 * `renderToString()`, KaTeX's other entry point onto the same tree. The string
 * is read and thrown away; nothing in the app ever builds one.
 *
 * Four things are worth the assertions:
 *
 *   - **Nothing reaches past the formula.** Every command KaTeX gates behind
 *     `trust` is refused under these options — no link, no picture, no class,
 *     id, style or data attribute the author chose — and the refusal carries
 *     the mark the component reads to show the formula as typed instead.
 *   - **What an author cannot do with TeX alone.** Spell that mark as a colour,
 *     leak a macro from one formula into the next, expand forever, or size a box
 *     over the rest of the screen — upward, downward or sideways, a size built
 *     by a macro and a stretched array included (`slideMathWithinBounds`).
 *   - **Malformed TeX throws**, which is what turns it back into its source.
 *   - **What React itself draws:** the source as escaped text until KaTeX has
 *     arrived, and an empty element afterwards — the formula is KaTeX's to fill.
 */

import { describe, expect, test } from "bun:test";
import katex from "katex";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	loadSlideMath,
	SLIDE_MATH_MAX_ARRAY_STRETCH,
	SLIDE_MATH_OPTIONS,
	SLIDE_MATH_REFUSED_MARK,
	SlideMath,
	slideMathWithinBounds,
} from "./SlideMath";
import { SlideText } from "./SlideText";

/** One formula, typeset exactly as `<SlideMath/>` typesets it. */
function typeset(tex: string, display = false): string {
	return katex.renderToString(tex, {
		...SLIDE_MATH_OPTIONS,
		displayMode: display,
	});
}

/** The half of the output a reader sees — the MathML half is for a screen reader. */
function visibleHalf(markup: string): string {
	const start = markup.indexOf('class="katex-html"');
	expect(start).toBeGreaterThan(-1);
	return markup.slice(start);
}

/**
 * Markup a formula must never carry, whoever wrote the TeX. Elements and
 * attributes only: the TeX source itself rides along as the text of the MathML
 * annotation, so `javascript:` as *text* there is the formula being described,
 * not a destination.
 */
const AUTHORED_REACH = [
	/<a[\s>]/,
	/\shref=/,
	/<img[\s>]/,
	/\ssrc=/,
	/\sid=/,
	/\sdata-[\w-]*=/,
	/\son[a-z]+=/,
	/="[^"]*javascript:/i,
	/class="[^"]*\bevil\b/,
];

function expectNoAuthoredReach(markup: string): void {
	for (const pattern of AUTHORED_REACH) {
		expect(markup).not.toMatch(pattern);
	}
}

describe("before KaTeX has arrived, a formula is its source", () => {
	// First in the file on purpose: KaTeX is loaded once per process, and every
	// test after `loadSlideMath()` below sees it loaded.
	test("as escaped text, never as markup", () => {
		expect(
			renderToStaticMarkup(
				createElement(SlideMath, {
					tex: "<b>x</b>",
					display: false,
					source: "$<b>x</b>$",
				}),
			),
		).toBe('<span class="[overflow-wrap:anywhere]">$&lt;b&gt;x&lt;/b&gt;$</span>');
	});

	test("the words around it are drawn as they always were", () => {
		const markup = renderToStaticMarkup(
			createElement(SlideText, {
				text: "Solve **$x^2 = 4$** now",
				size: "medium",
				variant: "inline",
			}),
		);
		expect(markup).toContain("Solve <strong>");
		expect(markup).toContain(">$x^2 = 4$</span></strong> now");
	});
});

describe("the options switch off every command that reaches past the formula", () => {
	test("trust is off, and not a hook", () => {
		expect(SLIDE_MATH_OPTIONS.trust).toBe(false);
		expect(SLIDE_MATH_OPTIONS.throwOnError).toBe(true);
		expect(SLIDE_MATH_OPTIONS.errorColor).toBe(SLIDE_MATH_REFUSED_MARK);
	});

	for (const written of [
		"\\href{https://example.com}{the link}",
		"\\href{javascript:alert(1)}{click}",
		"\\url{https://example.com}",
		"\\includegraphics[height=1em]{https://example.com/x.png}",
		"\\htmlClass{evil}{x}",
		"\\htmlId{evil}{x}",
		"\\htmlStyle{color:red}{x}",
		"\\htmlData{foo=bar}{x}",
	]) {
		test(`${written} is refused, and marked as refused`, () => {
			const markup = typeset(written);
			// The mark is what <SlideMath/> looks for before showing the
			// formula as typed rather than as a bare command name.
			expect(visibleHalf(markup)).toContain(SLIDE_MATH_REFUSED_MARK);
			expectNoAuthoredReach(markup);
			expect(markup).not.toMatch(/style="[^"]*color:\s*red/);
		});
	}
});

describe("a formula KaTeX can typeset is only a formula", () => {
	const corpus = [
		"\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
		"\\int_0^1 x^2\\,dx",
		"\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
		"\\lim_{x \\to \\infty} \\left(1 + \\frac{1}{x}\\right)^{x} = e",
		"\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
		"f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}",
		"\\sqrt[3]{x} + \\binom{n}{k} + \\mathbb{R} + \\vec{v} + \\hat{x}",
		"\\overbrace{a+b}^{n} \\underbrace{c+d}_{m} \\xrightarrow{f} \\cancel{x}",
		"\\boxed{E = mc^2} \\operatorname{sgn}(x) \\pmod{7}",
		"\\color{red}{x} + \\textcolor{#c0ffee}{y}",
		"\\text{if } x \\geq 0",
		"\\$5 + 5\\%",
	];

	for (const tex of corpus) {
		test(tex, () => {
			for (const display of [false, true]) {
				const markup = typeset(tex, display);
				expect(markup).toContain('class="katex"');
				expect(markup).toContain('<annotation encoding="application/x-tex">');
				expect(markup).not.toContain(SLIDE_MATH_REFUSED_MARK);
				expectNoAuthoredReach(markup);
			}
		});
	}

	test("display mode is a block of its own", () => {
		expect(typeset("x", true)).toContain('class="katex-display"');
		expect(typeset("x", false)).not.toContain("katex-display");
	});

	test("text inside a formula stays text", () => {
		const markup = typeset("\\text{<script>alert(1)</script>}");
		expect(markup).not.toContain("<script");
		expect(markup).toContain("&lt;script&gt;");
	});
});

describe("what TeX alone cannot do here", () => {
	test("spell the refusal mark as a colour of its own", () => {
		// KaTeX accepts only hex digits and letters as a colour, so a formula
		// that tried to pass itself off as refused — or a refusal as typeset —
		// never typesets at all.
		expect(() => typeset(`\\color{${SLIDE_MATH_REFUSED_MARK}}{x}`)).toThrow();
	});

	test("leak a macro from one formula into the next", () => {
		// No macro table is passed in, so KaTeX makes a fresh one per formula: a
		// `\gdef` on one slide is gone by the next formula, on any slide.
		expect(() => typeset("\\gdef\\leak{1}\\leak")).not.toThrow();
		expect(() => typeset("\\leak")).toThrow();
		typeset("\\gdef\\frac#1#2{oops}");
		expect(typeset("\\frac{1}{2}")).toContain("mfrac");
	});

	test("expand without end", () => {
		expect(() => typeset("\\def\\a{\\a\\a}\\a")).toThrow();
	});

	test("size a box over the rest of the screen", () => {
		const rule = visibleHalf(typeset("\\rule{100em}{100em}"));
		expect(rule).toContain(`${SLIDE_MATH_OPTIONS.maxSize}em`);
		expect(rule).not.toContain("100em");
		expect(visibleHalf(typeset("a\\hspace{100em}b"))).not.toContain("100em");
	});

	test("push the rest of the screen away with a negative size", () => {
		// KaTeX clamps sizes from above only, so each of these typesets as a box
		// thousands of ems deep or wide — the controls under a heading pushed out
		// of every phone's reach. The bound check refuses them before anything is
		// drawn, a size built by a macro included.
		for (const tex of [
			"\\raisebox{-99999em}{x}",
			"\\rule[-1000em]{10em}{10em}",
			"\\rule{1em}{-10000em}",
			"a\\kern{-5000em}b",
			"a\\hspace{-5000em}b",
			"a\\mkern{-90000mu}b",
			"\\raisebox{-99999pt}{x}",
			"\\begin{aligned}a\\\\[-9999em]b\\end{aligned}",
			"\\genfrac{(}{)}{-999em}{}{a}{b}",
			"\\def\\d{-99999}\\raisebox{\\d em}{x}",
			`\\raisebox{-${SLIDE_MATH_OPTIONS.maxSize + 1}em}{x}`,
		]) {
			expect([tex, slideMathWithinBounds(katex, tex, false)]).toEqual([
				tex,
				false,
			]);
		}
	});

	test("stretch an array's rows down the length of the screen", () => {
		const stretched = (stretch: number) =>
			`\\def\\arraystretch{${stretch}}\\begin{matrix}a\\\\b\\end{matrix}`;
		expect(slideMathWithinBounds(katex, stretched(9999), true)).toBe(false);
		expect(
			slideMathWithinBounds(katex, stretched(SLIDE_MATH_MAX_ARRAY_STRETCH + 1), true),
		).toBe(false);
		expect(
			slideMathWithinBounds(katex, stretched(SLIDE_MATH_MAX_ARRAY_STRETCH), true),
		).toBe(true);
	});

	test("while ordinary negative space, a size at the cap and a tall formula still typeset", () => {
		const twelveRows = `\\begin{pmatrix}${Array.from(
			{ length: 12 },
			(_, row) => `a_{${row}1} & a_{${row}2}`,
		).join("\\\\")}\\end{pmatrix}`;
		for (const tex of [
			"x",
			"\\frac{a}{b}",
			"\\sqrt{x^2+1}",
			"a\\!b",
			"a\\negthickspace b",
			"a\\kern-0.5em b",
			`\\raisebox{-${SLIDE_MATH_OPTIONS.maxSize}em}{x}`,
			"\\begin{aligned}a\\\\[-1em]b\\end{aligned}",
			// A positive size past the cap is KaTeX's to clamp, as above.
			"\\rule{100em}{100em}",
			twelveRows,
		]) {
			expect([tex, slideMathWithinBounds(katex, tex, true)]).toEqual([tex, true]);
		}
	});

	test("refuse what does not parse, as the typesetter would", () => {
		expect(slideMathWithinBounds(katex, "\\frac{1}{", false)).toBe(false);
	});
});

describe("malformed TeX throws, and is shown as typed", () => {
	for (const tex of [
		"\\frac{1}{",
		"x^",
		"x_{",
		"\\notacommand",
		"\\begin{matrix} a",
		"}",
		"{",
	]) {
		test(JSON.stringify(tex), () => {
			expect(() => typeset(tex)).toThrow();
		});
	}
});

describe("once KaTeX has arrived", () => {
	test("it is fetched once and shared", async () => {
		const first = await loadSlideMath();
		const second = await loadSlideMath();
		expect(second).toBe(first);
		expect(typeof first.render).toBe("function");
	});

	test("React draws an empty element for KaTeX to fill, and nothing else", () => {
		// The formula is built by KaTeX's own DOM calls inside a layout effect,
		// which a static render does not run — so what is left is exactly what
		// React contributes: no string of markup, and no text of its own.
		expect(
			renderToStaticMarkup(
				createElement(SlideMath, {
					tex: "x",
					display: false,
					source: "$x$",
				}),
			),
		).toBe("<span></span>");
		expect(
			renderToStaticMarkup(
				createElement(SlideMath, {
					tex: "x",
					display: true,
					source: "$$x$$",
				}),
			),
		).toBe(
			'<span class="grid grid-cols-[minmax(0,1fr)]"><span class="overflow-x-auto overflow-y-hidden"></span></span>',
		);
	});

	test("an inline formula and a display formula are never the same element to React", () => {
		// The same instance turns from inline to display when the slide under it
		// changes. React keeps an element whose type and key are unchanged, and
		// KaTeX's nodes inside it are not React's to remove — so a kept inline
		// host became the display frame with the previous slide's formula still
		// in it, until a reload. What each mode returns is caught here as an
		// element, because a static render shows the markup but not the identity
		// React reconciles by.
		const drawn = (display: boolean) => {
			let element: ReactElement | null = null;
			const Probe = () => {
				element = SlideMath({ tex: "x", display, source: "$x$" });
				return element;
			};
			renderToStaticMarkup(createElement(Probe));
			if (element === null) throw new Error("SlideMath drew nothing");
			return element as ReactElement;
		};
		const inline = drawn(false);
		const display = drawn(true);
		expect(inline.type).toBe(display.type);
		expect(inline.key).not.toBe(display.key);
	});
});
