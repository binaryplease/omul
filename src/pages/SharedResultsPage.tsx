import { Eye, Link2Off } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, clearResultsToken, getResultsToken } from "../api";
import { DeckMark, DeckThemeScope } from "../components/DeckTheme";
import { ResultsDisplay } from "../components/Results";
import { SegmentedResults } from "../components/SegmentedResults";
import { SlideAppearanceScope } from "../components/SlideAppearance";
import { SlideText } from "../components/SlideText";
import { SlideTypeIcon } from "../components/SlideTypeIcon";
import { LoadingState } from "../components/ui/Loading";
import { StatusBadge } from "../components/ui/StatusBadge";
import { usePageTitle } from "../router";
import type { Presentation, Slide } from "../types";
import { slideHasResults, slideTextSizeFor } from "../types";

// ── The shared results page (REQ098) ──────────────────────────
//
// What a results link opens: every slide's tally, and nothing else. No
// navigation, no reveal control, no reset, no export, no Q&A queue, no chat, no
// vote — not disabled versions of them either (ADR-0025 is about a control whose
// action is *currently* unavailable; these are not this page's controls at all,
// and drawing a greyed-out "End presentation" for a stakeholder reading a
// summary would be inventing an affordance to take away). The page is a read,
// and the only thing it can do is re-read.
//
// It is deliberately reachable **without** a link, too: the URL is just the
// deck's results, and a visitor with no token reads exactly what the public
// results endpoint publishes — which under `instant` is the whole tally and
// under `private` is nothing. What the link changes is the reveal-mode gate, and
// that is the one thing it changes.

/** How often the page re-reads the tallies while it is open. */
const RESULTS_POLL_MS = 5000;

/** One slide as this page draws it: what was asked, and what it came to. */
type ResultsRow = {
	slideId: string;
	question: string;
	results: any;
};

/**
 * What the page is showing right now. Separated from the row data because
 * "the link is gone" is not an empty deck and must not be drawn as one.
 */
export type SharedResultsState =
	| { kind: "loading" }
	| { kind: "revoked" }
	| { kind: "missing" }
	| { kind: "failed"; message: string }
	| { kind: "ready"; deck: Presentation; rows: ResultsRow[] };

/**
 * Read a failed results fetch into the state the page draws.
 *
 * Pure, and separate from the fetch, because the distinction it draws is the
 * whole honesty of this surface: a revoked link and a deck whose numbers are
 * simply private look identical in the payload (withheld markers all the way
 * down), so the server refuses the revoked one outright and this is where that
 * refusal is turned into words rather than into an empty page.
 */
export function readSharedResultsFailure(error: unknown): SharedResultsState {
	const message = error instanceof Error ? error.message : "Unknown error";
	if (message === "This results link is no longer valid") {
		return { kind: "revoked" };
	}
	if (message === "Not found") return { kind: "missing" };
	return { kind: "failed", message };
}

/**
 * The slides this page lists: the ones that have an aggregate at all
 * (`slideHasResults`), so a title card or a video does not appear as a question
 * nobody answered. A slide type that gains a tally later is included without
 * this being edited.
 */
export function sharedResultsSlides(deck: Presentation): Slide[] {
	return deck.slides.filter((slide) => slideHasResults(slide.type as any));
}

