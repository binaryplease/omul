import { Building2, ChevronLeft, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { AuthControls } from "../auth";
import { useSession } from "../auth-client";
import { workspaceRoleLabel } from "../components/WorkspaceRoles";
import { LoadingState } from "../components/ui/Loading";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import type { Workspace } from "../types";
import { WORKSPACE_NAME_MAX_LENGTH } from "../types";

// ── The workspaces this account is in (REQ128, REQ129) ────────
//
// A page of its own, for the reason the template gallery has one: a workspace is
// something to send somebody a link to, and its decks are not a section of
// "yours" — they belong to the workspace, and every member sees the same list.
//
// Nothing here is a permission check. The role on each card is the server's own
// report, drawn so a member can see what they may do before they try it;
// every route re-resolves it from the request's own credentials, so
// a card that said something else would only mis-draw its own buttons.

export function WorkspacesPage({ go }: { go: (r: Route) => void }) {
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [loading, setLoading] = useState(true);
	const [name, setName] = useState("");
	const [creating, setCreating] = useState(false);
	const { addToast } = useToast();
	const { data: session } = useSession();
	const userId = session?.user?.id ?? null;

	usePageTitle("Workspaces");

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			// Signed out there is nothing to ask for: a workspace membership is an
			// account's, so the endpoint would answer 401 and the page says so itself
			// rather than showing an empty list that looks like "you have none".
			const mine = userId
				? await api.listWorkspaces().catch(() => [])
				: ([] as Workspace[]);
			if (cancelled) return;
			setWorkspaces(mine);
			setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [userId]);

	const create = async () => {
		const trimmed = name.trim();
		if (!trimmed || creating) return;
		setCreating(true);
		try {
			const created = await api.createWorkspace(trimmed);
			setName("");
			addToast(`“${created.name}” created — you are its owner`, "success");
			go({ page: "workspace", id: created.id });
		} catch (createError: unknown) {
			addToast(
				createError instanceof Error
					? createError.message
					: "Could not create that workspace",
				"error",
			);
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="min-h-screen w-full bg-void bg-grid bg-noise">
			<div className="absolute top-4 right-4 sm:top-6 sm:right-6 lg:right-12 z-20 flex items-center gap-2">
				<AuthControls />
				<ThemeToggle />
			</div>

			<div className="relative z-10 w-full px-6 sm:px-12 lg:px-24 py-12 sm:py-16">
				<header className="mb-10 slide-in max-w-3xl">
					<button
						type="button"
						className="mb-4 flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
						onClick={() => go({ page: "home" })}
					>
						<ChevronLeft size={16} />
						Back
					</button>
					<div className="flex items-center gap-3 mb-2">
						<Building2 size={16} className="text-accent" />
						<span className="font-mono text-sm text-text-muted tracking-wider uppercase">
							workspaces
						</span>
					</div>
					<h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
						Decks a <span className="text-accent-text">team</span> owns
					</h1>
					<p className="text-text-muted max-w-xl">
						A workspace owns its decks itself. Everybody in it can open, edit and
						present every one of them, and removing somebody leaves the decks
						exactly where they were — no deck belongs to one account.
					</p>
				</header>

				{/* Creating one sits above the list it adds to. Drawn signed
				    out as well, disabled with the reason: the way in has to
				    be visible for the reason to be readable. */}
				<div className="mb-10 flex flex-col gap-2 max-w-md slide-in slide-in-delay-1">
					<div className="flex items-center gap-2">
						<input
							className="input text-sm"
							type="text"
							placeholder="Name your workspace"
							aria-label="Workspace name"
							maxLength={WORKSPACE_NAME_MAX_LENGTH}
							value={name}
							disabled={!userId}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") create();
							}}
						/>
						<button
							type="button"
							className="btn-primary text-sm flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={create}
							disabled={!userId || creating || !name.trim()}
							title={
								!userId
									? "Create a workspace — sign in first"
									: name.trim()
										? "Create this workspace"
										: "Create a workspace — give it a name first"
							}
						>
							<Plus size={14} />
							{creating ? "Creating…" : "Create"}
						</button>
					</div>
					<p className="text-xs text-text-dim">
						You become its owner: the only role that can rename it, delete it,
						hand out the owner role, or move one of its decks back into a
						personal account.
					</p>
				</div>

				{loading ? (
					<LoadingState />
				) : !userId ? (
					<EmptyState
						title="Sign in to use workspaces"
						body="A workspace is shared between accounts, so it needs one. Sign in from the top right and your workspaces appear here."
					/>
				) : workspaces.length === 0 ? (
					<EmptyState
						title="You are not in a workspace yet"
						body="Create one above, or ask somebody who has one to add you by the email address you signed up with."
					/>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
						{workspaces.map((workspace) => (
							<button
								key={workspace.id}
								type="button"
								className="group flex items-center gap-4 p-4 rounded-xl bg-surface-raised border border-border hover:border-text-dim transition-all shadow-panel cursor-pointer text-left"
								onClick={() => go({ page: "workspace", id: workspace.id })}
							>
								<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface border border-border-subtle flex-shrink-0">
									<Users size={18} className="text-text-muted" />
								</div>
								<div className="flex-1 min-w-0">
									<h3 className="font-semibold truncate mb-1">
										{workspace.name}
									</h3>
									<div className="flex items-center gap-4 text-sm text-text-muted">
										{/* What this account may do here, in the same words the
										    roster's picker chooses a role by. */}
										<span className="text-accent-text">
											{workspaceRoleLabel(workspace.role)}
										</span>
										<span>
											{new Date(workspace.createdAt).toLocaleDateString()}
										</span>
									</div>
								</div>
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

/** The page's two empty readings — no account, and no workspaces yet. */
function EmptyState({ title, body }: { title: string; body: string }) {
	return (
		<div className="text-center py-20">
			<div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-raised border border-border mb-6">
				<Building2 size={28} />
			</div>
			<h3 className="text-lg font-semibold mb-2">{title}</h3>
			<p className="text-text-muted max-w-sm mx-auto">{body}</p>
		</div>
	);
}
