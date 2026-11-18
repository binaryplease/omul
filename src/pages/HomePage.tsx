import {
	BarChart3,
	Building2,
	Copy,
	Download,
	Folder as FolderIcon,
	FolderInput,
	FolderPlus,
	LayoutTemplate,
	Pencil,
	Sparkles,
	Trash2,
	Upload,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	api,
	buildExportPayload,
	claimLocalPresentations,
	ImportFileError,
	listMyPresentations,
	listSharedPresentations,
} from "../api";
import { AuthControls, AuthDialog, VerifyEmailBanner } from "../auth";
import { useSession } from "../auth-client";
import { BrandMark } from "../components/BrandMark";
import { CreateControl } from "../components/CreateControl";
import {
	CollaboratorsDialog,
	deckAccessLevelLabel,
} from "../components/CollaboratorsDialog";
import { REMOVE_BUTTON_HOVER } from "../components/EditorControls";
import {
	EmailRecoveryPrompt,
	emailRecoveryPromptLabelsFor,
} from "../components/EmailRecoveryPrompt";
import { MoveToWorkspaceDialog } from "../components/MoveToWorkspaceDialog";
import { ICON_BUTTON_HOVER } from "../components/ShareCluster";
import { AppMenu } from "../components/ui/AppMenu";
import { ReasonButton } from "../components/ui/ReasonTip";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { LoadingState } from "../components/ui/Loading";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Modal } from "../components/ui/Modal";
import { useToast } from "../components/ui/Toast";
import { saveBlobAs } from "../download";
import {
	dismissEmailRecoveryPrompt,
	type EmailRecoveryOffer,
	emailRecoveryOfferFor,
	emailRecoveryPromptDismissed,
	useAccountSeenInThisBrowser,
} from "../email-recovery-prompt";
import { useGuestCreationRefusal } from "../guest-creation";
import { useInstanceAccess } from "../instance-access";
import { getDict } from "../i18n";
import { useDocumentLanguage, useInterfaceText } from "../interface-language";
import { fillText, formatDate, pluralText } from "../interface-text";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import {
	deckFilenameSlug,
	FOLDER_NAME_MAX_LENGTH,
	type Folder,
	type Presentation,
} from "../types";

// ── Home Page ─────────────────────────────────────────────────

