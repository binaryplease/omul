/**
 * PDF export of a deck, with or without its collected results (REQ096).
 *
 * The second export format, built on the shape the first one established
 * (`server/results-export.ts` beside it) and for the same reason: this module
 * has no store, no route and no clock of its own. The deck, the rows the room
 * submitted, the aggregates the results endpoint already computed and the
 * instant of the export all arrive as arguments — the very same
 * {@link ResultsExportInput} the workbook is built from — and a document comes
 * back. It cannot re-derive a tally that disagrees with the one on screen,
 * because it does not compute one.
 *
 * Two stages, deliberately separated:
 *
 *  - {@link buildDeckDocument} — pure data. Deck + rows + aggregates in, a
 *    {@link PdfDocument} of sections and blocks out. Everything worth asserting
 *    about the export is asserted here, against plain arrays, with no PDF
 *    parser in the loop.
 *  - {@link renderDeckDocument} — the only place `pdf-lib` is touched. It flows
 *    blocks onto pages, breaking where they no longer fit, and makes no
 *    decision about *what* the document says.
 *
 * ## What is rendered
 *
 * A cover page naming the deck, then **one section per slide** — what was
 * asked, and what it offered to answer with. `includeResults` adds each slide's
 * tally underneath, and the counts to the cover; on a deck that asked the room
 * for names (REQ076) it also adds a roster page between the two.
 *
 * The tally is not re-read per slide type. It is
 * {@link aggregateRowsFor} — the same flattening of `GET /results`' own payload
 * that the Aggregates sheet is — pivoted back into something a person reads:
 * the slide-level metrics as a list, the per-entry ones as bars where the
 * aggregation published a share of the whole ({@link SHARE_METRIC}) and as a
 * table where it did not. So a number in this file is the number the shared
 * screen drew, by construction, and a slide type that gains an aggregate later
 * appears here without this module being edited.
 *
 * ## What "self-contained" costs, and what it buys
 *
 * The file references nothing outside itself. Two consequences worth stating,
 * because each is a decision rather than an omission:
 *
 *  - **A slide's media is named, never fetched.** `mediaUrl` and
 *    `backgroundImage` are URLs the deck points at (see `server/schemas.ts`),
 *    and an exporter that downloaded them would be a signed-in caller making
 *    this server issue requests to an address they chose. The document prints
 *    the address instead.
 *  - **The text is set in embedded faces** — Noto Sans, vendored under
 *    `server/fonts/` and subset into each export, so the file carries only the
 *    glyphs it draws and every reader draws it the same way (REQ158). The face
 *    covers Latin, Latin Extended, Greek and Cyrillic, so text in those scripts
 *    reaches the page as authored. Chinese, Japanese and Korean are drawn from
 *    a second vendored face, Sarasa Gothic, and emoji from a third, GNU
 *    Unifont's monochrome pictographs — each chosen per run of text and
 *    embedded only into an export that has some. What none of them has a glyph
 *    for — Arabic, Hebrew, Devanagari, Thai and every other script — is folded
 *    to its nearest form the faces can draw and, failing that, marked — see
 *    {@link faceText}.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fontkit, { type Font } from "@pdf-lib/fontkit";
import {
	PDFDocument,
	type PDFFont,
	type PDFPage,
	rgb,
	type RGB,
} from "pdf-lib";
import boldFacePath from "./fonts/NotoSans-Bold.ttf" with { type: "file" };
import regularFacePath from "./fonts/NotoSans-Regular.ttf" with { type: "file" };
import cjkFacePath from "./fonts/SarasaGothicSC-Regular.ttf" with { type: "file" };
import emojiFacePath from "./fonts/unifont-15.0.06.ttf" with { type: "file" };
import emojiUpperFacePath from "./fonts/unifont_upper-15.0.06.ttf" with { type: "file" };
import {
	aggregateRowsFor,
	filteredAnswerTextsFor,
	participantNameFor,
	respondentIdsIn,
	respondentsIn,
	type ResultsExportInput,
	SHARE_METRIC,
	type SheetCell,
	type SlideResultsPayload,
} from "./results-export";
import {
	acceptedQuizAnswers,
	countdownSecondsFor,
	deckFilenameSlug,
	FIRST_PASS,
	formatCountdown,
	formFieldsFor,
	type GridAxis,
	gridAxesFor,
	guessRangeFor,
	isContentSlideType,
	isInteractiveSlideType,
	leaderboardSizeFor,
	maxSelectionsFor,
	POINTS_BUDGET,
	type Presentation,
	quizAnswerModeFor,
	quizTimeLimitFor,
	respondentIdOf,
	type Slide,
	SLIDE_TYPE_LABELS,
	slideHasCorrectAnswers,
	slideMediaIsInteractionArea,
} from "./schemas";

// ── The document model ───────────────────────────────────────
//
// A block is one thing the renderer knows how to draw and measure. Blocks flow
// down a page and break onto the next one when they run out of room; a
// *section* is what always starts on a fresh page. Nothing here carries a
// coordinate, a font or a colour — those are the renderer's, which is what lets
// the builder be tested against plain arrays.

/** A label/value pair, as the cover and a slide's totals are drawn. */
export type PdfFact = { label: string; value: string };

/** One bar of a tally: what it is, what it says, and how full it is drawn. */
export type PdfBar = {
	label: string;
	/** The entry's other metrics, spelled out under the bar. */
	caption: string;
	/** Percentage of the whole, as the aggregation published it, or `null`. */
	share: number | null;
};

export type PdfBlock =
	| { kind: "title"; text: string }
	| { kind: "subtitle"; text: string }
	| { kind: "heading"; text: string }
	/** A small section label — "Results", "Options", "Accepted answers". */
	| { kind: "label"; text: string }
	| { kind: "paragraph"; text: string }
	/** Secondary prose: a rule about the slide, a URL it points at. */
	| { kind: "note"; text: string }
	| { kind: "bullets"; items: string[] }
	| { kind: "facts"; facts: PdfFact[] }
	| { kind: "bars"; bars: PdfBar[] }
	| { kind: "table"; columns: string[]; rows: string[][] }
	| { kind: "rule" };

/** One page's worth of blocks — more if they overflow, never fewer. */
export type PdfSection = { blocks: PdfBlock[] };

/** A whole document, ready to render. */
export type PdfDocument = {
	/** What the running footer names the file, on every page. */
	footer: string;
	sections: PdfSection[];
};

/**
 * Everything one PDF export reads: the same input the workbook is built from,
 * plus the single decision REQ096 leaves to the caller.
 */
export type DeckPdfInput = ResultsExportInput & {
	/** Whether the collected results are rendered into the document. */
	includeResults: boolean;
};

// ── Reading a cell into words ────────────────────────────────

/**
 * The mark an absent value is drawn under.
 *
 * A dash rather than an empty run of page, for the reason the workbook keeps
 * `null` cells rather than dropping them: "nobody answered" and "the
 * average was zero" are different readings, and in a rendered document a blank
 * is indistinguishable from a layout that lost the number.
 */
export const EMPTY_VALUE = "—";

/** One aggregate cell as the document says it. */
export function cellText(value: SheetCell): string {
	if (value === null) return EMPTY_VALUE;
	if (typeof value === "boolean") return value ? "yes" : "no";
	if (typeof value === "number") {
		return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
	}
	return value.length > 0 ? value : EMPTY_VALUE;
}

// ── Authored markdown, reduced to words ──────────────────────

/**
 * The `{lang=…}` that closes a passage marked as another language (REQ133),
 * with a tag of the shape the client's `isSlideLanguageTag` accepts — restated
 * here because the server does not import the client's renderer, and held to
 * it by `SlideText.test.ts`.
 */
