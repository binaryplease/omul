/**
 * The declared-defaults rule over every collection that reaches storage, in one
 * place: every non-identity stored field carries a `.default(...)`, so the shape
 * can grow by appending a field and rows written under an older shape re-parse
 * forward.
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
 * The rule exempts exactly those, so it is enforced here with the
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
 * **The walk recurses, as the library's has since 0.5.0** (its F048). A
 * parent's `.default(...)` does not cover its members: a row that already
 * stores a slide is parsed against every field of `SlideSchema`, so a member
 * added there without a default makes every deck written before it unreadable —
 * on the first read of an old row, in a deployment, rather than here. The walk
 * therefore descends into every declared field and into what a container
 * stores without a declared name (an array's elements, a tuple's positions, a
 * record's values, a `.catchall()`), names fields by the library's own path
 * notation (`slides[].options[].id`), stops at ten levels, and refuses a union
 * or intersection with an object in it rather than skipping it. Run against the
 * library's own walk on 2026-10-02, it reports the same paths.
 *
 * The list below is written by hand, and a hand-written list is only a guard
 * while it is complete: a thirteenth collection added under `server/services/`
 * would otherwise be exempt from the rule in the library *and* here, at once and
 * silently. So the last case loads the service modules for their `createStore`
 * side effects and compares what they opened against what is listed.
 */

// IMPORTANT: set DATABASE_PATH before any import of ./db — db.ts opens the store
// at load time. ":memory:" gives this suite its own throw-away in-process store.
process.env.DATABASE_PATH = ":memory:";

import { beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
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
	StoredWorkspaceTemplateSchema,
} from "./schemas";

/** One collection, as `server/db.ts` opens it, plus what it may leave bare. */
interface StoredCollection {
	/** The collection name passed to `createStore`, so a failure names a table. */
	name: string;
	schema: z.ZodType;
	/**
	 * The fields the rule exempts: the primary key, and the foreign keys that
	 * identify the row's owner. They are required inputs — a vote with no
	 * `presentationId` belongs to nothing — so they fail loudly
	 * instead of defaulting into a row that points nowhere.
	 */
	identityFields: string[];
	/**
	 * The fields below the top level that are left bare on purpose, as full
	 * paths. Empty for every collection that stores no nested shape with a bare
	 * member; see {@link STORED_SLIDE_BARE_FIELDS} for the two that do.
	 */
	nestedBareFields: string[];
}

/**
 * The identities a slide carries: its own, and one per authored row. A vote
 * names the slide and the option, statement or item it answers by these, so a
 * defaulted one would be an answer pointing at a row nobody authored.
 */
const SLIDE_IDENTITY_FIELDS = [
	"id",
	"options[].id",
	"scaleStatements[].id",
	"rankingItems[].id",
	"gridItems[].id",
	"pointsItems[].id",
	"formFields[].id",
	"formFields[].options[].id",
	"quizAnswers[].id",
];

/**
 * What a slide, or one of its rows, *is*: written by whoever creates it and
 * present in every row since the field existed. These are creation-time input,
 * not extensions — a slide with no `type` is no slide, a row with no `text` is
 * an empty row the editor seeded on purpose, and a guess reference or pin area
 * with no number in it is not a reference or an area. The enclosing value is
 * the thing that is optional (`guessReference` and `pinArea` default to `null`,
 * the lists to `[]`), and it defaults whole.
 */
const SLIDE_REQUIRED_INPUT_FIELDS = [
	"type",
	"question",
	"options[].text",
	"scaleStatements[].text",
	"scaleLabels[].value",
	"scaleLabels[].label",
	"rankingItems[].text",
	"gridItems[].text",
	"pointsItems[].text",
	"guessReference.value",
	"pinArea.x",
	"pinArea.y",
	"pinArea.width",
	"pinArea.height",
	"formFields[].label",
	"formFields[].options[].text",
	"quizAnswers[].text",
];

/**
 * The two slide fields that break the rule today and are tracked rather than
 * exempted on their merits (REQ184): each is a bare `.optional()` whose
 * `undefined` carries meaning — "never marked" for `isCorrect`, "fall back to
 * `allowMultiple`" for `maxResponses` — that no default declares. Listed so the
 * walk can stay on for everything else; REQ184 closes when this list is empty.
 */
const SLIDE_OPEN_DEFAULT_GAPS = ["options[].isCorrect", "maxResponses"];

/**
 * A slide's bare fields as stored: `SlideSchema` sits under `slides[]` in both
 * `presentations` and `workspaceTemplates`, so both carry the same list.
 */
const STORED_SLIDE_BARE_FIELDS = [
	...SLIDE_IDENTITY_FIELDS,
	...SLIDE_REQUIRED_INPUT_FIELDS,
	...SLIDE_OPEN_DEFAULT_GAPS,
].map((path) => `slides[].${path}`);

/**
 * Every `createStore` call in `server/services/`. Kept in this order so it reads
 * against the modules that make them: workspaces, the templates they publish,
 * slide comments and collaborators, participant names, then the six of
 * `presentations.ts`.
 */
