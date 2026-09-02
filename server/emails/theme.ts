/**
 * Shared visual tokens for the transactional email templates.
 *
 * Every omul email speaks the same brand language as the app shell's "Signal"
 * design system — a light content card for readable prose, capped by a dark
 * "broadcast control room" masthead carrying the blue accent (REQ166), the
 * Figtree display face and DM Mono for the uppercase button/label chrome — so the
 * palette and the reusable style blocks live here once and are composed by every
 * template (ADR-0028: interaction/brand styling is a shared token, owned by one
 * module, never re-hand-rolled per surface). React Email renders components to
 * inline-styled, email-client-safe HTML, so the tokens are plain
 * `React.CSSProperties` objects spread onto each component's `style` prop.
 */

import type { CSSProperties } from "react";

/**
 * The brand palette — the single source of the colours used across all emails,
 * mirroring `src/index.css`'s light-mode tokens (the readable card) and the
 * dark defaults (the masthead) so an email reads as the same product as the app.
 *
 * An email is a user-facing surface, so REQ166's done-when binds here too: none
 * of these may resolve to the retired tangerine `#ff6b35` or to the warm-slate
 * neutrals. What an email cannot do is *resolve a token* — a mail client has no
 * `--color-*` cascade and no colour scheme to switch on — so this holds the
 * light-scheme values of that direction as literals and pairs them with the dark
 * Ground for the masthead. That is a second copy of two hex values by necessity,
 * which is why they are all named once here and composed everywhere else.
 */
export const palette = {
	// Light "content card" surfaces — REQ166's Ground, Card, Raised and the two
	// hairlines, light scheme (mirrors :root.light in src/index.css).
	page: "#fafafa",
	card: "#ffffff",
	raised: "#f4f4f5",
	border: "#e7e7ea",
	borderSubtle: "#efeff1",
	// Ink (--color-text), body (--color-text-muted), and a quiet step for the
	// fineprint. The quiet one is the direction's *dark* Dim rather than its
	// light one: the light Dim `#8a8a93` measures 3.42:1 on this card, and the
	// lines it carries — "if you didn't request this" — are the ones a reader
	// most needs. `#71717a` measures 4.83:1, so the ramp stays three steps deep
	// and every step clears AA.
	text: "#09090b",
	muted: "#4e4e57",
	faint: "#71717a",
	// The blue accent, light scheme, + the amber warning. The accent is rationed
	// the same way it is in the app: the CTA, the links, the eyebrow, the status
	// edge — what a reader acts on.
	accent: "#1f3bff",
	amber: "#d97706",
	// White ink on the accent CTA — REQ166's `On accent`, 6.71:1 on this accent.
	accentInk: "#ffffff",

	// ── Dark "broadcast control room" masthead (mirrors the app's default dark
	// theme: --color-void base, an accent glow, --color-text ink, and the
	// accent-as-text value that reads on the dark field at 7.63:1). The card body
	// stays light for readable prose; only the branded header carries the console
	// aesthetic.
	mastheadBg: "#09090b",
	mastheadGlow: "#101733",
	mastheadInk: "#f4f4f5",
	accentBright: "#7c9cff",
} as const;

// Figtree is the app's display/body face; DM Mono drives its uppercase button +
// label chrome. Neither is *delivered* to the inbox — see the note on the mail
// shell's `<Head>` for why an email fetches no webfont at all — so what these
// stacks really do is prefer the brand face on the rare client that already has
// it and fall through to the platform sans / mono everywhere else. The
// fallbacks are therefore the load-bearing half, not the courtesy half.
const bodyFont =
	'"Figtree",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const monoFont = '"DM Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace';

/** Font stacks, exported so templates/shell can reference them directly. */
export const fonts = { body: bodyFont, mono: monoFont } as const;

