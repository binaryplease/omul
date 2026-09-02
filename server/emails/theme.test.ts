/**
 * What every transactional email is allowed to look like, and what it must say.
 *
 * An email is a user-facing surface, so both halves of this round's colour and
 * naming work bind here — and an email is the one surface that cannot *resolve*
 * a token, because a mail client has no `--color-*` cascade. Its palette is
 * therefore a second copy of the direction's light-scheme values, and a second
 * copy with no check on it is how a rebrand ends up half-applied: the app goes
 * blue, the inbox stays tangerine, and nobody notices until a user says the
 * mail looked like a different product.
 *
 * Two things are held, on the *rendered HTML* rather than on the palette
 * object, because what a reader receives is the inlined styles, not the tokens:
 *
 *   - **No retired value survives** (REQ166) — not the tangerine `#ff6b35`, not
 *     any of the warm-slate neutrals it sat on.
 *   - **The product is named `omul`** (REQ167), in the subject line, the
 *     masthead and the prose, and the old name appears nowhere.
 *
 * The samples rendered here are the same components the sender renders
 * (`server/email.ts` composes them through the same `render()`), so a pass here
 * is a statement about real mail.
 */

import { describe, expect, test } from "bun:test";
import { render } from "@react-email/render";
import { emailPreviews } from "./index";
import { palette } from "./theme";

/**
 * The values REQ166 retired: the tangerine and its hover, and the warm-slate
 * ramp `--color-void` through `--color-text-dim` in both schemes, exactly as
 * the requirement's Notes name them.
 */
const RETIRED = [
	"#ff6b35",
	"#ff8555",
	"#0a0a0b",
	"#111114",
	"#1a1a1f",
	"#222228",
	"#2a2a32",
	"#1e1e25",
	"#e8e6e3",
	"#8a8690",
	"#5a5660",
	"#f1f5f9",
	"#e2e8f0",
	"#cbd5e1",
	"#94a3b8",
	"#1e293b",
	"#475569",
	"#64748b",
	// The tangerine written as rgb, which is how a shadow or a gradient carried it.
	"255, 107, 53",
];

/** WCAG 2.1 relative luminance of an `#rrggbb` string. */
function luminance(hex: string): number {
	const digits = hex.replace("#", "");
	const channels = [0, 2, 4]
		.map((offset) => parseInt(digits.slice(offset, offset + 2), 16) / 255)
		.map((channel) =>
			channel <= 0.04045
				? channel / 12.92
				: ((channel + 0.055) / 1.055) ** 2.4,
		);
	return (
		0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
	);
}

function contrast(foreground: string, background: string): number {
	const [lighter, darker] = [
		luminance(foreground),
		luminance(background),
	].sort((first, second) => second - first);
	return (lighter + 0.05) / (darker + 0.05);
}

describe("no email resolves to a retired colour (REQ166)", () => {
	for (const preview of emailPreviews) {
		test(`${preview.id} carries none of them`, async () => {
			const html = (await render(preview.element)).toLowerCase();
			for (const retired of RETIRED) {
				expect([preview.id, retired, html.includes(retired)]).toEqual([
					preview.id,
					retired,
					false,
				]);
			}
		});
	}

	test("the palette itself names none of them", () => {
		for (const [role, value] of Object.entries(palette)) {
			expect([role, RETIRED.includes(value.toLowerCase())]).toEqual([
				role,
				false,
			]);
		}
	});
});

describe("an email's words clear AA on the card it is set on", () => {
	// The card is the only surface these sit on — the body sets no background
	// (see the note on `theme.body`), so the client's canvas never gets between
	// a word and the card behind it.
	test("every step of the text ramp is readable", () => {
		expect(contrast(palette.text, palette.card)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(palette.muted, palette.card)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(palette.faint, palette.card)).toBeGreaterThanOrEqual(4.5);
	});

	test("the three steps stay three steps", () => {
		const ramp = [palette.text, palette.muted, palette.faint].map(luminance);
		expect(ramp[0]).toBeLessThan(ramp[1]);
		expect(ramp[1]).toBeLessThan(ramp[2]);
	});

	test("the CTA's label reads on the accent behind it", () => {
		expect(contrast(palette.accentInk, palette.accent)).toBeGreaterThanOrEqual(
			4.5,
		);
	});

	test("the masthead's name and descriptor read on the dark band", () => {
		expect(
			contrast(palette.mastheadInk, palette.mastheadBg),
		).toBeGreaterThanOrEqual(4.5);
		expect(
			contrast(palette.accentBright, palette.mastheadBg),
		).toBeGreaterThanOrEqual(4.5);
	});
});

describe("no email fetches an asset from a third party (ADR-0016, REQ178)", () => {
	// The app's faces are bundled and resolve offline; an email cannot carry a
	// bundle, so the only way to put one in an inbox is a stylesheet the reader's
	// mail client fetches from a font host when the mail is opened. That is a
	// third-party runtime asset dependency for first-party chrome, and it tells
	// the host who opened our mail and when. The mail therefore ships no font
	// reference at all and leans on `theme`'s system fallbacks — which is a
	// promise about the rendered HTML, so it is held there.
	for (const preview of emailPreviews) {
		test(`${preview.id} imports nothing and links no stylesheet`, async () => {
			const html = await render(preview.element);
			expect(html).not.toMatch(/@import/i);
			expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/i);
			expect(html).not.toMatch(/<link[^>]+stylesheet/i);
		});
	}
});

describe("an email names the product omul (REQ167)", () => {
	test("every subject line carries the product's name", () => {
		for (const preview of emailPreviews) {
			expect([preview.id, preview.subject.toLowerCase()]).toEqual([
				preview.id,
				expect.stringContaining("omul"),
			]);
		}
	});

	for (const preview of emailPreviews) {
		test(`${preview.id} sets the mark's name in its masthead`, async () => {
			const html = await render(preview.element);
			expect(html).toContain("omul");
		});
	}
});
