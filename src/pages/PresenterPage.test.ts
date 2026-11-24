/**
 * The presenter's top bar is three ordered zones (REQ190).
 *
 * REQ189 stopped it scrolling sideways by letting a row of thirteen equal chips
 * wrap; REQ190 replaced that with three zones sorted by what each control is
 * for — identity, room console, command — and one Deck menu for everything
 * about the deck that is not its lifecycle. The way back, the deck's title and
 * the lifecycle button sit on the first line at every width; every capability
 * the bar offered before is in the bar or one menu deep.
 *
 * Whether that fits is a matter of rendered widths, and it was checked in a
 * browser at 360, 768, 1280 and 1536px (REQ190's update log). What a test
 * without a DOM can hold is the structure that makes it fit, read off the
 * page's source the way `CreatePage.test.ts` reads its own: the page needs a
 * live store and socket to render at all.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AudienceBlankIcon,
	audienceBlankToggleLabel,
} from "../components/LiveRoom";
import {
	buildShareControls,
	joinMenuLabel,
	shareMenuLabel,
} from "../components/ShareCluster";
import {
	BarMenuRow,
	BOTTOM_DOCK_ATTRIBUTE,
	disabledReason,
} from "../components/ui/BarMenu";
import { fillText, interfaceTextFor } from "../interface-text";
import {
	blankMenuRow,
	keyBelongsToField,
	panelCountTone,
	panelSheetEscape,
	slidePagingFor,
} from "./PresenterPage";

const source = readFileSync(join(import.meta.dir, "PresenterPage.tsx"), "utf8");
const shareCluster = readFileSync(
	join(import.meta.dir, "..", "components", "ShareCluster.tsx"),
	"utf8",
);
// The page's and the share controls' English text (REQ248).
const pageSection = readFileSync(
	join(import.meta.dir, "..", "interface-text", "presenter-page.ts"),
	"utf8",
);
const shareSection = readFileSync(
	join(import.meta.dir, "..", "interface-text", "share.ts"),
	"utf8",
);
const german = interfaceTextFor("de");
// The join address the share controls are built with in these tests.
const JOIN_ADDRESS = {
	host: "omul.example",
	url: "https://omul.example/join/123456",
};
const topBarStart = source.indexOf("{/* Top bar (REQ190)");
const topBar = source.slice(topBarStart, source.indexOf("</header>", topBarStart));
const identity = topBar.indexOf("{/* Identity zone */}");
const console_ = topBar.indexOf("{/* Room console */}");
const command = topBar.indexOf("{/* Command zone */}");
const panelDescriptor = source.slice(
	source.indexOf("const panelToggles: PanelToggle[] = ["),
	source.indexOf("const openPanelCount"),
);
const deckMenuRows = source.slice(
	source.indexOf("const deckMenuRows = (close: () => void) => ("),
	source.indexOf("const moreMenuRows = (close: () => void) => ("),
);
const presentMenuRows = source.slice(
	source.indexOf("const presentMenuRows = (close: () => void) => ("),
	source.indexOf("const deckMenuRows = (close: () => void) => ("),
);

/** The `className` of the element opened right after `marker`. */
function zoneClass(marker: number): string {
	return /className="([^"]*)"/.exec(topBar.slice(marker))?.[1] ?? "";
}