const LANGUAGE_MARK = /\{lang=([A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*)\}/y;
const LANGUAGE_TAG_MAX_LENGTH = 35;

/**
 * One line with every `[passage]{lang=…}` reduced to its passage (REQ133).
 *
 * A language is something a page *says* rather than shows, so the words stay
 * and the marking goes. The `[` dropped is the one that balances the `]`, so a
 * link inside the passage keeps its own brackets for the reduction after this.
 * A span whose tag is not shaped like one is left as typed, as the slide shows it.
 */
function withoutLanguageMarking(line: string): string {
	const dropped = new Set<number>();
	const openers: number[] = [];
	let index = 0;
	while (index < line.length) {
		const character = line[index];
		if (character === "\\") {
			index += 2;
			continue;
		}
		if (character === "[") openers.push(index);
		if (character === "]") {
			const opener = openers.pop();
			LANGUAGE_MARK.lastIndex = index + 1;
			const mark = LANGUAGE_MARK.exec(line);
			const passage = opener === undefined ? "" : line.slice(opener + 1, index);
			if (
				opener !== undefined &&
				mark !== null &&
				(mark[1] as string).length <= LANGUAGE_TAG_MAX_LENGTH &&
				passage.trim().length > 0
			) {
				dropped.add(opener);
				const end = index + 1 + mark[0].length;
				for (let markIndex = index; markIndex < end; markIndex += 1) {
					dropped.add(markIndex);
				}
				index = end;
				continue;
			}
		}
		index += 1;
	}
	if (dropped.size === 0) return line;
	// By code unit, as the indices were taken — never by code point.
	return line
		.split("")
		.filter((_character, characterIndex) => !dropped.has(characterIndex))
		.join("");
}

/**
 * A slide's authored text as plain words.
 *
 * `question` and `body` are markdown, stored verbatim and resolved where they
 * are *rendered* (see **Authored slide text** in `docs/api.md`) — and this is a
 * renderer, so it resolves them the only way a PDF can: by dropping the markup
 * and keeping what it was marking up. Deliberately a **reduction** and not a
 * second implementation of the client's `SlideText`: bold that cannot be drawn
 * bold is not a reason to print `**bold**` at somebody, and a link's address is
 * kept beside its label because a printed page cannot be clicked.
 *
 * Line structure survives, because a body written as a list is a list.
 *
 * **Linear in the text, and that is load-bearing** (REQ213). Bun serves every
 * request from one thread, so a reduction that is quadratic in a field is a
 * request that stalls the whole process — and a field's own length cap is no
 * defence against work that grows with its square.
 * {@link withoutLanguageMarking} runs first and walks the line once: each `]`
 * pops one opener, its mark expression stops at the next `]` at the latest, and
 * the dropped positions are filtered out in one pass at the end.
 * The links and the bold are read by {@link reduceLinks} and
 * {@link reduceStrong} rather than by the expressions they replace, which
 * rescan the rest of the line from every opener that never closes. The
 * expressions that remain cannot: three are anchored at the start of the line,
 * and code and italic stop at their own next delimiter, so each opener's scan
 * ends where the next one's begins.
 */
export function plainTextFromMarkdown(markdown: string): string {
	return markdown
		.split("\n")
		.map((line) => {
			const unprefixed = withoutLanguageMarking(line)
				// Sub-headings (REQ089) — the hashes are the markup, not the words.
				.replace(/^\s{0,3}#{1,6}\s+/, "")
				// A list marker becomes a bullet the reader can see.
				.replace(/^\s*[-*+]\s+/, "• ")
				.replace(/^\s*(\d+)\.\s+/, "$1. ");
			// A link keeps both halves: nothing on paper can follow the label.
			const unlinked = reduceLinks(unprefixed).replace(/`([^`]*)`/g, "$1");
			return reduceStrong(unlinked)
				.replace(/(\*|_)(?=\S)([^*_]*?\S)\1/g, "$2")
				.trimEnd();
		})
		.join("\n")
		.trim();
}

/**
 * Every `[label](address)` on a line as `label (address)` — exactly what
 * `/\[([^\]]*)\]\(([^)]+)\)/g` replaced with `"$1 ($2)"` produces, read in one
 * pass instead.
 *
 * The expression scans from each `[` to the next `]`, so a line of `[` with no
 * `]` costs it the rest of the line once per bracket (REQ213). Here a failed
 * `[` hands its verdict to every `[` up to the `]` it reached, because each of
 * those reaches the same `]` and fails the same way — so the scan resumes past
 * it — and a missing `]` or `)` ends the line's links outright, since no later
 * opener could find one either.
 */
function reduceLinks(line: string): string {
	let output = "";
	let copied = 0;
	let open = line.indexOf("[");
	while (open !== -1) {
		const close = line.indexOf("]", open + 1);
		if (close === -1) break;
		if (line[close + 1] === "(") {
			const end = line.indexOf(")", close + 2);
			if (end === -1) break;
			// `[^)]+` — an empty address is not a link.
			if (end > close + 2) {
				output += `${line.slice(copied, open)}${line.slice(open + 1, close)} (${line.slice(close + 2, end)})`;
				copied = end + 1;
				open = line.indexOf("[", copied);
				continue;
			}
		}
		open = line.indexOf("[", close + 1);
	}
	return output + line.slice(copied);
}

/** What `\s` matches, asked of one character. */
const WHITESPACE = /\s/;

/**
 * Every `**bold**` and `__bold__` on a line as its words — exactly what
 * `/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g` replaced with `"$2"` produces: an opener
 * followed by a non-space, closed by the first matching pair that follows a
 * non-space.
 *
 * The expression searches the rest of the line for that closer from every
 * opener, so a line of openers that never close costs it the rest of the line
 * once per opener (REQ213). An opener that finds no closer proves that no later
 * opener of the same pair can — any closer after a later opener is after this
 * one too — so each pair is searched to the end of the line at most once.
 */
function reduceStrong(line: string): string {
	let output = "";
	let copied = 0;
	const unclosable = new Set<string>();
	let index = 0;
	while (index + 2 < line.length) {
		const pair = line.slice(index, index + 2);
		if (
			(pair !== "**" && pair !== "__") ||
			unclosable.has(pair) ||
			WHITESPACE.test(line[index + 2] as string)
		) {
			index += 1;
			continue;
		}
		let closer = line.indexOf(pair, index + 3);
		while (closer !== -1 && WHITESPACE.test(line[closer - 1] as string)) {
			closer = line.indexOf(pair, closer + 1);
		}
		if (closer === -1) {
			unclosable.add(pair);
			index += 1;
			continue;
		}
		output += line.slice(copied, index) + line.slice(index + 2, closer);
		copied = closer + 2;
		index = copied;
	}
	return output + line.slice(copied);
}

// ── Building the document ────────────────────────────────────

/** How a slide is titled when its author wrote no question. */
function slideHeading(slide: Slide): string {
	const question = plainTextFromMarkdown(slide.question);
	return question.length > 0 ? question : `(untitled ${SLIDE_TYPE_LABELS[slide.type]})`;
}

/** Every non-empty note in order — the caller need not filter its own list. */
function notes(...lines: (string | null)[]): PdfBlock[] {
	return lines
		.filter((line): line is string => typeof line === "string" && line.length > 0)
		.map((text) => ({ kind: "note", text }) as PdfBlock);
}

/** A bulleted block, or nothing at all when the list is empty. */
function bullets(items: string[]): PdfBlock[] {
	return items.length > 0 ? [{ kind: "bullets", items }] : [];
}

/** How many options one participant may hold, in words (REQ014). */
function selectionRule(slide: Slide): string {
	const limit = maxSelectionsFor(slide);
	if (limit === 0) return "Participants may select as many options as they like.";
	if (limit === 1) return "Participants select one option.";
	return `Participants select up to ${limit} options.`;
}

/**
 * The two ends of a scale or an axis in words, or `null` when its author named
 * neither.
 *
 * Spelled `0 = Slow, 10 = Fast` rather than with an arrow between them, and
 * that is a rendering decision rather than a stylistic one: an arrow is not a
 * character the embedded face has a glyph for, so it would reach the page as
 * the mark {@link faceText} folds it to (the client refuses arrows as icons
 * for its own reasons; here they simply cannot be drawn).
 */
function endLabels(
	ends: { min: number; max: number; minLabel: string; maxLabel: string },
): string | null {
	const low = ends.minLabel.trim();
	const high = ends.maxLabel.trim();
	const named = [
		low.length > 0 ? `${ends.min} = ${low}` : null,
		high.length > 0 ? `${ends.max} = ${high}` : null,
	].filter((part): part is string => part !== null);
	return named.length > 0 ? named.join(", ") : null;
}

/**
 * The quiz window as the live room actually plays it. Read through
 * `quizTimeLimitFor`, which treats an authored `0` (the editor's "Off") and any
 * out-of-range value as *no countdown* — a handout must not claim a
 * zero-second window for a question that never closes on its own.
 */
function quizTimeLimitLine(slide: Slide): string {
	const limit = quizTimeLimitFor(slide);
	return limit === null
		? "No time limit — every correct answer scores the same."
		: `Time limit: ${limit} seconds.`;
}

/** One axis of a 2x2 grid, named as its author named it (REQ048). */
function axisLine(name: string, axis: GridAxis): string {
	const title = axis.title.trim().length > 0 ? axis.title.trim() : name;
	const labels = endLabels(axis);
	const range = `${axis.min} to ${axis.max}`;
	return labels
		? `${name} axis — ${title}: ${range} (${labels})`
		: `${name} axis — ${title}: ${range}`;
}

/**
 * What this slide *asked*, and what it offered to answer with — the half of the
 * document that is there whether or not results were requested.
 *
 * Every branch reads the slide through the same resolvers the live surfaces do
 * (`formFieldsFor`, `gridAxesFor`, `guessRangeFor`, `maxSelectionsFor`,
 * `quizAnswerModeFor`, `acceptedQuizAnswers`, `leaderboardSizeFor`,
 * `countdownSecondsFor`), so a
 * hand-built deck's out-of-range value is folded here exactly as it is on the
 * phone rather than printed raw.
 */
export function questionBlocksFor(slide: Slide): PdfBlock[] {
	const blocks: PdfBlock[] = [];

	if (isContentSlideType(slide.type)) {
		const body = plainTextFromMarkdown(slide.body);
		if (body.length > 0) blocks.push({ kind: "paragraph", text: body });
	}

	// The media a slide carries is named rather than drawn — see the header of
	// this module for why an exporter does not fetch a URL a caller authored.
	// A pin slide's picture is the question rather than an illustration, which is
	// the distinction `slideMediaIsInteractionArea` exists to make.
	if (slide.mediaUrl.trim().length > 0) {
		blocks.push(
			...notes(
				slideMediaIsInteractionArea(slide.type)
					? `Pin target image: ${slide.mediaUrl.trim()}`
					: `Media: ${slide.mediaUrl.trim()}`,
			),
		);
	}

	switch (slide.type) {
		case "multiple-choice":
			blocks.push({ kind: "label", text: "Options" });
			blocks.push(
				...bullets(slide.options.map((option) => option.text)),
				...notes(selectionRule(slide)),
			);
			return blocks;

		case "quiz": {
			// The answer key is drawn in full — this route is authorized as an edit
			// for exactly that reason (REQ056), and a quiz handout with the answers
			// withheld from its author would be the room's copy rather than theirs.
			if (quizAnswerModeFor(slide) === "type") {
				const accepted = acceptedQuizAnswers(slide);
				blocks.push({ kind: "label", text: "Accepted answers" });
				blocks.push(
					...(accepted.length > 0
						? bullets(accepted)
						: notes("No answer is marked correct, so nobody scores.")),
					...notes("Participants type their answer.", quizTimeLimitLine(slide)),
				);
				return blocks;
			}
			blocks.push({ kind: "label", text: "Options" });
			blocks.push(
				...bullets(
					slide.options.map((option) =>
						option.isCorrect ? `${option.text} (correct)` : option.text,
					),
				),
				...notes(
					slideHasCorrectAnswers(slide)
						? null
						: "No option is marked correct, so nobody scores.",
					quizTimeLimitLine(slide),
				),
			);
			return blocks;
		}

		case "word-cloud":
		case "open-text":
			return [
				...blocks,
				...notes(
					slide.type === "word-cloud"
						? "Participants submit words."
						: "Participants submit open responses.",
					slide.allowResponseVotes
						? "Responses can be upvoted by the room."
						: null,
				),
			];

		case "scale": {
			const statements = slide.scaleStatements;
			const labels = endLabels({
				min: slide.scaleMin,
				max: slide.scaleMax,
				minLabel: slide.scaleMinLabel,
				maxLabel: slide.scaleMaxLabel,
			});
			blocks.push(
				...notes(
					labels
						? `Scale ${slide.scaleMin} to ${slide.scaleMax} (${labels})`
						: `Scale ${slide.scaleMin} to ${slide.scaleMax}`,
					slide.scaleAllowSkip ? "Statements may be skipped." : null,
				),
			);
			if (statements.length > 0) {
				blocks.push({ kind: "label", text: "Statements" });
				blocks.push(...bullets(statements.map((statement) => statement.text)));
			}
			return blocks;
		}

		case "ranking":
			blocks.push({ kind: "label", text: "Items to order" });
			return [...blocks, ...bullets(slide.rankingItems.map((item) => item.text))];

		case "points":
			blocks.push({ kind: "label", text: "Items to fund" });
			return [
				...blocks,
				...bullets(slide.pointsItems.map((item) => item.text)),
				...notes(`Each participant distributes ${POINTS_BUDGET} points.`),
			];

		case "grid": {
			const { xAxis, yAxis } = gridAxesFor(slide);
			blocks.push(
				...notes(
					axisLine("X", xAxis),
					axisLine("Y", yAxis),
					slide.gridAllowSkip ? "Items may be marked not assessable." : null,
				),
			);
			blocks.push({ kind: "label", text: "Items to place" });
			return [...blocks, ...bullets(slide.gridItems.map((item) => item.text))];
		}

		case "guess-number": {
			const range = guessRangeFor(slide);
			const reference = slide.guessReference;
			return [
				...blocks,
				...notes(
					`Range ${range.min} to ${range.max}, in steps of ${range.step}.`,
					reference
						? `Correct answer: ${reference.value} (±${reference.tolerance}).`
						: "No correct answer is set, so nobody scores.",
				),
			];
		}

		case "pin-image": {
			const area = slide.pinArea;
			return [
				...blocks,
				...notes(
					area
						? `Target area: ${area.x}, ${area.y} to ${area.x + area.width}, ${area.y + area.height} (per mille).`
						: "No target area is set, so no pin is right or wrong.",
				),
			];
		}

		case "form": {
			const fields = formFieldsFor(slide);
			blocks.push({ kind: "label", text: "Fields" });
			return [
				...blocks,
				...bullets(
					fields.map((field) => {
						const shape = [field.type, field.required ? "required" : "optional"].join(
							", ",
						);
						const options =
							field.options.length > 0
								? ` — ${field.options.map((option) => option.text).join(", ")}`
								: "";
						return `${field.label} (${shape})${options}`;
					}),
				),
			];
		}

		case "leaderboard":
			return [
				...blocks,
				...notes(
					`Shows the top ${leaderboardSizeFor(slide)} across the deck's quiz questions.`,
				),
			];

		case "countdown":
			return [
				...blocks,
				...notes(`Counts down from ${formatCountdown(countdownSecondsFor(slide))}.`),
			];

		default:
			return blocks;
	}
}

