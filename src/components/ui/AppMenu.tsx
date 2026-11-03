import { Ellipsis, ExternalLink, MessageSquareText, X } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useId,
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
import { FeedbackForm } from "../FeedbackForm";
import { configuredLegalLinks, LegalLink, useLegalLinks } from "../LegalLinks";
import { ICON_BUTTON_HOVER } from "../ShareCluster";
import {
	BAR_MENU_ROW_ATTRIBUTE,
	handleMenuPanelKey,
	MENU_DIVIDER,
	MENU_HEADING,
	MENU_PANEL,
	MENU_ROW,
	MenuBackdrop,
	MenuTrigger,
	menuPortalHost,
	useCloseOnEscape,
	useMenuPanelPlacement,
} from "./BarMenu";
import { THEME_OPTIONS, type ThemePreference, useTheme } from "./Theme";

export { appMenuPlacement } from "./BarMenu";

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
// The trigger, the portal, the placement and the key rules are the shell in
// `BarMenu.tsx`, which the presenter bar's menus share (REQ190).
//
// The panel is portaled. The preview header scrolls horizontally, which clips
// anything absolutely positioned inside it, and it and the presenter header
// carry a `backdrop-blur` that makes them the containing block for a `fixed`
// descendant too.
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
 * The trigger's accessible name: the menu's own, or — with a leading section —
 * that section's name followed by what the menu's own sections hold (REQ199),
 * so a caller names only its own rows and the feedback item is named exactly
 * where it is offered.
 */
export function appMenuTriggerLabel(
	feedbackEnabled: boolean,
	leadingLabel?: string,
): string {
	const menuName = appMenuName(feedbackEnabled);
	return leadingLabel ? `${leadingLabel}, ${menuName.toLowerCase()}` : menuName;
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
	leading,
	ref,
}: {
	id: string;
	links: LegalLinks;
	theme: ThemePreference;
	onThemeChange: (theme: ThemePreference) => void;
	feedbackEnabled?: boolean;
	onSendFeedback?: () => void;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	/** A screen's own section, drawn above Appearance (REQ199). */
	leading?: ReactNode;
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
			className={`${MENU_PANEL} ${leading ? "w-64" : "w-62"}`}
		>
			{leading && (
				<>
					{leading}
					<div aria-hidden className={MENU_DIVIDER} />
				</>
			)}
			<p id={`${id}-appearance`} className={MENU_HEADING}>
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
					<div aria-hidden className={MENU_DIVIDER} />
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
					<div aria-hidden className={MENU_DIVIDER} />
					<nav aria-labelledby={`${id}-legal`}>
						<p id={`${id}-legal`} className={MENU_HEADING}>
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

/**
 * A screen's own section at the head of the app menu (REQ199): the presenter's
 * phone bar folds its Deck menu in here, so one More trigger stands where the
 * Deck trigger and the app menu would be two unlabelled menus side by side.
 * `rows` gets `close`, as a `BarMenu`'s children do, and its rows are
 * `BarMenuRow`s.
 */
export type AppMenuLeading = {
	/**
	 * The trigger's accessible name for the screen's own section — "More —
	 * edit, preview, …" — to which the menu adds what its own sections hold, so
	 * the name follows the feedback item rather than being restated by a caller.
	 */
	label: string;
	title: string;
	heading: string;
	rows: (close: () => void) => ReactNode;
};

/** Focus on open with a leading section: its first enabled row, else the theme. */
const LEADING_INITIAL_FOCUS = `[${BAR_MENU_ROW_ATTRIBUTE}]:not(:disabled), [role="radio"][tabindex="0"]`;

/**
 * The theme switch, feedback and the legal texts, behind one icon button.
 * Without `className` and `leading` it is the same menu on every surface;
 * `className` is appended to the trigger's own, and `leading` puts a screen's
 * section above Appearance.
 */
export function AppMenu({
	className = "",
	leading,
}: {
	className?: string;
	leading?: AppMenuLeading;
} = {}) {
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
	const closeAndReturn = useCallback(() => close(true), [close]);

	const openPanel = () => {
		setPortalHost(menuPortalHost(triggerRef.current));
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

	// Focus moves to the chosen theme on open — or, with a leading section, to
	// its first enabled row, falling back to the theme when every row is
	// disabled. The rows come first in the panel, so the first match is a row
	// whenever one is enabled.
	useMenuPanelPlacement(
		open,
		triggerRef,
		panelRef,
		leading ? LEADING_INITIAL_FOCUS : '[role="radio"][tabindex="0"]',
	);
	useCloseOnEscape(view !== "closed", closeAndReturn);

	const handlePanelKey = (event: KeyboardEvent<HTMLDivElement>) =>
		handleMenuPanelKey(
			event,
			`${leading ? `[${BAR_MENU_ROW_ATTRIBUTE}]:not(:disabled), ` : ""}[role="radio"][tabindex="0"], [${MENU_ITEM_ATTRIBUTE}], a[href]`,
			closeAndReturn,
		);

	return (
		<>
			<MenuTrigger
				ref={triggerRef}
				expanded={view !== "closed"}
				controls={panelId}
				label={appMenuTriggerLabel(feedbackEnabled, leading?.label)}
				title={leading?.title ?? menuName}
				onClick={() => (view === "closed" ? openPanel() : close(false))}
				className={`flex size-8.5 flex-shrink-0 items-center justify-center rounded-lg border bg-surface-raised hover:border-accent/50 ${
					view === "closed" ? "border-border" : "border-accent/50"
				} ${ICON_BUTTON_HOVER} ${className}`}
			>
				<Ellipsis size={16} aria-hidden />
			</MenuTrigger>
			{view !== "closed" &&
				portalHost &&
				createPortal(
					<>
						{/* Dimmed behind the feedback dialog, which is modal. */}
						<MenuBackdrop
							label={
								view === "feedback"
									? "Close feedback"
									: `Close ${menuName.toLowerCase()} menu`
							}
							dimmed={view === "feedback"}
							onClose={closeAndReturn}
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
								leading={
									leading && (
										<>
											<p className={MENU_HEADING}>{leading.heading}</p>
											{leading.rows(closeAndReturn)}
										</>
									)
								}
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
