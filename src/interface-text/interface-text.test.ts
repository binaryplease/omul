/**
 * The organizer's interface language (REQ248): which language a browser
 * gets, the English fallback per key, and the completeness of every slice
 * that is done.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEGMENT_UNANSWERED_LABEL } from "../../server/segmentation";
import {
	deckAccessLevelLabel,
	deckAccessLevelSummary,
} from "../components/CollaboratorsDialog";
import { resultsLinkIssuedLabel } from "../components/ResultsLinkDialog";
import { slideCommentTimeLabel } from "../components/SlideComments";
import { SLIDE_TYPE_SECTIONS } from "../components/SlideTypeMenu";
import {
	workspaceRoleLabel,
	workspaceRoleSummary,
} from "../components/WorkspaceRoles";
import { DEFAULT_DOCUMENT_LANGUAGE } from "../interface-language";
import {
	type DeckAccessLevel,
	SEGMENT_REFUSAL_REASONS,
	WORKSPACE_ROLES,
} from "../types";
import {
	dateLocale,
	ENGLISH_INTERFACE_TEXT,
	fillText,
	formatDate,
	formatNumber,
	germanGaps,
	INTERFACE_LANGUAGE_NAMES,
	INTERFACE_LANGUAGES,
	INTERFACE_SECTIONS,
	type InterfaceSection,
	interfaceTextFor,
	pluralText,
	readInterfaceLanguagePreference,
	resolveInterfaceLanguage,
} from ".";

describe("the stored choice", () => {
	test("a language or auto reads back as itself", () => {
		expect(readInterfaceLanguagePreference("auto")).toBe("auto");
		expect(readInterfaceLanguagePreference("en")).toBe("en");
		expect(readInterfaceLanguagePreference("de")).toBe("de");
	});

	test("a missing or unknown value reads as auto", () => {
		expect(readInterfaceLanguagePreference(null)).toBe("auto");
		expect(readInterfaceLanguagePreference("")).toBe("auto");
		expect(readInterfaceLanguagePreference("fr")).toBe("auto");
		expect(readInterfaceLanguagePreference("DE")).toBe("auto");
	});
});

describe("Automatic follows the browser's languages", () => {
	test("the first offered primary subtag wins", () => {
		expect(resolveInterfaceLanguage("auto", ["de-AT", "en"])).toBe("de");
		expect(resolveInterfaceLanguage("auto", ["de-DE"])).toBe("de");
		expect(resolveInterfaceLanguage("auto", ["en-US", "de"])).toBe("en");
	});

	test("a language not offered is passed over, not mapped", () => {
		expect(resolveInterfaceLanguage("auto", ["fr-FR", "en-GB"])).toBe("en");
		expect(resolveInterfaceLanguage("auto", ["fr-FR", "de"])).toBe("de");
	});

	test("English when no browser language is offered", () => {
		expect(resolveInterfaceLanguage("auto", ["fr-FR"])).toBe("en");
		expect(resolveInterfaceLanguage("auto", [])).toBe("en");
		expect(resolveInterfaceLanguage("auto", [""])).toBe("en");
	});

	test("an explicit choice ignores the browser", () => {
		expect(resolveInterfaceLanguage("de", ["en-US"])).toBe("de");
		expect(resolveInterfaceLanguage("en", ["de-DE"])).toBe("en");
	});

	test("the subtag is read case-insensitively", () => {
		expect(resolveInterfaceLanguage("auto", ["DE-ch"])).toBe("de");
	});
});

describe("the offered languages", () => {
	test("English and German, each named in itself", () => {
		expect([...INTERFACE_LANGUAGES]).toEqual(["en", "de"]);
		expect(INTERFACE_LANGUAGE_NAMES).toEqual({ en: "English", de: "Deutsch" });
	});
});

describe("text and its fallback", () => {
	test("German reads the German entry", () => {
		expect(interfaceTextFor("de").appMenu.language).toBe("Sprache");
		expect(interfaceTextFor("en").appMenu.language).toBe("Language");
	});

	test("every section reads every English key in every language, never blank", () => {
		for (const language of INTERFACE_LANGUAGES) {
			const text = interfaceTextFor(language);
			for (const section of INTERFACE_SECTIONS) {
				const entries: Record<string, unknown> = text[section];
				for (const key of Object.keys(ENGLISH_INTERFACE_TEXT[section])) {
					expect(entries[key]).toBeDefined();
					expect(entries[key]).not.toBe("");
				}
			}
		}
	});

	test("pluralText picks the form by the language's rules and formats the count", () => {
		const english = { one: "{count} vote", other: "{count} votes" };
		expect(pluralText("en", 1, english)).toBe("1 vote");
		expect(pluralText("en", 0, english)).toBe("0 votes");
		expect(pluralText("en", 1200, english)).toBe("1,200 votes");
		const german = { one: "{count} Stimme", other: "{count} Stimmen" };
		expect(pluralText("de", 1, german)).toBe("1 Stimme");
		expect(pluralText("de", 1200, german)).toBe("1.200 Stimmen");
	});

	test("pluralText fills the other slots and keeps the formatted count", () => {
		const forms = { one: "{count} in {room}", other: "{count} in {room}" };
		expect(pluralText("de", 2500, forms, { room: "Saal", count: 7 })).toBe(
			"2.500 in Saal",
		);
	});

	test("fillText fills each named placeholder and leaves unknown ones", () => {
		expect(fillText("{count} in the room", { count: 3 })).toBe("3 in the room");
		expect(fillText("{a} and {b}", { a: "x" })).toBe("x and {b}");
	});

	test("numbers take the interface language's format", () => {
		expect(formatNumber("en", 1234.5)).toBe("1,234.5");
		expect(formatNumber("de", 1234.5)).toBe("1.234,5");
	});
});

/**
 * REQ248's slices, by the sections that hold their surfaces' strings. A slice
 * marked done fails here when any of its keys has no German entry; a slice
 * still open may hold English-only keys, which read English by the fallback.
 * Every slice is built, so every section is held complete.
 */
