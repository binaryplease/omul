import type { Slide } from "../types";
import { slideAppearanceFor } from "../types";

// ── What is behind a slide ───────────────────────────────────
//
// Three layers, in this order, full-bleed inside the nearest positioned ancestor
// (caller must use `position: relative`):
//
//   1. **The slide's own background colour** (REQ070) — the canvas this one
//      slide asked for, over the deck's. Nothing is painted when it authored
//      none, so the deck theme's own canvas shows through: the override is a
//      layer, not a replacement.
//   2. **The deck's theme wash** (REQ079) — the light its palette paints behind
//      every slide, on the presenter's screen and on every phone. It is a CSS
//      custom property written by `<DeckThemeScope/>` and consumed by
//      `.deck-slide-wash` in `index.css`, so this component neither knows nor
//      names a colour: a surface outside a theme scope gets `none` and the layer
//      is invisible.
//   3. **The slide's own `backgroundImage`** (REQ071), with a scrim + light blur
//      over it so foreground text stays legible regardless of the picture. Which
//      scrim that is comes from `<SlideAppearanceScope/>` as `--slide-scrim`,
//      paired with the words that sit on it (`slideScrimFor`); a surface outside
//      a scope falls back to the reader's own colour scheme, which is what
//      `.slide-scrim` in `index.css` resolves.
//
// All three are one component because they are one question — what is under the
// words — and a surface that drew one itself would be one edit away from drawing
// it over the picture instead of under it.
//
// Both authored values are read through `slideAppearanceFor()` and never off the
// field: it is the guard that refuses a colour that is not a colour and a URL no
// browser should be pointed at, and this is the component that would otherwise
// hand either straight to a `background-image`.
//
// IMPORTANT: This must be `absolute`, not `fixed`. Using `fixed` covers the
// entire viewport including the presenter sidebar and top controls, which
// completely breaks the UI.

export function SlideBackground({ slide }: { slide: Slide }) {
	const { backgroundColor, backgroundImage } = slideAppearanceFor(slide);
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
		>
			{backgroundColor !== "" && (
				<div className="absolute inset-0" style={{ background: backgroundColor }} />
			)}
			{/* The theme's own light, always — it is the deck's background, not the
			    slide's, so it does not wait for the slide to carry a picture. */}
			<div className="deck-slide-wash absolute inset-0" />
			{backgroundImage !== "" && (
				<div
					className="absolute inset-0"
					style={{
						backgroundImage: `url(${JSON.stringify(backgroundImage)})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						backgroundRepeat: "no-repeat",
					}}
				>
					{/* Scrim + blur so any image stays readable underneath, in the tone
					    the words on it need (REQ071). */}
					<div className="slide-scrim absolute inset-0" />
				</div>
			)}
		</div>
	);
}
