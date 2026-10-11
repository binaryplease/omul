/**
 * What this client prints when it is talking to a person rather than to a
 * program.
 *
 * Two rules run through all of it. **Nothing absent is silently dropped**: a
 * field the server reported as `null` prints as {@link EMPTY_MARKER} rather
 * than vanishing, so a caller can tell "no access level" from "this client
 * forgot to show it" — the human half of the same completeness the `--json`
 * output gets for free by printing the payload as it arrived. And **no secret
 * is ever rendered**: an edit token that came back on a create goes to the
 * token store and is reported here as the fact that it was stored, never as
 * its value.
 */

/** What an absent or null value looks like in human output. */
export const EMPTY_MARKER = "(none)";

/** A value as a person reads it — the marker for anything absent or blank. */
export function display(value: unknown): string {
	if (value === null || value === undefined) return EMPTY_MARKER;
	if (typeof value === "string") return value.trim() === "" ? EMPTY_MARKER : value;
	if (typeof value === "boolean") return value ? "yes" : "no";
	if (typeof value === "number") return String(value);
	return JSON.stringify(value);
}

/** `1 vote` / `3 votes` — a count reads as a sentence or it reads as a bug. */
export function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A `label   value` line, with the labels of one block lined up. */
export function labelled(rows: [string, unknown][]): string[] {
	const width = Math.max(...rows.map(([label]) => label.length));
	return rows.map(([label, value]) => `${label.padEnd(width)}  ${display(value)}`);
}

/**
 * A table whose columns are as wide as their widest cell. Written here rather
 * than reached for per command so a list of decks and a list of templates line
 * up the same way.
 */
export function table(rows: string[][]): string[] {
	if (rows.length === 0) return [];
	const columnCount = Math.max(...rows.map((row) => row.length));
	const widths: number[] = [];
	for (let column = 0; column < columnCount; column++) {
		widths.push(
			Math.max(...rows.map((row) => (row[column] ?? "").length)),
		);
	}
	return rows.map((row) =>
		row
			.map((cell, column) =>
				column === columnCount - 1 ? cell : cell.padEnd(widths[column] as number),
			)
			.join("  ")
			.trimEnd(),
	);
}
