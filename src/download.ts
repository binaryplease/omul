// ── Getting a file out of the browser ─────────────────────────
//
// Two surfaces now hand the user a file: the deck list saves a presentation as
// JSON, and the presenter's screen downloads a session's results as a
// spreadsheet (REQ095). The anchor-click dance that actually puts bytes in a
// download folder is the same both times, so it lives here once (ADR-0026) —
// two copies is how one of them eventually forgets to revoke its object URL.
//
// Nothing here decides *what* is downloaded or *what it is called*: a caller
// brings a blob and a name. For a server-generated file the name comes from the
// server's own `Content-Disposition`, so the file on disk is the file the
// endpoint said it was rather than a second guess at the same slug. For a file
// this browser builds itself, the name is slugged with `deckFilenameSlug` —
// which lives in `server/schemas.ts` beside every other rule both sides of the
// wire have to agree on (ADR-0026), so this module holds no copy of it.

/**
 * Save a blob to the user's download folder under `filename`.
 *
 * The object URL is revoked immediately after the click: the browser has
 * already taken its own reference to the blob by then, and leaving the URL
 * alive pins the whole file in memory for the lifetime of the document.
 */
export function saveBlobAs(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

/**
 * Read the filename out of a `Content-Disposition` header, or `null` when the
 * header is absent or names none — in which case the caller supplies its own
 * fallback rather than being handed an empty string that would save as a file
 * with no name at all.
 *
 * Handles the quoted `filename="…"` form the export endpoint sends. The
 * `filename*=` extended form is deliberately not parsed: nothing this app
 * serves uses it, and a half-implemented percent-decoder is worse than a
 * fallback the caller controls.
 */
export function filenameFromContentDisposition(
	header: string | null,
): string | null {
	if (!header) return null;
	const quoted = header.match(/filename="([^"]+)"/);
	if (quoted) return quoted[1];
	const bare = header.match(/filename=([^;]+)/);
	return bare ? bare[1].trim() : null;
}
