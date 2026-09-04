import type { ReactNode } from "react";
import type { DeckTemplate, DeckTemplateCategory } from "../types";
import { HighlightedText } from "./HighlightedText";
import { SlideTypeIcon } from "./SlideTypeIcon";

// ── One template, on a card ───────────────────────────────────
//
// Two surfaces draw a template: the built-in catalog's gallery (REQ005) and the
// templates a workspace publishes for itself (REQ004). What they draw is the
// same thing — a name, what occasion it is for, what it is, the shape of the
// deck it would produce, and the words it can be found by — because a published
// entry *is* a catalog entry plus who published it. So the card is one
// component, and the invariant it owns is that presentation, not the button on
// it: the two surfaces offer different actions (create from it; create from it,
// or take it down) and each passes its own as children.
//
// Everything the search looks at is on the card — title, description, category
// and tags — so a match always has a visible reason, and the reason is marked
// where it was found.

/**
 * What each category is called on screen. The vocabulary itself is the schema's
 * (`DECK_TEMPLATE_CATEGORIES`); these are the words for it, and they live beside
 * the card because the card is the only thing that says them out loud — on
 * either surface.
 */
export const DECK_TEMPLATE_CATEGORY_LABELS: Record<
	DeckTemplateCategory,
	string
> = {
	meeting: "Meetings",
	workshop: "Workshops",
	education: "Teaching",
	feedback: "Feedback",
	engagement: "Engagement",
};

export function TemplateCard({
	template,
	search,
	index,
	children,
}: {
	/**
	 * A built-in entry or a published one — the card reads only the fields they
	 * share, which is what lets one component draw both.
	 */
	template: DeckTemplate;
	/** What the gallery is being narrowed by, so the match can be marked. */
	search: string;
	/** Position in the grid, for the staggered entrance the pages share. */
	index: number;
	/** This surface's actions, and anything it alone has to say. */
	children?: ReactNode;
}) {
	const slideCount = template.slides.length;
	return (
		<article
			className={`flex flex-col gap-3 p-5 rounded-xl bg-surface-raised border border-border hover:border-text-dim transition-all shadow-panel slide-in slide-in-delay-${Math.min(index + 1, 5)}`}
		>
			<div className="flex items-start justify-between gap-3">
				<h2 className="font-semibold leading-tight">
					<HighlightedText text={template.title} search={search} />
				</h2>
				<span className="flex-shrink-0 rounded-full border border-border-subtle bg-surface px-2.5 py-0.5 text-xs text-text-muted">
					<HighlightedText
						text={DECK_TEMPLATE_CATEGORY_LABELS[template.category]}
						search={search}
					/>
				</span>
			</div>

			<p className="text-sm text-text-muted">
				<HighlightedText text={template.description} search={search} />
			</p>

			{/* The deck's shape at a glance: one icon per slide, in the order they
			    are in, so the card says what kind of session this is rather than
			    only how long it is. */}
			<div className="flex flex-wrap items-center gap-2 text-sm text-text-dim">
				<span className="font-mono text-xs">
					{slideCount} slide{slideCount === 1 ? "" : "s"}
				</span>
				<span className="flex flex-wrap items-center gap-1.5">
					{template.slides.map((slide) => (
						<SlideTypeIcon key={slide.id} type={slide.type} />
					))}
				</span>
			</div>

			<div className="flex flex-wrap gap-1.5">
				{template.tags.map((tag) => (
					<span
						key={tag}
						className="rounded-md bg-surface px-2 py-0.5 text-xs text-text-dim"
					>
						<HighlightedText text={tag} search={search} />
					</span>
				))}
			</div>

			{/* The action area, pushed to the bottom so every card in a row lines up
			    however long the description above it ran. */}
			<div className="mt-auto flex flex-col gap-2">{children}</div>
		</article>
	);
}

/**
 * The one way into a template, wherever it is drawn: create a deck from it.
 *
 * Shared with the card for the reason the card is shared — the affordance is the
 * same on both galleries, down to the wait while the server writes the deck. One
 * at a time on either surface: a second click while the first create is in
 * flight would leave the organizer with two decks and one editor, so every other
 * card's button is disabled **with that reason on it** rather than removed.
 */
export function UseTemplateButton({
	label,
	creating,
	busy,
	refusal = null,
	onUse,
}: {
	/** What this button does, said in full — the title when nothing is in flight. */
	label: string;
	/** This entry is the one being created right now. */
	creating: boolean;
	/** Some entry is being created — not necessarily this one. */
	busy: boolean;
	/**
	 * Why this caller may not use the template at all, when they may not — the
	 * control is still drawn and still says what it would do, because a button
	 * that vanished would say nothing (REQ129's rule, and the workspace page's).
	 */
	refusal?: string | null;
	onUse: () => void;
}) {
	return (
		<button
			type="button"
			className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
			onClick={onUse}
			disabled={busy || refusal !== null}
			title={
				refusal !== null
					? refusal
					: busy && !creating
						? "Another template is being created — one at a time."
						: label
			}
		>
			{creating ? "Creating…" : "Use template"}
		</button>
	);
}
