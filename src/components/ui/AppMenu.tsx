import { Ellipsis, ExternalLink, MessageSquareText, X } from "lucide-react";
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
import { api } from "../../api";
import { useSession } from "../../auth-client";
import {
	buildUserFeedbackSubmission,
	type FeedbackDraft,
	feedbackSurfaceForRoute,
	screenLanguage,
	useFeedbackConfig,
} from "../../feedback";
import { routeForLocation } from "../../router";
import type { FeedbackSurface, LegalLinks } from "../../types";
import { DECK_THEME_SCOPE_ATTRIBUTE } from "../DeckTheme";
import { FeedbackForm } from "../FeedbackForm";
import { configuredLegalLinks, LegalLink, useLegalLinks } from "../LegalLinks";
import { ICON_BUTTON_HOVER } from "../ShareCluster";
import { THEME_OPTIONS, type ThemePreference, useTheme } from "./Theme";

// ── App menu: appearance, feedback + legal texts (REQ183, REQ185) ──
//
// One small trigger, wherever a screen offers the theme switch, opening a panel
// with up to three sections: the Light / Dark / Auto choice, "Send feedback"
// when this deployment collects it (REQ185), and the operator's legal texts. It is what puts the imprint, the privacy policy and the terms within
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
// So the panel is drawn at the end of the nearest theme scope — the deck's, or
// a slide's own appearance over it, so it wears the same colours as its
// trigger — at a fixed position computed from the trigger, clamped
// to the viewport.
//
// "Send feedback" swaps the panel for a dialog holding the shared
// `FeedbackForm`, drawn in the same place for the same reasons. It keeps the
// panel's rules — Escape or a click outside closes it, focus goes back to the
// trigger, and no key it receives reaches the page — except that Tab cycles
// inside it rather than closing it, because tabbing past the send button must
// not throw away what was typed.

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

/** One actionable row in the panel — a legal link or the feedback item. */
const MENU_ROW =
	"flex min-h-9 w-full items-center justify-between gap-2.5 rounded-lg border-none bg-transparent px-2 py-2 text-left text-sm font-medium text-text no-underline transition-colors cursor-pointer hover:bg-surface-hover";

const SECTION_DIVIDER = "mx-1.5 my-1 h-px bg-border";

/** Marks the panel's rows that are tab stops, for the panel's own Tab rule. */
const MENU_ITEM_ATTRIBUTE = "data-app-menu-item";

/**
 * What the trigger is called, naming what the panel holds. With the feedback
 * channel off the menu is exactly what it was before REQ185, name included.
 */
function appMenuName(feedbackEnabled: boolean): string {
	return feedbackEnabled
		? "Appearance, feedback and legal"
		: "Appearance and legal";
}

/**
 * The panel's contents for a given theme and set of addresses. The Legal
 * section lists exactly the configured texts, in descriptor order, and is
 * absent when none is configured — the menu then holds Appearance alone.
 * "Send feedback" sits between the two, and only when `feedbackEnabled` —
 * which the menu takes from `GET /api/feedback/config` and nothing else.
 */
