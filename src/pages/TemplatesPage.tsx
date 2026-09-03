import { ChevronLeft, LayoutTemplate, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Segmented } from "../components/EditorControls";
import { HighlightedText } from "../components/HighlightedText";
import { ICON_BUTTON_HOVER } from "../components/ShareCluster";
import { SlideTypeIcon } from "../components/SlideTypeIcon";
import { LoadingState } from "../components/ui/Loading";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import type { DeckTemplate, DeckTemplateCategory } from "../types";
import { DECK_TEMPLATE_CATEGORIES, filterDeckTemplates } from "../types";

// ── Template gallery ──────────────────────────────────────────
//
// The catalog of prebuilt decks (REQ005) and the way into one (REQ006). The
// whole set is fetched once and narrowed in the browser with
// `filterDeckTemplates` — the very function the endpoint's `category`/`search`
// parameters run — so a search here can never mean something the API
// would disagree with, and typing costs no round trip over a handful of entries.
//
// Picking an entry does not load it into the editor's draft: it creates the deck
// server-side from its id and lands in the editor on the real thing. That is
// what makes the copy REQ006's copy — re-identified slides, a deck of one's own
// with an edit token, nothing pointing back at the template — rather than a
// client-side clipboard the organizer could lose by closing the tab.

/**
 * What each category is called on screen. The vocabulary itself is the schema's
 * (`DECK_TEMPLATE_CATEGORIES`); these are the words for it, and they live here
 * because the gallery is the only surface that says them out loud.
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

/** The category filter's choices: every category, plus "everything". */
const CATEGORY_FILTER_OPTIONS: { value: string; label: string }[] = [
	{ value: "all", label: "All" },
	...DECK_TEMPLATE_CATEGORIES.map((category) => ({
		value: category,
		label: DECK_TEMPLATE_CATEGORY_LABELS[category],
	})),
];

