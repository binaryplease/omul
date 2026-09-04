#!/usr/bin/env bun
// ── Frontend convention guard ─────────────────────────────────────────
//
// Narrow, executable backstops for the frontend conventions that drift silently
// under autonomous development — one descriptor per cross-surface affordance,
// and one shared token per interaction state. Each check targets
// one specific regression with a low false-positive rate, names the primitive
// to use in its message, and allowlists the canonical module that owns it.
//
// Run via `mise run check` (or `bun scripts/guard-frontend-conventions.ts`).
// Exits non-zero — and names the fix — when a surface bypasses a primitive.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SOURCE_ROOT = join(import.meta.dir, "..", "src");

type Violation = { file: string; line: number; text: string; message: string };

function sourceFiles(directory: string): string[] {
	const entries: string[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) {
			entries.push(...sourceFiles(path));
		} else if (path.endsWith(".tsx") || path.endsWith(".ts")) {
			entries.push(path);
		}
	}
	return entries;
}

/**
 * A single guard: a regex applied line by line, skipping files whose path
 * contains any allowlisted fragment (the canonical owner of the primitive).
 */
type Guard = {
	name: string;
	pattern: RegExp;
	allowlist: string[];
	message: string;
	/** Skip comment/prose lines — a glyph in a comment is never an icon. */
	skipComments?: boolean;
};

/** True for a line that is wholly a comment (line, block, JSDoc, or JSX). */
function isCommentLine(lineText: string): boolean {
	const trimmed = lineText.trimStart();
	return (
		trimmed.startsWith("//") ||
		trimmed.startsWith("*") ||
		trimmed.startsWith("/*") ||
		trimmed.startsWith("{/*")
	);
}

/** Drop any trailing `// …` comment so glyphs in it aren't matched as icons. */
function stripTrailingComment(lineText: string): string {
	const commentStart = lineText.indexOf("//");
	return commentStart === -1 ? lineText : lineText.slice(0, commentStart);
}

