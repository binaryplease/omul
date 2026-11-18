import {
	Check,
	Ellipsis,
	ExternalLink,
	Languages,
	MessageSquareText,
	X,
} from "lucide-react";
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
import { type Dict, getDict } from "../../i18n";
import {
	useInterfaceLanguage,
	useInterfaceText,
} from "../../interface-language";
import {
	ENGLISH_INTERFACE_TEXT,
	fillText,
	INTERFACE_LANGUAGE_NAMES,
	INTERFACE_LANGUAGES,
	type InterfaceLanguage,
	type InterfaceLanguagePreference,
	type InterfaceText,
} from "../../interface-text";
import { routeForLocation } from "../../router";
import type { FeedbackSurface, LegalLinks } from "../../types";
import { BRAND_NAME } from "../BrandMark";
import {
	FeedbackForm,
	type FeedbackFormContact,
	type FeedbackFormHeading,
	type FeedbackFormLabels,
	feedbackFormLabelsFor,
} from "../FeedbackForm";
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

// ── App menu: appearance, language, feedback + legal texts (REQ183, REQ185, REQ248) ──
//
// One small trigger, wherever a screen offers the theme switch, opening a panel
// with up to four sections: the Light / Dark / Auto choice, the interface
// language (REQ248) on every screen but the two that speak the deck's
// language, "Send feedback" when this deployment collects it (REQ185), and the
// operator's legal texts. It is what puts the imprint, the privacy policy and the terms within
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
//
// The menu speaks the language of the screen it sits on (REQ225, REQ248). The
// participant's screens speak the deck's language (REQ084), so there the
// trigger's name, the panel and the feedback dialog do too, and the menu
// offers no Language section. The preview offers none either and stays
// English. Every other screen is an organizer's, and there the menu speaks the
// interface language: its words come from the deck dictionary of that
// language, which holds them all already, and the Language section's own
// words from the interface text (`src/interface-text/app-menu.ts`). The
// dictionary's words arrive as one descriptor, `appMenuLabelsFor`.

/** Everything the menu says, in one language. */
export type AppMenuLabels = {
	/** The trigger's name, without and with the feedback item. */
	name: string;
	nameWithFeedback: string;
	/** The click-away backdrop's name, without and with the feedback item. */
	close: string;
	closeWithFeedback: string;
	appearance: string;
	themes: Record<ThemePreference, string>;
	sendFeedback: string;
	legal: string;
	legalTexts: Record<keyof LegalLinks, string>;
	/** Told to a screen reader after each legal text's name. */
	opensInNewTab: string;
	closeFeedback: string;
	feedbackForm: FeedbackFormLabels;
};

/** The menu's words out of a language's dictionary, mapped in one place. */
export function appMenuLabelsFor(dict: Dict): AppMenuLabels {
	return {
		name: dict.menuName,
		nameWithFeedback: dict.menuNameWithFeedback,
		close: dict.menuClose,
		closeWithFeedback: dict.menuCloseWithFeedback,
		appearance: dict.menuAppearance,
		themes: {
			light: dict.themeLight,
			dark: dict.themeDark,
			auto: dict.themeAuto,
		},
		sendFeedback: dict.menuSendFeedback,
		legal: dict.menuLegal,
		legalTexts: {
			imprintUrl: dict.legalImprint,
			privacyUrl: dict.legalPrivacy,
			termsUrl: dict.legalTerms,
		},
		opensInNewTab: dict.opensInNewTab,
		closeFeedback: dict.feedbackDialogClose,
		feedbackForm: feedbackFormLabelsFor(dict),
	};
}

/** The menu in English: the default of every helper that takes labels. */
export const APP_MENU_LABELS_EN: AppMenuLabels = appMenuLabelsFor(getDict("en"));

/** Marks the panel's rows that are tab stops, for the panel's own Tab rule. */
const MENU_ITEM_ATTRIBUTE = "data-app-menu-item";

/**
 * The Language section's words and the names the menu takes while it holds
 * the section, in the interface language (REQ248).
 */
export type AppMenuText = InterfaceText["appMenu"];

/**
 * What the trigger is called, naming what the panel holds. With the feedback
 * channel off the menu is exactly what it was before REQ185, name included.
 * `languageText` is passed where the menu holds the Language section, which
 * then joins the name (REQ248).
 */
