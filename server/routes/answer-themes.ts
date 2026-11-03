/**
 * Themes over a free-text slide's answers, over HTTP (REQ114).
 *
 * The store and its rules are `server/services/answer-themes.ts`; this file
 * adds who may reach it and which slides it is for. **Reading and writing are
 * both edit-gated** by the one gate `requireEdit` (owner, edit token, or an
 * `edit` grant): grouping is part of working the results, and nothing here is
 * served to participants, the shared screen or the results link.
 */

import { Elysia } from "elysia";
import {
	AnswerThemeNameSchema,
	AssignAnswerThemeSchema,
	type Slide,
	slideAnswersAreGroupable,
} from "../schemas";
import {
	assignAnswerToTheme,
	createAnswerTheme,
	deleteAnswerTheme,
	isAnswerThemeRefusal,
	listAnswerThemes,
	renameAnswerTheme,
} from "../services/answer-themes";
import { findSubmittedAnswer } from "../services/presentations";
import { requireEdit } from "./presentations";

const SLIDE_TYPE_REFUSAL = {
	error: "Only word-cloud and open-ended answers can be grouped into themes",
	refused: "slide-type",
} as const;

/**
 * Why this slide cannot hold themes, or `null` when it can: `404` for a slide
 * not on the deck, `400` with `refused: "slide-type"` for any other type.
 */
function slideRefusal(
	deck: Record<string, unknown>,
	slideId: string,
): { status: number; body: Record<string, string> } | null {
	const slide = (deck.slides as Slide[]).find((one) => one.id === slideId);
	if (!slide) {
		return { status: 404, body: { error: "No such slide on this deck" } };
	}
	if (!slideAnswersAreGroupable(slide.type)) {
		return { status: 400, body: SLIDE_TYPE_REFUSAL };
	}
	return null;
}

const EDITOR_ONLY =
	"Requires deck ownership, `Authorization: Bearer <creatorToken>`, or an `edit` grant; a results-link token opens nothing here. Word-cloud and open-ended slides only: any other type answers `400` with `refused: \"slide-type\"`, and a slide not on the deck `404`.";

export const answerThemeRoutes = new Elysia({
	prefix: "/api",
	name: "answer-themes",
})
	.get(
		"/presentations/:id/slides/:slideId/answer-themes",
		async ({ params, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const refusal = slideRefusal(auth, params.slideId);
			if (refusal) {
				set.status = refusal.status;
				return refusal.body;
			}
			return { themes: await listAnswerThemes(params.id, params.slideId) };
		},
		{
			detail: {
				tags: ["Results"],
				summary: "List a free-text slide's answer themes",
				description: `Returns \`{ themes }\` — every theme an editor grouped this slide's answers into (REQ114), oldest first, each \`{ id, slideId, name, answerIds, createdAt }\`. \`answerIds\` are the ids the results payload names answers by (\`responses[].id\` on an open-ended slide, \`answers[].id\` on a word cloud); an answer in no theme is ungrouped. ${EDITOR_ONLY}`,
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.post(
		"/presentations/:id/slides/:slideId/answer-themes",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const refusal = slideRefusal(auth, params.slideId);
			if (refusal) {
				set.status = refusal.status;
				return refusal.body;
			}
			const created = await createAnswerTheme(
				params.id,
				params.slideId,
				body.name,
			);
			if (isAnswerThemeRefusal(created)) {
				set.status = 400;
				return {
					error: "This slide has as many themes as it can hold",
					...created,
				};
			}
			set.status = 201;
			return created;
		},
		{
			body: AnswerThemeNameSchema,
			detail: {
				tags: ["Results"],
				summary: "Create an answer theme",
				description: `Adds an empty theme \`{ name }\` to a free-text slide (REQ114) and answers \`201\` with it. The name is trimmed and 1–80 characters (\`422\` otherwise); a slide holds at most 50 themes, past which it answers \`400\` with \`refused: \"theme-limit\"\`. ${EDITOR_ONLY}`,
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.patch(
		"/presentations/:id/slides/:slideId/answer-themes/:themeId",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const refusal = slideRefusal(auth, params.slideId);
			if (refusal) {
				set.status = refusal.status;
				return refusal.body;
			}
			const renamed = await renameAnswerTheme(
				params.id,
				params.slideId,
				params.themeId,
				body.name,
			);
			if (!renamed) {
				set.status = 404;
				return { error: "No such theme on this slide" };
			}
			return renamed;
		},
		{
			body: AnswerThemeNameSchema,
			detail: {
				tags: ["Results"],
				summary: "Rename an answer theme",
				description: `Renames one theme \`{ name }\` (REQ114), on the same terms as creating one, and answers with the theme. A theme id from another slide or deck answers the same \`404\` an unknown one does. ${EDITOR_ONLY}`,
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.delete(
		"/presentations/:id/slides/:slideId/answer-themes/:themeId",
		async ({ params, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const refusal = slideRefusal(auth, params.slideId);
			if (refusal) {
				set.status = refusal.status;
				return refusal.body;
			}
			const deleted = await deleteAnswerTheme(
				params.id,
				params.slideId,
				params.themeId,
			);
			if (!deleted) {
				set.status = 404;
				return { error: "No such theme on this slide" };
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Results"],
				summary: "Delete an answer theme",
				description: `Deletes one theme (REQ114). Its answers become ungrouped and are otherwise untouched — no answer is deleted or hidden. A theme id from another slide or deck answers \`404\`. ${EDITOR_ONLY}`,
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.put(
		"/presentations/:id/answers/:answerId/answer-theme",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const answer = await findSubmittedAnswer(params.id, params.answerId);
			if (!answer) {
				set.status = 404;
				return { error: "No such submitted answer on this deck" };
			}
			const refusal = slideRefusal(auth, answer.slideId);
			if (refusal) {
				set.status = refusal.status;
				return refusal.body;
			}
			const assigned = await assignAnswerToTheme(
				params.id,
				answer.slideId,
				answer.id,
				body.themeId,
				async () => (await findSubmittedAnswer(params.id, answer.id)) !== null,
			);
			if (!assigned) {
				set.status = 404;
				return { error: "No such theme or answer on this slide" };
			}
			return { ...assigned, slideId: answer.slideId };
		},
		{
			body: AssignAnswerThemeSchema,
			detail: {
				tags: ["Results"],
				summary: "Group one answer under a theme",
				description: `Puts one submitted answer in a theme on its own slide \`{ themeId }\` — moving it out of whichever theme held it, since an answer is in at most one — or with \`{ themeId: null }\` takes it out of every theme (REQ114). Idempotent. Answers \`{ answerId, themeId, slideId }\`. The answer itself is never changed: tallies, results and exports read as before. An answer id from another deck, or a theme from another slide or deck, answers the same \`404\` an unknown one does. ${EDITOR_ONLY}`,
				security: [{ bearerAuth: [] }],
			},
		},
	);