/**
 * One slide's results, as blocks: its tally, then whatever the profanity filter
 * withheld from the room (REQ085).
 */
export function resultBlocksFor(
	slide: Slide,
	payload: SlideResultsPayload,
): PdfBlock[] {
	return [
		...tallyBlocksFor(slide, payload),
		...filteredAnswerBlocksFor(slide, payload),
	];
}

/**
 * The answers the profanity filter kept off the wall (REQ085), as written and
 * under a label that says so — after the tally the room saw, never inside it,
 * so the numbers above stay the numbers the screen drew. Nothing at all on a
 * slide where the filter withheld nothing.
 */
function filteredAnswerBlocksFor(
	slide: Slide,
	payload: SlideResultsPayload,
): PdfBlock[] {
	const withheld = filteredAnswerTextsFor(slide, payload);
	if (withheld.length === 0) return [];
	return [
		{ kind: "label", text: "Withheld from the room by the profanity filter" },
		...bullets(withheld.map((text) => (text.length > 0 ? text : EMPTY_VALUE))),
	];
}

/**
 * One slide's tally, as blocks.
 *
 * The whole of it is a re-layout of {@link aggregateRowsFor} — the flattening
 * the Aggregates sheet is written from — so the two exports cannot disagree
 * about a number, and neither can disagree with the screen. Rows about the
 * slide as a whole become a list of totals; rows about an entry are grouped
 * back per entry and drawn as bars when the aggregation published a share of
 * the whole for them, as a table when it did not.
 */
function tallyBlocksFor(slide: Slide, payload: SlideResultsPayload): PdfBlock[] {
	const rows = aggregateRowsFor(slide, payload);
	const blocks: PdfBlock[] = [{ kind: "label", text: "Results" }];

	const slideTotals = rows.filter((row) => row.entry === null);
	if (slideTotals.length > 0) {
		blocks.push({
			kind: "facts",
			facts: slideTotals.map((row) => ({
				label: row.metric,
				value: cellText(row.value),
			})),
		});
	}

	// Entries and metrics keep the order the aggregation published them in — the
	// authored option order, the ranked item order, the bucket order — because
	// that order is itself a result (a tie broken on the authored order stays
	// broken the same way, REQ033/REQ044).
	const entryOrder: string[] = [];
	const metricOrder: string[] = [];
	const byEntry = new Map<string, Map<string, SheetCell>>();
	for (const row of rows) {
		if (row.entry === null) continue;
		let metrics = byEntry.get(row.entry);
		if (!metrics) {
			metrics = new Map();
			byEntry.set(row.entry, metrics);
			entryOrder.push(row.entry);
		}
		if (!metricOrder.includes(row.metric)) metricOrder.push(row.metric);
		metrics.set(row.metric, row.value);
	}
	if (entryOrder.length === 0) return blocks;

	if (metricOrder.includes(SHARE_METRIC)) {
		const captionMetrics = metricOrder.filter((metric) => metric !== SHARE_METRIC);
		blocks.push({
			kind: "bars",
			bars: entryOrder.map((entry) => {
				const metrics = byEntry.get(entry) ?? new Map<string, SheetCell>();
				const share = metrics.get(SHARE_METRIC);
				return {
					label: entry.length > 0 ? entry : EMPTY_VALUE,
					caption: captionMetrics
						.map((metric) => `${metric}: ${cellText(metrics.get(metric) ?? null)}`)
						.join(" · "),
					share: typeof share === "number" ? share : null,
				};
			}),
		});
		return blocks;
	}

	blocks.push({
		kind: "table",
		columns: ["Entry", ...metricOrder],
		rows: entryOrder.map((entry) => {
			const metrics = byEntry.get(entry) ?? new Map<string, SheetCell>();
			return [
				entry.length > 0 ? entry : EMPTY_VALUE,
				...metricOrder.map((metric) => cellText(metrics.get(metric) ?? null)),
			];
		}),
	});
	return blocks;
}

/** The cover: what deck this is, and how much of it there is. */
function coverSection(
	presentation: Presentation,
	input: DeckPdfInput,
	participantCount: number,
): PdfSection {
	const interactiveCount = presentation.slides.filter((slide) =>
		isInteractiveSlideType(slide.type),
	).length;
	const facts: PdfFact[] = [
		{ label: "Join code", value: presentation.code },
		{ label: "Status", value: presentation.status },
		{ label: "Mode", value: presentation.mode },
		{ label: "Language", value: presentation.language },
		{ label: "Results visibility", value: presentation.resultsVisibility },
		{ label: "Slides", value: String(presentation.slides.length) },
		{ label: "Interactive slides", value: String(interactiveCount) },
	];
	if (input.includeResults) {
		facts.push(
			{ label: "Participants", value: String(participantCount) },
			// REQ076 — stated on the cover only when the deck actually asked, and
			// that is not a hidden control: this is a *fact sheet*, and a
			// line reading "Names required: no" on every handout of every anonymous
			// deck is noise about a setting nobody used. The two exports differ here
			// on purpose — a spreadsheet column is a schema and keeps its place
			// whatever it holds, a printed page is prose.
			...(input.presentation.requireParticipantName
				? [{ label: "Names required", value: "yes" }]
				: []),
			{ label: "Responses", value: String(input.votes.length) },
			{ label: "Response upvotes", value: String(input.responseVotes.length) },
		);
	}
	facts.push(
		{ label: "Created at", value: presentation.createdAt },
		{ label: "Exported at", value: input.exportedAt },
	);

	return {
		blocks: [
			{ kind: "title", text: presentation.title },
			{
				kind: "subtitle",
				text: input.includeResults
					? "The deck and the results it collected"
					: "The deck, without its collected results",
			},
			{ kind: "rule" },
			{ kind: "facts", facts },
			{
				kind: "note",
				text: input.includeResults
					? "Every tally here is the one the shared screen drew — this document reads the deck's results, it does not recompute them."
					: "This document holds the deck only. Re-export it with results to include what the room submitted.",
			},
		],
	};
}

