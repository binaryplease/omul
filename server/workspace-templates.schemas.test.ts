/**
 * Unit tests for the vocabulary of publishing a deck as a workspace template
 * (REQ004), with no DB and no network between them:
 *
 *   - `canPublishWorkspaceTemplates` — the predicate the two write routes are
 *     gated on, stated once so neither re-derives it by comparing role strings,
 *     and narrower than the predicate a *use* is gated on;
 *   - the stored shape — the identity triple carries no default while everything
 *     else does, so an entry written before a field existed re-parses forward;
 *   - the wire shape — a published entry is a catalog entry plus a publisher, so
 *     one gallery draws both and `filterDeckTemplates` narrows both, and no
 *     account identifier can reach a client;
 *   - the publish body — what it insists on (a deck, an occasion) and what it
 *     lets stand (a name inherited from the deck, no description, no tags);
 *   - the create body — a deck starts from *one* template, and a workspace's own
 *     is used inside the workspace that published it.
 *
 * What a role actually *buys*, and whether the deck an entry produces is really
 * independent of it, are claims about the server and are tested there, over
 * HTTP, in `workspace-templates.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	canCreateWorkspaceDecks,
	canPublishWorkspaceTemplates,
	CreatePresentationSchema,
	DECK_TEMPLATE_CATEGORIES,
	DeckTemplateSchema,
	filterDeckTemplates,
	PublishWorkspaceTemplateSchema,
	StoredWorkspaceTemplateSchema,
	WORKSPACE_ROLES,
	WORKSPACE_TEMPLATE_TAG_LIMIT,
	WorkspaceTemplateSchema,
} from "./schemas";

const SLIDE = {
	id: "slide-1",
	type: "multiple-choice",
	question: "Which?",
	options: [{ id: "option-1", text: "This one" }],
};

describe("who may publish (REQ004, REQ129)", () => {
	test("publishing is admin and owner, never an ordinary member", () => {
		expect(canPublishWorkspaceTemplates("member")).toBe(false);
		expect(canPublishWorkspaceTemplates("admin")).toBe(true);
		expect(canPublishWorkspaceTemplates("owner")).toBe(true);
	});

	test("no membership is the withholding answer", () => {
		expect(canPublishWorkspaceTemplates(null)).toBe(false);
	});

	test("it is strictly narrower than being allowed to use one", () => {
		// The asymmetry is the design: every member starts a deck from the gallery,
		// and putting something *into* the gallery is an act on a surface everybody
		// reads. A role that could publish but not create decks would be nonsense,
		// and a run over the whole vocabulary is what keeps that true when REQ131's
		// reduced role arrives at the front of it.
		for (const role of WORKSPACE_ROLES) {
			if (canPublishWorkspaceTemplates(role)) {
				expect(canCreateWorkspaceDecks(role)).toBe(true);
			}
		}
		expect(
			WORKSPACE_ROLES.filter((role) => !canPublishWorkspaceTemplates(role)),
		).toEqual(["member"]);
	});
});

describe("the stored shape", () => {
	test("the identity triple has no default and fails loudly", () => {
		// An entry that lost its workspace belongs to nobody; one that lost the deck
		// it came from could not be recognised as a republish of it.
		const orphan = StoredWorkspaceTemplateSchema.safeParse({ id: "template-1" });
		expect(orphan.success).toBe(false);
		const complete = StoredWorkspaceTemplateSchema.safeParse({
			id: "template-1",
			workspaceId: "workspace-1",
			sourcePresentationId: "deck-1",
		});
		expect(complete.success).toBe(true);
	});

	test("an entry written before a field existed re-parses forward", () => {
		const parsed = StoredWorkspaceTemplateSchema.parse({
			id: "template-1",
			workspaceId: "workspace-1",
			sourcePresentationId: "deck-1",
		});
		expect(parsed.title).toBe("");
		expect(parsed.description).toBe("");
		expect(parsed.tags).toEqual([]);
		expect(parsed.slides).toEqual([]);
		expect(parsed.publishedBy).toBeNull();
		expect(parsed.createdAt).toBe("");
		expect(parsed.updatedAt).toBe("");
		// The occasion defaults rather than failing on a row, unlike the request
		// body below: a stored row is read, and a read that threw would lose the
		// entry rather than ask anybody to file it.
		expect(DECK_TEMPLATE_CATEGORIES).toContain(parsed.category);
	});

	test("a category outside the vocabulary is refused, not coerced", () => {
		const parsed = StoredWorkspaceTemplateSchema.safeParse({
			id: "template-1",
			workspaceId: "workspace-1",
			sourcePresentationId: "deck-1",
			category: "party",
		});
		expect(parsed.success).toBe(false);
	});
});

describe("the wire shape", () => {
	const entry = {
		id: "template-1",
		workspaceId: "workspace-1",
		publishedBy: "user-1",
		title: "Sprint retro",
		description: "How the sprint went.",
		category: "meeting",
		tags: ["retro"],
		slides: [SLIDE],
		sourcePresentationId: "deck-1",
		publishedByName: "Ada",
		createdAt: "2026-09-04T00:00:00.000Z",
		updatedAt: "2026-09-04T00:00:00.000Z",
	};

	test("no account identifier reaches a client, by construction", () => {
		const parsed = WorkspaceTemplateSchema.parse(entry);
		expect(parsed).not.toHaveProperty("publishedBy");
		expect(parsed).not.toHaveProperty("workspaceId");
		expect(parsed.publishedByName).toBe("Ada");
	});

	test("a publisher whose account is gone keeps the key rather than dropping it", () => {
		const parsed = WorkspaceTemplateSchema.parse({
			...entry,
			publishedByName: null,
		});
		expect("publishedByName" in parsed).toBe(true);
		expect(parsed.publishedByName).toBeNull();
	});

	test("a published entry is a catalog entry, so one gallery draws both", () => {
		// The claim the extension is for: whatever a workspace publishes still
		// parses as the shape `GET /api/templates` answers with, which is what lets
		// one card component and one filter serve both surfaces.
		const published = WorkspaceTemplateSchema.parse(entry);
		expect(DeckTemplateSchema.safeParse(published).success).toBe(true);
		expect(
			filterDeckTemplates([published], { search: "retro" }).map(
				(match) => match.id,
			),
		).toEqual(["template-1"]);
		expect(filterDeckTemplates([published], { category: "workshop" })).toEqual(
			[],
		);
	});
});

describe("the publish body", () => {
	test("it needs a deck and an occasion, and fills in the rest", () => {
		const parsed = PublishWorkspaceTemplateSchema.parse({
			presentationId: "deck-1",
			category: "workshop",
		});
		expect(parsed.title).toBe("");
		expect(parsed.description).toBe("");
		expect(parsed.tags).toEqual([]);
	});

	test("a publish with no deck behind it is refused", () => {
		expect(
			PublishWorkspaceTemplateSchema.safeParse({ category: "meeting" }).success,
		).toBe(false);
		expect(
			PublishWorkspaceTemplateSchema.safeParse({
				presentationId: "",
				category: "meeting",
			}).success,
		).toBe(false);
	});

	test("the occasion has no default: none of the five is the withholding one", () => {
		expect(
			PublishWorkspaceTemplateSchema.safeParse({ presentationId: "deck-1" })
				.success,
		).toBe(false);
	});

	test("more tags than an entry may carry is refused rather than truncated", () => {
		const tooMany = Array.from(
			{ length: WORKSPACE_TEMPLATE_TAG_LIMIT + 1 },
			(_unused, index) => `tag-${index}`,
		);
		expect(
			PublishWorkspaceTemplateSchema.safeParse({
				presentationId: "deck-1",
				category: "meeting",
				tags: tooMany,
			}).success,
		).toBe(false);
	});
});

describe("the create body (REQ004, REQ006)", () => {
	test("a workspace template stands in for the title and slides a create needs", () => {
		const parsed = CreatePresentationSchema.safeParse({
			workspaceId: "workspace-1",
			workspaceTemplateId: "template-1",
		});
		expect(parsed.success).toBe(true);
	});

	test("a deck starts from one template, not two", () => {
		const parsed = CreatePresentationSchema.safeParse({
			workspaceId: "workspace-1",
			workspaceTemplateId: "template-1",
			templateId: "team-check-in",
		});
		expect(parsed.success).toBe(false);
	});

	test("a workspace's own template is used inside that workspace", () => {
		// Without a workspace there is nothing to resolve the caller's role against
		// before the entry is looked up, which is the whole of what keeps the lookup
		// from reporting whether an id exists.
		const parsed = CreatePresentationSchema.safeParse({
			workspaceTemplateId: "template-1",
		});
		expect(parsed.success).toBe(false);
	});

	test("a create that names no template at all is unchanged", () => {
		expect(CreatePresentationSchema.safeParse({}).success).toBe(false);
		expect(
			CreatePresentationSchema.safeParse({ title: "Deck", slides: [SLIDE] })
				.success,
		).toBe(true);
		expect(
			CreatePresentationSchema.parse({ title: "Deck", slides: [SLIDE] })
				.workspaceTemplateId,
		).toBe("");
	});
});
