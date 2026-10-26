import { Fragment, type ReactNode } from "react";
import type { SlideTextSize } from "../types";
import type { ChoiceOption } from "./EditorControls";
import { SlideMath } from "./SlideMath";

// ── Authored slide text ───────────────────────────────────────────────
//
// REQ088 (clickable hyperlinks), REQ089 (markdown), REQ091 (text size), REQ093
// (mathematical notation). The one place the words an organizer typed become
// something to look at, worn by every surface that shows them — the editor's
// preview, the shared screen, the participant's phone and the dry run.
//
// The invariant is the *authored string*, not any one rendering of it:
// `**bold**` has to mean bold in all four places or the preview is
// previewing a screen that does not exist, and a link that is clickable on the
// projector but literal on a phone is worse than no link at all. So this module
// owns three things and every surface composes them:
//
//   - `parseSlideText` / `parseSlideInline` — the markup, parsed once, here.
//   - `<SlideText/>` — the rendering, as React elements.
//   - `SLIDE_TEXT_SCALE` — the size step as a shared token.
//
// **Why elements and not HTML.** Slide text is authored by whoever holds an
// edit token, and it is then shown to a whole room. Nothing here ever builds an
// HTML string, so `dangerouslySetInnerHTML` is not used and cannot be: the
// parser emits a typed node tree and React escapes every leaf, which leaves
// exactly one attacker-controlled attribute in the output — a link's `href` —
// and {@link safeSlideLinkHref} allowlists the schemes that may reach it. A
// `javascript:` URL is not sanitised into something harmless; it never becomes
// a link at all. A passage marked as another language (REQ133) adds a second
// attribute, `lang`, and only a value shaped like a language tag reaches it.
//
// A formula (REQ093) is found here like any other markup and drawn by
// `<SlideMath/>`, the one subtree React does not build itself: KaTeX builds it
// from DOM nodes rather than from a string, with every command that could carry
// a link, a picture or an attribute switched off — see `SlideMath.tsx`.

/**
 * The size step as a multiplier on whatever base size the surface already sets
 * — the shared token every rendering of authored text composes.
 *
 * `em` rather than a fixed size on purpose: the same slide is drawn at
 * `text-3xl` on the projector and `text-lg` in the preview pane, and a token in
 * `rem` would flatten the two into one size. `medium` is `1em` — literally no
 * change — so a deck nobody has touched renders exactly as it did before this
 * setting existed.
 */
export const SLIDE_TEXT_SCALE: Record<SlideTextSize, string> = {
	small: "text-[0.85em]",
	medium: "text-[1em]",
	large: "text-[1.25em]",
	"x-large": "text-[1.5em]",
};

/**
 * Line height, as a ratio, for each of the two things this module renders.
 *
 * It has to travel with the scale: a surface's `text-3xl` carries a line height
 * in `rem`, so text scaled up inside it would keep the smaller size's leading
 * and collide with the line above. Both ratios are the ones the untouched
 * surfaces already had (a heading's 1.2, body copy's ~1.55), which is what
 * keeps `medium` a no-op.
 *
 * Exported for one caller: the canvas's editable heading (REQ153) puts a
 * textarea where `<SlideText variant="inline"/>` would go, and it has to be laid
 * out on the same two tokens or the words would move the moment they were typed
 * into.
 */
export const SLIDE_TEXT_LEADING = {
	inline: "leading-[1.2]",
	blocks: "leading-[1.55]",
} as const;

/**
 * The steps as the editor offers them (one descriptor). Ordered
 * smallest to largest so the control reads as a scale rather than a menu.
 */
export const SLIDE_TEXT_SIZE_OPTIONS: ChoiceOption<SlideTextSize>[] = [
	{ value: "small", label: "Small" },
	{ value: "medium", label: "Medium" },
	{ value: "large", label: "Large" },
	{ value: "x-large", label: "Huge" },
];

/**
 * What the markup is, in the organizer's words (REQ088, REQ089) — the one
 * sentence the editor shows beside the fields it applies to. It lives here
 * rather than in the editor because it describes {@link parseSlideText}: a
 * subset that grew without this line growing with it would be a promise the
 * parser does not keep.
 */
export const SLIDE_MARKDOWN_HINT =
	"Heading and body take simple markdown: **bold**, *italic*, `code`, # sub-headings, and - or 1. lists. Links are written [like this](https://example.com) — or just paste an address starting with https://. They open in a new tab. Math is TeX between dollar signs: $x^2$ within a line, $$x^2$$ on a line of its own, and \\$ for a plain dollar sign. A passage in another language is written [like this]{lang=fr}, so a screen reader pronounces it in that language.";

/** The accent-underlined treatment every link in authored text wears. */
export const SLIDE_LINK =
	"text-accent-text underline underline-offset-2 decoration-accent-text/60 hover:text-accent-text-hover break-words";

// ── The markup, parsed ────────────────────────────────────────────────

