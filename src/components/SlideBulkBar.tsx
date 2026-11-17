import { ChevronDown, ChevronUp, Copy, SkipForward, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useInterfaceText } from "../interface-language";
import {
	ENGLISH_INTERFACE_TEXT,
	fillText,
	type InterfaceLanguage,
	interfaceTextFor,
	pluralText,
} from "../interface-text";
import { SLIDE_LIMIT, type Slide } from "../types";
import { ICON_BUTTON_HOVER } from "./ShareCluster";
import { ConfirmModal } from "./ui/ConfirmModal";
import { ReasonButton } from "./ui/ReasonTip";

// ── Bulk slide operations (editor rail) ──────────────────────────────
//
// REQ127. The editor's single-slide cursor (`selected` on the page) chooses what
// the canvas and the settings column show; this is a second, independent
// selection — a set of slides ticked in the rail — and the bar that acts on all
// of them at once. It sits at the head of the slide list it governs (ADR-0031),
// and every control in it is drawn whether or not anything is selected,
// disabled with its reason (ADR-0025). Each control calls one editor-store
// action, which is one reducer operation, so nothing is ever half applied.

/**
 * Why no delete may take the last slide away — worded once for the rail's bulk
 * delete and the editor's single-slide delete, which refuse for the same rule.
 */
export const SLIDE_REMOVAL_FLOOR_REASON =
	ENGLISH_INTERFACE_TEXT.editor.slideRemovalFloor;

/** "1 slide" / "3 slides" — the one count the bar's wording is built from. */
export function slideCountLabel(
	count: number,
	language: InterfaceLanguage = "en",
): string {
	return pluralText(language, count, interfaceTextFor(language).editor.slideCount);
}

/**
 * What the bulk skip control will do to the selection (REQ127/REQ110): a
 * selection with any slide still on the way through is skipped as a whole, and
 * only one that is already all skipped is included again — so a mixed selection
 * goes the way the single-slide toggle's pressed state would, and the result is
 * always one state for every slide.
 */
export function slideBulkSkipIntent(selection: readonly Slide[]): boolean {
	return selection.some((slide) => !slide.skipped);
}

/**
 * Which slide the editor's cursor should stand on once `removedIds` are gone: the
 * slide it is on if that survives, else the nearest survivor after it, else the
 * nearest before it — so the cursor lands where the author was looking rather
 * than jumping to the top. `null` only when nothing would survive, which the
 * reducer refuses anyway.
 */
export function cursorSlideAfterRemoval(
	slides: readonly Slide[],
	removedIds: readonly string[],
	cursorIndex: number,
): string | null {
	const removing = new Set(removedIds);
	const survives = (slide: Slide) => !removing.has(slide.id);
	const after = slides.slice(cursorIndex).find(survives);
	const before = slides.slice(0, cursorIndex).reverse().find(survives);
	return (after ?? before)?.id ?? null;
}

/** The per-slide tick in the rail, beside the thumbnail it selects. */
export function SlideSelectCheckbox({
	index,
	checked,
	revealed,
	onToggle,
}: {
	index: number;
	checked: boolean;
	/** Drawn at rest once anything is selected; until then on hover and focus. */
	revealed: boolean;
	onToggle: () => void;
}) {
	const { editor } = useInterfaceText().text;
	return (
		<input
			type="checkbox"
			checked={checked}
			onChange={onToggle}
			aria-label={fillText(editor.selectSlide, { number: index + 1 })}
			title={editor.selectSlideTitle}
			className={`absolute right-3 bottom-3 h-4 w-4 cursor-pointer accent-accent transition-opacity ${
				revealed || checked
					? ""
					: "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
			}`}
		/>
	);
}

/**
 * One icon control in the bar. An unavailable one stays focusable and shows
 * its reason on hover, focus or tap (`ReasonButton`), never only in a name a
 * sighted user cannot see.
 */
function BulkButton({
	label,
	reason,
	pressed,
	danger = false,
	onClick,
	children,
}: {
	label: string;
	/** Why the control is unavailable; `null` when it is available. */
	reason: string | null;
	pressed?: boolean | "mixed";
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<ReasonButton
			label={label}
			reason={reason}
			pressed={pressed}
			className={`rounded-md p-1 hover:bg-surface-hover aria-pressed:bg-accent-dim aria-pressed:text-accent-text ${
				danger
					? "text-text-muted transition-colors hover:text-error"
					: ICON_BUTTON_HOVER
			}`}
			onClick={onClick}
		>
			{children}
		</ReasonButton>
	);
}

