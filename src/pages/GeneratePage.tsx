import { AlertTriangle, ChevronLeft, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../auth-client";
import { LegalNotice } from "../components/LegalLinks";
import { SlideTypeIcon } from "../components/SlideTypeIcon";
import { AppMenu } from "../components/ui/AppMenu";
import { LoadingState } from "../components/ui/Loading";
import { useToast } from "../components/ui/Toast";
import {
	textWithElement,
	useDocumentLanguage,
	useInterfaceText,
} from "../interface-language";
import {
	fillText,
	type InterfaceLanguage,
	type InterfaceText,
} from "../interface-text";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import type { DeckGenerationAvailability, GeneratedSlideType } from "../types";
import { DECK_PROMPT_MAX_LENGTH } from "../types";

// ── Drafting a deck from a prompt (REQ007) ────────────────────
//
// A page of its own for the reason the template gallery is one: this is the
// second way a deck starts from *something* rather than from nothing, and both
// are worth a link. It is also the shape the wait wants — a generation takes
// seconds and can be refused for reasons that are the server's rather than the
// organizer's, and neither reads well inside a dialog over the home page.
//
// Generating does not load a draft into the editor's local document: it creates
// the deck server-side and lands in the editor on the real thing, exactly as
// picking a template does. What comes back is an ordinary presentation with an
// edit token of its own — which is what REQ007's "returns it as an ordinary
// editable deck" means, and what keeps a draft from being something the
// organizer can lose by closing the tab.
//
// **Whether this build can generate at all is the server's answer**
// (`GET /api/deck-generation`), read once on arrival. A self-hosted deployment
// with no provider key configured is the ordinary case, so the control is drawn
// and disabled with the reason rather than hidden — a missing button
// is indistinguishable from a broken one.
//
// The page is in the interface language (REQ248), and the deck it drafts
// starts with its participant language set to it — which is also the language
// the generator is asked to write the questions in, so a German presenter gets
// a German draft.

/**
 * What a generation asks the server for: the brief, and the interface language
 * as the deck's starting participant language and the language it is written
 * in (REQ248). Only the starting value — the presenter changes it in the deck's
 * settings like any other.
 */
export function deckGenerationRequest(
	prompt: string,
	language: InterfaceLanguage,
): { prompt: string; language: InterfaceLanguage } {
	return { prompt, language };
}

export function GeneratePage({ go }: { go: (r: Route) => void }) {
	const [availability, setAvailability] =
		useState<DeckGenerationAvailability | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState("");
	const [prompt, setPrompt] = useState("");
	// One generation at a time: a second submit while the first is in flight
	// would leave the organizer with two decks and one editor.
	const [generating, setGenerating] = useState(false);
	const { addToast } = useToast();
	const { data: session } = useSession();
	const { text, language } = useInterfaceText();
	const words = text.generate;

	usePageTitle(words.pageTitle);
	useDocumentLanguage(language);

	useEffect(() => {
		let cancelled = false;
		api
			.getDeckGeneration()
			.then((report) => {
				if (!cancelled) setAvailability(report);
			})
			.catch((error: Error) => {
				if (!cancelled) setLoadError(error.message);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const trimmed = prompt.trim();
	const promptMaxLength =
		availability?.promptMaxLength ?? DECK_PROMPT_MAX_LENGTH;
	const overLength = trimmed.length > promptMaxLength;
	// This deployment may only draft for account holders (REQ007) — the control
	// on the paid path that the abuse limits do not provide. A *report*, not a
	// credential: the route re-resolves both halves per request, so getting this
	// wrong here only mis-draws the button.
	const needsSignIn = Boolean(availability?.requiresAccount) && !session;

	/**
	 * Why the button cannot be pressed right now, or `null` when it can — one
	 * reading, so the disabled state and the explanation on it cannot disagree.
	 * Ordered the way the organizer can act on it: what this server
	 * cannot or will not do first, then what they have not typed yet.
	 */
	const blockedReason = (): string | null => {
		if (loadError) return fillText(words.blockedLoadFailed, { reason: loadError });
		// "Not configured" is the one reason the report gives
		// (`server/deck-generator.ts`), worded here in the interface language.
		if (availability && !availability.available) return words.blockedUnavailable;
		if (needsSignIn) return words.blockedSignIn;
		if (generating) return words.blockedGenerating;
		if (trimmed === "") return words.blockedEmpty;
		if (overLength) {
			return fillText(words.blockedTooLong, {
				count: trimmed.length,
				limit: promptMaxLength,
			});
		}
		return null;
	};

	const blocked = blockedReason();

	const handleGenerate = async () => {
		if (blocked || generating) return;
		setGenerating(true);
		try {
			const created = await api.generatePresentation(
				deckGenerationRequest(trimmed, language),
			);
			addToast(fillText(words.drafted, { title: created.title }), "success");
			go({ page: "edit", id: created.id });
		} catch (generateError: unknown) {
			addToast(
				generateError instanceof Error
					? generateError.message
					: words.generateFailed,
				"error",
			);
		} finally {
			setGenerating(false);
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
						<Sparkles size={16} className="text-accent" />
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
				</header>

				{loading ? (
					<LoadingState />
				) : (
					<div className="max-w-2xl slide-in slide-in-delay-1 flex flex-col gap-5">
						{/* The draft caveat sits above the box it qualifies —
						    it is a fact about what this control produces, so it is read
						    before the control is used rather than after. */}
						<DraftNotice words={words} />

						<div className="flex flex-col gap-2">
							<label
								className="text-sm font-medium text-text-muted"
								htmlFor="deck-prompt"
							>
								{words.promptLabel}
							</label>
							<textarea
								id="deck-prompt"
								className="input min-h-36 resize-y leading-relaxed"
								placeholder={words.promptPlaceholder}
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
								disabled={generating}
								aria-describedby="deck-prompt-count"
							/>
							<div
								id="deck-prompt-count"
								className={`text-xs font-mono ${overLength ? "text-error" : "text-text-dim"}`}
							>
								{fillText(words.promptCount, {
									count: trimmed.length,
									limit: promptMaxLength,
								})}
							</div>
						</div>

						{/* Always drawn, disabled with its reason: on a server
						    with no provider configured the reason is the whole message,
						    and a hidden button would read as a missing feature. */}
						<div className="flex flex-col gap-2">
							<button
								type="button"
								className="btn-primary px-6 py-3 inline-flex items-center justify-center gap-2 self-start disabled:opacity-50 disabled:cursor-not-allowed"
								onClick={handleGenerate}
								disabled={blocked !== null}
								title={blocked ?? words.generateTitle}
							>
								<Sparkles size={18} />
								{generating ? words.generating : words.generate}
							</button>
							{blocked && (
								<p className="text-sm text-text-dim max-w-xl">{blocked}</p>
							)}
							{/* Generating creates a deck — the same contract the blank
							    editor's Create concludes (REQ183). */}
							<LegalNotice
								action={text.legalNotice.generatingDraft}
								wording={text.legalNotice}
								className="max-w-xl"
							/>
						</div>

						{availability && availability.available && (
							<SlideTypesOffered types={availability.slideTypes} text={text} />
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * The draft caveat — the one sentence this page has to land, and the reason it
 * is drawn beside the result rather than buried in a tooltip: what comes back
 * is a draft, and the one thing a draft cannot be trusted about is which answer
 * is right.
 */
function DraftNotice({ words }: { words: InterfaceText["generate"] }) {
	return (
		<div className="flex items-start gap-3 p-4 rounded-xl bg-surface-raised border border-border">
			<AlertTriangle size={18} className="text-accent flex-shrink-0 mt-0.5" />
			<p className="text-sm text-text-muted">{words.draftNotice}</p>
		</div>
	);
}

/**
 * What the generator may reach for, drawn with the same icons the rest of the
 * product names a slide type by (`SlideTypeIcon`) — so "what will I
 * get?" is answered before the wait rather than after it. The set is the
 * server's own report, never a second list kept here.
 */
function SlideTypesOffered({
	types,
	text,
}: {
	types: GeneratedSlideType[];
	text: InterfaceText;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2 text-sm text-text-dim">
			<span className="font-mono text-xs">{text.generate.mayUse}</span>
			<span className="flex flex-wrap items-center gap-1.5">
				{types.map((type) => (
					<SlideTypeIcon
						key={type}
						type={type}
						labels={text.slideView.slideTypes}
					/>
				))}
			</span>
		</div>
	);
}
