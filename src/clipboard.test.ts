/**
 * A copy control on a page that may not write to the clipboard says so.
 *
 * On a page served over plain HTTP (the LAN case of REQ212) the browser leaves
 * `navigator.clipboard` undefined. Before this, the presenter's copy handlers
 * threw on it before their toast ran, so the presenter saw nothing at all. Bun
 * has no `navigator.clipboard` either, which makes the test runner such a page.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	browserClipboard,
	type ClipboardWriter,
	clipboardFailureMessage,
	copyWithFeedback,
	writeClipboardText,
} from "./clipboard";
import { ENGLISH_INTERFACE_TEXT, interfaceTextFor } from "./interface-text";

const EDIT_LINK = "http://192.168.1.20:3000/edit/pres-1#share=secret-token";

function recordingNotify() {
	const toasts: { message: string; tone: "success" | "error" }[] = [];
	return {
		toasts,
		notify: (message: string, tone: "success" | "error") => {
			toasts.push({ message, tone });
		},
	};
}

function recordingClipboard() {
	const written: string[] = [];
	const clipboard: ClipboardWriter = {
		writeText: async (value) => {
			written.push(value);
		},
	};
	return { written, clipboard };
}

describe("a copy control without navigator.clipboard", () => {
	test("the test runner has no clipboard, as a plain-HTTP page has none", () => {
		expect(globalThis.navigator?.clipboard).toBeUndefined();
		expect(browserClipboard()).toBeNull();
	});

	test("shows an error toast and resolves false instead of throwing", async () => {
		const { toasts, notify } = recordingNotify();
		const copying = copyWithFeedback({
			value: EDIT_LINK,
			copiedMessage: "Edit link copied to clipboard",
			notify,
		});
		await expect(copying).resolves.toBe(false);
		expect(toasts).toEqual([
			{ message: ENGLISH_INTERFACE_TEXT.share.copyUnavailable, tone: "error" },
		]);
	});

	test("an explicitly missing clipboard reads the same", async () => {
		const { toasts, notify } = recordingNotify();
		await expect(
			copyWithFeedback({
				value: "123456",
				copiedMessage: "Join code copied to clipboard",
				notify,
				clipboard: null,
			}),
		).resolves.toBe(false);
		expect(toasts.map((toast) => toast.tone)).toEqual(["error"]);
		expect(await writeClipboardText("123456", null)).toBe("unavailable");
	});

	test("the error is in the interface language", async () => {
		const german = interfaceTextFor("de");
		const { toasts, notify } = recordingNotify();
		await copyWithFeedback({
			value: "123456",
			copiedMessage: "Kopiert",
			notify,
			text: german,
			clipboard: null,
		});
		expect(toasts[0]?.message).toBe(german.share.copyUnavailable);
		expect(german.share.copyUnavailable).not.toBe(
			ENGLISH_INTERFACE_TEXT.share.copyUnavailable,
		);
	});

	test("the toast that shows the error needs no crypto.randomUUID (REQ212)", () => {
		// A plain-HTTP page has no `crypto.randomUUID`; a toast that minted its id
		// with it would throw in place of showing the copy error.
		const toast = readFileSync(
			join(import.meta.dir, "components", "ui", "Toast.tsx"),
			"utf8",
		);
		expect(toast).not.toContain("randomUUID(");
	});

	test("no failure message carries the copied value", async () => {
		for (const outcome of ["unavailable", "refused"] as const) {
			for (const language of ["en", "de"] as const) {
				const message = clipboardFailureMessage(
					outcome,
					interfaceTextFor(language),
				);
				expect(message).not.toContain("secret-token");
				expect(message).not.toContain("http");
			}
		}
	});
});

describe("a copy control with a clipboard", () => {
	test("writes the value and shows the confirmation", async () => {
		const { written, clipboard } = recordingClipboard();
		const { toasts, notify } = recordingNotify();
		await expect(
			copyWithFeedback({
				value: EDIT_LINK,
				copiedMessage: "Edit link copied to clipboard",
				notify,
				clipboard,
			}),
		).resolves.toBe(true);
		expect(written).toEqual([EDIT_LINK]);
		expect(toasts).toEqual([
			{ message: "Edit link copied to clipboard", tone: "success" },
		]);
	});

	test("a write the browser refuses shows an error and does not throw", async () => {
		const clipboard: ClipboardWriter = {
			writeText: async () => {
				throw new DOMException("Document is not focused.", "NotAllowedError");
			},
		};
		const { toasts, notify } = recordingNotify();
		await expect(
			copyWithFeedback({
				value: EDIT_LINK,
				copiedMessage: "Edit link copied to clipboard",
				notify,
				clipboard,
			}),
		).resolves.toBe(false);
		expect(toasts).toEqual([
			{ message: ENGLISH_INTERFACE_TEXT.share.copyRefused, tone: "error" },
		]);
	});
});