const STORED_COLLECTIONS: StoredCollection[] = [
	{
		name: "workspaces",
		schema: StoredWorkspaceSchema,
		identityFields: ["id"],
		nestedBareFields: [],
	},
	{
		name: "workspaceMembers",
		schema: StoredWorkspaceMemberSchema,
		identityFields: ["id", "workspaceId", "userId"],
		nestedBareFields: [],
	},
	{
		name: "workspaceTemplates",
		schema: StoredWorkspaceTemplateSchema,
		identityFields: ["id", "workspaceId", "sourcePresentationId"],
		nestedBareFields: STORED_SLIDE_BARE_FIELDS,
	},
	{
		name: "slideComments",
		schema: StoredSlideCommentSchema,
		identityFields: ["id", "presentationId", "slideId", "authorId"],
		nestedBareFields: [],
	},
	{
		name: "deckCollaborators",
		schema: StoredDeckCollaboratorSchema,
		identityFields: ["id", "presentationId", "userId"],
		nestedBareFields: [],
	},
	{
		name: "participantNames",
		schema: StoredParticipantNameSchema,
		identityFields: ["id", "presentationId", "participantId"],
		nestedBareFields: [],
	},
	{
		name: "presentations",
		schema: StoredPresentationSchema,
		identityFields: ["id"],
		nestedBareFields: STORED_SLIDE_BARE_FIELDS,
	},
	{
		name: "votes",
		schema: StoredVoteSchema,
		identityFields: ["id", "presentationId", "slideId"],
		nestedBareFields: [],
	},
	{
		name: "responseVotes",
		schema: StoredResponseVoteSchema,
		identityFields: ["id", "presentationId", "slideId", "responseId"],
		nestedBareFields: [],
	},
	{
		name: "qaQuestions",
		schema: StoredQAQuestionSchema,
		identityFields: ["id", "presentationId"],
		nestedBareFields: [],
	},
	{
		name: "qaUpvotes",
		schema: StoredQAUpvoteSchema,
		identityFields: ["id", "presentationId", "questionId"],
		nestedBareFields: [],
	},
	{
		name: "chatMessages",
		schema: StoredChatMessageSchema,
		identityFields: ["id", "presentationId"],
		nestedBareFields: [],
	},
];

/** Whether a field supplies a value of its own when the key is absent. */
function hasDeclaredDefault(fieldSchema: z.ZodType): boolean {
	const probe = fieldSchema.safeParse(undefined);
	return probe.success && probe.data !== undefined;
}

/** How deep the walk goes before it refuses, as the library's does. */
const MAX_NESTING_DEPTH = 10;

/** One declared field the walk reached, by its full path. */
interface DeclaredField {
	path: string;
	hasDefault: boolean;
}

/** Everything the walk read off one collection's schema. */
interface SchemaReading {
	fields: DeclaredField[];
	/** Paths whose fields cannot be read as one shape, so went unchecked. */
	unreadable: string[];
}

/**
 * Follow the wrappers that keep one stored shape underneath — `.optional()`,
 * `.nullable()`, `.default()`, `.catch()`, `.readonly()`, `.brand()`,
 * `.transform()`/`.refine()`/`z.preprocess()`, `.pipe()` and `z.lazy()` — to
 * the schema a stored value is actually read against.
 */
function unwrapStored(schema: z.ZodType): z.ZodType {
	if (
		schema instanceof z.ZodOptional ||
		schema instanceof z.ZodNullable ||
		schema instanceof z.ZodReadonly ||
		schema instanceof z.ZodBranded
	) {
		return unwrapStored(schema.unwrap());
	}
	if (schema instanceof z.ZodDefault) return unwrapStored(schema.removeDefault());
	if (schema instanceof z.ZodCatch) return unwrapStored(schema.removeCatch());
	if (schema instanceof z.ZodEffects) return unwrapStored(schema.innerType());
	if (schema instanceof z.ZodPipeline) return unwrapStored(schema._def.in);
	if (schema instanceof z.ZodLazy) return unwrapStored(schema.schema);
	return schema;
}

/** Whether a union or intersection has an object anywhere among its members. */
function compositeDeclaresFields(schema: z.ZodType): boolean {
	const members =
		schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion
			? [...schema.options]
			: schema instanceof z.ZodIntersection
				? [schema._def.left, schema._def.right]
				: [];
	return members.some((member: z.ZodType) => {
		const stored = unwrapStored(member);
		return stored instanceof z.ZodObject || compositeDeclaresFields(stored);
	});
}

/**
 * Record every field `schema` declares at `path`, then descend into each of
 * them and into whatever a container stores without a declared name.
 */
