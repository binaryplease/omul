import { GitMerge } from "lucide-react";
import { useState } from "react";
import { useInterfaceText } from "../interface-language";
import {
	ENGLISH_INTERFACE_TEXT,
	fillText,
	type InterfaceText,
	pluralText,
} from "../interface-text";
import type {
	DeckMergeChoices,
	DeckMergeSide,
	DeckOverlap,
} from "../store/deckMerge";
import type { Slide } from "../types";
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
function slideName(slide: Slide, text: InterfaceText): string {
	return (
		slideTextToPlain(slide.question ?? "") ||
		text.editor.slideTypeNames[slide.type]
	);
}

/** A deck setting's value in words, or nothing for one that has none short enough. */
function settingValue(
	value: unknown,
	wording: InterfaceText["deckMerge"],
): string | undefined {
	if (typeof value === "boolean") return value ? wording.valueOn : wording.valueOff;
	if (value === null) return wording.valueAutomatic;
	if (typeof value === "string") return value.trim() ? value : wording.valueEmpty;
	return undefined;
}

/** The heading of one overlap: which thing both people changed. */
export function overlapHeading(
	overlap: DeckOverlap,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): string {
	const wording = text.deckMerge;
	if (overlap.kind === "field") return wording.fieldNames[overlap.field];
	if (overlap.kind === "order") return wording.slideOrder;
	const slide = overlap.theirs ?? overlap.mine;
	return slide
		? fillText(wording.slideNamed, { name: slideName(slide, text) })
		: wording.slide;
}

/** The two versions of one overlap, as the choice between them. */
export function overlapOptions(
	overlap: DeckOverlap,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
): ChoiceOption<DeckMergeSide>[] {
	const wording = text.deckMerge;
	if (overlap.kind === "order") {
		return [
			{ value: "mine", label: wording.keepMyOrder },
			{ value: "theirs", label: wording.keepCurrentOrder },
		];
	}
	if (overlap.kind === "slide") {
		const describe = (slide: Slide | null) =>
			slide
				? fillText(wording.slideEdited, { name: slideName(slide, text) })
				: wording.slideDeleted;
		return [
			{
				value: "mine",
				label: wording.keepMine,
				description: describe(overlap.mine),
			},
			{
				value: "theirs",
				label: wording.keepCurrentOne,
				description: describe(overlap.theirs),
			},
		];
	}
	return [
		{
			value: "mine",
			label: wording.keepMine,
			description: settingValue(overlap.mine, wording),
		},
		{
			value: "theirs",
			label: wording.keepCurrentOne,
			description: settingValue(overlap.theirs, wording),
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
	const { text, language } = useInterfaceText();
	const wording = text.deckMerge;
	const remaining = overlaps.filter((overlap) => !choices[overlap.key]).length;
	const blockedReason =
		remaining > 0
			? pluralText(language, remaining, wording.chooseRemaining)
			: saving
				? wording.saving
				: null;
	return (
		// The dialog is portaled out of the editor's regions, so it declares the
		// interface language it is written in (REQ248).
		<div lang={language}>
			<Modal title={wording.title} icon={GitMerge} onClose={onCancel}>
				<p className="mb-4 text-sm text-text-muted">
					{pluralText(language, overlaps.length, wording.intro)}
				</p>
				<div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
					{overlaps.map((overlap) => (
						<section key={overlap.key} className="space-y-2">
							<h4 className="text-sm font-semibold">{overlapHeading(overlap, text)}</h4>
							<ChoiceCards<DeckMergeSide | "undecided">
								value={choices[overlap.key] ?? "undecided"}
								onChange={(side) =>
									setChoices((previous) => ({
										...previous,
										[overlap.key]: side as DeckMergeSide,
									}))
								}
								options={overlapOptions(overlap, text)}
								ariaLabel={overlapHeading(overlap, text)}
								columns={2}
							/>
						</section>
					))}
				</div>
				<div className="mt-6 flex flex-wrap items-center justify-end gap-3">
					{blockedReason && (
						<p
							id="deck-merge-blocked"
							className="mr-auto grow basis-32 text-xs text-text-muted"
						>
							{blockedReason}
						</p>
					)}
					<button type="button" className="btn-secondary text-sm" onClick={onCancel}>
						{wording.cancel}
					</button>
					<button
						type="button"
						className="btn-primary text-sm"
						disabled={blockedReason !== null}
						aria-describedby={blockedReason ? "deck-merge-blocked" : undefined}
						onClick={() => onSave(choices)}
					>
						{wording.save}
					</button>
				</div>
			</Modal>
		</div>
	);
}