const SLICES: { slice: string; done: boolean; sections: InterfaceSection[] }[] =
	[
		{ slice: "REQ248/1-mechanism", done: true, sections: ["appMenu"] },
		{
			slice: "REQ248/2-presenter-chrome",
			done: true,
			sections: [
				"dialogs",
				"liveRoom",
				"panels",
				"presenterPage",
				"presentingView",
				"share",
				"ui",
			],
		},
		{ slice: "REQ248/3-presenter-room", done: true, sections: ["slideView"] },
		{
			slice: "REQ248/4-editor-shell",
			done: true,
			sections: ["deckMerge", "editor", "legalNotice"],
		},
		{
			slice: "REQ248/5-slide-settings",
			done: true,
			sections: ["quizAnswerKey", "slideSettings"],
		},
		{
			slice: "REQ248/6-slide-canvas",
			done: true,
			sections: ["accessibility", "deckTheme", "slideCanvas"],
		},
		{
			slice: "REQ248/7-deck-settings",
			done: true,
			sections: ["answerThemes", "deckSettings"],
		},
		{ slice: "REQ248/8-home", done: true, sections: ["home", "sharing"] },
		{ slice: "REQ248/9-workspaces", done: true, sections: ["workspaces"] },
		{
			slice: "REQ248/10-public-pages",
			done: true,
			sections: ["generate", "join", "sharedResults", "templates"],
		},
		{ slice: "REQ248/11-account-and-menu", done: true, sections: ["account"] },
	];

