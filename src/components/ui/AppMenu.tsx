import { Ellipsis, ExternalLink } from "lucide-react";
import {
	type KeyboardEvent,
	type Ref,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { LegalLinks } from "../../types";
import { DECK_THEME_SCOPE_ATTRIBUTE } from "../DeckTheme";
import { configuredLegalLinks, LegalLink, useLegalLinks } from "../LegalLinks";
import { ICON_BUTTON_HOVER } from "../ShareCluster";
import { THEME_OPTIONS, type ThemePreference, useTheme } from "./Theme";

// ── App menu: appearance + legal texts (REQ183) ───────────────
//
// One small trigger, wherever a screen offers the theme switch, opening a panel
// with two sections: the Light / Dark / Auto choice, and the operator's legal
// texts. It is what puts the imprint, the privacy policy and the terms within
// reach of every non-loading screen, so a screen that draws the trigger is a
// screen that satisfies "reachable from any route" — and a screen that drops it
// is one that no longer does.
//
// A disclosure, not a `role="menu"`: the panel holds a radio group and plain
// links, neither of which the menu pattern fits. The trigger reports
// `aria-expanded`; focus moves to the chosen theme on open; Escape, a click
// outside, or tabbing off either end closes it, returning focus to the trigger.
//
// The panel is portaled. The presenter and preview headers scroll horizontally,
// which clips anything absolutely positioned inside them, and their
// `backdrop-blur` makes them the containing block for a `fixed` descendant too.
// So the panel is drawn at the end of the nearest deck-theme scope — still in
// the deck's colours — at a fixed position computed from the trigger, clamped
// to the viewport.

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

const SECTION_HEADING =
	"m-0 px-2 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wider text-text-muted";

/**
 * The panel's contents for a given theme and set of addresses. The Legal
 * section lists exactly the configured texts, in descriptor order, and is
 * absent when none is configured — the menu then holds Appearance alone.
 */
export function AppMenuPanel({
	id,
	links,
	theme,
	onThemeChange,
	onKeyDown,
	ref,
}: {
	id: string;
	links: LegalLinks;
	theme: ThemePreference;
	onThemeChange: (theme: ThemePreference) => void;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	ref?: Ref<HTMLDivElement>;
}) {
	const legalLinks = configuredLegalLinks(links);
	const anyChecked = THEME_OPTIONS.some((option) => option.value === theme);

	// Arrow keys move the choice, as in any radio group; the chosen option is
	// the group's one tab stop.
	const moveChoice = (event: KeyboardEvent<HTMLDivElement>) => {
		const step =
			event.key === "ArrowRight" || event.key === "ArrowDown"
				? 1
				: event.key === "ArrowLeft" || event.key === "ArrowUp"
					? -1
					: 0;
		if (step === 0) return;
		event.preventDefault();
		const current = THEME_OPTIONS.findIndex((option) => option.value === theme);
		const next =
			THEME_OPTIONS[
				(current + step + THEME_OPTIONS.length) % THEME_OPTIONS.length
			];
		onThemeChange(next.value);
		event.currentTarget
			.querySelector<HTMLButtonElement>(`[data-theme-option="${next.value}"]`)
			?.focus();
	};

	return (
		<div
			ref={ref}
			id={id}
			onKeyDown={onKeyDown}
			className="fixed z-50 w-62 max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-surface p-1.5 text-left shadow-2xl popover-in"
		>
			<p id={`${id}-appearance`} className={SECTION_HEADING}>
				Appearance
			</p>
			<div
				role="radiogroup"
				aria-labelledby={`${id}-appearance`}
				onKeyDown={moveChoice}
				className="mx-1 mb-1.5 grid grid-cols-3 gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5"
			>
				{THEME_OPTIONS.map(({ value, label, Icon }, index) => {
					const checked = theme === value;
					return (
						<button
							key={value}
							type="button"
							role="radio"
							aria-checked={checked}
							tabIndex={checked || (!anyChecked && index === 0) ? 0 : -1}
							data-theme-option={value}
							onClick={() => onThemeChange(value)}
							className={`flex flex-col items-center gap-1 rounded-md border-none px-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
								checked
									? "bg-surface-hover text-accent-text shadow-sm"
									: "bg-transparent text-text-dim hover:text-text-muted"
							}`}
						>
							<Icon size={16} aria-hidden />
							{label}
						</button>
					);
				})}
			</div>
			{legalLinks.length > 0 && (
				<>
					<div aria-hidden className="mx-1.5 my-1 h-px bg-border" />
					<nav aria-labelledby={`${id}-legal`}>
						<p id={`${id}-legal`} className={SECTION_HEADING}>
							Legal
						</p>
						{legalLinks.map((link) => (
							<LegalLink
								key={link.label}
								href={link.href}
								className="flex min-h-9 items-center justify-between gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-text no-underline transition-colors hover:bg-surface-hover"
							>
								<span>
									{link.label}
									<span className="sr-only"> (opens in a new tab)</span>
								</span>
								<ExternalLink
									size={14}
									aria-hidden
									className="flex-shrink-0 text-text-dim"
								/>
							</LegalLink>
						))}
					</nav>
				</>
			)}
		</div>
	);
}

/** The theme switch and the legal texts, behind one icon button. */
export function AppMenu() {
	const { theme, setTheme } = useTheme();
	// Read on mount, not on open, so the links are there the first time.
	const links = useLegalLinks();
	const [open, setOpen] = useState(false);
	const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const panelId = useId();

	const close = useCallback((returnFocus: boolean) => {
		setOpen(false);
		if (returnFocus) triggerRef.current?.focus();
	}, []);

	const openPanel = () => {
		setPortalHost(
			triggerRef.current?.closest<HTMLElement>(
				`[${DECK_THEME_SCOPE_ATTRIBUTE}]`,
			) ?? document.body,
		);
		setOpen(true);
	};

	// Place the panel before it paints, and keep it beside the trigger while
	// the page scrolls or resizes underneath it. Written straight to the
	// element: a position held in state would draw one frame in the wrong place.
	useLayoutEffect(() => {
		if (!open) return;
		const place = () => {
			const trigger = triggerRef.current;
			const panel = panelRef.current;
			if (!trigger || !panel) return;
			const { top, left } = appMenuPlacement(
				trigger.getBoundingClientRect(),
				{ width: panel.offsetWidth, height: panel.offsetHeight },
				{ width: window.innerWidth, height: window.innerHeight },
			);
			panel.style.top = `${top}px`;
			panel.style.left = `${left}px`;
		};
		place();
		panelRef.current
			?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
			?.focus();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const closeOnEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") close(true);
		};
		document.addEventListener("keydown", closeOnEscape);
		return () => document.removeEventListener("keydown", closeOnEscape);
	}, [open, close]);

	// A key pressed in the panel is the panel's: the presenter pages slides on
	// arrow keys and Space at the window, and choosing a theme must not move the
	// deck. So nothing leaves, and Escape is answered here rather than at the
	// document it no longer reaches.
	//
	// The panel sits at the end of the scope, not after the trigger, so the tab
	// order is kept by hand: tabbing off either end closes it and lands back on
	// the trigger, as if the panel had been drawn right after it.
	const handlePanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
		event.stopPropagation();
		if (event.key === "Escape") {
			close(true);
			return;
		}
		if (event.key !== "Tab") return;
		const stops = [
			...event.currentTarget.querySelectorAll<HTMLElement>(
				'[role="radio"][tabindex="0"], a[href]',
			),
		];
		const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
		if (document.activeElement !== edge) return;
		event.preventDefault();
		close(true);
	};

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => (open ? close(false) : openPanel())}
				aria-label="Appearance and legal"
				title="Appearance and legal"
				aria-expanded={open}
				aria-controls={panelId}
				className={`flex size-8.5 flex-shrink-0 items-center justify-center rounded-lg border bg-surface-raised hover:border-accent/50 ${
					open ? "border-accent/50" : "border-border"
				} ${ICON_BUTTON_HOVER}`}
			>
				<Ellipsis size={16} aria-hidden />
			</button>
			{open &&
				portalHost &&
				createPortal(
					<>
						{/* Click-away backdrop closes the panel. */}
						<button
							type="button"
							tabIndex={-1}
							aria-label="Close appearance and legal menu"
							className="fixed inset-0 z-40 cursor-default"
							onClick={() => close(false)}
						/>
						<AppMenuPanel
							ref={panelRef}
							id={panelId}
							links={links}
							theme={theme}
							onThemeChange={setTheme}
							onKeyDown={handlePanelKey}
						/>
					</>,
					portalHost,
				)}
		</>
	);
}
