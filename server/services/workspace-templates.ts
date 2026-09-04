/**
 * The templates a workspace publishes for itself (REQ004) — decks of its own,
 * frozen into starting points every member can build from.
 *
 * A module of its own rather than a section of `services/workspaces.ts`, on the
 * terms that file states for itself: it owns one collection, its vocabulary and
 * its failure set, and it would keep working unchanged if the workspace service
 * were rewritten around it — everything it needs of a workspace is the id, which
 * arrives as a string. `services/workspaces.ts` is the one module that imports
 * this one, for the single write it owes: a deleted workspace takes its published
 * templates with it, the way it already takes its memberships.
 *
 * Factory-free, like all three of its neighbours: functions over one
 * module-level collection, not a service instance somebody constructs.
 *
 * **Nothing here reads or writes a presentation.** A publish is handed the
 * slides it should store, already copied, and hands them back the same way; who
 * may publish, which deck is being published and whether that deck is even in
 * this workspace are all the route's questions, decided against the caller's
 * role before anything gets here (REQ129). What this module guarantees is the
 * one thing the requirement turns on: what goes in is a **copy**, and what comes
 * out is a copy of that — so no deck this catalog produces shares an identity
 * with the entry it came from, and no entry shares one with the deck it was
 * taken from.
 */

import { createStore } from "../db";
import {
	type DeckTemplateCategory,
	type Slide,
	StoredWorkspaceTemplateSchema,
	withFreshSlideIds,
} from "../schemas";

// Indexed on the workspace, because "what does this workspace publish?" is the
// only listing there is — no route and no screen asks for a published template
// without knowing whose it is.
//
// The (workspace, source deck) pair is **unique**, and that is a correctness
// constraint rather than a tuning one, exactly as the membership pair next door
// is: "one entry per deck this workspace has published" is this module's whole
// invariant, and a check-then-insert cannot hold it under a race. The loser of
// that race loses at the storage layer instead, where it is turned into the
// republish it was always going to be (see {@link publishWorkspaceTemplate}).
const templates = createStore(
	"workspaceTemplates",
	StoredWorkspaceTemplateSchema,
	{
		indexes: [
			"workspaceId",
			{ fields: ["workspaceId", "sourcePresentationId"], unique: true },
		],
	},
);

/** One published template, as every function here hands it back. */
export type WorkspaceTemplateRecord = {
	id: string;
	workspaceId: string;
	sourcePresentationId: string;
	title: string;
	description: string;
	category: DeckTemplateCategory;
	tags: string[];
	slides: Slide[];
	/** The account that published it. Never leaves the server. */
	publishedBy: string | null;
	createdAt: string;
	updatedAt: string;
};

/** What a caller states about an entry it is publishing — never its slides' ids. */
export type WorkspaceTemplateDraft = {
	title: string;
	description: string;
	category: DeckTemplateCategory;
	tags: string[];
	/** The deck's slides as stored. Copied on the way in; see below. */
	slides: readonly Slide[];
};

/** Project a stored row into the record shape, every key present. */
function readTemplate(row: Record<string, unknown>): WorkspaceTemplateRecord {
	return {
		id: row.id as string,
		workspaceId: row.workspaceId as string,
		sourcePresentationId: row.sourcePresentationId as string,
		title: (row.title as string | undefined) ?? "",
		description: (row.description as string | undefined) ?? "",
		category: (row.category as DeckTemplateCategory | undefined) ?? "meeting",
		tags: (row.tags as string[] | undefined) ?? [],
		slides: (row.slides as Slide[] | undefined) ?? [],
		publishedBy: (row.publishedBy as string | null) ?? null,
		createdAt: (row.createdAt as string | undefined) ?? "",
		updatedAt: (row.updatedAt as string | undefined) ?? "",
	};
}

/**
 * The slides a published entry stores for a deck — copies, under identities of
 * their own, sharing nothing with the deck they were taken from.
 *
 * The first half of REQ004's independence, and the reason a publish is a
 * *snapshot*: with fresh ids on the way in, the deck and the entry have no id in
 * common afterwards, so editing that deck reaches nothing here. Thin on purpose
 * — the re-identification is {@link withFreshSlideIds}, which is also what
 * `copyTemplateSlides` runs on the way back out. What this function adds is the
 * name of the direction.
 */
export function snapshotDeckSlides(slides: readonly Slide[]): Slide[] {
	return withFreshSlideIds(slides);
}

