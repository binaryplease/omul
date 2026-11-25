/**
 * The confirmation prompt is a dialog to assistive technology too (REQ219).
 *
 * Going live on a deck with a quiz nobody can get right asks the presenter
 * through this prompt, so the question has to reach a screen reader: the panel
 * is a modal dialog named by its title and described by its message. Where focus
 * goes is behaviour a static render cannot show, and is checked in the browser.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cancelOnEscape, ConfirmModal } from "./ConfirmModal";

const render = (open: boolean) =>
	renderToStaticMarkup(
		createElement(ConfirmModal, {
			open,
			title: "A quiz question has no correct answer",
			message: "Slide 2 has no correct answer.",
			confirmLabel: "Start anyway",
			onConfirm: () => {},
			onCancel: () => {},
		}),
	);

describe("ConfirmModal (REQ219)", () => {
	test("the panel is a modal dialog named by its title and described by its message", () => {
		const markup = render(true);
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		const labelledBy = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
		const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
		expect(markup).toContain(
			`<h3 id="${labelledBy}" class="text-lg font-semibold mb-2">A quiz question has no correct answer</h3>`,
		);
		expect(markup).toContain(
			`<p id="${describedBy}" class="text-text-muted text-sm mb-6">Slide 2 has no correct answer.</p>`,
		);
	});

	test("closed, it renders nothing", () => {
		expect(render(false)).toBe("");
	});
});

describe("Escape in ConfirmModal (REQ199)", () => {
	const press = (key: string) => {
		const pressed = { key, defaultPrevented: false, cancelled: 0 };
		cancelOnEscape(
			{
				key,
				preventDefault: () => {
					pressed.defaultPrevented = true;
				},
			},
			() => {
				pressed.cancelled += 1;
			},
		);
		return pressed;
	};

	test("Escape cancels the dialog and is marked handled", () => {
		const escape = press("Escape");
		expect(escape.cancelled).toBe(1);
		expect(escape.defaultPrevented).toBe(true);
	});

	test("any other key neither cancels nor is marked handled", () => {
		for (const key of ["Enter", " ", "Tab", "ArrowRight", "a"]) {
			const other = press(key);
			expect(other.cancelled).toBe(0);
			expect(other.defaultPrevented).toBe(false);
		}
	});

	test("the dialog's key handler is the one that marks Escape", () => {
		const source = readFileSync(join(import.meta.dir, "ConfirmModal.tsx"), "utf8");
		expect(source).toContain("onKeyDown={(event) => cancelOnEscape(event, onCancel)}");
	});
});
