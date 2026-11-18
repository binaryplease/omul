/**
 * Unit tests for the export dialog's words in the interface language (REQ248).
 *
 * What is asserted here is that the rows the presenter reads come from the
 * interface text, that English is the wording the descriptor always carried,
 * and that the control's name says why it is dead in German too.
 */

import { describe, expect, test } from "bun:test";
import { ENGLISH_INTERFACE_TEXT, interfaceTextFor } from "../interface-text";
import {
	DECK_EXPORT_FORMATS,
	deckExportFormatText,
	exportButtonLabel,
} from "./ExportDialog";

const german = interfaceTextFor("de");

describe("deckExportFormatText (REQ248)", () => {
	test("in English it is the wording each row always carried", () => {
		for (const format of DECK_EXPORT_FORMATS) {
			expect(deckExportFormatText(format.id, ENGLISH_INTERFACE_TEXT)).toEqual({
				label: format.label,
				summary: format.summary,
			});
		}
	});

	test("in German every row is named and summarised differently", () => {
		const labels = DECK_EXPORT_FORMATS.map(
			(format) => deckExportFormatText(format.id, german).label,
		);
		expect(new Set(labels).size).toBe(labels.length);
		for (const format of DECK_EXPORT_FORMATS) {
			expect(deckExportFormatText(format.id, german).summary).not.toBe(
				format.summary,
			);
		}
		expect(deckExportFormatText("xlsx", german).label).toContain(".xlsx");
	});
});

describe("exportButtonLabel in the interface language (REQ248)", () => {
	test("in English it reads as before", () => {
		expect(exportButtonLabel(true)).toBe(
			"Export this session — download it as a spreadsheet or as a PDF",
		);
	});

	test("a viewer who cannot export is still told why", () => {
		expect(exportButtonLabel(true, german)).toContain("PDF");
		expect(exportButtonLabel(false, german)).toContain(
			"du kannst diese Präsentation nicht bearbeiten",
		);
	});
});
