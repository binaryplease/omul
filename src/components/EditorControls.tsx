import { type ReactNode, useState } from "react";
import { RotateCcw } from "lucide-react";
import { authoredColorInputValue } from "./color";
import { authoredColorFor } from "../types";

// ── Editor form primitives ────────────────────────────────────────────
//
// The shared building blocks for every authoring surface: the per-slide
// settings column (REQ155) and the deck-level Presentation settings panel.
// Both used to hand-roll their own section cards, labels, segmented controls
// and option pickers, which let the two drift into slightly different visual
// dialects. Per ADR-0026/0027 the invariant — what a settings group, a labelled
// field, a switch and an enumerated choice look and feel like — is expressed
// once here and composed by each surface, so the editor reads as one coherent
// system rather than several look-alikes.
//
// The selected / idle treatment a choice wears (ADR-0028) is owned by a single
// token (`editorChoiceSurface`) and reused by every picker below, never
// re-declared per surface.
//
// Every word these primitives draw — a group's heading, a field's hint, a
// choice's one-line explanation — is on `text-text-muted` or stronger, never on
// `text-text-dim` (REQ157). `text-dim` measures 2.63:1 on the dark surface and
// 4.34:1 on the light one, both under AA for small text; `text-muted` clears it
// in both (5.29:1 dark, 6.92:1 light) and is the floor for anything an author
// has to read. `text-dim` stays what it is for borders, placeholders and the
// hairlines below — things that carry no words.

/**
 * Shared selected/idle surface for an enumerated choice (ADR-0028): the
 * highlight a card or pill wears when it is the active choice versus an idle,
 * pickable one. Aligned with the accent-dim family the slide rail and
 * type-picker already use, so every selectable surface in the editor agrees.
 */
export function editorChoiceSurface(active: boolean): string {
	return active
		? "border-accent/50 bg-accent-dim text-text"
		: "border-border bg-surface/40 text-text-muted hover:border-text-dim hover:text-text";
}

/**
 * What "this control drops the row it sits on" looks like at rest and under a
 * pointer (ADR-0028): the muted → error step every remove-a-row tool in the
 * editor wears. Owned here and composed by both surfaces that draw one — the
 * settings column's `RemoveRowButton` and the canvas's per-option remove tool
 * (REQ153) — because two spellings of the same red is how one list comes to warn
 * about deletion in a colour the list beside it does not.
 *
 * Only the colour pair, deliberately: the two differ in size, padding and how
 * they quieten (the canvas tool fades out until the row is pointed at or
 * focused), and a token that carried those would stop either from being drawn
 * the way its own surface needs.
 */
export const REMOVE_BUTTON_HOVER = "text-text-muted hover:text-error";

/** Eyebrow + title + accent icon chip — the masthead each editor panel wears. */
export function PanelHeader({
	icon,
	eyebrow,
	title,
}: {
	icon: ReactNode;
	eyebrow: string;
	title: string;
}) {
	return (
		<div className="flex items-center gap-3">
			<span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-surface-raised text-accent">
				{icon}
			</span>
			<div className="min-w-0">
				<p className="font-mono text-xs uppercase tracking-wider text-text-muted">
					{eyebrow}
				</p>
				<h2 className="truncate text-lg font-semibold">{title}</h2>
			</div>
		</div>
	);
}

/**
 * A group of related fields under a small heading. Two surface treatments share
 * one heading + spacing invariant (ADR-0027):
 *
 * - `"card"` (default) — a bordered, slightly-raised card that floats on the
 *   page. Used for the editor's Content groups and the deck-settings panel, so
 *   discrete concerns read as separate objects.
 * - `"bare"` — no card chrome; a hairline rule separates it from the previous
 *   group. Used inside an already-framed panel (the slide Settings control
 *   panel) so its groups read as sub-sections of one surface, not cards stacked
 *   inside another card.
 */
