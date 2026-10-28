/**
 * The ended screen's way onward (REQ200).
 *
 * When a deck has ended, the participant's screen offers one control: home. It
 * is worded in the deck's language, like every other participant screen
 * (REQ084), and where it leads is the deployment's to say (`GET /api/website`,
 * from `OMUL_WEBSITE_HOME_URL_EN` / `OMUL_WEBSITE_HOME_URL_DE`):
 *
 *   - **A website is configured** — a plain link to its home, in the deck's
 *     language where the website has it: a German deck to the German home,
 *     every other deck to the English one, and to whichever is set when only
 *     one is. The address is used exactly as configured; nothing is appended.
 *   - **None is** — the app's own home page, as before this existed.
 *
 * Only ever a link the participant clicks: nothing here navigates on its own,
 * and the browser's language is never consulted — the deck's language is what
 * the screen is already drawn in. The link tells the website it came from this
 * origin and nothing more (`referrerPolicy="origin"`): the page it leaves is
 * `/join/<CODE>`, and a website on the same host would otherwise be sent the
 * join code in its `Referer`.
 *
 * Until the one request answers, the control is drawn as unconfigured. It looks
 * the same either way, so nothing on screen shifts when it does.
 */

import { useEffect, useState } from "react";
import { api } from "../api";
import { getDict, resolveLang } from "../i18n";
import type { WebsiteLinks } from "../types";
import { withBrandName } from "./FeedbackForm";

/** What the control uses before — or without — a configured website. */
export const NO_WEBSITE_LINKS: WebsiteLinks = {
	homeUrlEn: null,
	homeUrlDe: null,
};

/**
 * The website home a deck in `language` leads to, or `null` when this
 * deployment configured none and the app's own home is the way onward.
 */
export function websiteHomeUrlFor(
	links: WebsiteLinks,
	language?: string,
): string | null {
	if (resolveLang(language) === "de") return links.homeUrlDe ?? links.homeUrlEn;
	return links.homeUrlEn ?? links.homeUrlDe;
}

// ── Loading ───────────────────────────────────────────────────

/**
 * One request per page load. A failed read is forgotten, so the next mount
 * tries again, and is drawn as unconfigured meanwhile — the same as an
 * instance that set nothing.
 */
let resolvedWebsiteLinks: WebsiteLinks | null = null;
let pendingWebsiteLinks: Promise<WebsiteLinks> | null = null;

function loadWebsiteLinks(): Promise<WebsiteLinks> {
	pendingWebsiteLinks ??= api.getWebsiteLinks().then(
		(links) => {
			resolvedWebsiteLinks = links;
			return links;
		},
		() => {
			pendingWebsiteLinks = null;
			return NO_WEBSITE_LINKS;
		},
	);
	return pendingWebsiteLinks;
}

export function useWebsiteLinks(): WebsiteLinks {
	const [links, setLinks] = useState<WebsiteLinks>(
		() => resolvedWebsiteLinks ?? NO_WEBSITE_LINKS,
	);
	useEffect(() => {
		if (resolvedWebsiteLinks) return;
		let mounted = true;
		void loadWebsiteLinks().then((loaded) => {
			if (mounted) setLinks(loaded);
		});
		return () => {
			mounted = false;
		};
	}, []);
	return links;
}

// ── Rendering ─────────────────────────────────────────────────

/**
 * The control for a given set of addresses: a link to the website's home when
 * one applies, otherwise a button that opens the app's own home through the
 * router (`onAppHome`).
 */
export function WebsiteHomeLinkView({
	links,
	language,
	onAppHome,
}: {
	links: WebsiteLinks;
	language?: string;
	onAppHome: () => void;
}) {
	const label = withBrandName(getDict(language).goToHomepage);
	const href = websiteHomeUrlFor(links, language);
	if (href) {
		return (
			<a href={href} className="btn-secondary" referrerPolicy="origin">
				{label}
			</a>
		);
	}
	return (
		<button type="button" className="btn-secondary" onClick={onAppHome}>
			{label}
		</button>
	);
}

/** The ended screen's way onward, reading this deployment's addresses. */
export function WebsiteHomeLink({
	language,
	onAppHome,
}: {
	language?: string;
	onAppHome: () => void;
}) {
	return (
		<WebsiteHomeLinkView
			links={useWebsiteLinks()}
			language={language}
			onAppHome={onAppHome}
		/>
	);
}
