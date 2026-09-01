#!/usr/bin/env bun
/**
 * Extract a feature-inventory spreadsheet → JSON.
 *
 *   bun scripts/extract-excel.ts [input.xlsx] [output.json]
 *
 * Row 3 contains the column headers; rows 4+ are data rows.
 * Each data row becomes a JSON object keyed by the header values.
 * Empty rows (all cells null/undefined) are skipped.
 *
 * The workbook is not in this repository — it is a working document supplied on
 * the command line. Both paths default under `.data/`, which is not tracked.
 */

import ExcelJS from "exceljs";
import { writeFileSync } from "fs";
import { join } from "path";

const INPUT =
	process.argv[2] ?? join(import.meta.dir, "../.data/inventory.xlsx");
const OUTPUT =
	process.argv[3] ?? join(import.meta.dir, "../.data/inventory.json");
const HEADER_ROW = 3;
const DATA_START_ROW = 4;

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(INPUT);

const sheet = wb.worksheets[0];
if (!sheet) throw new Error("No worksheet found in workbook");

// Build header map: column index → header string
const headers: Record<number, string> = {};
sheet.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (cell, colIdx) => {
	const value = cell.value;
	if (value !== null && value !== undefined) {
		headers[colIdx] = String(value).trim();
	}
});

console.log("Headers found:", headers);

// Helper: convert a cell value to a plain JS value
function cellValue(cell: ExcelJS.Cell): unknown {
	const v = cell.value;
	if (v === null || v === undefined) return null;
	// Hyperlink objects → plain URL string
	if (typeof v === "object" && "hyperlink" in v)
		return (v as ExcelJS.CellHyperlinkValue).hyperlink;
	// Rich text → plain string
	if (typeof v === "object" && "richText" in v)
		return (v as ExcelJS.CellRichTextValue).richText
			.map((r) => r.text)
			.join("");
	// Formula → result value
	if (typeof v === "object" && "result" in v)
		return (v as ExcelJS.CellFormulaValue).result ?? null;
	return v;
}

const records: Record<string, unknown>[] = [];

for (let rowIdx = DATA_START_ROW; rowIdx <= sheet.rowCount; rowIdx++) {
	const row = sheet.getRow(rowIdx);
	const obj: Record<string, unknown> = {};
	let hasValue = false;

	for (const [colIdxStr, header] of Object.entries(headers)) {
		const colIdx = Number(colIdxStr);
		const cell = row.getCell(colIdx);
		const val = cellValue(cell);
		obj[header] = val;
		if (val !== null && val !== undefined && val !== "") hasValue = true;
	}

	if (hasValue) records.push(obj);
}

writeFileSync(OUTPUT, JSON.stringify(records, null, 2), "utf-8");
console.log(`✓ Extracted ${records.length} rows → ${OUTPUT}`);
