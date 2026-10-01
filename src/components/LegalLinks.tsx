/**
 * The operator's legal texts, where a visitor meets them (REQ183).
 *
 * Two surfaces, one descriptor and one link style between them:
 *
 *   - **`<LegalFooter/>`** — mounted once by `App`, under every route, so the
 *     imprint, the privacy policy and the terms are reachable from anywhere in
 *     the app.
 *   - **`<LegalNotice action=…/>`** — the sentence at each point a contract is
 *     concluded (signing up, creating a deck, joining a room), naming the terms
 *     and the privacy policy *before* the action is submitted.
 *
 * Where the texts live is the deployment's to say (`GET /api/legal`, from
 * `OMUL_IMPRINT_URL` / `OMUL_PRIVACY_URL` / `OMUL_TERMS_URL`). A text whose
 * address was not configured gets no link, and a surface with nothing to link
 * renders nothing at all — so an instance that configured none looks exactly as
 * it did before this existed. Until the one request answers, every surface
 * draws as unconfigured; it is sent when `App` mounts, long before anybody has
 * filled in a form.
 *
 * Every link opens in a new tab: two of the three contract points are forms,
 * and reading the terms must not cost the visitor what they typed.
 */

import { type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import type { LegalLinks } from "../types";

/** What a surface draws before — or without — a configured address. */
export const NO_LEGAL_LINKS: LegalLinks = {
	imprintUrl: null,
	privacyUrl: null,
	termsUrl: null,
};

/** The three texts, in the order the footer lists them, and their names. */
export const LEGAL_TEXT_DESCRIPTORS = [
	{ field: "imprintUrl", label: "Imprint" },
	{ field: "privacyUrl", label: "Privacy Policy" },
	{ field: "termsUrl", label: "Terms of Service" },
] as const satisfies readonly { field: keyof LegalLinks; label: string }[];

/** The one style a legal link wears, in the footer and in a notice alike. */
export const LEGAL_LINK_CLASS =
	"underline underline-offset-2 hover:text-text transition-colors";

/** The texts this deployment configured, in footer order, unset ones dropped. */
export function configuredLegalLinks(
	links: LegalLinks,
): { label: string; href: string }[] {
	return LEGAL_TEXT_DESCRIPTORS.flatMap(({ field, label }) => {
		const href = links[field];
		return href ? [{ label, href }] : [];
	});
}

// ── Loading ───────────────────────────────────────────────────

/**
 * One request per page load, shared by every surface that asks. A failed read
 * is forgotten, so the next surface to mount tries again, and is drawn as
 * unconfigured meanwhile — the same as an instance that set nothing.
 */
let resolvedLegalLinks: LegalLinks | null = null;
let pendingLegalLinks: Promise<LegalLinks> | null = null;

function loadLegalLinks(): Promise<LegalLinks> {
	pendingLegalLinks ??= api.getLegalLinks().then(
		(links) => {
			resolvedLegalLinks = links;
			return links;
		},
		() => {
			pendingLegalLinks = null;
			return NO_LEGAL_LINKS;
		},
	);
	return pendingLegalLinks;
}

export function useLegalLinks(): LegalLinks {
	const [links, setLinks] = useState<LegalLinks>(
		() => resolvedLegalLinks ?? NO_LEGAL_LINKS,
	);
	useEffect(() => {
		if (resolvedLegalLinks) return;
		let mounted = true;
		void loadLegalLinks().then((loaded) => {
			if (mounted) setLinks(loaded);
		});
		return () => {
			mounted = false;
		};
	}, []);
	return links;
}

// ── Rendering ─────────────────────────────────────────────────

function LegalLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className={LEGAL_LINK_CLASS}
		>
			{children}
		</a>
	);
}

/** The footer for a given set of addresses — nothing when none is set. */
export function LegalFooterLinks({ links }: { links: LegalLinks }) {
	const configured = configuredLegalLinks(links);
	if (configured.length === 0) return null;
	return (
		<footer className="relative z-10 border-t border-border bg-void px-6 py-3 font-mono text-xs text-text-dim">
			<nav
				aria-label="Legal"
				className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1"
			>
				{configured.map((link) => (
					<LegalLink key={link.label} href={link.href}>
						{link.label}
					</LegalLink>
				))}
			</nav>
		</footer>
	);
}

/** The app-wide footer, under every route. */
export function LegalFooter() {
	return <LegalFooterLinks links={useLegalLinks()} />;
}

/**
 * The sentence at a contract-conclusion point, for a given set of addresses.
 * `action` completes "By …," — "creating an account", "joining". Names the
 * terms when they are configured and the privacy policy when it is; nothing
 * when neither is (the imprint is the footer's alone).
 */
export function LegalNoticeText({
	links,
	action,
	className = "",
}: {
	links: LegalLinks;
	action: string;
	className?: string;
}) {
	const { termsUrl, privacyUrl } = links;
	if (!termsUrl && !privacyUrl) return null;
	return (
		<p
			className={`font-mono text-xs leading-relaxed text-text-dim ${className}`}
		>
			{termsUrl && (
				<>
					By {action}, you agree to the{" "}
					<LegalLink href={termsUrl}>Terms of Service</LegalLink>.
				</>
			)}
			{termsUrl && privacyUrl && " "}
			{privacyUrl && (
				<>
					The <LegalLink href={privacyUrl}>Privacy Policy</LegalLink> explains
					how your data is processed.
				</>
			)}
		</p>
	);
}

/** A contract-conclusion notice, reading this deployment's addresses. */
export function LegalNotice({
	action,
	className,
}: {
	action: string;
	className?: string;
}) {
	return (
		<LegalNoticeText
			links={useLegalLinks()}
			action={action}
			className={className}
		/>
	);
}
