import type { ButtonHTMLAttributes } from "react";
import type { SlideType } from "../types";
import { slideTextToPlain } from "./SlideText";
import { SlideTypeIcon } from "./SlideTypeIcon";

// ── Slide rail item ───────────────────────────────────────────────────
//
// The numbered slide thumbnail that appears in a vertical rail on two
// surfaces: the presenter's navigation sidebar (click → go to slide) and the
// editor's slide list (click → select for editing). The
// invariant — a slide's identity chip (number + type icon + title) and its
// selected/idle treatment — is expressed once here; each surface composes it
// with its own click handler and surrounding chrome.

/**
 * Shared selected/idle surface token: the highlight a rail item
 * wears when it is the active/selected slide versus when it is not. Owned here,
 * composed by every rail surface — never re-declared inline per page.
 */
export function slideRailItemSurface(active: boolean): string {
	return active
		? "bg-accent-dim border-accent/30 text-text"
		: "bg-surface-raised border-border text-text-muted hover:border-text-dim";
}

/**
 * A single rail item rendered as a button. `active` drives the shared
 * highlight; `alwaysShowTitle` keeps the title visible on narrow rails (the
 * editor) where the presenter's horizontal-scroll rail hides it below md.
 *
 * `title` is the slide's authored heading, and the rail is naming a slide
 * rather than showing one — so its markup comes off here (REQ089): a truncated
 * one-line gist reading `**Q3** — see [the docs](https://…)` names the slide
 * worse than the words in it do.
 */
export function SlideRailItem({
	index,
	type,
	title,
	active,
	alwaysShowTitle = false,
	className = "",
	...buttonProps
}: {
	index: number;
	type: SlideType;
	title: string;
	active: boolean;
	alwaysShowTitle?: boolean;
	className?: string;
	// `type` (slide type) and `title` (slide title) are our own props; drop the
	// native button attributes of the same name so they don't collide.
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "title">) {
	const gist = slideTextToPlain(title);
	return (
		<button
			type="button"
			className={`flex-shrink-0 text-left p-2 md:p-3 rounded-lg border text-sm transition-all ${slideRailItemSurface(
				active,
			)} ${className}`}
			{...buttonProps}
		>
			<div className="flex items-center gap-2 md:mb-1">
				<span className="font-mono text-xs text-text-muted">{index + 1}</span>
				<SlideTypeIcon type={type} />
			</div>
			<p className={`truncate ${alwaysShowTitle ? "" : "hidden md:block"}`}>
				{gist || "Untitled"}
			</p>
		</button>
	);
}