/** A run of authored text, once its inline markup has been read. */
export type SlideInlineNode =
	| { kind: "text"; text: string }
	| { kind: "strong"; children: SlideInlineNode[] }
	| { kind: "emphasis"; children: SlideInlineNode[] }
	| { kind: "code"; text: string }
	| { kind: "link"; href: string; children: SlideInlineNode[] }
	/**
	 * A passage in a language other than the deck's (REQ133), written
	 * `[passage]{lang=fr}`. `lang` has passed {@link isSlideLanguageTag}.
	 */
	| { kind: "language"; lang: string; children: SlideInlineNode[] }
	/**
	 * A formula (REQ093). `tex` is what KaTeX is handed; `source` is the formula
	 * exactly as typed, delimiters included — what the slide shows instead when
	 * KaTeX refuses it.
	 */
	| { kind: "math"; tex: string; display: boolean; source: string };

/** One block of authored body text (REQ089: hierarchy and list structure). */
export type SlideTextBlock =
	| { kind: "paragraph"; content: SlideInlineNode[] }
	| { kind: "heading"; level: 1 | 2 | 3; content: SlideInlineNode[] }
	| {
			kind: "list";
			ordered: boolean;
			/** Where a numbered list starts counting — `1.` unless authored otherwise. */
			start: number;
			items: SlideInlineNode[][];
	  }
	/** A display formula on lines of its own (REQ093); `source` spans them all. */
	| { kind: "math"; tex: string; source: string };

/**
 * The schemes a link in authored text may use.
 *
 * An allowlist, and deliberately the shortest one that still does the job the
 * requirement asks for — a resource, a document, an address to write to, a
 * number to call (REQ088). Anything else is not a link: `javascript:` and
 * `data:` are the obvious ones, but the reason to enumerate what is *permitted*
 * rather than what is refused is that the next scheme somebody invents is
 * refused too, without anybody remembering to add it here.
 */
const ALLOWED_LINK_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

/**
 * The `href` a link may carry, or `null` when the target is not one this
 * surface will click through to.
 *
 * Parsed with the URL parser rather than matched with a regex, because the
 * evasions worth caring about are all about *what counts as a scheme*:
 * `JavaScript:`, ` javascript:` and a `java\nscript:` with a newline in it are
 * one scheme to a browser and three different strings to a pattern. Whatever
 * the parser says the protocol is, is what gets checked.
 *
 * A relative or scheme-less target ("example.com/docs") is refused for the same
 * reason: a slide's links point somewhere the room can reach from their own
 * device, and resolving one against whichever page happens to be rendering it
 * would send the presenter and a participant to two different places.
 */
export function safeSlideLinkHref(target: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(target.trim());
	} catch {
		return null;
	}
	return ALLOWED_LINK_SCHEMES.includes(parsed.protocol) ? parsed.href : null;
}

/**
 * Characters a backslash may turn back into a literal — the dollar sign among
 * them (REQ093), so a price can sit beside a formula on the same slide.
 */
const ESCAPABLE = "\\`*_{}[]()#+-.!>$";

