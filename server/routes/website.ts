/**
 * Where this instance's product website has its home, over HTTP (REQ200).
 *
 * One public, read-only route: a participant's ended screen reads it to decide
 * where its link home leads. What it reports is a fact about the deployment,
 * not about the caller, so it asks for no credential — see
 * `server/website-links.ts`.
 */

import { Elysia } from "elysia";
import { WebsiteLinksSchema, resolveWebsiteLinks } from "../website-links";

export const websiteRoutes = new Elysia({
	prefix: "/api",
	name: "website",
}).get("/website", () => resolveWebsiteLinks(), {
	response: WebsiteLinksSchema,
	detail: {
		tags: ["Discovery"],
		summary: "Where this instance's product website has its home",
		description:
			"The addresses of the product website's home that this deployment configured (REQ200), in `OMUL_WEBSITE_HOME_URL_EN` and `OMUL_WEBSITE_HOME_URL_DE`. Each is an absolute `http(s)://` URL, a path on this host, or an explicit `null` when unconfigured. A participant's ended screen links a German deck to `homeUrlDe` and a deck in any other language to `homeUrlEn`, falls back to whichever one is set, and leads to the app's own home page while neither is. Public and read-only.",
	},
});