/**
 * Who took part, by name — the deck's roster as a page of its own (REQ076).
 *
 * `null` when there is no roster to print: an export taken without results, a
 * session nobody answered, or one where no name was ever stated. A section is a
 * page, and an empty one is a page reading "Participants" over nothing.
 *
 * Gated on **names having been collected**, not on the deck's switch as it
 * stands today — the same stance `getResultsExport` takes when it reads the
 * roster unconditionally. An organizer who turns names off after a session still
 * has a session that collected them, and a handout that dropped them over a
 * setting changed afterwards would be a record of the session missing what the
 * session recorded. Names can only be collected while the switch is on, so
 * "any name was stated" already implies the deck asked.
 *
 * Built from the **votes**, not from the roster alone, and joined the way the
 * Participants sheet is (`respondentsIn`): the count on the cover and the
 * rows here then answer the same question — how many people answered — so a
 * handout cannot say twelve at the front and list nine at the back. Somebody
 * who stated a name and then answered nothing is not on it, for that reason;
 * somebody who answered without stating one is, under an explicit
 * {@link EMPTY_VALUE}, because dropping them would make the page a shorter list
 * than the number beside it.
 *
 * A device that went through the deck more than once (REQ083) is one row per
 * pass, for the same reason — the cover counted each pass — and the name it
 * stated once is carried by each of them, the later ones marked with their pass
 * so the page does not read as the same person listed twice by mistake.
 *
 * **No participant id is printed.** This codebase treats one as that
 * participant's only credential — it is what a vote, a question, a chat message
 * and a stated name are all accepted on — and this document is a handout by its
 * own description, the one artefact here most likely to be left on a table or
 * forwarded on. The id's only job on a page like this would be joining a row to
 * the workbook's Participants sheet, and that join is the workbook's own; what
 * this page is for is *who was here*, which a name and a participation count
 * say in full.
 *
 * The names are **listed and never joined to answers here**. The per-row detail
 * is the workbook's (REQ095), which is where an organizer reads a form; this
 * document is a handout, and a handout that printed who said what would be one
 * left on a table.
 */
function participantsSection(input: DeckPdfInput): PdfSection | null {
	if (!input.includeResults) return null;

	const respondents = respondentsIn(input.votes);
	if (respondents.length === 0) return null;
	const namedAnyone = respondents.some(
		(respondent) =>
			participantNameFor(input.participantNames, respondent.participantId) !==
			null,
	);
	if (!namedAnyone) return null;

	const answeredSlides = new Map<string, Set<string>>();
	for (const vote of input.votes) {
		const respondentId = respondentIdOf(vote);
		const seen = answeredSlides.get(respondentId) ?? new Set<string>();
		seen.add(vote.slideId);
		answeredSlides.set(respondentId, seen);
	}

	const rows = respondents
		.map(({ respondentId, participantId, pass }) => ({
			participantId,
			pass,
			name: participantNameFor(input.participantNames, participantId),
			answered: answeredSlides.get(respondentId)?.size ?? 0,
		}))
		// By name, as the roster on screen is ordered (`orderParticipantRoster`) —
		// with the unnamed rows last rather than first, since a page of dashes is
		// not what somebody opens this section to read. One device's passes stay
		// together, in the order they were made.
		.sort((left, right) => {
			if ((left.name === null) !== (right.name === null)) {
				return left.name === null ? 1 : -1;
			}
			const byName = (left.name ?? "").localeCompare(right.name ?? "", undefined, {
				sensitivity: "base",
			});
			return (
				byName ||
				left.participantId.localeCompare(right.participantId) ||
				left.pass - right.pass
			);
		});

	return {
		blocks: [
			{ kind: "label", text: "Participants" },
			{ kind: "heading", text: "Who took part" },
			{ kind: "rule" },
			{
				kind: "note",
				text: "Everyone joining this deck was asked to state a name. What each of them answered is in the spreadsheet export, not here.",
			},
			{
				kind: "table",
				columns: ["Name", "Slides answered"],
				rows: rows.map((row) => [
					rosterLabel(row.name ?? EMPTY_VALUE, row.pass),
					String(row.answered),
				]),
			},
		],
	};
}

/**
 * What one roster row is called (REQ076): the stated name, and — for a device's
 * second or later pass through the deck (REQ083) — which pass it is. A first pass
 * is the name alone, which is every row on a deck that never allowed another.
 */
export function rosterLabel(name: string, pass: number): string {
	return pass > FIRST_PASS ? `${name} (pass ${pass})` : name;
}

/**
 * Build the whole document. Pure: same input, same sections, every time — which
 * is what lets the tests assert on blocks rather than on a rendered file.
 */
export function buildDeckDocument(input: DeckPdfInput): PdfDocument {
	const { presentation, results, includeResults } = input;
	const roster = participantsSection(input);
	const resultsBySlideId = new Map(
		results.map((payload) => [String(payload.slideId ?? ""), payload]),
	);
	const total = presentation.slides.length;

	return {
		footer: presentation.title,
		sections: [
			// The workbook's own reading of "how many people answered?", composed
			// rather than re-derived, so the cover and the Summary sheet cannot come
			// to disagree — each pass a device made counting once (REQ083).
			coverSection(presentation, input, respondentIdsIn(input.votes).length),
			// REQ076 — directly behind the cover, ahead of the slides: it is a fact
			// about the session rather than about any one question, and the cover has
			// just said how many people there were.
			...(roster ? [roster] : []),
			...presentation.slides.map((slide, index): PdfSection => {
				const blocks: PdfBlock[] = [
					{
						kind: "label",
						text: `Slide ${index + 1} of ${total} · ${SLIDE_TYPE_LABELS[slide.type]}`,
					},
					{ kind: "heading", text: slideHeading(slide) },
					{ kind: "rule" },
					...questionBlocksFor(slide),
				];
				if (includeResults) {
					blocks.push(...resultBlocksFor(slide, resultsBySlideId.get(slide.id) ?? {}));
				}
				return { blocks };
			}),
		],
	};
}

// ── Rendering ────────────────────────────────────────────────
//
// Everything below turns a model into bytes. It decides nothing about content:
// every question of *what* the document says is already settled above.

/** A4, in PDF points. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 62;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

/**
 * The palette, taken from the app's own tokens (`src/index.css`) — the light
 * scheme's, because the page is paper.
 *
 * `ACCENT` is that scheme's `--color-accent` (REQ166), and it moved off the
 * retired tangerine when the house deck theme did (REQ168): an organizer who
 * runs a deck that never chose a theme sees these bars blue on the projector
 * and on every phone, and a print that answered `#ff6b35` would be the one
 * surface still disagreeing. It draws bar fill, the share percentage and the
 * section labels, so it is held to the text floor and not only the graphics
 * one: `#1f3bff` measures 6.71:1 on the page, where the tangerine measured
 * 2.94:1.
 */
const INK: RGB = rgb(0.06, 0.06, 0.07);
const MUTED: RGB = rgb(0.42, 0.41, 0.44);
const DIM: RGB = rgb(0.62, 0.61, 0.64);
const ACCENT: RGB = rgb(0.12, 0.23, 1);
const RULE: RGB = rgb(0.86, 0.85, 0.87);
const BAR_TRACK: RGB = rgb(0.93, 0.93, 0.94);

/** How far a line of text sits below the one above it. */
const LINE_HEIGHT = 1.36;

/**
 * The face the export is set in, as bytes: Noto Sans, regular and bold (SIL OFL
 * 1.1 — the notice travels in `public/licenses/OFL-1.1-fonts.txt`, see
 * `NOTICE.md` §3). It covers Latin, Latin Extended, Greek and Cyrillic.
 *
 * The hinted build, not the smaller unhinted one, and that is not about hinting:
 * pdf-lib's subsetter writes the unhinted build's glyphs out unreadable — every
 * reader tried drew blank boxes where the letters were — while the hinted build
 * subsets cleanly. Subsetting is what keeps an export at tens of kilobytes of
 * font rather than the whole face, so the face follows the subsetter.
 *
 * Imported as files so `bun build` carries them beside the bundled server; the
 * path is resolved against this module because the bundle names it relative to
 * itself, not to the working directory. Read when this module loads, so a server
 * whose fonts are missing fails at boot rather than at somebody's first export.
 */
const FACE_BYTES = {
	regular: readFileSync(resolve(import.meta.dir, regularFacePath)),
	bold: readFileSync(resolve(import.meta.dir, boldFacePath)),
};

