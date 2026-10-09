/**
 * Feedback about omul, over HTTP (REQ185).
 *
 * Two public routes. `GET /api/feedback/config` says whether this deployment
 * collects feedback at all — a fact about the deployment, not the caller, read
 * once per page load the way `GET /api/legal` is. `POST /api/feedback` stores
 * one entry from the app menu in the feedback database
 * (`server/feedback-store.ts`), and answers `404` while the channel is off.
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

import { Elysia } from "elysia";
import { resolveUserId } from "../accounts";
import {
	type FeedbackStore,
	feedbackStore as defaultFeedbackStore,
} from "../feedback-store";
import { guardFeedback } from "../rate-limit";
import { FeedbackConfigSchema, UserFeedbackSubmissionSchema } from "../schemas";

const EMPTY_SUBMISSION_MESSAGE =
	"Feedback needs a rating, a comment, or both";

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
						"Reports whether this deployment collects feedback about omul from the app menu (REQ185): `enabled` is true only when the operator set `OMUL_FEEDBACK_ENABLED=true`. Public and read-only — a fact about the deployment, not the caller. An object rather than a bare boolean, because further fields join it.",
				},
			})

			// ── Send feedback from the app menu ──────────────────────
			.post(
				"/feedback",
				async ({ body, request, server, set }) => {
					// Off answers as though the route were not there, and before the
					// rate limit, so a deployment that collects nothing spends no budget
					// saying so.
					if (!store) {
						set.status = 404;
						return { error: "Feedback is not collected on this server" };
					}
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
					body: UserFeedbackSubmissionSchema,
					detail: {
						tags: ["Feedback"],
						summary: "Send feedback about omul to this instance's operator",
						description:
							"Stores one piece of feedback about omul itself in the operator's feedback database (REQ185) — not in any deck, and never shown to a presenter or organizer. Takes `{ rating?, comment?, surface, language, contactMe? }`: a `rating` from 1 to 5, a `comment` of at most 2,000 characters after trimming, or both — either alone is enough, neither answers `400`. `surface` is `presenter`, `participant` or `other`. No account is needed. With `contactMe: true` and a signed-in session, the session's account is recorded so the operator can write back; without a session `contactMe` is ignored, and the account can never be named in the body. Nothing else about the sender is stored, and the date is kept to the day. Answers `201` with the entry's `id`, `404` while `OMUL_FEEDBACK_ENABLED` is not `true`, `422` for a malformed body, and `429` over the feedback budget — twenty per ten minutes per client (REQ145).",
					},
				},
			)
	);
}

/** The feedback routes the server mounts, over the environment's store. */
export const feedbackRoutes = createFeedbackRoutes();
