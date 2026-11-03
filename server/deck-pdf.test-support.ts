/**
 * Reading text back off a rendered deck PDF, for every suite that asserts on
 * what one says (`deck-pdf.*.test.ts`, and the PDF checks in the answer-deletion
 * and profanity-filter suites).
 *
 * Enough of a PDF reader to assert on, and no more. The export sets its text in
 * an embedded, subset face (REQ158), so a `<hex> Tj` operand is a run of glyph
 * ids rather than of characters, and the ids mean something different in each
 * font. What turns them back into text is the font's own `ToUnicode` CMap —
 * the table every PDF reader uses to copy text out of a file — so this reads
 * exactly what a reader's copy-and-paste would, through `pdf-lib`'s parser
 * rather than a second one written here. A font with no such table is one of
 * the PDF standard fonts, whose operands are single bytes in their own encoding
 * — read as latin-1, which agrees with it everywhere outside the C1 range.
 */

import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFRawStream,
} from "pdf-lib";

/** A stream's decoded bytes, as the latin-1 string its operators are written in. */
function streamText(stream: PDFRawStream): string {
	return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
}

/** One font's glyph ids → the text each draws, from its `ToUnicode` CMap. */
function toUnicodeTable(cmap: string): Map<number, string> {
	const table = new Map<number, string>();
	for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
		for (const entry of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
			// The destination is UTF-16BE; Buffer decodes only the little-endian form.
			const text = Buffer.from(entry[2], "hex").swap16().toString("utf16le");
			table.set(Number.parseInt(entry[1], 16), text);
		}
	}
	return table;
}

/**
 * Every run of text the document draws, in the order it draws them — one entry
 * per `drawText` call, so a line the wrapper produced is an entry. A line that
 * mixes scripts is drawn one call per face (REQ158), so it is several entries
 * here; {@link drawnLines} reads it back whole.
 */
export async function drawnRuns(bytes: Uint8Array): Promise<string[]> {
	return (await drawnPieces(bytes)).map((piece) => piece.text);
}

/**
 * Every line of text the document draws: consecutive runs on one page and one
 * baseline, joined. A line drawn from two faces reads back as the line — and so
 * does a label and the value drawn beside it, which share a baseline too.
 */
export async function drawnLines(bytes: Uint8Array): Promise<string[]> {
	const lines: string[] = [];
	let previous: DrawnPiece | null = null;
	for (const piece of await drawnPieces(bytes)) {
		if (previous !== null && previous.page === piece.page && previous.baseline === piece.baseline) {
			lines[lines.length - 1] += piece.text;
		} else {
			lines.push(piece.text);
		}
		previous = piece;
	}
	return lines;
}

/**
 * The names of the fonts the document's pages draw with — what a reader lists
 * as the file's embedded fonts, so a face that is not here is not in the file.
 */
export async function drawnFontNames(bytes: Uint8Array): Promise<string[]> {
	const document = await PDFDocument.load(bytes);
	const names = new Set<string>();
	for (const page of document.getPages()) {
		const fonts = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
		for (const [, reference] of fonts?.entries() ?? []) {
			const font = document.context.lookup(reference, PDFDict);
			names.add(font.lookup(PDFName.of("BaseFont"), PDFName).decodeText());
		}
	}
	return [...names];
}

/** One `drawText` call's text, and where it was drawn. */
type DrawnPiece = { page: number; baseline: number; text: string };

async function drawnPieces(bytes: Uint8Array): Promise<DrawnPiece[]> {
	const document = await PDFDocument.load(bytes);
	const runs: DrawnPiece[] = [];
	for (const [pageIndex, page] of document.getPages().entries()) {
		const tables = new Map<string, Map<number, string> | null>();
		const fonts = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
		for (const [name, reference] of fonts?.entries() ?? []) {
			const font = document.context.lookup(reference, PDFDict);
			const cmap = font.lookup(PDFName.of("ToUnicode"));
			tables.set(
				name.asString(),
				cmap instanceof PDFRawStream ? toUnicodeTable(streamText(cmap)) : null,
			);
		}

		const contents = page.node.Contents();
		const streams =
			contents instanceof PDFArray
				? contents
						.asArray()
						.map((item) => document.context.lookup(item))
						.filter((item): item is PDFRawStream => item instanceof PDFRawStream)
				: contents instanceof PDFRawStream
					? [contents]
					: [];
		let table: Map<number, string> | null = null;
		let baseline = 0;
		for (const stream of streams) {
			const operators =
				/(\/\S+)\s+[\d.]+\s+Tf|1 0 0 1 -?[\d.]+ (-?[\d.]+) Tm|<([0-9A-Fa-f]*)>\s*Tj/g;
			for (const operator of streamText(stream).matchAll(operators)) {
				if (operator[1] !== undefined) {
					table = tables.get(operator[1]) ?? null;
					continue;
				}
				if (operator[2] !== undefined) {
					baseline = Number(operator[2]);
					continue;
				}
				if (table === null) {
					runs.push({
						page: pageIndex,
						baseline,
						text: Buffer.from(operator[3], "hex").toString("latin1"),
					});
					continue;
				}
				const glyphTable = table;
				const glyphIds = operator[3].match(/.{4}/g) ?? [];
				runs.push({
					page: pageIndex,
					baseline,
					text: glyphIds
						.map((glyphId) => glyphTable.get(Number.parseInt(glyphId, 16)) ?? "\uFFFD")
						.join(""),
				});
			}
		}
	}
	return runs;
}
