import { Fragment } from "react";

// ── Search-match highlighting ─────────────────────────────────────────
//
// The one place a search term is marked up inside a result (a search
// surface must highlight the matched content, and the field that produced the
// match must itself be visible). Split out from the surface that searches, so a
// second search surface highlights identically rather than inventing its own
// <mark>.
//
// The matching rule is the caller's, not this module's: `highlightSegments`
// marks a plain case-insensitive substring, which is exactly what
// `deckTemplateMatchesSearch` decides a match *is* (server/schemas.ts). A
// surface whose filter matched some other way must not use this one — a
// highlight that points at the wrong characters is worse than none, because it
// explains a result with a reason that is not the reason.

/** One run of a string, either inside a match or outside every match. */
export type TextSegment = { text: string; matched: boolean };

/**
 * `text` split into alternating matched/unmatched runs for `search` — every
 * occurrence, case-insensitively, in order.
 *
 * Always returns at least one segment, so a caller can render the result
 * unconditionally: an empty search (or one that matches nothing) is the whole
 * string, unmatched.
 */
export function highlightSegments(text: string, search: string): TextSegment[] {
	const needle = search.trim().toLowerCase();
	if (needle === "") return [{ text, matched: false }];
	const haystack = text.toLowerCase();
	const segments: TextSegment[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		const found = haystack.indexOf(needle, cursor);
		if (found === -1) break;
		if (found > cursor) {
			segments.push({ text: text.slice(cursor, found), matched: false });
		}
		segments.push({
			text: text.slice(found, found + needle.length),
			matched: true,
		});
		cursor = found + needle.length;
	}
	if (cursor < text.length) {
		segments.push({ text: text.slice(cursor), matched: false });
	}
	return segments.length > 0 ? segments : [{ text, matched: false }];
}

/**
 * A string with the searched-for term marked inside it. Renders plain text when
 * there is no search, so a surface passes its query straight through rather than
 * branching on whether one has been typed yet.
 */
export function HighlightedText({
	text,
	search,
	className = "",
}: {
	text: string;
	search: string;
	className?: string;
}) {
	const segments = highlightSegments(text, search);
	return (
		<span className={className}>
			{segments.map((segment, index) =>
				segment.matched ? (
					<mark key={index} className="rounded bg-accent/25 px-0.5 text-text">
						{segment.text}
					</mark>
				) : (
					<Fragment key={index}>{segment.text}</Fragment>
				),
			)}
		</span>
	);
}