export function Section({
	title,
	description,
	children,
	variant = "card",
}: {
	title?: string;
	description?: string;
	children: ReactNode;
	variant?: "card" | "bare";
}) {
	const surface =
		variant === "bare"
			? "border-t border-border-subtle pt-5 first:border-t-0 first:pt-0"
			: "rounded-xl border border-border bg-surface-raised/40 p-4 sm:p-5";
	return (
		<section className={`space-y-3 ${surface}`}>
			{/* Heading is optional: a sub-section whose name would only echo its
			    parent panel's title (a Content panel's lone "Content" group) drops
			    it and lets the fields sit directly under the panel header. */}
			{title && (
				<div>
					<h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
						{title}
					</h3>
					{description && (
						<p className="mt-1 text-xs text-text-muted">{description}</p>
					)}
				</div>
			)}
			{children}
		</section>
	);
}

/**
 * One group of the slide settings column (REQ155): a heading, at most one line
 * saying what the current choice *does*, and — when the group departs from its
 * default — the marker that says so and the one gesture back.
 *
 * Three rules it exists to keep, and each of them is a rule the column cannot
 * keep field by field:
 *
 * - **Departure is stated at the group.** An organizer scanning the column sees
 *   which groups this slide disagrees with the deck (or the product) about,
 *   without opening any of them. Departure is a fact about the group, so it is
 *   drawn on the group.
 * - **The way back is one gesture.** Reset writes every field of the group at
 *   once; putting a slide back the way it came must not be a hunt for which of
 *   five controls was touched.
 * - **The reset stays on screen** (ADR-0025). With nothing to undo it is inert
 *   and says so, rather than appearing and disappearing as the author types —
 *   a control that comes and goes is one nobody learns is there.
 *
 * `consequence` is the group's *whole* prose budget: one line about the choice
 * that is currently made, never a description of the choices that are not. The
 * canvas beside the column is what shows those (REQ152/REQ153/REQ154).
 */
export function SettingsGroup({
	title,
	consequence,
	departed = false,
	departureLabel = "Changed",
	canReset,
	resetUnavailableReason,
	resetLabel,
	onReset,
	children,
}: {
	title: string;
	/** At most one line, about the choice in force. Omitted where it would echo. */
	consequence?: string;
	/** Whether anything in this group departs from its deck or product default. */
	departed?: boolean;
	/**
	 * Whether the reset has anything to write *right now* — by default, whatever
	 * `departed` says. They come apart on one group: a reveal an author closed
	 * further than its default is a departure this group marks and deliberately
	 * does not undo, because undoing it would open a slide they closed. The
	 * button then states that rather than doing nothing when clicked (ADR-0025).
	 */
	canReset?: boolean;
	/** Why the reset is inert while the group is still marked. */
	resetUnavailableReason?: string;
	/** What the marker says — the kind of default this group departs from. */
	departureLabel?: string;
	/** What the reset does, in the organizer's words; also its inert reason. */
	resetLabel?: string;
	/**
	 * Where the reset writes, or absent on a group that has nothing to reset —
	 * one holding the slide's own substance rather than settings with defaults.
	 * Absent means no control at all, which is not the ADR-0025 case: there is no
	 * unavailable action here to explain, only an action that does not exist.
	 */
	onReset?: () => void;
	children: ReactNode;
}) {
	return (
		<section className="space-y-2 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0">
			<div className="flex items-center gap-2">
				<h3 className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
					{title}
				</h3>
				{departed && (
					<span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-accent/40 bg-accent-dim px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text">
						<span
							aria-hidden="true"
							className="h-1.5 w-1.5 rounded-full bg-accent"
						/>
						{departureLabel}
					</span>
				)}
				{onReset && (
					<ResetGroupButton
						title={title}
						departed={departed}
						canReset={canReset ?? departed}
						resetUnavailableReason={resetUnavailableReason}
						resetLabel={resetLabel}
						onReset={onReset}
					/>
				)}
			</div>
			{consequence && (
				<p className="text-xs text-text-muted">{consequence}</p>
			)}
			{children}
		</section>
	);
}

/**
 * The one gesture back, and every state of it named (ADR-0025).
 *
 * Three states rather than two, because a group can depart from its default in a
 * way this control must not undo: a reveal an author closed further than the
 * product default is marked, and the button says why it will not put it back
 * instead of quietly writing nothing when clicked.
 */
