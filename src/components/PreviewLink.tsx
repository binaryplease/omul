import { Eye } from "lucide-react";
import type { Route } from "../router";
import { BarMenuRow } from "./ui/BarMenu";

// ── The way into a preview (REQ103) ───────────────────────────
//
// Two surfaces offer the dry run — the editor, where a deck is prepared, and
// the presenter's screen, where it is about to be run — so the control is one
// component rather than two buttons that will eventually disagree about what
// it is called and what it warns.
//
// It is offered whether or not this browser can edit the deck, disabled with
// its reason rather than dropped: a preview reads the deck's answer
// keys, so it needs the same credential an edit does, and a viewer who cannot
// open one should learn *why* rather than find nothing there.
//
// The `menu-row` variant is the presenter's Deck menu row (REQ190): always
// labelled, and the reason drawn as a visible second line when disabled.

export function PreviewLink({
	presentationId,
	go,
	canPreview,
	variant = "button",
	className = "btn-secondary text-sm flex items-center gap-1.5",
}: {
	presentationId: string;
	go: (route: Route) => void;
	/**
	 * Whether this caller may edit the deck — its owner, the holder of its edit
	 * token, or an `edit` collaborator. Decided by `callerCanEditDeck`, never by
	 * the token map alone (REQ149).
	 */
	canPreview: boolean;
	variant?: "button" | "menu-row";
	className?: string;
}) {
	const title = canPreview
		? "Preview the deck with test votes — nothing is saved and no session is started"
		: "You don't have edit access to this presentation, so its preview is not yours to open";
	const open = () => go({ page: "preview", id: presentationId });
	if (variant === "menu-row") {
		return (
			<BarMenuRow
				icon={<Eye size={16} />}
				label="Preview"
				reason={title}
				disabled={!canPreview}
				title={title}
				onClick={open}
			/>
		);
	}
	return (
		<button
			type="button"
			className={className}
			onClick={open}
			disabled={!canPreview}
			title={title}
		>
			<Eye size={14} />
			<span className="hidden sm:inline">Preview</span>
		</button>
	);
}
