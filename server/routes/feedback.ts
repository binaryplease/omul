/**
 * Feedback about omul, over HTTP (REQ185, REQ186).
 *
 * Three public routes. `GET /api/feedback/config` says which feedback this
 * deployment collects — a fact about the deployment, not the caller, read once
 * per page load the way `GET /api/legal` is. `POST /api/feedback` stores one
 * entry from the app menu's form (REQ185), and `POST /api/feedback/participant`
 * one answer to the prompt after a session (REQ186), each in the feedback
 * database (`server/feedback-store.ts`). Each write answers `404` while its own
 * channel is off, whatever the request carries — the two switches are
 * independent, so either channel runs without the other.
 *
 * **JSON only.** A form-encoded, multipart or plain-text post is refused `415`
 * before it is validated or counted against the budget: those are the bodies a
 * page on another site can make a visitor's browser send without asking, and
 * the real client never sends one.
 *
 * Both work without an account, because participants and anonymous deck
 * creators have none. **The account the menu's form may record comes from the
 * session and never from the body**: `contactMe: true` stores whoever the
 * session resolves to, and without a session the entry is stored anonymously
 * whatever the body says, so a client cannot name somebody else's account. The
 * participant route records no account at all: it never asks who the session
 * is, and its table has no column to put one in.
 *
 * Nothing here logs the request body. An entry is anonymous unless its sender
 * asked to be contacted, and a log line would be a second copy that is not.
 */

import { Elysia, status } from "elysia";
import { resolveUserId } from "../accounts";
import {
	type FeedbackSettings,
	type FeedbackStore,
	feedbackChannelOn,
	feedbackSettings as defaultFeedbackSettings,
	feedbackStore as defaultFeedbackStore,
} from "../feedback-store";
import { guardFeedback, guardParticipantFeedback } from "../rate-limit";
import {
	type FeedbackConfig,
	FeedbackConfigSchema,
	ParticipantFeedbackSubmissionSchema,
	UserFeedbackSubmissionSchema,
} from "../schemas";

const EMPTY_SUBMISSION_MESSAGE =
	"Feedback needs a rating, a comment, or both";
const OFF_MESSAGE = "Feedback is not collected on this server";
const PROMPT_OFF_MESSAGE =
	"Feedback from participants is not collected on this server";
const JSON_ONLY_MESSAGE = "Feedback is accepted as application/json only";

/** Whether the request declares a JSON body, whatever its parameters. */
function declaresJson(request: Request): boolean {
	const mediaType = request.headers.get("content-type")?.split(";")[0];
	return mediaType?.trim().toLowerCase() === "application/json";
}

/**
 * The feedback routes over a given store — `null` for a deployment with both
 * channels off — and the settings that say which channel is on. A factory for
 * the reason the generation routes are one: the tests drive every posture end
 * to end over their own store, without re-importing the module under a
 * different environment.
 */
export function createFeedbackRoutes(
	store: FeedbackStore | null = defaultFeedbackStore,
	settings: FeedbackSettings = defaultFeedbackSettings,
) {
	// Each channel's store while it is on, and `null` while it is off.
	const menuStore = store && feedbackChannelOn(settings, "user") ? store : null;
	const promptStore =
		store && feedbackChannelOn(settings, "participant") ? store : null;
	const config: FeedbackConfig = {
		enabled: menuStore !== null,
		promptPercent: promptStore ? settings.promptPercent : null,
		promptCooldownDays: settings.promptCooldownDays,
	};

	return (
		new Elysia({ prefix: "/api", name: "feedback" })
			// ── Which feedback does this deployment collect? ─────────
			.get("/feedback/config", () => config, {
				response: FeedbackConfigSchema,
				detail: {
					tags: ["Feedback"],
					summary: "Whether this server collects feedback about omul",
					description:
						"Reports which feedback about omul this deployment collects — what the app menu's feedback form (REQ185) and the prompt after a session (REQ186) read before offering themselves. `enabled` is true only when the operator set `OMUL_FEEDBACK_ENABLED=true`. `promptPercent` is the share of eligible participants the prompt asks, from 1 to 100, and `null` while `OMUL_FEEDBACK_PROMPT_PERCENT` is unset; `promptCooldownDays` is how many days a device waits before it is asked again (`OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS`, default 30), reported whether or not the prompt is on. The two switches are independent. Public and read-only — a fact about the deployment, not the caller.",
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
					if (!menuStore) throw status(404, { error: OFF_MESSAGE });
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
					const entry = menuStore.recordUserFeedback({
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
					parse: menuStore ? undefined : "none",
					// Runs before validation and before the handler's rate limit.
					transform: ({ request }) => {
						if (!menuStore) throw status(404, { error: OFF_MESSAGE });
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

			// ── Answer the prompt after a session (REQ186) ───────────
			// Off is absent in the same way: the body is never read, and the
			// budget is not spent. On, nobody is looked up — not the session, not
			// the participant — because nobody is recorded.
			.post(
				"/feedback/participant",
				({ body, request, server, set }) => {
					// The transform has already answered 404; this only narrows it.
					if (!promptStore) throw status(404, { error: PROMPT_OFF_MESSAGE });
					const overLimit = guardParticipantFeedback({ request, server });
					if (overLimit) return overLimit;
					if (body.rating === null && body.comment === "") {
						set.status = 400;
						return { error: EMPTY_SUBMISSION_MESSAGE };
					}
					const entry = promptStore.recordParticipantFeedback({
						rating: body.rating,
						comment: body.comment,
						language: body.language,
					});
					set.status = 201;
					return { id: entry.id };
				},
				{
					parse: promptStore ? undefined : "none",
					// Runs before validation and before the handler's rate limit.
					transform: ({ request }) => {
						if (!promptStore) {
							throw status(404, { error: PROMPT_OFF_MESSAGE });
						}
						if (!declaresJson(request)) {
							throw status(415, { error: JSON_ONLY_MESSAGE });
						}
					},
					body: ParticipantFeedbackSubmissionSchema,
					detail: {
						tags: ["Feedback"],
						summary:
							"Answer the prompt after a session: what a participant thinks of omul",
						description:
							"Stores one participant's answer to the prompt shown after a session ends (REQ186) in the operator's feedback database — not in any deck, and never shown to a presenter or organizer. Takes a JSON body `{ rating?, comment?, language }`: a `rating` from 1 to 5, a `comment` of at most 2,000 characters after trimming, or both — either alone is enough, neither answers `400`. `language` is the deck's language, one of `en`, `de`, `fr`, `es`, `it`, `pt`, `nl`. Anonymous by definition: no account, participant, deck, IP address or user agent is stored, signed in or not, and the date is kept to the day. Answers `201` with the entry's `id`, `404` for any request while `OMUL_FEEDBACK_PROMPT_PERCENT` is unset (independently of `OMUL_FEEDBACK_ENABLED`), `415` for any content type but `application/json`, `422` for a malformed body, and `429` over its budget — three hundred per ten minutes per client, sized for a room behind one address (REQ145).",
					},
				},
			)
	);
}

/** The feedback routes the server mounts, over the environment's store. */
export const feedbackRoutes = createFeedbackRoutes();
