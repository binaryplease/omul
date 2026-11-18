import {
	Building2,
	ChevronLeft,
	LayoutTemplate,
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
import { builtInDeckThemeOptions } from "../components/DeckTheme";
import { ChoiceCards } from "../components/EditorControls";
import { PublishTemplateDialog } from "../components/PublishTemplateDialog";
import { ICON_BUTTON_HOVER } from "../components/ShareCluster";
import { TemplateCard, UseTemplateButton } from "../components/TemplateCard";
import {
	assignableWorkspaceRoles,
	workspaceMemberDisplayName,
	workspaceRoleInSentence,
	workspaceRoleLabel,
	workspaceRoleSummary,
	WORKSPACE_ROLE_DESCRIPTORS,
} from "../components/WorkspaceRoles";
import { AppMenu } from "../components/ui/AppMenu";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { LoadingState } from "../components/ui/Loading";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useToast } from "../components/ui/Toast";
import {
	textWithElement,
	useDocumentLanguage,
	useInterfaceText,
} from "../interface-language";
import { fillText, formatDate, pluralText } from "../interface-text";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import type {
	BuiltInDeckThemeId,
	Presentation,
	Workspace,
	WorkspaceMember,
	WorkspaceRole,
	WorkspaceTemplate,
} from "../types";
import {
	canAdministerWorkspace,
	canCreateWorkspaceDecks,
	canManageWorkspaceMembers,
	canPublishWorkspaceTemplates,
	DEFAULT_WORKSPACE_ROLE,
	WORKSPACE_NAME_MAX_LENGTH,
} from "../types";