/**
 * The face Chinese, Japanese and Korean are drawn in, as bytes: Sarasa Gothic
 * SC, regular (SIL OFL 1.1, same notice file as above). One file covers all
 * three — Han, kana and Hangul — and its CJK glyphs are Source Han Sans', the
 * design Noto Sans CJK is too, so it sits beside Noto Sans without a seam.
 *
 * One weight: a bold run draws its CJK characters in this regular face. In the
 * Simplified Chinese orthography, so a Japanese or Korean Han character whose
 * regional form differs is drawn in the Chinese one — legible, and the same
 * character, but not the local glyph.
 *
 * Chosen for the subsetter, the way the hinted Noto Sans was.
 * `@pdf-lib/fontkit` writes a subset's glyph offsets in the short `loca` format
 * whenever they fit, which halves them, and does not pad the glyph records to
 * make that exact — so a face whose glyph records have odd lengths subsets into
 * glyphs that start a byte off, and readers draw them blank or not at all.
 * Noto Sans CJK ships only CFF outlines, whose subsets poppler refuses outright,
 * and Google's static Noto Sans SC / KR TTFs have odd-length records; Sarasa's
 * hinted build goes through ttfautohint, which aligns every record, and it
 * subsets cleanly. A face that replaces it has to pass the same check on a
 * rendered page, and the even-offset test in `deck-pdf.schemas.test.ts`.
 *
 * About 24 MB, read when this module loads for the reason the faces above are.
 * Never embedded whole: an export with no CJK in it does not embed it at all,
 * and one that has some carries the glyphs it draws.
 */
const CJK_FACE_BYTES = readFileSync(resolve(import.meta.dir, cjkFacePath));

/**
 * The face emoji are drawn in, as bytes: GNU Unifont 15.0.06 (dual-licensed
 * SIL OFL 1.1 and GPLv2+ with the font embedding exception, used under the
 * OFL; same notice file as above). One face in two files, split where Unifont
 * splits it: the Basic Multilingual Plane (`❤`, `✅`, `⭐`, `☕`) and the planes
 * above it, where nearly all emoji live (`😀`, `👍`, `🎉`).
 *
 * Monochrome, drawn on a 16-pixel grid — each emoji is a legible black
 * pictograph rather than the picture a phone shows, and one weight, so a bold
 * run draws its emoji in this face as it draws its CJK in the regular one.
 *
 * Chosen for the subsetter, as the faces above were. The monochrome emoji faces
 * with outline designs — Noto Emoji, in its current and its 2020 builds, and
 * OpenMoji's black build — all have odd-length glyph records, and poppler drew
 * them blank or in fragments; Unifont's records are all even, and it draws
 * cleanly in poppler and macOS Quartz. 15.0.06 is its last release with
 * TrueType outlines — later ones ship CFF only, whose subsets poppler refuses —
 * so it draws the emoji of Unicode 15.0 and earlier. One added since (`🫩`,
 * `🫪`) has only a hex-code placeholder in it, which is not drawn: it folds like
 * any character no face has (see {@link isUnifontPlaceholder}).
 *
 * About 25 MB between the two files, read when this module loads for the reason
 * the faces above are. Never embedded whole: an export with no emoji does not
 * embed either file, and one that has some carries the glyphs it draws.
 */
const EMOJI_FACE_BYTES = [
	readFileSync(resolve(import.meta.dir, emojiFacePath)),
	readFileSync(resolve(import.meta.dir, emojiUpperFacePath)),
];

/**
 * The code points both weights of the face have a glyph for. One set for both,
 * so a run folds the same way whichever weight it is drawn in.
 */
const FACE_COVERAGE: ReadonlySet<number> = (() => {
	const bold = new Set(fontkit.create(FACE_BYTES.bold).characterSet);
	return new Set(
		fontkit
			.create(FACE_BYTES.regular)
			.characterSet.filter((codePoint) => bold.has(codePoint)),
	);
})();

/**
 * The C0 controls and DEL — whitespace and formatting, never letters. Folded to
 * a space before the coverage question is asked; see {@link faceText}.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * Variation selectors — invisible by design, picking a glyph variant of the
 * character before them (a Japanese name's Han variant, emoji presentation).
 * Dropped before the fold: no face draws them, and folded on their own they
 * would put a `?` straight after a CJK character or an emoji a face does draw.
 */
const VARIATION_SELECTORS = /[︀-️\u{E0100}-\u{E01EF}]/gu;

/**
 * The parts of an emoji sequence that only join, colour or enclose the emoji
 * around them, dropped for the reason variation selectors are: the zero-width
 * joiner, the five skin tones, the enclosing keycap, and the tag characters that
 * spell a subdivision flag after `🏴` (England's is `🏴` and `gbeng` in tags).
 *
 * The emoji face draws no ligatures, so a joiner has nothing to join, and the
 * shaping pass `drawText` makes swaps it for a space glyph — a gap on the page
 * and a space in copied text, where the width measured was zero. The face is
 * monochrome, so a tone has nothing to show: Unifont draws one standing alone as
 * a swatch, which after a `👋` would read as a stray box. Its keycap is a mark
 * with no width that is drawn a full emoji's width back from where it stands, so
 * after a digit narrower than that it boxes the space or the character before
 * it too. Tags are invisible by design. What they joined, coloured or enclosed
 * is drawn plain: a family as its members side by side, `👋🏽` as `👋`, a keycap
 * as its digit, England's flag as `🏴`. Dropping the joiner everywhere costs
 * nothing elsewhere: the scripts that use it outside emoji are ones no face
 * draws, which fold whole.
 */
