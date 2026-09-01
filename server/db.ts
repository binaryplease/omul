import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	type Collection,
	createStore as createDocStore,
	type DocStore,
} from "@binaryplease/zodstore";
import type { z } from "zod";
import { docstorePath } from "./store-path";

// Persistence path for the zodstore SQLite database. `:memory:` gives an
// ephemeral in-process store (used by tests); any other value is a file path.
// Per ADR-0018 this is a fixed, known location read once at load — no silent
// fallback to a different file if it is unwritable; bun:sqlite fails loudly.
// `server/store-path.ts` owns the one reading of DATABASE_PATH, so the auth and
// admin stores hang their siblings off the same answer (REQ174).
const DATABASE_PATH = docstorePath();

// Ensure the parent directory exists before bun:sqlite opens the file — it will
// create the database file but not the directories leading to it.
if (DATABASE_PATH !== ":memory:") {
	const directory = dirname(DATABASE_PATH);
	if (directory && directory !== "." && !existsSync(directory)) {
		mkdirSync(directory, { recursive: true });
	}
}

// One store over one bun:sqlite database, opened at module load so the
// collection factory below can create tables immediately when services import
// it (services declare their collections at their own module-load time, before
// `connectDb()` is awaited).
//
// `maxRows: null` disables the library's 10 000-row ceiling on a `find()` that
// names no `limit`. The ceiling throws rather than truncating, which is the
// right shape, but every read here is already narrowed by a presentation id and
// a single large event legitimately crosses it — 1 000 participants over ten
// slides is 10 000 rows of `votes` for one deck, and `votes.find({
// presentationId })` is what the results view and the export are built on.
// Capping it would turn that event into a 500. The pragmas are left at the
// library's own defaults (WAL, `synchronous=NORMAL`, `busy_timeout=5000`).
const docStore: DocStore = createDocStore({
	path: DATABASE_PATH,
	maxRows: null,
});

/**
 * Confirm the store is ready. zodstore is synchronous and in-process, so there
 * is nothing to connect to — this exists to preserve the call site in
 * `server/index.ts` and to surface a single startup log line.
 */
export async function connectDb(): Promise<void> {
	console.log(`[db] using zodstore at ${DATABASE_PATH}`);
}

/** Close the underlying SQLite connection. */
export async function closeDb(): Promise<void> {
	docStore.close();
}

/**
 * A generic document store backed by one zodstore collection.
 *
 * Design:
 *   - Each store maps to one Zod-gated collection (one SQLite table).
 *   - Documents use a string `id` field as primary key.
 *   - The interface is async so the calling service/route layer is unchanged,
 *     even though zodstore itself is synchronous. `filter` objects are plain
 *     equality maps and translate directly into the store's typed where-clause
 *     (a bare value is shorthand for `eq`).
 */
export interface Store {
	insert(doc: Record<string, unknown>): Promise<Record<string, unknown>>;
	update(
		id: string,
		changes: Record<string, unknown>,
	): Promise<Record<string, unknown> | null>;
	remove(id: string): Promise<boolean>;
	findOne(id: string): Promise<Record<string, unknown> | null>;
	find(filter?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
	deleteMany(filter: Record<string, unknown>): Promise<number>;
}

/**
 * Every collection name this process has opened, in the order `createStore` was
 * called with it.
 *
 * Recorded because {@link createStore} declines the library's own per-collection
 * ADR-0029 walk (see below) and `server/stored-defaults.test.ts` re-implements it
 * over a hand-written list. A hand-written list is only a guard while it is
 * complete, and nothing about adding a twelfth `createStore` call makes anyone
 * add a twelfth entry — so the test reads this back and fails on a collection
 * that is open but unlisted, rather than exempting it in silence.
 */
const openedCollections = new Set<string>();

/** The collection names {@link createStore} has opened in this process. */
export function openedCollectionNames(): string[] {
	return [...openedCollections];
}

/**
 * Open a store over a named collection, gated by `schema` (ADR-0013). The schema
 * is validated on every read and write; passing it at the call site keeps the
 * stored shape visible where the collection is used. `indexes` declares the
 * `json_extract` expression indexes over the fields the collection filters on.
 *
 * `enforceDefaults: false` opts out of the library's walk that refuses a
 * non-identity field with no `.default(...)`. The rule itself is ADR-0029 and
 * still holds — what does not hold here is the library's way of recognising an
 * identity field, which is the schema object `ref()` hands out. This catalog's
 * foreign keys are plain `z.string()` over `crypto.randomUUID()` values with no
 * `prefix_` on them, so `ref()` cannot express them and the walk reads all
 * eighteen of them — `presentationId`, `slideId`, `workspaceId`, `userId`,
 * `authorId`, `participantId`, `questionId`, `responseId`, spread over nine of
 * the eleven collections — as ordinary fields that forgot a default. ADR-0029's
 * own exemption for identity fields covers exactly those, and
 * `server/stored-defaults.test.ts` enforces the rule over every collection with
 * that exemption spelled out — over every collection this function has actually
 * opened, which is what {@link openedCollections} is for.
 */
export function createStore<TSchema extends z.ZodType>(
	name: string,
	schema: TSchema,
	options: {
		indexes?: (string | { fields: string[]; unique?: boolean })[];
	} = {},
): Store {
	openedCollections.add(name);

	const collection: Collection<
		z.input<TSchema>,
		z.output<TSchema>
	> = docStore.collection(name, schema, {
		indexes: options.indexes,
		enforceDefaults: false,
	});

	async function insert(
		doc: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const id = crypto.randomUUID();
		return collection.insert({ id, ...doc } as z.input<TSchema>) as Record<
			string,
			unknown
		>;
	}

	async function update(
		id: string,
		changes: Record<string, unknown>,
	): Promise<Record<string, unknown> | null> {
		return collection.update(
			id,
			changes as Partial<z.input<TSchema>>,
		) as Record<string, unknown> | null;
	}

	async function remove(id: string): Promise<boolean> {
		return collection.delete(id);
	}

	async function findOne(id: string): Promise<Record<string, unknown> | null> {
		return collection.get(id) as Record<string, unknown> | null;
	}

	async function find(
		filter?: Record<string, unknown>,
	): Promise<Record<string, unknown>[]> {
		return collection.find(
			filter ? { where: filter as never } : undefined,
		) as Record<string, unknown>[];
	}

	async function deleteMany(filter: Record<string, unknown>): Promise<number> {
		return collection.deleteMany(filter as never);
	}

	return { insert, update, remove, findOne, find, deleteMany };
}