export function HomePage({ go }: { go: (r: Route) => void }) {
	const [presentations, setPresentations] = useState<Presentation[]>([]);
	/**
	 * The decks another account has shared with this one (REQ075), each carrying
	 * the level it was shared at. Kept apart from the list above rather than
	 * merged into it: a deck you were invited to is a different thing from one of
	 * yours, and the level is the first thing to say about it.
	 */
	const [shared, setShared] = useState<Presentation[]>([]);
	/**
	 * Which of the listed decks this account actually **owns** — the server's own
	 * answer, from `/presentations/mine`. Sharing is the owner's alone, so this is
	 * what decides whether the share control on a card can do anything. A deck
	 * held only by a locally-stored edit token is not in here, which is correct:
	 * that credential opens edits, never the sharing surface.
	 */
	const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [deleteTarget, setDeleteTarget] = useState<Presentation | null>(null);
	/** The deck whose collaborator dialog is open (REQ075), if any. */
	const [shareTarget, setShareTarget] = useState<Presentation | null>(null);
	/** The deck being handed to a workspace (REQ128), if any. */
	const [moveTarget, setMoveTarget] = useState<Presentation | null>(null);
	/** This account's folders (REQ126), each naming the decks filed in it. */
	const [folders, setFolders] = useState<Folder[]>([]);
	/** The deck whose folder is being chosen, if any. */
	const [fileTarget, setFileTarget] = useState<Presentation | null>(null);
	/** The folder-name dialog: a new folder, or a rename of `folder`. */
	const [nameDialog, setNameDialog] = useState<{ folder: Folder | null } | null>(
		null,
	);
	const [deleteFolderTarget, setDeleteFolderTarget] = useState<Folder | null>(
		null,
	);
	/** The folder whose collaborator dialog is open (REQ126), if any. */
	const [shareFolderTarget, setShareFolderTarget] = useState<Folder | null>(
		null,
	);
	const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { addToast } = useToast();
	const { text, language } = useInterfaceText();
	const words = text.home;
	// The signed-in account (if any). Its id drives the load below, so signing in
	// or out re-resolves the visible presentations.
	const { data: session, isPending: sessionPending } = useSession();
	const userId = session?.user?.id ?? null;
	/**
	 * Whether this browser closed the offer to keep its decks (REQ194), whether
	 * it has had an account (which turns the offer from "create an account" into
	 * "sign in"), and the tab of the sign-in dialog that offer opened, if any.
	 */
	const [recoveryPromptDismissed, setRecoveryPromptDismissed] = useState(
		emailRecoveryPromptDismissed,
	);
	const accountSeen = useAccountSeenInThisBrowser(userId);
	// While the operator has closed sign-up (REQ251) the offer asks to sign in.
	const { signUpOpen } = useInstanceAccess();
	// While the operator has closed creating without an account (REQ252) and
	// nobody is signed in, every way to start a deck here is drawn disabled
	// with this reason; joining by code is not a create and stays open.
	const createRefusal = useGuestCreationRefusal();
	const [recoveryDialogTab, setRecoveryDialogTab] =
		useState<EmailRecoveryOffer | null>(null);
	// Signed out, every listed deck is one this browser holds a token for, so
	// the list's length is what an emptied browser would lose.
	const emailRecoveryOffer = emailRecoveryOfferFor({
		sessionPending,
		listLoading: loading,
		signedIn: userId !== null,
		accountSeen,
		signUpOpen,
		localDeckCount: presentations.length,
		dismissed: recoveryPromptDismissed,
	});

	usePageTitle("");
	useDocumentLanguage(language);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			// When signed in, first attach any locally-created decks to the account
			// (idempotent) so the server's owner-scoped list returns them too.
			if (userId) await claimLocalPresentations();
			// Merge the two sources: decks this browser holds an edit token for
			// (local history) and decks the account owns server-side. Dedup by id,
			// preferring the local entry (it carries participantCount). The decks
			// shared *with* this account (REQ075) are fetched alongside and kept in
			// their own list — they are neither owned here nor held by a token.
			const [local, mine, sharedWithMe, ownFolders] = await Promise.all([
				api.listPresentations().catch(() => []),
				userId ? listMyPresentations() : Promise.resolve([]),
				userId ? listSharedPresentations() : Promise.resolve([]),
				userId
					? api.listFolders().catch(() => [] as Folder[])
					: Promise.resolve([] as Folder[]),
			]);
			if (cancelled) return;
			const byId = new Map<string, Presentation>();
			for (const p of [...mine, ...local]) byId.set(p.id, p);
			const merged = [...byId.values()].sort(
				(a, b) =>
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
			setPresentations(merged);
			setOwnedIds(new Set(mine.map((p: Presentation) => p.id)));
			setShared(sharedWithMe);
			setFolders(ownFolders);
			setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [userId]);

	const handleDelete = async () => {
		if (!deleteTarget) return;
		await api.deletePresentation(deleteTarget.id);
		setPresentations((ps) => ps.filter((p) => p.id !== deleteTarget.id));
		addToast(words.presentationDeleted, "success");
		setDeleteTarget(null);
	};

	/** Run one folder write, then re-read the folders it changed. */
	const changeFolders = async (write: () => Promise<unknown>, done: string) => {
		try {
			await write();
			setFolders(await api.listFolders());
			addToast(done, "success");
		} catch (folderError: unknown) {
			addToast(
				folderError instanceof Error
					? folderError.message
					: words.foldersFailed,
				"error",
			);
		}
	};

	const renderDeckGrid = (decks: Presentation[]) => (
		<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{decks.map((pres, i) => (
				<OwnDeckCard
					key={pres.id}
					pres={pres}
					enterDelay={Math.min(i + 1, 5)}
					owned={ownedIds.has(pres.id)}
					signedIn={userId !== null}
					duplicating={duplicatingId === pres.id}
					duplicateRefusal={createRefusal}
					onOpen={() => go({ page: "present", id: pres.id })}
					onShare={() => setShareTarget(pres)}
					onFile={() => setFileTarget(pres)}
					onMove={() => setMoveTarget(pres)}
					onExport={() => handleExport(pres)}
					onDuplicate={() => handleDuplicate(pres)}
					onDelete={() => setDeleteTarget(pres)}
				/>
			))}
		</div>
	);

	const handleExport = (pres: Presentation) => {
		const payload = buildExportPayload(pres);
		const blob = new Blob([JSON.stringify(payload, null, 2)], {
			type: "application/json",
		});
		saveBlobAs(blob, `${deckFilenameSlug(pres.title)}.omul.json`);
	};

	const handleImportFile = async (file: File) => {
		if (createRefusal) return;
		setImporting(true);
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			const created = await api.importPresentation(data);
			setPresentations((ps) => [created, ...ps]);
			addToast(words.presentationImported, "success");
			go({ page: "edit", id: created.id });
		} catch (e: unknown) {
			const msg =
				e instanceof SyntaxError
					? words.invalidJson
					: e instanceof ImportFileError
						? e.reason === "not-object"
							? words.importNotObject
							: words.importMissingFields
						: e instanceof Error
							? e.message
							: words.importFailed;
			addToast(msg, "error");
		} finally {
			setImporting(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const handleDuplicate = async (source: Presentation) => {
		if (duplicatingId || createRefusal) return;
		setDuplicatingId(source.id);
		try {
			const copy = await api.duplicatePresentation(source.id);
			setPresentations((ps) => [copy, ...ps]);
			addToast(words.presentationDuplicated, "success");
			go({ page: "edit", id: copy.id });
		} catch (e: unknown) {
			addToast(
				e instanceof Error ? e.message : words.duplicateFailed,
				"error",
			);
		} finally {
			setDuplicatingId(null);
		}
	};

	return (
		<div className="min-h-screen w-full bg-void bg-grid bg-noise">
			{/* Account controls + theme toggle - top right */}
			<div className="absolute top-4 right-4 sm:top-6 sm:right-6 lg:right-12 z-20 flex items-center gap-2">
				<AuthControls />
				<AppMenu />
			</div>
			{/* Hero section - full width */}
			<div className="relative z-10 w-full px-6 sm:px-12 lg:px-24 py-16 sm:py-24">
				<header className="mb-16 slide-in max-w-3xl">
					{/* The mark stands alone (REQ167): no dot beside it, no gloss under
					    it, and never in the accent. */}
					<div className="flex items-center mb-4">
						<BrandMark heightPx={28} />
					</div>
					<h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
						{words.heroTitleStart}
						<span className="text-accent-text">{words.heroTitleAccent}</span>
					</h1>
					<p className="text-text-muted text-lg max-w-xl">{words.heroIntro}</p>
				</header>

				{/* Verify-email nudge for signed-in, unverified accounts (renders
				    nothing otherwise). */}
				<div className="mb-10 max-w-xl">
					<VerifyEmailBanner />
				</div>

				{/* Actions */}
				<div className="flex flex-wrap gap-4 mb-16 slide-in slide-in-delay-1">
					<CreateControl
						refusal={createRefusal}
						label={words.createPresentation}
						className="btn-primary text-lg px-8 py-3"
						onClick={() => go({ page: "create" })}
					>
					{words.createPresentation}
					</CreateControl>
					{/* The catalog of prebuilt decks (REQ005), beside the blank-deck
					    button it is the alternative to. */}
					<CreateControl
						refusal={createRefusal}
						label={words.useTemplate}
						className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2"
						onClick={() => go({ page: "templates" })}
						title={words.useTemplateTitle}
					>
						<LayoutTemplate size={18} />
						{words.useTemplate}
					</CreateControl>
					{/* Drafting from a prompt (REQ007) — the third way a deck starts,
					    beside the blank one and the prebuilt one. Whether this build
					    can actually generate is the page's own question to ask, so the
					    way in is always here and the reason, when there is
					    one, is stated where the control it blocks lives. */}
					<CreateControl
						refusal={createRefusal}
						label={words.generateDraft}
						className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2"
						onClick={() => go({ page: "generate" })}
						title={words.generateDraftTitle}
					>
						<Sparkles size={18} />
						{words.generateDraft}
					</CreateControl>
					{/* Workspaces (REQ128) — the other owner a deck can have. Always
					    offered, whether or not this browser is signed in: the page
					    itself says what a workspace is and why it needs an account,
					    which a missing button could not. */}
					<button
						className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2"
						type="button"
						onClick={() => go({ page: "workspaces" })}
						title={words.workspacesTitle}
					>
						<Building2 size={18} />
						{words.workspaces}
					</button>
					<button
						className="btn-secondary text-lg px-8 py-3"
						type="button"
						onClick={() => go({ page: "join" })}
					>
					{words.joinWithCode}
					</button>
					<CreateControl
						refusal={createRefusal}
						label={words.importDeck}
						className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
						onClick={() => fileInputRef.current?.click()}
						disabled={importing}
						title={words.importTitle}
					>
						<Upload size={18} />
						{importing ? words.importing : words.importDeck}
					</CreateControl>
					<input
						ref={fileInputRef}
						type="file"
						accept="application/json,.json"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) handleImportFile(file);
						}}
					/>
				</div>
			</div>

			{/* Presentations list - full width */}
			<div className="relative z-10 w-full px-6 sm:px-12 lg:px-24 pb-16">
				<section className="slide-in slide-in-delay-2">
					<div className="flex flex-wrap items-center justify-between gap-3 mb-6">
						<h2 className="text-xl font-semibold text-text-muted">
						{words.yourPresentations}
						</h2>
						{/* Folders group this list (REQ126), so the way to make one sits
						    on the list. Signed out it is disabled with the reason: a
						    folder is an account's. */}
						<button
							type="button"
							className="btn-secondary text-sm px-4 py-2 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={() => setNameDialog({ folder: null })}
							disabled={userId === null}
							title={
								userId === null ? words.newFolderSignedOut : words.newFolderTitle
							}
						>
							<FolderPlus size={16} />
							{words.newFolder}
						</button>
					</div>
					{/* The offer to keep these decks with an account (REQ194), on the
					    list it is about. Signing in claims them (the effect above). */}
					{emailRecoveryOffer !== null && (
						<div className="mb-6 max-w-3xl">
							<EmailRecoveryPrompt
								offer={emailRecoveryOffer}
								labels={emailRecoveryPromptLabelsFor(getDict(language))}
								onTakeOffer={() => setRecoveryDialogTab(emailRecoveryOffer)}
								onDismiss={() => {
									dismissEmailRecoveryPrompt();
									setRecoveryPromptDismissed(true);
								}}
							/>
						</div>
					)}
					{loading ? (
						<LoadingState />
					) : presentations.length === 0 ? (
						<div className="text-center py-20">
							<div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-raised border border-border mb-6">
								<BarChart3 size={28} />
							</div>
							<h3 className="text-lg font-semibold mb-2">
							{words.noPresentations}
							</h3>
							<p className="text-text-muted mb-6 max-w-sm mx-auto">
							{words.noPresentationsBody}
							</p>
							<div className="flex flex-wrap items-center justify-center gap-3">
								{/* The empty list's own ways to start a deck are creates too
								    (REQ252), refused with the same reason as the hero's. */}
								<CreateControl
									refusal={createRefusal}
									label={words.createFirst}
									className="btn-primary px-6 py-2.5"
									onClick={() => go({ page: "create" })}
								>
								{words.createFirst}
								</CreateControl>
								{/* The emptier this list is, the more useful a prebuilt deck
								    is (REQ005) — so the offer is here too, not only in the
								    hero above. */}
								<CreateControl
									refusal={createRefusal}
									label={words.startFromTemplate}
									className="btn-secondary px-6 py-2.5 inline-flex items-center gap-2"
									onClick={() => go({ page: "templates" })}
								>
									<LayoutTemplate size={16} />
									{words.startFromTemplate}
								</CreateControl>
							</div>
						</div>
					) : folders.length === 0 ? (
						renderDeckGrid(presentations)
					) : (
						<div className="flex flex-col gap-10">
							{groupDecksByFolder(presentations, folders).map(
								({ folder, decks }) =>
									folder === null && decks.length === 0 ? null : (
										<div key={folder?.id ?? "unfiled"}>
											<div className="flex items-center gap-2 mb-3 min-w-0">
												<FolderIcon
													size={16}
													className="text-text-dim shrink-0"
												/>
												<h3 className="font-semibold truncate min-w-0">
													{folder?.name ?? words.unfiled}
												</h3>
												<span className="text-sm text-text-dim shrink-0">
													{decks.length}
												</span>
												{folder && (
													<>
														{/* Sharing a folder sits on the folder it shares,
														    and reaches every deck under this heading. */}
														<button
															type="button"
															className={`${OWN_DECK_ACTION} ${ICON_BUTTON_HOVER}`}
															onClick={() => setShareFolderTarget(folder)}
															title={fillText(words.shareFolderTitle, {
																name: folder.name,
															})}
														>
															<Users size={16} />
														</button>
														<button
															type="button"
															className={`${OWN_DECK_ACTION} ${ICON_BUTTON_HOVER}`}
															onClick={() => setNameDialog({ folder })}
															title={fillText(words.renameFolderTitle, {
																name: folder.name,
															})}
														>
															<Pencil size={16} />
														</button>
														<button
															type="button"
															className={`${OWN_DECK_ACTION} transition-colors ${REMOVE_BUTTON_HOVER}`}
															onClick={() => setDeleteFolderTarget(folder)}
															title={fillText(words.deleteFolderTitle, {
																name: folder.name,
															})}
														>
															<Trash2 size={16} />
														</button>
													</>
												)}
											</div>
											{decks.length === 0 ? (
												<p className="text-sm text-text-dim">
												{words.emptyFolder}
												</p>
											) : (
												renderDeckGrid(decks)
											)}
										</div>
									),
							)}
						</div>
					)}
				</section>
			</div>

			{/* Decks somebody else shared with this account (REQ075). Its own
			    section, below the account's own: an invitation is a different thing
			    from a deck you made, and the level is the first thing to say about
			    it. Rendered only when there is something in it — an empty section
			    would be chrome explaining a feature rather than a list. */}
			{shared.length > 0 && (
				<div className="relative z-10 w-full px-6 sm:px-12 lg:px-24 pb-16">
					<section className="slide-in">
						<h2 className="text-xl font-semibold mb-6 text-text-muted">
						{words.sharedWithYou}
						</h2>
						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
							{shared.map((pres) => (
								<div
									key={pres.id}
									className="group flex items-center gap-4 p-4 rounded-xl bg-surface-raised border border-border hover:border-text-dim transition-all shadow-panel cursor-pointer"
									onClick={() => go({ page: "present", id: pres.id })}
								>
									<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface border border-border-subtle flex-shrink-0">
										<span className="font-mono text-sm text-text-muted">
											{pres.slides.length}
										</span>
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-3 mb-1">
											<h3 className="font-semibold truncate">{pres.title}</h3>
											<StatusBadge status={pres.status} />
										</div>
										<div className="flex items-center gap-4 text-sm text-text-muted">
											{/* What this account may do with it, in the same words
											    the owner chose it by. */}
											<span className="text-accent-text">
												{deckAccessLevelLabel(pres.accessLevel ?? null, text)}
											</span>
											<span className="font-mono">{pres.code}</span>
											<span>{formatDate(language, pres.createdAt)}</span>
										</div>
									</div>
								</div>
							))}
						</div>
					</section>
				</div>
			)}

			{moveTarget && (
				<MoveToWorkspaceDialog
					presentationId={moveTarget.id}
					deckTitle={moveTarget.title}
					onClose={() => setMoveTarget(null)}
					onMoved={(workspace) => {
						// The deck is the workspace's now, so it leaves this list rather
						// than sitting in it under somebody else's ownership — it is one
						// click away on the workspace's own page.
						setPresentations((ps) => ps.filter((p) => p.id !== moveTarget.id));
						setOwnedIds((owned) => {
							const remaining = new Set(owned);
							remaining.delete(moveTarget.id);
							return remaining;
						});
						go({ page: "workspace", id: workspace.id });
					}}
					onNotify={addToast}
				/>
			)}

			{fileTarget && (
				<Modal
					title={words.moveToFolder}
					icon={FolderInput}
					onClose={() => setFileTarget(null)}
				>
					<ul className="flex flex-col gap-1">
						{[null, ...folders].map((folder) => {
							const current =
								(folders.find((candidate) =>
									candidate.presentationIds.includes(fileTarget.id),
								)?.id ?? null) === (folder?.id ?? null);
							return (
								<li key={folder?.id ?? "unfiled"}>
									<button
										type="button"
										className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
										disabled={current}
										title={
											current
											? words.alreadyHere
												: folder
												? fillText(words.fileIn, {
														title: fileTarget.title,
														folder: folder.name,
													})
												: fillText(words.takeOutOfFolder, {
														title: fileTarget.title,
													})
										}
										onClick={() => {
											setFileTarget(null);
											changeFolders(
												() => api.fileDeck(fileTarget.id, folder?.id ?? null),
												folder
													? fillText(words.filedIn, { folder: folder.name })
													: words.movedToUnfiled,
											);
										}}
									>
										<FolderIcon size={16} className="text-text-dim shrink-0" />
										<span className="flex-1 min-w-0 truncate">
											{folder?.name ?? words.noFolder}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
					{folders.length === 0 && (
						<p className="mt-3 text-sm text-text-muted">{words.noFoldersYet}</p>
					)}
				</Modal>
			)}

			{nameDialog && (
				<FolderNameDialog
					folder={nameDialog.folder}
					onClose={() => setNameDialog(null)}
					onSubmit={(name) => {
						const renaming = nameDialog.folder;
						setNameDialog(null);
						changeFolders(
							() =>
								renaming
									? api.renameFolder(renaming.id, name)
									: api.createFolder(name),
							renaming
								? words.folderRenamed
								: fillText(words.folderCreated, { name }),
						);
					}}
				/>
			)}

			<ConfirmModal
				open={!!deleteFolderTarget}
				title={words.deleteFolder}
				message={fillText(words.deleteFolderMessage, {
					name: deleteFolderTarget?.name ?? "",
				})}
				confirmLabel={words.deleteFolder}
				variant="danger"
				onConfirm={() => {
					const target = deleteFolderTarget;
					setDeleteFolderTarget(null);
					if (target) {
						changeFolders(
							() => api.deleteFolder(target.id),
							words.folderDeleted,
						);
					}
				}}
				onCancel={() => setDeleteFolderTarget(null)}
			/>

			{recoveryDialogTab !== null && (
				<AuthDialog
					initialMode={recoveryDialogTab}
					onClose={() => setRecoveryDialogTab(null)}
				/>
			)}

			{shareTarget && (
				<CollaboratorsDialog
					subject={{ kind: "deck", id: shareTarget.id, title: shareTarget.title }}
					onClose={() => setShareTarget(null)}
					onNotify={addToast}
				/>
			)}

			{shareFolderTarget && (
				<CollaboratorsDialog
					subject={{
						kind: "folder",
						id: shareFolderTarget.id,
						title: shareFolderTarget.name,
					}}
					onClose={() => setShareFolderTarget(null)}
					onNotify={addToast}
				/>
			)}

			<ConfirmModal
				open={!!deleteTarget}
				title={words.deletePresentation}
				message={fillText(words.deletePresentationMessage, {
					title: deleteTarget?.title ?? "",
				})}
				confirmLabel={words.deleteConfirm}
				variant="danger"
				onConfirm={handleDelete}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}

// ── One of your own decks ─────────────────────────────────────

/**
 * The quiet treatment every action on an own-deck card shares, beside the hover
 * token it composes. Its own row, at rest and in reach (REQ188): five icon
 * buttons that merely faded in on hover still took their width, which left the
 * title one letter and an ellipsis at the two-column width — and a control a
 * touch screen can tap but nobody can see is not a control anyone finds.
 */
const OWN_DECK_ACTION = "p-2 rounded-lg disabled:opacity-30";

/**
 * A card under "Your Presentations" (REQ188): the title on a line of its own
 * with the status beside it, then code, slide count and date — each of which
 * may move to a second line but never breaks inside itself — then the deck's
 * six actions. The whole card is the click target that opens the
 * presentation; every action stops the click from reaching it.
 */
export function OwnDeckCard({
	pres,
	enterDelay,
	owned,
	signedIn,
	duplicating,
	duplicateRefusal = null,
	onOpen,
	onShare,
	onFile,
	onMove,
	onExport,
	onDuplicate,
	onDelete,
}: {
	pres: Presentation;
	/** Which of the staggered entrance steps the card wears (1–5). */
	enterDelay: number;
	/** Whether this account owns the deck — the server's answer, not the token map's. */
	owned: boolean;
	signedIn: boolean;
	duplicating: boolean;
	/**
	 * Why this visitor may not duplicate the deck — a duplicate is a create, so
	 * it is refused while creating without an account is closed and nobody is
	 * signed in (REQ252) — or `null` when they may.
	 */
	duplicateRefusal?: string | null;
	onOpen: () => void;
	onShare: () => void;
	/** Choose this deck's folder (REQ126) — owner-only, like sharing. */
	onFile: () => void;
	onMove: () => void;
	onExport: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
}) {
	const { text, language } = useInterfaceText();
	const words = text.home;
	const slideCount = pres.slides.length;
	return (
		<div
			className={`flex flex-col p-4 rounded-xl bg-surface-raised border border-border hover:border-text-dim transition-all shadow-panel cursor-pointer slide-in slide-in-delay-${enterDelay}`}
			onClick={onOpen}
		>
			<div className="flex items-center gap-3 mb-1 min-w-0">
				{/* The full title on hover too, since a long one still truncates. */}
				<h3 className="font-semibold truncate min-w-0" title={pres.title}>
					{pres.title}
				</h3>
				<span className="flex-shrink-0">
					<StatusBadge status={pres.status} />
				</span>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
				<span className="font-mono whitespace-nowrap">{pres.code}</span>
				<span className="whitespace-nowrap">
					{pluralText(language, slideCount, words.slideCount)}
				</span>
				<span className="whitespace-nowrap">
				{formatDate(language, pres.createdAt)}
				</span>
			</div>
			<div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t border-border-subtle">
				{/* Sharing lives on the deck it shares. Shown for
				    every deck and disabled with the reason when this account
				    is not its owner — a locally-held edit token
				    runs the deck but never widens who is on it. */}
				<button
					type="button"
					className={`${OWN_DECK_ACTION} ${ICON_BUTTON_HOVER} disabled:cursor-not-allowed disabled:hover:text-text-muted`}
					onClick={(event) => {
						event.stopPropagation();
						onShare();
					}}
					disabled={!owned}
					title={
						owned
						? words.shareDeck
							: signedIn
							? words.shareDeckNotOwner
							: words.shareDeckSignedOut
					}
				>
					<Users size={18} />
				</button>
				{/* Filing it (REQ126): a folder is the owning account's, so this is
				    owner-only on the same terms as sharing. */}
				<button
					type="button"
					className={`${OWN_DECK_ACTION} ${ICON_BUTTON_HOVER} disabled:cursor-not-allowed disabled:hover:text-text-muted`}
					onClick={(event) => {
						event.stopPropagation();
						onFile();
					}}
					disabled={!owned}
					title={
						owned
						? words.fileDeck
							: signedIn
							? words.fileDeckNotOwner
							: words.fileDeckSignedOut
					}
				>
					<FolderInput size={18} />
				</button>
				{/* Handing the deck to a workspace changes who owns it, so
				    it sits on the deck beside the sharing control
				    it is the bigger version of. Owner-only for the same
				    reason sharing is: a locally-held edit token runs a deck,
				    it does not give it away. */}
				<button
					type="button"
					className={`${OWN_DECK_ACTION} ${ICON_BUTTON_HOVER} disabled:cursor-not-allowed disabled:hover:text-text-muted`}
					onClick={(event) => {
						event.stopPropagation();
						onMove();
					}}
					disabled={!owned}
					title={
						owned
						? words.moveDeck
							: signedIn
							? words.moveDeckNotOwner
							: words.moveDeckSignedOut
					}
				>
					<Building2 size={18} />
				</button>
				<button
					type="button"
					className={`${OWN_DECK_ACTION} ${ICON_BUTTON_HOVER}`}
					onClick={(event) => {
						event.stopPropagation();
						onExport();
					}}
					title={words.exportDeck}
				>
					<Download size={18} />
				</button>
				{duplicateRefusal !== null ? (
					// The wrapper keeps a tap on the refused control from reaching the
					// card, which would open the deck.
					<span
						className="contents"
						onClick={(event) => event.stopPropagation()}
					>
						<ReasonButton
							label={words.duplicateDeck}
							reason={duplicateRefusal}
							className={`${OWN_DECK_ACTION} ${ICON_BUTTON_HOVER}`}
							onClick={onDuplicate}
						>
							<Copy size={18} />
						</ReasonButton>
					</span>
				) : (
					<button
						type="button"
						className={`${OWN_DECK_ACTION} ${ICON_BUTTON_HOVER} disabled:cursor-wait`}
						onClick={(event) => {
							event.stopPropagation();
							onDuplicate();
						}}
						disabled={duplicating}
						title={words.duplicateDeck}
					>
						<Copy size={18} />
					</button>
				)}
				<button
					type="button"
					className={`${OWN_DECK_ACTION} transition-colors ${REMOVE_BUTTON_HOVER}`}
					onClick={(event) => {
						event.stopPropagation();
						onDelete();
					}}
					title={words.deleteDeck}
				>
					<Trash2 size={18} />
				</button>
			</div>
		</div>
	);
}

// ── Folders (REQ126) ──────────────────────────────────────────

/**
 * The account's decks grouped by folder: one group per folder, in the order
 * given, then the decks in none (`folder: null`). Each deck lands once and
 * keeps the list's own order; a filed id the list does not hold is skipped.
 */
export function groupDecksByFolder(
	decks: Presentation[],
	folders: Folder[],
): { folder: Folder | null; decks: Presentation[] }[] {
	const folderOf = new Map<string, string>();
	for (const folder of folders) {
		for (const presentationId of folder.presentationIds) {
			folderOf.set(presentationId, folder.id);
		}
	}
	return [
		...folders.map((folder) => ({
			folder,
			decks: decks.filter((deck) => folderOf.get(deck.id) === folder.id),
		})),
		{ folder: null, decks: decks.filter((deck) => !folderOf.has(deck.id)) },
	];
}

/** Naming a new folder, or renaming `folder`. */
function FolderNameDialog({
	folder,
	onClose,
	onSubmit,
}: {
	folder: Folder | null;
	onClose: () => void;
	onSubmit: (name: string) => void;
}) {
	const [name, setName] = useState(folder?.name ?? "");
	const { text } = useInterfaceText();
	const words = text.home;
	const trimmed = name.trim();
	return (
		<Modal
		title={folder ? words.renameFolder : words.newFolder}
			icon={FolderPlus}
			onClose={onClose}
		>
			<form
				className="flex items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					if (trimmed) onSubmit(trimmed);
				}}
			>
				<input
					className="input text-sm"
					type="text"
					placeholder={words.folderNamePlaceholder}
					aria-label={words.folderName}
					autoFocus
					maxLength={FOLDER_NAME_MAX_LENGTH}
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
				<button
					type="submit"
					className="btn-primary text-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={!trimmed}
					title={trimmed ? words.saveName : words.nameFirst}
				>
				{folder ? words.rename : words.create}
				</button>
			</form>
		</Modal>
	);
}