describe("the presenter top bar is three ordered zones (REQ190)", () => {
	test("the bar and its three zones are found, in tab order", () => {
		expect(topBarStart).toBeGreaterThan(-1);
		expect(identity).toBeGreaterThan(-1);
		expect(console_).toBeGreaterThan(identity);
		expect(command).toBeGreaterThan(console_);
	});

	test("nothing in the bar scrolls horizontally or refuses to wrap", () => {
		expect(topBar.includes("overflow-x-auto")).toBe(false);
		expect(topBar.includes("whitespace-nowrap")).toBe(false);
		// The phone's status line is the one thing allowed a second line.
		expect(topBar.match(/(?<!max-sm:)\bflex-wrap\b/g)).toBeNull();
		expect(topBar.match(/max-sm:flex-wrap/g)?.length).toBe(1);
	});

	test("identity and command hold the first line at every width", () => {
		expect(zoneClass(identity)).toContain("row-start-1");
		expect(zoneClass(command)).toContain("row-start-1");
		// The console takes the second line below `xl` and joins the first from it.
		expect(zoneClass(console_)).toContain("row-start-2");
		expect(zoneClass(console_)).toContain("xl:row-start-1");
	});

	test("the Back link and the title are in the identity zone", () => {
		const back = topBar.indexOf('go({ page: "home" })');
		const title = topBar.indexOf("<h1");
		expect(back).toBeGreaterThan(identity);
		expect(title).toBeGreaterThan(back);
		expect(title).toBeLessThan(console_);
	});

	test("the title is what gives way, and can still be read whole", () => {
		expect(topBar).toMatch(
			/<h1 className="[^"]*\btruncate\b[^"]*\bmin-w-0\b[^"]*" title=\{pres\.title\}/,
		);
	});

	test("every lifecycle button and the View only marker sit in the command zone", () => {
		const lifecycle = [
			topBar.indexOf("{pageText.viewOnly}"),
			topBar.indexOf("onClick={handleStart}"),
			topBar.indexOf("onClick={handleEnd}"),
			topBar.lastIndexOf("onClick={handleStart}"),
		];
		for (const position of lifecycle) {
			expect(position).toBeGreaterThan(command);
		}
	});

	test("the door, the shared-screen group and the panels sit in the room console", () => {
		for (const control of [
			"<ShareCluster",
			"aria-label={pageText.sharedScreenGroup}",
			"panelToggles.map(",
		]) {
			const position = topBar.indexOf(control);
			expect({ control, inConsole: position > console_ && position < command }).toEqual({
				control,
				inConsole: true,
			});
		}
	});

	test("all five panels are in the descriptor, with their labels", () => {
		for (const label of [
			"qaButtonLabel",
			"audienceButtonLabel",
			"notesButtonLabel",
			"commentsButtonLabel",
			"rosterButtonLabel",
		]) {
			expect(panelDescriptor).toContain(`ariaLabel: ${label},`);
		}
		expect(panelDescriptor).toContain("disabled: !canReadComments,");
	});

	test("the deck's own actions are one tap deep in the Deck menu", () => {
		// The rows are one definition (REQ199), which the Deck menu in the
		// command zone draws.
		for (const control of [
			'go({ page: "edit", id: pres.id })',
			"ariaLabel={resultsLinkButtonLabel}",
			"ariaLabel={exportControlLabel}",
			"ariaLabel={resetButtonLabel}",
		]) {
			expect({ control, found: deckMenuRows.includes(control) }).toEqual({
				control,
				found: true,
			});
		}
		const deckMenu = topBar.slice(command);
		expect(deckMenu).toMatch(/label=\{deckMenuLabel\}[\s\S]*?\{deckMenuRows\}\s*<\/BarMenu>/);
		expect(deckMenu).toContain("<AppMenu className={`max-sm:hidden ${BAR_CONTROL_SIZE}`} />");
	});

	test("the share menu still offers every way in, the edit link last", () => {
		for (const [key, title] of [
			["copyJoinLink", "Copy join link"],
			["showQrCode", "Show QR code"],
			["copyEmbedCode", "Copy embed code (iframe snippet)"],
			["copyEditLink", "Copy share link with edit permissions"],
		]) {
			expect(shareCluster).toContain(`title: shareText.${key},`);
			expect(shareSection).toContain(`${key}: "${title}",`);
		}
		// The edit link is the last action pushed, after the others.
		expect(shareCluster.indexOf("title: shareText.copyEditLink,")).toBeGreaterThan(
			shareCluster.indexOf("title: shareText.copyEmbedCode,"),
		);
		// The join code still copies itself on one tap, under its own title.
		expect(shareCluster).toMatch(/title=\{shareText\.copyJoinCode\}/);
		expect(shareSection).toContain('copyJoinCode: "Copy join code",');
		expect(shareCluster).toContain("onClick={join.onClick}");
		expect(shareCluster).not.toMatch(/variant: "bar"|"compact"/);
	});

	test("the QR code is one tap, beside the code, and the menu holds the rest (REQ191)", () => {
		const noop = () => {};
		for (const isOwner of [true, false]) {
			const { join, actions } = buildShareControls({
				code: "123456",
				address: JOIN_ADDRESS,
				isOwner,
				copied: { code: false, link: false, embed: false, editLink: false },
				onCopyCode: noop,
				onCopyLink: noop,
				onShowQr: noop,
				onCopyEmbed: noop,
				onShareEdit: noop,
			});
			expect(join.address).toEqual(JOIN_ADDRESS);
			expect(actions.map((action) => action.key)).toContain("qr");
			const menuActions = actions.filter((action) => action.key !== "qr");
			expect(shareMenuLabel(menuActions)).toBe(
				isOwner
					? "Share — copy the join link, the embed code or the edit link"
					: "Share — copy the join link or the embed code",
			);
		}
		// The QR button sits after the divider and before the Share caret, and
		// the menu's rows leave the QR action out.
		const qrButton = shareCluster.indexOf("aria-haspopup=\"dialog\"");
		expect(qrButton).toBeGreaterThan(shareCluster.indexOf("onClick={join.onClick}"));
		expect(qrButton).toBeLessThan(
			shareCluster.indexOf("label={shareMenuLabel(menuActions, text)}"),
		);
		expect(shareCluster).toContain("menuActions.map((action) => (");
	});

	test("a disabled row's visible reason is its name after the dash", () => {
		expect(
			disabledReason(
				"Reset results — you cannot edit this presentation, so its results are not yours to clear",
			),
		).toBe(
			"You cannot edit this presentation, so its results are not yours to clear",
		);
		expect(disabledReason("no dash here")).toBe("No dash here");
	});
});

