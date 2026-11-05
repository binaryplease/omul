import { Trash2, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type {
	DeckAccessLevel,
	DeckCollaborator,
	DeckCollaboratorEntry,
} from "../types";
import { BRAND_NAME } from "./BrandMark";
import { Modal } from "./ui/Modal";

// ── Who the deck is shared with, as its owner manages it (REQ075) ──────
//
// One dialog for the whole capability — inviting, changing a level and revoking
// — because they are three views of one question: who is on this deck. Split
// across the chrome, an owner could revoke somebody without ever having been
// shown that anybody was there. It sits behind a control on the deck's own card:
// what it governs is that deck, so it lives beside it rather than in
// global chrome.
//
// A folder (REQ126) is shared through the same dialog, because it is the same
// question asked one level up: the grant is the same shape, at the same levels,
// and reaches every deck filed in the folder. Only the calls and the sentences
// differ, and both are chosen by `subject.kind` from the two tables below.
//
// A deck's dialog also lists the accounts that reach the deck through the folder
// it is filed in. Those rows are read-only here: a folder grant is changed and
// revoked in the folder's own dialog.
//
// Everything here is the *owner's* surface. It is emphatically not where the
// levels are enforced — that is the server, on every mutation route, and it
// holds whether this dialog was ever drawn (see `server/routes/presentations.ts`
// and `server/collaborators.integration.test.ts`).

/**
 * The three levels as a person reads them: one descriptor, composed
 * by the picker in this dialog and by the badge on a shared deck's card, so the
 * two cannot come to describe the same grant differently.
 *
 * `summary` says what the level grants **today** and is deliberately blunt about
 * `comment`: the level exists and is carried faithfully through the model, but
 * comment threads on slides are their own piece of work, so today it authorizes
 * exactly what `view` does. An owner who was told otherwise would be granting
 * something that is not there.
 */
export const DECK_ACCESS_LEVEL_DESCRIPTORS: readonly {
	level: DeckAccessLevel;
	label: string;
	summary: string;
}[] = [
	{
		level: "view",
		label: "Can view",
		summary:
			"Opens the deck and its results, including what the room is kept from. Changes nothing.",
	},
	{
		level: "comment",
		label: "Can comment",
		summary:
			"Everything a viewer can do. Commenting on slides is not built yet, so today this grants no more than “Can view”.",
	},
	{
		level: "edit",
		label: "Can edit",
		summary:
			"Edits the slides, runs the session and reveals results. Cannot delete the deck or change who it is shared with — both stay with you.",
	},
];

/** How a level is named on screen. Falls back to the raw value, never to "". */
export function deckAccessLevelLabel(level: DeckAccessLevel | null): string {
	if (!level) return "No access";
	return (
		DECK_ACCESS_LEVEL_DESCRIPTORS.find(
			(descriptor) => descriptor.level === level,
		)?.label ?? level
	);
}

/** What a level grants, in one sentence, for the picker's helper line. */
export function deckAccessLevelSummary(level: DeckAccessLevel | null): string {
	if (!level) return "This deck is not shared with you.";
	return (
		DECK_ACCESS_LEVEL_DESCRIPTORS.find(
			(descriptor) => descriptor.level === level,
		)?.summary ?? ""
	);
}

/**
 * How one collaborator is named in the list: their display name where the
 * account has one, otherwise the address the owner invited.
 *
 * An account that has since been deleted comes back with neither — the grant
 * outlives the person — and is said so rather than rendered as a blank row, so
 * the owner can see the standing they still have to revoke.
 */
export function collaboratorDisplayName(
	collaborator: Pick<DeckCollaborator, "email" | "name">,
): string {
	if (collaborator.name?.trim()) return collaborator.name.trim();
	if (collaborator.email.trim()) return collaborator.email.trim();
	return "Account no longer exists";
}

/** A row of the deck's list that reaches the deck through a shared folder. */
export type FolderStanding = DeckCollaboratorEntry & {
	folder: NonNullable<DeckCollaboratorEntry["folder"]>;
};

function isFolderStanding(
	entry: DeckCollaboratorEntry,
): entry is FolderStanding {
	return entry.folder !== null;
}

/** The dialog's two lists: grants it can change, and standing it only reports. */
export type ShareList = {
	grants: DeckCollaborator[];
	folderStanding: FolderStanding[];
};

/** Split the deck's list into its own grants and the folder's. */
export function splitDeckCollaborators(
	entries: DeckCollaboratorEntry[],
): ShareList {
	return {
		grants: entries.filter((entry) => !isFolderStanding(entry)),
		folderStanding: entries.filter(isFolderStanding),
	};
}

/**
 * The folder standing of the account behind this deck grant, or `undefined`.
 *
 * The payload carries no account id, so the account is matched by its email. A
 * deleted account has an empty email and matches nothing.
 */
export function folderStandingOf(
	collaborator: Pick<DeckCollaborator, "email">,
	folderStanding: FolderStanding[],
): FolderStanding | undefined {
	if (!collaborator.email) return undefined;
	return folderStanding.find((entry) => entry.email === collaborator.email);
}

/**
 * What the owner is told after revoking a grant.
 *
 * On a folder the sentence names only the folder's access: a grant the account
 * holds on one of the filed decks themselves is not touched by the revoke, and
 * the folder dialog does not read the decks' grants, so it says nothing about
 * them.
 */
export function revokedGrantNotice(
	kind: ShareSubject["kind"],
	collaborator: Pick<DeckCollaborator, "email" | "name">,
	folderStanding: FolderStanding[],
): string {
	const name = collaboratorDisplayName(collaborator);
	if (kind === "folder") return `${name} no longer has access through this folder`;
	const kept = folderStandingOf(collaborator, folderStanding);
	if (!kept) return `${name} no longer has access`;
	return `${name} no longer has a grant on this deck, but keeps “${deckAccessLevelLabel(kept.level)}” through the folder “${kept.folder.name}”`;
}

/** What the revoke button on a grant's row says it will do. */
export function revokeTitle(
	kind: ShareSubject["kind"],
	collaborator: Pick<DeckCollaborator, "email">,
	folderStanding: FolderStanding[],
): string {
	if (kind === "folder") {
		return "Remove this person's access through this folder — it stops at their next request";
	}
	const kept = folderStandingOf(collaborator, folderStanding);
	if (!kept) return "Remove this person's access — it stops at their next request";
	return `Remove this grant — they keep “${deckAccessLevelLabel(kept.level)}” through the folder “${kept.folder.name}”`;
}

/** What the list says when the subject has no grants of its own. */
export function noGrantsSentence(
	unshared: string,
	folderStanding: FolderStanding[],
): string {
	return folderStanding.length > 0
		? "No account has a grant on this deck itself."
		: unshared;
}

/** What the dialog shares: one deck (REQ075), or a folder of them (REQ126). */
export type ShareSubject = { kind: "deck" | "folder"; id: string; title: string };

/** The four owner calls for each kind of subject, one shape for both. */
const SHARE_CALLS: Record<
	ShareSubject["kind"],
	{
		list: (id: string) => Promise<ShareList>;
		share: typeof api.shareDeck;
		setLevel: typeof api.setCollaboratorLevel;
		revoke: typeof api.removeCollaborator;
	}
> = {
	deck: {
		list: async (id) => splitDeckCollaborators(await api.listCollaborators(id)),
		share: api.shareDeck,
		setLevel: api.setCollaboratorLevel,
		revoke: api.removeCollaborator,
	},
	folder: {
		list: async (id) => ({
			grants: await api.listFolderCollaborators(id),
			folderStanding: [],
		}),
		share: api.shareFolder,
		setLevel: api.setFolderCollaboratorLevel,
		revoke: api.removeFolderCollaborator,
	},
};

/** How the dialog speaks about each kind of subject. */
const SHARE_COPY: Record<
	ShareSubject["kind"],
	{
		title: string;
		reach: string;
		found: string;
		granted: string;
		inviteTitle: string;
		unshared: string;
		kept: string;
	}
> = {
	deck: {
		title: "Share this deck",
		reach: "",
		found: "find it",
		granted: "this deck",
		inviteTitle: "Share this deck with that account",
		unshared:
			"This deck is shared with nobody. Only you can open, edit and run it.",
		kept: "Deleting this deck, and deciding who it is shared with, stay with you whatever level you grant.",
	},
	folder: {
		title: "Share this folder",
		reach:
			" The level reaches every deck filed in it — the ones there now and any you file later — and a deck you move out of it is no longer reached.",
		found: "find its decks",
		granted: "the decks in this folder",
		inviteTitle: "Share this folder and its decks with that account",
		unshared:
			"This folder is shared with nobody. Its decks are reached only by you and by whoever each deck is shared with.",
		kept: "Deleting its decks, and deciding who the folder is shared with, stay with you whatever level you grant.",
	},
};

/** Who one row names: the account's name, and its address under that. */
function CollaboratorIdentity({
	collaborator,
}: {
	collaborator: Pick<DeckCollaborator, "email" | "name">;
}) {
	return (
		<div className="flex-1 min-w-0">
			<div className="truncate">{collaboratorDisplayName(collaborator)}</div>
			{collaborator.name?.trim() && collaborator.email ? (
				<div className="text-xs text-text-dim truncate">
					{collaborator.email}
				</div>
			) : null}
		</div>
	);
}

/**
 * The accounts that reach the deck through its folder. A deck is in at most one
 * folder, so every row names the same one. The two controls stay on the row,
 * disabled, and say where the grant is managed.
 */
function FolderStandingList({
	folderStanding,
}: {
	folderStanding: FolderStanding[];
}) {
	const folderName = folderStanding[0].folder.name;
	const managedThere = `Change or revoke this in the share dialog of the folder “${folderName}”`;
	return (
		<div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm flex flex-col gap-3">
			<p className="text-xs text-text-dim">
				These accounts reach this deck through the shared folder{" "}
				<span className="text-text">{folderName}</span>. Revoking a grant above
				leaves this access in place. An account listed in both places has the
				stronger of its two levels. Change or revoke this access in that
				folder's share dialog.
			</p>
			<ul className="flex flex-col gap-3">
				{folderStanding.map((standing) => (
					<li key={standing.id} className="flex items-center gap-2">
						<CollaboratorIdentity collaborator={standing} />
						<div className="w-36 shrink-0">
							<select
								className="input text-xs disabled:opacity-50 disabled:cursor-not-allowed"
								value={standing.level}
								disabled
								title={managedThere}
							>
								{DECK_ACCESS_LEVEL_DESCRIPTORS.map((descriptor) => (
									<option key={descriptor.level} value={descriptor.level}>
										{descriptor.label}
									</option>
								))}
							</select>
						</div>
						<button
							type="button"
							className="text-text-dim p-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
							disabled
							title={managedThere}
						>
							<Trash2 size={16} />
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

export function CollaboratorsDialog({
	subject,
	onClose,
	onNotify,
}: {
	subject: ShareSubject;
	onClose: () => void;
	/** How the dialog says what just happened — the surface's own toast. */
	onNotify: (message: string, tone: "success" | "info" | "error") => void;
}) {
	const [collaborators, setCollaborators] = useState<DeckCollaborator[]>([]);
	const [folderStanding, setFolderStanding] = useState<FolderStanding[]>([]);
	const [loading, setLoading] = useState(true);
	const [email, setEmail] = useState("");
	const [level, setLevel] = useState<DeckAccessLevel>("view");
	const [busy, setBusy] = useState(false);
	const calls = SHARE_CALLS[subject.kind];
	const copy = SHARE_COPY[subject.kind];

	const refresh = useCallback(async () => {
		try {
			const list = await SHARE_CALLS[subject.kind].list(subject.id);
			setCollaborators(list.grants);
			setFolderStanding(list.folderStanding);
		} catch {
			// A list that cannot be read leaves the dialog saying the deck is shared
			// with nobody, which is the withholding reading: it offers no level to
			// change and no grant to revoke, and inviting still works.
			setCollaborators([]);
			setFolderStanding([]);
		} finally {
			setLoading(false);
		}
	}, [subject.kind, subject.id]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const invite = async () => {
		const address = email.trim();
		if (!address || busy) return;
		setBusy(true);
		try {
			const grant = await calls.share(subject.id, address, level);
			// Re-read rather than splice: sharing again with an address that already
			// has a grant *changes* it, so appending would show one person twice.
			await refresh();
			setEmail("");
			onNotify(
				`${collaboratorDisplayName(grant)} can now ${deckAccessLevelLabel(grant.level).toLowerCase()} ${copy.granted}`,
				"success",
			);
		} catch (shareError: unknown) {
			onNotify(
				shareError instanceof Error
					? shareError.message
					: `Could not share ${copy.granted}`,
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	const changeLevel = async (
		collaborator: DeckCollaborator,
		next: DeckAccessLevel,
	) => {
		setBusy(true);
		try {
			const updated = await calls.setLevel(
				subject.id,
				collaborator.id,
				next,
			);
			setCollaborators((current) =>
				current.map((entry) => (entry.id === updated.id ? updated : entry)),
			);
			onNotify(
				`${collaboratorDisplayName(updated)} — ${deckAccessLevelLabel(updated.level).toLowerCase()}`,
				"info",
			);
		} catch (levelError: unknown) {
			onNotify(
				levelError instanceof Error
					? levelError.message
					: "Could not change that access level",
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	const revoke = async (collaborator: DeckCollaborator) => {
		setBusy(true);
		try {
			await calls.revoke(subject.id, collaborator.id);
			setCollaborators((current) =>
				current.filter((entry) => entry.id !== collaborator.id),
			);
			onNotify(
				revokedGrantNotice(subject.kind, collaborator, folderStanding),
				"info",
			);
		} catch (revokeError: unknown) {
			onNotify(
				revokeError instanceof Error
					? revokeError.message
					: "Could not remove that collaborator",
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal title={copy.title} icon={Users} onClose={onClose}>
			<div className="flex flex-col gap-4">
				<p className="text-sm text-text-muted">
					Give another {BRAND_NAME} account access to{" "}
					<span className="text-text">{subject.title}</span>.{copy.reach} They
					sign in with their own account and {copy.found} under “Shared with
					you” — there is no link to pass on and nothing for them to forward. The
					level you choose is enforced on the server for every change they try
					to make, not just in what they are shown.
				</p>

				{/* Invite by the address the account signed up with — a caller never
				    names an account any other way. */}
				<div className="flex flex-col gap-2">
					<input
						type="email"
						className="input text-sm"
						placeholder="their@email.address"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") invite();
						}}
					/>
					<div className="flex items-center gap-2">
						{/* `.input` is width:100%, so a select is sized by the box around
						    it rather than by a width utility on it. */}
						<div className="flex-1 min-w-0">
							<select
								className="input text-sm"
								value={level}
								onChange={(event) =>
									setLevel(event.target.value as DeckAccessLevel)
								}
								title="What this person will be able to do"
							>
								{DECK_ACCESS_LEVEL_DESCRIPTORS.map((descriptor) => (
									<option key={descriptor.level} value={descriptor.level}>
										{descriptor.label}
									</option>
								))}
							</select>
						</div>
						<button
							type="button"
							className="btn-primary text-sm flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
							onClick={invite}
							disabled={busy || !email.trim()}
							title={
								email.trim()
									? copy.inviteTitle
									: `${copy.inviteTitle} — type the account's email address first`
							}
						>
							<UserPlus size={14} />
							Invite
						</button>
					</div>
					{/* What the chosen level buys, under the control that chooses it —
					    a level is a promise to somebody, and reading it afterwards is
					    too late. */}
					<p className="text-xs text-text-dim">{deckAccessLevelSummary(level)}</p>
				</div>

				<div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
					{loading ? (
						<span className="text-text-dim">Checking…</span>
					) : collaborators.length === 0 ? (
						<span className="text-text-muted">
							{noGrantsSentence(copy.unshared, folderStanding)}
						</span>
					) : (
						<ul className="flex flex-col gap-3">
							{collaborators.map((collaborator) => (
								<li key={collaborator.id} className="flex items-center gap-2">
									<CollaboratorIdentity collaborator={collaborator} />
									<div className="w-36 shrink-0">
										<select
											className="input text-xs"
											value={collaborator.level}
											disabled={busy}
											onChange={(event) =>
												changeLevel(
													collaborator,
													event.target.value as DeckAccessLevel,
												)
											}
											title="Change what this person can do"
										>
											{DECK_ACCESS_LEVEL_DESCRIPTORS.map((descriptor) => (
												<option key={descriptor.level} value={descriptor.level}>
													{descriptor.label}
												</option>
											))}
										</select>
									</div>
									<button
										type="button"
										className="text-text-dim hover:text-error transition-colors p-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
										onClick={() => revoke(collaborator)}
										disabled={busy}
										title={revokeTitle(subject.kind, collaborator, folderStanding)}
									>
										<Trash2 size={16} />
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				{folderStanding.length > 0 ? (
					<FolderStandingList folderStanding={folderStanding} />
				) : null}

				<p className="text-xs text-text-dim">
					Removing somebody takes effect at once — there is nothing of theirs to
					expire. What it cannot reach is a page they already have open, which
					keeps what it was last sent until it next asks the server. {copy.kept}
				</p>
			</div>
		</Modal>
	);
}
