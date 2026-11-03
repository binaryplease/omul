import {
	ALargeSmall,
	Accessibility,
	ChevronRight,
	Contrast,
	Heading,
	ImageOff,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Slide } from "../types";
import type {
	SlideAccessibilityField,
	SlideAccessibilityFinding,
	SlideAccessibilityRisk,
} from "./DeckAccessibility";
import { ICON_BUTTON_HOVER } from "./ShareCluster";
import { slideQuestionLabel } from "./SlideCanvasFields";

// ── The deck accessibility check, in the editor (REQ132) ──────────────
//
// `DeckAccessibility.ts` decides what is at risk; this module is how the editor
// shows it and how a finding takes the organizer to what clears it. Three
// pieces, so the page that wires them holds no rule of its own:
//
//   - **Where a finding goes** — `accessibilityFindingDestination()`, pure: the
//     rail selection, the slide the canvas draws, and the field to bring up. A
//     slide's own field is in that slide's column (or, for its heading, on the
//     canvas); the deck's theme and brand are in the presentation settings,
//     drawn against the slide the finding is about.
//   - **What the field is** — `accessibilityFieldMarker()`, spread on the
//     control that edits it, and `revealAccessibilityField()`, which opens a
//     closed disclosure around it, scrolls it into view and puts the caret in
//     it. A marker rather than a ref threaded through every group, so the
//     controls stay where they are and only say which field they edit.
//   - **What the organizer reads** — `<AccessibilityFindingsStrip/>`, under the
//     canvas beside the notes and comment strips: the slide's findings, each
//     with the one control that goes to its field. The rail's thumbnails carry
//     each slide's count, so the deck's findings are visible slide by slide.
//
// Findings are advisory: nothing here is read by Save, Present or Publish.

/** The attribute that marks the control editing a field a finding names. */
export const ACCESSIBILITY_FIELD_ATTRIBUTE = "data-accessibility-field";

/** One string per field — `slide:textColor`, `deck:theme` — the marker's value. */
export function accessibilityFieldTarget(field: SlideAccessibilityField): string {
	return `${field.scope}:${field.name}`;
}

/** Spread on the control (or the wrapper around it) that edits `field`. */
export function accessibilityFieldMarker(field: SlideAccessibilityField) {
	return { [ACCESSIBILITY_FIELD_ATTRIBUTE]: accessibilityFieldTarget(field) };
}

/** What each field is called on the control that goes to it. */
export function accessibilityFieldLabel(
	field: SlideAccessibilityField,
	slide: Slide,
): string {
	if (field.scope === "deck") {
		return field.name === "theme" ? "Deck theme" : "Your own theme";
	}
	switch (field.name) {
		case "textColor":
			return "Text colour";
		case "backgroundColor":
			return "Background colour";
		case "backgroundImage":
			return "Background image";
		case "textSize":
			return "Text size";
		case "mediaAlt":
			return "Alt text";
		case "question":
			return slideQuestionLabel(slide);
	}
}

/** Each slide's findings, keyed by slide id, in the order the check gave them. */
export function accessibilityFindingsBySlide(
	findings: readonly SlideAccessibilityFinding[],
): Map<string, SlideAccessibilityFinding[]> {
	const bySlide = new Map<string, SlideAccessibilityFinding[]>();
	for (const finding of findings) {
		const slideFindings = bySlide.get(finding.slideId) ?? [];
		slideFindings.push(finding);
		bySlide.set(finding.slideId, slideFindings);
	}
	return bySlide;
}

export type AccessibilityFindingDestination = {
	/** What the rail selects: the slide, or the deck's settings panel. */
	selection: number | "settings";
	/** The slide the canvas draws — the finding's, whichever panel is open. */
	canvasSlideIndex: number;
	/** The marker of the field to bring up, or `null` when none is named. */
	target: string | null;
	/** Whether the canvas must show the slide rather than its results. */
	showsQuestion: boolean;
};

/** Where acting on a finding takes the editor. */
export function accessibilityFindingDestination(
	finding: SlideAccessibilityFinding,
): AccessibilityFindingDestination {
	const { field } = finding;
	return {
		selection: field?.scope === "deck" ? "settings" : finding.slideIndex,
		canvasSlideIndex: finding.slideIndex,
		target: field ? accessibilityFieldTarget(field) : null,
		// The heading is written on the canvas (REQ153), and only its question
		// view carries the field.
		showsQuestion: field?.scope === "slide" && field.name === "question",
	};
}

const FOCUSABLE_FIELD =
	'textarea, input:not([type="color"]):not([type="hidden"]), select, button, [tabindex]:not([tabindex="-1"])';