describe("Present is one menu holding every way to present (REQ247)", () => {
	const english = interfaceTextFor("en");

	test("the Present rows are present here, a presenting window, the preview and the blank, in that order", () => {
		const order = [
			"label={pageText.present}",
			"enterPresenting();",
			"label={pageText.openPresentingWindow}",
			"presentingWindowName(pres.id)",
			'<PreviewLink\n\t\t\t\tvariant="menu-row"',
			"<div aria-hidden className={MENU_DIVIDER} />",
			"icon={<AudienceBlankIcon blanked={screenBlanked} />}",
			"{...blankMenuRow({ blanked: screenBlanked, canControl: isOwner }, text)}",
			"handleSetBlanked(!screenBlanked);",
		];
		let at = 0;
		for (const marker of order) {
			const found = presentMenuRows.indexOf(marker, at);
			expect({ marker, found: found > -1 }).toEqual({ marker, found: true });
			at = found + marker.length;
		}
	});

	test("the Deck rows hold neither the preview nor the presenting window", () => {
		// Acceptance: "Open presenting window" sat in the Deck menu, away from
		// Present; the preview went with it.
		expect(deckMenuRows.length).toBeGreaterThan(0);
		expect(deckMenuRows).not.toContain("<PreviewLink");
		expect(deckMenuRows).not.toContain("openPresentingWindow");
		expect(deckMenuRows).not.toContain("enterPresenting");
		for (const text of [english, german]) {
			for (const offers of [
				text.presenterPage.deckMenuOffers,
				text.presenterPage.deckMenuOffersWithEdit,
			]) {
				expect(offers).not.toMatch(/preview|presenting window|Vorschau|Präsentationsfenster/i);
			}
		}
	});

	test("the Screen group's Present control opens those rows, and focus comes back to it", () => {
		const screen = topBar.slice(topBar.indexOf("aria-label={pageText.sharedScreenGroup}"));
		const presentMenu = screen.slice(screen.indexOf("<BarMenu"), screen.indexOf("</BarMenu>"));
		expect(presentMenu).toContain("triggerRef={presentControlRef}");
		expect(presentMenu).toContain("label={presentMenuLabel}");
		expect(presentMenu).toContain("triggerClassName={`${BAR_GROUP_ITEM} max-sm:hidden`}");
		expect(presentMenu).toMatch(/\{presentMenuRows\}\s*$/);
		// The bar has no second way into the view beside the menu.
		expect(source).not.toContain("onClick={enterPresenting}");
	});

	test("the Present and More triggers name all four rows, in English and in German", () => {
		for (const text of [english, german]) {
			const page = text.presenterPage;
			const presentName = fillText(page.presentMenuLabel, {
				offers: page.presentMenuOffers,
			});
			const moreName = fillText(page.moreMenuLabel, {
				present: page.presentMenuOffers,
				offers: page.deckMenuOffers,
			});
			for (const row of [page.preview, page.openPresentingWindow, page.blankRow]) {
				expect(presentName.toLowerCase()).toContain(row.toLowerCase());
				expect(moreName.toLowerCase()).toContain(row.toLowerCase());
			}
			expect(presentName.startsWith(`${page.present} — `)).toBe(true);
			expect(moreName).not.toMatch(/\{\w+\}/);
		}
		expect(german.presenterPage.presentMenuLabel).toBe("Präsentieren — {offers}");
	});
});

