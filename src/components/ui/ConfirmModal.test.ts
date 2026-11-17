/**
 * The confirmation prompt is a dialog to assistive technology too (REQ219).
 *
 * Going live on a deck with a quiz nobody can get right asks the presenter
 * through this prompt, so the question has to reach a screen reader: the panel
 * is a modal dialog named by its title and described by its message. Where focus
 * goes is behaviour a static render cannot show, and is checked in the browser.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmModal } from "./ConfirmModal";

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
