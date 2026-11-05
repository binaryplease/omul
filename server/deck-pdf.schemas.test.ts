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
 *   - **Nothing the faces cannot draw reaches the page.** {@link faceText} is
 *     what stands between a participant's Arabic or Thai and a blank box or a
 *     `drawText` that throws (REQ158).
 *
 * Pure: no store, no app, no clock beyond the instant handed in.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import {
	bodyTextWrapper,
	buildDeckDocument,
	cellText,
	deckPdfFilename,
	type DeckPdfInput,
	EMPTY_VALUE,
	faceText,
	PDF_CONTENT_TYPE,
	type PdfBlock,
	type PdfDocument,
	plainTextFromMarkdown,
	questionBlocksFor,
	renderDeckDocument,
	resultBlocksFor,
} from "./deck-pdf";
import { drawnFontNames, drawnLines, drawnRuns } from "./deck-pdf.test-support";
import type { SlideResultsPayload } from "./results-export";
import {
	type Presentation,
	PresentationSchema,
	type Slide,
	SLIDE_TEXT_MAX_LENGTH,
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
 * Render a slide whose question and body are each one unbroken run of `length`
 * characters, and say how long the render took in milliseconds.
 */
async function renderUnbrokenRun(
	questionCharacter: string,
	bodyCharacter: string,
	length: number,
): Promise<number> {
	const document = buildDeckDocument(
		input(
			deck([
				slide({
					id: "s1",
					type: "text",
					question: questionCharacter.repeat(length),
					body: bodyCharacter.repeat(length),
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
		// An arrow is not a character the embedded face draws, so none is written.
		expect(faceText(text)).toBe(text);
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

	test("links and bold are read as the expressions they replaced read them (REQ213)", () => {
		// The leftmost `[` opens, the first `]` and `)` close, an empty address is
		// no link, and a link that fails leaves its text exactly as written.
		expect(plainTextFromMarkdown("[a[b](c) [d](e)")).toBe("a[b (c) d (e)");
		expect(plainTextFromMarkdown("[a]() [b](c)")).toBe("[a]() b (c)");
		expect(plainTextFromMarkdown("[a] (b) [c](d")).toBe("[a] (b) [c](d");
		expect(plainTextFromMarkdown("[a](b(c))")).toBe("a (b(c))");
		// A bold run closes on the first matching pair after a non-space, and a
		// pair of the other kind does not close it. Italic runs after bold, so a
		// pair left standing can still be read as two single delimiters.
		expect(plainTextFromMarkdown("**a __b** c")).toBe("a __b c");
		expect(plainTextFromMarkdown("**a **b**")).toBe("a **b");
		expect(plainTextFromMarkdown("** a** **b **")).toBe("** a** *b *");
		expect(plainTextFromMarkdown("*****")).toBe("*");
		expect(plainTextFromMarkdown("[**Docs**](https://example.com/a_b)")).toBe(
			"Docs (https://example.com/a_b)",
		);
	});

	test("adversarial markup costs work linear in the text (REQ213)", () => {
		// The same amount of text, cut once into many short fields and once into
		// few long ones: linear work takes the same time for both, quadratic work
		// takes eight times as long for the long ones. Compared as a ratio rather
		// than against a clock, so the bound holds on any machine. Driven through
		// the document builder, so it is the export's own reduction being timed.
		const longest = SLIDE_TEXT_MAX_LENGTH;
		const shortest = longest / 8;
		const totalPerField = longest * 32;
		const exportOf = (unit: string, fieldLength: number) => {
			const text = unit.repeat(Math.ceil(fieldLength / unit.length)).slice(0, fieldLength);
			const slides = Array.from({ length: totalPerField / fieldLength }, (_, index) =>
				slide({ id: `s${index}`, type: "text", question: text, body: text }),
			);
			return input(deck(slides), { includeResults: false });
		};
		const fastest = (deckInput: DeckPdfInput) => {
			let best = Number.POSITIVE_INFINITY;
			for (let attempt = 0; attempt < 9; attempt++) {
				const started = performance.now();
				buildDeckDocument(deckInput);
				best = Math.min(best, performance.now() - started);
			}
			return best;
		};
		// The last unit is a span that matches, so `withoutLanguageMarking` takes its
		// dropping path. The assertion fails if a change to the mark's syntax leaves
		// this unit unmatched, because the ratio would then measure the wrong path.
		const matchingLanguageSpan = "[x]{lang=fr}";
		expect(plainTextFromMarkdown(matchingLanguageSpan)).toBe("x");
		for (const unit of ["[", "[a](", "[a](b", "**a ", "__a ", "*a ", "_a ", "`a", matchingLanguageSpan]) {
			const short = exportOf(unit, shortest);
			const long = exportOf(unit, longest);
			fastest(short);
			const ratio = fastest(long) / Math.max(fastest(short), 0.05);
			expect({ unit, ratio: ratio < 3 }).toEqual({ unit, ratio: true });
		}
	}, 30_000);

	test("a passage in another language keeps its words and drops the marking (REQ133)", () => {
		expect(plainTextFromMarkdown("She said [bonjour]{lang=fr} twice")).toBe(
			"She said bonjour twice",
		);
		expect(plainTextFromMarkdown("- [**Grüezi**]{lang=de-CH}")).toBe("• Grüezi");
		expect(
			plainTextFromMarkdown("[voir [la doc](https://example.com)]{lang=fr}"),
		).toBe("voir la doc (https://example.com)");
		expect(plainTextFromMarkdown("[il dit [ja]{lang=de}]{lang=fr}")).toBe(
			"il dit ja",
		);
		// What the slide shows as typed, the page prints as typed.
		expect(plainTextFromMarkdown("[bonjour]{lang=1}")).toBe("[bonjour]{lang=1}");
		expect(plainTextFromMarkdown("[bonjour]{dir=rtl}")).toBe("[bonjour]{dir=rtl}");
	});
});

describe("REQ158 — nothing reaches the page the face cannot draw", () => {
	test("Latin-1 and its typographic marks are kept, character for character", () => {
		const text = "Voilà — “quoted”, 50% • café…";
		expect(faceText(text)).toBe(text);
	});

	test("Latin Extended, Greek and Cyrillic are kept as authored", () => {
		// What the standard fonts folded before REQ158: `č` and `ż` printed as `c`
		// and `z`, and a Greek or Cyrillic word as a single `?`.
		for (const text of [
			"čeština",
			"Zażółć gęślą jaźń",
			"Łódź, Őrség, Şişli, Đặng",
			"Ελληνικά καλημέρα",
			"Привіт, світе — Їжак, Ґанок",
		]) {
			expect(faceText(text)).toBe(text);
		}
	});

	test("a letter typed as base plus accent is drawn from its composed glyph", () => {
		expect(faceText("c\u030Ceština")).toBe("čeština");
	});

	test("Chinese, Japanese and Korean are kept as authored", () => {
		// Drawn from the CJK face since REQ158's second slice; before it each of
		// these printed as a single `?`.
		for (const text of [
			"中文汉字，繁體中文。",
			"日本語のテキスト「こんにちは」ー・",
			"한국어 텍스트입니다",
			"Mixed 中文 and English, 日本語 and 한국어",
		]) {
			expect(faceText(text)).toBe(text);
		}
	});

	test("a script no face can express collapses to one mark", () => {
		// The emoji face has Arabic, Hebrew and Thai glyphs of its own, and draws
		// none of them: it is the emoji face and nothing else.
		expect(faceText("مرحبا")).toBe("?");
		expect(faceText("AשלוםB")).toBe("A?B");
		expect(faceText("สวัสดี and नमस्ते")).toBe("? and ?");
	});

	test("emoji are kept as authored", () => {
		// Drawn from the emoji face since REQ158's third slice; before it each run
		// of these printed as a single `?`. The ordinary case — a participant typed
		// one into a word cloud — and the ones the text face's own plane holds.
		expect(faceText("nice 🎉")).toBe("nice 🎉");
		expect(faceText("中文🎉")).toBe("中文🎉");
		expect(faceText("😀👍🔥🚀 ❤ ✅ ⭐ ☕ ✨")).toBe("😀👍🔥🚀 ❤ ✅ ⭐ ☕ ✨");
	});

	test("an emoji sequence keeps the parts the faces draw, and no mark between them", () => {
		// Joined by zero-width joiners, the members are kept and the joiners
		// dropped: the faces draw no ligature for a joiner to ask for.
		expect(faceText("👨\u200D👩\u200D👧")).toBe("👨👩👧");
		// A skin tone is a colour the monochrome face cannot show: dropped.
		expect(faceText("hi 👋🏽 there")).toBe("hi 👋 there");
		// A keycap is drawn as its digit: the face's keycap mark has no width and
		// would box the character before the digit too.
		expect(faceText("1\uFE0F\u20E3")).toBe("1");
		// A flag is its two regional indicators; a subdivision flag's tags are
		// invisible and dropped, leaving the black flag they qualified.
		expect(faceText("🇩🇪")).toBe("🇩🇪");
		expect(faceText("🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}!")).toBe("🏴!");
	});

	test("a variation selector after a drawn character leaves no mark behind", () => {
		// Invisible by design: a Japanese name's Han variant, an emoji-style
		// presentation. Folded on their own they put a `?` mid-word.
		expect(faceText("葛\u{E0100}飾区")).toBe("葛飾区");
		expect(faceText("㊗\uFE0F")).toBe("㊗");
		expect(faceText("中文\uFE0F中文")).toBe("中文中文");
		expect(faceText("I ❤\uFE0F it")).toBe("I ❤ it");
	});

	test("an emoji the face has only a hex-code placeholder for folds", () => {
		// Unifont 15.0.06 maps every code point of its planes; what Unicode had not
		// assigned by 15.0 is mapped to the code point's hex digits in a box. Read
		// as coverage, `🫩` printed as a box reading `01F AE9` rather than as `?`.
		expect(faceText("\u{1FAE9}")).toBe("?");
		expect(faceText("hi \u{1FAEA}!")).toBe("hi ?!");
		expect(faceText("\u{1FC45}")).toBe("?");
		// Every emoji Unicode 16.0 and 17.0 added, and every code point still
		// reserved in the emoji blocks — the ones a later Unicode may assign.
		const added = [
			0x1f6d8, 0x1fa89, 0x1fa8a, 0x1fa8e, 0x1fa8f, 0x1fabe, 0x1fac6, 0x1fac8, 0x1facd,
			0x1fadc, 0x1fadf, 0x1fae9, 0x1faea, 0x1faef,
		];
		const reserved: number[] = [];
		for (let codePoint = 0x1f000; codePoint <= 0x1fffd; codePoint++) {
			const character = String.fromCodePoint(codePoint);
			if (/\p{Cn}/u.test(character) && /\p{Extended_Pictographic}/u.test(character)) {
				reserved.push(codePoint);
			}
		}
		expect(reserved.length).toBeGreaterThan(1_000);
		for (const codePoint of [...added, ...reserved]) {
			expect({ codePoint, drawn: faceText(String.fromCodePoint(codePoint)) }).toEqual({
				codePoint,
				drawn: "?",
			});
		}
		// The emoji Unicode 15.0 had are drawn, beside them.
		expect(faceText("\u{1FAE0}\u{1FAF6}\u{1FA77}")).toBe("\u{1FAE0}\u{1FAF6}\u{1FA77}");
	});

	test("the CJK and emoji faces draw CJK and emoji and nothing else", () => {
		// Both have Latin, arrows and symbols of their own; drawing those from them
		// would set one sentence in two designs. An arrow still folds as it did.
		expect(faceText("0 → 10")).toBe("0 ? 10");
	});

	test("what the face lacks still folds to the nearest form it has", () => {
		// A full-width letter decomposes to the plain one the face does draw.
		expect(faceText("ＡＢ")).toBe("AB");
	});

	test("a control character is whitespace, not an unencodable script", () => {
		// A tab is ordinary in an indented markdown list and a `\r` rides every
		// CRLF-authored deck. Read as "not in the face" they would print as a
		// literal `?` in the middle of a sentence.
		expect(faceText("one\ttwo")).toBe("one two");
		expect(faceText("one\r")).toBe("one ");
		expect(faceText("\t- indented item")).toBe(" - indented item");
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
	test("rendering a long deck hands the thread back while it works (REQ213)", async () => {
		// A deck with every field at its cap: real render work, about a second at
		// the full slide limit. Bun answers every request from this one thread, so
		// what matters is not how long the render takes but how long the thread
		// is gone at a stretch. A timer asking to run every millisecond measures
		// that stretch; compared with the render's own length rather than with a
		// clock, so the bound holds on any machine — a render that never yields
		// keeps the thread for nearly all of itself, one that does for a sliver.
		const text = "lorem ipsum dolor sit amet ".repeat(200).slice(0, SLIDE_TEXT_MAX_LENGTH);
		const slides = Array.from({ length: 60 }, (_, index) =>
			slide({ id: `s${index}`, type: "text", question: text, body: text }),
		);
		const document = buildDeckDocument(input(deck(slides)));

		let longestGap = 0;
		let lastTick = performance.now();
		const probe = setInterval(() => {
			const now = performance.now();
			longestGap = Math.max(longestGap, now - lastTick);
			lastTick = now;
		}, 1);
		const started = performance.now();
		lastTick = started;
		await renderDeckDocument(document);
		const renderTook = performance.now() - started;
		clearInterval(probe);

		expect(renderTook).toBeGreaterThan(0);
		expect({ shareOfRenderHeld: longestGap / renderTook < 0.25 }).toEqual({
			shareOfRenderHeld: true,
		});
	}, 30_000);

	test("a document renders to PDF bytes, whatever it carries", async () => {
		const document = buildDeckDocument(
			input(
				deck([
					slide({
						id: "s1",
						type: "multiple-choice",
						// Text the embedded faces cannot draw: the render must fold the
						// Arabic rather than throw, which is the whole reason `faceText`
						// runs at the drawing site rather than at the building one.
						question: "日本語 — which one? 🎉 مرحبا",
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
		// budget only says how fast the box is. A short run first pays the one-off
		// costs — parsing the faces, warming the JIT — so `small` carries none the
		// larger run does not, and the ratio compares like with like.
		await renderUnbrokenRun("x", "y", 1_000);
		const small = await renderUnbrokenRun("x", "y", 40_000);
		const large = await renderUnbrokenRun("x", "y", 160_000);

		// The ratio is the assertion that carries this test; the absolute bar below
		// it is a backstop, not a second independent catch. Measured at these two
		// sizes before the text was shaped: linear 120ms and 480ms, a ratio of 4.0,
		// against quadratic 136ms and 2,417ms, a ratio of 17.8. So the shape is what
		// separates them by an order of magnitude. Since deck PDFs shape their text
		// in Noto Sans (REQ158) a run costs about twice that: 261ms and 926–1,002ms
		// locally, a ratio of 3.5–3.8, and a shared CI runner is several times
		// slower again — it once took 5,093ms over the larger run and failed a 5s
		// bar with the ratio well inside 8. So the backstop is 15s, as for the CJK
		// run below, and the timeout is set as for its siblings rather than left at
		// bun's 5s, which is a second wall-clock budget nobody chose. Read a
		// failure of the ratio as the regression; read a failure of the budget as
		// either that or a machine under load. Shaping also dilutes the ratio: with
		// the window removed this render measured 351ms and 2,327ms, 6.6, which
		// passes — so the next test times the wrap alone, and carries the claim.
		expect(large).toBeLessThan(15_000);
		expect(large / Math.max(small, 1)).toBeLessThan(8);
	}, 30_000);

	test("the wrap itself is linear in the run it breaks", async () => {
		// The render above times the wrap together with drawing, and drawing
		// shapes every line (REQ158): a linear cost that, at 40,000 characters, is
		// most of the time. With the window removed (WRAP_PROBE_CHARACTERS at
		// Infinity) that dilution held the render's ratio to 6.3–6.8 — under 8, so
		// the regression it exists for passed. Timed alone, the wrap shows its
		// shape plainly: measured over ten wraps of each size, linear 11–12ms and
		// 40–43ms, a ratio of 3.6–3.7, against quadratic 329ms and 5,097ms, 15.5.
		// Ten of each, because one linear wrap of 40,000 characters takes about a
		// millisecond, where a pause of the runner's would decide the ratio.
		const wrap = await bodyTextWrapper();
		const time = (length: number) => {
			const run = "x".repeat(length);
			let elapsed = 0;
			for (let round = 0; round < 10; round++) {
				const startedAt = performance.now();
				const lines = wrap(run);
				elapsed += performance.now() - startedAt;
				expect(lines.join("")).toBe(run);
			}
			return elapsed;
		};
		time(1_000);
		const small = time(40_000);
		const large = time(160_000);
		expect(large / Math.max(small, 1)).toBeLessThan(8);
	}, 60_000);

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
		const lines = (await drawnRuns(bytes)).filter((piece) => /^[~|]+$/.test(piece));

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

describe("REQ158 — the embedded faces on the page", () => {
	/** A deck and its responses in every script the faces cover, and one they do not. */
	function multiScriptDocument(): PdfDocument {
		return buildDeckDocument(
			input(
				deck(
					[
						slide({
							id: "s1",
							type: "multiple-choice",
							question: "Która opcja? Ποια επιλογή; Який варіант?",
							options: [
								{ id: "a", text: "Łódź" },
								{ id: "b", text: "Αθήνα" },
								{ id: "c", text: "Київ" },
							],
						}),
						slide({
							id: "s2",
							type: "multiple-choice",
							question: "你最喜欢哪个城市？どの都市が好き？어느 도시를 좋아해요?",
							options: [
								{ id: "a", text: "北京" },
								{ id: "b", text: "東京" },
								{ id: "c", text: "서울" },
							],
						}),
						slide({ id: "s3", type: "open-text", question: "Thoughts?" }),
					],
					{ title: "Огляд — 季度回顾 — 분기 검토" },
				),
				{
					results: [
						{
							slideId: "s1",
							type: "multiple-choice",
							totalVotes: 3,
							respondentCount: 3,
							options: [
								{ id: "a", text: "Łódź", count: 1, isCorrect: null },
								{ id: "b", text: "Αθήνα", count: 1, isCorrect: null },
								{ id: "c", text: "Київ", count: 1, isCorrect: null },
							],
						},
						{
							slideId: "s2",
							type: "multiple-choice",
							totalVotes: 3,
							respondentCount: 3,
							options: [
								{ id: "a", text: "北京", count: 1, isCorrect: null },
								{ id: "b", text: "東京", count: 1, isCorrect: null },
								{ id: "c", text: "서울", count: 1, isCorrect: null },
							],
						},
						{
							slideId: "s3",
							type: "open-text",
							totalVotes: 7,
							responses: [
								{ id: "r1", text: "Dziękuję, było świetnie", upvotes: 2 },
								{ id: "r2", text: "Ευχαριστώ πολύ", upvotes: 1 },
								{ id: "r3", text: "Дякую, все зрозуміло", upvotes: 0 },
								{ id: "r4", text: "谢谢，讲得非常好。", upvotes: 0 },
								{ id: "r5", text: "とても良かったです「最高」", upvotes: 0 },
								{ id: "r6", text: "정말 좋았어요", upvotes: 0 },
								{ id: "r7", text: "ありがとう 🎉 done", upvotes: 0 },
								{ id: "r8", text: "thanks شكرا!", upvotes: 0 },
							],
						},
					],
				},
			),
		);
	}

	/**
	 * A document of Latin, Greek and Cyrillic alone — nothing the CJK or the
	 * emoji face draws.
	 */
	function noCjkDocument(): PdfDocument {
		return buildDeckDocument(
			input(
				deck([slide({ id: "s1", type: "open-text", question: "Która opcja? Який?" })], {
					title: "Přehled — Ελληνικά — Огляд",
				}),
			),
		);
	}

	test("deck text and responses in Latin Extended, Greek and Cyrillic reach the page as authored", async () => {
		const drawn = await drawnLines(await renderDeckDocument(multiScriptDocument()));
		for (const authored of [
			"Która opcja? Ποια επιλογή; Який варіант?",
			"Łódź",
			"Αθήνα",
			"Київ",
			"Dziękuję, było świetnie",
			"Ευχαριστώ πολύ",
			"Дякую, все зрозуміло",
		]) {
			expect(drawn.join("\n")).toContain(authored);
		}
	});

	test("deck text and responses in Chinese, Japanese and Korean reach the page as authored", async () => {
		const drawn = await drawnLines(await renderDeckDocument(multiScriptDocument()));
		// Whole lines, not fragments: a line that mixes scripts is drawn one run
		// per face, and these read the runs back joined on their baseline — so the
		// title is asserted as the one line it was authored as, Latin and CJK alike.
		expect(drawn).toContain("Огляд — 季度回顾 — 분기 검토");
		expect(drawn).toContain("你最喜欢哪个城市？どの都市が好き？어느 도시를 좋아해요?");
		const text = drawn.join("\n");
		for (const authored of [
			"• 北京",
			"• 東京",
			"• 서울",
			"谢谢，讲得非常好。",
			"とても良かったです「最高」",
			"정말 좋았어요",
		]) {
			expect(text).toContain(authored);
		}
	});

	test("CJK runs are drawn from the CJK face and the rest from Noto Sans", async () => {
		const bytes = await renderDeckDocument(multiScriptDocument());
		const fonts = await drawnFontNames(bytes);
		expect(fonts.some((name) => name.includes("Sarasa-Gothic-SC-Regular"))).toBe(true);
		expect(fonts.some((name) => name.includes("NotoSans-Regular"))).toBe(true);
		expect(fonts.some((name) => name.includes("NotoSans-Bold"))).toBe(true);
		// And a run is one face's: a CJK title is several runs, not one.
		const runs = await drawnRuns(bytes);
		expect(runs).toContain("季度回顾");
		expect(runs).toContain("Огляд — ");
	});

	test("emoji in responses reach the page, drawn from the emoji face", async () => {
		const bytes = await renderDeckDocument(multiScriptDocument());
		expect((await drawnLines(bytes)).join("\n")).toContain("ありがとう 🎉 done");
		expect(await drawnRuns(bytes)).toContain("🎉");
		// `🎉` is above the Basic Multilingual Plane, so the upper file draws it.
		const fonts = await drawnFontNames(bytes);
		expect(fonts.some((name) => name.includes("UnifontUpper"))).toBe(true);
	});

	test("a script no face draws still folds, and the line it rides on still draws", async () => {
		const drawn = await drawnLines(await renderDeckDocument(multiScriptDocument()));
		expect(drawn.join("\n")).toContain("thanks ?!");
	});

	test("an emoji newer than the face reaches the page as a mark, not a placeholder box", async () => {
		const document = buildDeckDocument(
			input(
				deck([
					slide({
						id: "s1",
						type: "text",
						question: "Plain",
						body: "new \u{1FAE9} \u{1FAEA} \u{1FC45} old \u{1F600}",
					}),
				]),
				{ includeResults: false },
			),
		);
		const bytes = await renderDeckDocument(document);
		expect(await drawnLines(bytes)).toContain("new ? ? ? old \u{1F600}");
		// Only the emoji the face draws was taken from it: one glyph, one run.
		expect((await drawnRuns(bytes)).filter((run) => /\p{Extended_Pictographic}/u.test(run))).toEqual([
			"\u{1F600}",
		]);
	});

	test("an emoji sequence draws as its parts, with no mark between them", async () => {
		const document = buildDeckDocument(
			input(
				deck([
					slide({
						id: "s1",
						type: "text",
						question: "Plain",
						body: "family 👨\u200D👩\u200D👧 wave 👋🏽 key 1\uFE0F\u20E3 flag 🇩🇪 🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} love ❤\uFE0F",
					}),
				]),
				{ includeResults: false },
			),
		);
		const bytes = await renderDeckDocument(document);
		expect(await drawnLines(bytes)).toContain(
			"family 👨👩👧 wave 👋 key 1 flag 🇩🇪 🏴 love ❤",
		);
		// `❤` is in the Basic Multilingual Plane, the rest above it:
		// both of the emoji face's files are embedded, and nothing else.
		const fonts = await drawnFontNames(bytes);
		expect(fonts.some((name) => name.includes("UnifontMedium"))).toBe(true);
		expect(fonts.some((name) => name.includes("UnifontUpper"))).toBe(true);
		expect(fonts.some((name) => name.includes("Sarasa"))).toBe(false);
	});

	test("an unbroken run mixing Latin and emoji breaks without losing a character", async () => {
		// Every emoji here is a surrogate pair, so a break placed by UTF-16 unit
		// that split one would read back as two broken halves, or not at all.
		const run = Array.from({ length: 4_001 }, (_unused, index) =>
			index % 5 < 2 ? "~" : "😀",
		).join("");
		const document = buildDeckDocument(
			input(
				deck([slide({ id: "s1", type: "text", question: "Plain", body: run })]),
				{ includeResults: false },
			),
		);
		const lines = (await drawnLines(await renderDeckDocument(document))).filter((line) =>
			/^[~😀]+$/u.test(line),
		);
		expect(lines.join("")).toBe(run);
		expect(lines.length).toBeGreaterThan(20);
	});

	test("a line mixing Latin and CJK wraps at its words and draws them in order", async () => {
		// Written in an alphabet the rest of the document never draws, so every
		// line of the body is recognisably its own (see the over-wide run test).
		const words = Array.from({ length: 300 }, (_unused, index) =>
			["zq中文", "한국zq", "日本語", "zz", "qz테스트"][index % 5],
		);
		const document = buildDeckDocument(
			input(
				deck([slide({ id: "s1", type: "text", question: "Plain", body: words.join(" ") })]),
				{ includeResults: false },
			),
		);
		const lines = (await drawnLines(await renderDeckDocument(document))).filter((line) =>
			/^[zq中文한국日本語테스트 ]+$/u.test(line),
		);
		expect(lines.join(" ")).toBe(words.join(" "));
		expect(lines.length).toBeGreaterThan(10);
	});

	test("an unbroken run mixing Latin and CJK breaks without losing a character", async () => {
		const run = Array.from({ length: 4_001 }, (_unused, index) =>
			index % 5 < 2 ? "~" : "漢",
		).join("");
		const document = buildDeckDocument(
			input(
				deck([slide({ id: "s1", type: "text", question: "Plain", body: run })]),
				{ includeResults: false },
			),
		);
		const lines = (await drawnLines(await renderDeckDocument(document))).filter((line) =>
			/^[~漢]+$/u.test(line),
		);
		expect(lines.join("")).toBe(run);
		expect(lines.length).toBeGreaterThan(20);
	});

	test("an unbroken run of CJK wraps in linear time too", async () => {
		// The REQ159 shape again, through the second face: every character of the
		// run is measured and drawn from the CJK face, so a per-face path that
		// measured whole strings again would show here first. The ratio carries the
		// test, as it does above. The budget is wider than the Latin one because
		// the work is: a CJK character is about twice as wide, so the same run is
		// twice the lines, and the shaping pass `drawText` makes over each costs
		// about three times as much per character in the CJK face as in Noto Sans.
		// Measured at these sizes: 783ms and 3,131ms, a ratio of 4.0.
		const small = await renderUnbrokenRun("漢", "字", 40_000);
		const large = await renderUnbrokenRun("漢", "字", 160_000);
		expect(large).toBeLessThan(15_000);
		expect(large / Math.max(small, 1)).toBeLessThan(8);
	}, 30_000);

	test("an unbroken run of emoji wraps in linear time too", async () => {
		// The same shape through the emoji face: every character of the run is
		// measured and drawn from it, as a surrogate pair, so a per-face path that
		// measured whole strings again — or a break search that walked off a pair —
		// would show here first. The ratio carries the test, as it does above. An
		// emoji is a full em wide, about twice a Latin letter, so the same run is
		// twice the lines — but the face has no shaping tables, so the pass
		// `drawText` makes over each line costs next to nothing, and the run is
		// quicker than a Latin one. Measured at these sizes: 127ms and 378ms, a
		// ratio of 3.0, against 261ms and 916ms for Latin on the same machine.
		const small = await renderUnbrokenRun("😀", "🎉", 40_000);
		const large = await renderUnbrokenRun("😀", "🎉", 160_000);
		expect(large).toBeLessThan(5_000);
		expect(large / Math.max(small, 1)).toBeLessThan(8);
	}, 30_000);

	test("an export with no CJK or emoji in it carries neither face", async () => {
		const fonts = await drawnFontNames(await renderDeckDocument(noCjkDocument()));
		expect(fonts.some((name) => name.includes("NotoSans"))).toBe(true);
		expect(fonts.some((name) => name.includes("Sarasa"))).toBe(false);
		expect(fonts.some((name) => name.includes("Unifont"))).toBe(false);
	});

	test("the faces are subset, not carried whole, into every export", async () => {
		// Each weight of Noto Sans is over 600 KB, the CJK face about 24 MB and the
		// emoji face's two files about 25 MB between them; an export that carried
		// any of them whole would say nothing in under a megabyte.
		expect((await renderDeckDocument(noCjkDocument())).byteLength).toBeLessThan(60_000);
		expect((await renderDeckDocument(multiScriptDocument())).byteLength).toBeLessThan(150_000);
	});
});

describe("REQ158 — a vendored face the subsetter can write", () => {
	/**
	 * Where each glyph's record starts in a TrueType face, from its `loca` table
	 * — read off the bytes, because fontkit's typings do not expose the table.
	 */
	function glyphOffsets(face: Buffer): number[] {
		const tables = new Map<string, number>();
		for (let index = 0; index < face.readUInt16BE(4); index++) {
			const entry = 12 + index * 16;
			tables.set(face.toString("latin1", entry, entry + 4), face.readUInt32BE(entry + 8));
		}
		const head = tables.get("head") ?? 0;
		const maxp = tables.get("maxp") ?? 0;
		const loca = tables.get("loca") ?? 0;
		const long = face.readInt16BE(head + 50) === 1;
		return Array.from({ length: face.readUInt16BE(maxp + 4) + 1 }, (_unused, index) =>
			long ? face.readUInt32BE(loca + index * 4) : face.readUInt16BE(loca + index * 2) * 2,
		);
	}

	test("every face under server/fonts/ starts each glyph on an even byte", () => {
		// `@pdf-lib/fontkit` writes a subset's glyph offsets in the short `loca`
		// format whenever they fit — halved — without padding the records to make
		// that exact. A face with an odd-length glyph record subsets into glyphs
		// that start a byte off, which readers draw blank while the text still
		// extracts, so nothing but a rendered page would show it. That is what
		// ruled out the unhinted Noto Sans, Google's static Noto Sans SC and KR, and
		// Droid Sans Fallback; this is the check that would catch the next one.
		const directory = resolve(import.meta.dir, "fonts");
		const faces = readdirSync(directory).filter((name) => name.endsWith(".ttf"));
		expect(faces.length).toBeGreaterThanOrEqual(3);
		for (const name of faces) {
			const odd = glyphOffsets(readFileSync(resolve(directory, name))).filter(
				(offset) => offset % 2 !== 0,
			);
			expect({ name, odd: odd.length }).toEqual({ name, odd: 0 });
		}
	});
});
