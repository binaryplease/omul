import { GitMerge } from "lucide-react";
import { useState } from "react";
import {
	DECK_FIELD_LABELS,
	type DeckMergeChoices,
	type DeckMergeSide,
	type DeckOverlap,
} from "../store/deckMerge";
import type { Slide } from "../types";
import { SLIDE_TYPE_LABELS } from "../types";
import { ChoiceCards, type ChoiceOption } from "./EditorControls";
import { slideTextToPlain } from "./SlideText";
import { Modal } from "./ui/Modal";

// ── Resolving a refused save (REQ126) ────────────────────────
//
// What the editor shows when a Save was refused because someone else saved the
// deck first *and* both of them changed the same thing. Everything else has
// already been carried over by the merge (`src/store/deckMerge.ts`); this lists
// only the overlaps, one choice each, and saves nothing until every one has
// been made. Cancelling leaves the person's edits on screen, unsaved.

/** What the person calls a slide — the rail's gist, or its type. */
function slideName(slide: Slide): string {
	return slideTextToPlain(slide.question ?? "") || SLIDE_TYPE_LABELS[slide.type];
}

/** A deck setting's value in words, or nothing for one that has none short enough. */
function settingValue(value: unknown): string | undefined {
	if (typeof value === "boolean") return value ? "On" : "Off";
	if (value === null) return "Automatic";
	if (typeof value === "string") return value.trim() ? value : "Empty";
	return undefined;
}

/** The heading of one overlap: which thing both people changed. */
export function overlapHeading(overlap: DeckOverlap): string {
	if (overlap.kind === "field") return DECK_FIELD_LABELS[overlap.field];
	if (overlap.kind === "order") return "Slide order";
	const slide = overlap.theirs ?? overlap.mine;
	return slide ? `Slide: ${slideName(slide)}` : "Slide";
}

/** The two versions of one overlap, as the choice between them. */
export function overlapOptions(
	overlap: DeckOverlap,
): ChoiceOption<DeckMergeSide>[] {
	if (overlap.kind === "order") {
		return [
			{ value: "mine", label: "Keep my order" },
			{ value: "theirs", label: "Keep the current order" },
		];
	}
	if (overlap.kind === "slide") {
		const describe = (slide: Slide | null) =>
			slide ? `Edited: ${slideName(slide)}` : "Deleted";
		return [
			{ value: "mine", label: "Keep mine", description: describe(overlap.mine) },
			{
				value: "theirs",
				label: "Keep the current one",
				description: describe(overlap.theirs),
			},
		];
	}
	return [
		{ value: "mine", label: "Keep mine", description: settingValue(overlap.mine) },
		{
			value: "theirs",
			label: "Keep the current one",
			description: settingValue(overlap.theirs),
		},
	];
}

export function DeckMergeDialog({
	overlaps,
	saving,
	onSave,
	onCancel,
}: {
	overlaps: DeckOverlap[];
	saving: boolean;
	onSave: (choices: DeckMergeChoices) => void;
	onCancel: () => void;
}) {
	const [choices, setChoices] = useState<DeckMergeChoices>({});
	const remaining = overlaps.filter((overlap) => !choices[overlap.key]).length;
	const blockedReason =
		remaining > 0
			? `Choose a version for ${remaining === 1 ? "the change" : `all ${remaining} changes`} above to save.`
			: saving
				? "Saving…"
				: null;
	return (
		<Modal title="Someone else saved this deck" icon={GitMerge} onClose={onCancel}>
			<p className="mb-4 text-sm text-text-muted">
				Everything only one of you changed is kept. You both changed the{" "}
				{overlaps.length === 1 ? "thing" : "things"} below — choose which
				version to keep.
			</p>
			<div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
				{overlaps.map((overlap) => (
					<section key={overlap.key} className="space-y-2">
						<h4 className="text-sm font-semibold">{overlapHeading(overlap)}</h4>
						<ChoiceCards<DeckMergeSide | "undecided">
							value={choices[overlap.key] ?? "undecided"}
							onChange={(side) =>
								setChoices((previous) => ({
									...previous,
									[overlap.key]: side as DeckMergeSide,
								}))
							}
							options={overlapOptions(overlap)}
							ariaLabel={overlapHeading(overlap)}
							columns={2}
						/>
					</section>
				))}
			</div>
			<div className="mt-6 flex items-center justify-end gap-3">
				{blockedReason && (
					<p id="deck-merge-blocked" className="mr-auto text-xs text-text-muted">
						{blockedReason}
					</p>
				)}
				<button type="button" className="btn-secondary text-sm" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					className="btn-primary text-sm"
					disabled={blockedReason !== null}
					aria-describedby={blockedReason ? "deck-merge-blocked" : undefined}
					onClick={() => onSave(choices)}
				>
					Save
				</button>
			</div>
		</Modal>
	);
}