export function appMenuName(
	feedbackEnabled: boolean,
	labels: AppMenuLabels = APP_MENU_LABELS_EN,
	languageText?: AppMenuText,
): string {
	if (languageText) {
		return feedbackEnabled
			? languageText.menuNameWithLanguageAndFeedback
			: languageText.menuNameWithLanguage;
	}
	return feedbackEnabled ? labels.nameWithFeedback : labels.name;
}

/** The click-away backdrop's name, by what the panel holds. */
export function appMenuCloseLabel(
	feedbackEnabled: boolean,
	labels: AppMenuLabels = APP_MENU_LABELS_EN,
	languageText?: AppMenuText,
): string {
	if (languageText) {
		return feedbackEnabled
			? languageText.closeWithLanguageAndFeedback
			: languageText.closeWithLanguage;
	}
	return feedbackEnabled ? labels.closeWithFeedback : labels.close;
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
	labels: AppMenuLabels = APP_MENU_LABELS_EN,
	languageText?: AppMenuText,
): string {
	const menuName = appMenuName(feedbackEnabled, labels, languageText);
	const nameInList =
		languageText?.nameInList ?? ENGLISH_INTERFACE_TEXT.appMenu.nameInList;
	return leadingLabel ? `${leadingLabel}, ${nameInList(menuName)}` : menuName;
}

/**
 * The interface language as the Language section offers it: the stored
 * preference, what "Automatic" reads now, the way to change it, and the
 * section's words in the interface language.
 */
export type AppMenuLanguageChoice = {
	preference: InterfaceLanguagePreference;
	automaticLanguage: InterfaceLanguage;
	onChange: (preference: InterfaceLanguagePreference) => void;
	language: InterfaceLanguage;
	text: AppMenuText;
};

/** The Language section's rows, in the order offered: Automatic, then each language. */
const LANGUAGE_PREFERENCES: readonly InterfaceLanguagePreference[] = [
	"auto",
	...INTERFACE_LANGUAGES,
];

/**
 * Arrow keys move a radio group's choice, as in any radio group, and focus
 * follows it; the chosen option is the group's one tab stop. Shared by the
 * Appearance and the Language sections.
 */
function moveRadioChoice<Value extends string>(
	event: KeyboardEvent<HTMLDivElement>,
	values: readonly Value[],
	current: Value,
	choose: (value: Value) => void,
	attribute: string,
) {
	const step =
		event.key === "ArrowRight" || event.key === "ArrowDown"
			? 1
			: event.key === "ArrowLeft" || event.key === "ArrowUp"
				? -1
				: 0;
	if (step === 0) return;
	event.preventDefault();
	const index = values.indexOf(current);
	const next = values[(index + step + values.length) % values.length];
	choose(next);
	event.currentTarget
		.querySelector<HTMLButtonElement>(`[${attribute}="${next}"]`)
		?.focus();
}

/**
 * The Language section (REQ248): one checked row among Automatic and each
 * offered language, each language named in itself. Outside English its heading
 * carries the English word after its own ("Sprache · Language"), so an
 * organizer stuck in a language they cannot read still finds the way back.
 */
function LanguageSection({
	id,
	choice,
}: {
	id: string;
	choice: AppMenuLanguageChoice;
}) {
	const headingId = `${id}-language`;
	return (
		<>
			<p id={headingId} className={`${MENU_HEADING} flex items-center gap-1.5`}>
				<Languages size={13} aria-hidden />
				{choice.text.language}
				{choice.language !== "en" && (
					<>
						{" · "}
						<span lang="en">{ENGLISH_INTERFACE_TEXT.appMenu.language}</span>
					</>
				)}
			</p>
			<div
				role="radiogroup"
				aria-labelledby={headingId}
				onKeyDown={(event) =>
					moveRadioChoice(
						event,
						LANGUAGE_PREFERENCES,
						choice.preference,
						choice.onChange,
						"data-language-option",
					)
				}
				className="mb-1"
			>
				{LANGUAGE_PREFERENCES.map((preference) => {
					const checked = choice.preference === preference;
					const automatic = preference === "auto";
					return (
						<button
							key={preference}
							type="button"
							role="radio"
							aria-checked={checked}
							tabIndex={checked ? 0 : -1}
							data-language-option={preference}
							lang={automatic ? undefined : preference}
							onClick={() => choice.onChange(preference)}
							className={MENU_ROW}
						>
							<span>
								{automatic ? (
									<>
										{choice.text.languageAutomatic} (
										<span lang={choice.automaticLanguage}>
											{INTERFACE_LANGUAGE_NAMES[choice.automaticLanguage]}
										</span>
										)
									</>
								) : (
									INTERFACE_LANGUAGE_NAMES[preference]
								)}
							</span>
							{checked && (
								<Check
									size={14}
									aria-hidden
									className="flex-shrink-0 text-accent-text"
								/>
							)}
						</button>
					);
				})}
			</div>
		</>
	);
}

