import { ChevronLeft, LayoutTemplate, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Segmented } from "../components/EditorControls";
import { LegalNotice } from "../components/LegalLinks";
import { ICON_BUTTON_HOVER } from "../components/ShareCluster";
import { TemplateCard, UseTemplateButton } from "../components/TemplateCard";
import { AppMenu } from "../components/ui/AppMenu";
import { LoadingState } from "../components/ui/Loading";
import { useToast } from "../components/ui/Toast";
import { useGuestCreationRefusal } from "../guest-creation";
import {
	textWithElement,
	useDocumentLanguage,
	useInterfaceText,
} from "../interface-language";
import {
	fillText,
	type InterfaceLanguage,
	type InterfaceText,
	pluralText,
} from "../interface-text";
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
//
// The card itself is `components/TemplateCard.tsx` and is not this page's: a
// workspace's own published templates (REQ004) are the same entry with a
// publisher on it, drawn by the same component on the workspace's page.
//
// The page is in the interface language (REQ248), and a deck made here starts
// with its participant language set to it, as one made on /create does. The
// templates' own titles, descriptions and slides are the catalog's, and stay
// as it wrote them.

/**
 * What picking an entry asks the server for: a copy of it, its participant
 * language starting in the interface language (REQ248). Only the starting
 * value — the presenter changes it in the deck's settings like any other.
 */
export function templateCreateRequest(
	templateId: string,
	language: InterfaceLanguage,
): { templateId: string; language: InterfaceLanguage } {
	return { templateId, language };
}

/** The language the built-in catalog's entries are written in (`server/templates.ts`). */
const CATALOG_LANGUAGE = "en";

/** The category filter's choices: every category, plus "everything". */
function categoryFilterOptions(
	text: InterfaceText,
): { value: string; label: string }[] {
	return [
		{ value: "all", label: text.templates.allCategories },
		...DECK_TEMPLATE_CATEGORIES.map((category) => ({
			value: category,
			label: text.workspaces.templateCategories[category],
		})),
	];
}

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
	// `/templates` is reachable by URL, so each entry's Use is disabled with its
	// reason while creating without an account is closed and nobody is signed
	// in (REQ252). Browsing the catalog stays open.
	const createRefusal = useGuestCreationRefusal();
	const { addToast } = useToast();
	const { text, language } = useInterfaceText();
	const words = text.templates;

	usePageTitle(words.pageTitle);
	useDocumentLanguage(language);

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
		if (creatingId || createRefusal) return;
		setCreatingId(template.id);
		try {
			const created = await api.createPresentation(
				templateCreateRequest(template.id, language),
			);
			addToast(fillText(words.createdFrom, { title: template.title }), "success");
			go({ page: "edit", id: created.id });
		} catch (createError: unknown) {
			addToast(
				createError instanceof Error
					? createError.message
					: words.createFailed,
				"error",
			);
		} finally {
			setCreatingId(null);
		}
	};

	return (
		<div className="min-h-screen w-full bg-void bg-grid bg-noise">
			<div className="absolute top-4 right-4 sm:top-6 sm:right-6 lg:right-12 z-20">
				<AppMenu />
			</div>

			<div className="relative z-10 w-full px-6 sm:px-12 lg:px-24 py-12 sm:py-16">
				<header className="mb-10 slide-in max-w-3xl">
					<button
						type="button"
						className="mb-4 flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
						onClick={() => go({ page: "home" })}
					>
						<ChevronLeft size={16} />
						{words.back}
					</button>
					<div className="flex items-center gap-3 mb-2">
						<LayoutTemplate size={16} className="text-accent" />
						<span className="font-mono text-sm text-text-muted tracking-wider uppercase">
							{words.eyebrow}
						</span>
					</div>
					<h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
						{textWithElement(
							words.title,
							"accent",
							<span className="text-accent-text">{words.titleAccent}</span>,
						)}
					</h1>
					<p className="text-text-muted max-w-xl">{words.intro}</p>
					{/* Picking a template creates a deck — the same contract the
					    blank editor's Create concludes (REQ183). */}
					<LegalNotice
						action={text.legalNotice.usingTemplate}
						wording={text.legalNotice}
						className="mt-3 max-w-xl"
					/>
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
							placeholder={words.searchPlaceholder}
							aria-label={words.searchPlaceholder}
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
							title={search === "" ? words.clearSearchEmpty : words.clearSearch}
							aria-label={words.clearSearch}
						>
							<X size={14} />
						</button>
					</div>
					{/* Six choices outgrow a phone in either language, so the row
					    scrolls within itself rather than widening the page. */}
					<div className="max-w-full overflow-x-auto">
						<Segmented
							ariaLabel={words.categoryFilter}
							value={category}
							onChange={setCategory}
							options={categoryFilterOptions(text)}
						/>
					</div>
				</div>

				{loading ? (
					<LoadingState />
				) : error ? (
					<p className="text-error text-sm">{error}</p>
				) : (
					<>
						<p className="mb-4 text-sm text-text-dim">
							{filtering
								? pluralText(language, visible.length, words.matchCount, {
										total: templates.length,
									})
								: pluralText(language, templates.length, words.templateCount)}
						</p>
						{visible.length === 0 ? (
							<EmptyResult
								words={words}
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
										contentLanguage={CATALOG_LANGUAGE}
									>
										<UseTemplateButton
											label={fillText(words.useTemplateLabel, {
												title: template.title,
											})}
											creating={creatingId === template.id}
											busy={creatingId !== null}
											refusal={createRefusal}
											onUse={() => handleUse(template)}
										/>
									</TemplateCard>
								))}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}

/** Nothing matched — say what would show more, rather than an empty grid. */
function EmptyResult({
	words,
	onClear,
}: {
	words: InterfaceText["templates"];
	onClear: () => void;
}) {
	return (
		<div className="text-center py-16">
			<div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-raised border border-border mb-6">
				<LayoutTemplate size={28} />
			</div>
			<h3 className="text-lg font-semibold mb-2">{words.noMatch}</h3>
			<p className="text-text-muted mb-6 max-w-sm mx-auto">
				{words.noMatchBody}
			</p>
			<button className="btn-secondary px-6 py-2.5" type="button" onClick={onClear}>
				{words.clearFilters}
			</button>
		</div>
	);
}
