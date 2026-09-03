import { Trash2, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { DeckAccessLevel, DeckCollaborator } from "../types";
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

export function CollaboratorsDialog({
	presentationId,
	deckTitle,
	onClose,
	onNotify,
}: {
	presentationId: string;
	deckTitle: string;
	onClose: () => void;
	/** How the dialog says what just happened — the surface's own toast. */
	onNotify: (message: string, tone: "success" | "info" | "error") => void;
}) {
	const [collaborators, setCollaborators] = useState<DeckCollaborator[]>([]);
	const [loading, setLoading] = useState(true);
	const [email, setEmail] = useState("");
	const [level, setLevel] = useState<DeckAccessLevel>("view");
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setCollaborators(await api.listCollaborators(presentationId));
		} catch {
			// A list that cannot be read leaves the dialog saying the deck is shared
			// with nobody, which is the withholding reading: it offers no level to
			// change and no grant to revoke, and inviting still works.
			setCollaborators([]);
		} finally {
			setLoading(false);
		}
	}, [presentationId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const invite = async () => {
		const address = email.trim();
		if (!address || busy) return;
		setBusy(true);
		try {
			const grant = await api.shareDeck(presentationId, address, level);
			// Re-read rather than splice: sharing again with an address that already
			// has a grant *changes* it, so appending would show one person twice.
			await refresh();
			setEmail("");
			onNotify(
				`${collaboratorDisplayName(grant)} can now ${deckAccessLevelLabel(grant.level).toLowerCase()} this deck`,
				"success",
			);
		} catch (shareError: unknown) {
			onNotify(
				shareError instanceof Error
					? shareError.message
					: "Could not share this deck",
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
			const updated = await api.setCollaboratorLevel(
				presentationId,
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
			await api.removeCollaborator(presentationId, collaborator.id);
			setCollaborators((current) =>
				current.filter((entry) => entry.id !== collaborator.id),
			);
			onNotify(
				`${collaboratorDisplayName(collaborator)} no longer has access`,
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
		<Modal title="Share this deck" icon={Users} onClose={onClose}>
			<div className="flex flex-col gap-4">
				<p className="text-sm text-text-muted">
					Give another {BRAND_NAME} account access to{" "}
					<span className="text-text">{deckTitle}</span>. They sign in with their
					own account and find it under “Shared with you” — there is no link to
					pass on and nothing for them to forward. The level you choose is
					enforced on the server for every change they try to make, not just in
					what they are shown.
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
									? "Share this deck with that account"
									: "Share this deck — type the account's email address first"
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
							This deck is shared with nobody. Only you can open, edit and run it.
						</span>
					) : (
						<ul className="flex flex-col gap-3">
							{collaborators.map((collaborator) => (
								<li key={collaborator.id} className="flex items-center gap-2">
									<div className="flex-1 min-w-0">
										<div className="truncate">
											{collaboratorDisplayName(collaborator)}
										</div>
										{collaborator.name?.trim() && collaborator.email ? (
											<div className="text-xs text-text-dim truncate">
												{collaborator.email}
											</div>
										) : null}
									</div>
									<div className="w-32 shrink-0">
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
										title="Remove this person's access — it stops at their next request"
									>
										<Trash2 size={16} />
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				<p className="text-xs text-text-dim">
					Removing somebody takes effect at once — there is nothing of theirs to
					expire. What it cannot reach is a page they already have open, which
					keeps what it was last sent until it next asks the server. Deleting this
					deck, and deciding who it is shared with, stay with you whatever level
					you grant.
				</p>
			</div>
		</Modal>
	);
}
