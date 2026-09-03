import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Workspace, WorkspaceRole } from "../types";
import { canCreateWorkspaceDecks } from "../types";
import { workspaceRoleLabel } from "./WorkspaceRoles";
import { Modal } from "./ui/Modal";

// ── Handing one of your decks to a workspace (REQ128) ─────────
//
// The other half of the move `WorkspacePage` offers: that page takes a deck back
// out, this hands one in. It sits behind a control on the deck's own card
// — what it changes is that deck's owner, so it lives beside the deck
// rather than in the workspace's chrome, where an organizer would have to know
// which of their decks they meant before they got there.
//
// The list is filtered to the workspaces this account may actually create decks
// in, and that is not a permission check: the server re-decides it (REQ129), and
// a workspace offered here that refused the move would be a `403` in place of a
// result. A caller in no such workspace is told so rather than shown an empty
// picker.

export function MoveToWorkspaceDialog({
	presentationId,
	deckTitle,
	onClose,
	onMoved,
	onNotify,
}: {
	presentationId: string;
	deckTitle: string;
	onClose: () => void;
	/** Told which workspace took the deck, so the page can drop it from "yours". */
	onMoved: (workspace: Workspace) => void;
	onNotify: (message: string, tone: "success" | "info" | "error") => void;
}) {
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const mine = await api.listWorkspaces().catch(() => [] as Workspace[]);
			if (cancelled) return;
			setWorkspaces(
				mine.filter((workspace) =>
					canCreateWorkspaceDecks(workspace.role as WorkspaceRole | null),
				),
			);
			setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const move = async (workspace: Workspace) => {
		if (busy) return;
		setBusy(true);
		try {
			await api.setPresentationWorkspace(presentationId, workspace.id);
			onNotify(`“${deckTitle}” now belongs to ${workspace.name}`, "success");
			onMoved(workspace);
			onClose();
		} catch (moveError: unknown) {
			onNotify(
				moveError instanceof Error
					? moveError.message
					: "Could not move this deck",
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal title="Move to a workspace" icon={Building2} onClose={onClose}>
			<div className="flex flex-col gap-4">
				<p className="text-sm text-text-muted">
					Hand <span className="text-text">{deckTitle}</span> to a workspace.
					Everybody in it can then open, edit and present it, and it stays there
					whoever comes or goes — including you. It stops being yours: the deck's
					existing edit link is retired by the move, and only a workspace owner
					can take it back out.
				</p>

				<div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
					{loading ? (
						<span className="text-text-dim">Checking…</span>
					) : workspaces.length === 0 ? (
						<span className="text-text-muted">
							You are not in a workspace that takes new decks. Create one from
							the Workspaces page, or ask somebody to add you to theirs.
						</span>
					) : (
						<ul className="flex flex-col gap-2">
							{workspaces.map((workspace) => (
								<li key={workspace.id}>
									<button
										type="button"
										className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
										onClick={() => move(workspace)}
										disabled={busy}
										title={`Hand this deck to ${workspace.name}`}
									>
										<Building2 size={16} className="text-text-dim shrink-0" />
										<span className="flex-1 min-w-0 truncate">
											{workspace.name}
										</span>
										<span className="text-xs text-text-dim shrink-0">
											{workspaceRoleLabel(workspace.role)}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</Modal>
	);
}
