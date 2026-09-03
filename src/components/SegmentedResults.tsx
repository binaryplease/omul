import { Group, Lock, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Slide } from "../types";
import { segmentSourcesFor, SLIDE_TYPE_LABELS } from "../types";
import { type ChoiceOption, ChoiceCards } from "./EditorControls";
import { ResultsDisplay } from "./Results";

// ── Segmented results (REQ020, REQ116) ────────────────────────
//
// The read side of the join: a slide's tally, drawn once per group of the room
// as an earlier slide's answers divide it. "What did the people who picked
// Alpha say to this?" — asked on the results surface, of any slide there, and
// answered by the same server aggregation the chart above it came from.
//
// Three things this surface does not do, each on purpose:
//
//  - **It does not decide which slides can group which.** That is one
//    descriptor, `segmentSourcesFor`, shared with the endpoint that enforces it.
//   A picker with its own idea of eligibility would offer
//    groupings the API refuses.
//  - **It does not draw a second kind of chart.** Every group is rendered by
//    `ResultsDisplay`, the component the unsegmented tally uses, so a word cloud
//    stays a word cloud and a grid stays a grid inside a breakdown (the unit of
//    sharing is the invariant, and the invariant here is "a slide's results,
//    drawn").
//  - **It does not hide a grouping it cannot offer.** An earlier slide that
//    cannot divide the room is drawn disabled with the reason the server would
//    have given, and a deck with nothing earlier to group by says so
//    on the control rather than dropping it.
//
// It sits inside the slide's own section, under that slide's chart, because
// that is what it changes.

/** The value the picker carries when no breakdown is asked for. */
export const NO_SEGMENT = "";

/** What "do not break this down" is called, and what it means: the room, whole. */
export const NO_SEGMENT_LABEL = "Everyone";

/** Why the picker is inert on a slide with nothing before it to group by. */
export const NO_SOURCES_REASON =
	"Nothing earlier in this deck collects answers these results could be grouped by.";

/**
 * The picker's entries: the room whole, then every earlier slide, the ones that
 * cannot group it included and marked.
 *
 * Pure — data in, descriptors out — so what a reader is offered, and what they
 * are told about what they are not offered, is assertable without a DOM.
 */
export function segmentPickerOptions(
	slides: Slide[],
	targetSlideId: string,
): ChoiceOption<string>[] {
	const sources = segmentSourcesFor(slides, targetSlideId);
	return [
		{
			value: NO_SEGMENT,
			label: NO_SEGMENT_LABEL,
			// The one entry that is disabled by the *absence* of the others: with no
			// earlier slide to group by there is nothing to switch away to, and a
			// control that silently offered a single choice would read as broken.
			disabled: sources.length === 0,
			disabledReason: sources.length === 0 ? NO_SOURCES_REASON : undefined,
		},
		...sources.map((source) => ({
			value: source.slideId,
			label: `${source.position}. ${
				source.question.trim().length > 0
					? source.question.trim()
					: SLIDE_TYPE_LABELS[source.type]
			}`,
			disabled: source.refusal !== null,
			// The server's own sentence, carried rather than re-worded.
			disabledReason: source.reason ?? undefined,
		})),
	];
}

/** One group as this surface draws it. */
export type SegmentRow = {
	key: string | null;
	label: string;
	/** How many people answered, or `null` where the group is held back — the count goes with the answers. */
	respondentCount: number | null;
	/** The group's tally, or `null` where the group is held back. */
	results: any;
	suppressed: boolean;
};

/** A whole breakdown, read defensively out of the payload. */
export type SegmentedView = {
	/** The whole breakdown is kept from this reader. */
	withheld: boolean;
	/** Which of the two reasons it is, or `null` when it is not withheld. */
	withheldReason: "reveal-mode" | "identifiable" | null;
	/** How many people a group needs before its answers are published. */
	minRespondents: number;
	segments: SegmentRow[];
};

/**
 * Read the endpoint's payload into rows.
 *
 * Every field defaulted at the read site, for the reason `readLeaderboard` does
 * it: this surface polls, and a payload in flight while the deck is being edited
 * underneath must degrade to "no groups" rather than to a crash inside a chart.
 */
export function readSegments(payload: any): SegmentedView {
	const segments = Array.isArray(payload?.segments) ? payload.segments : [];
	return {
		withheld: payload?.withheld === true,
		withheldReason:
			payload?.withheldReason === "reveal-mode" ||
			payload?.withheldReason === "identifiable"
				? payload.withheldReason
				: null,
		minRespondents:
			typeof payload?.minRespondents === "number" ? payload.minRespondents : 0,
		segments: segments.map((segment: any) => ({
			key: typeof segment?.key === "string" ? segment.key : null,
			label: typeof segment?.label === "string" ? segment.label : "",
			// `null` is a value here, not a missing number: a held-back group reports
			// that it is held back and nothing else, so a `0` default would put a
			// head count on screen the server deliberately did not send.
			respondentCount:
				typeof segment?.respondentCount === "number"
					? segment.respondentCount
					: null,
			results: segment?.results ?? null,
			suppressed: segment?.suppressed === true,
		})),
	};
}