describe("each done slice is complete in German (REQ248)", () => {
	test("every section belongs to exactly one slice", () => {
		const assigned = SLICES.flatMap((slice) => slice.sections).sort();
		expect(assigned).toEqual([...INTERFACE_SECTIONS].sort());
	});

	for (const { slice, done, sections } of SLICES) {
		if (!done) continue;
		for (const section of sections) {
			test(`${slice}: every key of ${section} has a German entry`, () => {
				expect(germanGaps(section)).toEqual([]);
			});
		}
	}

	test("every done slice's sections are not empty", () => {
		for (const { done, sections } of SLICES) {
			if (!done) continue;
			for (const section of sections) {
				expect(Object.keys(ENGLISH_INTERFACE_TEXT[section]).length).toBeGreaterThan(0);
			}
		}
	});

	test("the German app menu names its sections in German", () => {
		const german = interfaceTextFor("de").appMenu;
		expect(german.menuNameWithLanguage).toBe(
			"Darstellung, Sprache und Rechtliches",
		);
		expect(german.nameInList("Darstellung und Rechtliches")).toBe(
			"Darstellung und Rechtliches",
		);
		expect(ENGLISH_INTERFACE_TEXT.appMenu.nameInList("Appearance and legal")).toBe(
			"appearance and legal",
		);
	});

	test("the editor's tables name every slide type and deck field in German too", () => {
		// `germanGaps` sees a table as one key; a German table is typed whole, and
		// this holds it to the English one entry by entry.
		const german = interfaceTextFor("de");
		for (const table of ["slideTypeNames", "slideTypeHints"] as const) {
			expect(Object.keys(german.editor[table]).sort()).toEqual(
				Object.keys(ENGLISH_INTERFACE_TEXT.editor[table]).sort(),
			);
		}
		expect(Object.keys(german.deckMerge.fieldNames).sort()).toEqual(
			Object.keys(ENGLISH_INTERFACE_TEXT.deckMerge.fieldNames).sort(),
		);
	});

	test("the slide column's tables name every group heading and embed provider in German too", () => {
		const german = interfaceTextFor("de");
		for (const table of ["groupTitles", "embedFrames"] as const) {
			expect(Object.keys(german.slideSettings[table]).sort()).toEqual(
				Object.keys(ENGLISH_INTERFACE_TEXT.slideSettings[table]).sort(),
			);
		}
		// Every heading a slide type declares is one the table carries.
		for (const sections of Object.values(SLIDE_TYPE_SECTIONS)) {
			for (const title of [
				sections.content,
				sections.answers,
				sections.scoring,
				sections.results,
			]) {
				if (title !== null) expect(german.slideSettings.groupTitles[title]).toBeTruthy();
			}
		}
	});

	test("the canvas's stand-in room says as much in German as in English", () => {
		const german = interfaceTextFor("de").slideCanvas;
		const english = ENGLISH_INTERFACE_TEXT.slideCanvas;
		for (const list of [
			"sampleWords",
			"sampleResponses",
			"previewWords",
			"previewResponses",
		] as const) {
			expect(german[list].length).toBe(english[list].length);
			expect(german[list]).not.toEqual(english[list]);
		}
	});

	test("home and workspaces name every access level, subject, role and category in German too", () => {
		const german = interfaceTextFor("de");
		const english = ENGLISH_INTERFACE_TEXT;
		const sameKeys = (left: object, right: object) =>
			expect(Object.keys(left).sort()).toEqual(Object.keys(right).sort());
		sameKeys(german.sharing.accessLevels, english.sharing.accessLevels);
		sameKeys(german.sharing.subjects, english.sharing.subjects);
		sameKeys(german.workspaces.roles, english.workspaces.roles);
		sameKeys(
			german.workspaces.templateCategories,
			english.workspaces.templateCategories,
		);
		const levels = Object.keys(english.sharing.accessLevels) as DeckAccessLevel[];
		for (const level of levels) {
			expect(german.sharing.accessLevels[level]).not.toEqual(
				english.sharing.accessLevels[level],
			);
		}
		for (const role of WORKSPACE_ROLES) {
			expect(german.workspaces.roles[role].summary).not.toBe(
				english.workspaces.roles[role].summary,
			);
		}
	});

	test("the results breakdown words every refusal, in English exactly as the server does", () => {
		const german = interfaceTextFor("de").sharedResults.segmentRefusals;
		const english = ENGLISH_INTERFACE_TEXT.sharedResults.segmentRefusals;
		expect(english).toEqual(SEGMENT_REFUSAL_REASONS);
		expect(ENGLISH_INTERFACE_TEXT.sharedResults.didNotAnswer).toBe(
			SEGMENT_UNANSWERED_LABEL,
		);
		expect(Object.keys(german).sort()).toEqual(Object.keys(english).sort());
		for (const refusal of Object.keys(english) as (keyof typeof english)[]) {
			expect(german[refusal]).not.toBe(english[refusal]);
		}
	});

	test("the role and level helpers read the language they are handed", () => {
		const german = interfaceTextFor("de");
		expect(workspaceRoleLabel("owner", german)).toBe("Inhaber");
		expect(workspaceRoleLabel(null, german)).toBe("Kein Zugriff");
		expect(workspaceRoleSummary("member", german)).toContain("Kann keine");
		expect(deckAccessLevelLabel("edit", german)).toBe("Bearbeiten");
		expect(deckAccessLevelSummary("comment", german)).toContain("„Ansehen“");
		// Without a text they stay English, which the tests that pin English rely on.
		expect(workspaceRoleLabel("owner")).toBe("Owner");
		expect(deckAccessLevelLabel("edit")).toBe("Can edit");
	});
});

