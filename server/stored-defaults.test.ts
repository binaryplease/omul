/**
 * ADR-0029 over every collection that reaches storage, in one place.
 *
 * The storage library carries this walk itself — `store.collection(...)` refuses
 * a non-identity field with no `.default(...)` — and `server/db.ts` opts out of
 * it with `{ enforceDefaults: false }`. The reason is narrow and is the whole
 * reason this file exists: the library recognises an identity field by the
 * schema object its `ref()` helper hands out, and `ref("presentation")` is a
 * `z.string().startsWith("presentation_")`. This catalog's foreign keys are
 * plain `z.string()` over `crypto.randomUUID()` values that carry no prefix, so
 * `ref()` cannot express one and the library's walk reads every one of them as
 * an ordinary field that forgot a default.
 *
 * ADR-0029 exempts exactly those, so the rule is enforced here with the
 * exemption written down rather than inferred. Each collection names its
 * identity fields explicitly, which is what makes this a guard: a new field on
 * a stored schema either declares a default or has to be added to a list a
 * reader can see, and neither happens by accident.
 *
 * "Has a default" is asked the way the library asks it — parse `undefined` and
 * see whether a value comes back — rather than by reading Zod internals, so
 * `.catch()` and a default carried through a `.transform()` count and
 * `.optional()` does not.
 *
 * The list below is written by hand, and a hand-written list is only a guard
 * while it is complete: a twelfth collection added under `server/services/`
 * would otherwise be exempt from ADR-0029 in the library *and* here, at once and
 * silently. So the last case loads the service modules for their `createStore`
 * side effects and compares what they opened against what is listed.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";

import { beforeAll, describe, expect, test } from "bun:test";
import type { z } from "zod";
import {
	StoredChatMessageSchema,
	StoredDeckCollaboratorSchema,
	StoredParticipantNameSchema,
	StoredPresentationSchema,
	StoredQAQuestionSchema,
	StoredQAUpvoteSchema,
	StoredResponseVoteSchema,
	StoredSlideCommentSchema,
	StoredVoteSchema,
	StoredWorkspaceMemberSchema,
	StoredWorkspaceSchema,
} from "./schemas";

/** One collection, as `server/db.ts` opens it, plus what it may leave bare. */
interface StoredCollection {
	/** The collection name passed to `createStore`, so a failure names a table. */
	name: string;
	schema: z.ZodType;
	/**
	 * The fields ADR-0029 exempts: the primary key, and the foreign keys that
	 * identify the row's owner. They are required inputs — a vote with no
	 * `presentationId` belongs to nothing — so they fail loudly (ADR-0018)
	 * instead of defaulting into a row that points nowhere.
	 */
	identityFields: string[];
}

/**
 * Every `createStore` call in `server/services/`. Kept in this order so it reads
 * against the three modules that make them: workspaces, slide comments and
 * collaborators, participant names, then the six of `presentations.ts`.
 */
const STORED_COLLECTIONS: StoredCollection[] = [
	{
		name: "workspaces",
		schema: StoredWorkspaceSchema,
		identityFields: ["id"],
	},
	{
		name: "workspaceMembers",
		schema: StoredWorkspaceMemberSchema,
		identityFields: ["id", "workspaceId", "userId"],
	},
	{
		name: "slideComments",
		schema: StoredSlideCommentSchema,
		identityFields: ["id", "presentationId", "slideId", "authorId"],
	},
	{
		name: "deckCollaborators",
		schema: StoredDeckCollaboratorSchema,
		identityFields: ["id", "presentationId", "userId"],
	},
	{
		name: "participantNames",
		schema: StoredParticipantNameSchema,
		identityFields: ["id", "presentationId", "participantId"],
	},
	{
		name: "presentations",
		schema: StoredPresentationSchema,
		identityFields: ["id"],
	},
	{
		name: "votes",
		schema: StoredVoteSchema,
		identityFields: ["id", "presentationId", "slideId"],
	},
	{
		name: "responseVotes",
		schema: StoredResponseVoteSchema,
		identityFields: ["id", "presentationId", "slideId", "responseId"],
	},
	{
		name: "qaQuestions",
		schema: StoredQAQuestionSchema,
		identityFields: ["id", "presentationId"],
	},
	{
		name: "qaUpvotes",
		schema: StoredQAUpvoteSchema,
		identityFields: ["id", "presentationId", "questionId"],
	},
	{
		name: "chatMessages",
		schema: StoredChatMessageSchema,
		identityFields: ["id", "presentationId"],
	},
];