export function AppMenuPanel({
	id,
	links,
	theme,
	onThemeChange,
	feedbackEnabled = false,
	onSendFeedback,
	onKeyDown,
	ref,
}: {
	id: string;
	links: LegalLinks;
	theme: ThemePreference;
	onThemeChange: (theme: ThemePreference) => void;
	feedbackEnabled?: boolean;
	onSendFeedback?: () => void;
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
			{feedbackEnabled && (
				<>
					<div aria-hidden className={SECTION_DIVIDER} />
					<button
						type="button"
						{...{ [MENU_ITEM_ATTRIBUTE]: "" }}
						onClick={onSendFeedback}
						className={MENU_ROW}
					>
						<span>Send feedback</span>
						<MessageSquareText
							size={14}
							aria-hidden
							className="flex-shrink-0 text-text-dim"
						/>
					</button>
				</>
			)}
			{legalLinks.length > 0 && (
				<>
					<div aria-hidden className={SECTION_DIVIDER} />
					<nav aria-labelledby={`${id}-legal`}>
						<p id={`${id}-legal`} className={SECTION_HEADING}>
							Legal
						</p>
						{legalLinks.map((link) => (
							<LegalLink
								key={link.label}
								href={link.href}
								className={MENU_ROW}
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

/** What the menu is showing: nothing, its panel, or the feedback dialog. */
type AppMenuView = "closed" | "panel" | "feedback";

/**
 * Where a feedback entry says it was sent from — the kind of screen and its
 * language — read once, as the dialog opens over that screen.
 */
type FeedbackOrigin = { surface: FeedbackSurface; language: string };

/** What the feedback dialog's Tab rule cycles through. */
const DIALOG_FOCUSABLE =
	"button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]";

/**
 * The menu's feedback dialog: the shared form, wired to this app — the
 * signed-in account's address for the contact box, and `POST /api/feedback`
 * for the answer. Nothing names the account in the body; the server takes it
 * from the session.
 */
function AppMenuFeedbackDialog({
	id,
	origin,
	onClose,
}: {
	id: string;
	origin: FeedbackOrigin;
	onClose: () => void;
}) {
	const { data: session } = useSession();
	const contactEmail = session?.user.email ?? null;
	const dialogRef = useRef<HTMLDivElement>(null);
	const headingId = `${id}-heading`;

	useEffect(() => {
		dialogRef.current?.querySelector<HTMLElement>(DIALOG_FOCUSABLE)?.focus();
	}, []);

	const sendFeedback = async (draft: FeedbackDraft) => {
		await api.sendFeedback(
			buildUserFeedbackSubmission(draft, {
				...origin,
				contactOffered: contactEmail !== null,
			}),
		);
	};

	// Keys stay in the dialog, as they stay in the panel. Escape closes it; Tab
	// wraps from either end to the other.
	const handleDialogKey = (event: KeyboardEvent<HTMLDivElement>) => {
		event.stopPropagation();
		if (event.key === "Escape") {
			onClose();
			return;
		}
		if (event.key !== "Tab") return;
		const stops = [
			...event.currentTarget.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE),
		];
		const first = stops[0];
		const last = stops[stops.length - 1];
		if (!first || !last) return;
		const leaving = event.shiftKey ? first : last;
		if (document.activeElement !== leaving) return;
		event.preventDefault();
		(event.shiftKey ? last : first).focus();
	};

	return (
		<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
			<div
				ref={dialogRef}
				id={id}
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				onKeyDown={handleDialogKey}
				className="pointer-events-auto flex max-h-full w-full max-w-md items-start gap-2 overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-left shadow-2xl popover-in"
			>
				<div className="min-w-0 flex-1">
					<FeedbackForm
						headingId={headingId}
						contactEmail={contactEmail}
						onSend={sendFeedback}
						onDone={onClose}
					/>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close feedback"
					title="Close feedback"
					className={`-mr-1 -mt-1 flex size-8 flex-shrink-0 items-center justify-center rounded-lg border-none bg-transparent cursor-pointer ${ICON_BUTTON_HOVER}`}
				>
					<X size={16} aria-hidden />
				</button>
			</div>
		</div>
	);
}

/** The theme switch, feedback and the legal texts, behind one icon button. */
export function AppMenu() {
	const { theme, setTheme } = useTheme();
	// Read on mount, not on open, so the links and the feedback item are there
	// the first time.
	const links = useLegalLinks();
	const feedbackEnabled = useFeedbackConfig().enabled;
	const [view, setView] = useState<AppMenuView>("closed");
	const [feedbackOrigin, setFeedbackOrigin] = useState<FeedbackOrigin | null>(
		null,
	);
	const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const panelId = useId();
	const open = view === "panel";
	const menuName = appMenuName(feedbackEnabled);

	const close = useCallback((returnFocus: boolean) => {
		setView("closed");
		if (returnFocus) triggerRef.current?.focus();
	}, []);

	const openPanel = () => {
		setPortalHost(
			triggerRef.current?.closest<HTMLElement>(
				`[${DECK_THEME_SCOPE_ATTRIBUTE}]`,
			) ?? document.body,
		);
		setView("panel");
	};

	// The screen the menu was opened on, not wherever the sender is by the
	// time they press send.
	const openFeedback = () => {
		setFeedbackOrigin({
			surface: feedbackSurfaceForRoute(
				routeForLocation(
					window.location.pathname,
					window.location.hash.slice(1),
				),
			),
			language: screenLanguage(triggerRef.current),
		});
		setView("feedback");
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
		if (view === "closed") return;
		const closeOnEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") close(true);
		};
		document.addEventListener("keydown", closeOnEscape);
		return () => document.removeEventListener("keydown", closeOnEscape);
	}, [view, close]);

	// A key pressed in the panel is the panel's: the presenter pages slides on
	// arrow keys and Space at the window, and choosing a theme must not move the
	// deck. So nothing leaves, and Escape is answered here rather than at the
	// document it no longer reaches.
	//
	// The panel sits at the end of the scope, not after the trigger, so the tab
	// order is kept by hand: tabbing off either end closes it and lands back on
	// the trigger. Off the far end that is one stop short of where a panel drawn
	// right after the trigger would leave focus — one more Tab, never a trap.
	const handlePanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
		event.stopPropagation();
		if (event.key === "Escape") {
			close(true);
			return;
		}
		if (event.key !== "Tab") return;
		const stops = [
			...event.currentTarget.querySelectorAll<HTMLElement>(
				`[role="radio"][tabindex="0"], [${MENU_ITEM_ATTRIBUTE}], a[href]`,
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
				onClick={() => (view === "closed" ? openPanel() : close(false))}
				aria-label={menuName}
				title={menuName}
				aria-expanded={view !== "closed"}
				// Only while the panel or the dialog exists: an id naming nothing is
				// no reference.
				aria-controls={view === "closed" ? undefined : panelId}
				className={`flex size-8.5 flex-shrink-0 items-center justify-center rounded-lg border bg-surface-raised hover:border-accent/50 ${
					view === "closed" ? "border-border" : "border-accent/50"
				} ${ICON_BUTTON_HOVER}`}
			>
				<Ellipsis size={16} aria-hidden />
			</button>
			{view !== "closed" &&
				portalHost &&
				createPortal(
					<>
						{/* Click-away backdrop closes the panel or the dialog, handing
						    focus back to the trigger rather than dropping it on the page
						    body as the backdrop unmounts under it. Dimmed behind the
						    dialog, which is modal. */}
						<button
							type="button"
							tabIndex={-1}
							aria-label={
								view === "feedback"
									? "Close feedback"
									: `Close ${menuName.toLowerCase()} menu`
							}
							className={`fixed inset-0 z-40 cursor-default border-none ${
								view === "feedback"
									? "bg-void/70 backdrop-blur-sm"
									: "bg-transparent"
							}`}
							onClick={() => close(true)}
						/>
						{view === "panel" && (
							<AppMenuPanel
								ref={panelRef}
								id={panelId}
								links={links}
								theme={theme}
								onThemeChange={setTheme}
								feedbackEnabled={feedbackEnabled}
								onSendFeedback={openFeedback}
								onKeyDown={handlePanelKey}
							/>
						)}
						{view === "feedback" && feedbackOrigin && (
							<AppMenuFeedbackDialog
								id={panelId}
								origin={feedbackOrigin}
								onClose={() => close(true)}
							/>
						)}
					</>,
					portalHost,
				)}
		</>
	);
}
