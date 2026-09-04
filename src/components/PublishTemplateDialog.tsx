import { LayoutTemplate } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import type {
	DeckTemplateCategory,
	Presentation,
	WorkspaceTemplate,
} from "../types";
import {
	DECK_TEMPLATE_CATEGORIES,
	WORKSPACE_TEMPLATE_DESCRIPTION_MAX_LENGTH,
	WORKSPACE_TEMPLATE_TAG_LIMIT,
	WORKSPACE_TEMPLATE_TAG_MAX_LENGTH,
} from "../types";
import { DECK_TEMPLATE_CATEGORY_LABELS } from "./TemplateCard";
import { Modal } from "./ui/Modal";

// ── Publishing a deck as the workspace's template (REQ004) ────
//
// Reached from a control on the deck's own card, because what it publishes is
// that deck. What the dialog collects is everything *except* the slides: the
// slides are the deck's and are copied server-side, while the name, the
// occasion, the sentence and the search words are decisions about the entry in
// the gallery and are nobody's but the publisher's.
//
// Two things it says out loud, because both surprise somebody otherwise:
// publishing takes a **snapshot** — editing the deck afterwards does not change
// the template — and republishing an already-published deck refreshes that entry
// rather than adding a second one. The server decides both; this only says so.

/** The occasion picker's choices — the schema's vocabulary, in its own order. */
const CATEGORY_OPTIONS: { value: DeckTemplateCategory; label: string }[] =
	DECK_TEMPLATE_CATEGORIES.map((category) => ({
		value: category,
		label: DECK_TEMPLATE_CATEGORY_LABELS[category],
	}));

export function PublishTemplateDialog({
	workspaceId,
	deck,
	published,
	onClose,
	onPublished,
	onNotify,
}: {
	workspaceId: string;
	deck: Presentation;
	/** This deck's existing entry, when it has one — what makes this a republish. */
	published: WorkspaceTemplate | null;
	onClose: () => void;
	/** Handed the entry so the gallery beside it can be updated in place. */
	onPublished: (template: WorkspaceTemplate) => void;
	onNotify: (message: string, tone: "success" | "info" | "error") => void;
}) {
	// Pre-filled from the entry when there is one, so a republish edits what is
	// already in the gallery rather than re-typing it, and from the deck when
	// there is not.
	const [title, setTitle] = useState(published?.title ?? deck.title ?? "");
	const [description, setDescription] = useState(published?.description ?? "");
	const [category, setCategory] = useState<DeckTemplateCategory>(
		published?.category ?? "meeting",
	);
	const [tags, setTags] = useState((published?.tags ?? []).join(", "));
	const [busy, setBusy] = useState(false);

	// A comma-separated line rather than a tag editor: this is a handful of extra
	// search words, and the cap is the schema's so the field cannot compose a
	// request the boundary refuses.
	const enteredTags = tags
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag !== "")
		.slice(0, WORKSPACE_TEMPLATE_TAG_LIMIT)
		.map((tag) => tag.slice(0, WORKSPACE_TEMPLATE_TAG_MAX_LENGTH));

	const publish = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const template = await api.publishWorkspaceTemplate(workspaceId, {
				presentationId: deck.id,
				title: title.trim(),
				description: description.trim(),
				category,
				tags: enteredTags,
			});
			onNotify(
				published
					? `“${template.title}” now holds this deck's slides as they are today`
					: `“${template.title}” is a template this workspace can start from`,
				"success",
			);
			onPublished(template);
			onClose();
		} catch (publishError: unknown) {
			onNotify(
				publishError instanceof Error
					? publishError.message
					: "Could not publish this deck",
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal
			title={published ? "Republish as template" : "Publish as template"}
			icon={LayoutTemplate}
			onClose={onClose}
		>
			<div className="flex flex-col gap-4">
				<p className="text-sm text-text-muted">
					{published
						? "This deck is already a template here. Republishing replaces the entry's slides with the deck's as they are right now — decks somebody already made from it are untouched."
						: "Everybody in this workspace will be able to start a new deck from a copy of this one. The copy is taken now: editing this deck afterwards will not change the template, and republishing is how you update it."}
				</p>

				<label className="flex flex-col gap-1.5 text-sm">
					<span className="text-text-muted">Name in the gallery</span>
					<input
						className="input text-sm"
						type="text"
						value={title}
						disabled={busy}
						placeholder={deck.title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</label>

				<label className="flex flex-col gap-1.5 text-sm">
					<span className="text-text-muted">What it is for</span>
					<select
						className="input text-sm"
						value={category}
						disabled={busy}
						onChange={(event) =>
							setCategory(event.target.value as DeckTemplateCategory)
						}
					>
						{CATEGORY_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>

				<label className="flex flex-col gap-1.5 text-sm">
					<span className="text-text-muted">
						A sentence or two{" "}
						<span className="text-text-dim">(optional)</span>
					</span>
					<textarea
						className="input text-sm min-h-20"
						value={description}
						disabled={busy}
						maxLength={WORKSPACE_TEMPLATE_DESCRIPTION_MAX_LENGTH}
						placeholder="What this deck is for, and when to reach for it."
						onChange={(event) => setDescription(event.target.value)}
					/>
				</label>

				<label className="flex flex-col gap-1.5 text-sm">
					<span className="text-text-muted">
						Words to find it by{" "}
						<span className="text-text-dim">(optional, comma-separated)</span>
					</span>
					<input
						className="input text-sm"
						type="text"
						value={tags}
						disabled={busy}
						placeholder="retro, sprint, team"
						onChange={(event) => setTags(event.target.value)}
					/>
					<span className="text-xs text-text-dim">
						Up to {WORKSPACE_TEMPLATE_TAG_LIMIT}; every one of them is shown on
						the card, so a search always has a visible reason.
					</span>
				</label>

				<div className="flex items-center justify-end gap-2">
					<button
						type="button"
						className="btn-secondary text-sm px-4"
						onClick={onClose}
						disabled={busy}
					>
						Cancel
					</button>
					<button
						type="button"
						className="btn-primary text-sm px-4 disabled:opacity-50 disabled:cursor-not-allowed"
						onClick={publish}
						disabled={busy || title.trim() === ""}
						title={
							title.trim() === ""
								? "Publish — give the template a name first"
								: published
									? "Replace this template's slides with the deck's"
									: "Publish this deck as a template for the workspace"
						}
					>
						{busy ? "Publishing…" : published ? "Republish" : "Publish"}
					</button>
				</div>
			</div>
		</Modal>
	);
}
