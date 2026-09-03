/**
 * Unit tests for the PDF document builder (REQ096).
 *
 * The builder's whole job is to say what the document *contains*, so almost
 * every assertion here reads a block out of a plain model — no PDF parser, no
 * store, no app. Four properties carry the slice:
 *
 *   - **Both readings exist and differ in one thing.** With results the deck's
 *     tallies are drawn and its counts reach the cover; without them neither
 *     does, and the slides themselves are identical.
 *   - **The tallies are read, never recomputed.** Every results block is a
 *     re-layout of `aggregateRowsFor` — the flattening the XLSX export's
 *     Aggregates sheet is written from — so a number in the document is fed in
 *     here as the results endpoint's own payload and asserted to come out under
 *     its own name.
 *   - **A stored value is never printed as storage.** A slide type is named
 *     ("Guess the Number"), authored markdown is reduced to the words it marked
 *     up, and an absent number is an explicit mark rather than a blank.
 *   - **Nothing the fonts cannot draw reaches the page.** {@link winAnsiText} is
 *     what stands between a participant's emoji and a `drawText` that throws.
 *
 * Pure: no store, no app, no clock beyond the instant handed in.
 */

import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import {
	buildDeckDocument,
	cellText,
	deckPdfFilename,
	type DeckPdfInput,
	EMPTY_VALUE,
	PDF_CONTENT_TYPE,
	type PdfBlock,
	type PdfDocument,
	plainTextFromMarkdown,
	questionBlocksFor,
	renderDeckDocument,
	resultBlocksFor,
	winAnsiText,
} from "./deck-pdf";
import type { SlideResultsPayload } from "./results-export";
import {
	type Presentation,
	PresentationSchema,
	type Slide,
	SlideSchema,
} from "./schemas";

/** Parse a hand-written slide through the schema so defaults are filled in. */
function slide(fields: Record<string, unknown>): Slide {
	return SlideSchema.parse(fields);
}

/** Parse a hand-written deck through the public presentation schema. */
function deck(slides: Slide[], fields: Record<string, unknown> = {}): Presentation {
	return PresentationSchema.parse({
		id: "deck-1",
		code: "123456",
		title: "Quarterly Review",
		createdAt: "2026-08-01T09:00:00.000Z",
		slides,
		...fields,
	});
}

/** One export's input, with everything the caller did not care about empty. */
function input(
	presentation: Presentation,
	fields: Partial<DeckPdfInput> = {},
): DeckPdfInput {
	return {
		presentation,
		votes: [],
		responseVotes: [],
		participantNames: {},
		results: [],
		exportedAt: "2026-08-14T12:00:00.000Z",
		includeResults: true,
		...fields,
	};
}

/** Every block of every section, flattened — what the document says, in order. */
function allBlocks(document: PdfDocument): PdfBlock[] {
	return document.sections.flatMap((section) => section.blocks);
}

/** Every run of text a block carries, whatever kind of block it is. */
function textIn(block: PdfBlock): string[] {
	switch (block.kind) {
		case "title":
		case "subtitle":
		case "heading":
		case "label":
		case "paragraph":
		case "note":
			return [block.text];
		case "bullets":
			return block.items;
		case "facts":
			return block.facts.flatMap((fact) => [fact.label, fact.value]);
		case "bars":
			return block.bars.flatMap((bar) => [bar.label, bar.caption]);
		case "table":
			return [...block.columns, ...block.rows.flat()];
		case "rule":
			return [];
	}
}

/** Everything the document says, as one searchable list of strings. */
function allText(document: PdfDocument): string[] {
	return allBlocks(document).flatMap(textIn);
}

/**
 * Every baseline the rendered document draws text at, in PDF points from the
 * foot of its page.
 *
 * Enough of a PDF reader to answer one question — *did anything end up off the
 * page?* — and no more. pdf-lib deflates its content streams and positions each
 * run with `1 0 0 1 <x> <y> Tm`, both properties of the file format rather than
 * of this export, so the helper does not go stale when the layout moves. A
 * baseline at or below zero is text drawn on no page at all.
 */
