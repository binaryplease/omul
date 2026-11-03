/**
 * Themes over a free-text slide's answers (REQ114).
 *
 * An editor reads a wall of word-cloud or open-ended answers and sorts it into
 * named groups. The grouping is stored **beside** the answers, in a collection
 * of its own: no vote row is written, hidden or removed by anything here, so
 * every tally, results payload and export (REQ095/REQ096) reads what it read
 * before a theme existed.
 *
 * A module of its own for the reason `services/slide-comments.ts` is one: it
 * owns its collection and its rules, and **nothing here imports the
 * presentation service**, so that service can import this one to erase a deck's
 * themes with its answers. What this module cannot see — whether an answer id
 * is a row on this deck — it is handed by the caller as a check to run under
 * its own lock (see {@link assignAnswerToTheme}).
 *
 * Who may read or write a theme is the route's question (`requireEdit`), and
 * which slide types may hold one is `slideAnswersAreGroupable`.
 */

import { createStore } from "../db";
import { createKeyedLock } from "../keyed-lock";
import {
	ANSWER_THEMES_PER_SLIDE_MAX,
	type AnswerTheme,
	AnswerThemeSchema,
	StoredAnswerThemeSchema,
} from "../schemas";

const themes = createStore("answerThemes", StoredAnswerThemeSchema, {
	indexes: ["presentationId", "slideId"],
});

// One queue per slide: "an answer is in at most one theme" and the per-slide
// cap are both read-then-write over that slide's themes.
const slideLock = createKeyedLock();

function slideKey(presentationId: string, slideId: string): string {
	return `${presentationId}:${slideId}`;
}

/** Why a theme was not created, when the reason is a rule. */
export type AnswerThemeRefusal = { refused: "theme-limit" };

/** Whether a `createAnswerTheme` result is a stated refusal. */
export function isAnswerThemeRefusal(
	result: AnswerTheme | AnswerThemeRefusal,
): result is AnswerThemeRefusal {
	return "refused" in result;
}

/** The slide's themes, oldest first, with every key present. */
async function slideThemes(
	presentationId: string,
	slideId: string,
): Promise<AnswerTheme[]> {
	const rows = await themes.find({ presentationId, slideId });
	return rows
		.map((row) => AnswerThemeSchema.parse(row))
		.sort((first, second) => first.createdAt.localeCompare(second.createdAt));
}

/**
 * One theme, only if it is on this slide of this deck — an id from anywhere
 * else is `null`, as an unknown one is, so no route can probe across decks.
 */
async function themeOnSlide(
	presentationId: string,
	slideId: string,
	themeId: string,
): Promise<AnswerTheme | null> {
	const row = await themes.findOne(themeId);
	if (!row || row.presentationId !== presentationId || row.slideId !== slideId) {
		return null;
	}
	return AnswerThemeSchema.parse(row);
}

/** Every theme on one slide, oldest first. */
export async function listAnswerThemes(
	presentationId: string,
	slideId: string,
): Promise<AnswerTheme[]> {
	return slideThemes(presentationId, slideId);
}

/** Add an empty theme to a slide, up to {@link ANSWER_THEMES_PER_SLIDE_MAX}. */
export async function createAnswerTheme(
	presentationId: string,
	slideId: string,
	name: string,
): Promise<AnswerTheme | AnswerThemeRefusal> {
	return slideLock.run(slideKey(presentationId, slideId), async () => {
		const existing = await themes.find({ presentationId, slideId });
		if (existing.length >= ANSWER_THEMES_PER_SLIDE_MAX) {
			return { refused: "theme-limit" } satisfies AnswerThemeRefusal;
		}
		const inserted = await themes.insert({
			presentationId,
			slideId,
			name,
			answerIds: [],
			createdAt: new Date().toISOString(),
		});
		return AnswerThemeSchema.parse(inserted);
	});
}

/** Rename one theme; `null` when it is not on this slide. */
export async function renameAnswerTheme(
	presentationId: string,
	slideId: string,
	themeId: string,
	name: string,
): Promise<AnswerTheme | null> {
	return slideLock.run(slideKey(presentationId, slideId), async () => {
		if (!(await themeOnSlide(presentationId, slideId, themeId))) return null;
		const updated = await themes.update(themeId, { name });
		return updated ? AnswerThemeSchema.parse(updated) : null;
	});
}

/**
 * Delete one theme. Its answers become ungrouped — they are untouched, since
 * they were never in the theme, only named by it.
 */
export async function deleteAnswerTheme(
	presentationId: string,
	slideId: string,
	themeId: string,
): Promise<boolean> {
	return slideLock.run(slideKey(presentationId, slideId), async () => {
		if (!(await themeOnSlide(presentationId, slideId, themeId))) return false;
		return themes.remove(themeId);
	});
}

/**
 * Put one answer in a theme on its slide — out of whichever theme held it — or,
 * with `themeId: null`, in none. Idempotent: repeating it changes nothing.
 *
 * `answerStillStands` is asked **inside** the slide's lock, after the theme is
 * found. The REQ027 delete removes its vote row and then
 * {@link removeAnswerFromThemes} under this same lock, so either this check sees
 * the row gone, or the delete's sweep runs after this write and takes the id
 * back out — a theme never keeps naming a deleted answer.
 *
 * `null` when the theme is not on this slide or the answer is gone.
 */
export async function assignAnswerToTheme(
	presentationId: string,
	slideId: string,
	answerId: string,
	themeId: string | null,
	answerStillStands: () => Promise<boolean>,
): Promise<{ answerId: string; themeId: string | null } | null> {
	return slideLock.run(slideKey(presentationId, slideId), async () => {
		if (themeId !== null) {
			if (!(await themeOnSlide(presentationId, slideId, themeId))) return null;
		}
		if (!(await answerStillStands())) return null;
		for (const theme of await slideThemes(presentationId, slideId)) {
			const holds = theme.answerIds.includes(answerId);
			if (theme.id === themeId && !holds) {
				await themes.update(theme.id, {
					answerIds: [...theme.answerIds, answerId],
				});
			} else if (theme.id !== themeId && holds) {
				await themes.update(theme.id, {
					answerIds: theme.answerIds.filter((member) => member !== answerId),
				});
			}
		}
		return { answerId, themeId };
	});
}

/**
 * Take a deleted answer (REQ027) out of whichever theme held it. The theme
 * stays, even emptied: an editor may be building groups ahead of the answers.
 */
export async function removeAnswerFromThemes(
	presentationId: string,
	slideId: string,
	answerId: string,
): Promise<void> {
	await slideLock.run(slideKey(presentationId, slideId), async () => {
		for (const theme of await slideThemes(presentationId, slideId)) {
			if (!theme.answerIds.includes(answerId)) continue;
			await themes.update(theme.id, {
				answerIds: theme.answerIds.filter((member) => member !== answerId),
			});
		}
	});
}

/**
 * Drop every theme on a deck — with the answers they group, on a reset
 * (REQ101) or a delete (REQ146). Returns how many were removed.
 */
export async function deleteDeckAnswerThemes(
	presentationId: string,
): Promise<number> {
	return themes.deleteMany({ presentationId });
}