/** Reusable style blocks, composed by the shell and the individual templates. */
export const theme = {
	// ⚠️ REQUIREMENT: the email body must NOT set a `backgroundColor`.
	//
	// Many mail clients (Gmail, Outlook, various webmail) wrap the message in
	// their own padded chrome. A full-bleed page background paints that injected
	// padding as an ugly, mismatched coloured gutter around the content, and the
	// exact inset varies per client so there's no reliable way to paper over it.
	// Leaving the body transparent lets our card sit flush inside whatever inset
	// the client uses (blending into the client's own canvas), so the design must
	// stand on its own without a page colour behind it — the card below carries
	// the full brand identity so nothing is lost. Do not reintroduce a body/page
	// `backgroundColor`; if you need the page tone, apply it to the card.
	body: {
		margin: 0,
		padding: "24px 16px",
		fontFamily: bodyFont,
		color: palette.text,
	} satisfies CSSProperties,

	// Outer column that stacks the card and the footer sign-off.
	outer: {
		maxWidth: "544px",
		margin: "0 auto",
	} satisfies CSSProperties,

	// ── Brand lockup: the product's name set in the body face beside the mono,
	// wide-tracked descriptor. Deliberately *typeset* rather than the drawn
	// wordmark (REQ167) — mail clients strip inline SVG and a hosted raster would
	// be a third-party fetch from the reader's inbox, so the mark stays on the
	// surfaces that can carry it and the mail spells the name.
	brandWord: {
		margin: 0,
		fontFamily: bodyFont,
		fontSize: "20px",
		fontWeight: 700,
		letterSpacing: "-0.02em",
		color: palette.mastheadInk,
		lineHeight: 1,
		verticalAlign: "middle",
	} satisfies CSSProperties,

	brandTagline: {
		margin: 0,
		marginLeft: "12px",
		fontFamily: monoFont,
		fontSize: "10px",
		fontWeight: 500,
		letterSpacing: "0.3em",
		textTransform: "uppercase",
		color: palette.accentBright,
		verticalAlign: "middle",
	} satisfies CSSProperties,

	// The card is the whole brand artifact — a self-contained panel that reads
	// correctly on any client canvas (white, off-white, or dark) because it no
	// longer relies on a coloured page behind it. A bright-accent top hairline
	// caps the dark masthead below like a broadcast status edge; `overflow:hidden`
	// clips the masthead to the rounded corners.
	card: {
		backgroundColor: palette.card,
		border: `1px solid ${palette.border}`,
		borderTop: `3px solid ${palette.accent}`,
		borderRadius: "16px",
		overflow: "hidden",
		boxShadow: "0 8px 24px rgba(9, 9, 11, 0.12)",
	} satisfies CSSProperties,

	// The dark "broadcast control room" masthead — the app's real identity,
	// brought into the mail as a bounded brand block (NOT a body/page background,
	// so the no-body-colour rule still holds). Solid dark base for Outlook/older
	// clients; an accent glow layered on top for clients that honour
	// background-image, echoing the app's accent glow. The wordmark + tagline
	// lockup sits on it.
	cardHeader: {
		padding: "26px 32px",
		backgroundColor: palette.mastheadBg,
		backgroundImage: `radial-gradient(130% 150% at 12% -30%, ${palette.mastheadGlow} 0%, rgba(16, 23, 51, 0) 58%)`,
		borderBottom: "1px solid #050505",
	} satisfies CSSProperties,

	// The content region below the header band.
	cardBody: {
		padding: "32px",
	} satisfies CSSProperties,

	// Mono, wide-tracked category kicker above each headline — the brand's
	// "control room" label treatment doubling as an editorial eyebrow, so the
	// prose gets a clear three-tier hierarchy (kicker → headline → body).
	eyebrow: {
		margin: "0 0 10px",
		fontFamily: monoFont,
		fontSize: "11px",
		fontWeight: 600,
		letterSpacing: "0.2em",
		textTransform: "uppercase",
		color: palette.accent,
	} satisfies CSSProperties,

	heading: {
		margin: "0 0 14px",
		fontFamily: bodyFont,
		fontSize: "24px",
		fontWeight: 700,
		letterSpacing: "-0.02em",
		lineHeight: 1.2,
		color: palette.text,
	} satisfies CSSProperties,

	// Body prose: set for reading, not UI chrome — a 16px measure with generous
	// 1.75 leading over the card's ~64-character column reads as comfortable prose.
	lead: {
		margin: "0 0 28px",
		fontSize: "16px",
		lineHeight: 1.75,
		color: palette.muted,
	} satisfies CSSProperties,

	// Mirrors the app's `.btn-primary` on the dark scheme: accent fill, white ink.
	button: {
		display: "inline-block",
		backgroundColor: palette.accent,
		color: palette.accentInk,
		fontFamily: monoFont,
		fontWeight: 600,
		fontSize: "12px",
		textTransform: "uppercase",
		letterSpacing: "0.1em",
		textDecoration: "none",
		padding: "13px 22px",
		borderRadius: "10px",
	} satisfies CSSProperties,

	fineprint: {
		margin: "28px 0 8px",
		fontSize: "13px",
		lineHeight: 1.6,
		color: palette.faint,
	} satisfies CSSProperties,

	// The raw fallback URL, boxed as a raised "chip" (like the app's mono code
	// chips) so a long wrapping link reads as a deliberate element instead of
	// loose runaway text.
	linkBox: {
		margin: 0,
		padding: "12px 14px",
		backgroundColor: palette.raised,
		border: `1px solid ${palette.borderSubtle}`,
		borderRadius: "10px",
	} satisfies CSSProperties,

	pasteLink: {
		margin: 0,
		fontFamily: monoFont,
		fontSize: "13px",
		lineHeight: 1.55,
		wordBreak: "break-all",
	} satisfies CSSProperties,

	anchor: {
		color: palette.accent,
		textDecoration: "underline",
		textUnderlineOffset: "2px",
	} satisfies CSSProperties,

	// A hairline divider + the reassuring footer note inside the card.
	footer: {
		margin: "26px 0 0",
		paddingTop: "20px",
		borderTop: `1px solid ${palette.borderSubtle}`,
		fontSize: "13px",
		lineHeight: 1.6,
		color: palette.faint,
	} satisfies CSSProperties,

	// The brand sign-off below the card, on the page.
	signoff: {
		margin: "18px 0 0",
		padding: "0 4px",
		fontFamily: monoFont,
		fontSize: "11px",
		letterSpacing: "0.08em",
		textTransform: "uppercase",
		color: palette.faint,
	} satisfies CSSProperties,
} as const;
