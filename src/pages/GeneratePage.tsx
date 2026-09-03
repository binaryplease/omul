import { AlertTriangle, ChevronLeft, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../auth-client";
import { SlideTypeIcon } from "../components/SlideTypeIcon";
import { LoadingState } from "../components/ui/Loading";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
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

/** What the box suggests when the organizer has typed nothing yet. */
const PROMPT_PLACEHOLDER =
	"A 30-minute retrospective for a team of eight that just shipped a rough release — how it went, what to keep, what to change.";

/**
 * The one sentence this page has to land, and the reason it is drawn beside the
 * result rather than buried in a tooltip: what comes back is a draft, and the
 * one thing a draft cannot be trusted about is which answer is right.
 */
const DRAFT_NOTICE =
	"Everything it writes is a starting point — read it before you run it. No answer comes back marked correct, so mark the answer key yourself on any quiz or knowledge-check slide.";

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

	usePageTitle("Generate a deck");

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
		if (loadError) {
			return `Could not ask this server whether it can generate: ${loadError}`;
		}
		if (availability && !availability.available) return availability.reason;
		if (needsSignIn) {
			return "Sign in to generate a deck — this server only drafts for account holders.";
		}
		if (generating) return "Drafting your deck — this takes a few seconds.";
		if (trimmed === "") return "Describe the session you want first.";
		if (overLength) {
			return `That brief is ${trimmed.length} characters; the limit is ${promptMaxLength}.`;
		}
		return null;
	};

	const blocked = blockedReason();

	const handleGenerate = async () => {
		if (blocked || generating) return;
		setGenerating(true);
		try {
			const created = await api.generatePresentation({ prompt: trimmed });
			addToast(`Drafted “${created.title}” — review it before you run it`, "success");
			go({ page: "edit", id: created.id });
		} catch (generateError: unknown) {
			addToast(
				generateError instanceof Error
					? generateError.message
					: "Could not generate a deck from that prompt",
				"error",
			);
		} finally {
			setGenerating(false);
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
						<Sparkles size={16} className="text-accent" />
						<span className="font-mono text-sm text-text-muted tracking-wider uppercase">
							generate
						</span>
					</div>
					<h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
						Describe the session, get a{" "}
						<span className="text-accent-text">draft deck</span>
					</h1>
					<p className="text-text-muted max-w-xl">
						Say what the session is for and who is in the room. You get a full
						deck you own from the moment it lands — the slides are yours to
						edit, reorder or throw away.
					</p>
				</header>

				{loading ? (
					<LoadingState />
				) : (
					<div className="max-w-2xl slide-in slide-in-delay-1 flex flex-col gap-5">
						{/* The draft caveat sits above the box it qualifies —
						    it is a fact about what this control produces, so it is read
						    before the control is used rather than after. */}
						<DraftNotice />

						<div className="flex flex-col gap-2">
							<label
								className="text-sm font-medium text-text-muted"
								htmlFor="deck-prompt"
							>
								What is the session for?
							</label>
							<textarea
								id="deck-prompt"
								className="input min-h-36 resize-y leading-relaxed"
								placeholder={PROMPT_PLACEHOLDER}
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
								disabled={generating}
								aria-describedby="deck-prompt-count"
							/>
							<div
								id="deck-prompt-count"
								className={`text-xs font-mono ${overLength ? "text-error" : "text-text-dim"}`}
							>
								{trimmed.length} / {promptMaxLength}
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
								title={blocked ?? "Draft a deck from this brief"}
							>
								<Sparkles size={18} />
								{generating ? "Drafting…" : "Generate draft deck"}
							</button>
							{blocked && (
								<p className="text-sm text-text-dim max-w-xl">{blocked}</p>
							)}
						</div>

						{availability && availability.available && (
							<SlideTypesOffered types={availability.slideTypes} />
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/** The draft caveat, stated where it applies rather than after the fact. */
function DraftNotice() {
	return (
		<div className="flex items-start gap-3 p-4 rounded-xl bg-surface-raised border border-border">
			<AlertTriangle size={18} className="text-accent flex-shrink-0 mt-0.5" />
			<p className="text-sm text-text-muted">{DRAFT_NOTICE}</p>
		</div>
	);
}

/**
 * What the generator may reach for, drawn with the same icons the rest of the
 * product names a slide type by (`SlideTypeIcon`) — so "what will I
 * get?" is answered before the wait rather than after it. The set is the
 * server's own report, never a second list kept here.
 */
function SlideTypesOffered({ types }: { types: GeneratedSlideType[] }) {
	return (
		<div className="flex flex-wrap items-center gap-2 text-sm text-text-dim">
			<span className="font-mono text-xs">it may use</span>
			<span className="flex flex-wrap items-center gap-1.5">
				{types.map((type) => (
					<SlideTypeIcon key={type} type={type} />
				))}
			</span>
		</div>
	);
}