describe("the blank is a row of the Present menu, not a bar button (REQ109/REQ247)", () => {
	const english = interfaceTextFor("en");
	const screenGroup = topBar.slice(
		topBar.indexOf("aria-label={pageText.sharedScreenGroup}"),
		topBar.indexOf("aria-label={pageText.panelsGroup}"),
	);
	const row = (blanked: boolean, canControl: boolean, text = english) =>
		renderToStaticMarkup(
			createElement(BarMenuRow, {
				icon: createElement(AudienceBlankIcon, { blanked }),
				...blankMenuRow({ blanked, canControl }, text),
				onClick: () => {},
			}),
		);
	/** An attribute value as `renderToStaticMarkup` escapes it. */
	const escaped = (value: string) => value.replace(/'/g, "&#x27;");

	test("the shared-screen group draws the Present trigger and no blank button", () => {
		expect(screenGroup.length).toBeGreaterThan(0);
		expect(screenGroup).not.toContain("handleSetBlanked");
		expect(screenGroup).not.toContain("aria-pressed");
		expect(screenGroup).not.toContain("blankButtonLabel");
		expect(screenGroup).not.toContain("AudienceBlankIcon");
		expect(screenGroup.match(/<button\b/g)).toBeNull();
		expect(screenGroup.match(/<BarMenu\b/g)?.length).toBe(1);
		// Its one trigger is not drawn below `sm`, so neither is the group.
		expect(screenGroup).toMatch(/^aria-label=\{pageText\.sharedScreenGroup\} className=\{`[^`]*\bmax-sm:hidden\b/);
		// Nowhere else in the bar draws it either: the menu row is the one in it.
		expect(topBar).not.toContain("handleSetBlanked");
		// The menu row and the presenting view's strip; `B` reads the deck itself.
		expect(source.match(/handleSetBlanked\(!screenBlanked\)/g)?.length).toBe(2);
	});

	test("shown and held: the row offers to blank, unpressed, and is enabled", () => {
		const markup = row(false, true);
		expect(markup).toContain(`aria-label="${escaped(audienceBlankToggleLabel({ blanked: false, canControl: true }))}"`);
		expect(markup).toContain('aria-label="Blank the shared screen — the room&#x27;s screen goes dark');
		expect(markup).toContain('aria-pressed="false"');
		expect(markup).not.toContain('disabled=""');
		expect(markup).toContain(">Blank the shared screen</span>");
		expect(markup).toContain("lucide-eye-off");
	});

	test("blanked and held: the row offers to show the slide again, pressed, in another glyph", () => {
		const markup = row(true, true);
		expect(markup).toContain(`aria-label="${escaped(audienceBlankToggleLabel({ blanked: true, canControl: true }))}"`);
		expect(markup).toContain('aria-label="Show the slide again — ');
		expect(markup).toContain('aria-pressed="true"');
		expect(markup).not.toContain('disabled=""');
		expect(markup).toContain("lucide-eye-closed");
		expect(markup).not.toContain("lucide-eye-off");
	});

	test("for a viewer who does not hold the deck the row is disabled with its reason shown", () => {
		for (const blanked of [false, true]) {
			const label = audienceBlankToggleLabel({ blanked, canControl: false });
			const markup = row(blanked, false);
			expect(markup).toContain(`aria-label="${escaped(label)}"`);
			expect(markup).toContain('disabled=""');
			expect(markup).toContain(`>${escaped(disabledReason(label))}</span>`);
			expect(markup).toContain(`aria-pressed="${blanked}"`);
		}
		expect(blankMenuRow({ blanked: false, canControl: false }).reason).toBe(
			"You cannot edit this presentation, so its screen is not yours to blank",
		);
	});

	test("the row reads German, its name and its reason", () => {
		const german = interfaceTextFor("de");
		const held = blankMenuRow({ blanked: false, canControl: true }, german);
		expect(held.label).toBe("Geteilten Bildschirm ausblenden");
		expect(held.ariaLabel).toBe(
			audienceBlankToggleLabel({ blanked: false, canControl: true }, german),
		);
		const refused = blankMenuRow({ blanked: false, canControl: false }, german);
		expect(refused.reason).toBe(
			"Du kannst diese Präsentation nicht bearbeiten, also kannst du ihren Bildschirm nicht ausblenden",
		);
	});

	test("the bar no longer draws a monitor glyph for the blank", () => {
		expect(source).not.toMatch(/\bMonitorOff\b/);
		expect(source).not.toMatch(/<Monitor size/);
	});
});

describe("the door is the room's standing invitation (REQ191)", () => {
	test("the join-bar switch is retired: the page no longer reads showJoinBar", () => {
		expect(source.includes("showJoinBar")).toBe(false);
		expect(source.includes("joinBarButtonLabel")).toBe(false);
	});

	test("the door is drawn unconditionally", () => {
		expect(topBar).toMatch(/^\t*<ShareCluster variant="menu" controls=\{shareControls\} \/>$/m);
		expect(topBar).not.toMatch(/&&\s*<ShareCluster/);
	});

	test("the QR overlay is a dialog that shows the room's head-count", () => {
		const overlay = source.slice(source.indexOf("const qrDialog = showQr && ("));
		expect(overlay).toContain('role="dialog"');
		expect(overlay).toContain('aria-modal="true"');
		expect(overlay).toContain("participantCount");
		expect(overlay).toContain("onClick={closeQr}");
	});

	test("a paging key closes the QR before it can page the deck", () => {
		const keys = source.slice(source.indexOf("const handleKeyDown"));
		expect(keys.indexOf("if (showQr)")).toBeGreaterThan(-1);
		expect(keys.indexOf("if (showQr)")).toBeLessThan(keys.indexOf("handleSlide("));
	});
});

describe("below 1280px the bar is laid out for whoever holds the screen (REQ199)", () => {
	const consoleZone = topBar.slice(console_, command);

	test("below `sm` the room console is the bottom dock, moved by CSS rather than drawn twice", () => {
		expect(consoleZone).toMatch(/<div\s+data-bottom-dock\s+className="[^"]*\bmax-sm:fixed\b[^"]*\bmax-sm:bottom-0\b/);
		expect(source.match(/^\t*data-bottom-dock$/gm)?.length).toBe(1);
		const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");
		expect(css).toContain(":root:has([data-bottom-dock])");
		expect(css).toContain("--bottom-dock-height");
		expect(source).toContain("pb-[var(--bottom-dock-height,0px)]");
	});

	test("the header's blur is `sm:`-only, so it does not pin the dock to the header", () => {
		expect(topBar).toMatch(/<header className="[^"]*\bsm:backdrop-blur-sm\b/);
		expect(topBar).not.toMatch(/<header className="[^"]*(?<!sm:)\bbackdrop-blur-sm\b/);
	});

	test("the dock pages the deck on a phone, and only there", () => {
		const slides = consoleZone.slice(
			consoleZone.indexOf("aria-label={pageText.slidesGroup}"),
		);
		expect(consoleZone).toMatch(/role="group" aria-label=\{pageText\.slidesGroup\} className=\{`\$\{BAR_GROUP\} ml-auto sm:hidden`\}/);
		expect(slides).toContain("pageTo(slidePaging.previous.index)");
		expect(slides).toContain("pageTo(slidePaging.next.index)");
		// Disabled with its reason, never hidden, from the one paging value the
		// in-slide row reads too.
		expect(slides).toContain("disabled={slidePaging.previous.disabled}");
		expect(slides).toContain("aria-label={slidePaging.next.label}");
		const inSlide = source.slice(
			source.indexOf("const slideNavigation ="),
			source.indexOf("if (sharedScreenView(pres) === \"blank\")"),
		);
		expect(inSlide).toContain("disabled={slidePaging.previous.disabled}");
		expect(inSlide).toContain("disabled={slidePaging.next.disabled}");
		// The deck view's in-slide row gives way to the dock below `sm`; the
		// blanked screen has no dock and keeps it.
		expect(source).toContain('<div className="max-sm:hidden">{slideNavigation}</div>');
		expect(source.match(/\{slideNavigation\}/g)?.length).toBe(2);
	});

	test("below `sm` the Deck trigger gives way to one More menu leading with the same rows", () => {
		const command_ = topBar.slice(command);
		expect(command_).toMatch(/triggerClassName=\{`[^`]*\bmax-sm:hidden\b[^`]*`\}/);
		expect(command_).toMatch(/<AppMenu\s+className=\{`sm:hidden \$\{BAR_CONTROL_SIZE\}`\}\s+leading=\{\{[\s\S]*?rows: moreMenuRows,/);
		// More leads with the Present rows (REQ247), then the very same Deck rows.
		expect(source).toMatch(/const moreMenuRows = \(close: \(\) => void\) => \(\s*<>\s*\{presentMenuRows\(close\)\}[\s\S]*?\{deckMenuRows\(close\)\}/);
		expect(source.match(/\{deckMenuRows\}|\{deckMenuRows\(close\)\}/g)?.length).toBe(2);
		expect(source.match(/\{presentMenuRows\}|\{presentMenuRows\(close\)\}/g)?.length).toBe(2);
	});

	test("More and Deck name the rows from one list, and More leaves its own sections to `AppMenu`", () => {
		const command_ = topBar.slice(command);
		expect(source).toMatch(
			/const deckMenuLabel = fillText\(pageText\.deckMenuLabel, \{\s*offers: deckMenuOffers,\s*\}\);/,
		);
		expect(command_).toMatch(
			/label: fillText\(pageText\.moreMenuLabel, \{\s*present: pageText\.presentMenuOffers,\s*offers: deckMenuOffers,\s*\}\),/,
		);
		expect(pageSection).toContain('deckMenuLabel: "Deck — {offers}",');
		expect(pageSection).toContain('moreMenuLabel: "More — {present}, {offers}",');
		// German keeps the "Name — what it holds" shape both triggers share.
		expect(german.presenterPage.deckMenuLabel).toMatch(/^\S+ — \{offers\}$/);
		expect(german.presenterPage.moreMenuLabel).toMatch(/^\S+ — .*\{offers\}$/);
		// The app menu's sections are named by the menu, feedback included where
		// it is on (`appMenuTriggerLabel`), never restated here.
		expect(source).not.toMatch(/appearance and legal|feedback and legal/);
	});

	test("from `sm` to `xl` line 2 holds both edges", () => {
		expect(consoleZone).toMatch(/aria-label=\{pageText\.sharedScreenGroup\} className=\{`\$\{BAR_GROUP\} sm:max-xl:ml-auto max-sm:hidden`\}/);
	});

	test("one control height per width lives in the shared tokens, at every width (REQ192)", () => {
		// A pill is its item plus 2px of padding and 1px of border on each side:
		// 32 + 6 = 38px from `xl`, 34 + 6 = 40px below it, 38 + 6 = 44px below `sm`.
		expect(shareCluster).toMatch(/export const BAR_GROUP_ITEM = `[^`]*\bh-8 min-w-8 max-xl:h-8\.5 max-xl:min-w-8\.5 max-sm:h-9\.5 max-sm:min-w-9\.5\b/);
		expect(shareCluster).toContain('export const BAR_CONTROL_HEIGHT = "h-9.5 max-xl:h-10 max-sm:h-11";');
		expect(shareCluster).toContain('export const BAR_CONTROL_SIZE = "xl:size-9.5 max-xl:size-10 max-sm:size-11";');
		const lifecycles = topBar.match(/className=\{`btn-(?:primary|secondary) text-sm [^`]*`\}/g) ?? [];
		expect(lifecycles.length).toBe(3);
		for (const lifecycle of lifecycles) {
			expect(lifecycle).toContain("${BAR_CONTROL_HEIGHT}");
		}
		// No control in the console or the command zone states a height of its
		// own. (Back, in the identity zone, is a bare link with no chrome.)
		expect(topBar.slice(console_)).not.toMatch(/\b(?:max-(?:sm|xl):)?(?:h|size)-(?:8\.5|9|9\.5|10|11)\b/);
		// The Deck trigger, the View only marker and both app-menu mounts read
		// the tokens too.
		expect(topBar).toMatch(/triggerClassName=\{`flex \$\{BAR_CONTROL_HEIGHT\}/);
		expect(topBar).toMatch(/className=\{`inline-flex \$\{BAR_CONTROL_HEIGHT\}[^`]*`\}\s*title=\{pageText\.viewOnlyTitle\}/);
		expect(topBar.match(/\$\{BAR_CONTROL_SIZE\}/g)?.length).toBe(2);
	});

	test("the dock's Next carries the primary fill through the shared token", () => {
		expect(shareCluster).toMatch(/export const BAR_GROUP_ITEM_PRIMARY = `\$\{BAR_GROUP_ITEM\} enabled:bg-primary [^`]*enabled:hover:bg-primary-hover/);
		expect(topBar).not.toContain("enabled:bg-primary");
		expect(topBar).toContain("className={`${BAR_GROUP_ITEM_PRIMARY} min-w-10!`}");
	});

	test("a focus below `sm` scrolls clear of the dock, and its menus open above its top edge", () => {
		const css = readFileSync(join(import.meta.dir, "..", "index.css"), "utf8");
		const dockRule = css.slice(css.indexOf(":root:has([data-bottom-dock])"));
		expect(dockRule.slice(0, dockRule.indexOf("}"))).toContain(
			"scroll-padding-bottom: var(--bottom-dock-height);",
		);
		// Menus are placed against the dock's top edge, read off the same marker.
		expect(BOTTOM_DOCK_ATTRIBUTE).toBe("data-bottom-dock");
		const barMenu = readFileSync(
			join(import.meta.dir, "..", "components", "ui", "BarMenu.tsx"),
			"utf8",
		);
		expect(barMenu).toContain("appMenuPlacement(\n\t\t\t\tmenuAnchorBox(trigger),");
	});

	test("below `sm` the open panels are a sheet above the dock, closed from the sheet", () => {
		const main = source.slice(source.indexOf("{/* Main content area */}"));
		const sheet = main.slice(main.indexOf("{/* The panels beside the slide."));
		expect(sheet).toMatch(/^\t*<div ref=\{panelSheetRef\} className="sm:contents max-sm:hidden max-sm:has-\[aside\]:flex [^"]*\bmax-sm:fixed\b[^"]*\bmax-sm:bottom-\[var\(--bottom-dock-height,0px\)\][^"]*\bmax-sm:overflow-y-auto\b/m);
		// Every panel is in it, and scrolls itself into the sheet's view.
		expect(sheet.match(/<aside ref=\{revealInPanelSheet\}/g)?.length).toBe(5);
		expect(main.match(/<aside\b/g)?.length).toBe(5);
		// The sheet's own close hides every open panel through the descriptor,
		// under a heading a screen reader can jump to.
		expect(sheet).toMatch(/className="sticky top-0 [^"]*\bsm:hidden"/);
		expect(sheet).toMatch(/<h2 className="[^"]*">\s*\{pageText\.panels\}\s*<\/h2>/);
		expect(sheet).toContain('onClick={() => hidePanels("dock")}');
		expect(source).toMatch(
			/const hidePanels = \(focus: PanelSheetFocus\) => \{\s*for \(const toggle of panelToggles\)/,
		);
	});

	test("below `sm` Escape takes the panel sheet down, unless a menu or dialog has it", () => {
		const shown = { sheetShown: true, answered: false, composing: false, inField: false };
		// Focus on the page, maybe behind the sheet: it stays, and is uncovered.
		expect(panelSheetEscape({ ...shown, focusInSheet: false })).toBe("stay");
		// Focus in the sheet goes with it, so it lands on the dock's Panels trigger.
		expect(panelSheetEscape({ ...shown, focusInSheet: true })).toBe("dock");
		// No sheet, or an Escape somebody else answered: the sheet is left alone.
		for (const focusInSheet of [false, true]) {
			expect(
				panelSheetEscape({ ...shown, sheetShown: false, focusInSheet }),
			).toBeNull();
			expect(panelSheetEscape({ ...shown, answered: true, focusInSheet })).toBeNull();
		}
		// The window's handler asks after the QR overlay has had its keys, and
		// counts a menu's Escape and every open dialog as answered.
		const handler = source.slice(source.indexOf("const handleKeyDown = useCallback("));
		expect(handler.indexOf("panelSheetEscape(")).toBeGreaterThan(handler.indexOf("if (showQr)"));
		expect(handler).toMatch(
			/answered:\s*e\.defaultPrevented \|\|\s*confirmShareEdit \|\|\s*confirmReset \|\|\s*exportOpen \|\|\s*resultsLinkOpen,/,
		);
		expect(source).toContain('<div ref={panelSheetRef} className="sm:contents ');
		expect(source).toContain("hidePanelsRef.current = hidePanels;");
		const barMenu = readFileSync(
			join(import.meta.dir, "..", "components", "ui", "BarMenu.tsx"),
			"utf8",
		);
		expect(barMenu).toMatch(
			/if \(event\.key !== "Escape"\) return;\s*event\.preventDefault\(\);\s*close\(\);/,
		);
	});

	test("Escape typed in a field inside the sheet is the field's, and keeps the draft", () => {
		const shown = { sheetShown: true, answered: false, composing: false };
		// The chat's draft is in the sheet: Escape leaves the sheet, and the draft, up.
		expect(panelSheetEscape({ ...shown, focusInSheet: true, inField: true })).toBeNull();
		// A field behind the sheet is the covered control Escape is for (WCAG 2.4.11).
		expect(panelSheetEscape({ ...shown, focusInSheet: false, inField: true })).toBe("stay");
		// An IME that is composing owns Escape wherever it is.
		for (const focusInSheet of [false, true]) {
			for (const inField of [false, true]) {
				expect(
					panelSheetEscape({ ...shown, composing: true, focusInSheet, inField }),
				).toBeNull();
			}
		}
		const handler = source.slice(source.indexOf("const handleKeyDown = useCallback("));
		expect(handler).toContain("composing: e.isComposing,");
		expect(handler).toContain(
			"inField: keyBelongsToField({ isComposing: false, target: e.target }),",
		);
	});

	test("Space and the arrows typed into a field never page the deck (REQ199)", () => {
		const key = (target: object | null, isComposing = false) =>
			keyBelongsToField({ isComposing, target: target as EventTarget | null });
		for (const type of ["text", "search", "email", "number", "url", "password"]) {
			expect(key({ tagName: "INPUT", type })).toBe(true);
		}
		expect(key({ tagName: "TEXTAREA" })).toBe(true);
		expect(key({ tagName: "SELECT" })).toBe(true);
		expect(key({ tagName: "DIV", isContentEditable: true })).toBe(true);
		// Nothing is typed into these; a key acts on them as on a button.
		for (const type of ["checkbox", "radio", "button", "submit", "range"]) {
			expect(key({ tagName: "INPUT", type })).toBe(false);
		}
		expect(key({ tagName: "BODY", isContentEditable: false })).toBe(false);
		expect(key({ tagName: "BUTTON", isContentEditable: false })).toBe(false);
		expect(key(null)).toBe(false);
		expect(key({ tagName: "BUTTON" }, true)).toBe(true);
		// The handler asks before its paging branch, which is where it would
		// prevent the default and turn the slide.
		const handler = source.slice(source.indexOf("const handleKeyDown = useCallback("));
		const guard = handler.indexOf("if (keyBelongsToField(e)) return;");
		expect(guard).toBeGreaterThan(handler.indexOf("panelSheetEscape("));
		expect(guard).toBeLessThan(handler.indexOf("if (NEXT_SLIDE_KEYS.includes(e.key))"));
		expect(guard).toBeLessThan(
			handler.indexOf("if (PREVIOUS_SLIDE_KEYS.includes(e.key))"),
		);
		// The presenting view's `F` and `B` (REQ247) are typed letters in a field.
		expect(guard).toBeLessThan(handler.indexOf("presentingShortcut({"));
	});

	test("a panel's count reads at 4.5:1: `0` and — are muted, not dim (REQ190)", () => {
		expect(panelCountTone({ pressed: false, count: 0 })).toBe("text-text-muted");
		expect(panelCountTone({ pressed: false, count: "—" })).toBe("text-text-muted");
		expect(panelCountTone({ pressed: false, count: 3 })).toBe("text-text");
		expect(panelCountTone({ pressed: true, count: 0 })).toBe("");
		const panelCount = source.slice(
			source.indexOf("export function panelCountTone("),
			source.indexOf("function revealInPanelSheet("),
		);
		expect(panelCount).not.toContain('"text-text-dim"');
	});

	test("below `sm` the door is one button with the code on it, opening the Join menu", () => {
		expect(shareCluster).toMatch(/className=\{`\$\{BAR_GROUP\} max-sm:hidden \$\{className\}`\}/);
		expect(shareCluster).toMatch(/className=\{`\$\{BAR_GROUP\} sm:hidden \$\{className\}`\}/);
		const noop = () => {};
		for (const isOwner of [true, false]) {
			const { actions } = buildShareControls({
				code: "123456",
				address: JOIN_ADDRESS,
				isOwner,
				copied: { code: false, link: false, embed: false, editLink: false },
				onCopyCode: noop,
				onCopyLink: noop,
				onShowQr: noop,
				onCopyEmbed: noop,
				onShareEdit: noop,
			});
			const menuActions = actions.filter((action) => action.key !== "qr");
			expect(joinMenuLabel("123456", menuActions)).toBe(
				isOwner
					? "Join 123456 — show the QR code, copy the code, the join link, the embed code or the edit link"
					: "Join 123456 — show the QR code, copy the code, the join link or the embed code",
			);
		}
	});
});

describe("presenter paging steps over skipped slides (REQ110)", () => {
	/** A deck of slides, `true` where the slide is skipped. */
	const deck = (...skipped: boolean[]) =>
		skipped.map((isSkipped) => ({ skipped: isSkipped }));
	const live = (slides: { skipped: boolean }[], activeSlideIndex: number) =>
		slidePagingFor({ slides, activeSlideIndex, refusal: null });

	test("with nothing skipped, Next and Previous are the neighbours", () => {
		const paging = live(deck(false, false, false), 1);
		expect(paging.previous).toEqual({
			index: 0,
			disabled: false,
			label: "Previous slide — slide 1 of 3",
		});
		expect(paging.next).toEqual({
			index: 2,
			disabled: false,
			label: "Next slide — slide 3 of 3",
		});
	});

	test("a run of several skipped slides is stepped over in one press, counted in the label", () => {
		const slides = deck(false, true, true, true, false);
		expect(live(slides, 0).next).toEqual({
			index: 4,
			disabled: false,
			label: "Next slide — slide 5 of 5",
		});
		expect(live(slides, 4).previous.index).toBe(0);
	});

	test("a skipped last slide shuts Next on the slide before it, and says why", () => {
		const next = live(deck(false, false, true), 1).next;
		expect(next.index).toBeNull();
		expect(next.disabled).toBe(true);
		expect(next.label).toBe("Next slide — every later slide is skipped");
	});

	test("the deck's real ends read as they always did", () => {
		const slides = deck(false, false);
		expect(live(slides, 0).previous.label).toBe(
			"Previous slide — this is the first slide",
		);
		expect(live(slides, 1).next.label).toBe("Next slide — this is the last slide");
	});

	test("a skipped first slide shuts Previous on the slide after it", () => {
		const previous = live(deck(true, false), 1).previous;
		expect(previous.disabled).toBe(true);
		expect(previous.label).toBe("Previous slide — every earlier slide is skipped");
	});

	test("a refusal still shuts both directions, whatever is skipped", () => {
		const paging = slidePagingFor({
			slides: deck(false, true, false),
			activeSlideIndex: 0,
			refusal: "start the presentation to page through it",
		});
		expect(paging.next.disabled).toBe(true);
		expect(paging.next.label).toBe(
			"Next slide — start the presentation to page through it",
		);
	});

	test("every place that pages goes through it — the keyboard as well as both button pairs", () => {
		expect(source.match(/pageTo\(slidePaging\.previous\.index\)/g)?.length).toBe(2);
		expect(source.match(/pageTo\(slidePaging\.next\.index\)/g)?.length).toBe(2);
		const keyboard = source.slice(
			source.indexOf("const handleKeyDown = useCallback("),
			source.indexOf('window.addEventListener("keydown", handleKeyDown)'),
		);
		expect(keyboard).toContain("steppedSlideIndex(pres.slides, pres.activeSlideIndex, 1)");
		expect(keyboard).toMatch(/steppedSlideIndex\(\s*pres\.slides,\s*pres\.activeSlideIndex,\s*-1,?\s*\)/);
		expect(keyboard).toContain("pres?.slides,");
		expect(source).not.toMatch(/handleSlide\(pres\.activeSlideIndex [+-] 1\)/);
	});

	test("the rail still opens a skipped slide directly, and marks it", () => {
		const rail = source.slice(source.indexOf("<SlideRailItem"));
		expect(rail).toContain("skipped={slide.skipped}");
		expect(rail).toContain("onClick={() => isOwner && handleSlide(i)}");
	});
});

describe("the presenter screen in the interface language (REQ248)", () => {
	test("paging names its slides in German, keeping the reason after the dash", () => {
		const paging = slidePagingFor(
			{ slides: [{}, {}, { skipped: true }], activeSlideIndex: 1, refusal: null },
			german,
			"de",
		);
		expect(paging.previous.label).toBe("Vorherige Folie — Folie 1 von 3");
		expect(paging.next.label).toBe(
			"Nächste Folie — alle späteren Folien werden übersprungen",
		);
		expect(disabledReason(paging.next.label)).toBe(
			"Alle späteren Folien werden übersprungen",
		);
	});

	test("the share and join menus are named in German, edit link or not", () => {
		const noop = () => {};
		for (const isOwner of [true, false]) {
			const { actions } = buildShareControls(
				{
					code: "123456",
					address: JOIN_ADDRESS,
					isOwner,
					copied: { code: false, link: false, embed: false, editLink: false },
					onCopyCode: noop,
					onCopyLink: noop,
					onShowQr: noop,
					onCopyEmbed: noop,
					onShareEdit: noop,
				},
				german,
			);
			expect(actions[0]?.title).toBe("Link zum Mitmachen kopieren");
			const menuActions = actions.filter((action) => action.key !== "qr");
			expect(shareMenuLabel(menuActions, german)).toBe(
				isOwner
					? "Teilen — Link zum Mitmachen, Einbettungscode oder Bearbeitungslink kopieren"
					: "Teilen — Link zum Mitmachen oder Einbettungscode kopieren",
			);
			// The code on the trigger's face still leads its name (WCAG 2.5.3).
			expect(joinMenuLabel("123456", menuActions, german)).toStartWith(
				"Mitmachen 123456 — ",
			);
		}
	});

	test("the room's words on this screen read the deck's dictionary", () => {
		const overlay = source.slice(source.indexOf("const qrDialog = showQr && ("));
		for (const key of [
			"roomText.roomScanToJoin",
			"roomText.roomOrGoTo",
			"roomText.roomJoinCode",
			"roomText.roomHeadCount",
		]) {
			expect(overlay).toContain(key);
		}
		expect(source).toContain("const roomText = getDict(pres.language);");
		// The room's block carries the deck's language, Close the presenter's.
		expect(overlay).toContain("lang={roomLanguage}");
		expect(overlay).toMatch(/lang=\{language\}[\s\S]*?\{pageText\.close\}/);
	});
});