/**
 * How many people a group holds, in words rather than a bare number — or nothing
 * at all for a group whose count was not sent.
 */
export function segmentCountLabel(respondentCount: number | null): string | null {
	if (respondentCount === null) return null;
	return respondentCount === 1 ? "1 answered" : `${respondentCount} answered`;
}

/**
 * Why a group's answers are not on screen — the sentence, not a blank panel.
 *
 * It has to cover **two** cases in one breath, because a reader cannot tell them
 * apart and should not have to: the group that was too small to publish, and the
 * group held back beside it so that the small one could not simply be subtracted
 * out of the chart above. Naming only the first would tell a reader with a group
 * of nine that nine is fewer than five.
 */
export function segmentSuppressedReason(minRespondents: number): string {
	return `Not published. A group of fewer than ${minRespondents} people would name the people in it, and groups are held back at least two at a time so the missing answers cannot be worked out by subtracting the rest — so this one is held back too. The organizer reads every group in full.`;
}

/** Why a whole breakdown is not on screen — one sentence per reason. */
export function segmentedWithheldReason(
	withheldReason: SegmentedView["withheldReason"],
): string {
	if (withheldReason === "identifiable") {
		// Not a reveal-mode decision and must not read like one: no group size makes
		// a list of what individual people wrote anonymous, so this breakdown is the
		// organizer's alone whatever the deck publishes.
		return "This slide's results list what each person answered, and no group is small enough — or large enough — to make that anonymous. Only the organizer can break these results down.";
	}
	return "This breakdown is not published — the organizer has kept one of the two slides' results back.";
}

/**
 * The breakdown control and, once a grouping is picked, the groups themselves.
 *
 * Polls with the surface around it rather than on a clock of its own: `pollTick`
 * is bumped by the page each time it re-reads the deck's tallies, so an open
 * breakdown moves with the numbers above it instead of drifting a few seconds
 * behind them.
 */
export function SegmentedResults({
	presentationId,
	slide,
	slides,
	pollTick = 0,
}: {
	presentationId: string;
	slide: Slide;
	/** The whole deck, in order — what "an earlier slide" is resolved against. */
	slides: Slide[];
	pollTick?: number;
}) {
	const [segmentBy, setSegmentBy] = useState<string>(NO_SEGMENT);
	const [view, setView] = useState<SegmentedView | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const slideId = String(slide.id ?? "");
	const options = segmentPickerOptions(slides, slideId);

	useEffect(() => {
		if (segmentBy === NO_SEGMENT) {
			setView(null);
			setFailure(null);
			return;
		}
		let live = true;
		api
			.getSegmentedResults(presentationId, slideId, segmentBy)
			.then((payload) => {
				if (!live) return;
				setView(readSegments(payload));
				setFailure(null);
			})
			.catch((error: unknown) => {
				if (!live) return;
				setView(null);
				setFailure(error instanceof Error ? error.message : "Unknown error");
			});
		return () => {
			live = false;
		};
	}, [presentationId, slideId, segmentBy, pollTick]);

	return (
		<div className="flex flex-col gap-3 border-t border-border pt-5">
			<div className="flex items-center gap-2">
				<Group size={15} className="text-text-muted" />
				<span className="text-sm text-text-muted">Break these results down by</span>
			</div>
			<ChoiceCards
				value={segmentBy}
				onChange={setSegmentBy}
				options={options}
				ariaLabel="Break these results down by an earlier slide's answers"
				variant="tile"
				columns={2}
			/>
			{failure && <p className="text-sm text-text-muted">{failure}</p>}
			{view?.withheld && (
				/* Two reasons a whole breakdown can be missing, and the server says
				   which: the organizer keeping one of the two slides' results back
				   (their group labels and counts *are* that slide's tally under
				   another name), or a slide whose tally names individual people. */
				<p className="text-sm text-text-muted">
					{segmentedWithheldReason(view.withheldReason)}
				</p>
			)}
			{view && !view.withheld && (
				<div className="grid gap-4 sm:grid-cols-2">
					{view.segments.map((segment) => (
						<section
							key={segment.key ?? "unanswered"}
							className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4"
						>
							<header className="flex items-baseline justify-between gap-3">
								<h3 className="min-w-0 truncate text-sm font-semibold">
									{segment.label}
								</h3>
								{/* No chip at all where the count was not sent: a held-back
								    group's head count is a fact about the people in it, and
								    drawing a placeholder for it would only invite the reader
								    to guess what it stood for. */}
								{segmentCountLabel(segment.respondentCount) && (
									<span className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
										<Users size={13} />
										{segmentCountLabel(segment.respondentCount)}
									</span>
								)}
							</header>
							{segment.suppressed ? (
								<p className="flex items-start gap-2 text-sm text-text-muted">
									<Lock size={14} className="mt-0.5 shrink-0" />
									{segmentSuppressedReason(view.minRespondents)}
								</p>
							) : (
								<ResultsDisplay slide={slide} results={segment.results} />
							)}
						</section>
					))}
				</div>
			)}
		</div>
	);
}