export function TemplatesPage({ go }: { go: (r: Route) => void }) {
	const [templates, setTemplates] = useState<DeckTemplate[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	// The two filters (REQ005), held as the raw controls' values: "all" is the
	// absence of a category filter rather than a sixth category.
	const [category, setCategory] = useState<string>("all");
	const [search, setSearch] = useState("");
	// Which entry is currently being turned into a deck, if any. One at a time:
	// a second click while the first create is in flight would leave the
	// organizer with two decks and one editor.
	const [creatingId, setCreatingId] = useState<string | null>(null);
	const { addToast } = useToast();

	usePageTitle("Templates");

	useEffect(() => {
		let cancelled = false;
		api
			.listTemplates()
			.then((catalog) => {
				if (!cancelled) setTemplates(catalog);
			})
			.catch((loadError: Error) => {
				if (!cancelled) setError(loadError.message);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const visible = filterDeckTemplates(templates, {
		category:
			category === "all" ? undefined : (category as DeckTemplateCategory),
		search,
	});
	const filtering = category !== "all" || search.trim() !== "";

	const handleUse = async (template: DeckTemplate) => {
		if (creatingId) return;
		setCreatingId(template.id);
		try {
			const created = await api.createPresentation({ templateId: template.id });
			addToast(`Created from “${template.title}”`, "success");
			go({ page: "edit", id: created.id });
		} catch (createError: unknown) {
			addToast(
				createError instanceof Error
					? createError.message
					: "Failed to create from this template",
				"error",
			);
		} finally {
			setCreatingId(null);
		}
	};

	return (
		<div className="min-h-screen w-full bg-void bg-grid bg-noise">
			<div className="absolute top-4 right-4 sm:top-6 sm:right-6 lg:right-12 z-20">
				<ThemeToggle />
			</div>

			<div className="relative z-10 w-full px-6 sm:px-12 lg:px-24 py-12 sm:py-16">
				<header className="mb-10 slide-in max-w-3xl">
					<button
						type="button"
						className="mb-4 flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
						onClick={() => go({ page: "home" })}
					>
						<ChevronLeft size={16} />
						Back
					</button>
					<div className="flex items-center gap-3 mb-2">
						<LayoutTemplate size={16} className="text-accent" />
						<span className="font-mono text-sm text-text-muted tracking-wider uppercase">
							templates
						</span>
					</div>
					<h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
						Start from a <span className="text-accent-text">prebuilt deck</span>
					</h1>
					<p className="text-text-muted max-w-xl">
						Every template is a full deck you own from the moment you pick it —
						the slides are copied into a new presentation and are yours to edit,
						reorder or throw away.
					</p>
				</header>

				{/* The two filters, above the results they narrow. */}
				<div className="mb-8 flex flex-col gap-3 slide-in slide-in-delay-1">
					<div className="relative max-w-md">
						<Search
							size={16}
							className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
						/>
						<input
							className="input input-search"
							type="search"
							placeholder="Search templates"
							aria-label="Search templates"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
						{/* Always here, disabled when there is nothing to clear
						    — a control that vanished would make an empty
						    search box look like a different screen. */}
						<button
							type="button"
							className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 disabled:opacity-40 ${ICON_BUTTON_HOVER}`}
							onClick={() => setSearch("")}
							disabled={search === ""}
							title={
								search === ""
									? "Nothing to clear — the search box is empty."
									: "Clear the search"
							}
							aria-label="Clear the search"
						>
							<X size={14} />
						</button>
					</div>
					<Segmented
						ariaLabel="Filter templates by category"
						value={category}
						onChange={setCategory}
						options={CATEGORY_FILTER_OPTIONS}
					/>
				</div>

				{loading ? (
					<LoadingState />
				) : error ? (
					<p className="text-error text-sm">{error}</p>
				) : (
					<>
						<p className="mb-4 text-sm text-text-dim">
							{filtering
								? `${visible.length} of ${templates.length} templates match`
								: `${templates.length} template${templates.length === 1 ? "" : "s"}`}
						</p>
						{visible.length === 0 ? (
							<EmptyResult
								onClear={() => {
									setSearch("");
									setCategory("all");
								}}
							/>
						) : (
							<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
								{visible.map((template, index) => (
									<TemplateCard
										key={template.id}
										template={template}
										search={search}
										index={index}
										creating={creatingId === template.id}
										busy={creatingId !== null}
										onUse={() => handleUse(template)}
									/>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}

/**
 * One catalog entry. Everything the search looks at is on the card — title,
 * description, category and tags — so a match always has a visible reason, and
 * the reason is marked where it was found.
 */
function TemplateCard({
	template,
	search,
	index,
	creating,
	busy,
	onUse,
}: {
	template: DeckTemplate;
	search: string;
	index: number;
	/** This entry is the one being created right now. */
	creating: boolean;
	/** Some entry is being created — not necessarily this one. */
	busy: boolean;
	onUse: () => void;
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

			<button
				type="button"
				className="btn-primary mt-auto text-sm disabled:opacity-50 disabled:cursor-wait"
				onClick={onUse}
				disabled={busy}
				title={
					busy && !creating
						? "Another template is being created — one at a time."
						: `Create a new deck from “${template.title}”`
				}
			>
				{creating ? "Creating…" : "Use template"}
			</button>
		</article>
	);
}

/** Nothing matched — say what would show more, rather than an empty grid. */
function EmptyResult({ onClear }: { onClear: () => void }) {
	return (
		<div className="text-center py-16">
			<div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-raised border border-border mb-6">
				<LayoutTemplate size={28} />
			</div>
			<h3 className="text-lg font-semibold mb-2">No template matches</h3>
			<p className="text-text-muted mb-6 max-w-sm mx-auto">
				Nothing in the catalog answers both filters. Clear them to see every
				template again.
			</p>
			<button className="btn-secondary px-6 py-2.5" type="button" onClick={onClear}>
				Clear filters
			</button>
		</div>
	);
}
