import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KatexOptions } from "katex";

// ── Mathematical notation (REQ093) ────────────────────────────────────
//
// A formula an organizer typed between dollar signs, typeset by KaTeX — and
// this is the one module that reaches KaTeX. `SlideText.tsx` finds the
// formulas in authored text; this turns one of them into something to look at,
// on every surface that draws the slide.
//
// Three decisions live here and nowhere else:
//
//   - **The options.** Authored text is untrusted input on every phone in the
//     room, so KaTeX runs with everything that could carry the author past the
//     formula switched off: no `\href` or `\url`, no `\includegraphics`, no
//     `\htmlClass`/`\htmlId`/`\htmlStyle`/`\htmlData`, no trust hook — plus a
//     cap on author-sized boxes and on macro expansion, and a fresh macro table
//     per formula (none is passed in), so a `\gdef` on one slide cannot
//     redefine another slide's commands. KaTeX's cap reaches positive sizes
//     only, so a negative size past it, and a row stretch past
//     `SLIDE_MATH_MAX_ARRAY_STRETCH`, are refused here before anything is drawn
//     (`slideMathWithinBounds`).
//   - **How a formula reaches the DOM.** KaTeX's own `render()` builds it with
//     `createElement` and `createTextNode` into an element React rendered empty
//     and never reconciles the children of. No HTML string is built and nothing
//     is parsed as markup, which is the guarantee the rest of `SlideText` gets
//     from React escaping every leaf.
//   - **When KaTeX loads.** It is a chunk of its own, fetched from this
//     deployment the first time a formula is on screen, so a deck without
//     mathematics costs a participant's phone nothing. Its fonts are bundled
//     the same way: the stylesheet `index.css` imports names them, and the
//     build ships them beside every other asset.
//
// A formula that does not typeset — malformed TeX, a refused command, a chunk
// that never arrived — is shown exactly as it was typed, dollar signs and all.
// The slide never breaks, and its author can see what they wrote.

/** The custom property the refusal mark names — defined nowhere, on purpose. */
const REFUSED_PROPERTY = "--slide-math-refused";

/**
 * The colour KaTeX is told to draw a refused command in — not as a colour but
 * as the mark that says it refused one.
 *
 * KaTeX does not throw for a command it will not trust: it draws the command's
 * name "in errorColor" and drops its arguments, so `\href{…}{the link}` would
 * reach the room as a bare `\href`. Finding this value in what it drew is how
 * {@link SlideMath} knows to show the formula as typed instead. No author can
 * produce it — KaTeX accepts only hex digits and letters as a colour — and the
 * property it names is defined nowhere, so a refused command that somehow got
 * past the check would still be drawn in the text's own colour, never in red.
 */
export const SLIDE_MATH_REFUSED_MARK = `var(${REFUSED_PROPERTY})`;

/** Anything KaTeX drew in {@link SLIDE_MATH_REFUSED_MARK}: a command it refused. */
const REFUSED_COMMAND = `[style*="${REFUSED_PROPERTY}"]`;

/**
 * KaTeX's options for every formula (REQ093) — one set, so the projector and a
 * phone cannot typeset the same source two ways. `displayMode` is the only
 * thing added per formula.
 */
export const SLIDE_MATH_OPTIONS = {
	// A formula that does not parse throws, and the caller shows it as typed.
	// KaTeX's own fallback would draw it in an error colour with the parser's
	// message as a tooltip — a debugging aid, not something to project.
	throwOnError: true,
	// Every command that could reach past the formula — a link, a picture, a
	// class, an id, an inline style, a data attribute — is refused outright
	// rather than filtered. A boolean, not a function: there is no hook here to
	// get subtly wrong.
	trust: false,
	// What a refusal is drawn in — see SLIDE_MATH_REFUSED_MARK.
	errorColor: SLIDE_MATH_REFUSED_MARK,
	// LaTeX-faithfulness complaints are for a typesetter's console, not a room's.
	strict: "ignore",
	// MathML for assistive technology, HTML for everybody's eyes.
	output: "htmlAndMathml",
	// Author-sized boxes and spaces (`\rule`, `\hspace`, `\raisebox`), in ems.
	// Past this no typographic use is left — only a slab of ink over the rest of
	// the screen.
	maxSize: 10,
	// Macro expansions per formula: room for any real one, and a stop for
	// `\def\a{\a\a}\a`.
	maxExpand: 1000,
} as const satisfies KatexOptions;

