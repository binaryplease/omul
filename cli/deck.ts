/**
 * The deck document `omul create` sends, and the one liberty this client takes
 * with it.
 *
 * A deck is read from a JSON file (or standard input) and posted to
 * `POST /api/presentations` as it stands, because the server owns what a valid
 * deck is and a second opinion here would only be a stale one. The single
 * exception is **identity**: `SlideSchema` requires an `id` on every slide and
 * on every item a slide offers — options, ranking items, grid items, points
 * items, scale statements, form fields — and those ids are opaque strings
 * nobody reads. Requiring a person (or an agent) to invent a dozen unique
 * strings by hand before a deck can be created buys nothing, so an entry that
 * carries none is given one here.
 *
 * Nothing else is filled in, corrected or defaulted. A deck that is missing a
 * question, names a slide type that does not exist or exceeds a limit comes
 * back as the server's own refusal, which is the message that will still be
 * true after this client is out of date.
 */

import { CliError } from "./errors";

/**
 * The slide-level lists whose entries carry an `id` in the server's schema.
 * `scaleLabels` is deliberately absent — its entries are `{ value, label }`,
 * with no identity to fill.
 */
const ID_BEARING_LISTS = [
	"options",
	"scaleStatements",
	"rankingItems",
	"gridItems",
	"pointsItems",
	"formFields",
] as const;

/** Read a deck document from a path, or from standard input for `-`. */
export async function readDeckDocument(
	path: string,
): Promise<Record<string, unknown>> {
	const raw =
		path === "-" ? await Bun.stdin.text() : await readFileText(path);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const where = path === "-" ? "standard input" : path;
		throw new CliError(`${where} is not valid JSON: ${(error as Error).message}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		const where = path === "-" ? "standard input" : path;
		throw new CliError(
			`${where} must hold a JSON object — the body of a create, e.g. {"title": "…", "slides": [ … ]}.`,
		);
	}
	return parsed as Record<string, unknown>;
}

async function readFileText(path: string): Promise<string> {
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new CliError(`No such file: ${path}`);
	}
	return file.text();
}

/**
 * A copy of the deck with an id on every slide and every item that lacks one.
 * Anything that is not shaped like a slide is passed through untouched — the
 * server is what refuses it, and it says why.
 */
export function withGeneratedIds(
	deck: Record<string, unknown>,
): Record<string, unknown> {
	const slides = deck.slides;
	if (!Array.isArray(slides)) return deck;
	return { ...deck, slides: slides.map(withSlideIds) };
}

function withSlideIds(slide: unknown): unknown {
	const record = asPlainObject(slide);
	if (!record) return slide;
	const filled = withId(record);
	for (const listName of ID_BEARING_LISTS) {
		const list = filled[listName];
		if (!Array.isArray(list)) continue;
		filled[listName] = list.map((entry) => {
			const item = asPlainObject(entry);
			return item ? withId(item) : entry;
		});
	}
	return filled;
}

/** A shallow copy carrying an id — the one it already had, or a fresh one. */
function withId(record: Record<string, unknown>): Record<string, unknown> {
	const existing = record.id;
	if (typeof existing === "string" && existing.trim() !== "") {
		return { ...record };
	}
	return { ...record, id: crypto.randomUUID() };
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return { ...(value as Record<string, unknown>) };
}