function textBaselinesIn(bytes: Uint8Array): number[] {
	const raw = Buffer.from(bytes).toString("latin1");
	const baselines: number[] = [];
	const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
	let stream = streams.exec(raw);
	while (stream !== null) {
		try {
			const content = inflateSync(Buffer.from(stream[1], "latin1")).toString(
				"latin1",
			);
			const positions = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
			let position = positions.exec(content);
			while (position !== null) {
				baselines.push(Number(position[2]));
				position = positions.exec(content);
			}
		} catch {
			// Not a deflate stream — it carries no drawing operators to read.
		}
		stream = streams.exec(raw);
	}
	return baselines;
}

/**
 * Every run of text the rendered document draws, in the order it draws them.
 *
 * The sibling of {@link textBaselinesIn}, reading the same deflated content
 * streams for the other half of the operator pdf-lib emits: `<hex> Tj` is the
 * text, `Tm` before it is where. One entry per `drawText` call, so a line the
 * wrapper produced is an entry — which is what lets a test ask whether breaking
 * a run kept the run.
 */
function drawnRunsIn(bytes: Uint8Array): string[] {
	const raw = Buffer.from(bytes).toString("latin1");
	const runs: string[] = [];
	const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
	let stream = streams.exec(raw);
	while (stream !== null) {
		try {
			const content = inflateSync(Buffer.from(stream[1], "latin1")).toString(
				"latin1",
			);
			const drawn = /<([0-9A-Fa-f]*)>\s*Tj/g;
			let piece = drawn.exec(content);
			while (piece !== null) {
				runs.push(Buffer.from(piece[1], "hex").toString("latin1"));
				piece = drawn.exec(content);
			}
		} catch {
			// Not a deflate stream — it carries no drawing operators to read.
		}
		stream = streams.exec(raw);
	}
	return runs;
}

/** The blocks of the section that renders slide `index` (the cover is 0). */
function slideSection(document: PdfDocument, index: number): PdfBlock[] {
	const section = document.sections[index + 1];
	expect(section).toBeDefined();
	return section.blocks;
}

describe("REQ096 — what the document says", () => {
	test("the cover names the deck and the reading it is", () => {
		const withResults = buildDeckDocument(input(deck([])));
		const withoutResults = buildDeckDocument(
			input(deck([]), { includeResults: false }),
		);

		expect(withResults.sections[0].blocks[0]).toEqual({
			kind: "title",
			text: "Quarterly Review",
		});
		expect(allText(withResults)).toContain("The deck and the results it collected");
		expect(allText(withoutResults)).toContain(
			"The deck, without its collected results",
		);
		// The running footer names the deck on every page.
		expect(withResults.footer).toBe("Quarterly Review");
	});

	test("the deck-only reading carries no count of what the room submitted", () => {
		const presentation = deck([
			slide({ id: "s1", type: "multiple-choice", question: "Pick one" }),
		]);
		const rows = [
			{
				id: "v1",
				presentationId: "deck-1",
				slideId: "s1",
				value: "a",
				participantId: "alice",
				createdAt: "2026-08-14T11:00:00.000Z",
				statementId: null,
				skip: false,
			},
		] as unknown as DeckPdfInput["votes"];

		const labels = (document: PdfDocument): string[] =>
			allBlocks(document)
				.filter((block) => block.kind === "facts")
				.flatMap((block) => (block.kind === "facts" ? block.facts : []))
				.map((fact) => fact.label);

		expect(labels(buildDeckDocument(input(presentation, { votes: rows })))).toContain(
			"Participants",
		);
		expect(
			labels(
				buildDeckDocument(
					input(presentation, { votes: rows, includeResults: false }),
				),
			),
		).not.toContain("Participants");
	});

	test("one section per slide, each named by its type rather than its id", () => {
		const document = buildDeckDocument(
			input(
				deck([
					slide({ id: "s1", type: "guess-number", question: "How many?" }),
					slide({ id: "s2", type: "word-cloud", question: "One word" }),
				]),
			),
		);
		// The cover, then one per slide — a section is what starts a fresh page.
		expect(document.sections).toHaveLength(3);
		expect(slideSection(document, 0)[0]).toEqual({
			kind: "label",
			text: "Slide 1 of 2 · Guess the Number",
		});
		expect(slideSection(document, 0)[1]).toEqual({
			kind: "heading",
			text: "How many?",
		});
	});

	test("a slide whose author wrote no question is still titled", () => {
		const document = buildDeckDocument(
			input(deck([slide({ id: "s1", type: "image", question: "" })])),
		);
		expect(slideSection(document, 0)[1]).toEqual({
			kind: "heading",
			text: "(untitled Image)",
		});
	});

	test("the results half is there with results and absent without them", () => {
		const slides = [slide({ id: "s1", type: "word-cloud", question: "One word" })];
		const results: SlideResultsPayload[] = [
			{
				slideId: "s1",
				type: "word-cloud",
				totalVotes: 4,
				words: [{ text: "steady", count: 3 }],
			},
		];

		const withResults = buildDeckDocument(input(deck(slides), { results }));
		expect(allText(withResults)).toContain("Results");
		expect(allText(withResults)).toContain("steady");

		const withoutResults = buildDeckDocument(
			input(deck(slides), { results, includeResults: false }),
		);
		expect(allText(withoutResults)).not.toContain("Results");
		expect(allText(withoutResults)).not.toContain("steady");
	});
});