export function SharedResultsPage({ id }: { id: string }) {
	const [state, setState] = useState<SharedResultsState>({ kind: "loading" });
	/**
	 * How many times this page has re-read the deck. Handed to every open
	 * breakdown (REQ116) so a segmented view refreshes on the same beat as the
	 * chart above it, rather than each one keeping a clock of its own.
	 */
	const [pollTick, setPollTick] = useState(0);
	/**
	 * Whether this browser is reading through a link at all. Read once per render
	 * pass rather than stored, since the only thing that changes it — the fragment
	 * consumer in `App.tsx` — has already run by the time this mounts.
	 */
	const holdsLink = Boolean(getResultsToken(id));

	const load = useCallback(async () => {
		try {
			const [deck, rows] = await Promise.all([
				api.getPresentation(id),
				api.getSharedResults(id),
			]);
			setState({ kind: "ready", deck, rows });
			setPollTick((tick) => tick + 1);
		} catch (loadError: unknown) {
			const failure = readSharedResultsFailure(loadError);
			// A refused link is a dead credential, so it goes: keeping it would make
			// every later reload ask the same refused question, and the honest state
			// of this browser is that it no longer holds a way in.
			if (failure.kind === "revoked") clearResultsToken(id);
			setState(failure);
		}
	}, [id]);

	// Initial read, then a poll — a session's numbers move while somebody is
	// looking at them, and this page has no socket of its own: the WebSocket
	// carries room events to participants and presenters, and a results link is
	// neither. Re-reading is also what makes a revocation land here rather than
	// only on the next visit.
	useEffect(() => {
		load();
		const interval = setInterval(load, RESULTS_POLL_MS);
		return () => clearInterval(interval);
	}, [load]);

	const deck = state.kind === "ready" ? state.deck : null;
	usePageTitle(deck ? `${deck.title} — Results` : "Results");

	const themed = (screen: React.ReactNode) => (
		<DeckThemeScope deck={deck}>
			<div className="min-h-screen w-full bg-void bg-grid bg-noise">{screen}</div>
		</DeckThemeScope>
	);

	if (state.kind === "loading") {
		return themed(
			<div className="min-h-screen flex items-center justify-center">
				<LoadingState />
			</div>,
		);
	}

	if (state.kind !== "ready") {
		return themed(
			<div className="min-h-screen flex items-center justify-center p-6">
				<div className="max-w-md text-center flex flex-col items-center gap-3">
					<Link2Off size={28} className="text-text-dim" />
					<h1 className="text-lg font-semibold">
						{state.kind === "revoked"
							? "This results link is no longer valid"
							: state.kind === "missing"
								? "These results are not available"
								: "The results could not be loaded"}
					</h1>
					<p className="text-sm text-text-muted">
						{state.kind === "revoked"
							? "The organizer has withdrawn it, or replaced it with a newer one. Ask them for the current link."
							: state.kind === "missing"
								? "The presentation behind this link has been deleted."
								: state.message}
					</p>
				</div>
			</div>,
		);
	}

	const slides = sharedResultsSlides(state.deck);
	const tallies = new Map(state.rows.map((row) => [row.slideId, row.results]));

	return themed(
		<div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8">
			<header className="flex flex-col gap-3 border-b border-border pb-6">
				<div className="flex items-center gap-3">
					<DeckMark deck={state.deck} size="md" fallback="none" />
					<h1 className="text-2xl sm:text-3xl font-bold">{state.deck.title}</h1>
					<StatusBadge status={state.deck.status} />
				</div>
				{/* What this page is, said out loud. A recipient who was handed a URL
				    with no covering note should be able to tell from the page itself
				    that they are looking at a read-only view and that it is not a way
				    into the deck. */}
				<p className="flex items-start gap-2 text-sm text-text-muted">
					<Eye size={15} className="shrink-0 mt-0.5" />
					{holdsLink
						? "Results, shared read-only. This link shows the numbers and grants nothing else — it cannot change the presentation, and the organizer can withdraw it at any time."
						: "Results, as this presentation publishes them. Slides whose organizer has kept their numbers back are not shown here."}
				</p>
			</header>

			{slides.length === 0 ? (
				<p className="text-text-dim py-16 text-center">
					This presentation has no slides that collect answers.
				</p>
			) : (
				slides.map((slide, index) => {
					const results = tallies.get(slide.id as string) ?? null;
					return (
						/* The slide's own colours (REQ019/REQ070) — a chart the room was
						   shown in green is read back in green here, or the shared page
						   would be a different reading of the same slide. */
						<SlideAppearanceScope key={slide.id} deck={deck} slide={slide}>
							<section className="rounded-2xl border border-border bg-surface/50 p-5 sm:p-8 flex flex-col gap-5">
								<div className="flex items-start gap-3">
									<span className="font-mono text-xs text-text-dim mt-1.5">
										{index + 1}
									</span>
									<span className="text-text-muted mt-0.5">
										<SlideTypeIcon type={slide.type as any} />
									</span>
									<h2 className="text-lg sm:text-xl font-semibold flex-1">
										<SlideText
											text={slide.question ?? ""}
											size={slideTextSizeFor(slide as any)}
											variant="inline"
										/>
									</h2>
								</div>
								{results ? (
									<>
										<ResultsDisplay slide={slide} results={results} />
										{/* REQ020/REQ116 — the same tally, split by what these
										    people answered earlier in the deck. Under the chart
										    it re-draws, because that is what it changes
										    (ADR-0031), and only where there is a chart: a slide
										    whose numbers this reader cannot see has nothing to
										    break down, and the sentence below says so already. */}
										<SegmentedResults
											presentationId={id}
											slide={slide}
											slides={state.deck.slides as Slide[]}
											pollTick={pollTick}
										/>
									</>
								) : (
									/* Withheld, not empty — the same distinction the API draws
									   (REQ016/REQ017), and a slide with no answers still draws its
									   own empty tally above rather than landing here. A visitor
									   reading without a link meets this on every slide the deck
									   keeps back; a link holder does not meet it at all, because
									   lifting that gate is what the link is. */
									<p className="text-text-dim text-sm">
										The organizer has not published this slide's results.
									</p>
								)}
							</section>
						</SlideAppearanceScope>
					);
				})
			)}
		</div>,
	);
}
