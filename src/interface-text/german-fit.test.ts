/**
 * German labels are longer than English ones, and three places cut them off
 * until they were laid out to fit (REQ248, from the earlier unmerged branch): the share
 * dialog's access-level picker, the API keys row, and the slide-type menu
 * beside the editor's canvas. Each layout is held here by reading the source,
 * because this repo renders no DOM in tests; the browser pass in REQ248's log
 * is where the fit itself was looked at.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGLISH_INTERFACE_TEXT, interfaceTextFor } from ".";

const source = (...path: string[]) =>
	readFileSync(join(import.meta.dir, "..", ...path), "utf8");

describe("the share dialog's level picker is as wide as its longest level", () => {
	const dialog = source("components", "CollaboratorsDialog.tsx");

	test("no fixed width is set on the box around a level picker", () => {
		// A `w-32`, then a `w-36`, cut "Kommentieren" short.
		expect(dialog).not.toMatch(/<div className="w-\d+ shrink-0">\s*<select/);
	});

	test("both lists draw the picker in a box that only refuses to shrink", () => {
		const boxes = dialog.match(/<div className="shrink-0">\s*<select/g);
		expect(boxes?.length).toBe(2);
	});

	test("the longest German level is the one the fix was for", () => {
		const levels = Object.values(interfaceTextFor("de").sharing.accessLevels).map(
			(level) => level.label,
		);
		expect(levels).toContain("Kommentieren");
		expect(Math.max(...levels.map((label) => label.length))).toBe(
			"Kommentieren".length,
		);
	});
});

describe("the API keys row stacks on a phone", () => {
	const auth = source("auth.tsx");
	const row = auth.slice(
		auth.indexOf("placeholder={words.keyNamePlaceholder}") - 600,
		auth.indexOf("placeholder={words.keyNamePlaceholder}"),
	);

	test("the name field and Create sit in a column below sm, in a row from sm", () => {
		expect(row).toContain('<div className="flex flex-col gap-2 sm:flex-row">');
	});

	test("the German placeholder is the short one awaiting the owner's approval", () => {
		expect(interfaceTextFor("de").account.keyNamePlaceholder).toBe(
			"Name (z. B. Laptop)",
		);
		expect(
			interfaceTextFor("de").account.keyNamePlaceholder.length,
		).toBeLessThanOrEqual(ENGLISH_INTERFACE_TEXT.account.keyNamePlaceholder.length);
	});
});

describe("the slide-type menu stays inside the settings column", () => {
	const editor = source("components", "SlideEditor.tsx");

	test("the popover is anchored to the whole header row", () => {
		expect(editor).toContain(
			'<div className="relative flex items-center justify-between gap-2">',
		);
	});

	test("the popover is never wider than that row", () => {
		const popover = editor.match(
			/<div className="absolute left-0 top-full z-30 mt-2 max-h-\[70vh\] w-80 ([^ "]+)/,
		);
		expect(popover?.[1]).toBe("max-w-full");
		expect(editor).not.toContain("w-80 max-w-[calc(100vw-2rem)]");
	});
});
