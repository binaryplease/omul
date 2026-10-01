/**
 * Where this instance's legal texts live, over HTTP (REQ183).
 *
 * One public, read-only route: the client reads it once per page load to draw
 * the footer on every route and the sentence at each point a contract is
 * concluded. What it reports is a fact about the deployment, not about the
 * caller, so it asks for no credential — see `server/legal-links.ts`.
 */

import { Elysia } from "elysia";
import { LegalLinksSchema, resolveLegalLinks } from "../legal-links";

export const legalRoutes = new Elysia({ prefix: "/api", name: "legal" }).get(
	"/legal",
	() => resolveLegalLinks(),
	{
		response: LegalLinksSchema,
		detail: {
			tags: ["Discovery"],
			summary: "Where this instance's legal texts live",
			description:
				"The addresses of this deployment's imprint, privacy policy and terms (REQ183), as the operator configured them in `OMUL_IMPRINT_URL`, `OMUL_PRIVACY_URL` and `OMUL_TERMS_URL`. Each is an absolute `http(s)://` URL, a path on this host, or an explicit `null` when unconfigured — and an unconfigured text is one the app draws no link for. Public and read-only.",
		},
	},
);
