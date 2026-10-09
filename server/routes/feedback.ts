/**
 * Feedback about omul, over HTTP (REQ185).
 *
 * Two public routes. `GET /api/feedback/config` says whether this deployment
 * collects feedback at all — a fact about the deployment, not the caller, read
 * once per page load the way `GET /api/legal` is. `POST /api/feedback` stores
 * one entry in the feedback database (`server/feedback-store.ts`) — what the app
 * menu's form sends — and answers `404`
 * while the channel is off, whatever the request carries.
 *
 * **JSON only.** A form-encoded, multipart or plain-text post is refused `415`
 * before it is validated or counted against the budget: those are the bodies a
 * page on another site can make a visitor's browser send without asking, and
 * the real client never sends one.
 *
 * It works without an account, because participants and anonymous deck
 * creators have none. **The account it may record comes from the session and
 * never from the body**: `contactMe: true` stores whoever the session resolves
 * to, and without a session the entry is stored anonymously whatever the body
 * says, so a client cannot name somebody else's account.
 *
 * Nothing here logs the request body. An entry is anonymous unless its sender
 * asked to be contacted, and a log line would be a second copy that is not.
 */

import { Elysia, status } from "elysia";
import { resolveUserId } from "../accounts";
import {
	type FeedbackStore,
	feedbackStore as defaultFeedbackStore,
} from "../feedback-store";
import { guardFeedback } from "../rate-limit";
import { FeedbackConfigSchema, UserFeedbackSubmissionSchema } from "../schemas";

const EMPTY_SUBMISSION_MESSAGE =
	"Feedback needs a rating, a comment, or both";
const OFF_MESSAGE = "Feedback is not collected on this server";
const JSON_ONLY_MESSAGE = "Feedback is accepted as application/json only";

/** Whether the request declares a JSON body, whatever its parameters. */
function declaresJson(request: Request): boolean {
	const mediaType = request.headers.get("content-type")?.split(";")[0];
	return mediaType?.trim().toLowerCase() === "application/json";
}

/**
 * The feedback routes over a given store, or `null` for a deployment with the
 * channel off. A factory for the reason the generation routes are one: the
 * tests drive both postures end to end over their own `:memory:` store, without
 * re-importing the module under a different environment.
 */
export function createFeedbackRoutes(
	store: FeedbackStore | null = defaultFeedbackStore,
) {
	return (
		new Elysia({ prefix: "/api", name: "feedback" })
			// ── Does this deployment collect feedback? ───────────────
			.get("/feedback/config", () => ({ enabled: store !== null }), {
				response: FeedbackConfigSchema,
				detail: {
					tags: ["Feedback"],
					summary: "Whether this server collects feedback about omul",
					description:
						"Reports whether this deployment collects feedback about omul (REQ185) — what the app menu's feedback form reads before offering itself: `enabled` is true only when the operator set `OMUL_FEEDBACK_ENABLED=true`. Public and read-only — a fact about the deployment, not the caller. An object rather than a bare boolean, because further fields join it.",
				},
			})

			// ── Send feedback ────────────────────────────────────────
			// Off answers as though the route were not there: the body is never
			// read, so no body — malformed, empty or form-encoded — can make it
			// answer anything but 404, and before the rate limit, so a deployment
			// that collects nothing spends no budget saying so.
			.post(
				"/feedback",
				async ({ body, request, server, set }) => {
					// The transform has already answered 404; this only narrows `store`.
					if (!store) throw status(404, { error: OFF_MESSAGE });
					const overLimit = guardFeedback({ request, server });
					if (overLimit) return overLimit;
					if (body.rating === null && body.comment === "") {
						set.status = 400;
						return { error: EMPTY_SUBMISSION_MESSAGE };
					}
					// Only resolved when asked for, so an entry that did not tick the box
					// is never even associated with a session on the way in.
					const contactAccountId = body.contactMe
						? await resolveUserId(request.headers)
						: null;
					const entry = store.recordUserFeedback({
						rating: body.rating,
						comment: body.comment,
						surface: body.surface,
						contactAccountId,
						language: body.language,
					});
					set.status = 201;
					return { id: entry.id };
				},
				{
					parse: store ? undefined : "none",
					// Runs before validation and before the handler's rate limit.
					transform: ({ request }) => {
						if (!store) throw status(404, { error: OFF_MESSAGE });
						if (!declaresJson(request)) {
							throw status(415, { error: JSON_ONLY_MESSAGE });
						}
					},
					body: UserFeedbackSubmissionSchema,
					detail: {
						tags: ["Feedback"],
						summary: "Send feedback about omul to this instance's operator",
						description:
							"Stores one piece of feedback about omul itself in the operator's feedback database (REQ185) — not in any deck, and never shown to a presenter or organizer. Takes a JSON body `{ rating?, comment?, surface, language, contactMe? }`: a `rating` from 1 to 5, a `comment` of at most 2,000 characters after trimming, or both — either alone is enough, neither answers `400`. `surface` is `presenter`, `participant` or `other`. No account is needed. With `contactMe: true` and a signed-in session, the session's account is recorded so the operator can write back; without a session `contactMe` is ignored, and the account can never be named in the body. Nothing else about the sender is stored, and the date is kept to the day. Answers `201` with the entry's `id`, `404` for any request while `OMUL_FEEDBACK_ENABLED` is not `true`, `415` for any content type but `application/json` (so another site cannot post a form through a visitor's browser), `422` for a malformed body, and `429` over the feedback budget — twenty per ten minutes per client (REQ145).",
					},
				},
			)
	);
}

/** The feedback routes the server mounts, over the environment's store. */
export const feedbackRoutes = createFeedbackRoutes();
