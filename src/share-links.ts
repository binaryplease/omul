// ── The links a presenter copies, and the on-screen join address ──────────────
//
// Every link the presenter screen puts on the clipboard is built here from the
// page's origin, so each one carries its `http:` or `https:` scheme:
// `joinLinkUrl` (the Copy join link row and the QR code), `embedSnippet` (the
// Copy embed code row) and `editLinkUrl` (the edit-link confirmation). The
// results link has its own builder, `resultsLinkUrl` in `api.ts`, beside the
// token storage it reads.
//
// The screen also *shows* the join address, spelled as the bare host and path so
// it can be read aloud and typed in (REQ179, REQ191). Selecting that text and
// copying it would put a link without a scheme on the clipboard, so every
// element that shows the address takes `onCopy={copyAddressAs(address)}`: a copy
// whose selection lies inside the element and holds the whole host writes the
// absolute URL instead. The copy event's own clipboard data is writable on a page
// served over plain HTTP, where `navigator.clipboard` is missing (REQ212), so
// this path works on a LAN deploy too.

import type { ClipboardEvent } from "react";

/** Where the room joins: the host the screen shows, and the link it stands for. */
export type JoinAddress = {
	/** The bare host, as shown on screen ("omul.example", "192.168.1.20:3000"). */
	host: string;
	/** The absolute join link, scheme included. */
	url: string;
};

/** The absolute join link for a deck's code. */
export function joinLinkUrl(origin: string, code: string): string {
	return `${origin}/join/${encodeURIComponent(code)}`;
}

/** The join address of a deck on the page at `location`. */
export function joinAddressFor(
	location: { host: string; origin: string },
	code: string,
): JoinAddress {
	return { host: location.host, url: joinLinkUrl(location.origin, code) };
}

/** The `<iframe>` snippet the Copy embed code row puts on the clipboard. */
export function embedSnippet(joinUrl: string): string {
	return `<iframe src="${joinUrl}" width="100%" height="600" frameborder="0" allow="clipboard-write" style="border:0;border-radius:12px;"></iframe>`;
}

/**
 * The share link with edit permissions. The token rides in the fragment, so it
 * is never sent to the server in a request line.
 */
export function editLinkUrl(
	origin: string,
	presentationId: string,
	token: string,
): string {
	return `${origin}/edit/${presentationId}#share=${encodeURIComponent(token)}`;
}

/** True when `value` parses as an absolute `http:` or `https:` URL. */
export function isHttpLink(value: string): boolean {
	try {
		const protocol = new URL(value).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * What a copy of selected on-screen text should put on the clipboard: the
 * absolute join link when the selection lies inside the address element and
 * holds the whole host, and `null` (the browser's own copy) otherwise. A
 * selection of the code alone or of part of the host is copied as selected,
 * and so is a selection that runs past the element, such as select-all.
 */
export function addressCopyText(
	selection: { text: string; insideAddress: boolean },
	address: JoinAddress,
): string | null {
	if (!selection.insideAddress || address.host === "") return null;
	return selection.text.includes(address.host) ? address.url : null;
}

/** The parts of a DOM selection `copyAddressAs` reads. */
export type AddressSelection = {
	anchorNode: Node | null;
	focusNode: Node | null;
	toString(): string;
};

/** The parts of a copy event `copyAddressAs` reads and writes. */
export type AddressCopyEvent = {
	currentTarget: { contains(node: Node | null): boolean };
	clipboardData: { setData(format: string, data: string): void } | null;
	preventDefault(): void;
};

function documentSelection(): AddressSelection | null {
	return globalThis.getSelection?.() ?? null;
}

/**
 * The `onCopy` handler for an element that shows the join address. It writes
 * `address.url` in place of the selected text when `addressCopyText` says so,
 * and leaves every other copy to the browser.
 */
export function copyAddressAs(
	address: JoinAddress,
	readSelection: () => AddressSelection | null = documentSelection,
): (event: AddressCopyEvent | ClipboardEvent<HTMLElement>) => void {
	return (event) => {
		const selection = readSelection();
		if (!selection || !event.clipboardData) return;
		const insideAddress =
			event.currentTarget.contains(selection.anchorNode) &&
			event.currentTarget.contains(selection.focusNode);
		const replacement = addressCopyText(
			{ text: selection.toString(), insideAddress },
			address,
		);
		if (replacement === null) return;
		event.clipboardData.setData("text/plain", replacement);
		event.preventDefault();
	};
}
