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
 * Two stages, deliberately separated (ADR-0010):
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
 *  - **The text is set in the PDF standard fonts**, so nothing is embedded and
 *    every reader draws the file the same way. Their encoding is WinAnsi, which
 *    covers Latin-1 and no more, so text outside it is folded to its nearest
 *    unaccented form and, failing that, marked — see {@link winAnsiText}.
 *    REQ158 is the entry that widens this.
 */

import {
	PDFDocument,
	type PDFFont,
	type PDFPage,
	rgb,
	type RGB,
	StandardFonts,
} from "pdf-lib";
import {
	aggregateRowsFor,
	participantIdsIn,
	participantNameFor,
	type ResultsExportInput,
	SHARE_METRIC,
	type SheetCell,
	type SlideResultsPayload,
} from "./results-export";
import {
	acceptedQuizAnswers,
	deckFilenameSlug,
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
 * `null` cells rather than dropping them (ADR-0024): "nobody answered" and "the
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
 */
export function plainTextFromMarkdown(markdown: string): string {
	return markdown
		.split("\n")
		.map((line) =>
			line
				// Sub-headings (REQ089) — the hashes are the markup, not the words.
				.replace(/^\s{0,3}#{1,6}\s+/, "")
				// A list marker becomes a bullet the reader can see.
				.replace(/^\s*[-*+]\s+/, "• ")
				.replace(/^\s*(\d+)\.\s+/, "$1. ")
				// A link keeps both halves: nothing on paper can follow the label.
				.replace(/\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)")
				.replace(/`([^`]*)`/g, "$1")
				.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
				.replace(/(\*|_)(?=\S)([^*_]*?\S)\1/g, "$2")
				.trimEnd(),
		)
		.join("\n")
		.trim();
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
 * character the PDF standard fonts can encode, so it would reach the page as
 * the mark {@link winAnsiText} folds it to (ADR-0022 refuses arrows as icons on
 * the client for its own reasons; here they simply cannot be drawn).
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
 * `quizAnswerModeFor`, `acceptedQuizAnswers`, `leaderboardSizeFor`), so a
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

		default:
			return blocks;
	}
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
export function resultBlocksFor(
	slide: Slide,
	payload: SlideResultsPayload,
): PdfBlock[] {
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
			// that is not ADR-0025's hidden control: this is a *fact sheet*, and a
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
 * Participants sheet is (`participantIdsIn`): the count on the cover and the
 * rows here then answer the same question — how many people answered — so a
 * handout cannot say twelve at the front and list nine at the back. Somebody
 * who stated a name and then answered nothing is not on it, for that reason;
 * somebody who answered without stating one is, under an explicit
 * {@link EMPTY_VALUE}, because dropping them would make the page a shorter list
 * than the number beside it.
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

	const participantIds = participantIdsIn(input.votes);
	if (participantIds.length === 0) return null;
	const namedAnyone = participantIds.some(
		(participantId) =>
			participantNameFor(input.participantNames, participantId) !== null,
	);
	if (!namedAnyone) return null;

	const answeredSlides = new Map<string, Set<string>>();
	for (const vote of input.votes) {
		const seen = answeredSlides.get(vote.participantId) ?? new Set<string>();
		seen.add(vote.slideId);
		answeredSlides.set(vote.participantId, seen);
	}

	const rows = participantIds
		.map((participantId) => ({
			participantId,
			name: participantNameFor(input.participantNames, participantId),
			answered: answeredSlides.get(participantId)?.size ?? 0,
		}))
		// By name, as the roster on screen is ordered (`orderParticipantRoster`) —
		// with the unnamed rows last rather than first, since a page of dashes is
		// not what somebody opens this section to read.
		.sort((left, right) => {
			if ((left.name === null) !== (right.name === null)) {
				return left.name === null ? 1 : -1;
			}
			const byName = (left.name ?? "").localeCompare(right.name ?? "", undefined, {
				sensitivity: "base",
			});
			return byName || left.participantId.localeCompare(right.participantId);
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
				rows: rows.map((row) => [row.name ?? EMPTY_VALUE, String(row.answered)]),
			},
		],
	};
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
			// to disagree (ADR-0026).
			coverSection(presentation, input, participantIdsIn(input.votes).length),
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
 * The code points the PDF standard fonts can encode: printable ASCII, the
 * Latin-1 supplement, and the typographic characters WinAnsi puts in the C1
 * range (curly quotes, dashes, the bullet, the ellipsis).
 */
const WIN_ANSI_EXTRAS = new Set(
	"€‚ƒ„…†‡ˆ‰Š‹Œ Ž‘’“”•–—˜™š›œžŸ".split("").filter((character) => character !== " "),
);

/**
 * The C0 controls and DEL — whitespace and formatting, never letters. Folded to
 * a space before the encoding question is asked; see {@link winAnsiText}.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

function isWinAnsi(character: string): boolean {
	const code = character.codePointAt(0) ?? 0;
	if (code >= 0x20 && code <= 0x7e) return true;
	if (code >= 0xa0 && code <= 0xff) return true;
	return WIN_ANSI_EXTRAS.has(character);
}

/**
 * Fold text into what the standard fonts can draw.
 *
 * Three steps, weakest loss first. A character WinAnsi has is kept. One it does
 * not is decomposed and stripped of its combining marks — which is what carries
 * most of Latin Extended-A through, so `č` prints as `c` and `ą` as `a` rather
 * than as nothing. What survives neither is a script these fonts cannot express
 * at all, and a run of it collapses to a single `?`: seven question marks in a
 * row say no more than one does, and the alternative — `drawText` throwing on
 * the first character it cannot encode — would fail the whole export over one
 * word somebody typed. REQ158 is the entry that replaces this with an embedded
 * face.
 *
 * Control characters are **whitespace, not an unencodable script**, and are
 * folded to a space before any of that: a tab is ordinary in an indented
 * markdown list and a stray `\r` rides every CRLF-authored deck, and neither is
 * a character somebody meant to print. Read as "not in WinAnsi" they would come
 * out as a literal `?` in the middle of a sentence; read as space they are
 * collapsed by the wrapper's own whitespace split, which is what they are.
 */
export function winAnsiText(text: string): string {
	let output = "";
	let dropped = false;
	for (const character of text.replace(CONTROL_CHARACTERS, " ")) {
		if (isWinAnsi(character)) {
			output += character;
			dropped = false;
			continue;
		}
		const folded = character
			.normalize("NFKD")
			.replace(/\p{M}/gu, "")
			.split("")
			.filter(isWinAnsi)
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
 * How much of `text` fits in `width` — the longest prefix, never fewer than one
 * character so a caller breaking a run into chunks always advances.
 *
 * **Binary search, not a walk down from the end.** `widthOfTextAtSize` measures
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
 */
function fittingPrefix(
	text: string,
	font: PDFFont,
	size: number,
	width: number,
): number {
	let low = 1;
	let high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (font.widthOfTextAtSize(text.slice(0, middle), size) <= width) {
			low = middle;
		} else {
			high = middle - 1;
		}
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
	font: PDFFont,
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
		if (current.length === 0 || font.widthOfTextAtSize(candidate, size) <= width) {
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
			let cut = fittingPrefix(windowText, font, size, width);
			while (cut === windowText.length && start + windowText.length < line.length) {
				windowSize *= 2;
				windowText = line.slice(start, start + windowSize);
				cut = fittingPrefix(windowText, font, size, width);
			}
			broken.push(windowText.slice(0, cut));
			start += cut;
		}
	}
	return broken.length > 0 ? broken : [""];
}

type Fonts = { regular: PDFFont; bold: PDFFont };

/**
 * The page the renderer is currently writing onto, and how far down it is.
 *
 * A factory closure rather than a class (ADR-0007): the whole of the flow is
 * "put this at the cursor, and start a page when it will not fit", and every
 * block draws through the same two calls.
 */
function createFlow(document: PDFDocument, fonts: Fonts) {
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
			font: PDFFont;
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
			target.drawText(line, {
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
				font: PDFFont;
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
						: wrapLine(winAnsiText(line), options.font, options.size, width),
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
				winAnsiText(fact.value),
				fonts.regular,
				10,
				CONTENT_WIDTH - labelWidth,
			);
			valueLines.forEach((line, index) => {
				const target = fit(step);
				// The label rides the value's first line, so a break carries both.
				if (index === 0) {
					target.drawText(winAnsiText(fact.label), {
						x: MARGIN_X,
						y: cursorY - 10,
						size: 9.5,
						font: fonts.regular,
						color: MUTED,
					});
				}
				target.drawText(line, {
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
			const shareWidth = fonts.bold.widthOfTextAtSize(shareText, 9.5) + 8;
			const labelStep = 10 * LINE_HEIGHT;
			const captionStep = 8.5 * LINE_HEIGHT;
			const labelLines = wrapLine(
				winAnsiText(bar.label),
				fonts.regular,
				10,
				CONTENT_WIDTH - shareWidth,
			);
			const captionLines =
				bar.caption.length > 0
					? wrapLine(winAnsiText(bar.caption), fonts.regular, 8.5, CONTENT_WIDTH)
					: [];

			labelLines.forEach((line, index) => {
				const target = fit(labelStep);
				target.drawText(line, {
					x: MARGIN_X,
					y: cursorY - 10,
					size: 10,
					font: fonts.regular,
					color: INK,
				});
				// The share rides the label's first line, so a break carries both.
				if (index === 0) {
					target.drawText(shareText, {
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
				target.drawText(line, {
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
		 */
		table(columns: string[], rows: string[][]): void {
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
					wrapLine(winAnsiText(column), fonts.bold, 9, widthOf(index) - 6),
				);
				const lineCount = Math.max(...headings.map((lines) => lines.length), 1);
				const target = fit(lineCount * 9 * LINE_HEIGHT + 6);
				headings.forEach((lines, index) => {
					lines.forEach((line, lineIndex) => {
						target.drawText(line, {
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
				const cells = row.map((cell, index) =>
					wrapLine(winAnsiText(cell), fonts.regular, 9.5, widthOf(index) - 6),
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
						target.drawText(line, {
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
	const fonts: Fonts = {
		regular: await document.embedFont(StandardFonts.Helvetica),
		bold: await document.embedFont(StandardFonts.HelveticaBold),
	};
	const flow = createFlow(document, fonts);

	for (const section of model.sections) {
		flow.startSection();
		for (const block of section.blocks) {
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
					for (const fact of block.facts) flow.fact(fact);
					flow.gap(6);
					break;
				case "bars":
					for (const bar of block.bars) flow.bar(bar);
					break;
				case "table":
					flow.table(block.columns, block.rows);
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
	const footer = winAnsiText(model.footer);
	pages.forEach((page, index) => {
		const counter = `${index + 1} / ${pages.length}`;
		const counterWidth = fonts.regular.widthOfTextAtSize(counter, 8.5);
		const footerText = wrapLine(
			footer,
			fonts.regular,
			8.5,
			CONTENT_WIDTH - counterWidth - 16,
		)[0];
		page.drawText(footerText, {
			x: MARGIN_X,
			y: MARGIN_BOTTOM - 26,
			size: 8.5,
			font: fonts.regular,
			color: DIM,
		});
		page.drawText(counter, {
			x: PAGE_WIDTH - MARGIN_X - counterWidth,
			y: MARGIN_BOTTOM - 26,
			size: 8.5,
			font: fonts.regular,
			color: DIM,
		});
	});

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
