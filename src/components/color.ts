// ── Colour arithmetic ─────────────────────────────────────────────────
//
// The pure maths both theming layers do: the deck's own palette derivation
// (`DeckTheme.tsx`, REQ079/REQ080) and a slide's override of it
// (`SlideAppearance.tsx`, REQ087/REQ070/REQ071/REQ019). It is its own module
// because it depends on neither of them — no DOM, no React, no
// schema, no token vocabulary — which is also what makes every derivation
// above it assertable without a browser.
//
// Everything here is a total function: a value that is not a colour comes back
// as `null` rather than as a repaired guess, because the layers above answer a
// refused colour with the layer underneath.

export type Rgb = { red: number; green: number; blue: number };
export type Hsl = { hue: number; saturation: number; lightness: number };

export const BLACK: Rgb = { red: 0, green: 0, blue: 0 };
export const WHITE: Rgb = { red: 255, green: 255, blue: 255 };

export function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** `#rgb` / `#rrggbb` as channels, or `null` for anything else. */
export function parseHexColor(value: string): Rgb | null {
	const authored = value.trim().toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(authored);
	if (short) {
		return {
			red: Number.parseInt(short[1] + short[1], 16),
			green: Number.parseInt(short[2] + short[2], 16),
			blue: Number.parseInt(short[3] + short[3], 16),
		};
	}
	const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(authored);
	if (!long) return null;
	return {
		red: Number.parseInt(long[1], 16),
		green: Number.parseInt(long[2], 16),
		blue: Number.parseInt(long[3], 16),
	};
}

/** Channels back to `#rrggbb`, which is the only form these modules write. */
export function formatHexColor({ red, green, blue }: Rgb): string {
	const channel = (value: number) =>
		Math.round(Math.min(255, Math.max(0, value)))
			.toString(16)
			.padStart(2, "0");
	return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** `weight` of `toward` over `from`, channel by channel. */
export function mixColors(from: Rgb, toward: Rgb, weight: number): Rgb {
	const at = clampUnit(weight);
	return {
		red: from.red + (toward.red - from.red) * at,
		green: from.green + (toward.green - from.green) * at,
		blue: from.blue + (toward.blue - from.blue) * at,
	};
}

/** The same colour as a translucent `rgba()`, for glows, washes and scrims. */
export function rgbaColor({ red, green, blue }: Rgb, alpha: number): string {
	return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${alpha})`;
}

export function rgbToHsl({ red, green, blue }: Rgb): Hsl {
	const redUnit = red / 255;
	const greenUnit = green / 255;
	const blueUnit = blue / 255;
	const max = Math.max(redUnit, greenUnit, blueUnit);
	const min = Math.min(redUnit, greenUnit, blueUnit);
	const lightness = (max + min) / 2;
	const span = max - min;
	if (span === 0) return { hue: 0, saturation: 0, lightness };
	const saturation =
		lightness > 0.5 ? span / (2 - max - min) : span / (max + min);
	let hue: number;
	if (max === redUnit) {
		hue = (greenUnit - blueUnit) / span + (greenUnit < blueUnit ? 6 : 0);
	} else if (max === greenUnit) {
		hue = (blueUnit - redUnit) / span + 2;
	} else {
		hue = (redUnit - greenUnit) / span + 4;
	}
	return { hue: hue / 6, saturation, lightness };
}

export function hslToRgb({ hue, saturation, lightness }: Hsl): Rgb {
	if (saturation === 0) {
		const level = lightness * 255;
		return { red: level, green: level, blue: level };
	}
	const upper =
		lightness < 0.5
			? lightness * (1 + saturation)
			: lightness + saturation - lightness * saturation;
	const lower = 2 * lightness - upper;
	const channel = (offset: number) => {
		let position = hue + offset;
		if (position < 0) position += 1;
		if (position > 1) position -= 1;
		if (position < 1 / 6) return lower + (upper - lower) * 6 * position;
		if (position < 1 / 2) return upper;
		if (position < 2 / 3) return lower + (upper - lower) * (2 / 3 - position) * 6;
		return lower;
	};
	return {
		red: channel(1 / 3) * 255,
		green: channel(0) * 255,
		blue: channel(-1 / 3) * 255,
	};
}

/** WCAG relative luminance — what "is this canvas dark?" actually asks. */
export function relativeLuminance({ red, green, blue }: Rgb): number {
	const channel = (value: number) => {
		const unit = value / 255;
		return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
	};
	return (
		0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
	);
}

export function contrastRatio(one: Rgb, other: Rgb): number {
	const first = relativeLuminance(one);
	const second = relativeLuminance(other);
	const lighter = Math.max(first, second);
	const darker = Math.min(first, second);
	return (lighter + 0.05) / (darker + 0.05);
}

/** Which colour scheme a canvas belongs to, read off the canvas itself. */
export function schemeOfCanvas(canvas: Rgb): "dark" | "light" {
	return relativeLuminance(canvas) < 0.2 ? "dark" : "light";
}

/**
 * What a native colour input shows for an authored value: the colour as
 * `#rrggbb`, or `fallback` while the field is empty or half-typed.
 *
 * A `<input type="color">` has no "unset" — it always reports some colour — so
 * the two controls that author one field need a shared answer to "what does the
 * picker show when nothing is authored yet?", and this is it. One
 * answer for both layers: a deck's brand colour and a slide's own are authored
 * by the same control.
 */
export function authoredColorInputValue(
	value: string,
	fallback: string,
): string {
	const parsed = parseHexColor(value);
	return parsed ? formatHexColor(parsed) : fallback;
}
