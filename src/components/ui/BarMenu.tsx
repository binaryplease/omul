import {
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { DECK_THEME_SCOPE_ATTRIBUTE } from "../DeckTheme";

// ── Bar menu: a trigger and its portaled panel (REQ190) ──
//
// The mechanics `AppMenu` (REQ183) established, held once so the presenter
// bar's Share, Panels and Deck menus and the app menu cannot drift apart: a
// disclosure, not a `role="menu"`, whose trigger reports `aria-expanded`; a
// panel portaled to the end of the nearest theme scope and placed beside the
// trigger by `appMenuPlacement()`; Escape, a click outside or tabbing off either
// end closes it, and focus goes back to the trigger. `AppMenu` composes the
// pieces below; `BarMenu` composes them into a panel of rows.

/** Space between trigger and panel, and the least room kept to a viewport edge. */
const APP_MENU_MARGIN_PX = 8;

type Box = { top: number; bottom: number; right: number };
type Size = { width: number; height: number };

/**
 * Where the panel goes: right-aligned under the trigger, shifted left or right
 * just enough to stay on screen, and flipped above the trigger when it would
 * run off the bottom and there is room above. Pure, so it is testable.
 */
export function appMenuPlacement(
	trigger: Box,
	panel: Size,
	viewport: Size,
): { top: number; left: number } {
	const margin = APP_MENU_MARGIN_PX;
	const rightmost = viewport.width - panel.width - margin;
	const left = Math.max(margin, Math.min(trigger.right - panel.width, rightmost));
	const below = trigger.bottom + margin;
	const above = trigger.top - margin - panel.height;
	const fitsBelow = below + panel.height <= viewport.height - margin;
	return { top: fitsBelow || above < margin ? below : above, left };
}

export const MENU_HEADING =
	"m-0 px-2 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wider text-text-muted";

const MENU_ROW_SURFACE =
	"flex min-h-9 w-full gap-2.5 rounded-lg border-none bg-transparent px-2 py-2 text-left text-sm font-medium no-underline transition-colors cursor-pointer hover:bg-surface-hover";

/** One actionable row in the app menu — a legal link or the feedback item. */
export const MENU_ROW = `${MENU_ROW_SURFACE} items-center justify-between text-text`;

export const MENU_DIVIDER = "mx-1.5 my-1 h-px bg-border";

/** The panel's frame, shared by every menu drawn from a bar. */
export const MENU_PANEL =
	"fixed z-50 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-surface p-1.5 text-left shadow-2xl popover-in";

/**
 * Marks a `BarMenu` row, for focus on open and the panel's Tab rule — and
 * `AppMenu`'s, when it leads its panel with rows (REQ199).
 */
export const BAR_MENU_ROW_ATTRIBUTE = "data-bar-menu-row";

/**
 * Marks a bar docked to the bottom edge of the screen — the presenter's phone
 * console (REQ199), whose element carries it while `index.css` reads it.
 */
export const BOTTOM_DOCK_ATTRIBUTE = "data-bottom-dock";

/**
 * The box a panel is placed against: its trigger's, except that a trigger in a
 * docked bar takes the bar's top edge as its own, so its menus open clear of
 * the whole dock rather than over the dock's padding. The marker alone is not
 * enough — the presenter's console carries it at every width and is docked only
 * below `sm` — so the bar has to be `fixed` as well.
 */
function menuAnchorBox(trigger: HTMLElement): Box {
	const box = trigger.getBoundingClientRect();
	const dock = trigger.closest<HTMLElement>(`[${BOTTOM_DOCK_ATTRIBUTE}]`);
	if (!dock || getComputedStyle(dock).position !== "fixed") return box;
	return {
		top: Math.min(box.top, dock.getBoundingClientRect().top),
		bottom: box.bottom,
		right: box.right,
	};
}

/** Where a menu's panel is drawn: the trigger's theme scope, or the page. */
export function menuPortalHost(trigger: HTMLElement | null): HTMLElement {
	return (
		trigger?.closest<HTMLElement>(`[${DECK_THEME_SCOPE_ATTRIBUTE}]`) ??
		document.body
	);
}

/**
 * Place the panel before it paints, keep it beside the trigger while the page
 * scrolls or resizes underneath it, and move focus into it on open — to the
 * first match of `initialFocus`, or to the panel itself when nothing matches.
 * Written straight to the element: a position held in state would draw one
 * frame in the wrong place.
 */
export function useMenuPanelPlacement(
	open: boolean,
	triggerRef: RefObject<HTMLElement | null>,
	panelRef: RefObject<HTMLElement | null>,
	initialFocus: string,
) {
	useLayoutEffect(() => {
		if (!open) return;
		const place = () => {
			const trigger = triggerRef.current;
			const panel = panelRef.current;
			if (!trigger || !panel) return;
			const { top, left } = appMenuPlacement(
				menuAnchorBox(trigger),
				{ width: panel.offsetWidth, height: panel.offsetHeight },
				{ width: window.innerWidth, height: window.innerHeight },
			);
			panel.style.top = `${top}px`;
			panel.style.left = `${left}px`;
		};
		place();
		const panel = panelRef.current;
		(panel?.querySelector<HTMLElement>(initialFocus) ?? panel)?.focus();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [open, triggerRef, panelRef, initialFocus]);
}

/**
 * Escape anywhere on the page closes an open menu, returning focus. The Escape
 * is marked handled, so a listener further out — the presenter's panel sheet
 * (REQ199) — does not take a second layer down with the same key.
 */
export function useCloseOnEscape(active: boolean, close: () => void) {
	useEffect(() => {
		if (!active) return;
		const closeOnEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			close();
		};
		document.addEventListener("keydown", closeOnEscape);
		return () => document.removeEventListener("keydown", closeOnEscape);
	}, [active, close]);
}

/**
 * A key pressed in the panel is the panel's: the presenter pages slides on
 * arrow keys and Space at the window, and using a menu must not move the deck.
 * So nothing leaves, and Escape is answered here rather than at the document it
 * no longer reaches.
 *
 * The panel sits at the end of the scope, not after the trigger, so the tab
 * order is kept by hand: tabbing off either end of `stops` closes it and lands
 * back on the trigger — one more Tab past where a panel drawn after the trigger
 * would leave focus, never a trap. A panel with no stop closes on any Tab.
 */
export function handleMenuPanelKey(
	event: KeyboardEvent<HTMLElement>,
	stops: string,
	close: () => void,
) {
	event.stopPropagation();
	if (event.key === "Escape") {
		close();
		return;
	}
	if (event.key !== "Tab") return;
	const tabStops = [...event.currentTarget.querySelectorAll<HTMLElement>(stops)];
	const edge = event.shiftKey ? tabStops[0] : tabStops[tabStops.length - 1];
	if (edge && document.activeElement !== edge) return;
	event.preventDefault();
	close();
}

/** The trigger every menu opens from. The name starts with what it shows. */
export function MenuTrigger({
	ref,
	expanded,
	controls,
	label,
	title,
	className,
	onClick,
	children,
}: {
	ref?: Ref<HTMLButtonElement>;
	expanded: boolean;
	controls: string;
	label: string;
	title: string;
	className: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			aria-label={label}
			title={title}
			aria-expanded={expanded}
			// Only while the panel exists: an id naming nothing is no reference.
			aria-controls={expanded ? controls : undefined}
			className={className}
		>
			{children}
		</button>
	);
}

/**
 * The click-away layer under an open panel. It closes the panel and hands focus
 * back to the trigger rather than dropping it on the page body as the layer
 * unmounts under it.
 */
export function MenuBackdrop({
	label,
	dimmed = false,
	onClose,
}: {
	label: string;
	dimmed?: boolean;
	onClose: () => void;
}) {
	return (
		<button
			type="button"
			tabIndex={-1}
			aria-label={label}
			className={`fixed inset-0 z-40 cursor-default border-none ${
				dimmed ? "bg-void/70 backdrop-blur-sm" : "bg-transparent"
			}`}
			onClick={onClose}
		/>
	);
}

/**
 * Why a row is disabled, as its visible second line: the part of its accessible
 * name after the first " — ", capitalised, or the whole name when it has none.
 */
export function disabledReason(label: string): string {
	const dash = label.indexOf(" — ");
	const reason = dash === -1 ? label : label.slice(dash + 3);
	return reason.charAt(0).toUpperCase() + reason.slice(1);
}

/**
 * One row of a `BarMenu`. Disabled, it dims its icon and label but not
 * `reason`, which says why in words a pointer and a screen reader both reach.
 */
export function BarMenuRow({
	icon,
	label,
	reason,
	trailing,
	tone = "default",
	disabled = false,
	pressed,
	ariaLabel,
	title,
	onClick,
}: {
	icon: ReactNode;
	label: ReactNode;
	reason?: string;
	trailing?: ReactNode;
	tone?: "default" | "danger";
	disabled?: boolean;
	pressed?: boolean;
	ariaLabel?: string;
	title?: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			{...{ [BAR_MENU_ROW_ATTRIBUTE]: "" }}
			onClick={onClick}
			disabled={disabled}
			aria-pressed={pressed}
			aria-label={ariaLabel}
			title={title}
			className={`${MENU_ROW_SURFACE} items-start disabled:cursor-not-allowed disabled:hover:bg-transparent ${
				tone === "danger" && !disabled ? "text-error" : "text-text"
			}`}
		>
			<span
				aria-hidden
				className={`mt-0.5 flex flex-shrink-0 ${disabled ? "opacity-50" : ""}`}
			>
				{icon}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className={disabled ? "opacity-50" : ""}>{label}</span>
				{disabled && reason && (
					<span className="text-xs font-normal text-text-dim">{reason}</span>
				)}
			</span>
			{trailing && (
				<span className="ml-auto flex flex-shrink-0 items-center gap-2 self-center">
					{trailing}
				</span>
			)}
		</button>
	);
}

/**
 * A trigger opening a panel of `BarMenuRow`s under a heading. `children` gets
 * `close`, so a row that hands off to a dialog or a page closes the menu first
 * and a row that only toggles leaves it open.
 */
export function BarMenu({
	label,
	title,
	heading,
	triggerClassName,
	trigger,
	children,
}: {
	label: string;
	title: string;
	heading: ReactNode;
	triggerClassName: string;
	trigger: ReactNode;
	children: (close: () => void) => ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const panelId = useId();

	const close = useCallback(() => {
		setOpen(false);
		triggerRef.current?.focus();
	}, []);

	useMenuPanelPlacement(
		open,
		triggerRef,
		panelRef,
		`[${BAR_MENU_ROW_ATTRIBUTE}]:not(:disabled)`,
	);
	useCloseOnEscape(open, close);

	return (
		<>
			<MenuTrigger
				ref={triggerRef}
				expanded={open}
				controls={panelId}
				label={label}
				title={title}
				className={triggerClassName}
				onClick={() => {
					if (open) {
						setOpen(false);
						return;
					}
					setPortalHost(menuPortalHost(triggerRef.current));
					setOpen(true);
				}}
			>
				{trigger}
			</MenuTrigger>
			{open &&
				portalHost &&
				createPortal(
					<>
						<MenuBackdrop label={`Close ${title.toLowerCase()} menu`} onClose={close} />
						<div
							ref={panelRef}
							id={panelId}
							tabIndex={-1}
							onKeyDown={(event) =>
								handleMenuPanelKey(
									event,
									`[${BAR_MENU_ROW_ATTRIBUTE}]:not(:disabled)`,
									close,
								)
							}
							className={`${MENU_PANEL} w-64 outline-none`}
						>
							<p className={MENU_HEADING}>{heading}</p>
							{children(close)}
						</div>
					</>,
					portalHost,
				)}
		</>
	);
}
