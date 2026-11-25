// ── Writing to the clipboard from a copy control ──────────────────────
//
// `navigator.clipboard` exists only in a secure context. On a page served over
// plain HTTP, the LAN case of REQ212, it is `undefined`, and a handler that
// called `navigator.clipboard.writeText` threw before its toast ran: the
// presenter saw neither a confirmation nor an error. `writeClipboardText` never
// throws; it reports what happened, and `copyWithFeedback` turns that into the
// confirmation or a fixed error message. No message here ever contains the
// copied value, because the edit link and the results link carry a secret.

import { ENGLISH_INTERFACE_TEXT, type InterfaceText } from "./interface-text";

/** The one method of the Clipboard API a copy control uses. */
export type ClipboardWriter = { writeText(text: string): Promise<void> };

/** What a copy came to. */
export type ClipboardOutcome = "copied" | "unavailable" | "refused";

/** The browser's clipboard, or `null` where the page may not write to it. */
export function browserClipboard(): ClipboardWriter | null {
	const clipboard = globalThis.navigator?.clipboard;
	return clipboard && typeof clipboard.writeText === "function"
		? clipboard
		: null;
}

/**
 * Write `value` to `clipboard`: `"unavailable"` when there is no clipboard to
 * write to, `"refused"` when the browser rejected the write (a denied
 * permission, a document without focus), `"copied"` otherwise.
 */
export async function writeClipboardText(
	value: string,
	clipboard: ClipboardWriter | null = browserClipboard(),
): Promise<ClipboardOutcome> {
	if (!clipboard) return "unavailable";
	try {
		await clipboard.writeText(value);
		return "copied";
	} catch {
		return "refused";
	}
}

/** The error a failed copy shows, in the interface language. */
export function clipboardFailureMessage(
	outcome: Exclude<ClipboardOutcome, "copied">,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string {
	return outcome === "unavailable"
		? text.share.copyUnavailable
		: text.share.copyRefused;
}

/** How a surface shows a toast. */
export type CopyNotify = (message: string, tone: "success" | "error") => void;

/**
 * Copy `value` and say so: `copiedMessage` as a success on a write, the
 * failure's message as an error otherwise. Resolves to whether it copied, so a
 * control shows its copied state only after a write that happened.
 */
export async function copyWithFeedback({
	value,
	copiedMessage,
	notify,
	text = ENGLISH_INTERFACE_TEXT,
	clipboard = browserClipboard(),
}: {
	value: string;
	copiedMessage: string;
	notify: CopyNotify;
	text?: InterfaceText;
	clipboard?: ClipboardWriter | null;
}): Promise<boolean> {
	const outcome = await writeClipboardText(value, clipboard);
	if (outcome === "copied") {
		notify(copiedMessage, "success");
		return true;
	}
	notify(clipboardFailureMessage(outcome, text), "error");
	return false;
}