/** An inline code span: `` `like this` ``, never across a line break. */
const CODE_SPAN = /^`([^`\n]+)`/;
/** The `[label](` that opens a link. The label may not itself contain a link. */
const LINK_LABEL = /^\[([^\]\n]*)\]\(/;
/**
 * A bare URL typed straight into the text, made clickable as it stands.
 *
 * Parentheses are *inside* the class rather than outside it: plenty of real
 * addresses carry them — `…/wiki/Nirvana_(band)`, most SharePoint and Confluence
 * links — and a URL cut at the first `(` is not a shorter link, it is a link
 * that silently goes somewhere else. Where the run ends is decided afterwards by
 * {@link trimBareUrlTail}, which is the only way to tell the parens *in* an
 * address from the ones a sentence wrapped around it.
 */
const BARE_URL = /^https?:\/\/[^\s<>[\]]+/;

/** Punctuation that ends a sentence rather than an address. */
const URL_TRAILING_PUNCTUATION = ".,;:!?'\"";

/**
 * How deep emphasis inside emphasis is followed before the rest of the run is
 * taken literally. Six is far past anything an organizer writes on a slide; it
 * is here so a pathological string of markers cannot recurse without bound.
 */
const INLINE_NESTING_LIMIT = 6;

/** True for a character that would sit *inside* a word. */
function isWordCharacter(character: string | undefined): boolean {
	return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

/**
 * The target of a `[label](…)` link, read from the `(` at `openIndex` to the
 * `)` that closes it — with any balanced pairs in between counted rather than
 * cut at. Returns `null` when nothing closes it on this line, in which case the
 * `[label](` was never a link.
 *
 * A scanner rather than a pattern because "the closing paren" is not "the first
 * paren": `[the band](https://en.wikipedia.org/wiki/Nirvana_(band))` has three
 * of them, and a regex that stopped at the first would hand back an address one
 * character short of the one the organizer pasted — clickable, blue, and wrong.
 *
 * Whitespace *around* the target is allowed and dropped; whitespace *inside* it
 * means this was never a link target, and the whole run stays text.
 */
function readLinkTarget(
	source: string,
	openIndex: number,
): { target: string; end: number } | null {
	let depth = 1;
	let index = openIndex + 1;
	let raw = "";

	while (index < source.length) {
		const character = source[index] as string;
		if (character === "\n") return null;
		if (character === "\\") {
			const escaped = source[index + 1];
			if (escaped === "(" || escaped === ")") {
				raw += escaped;
				index += 2;
				continue;
			}
		}
		if (character === "(") depth += 1;
		if (character === ")") {
			depth -= 1;
			if (depth === 0) {
				const target = raw.trim();
				return /\s/.test(target) ? null : { target, end: index + 1 };
			}
		}
		raw += character;
		index += 1;
	}

	return null;
}

/**
 * Where a bare URL stops, once the punctuation around it has been given back to
 * the sentence: a trailing full stop, and any closing paren that nothing in the
 * address opened.
 *
 * The two have to be taken in turn rather than in sequence — `(see
 * https://example.com/a.)` ends on both — and the balance is what separates
 * `…/Nirvana_(band)` (keep the paren, the address opened it) from
 * `(see https://example.com)` (drop it, the sentence did).
 */
function trimBareUrlTail(candidate: string): string {
	// The parens are counted once and the count is carried down the walk, rather
	// than recounted per character dropped: a run of closing parens is a thing an
	// authored string can contain, and re-scanning for each one would make a long
	// one quadratic.
	let opened = 0;
	let closed = 0;
	for (const character of candidate) {
		if (character === "(") opened += 1;
		else if (character === ")") closed += 1;
	}

	let end = candidate.length;
	while (end > 0) {
		const last = candidate[end - 1] as string;
		if (URL_TRAILING_PUNCTUATION.includes(last)) {
			end -= 1;
			continue;
		}
		if (last === ")" && closed > opened) {
			closed -= 1;
			end -= 1;
			continue;
		}
		break;
	}

	return candidate.slice(0, end);
}

/** A formula found in authored text, and the index just past its delimiter. */
type FoundFormula = {
	tex: string;
	display: boolean;
	source: string;
	end: number;
};

/** Whitespace a delimiter may not sit against, and that a blank line is made of. */
function isSpace(character: string | undefined): boolean {
	return character !== undefined && /\s/.test(character);
}

/** True when the line that starts at `from` holds nothing but spaces. */
function lineIsBlank(source: string, from: number): boolean {
	let index = from;
	while (index < source.length && source[index] !== "\n") {
		if (!isSpace(source[index])) return false;
		index += 1;
	}
	return true;
}

/**
 * True when the backslash at `index` takes the next character with it, as TeX
 * reads a formula — never across a line break.
 */
function isTexEscape(source: string, index: number): boolean {
	return (
		source[index] === "\\" &&
		index + 1 < source.length &&
		source[index + 1] !== "\n"
	);
}

/**
 * The formula whose opening `$` is at `start`, or `null` when that `$` opens
 * none and is just a dollar sign on the slide (REQ093).
 *
 * The rules are Pandoc's, because they are the ones that keep prose with prices
 * in it reading as prose. An inline `$…$` opens onto something that is not a
 * space, closes just after something that is not a space, is not followed by a
 * digit, and stays on its line — so `$5 or $10` and `$5-$10` stay prices while
 * `$x$` is a formula. A display `$$…$$` may pad its formula with spaces and
 * run over several lines, though not across a blank one. Inside either, a
 * backslash takes the next character with it, as TeX does, so `\$` is a dollar
 * sign *in* the formula rather than the end of it.
 */
function readFormula(source: string, start: number): FoundFormula | null {
	return source[start + 1] === "$"
		? readDisplayFormula(source, start)
		: readInlineFormula(source, start);
}

function readInlineFormula(
	source: string,
	start: number,
): FoundFormula | null {
	const opensOnto = source[start + 1];
	if (opensOnto === undefined || isSpace(opensOnto)) return null;

	let index = start + 1;
	while (index < source.length) {
		const character = source[index] as string;
		if (character === "\n") return null;
		if (isTexEscape(source, index)) {
			index += 2;
			continue;
		}
		if (character === "$") {
			const closesAfterSpace = isSpace(source[index - 1]);
			const digitFollows = /[0-9]/.test(source[index + 1] ?? "");
			if (closesAfterSpace || digitFollows) return null;
			return {
				tex: source.slice(start + 1, index),
				display: false,
				source: source.slice(start, index + 1),
				end: index + 1,
			};
		}
		index += 1;
	}
	return null;
}

function readDisplayFormula(
	source: string,
	start: number,
): FoundFormula | null {
	let index = start + 2;
	while (index < source.length) {
		const character = source[index] as string;
		if (character === "\n" && lineIsBlank(source, index + 1)) return null;
		if (isTexEscape(source, index)) {
			index += 2;
			continue;
		}
		if (character === "$" && source[index + 1] === "$") {
			const tex = source.slice(start + 2, index).trim();
			if (tex.length === 0) return null;
			return {
				tex,
				display: true,
				source: source.slice(start, index + 2),
				end: index + 2,
			};
		}
		index += 1;
	}
	return null;
}

/**
 * Where an emphasis run that `marker` opened closes — the index of its closing
 * marker — or `-1` when nothing closes it on this line. The run's content
 * starts at `from` and holds at least one character, and a one-character marker
 * may not appear inside its own run.
 *
 * A formula is stepped over whole (REQ093): `_` and `*` are TeX's subscript and
 * asterisk as often as they are markdown's emphasis, so `_the root $x_1$ is
 * real_` is an emphasised sentence with a formula in it, not an emphasised `the
 * root $x`. Text without a dollar sign in it closes exactly where it always has.
 */
function emphasisCloseIndex(
	source: string,
	from: number,
	marker: string,
): number {
	let index = from;
	while (index < source.length) {
		const character = source[index] as string;
		if (character === "\n") return -1;
		// The two escapes that decide what a `$` means, read the way the parser
		// itself reads them; every other backslash is left to mean what it did.
		if (
			character === "\\" &&
			(source[index + 1] === "\\" || source[index + 1] === "$")
		) {
			index += 2;
			continue;
		}
		if (character === "$") {
			const formula = readFormula(source, index);
			index = formula?.end ?? index + (source[index + 1] === "$" ? 2 : 1);
			continue;
		}
		if (index > from && source.startsWith(marker, index)) return index;
		if (marker.length === 1 && character === marker) return -1;
		index += 1;
	}
	return -1;
}

/**
 * The `**strong**`, `__strong__`, `*italic*` or `_italic_` run that `marker`
 * opens at `start`, or `null` when the marker opens nothing.
 */
function readEmphasisRun(
	source: string,
	start: number,
	marker: string,
): { content: string; end: number } | null {
	if (!source.startsWith(marker, start)) return null;
	const from = start + marker.length;
	const close = emphasisCloseIndex(source, from, marker);
	return close === -1
		? null
		: { content: source.slice(from, close), end: close + marker.length };
}

/**
 * The braces that close a bracketed span: `{…}` straight after its `]`, with no
 * brace or line break inside.
 */
const SPAN_ATTRIBUTES = /^\{([^{}\n]*)\}/;

/**
 * A language tag's shape (REQ133): BCP 47's, without its registry — a primary
 * subtag of two or three letters, then any hyphen-separated subtags of one to
 * eight letters or digits. `fr`, `de-CH`, `zh-Hant-TW` and `sr-Latn` pass; `1`,
 * `english`, `fr_FR` and a quoted `"fr"` do not.
 */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/** The longest tag accepted — the length BCP 47 asks every reader to hold. */
const LANGUAGE_TAG_MAX_LENGTH = 35;

/**
 * Whether `tag` is shaped like a language tag, and so may become a `lang`
 * attribute (REQ133).
 *
 * The value is authored, and it is the second attacker-controlled attribute
 * this module emits after a link's `href`, so it is held to a shape rather than
 * passed through: whatever does not look like a language never reaches the
 * DOM. Restated in `plainTextFromMarkdown` (`server/deck-pdf.ts`), and the two
 * are held together by `SlideText.test.ts`.
 */
export function isSlideLanguageTag(tag: string): boolean {
	return tag.length <= LANGUAGE_TAG_MAX_LENGTH && LANGUAGE_TAG.test(tag);
}

/**
 * The index just past the token that starts at `index`, as a bracketed span's
 * scan reads the text (REQ133): an escaped character, a code span or a formula
 * is one token, so a bracket inside it is not counted; anything else is one
 * character.
 *
 * Depends on nothing before `index`, which is what lets every scan that reaches
 * a position share the one reading of it.
 */
function spanTokenEnd(source: string, index: number): number {
	const character = source[index] as string;
	if (character === "\\" && ESCAPABLE.includes(source[index + 1] ?? "")) {
		return index + 2;
	}
	if (character === "`") {
		const close = source.indexOf("`", index + 1);
		const code = close === -1 ? "" : source.slice(index + 1, close);
		return code.length > 0 && !code.includes("\n") ? close + 1 : index + 1;
	}
	if (character === "$") {
		const formula = readFormula(source, index);
		return formula?.end ?? index + (source[index + 1] === "$" ? 2 : 1);
	}
	return index + 1;
}

/** A `[passage]{…}` span, with `end` counted from its opening bracket. */
type BracketedSpan = { passage: string; lang: string | null; end: number };

/** Not yet read, in the reader's tables. */
const UNREAD = -2;
/** Nothing closes it before a line break or the end of the text. */
const UNCLOSED = -1;

/**
 * Reads the `[passage]{…}` spans of one run of text (REQ133): `read(start)` is
 * the span that opens at the `[` at `start`, or `null` when that bracket closes
 * no span.
 *
 * The closing `]` is the one that balances the opening bracket, so a link can
 * sit inside the passage — `[voir [la doc](https://example.com)]{lang=fr}` —
 * and a bracket inside code, inside a formula or behind a backslash is not
 * counted; a line break before the balancing `]` means no span. `lang` is
 * `null` when the braces are something other than one well-shaped `lang=` tag;
 * the caller then shows the whole span as typed.
 *
 * One reader serves every bracket of the text, and that is the point of it.
 * Scanning forward afresh from each `[` costs the length of the text per
 * bracket, so five thousand unclosed ones (an authored field's length) took
 * time quadratic in it. Here each token is read once, by whichever scan reaches
 * it first, and each bracket's closer is found once, by a stack over that scan.
 * A scan that runs into a position an earlier one read stops there and takes
 * the rest from it: its still-open brackets close where the text from that
 * position first drops below its own level, found by stepping over whole
 * bracket pairs and remembered for every position on the way. So the work is
 * linear in the text, and `steps` counts it: tokens read plus positions
 * stepped, never more than twice the text's length.
 *
 * Exported so the test can hold `steps` to that bound.
 */
export function createBracketedSpanReader(source: string): {
	read: (start: number) => BracketedSpan | null;
	readonly steps: number;
} {
	const tokenEnd = new Int32Array(source.length).fill(UNREAD);
	const closeOf = new Int32Array(source.length).fill(UNREAD);
	const dropFrom = new Int32Array(source.length).fill(UNREAD);
	let steps = 0;

	/**
	 * The first `]` that closes a level below the one open at `from`, or
	 * `UNCLOSED`. Every position from `from` on is already read.
	 */
	function closerBelow(from: number): number {
		const stepped: number[] = [];
		let index = from;
		let found = UNCLOSED;
		while (index < source.length) {
			if (dropFrom[index] !== UNREAD) {
				found = dropFrom[index] as number;
				break;
			}
			steps += 1;
			stepped.push(index);
			const character = source[index];
			if (character === "\n") break;
			if (character === "]") {
				found = index;
				break;
			}
			if (character === "[") {
				const close = closeOf[index] as number;
				if (close === UNCLOSED) break;
				index = close + 1;
				continue;
			}
			index = tokenEnd[index] as number;
		}
		for (const position of stepped) dropFrom[position] = found;
		return found;
	}

	/** Read forward from `start` until the end or a position already read. */
	function scan(start: number): void {
		const open: number[] = [];
		let index = start;
		while (index < source.length) {
			if (index !== start && tokenEnd[index] !== UNREAD) break;
			steps += 1;
			const character = source[index];
			tokenEnd[index] = spanTokenEnd(source, index);
			if (character === "\n") {
				for (const bracket of open) closeOf[bracket] = UNCLOSED;
				open.length = 0;
			} else if (character === "[") {
				open.push(index);
			} else if (character === "]") {
				const bracket = open.pop();
				if (bracket !== undefined) closeOf[bracket] = index;
			}
			index = tokenEnd[index] as number;
		}
		// What is still open closes, innermost first, on the text already read.
		let from = index;
		while (open.length > 0) {
			const bracket = open.pop() as number;
			const close = from < source.length ? closerBelow(from) : UNCLOSED;
			closeOf[bracket] = close;
			if (close === UNCLOSED) {
				for (const outer of open) closeOf[outer] = UNCLOSED;
				break;
			}
			from = close + 1;
		}
	}

	function read(start: number): BracketedSpan | null {
		if (tokenEnd[start] === UNREAD) scan(start);
		const close = closeOf[start] as number;
		if (close < 0) return null;

		const attributes = SPAN_ATTRIBUTES.exec(source.slice(close + 1));
		const passage = source.slice(start + 1, close);
		if (attributes === null || passage.trim().length === 0) return null;

		const [, tag] = /^lang=(.*)$/.exec(attributes[1] as string) ?? [];
		return {
			passage,
			lang: tag !== undefined && isSlideLanguageTag(tag) ? tag : null,
			end: close + 1 + attributes[0].length - start,
		};
	}

	return {
		read,
		get steps() {
			return steps;
		},
	};
}

function parseInlineNodes(source: string, depth: number): SlideInlineNode[] {
	const nodes: SlideInlineNode[] = [];
	let literal = "";
	let position = 0;
	// One for the whole run, made at its first bracket (REQ133).
	let spans: ReturnType<typeof createBracketedSpanReader> | null = null;

	function flushLiteral(): void {
		if (literal.length > 0) {
			nodes.push({ kind: "text", text: literal });
			literal = "";
		}
	}

	while (position < source.length) {
		const character = source[position] as string;
		const rest = source.slice(position);

		// A backslash takes the marker after it literally, which is the only way
		// to write a star on a slide that also uses stars for emphasis.
		if (character === "\\") {
			const escaped = source[position + 1];
			if (escaped !== undefined && ESCAPABLE.includes(escaped)) {
				literal += escaped;
				position += 2;
				continue;
			}
		}

		const code = CODE_SPAN.exec(rest);
		if (code) {
			flushLiteral();
			nodes.push({ kind: "code", text: code[1] as string });
			position += code[0].length;
			continue;
		}

		// After code, so `` `$HOME` `` stays the shell variable it was typed as.
		if (character === "$") {
			const formula = readFormula(source, position);
			if (formula) {
				flushLiteral();
				nodes.push({
					kind: "math",
					tex: formula.tex,
					display: formula.display,
					source: formula.source,
				});
				position = formula.end;
				continue;
			}
			// A dollar sign that opens nothing is a dollar sign — and a doubled one
			// is taken whole, so the `$$` of an unfinished display formula cannot
			// open an inline one with its second half.
			const unopened = source[position + 1] === "$" ? "$$" : "$";
			literal += unopened;
			position += unopened.length;
			continue;
		}

		// Before links, so the `[` that opens a span around a link is read as the
		// span's rather than taken as the start of a longer label.
		const span =
			character === "[" && depth < INLINE_NESTING_LIMIT
				? (spans ??= createBracketedSpanReader(source)).read(position)
				: null;
		if (span) {
			flushLiteral();
			// Braces that are not one well-shaped `lang=` are not half-applied: the
			// whole span stays on the slide as typed, as a refused link does.
			nodes.push(
				span.lang === null
					? { kind: "text", text: rest.slice(0, span.end) }
					: {
							kind: "language",
							lang: span.lang,
							children: parseInlineNodes(span.passage, depth + 1),
						},
			);
			position += span.end;
			continue;
		}

		const linkLabel = LINK_LABEL.exec(rest);
		const linkTarget = linkLabel
			? readLinkTarget(rest, linkLabel[0].length - 1)
			: null;
		if (linkLabel && linkTarget) {
			const label = linkLabel[1] as string;
			const href = safeSlideLinkHref(linkTarget.target);
			const written = rest.slice(0, linkTarget.end);
			flushLiteral();
			if (href === null) {
				// A target this surface will not click through to is not quietly
				// dropped and not silently defanged into a dead link: it stays on the
				// slide exactly as it was typed, as text, so the organizer can see
				// what they wrote and why it is not blue.
				nodes.push({ kind: "text", text: written });
			} else {
				const children =
					label.trim().length > 0
						? parseInlineNodes(label, depth + 1)
						: [{ kind: "text" as const, text: href }];
				nodes.push({ kind: "link", href, children });
			}
			position += written.length;
			continue;
		}

		const bare = BARE_URL.exec(rest);
		if (bare) {
			// A sentence that ends on a URL ends with a full stop, and the full stop
			// is punctuation rather than part of the address — as is the paren a
			// sentence wrapped around it, but not the one the address itself opened.
			const target = trimBareUrlTail(bare[0]);
			const href = safeSlideLinkHref(target);
			if (href !== null) {
				flushLiteral();
				nodes.push({
					kind: "link",
					href,
					children: [{ kind: "text", text: target }],
				});
				position += target.length;
				continue;
			}
		}

		if (depth < INLINE_NESTING_LIMIT) {
			const strong =
				readEmphasisRun(source, position, "**") ??
				readEmphasisRun(source, position, "__");
			if (strong) {
				flushLiteral();
				nodes.push({
					kind: "strong",
					children: parseInlineNodes(strong.content, depth + 1),
				});
				position = strong.end;
				continue;
			}

			// `_` only opens emphasis at a word boundary, so `snake_case_names` and
			// an underscored file name stay the words they are.
			const underscoreOpensWord =
				character === "_" && isWordCharacter(source[position - 1]);
			const emphasis = underscoreOpensWord
				? null
				: (readEmphasisRun(source, position, "*") ??
					readEmphasisRun(source, position, "_"));
			if (emphasis) {
				flushLiteral();
				nodes.push({
					kind: "emphasis",
					children: parseInlineNodes(emphasis.content, depth + 1),
				});
				position = emphasis.end;
				continue;
			}
		}

		literal += character;
		position += 1;
	}

	flushLiteral();
	return nodes;
}

/**
 * One run of authored text with its inline markup read (REQ088, REQ089, REQ133):
 * bold, italic, code, links — markdown-style or typed bare — and passages
 * marked as another language.
 *
 * Line breaks are kept as literal text rather than turned into blocks, which is
 * what makes this the right parse for a *heading*: a slide's question is one
 * run of words that may be emphasised, not a document.
 */
export function parseSlideInline(source: string): SlideInlineNode[] {
	return parseInlineNodes(source, 0);
}

function inlineHasMath(nodes: SlideInlineNode[]): boolean {
	return nodes.some(
		(node) =>
			node.kind === "math" ||
			((node.kind === "strong" ||
				node.kind === "emphasis" ||
				node.kind === "link" ||
				node.kind === "language") &&
				inlineHasMath(node.children)),
	);
}

/**
 * Whether a heading holds a formula anywhere in it — inside emphasis or a link
 * label included (REQ093). Asked by the canvas, whose heading is a field: a
 * field can only show the TeX, so a heading with a formula in it has to be
 * drawn typeset beside it for the canvas to show what the room will read.
 */
export function slideInlineHasMath(source: string): boolean {
	return inlineHasMath(parseSlideInline(source));
}

const HEADING_LINE = /^ {0,3}(#{1,3})\s+(.*)$/;
const BULLET_LINE = /^ {0,3}[-*+]\s+(.*)$/;
const NUMBERED_LINE = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const FORMULA_LINE = /^( {0,3})\$\$/;

/**
 * A body split into lines, with the offset each one starts at — so a formula
 * block is read off the text in place rather than off lines joined back
 * together, which would make a body of many short formulas quadratic.
 */
type SlideTextBody = {
	text: string;
	lines: readonly string[];
	lineStarts: readonly number[];
};

function splitSlideTextBody(source: string): SlideTextBody {
	const text = source.replace(/\r\n?/g, "\n");
	const lines = text.split("\n");
	const lineStarts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineStarts.push(offset);
		offset += line.length + 1;
	}
	return { text, lines, lineStarts };
}

/**
 * The display formula that opens on line `index` and stands on lines of its own
 * (REQ093), or `null` when that line opens none: `$$` at the start of the line,
 * and a closing `$$` that ends its line, before any blank one.
 *
 * The lines in between are TeX, not markdown, which is the reason to read them
 * as a block at all: an equation continued on a line that starts `+ b` or `- c`
 * is not a list item, and a paragraph does not swallow the formula it precedes.
 */
function readFormulaBlock(
	body: SlideTextBody,
	index: number,
): { block: SlideTextBlock; next: number } | null {
	const opening = FORMULA_LINE.exec(body.lines[index] as string);
	if (!opening) return null;

	const lineStart = body.lineStarts[index] as number;
	const formula = readDisplayFormula(
		body.text,
		lineStart + (opening[1] as string).length,
	);
	if (formula === null) return null;

	// The line the closing `$$` is on, and the rest of it, which has to be empty.
	let closingLine = index;
	while ((body.lineStarts[closingLine + 1] ?? Infinity) < formula.end) {
		closingLine += 1;
	}
	const lineEnd =
		(body.lineStarts[closingLine] as number) +
		(body.lines[closingLine] as string).length;
	if (body.text.slice(formula.end, lineEnd).trim().length > 0) return null;

	return {
		block: {
			kind: "math",
			tex: formula.tex,
			source: body.text.slice(lineStart, lineEnd),
		},
		next: closingLine + 1,
	};
}

/**
 * A body of authored text, read into blocks (REQ089): paragraphs, up to three
 * levels of sub-heading, and bulleted or numbered lists.
 *
 * Paragraphs keep their own line breaks — every surface renders them
 * pre-wrapped, as they did before markdown arrived — so a deck whose bodies are
 * plain typed text renders character for character the way it always has. That
 * backwards compatibility is the whole reason a soft line break is not folded
 * into a space the way a strict markdown reader would fold it.
 */
export function parseSlideText(source: string): SlideTextBlock[] {
	const body = splitSlideTextBody(source);
	const { lines } = body;
	const blocks: SlideTextBlock[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] as string;

		if (line.trim().length === 0) {
			index += 1;
			continue;
		}

		const formula = readFormulaBlock(body, index);
		if (formula) {
			blocks.push(formula.block);
			index = formula.next;
			continue;
		}

		const heading = HEADING_LINE.exec(line);
		if (heading) {
			const level = (heading[1] as string).length as 1 | 2 | 3;
			blocks.push({
				kind: "heading",
				level,
				content: parseSlideInline(heading[2] as string),
			});
			index += 1;
			continue;
		}

		const bullet = BULLET_LINE.exec(line);
		if (bullet) {
			const items: SlideInlineNode[][] = [];
			while (index < lines.length) {
				const item = BULLET_LINE.exec(lines[index] as string);
				if (!item) break;
				items.push(parseSlideInline(item[1] as string));
				index += 1;
			}
			blocks.push({ kind: "list", ordered: false, start: 1, items });
			continue;
		}

		const numbered = NUMBERED_LINE.exec(line);
		if (numbered) {
			const start = Number.parseInt(numbered[1] as string, 10);
			const items: SlideInlineNode[][] = [];
			while (index < lines.length) {
				const item = NUMBERED_LINE.exec(lines[index] as string);
				if (!item) break;
				items.push(parseSlideInline(item[2] as string));
				index += 1;
			}
			blocks.push({ kind: "list", ordered: true, start, items });
			continue;
		}

		const paragraph: string[] = [];
		while (index < lines.length) {
			const next = lines[index] as string;
			if (
				next.trim().length === 0 ||
				HEADING_LINE.test(next) ||
				BULLET_LINE.test(next) ||
				NUMBERED_LINE.test(next) ||
				readFormulaBlock(body, index) !== null
			) {
				break;
			}
			paragraph.push(next);
			index += 1;
		}
		blocks.push({
			kind: "paragraph",
			content: parseSlideInline(paragraph.join("\n")),
		});
	}

	return blocks;
}

function inlineToPlain(nodes: SlideInlineNode[]): string {
	return nodes
		.map((node) => {
			switch (node.kind) {
				case "text":
				case "code":
					return node.text;
				case "math":
					return node.tex;
				default:
					return inlineToPlain(node.children);
			}
		})
		.join("");
}

/**
 * Authored text with its markup taken back off, as one line.
 *
 * For the places that show a *gist* rather than the slide — the rail item, a
 * thumbnail, a `title` tooltip — where markup would be read out as the literal
 * stars and brackets it is written with. A link becomes its label, never its
 * target: the rail is naming a slide, not offering a destination. A formula
 * becomes its TeX without the dollar signs (REQ093), the way code loses its
 * backticks: a row too small to typeset in still says which formula it is.
 */
export function slideTextToPlain(source: string): string {
	return parseSlideText(source)
		.map((block) => {
			if (block.kind === "list") return block.items.map(inlineToPlain).join(" ");
			if (block.kind === "math") return block.tex;
			return inlineToPlain(block.content);
		})
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

// ── The rendering ─────────────────────────────────────────────────────

// Parsed markup is addressed by position and nothing else: two identical
// `**bold**` runs in one sentence are the same node with different neighbours,
// so the index *is* the identity here — the same reasoning `Results.tsx` gives
// its poll dots. Nothing in this tree is reordered or kept across renders.
function renderInline(nodes: SlideInlineNode[]): ReactNode[] {
	return nodes.map((node, index) => {
		switch (node.kind) {
			case "text":
				// A Fragment rather than a span: a bare string cannot carry a key, and
				// an extra element here would sit between pre-wrapped text and the
				// whitespace rules its surface set.
				return <Fragment key={index}>{node.text}</Fragment>;
			case "strong":
				return <strong key={index}>{renderInline(node.children)}</strong>;
			case "emphasis":
				return <em key={index}>{renderInline(node.children)}</em>;
			case "code":
				return (
					<code
						key={index}
						className="rounded bg-surface-raised/80 px-1 py-0.5 font-mono text-[0.9em]"
					>
						{node.text}
					</code>
				);
			case "link":
				return (
					<a
						key={index}
						href={node.href}
						target="_blank"
						rel="noopener noreferrer"
						className={SLIDE_LINK}
					>
						{renderInline(node.children)}
					</a>
				);
			case "language":
				// `lang` and nothing else: the passage looks exactly like its
				// neighbours and is only *pronounced* differently (REQ133).
				return (
					<span key={index} lang={node.lang}>
						{renderInline(node.children)}
					</span>
				);
			case "math":
				return (
					<SlideMath
						key={index}
						tex={node.tex}
						display={node.display}
						source={node.source}
					/>
				);
		}
	});
}

const HEADING_SCALE: Record<1 | 2 | 3, string> = {
	1: "text-[1.3em] font-bold",
	2: "text-[1.15em] font-bold",
	3: "text-[1em] font-semibold",
};

function renderBlock(block: SlideTextBlock, index: number): ReactNode {
	if (block.kind === "math") {
		// Pre-wrapped like a paragraph for the one case where what is drawn is
		// the source: a formula KaTeX refused keeps the lines it was typed on.
		return (
			<div key={index} className="whitespace-pre-wrap break-words">
				<SlideMath tex={block.tex} display source={block.source} />
			</div>
		);
	}

	if (block.kind === "heading") {
		// A sub-heading *inside* a body sits under the slide's own heading — an
		// `h3` on a content slide — so it starts at `h4` rather than opening a
		// second document outline on the same screen.
		const Tag = (["h4", "h5", "h6"] as const)[block.level - 1];
		return (
			<Tag key={index} className={`break-words ${HEADING_SCALE[block.level]}`}>
				{renderInline(block.content)}
			</Tag>
		);
	}

	if (block.kind === "list") {
		// The list is `inline-block` so it keeps its own left-aligned bullets
		// while sitting wherever its surface puts it — centred on the shared
		// screen, flush left on a phone — and it is wrapped in a block so two
		// lists in one body get a line each instead of flowing side by side.
		const Tag = block.ordered ? "ol" : "ul";
		return (
			<div key={index}>
				<Tag
					start={block.ordered ? block.start : undefined}
					className={`inline-block space-y-1 pl-5 text-left break-words ${
						block.ordered ? "list-decimal" : "list-disc"
					}`}
				>
					{block.items.map((item, itemIndex) => (
						<li key={itemIndex}>{renderInline(item)}</li>
					))}
				</Tag>
			</div>
		);
	}

	return (
		<p key={index} className="whitespace-pre-wrap break-words">
			{renderInline(block.content)}
		</p>
	);
}

/**
 * Authored slide text, rendered (REQ088, REQ089, REQ091, REQ133).
 *
 * Two variants, because a slide's text is two different things:
 *
 *   - `"inline"` — a heading. Emphasis and links, no blocks, so it is legal
 *     inside the `<h2>`/`<h3>` each surface already wraps a question in.
 *   - `"blocks"` — a body. Paragraphs, sub-headings and lists; must be given a
 *     `<div>` to live in, never a `<p>`.
 *
 * `size` is the organizer's step (REQ091) and is applied here, once, as a
 * multiplier on whatever the surface's own classes already set — pass
 * `slideTextSizeFor(slide)`, never `slide.textSize`.
 */
export function SlideText({
	text,
	size,
	variant,
	className = "",
}: {
	text: string;
	size: SlideTextSize;
	variant: "inline" | "blocks";
	className?: string;
}) {
	const scale = `${SLIDE_TEXT_SCALE[size]} ${SLIDE_TEXT_LEADING[variant]}`;

	if (variant === "inline") {
		return (
			<span className={`${scale} ${className}`}>
				{renderInline(parseSlideInline(text))}
			</span>
		);
	}

	return (
		<div className={`space-y-3 ${scale} ${className}`}>
			{parseSlideText(text).map(renderBlock)}
		</div>
	);
}