function ResetGroupButton({
	title,
	departed,
	canReset,
	resetUnavailableReason,
	resetLabel,
	onReset,
}: {
	title: string;
	departed: boolean;
	canReset: boolean;
	resetUnavailableReason?: string;
	resetLabel?: string;
	onReset: () => void;
}) {
	const reason = !canReset
		? departed && resetUnavailableReason
			? resetUnavailableReason
			: `Nothing to reset — ${title.toLowerCase()} is at its default.`
		: undefined;
	return (
		<button
			type="button"
			className={`flex-shrink-0 rounded-md p-1 transition-colors ${REMOVE_BUTTON_HOVER} aria-disabled:cursor-not-allowed aria-disabled:text-text-dim aria-disabled:hover:text-text-dim`}
			aria-disabled={!canReset}
			onClick={() => {
				if (canReset) onReset();
			}}
			title={canReset ? resetLabel : reason}
			aria-label={
				canReset ? resetLabel : `Reset ${title.toLowerCase()} — ${reason}`
			}
		>
			<RotateCcw size={13} />
		</button>
	);
}

// The `EditorPanel` wrapper that used to live here — the header band over the
// slide editor's Content and Settings frames — is gone with the two panels it
// framed (REQ155). It had exactly one consumer, and what replaced it is not a
// third panel but the absence of one: the settings column is a run of groups in
// a named region, and a frame drawn around a frame is chrome the column's 300px
// cannot spare. `PanelHeader` above stays: the deck-settings panel still wears
// one, and that surface keeps its current form.

/**
 * Labelled form field: a muted caption above its control, optional hint below.
 *
 * `inline` puts the caption beside the control instead, for a short one-row
 * control in a column whose height is its constraint (REQ155) — a segmented
 * switch does not need a line of its own to be understood, and the line it was
 * taking is what a common slide type needs to fit without scrolling.
 */
