/**
 * The presenter screen's presenting view (REQ247).
 *
 * What the room sees and how the layer comes and goes are rendered behaviour,
 * checked in a browser (REQ247's update log). What a test without a DOM can
 * hold is the rules for the keys, the address and the second window, and the
 * structure of the strip, read off the source the way `PresenterPage.test.ts`
 * reads the page's.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { routeForLocation } from "../router";
import {
	isTypingTarget,
	NEXT_SLIDE_KEYS,
	PRESENTING_HASH,
	FULLSCREEN_ESCAPE_GRACE_MS,
	PRESENTING_LAYER_IDLE_MS,
	presentingEscape,
	presentingShortcut,
	presentingWindowName,
	PREVIOUS_SLIDE_KEYS,
	takesSpace,
} from "./PresentingView";

const source = readFileSync(join(import.meta.dir, "PresentingView.tsx"), "utf8");
const page = readFileSync(
	join(import.meta.dir, "..", "pages", "PresenterPage.tsx"),
	"utf8",
);
// The view's and the page's English text (REQ248).
const viewSection = readFileSync(
	join(import.meta.dir, "..", "interface-text", "presenting-view.ts"),
	"utf8",
);
const slideView = readFileSync(join(import.meta.dir, "PresenterSlideView.tsx"), "utf8");
const pageSection = readFileSync(
	join(import.meta.dir, "..", "interface-text", "presenter-page.ts"),
	"utf8",
);

describe("the keys of the presenting view (REQ247)", () => {
	const free = { modified: false, typing: false, overlayOpen: false };

	test("F enters or leaves, B blanks, either case", () => {
		expect(presentingShortcut({ ...free, key: "f" })).toBe("presenting");
		expect(presentingShortcut({ ...free, key: "F" })).toBe("presenting");
		expect(presentingShortcut({ ...free, key: "b" })).toBe("blank");
		expect(presentingShortcut({ ...free, key: "g" })).toBeNull();
	});

	test("not with a modifier, in a field, or with a dialog or menu open", () => {
		for (const held of [
			{ modified: true },
			{ typing: true },
			{ overlayOpen: true },
		]) {
			expect(presentingShortcut({ ...free, ...held, key: "f" })).toBeNull();
			expect(presentingShortcut({ ...free, ...held, key: "b" })).toBeNull();
		}
	});

	test("a field is an input, a textarea, a select or editable content", () => {
		for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
			expect(isTypingTarget({ tagName })).toBe(true);
		}
		expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
		expect(isTypingTarget({ tagName: "BUTTON", isContentEditable: false })).toBe(
			false,
		);
		expect(isTypingTarget(null)).toBe(false);
	});

	test("Space is a focused button's, or a field's, not Next", () => {
		// Acceptance: Space on a focused Present, Blank or Exit paged the room.
		const element = (tagName: string, role: string | null = null) => ({
			tagName,
			getAttribute: (name: string) => (name === "role" ? role : null),
		});
		expect(takesSpace(element("BUTTON"))).toBe(true);
		expect(takesSpace(element("SUMMARY"))).toBe(true);
		expect(takesSpace(element("INPUT"))).toBe(true);
		for (const role of ["button", "menuitemradio", "switch", "tab"]) {
			expect(takesSpace(element("DIV", role))).toBe(true);
		}
		expect(takesSpace(element("BODY"))).toBe(false);
		expect(takesSpace(element("DIV", "toolbar"))).toBe(false);
		expect(takesSpace(null)).toBe(false);
	});

	test("F on the start card leaves where the browser offers no full screen", () => {
		// Review: with full screen disabled, F on the start card did nothing.
		expect(page).toMatch(
			/if \(!presenting\) enterPresenting\(\);\s*else if \(startCardShown && document\.fullscreenEnabled\) requestFullscreen\(\);\s*else leavePresenting\(\);/,
		);
	});

	test("the page lets Space press the focused control before it pages", () => {
		const handler = page.slice(
			page.indexOf("const handleKeyDown = useCallback("),
			page.indexOf('window.addEventListener("keydown", handleKeyDown)'),
		);
		const guard = handler.search(
			/if \(\s*e\.key === " " &&\s*takesSpace\(e\.target instanceof HTMLElement \? e\.target : null\)\s*\) \{\s*return;/,
		);
		expect(guard).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(handler.indexOf("const pagingKey ="));
		expect(guard).toBeLessThan(handler.indexOf("if (NEXT_SLIDE_KEYS.includes(e.key)) {"));
	});

	test("a clicker's PageDown and PageUp page as the arrows do", () => {
		expect([...NEXT_SLIDE_KEYS].sort()).toEqual(
			[" ", "ArrowDown", "ArrowRight", "PageDown"].sort(),
		);
		expect([...PREVIOUS_SLIDE_KEYS].sort()).toEqual(
			["ArrowLeft", "ArrowUp", "PageUp"].sort(),
		);
	});

	test("the page pages, and closes the QR, through those lists", () => {
		const handler = page.slice(
			page.indexOf("const handleKeyDown = useCallback("),
			page.indexOf('window.addEventListener("keydown", handleKeyDown)'),
		);
		const qr = handler.slice(handler.indexOf("if (showQr)"));
		expect(qr.slice(0, qr.indexOf("return;"))).toContain(
			"NEXT_SLIDE_KEYS.includes(e.key) ||\n\t\t\t\t\tPREVIOUS_SLIDE_KEYS.includes(e.key)",
		);
		expect(handler).toContain("if (NEXT_SLIDE_KEYS.includes(e.key)) {");
		expect(handler).toContain("if (PREVIOUS_SLIDE_KEYS.includes(e.key)) {");
		// Escape leaves the view unless a menu answered it or a dialog owns it.
		expect(handler).toMatch(
			/if \(e\.key === "Escape" && presenting\) \{\s*if \(!e\.defaultPrevented && !dialogOpen\) \{/,
		);
	});

	test("one Escape never ends both the full screen and the view", () => {
		// In full screen, Escape ends the full screen alone.
		expect(
			presentingEscape({ inFullscreen: true, msSinceFullscreenEnded: null }),
		).toBe("end-fullscreen");
		// The press a browser spent on its full screen, delivered after it ended.
		expect(
			presentingEscape({ inFullscreen: false, msSinceFullscreenEnded: 20 }),
		).toBe("spent");
		// A further press leaves.
		expect(
			presentingEscape({
				inFullscreen: false,
				msSinceFullscreenEnded: FULLSCREEN_ESCAPE_GRACE_MS,
			}),
		).toBe("leave");
		expect(
			presentingEscape({ inFullscreen: false, msSinceFullscreenEnded: null }),
		).toBe("leave");
	});

	test("the page's Escape goes through that rule and leaves only on `leave`", () => {
		const handler = page.slice(
			page.indexOf("const handleKeyDown = useCallback("),
			page.indexOf('window.addEventListener("keydown", handleKeyDown)'),
		);
		const escape = handler.slice(
			handler.indexOf('if (e.key === "Escape" && presenting) {'),
			handler.indexOf("// Below `sm`, Escape takes down the panel sheet"),
		);
		expect(escape).toContain("const escape = presentingEscape({");
		// Chromium clears the full screen before it dispatches the event, so a
		// press in that gap counts as the one that ended it.
		expect(escape).toMatch(/msSinceFullscreenEnded: fullscreenSeenRef\.current\s*\?\s*0\s*:/);
		expect(page).toContain("fullscreenSeenRef.current = document.fullscreenElement !== null;");
		expect(escape).toMatch(
			/if \(escape === "end-fullscreen"\) \{\s*document\.exitFullscreen\(\)\.catch\(\(\) => \{\}\);\s*\} else if \(escape === "leave"\) \{\s*leavePresenting\(\);\s*\}/,
		);
		expect(escape.match(/leavePresenting\(\)/g)?.length).toBe(1);
	});
});

describe("the address and the second window (REQ247)", () => {
	test("#presenting still resolves to the presenter screen", () => {
		expect(PRESENTING_HASH).toBe("#presenting");
		expect(routeForLocation("/present/deck-1", PRESENTING_HASH.slice(1))).toEqual({
			page: "present",
			id: "deck-1",
		});
	});

	test("#presenting typed into an open page opens the view, and removing it leaves", () => {
		// Acceptance: a same-document hash change left the address claiming a
		// view the screen was not in.
		const follow = page.slice(page.indexOf("const followAddress = () => {"));
		expect(follow).toMatch(
			/if \(addressed && !presenting\) \{\s*setPresenting\(true\);\s*setStartCardShown\(true\);\s*\} else if \(!addressed && presenting\) \{\s*leavePresenting\(\);/,
		);
		expect(page).toContain('window.addEventListener("hashchange", followAddress);');
		expect(page).toContain('window.removeEventListener("hashchange", followAddress);');
	});

	test("the view rides the address without a history entry", () => {
		expect(page).toContain("window.location.hash === PRESENTING_HASH");
		expect(page).toContain("window.history.replaceState(");
		expect(page).not.toContain("history.pushState");
	});

	test("one named window per deck, opened straight into the view", () => {
		expect(presentingWindowName("deck-1")).toBe("omul-presenting-deck-1");
		expect(page).toContain(
			"`/present/${pres.id}${PRESENTING_HASH}`,\n\t\t\t\t\t\tpresentingWindowName(pres.id),",
		);
	});

	test("leaving full screen leaves the presenting view on", () => {
		// Acceptance: Esc in full screen ended the full screen and the view at
		// once, so the presenter's console reached the projector.
		const follow = page.slice(
			page.indexOf("const followFullscreen = () => {"),
			page.indexOf('document.addEventListener("fullscreenchange", followFullscreen);'),
		);
		expect(follow.length).toBeGreaterThan(0);
		expect(follow).not.toContain("leavePresenting");
		expect(follow).not.toContain("setPresenting(");
		expect(follow).toMatch(
			/\} else \{\s*requestedFullscreenRef\.current = false;\s*fullscreenEndedAtRef\.current = performance\.now\(\);\s*\}/,
		);
	});

	test("leaving ends only a full screen the view asked for", () => {
		expect(page).toMatch(
			/if \(requestedFullscreenRef\.current\) \{\s*requestedFullscreenRef\.current = false;\s*if \(document\.fullscreenElement\) document\.exitFullscreen\(\)/,
		);
		expect(page).toContain('document.addEventListener("fullscreenchange", followFullscreen);');
		expect(page).toContain("document.documentElement.requestFullscreen()");
	});
});

describe("what the room sees, and the strip (REQ247)", () => {
	test("the layer goes down after three seconds, and hides the cursor", () => {
		expect(PRESENTING_LAYER_IDLE_MS).toBe(3000);
		expect(source).toContain('${layerUp ? "" : "cursor-none"}');
	});

	test("the slide's own controls hide by visibility, never by removal", () => {
		expect(source).toContain("layerUp ? STAGE_CONTROLS_SHOWN : STAGE_CONTROLS_HIDDEN");
		expect(source).toMatch(/const STAGE_CONTROLS_HIDDEN =\s*"[^"]*:invisible [^"]*:opacity-0 /);
		expect(source).not.toMatch(/const STAGE_CONTROLS_\w+ =\s*"[^"]*(?:hidden|display)/);
		// Without the fade under reduced motion.
		expect(source).toMatch(/const LAYER_HIDDEN =\s*"[^"]*motion-reduce:transition-none"/);
	});

	test("a line marked as the presenter's goes with the layer", () => {
		// Acceptance: a presenter-only hint stayed on the projector with the
		// layer down. A line marked `data-presenter-hint` hides as a control does.
		expect(source).toMatch(
			/const STAGE_CONTROLS_HIDDEN =\s*"\[&_:is\(button,input,select,textarea,\[data-presenter-hint\]\)\]:invisible /,
		);
	});

	test("under a hidden or private tally the slide shows only the room's sentence", () => {
		// The hints the earlier unmerged branch marked ("Reveal when you're ready", "not shown on the
		// shared screen") are not drawn on this base: the slide view shows the
		// room's text in the deck's language (REQ225), so the projector has no
		// presenter-only line to hide. Should one come back, it carries the marker.
		expect(slideView).not.toContain("Reveal when you're ready");
		expect(slideView).not.toContain("not shown on the shared screen");
		expect(slideView.match(/<p className="text-text-dim mb-4">\{dict\.resultsHidden\}<\/p>/g)?.length).toBe(2);
	});

	test("the start card is a dialog that takes focus ahead of the strip", () => {
		// Acceptance: it was not announced, and its actions came last in Tab order.
		const card = source.slice(source.indexOf("{startCardShown && ("));
		expect(card).toMatch(
			/ref=\{startCardRef\}\s*role="dialog"\s*aria-labelledby=\{startCardTextId\}/,
		);
		expect(card).toContain("<p id={startCardTextId}");
		expect(source).toMatch(
			/if \(!startCardShown\) return;\s*startCardRef\.current\s*\?\.querySelector<HTMLButtonElement>\("button:not\(:disabled\)"\)\s*\?\.focus\(\);/,
		);
		// Tab stays native between its own actions, and leaves it for the strip.
		expect(source).toContain(
			"(event.shiftKey ? cardAction > 0 : cardAction < cardActions.length - 1)",
		);
		// It is not the layer's, so it neither holds the layer up nor loses focus.
		expect(source).toContain("!(startCardRef.current?.contains(focused) ?? false);");
		expect(source).toContain("if (focusInLayer) focused.blur();");
	});

	test("the strip is one toolbar in the documented order", () => {
		const strip = source.slice(source.indexOf('role="toolbar"'));
		expect(strip).toContain("aria-label={viewText.controls}");
		expect(viewSection).toContain('controls: "Presenting controls",');
		const order = [
			"onPage(paging.previous.index)",
			"{position}",
			"onPage(paging.next.index)",
			'<div aria-hidden className="w-px h-5 bg-border" />',
			"aria-pressed={blank.pressed}",
			"<AudienceBlankIcon blanked={blank.pressed} />",
			"onClick={onShowQr}",
			"{fullscreenOffered && (",
			'<div aria-hidden className="w-px h-5 bg-border" />',
			"aria-label={viewText.leave}",
		];
		let at = 0;
		for (const marker of order) {
			const found = strip.indexOf(marker, at);
			expect(found).toBeGreaterThan(at - 1);
			at = found + marker.length;
		}
		expect(strip).toContain("disabled={paging.previous.disabled}");
		expect(strip).toContain("disabled={blank.disabled}");
		// The blank's glyph is the Present menu row's (`AudienceBlankIcon`), not a monitor.
		expect(source).not.toMatch(/\bMonitor(?:Off)?\b/);
		expect(viewSection).toContain('leave: "Leave presenting view (Esc)",');
	});

	test("the join line is quiet, goes with the blank, and is in the deck's language", () => {
		// The room reads it, so it is the deck's `Dict` and says so (REQ248).
		expect(source).toMatch(/\{!blanked && \(\s*<p\s+lang=\{roomLanguage\}\s+className="pointer-events-none [^"]*text-sm text-text-muted"\s*>\s*\{getDict\(join\.language\)\.roomJoinAt\} \{join\.host\}/);
		expect(source).toContain("const roomLanguage = resolveLang(join.language);");
		expect(page).toMatch(/join=\{\{[^}]*language: pres\.language,/);
		expect(source).toContain(
			'<span className="font-mono font-bold text-accent-text tracking-widest">',
		);
	});
});

describe("how the presenter screen offers the view (REQ247)", () => {
	const screen = page.slice(page.indexOf("aria-label={pageText.sharedScreenGroup}"));
	const screenGroup = screen.slice(0, screen.indexOf("</div>"));

	test("Present is the Screen group's one control, from `sm`, and the blank is one of its rows", () => {
		// The blank moved from a button beside Present into its menu (REQ109).
		expect(screenGroup).not.toContain("aria-pressed={screenBlanked}");
		expect(screenGroup).toContain("{presentMenuRows}");
		const rows = page.slice(
			page.indexOf("const presentMenuRows = (close: () => void) => ("),
			page.indexOf("const deckMenuRows = (close: () => void) => ("),
		);
		expect(rows).toContain("{...blankMenuRow({ blanked: screenBlanked, canControl: isOwner }, text)}");
		expect(screenGroup).toContain("triggerClassName={`${BAR_GROUP_ITEM} max-sm:hidden`}");
		expect(screenGroup).not.toContain("aria-pressed={presenting");
		expect(page).toContain("const presentLabel = pageText.presentLabel;");
		expect(pageSection).toContain(
			'presentLabel: "Present — show only the slide, full screen (F)",',
		);
	});

	test("the view is an early return ahead of the blank, without the in-slide row", () => {
		const presentingReturn = page.indexOf("if (presenting) {");
		expect(presentingReturn).toBeGreaterThan(-1);
		expect(presentingReturn).toBeLessThan(
			page.indexOf('if (sharedScreenView(pres) === "blank")'),
		);
		expect(page).toContain("slideStage(true)");
		expect(page).toMatch(/\{!presentingView && \(\s*<div className="max-sm:hidden">\{slideNavigation\}<\/div>/);
	});

	test("the hint under the slide names the key", () => {
		expect(page).toContain("{pageText.pagingHint}");
		expect(pageSection).toContain('pagingHint: "(arrow keys · F to present)",');
	});
});