const EMOJI_SEQUENCE_MARKS = /[\u200D\u20E3\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu;

function isInFace(character: string): boolean {
	return FACE_COVERAGE.has(character.codePointAt(0) ?? 0);
}

/**
 * The characters of the Chinese, Japanese and Korean writing systems: Han,
 * kana, Hangul and Bopomofo, with the punctuation Unicode files under those
 * scripts (`、`, `。`, `「」`, `ー`); the rest of the CJK Symbols and Punctuation
 * block; and the full-width punctuation CJK text is typed with (`，`, `？`,
 * `（）`). Not the full-width letters and digits: `Ａ` and `１` still fold to
 * the `A` and `1` the text face draws.
 */
const CJK_SCRIPT =
	/[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\p{scx=Bopomofo}　-〿！-／：-＠［-｀｛-･]/u;

/**
 * Emoji: the pictographs (`\p{Extended_Pictographic}` — `😀`, `❤`, `✈`), and
 * the characters drawn as emoji by default (`\p{Emoji_Presentation}`, which adds
 * the regional indicators a flag is spelled in). Not the digits, `#` and `*` a
 * keycap encloses, which the text face draws.
 */
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;

/**
 * A face a character is drawn in when the text face has no glyph for it: its
 * bytes, embedded only into a document that needs them, and the code points it
 * draws.
 */
type FallbackFace = { bytes: Buffer; coverage: ReadonlySet<number> };

/**
 * The code points of `bytes` that `draws` admits, and only those.
 *
 * Each fallback face has Latin, arrows and symbols too, and drawing those from
 * it would set a deck's Latin text in two designs at once and widen what that
 * face is for; outside its own set the fold decides, as it did before.
 */
function fallbackFace(
	bytes: Buffer,
	draws: (face: Font, codePoint: number) => boolean,
): FallbackFace {
	const face = fontkit.create(bytes);
	return {
		bytes,
		coverage: new Set(face.characterSet.filter((codePoint) => draws(face, codePoint))),
	};
}

/**
 * The outline of a solid square filling Unifont's whole cell, from its top-left
 * corner (0, 832) to its bottom-right (1024, -64), as fontkit writes it.
 */
const UNIFONT_PLACEHOLDER_CELL = "M0 832Q0 832 0 -64L1024 -64Q1024 -64 1024 832Z";

/**
 * Whether Unifont's glyph for `codePoint` is a placeholder rather than a
 * drawing: the code point's hex digits knocked out of a solid square.
 *
 * Unifont maps every code point of its planes, and 15.0.06 has a drawing only
 * for what Unicode had assigned by 15.0. The rest is mapped too, to that square
 * — every reserved code point in the emoji blocks, and the emoji Unicode 16.0
 * and 17.0 added later (`🫩`, `🫪`, …) — so a cmap lookup says the face draws
 * them, and the page would show `01F` over `AE9` where an emoji was written. No
 * emoji drawing in either file traces the whole cell, so the square is the
 * test; a placeholder's code point is left out of the face and folds like any
 * other character no face has.
 */
function isUnifontPlaceholder(face: Font, codePoint: number): boolean {
	return face.glyphForCodePoint(codePoint).path.toSVG().includes(UNIFONT_PLACEHOLDER_CELL);
}

/**
 * The fallback faces, in the order a character is offered to them: the CJK
 * face first, so the few characters both it and the emoji face claim (`〰`,
 * `㊗`) are drawn as they were before the emoji face existed, then the emoji
 * face's two files.
 */
const FALLBACK_FACES: readonly FallbackFace[] = [
	fallbackFace(CJK_FACE_BYTES, (_face, codePoint) =>
		CJK_SCRIPT.test(String.fromCodePoint(codePoint)),
	),
	...EMOJI_FACE_BYTES.map((bytes) =>
		fallbackFace(
			bytes,
			(face, codePoint) =>
				EMOJI.test(String.fromCodePoint(codePoint)) && !isUnifontPlaceholder(face, codePoint),
		),
	),
];

/** The fallback face that draws `character`, if one does. */
function fallbackFaceFor(character: string): FallbackFace | undefined {
	const codePoint = character.codePointAt(0) ?? 0;
	return FALLBACK_FACES.find((face) => face.coverage.has(codePoint));
}

function isDrawable(character: string): boolean {
	return isInFace(character) || fallbackFaceFor(character) !== undefined;
}

/**
 * Fold text into what the embedded faces can draw.
 *
 * Composed first (NFC), so a letter typed as base-plus-accent is drawn from the
 * face's own precomposed glyph rather than as two glyphs stacked by guesswork.
 * Then three steps, weakest loss first. A character any face has is kept — all
 * of Latin, Latin Extended, Greek and Cyrillic from Noto Sans, so `ł`, `č`, `Ω`
 * and `Ї` print as authored, Chinese, Japanese and Korean from the CJK face,
 * and emoji from the emoji face. One none has is decomposed and stripped of its
 * combining marks, keeping whatever of it they can draw — a full-width `Ａ`
 * prints as `A`. What survives none is a script these faces cannot express at
 * all — Arabic, Hebrew, Devanagari, Thai and every other script beyond the ones
 * above, and an emoji newer than Unicode 15.0 — and a run of it collapses to
 * a single `?`: seven question marks in a row say no more than one does, and
 * the alternative — `drawText` drawing a blank box, or throwing on a character
 * it cannot encode — would put nothing legible on the page, or fail the whole
 * export over one word somebody typed.
 *
 * An emoji written as a sequence is drawn as its parts, each from the face that
 * has it: the face draws no ligatures, so a family joined by zero-width joiners
 * prints as its members side by side, a flag as the two boxed letters of its
 * regional indicators, and a keycap as its digit. Joiners, skin tones, keycaps
 * and flag tags are dropped with the variation selectors, before any of this —
 * see {@link EMOJI_SEQUENCE_MARKS}.
 *
 * Which face draws what this keeps is {@link fontFor}'s question, not this one's.
 *
 * Control characters are **whitespace, not an unencodable script**, and are
 * folded to a space before any of that: a tab is ordinary in an indented
 * markdown list and a stray `\r` rides every CRLF-authored deck, and neither is
 * a character somebody meant to print. Read as "not in the face" they would
 * come out as a literal `?` in the middle of a sentence; read as space they are
 * collapsed by the wrapper's own whitespace split, which is what they are.
 */
export function faceText(text: string): string {
	let output = "";
	let dropped = false;
	const visible = text
		.replace(CONTROL_CHARACTERS, " ")
		.replace(VARIATION_SELECTORS, "")
		.replace(EMOJI_SEQUENCE_MARKS, "");
	for (const character of visible.normalize("NFC")) {
		if (isDrawable(character)) {
			output += character;
			dropped = false;
			continue;
		}
		const folded = Array.from(
			character.normalize("NFKD").replace(/\p{M}/gu, ""),
		)
			.filter(isDrawable)
			.join("");
		if (folded.length > 0) {
			output += folded;
			dropped = false;
			continue;
		}
		if (!dropped) output += "?";
		dropped = true;
	}
	return output;
}

/**
 * One weight of the text face, and the fallback faces the rest of its
 * characters are drawn in — only those the document needs, so one with no CJK
 * or no emoji does not embed that face at all (see {@link renderDeckDocument}).
 */
type Typeface = { text: PDFFont; fallbacks: ReadonlyMap<FallbackFace, PDFFont> };

/**
 * The font a character is drawn in: the text face for whatever it has, and the
 * fallback face that has it for the rest of what {@link faceText} kept — which,
 * past that fold, is only ever CJK or emoji.
 */
function fontFor(character: string, typeface: Typeface): PDFFont {
	if (isInFace(character)) return typeface.text;
	const fallback = fallbackFaceFor(character);
	return (fallback && typeface.fallbacks.get(fallback)) ?? typeface.text;
}

/**
 * Split text into the runs each face draws — `drawText` takes one font, so a
 * line that mixes scripts is drawn as several calls at advancing x.
 */
function faceRuns(
	text: string,
	typeface: Typeface,
): { text: string; font: PDFFont }[] {
	const runs: { text: string; font: PDFFont }[] = [];
	for (const character of text) {
		const font = fontFor(character, typeface);
		const current = runs.at(-1);
		if (current !== undefined && current.font === font) {
			current.text += character;
		} else {
			runs.push({ text: character, font });
		}
	}
	return runs;
}

/** Each typeface's width of every character it has measured, at size 1. */
const CHARACTER_WIDTHS = new WeakMap<Typeface, Map<string, number>>();

/**
 * How wide `text` is drawn in `typeface` at `size` — the sum of its characters'
 * widths, each asked of `pdf-lib` once per typeface, in the face that character
 * is drawn in, and remembered.
 *
 * Not `widthOfTextAtSize` on the whole string, because for an embedded face that
 * runs the font's full shaping pass over every character it is handed, and the
 * wrapper below measures the same text many times over: a 160,000-character run
 * took 6.8s to render that way, against half a second with the standard fonts.
 * Summed per character it is a table lookup, and the same render takes 0.9s,
 * most of it the one shaping pass `drawText` makes per line. The faces draw each
 * character with its own advance — no kerning reaches the page — so the sum is
 * the width `drawText` puts down, and a line drawn from two faces is measured
 * per segment, each in its own face, by the same sum.
 */
function textWidth(text: string, typeface: Typeface, size: number): number {
	let widths = CHARACTER_WIDTHS.get(typeface);
	if (!widths) {
		widths = new Map();
		CHARACTER_WIDTHS.set(typeface, widths);
	}
	let total = 0;
	for (const character of text) {
		let width = widths.get(character);
		if (width === undefined) {
			width = fontFor(character, typeface).widthOfTextAtSize(character, 1);
			widths.set(character, width);
		}
		total += width;
	}
	return total * size;
}

/**
 * Draw one line of folded text, each run in the face that has it, starting at
 * `x` and advancing by what each run measured.
 */
function drawFaceText(
	page: PDFPage,
	text: string,
	options: { x: number; y: number; size: number; font: Typeface; color: RGB },
): void {
	let x = options.x;
	for (const run of faceRuns(text, options.font)) {
		page.drawText(run.text, {
			x,
			y: options.y,
			size: options.size,
			font: run.font,
			color: options.color,
		});
		x += textWidth(run.text, options.font, options.size);
	}
}

/**
 * How much of `text` fits in `width` — the longest prefix, never fewer than one
 * character so a caller breaking a run into chunks always advances.
 *
 * **Binary search, not a walk down from the end.** {@link textWidth} measures
 * the whole string it is handed, so probing one character at a time costs
 * O(n) measurements of O(n) each. Bun serves on one thread, so a quadratic wrap
 * here is not a slow request but a wedged process: measured before this was a
 * search, a 4,000-character unbroken token took 2.8s and 8,000 took 19.7s.
 *
 * The search alone is not enough, because it is still handed the *whole*
 * remaining run: O(log n) probes of O(n) each, once per ~300 characters
 * emitted, is Θ(n²·log n) again. What bounds it is the caller — `wrapLine`
 * hands this a window of {@link WRAP_PROBE_CHARACTERS}, never the whole tail —
 * so `text` here is short by construction and the two together are linear.
 *
 * Counted in UTF-16 units, so the answer is moved off the middle of a surrogate
 * pair: the face draws a few letters beyond the Basic Multilingual Plane, and a
 * pair broken across two lines would print as two boxes.
 */
function fittingPrefix(
	text: string,
	typeface: Typeface,
	size: number,
	width: number,
): number {
	let low = 1;
	let high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (textWidth(text.slice(0, middle), typeface, size) <= width) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}
	const last = text.charCodeAt(low - 1);
	if (low < text.length && last >= 0xd800 && last <= 0xdbff) {
		return low > 1 ? low - 1 : low + 1;
	}
	return low;
}

/**
 * How much of an over-wide run {@link wrapLine} measures at a time while
 * breaking it into lines.
 *
 * The window exists so the cost of breaking a run is proportional to the run
 * rather than to its square: without it, every ~300 characters emitted costs a
 * binary search over the entire remaining tail, which is what let a single
 * authored field wedge the process (REQ159).
 *
 * 64 is a floor, not a ceiling. The loop doubles the window whenever the whole
 * of it fits — which is the only case where a wider window could have said
 * something different — so the answer is the same one an unbounded search
 * gives, at any starting value. It is small because the widest column here is
 * `CONTENT_WIDTH` at the largest size drawn, where about twenty characters fit;
 * the smallest text on the widest column reaches roughly three hundred, and the
 * doubling walks up to that once per line and then stays there.
 */
const WRAP_PROBE_CHARACTERS = 64;