/**
 * The panel's contents for a given theme and set of addresses. The Legal
 * section lists exactly the configured texts, in descriptor order, and is
 * absent when none is configured — the menu then holds Appearance alone.
 * "Send feedback" sits between the two, and only when `feedbackEnabled` —
 * which the menu takes from `GET /api/feedback/config` and nothing else. The
 * Language section sits below Appearance, and only when `languageChoice` is
 * given (REQ248).
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
	labels = APP_MENU_LABELS_EN,
	languageChoice,
	lang,
	leadingLang,
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
	labels?: AppMenuLabels;
	/** The Language section, below Appearance; absent where it is not offered. */
	languageChoice?: AppMenuLanguageChoice;
	/**
	 * The language `labels` are in. The panel is portaled away from its
	 * trigger, so it says its own language rather than inheriting the portal
	 * host's.
	 */
	lang?: string;
	/**
	 * The language of the screen's own `leading` section, which is not the
	 * menu's own while that screen is untranslated (REQ248).
	 */
	leadingLang?: string;
}) {
	const legalLinks = configuredLegalLinks(links);
	const anyChecked = THEME_OPTIONS.some((option) => option.value === theme);
	const themeValues = THEME_OPTIONS.map((option) => option.value);

	return (
		<div
			ref={ref}
			id={id}
			lang={lang}
			onKeyDown={onKeyDown}
			className={`${MENU_PANEL} ${leading ? "w-64" : "w-62"}`}
		>
			{leading && (
				<>
					<div lang={leadingLang} className="contents">
						{leading}
					</div>
					<div aria-hidden className={MENU_DIVIDER} />
				</>
			)}
			<p id={`${id}-appearance`} className={MENU_HEADING}>
				{labels.appearance}
			</p>
			<div
				role="radiogroup"
				aria-labelledby={`${id}-appearance`}
				onKeyDown={(event) =>
					moveRadioChoice(
						event,
						themeValues,
						theme,
						onThemeChange,
						"data-theme-option",
					)
				}
				className="mx-1 mb-1.5 grid grid-cols-3 gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5"
			>
				{THEME_OPTIONS.map(({ value, Icon }, index) => {
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
							{labels.themes[value]}
						</button>
					);
				})}
			</div>
			{languageChoice && (
				<>
					<div aria-hidden className={MENU_DIVIDER} />
					<LanguageSection id={id} choice={languageChoice} />
				</>
			)}
			{feedbackEnabled && (
				<>
					<div aria-hidden className={MENU_DIVIDER} />
					<button
						type="button"
						{...{ [MENU_ITEM_ATTRIBUTE]: "" }}
						onClick={onSendFeedback}
						className={MENU_ROW}
					>
						<span>{labels.sendFeedback}</span>
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
							{labels.legal}
						</p>
						{legalLinks.map((link) => (
							<LegalLink
								key={link.field}
								href={link.href}
								className={MENU_ROW}
							>
								<span>
									{labels.legalTexts[link.field]}
									<span className="sr-only"> {labels.opensInNewTab}</span>
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
	labels,
	lang,
	heading,
	contact,
}: {
	id: string;
	origin: FeedbackOrigin;
	onClose: () => void;
	labels: AppMenuLabels;
	/** The language `labels` are in, as on the panel. */
	lang?: string;
	/**
	 * The heading and the contact box in the interface language, on an
	 * organizer's screen (REQ248). Without them they are English.
	 */
	heading?: FeedbackFormHeading;
	contact?: FeedbackFormContact;
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
				lang={lang}
				onKeyDown={handleDialogKey}
				className="pointer-events-auto flex max-h-full w-full max-w-md items-start gap-2 overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-left shadow-2xl popover-in"
			>
				<div className="min-w-0 flex-1">
					<FeedbackForm
						headingId={headingId}
						labels={labels.feedbackForm}
						heading={heading}
						contact={contact}
						contactEmail={contactEmail}
						onSend={sendFeedback}
						onDone={onClose}
					/>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label={labels.closeFeedback}
					title={labels.closeFeedback}
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

/** The feedback dialog's heading in the interface language (REQ248). */
function feedbackHeadingFor(text: InterfaceText["appMenu"]): FeedbackFormHeading {
	return {
		lead: fillText(text.feedbackHeadingLead, { brand: BRAND_NAME }),
		recipient: fillText(text.feedbackHeadingRecipient, { brand: BRAND_NAME }),
	};
}

/** The feedback dialog's contact box in the interface language (REQ248). */
function feedbackContactFor(text: InterfaceText["appMenu"]): FeedbackFormContact {
	return {
		label: text.contactMe,
		address: (email) => fillText(text.contactAddress, { email }),
	};
}

/** Focus on open with a leading section: its first enabled row, else the theme. */
const LEADING_INITIAL_FOCUS = `[${BAR_MENU_ROW_ATTRIBUTE}]:not(:disabled), [role="radio"][tabindex="0"]`;

/**
 * The theme switch, feedback and the legal texts, behind one icon button.
 * Without `className` and `leading` it is the same menu on every surface;
 * `className` is appended to the trigger's own, and `leading` puts a screen's
 * section above Appearance.
 *
 * `speaksDeckLanguage` marks the two screens that speak the deck's language
 * rather than the interface's — the participant screen and the preview
 * (REQ084, REQ248): there the menu offers no Language section and speaks
 * `language`, the deck's, or English where none is given (REQ225). Every other
 * screen's menu offers the Language section and speaks the interface language.
 */
export function AppMenu({
	className = "",
	leading,
	speaksDeckLanguage = false,
	language,
}: {
	className?: string;
	leading?: AppMenuLeading;
	speaksDeckLanguage?: boolean;
	language?: string;
} = {}) {
	const { theme, setTheme } = useTheme();
	const interfaceText = useInterfaceText();
	const { preference, automaticLanguage, setPreference } =
		useInterfaceLanguage();
	// The dictionary the menu's words come from; its `locale` is the `lang`
	// the panel and the dialog declare.
	const menuDict = getDict(
		speaksDeckLanguage ? (language ?? "en") : interfaceText.language,
	);
	const menuLanguage = menuDict.locale;
	const labels = appMenuLabelsFor(menuDict);
	const languageChoice: AppMenuLanguageChoice | undefined = speaksDeckLanguage
		? undefined
		: {
				preference,
				automaticLanguage,
				onChange: setPreference,
				language: interfaceText.language,
				text: interfaceText.text.appMenu,
			};
	const languageText = languageChoice?.text;
	// Read on mount, not on open, so the links and the feedback item are there
	// the first time.
	const links = useLegalLinks();
	const feedbackEnabled = useFeedbackConfig().enabled;
	const [view, setView] = useState<AppMenuView>("closed");
	const [feedbackOrigin, setFeedbackOrigin] = useState<FeedbackOrigin | null>(
		null,
	);
	const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
	// The screen's language, read from the trigger, which is not portaled.
	const [screenLang, setScreenLang] = useState<string>("en");
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const panelId = useId();
	const open = view === "panel";
	const menuName = appMenuName(feedbackEnabled, labels, languageText);

	const close = useCallback((returnFocus: boolean) => {
		setView("closed");
		if (returnFocus) triggerRef.current?.focus();
	}, []);
	const closeAndReturn = useCallback(() => close(true), [close]);

	const openPanel = () => {
		setPortalHost(menuPortalHost(triggerRef.current));
		setScreenLang(screenLanguage(triggerRef.current));
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
				label={appMenuTriggerLabel(
					feedbackEnabled,
					leading?.label,
					labels,
					languageText,
				)}
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
									? labels.closeFeedback
									: appMenuCloseLabel(feedbackEnabled, labels, languageText)
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
								labels={labels}
								languageChoice={languageChoice}
								lang={menuLanguage}
								leadingLang={screenLang}
							/>
						)}
						{view === "feedback" && feedbackOrigin && (
							<AppMenuFeedbackDialog
								id={panelId}
								origin={feedbackOrigin}
								onClose={() => close(true)}
								labels={labels}
								lang={menuLanguage}
								heading={languageText && feedbackHeadingFor(languageText)}
								contact={languageText && feedbackContactFor(languageText)}
							/>
						)}
					</>,
					portalHost,
				)}
		</>
	);
}