describe("REQ096 — what a slide asked", () => {
	test("a choice slide lists its options and its selection rule", () => {
		const blocks = questionBlocksFor(
			slide({
				id: "s1",
				type: "multiple-choice",
				question: "Pick",
				options: [
					{ id: "a", text: "Weekly" },
					{ id: "b", text: "Monthly" },
				],
				mcMaxSelections: 2,
			}),
		);
		expect(blocks).toContainEqual({
			kind: "bullets",
			items: ["Weekly", "Monthly"],
		});
		expect(blocks.flatMap(textIn)).toContain(
			"Participants select up to 2 options.",
		);
	});

	test("a quiz draws its answer key — the document is the organizer's", () => {
		const blocks = questionBlocksFor(
			slide({
				id: "s1",
				type: "quiz",
				question: "Capital of France?",
				timeLimit: 20,
				options: [
					{ id: "a", text: "Paris", isCorrect: true },
					{ id: "b", text: "Lyon" },
				],
			}),
		);
		expect(blocks).toContainEqual({
			kind: "bullets",
			items: ["Paris (correct)", "Lyon"],
		});
		expect(blocks.flatMap(textIn)).toContain("Time limit: 20 seconds.");
	});

	test("a quiz with no countdown says so — never 'Time limit: 0 seconds.'", () => {
		// `0` is the editor's authored spelling of "Off" (`quizTimeLimitFor`
		// reads it as no limit on every live surface); a handout claiming an
		// instant-closing window for a question that never closes on its own
		// would contradict the room it documents. A negative stored value folds
		// the same way rather than printing raw.
		for (const authored of [0, -5]) {
			const lines = questionBlocksFor(
				slide({
					id: "s1",
					type: "quiz",
					question: "Capital of France?",
					timeLimit: authored,
					options: [{ id: "a", text: "Paris", isCorrect: true }],
				}),
			).flatMap(textIn);
			expect(lines).toContain(
				"No time limit — every correct answer scores the same.",
			);
			expect(lines.join(" ")).not.toContain(`${authored} seconds`);
		}
	});

	test("a typed quiz draws the answers it accepts, not its options", () => {
		const blocks = questionBlocksFor(
			slide({
				id: "s1",
				type: "quiz",
				question: "Which country?",
				quizAnswerMode: "type",
				quizAnswers: [{ id: "q1", text: "USA" }, { id: "q2", text: "United States" }],
			}),
		);
		expect(blocks).toContainEqual({
			kind: "bullets",
			items: ["USA", "United States"],
		});
		expect(blocks.flatMap(textIn)).toContain("Accepted answers");
	});

	test("a slide with no notion of correctness says so rather than staying silent", () => {
		const blocks = questionBlocksFor(
			slide({
				id: "s1",
				type: "quiz",
				question: "Opinion?",
				options: [{ id: "a", text: "Yes" }],
			}),
		);
		expect(blocks.flatMap(textIn)).toContain(
			"No option is marked correct, so nobody scores.",
		);
	});

	test("a scale names both ends in words an encodable font can draw", () => {
		const blocks = questionBlocksFor(
			slide({
				id: "s1",
				type: "scale",
				question: "Rate",
				scaleMin: 1,
				scaleMax: 5,
				scaleMinLabel: "Poor",
				scaleMaxLabel: "Great",
			}),
		);
		const text = blocks.flatMap(textIn).join(" ");
		expect(text).toContain("Scale 1 to 5 (1 = Poor, 5 = Great)");
		// An arrow is not a character the standard fonts encode, so none is written.
		expect(winAnsiText(text)).toBe(text);
	});

	test("a slide's media is named, never fetched", () => {
		const blocks = questionBlocksFor(
			slide({
				id: "s1",
				type: "pin-image",
				question: "Where?",
				mediaUrl: "https://example.com/map.png",
				pinArea: { x: 100, y: 200, width: 50, height: 60 },
			}),
		);
		const text = blocks.flatMap(textIn);
		expect(text).toContain("Pin target image: https://example.com/map.png");
		expect(text).toContain("Target area: 100, 200 to 150, 260 (per mille).");
	});

	test("a form lists its fields with their shape and their choices", () => {
		const blocks = questionBlocksFor(
			slide({
				id: "s1",
				type: "form",
				question: "Sign up",
				formFields: [
					{ id: "name", label: "Your name", required: true },
					{
						id: "track",
						label: "Track",
						type: "choice",
						options: [
							{ id: "d", text: "Design" },
							{ id: "e", text: "Engineering" },
						],
					},
				],
			}),
		);
		expect(blocks).toContainEqual({
			kind: "bullets",
			items: [
				"Your name (text, required)",
				"Track (choice, optional) — Design, Engineering",
			],
		});
	});

	test("a content slide's body is drawn as words, not as markdown", () => {
		const blocks = questionBlocksFor(
			slide({
				id: "s1",
				type: "text",
				question: "Welcome",
				body: "## Agenda\n\n- Warm **up**\n- [Docs](https://example.com)",
			}),
		);
		expect(blocks).toContainEqual({
			kind: "paragraph",
			text: "Agenda\n\n• Warm up\n• Docs (https://example.com)",
		});
	});
});