/** Break one line into as many as it takes to fit `width`. */
function wrapLine(
	text: string,
	typeface: Typeface,
	size: number,
	width: number,
): string[] {
	const lines: string[] = [];
	let current = "";
	for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
		const candidate = current.length > 0 ? `${current} ${word}` : word;
		// Emptiness is asked first so that the *one* word that is always accepted
		// unmeasured — the first on a line — is never measured. It is the only
		// candidate here that can be arbitrarily long, and measuring it would be an
		// O(n) pass whose answer is discarded.
		if (current.length === 0 || textWidth(candidate, typeface, size) <= width) {
			current = candidate;
			continue;
		}
		lines.push(current);
		current = word;
	}
	// A single word wider than the column is broken by character rather than
	// pushed past the margin — a pasted URL is the ordinary case, and a line that
	// runs off the page is not a rendering of it.
	//
	// Only ever a window of the run is measured (see WRAP_PROBE_CHARACTERS): the
	// window widens while the whole of it still fits, and the moment it does not,
	// the longest fitting prefix lies strictly inside it — so a wider window
	// could not have found a longer one, and the break is where an unbounded
	// search would have put it.
	const broken: string[] = [];
	for (const line of [...lines, current]) {
		if (line.length === 0) continue;
		let start = 0;
		// Widened, never narrowed, and carried across the whole line: the font, the
		// size and the column are the same for every chunk of it, so the width that
		// fits is too — the doubling settles on the first chunk and costs nothing
		// on the rest.
		let windowSize = WRAP_PROBE_CHARACTERS;
		while (start < line.length) {
			let windowText = line.slice(start, start + windowSize);
			let cut = fittingPrefix(windowText, typeface, size, width);
			while (cut === windowText.length && start + windowText.length < line.length) {
				windowSize *= 2;
				windowText = line.slice(start, start + windowSize);
				cut = fittingPrefix(windowText, typeface, size, width);
			}
			broken.push(windowText.slice(0, cut));
			start += cut;
		}
	}
	return broken.length > 0 ? broken : [""];
}

/**
 * The export's line breaking alone, for body text across the content column,
 * without drawing a line of it — so the linear-time test (REQ096) can time the
 * wrap by itself. A render's wall-clock cannot: drawing shapes every line in
 * Noto Sans (REQ158), a linear cost large enough to hide a quadratic wrap.
 */
export async function bodyTextWrapper(): Promise<(text: string) => string[]> {
	const document = await PDFDocument.create();
	document.registerFontkit(fontkit);
	const typeface: Typeface = {
		text: await document.embedFont(FACE_BYTES.regular, { subset: true }),
		fallbacks: new Map(),
	};
	return (text) => wrapLine(text, typeface, 11, CONTENT_WIDTH);
}

type Fonts = { regular: Typeface; bold: Typeface };

/**
 * How long the renderer works before it hands the thread back (REQ213).
 *
 * Bun serves every request from one thread, and a deck at its caps
 * (`SLIDE_LIMIT` slides, every field at its length limit) takes on the
 * order of a second to lay out — linear work, but a second all the same. Done
 * in one stretch, that second is a second in which no other request is
 * answered: not a vote, not a join, not a health check. So the renderer works
 * in slices and yields between them, and the longest anything else waits on an
 * export is about one slice rather than the whole render.
 *
 * Ten milliseconds is short enough that a vote landing mid-export is not
 * noticeably late, and long enough that the yields themselves cost nothing a
 * reader would see: a worst-case render yields about a hundred and fifty times.
 */
export const RENDER_SLICE_MS = 10;

/**
 * A function that, once {@link RENDER_SLICE_MS} has passed since it last
 * yielded, waits for the event loop to run whatever else is ready — and
 * otherwise returns at once. Called between units of work small enough that
 * none of them is itself a long stall.
 */
function createYielder(sliceMs: number): () => Promise<void> {
	let sliceStartedAt = performance.now();
	return async () => {
		if (performance.now() - sliceStartedAt < sliceMs) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		sliceStartedAt = performance.now();
	};
}

/**
 * The page the renderer is currently writing onto, and how far down it is.
 *
 * A factory closure rather than a class: the whole of the flow is
 * "put this at the cursor, and start a page when it will not fit", and every
 * block draws through the same two calls.
 */
function createFlow(
	document: PDFDocument,
	fonts: Fonts,
	yieldIfDue: () => Promise<void>,
) {
	let page: PDFPage | null = null;
	let cursorY = 0;

	function newPage(): PDFPage {
		page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
		cursorY = PAGE_HEIGHT - MARGIN_TOP;
		return page;
	}

	/** The page with room for `height` — a fresh one when this has none left. */
	function fit(height: number): PDFPage {
		if (!page) return newPage();
		if (cursorY - height < MARGIN_BOTTOM) return newPage();
		return page;
	}

	function text(
		lines: string[],
		options: {
			size: number;
			font: Typeface;
			color: RGB;
			indent?: number;
			gapBefore?: number;
			gapAfter?: number;
		},
	): void {
		const step = options.size * LINE_HEIGHT;
		cursorY -= options.gapBefore ?? 0;
		for (const line of lines) {
			const target = fit(step);
			drawFaceText(target, line, {
				x: MARGIN_X + (options.indent ?? 0),
				y: cursorY - options.size,
				size: options.size,
				font: options.font,
				color: options.color,
			});
			cursorY -= step;
		}
		cursorY -= options.gapAfter ?? 0;
	}

	return {
		startSection(): void {
			newPage();
		},
		/**
		 * Leave `height` of blank page behind. Never breaks: a page whose last
		 * inch is whitespace is the shape a gap has, and one that started a fresh
		 * page to hold nothing would open every list with an empty leaf.
		 */
		gap(height: number): void {
			cursorY -= height;
		},
		/** Draw one wrapped run of prose. */
		prose(
			body: string,
			options: {
				size: number;
				font: Typeface;
				color: RGB;
				indent?: number;
				gapBefore?: number;
				gapAfter?: number;
			},
		): void {
			const width = CONTENT_WIDTH - (options.indent ?? 0);
			const lines = body
				.split("\n")
				.flatMap((line) =>
					line.trim().length === 0
						? [""]
						: wrapLine(faceText(line), options.font, options.size, width),
				);
			text(lines, options);
		},
		rule(): void {
			const target = fit(14);
			cursorY -= 7;
			target.drawLine({
				start: { x: MARGIN_X, y: cursorY },
				end: { x: PAGE_WIDTH - MARGIN_X, y: cursorY },
				thickness: 0.75,
				color: RULE,
			});
			cursorY -= 7;
		},
		/**
		 * A label/value row: the label in a fixed gutter, the value beside it.
		 *
		 * The value flows **line by line** rather than being reserved as one block.
		 * A block reserved whole is a block that can be taller than the text column
		 * — the fields feeding this have no length cap (`server/schemas.ts`) — and
		 * `fit()` answers that by opening a fresh page the block then runs straight
		 * off the bottom of. Fitting per line cannot: the worst case is a value
		 * that continues on the next page, which is what a long value does.
		 */
		fact(fact: PdfFact): void {
			const labelWidth = 150;
			const step = 10 * LINE_HEIGHT;
			const valueLines = wrapLine(
				faceText(fact.value),
				fonts.regular,
				10,
				CONTENT_WIDTH - labelWidth,
			);
			valueLines.forEach((line, index) => {
				const target = fit(step);
				// The label rides the value's first line, so a break carries both.
				if (index === 0) {
					drawFaceText(target, faceText(fact.label), {
						x: MARGIN_X,
						y: cursorY - 10,
						size: 9.5,
						font: fonts.regular,
						color: MUTED,
					});
				}
				drawFaceText(target, line, {
					x: MARGIN_X + labelWidth,
					y: cursorY - 10,
					size: 10,
					font: fonts.regular,
					color: INK,
				});
				cursorY -= step;
			});
		},
		/**
		 * One bar: its label and share on one row, the track under them, the
		 * entry's other metrics beneath that.
		 *
		 * Flowed per line for the reason {@link fact} is — a bar's label is an
		 * entry the room wrote, so nothing bounds how many lines it takes — with
		 * the track and the caption's first line kept together, since a track
		 * divorced from its label is not a reading of anything.
		 */
		bar(bar: PdfBar): void {
			const shareText = bar.share === null ? EMPTY_VALUE : `${bar.share}%`;
			const shareWidth = textWidth(shareText, fonts.bold, 9.5) + 8;
			const labelStep = 10 * LINE_HEIGHT;
			const captionStep = 8.5 * LINE_HEIGHT;
			const labelLines = wrapLine(
				faceText(bar.label),
				fonts.regular,
				10,
				CONTENT_WIDTH - shareWidth,
			);
			const captionLines =
				bar.caption.length > 0
					? wrapLine(faceText(bar.caption), fonts.regular, 8.5, CONTENT_WIDTH)
					: [];

			labelLines.forEach((line, index) => {
				const target = fit(labelStep);
				drawFaceText(target, line, {
					x: MARGIN_X,
					y: cursorY - 10,
					size: 10,
					font: fonts.regular,
					color: INK,
				});
				// The share rides the label's first line, so a break carries both.
				if (index === 0) {
					drawFaceText(target, shareText, {
						x: PAGE_WIDTH - MARGIN_X - shareWidth + 8,
						y: cursorY - 10,
						size: 9.5,
						font: fonts.bold,
						color: bar.share === null ? DIM : ACCENT,
					});
				}
				cursorY -= labelStep;
			});
			cursorY -= 2;

			const track = fit(11);
			track.drawRectangle({
				x: MARGIN_X,
				y: cursorY - 5,
				width: CONTENT_WIDTH,
				height: 5,
				color: BAR_TRACK,
			});
			if (bar.share !== null && bar.share > 0) {
				track.drawRectangle({
					x: MARGIN_X,
					y: cursorY - 5,
					width: (CONTENT_WIDTH * Math.min(bar.share, 100)) / 100,
					height: 5,
					color: ACCENT,
				});
			}
			cursorY -= 6;

			for (const line of captionLines) {
				const target = fit(captionStep);
				drawFaceText(target, line, {
					x: MARGIN_X,
					y: cursorY - 8.5,
					size: 8.5,
					font: fonts.regular,
					color: MUTED,
				});
				cursorY -= captionStep;
			}
			cursorY -= 8;
		},
		/**
		 * A table whose first column is the entry and whose rest are its metrics.
		 * The header repeats on every page the table runs onto — a column of bare
		 * numbers under no heading is not a reading of anything.
		 *
		 * Asynchronous because its rows are the one run of work here that the
		 * caps do not bound per block: a room's open responses are as many as
		 * the room wrote, so the table yields between rows like the render loop
		 * does between blocks.
		 */
		async table(columns: string[], rows: string[][]): Promise<void> {
			const entryWidth = CONTENT_WIDTH * 0.42;
			const metricWidth =
				columns.length > 1 ? (CONTENT_WIDTH - entryWidth) / (columns.length - 1) : 0;
			const widthOf = (index: number) => (index === 0 ? entryWidth : metricWidth);
			const xOf = (index: number) =>
				MARGIN_X + (index === 0 ? 0 : entryWidth + (index - 1) * metricWidth);

			const drawHeader = (): void => {
				// Every wrapped line of every heading, not just the first: a metric
				// column is ~70pt wide and a grid slide's are "Average <x title>" /
				// "Average <y title>" (REQ048), named by whatever the organizer wrote.
				// Truncated to one line those two columns both read `Average`, which
				// is worse than the bare numbers this heading exists to explain.
				const headings = columns.map((column, index) =>
					wrapLine(faceText(column), fonts.bold, 9, widthOf(index) - 6),
				);
				const lineCount = Math.max(...headings.map((lines) => lines.length), 1);
				const target = fit(lineCount * 9 * LINE_HEIGHT + 6);
				headings.forEach((lines, index) => {
					lines.forEach((line, lineIndex) => {
						drawFaceText(target, line, {
							x: xOf(index),
							y: cursorY - 9 - lineIndex * 9 * LINE_HEIGHT,
							size: 9,
							font: fonts.bold,
							color: MUTED,
						});
					});
				});
				cursorY -= lineCount * 9 * LINE_HEIGHT + 3;
				target.drawLine({
					start: { x: MARGIN_X, y: cursorY },
					end: { x: PAGE_WIDTH - MARGIN_X, y: cursorY },
					thickness: 0.5,
					color: RULE,
				});
				cursorY -= 5;
			};

			drawHeader();
			for (const row of rows) {
				await yieldIfDue();
				const cells = row.map((cell, index) =>
					wrapLine(faceText(cell), fonts.regular, 9.5, widthOf(index) - 6),
				);
				const lineCount = Math.max(...cells.map((lines) => lines.length), 1);
				const height = lineCount * 9.5 * LINE_HEIGHT + 3;
				const before = page;
				let target = fit(height);
				if (target !== before) {
					// The row broke onto a fresh page, so the header comes with it — and
					// the row is then drawn on *that* page whatever its height, rather
					// than asking to fit a second time. Asking twice is how a header
					// ends up orphaned at the foot of a page the row never uses.
					drawHeader();
					target = page as PDFPage;
				}
				cells.forEach((lines, index) => {
					lines.forEach((line, lineIndex) => {
						drawFaceText(target, line, {
							x: xOf(index),
							y: cursorY - 9.5 - lineIndex * 9.5 * LINE_HEIGHT,
							size: 9.5,
							font: fonts.regular,
							color: index === 0 ? INK : MUTED,
						});
					});
				});
				cursorY -= height;
			}
			cursorY -= 4;
		},
	};
}