function walkStoredSchema(
	schema: z.ZodType,
	path: string,
	depth: number,
	reading: SchemaReading,
): void {
	if (depth > MAX_NESTING_DEPTH) {
		reading.unreadable.push(`${path} (deeper than ${MAX_NESTING_DEPTH} levels)`);
		return;
	}

	const stored = unwrapStored(schema);
	if (stored instanceof z.ZodObject) {
		const shape = stored.shape as Record<string, z.ZodType>;
		for (const [fieldName, fieldSchema] of Object.entries(shape)) {
			const fieldPath = path === "" ? fieldName : `${path}.${fieldName}`;
			reading.fields.push({
				path: fieldPath,
				hasDefault: hasDeclaredDefault(fieldSchema),
			});
			walkStoredSchema(fieldSchema, fieldPath, depth + 1, reading);
		}
		const catchall = stored._def.catchall as z.ZodType;
		if (!(catchall instanceof z.ZodNever)) {
			walkStoredSchema(catchall, `${path}.<key>`, depth + 1, reading);
		}
	} else if (stored instanceof z.ZodArray) {
		walkStoredSchema(stored.element, `${path}[]`, depth + 1, reading);
	} else if (stored instanceof z.ZodRecord) {
		walkStoredSchema(stored.valueSchema, `${path}.<key>`, depth + 1, reading);
	} else if (stored instanceof z.ZodTuple) {
		stored.items.forEach((item: z.ZodType, position: number) => {
			walkStoredSchema(item, `${path}[${position}]`, depth + 1, reading);
		});
		const rest = stored._def.rest as z.ZodType | null;
		if (rest !== null) walkStoredSchema(rest, `${path}[]`, depth + 1, reading);
	} else if (compositeDeclaresFields(stored)) {
		reading.unreadable.push(path === "" ? "(the collection's schema)" : path);
	}
}

/** Walk one collection's schema from the top. */
function readStoredSchema(schema: z.ZodType): SchemaReading {
	const reading: SchemaReading = { fields: [], unreadable: [] };
	walkStoredSchema(schema, "", 0, reading);
	return reading;
}

/**
 * The collection names `server/db.ts` was asked to open, filled in by
 * {@link beforeAll} once the service modules have been loaded.
 */
let openedCollectionNames: string[] = [];

describe("every stored field either defaults or is identity", () => {
	beforeAll(async () => {
		// Imported for their module-load `createStore` calls, not for their exports:
		// these six modules are every caller of it outside a test. `presentations`
		// pulls in the others itself, and `workspaces` pulls in the templates a
		// workspace publishes; naming them all keeps the coupling legible and makes a
		// module that stops being reachable show up here.
		await import("./services/workspaces");
		await import("./services/workspace-templates");
		await import("./services/slide-comments");
		await import("./services/collaborators");
		await import("./services/participant-names");
		await import("./services/presentations");

		const { openedCollectionNames: opened } = await import("./db");
		openedCollectionNames = opened();
	});

	test("every collection this server opens is listed here", () => {
		// The guard on the list itself. A thirteenth `createStore` call that nobody
		// adds a row for is a collection the rule stops being enforced over —
		// silently, because the library's own walk is off. Concretely: that
		// collection gains a non-identity field with no `.default(...)`, and rows
		// written before it stop parsing on read.
		const unlisted = openedCollectionNames.filter(
			(name) => !STORED_COLLECTIONS.some((entry) => entry.name === name),
		);
		expect(unlisted).toEqual([]);
	});

	for (const collection of STORED_COLLECTIONS) {
		const exempt = [
			...collection.identityFields,
			...collection.nestedBareFields,
		];

		test(`${collection.name} declares a default on every other field, at every depth`, () => {
			const reading = readStoredSchema(collection.schema);
			expect(reading.fields.length).toBeGreaterThan(0);

			const bare = reading.fields
				.filter((field) => !field.hasDefault)
				.map((field) => field.path)
				.filter((path) => !exempt.includes(path));

			expect(bare).toEqual([]);
		});

		test(`${collection.name}'s schema reads as one shape all the way down`, () => {
			// A union or intersection with an object in it declares fields the walk
			// cannot read, so nothing below it would be checked. The library refuses
			// one for the same reason rather than skipping it.
			expect(readStoredSchema(collection.schema).unreadable).toEqual([]);
		});

		test(`${collection.name}'s exempt fields are all real fields`, () => {
			// An exemption for a field that no longer exists is an exemption that
			// silently covers whatever is added under that name next.
			const paths = readStoredSchema(collection.schema).fields.map(
				(field) => field.path,
			);
			const unknown = exempt.filter((path) => !paths.includes(path));
			expect(unknown).toEqual([]);
		});

		test(`${collection.name} is a collection this server actually opens`, () => {
			// The other direction of the completeness check below: a listed
			// collection nothing opens is a stale entry, and a stale entry is an
			// exemption list that has drifted from the code it claims to cover.
			expect(openedCollectionNames).toContain(collection.name);
		});

		test(`${collection.name}'s exempt fields carry no default`, () => {
			// The other direction of the exemption: a field listed here must be
			// one that fails loudly, not one that quietly defaults — and an open
			// gap that has since gained a default is closed, so its entry goes.
			const defaulted = readStoredSchema(collection.schema)
				.fields.filter((field) => field.hasDefault)
				.map((field) => field.path)
				.filter((path) => exempt.includes(path));
			expect(defaulted).toEqual([]);
		});
	}
});
