import type React from "react";
import {
	createContext,
	Fragment,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	ENGLISH_INTERFACE_TEXT,
	type InterfaceLanguage,
	type InterfaceLanguagePreference,
	type InterfaceText,
	interfaceTextFor,
	readInterfaceLanguagePreference,
	resolveInterfaceLanguage,
} from "./interface-text";
import { INTERFACE_LANGUAGE_KEY } from "./storage";

// ── The interface language, held for the app (REQ248) ───────
//
// One provider at the root holds the browser's choice and the language it
// resolves to. Components read their text through `useInterfaceText()`, and a
// choice re-renders them at once, without a reload. The choice is stored per
// browser and read on load, so another open tab picks it up on its next load.
//
// The language rule: a participant- or room-facing surface speaks the deck's
// language (REQ084, REQ225, `src/i18n.ts`) and never reads this provider; an
// organizer surface speaks the interface language.
//
// The provider also holds `<html lang>`. It is English, the language every
// screen whose slice is not built is still written in, unless the mounted
// screen declares its own with `useDocumentLanguage()`. A screen declares the
// interface language once its slice translates it; until then the app menu,
// which is translated, carries its own `lang`.

type InterfaceLanguageState = {
	preference: InterfaceLanguagePreference;
	language: InterfaceLanguage;
	/** What `"auto"` reads right now, for the menu's "Automatic (…)" row. */
	automaticLanguage: InterfaceLanguage;
	setPreference: (preference: InterfaceLanguagePreference) => void;
	/** A screen's own `<html lang>`, or `null` to hand it back. */
	setDocumentLanguage: (language: string | null) => void;
};

const InterfaceLanguageContext = createContext<InterfaceLanguageState>({
	preference: "auto",
	language: "en",
	automaticLanguage: "en",
	setPreference: () => {},
	setDocumentLanguage: () => {},
});

function browserLanguages(): readonly string[] {
	if (typeof navigator === "undefined") return [];
	return navigator.languages?.length
		? navigator.languages
		: [navigator.language ?? ""];
}

function readStoredPreference(): InterfaceLanguagePreference {
	try {
		return readInterfaceLanguagePreference(
			localStorage.getItem(INTERFACE_LANGUAGE_KEY),
		);
	} catch {
		return "auto";
	}
}

/** `<html lang>` on a screen that declares none, as `src/index.html` has it. */
export const DEFAULT_DOCUMENT_LANGUAGE = "en";

export function InterfaceLanguageProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [preference, setPreferenceState] =
		useState<InterfaceLanguagePreference>(readStoredPreference);
	const [documentLanguage, setDocumentLanguage] = useState<string | null>(
		null,
	);
	const automaticLanguage = resolveInterfaceLanguage(
		"auto",
		browserLanguages(),
	);
	const language = preference === "auto" ? automaticLanguage : preference;

	const setPreference = useCallback((next: InterfaceLanguagePreference) => {
		setPreferenceState(next);
		try {
			localStorage.setItem(INTERFACE_LANGUAGE_KEY, next);
		} catch {
			// A browser that refuses storage still switches for this load.
		}
	}, []);

	useEffect(() => {
		document.documentElement.lang =
			documentLanguage ?? DEFAULT_DOCUMENT_LANGUAGE;
	}, [documentLanguage]);

	const value = useMemo(
		() => ({
			preference,
			language,
			automaticLanguage,
			setPreference,
			setDocumentLanguage,
		}),
		[preference, language, automaticLanguage, setPreference],
	);

	return (
		<InterfaceLanguageContext.Provider value={value}>
			{children}
		</InterfaceLanguageContext.Provider>
	);
}

/**
 * Draws `children` in `language` rather than the browser's interface language:
 * for interface surfaces mounted on a screen that speaks the deck's language,
 * the participant screen's sign-in dialog and reset landing (REQ134). That
 * screen hands in the deck's language where it is an interface language and
 * English where it is not. The stored choice and the way to change it pass
 * through unchanged.
 */
export function InterfaceLanguageScope({
	language,
	children,
}: {
	language: InterfaceLanguage;
	children: React.ReactNode;
}) {
	const outer = useContext(InterfaceLanguageContext);
	const value = useMemo(() => ({ ...outer, language }), [outer, language]);
	return (
		<InterfaceLanguageContext.Provider value={value}>
			{children}
		</InterfaceLanguageContext.Provider>
	);
}

/** The browser's choice, what it resolves to, and the way to change it. */
export function useInterfaceLanguage(): InterfaceLanguageState {
	return useContext(InterfaceLanguageContext);
}

/**
 * The one reading point for interface text: the strings in the interface
 * language, English filling any key without an entry, and the language they
 * are in, for `pluralText`, `formatNumber` and a `lang` attribute.
 */
export function useInterfaceText(): {
	text: InterfaceText;
	language: InterfaceLanguage;
} {
	const { language } = useContext(InterfaceLanguageContext);
	return { text: interfaceTextFor(language), language };
}

/**
 * The English interface text, for a surface that does not follow the interface
 * language (the app menu on the participant screen and the preview).
 */
export const englishInterfaceText = {
	text: ENGLISH_INTERFACE_TEXT,
	language: "en" as const,
};

/**
 * Sets `<html lang>` to `language` while the calling screen is mounted, and
 * hands it back to English on unmount. A screen calls it with the interface
 * language once its slice translates it, or with the deck's language where the
 * whole screen speaks the deck's. `undefined` leaves the English default.
 */
export function useDocumentLanguage(language: string | undefined) {
	const { setDocumentLanguage } = useContext(InterfaceLanguageContext);
	useEffect(() => {
		if (!language) return;
		setDocumentLanguage(language);
		return () => setDocumentLanguage(null);
	}, [language, setDocumentLanguage]);
}

/**
 * `template` with each `{placeholder}` replaced by `element`: a sentence that
 * draws one of its words as an element of its own (a link, an emphasised title)
 * wherever the language puts that word.
 */
export function textWithElement(
	template: string,
	placeholder: string,
	element: React.ReactNode,
): React.ReactNode {
	return textWithElements(template, { [placeholder]: element });
}

/**
 * `template` with each `{placeholder}` named in `elements` replaced by its
 * element: a sentence that draws several of its words as elements of their own
 * (two addresses), wherever the language puts each. A placeholder not named
 * stays as written.
 */
export function textWithElements(
	template: string,
	elements: Record<string, React.ReactNode>,
): React.ReactNode {
	const parts = template.split(/\{(\w+)\}/);
	return (
		<>
			{parts.map((part, index) =>
				// Odd parts are the placeholders' names, between the text around them.
				index % 2 === 0 ? (
					part
				) : (
					<Fragment key={index}>
						{part in elements ? elements[part] : `{${part}}`}
					</Fragment>
				),
			)}
		</>
	);
}