export function SlideBulkBar({
	slides,
	selection,
	onSelectAll,
	onClear,
	onMove,
	onSetSkipped,
	onRemove,
	onCopy,
	canMoveUp,
	canMoveDown,
	canRemove,
	canCopy,
}: {
	slides: readonly Slide[];
	/** The ticked slides, in deck order. */
	selection: readonly Slide[];
	onSelectAll: () => void;
	onClear: () => void;
	onMove: (direction: -1 | 1) => void;
	onSetSkipped: (skipped: boolean) => void;
	onRemove: () => void;
	onCopy: () => void;
	canMoveUp: boolean;
	canMoveDown: boolean;
	canRemove: boolean;
	canCopy: boolean;
}) {
	const [confirmingRemoval, setConfirmingRemoval] = useState(false);
	const { text, language } = useInterfaceText();
	const editor = text.editor;
	const count = selection.length;
	// Before anything is ticked the controls still name what they act on.
	const counted =
		count === 0 ? editor.selectedSlides : slideCountLabel(count, language);
	/** A bar wording with the selection filled in. */
	const named = (template: string, values: Record<string, string | number> = {}) =>
		fillText(template, { slides: counted, ...values });
	const none = count === 0 ? editor.selectSlidesFirst : null;
	const willSkip = slideBulkSkipIntent(selection);
	const skippedCount = selection.filter((slide) => slide.skipped).length;
	const allSelected = count === slides.length;

	const skipLabel = willSkip
		? skippedCount > 0
			? named(editor.skipAllSomeSkipped, { skipped: skippedCount })
			: named(editor.skipStepOver)
		: named(editor.includeAgain);
	const removeReason = none ?? (canRemove ? null : editor.slideRemovalFloor);
	const copyReason =
		none ??
		(canCopy ? null : fillText(editor.slideLimitReached, { limit: SLIDE_LIMIT }));

	return (
		<div className="flex-shrink-0 md:w-full flex items-center gap-1 rounded-lg border border-border bg-surface-raised/50 px-2 py-1">
			<label className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
				<input
					type="checkbox"
					className="h-4 w-4 cursor-pointer accent-accent"
					checked={count > 0 && allSelected}
					ref={(input) => {
						if (input) input.indeterminate = count > 0 && !allSelected;
					}}
					onChange={count > 0 ? onClear : onSelectAll}
					aria-label={count > 0 ? editor.clearSelection : editor.selectAllSlides}
				/>
				<span aria-live="polite" className="truncate whitespace-nowrap">
					{count > 0
						? fillText(editor.selectedCount, { count })
						: editor.select}
				</span>
			</label>
			<div className="ml-auto flex items-center">
				<BulkButton
					label={named(editor.moveUp)}
					reason={none ?? (canMoveUp ? null : editor.alreadyAtTop)}
					onClick={() => onMove(-1)}
				>
					<ChevronUp size={15} />
				</BulkButton>
				<BulkButton
					label={named(editor.moveDown)}
					reason={none ?? (canMoveDown ? null : editor.alreadyAtBottom)}
					onClick={() => onMove(1)}
				>
					<ChevronDown size={15} />
				</BulkButton>
				<BulkButton
					label={count === 0 ? named(editor.skip) : skipLabel}
					reason={none}
					pressed={
						count > 0 && skippedCount === count
							? true
							: skippedCount > 0
								? "mixed"
								: false
					}
					onClick={() => onSetSkipped(willSkip)}
				>
					<SkipForward size={15} />
				</BulkButton>
				<BulkButton
					label={
						count === 0 ? named(editor.copy) : named(editor.copyAfterLast)
					}
					reason={copyReason}
					onClick={onCopy}
				>
					<Copy size={15} />
				</BulkButton>
				<BulkButton
					label={named(editor.delete)}
					reason={removeReason}
					danger
					onClick={() => setConfirmingRemoval(true)}
				>
					<Trash2 size={15} />
				</BulkButton>
			</div>
			<ConfirmModal
				open={confirmingRemoval}
				title={named(editor.deleteConfirmTitle)}
				message={pluralText(language, count, editor.deleteConfirmMessage)}
				confirmLabel={named(editor.delete)}
				variant="danger"
				onConfirm={() => {
					setConfirmingRemoval(false);
					onRemove();
				}}
				onCancel={() => setConfirmingRemoval(false)}
			/>
		</div>
	);
}
