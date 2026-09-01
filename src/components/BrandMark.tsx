// ── The product's own mark (REQ167) ───────────────────────────
//
// The drawn `omul` wordmark and its closed-ring signet, on the surfaces that
// identify the product to a visitor. The mark files are drawn and final and
// live under `public/brand/`; nothing here redraws them.
//
// Three things this module owns, and nothing else does:
//
//   - `BRAND_NAME` — the product's name, spelled once. Every surface that says
//     it in words says it from here, so a rename is one edit rather than a
//     grep that misses one sentence.
//   - `brandMarkForm()` — *which* of the two forms a given size gets. Below
//     roughly 56px of wordmark width the closed ring takes over, and the
//     closed ring is also the icon, tile and avatar form. Stated as a function
//     of the height a caller asks for, so the rule is executable rather than a
//     note somebody has to remember (ADR-0026).
//   - `<BrandMark/>` — the one rendering, which asks that function.
//
// The wordmark is drawn in the ink on light and in the paper on dark — its
// inverse form, which is the pair the specimen supplies. It gets there through
// `--color-mark`, the token `index.css` resolves per scheme beside Ground and
// Text, so the mark and the chrome hold those two values once between them
// rather than each holding a copy. It is **never** drawn in the accent: the
// accent belongs to the interface, and marks what is interactive, active or
// measured there (REQ166).
//
// The signet is a fixed tile — paper ring on an ink ground, the same in both
// schemes — so it is the supplied file, referenced. That one file is also what
// the browser tab and the home-screen tile are pointed at from `index.html`;
// there is one drawing of the ring in this repository and this is how every
// surface reaches it.
//
// ── Licensing: trademark rights in the mark are reserved ──────
//
// `WORDMARK_GEOMETRY` below *is* the wordmark, transcribed stroke for stroke,
// and the files under `public/brand/` are the drawn originals. Both are named
// in `TRADEMARK.md` at the root, which reserves the trademark rights in them
// under AGPL-3.0 §7(e). That is a reservation, not a carve-out: this file and
// those files stay under the code license, so redistributing them with the
// source is fine. What is not granted is using the mark to identify a build —
// so if you fork this and change it, change the mark: replace the directory and
// the constant, both of which exist in one place each so that it is a small
// edit.

/** The product's name, as it is written: lowercase, one word. */
export const BRAND_NAME = "omul";

/** Where the drawn mark lives, served as-is. */
export const SIGNET_URL = "/brand/omul-icon-ring.svg";

/**
 * The wordmark's strokes, exactly as `public/brand/omul-wordmark.svg` draws
 * them: stroke 88, x-height 360, ascender 560; the `o` and the `u` are the same
 * ring of radius 142 about y=420, the `u` being its lower half cut open.
 *
 * Named as data rather than left loose in the JSX below so that
 * `BrandMark.test.ts` can hold it against the drawn file element for element —
 * see the note on {@link Wordmark} for why this copy exists at all.
 */
export const WORDMARK_GEOMETRY = {
	viewBox: "-40 0 1584 646",
	strokeWidth: 88,
	ring: { cx: 186, cy: 420, r: 142 },
	paths: [
		"M 456 600 L 456 386 A 108 108 0 0 1 672 386 L 672 600",
		"M 672 386 A 108 108 0 0 1 888 386 L 888 600",
		"M 1032 240 L 1032 420 A 142 142 0 0 0 1316 420 L 1316 240",
		"M 1460 40 L 1460 600",
	],
} as const;

/**
 * The wordmark's drawn proportions — 1584 × 646 in the mark's own units,
 * clearance included.
 */
const WORDMARK_ASPECT_RATIO = 1584 / 646;

/**
 * The narrowest the wordmark is set (REQ167). Under it the letters stop being
 * letters and the signet stands in.
 */
export const WORDMARK_MIN_WIDTH_PX = 56;

/** Which form a mark of this height is drawn in. */
export function brandMarkForm(heightPx: number): "wordmark" | "signet" {
	return heightPx * WORDMARK_ASPECT_RATIO >= WORDMARK_MIN_WIDTH_PX
		? "wordmark"
		: "signet";
}

/**
 * The wordmark, drawn from {@link WORDMARK_GEOMETRY}. Only the colour is the
 * app's: `currentColor`, resolved from `--color-mark`, which is what an `<img>`
 * at a static URL could not do and what the requirement's "one copy of ink and
 * paper between mark and chrome" needs.
 *
 * **This is the application's authoritative wordmark.** The two wordmark SVGs
 * under `public/brand/` are the drawn originals, kept because they are the
 * supplied artwork and what anything outside this app is handed — but nothing
 * in `src/` references them, so a correction made there does not reach a
 * screen. Redraw the mark and it has to be re-copied into the constant above,
 * and `BrandMark.test.ts` fails until it is: it reads the original off disk and
 * holds the constant to it, element for element.
 */
function Wordmark({
	heightPx,
	className,
}: {
	heightPx: number;
	className: string;
}) {
	return (
		<svg
			viewBox={WORDMARK_GEOMETRY.viewBox}
			height={heightPx}
			width={heightPx * WORDMARK_ASPECT_RATIO}
			role="img"
			aria-label={BRAND_NAME}
			className={`text-mark ${className}`}
		>
			<title>{BRAND_NAME}</title>
			<g
				fill="none"
				stroke="currentColor"
				strokeWidth={WORDMARK_GEOMETRY.strokeWidth}
				strokeLinecap="butt"
			>
				<circle
					cx={WORDMARK_GEOMETRY.ring.cx}
					cy={WORDMARK_GEOMETRY.ring.cy}
					r={WORDMARK_GEOMETRY.ring.r}
				/>
				{WORDMARK_GEOMETRY.paths.map((stroke) => (
					<path key={stroke} d={stroke} />
				))}
			</g>
		</svg>
	);
}

/**
 * The mark, at the height a surface has for it. Which of the two forms that
 * height gets is `brandMarkForm()`'s to say — a caller states how much room it
 * has, never which drawing it wants, or two surfaces would eventually disagree
 * about where the wordmark stops being legible.
 */
export function BrandMark({
	heightPx,
	className = "",
}: {
	heightPx: number;
	className?: string;
}) {
	if (brandMarkForm(heightPx) === "signet") {
		return (
			<img
				src={SIGNET_URL}
				alt={BRAND_NAME}
				width={heightPx}
				height={heightPx}
				className={className}
			/>
		);
	}
	return <Wordmark heightPx={heightPx} className={className} />;
}