describe("dates take the interface language's format", () => {
	test("German writes a day the German way", () => {
		expect(formatDate("de", new Date(2026, 9, 27))).toBe("27.10.2026");
	});

	test("English keeps the browser's own locale, as before REQ248", () => {
		// Review: an English interface wrote every date in en-US, so a fr-FR
		// browser on Automatic read 5 November as 11/5/2026.
		const day = new Date(2026, 10, 5, 14, 30);
		expect(dateLocale("en")).toBeUndefined();
		expect(dateLocale("de")).toBe("de");
		expect(formatDate("en", day)).toBe(day.toLocaleDateString());
		expect(slideCommentTimeLabel(day.toISOString())).toBe(
			day.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
		);
		expect(resultsLinkIssuedLabel(day.toISOString())).toBe(
			`Active since ${day.toLocaleString()}.`,
		);
	});
});

describe("<html lang> follows the interface where a screen is translated", () => {
	const source = (...path: string[]) =>
		readFileSync(join(import.meta.dir, "..", ...path), "utf8");

	test("a screen that declares no language is English, as index.html is", () => {
		expect(DEFAULT_DOCUMENT_LANGUAGE).toBe("en");
		expect(source("index.html")).toContain('<html lang="en"');
		expect(source("interface-language.tsx")).toContain(
			"documentElement.lang =\n\t\t\tdocumentLanguage ?? DEFAULT_DOCUMENT_LANGUAGE;",
		);
	});

	test("each organizer screen declares the interface language, the deck's screens the deck's", () => {
		for (const page of [
			"PresenterPage.tsx",
			"HomePage.tsx",
			"WorkspacesPage.tsx",
			"WorkspacePage.tsx",
			"TemplatesPage.tsx",
			"GeneratePage.tsx",
			"JoinPage.tsx",
			"SharedResultsPage.tsx",
		]) {
			expect(source("pages", page), page).toContain(
				"useDocumentLanguage(language);",
			);
		}
		for (const page of ["ParticipantPage.tsx", "PreviewPage.tsx"]) {
			expect(source("pages", page), page).toContain(
				"useDocumentLanguage(pres?.language || undefined);",
			);
		}
		// The preview's chrome stays English under the deck's <html lang>, so it
		// says so (review: a German deck tagged the English header de).
		const preview = source("pages", "PreviewPage.tsx");
		expect(preview).toMatch(/<header\s+lang="en"/);
		expect(preview.match(/<h2\s+lang="en"/g)?.length).toBe(2);
		// The editor names its interface language `interfaceLanguage`, because
		// `language` there is the deck's.
		expect(source("pages", "CreatePage.tsx")).toContain(
			"useDocumentLanguage(interfaceLanguage);",
		);
	});
});
