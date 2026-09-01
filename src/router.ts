import { useEffect } from "react";
import { BRAND_NAME } from "./components/BrandMark";

// ── Client-side routing ──────────────────────────────────────

export type Route =
	| { page: "home" }
	| { page: "create" }
	/** The prebuilt-deck catalog (REQ005) — a page of its own, so it is linkable. */
	| { page: "templates" }
	/**
	 * Drafting a deck from a prompt (REQ007) — a page of its own for the reason
	 * the catalog next door has one: it is the second way a deck starts from
	 * something rather than from nothing, and both deserve a link to send
	 * somebody.
	 */
	| { page: "generate" }
	/**
	 * The workspaces this account is in (REQ128), and one of them. Two routes
	 * rather than a selection inside one page, for the reason the catalog and the
	 * generator have pages of their own: a workspace is a place a team works, and
	 * a place is something you send somebody a link to.
	 */
	| { page: "workspaces" }
	| { page: "workspace"; id: string }
	| { page: "edit"; id: string }
	| { page: "present"; id: string }
	| { page: "preview"; id: string }
	/**
	 * The deck's results, read-only and account-free (REQ098). A page of its own
	 * because that is what a shareable link points at: the presenter surface is a
	 * console with a projector on the other end of it, and handing somebody a
	 * results link must not hand them that.
	 */
	| { page: "results"; id: string }
	| { page: "join" }
	| { page: "participate"; code: string };

export function getInitialRoute(): Route {
	const path = window.location.pathname;
	const hash = window.location.hash.slice(1);

	if (path.startsWith("/preview/")) {
		return { page: "preview", id: path.split("/preview/")[1] };
	}
	if (path.startsWith("/results/")) {
		return { page: "results", id: path.split("/results/")[1] };
	}
	if (path.startsWith("/present/")) {
		return { page: "present", id: path.split("/present/")[1] };
	}
	if (path.startsWith("/edit/")) {
		return { page: "edit", id: path.split("/edit/")[1] };
	}
	if (path.startsWith("/join/")) {
		return { page: "participate", code: path.split("/join/")[1] };
	}
	if (path.startsWith("/workspaces/")) {
		return { page: "workspace", id: path.split("/workspaces/")[1] };
	}
	if (path === "/workspaces") return { page: "workspaces" };
	if (path === "/templates") return { page: "templates" };
	if (path === "/generate") return { page: "generate" };
	if (hash === "create") return { page: "create" };
	if (hash === "join") return { page: "join" };
	return { page: "home" };
}

export function navigate(route: Route) {
	switch (route.page) {
		case "home":
			window.history.pushState(null, "", "/");
			break;
		case "create":
			window.history.pushState(null, "", "/#create");
			break;
		case "templates":
			window.history.pushState(null, "", "/templates");
			break;
		case "generate":
			window.history.pushState(null, "", "/generate");
			break;
		case "workspaces":
			window.history.pushState(null, "", "/workspaces");
			break;
		case "workspace":
			window.history.pushState(null, "", `/workspaces/${route.id}`);
			break;
		case "edit":
			window.history.pushState(null, "", `/edit/${route.id}`);
			break;
		case "join":
			window.history.pushState(null, "", "/#join");
			break;
		case "present":
			window.history.pushState(null, "", `/present/${route.id}`);
			break;
		case "preview":
			window.history.pushState(null, "", `/preview/${route.id}`);
			break;
		case "results":
			window.history.pushState(null, "", `/results/${route.id}`);
			break;
		case "participate":
			window.history.pushState(null, "", `/join/${route.code}`);
			break;
	}
}

/**
 * The tab's words. The product is named by its name alone (REQ167) — the mark
 * stands without a gloss, and so does the word.
 */
export function usePageTitle(title: string) {
	useEffect(() => {
		document.title = title ? `${title} - ${BRAND_NAME}` : BRAND_NAME;
	}, [title]);
}
