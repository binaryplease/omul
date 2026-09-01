/**
 * Unit tests for the product's own mark (REQ167).
 *
 * Three things are held here, and each is a way the mark quietly stops being
 * the mark:
 *
 *   - **The drawn file and the drawn component do not drift.** The wordmark's
 *     geometry exists twice — once as `public/brand/omul-wordmark.svg`, the
 *     supplied artwork, and once as `WORDMARK_GEOMETRY`, which is what actually
 *     reaches a screen (it has to be inline for `currentColor` to pick up
 *     `--color-mark` per scheme). Two copies with no check between them is one
 *     correction away from an app drawing last month's mark, so the check is
 *     here: the file is parsed and the constant is held to it.
 *   - **The 56px rule is a rule, not a note.** Below roughly that much wordmark
 *     width the signet takes over, and `brandMarkForm()` is the one reading of
 *     it.
 *   - **The name keeps its spaces in prose.** JSX strips a text node's trailing
 *     whitespace when it ends in a newline, so `Thanks for using\n{BRAND_NAME}`
 *     renders as "Thanks for usingomul". Every surface that sets the name into
 *     a sentence is checked for it.
 *
 * This repo renders no DOM in tests, so the last of those is asserted by
 * reading the sources — the same way `CreatePage.test.ts` asserts its markup.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BRAND_NAME,
	brandMarkForm,
	SIGNET_URL,
	WORDMARK_GEOMETRY,
	WORDMARK_MIN_WIDTH_PX,
} from "./BrandMark";

const REPO_ROOT = join(import.meta.dir, "..", "..");

function readRepoFile(relativePath: string): string {
	return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/** Every `attribute="value"` pair in a chunk of markup, as a lookup. */
function attributesOf(tag: string): Record<string, string> {
	const found: Record<string, string> = {};
	for (const [, name, value] of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
		found[name] = value;
	}
	return found;
}

describe("the drawn file and the drawn component are the same mark (REQ167)", () => {
	const source = readRepoFile("public/brand/omul-wordmark.svg");

	test("the viewBox and the stroke width are the supplied ones", () => {
		const root = attributesOf(source.slice(0, source.indexOf(">")));
		expect(root.viewBox).toBe(WORDMARK_GEOMETRY.viewBox);

		const group = attributesOf(
			source.slice(source.indexOf("<g "), source.indexOf(">", source.indexOf("<g "))),
		);
		expect(group["stroke-width"]).toBe(String(WORDMARK_GEOMETRY.strokeWidth));
		// The mark is never drawn in the accent — the file draws it in the ink, and
		// the component substitutes the per-scheme token for exactly that value.
		expect(group.stroke).toBe("#09090B");
	});

	test("the ring the o and the u share is the supplied one", () => {
		const circle = attributesOf(
			source.slice(source.indexOf("<circle"), source.indexOf("/>", source.indexOf("<circle"))),
		);
		expect(Number(circle.cx)).toBe(WORDMARK_GEOMETRY.ring.cx);
		expect(Number(circle.cy)).toBe(WORDMARK_GEOMETRY.ring.cy);
		expect(Number(circle.r)).toBe(WORDMARK_GEOMETRY.ring.r);
	});

	test("every stroke of the m, the u and the l is the supplied one", () => {
		const drawn = [...source.matchAll(/<path\s+d="([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(drawn).toEqual([...WORDMARK_GEOMETRY.paths]);
	});

	test("the signet the component points at is a file this repo ships", () => {
		expect(SIGNET_URL.startsWith("/")).toBe(true);
		const signet = readRepoFile(join("public", SIGNET_URL));
		expect(signet).toContain("<circle");
		// A tile, not a wordmark: paper ring on an ink ground, fixed in both
		// schemes, which is why this one stays a file rather than being inlined.
		expect(signet).toContain('fill="#09090B"');
		expect(signet).toContain('stroke="#FAFAFA"');
	});
});

describe("below 56px of wordmark width the signet takes over (REQ167)", () => {
	// 1584 / 646 ≈ 2.452, so the threshold lands at ~22.8px of height.
	test("a mark with room for the letters is the wordmark", () => {
		for (const heightPx of [23, 28, 32, 64]) {
			expect(brandMarkForm(heightPx)).toBe("wordmark");
		}
	});

	test("a mark without it is the signet", () => {
		for (const heightPx of [8, 16, 22]) {
			expect(brandMarkForm(heightPx)).toBe("signet");
		}
	});

	test("the switch is exactly the stated width, not a rounded guess", () => {
		const threshold = WORDMARK_MIN_WIDTH_PX / (1584 / 646);
		expect(brandMarkForm(threshold)).toBe("wordmark");
		expect(brandMarkForm(threshold - 0.001)).toBe("signet");
	});

	test("the home header asks for a height the wordmark survives", () => {
		const home = readRepoFile("src/pages/HomePage.tsx");
		const asked = home.match(/<BrandMark heightPx=\{(\d+)\}/);
		expect(asked).not.toBeNull();
		expect(brandMarkForm(Number(asked?.[1]))).toBe("wordmark");
	});
});

describe("the name keeps its spaces where it is set into a sentence", () => {
	// Every surface that interpolates the name into prose. The failure this
	// catches is silent: it type-checks, it builds, and it renders one word.
	const SURFACES = [
		"src/auth.tsx",
		"src/components/CollaboratorsDialog.tsx",
		"src/router.ts",
	];

	test("the name is one lowercase word", () => {
		expect(BRAND_NAME).toBe("omul");
		expect(BRAND_NAME).toBe(BRAND_NAME.toLowerCase());
	});

	for (const path of SURFACES) {
		test(`${path} never welds the name onto the word before it`, () => {
			const source = readRepoFile(path);
			const lines = source.split("\n");
			lines.forEach((line, index) => {
				const at = line.indexOf("{BRAND_NAME}");
				if (at < 0) return;
				const before = line.slice(0, at);
				if (before.trim().length > 0) {
					// Something precedes it on this line, so this line decides: the
					// character before the brace must not be a word character.
					// (`${BRAND_NAME}` inside a template literal ends in `$`, which is
					// how an interpolation passes without a space of its own.)
					expect([line, /[A-Za-z0-9]$/.test(before)]).toEqual([line, false]);
					return;
				}
				// Nothing but indentation precedes it, so JSX has already discarded
				// the newline above: the previous line has to end in something that
				// is not a word, or the two run together on screen.
				const previous = (lines[index - 1] ?? "").trimEnd();
				expect([previous, /[A-Za-z0-9.,;:!?]$/.test(previous)]).toEqual([
					previous,
					false,
				]);
			});
		});
	}
});
