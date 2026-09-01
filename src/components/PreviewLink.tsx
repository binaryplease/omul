import { Eye } from "lucide-react";
import type { Route } from "../router";

// ── The way into a preview (REQ103) ───────────────────────────
//
// Two surfaces offer the dry run — the editor, where a deck is prepared, and
// the presenter's screen, where it is about to be run — so the control is one
// component rather than two buttons that will eventually disagree about what
// it is called and what it warns (ADR-0026).
//
// It is offered whether or not this browser can edit the deck, disabled with
// its reason rather than dropped (ADR-0025): a preview reads the deck's answer
// keys, so it needs the same credential an edit does, and a viewer who cannot
// open one should learn *why* rather than find nothing there.

export function PreviewLink({
	presentationId,
	go,
	canPreview,
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
	className?: string;
}) {
	return (
		<button
			type="button"
			className={className}
			onClick={() => go({ page: "preview", id: presentationId })}
			disabled={!canPreview}
			title={
				canPreview
					? "Preview the deck with test votes — nothing is saved and no session is started"
					: "You don't have edit access to this presentation, so its preview is not yours to open"
			}
		>
			<Eye size={14} />
			<span className="hidden sm:inline">Preview</span>
		</button>
	);
}