describe("REQ096 — the tallies are read, never recomputed", () => {
	test("a share the aggregation published becomes a bar of that width", () => {
		const blocks = resultBlocksFor(
			slide({
				id: "s1",
				type: "multiple-choice",
				question: "Pick",
				options: [
					{ id: "a", text: "Weekly" },
					{ id: "b", text: "Monthly" },
				],
			}),
			{
				slideId: "s1",
				type: "multiple-choice",
				totalVotes: 5,
				respondentCount: 5,
				options: [
					{ id: "a", text: "Weekly", count: 2, isCorrect: null },
					{ id: "b", text: "Monthly", count: 3, isCorrect: null },
				],
			},
		);
		const bars = blocks.find((block) => block.kind === "bars");
		expect(bars).toBeDefined();
		if (bars?.kind !== "bars") throw new Error("expected bars");
		expect(bars.bars.map((bar) => [bar.label, bar.share])).toEqual([
			["Weekly", 40],
			["Monthly", 60],
		]);
		// The count rides the caption; nothing here divides anything itself.
		expect(bars.bars[0].caption).toContain("Count: 2");
	});

	test("slide-level metrics are drawn as totals above the entries", () => {
		const blocks = resultBlocksFor(
			slide({ id: "s1", type: "guess-number", question: "How many?" }),
			{
				slideId: "s1",
				type: "guess-number",
				totalVotes: 3,
				guessCount: 3,
				averageGuess: 41.5,
				medianGuess: 40,
				buckets: [],
			},
		);
		const facts = blocks.find((block) => block.kind === "facts");
		if (facts?.kind !== "facts") throw new Error("expected facts");
		expect(facts.facts).toContainEqual({ label: "Guesses", value: "3" });
		expect(facts.facts).toContainEqual({ label: "Average guess", value: "41.5" });
		// A metric the payload does not carry stays an explicit absence.
		expect(facts.facts).toContainEqual({ label: "Reference", value: EMPTY_VALUE });
	});

	test("entries without a published share become a table, one column per metric", () => {
		const blocks = resultBlocksFor(
			slide({
				id: "s1",
				type: "ranking",
				question: "Order these",
				rankingItems: [
					{ id: "a", text: "Latency" },
					{ id: "b", text: "Cost" },
				],
			}),
			{
				slideId: "s1",
				type: "ranking",
				totalVotes: 2,
				ballots: 2,
				items: [
					{
						id: "a",
						text: "Latency",
						rank: 1,
						points: 4,
						rankedCount: 2,
						notRanked: 0,
						averageRank: 1,
					},
					{
						id: "b",
						text: "Cost",
						rank: 2,
						points: 2,
						rankedCount: 2,
						notRanked: 0,
						averageRank: 2,
					},
				],
			},
		);
		const table = blocks.find((block) => block.kind === "table");
		if (table?.kind !== "table") throw new Error("expected a table");
		expect(table.columns).toEqual([
			"Entry",
			"Rank",
			"Points",
			"Ranked by",
			"Not ranked by",
			"Average rank",
		]);
		// Entry order is the aggregation's, which is itself a result.
		expect(table.rows.map((row) => row[0])).toEqual(["Latency", "Cost"]);
		expect(table.rows[0]).toEqual(["Latency", "1", "4", "2", "0", "1"]);
	});

	test("a slide with no rows still reports itself", () => {
		const blocks = resultBlocksFor(
			slide({ id: "s1", type: "text", question: "Welcome" }),
			{},
		);
		expect(blocks[0]).toEqual({ kind: "label", text: "Results" });
		const facts = blocks.find((block) => block.kind === "facts");
		if (facts?.kind !== "facts") throw new Error("expected facts");
		expect(facts.facts).toContainEqual({ label: "Responses", value: "0" });
	});
});