/**
 * Publish a deck as one of this workspace's templates, or refresh the entry it
 * already has — one row per (workspace, deck), so republishing is an update
 * rather than a second card beside the first.
 *
 * Idempotent per deck, and idempotent under a **race** too, which the read below
 * cannot give on its own: two publishes of the same deck in flight together both
 * find no row, and the unique index is what makes the second insert fail rather
 * than succeed. That failure is handled here as the republish the losing call
 * was always going to be if it had arrived a moment later — the same shape
 * `addWorkspaceMember` takes, for the same reason.
 *
 * Reports which of the two happened, so the route can answer `201` for an entry
 * that did not exist and `200` for one that did.
 */
export async function publishWorkspaceTemplate(
	workspaceId: string,
	sourcePresentationId: string,
	publishedBy: string | null,
	draft: WorkspaceTemplateDraft,
): Promise<{ created: boolean; template: WorkspaceTemplateRecord }> {
	const now = new Date().toISOString();
	const fields = {
		title: draft.title,
		description: draft.description,
		category: draft.category,
		tags: draft.tags,
		slides: snapshotDeckSlides(draft.slides),
		updatedAt: now,
	};
	const existing = (
		await templates.find({ workspaceId, sourcePresentationId })
	)[0];
	if (existing) return republish(existing, fields);
	try {
		const inserted = await templates.insert({
			workspaceId,
			sourcePresentationId,
			publishedBy,
			createdAt: now,
			...fields,
		});
		return { created: true, template: readTemplate(inserted) };
	} catch (insertError) {
		// The lost race, and only the lost race: a refusal with no row behind it is
		// some other failure and is re-thrown rather than swallowed into an entry
		// this function did not write.
		const raced = (await templates.find({ workspaceId, sourcePresentationId }))[0];
		if (!raced) throw insertError;
		return republish(raced, fields);
	}
}

/**
 * Refresh an entry that already exists. A row that vanished between being read
 * and being written is a **throw**, not a fallback: answering with the entry as
 * it was would tell a publisher their deck's newest slides are in a template
 * that does not hold them (fail loudly rather than quietly wrong).
 *
 * `publishedBy` and `createdAt` are deliberately not among the fields moved —
 * the entry keeps saying who put it in the gallery and when it first appeared,
 * while `updatedAt` is what a refresh moves.
 */
async function republish(
	existing: Record<string, unknown>,
	fields: Record<string, unknown>,
): Promise<{ created: false; template: WorkspaceTemplateRecord }> {
	const id = existing.id as string;
	const updated = await templates.update(id, fields);
	if (!updated) {
		throw new Error(
			`publishWorkspaceTemplate: entry ${id} disappeared mid-republish`,
		);
	}
	return { created: false, template: readTemplate(updated) };
}

/**
 * Everything one workspace publishes, newest first — a gallery is read for what
 * arrived recently, unlike the roster beside it, which is read for who was here
 * first.
 */
export async function listWorkspaceTemplates(
	workspaceId: string,
): Promise<WorkspaceTemplateRecord[]> {
	if (!workspaceId) return [];
	const rows = await templates.find({ workspaceId });
	return rows
		.map(readTemplate)
		.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

/**
 * One published template by its own id, **scoped to its workspace** — an id that
 * belongs to another workspace is `null` here rather than a read across
 * workspaces, exactly as `getWorkspaceMember` is scoped. The caller's standing
 * was proved against the workspace, so the entry has to be one of that
 * workspace's for that proof to mean anything.
 */
export async function getWorkspaceTemplate(
	workspaceId: string,
	templateId: string,
): Promise<WorkspaceTemplateRecord | null> {
	if (!workspaceId || !templateId) return null;
	const row = await templates.findOne(templateId);
	if (!row || row.workspaceId !== workspaceId) return null;
	return readTemplate(row);
}

/**
 * Take one published template back down, scoped to its workspace for the reason
 * {@link getWorkspaceTemplate} is.
 *
 * Immediate and total for the *gallery*, and deliberately nothing at all for the
 * decks: every deck made from this entry is an ordinary deck of the workspace's
 * that shares no id with it, so there is nothing here that could reach one. The
 * deck the entry was published from is untouched too — it was only ever the
 * snapshot's source.
 */
export async function unpublishWorkspaceTemplate(
	workspaceId: string,
	templateId: string,
): Promise<boolean> {
	const existing = await getWorkspaceTemplate(workspaceId, templateId);
	if (!existing) return false;
	return templates.remove(templateId);
}

/**
 * Every published template of one workspace, removed — what deleting the
 * workspace calls, on the reading its membership sweep already takes: an entry
 * naming a workspace that no longer exists is a row no route resolves and no
 * screen draws.
 */
export async function deleteWorkspaceTemplates(
	workspaceId: string,
): Promise<number> {
	return templates.deleteMany({ workspaceId });
}
