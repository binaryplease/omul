/**
 * The template catalog over HTTP (REQ005).
 *
 * Its own route file for the reason `server/templates.ts` is its own module
 * (ADR-0032): nothing here touches a store, an owner or an edit token, so it
 * would still work unchanged if the presentation routes beside it were deleted.
 *
 * **Public and unauthenticated, both of them.** The catalog is content this
 * build ships — the same entries for every caller, signed in or not — so there
 * is nothing here to authorize and nothing a credential would change. Read-only
 * in the strongest sense the codebase has: there is no write route for a
 * template anywhere, because the set is code (see the module note in
 * `server/templates.ts`). *Starting* from an entry is a presentation create and
 * lives with the other presentation routes, where its rate limit already is.
 */

import { Elysia } from "elysia";
import { DeckTemplateQuerySchema } from "../schemas";
import { findDeckTemplate, listDeckTemplates } from "../templates";

export const templateRoutes = new Elysia({ prefix: "/api" })
	// ── List the catalog (REQ005) ───────────────────────────
	.get(
		"/templates",
		({ query }) =>
			listDeckTemplates({ category: query.category, search: query.search }),
		{
			query: DeckTemplateQuerySchema,
			detail: {
				tags: ["Templates"],
				summary: "List the deck templates",
				description:
					"Returns the built-in template catalog (REQ005): each entry with its `id`, `title`, `description`, `category`, `tags` and the full `slides` it would copy into a new deck. Narrowed by two independently optional filters — `category`, one of the closed set, and `search`, a case-insensitive substring matched against the title, description, category and tags together. An entry's id is what `POST /api/presentations` takes as `templateId` (REQ006). Public: the catalog ships with the build and reads the same for every caller.",
			},
		},
	)

	// ── One entry by id (REQ005) ────────────────────────────
	.get(
		"/templates/:id",
		({ params, set }) => {
			const template = findDeckTemplate(params.id);
			if (!template) {
				set.status = 404;
				return { error: "Not found" };
			}
			return template;
		},
		{
			detail: {
				tags: ["Templates"],
				summary: "Get one deck template",
				description:
					"Fetches a single catalog entry by its id — the same shape the list returns, for a client that already holds an id and wants to inspect what it would copy before creating from it (REQ006). Returns 404 when nothing is filed under that id, which is also what `POST /api/presentations` refuses an unknown `templateId` with (as a 400 on the body).",
			},
		},
	);