// ── One workspace: its decks, its templates, and who is in it ──
//                                        (REQ128, REQ129, REQ004)
//
// All of it on one screen, because they are views of one question — what this
// workspace owns, and who that means. Split across pages, a member could be
// removed from a roster without ever having been shown what they were being
// removed from.
//
// The templates a workspace publishes (REQ004) sit between the two, which is
// where they belong in both directions: they are made *out of* the decks above
// them by a control on the deck's own card, and who may publish one is a fact
// about the roster below them.
//
// Every control here is drawn for every member and **disabled with its reason**
// when their role does not open it, rather than hidden: "you cannot
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
	const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
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
	// The deck whose "publish as template" dialog is open, the entry being taken
	// back down, and which template is currently being turned into a deck.
	const [publishTarget, setPublishTarget] = useState<Presentation | null>(null);
	const [unpublishTarget, setUnpublishTarget] =
		useState<WorkspaceTemplate | null>(null);
	const [creatingFromId, setCreatingFromId] = useState<string | null>(null);
	const { addToast } = useToast();
	const { data: session } = useSession();
	const userId = session?.user?.id ?? null;
	const { text, language } = useInterfaceText();
	const words = text.workspaces;

	usePageTitle(workspace?.name ?? words.workspaceFallbackTitle);
	useDocumentLanguage(language);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [found, roster, ownedDecks, published] = await Promise.all([
				api.getWorkspace(id),
				api.listWorkspaceMembers(id),
				api.listWorkspacePresentations(id),
				api.listWorkspaceTemplates(id),
			]);
			setWorkspace(found);
			setRenaming(found.name);
			setMembers(roster);
			setDecks(ownedDecks);
			setTemplates(published);
			setRefused("");
		} catch (loadError: unknown) {
			// A refusal is the honest answer to draw, not an empty workspace: the
			// caller may have been removed from it a moment ago, and a blank roster
			// would read as "everybody left".
			setWorkspace(null);
			setRefused(
				loadError instanceof Error
					? loadError.message
					: words.openFailed,
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
	const canPublish = canPublishWorkspaceTemplates(myRole);
	const canCreateDecks = canCreateWorkspaceDecks(myRole);

	/** The entry this deck already has in the gallery, if it has one. */
	const publishedFrom = (deck: Presentation): WorkspaceTemplate | null =>
		templates.find((entry) => entry.sourcePresentationId === deck.id) ?? null;

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
			fillText(words.memberAdded, {
				name: workspaceMemberDisplayName(member, text),
				role: workspaceRoleInSentence(member.role, text),
			}),
				"success",
			);
		} catch (addError: unknown) {
			addToast(
				addError instanceof Error
					? addError.message
					: words.addFailed,
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
			fillText(words.roleChanged, {
				name: workspaceMemberDisplayName(updated, text),
				role: workspaceRoleInSentence(updated.role, text),
			}),
				"info",
			);
			// Changing your own role changes what this page may draw next.
			if (updated.mine) await load();
		} catch (roleError: unknown) {
			addToast(
				roleError instanceof Error
					? roleError.message
					: words.roleFailed,
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
				addToast(words.youLeft, "info");
				go({ page: "workspaces" });
				return;
			}
			setMembers((current) => current.filter((entry) => entry.id !== target.id));
			addToast(
			fillText(words.memberRemoved, {
				name: workspaceMemberDisplayName(target, text),
			}),
				"info",
			);
		} catch (removeError: unknown) {
			addToast(
				removeError instanceof Error
					? removeError.message
					: words.removeFailed,
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	/** The theme a deck created here starts in when it names none (REQ086). */
	const changeDefaultTheme = async (defaultTheme: BuiltInDeckThemeId) => {
		if (defaultTheme === workspace?.defaultTheme || busy) return;
		setBusy(true);
		try {
			const updated = await api.setWorkspaceDefaultTheme(id, defaultTheme);
			setWorkspace(updated);
			addToast(words.defaultThemeChanged, "success");
		} catch (themeError: unknown) {
			addToast(
				themeError instanceof Error
					? themeError.message
					: words.defaultThemeFailed,
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
			addToast(words.renamed, "success");
		} catch (renameError: unknown) {
			addToast(
				renameError instanceof Error
					? renameError.message
					: words.renameFailed,
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
			addToast(words.deleted, "success");
			go({ page: "workspaces" });
		} catch (deleteError: unknown) {
			addToast(
				deleteError instanceof Error
					? deleteError.message
					: words.deleteFailed,
				"error",
			);
		}
	};

	const createDeck = async () => {
		if (creatingDeck) return;
		setCreatingDeck(true);
		try {
			const created = await api.createPresentation({
				title: words.newDeckTitle,
				slides: [
					{ id: crypto.randomUUID(), type: "text", question: words.newDeckSlide },
				],
				workspaceId: id,
				// A deck starts in the interface language, as on /create (REQ248).
				language,
			});
			addToast(words.deckCreated, "success");
			go({ page: "edit", id: created.id });
		} catch (createError: unknown) {
			addToast(
				createError instanceof Error
					? createError.message
					: words.deckCreateFailed,
				"error",
			);
		} finally {
			setCreatingDeck(false);
		}
	};

	/** A deck of the workspace's, started from one of the workspace's templates. */
	const createFromTemplate = async (template: WorkspaceTemplate) => {
		if (creatingFromId) return;
		setCreatingFromId(template.id);
		try {
			const created = await api.createPresentation({
				workspaceId: id,
				workspaceTemplateId: template.id,
				language,
			});
			addToast(
				fillText(words.createdFromTemplate, { title: template.title }),
				"success",
			);
			go({ page: "edit", id: created.id });
		} catch (createError: unknown) {
			addToast(
				createError instanceof Error
					? createError.message
					: words.createFromTemplateFailed,
				"error",
			);
		} finally {
			setCreatingFromId(null);
		}
	};

	const unpublish = async () => {
		if (!unpublishTarget) return;
		const target = unpublishTarget;
		setUnpublishTarget(null);
		try {
			await api.unpublishWorkspaceTemplate(id, target.id);
			setTemplates((current) =>
				current.filter((entry) => entry.id !== target.id),
			);
			addToast(fillText(words.unpublished, { title: target.title }), "info");
		} catch (unpublishError: unknown) {
			addToast(
				unpublishError instanceof Error
					? unpublishError.message
					: words.unpublishFailed,
				"error",
			);
		}
	};

	const moveDeckOut = async () => {
		if (!moveOutTarget) return;
		const target = moveOutTarget;
		setMoveOutTarget(null);
		try {
			await api.setPresentationWorkspace(target.id, null);
			setDecks((current) => current.filter((deck) => deck.id !== target.id));
			addToast(fillText(words.movedOut, { title: target.title }), "info");
		} catch (moveError: unknown) {
			addToast(
				moveError instanceof Error
					? moveError.message
					: words.moveOutFailed,
				"error",
			);
		}
	};

	return (
		<div className="min-h-screen w-full bg-void bg-grid bg-noise">
			<div className="absolute top-4 right-4 sm:top-6 sm:right-6 lg:right-12 z-20 flex items-center gap-2">
				<AuthControls />
				<AppMenu />
			</div>

			<div className="relative z-10 w-full px-6 sm:px-12 lg:px-24 py-12 sm:py-16">
				<header className="mb-10 slide-in max-w-3xl">
					<button
						type="button"
						className="mb-4 flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
						onClick={() => go({ page: "workspaces" })}
					>
						<ChevronLeft size={16} />
						{words.allWorkspaces}
					</button>
					<div className="flex items-center gap-3 mb-2">
						<Building2 size={16} className="text-accent" />
						<span className="font-mono text-sm text-text-muted tracking-wider uppercase">
							{words.workspaceEyebrow}
						</span>
					</div>
					{loading ? null : workspace ? (
						<>
							{/* The name is the page's subject, so it is drawn as one; the
							    control that changes it sits beside it and is
							    disabled with its reason for a role that may not rename
							    rather than removed. Dimming the heading itself
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
										aria-label={words.workspaceName}
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
									title={canAdminister ? words.rename : words.renameOwnerOnly}
								>
									<Pencil size={16} />
								</button>
							</div>
							<p className="text-text-muted">
							{textWithElement(
								words.youAre,
								"role",
								<span className="text-accent-text">
									{workspaceRoleInSentence(myRole, text)}
								</span>,
							)}{" "}
							{workspaceRoleSummary(myRole, text)}
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
							{/* Wraps rather than squeezing, like the home page's list
							    heading: on a narrow screen the button drops under the
							    heading instead of both breaking into short lines. */}
							<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-6">
								<h2 className="text-xl font-semibold text-text-muted">
									{words.decksHeading}
								</h2>
								<button
									type="button"
									className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
									onClick={createDeck}
									disabled={!canCreateWorkspaceDecks(myRole) || creatingDeck}
									title={
										canCreateWorkspaceDecks(myRole)
										? words.createDeck
										: words.createDeckRefused
									}
								>
									<Plus size={14} />
									{creatingDeck ? words.creating : words.newDeck}
								</button>
							</div>
							{/* The theme a new deck here starts in (REQ086) sits with the
							    decks it governs, under the control that creates them.
							    Drawn for every member, and disabled with its reason for
							    every role but the one that may rename the workspace. */}
							<div className="mb-6 max-w-2xl">
								<h3 className="text-sm font-medium text-text-muted mb-1">
									{words.defaultThemeHeading}
								</h3>
								<p className="text-xs text-text-dim mb-3">
									{words.defaultThemeNote}
									{canAdminister ? "" : words.defaultThemeOwnerOnly}
								</p>
								<ChoiceCards
									ariaLabel={words.defaultThemeName}
									variant="tile"
									columns={3}
									value={workspace.defaultTheme}
									onChange={changeDefaultTheme}
									options={builtInDeckThemeOptions(text).map((option) => ({
										...option,
										disabled: !canAdminister || busy,
										disabledReason: canAdminister
										? words.defaultThemeSaving
										: words.defaultThemeRefused,
									}))}
								/>
							</div>
							{decks.length === 0 ? (
								<p className="text-text-muted">{words.noDecks}</p>
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
														{formatDate(language, deck.createdAt)}
													</span>
												</div>
											</div>
											{/* Publishing sits on the deck it publishes (REQ004), for
											    the reason moving one out sits on the deck it moves.
											    Drawn for every member and disabled with its reason
											    for a role that may not publish, and it says which
											    of the two acts it is — a deck that already has an
											    entry is republished rather than published twice. */}
											<button
												type="button"
												className={`p-2 rounded disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-muted ${ICON_BUTTON_HOVER}`}
												onClick={(event) => {
													event.stopPropagation();
													setPublishTarget(deck);
												}}
												disabled={!canPublish}
												title={
													!canPublish
													? words.publishRefused
														: publishedFrom(deck)
														? words.republish
														: words.publish
												}
											>
												<LayoutTemplate size={18} />
											</button>
											{/* Taking a deck back out of the shared ownership sits on
											    the deck it moves, and is the owner's own
											    act — drawn disabled with the reason for everybody
											    else. */}
											<button
												type="button"
												className="text-text-dim hover:text-accent transition-colors p-2 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-dim"
												onClick={(event) => {
													event.stopPropagation();
													setMoveOutTarget(deck);
												}}
												disabled={!canAdminister}
												title={
													canAdminister ? words.moveOut : words.moveOutOwnerOnly
												}
											>
												<LogOut size={18} />
											</button>
										</div>
									))}
								</div>
							)}
						</section>

						{/* ── What it publishes (REQ004) ────────────────── */}
						<section className="mb-14 slide-in slide-in-delay-2">
							<h2 className="text-xl font-semibold text-text-muted mb-6">
								{words.templatesHeading}
							</h2>
							{templates.length === 0 ? (
								<p className="text-text-muted max-w-2xl">
									{words.noTemplates}
									{canPublish ? "" : words.noTemplatesAdminOnly}
								</p>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
									{templates.map((template, index) => (
										<TemplateCard
											key={template.id}
											template={template}
											search=""
											index={index}
										>
											{/* Who put it here, so a card in a shared gallery has
											    somebody behind it — an account that has since been
											    deleted leaves the entry standing and says so. */}
											<p className="text-xs text-text-dim">
											{fillText(words.publishedBy, {
												name: template.publishedByName ?? words.formerMember,
												date: formatDate(language, template.createdAt),
											})}
											</p>
											<UseTemplateButton
												label={fillText(words.useTemplate, { title: template.title })}
												creating={creatingFromId === template.id}
												busy={creatingFromId !== null}
												refusal={canCreateDecks ? null : words.useTemplateRefused}
												onUse={() => createFromTemplate(template)}
											/>
											<button
												type="button"
												className="text-xs text-text-dim hover:text-error transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-dim"
												onClick={() => setUnpublishTarget(template)}
												disabled={!canPublish}
												title={
												canPublish ? words.unpublishTitle : words.unpublishAdminOnly
												}
											>
											{words.unpublish}
											</button>
										</TemplateCard>
									))}
								</div>
							)}
						</section>

						{/* ── Who is in it ──────────────────────────────── */}
						<section className="slide-in slide-in-delay-3 max-w-2xl">
							<h2 className="text-xl font-semibold mb-6 text-text-muted">
								{words.rosterHeading}
							</h2>

							<div className="flex flex-col gap-2 mb-6">
								<input
									type="email"
									className="input text-sm"
									placeholder={words.emailPlaceholder}
									aria-label={words.emailToAdd}
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
											title={words.roleToGive}
										>
											{WORKSPACE_ROLE_DESCRIPTORS.filter((descriptor) =>
												assignableWorkspaceRoles(myRole).includes(
													descriptor.role,
												),
											).map((descriptor) => (
												<option key={descriptor.role} value={descriptor.role}>
												{workspaceRoleLabel(descriptor.role, text)}
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
											? words.addRefused
												: email.trim()
												? words.addThis
												: words.addEmailFirst
										}
									>
										<UserPlus size={14} />
										{words.add}
									</button>
								</div>
								{/* What the chosen role buys, under the control that chooses
								    it — a role is a promise to somebody, and reading it
								    afterwards is too late. */}
								<p className="text-xs text-text-dim">
									{workspaceRoleSummary(role, text)}
								</p>
							</div>

							<div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
								<ul className="flex flex-col gap-3">
									{members.map((member) => (
										<li key={member.id} className="flex items-center gap-2">
											<div className="flex-1 min-w-0">
												<div className="truncate">
													{workspaceMemberDisplayName(member, text)}
													{member.mine ? (
													<span className="text-text-dim">{words.you}</span>
													) : null}
												</div>
												{member.name?.trim() && member.email ? (
													<div className="text-xs text-text-dim truncate">
														{member.email}
													</div>
												) : null}
											</div>
											<div className="w-36 shrink-0">
												<select
													className="input text-xs disabled:opacity-60 disabled:cursor-not-allowed"
													value={member.role}
													disabled={
														busy ||
														!canManage ||
														(member.role === "owner" && !canAdminister)
													}
													title={
														canManage ? words.changeRole : words.changeRoleRefused
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
														{workspaceRoleLabel(descriptor.role, text)}
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
														? words.leave
														: canManage
															? words.remove
															: words.removeRefused
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
							{fillText(words.rosterNote, {
								owner: workspaceRoleInSentence("owner", text),
							})}
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
										? words.deleteWorkspaceHasDecks
										: words.deleteWorkspace
										: words.deleteWorkspaceOwnerOnly
								}
							>
							{words.deleteWorkspace}
							</button>
						</section>
					</>
				)}
			</div>

			<ConfirmModal
				open={!!removeTarget}
				title={removeTarget?.mine ? words.leaveTitle : words.removeTitle}
				message={
					removeTarget?.mine
					? fillText(words.leaveMessage, { workspace: workspace?.name ?? "" })
					: fillText(words.removeMessage, {
							name: removeTarget
								? workspaceMemberDisplayName(removeTarget, text)
								: "",
							workspace: workspace?.name ?? "",
						})
				}
				confirmLabel={removeTarget?.mine ? words.leaveConfirm : words.removeConfirm}
				variant="danger"
				onConfirm={removeMember}
				onCancel={() => setRemoveTarget(null)}
			/>

			<ConfirmModal
				open={!!moveOutTarget}
				title={words.moveOutTitle}
				message={fillText(words.moveOutMessage, { title: moveOutTarget?.title ?? "" })}
				confirmLabel={words.moveOutConfirm}
				onConfirm={moveDeckOut}
				onCancel={() => setMoveOutTarget(null)}
			/>

			{publishTarget ? (
				<PublishTemplateDialog
					workspaceId={id}
					deck={publishTarget}
					published={publishedFrom(publishTarget)}
					onClose={() => setPublishTarget(null)}
					onPublished={(template) => {
						// Republishing returns the same entry with new slides, so the list
						// is updated in place; a first publish is prepended, which is where
						// the server's newest-first order would have put it anyway.
						setTemplates((current) =>
							current.some((entry) => entry.id === template.id)
								? current.map((entry) =>
										entry.id === template.id ? template : entry,
									)
								: [template, ...current],
						);
					}}
					onNotify={addToast}
				/>
			) : null}

			<ConfirmModal
				open={!!unpublishTarget}
				title={words.unpublishConfirmTitle}
				message={fillText(words.unpublishMessage, {
					title: unpublishTarget?.title ?? "",
				})}
				confirmLabel={words.unpublish}
				variant="danger"
				onConfirm={unpublish}
				onCancel={() => setUnpublishTarget(null)}
			/>

			<ConfirmModal
				open={deleteWorkspaceOpen}
				title={words.deleteWorkspaceTitle}
				message={
					decks.length > 0
					? pluralText(language, decks.length, words.deleteWorkspaceBlocked, {
							workspace: workspace?.name ?? "",
						})
					: fillText(words.deleteWorkspaceMessage, {
							workspace: workspace?.name ?? "",
						})
				}
				confirmLabel={words.deleteConfirm}
				variant="danger"
				onConfirm={removeWorkspace}
				onCancel={() => setDeleteWorkspaceOpen(false)}
			/>
		</div>
	);
}
