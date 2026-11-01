/**
 * The shared dialog shell is a dialog to assistive technology too (REQ241).
 *
 * "Share the results" and the other sharing, export and account dialogs are
 * drawn by this shell, so each of them has to reach a screen reader as a modal
 * dialog named by its title, as the "Clear the results" prompt does (REQ219).
 * Where focus goes and that Escape closes it from anywhere is behaviour a static
 * render cannot show, and is checked in the browser.
 */

import { describe, expect, test } from "bun:test";
import { Link2 } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal } from "./Modal";

describe("Modal (REQ241)", () => {
	test("the panel is a modal dialog named by its title", () => {
		const markup = renderToStaticMarkup(
			createElement(
				Modal,
				{ title: "Share the results", icon: Link2, onClose: () => {} },
				"Body",
			),
		);
		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		const labelledBy = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
		expect(labelledBy).toBeTruthy();
		expect(markup).toContain(
			`<h3 id="${labelledBy}" class="flex-1 text-lg font-semibold">Share the results</h3>`,
		);
	});

	test("the panel can take focus from script but is not a Tab stop", () => {
		const markup = renderToStaticMarkup(
			createElement(Modal, { title: "Export this session", onClose: () => {} }),
		);
		expect(markup).toMatch(/role="dialog"[^>]*tabindex="-1"/);
	});
});
