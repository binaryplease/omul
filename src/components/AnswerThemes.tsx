import {
	Check,
	EyeOff,
	Layers,
	Pencil,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import {
	ANSWER_THEME_NAME_MAX_LENGTH,
	ANSWER_THEMES_PER_SLIDE_MAX,
	type AnswerTheme,
	type SlideType,
} from "../types";
import { ICON_BUTTON_HOVER } from "./ShareCluster";
import { ConfirmModal } from "./ui/ConfirmModal";

// ── Grouping free-text answers into themes (REQ114) ───────────
//
// An editor sorts a word cloud's or an open-ended slide's answers into named
// themes, through the five editor-only routes in `server/routes/answer-themes.ts`.
// The themes are stored beside the answers and change none of them, so every
// answer stays listed here exactly as it was written — grouped under its theme,
// or under "Ungrouped".
//
// **Unmounted, and editor-only by the server's gate.** No module imports this
// surface, so no page draws it. It left the editor's page because the editor
// shows only pre-presentation content, and moving themes to the Results page is
// REQ114's open follow-up, which decides what it reuses from here. The
// presenter's screen (the projector), a participant's phone and the results page
// a results link opens do not draw it; each of those would answer `401`.
// Nothing is broadcast when a theme changes, so the panel re-reads after its own
// writes and on its refresh control.
//
// **The surface says so itself.** A tester who grouped a live deck's answers
// went looking for the themes on the presenter's screen and on the phones, and
// could not tell whether the feature worked. So the strip states its scope on
// its one closed line, and the open panel opens with what themes are for and
// where they do not appear — in every state, a failed read included.

/** The strip's closed line: who sees themes, and that the room does not. */
export const ANSWER_THEMES_SCOPE = "Editors only, not shown live";

/**
 * What themes are for, at the top of the open panel: sorted by hand, read
 * here, and drawn on none of the surfaces a live deck is watched on.
 */
export const ANSWER_THEMES_PURPOSE =
	"Sort this slide's answers into themes by hand, for your own analysis here in the editor. Themes are never shown live: the presenter screen, the shared screen, participants' phones and the results link show the answers without them.";

/** One individual answer, as the grouping surface lists it. */
export type GroupableAnswer = { id: string; text: string };

/**
 * The individual answers an editor's read of a free-text tally names, in the
 * order the tally lists them — a word cloud's editor-only `answers` list (the
 * cloud itself names no row), an open-ended slide's `responses`. Anything else,
 * or a tally that names none, reads as no answers.
 */
export function groupableAnswersOf(
	slideType: SlideType,
	results: unknown,
): GroupableAnswer[] {
	if (!results || typeof results !== "object") return [];
	const tally = results as Record<string, unknown>;
	const rows =
		slideType === "word-cloud"
			? tally.answers
			: slideType === "open-text"
				? tally.responses
				: null;
	if (!Array.isArray(rows)) return [];
	return rows.map((row) => ({
		id: String(row?.id ?? ""),
		text: String(row?.text ?? ""),
	}));
}

/** One theme with the answers it holds, as the panel draws it. */
export type AnswerThemeGroup = {
	theme: AnswerTheme;
	answers: GroupableAnswer[];
	/**
	 * Answers the theme holds that this list does not name — the ones the deck's
	 * profanity filter keeps out of every tally (REQ085). Counted, never dropped.
	 */
	unlisted: number;
};

/**
 * Split a slide's answers into its themes and the ungrouped rest — the single
 * reading, so a theme's count and the rows under it cannot disagree.
 *
 * Answers keep the tally's order inside each group. An answer is in at most one
 * theme (the server's rule); should two ever name it, the older theme keeps it,
 * so no answer is drawn twice.
 */
export function groupAnswersByTheme(
	answers: GroupableAnswer[],
	themes: AnswerTheme[],
): { groups: AnswerThemeGroup[]; ungrouped: GroupableAnswer[] } {
	const listed = new Set(answers.map((answer) => answer.id));
	const claimed = new Set<string>();
	const groups = themes.map((theme) => {
		const members = new Set(
			theme.answerIds.filter((answerId) => !claimed.has(answerId)),
		);
		for (const answerId of members) claimed.add(answerId);
		return {
			theme,
			answers: answers.filter((answer) => members.has(answer.id)),
			unlisted: [...members].filter((answerId) => !listed.has(answerId))
				.length,
		};
	});
	return {
		groups,
		ungrouped: answers.filter((answer) => !claimed.has(answer.id)),
	};
}

/** The theme one answer is in, or `null` when it is ungrouped. */
export function themeIdOfAnswer(
	themes: AnswerTheme[],
	answerId: string,
): string | null {
	return themes.find((theme) => theme.answerIds.includes(answerId))?.id ?? null;
}

/**
 * Whether a new theme can be added right now and, when it cannot, the one
 * sentence saying why — drawn beside the control, which stays on screen. The
 * server re-decides both bounds; this only keeps the button from offering a
 * write it would refuse.
 */
export function answerThemeCreation({
	name,
	themeCount,
}: {
	name: string;
	themeCount: number;
}): { enabled: boolean; reason: string } {
	if (themeCount >= ANSWER_THEMES_PER_SLIDE_MAX) {
		return {
			enabled: false,
			reason: `A slide holds at most ${ANSWER_THEMES_PER_SLIDE_MAX} themes. Delete one to add another.`,
		};
	}
	if (name.trim() === "") {
		return { enabled: false, reason: "Name the theme to add it." };
	}
	return { enabled: true, reason: "" };
}

/**
 * A failed read, in words. A `404` here means the slide is not on the stored
 * deck — one added since the last save — which has no answers to group yet; any
 * other refusal is the server's own sentence.
 */
export function answerThemesLoadFailure(loadError: unknown): string {
	if (loadError instanceof ApiError && loadError.status === 404) {
		return "This slide is not saved yet, so nobody can have answered it. Save the deck to group its answers.";
	}
	return loadError instanceof Error ? loadError.message : "Unknown error";
}

/** How many answers a group line names, singular or plural. */
export function answerCountLabel(count: number): string {
	return count === 1 ? "1 answer" : `${count} answers`;
}

/**
 * One slide's answers and themes, read together and re-read after every write
 * this browser makes (nothing is broadcast when a theme changes).
 *
 * A read that comes back after the panel has moved to another slide is
 * dropped, so a slow answer never paints one slide's themes under another.
 */
export function useAnswerThemes(
	presentationId: string,
	slideId: string,
	slideType: SlideType,
): {
	answers: GroupableAnswer[];
	themes: AnswerTheme[];
	loading: boolean;
	error: string | null;
	load: () => Promise<void>;
} {
	const [answers, setAnswers] = useState<GroupableAnswer[]>([]);
	const [themes, setThemes] = useState<AnswerTheme[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const latestRead = useRef(0);

	const load = useCallback(async () => {
		const read = ++latestRead.current;
		setLoading(true);
		try {
			const [results, loadedThemes] = await Promise.all([
				api.getResults(presentationId, slideId),
				api.listAnswerThemes(presentationId, slideId),
			]);
			if (read !== latestRead.current) return;
			setAnswers(groupableAnswersOf(slideType, results));
			setThemes(loadedThemes);
			setError(null);
		} catch (loadError) {
			if (read !== latestRead.current) return;
			// Emptied along with the reason: groups left on screen under a refusal
			// would be a grouping this reader can no longer read.
			setAnswers([]);
			setThemes([]);
			setError(answerThemesLoadFailure(loadError));
		} finally {
			if (read === latestRead.current) setLoading(false);
		}
	}, [presentationId, slideId, slideType]);

	useEffect(() => {
		load();
	}, [load]);

	return { answers, themes, loading, error, load };
}

/**
 * One answer and the theme it is in. A native `<select>` is the one control
 * for all three moves — into a theme, to another, back to ungrouped — so it is
 * reachable and operable by keyboard without a widget of its own.
 */
function AnswerThemeRow({
	answer,
	themes,
	busy,
	onAssign,
}: {
	answer: GroupableAnswer;
	themes: AnswerTheme[];
	busy: boolean;
	onAssign: (answerId: string, themeId: string | null) => void;
}) {
	return (
		<li className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm">
			{/* The answer as it was written, rendered as text. */}
			<span className="min-w-0 flex-1 break-words">{answer.text}</span>
			{/* Sized by its box: `.input` is full-width by design. */}
			<div className="w-40 shrink-0">
				<select
					className="input text-xs"
					value={themeIdOfAnswer(themes, answer.id) ?? ""}
					disabled={busy}
					aria-label={`Theme for "${answer.text}"`}
					onChange={(event) => onAssign(answer.id, event.target.value || null)}
				>
					<option value="">Ungrouped</option>
					{themes.map((theme) => (
						<option key={theme.id} value={theme.id}>
							{theme.name}
						</option>
					))}
				</select>
			</div>
		</li>
	);
}

/** A theme's heading: its name and count, and renaming and deleting it in place. */
function AnswerThemeHeading({
	group,
	busy,
	onRename,
	onDelete,
}: {
	group: AnswerThemeGroup;
	busy: boolean;
	onRename: (themeId: string, name: string) => Promise<boolean>;
	onDelete: (theme: AnswerTheme) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const { theme } = group;
	const count = group.answers.length + group.unlisted;

	if (draft !== null) {
		const submit = async () => {
			if (draft.trim() === "") return;
			if (await onRename(theme.id, draft)) setDraft(null);
		};
		return (
			<form
				className="flex items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<input
					className="input text-sm"
					value={draft}
					maxLength={ANSWER_THEME_NAME_MAX_LENGTH}
					aria-label={`New name for the theme "${theme.name}"`}
					// The field exists only because its theme's rename was just pressed,
					// and that button is gone from under the keyboard: focusing the
					// field finishes the gesture rather than stealing focus from one.
					autoFocus
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") setDraft(null);
					}}
				/>
				<button
					type="submit"
					className={`shrink-0 ${ICON_BUTTON_HOVER} disabled:cursor-not-allowed disabled:opacity-50`}
					disabled={busy || draft.trim() === ""}
					title="Save the new name"
					aria-label="Save the new name"
				>
					<Check size={14} />
				</button>
				<button
					type="button"
					className={`shrink-0 ${ICON_BUTTON_HOVER}`}
					title="Keep the old name"
					aria-label="Keep the old name"
					onClick={() => setDraft(null)}
				>
					<X size={14} />
				</button>
			</form>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<h4 className="min-w-0 truncate text-sm font-medium text-text">
				{theme.name}
			</h4>
			<span className="flex-1 whitespace-nowrap text-xs text-text-dim">
				{answerCountLabel(count)}
			</span>
			<button
				type="button"
				className={`shrink-0 ${ICON_BUTTON_HOVER} disabled:cursor-not-allowed disabled:opacity-50`}
				disabled={busy}
				title={`Rename the theme "${theme.name}"`}
				aria-label={`Rename the theme "${theme.name}"`}
				onClick={() => setDraft(theme.name)}
			>
				<Pencil size={13} />
			</button>
			<button
				type="button"
				className={`shrink-0 ${ICON_BUTTON_HOVER} disabled:cursor-not-allowed disabled:opacity-50`}
				disabled={busy}
				title={`Delete the theme "${theme.name}" — its answers become ungrouped`}
				aria-label={`Delete the theme "${theme.name}" — its answers become ungrouped`}
				onClick={() => onDelete(theme)}
			>
				<Trash2 size={13} />
			</button>
		</div>
	);
}

/**
 * One slide's answers, grouped by theme, with every edit the routes allow:
 * add a theme, rename or delete one, and put an answer into a theme, move it to
 * another or take it out. Loads when it mounts, and is keyed on the slide by its
 * host, so nothing typed about one slide survives onto the next.
 */
export function AnswerThemesPanel({
	presentationId,
	slideId,
	slideType,
}: {
	presentationId: string;
	slideId: string;
	slideType: SlideType;
}) {
	const { answers, themes, loading, error, load } = useAnswerThemes(
		presentationId,
		slideId,
		slideType,
	);
	const [newName, setNewName] = useState("");
	const [busy, setBusy] = useState(false);
	const [writeError, setWriteError] = useState("");
	const [deleting, setDeleting] = useState<AnswerTheme | null>(null);
	const { groups, ungrouped } = groupAnswersByTheme(answers, themes);
	const creation = answerThemeCreation({
		name: newName,
		themeCount: themes.length,
	});

	/** Run one write, then re-read — the server's state is the one drawn. */
	const write = async (action: () => Promise<unknown>): Promise<boolean> => {
		setBusy(true);
		setWriteError("");
		try {
			await action();
			return true;
		} catch (actionError) {
			setWriteError((actionError as Error).message);
			return false;
		} finally {
			await load();
			setBusy(false);
		}
	};

	const create = async () => {
		if (!creation.enabled || busy) return;
		const created = await write(() =>
			api.createAnswerTheme(presentationId, slideId, newName),
		);
		if (created) setNewName("");
	};

	const assign = (answerId: string, themeId: string | null) =>
		write(() => api.assignAnswerTheme(presentationId, answerId, themeId));

	const rename = (themeId: string, name: string) =>
		write(() => api.renameAnswerTheme(presentationId, slideId, themeId, name));

	const confirmDelete = async () => {
		const theme = deleting;
		setDeleting(null);
		if (theme) {
			await write(() =>
				api.deleteAnswerTheme(presentationId, slideId, theme.id),
			);
		}
	};

	const purpose = (
		<p className="text-xs text-text-muted">{ANSWER_THEMES_PURPOSE}</p>
	);

	if (error) {
		return (
			<div className="space-y-4">
				{purpose}
				<p className="text-xs text-text-dim">{error}</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{purpose}
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 text-xs text-text-dim">
					{loading && answers.length === 0 && themes.length === 0
						? "Loading answers…"
						: answers.length === 0
							? "Nobody has answered this slide yet. Themes can be set up ahead of the answers."
							: `${answerCountLabel(answers.length)}, ${ungrouped.length} ungrouped. Grouping changes no answer. Answers sent since this list was read appear on refresh.`}
				</p>
				<button
					type="button"
					className={`shrink-0 ${ICON_BUTTON_HOVER} disabled:cursor-not-allowed disabled:opacity-50`}
					disabled={busy || loading}
					title="Read this slide's answers and themes again"
					aria-label="Read this slide's answers and themes again"
					onClick={() => load()}
				>
					<RefreshCw size={13} />
				</button>
			</div>

			<form
				className="space-y-1"
				onSubmit={(event) => {
					event.preventDefault();
					create();
				}}
			>
				<div className="flex items-center gap-2">
					<input
						className="input text-sm"
						value={newName}
						maxLength={ANSWER_THEME_NAME_MAX_LENGTH}
						placeholder="New theme…"
						aria-label="Name of a new theme"
						onChange={(event) => setNewName(event.target.value)}
					/>
					<button
						type="submit"
						className="btn-secondary shrink-0 text-xs"
						disabled={!creation.enabled || busy}
					>
						Add theme
					</button>
				</div>
				{/* The control stays in every state and says why it is idle. */}
				<p className="text-xs text-text-dim">
					{writeError || creation.reason}
				</p>
			</form>

			{groups.map((group) => (
				<section key={group.theme.id} className="space-y-2">
					<AnswerThemeHeading
						group={group}
						busy={busy}
						onRename={rename}
						onDelete={setDeleting}
					/>
					{group.answers.length > 0 ? (
						<ul className="space-y-1.5">
							{group.answers.map((answer) => (
								<AnswerThemeRow
									key={answer.id}
									answer={answer}
									themes={themes}
									busy={busy}
									onAssign={assign}
								/>
							))}
						</ul>
					) : null}
					{group.unlisted > 0 ? (
						<p className="text-xs text-text-dim">
							{answerCountLabel(group.unlisted)} held back by the profanity
							filter, not listed here
						</p>
					) : group.answers.length === 0 ? (
						<p className="text-xs text-text-dim">No answers in this theme yet.</p>
					) : null}
				</section>
			))}

			{ungrouped.length > 0 ? (
				<section className="space-y-2">
					<div className="flex items-center gap-2">
						<h4 className="text-sm font-medium text-text">Ungrouped</h4>
						<span className="text-xs text-text-dim">
							{answerCountLabel(ungrouped.length)}
						</span>
					</div>
					<ul className="space-y-1.5">
						{ungrouped.map((answer) => (
							<AnswerThemeRow
								key={answer.id}
								answer={answer}
								themes={themes}
								busy={busy}
								onAssign={assign}
							/>
						))}
					</ul>
				</section>
			) : null}

			<ConfirmModal
				open={deleting !== null}
				title="Delete this theme?"
				message={`"${deleting?.name ?? ""}" goes, and its answers become ungrouped. No answer is deleted.`}
				confirmLabel="Delete theme"
				variant="danger"
				onConfirm={confirmDelete}
				onCancel={() => setDeleting(null)}
			/>
		</div>
	);
}

/**
 * A free-text slide's answers grouped into themes, under the slide they belong
 * to (REQ114) — a strip closed to one line until opened. Opening it is what
 * reads the answers and themes, so paging through slides with it closed asks
 * nothing. No page mounts it at present.
 */
export function AnswerThemesStrip({
	presentationId,
	slideId,
	slideType,
}: {
	presentationId: string;
	slideId: string;
	slideType: SlideType;
}) {
	const [open, setOpen] = useState(false);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-2 rounded-xl border border-border bg-surface/40 px-3 py-2">
			<div className="flex items-center gap-2">
				<Layers size={14} className="flex-shrink-0 text-text-muted" />
				<button
					type="button"
					aria-expanded={open}
					aria-label={
						open
							? "Hide this slide's answer themes"
							: "Show this slide's answers grouped into themes"
					}
					onClick={() => setOpen((wasOpen) => !wasOpen)}
					className="min-w-0 flex-1 truncate text-left text-sm text-text-muted transition-colors hover:text-text"
				>
					{open ? "Answer themes" : "Group this slide's answers into themes"}
				</button>
				{/* The presenter-notes strip's marker, beside it under the canvas:
				    the same shape for the same kind of fact. */}
				<span className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-xs text-text-muted">
					<EyeOff size={12} />
					{ANSWER_THEMES_SCOPE}
				</span>
			</div>
			{open && (
				<AnswerThemesPanel
					key={slideId}
					presentationId={presentationId}
					slideId={slideId}
					slideType={slideType}
				/>
			)}
		</div>
	);
}