const guards: Guard[] = [
	{
		// Glyph characters used as icons. The project uses lucide-react
		// for icons; arrows/checks/triangles as literal glyphs are always
		// icons-as-text. These code points never appear in the app's prose, so
		// matching them directly stays low-noise.
		name: "glyph-as-icon",
		pattern: /[←→↑↓⬆⬇⬅➡▲▼◀▶△▽✓✔✗✕✖★☆➜➤]/u,
		allowlist: [],
		skipComments: true,
		message:
			"Unicode glyph used as an icon — import the equivalent icon from lucide-react instead.",
	},
	{
		// The muted → accent icon-button hover treatment is a shared
		// interaction-state token. It must be composed from ShareCluster, never
		// re-declared inline per surface.
		name: "inline hover token",
		pattern: /text-text-muted\s+hover:text-accent/,
		allowlist: ["components/ShareCluster.tsx"],
		message:
			"Inline interaction-state hover style — compose ICON_BUTTON_HOVER from src/components/ShareCluster.tsx instead.",
	},
	{
		// A deck's logo (REQ136) reaches a *rendering* surface through
		// deckLogoFor() and <DeckMark/>, never off the field. The resolver is what
		// refuses a URL no `<img>` should be pointed at, so a surface reading the
		// raw string has stepped around the check as well as around the fallback
		// mark. Only the editor is allowlisted, because it is the one surface that
		// *authors* the field rather than drawing it — and it draws it through
		// <DeckMark/> like everybody else.
		name: "REQ136 raw logo field",
		pattern: /\.themeLogoUrl\b/,
		allowlist: ["pages/CreatePage.tsx"],
		skipComments: true,
		message:
			"Deck logo URL read straight off the field — resolve it with deckLogoFor() or render <DeckMark/> from src/components/DeckTheme.tsx instead.",
	},
	{
		// A deck's own theme (REQ080) reaches a *rendering* surface
		// through deckBrandFor() and the DeckTheme catalog, never off the field.
		// The resolver is what refuses a value that is not a colour and a face this
		// build does not ship, so a surface reading the raw object has stepped
		// around the check as well as around the house-theme fallback — and these
		// values end up in a `background`, which is the one place a string that was
		// never a colour must not arrive. Two files are allowlisted and neither
		// draws anything: the editor, the one surface that *authors* the brand
		// (and which renders it through the same resolver as everybody else), and
		// the authoring document's reducer, which owns the field the editor writes.
		name: "REQ080 raw brand field",
		pattern: /\.themeBrand\b/,
		allowlist: ["pages/CreatePage.tsx", "store/editorDocument.ts"],
		skipComments: true,
		message:
			"Deck brand read straight off the field — resolve it with deckBrandFor() or render through <DeckThemeScope/> from src/components/DeckTheme.tsx instead.",
	},
	{
		// A slide's own appearance (REQ087/REQ070/REQ071/REQ019) reaches
		// a *rendering* surface through slideAppearanceFor() and
		// <SlideAppearanceScope/>, never off the field. The resolver is what refuses
		// a value that is not a colour, a layout this build cannot draw and a URL no
		// browser should be pointed at — and these values end up in a `background`
		// and a `background-image`, which is exactly where a string that was never a
		// colour must not arrive. A surface reading the raw field has stepped around
		// the check as well as around the theme it should have fallen back to.
		// Exactly one file is allowlisted and it draws no slide: the per-slide
		// editor, the one surface that *authors* these fields — and which previews
		// them through the same resolver as everybody else.
		// The identifier is matched by its *suffix* (`slide`, `activeSlide`,
		// `audienceSlide`, …) rather than by the bare name, because a surface holds
		// the slide it is drawing under whatever it happens to call it, and a guard
		// that only knew one spelling would wave the other three through.
		name: "REQ087 raw slide appearance field",
		pattern:
			/\b\w*[Ss]lide\.(layout|backgroundColor|backgroundImage|textColor|chartColor)\b/,
		allowlist: ["components/SlideEditor.tsx"],
		skipComments: true,
		message:
			"Slide appearance read straight off the field — resolve it with slideAppearanceFor() or render through <SlideAppearanceScope/> from src/components/SlideAppearance.tsx instead.",
	},
	{
		// REQ152: the editor draws the slide being authored in exactly one
		// place — the stage — and `<SlideCanvas/>` is it. `SlidePreview` is that
		// stage's renderer, and the deck theming around it is part of the frame, so
		// a second render site would be a second answer to "what will the room see"
		// living one scroll away from the first. The retired `hidden xl:flex`
		// preview aside is precisely the shape this guard refuses to let grow back.
		name: "REQ152 second slide-preview site",
		pattern: /<SlidePreview\b/,
		allowlist: ["components/SlideCanvas.tsx"],
		// A comment naming `<SlidePreview/>` is prose about the move, not a second
		// render site — and this move's rationale is exactly the kind of thing the
		// next surface will want to write down. Only real markup counts.
		skipComments: true,
		message:
			"Slide drawn outside the editor's stage — render <SlideCanvas/> from src/components/SlideCanvas.tsx instead.",
	},
	{
		// REQ153: the editor's authoring layer — the hover outlines, the
		// add-option row, the correct/remove tools on each option — is drawn by the
		// one rendering path the room's slide is drawn by, and is switched on by
		// being *handed* `SlideCanvasEditing` rather than by a flag. That makes the
		// question "can this screen be typed on?" answerable by grep, and this guard
		// is the answer: the descriptor may only appear along the canvas's own chain
		// (the module that owns it, the stage, the renderer and the content-slide
		// renderer it passes through, and the page that builds it). A participant's
		// phone, the presenter's screen, the shared results page or the dry run
		// naming it at all is an editing affordance one prop away from an audience.
		name: "REQ153 editing layer off the canvas",
		pattern: /\bSlideCanvasEditing\b/,
		allowlist: [
			"components/SlideCanvasFields.tsx",
			"components/SlideCanvas.tsx",
			"components/SlidePreview.tsx",
			"components/ContentSlideView.tsx",
			"pages/CreatePage.tsx",
		],
		skipComments: true,
		message:
			"Slide editing layer reached outside the editor's stage — author a slide through <SlideCanvas editing=…/> from src/components/SlideCanvas.tsx instead.",
	},
	{
		// REQ004/REQ005: two galleries draw a template — the built-in catalog and
		// the templates a workspace publishes — and what they draw is the same
		// entry, so the card and the words for its five categories are one
		// descriptor owned by one module. A surface that re-declared the label map
		// is a surface where "Teaching" can quietly become "Education" on one
		// gallery and not the other; a surface that re-declared the card is where
		// the tags stop being rendered on one of them and a search starts matching
		// on something the reader cannot see.
		name: "re-declared template category labels",
		pattern: /DECK_TEMPLATE_CATEGORY_LABELS(\s*:|\s*=)/,
		allowlist: ["components/TemplateCard.tsx"],
		skipComments: true,
		message:
			"Template category labels re-declared — import DECK_TEMPLATE_CATEGORY_LABELS and render <TemplateCard/> from src/components/TemplateCard.tsx instead.",
	},
	{
		// The share-control cluster is a single descriptor + wrapper.
		// These title strings are unique to those controls; finding them outside
		// the wrapper means the affordance was hand-rolled again.
		name: "hand-rolled share control",
		pattern:
			/title="(Copy join code|Copy join link|Copy embed code|Copy share link with edit permissions)"/,
		allowlist: ["components/ShareCluster.tsx"],
		message:
			"Hand-rolled share control — build it with buildShareControls() and render <ShareCluster/> from src/components/ShareCluster.tsx instead.",
	},
];

const violations: Violation[] = [];

for (const file of sourceFiles(SOURCE_ROOT)) {
	const relativePath = relative(join(import.meta.dir, ".."), file);
	const lines = readFileSync(file, "utf8").split("\n");
	for (const guard of guards) {
		if (guard.allowlist.some((fragment) => relativePath.includes(fragment))) {
			continue;
		}
		lines.forEach((lineText, index) => {
			if (guard.skipComments && isCommentLine(lineText)) {
				return;
			}
			const scanned = guard.skipComments
				? stripTrailingComment(lineText)
				: lineText;
			if (guard.pattern.test(scanned)) {
				violations.push({
					file: relativePath,
					line: index + 1,
					text: lineText.trim(),
					message: `[${guard.name}] ${guard.message}`,
				});
			}
		});
	}
}

if (violations.length > 0) {
	console.error(`✗ ${violations.length} frontend-convention violation(s):\n`);
	for (const violation of violations) {
		console.error(`  ${violation.file}:${violation.line}`);
		console.error(`    ${violation.message}`);
		console.error(`    > ${violation.text}\n`);
	}
	process.exit(1);
}

console.log("✓ frontend conventions OK");