/** The library itself, once its chunk has arrived. */
type Katex = (typeof import("katex"))["default"];

/**
 * How far an array's rows may be stretched (`\arraystretch`): room for any real
 * table, and a stop for one stretched down the length of the screen.
 */
export const SLIDE_MATH_MAX_ARRAY_STRETCH = 3;

/**
 * One of each TeX unit in ems, as KaTeX converts it at text size: ten points to
 * the em, an ex of 0.431em, eighteen mu to the em. Every unit KaTeX accepts is
 * here — it refuses any other before a formula is typeset.
 */
const EMS_PER_UNIT: Readonly<Record<string, number>> = {
	em: 1,
	ex: 0.431,
	mu: 1 / 18,
	pt: 1 / 10,
	mm: 7227 / 2540 / 10,
	cm: 7227 / 254 / 10,
	in: 72.27 / 10,
	bp: 803 / 800 / 10,
	pc: 12 / 10,
	dd: 1238 / 1157 / 10,
	cc: 14856 / 1157 / 10,
	nd: 685 / 642 / 10,
	nc: 1370 / 107 / 10,
	sp: 1 / 65536 / 10,
	px: 803 / 800 / 10,
};

/**
 * Whether a formula keeps inside the box its options promise (REQ093).
 *
 * `maxSize` caps an author's sizes from above only — KaTeX clamps them with
 * `Math.min` — so a *negative* one (`\raisebox{-9999em}`, `\rule[-1000em]`,
 * `\kern-5000em`, a `\\[-9999em]` row gap) passes untouched, and
 * `\arraystretch` is a multiplier the cap never sees at all. Either can push
 * the rest of a phone's screen out of reach. So the formula is parsed — its
 * macros already expanded, which a scan of the source would miss — and refused
 * like a refused command when a size reaches further below zero than `maxSize`
 * reaches above it, or a row stretch past {@link SLIDE_MATH_MAX_ARRAY_STRETCH}.
 *
 * The parse is KaTeX's own `__parse`, which its authors mark unstable. The walk
 * reads only the shape every size has — a number and a unit — wherever it sits
 * in the tree, and a release without the function fails closed: every formula
 * shown as typed, and `SlideMath.test.ts` failing with it.
 */
export function slideMathWithinBounds(
	katex: Katex,
	tex: string,
	display: boolean,
): boolean {
	const parse = (
		katex as unknown as {
			__parse?: (expression: string, options: object) => unknown;
		}
	).__parse;
	if (typeof parse !== "function") return false;
	let tree: unknown;
	try {
		tree = parse(tex, { ...SLIDE_MATH_OPTIONS, displayMode: display });
	} catch {
		return false;
	}
	const visited = new WeakSet<object>();
	const within = (node: unknown): boolean => {
		if (node === null || typeof node !== "object" || visited.has(node)) {
			return true;
		}
		visited.add(node);
		if (Array.isArray(node)) return node.every(within);
		const fields = node as Record<string, unknown>;
		if (typeof fields.number === "number" && typeof fields.unit === "string") {
			const ems = fields.number * (EMS_PER_UNIT[fields.unit] ?? 1);
			if (ems < -SLIDE_MATH_OPTIONS.maxSize) return false;
		}
		if (
			typeof fields.arraystretch === "number" &&
			fields.arraystretch > SLIDE_MATH_MAX_ARRAY_STRETCH
		) {
			return false;
		}
		// `loc` points back into the lexer and its whole input — not part of the
		// formula's own structure.
		return Object.entries(fields).every(
			([key, value]) => key === "loc" || within(value),
		);
	};
	return within(tree);
}

let loadedKatex: Katex | null = null;
let pendingKatex: Promise<Katex> | null = null;

/**
 * KaTeX, fetched once per page and shared by every formula on it.
 *
 * A failed fetch — a dropped connection, a deploy that replaced the chunk — is
 * not remembered: the next formula to mount asks again, and until one gets an
 * answer every formula stands as typed.
 */
