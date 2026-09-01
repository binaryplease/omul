import { Fragment, type ReactNode } from "react";
import type { SlideTextSize } from "../types";
import type { ChoiceOption } from "./EditorControls";

// ── Authored slide text ───────────────────────────────────────────────
//
// REQ088 (clickable hyperlinks), REQ089 (markdown), REQ091 (text size). The
// one place the words an organizer typed become something to look at, worn by
// every surface that shows them — the editor's preview, the shared screen, the
// participant's phone and the dry run.
//
// The invariant is the *authored string*, not any one rendering of it
// (ADR-0027): `**bold**` has to mean bold in all four places or the preview is
// previewing a screen that does not exist, and a link that is clickable on the
// projector but literal on a phone is worse than no link at all. So this module
// owns three things and every surface composes them:
//
//   - `parseSlideText` / `parseSlideInline` — the markup, parsed once, here.
//   - `<SlideText/>` — the rendering, as React elements.
//   - `SLIDE_TEXT_SCALE` — the size step as a shared token (ADR-0028).
//
// **Why elements and not HTML.** Slide text is authored by whoever holds an
// edit token, and it is then shown to a whole room. Nothing here ever builds an
// HTML string, so `dangerouslySetInnerHTML` is not used and cannot be: the
// parser emits a typed node tree and React escapes every leaf, which leaves
// exactly one attacker-controlled attribute in the output — a link's `href` —
// and {@link safeSlideLinkHref} allowlists the schemes that may reach it. A
// `javascript:` URL is not sanitised into something harmless; it never becomes
// a link at all.

/**
 * The size step as a multiplier on whatever base size the surface already sets
 * (ADR-0028) — the shared token every rendering of authored text composes.
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
 * The steps as the editor offers them (ADR-0026: one descriptor). Ordered
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
	"Heading and body take simple markdown: **bold**, *italic*, `code`, # sub-headings, and - or 1. lists. Links are written [like this](https://example.com) — or just paste an address starting with https://. They open in a new tab.";

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
	| { kind: "link"; href: string; children: SlideInlineNode[] };

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
	  };

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

/** Characters a backslash may turn back into a literal. */
const ESCAPABLE = "\\`*_{}[]()#+-.!>";

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
/** `**bold**` / `__bold__`, within one line. */
const STRONG_STAR = /^\*\*([^\n]+?)\*\*/;
const STRONG_UNDERSCORE = /^__([^\n]+?)__/;
/** `*italic*` / `_italic_`, within one line and without nesting the marker. */
const EMPHASIS_STAR = /^\*([^*\n]+?)\*/;
const EMPHASIS_UNDERSCORE = /^_([^_\n]+?)_/;

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

function parseInlineNodes(source: string, depth: number): SlideInlineNode[] {
	const nodes: SlideInlineNode[] = [];
	let literal = "";
	let position = 0;

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
			const strong = STRONG_STAR.exec(rest) ?? STRONG_UNDERSCORE.exec(rest);
			if (strong) {
				flushLiteral();
				nodes.push({
					kind: "strong",
					children: parseInlineNodes(strong[1] as string, depth + 1),
				});
				position += strong[0].length;
				continue;
			}

			// `_` only opens emphasis at a word boundary, so `snake_case_names` and
			// an underscored file name stay the words they are.
			const underscoreOpensWord =
				character === "_" && isWordCharacter(source[position - 1]);
			const emphasis = underscoreOpensWord
				? null
				: (EMPHASIS_STAR.exec(rest) ?? EMPHASIS_UNDERSCORE.exec(rest));
			if (emphasis) {
				flushLiteral();
				nodes.push({
					kind: "emphasis",
					children: parseInlineNodes(emphasis[1] as string, depth + 1),
				});
				position += emphasis[0].length;
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
 * One run of authored text with its inline markup read (REQ088, REQ089): bold,
 * italic, code, and links — markdown-style or typed bare.
 *
 * Line breaks are kept as literal text rather than turned into blocks, which is
 * what makes this the right parse for a *heading*: a slide's question is one
 * run of words that may be emphasised, not a document.
 */
export function parseSlideInline(source: string): SlideInlineNode[] {
	return parseInlineNodes(source, 0);
}

const HEADING_LINE = /^ {0,3}(#{1,3})\s+(.*)$/;
const BULLET_LINE = /^ {0,3}[-*+]\s+(.*)$/;
const NUMBERED_LINE = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;

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
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const blocks: SlideTextBlock[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] as string;

		if (line.trim().length === 0) {
			index += 1;
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
				NUMBERED_LINE.test(next)
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
 * target: the rail is naming a slide, not offering a destination.
 */
export function slideTextToPlain(source: string): string {
	return parseSlideText(source)
		.map((block) =>
			block.kind === "list"
				? block.items.map(inlineToPlain).join(" ")
				: inlineToPlain(block.content),
		)
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
		}
	});
}

const HEADING_SCALE: Record<1 | 2 | 3, string> = {
	1: "text-[1.3em] font-bold",
	2: "text-[1.15em] font-bold",
	3: "text-[1em] font-semibold",
};

function renderBlock(block: SlideTextBlock, index: number): ReactNode {
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
 * Authored slide text, rendered (REQ088, REQ089, REQ091).
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