/**
 * The fallback faces anything the document draws comes from — asked before
 * drawing, because embedding is asynchronous and the flow is not, and asked so
 * that a document without CJK or without emoji embeds no such face at all: even
 * an empty subset of the CJK face carries its hinting programs, about 9 KB.
 *
 * Read off the model serialised whole, so a block kind added later is covered
 * without this being edited, and through the very fold the drawing makes, so a
 * face is in the answer exactly when some character reaches {@link fontFor}
 * needing it. `JSON.stringify` writes every drawable character through as itself
 * (it escapes only ASCII controls and lone surrogates, which fold anyway), and
 * the one transform the renderer adds, upper-casing a label, never produces a
 * CJK character or an emoji.
 */
function fallbackFacesDrawn(model: PdfDocument): ReadonlySet<FallbackFace> {
	const faces = new Set<FallbackFace>();
	for (const character of faceText(JSON.stringify(model))) {
		if (isInFace(character)) continue;
		const fallback = fallbackFaceFor(character);
		if (fallback) faces.add(fallback);
	}
	return faces;
}

/**
 * Turn a document model into PDF bytes.
 *
 * The only place `pdf-lib` is used. Nothing here reads a slide, a vote or an
 * aggregate — it is handed blocks and puts them on pages.
 */
export async function renderDeckDocument(
	model: PdfDocument,
): Promise<Uint8Array<ArrayBuffer>> {
	const document = await PDFDocument.create();
	document.setProducer("omul");
	document.setCreator("omul");
	document.registerFontkit(fontkit);
	const fallbacks = new Map<FallbackFace, PDFFont>();
	for (const fallback of fallbackFacesDrawn(model)) {
		fallbacks.set(fallback, await document.embedFont(fallback.bytes, { subset: true }));
	}
	const fonts: Fonts = {
		regular: {
			text: await document.embedFont(FACE_BYTES.regular, { subset: true }),
			fallbacks,
		},
		bold: {
			text: await document.embedFont(FACE_BYTES.bold, { subset: true }),
			fallbacks,
		},
	};
	const yieldIfDue = createYielder(RENDER_SLICE_MS);
	const flow = createFlow(document, fonts, yieldIfDue);

	for (const section of model.sections) {
		flow.startSection();
		for (const block of section.blocks) {
			await yieldIfDue();
			switch (block.kind) {
				case "title":
					flow.prose(block.text, {
						size: 24,
						font: fonts.bold,
						color: INK,
						gapAfter: 4,
					});
					break;
				case "subtitle":
					flow.prose(block.text, {
						size: 11,
						font: fonts.regular,
						color: MUTED,
						gapAfter: 4,
					});
					break;
				case "heading":
					flow.prose(block.text, {
						size: 16,
						font: fonts.bold,
						color: INK,
						gapAfter: 2,
					});
					break;
				case "label":
					flow.prose(block.text.toUpperCase(), {
						size: 8.5,
						font: fonts.bold,
						color: ACCENT,
						gapBefore: 8,
						gapAfter: 2,
					});
					break;
				case "paragraph":
					flow.prose(block.text, {
						size: 11,
						font: fonts.regular,
						color: INK,
						gapAfter: 6,
					});
					break;
				case "note":
					flow.prose(block.text, {
						size: 9.5,
						font: fonts.regular,
						color: MUTED,
						gapAfter: 4,
					});
					break;
				case "bullets":
					for (const item of block.items) {
						await yieldIfDue();
						flow.prose(`• ${item}`, {
							size: 10.5,
							font: fonts.regular,
							color: INK,
							indent: 6,
						});
					}
					flow.gap(6);
					break;
				case "facts":
					for (const fact of block.facts) {
						await yieldIfDue();
						flow.fact(fact);
					}
					flow.gap(6);
					break;
				case "bars":
					for (const bar of block.bars) {
						await yieldIfDue();
						flow.bar(bar);
					}
					break;
				case "table":
					await flow.table(block.columns, block.rows);
					break;
				case "rule":
					flow.rule();
					break;
			}
		}
	}

	// The running footer is written last, because "page 3 of 11" is not knowable
	// while page 3 is being filled.
	const pages = document.getPages();
	const footer = faceText(model.footer);
	for (const [index, page] of pages.entries()) {
		await yieldIfDue();
		const counter = `${index + 1} / ${pages.length}`;
		const counterWidth = textWidth(counter, fonts.regular, 8.5);
		const footerText = wrapLine(
			footer,
			fonts.regular,
			8.5,
			CONTENT_WIDTH - counterWidth - 16,
		)[0];
		drawFaceText(page, footerText, {
			x: MARGIN_X,
			y: MARGIN_BOTTOM - 26,
			size: 8.5,
			font: fonts.regular,
			color: DIM,
		});
		drawFaceText(page, counter, {
			x: PAGE_WIDTH - MARGIN_X - counterWidth,
			y: MARGIN_BOTTOM - 26,
			size: 8.5,
			font: fonts.regular,
			color: DIM,
		});
	}

	// pdf-lib allocates its output as a plain `new Uint8Array(size)`, so the bytes
	// are backed by an `ArrayBuffer` and go out as written rather than through a
	// re-wrap that would only copy them — the same reading the workbook's
	// `writeBuffer()` gets. TypeScript only knows the wider `ArrayBufferLike`,
	// which is why the shape is stated here rather than at the call site.
	return (await document.save()) as Uint8Array<ArrayBuffer>;
}

/** The MIME type a PDF download is served under. */
export const PDF_CONTENT_TYPE = "application/pdf";

/**
 * The filename the browser saves the export as. Slugged from the deck's title
 * through {@link deckFilenameSlug} — the same descriptor the JSON deck export
 * and the results workbook compose, so every file a deck produces is named by
 * one rule — and dated from the export instant so a deck run twice does not
 * overwrite its own first file.
 *
 * The two readings are named apart (`-deck-` / `-results-`) because they are
 * different documents of the same deck on the same day, and a download folder
 * is where that distinction has to survive.
 */
export function deckPdfFilename(
	title: string,
	exportedAt: string,
	includeResults: boolean,
): string {
	const day = exportedAt.slice(0, 10);
	const kind = includeResults ? "results" : "deck";
	return `${deckFilenameSlug(title)}-${kind}-${day}.pdf`;
}