/**
 * Bring up the field a marker names: open the disclosure it rests in, scroll it
 * into view and focus its first control. A field can sit inside a disclosure
 * that is itself marked (a question's illustration holds its alt text), so the
 * innermost marked element is the one focused once the outer one is open.
 * Returns whether the field was found.
 */
export function revealAccessibilityField(
	root: ParentNode,
	target: string,
	nextFrame: (callback: () => void) => void = (callback) =>
		requestAnimationFrame(() => callback()),
): boolean {
	const selector = `[${ACCESSIBILITY_FIELD_ATTRIBUTE}="${target}"]`;
	const outer = root.querySelector<HTMLElement>(selector);
	if (!outer) return false;
	// A marked disclosure is the marker's own first child (`DisclosureRow`'s
	// closed button), so nothing else that happens to be closed is opened.
	const toggle = (
		outer.matches('[aria-expanded="false"]') ? outer : outer.firstElementChild
	) as HTMLElement | null;
	if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
	nextFrame(() => {
		const marked = root.querySelectorAll<HTMLElement>(selector);
		const field = marked[marked.length - 1] ?? outer;
		field.scrollIntoView({ block: "center", behavior: "smooth" });
		const control = field.matches(FOCUSABLE_FIELD)
			? field
			: field.querySelector<HTMLElement>(FOCUSABLE_FIELD);
		control?.focus({ preventScroll: true });
	});
	return true;
}

const RISK_ICONS: Record<SlideAccessibilityRisk, ReactNode> = {
	"low-contrast": <Contrast size={14} />,
	"small-text": <ALargeSmall size={14} />,
	"missing-alt": <ImageOff size={14} />,
	"missing-heading": <Heading size={14} />,
};

/** How many findings, said the way the strip and the rail say it. */
export function accessibilityFindingCountLabel(count: number): string {
	return count === 1 ? "1 accessibility finding" : `${count} accessibility findings`;
}

/**
 * The slide's findings under the canvas, each with the control that goes to its
 * field. A slide with none says so in one line, the way the notes strip says a
 * slide has no notes, and names how many the rest of the deck holds so a clean
 * slide is not read as a clean deck.
 */
export function AccessibilityFindingsStrip({
	slide,
	findings,
	deckFindingCount,
	onGoToFinding,
}: {
	slide: Slide;
	/** This slide's findings, from `accessibilityFindingsBySlide()`. */
	findings: readonly SlideAccessibilityFinding[];
	/** Every slide's findings together, this one's included. */
	deckFindingCount: number;
	onGoToFinding: (finding: SlideAccessibilityFinding) => void;
}) {
	const elsewhere = deckFindingCount - findings.length;
	const elsewhereNote =
		elsewhere > 0
			? `${elsewhere} on other slides — marked in the rail.`
			: "None on other slides.";

	if (findings.length === 0) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-border bg-surface/40 px-3 py-2">
				<Accessibility size={14} className="flex-shrink-0 text-text-muted" />
				<p className="min-w-0 flex-1 basis-56 text-sm text-text-muted">
					No accessibility risks found on this slide.
				</p>
				<span className="text-xs text-text-muted">
					{elsewhereNote}
				</span>
			</div>
		);
	}

	return (
		<section
			aria-label="Accessibility findings on this slide"
			className="mx-auto w-full max-w-3xl space-y-2 rounded-xl border border-warning/40 bg-surface/40 px-3 py-2.5"
		>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
				<Accessibility size={14} className="flex-shrink-0 text-warning" />
				<span className="min-w-0 flex-1 basis-56 text-sm font-medium text-text">
					{accessibilityFindingCountLabel(findings.length)} on this slide
				</span>
				<span className="text-xs text-text-muted">
					{elsewhereNote}
				</span>
			</div>
			<ul className="space-y-1.5">
				{findings.map((finding) => (
					<li
						key={`${finding.risk}-${finding.field ? accessibilityFieldTarget(finding.field) : "none"}`}
						className="flex items-start gap-2"
					>
						<span aria-hidden="true" className="mt-0.5 flex-shrink-0 text-warning">
							{RISK_ICONS[finding.risk]}
						</span>
						<p className="min-w-0 flex-1 text-sm text-text-muted">{finding.message}</p>
						{finding.field && (
							<button
								type="button"
								className={`inline-flex flex-shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${ICON_BUTTON_HOVER}`}
								aria-label={`Go to ${accessibilityFieldLabel(finding.field, slide).toLowerCase()}`}
								onClick={() => onGoToFinding(finding)}
							>
								{accessibilityFieldLabel(finding.field, slide)}
								<ChevronRight size={12} aria-hidden="true" />
							</button>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
