import {
	BarChart3,
	Building2,
	Copy,
	Download,
	LayoutTemplate,
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
	listMyPresentations,
	listSharedPresentations,
} from "../api";
import { AuthControls, VerifyEmailBanner } from "../auth";
import { useSession } from "../auth-client";
import { BrandMark } from "../components/BrandMark";
import {
	CollaboratorsDialog,
	deckAccessLevelLabel,
} from "../components/CollaboratorsDialog";
import { MoveToWorkspaceDialog } from "../components/MoveToWorkspaceDialog";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { LoadingState } from "../components/ui/Loading";
import { StatusBadge } from "../components/ui/StatusBadge";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
import { saveBlobAs } from "../download";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import { deckFilenameSlug, type Presentation } from "../types";

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
	const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
	const [importing, setImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const { addToast } = useToast();
	// The signed-in account (if any). Its id drives the load below, so signing in
	// or out re-resolves the visible presentations.
	const { data: session } = useSession();
	const userId = session?.user?.id ?? null;

	usePageTitle("");

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
			const [local, mine, sharedWithMe] = await Promise.all([
				api.listPresentations().catch(() => []),
				userId ? listMyPresentations() : Promise.resolve([]),
				userId ? listSharedPresentations() : Promise.resolve([]),
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
		addToast("Presentation deleted", "success");
		setDeleteTarget(null);
	};

	const handleExport = (pres: Presentation) => {
		const payload = buildExportPayload(pres);
		const blob = new Blob([JSON.stringify(payload, null, 2)], {
			type: "application/json",
		});
		saveBlobAs(blob, `${deckFilenameSlug(pres.title)}.omul.json`);
	};

	const handleImportFile = async (file: File) => {
		setImporting(true);
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			const created = await api.importPresentation(data);
			setPresentations((ps) => [created, ...ps]);
			addToast("Presentation imported", "success");
			go({ page: "edit", id: created.id });
		} catch (e: unknown) {
			const msg =
				e instanceof SyntaxError
					? "Invalid JSON file"
					: e instanceof Error
						? e.message
						: "Failed to import presentation";
			addToast(msg, "error");
		} finally {
			setImporting(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const handleDuplicate = async (source: Presentation) => {
		if (duplicatingId) return;
		setDuplicatingId(source.id);
		try {
			const copy = await api.duplicatePresentation(source.id);
			setPresentations((ps) => [copy, ...ps]);
			addToast("Presentation duplicated", "success");
			go({ page: "edit", id: copy.id });
		} catch (e: unknown) {
			addToast(
				e instanceof Error ? e.message : "Failed to duplicate presentation",
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
				<ThemeToggle />
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
						Live Interactive
						<span className="text-accent-text"> Presentations</span>
					</h1>
					<p className="text-text-muted text-lg max-w-xl">
						Create polls, word clouds, Q&A sessions, and quizzes. Participants
						join with a code on any device.
					</p>
				</header>

				{/* Verify-email nudge for signed-in, unverified accounts (renders
				    nothing otherwise). */}
				<div className="mb-10 max-w-xl">
					<VerifyEmailBanner />
				</div>

				{/* Actions */}
				<div className="flex flex-wrap gap-4 mb-16 slide-in slide-in-delay-1">
					<button
						className="btn-primary text-lg px-8 py-3"
						type="button"
						onClick={() => go({ page: "create" })}
					>
						Create Presentation
					</button>
					{/* The catalog of prebuilt decks (REQ005), beside the blank-deck
					    button it is the alternative to. */}
					<button
						className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2"
						type="button"
						onClick={() => go({ page: "templates" })}
						title="Start from a prebuilt deck you can edit"
					>
						<LayoutTemplate size={18} />
						Use a Template
					</button>
					{/* Drafting from a prompt (REQ007) — the third way a deck starts,
					    beside the blank one and the prebuilt one. Whether this build
					    can actually generate is the page's own question to ask, so the
					    way in is always here (ADR-0025) and the reason, when there is
					    one, is stated where the control it blocks lives. */}
					<button
						className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2"
						type="button"
						onClick={() => go({ page: "generate" })}
						title="Describe a session and get a draft deck to edit"
					>
						<Sparkles size={18} />
						Generate a Draft
					</button>
					{/* Workspaces (REQ128) — the other owner a deck can have. Always
					    offered, whether or not this browser is signed in: the page
					    itself says what a workspace is and why it needs an account
					    (ADR-0025), which a missing button could not. */}
					<button
						className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2"
						type="button"
						onClick={() => go({ page: "workspaces" })}
						title="Decks a team owns together"
					>
						<Building2 size={18} />
						Workspaces
					</button>
					<button
						className="btn-secondary text-lg px-8 py-3"
						type="button"
						onClick={() => go({ page: "join" })}
					>
						Join with Code
					</button>
					<button
						className="btn-secondary text-lg px-8 py-3 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={importing}
						title="Import a presentation from a .omul.json file"
					>
						<Upload size={18} />
						{importing ? "Importing…" : "Import"}
					</button>
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
					<h2 className="text-xl font-semibold mb-6 text-text-muted">
						Your Presentations
					</h2>
					{loading ? (
						<LoadingState />
					) : presentations.length === 0 ? (
						<div className="text-center py-20">
							<div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-raised border border-border mb-6">
								<BarChart3 size={28} />
							</div>
							<h3 className="text-lg font-semibold mb-2">
								No presentations yet
							</h3>
							<p className="text-text-muted mb-6 max-w-sm mx-auto">
								Create your first presentation to start collecting live
								responses from your audience.
							</p>
							<div className="flex flex-wrap items-center justify-center gap-3">
								<button
									className="btn-primary px-6 py-2.5"
									type="button"
									onClick={() => go({ page: "create" })}
								>
									Create your first presentation
								</button>
								{/* The emptier this list is, the more useful a prebuilt deck
								    is (REQ005) — so the offer is here too, not only in the
								    hero above. */}
								<button
									className="btn-secondary px-6 py-2.5 inline-flex items-center gap-2"
									type="button"
									onClick={() => go({ page: "templates" })}
								>
									<LayoutTemplate size={16} />
									Start from a template
								</button>
							</div>
						</div>
					) : (
						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
							{presentations.map((pres, i) => (
								// The whole card is the click target — it opens the presentation.
								<div
									key={pres.id}
									className={`group flex items-center gap-4 p-4 rounded-xl bg-surface-raised border border-border hover:border-text-dim transition-all shadow-panel cursor-pointer slide-in slide-in-delay-${Math.min(i + 1, 5)}`}
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
											<span className="font-mono">{pres.code}</span>
											<span>
												{pres.slides.length} slide
												{pres.slides.length !== 1 ? "s" : ""}
											</span>
											<span>
												{new Date(pres.createdAt).toLocaleDateString()}
											</span>
										</div>
									</div>
									{/* Sharing lives on the deck it shares (ADR-0031). Shown for
									    every deck and disabled with the reason when this account
									    is not its owner (ADR-0025) — a locally-held edit token
									    runs the deck but never widens who is on it. */}
									<button
										type="button"
										className="text-text-dim hover:text-accent transition-colors p-2 opacity-0 group-hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-dim"
										onClick={(e) => {
											e.stopPropagation();
											setShareTarget(pres);
										}}
										disabled={!ownedIds.has(pres.id)}
										title={
											ownedIds.has(pres.id)
												? "Share this deck with another account"
												: userId
													? "Share this deck — only its owner can, and this account does not own it"
													: "Share this deck — sign in with the account that owns it first"
										}
									>
										<Users size={18} />
									</button>
									{/* Handing the deck to a workspace changes who owns it, so
									    it sits on the deck (ADR-0031) beside the sharing control
									    it is the bigger version of. Owner-only for the same
									    reason sharing is: a locally-held edit token runs a deck,
									    it does not give it away. */}
									<button
										type="button"
										className="text-text-dim hover:text-accent transition-colors p-2 opacity-0 group-hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-text-dim"
										onClick={(e) => {
											e.stopPropagation();
											setMoveTarget(pres);
										}}
										disabled={!ownedIds.has(pres.id)}
										title={
											ownedIds.has(pres.id)
												? "Move this deck into a workspace"
												: userId
													? "Move this deck into a workspace — only its owner can, and this account does not own it"
													: "Move this deck into a workspace — sign in with the account that owns it first"
										}
									>
										<Building2 size={18} />
									</button>
									<button
										type="button"
										className="text-text-dim hover:text-accent transition-colors p-2 opacity-0 group-hover:opacity-100"
										onClick={(e) => {
											e.stopPropagation();
											handleExport(pres);
										}}
										title="Export presentation as JSON"
									>
										<Download size={18} />
									</button>
									<button
										type="button"
										className="text-text-dim hover:text-accent transition-colors p-2 opacity-0 group-hover:opacity-100 disabled:opacity-50 disabled:cursor-wait"
										onClick={(e) => {
											e.stopPropagation();
											handleDuplicate(pres);
										}}
										disabled={duplicatingId === pres.id}
										title="Duplicate presentation"
									>
										<Copy size={18} />
									</button>
									<button
										type="button"
										className="text-text-dim hover:text-error transition-colors p-2 opacity-0 group-hover:opacity-100"
										onClick={(e) => {
											e.stopPropagation();
											setDeleteTarget(pres);
										}}
										title="Delete presentation"
									>
										<Trash2 size={18} />
									</button>
								</div>
							))}
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
							Shared with You
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
											    the owner chose it by (ADR-0026). */}
											<span className="text-accent-text">
												{deckAccessLevelLabel(pres.accessLevel ?? null)}
											</span>
											<span className="font-mono">{pres.code}</span>
											<span>
												{new Date(pres.createdAt).toLocaleDateString()}
											</span>
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

			{shareTarget && (
				<CollaboratorsDialog
					presentationId={shareTarget.id}
					deckTitle={shareTarget.title}
					onClose={() => setShareTarget(null)}
					onNotify={addToast}
				/>
			)}

			<ConfirmModal
				open={!!deleteTarget}
				title="Delete presentation"
				message={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
				confirmLabel="Delete"
				variant="danger"
				onConfirm={handleDelete}
				onCancel={() => setDeleteTarget(null)}
			/>
		</div>
	);
}