/** Whether a field supplies a value of its own when the key is absent. */
function hasDeclaredDefault(fieldSchema: z.ZodType): boolean {
	const probe = fieldSchema.safeParse(undefined);
	return probe.success && probe.data !== undefined;
}

/** The object shape of a stored schema, or `null` if it has none to walk. */
function readShape(schema: z.ZodType): Record<string, z.ZodType> | null {
	const shape = (schema as { shape?: Record<string, z.ZodType> }).shape;
	return typeof shape === "object" && shape !== null ? shape : null;
}

/**
 * The collection names `server/db.ts` was asked to open, filled in by
 * {@link beforeAll} once the service modules have been loaded.
 */
let openedCollectionNames: string[] = [];

describe("every stored field either defaults or is identity (ADR-0029)", () => {
	beforeAll(async () => {
		// Imported for their module-load `createStore` calls, not for their exports:
		// these five modules are every caller of it outside a test. `presentations`
		// pulls in the other four itself; naming them all keeps the coupling legible
		// and makes a module that stops being reachable show up here.
		await import("./services/workspaces");
		await import("./services/slide-comments");
		await import("./services/collaborators");
		await import("./services/participant-names");
		await import("./services/presentations");

		const { openedCollectionNames: opened } = await import("./db");
		openedCollectionNames = opened();
	});

	test("every collection this server opens is listed here", () => {
		// The guard on the list itself. A twelfth `createStore` call that nobody
		// adds a row for is a collection ADR-0029 stops being enforced over —
		// silently, because the library's own walk is off. Concretely: that
		// collection gains a non-identity field with no `.default(...)`, and rows
		// written before it stop parsing on read.
		const unlisted = openedCollectionNames.filter(
			(name) => !STORED_COLLECTIONS.some((entry) => entry.name === name),
		);
		expect(unlisted).toEqual([]);
	});

	for (const collection of STORED_COLLECTIONS) {
		test(`${collection.name} declares a default on every other field`, () => {
			const shape = readShape(collection.schema);
			expect(shape).not.toBeNull();

			const bare = Object.entries(shape ?? {})
				.filter(([field]) => !collection.identityFields.includes(field))
				.filter(([, fieldSchema]) => !hasDeclaredDefault(fieldSchema))
				.map(([field]) => field);

			expect(bare).toEqual([]);
		});

		test(`${collection.name}'s identity fields are all real fields`, () => {
			// An exemption for a field that no longer exists is an exemption that
			// silently covers whatever is added under that name next.
			const shape = readShape(collection.schema) ?? {};
			const unknown = collection.identityFields.filter(
				(field) => !(field in shape),
			);
			expect(unknown).toEqual([]);
		});

		test(`${collection.name} is a collection this server actually opens`, () => {
			// The other direction of the completeness check below: a listed
			// collection nothing opens is a stale entry, and a stale entry is an
			// exemption list that has drifted from the code it claims to cover.
			expect(openedCollectionNames).toContain(collection.name);
		});

		test(`${collection.name}'s identity fields carry no default`, () => {
			// The other direction of the exemption: a field listed here must be
			// one that fails loudly (ADR-0018), not one that quietly defaults.
			const shape = readShape(collection.schema) ?? {};
			const defaulted = collection.identityFields.filter((field) => {
				const fieldSchema = shape[field];
				return fieldSchema !== undefined && hasDeclaredDefault(fieldSchema);
			});
			expect(defaulted).toEqual([]);
		});
	}
});