export function Field({
	label,
	hint,
	children,
	className = "",
	inline = false,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
	className?: string;
	inline?: boolean;
}) {
	if (inline) {
		return (
			// Wrapping rather than colliding: a switch wider than the room left
			// beside its caption drops to its own line, which is the stacked layout
			// again — the one thing it must never do is overlap the words naming it.
			<div
				className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ${className}`}
			>
				<label className="min-w-0 text-xs font-medium text-text-muted">
					{label}
				</label>
				<div className="flex-shrink-0">{children}</div>
			</div>
		);
	}
	return (
		<div className={className}>
			{/* Caption pattern shared across the editor — the label heads the group
			    below rather than binding to a single control. */}
			<label className="mb-1 block text-xs font-medium text-text-muted">
				{label}
			</label>
			{children}
			{hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
		</div>
	);
}

/**
 * One authored colour, authored two ways at once (ADR-0026): the swatch opens
 * the platform's colour picker, the box beside it takes the hex a brand guide is
 * written in. Both write the same field, so an organizer who was handed
 * `#0F62FE` pastes it and an organizer who was handed a printed card picks it.
 *
 * One control, both theming layers: a deck's brand colour (REQ080/REQ135) and a
 * slide's own background, text and chart colours (REQ070/REQ019) are the same
 * kind of value, authored the same way, and resolved by the same function — so
 * what the editor says about a half-typed colour is what every screen will do
 * with it.
 *
 * What the resolver makes of the value is stated here rather than discovered on
 * a projector, the same way an unusable logo URL is: a colour outside the
 * grammar leaves the layer underneath standing, and says so while it can still
 * be fixed. `unsetNote` is what that layer *is* on this field — the house theme,
 * the deck's theme — because "nothing typed" is a real state a control with no
 * empty value cannot show by itself (ADR-0025).
 */
export function ColorField({
	label,
	hint,
	placeholder,
	value,
	unsetNote,
	onChange,
	collapsible = false,
}: {
	label: string;
	hint?: string;
	/** The colour shown while nothing is authored — the inherited value. */
	placeholder: string;
	value: string;
	unsetNote?: string;
	onChange: (value: string) => void;
	/**
	 * Whether the field rests as a swatch chip and opens on demand (REQ155). The
	 * settings column carries three of these and a picker each would be most of
	 * its height; a chip states what the colour *is* — a word when it is
	 * inherited — and the picker is one click away.
	 */
	collapsible?: boolean;
}) {
	// Only the swatch's colour is needed here; the picker, the hex box and the way
	// back all live in `ColorFieldBody`, which reads the value for itself.
	const resolved = authoredColorFor(value);

	if (collapsible) {
		return (
			<DisclosureRow
				label={label}
				value={authoredColorLabel(value)}
				openHint="Open the colour picker"
				marker={
					<span
						aria-hidden="true"
						className="h-4 w-4 flex-shrink-0 rounded border border-border-subtle"
						style={{ background: resolved || placeholder }}
					/>
				}
			>
				<ColorFieldBody
					label={label}
					hint={hint}
					placeholder={placeholder}
					value={value}
					unsetNote={unsetNote}
					onChange={onChange}
				/>
			</DisclosureRow>
		);
	}

	return (
		<ColorFieldBody
			label={label}
			hint={hint}
			placeholder={placeholder}
			value={value}
			unsetNote={unsetNote}
			onChange={onChange}
		/>
	);
}

/** The picker, the hex box and the way back — {@link ColorField}'s open state. */
function ColorFieldBody({
	label,
	hint,
	placeholder,
	value,
	unsetNote,
	onChange,
}: {
	label: string;
	hint?: string;
	placeholder: string;
	value: string;
	unsetNote?: string;
	onChange: (value: string) => void;
}) {
	const authored = value.trim();
	const resolved = authoredColorFor(value);
	return (
		<Field label={label} hint={hint}>
			<div className="flex items-center gap-2">
				<input
					type="color"
					aria-label={`${label} picker`}
					className="h-10 w-12 flex-shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1"
					value={authoredColorInputValue(value, placeholder)}
					onChange={(event) => onChange(event.target.value)}
				/>
				<input
					className="input"
					placeholder={placeholder}
					value={value}
					onChange={(event) => onChange(event.target.value)}
				/>
				{/* The way back to "unset". A colour input cannot express it — it
				    always reports some colour — so clearing the field is a control of
				    its own rather than a value the picker could be dragged to. It
				    stands and states why when there is nothing to clear (ADR-0025). */}
				<button
					type="button"
					className="btn-secondary flex-shrink-0 text-xs"
					onClick={() => onChange("")}
					disabled={authored === ""}
					title={
						authored === ""
							? "Nothing is authored on this field."
							: "Clear this colour and go back to the inherited one."
					}
				>
					Clear
				</button>
			</div>
			{authored !== "" && resolved === "" && (
				<p className="mt-1 text-xs text-warning">
					Not a colour — write it as {placeholder} or #f63. The inherited value
					stands until it is fixed.
				</p>
			)}
			{authored === "" && unsetNote && (
				<p className="mt-1 text-xs text-text-muted">{unsetNote}</p>
			)}
		</Field>
	);
}

/**
 * A setting that rests as one line and opens where it sits (REQ155).
 *
 * The column's height is its whole constraint, and three colour pickers and a
 * URL field are most of it — so a setting an author touches rarely states what
 * it currently *is* on one row, and grows into its full control on demand. The
 * chip is the shared token (ADR-0028): one spelling of "a setting, closed",
 * composed by every field that rests as one, rather than each inventing a row of
 * its own.
 *
 * It is disclosure, not hiding: the setting is named and its value is legible
 * without opening anything, which is what ADR-0025 asks of a control that is
 * present but not in use.
 */
export function DisclosureRow({
	label,
	value,
	openHint,
	marker,
	children,
}: {
	label: string;
	/** What the setting is, in a word — read without opening it. */
	value: string;
	/** What opening it offers, for the accessible name. */
	openHint: string;
	/** An optional swatch or icon that shows the value rather than naming it. */
	marker?: ReactNode;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);

	if (!open) {
		return (
			<button
				type="button"
				aria-expanded={false}
				aria-label={`${label} — ${value}. ${openHint}.`}
				onClick={() => setOpen(true)}
				className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface/40 px-2 py-1.5 text-left transition-colors hover:border-text-dim"
			>
				{marker}
				<span className="min-w-0 flex-1 truncate text-xs text-text-muted">
					{label}
				</span>
				<span className="flex-shrink-0 font-mono text-xs text-text-muted">
					{value}
				</span>
			</button>
		);
	}

	return (
		<div className="space-y-2 rounded-lg border border-border bg-surface/40 p-2">
			{children}
			<button
				type="button"
				className="text-xs text-text-muted transition-colors hover:text-text"
				onClick={() => setOpen(false)}
			>
				Done
			</button>
		</div>
	);
}

/**
 * What an authored colour is *called* on a chip (REQ155).
 *
 * An unauthored colour reads as the word "Theme" rather than as the hex it
 * currently resolves to: the two states look identical spelled out as `#0f62fe`,
 * and only one of them survives re-theming the deck. A value outside the grammar
 * reads as the refusal it is — the resolver leaves the layer underneath standing
 * (see {@link ColorField}), and a chip showing the typed string would claim a
 * colour that is not on the slide.
 */
export function authoredColorLabel(value: string): string {
	const authored = (value ?? "").trim();
	if (authored === "") return "Theme";
	return authoredColorFor(authored) || "Not a colour";
}

/** One enumerated choice for the pickers below. */
export type ChoiceOption<Value extends string> = {
	value: Value;
	label: string;
	description?: string;
	icon?: ReactNode;
	/**
	 * A choice this surface currently cannot make. It is still drawn, still
	 * focusable and still says why (ADR-0025) — an option removed from a picker
	 * teaches nobody that it exists, let alone what would bring it back.
	 */
	disabled?: boolean;
	/** Why it cannot be picked — carried into the tooltip *and* the name. */
	disabledReason?: string;
};

/**
 * What an unavailable choice is called to a reader who cannot see the pointer
 * (ADR-0025): the option, and the reason it is inert, in one string. A tooltip
 * alone is a hover-only explanation, which is no explanation for a keyboard.
 */
export function choiceOptionName<Value extends string>(
	option: ChoiceOption<Value>,
): string | undefined {
	if (!option.disabled) return undefined;
	return option.disabledReason
		? `${option.label} — ${option.disabledReason}`
		: option.label;
}

/**
 * A vertical/grid card picker for a small set of choices that each deserve a
 * one-line explanation (result visibility, pace, layout). The chosen card wears
 * the shared accent highlight; the rest stay idle and pickable. Use this over a
 * native <select> whenever the options carry meaning worth surfacing inline.
 *
 * Two densities of the same picker (ADR-0027 — the invariant is *the enumerated
 * choice*, not the amount of room it is given):
 *
 * - `"card"` (default) — icon beside a label and its one-line description, one
 *   or two to a row. What a full-width panel offers.
 * - `"tile"` — icon beside a short label, on one line, descriptions dropped.
 *   What a 300px settings column offers (REQ155): the canvas beside it already
 *   shows what each choice does, so the sentence under the label was describing
 *   a picture the author is looking at — and the height it took is height the
 *   column needs to fit a common slide type without scrolling.
 */
export function ChoiceCards<Value extends string>({
	value,
	onChange,
	options,
	ariaLabel,
	columns = 1,
	variant = "card",
}: {
	value: Value;
	onChange: (value: Value) => void;
	options: ChoiceOption<Value>[];
	ariaLabel: string;
	columns?: 1 | 2 | 3;
	variant?: "card" | "tile";
}) {
	// A tile grid keeps its columns at every width — it is drawn in a column that
	// is narrow on purpose, and three icons fit there. A card grid keeps the
	// breakpoint it always had, so the panels that were built around it (the deck
	// settings) are unchanged.
	const columnClass =
		variant === "tile"
			? columns === 3
				? "grid-cols-3"
				: columns === 2
					? "grid-cols-2"
					: ""
			: columns >= 2
				? "sm:grid-cols-2"
				: "";
	return (
		<fieldset
			aria-label={ariaLabel}
			className={`grid min-w-0 gap-2 border-0 p-0 ${columnClass}`}
		>
			{options.map((option) => {
				const active = option.value === value;
				const unavailable = option.disabled === true;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={active}
						aria-disabled={unavailable}
						aria-label={choiceOptionName(option)}
						title={unavailable ? option.disabledReason : undefined}
						onClick={() => {
							if (!unavailable) onChange(option.value);
						}}
						className={`${
							variant === "tile"
								? "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left"
								: "flex items-start gap-3 rounded-xl border p-3 text-left"
						} transition-colors ${editorChoiceSurface(active)} ${
							unavailable
								? "cursor-not-allowed text-text-dim hover:border-border hover:text-text-dim"
								: ""
						}`}
					>
						{option.icon && (
							<span
								className={
									variant === "tile" ? "flex-shrink-0" : "mt-0.5 flex-shrink-0"
								}
							>
								{option.icon}
							</span>
						)}
						<span className="min-w-0">
							<span
								className={
									variant === "tile"
										? "block truncate text-xs font-medium leading-tight"
										: "block text-sm font-medium"
								}
							>
								{option.label}
							</span>
							{variant === "card" && option.description && (
								<span className="mt-0.5 block text-xs text-text-muted">
									{option.description}
								</span>
							)}
						</span>
					</button>
				);
			})}
		</fieldset>
	);
}

/**
 * A compact horizontal segmented control for terse, mutually-exclusive choices
 * (the Content/Settings switcher, a per-participant answer count). Same idiom as
 * ChoiceCards but optimised for short labels that read at a glance in one row.
 */
export function Segmented<Value extends string>({
	value,
	onChange,
	options,
	ariaLabel,
	compact = false,
}: {
	value: Value;
	onChange: (value: Value) => void;
	options: ChoiceOption<Value>[];
	ariaLabel: string;
	/**
	 * The narrow build (REQ155): the same control at the size a 300px column can
	 * spare, so a short switch sits beside its own caption instead of under it.
	 */
	compact?: boolean;
}) {
	return (
		<div
			role="tablist"
			aria-label={ariaLabel}
			className={`inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface/50 ${
				compact ? "p-0.5" : "p-1"
			}`}
		>
			{options.map((option) => {
				const active = option.value === value;
				// `aria-disabled` rather than `disabled`, the same posture the canvas's
				// remove tool takes (REQ153): a disabled button leaves the tab order,
				// and its reason would then be reachable by pointer alone.
				const unavailable = option.disabled === true;
				return (
					<button
						key={option.value}
						type="button"
						role="tab"
						aria-selected={active}
						aria-disabled={unavailable}
						aria-label={choiceOptionName(option)}
						title={unavailable ? option.disabledReason : undefined}
						onClick={() => {
							if (!unavailable) onChange(option.value);
						}}
						className={`inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors ${
							compact ? "px-1.5 py-1 text-xs" : "gap-1.5 px-3 py-1.5 text-sm"
						} ${
							unavailable
								? "cursor-not-allowed text-text-dim"
								: active
									? "bg-surface-raised text-text shadow-sm"
									: "text-text-muted hover:text-text"
						}`}
					>
						{option.icon}
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

/**
 * A switch row: title (+ optional description) on the left, an accessible
 * toggle on the right. Replaces bare checkboxes for boolean settings so an
 * on/off choice reads as a deliberate, modern control with room to explain
 * itself.
 */
export function Toggle({
	label,
	description,
	checked,
	onChange,
}: {
	label: string;
	description?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className="flex w-full items-start gap-3 rounded-xl border border-border bg-surface/40 p-3 text-left transition-colors hover:border-text-dim"
		>
			<span className="min-w-0 flex-1">
				<span className="block text-sm font-medium text-text">{label}</span>
				{description && (
					<span className="mt-0.5 block text-xs text-text-muted">
						{description}
					</span>
				)}
			</span>
			<span
				className={`relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
					checked ? "bg-accent" : "bg-surface-hover"
				}`}
			>
				<span
					className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
						checked ? "translate-x-4" : "translate-x-0.5"
					}`}
				/>
			</span>
		</button>
	);
}