describe("REQ096 — reading a value into words", () => {
	test("an absent value is an explicit mark, never a blank", () => {
		expect(cellText(null)).toBe(EMPTY_VALUE);
		expect(cellText("")).toBe(EMPTY_VALUE);
		// And zero is not absence: the two stay distinguishable.
		expect(cellText(0)).toBe("0");
	});

	test("a boolean reads as a word and a fraction keeps two places", () => {
		expect(cellText(true)).toBe("yes");
		expect(cellText(false)).toBe("no");
		expect(cellText(12.3456)).toBe("12.35");
		expect(cellText(12)).toBe("12");
	});

	test("markdown is reduced to the words it marked up", () => {
		expect(plainTextFromMarkdown("### Heading")).toBe("Heading");
		expect(plainTextFromMarkdown("**bold** and *italic* and `code`")).toBe(
			"bold and italic and code",
		);
		expect(plainTextFromMarkdown("[Docs](https://example.com)")).toBe(
			"Docs (https://example.com)",
		);
		expect(plainTextFromMarkdown("- one\n- two")).toBe("• one\n• two");
	});
});

describe("REQ096 — nothing reaches the page the fonts cannot draw", () => {
	test("what WinAnsi has is kept, byte for byte", () => {
		const text = "Voilà — “quoted”, 50% • café…";
		expect(winAnsiText(text)).toBe(text);
	});

	test("Latin beyond WinAnsi is folded rather than lost", () => {
		// `š` is one of the handful of Latin Extended letters WinAnsi does carry,
		// so it survives untouched; `č` and `ż` do not, and decompose to their base
		// letter rather than to nothing.
		expect(winAnsiText("čeština")).toBe("ceština");
		expect(winAnsiText("ważne")).toBe("wazne");
	});

	test("a script the fonts cannot express collapses to one mark", () => {
		expect(winAnsiText("日本語")).toBe("?");
		expect(winAnsiText("A日本語B")).toBe("A?B");
		// An emoji is the ordinary case — a participant typed it into a word cloud.
		expect(winAnsiText("nice 🎉")).toBe("nice ?");
	});

	test("a control character is whitespace, not an unencodable script", () => {
		// A tab is ordinary in an indented markdown list and a `\r` rides every
		// CRLF-authored deck. Read as "not in WinAnsi" they would print as a
		// literal `?` in the middle of a sentence.
		expect(winAnsiText("one\ttwo")).toBe("one two");
		expect(winAnsiText("one\r")).toBe("one ");
		expect(winAnsiText("\t- indented item")).toBe(" - indented item");
	});
});

describe("REQ096 — the file the browser saves", () => {
	test("the two readings are named apart, under one slug rule", () => {
		expect(deckPdfFilename("Q3 — Review", "2026-08-14T12:00:00.000Z", true)).toBe(
			"q3-review-results-2026-08-14.pdf",
		);
		expect(deckPdfFilename("Q3 — Review", "2026-08-14T12:00:00.000Z", false)).toBe(
			"q3-review-deck-2026-08-14.pdf",
		);
	});

	test("a title that slugs to nothing still saves under a name", () => {
		expect(deckPdfFilename("日本語", "2026-08-14T12:00:00.000Z", true)).toBe(
			"presentation-results-2026-08-14.pdf",
		);
	});
});

