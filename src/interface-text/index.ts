// ── The organizer's interface language (REQ248) ─────────────
//
// What an organizer reads — chrome, menus, dialogs, panels, toasts, disabled
// reasons, every control's label, `aria-label` and `title` — in a language of
// its own, chosen per browser in the app menu. It is a separate thing from the
// deck's language (REQ084, `src/i18n.ts`), which is the audience's: neither
// sets the other, and text the room reads stays with the deck's `Dict`.
//
// The English text is the source. Each section file beside this one exports
// `en`, an entry for every key, and `de`, a German entry per key; a key with no
// German entry reads English, never a blank and never a key name. Components
// read the text through `useInterfaceText()` (`src/interface-language.tsx`),
// and nothing here imports React, so the reading is testable without a DOM.
//
// A section is one surface's strings, and each belongs to one slice of REQ248
// (`interface-text.test.ts`): a key of a done slice's sections without a
// German entry fails the test.

import { fillTemplate, type PluralForms } from "../i18n";
import * as accessibility from "./accessibility";
import * as account from "./account";
import * as answerThemes from "./answer-themes";
import * as appMenu from "./app-menu";
import * as deckMerge from "./deck-merge";
import * as deckSettings from "./deck-settings";
import * as deckTheme from "./deck-theme";
import * as dialogs from "./dialogs";
import * as editor from "./editor";
import * as generate from "./generate";
import * as home from "./home";
import * as join from "./join";
import * as legalNotice from "./legal-notice";
import * as liveRoom from "./live-room";
import * as panels from "./panels";
import * as presenterPage from "./presenter-page";
import * as presentingView from "./presenting-view";
import * as quizAnswerKey from "./quiz-answer-key";
import * as share from "./share";
import * as sharedResults from "./shared-results";
import * as sharing from "./sharing";
import * as slideCanvas from "./slide-canvas";
import * as slideSettings from "./slide-settings";
import * as slideView from "./slide-view";
import * as templates from "./templates";
import * as ui from "./ui";
import * as workspaces from "./workspaces";

/**
 * The interface languages, in the order the app menu offers them. Each is also
 * a deck language, so `getDict(language)` holds its words for a surface that
 * shares them with the room (the app menu, REQ225).
 */
export const INTERFACE_LANGUAGES = ["en", "de"] as const;

export type InterfaceLanguage = (typeof INTERFACE_LANGUAGES)[number];

/** What the browser stores: a language, or "follow the browser". */
export type InterfaceLanguagePreference = "auto" | InterfaceLanguage;

/** Each language named in itself, as the deck's language picker names them. */
export const INTERFACE_LANGUAGE_NAMES: Record<InterfaceLanguage, string> = {
	en: "English",
	de: "Deutsch",
};

function isInterfaceLanguage(value: string): value is InterfaceLanguage {
	return (INTERFACE_LANGUAGES as readonly string[]).includes(value);
}

/** A stored preference, read back; a missing or unknown value is `"auto"`. */
export function readInterfaceLanguagePreference(
	stored: string | null,
): InterfaceLanguagePreference {
	return stored !== null && isInterfaceLanguage(stored) ? stored : "auto";
}

/**
 * The language a preference draws the interface in. `"auto"` is the first of
 * the browser's languages whose primary subtag is offered — `de-AT, en` reads
 * German, `fr-FR, en-GB` English, because French is not offered — and English
 * when none is.
 */
export function resolveInterfaceLanguage(
	preference: InterfaceLanguagePreference,
	browserLanguages: readonly string[],
): InterfaceLanguage {
	if (preference !== "auto") return preference;
	for (const tag of browserLanguages) {
		const primary = tag.split("-")[0]?.toLowerCase() ?? "";
		if (isInterfaceLanguage(primary)) return primary;
	}
	return "en";
}

const SECTIONS = {
	accessibility,
	account,
	answerThemes,
	appMenu,
	deckMerge,
	deckSettings,
	deckTheme,
	dialogs,
	editor,
	generate,
	home,
	join,
	legalNotice,
	liveRoom,
	panels,
	presenterPage,
	presentingView,
	quizAnswerKey,
	share,
	sharedResults,
	sharing,
	slideCanvas,
	slideSettings,
	slideView,
	templates,
	ui,
	workspaces,
};

export type InterfaceSection = keyof typeof SECTIONS;

/** Every section's English entries — the shape every language is read in. */
export type InterfaceText = {
	[Section in InterfaceSection]: (typeof SECTIONS)[Section]["en"];
};

/** The section names, for the completeness test. */
export const INTERFACE_SECTIONS = Object.keys(SECTIONS) as InterfaceSection[];

/**
 * The keys of `section` that have no German entry. Empty for a section that
 * is complete; the completeness test holds the done slices' sections to that.
 */
export function germanGaps(section: InterfaceSection): string[] {
	const german: Record<string, unknown> = SECTIONS[section].de;
	return Object.keys(SECTIONS[section].en).filter(
		(key) => german[key] === undefined || german[key] === "",
	);
}

function buildInterfaceText(language: InterfaceLanguage): InterfaceText {
	const text: Record<string, unknown> = {};
	for (const section of INTERFACE_SECTIONS) {
		const { en, de } = SECTIONS[section];
		text[section] = language === "de" ? { ...en, ...de } : en;
	}
	return text as InterfaceText;
}

const INTERFACE_TEXTS: Record<InterfaceLanguage, InterfaceText> = {
	en: buildInterfaceText("en"),
	de: buildInterfaceText("de"),
};

/** The interface text for a language, English filling every gap per key. */
export function interfaceTextFor(language: InterfaceLanguage): InterfaceText {
	return INTERFACE_TEXTS[language];
}

/**
 * The English interface text, for a pure helper whose callers have no
 * provider (tests, and surfaces that do not follow the interface language) and
 * as the default argument of helpers that take a `text`.
 */
export const ENGLISH_INTERFACE_TEXT = INTERFACE_TEXTS.en;

/**
 * `template` with each `{name}` replaced by its value — the deck's
 * `fillTemplate`, under the name the interface surfaces call it by.
 */
export function fillText(
	template: string,
	values: Record<string, string | number>,
): string {
	return fillTemplate(template, values);
}

/**
 * A text that changes with a count: the deck's `PluralForms`, one form per
 * plural category English and German use (`one` and `other`). A language with
 * more categories adds them when it joins.
 */
export type PluralText = PluralForms;

/** A date, without its time, in the interface language's format. */
export function formatDate(
	language: InterfaceLanguage,
	value: string | number | Date,
): string {
	return new Date(value).toLocaleDateString(language);
}

/** A number in the interface language's format: `1,200` in English, `1.200` in German. */
export function formatNumber(language: InterfaceLanguage, value: number): string {
	return new Intl.NumberFormat(language).format(value);
}

/**
 * A counted phrase in the interface language: the form its plural rules
 * choose for `count`, with `{count}` in the language's number format and any
 * other slot filled by `fillTemplate`.
 *
 * The forms are the deck's `PluralForms` (REQ225), so one shape serves both.
 * The deck's `countPhrase` is not reused because it writes the count
 * unformatted, which the room-facing surfaces of REQ225 print today.
 */
export function pluralText(
	language: InterfaceLanguage,
	count: number,
	forms: PluralForms,
	values: Record<string, string | number> = {},
): string {
	const category = new Intl.PluralRules(language).select(count);
	return fillTemplate(category === "one" ? forms.one : forms.other, {
		...values,
		count: formatNumber(language, count),
	});
}