export function loadSlideMath(): Promise<Katex> {
	if (loadedKatex !== null) return Promise.resolve(loadedKatex);
	if (pendingKatex === null) {
		pendingKatex = import("katex").then(
			(katexModule) => {
				loadedKatex = katexModule.default;
				return katexModule.default;
			},
			(loadError: unknown) => {
				pendingKatex = null;
				throw loadError;
			},
		);
	}
	return pendingKatex;
}

/** KaTeX if it has arrived, `null` while it has not — asking for it if need be. */
function useKatex(): Katex | null {
	const [katex, setKatex] = useState<Katex | null>(loadedKatex);

	useEffect(() => {
		if (katex !== null) return;
		let mounted = true;
		loadSlideMath().then(
			(arrived) => {
				if (mounted) setKatex(arrived);
			},
			// Nothing to report: the formula keeps standing as typed.
			() => {},
		);
		return () => {
			mounted = false;
		};
	}, [katex]);

	return katex;
}

/**
 * A display formula is a block of its own that scrolls sideways rather than
 * pushing a phone's layout wider than its screen.
 *
 * Two elements, because the surfaces centre a slide in a column that shrinks to
 * fit its content, and a formula's width would otherwise *become* that column's
 * narrowest possible width — wider than the phone, cut off at both edges. The
 * frame is a one-column grid whose track may shrink to nothing yet grows to the
 * formula's full width where there is room, so a short formula still sizes its
 * column; the scroller inside is the grid item, free to be narrower than what
 * it holds. `overflow-y` is stated because `auto` on one axis turns `visible`
 * on the other into `auto`, and a vertical scrollbar on an equation is never
 * what anybody wanted.
 */
const DISPLAY_FORMULA_FRAME = "grid grid-cols-[minmax(0,1fr)]";
const DISPLAY_FORMULA_SCROLLER = "overflow-x-auto overflow-y-hidden";

/**
 * One formula, typeset (REQ093).
 *
 * `source` is the formula exactly as it was typed, delimiters included. It is
 * what stands in the formula's place until KaTeX has arrived, and for good when
 * KaTeX refuses it — as text, which React escapes like any other.
 */
export function SlideMath({
	tex,
	display,
	source,
}: {
	tex: string;
	display: boolean;
	source: string;
}) {
	const katex = useKatex();
	const hostRef = useRef<HTMLSpanElement>(null);
	// The formula KaTeX last refused, so that a corrected one is tried afresh.
	const [refused, setRefused] = useState<string | null>(null);
	const formula = `${display ? "display" : "inline"}:${tex}`;
	const typesets = katex !== null && refused !== formula;

	// A layout effect, so the formula is in place before the frame is painted
	// and the room never sees the empty element it is drawn into.
	useLayoutEffect(() => {
		const host = hostRef.current;
		if (katex === null || host === null) return;
		try {
			// A size past the cap's reach is refused before anything is drawn, so
			// the room never gets the frame in which it pushed the screen away.
			if (slideMathWithinBounds(katex, tex, display)) {
				katex.render(tex, host, { ...SLIDE_MATH_OPTIONS, displayMode: display });
				if (host.querySelector(REFUSED_COMMAND) === null) return;
			}
		} catch {
			// Malformed TeX, or KaTeX failing in a way nobody predicted — it ends
			// the same way as a refused command, below.
		}
		host.replaceChildren();
		setRefused(formula);
	}, [katex, tex, display, formula]);

	if (!typesets) {
		// As typed — but TeX has few spaces to break at, and a run that fits a
		// projector can be wider than a phone.
		return <span className="[overflow-wrap:anywhere]">{source}</span>;
	}
	// Keyed apart, because the same instance can turn from one into the other
	// when the slide under it changes. Unkeyed, both are a bare `<span>` to React,
	// which would keep the inline host as the display frame and never remove the
	// formula KaTeX drew into it — that subtree is not React's to reconcile.
	if (!display) return <span key="inline" ref={hostRef} />;
	return (
		<span key="display" className={DISPLAY_FORMULA_FRAME}>
			<span ref={hostRef} className={DISPLAY_FORMULA_SCROLLER} />
		</span>
	);
}