describe("REQ096 — rendering", () => {
	test("a document renders to PDF bytes, whatever it carries", async () => {
		const document = buildDeckDocument(
			input(
				deck([
					slide({
						id: "s1",
						type: "multiple-choice",
						// Text the standard fonts cannot encode: the render must fold it
						// rather than throw, which is the whole reason `winAnsiText` runs
						// at the drawing site rather than at the building one.
						question: "日本語 — which one? 🎉",
						options: [{ id: "a", text: "čeština" }],
					}),
					slide({ id: "s2", type: "text", question: "Welcome", body: "# Hello" }),
				]),
				{
					results: [
						{
							slideId: "s1",
							type: "multiple-choice",
							totalVotes: 1,
							respondentCount: 1,
							options: [{ id: "a", text: "čeština", count: 1, isCorrect: null }],
						},
					],
				},
			),
		);

		const bytes = await renderDeckDocument(document);
		expect(bytes.byteLength).toBeGreaterThan(0);
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
		expect(PDF_CONTENT_TYPE).toBe("application/pdf");
	});

	test("a slide with more entries than fit on one page still renders", async () => {
		// The renderer flows blocks and breaks pages; a word cloud with a few
		// hundred words is the ordinary way that happens, and nothing is dropped
		// to make it fit.
		const words = Array.from({ length: 200 }, (_, index) => ({
			text: `word-${index}`,
			count: 200 - index,
		}));
		const document = buildDeckDocument(
			input(deck([slide({ id: "s1", type: "word-cloud", question: "One word" })]), {
				results: [
					{ slideId: "s1", type: "word-cloud", totalVotes: 20100, words },
				],
			}),
		);
		const bars = allBlocks(document).find((block) => block.kind === "bars");
		if (bars?.kind !== "bars") throw new Error("expected bars");
		expect(bars.bars).toHaveLength(200);

		const bytes = await renderDeckDocument(document);
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
	});

	test("a table longer than a page renders, header and all", async () => {
		// The other pagination path: entries the aggregation publishes no share
		// for become a table, and a room's worth of open responses is how one runs
		// past the foot of the page. Long cells wrap, so the rows are not a fixed
		// height either.
		const responses = Array.from({ length: 120 }, (_, index) => ({
			id: `r-${index}`,
			text: `Response ${index} — ${"a long thought that has to wrap inside its column ".repeat(2)}`,
			upvotes: index % 4,
		}));
		const document = buildDeckDocument(
			input(deck([slide({ id: "s1", type: "open-text", question: "Thoughts?" })]), {
				results: [
					{ slideId: "s1", type: "open-text", totalVotes: 120, responses },
				],
			}),
		);
		const table = allBlocks(document).find((block) => block.kind === "table");
		if (table?.kind !== "table") throw new Error("expected a table");
		expect(table.columns).toEqual(["Entry", "Upvotes"]);
		expect(table.rows).toHaveLength(120);

		const bytes = await renderDeckDocument(document);
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
	});

	test("an unbroken run of thousands of characters wraps in linear time", async () => {
		// The regression this exists for, in two rounds. The character-breaking
		// fallback first walked one character down from the end, measuring the
		// whole prefix each step — 4,000 characters took 2.8s and 8,000 took 19.7s.
		// Replacing that walk with a binary search removed one factor of n and left
		// the dominant one: each search still measured prefixes of the *whole*
		// remaining run, once per line emitted, so 200,000 characters took 33s and
		// ten such slides wedged the process for 4m45s. What fixed it is bounding
		// what any one search looks at (WRAP_PROBE_CHARACTERS).
		//
		// The claim is the *shape*, so it is asserted as one: quadruple the input
		// and quadratic time goes up ~16×, linear ~4×. A ratio is what survives
		// being run on a slower machine than this was written on, where an absolute
		// budget only says how fast the box is.
		async function renderRunOf(length: number): Promise<number> {
			const document = buildDeckDocument(
				input(
					deck([
						slide({
							id: "s1",
							type: "text",
							question: "x".repeat(length),
							body: "y".repeat(length),
						}),
					]),
					{ includeResults: false },
				),
			);
			const startedAt = Date.now();
			const bytes = await renderDeckDocument(document);
			const elapsed = Date.now() - startedAt;
			expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
			return elapsed;
		}

		const small = await renderRunOf(40_000);
		const large = await renderRunOf(160_000);

		// The ratio is the assertion that carries this test; the absolute bar below
		// it is a backstop, not a second independent catch. Measured at these two
		// sizes: linear 120ms and 480ms, a ratio of 4.0, against quadratic 136ms
		// and 2,417ms, a ratio of 17.8. So the shape is what separates them by an
		// order of magnitude, while the wall-clock of the larger render alone
		// (~4.8s quadratic) sits close enough to the 5s bar that a faster box could
		// slip under it. Read a failure of the ratio as the regression; read a
		// failure of the budget as either that or a machine under load.
		expect(large).toBeLessThan(5_000);
		expect(large / Math.max(small, 1)).toBeLessThan(8);
	});

	test("breaking an over-wide run keeps every character, in order, once", async () => {
		// The other half of bounding the search: a window has two seams, and an
		// off-by-one at either would drop or repeat a character at every line break
		// — a corruption no timing assertion would ever notice. So the drawn text
		// is read back off the page and compared to what went in.
		//
		// The run is written in an alphabet of two characters the rest of the
		// document never draws, so *every* line it breaks into is recognisably its
		// own however short the last one comes out — which is how the body's lines
		// are told apart from the cover's, the heading's and the footer's without
		// assuming anything about where the breaks land. Neither character means
		// anything to `plainTextFromMarkdown`, and the length is deliberately not a
		// multiple of the probe window, so the seams fall on no tidy boundary.
		//
		// The pattern repeats every 7, not every 1: a seam that dropped a character
		// and one that repeated one would both leave the length wrong, but a seam
		// that reordered would not, and a single repeated character cannot tell.
		const run = Array.from({ length: 19_997 }, (_unused, index) =>
			index % 7 < 3 ? "~" : "|",
		).join("");
		const document = buildDeckDocument(
			input(
				deck([slide({ id: "s1", type: "text", question: "Plain", body: run })]),
				{ includeResults: false },
			),
		);

		const bytes = await renderDeckDocument(document);
		const lines = drawnRunsIn(bytes).filter((piece) => /^[~|]+$/.test(piece));

		expect(lines.join("")).toBe(run);
		// And it really was broken up, rather than drawn off the edge of the page
		// in one run — otherwise the equality above would hold for a wrapper that
		// had stopped wrapping.
		expect(lines.length).toBeGreaterThan(20);
	});

	test("a fact taller than the page breaks instead of running off it", async () => {
		// The other half of the same defect: a block whose height was reserved
		// whole could be taller than the whole text column, and `fit()` answered
		// that by opening a fresh page the block then ran straight off the bottom
		// of — text drawn at a negative baseline, on no page at all. A typed quiz's
		// accepted-answer list (REQ055) is one authored string in one fact, so it
		// is the shortest route to a fact hundreds of lines long.
		const accepted = Array.from(
			{ length: 260 },
			(_, index) => `accepted answer number ${index}`,
		);
		const document = buildDeckDocument(
			input(deck([slide({ id: "s1", type: "quiz", question: "Which country?" })]), {
				results: [
					{
						slideId: "s1",
						type: "quiz",
						totalVotes: 0,
						respondentCount: 0,
						typedAnswers: { accepted, distinctCount: 0, entries: [] },
					},
				],
			}),
		);
		const baselines = textBaselinesIn(await renderDeckDocument(document));
		expect(baselines.length).toBeGreaterThan(100);
		expect(Math.min(...baselines)).toBeGreaterThan(0);
	});

	test("a bar whose label outruns the page breaks too", async () => {
		const label = Array.from({ length: 700 }, (_, index) => `word${index}`).join(" ");
		const document = buildDeckDocument(
			input(deck([slide({ id: "s1", type: "word-cloud", question: "One word" })]), {
				results: [
					{
						slideId: "s1",
						type: "word-cloud",
						totalVotes: 1,
						words: [{ text: label, count: 1 }],
					},
				],
			}),
		);
		const baselines = textBaselinesIn(await renderDeckDocument(document));
		expect(baselines.length).toBeGreaterThan(60);
		expect(Math.min(...baselines)).toBeGreaterThan(0);
	});
});
