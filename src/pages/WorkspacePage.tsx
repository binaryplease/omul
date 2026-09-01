import {
	Building2,
	ChevronLeft,
	LogOut,
	Pencil,
	Plus,
	Trash2,
	UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { AuthControls } from "../auth";
import { useSession } from "../auth-client";
import {
	assignableWorkspaceRoles,
	workspaceMemberDisplayName,
	workspaceRoleLabel,
	workspaceRoleSummary,
	WORKSPACE_ROLE_DESCRIPTORS,
} from "../components/WorkspaceRoles";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { LoadingState } from "../components/ui/Loading";
import { StatusBadge } from "../components/ui/StatusBadge";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import type { Presentation, Workspace, WorkspaceMember, WorkspaceRole } from "../types";
import {
	canAdministerWorkspace,
	canCreateWorkspaceDecks,
	canManageWorkspaceMembers,
	DEFAULT_WORKSPACE_ROLE,
	WORKSPACE_NAME_MAX_LENGTH,
} from "../types";

// ── One workspace: its decks, and who is in it (REQ128, REQ129) ─
//
// Both halves on one screen, because they are two views of one question — what
// this workspace owns, and who that means. Split across two pages, a member
// could be removed from a roster without ever having been shown what they were
// being removed from.
//
// Every control here is drawn for every member and **disabled with its reason**
// when their role does not open it (ADR-0025), rather than hidden: "you cannot
// do this, and here is who can" is a fact somebody needs, and a missing button
// says nothing. The role each one is read against is the server's own report,
// and the server re-checks it on every request (REQ129) — so this file decides
// what is drawn, never what is allowed.

export function WorkspacePage({
	id,
	go,
}: {
	id: string;
	go: (r: Route) => void;
}) {
	const [workspace, setWorkspace] = useState<Workspace | null>(null);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [decks, setDecks] = useState<Presentation[]>([]);
	const [loading, setLoading] = useState(true);
	const [refused, setRefused] = useState("");
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<WorkspaceRole>(DEFAULT_WORKSPACE_ROLE);
	const [busy, setBusy] = useState(false);
	const [creatingDeck, setCreatingDeck] = useState(false);
	const [renaming, setRenaming] = useState("");
	const [editingName, setEditingName] = useState(false);
	const [deleteWorkspaceOpen, setDeleteWorkspaceOpen] = useState(false);
	const [removeTarget, setRemoveTarget] = useState<WorkspaceMember | null>(null);
	const [moveOutTarget, setMoveOutTarget] = useState<Presentation | null>(null);
	const { addToast } = useToast();
	const { data: session } = useSession();
	const userId = session?.user?.id ?? null;

	usePageTitle(workspace?.name ?? "Workspace");

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [found, roster, ownedDecks] = await Promise.all([
				api.getWorkspace(id),
				api.listWorkspaceMembers(id),
				api.listWorkspacePresentations(id),
			]);
			setWorkspace(found);
			setRenaming(found.name);
			setMembers(roster);
			setDecks(ownedDecks);
			setRefused("");
		} catch (loadError: unknown) {
			// A refusal is the honest answer to draw, not an empty workspace: the
			// caller may have been removed from it a moment ago, and a blank roster
			// would read as "everybody left".
			setWorkspace(null);
			setRefused(
				loadError instanceof Error
					? loadError.message
					: "This workspace could not be opened",
			);
		} finally {
			setLoading(false);
		}
	}, [id]);

	useEffect(() => {
		load();
	}, [load]);

	const myRole = workspace?.role ?? null;
	const canManage = canManageWorkspaceMembers(myRole);
	const canAdminister = canAdministerWorkspace(myRole);

	const addMember = async () => {
		const address = email.trim();
		if (!address || busy) return;
		setBusy(true);
		try {
			const member = await api.addWorkspaceMember(id, address, role);
			// Re-read rather than splice: adding an address that is already a member
			// *changes* their role, so appending would show one person twice.
			setMembers(await api.listWorkspaceMembers(id));
			setEmail("");
			addToast(
				`${workspaceMemberDisplayName(member)} is now ${workspaceRoleLabel(member.role).toLowerCase()}`,
				"success",
			);
		} catch (addError: unknown) {
			addToast(
				addError instanceof Error
					? addError.message
					: "Could not add that account",
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	const changeRole = async (member: WorkspaceMember, next: WorkspaceRole) => {
		setBusy(true);
		try {
			const updated = await api.setWorkspaceMemberRole(id, member.id, next);
			setMembers((current) =>
				current.map((entry) => (entry.id === updated.id ? updated : entry)),
			);
			addToast(
				`${workspaceMemberDisplayName(updated)} — ${workspaceRoleLabel(updated.role).toLowerCase()}`,
				"info",
			);
			// Changing your own role changes what this page may draw next.
			if (updated.mine) await load();
		} catch (roleError: unknown) {
			addToast(
				roleError instanceof Error
					? roleError.message
					: "Could not change that role",
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	const removeMember = async () => {
		if (!removeTarget) return;
		const target = removeTarget;
		setRemoveTarget(null);
		setBusy(true);
		try {
			await api.removeWorkspaceMember(id, target.id);
			if (target.mine) {
				addToast("You have left the workspace", "info");
				go({ page: "workspaces" });
				return;
			}
			setMembers((current) => current.filter((entry) => entry.id !== target.id));
			addToast(
				`${workspaceMemberDisplayName(target)} is no longer in this workspace — its decks are untouched`,
				"info",
			);
		} catch (removeError: unknown) {
			addToast(
				removeError instanceof Error
					? removeError.message
					: "Could not remove that member",
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	const rename = async () => {
		const trimmed = renaming.trim();
		if (!trimmed || trimmed === workspace?.name || busy) return;
		setBusy(true);
		try {
			const updated = await api.renameWorkspace(id, trimmed);
			setWorkspace(updated);
			addToast("Workspace renamed", "success");
		} catch (renameError: unknown) {
			addToast(
				renameError instanceof Error
					? renameError.message
					: "Could not rename this workspace",
				"error",
			);
			setRenaming(workspace?.name ?? "");
		} finally {
			setBusy(false);
		}
	};

	const removeWorkspace = async () => {
		setDeleteWorkspaceOpen(false);
		try {
			await api.deleteWorkspace(id);
			addToast("Workspace deleted", "success");
			go({ page: "workspaces" });
		} catch (deleteError: unknown) {
			addToast(
				deleteError instanceof Error
					? deleteError.message
					: "Could not delete this workspace",
				"error",
			);
		}
	};

	const createDeck = async () => {
		if (creatingDeck) return;
		setCreatingDeck(true);
		try {
			const created = await api.createPresentation({
				title: "Untitled presentation",
				slides: [
					{ id: crypto.randomUUID(), type: "text", question: "New slide" },
				],
				workspaceId: id,
			});
			addToast("Deck created in this workspace", "success");
			go({ page: "edit", id: created.id });
		} catch (createError: unknown) {
			addToast(
				createError instanceof Error
					? createError.message
					: "Could not create a deck here",
				"error",
			);
		} finally {
			setCreatingDeck(false);
		}
	};

	const moveDeckOut = async () => {
		if (!moveOutTarget) return;
		const target = moveOutTarget;
		setMoveOutTarget(null);
		try {
			await api.setPresentationWorkspace(target.id, null);
			setDecks((current) => current.filter((deck) => deck.id !== target.id));
			addToast(`“${target.title}” is now yours alone`, "info");
		} catch (moveError: unknown) {
			addToast(
				moveError instanceof Error
					? moveError.message
					: "Could not move that deck out",
				"error",
			);
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
						onClick={() => go({ page: "workspaces" })}
					>
						<ChevronLeft size={16} />
						All workspaces
					</button>
					<div className="flex items-center gap-3 mb-2">
						<Building2 size={16} className="text-accent" />
						<span className="font-mono text-sm text-text-muted tracking-wider uppercase">
							workspace
						</span>
					</div>
					{loading ? null : workspace ? (
						<>
							{/* The name is the page's subject, so it is drawn as one; the
							    control that changes it sits beside it (ADR-0031) and is
							    disabled with its reason for a role that may not rename
							    (ADR-0025) rather than removed. Dimming the heading itself
							    instead would make the workspace's own name hard to read for
							    every member who is not its owner. */}
							<div className="flex items-center gap-3 mb-3">
								{editingName ? (
									<input
										// biome-ignore lint/a11y/noAutofocus: the field replaces the
										// heading on a deliberate click; landing anywhere else would
										// lose the caret the click asked for.
										autoFocus
										className="input text-lg font-semibold"
										type="text"
										aria-label="Workspace name"
										maxLength={WORKSPACE_NAME_MAX_LENGTH}
										value={renaming}
										disabled={busy}
										onChange={(event) => setRenaming(event.target.value)}
										onBlur={() => {
											setEditingName(false);
											rename();
										}}
										onKeyDown={(event) => {
											if (event.key === "Enter") event.currentTarget.blur();
											if (event.key === "Escape") {
												setRenaming(workspace.name);
												setEditingName(false);
											}
										}}
									/>
								) : (
									<h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
										{workspace.name}
									</h1>
								)}
								<button
									type="button"
									className="text-text-dim hover:text-accent transition-colors p-2 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-dim"
									onClick={() => setEditingName(true)}
									disabled={!canAdminister || editingName || busy}
									title={
										canAdminister
											? "Rename this workspace"
											: "Rename this workspace — only its owner can"
									}
								>
									<Pencil size={16} />
								</button>
							</div>
							<p className="text-text-muted">
								You are{" "}
								<span className="text-accent-text">
									{workspaceRoleLabel(myRole).toLowerCase()}
								</span>{" "}
								here. {workspaceRoleSummary(myRole)}
							</p>
						</>
					) : (
						<p className="text-text-muted">{refused}</p>
					)}
				</header>

				{loading ? (
					<LoadingState />
				) : !workspace ? null : (
					<>
						{/* ── The decks the workspace owns ──────────────── */}
						<section className="mb-14 slide-in slide-in-delay-1">
							<div className="flex items-center justify-between gap-4 mb-6">
								<h2 className="text-xl font-semibold text-text-muted">
									Decks this workspace owns
								</h2>
								<button
									type="button"
									className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
									onClick={createDeck}
									disabled={!canCreateWorkspaceDecks(myRole) || creatingDeck}
									title={
										canCreateWorkspaceDecks(myRole)
											? "Create a deck the workspace owns"
											: "Create a deck here — your role in this workspace does not allow it"
									}
								>
									<Plus size={14} />
									{creatingDeck ? "Creating…" : "New deck"}
								</button>
							</div>
							{decks.length === 0 ? (
								<p className="text-text-muted">
									No decks yet. One created here belongs to the workspace rather
									than to you — everybody in it can open, edit and present it,
									and it stays when anybody leaves.
								</p>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
									{decks.map((deck) => (
										<div
											key={deck.id}
											className="group flex items-center gap-4 p-4 rounded-xl bg-surface-raised border border-border hover:border-text-dim transition-all shadow-panel cursor-pointer"
											onClick={() => go({ page: "present", id: deck.id })}
										>
											<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface border border-border-subtle flex-shrink-0">
												<span className="font-mono text-sm text-text-muted">
													{deck.slides.length}
												</span>
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-3 mb-1">
													<h3 className="font-semibold truncate">
														{deck.title}
													</h3>
													<StatusBadge status={deck.status} />
												</div>
												<div className="flex items-center gap-4 text-sm text-text-muted">
													<span className="font-mono">{deck.code}</span>
													<span>
														{new Date(deck.createdAt).toLocaleDateString()}
													</span>
												</div>
											</div>
											{/* Taking a deck back out of the shared ownership sits on
											    the deck it moves (ADR-0031), and is the owner's own
											    act — drawn disabled with the reason for everybody
											    else (ADR-0025). */}
											<button
												type="button"
												className="text-text-dim hover:text-accent transition-colors p-2 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-dim"
												onClick={(event) => {
													event.stopPropagation();
													setMoveOutTarget(deck);
												}}
												disabled={!canAdminister}
												title={
													canAdminister
														? "Move this deck out of the workspace and into your account"
														: "Move this deck out — only the workspace's owner can"
												}
											>
												<LogOut size={18} />
											</button>
										</div>
									))}
								</div>
							)}
						</section>

						{/* ── Who is in it ──────────────────────────────── */}
						<section className="slide-in slide-in-delay-2 max-w-2xl">
							<h2 className="text-xl font-semibold mb-6 text-text-muted">
								Who is in this workspace
							</h2>

							<div className="flex flex-col gap-2 mb-6">
								<input
									type="email"
									className="input text-sm"
									placeholder="their@email.address"
									aria-label="Email address to add"
									value={email}
									disabled={!canManage}
									onChange={(event) => setEmail(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") addMember();
									}}
								/>
								<div className="flex items-center gap-2">
									<div className="flex-1 min-w-0">
										<select
											className="input text-sm"
											value={role}
											disabled={!canManage}
											onChange={(event) =>
												setRole(event.target.value as WorkspaceRole)
											}
											title="What this person will be able to do"
										>
											{WORKSPACE_ROLE_DESCRIPTORS.filter((descriptor) =>
												assignableWorkspaceRoles(myRole).includes(
													descriptor.role,
												),
											).map((descriptor) => (
												<option key={descriptor.role} value={descriptor.role}>
													{descriptor.label}
												</option>
											))}
										</select>
									</div>
									<button
										type="button"
										className="btn-primary text-sm flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
										onClick={addMember}
										disabled={!canManage || busy || !email.trim()}
										title={
											!canManage
												? "Add somebody — your role in this workspace does not allow it"
												: email.trim()
													? "Add this account to the workspace"
													: "Add somebody — type the account's email address first"
										}
									>
										<UserPlus size={14} />
										Add
									</button>
								</div>
								{/* What the chosen role buys, under the control that chooses
								    it — a role is a promise to somebody, and reading it
								    afterwards is too late. */}
								<p className="text-xs text-text-dim">
									{workspaceRoleSummary(role)}
								</p>
							</div>

							<div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
								<ul className="flex flex-col gap-3">
									{members.map((member) => (
										<li key={member.id} className="flex items-center gap-2">
											<div className="flex-1 min-w-0">
												<div className="truncate">
													{workspaceMemberDisplayName(member)}
													{member.mine ? (
														<span className="text-text-dim"> (you)</span>
													) : null}
												</div>
												{member.name?.trim() && member.email ? (
													<div className="text-xs text-text-dim truncate">
														{member.email}
													</div>
												) : null}
											</div>
											<div className="w-28 shrink-0">
												<select
													className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed"
													value={member.role}
													disabled={
														busy ||
														!canManage ||
														(member.role === "owner" && !canAdminister)
													}
													title={
														canManage
															? "Change what this person can do here"
															: "Change this role — your own role does not allow it"
													}
													onChange={(event) =>
														changeRole(
															member,
															event.target.value as WorkspaceRole,
														)
													}
												>
													{WORKSPACE_ROLE_DESCRIPTORS.filter(
														(descriptor) =>
															assignableWorkspaceRoles(myRole).includes(
																descriptor.role,
															) || descriptor.role === member.role,
													).map((descriptor) => (
														<option
															key={descriptor.role}
															value={descriptor.role}
														>
															{descriptor.label}
														</option>
													))}
												</select>
											</div>
											<button
												type="button"
												className="text-text-dim hover:text-error transition-colors p-2 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-dim"
												onClick={() => setRemoveTarget(member)}
												disabled={
													busy ||
													(!member.mine && !canManage) ||
													(!member.mine &&
														member.role === "owner" &&
														!canAdminister)
												}
												title={
													member.mine
														? "Leave this workspace"
														: canManage
															? "Remove this person from the workspace"
															: "Remove somebody — your role in this workspace does not allow it"
												}
											>
												{member.mine ? (
													<LogOut size={16} />
												) : (
													<Trash2 size={16} />
												)}
											</button>
										</li>
									))}
								</ul>
							</div>

							<p className="text-xs text-text-dim mt-4">
								Removing somebody takes effect at once — there is nothing of
								theirs to expire — and the workspace keeps every deck they
								worked on. Deleting a deck and deciding who outside the
								workspace it is shared with need the admin role;{" "}
								{workspaceRoleLabel("owner").toLowerCase()} is the only role
								that can rename or delete the workspace itself.
							</p>

							{/* Deleting the workspace is the last thing on the page, below
							    everything it would take with it. */}
							<button
								type="button"
								className="mt-6 text-sm text-text-dim hover:text-error transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-dim"
								onClick={() => setDeleteWorkspaceOpen(true)}
								disabled={!canAdminister}
								title={
									canAdminister
										? decks.length > 0
											? "Delete this workspace — move or delete its decks first"
											: "Delete this workspace"
										: "Delete this workspace — only its owner can"
								}
							>
								Delete this workspace
							</button>
						</section>
					</>
				)}
			</div>

			<ConfirmModal
				open={!!removeTarget}
				title={removeTarget?.mine ? "Leave workspace" : "Remove member"}
				message={
					removeTarget?.mine
						? `Leave “${workspace?.name}”? You lose access to its decks — the decks themselves stay with the workspace.`
						: `Remove ${removeTarget ? workspaceMemberDisplayName(removeTarget) : ""} from “${workspace?.name}”? They lose access at once. Every deck they worked on stays with the workspace.`
				}
				confirmLabel={removeTarget?.mine ? "Leave" : "Remove"}
				variant="danger"
				onConfirm={removeMember}
				onCancel={() => setRemoveTarget(null)}
			/>

			<ConfirmModal
				open={!!moveOutTarget}
				title="Move deck out of the workspace"
				message={`Move “${moveOutTarget?.title}” into your own account? It leaves this workspace's list, everybody else in it loses access, and its old edit link stays retired.`}
				confirmLabel="Move to my account"
				onConfirm={moveDeckOut}
				onCancel={() => setMoveOutTarget(null)}
			/>

			<ConfirmModal
				open={deleteWorkspaceOpen}
				title="Delete workspace"
				message={
					decks.length > 0
						? `“${workspace?.name}” still owns ${decks.length} deck${decks.length === 1 ? "" : "s"}. Move them out or delete them first — deleting the workspace never deletes a deck.`
						: `Delete “${workspace?.name}”? Everybody in it loses it, and this cannot be undone.`
				}
				confirmLabel="Delete"
				variant="danger"
				onConfirm={removeWorkspace}
				onCancel={() => setDeleteWorkspaceOpen(false)}
			/>
		</div>
	);
}
