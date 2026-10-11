/**
 * Admin surface — a privileged, operator-only API under `/api/admin/*`.
 *
 * The first (and only) action is **reassigning a presentation's owner** to
 * another account. Every action runs as a two-step,
 * token-confirmed flow so an accidental one-shot call can't mutate anything:
 *
 *   1. POST /api/admin/actions          — *prepares* an action: validates it,
 *      resolves the target account, and returns a human-readable `summary` plus a
 *      one-time `confirmationToken` (10-minute TTL). Nothing is mutated yet.
 *   2. POST /api/admin/actions/:id/confirm — *executes* it: the admin echoes the
 *      `confirmationToken` back and the reassignment runs. Bound to the same
 *      admin who prepared it, and only while still pending and unexpired.
 *   3. GET  /api/admin/events           — the append-only admin audit log.
 *
 * Beside the actions, one read: GET /api/admin/feedback, the feedback people
 * sent about omul (REQ185), one channel and one page at a time. It is the only
 * route that reads the feedback database, and it turns a stored contact account
 * into its current email here, at read time — the database never holds one.
 *
 * Admins are a deployment-supplied email allowlist (server/admins.ts, REQ164),
 * empty unless `OMUL_ADMIN_EMAILS` names someone — so an instance nobody has
 * been named on refuses every route here, which is the safe posture rather than
 * a broken one. The gate is a **cookie session only** (a privileged operator at
 * a browser), never a personal API key: 401 when not signed in, 403 when signed
 * in but not an admin.
 */

import { Elysia, status } from "elysia";
import { z } from "zod";
import {
	findUserByEmail,
	findUserById,
	resolveSessionAccount,
} from "../accounts";
import { adminStore } from "../admin-events";
import { isAdminEmail } from "../admins";
import {
	type FeedbackStore,
	feedbackStore as defaultFeedbackStore,
} from "../feedback-store";
import {
	AdminFeedbackErrorSchema,
	type AdminFeedbackPage,
	AdminFeedbackPageSchema,
	AdminFeedbackQuerySchema,
	FEEDBACK_PAGE_SIZE,
	type FeedbackContact,
} from "../schemas";
import { assignOwner, getPresentation } from "../services/presentations";

/** A JSON error Response with the given status. */
function jsonError(status: number, error: string): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** Why a request may not use the admin surface. */
interface AdminRefusal {
	status: 401 | 403;
	error: string;
}

/**
 * Resolve the admin behind a request, or why it is refused: 401 when there is
 * no cookie session; 403 when the session's email is not on the allowlist. API
 * keys are deliberately not honoured here.
 */
async function resolveAdmin(
	request: Request,
): Promise<{ userId: string; email: string } | AdminRefusal> {
	const account = await resolveSessionAccount(request.headers);
	if (!account) {
		return { status: 401, error: "Sign in to use the admin surface" };
	}
	if (!isAdminEmail(account.email)) return { status: 403, error: "Not an admin" };
	return account;
}

/** {@link resolveAdmin}, with a refusal as the Response to short-circuit with. */
async function requireAdmin(
	request: Request,
): Promise<{ userId: string; email: string } | Response> {
	const admin = await resolveAdmin(request);
	return "error" in admin ? jsonError(admin.status, admin.error) : admin;
}

// The action catalog. Only `reassign-presentation` exists today; new privileged
// actions slot in here with their own params schema and executor.
const PrepareActionSchema = z.object({
	type: z.literal("reassign-presentation"),
	presentationId: z.string().min(1),
	targetEmail: z.string().email(),
});

/**
 * Who an administrator can write back to about one app-menu entry: nobody when
 * the sender did not ask, the account's email as it stands now, or `deleted`
 * when the account is gone — so a deleted account leaves no address anywhere.
 */
function resolveFeedbackContact(
	contactAccountId: string | null,
): FeedbackContact {
	if (contactAccountId === null) return null;
	const account = findUserById(contactAccountId);
	return account ? { status: "email", email: account.email } : { status: "deleted" };
}

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
	// ── Prepare an action (no mutation yet) ────────────────
	.post(
		"/actions",
		async ({ body, request, set }) => {
			const admin = await requireAdmin(request);
			if (admin instanceof Response) return admin;

			// Only reassign-presentation is validated/supported today.
			const presentation = await getPresentation(body.presentationId);
			if (!presentation) {
				set.status = 404;
				return { error: "Presentation not found" };
			}
			const target = findUserByEmail(body.targetEmail);
			if (!target) {
				set.status = 404;
				return { error: "Target account not found" };
			}

			const confirmationToken = crypto.randomUUID();
			const summary = `Reassign presentation "${presentation.title as string}" (${body.presentationId}) to ${target.email}`;
			const action = adminStore.prepareAction({
				type: body.type,
				params: {
					presentationId: body.presentationId,
					targetUserId: target.id,
					targetEmail: target.email,
				},
				summary,
				adminUserId: admin.userId,
				adminEmail: admin.email,
				token: confirmationToken,
			});

			set.status = 201;
			return {
				id: action.id,
				type: action.type,
				summary: action.summary,
				expiresAt: action.expiresAt,
				// Shown once — the admin echoes it back to confirm.
				confirmationToken,
			};
		},
		{
			body: PrepareActionSchema,
			detail: {
				tags: ["Admin"],
				summary: "Prepare an admin action",
				description:
					"Validates a privileged action, resolves its target, and returns a one-time `confirmationToken` (10-minute TTL) plus a human-readable summary. Nothing is mutated until the action is confirmed. Requires an admin cookie session (401 without a session, 403 when not an admin).",
			},
		},
	)

	// ── Confirm (execute) an action ────────────────────────
	.post(
		"/actions/:id/confirm",
		async ({ params, body, request, set }) => {
			const admin = await requireAdmin(request);
			if (admin instanceof Response) return admin;

			const result = adminStore.confirmAction({
				id: params.id,
				token: body.confirmationToken,
				adminUserId: admin.userId,
				adminEmail: admin.email,
			});

			switch (result.kind) {
				case "not-found":
					set.status = 404;
					return { error: "Action not found" };
				case "invalid-token":
					set.status = 400;
					return { error: "Invalid confirmation token" };
				case "forbidden":
					set.status = 403;
					return { error: "This action was prepared by a different admin" };
				case "expired":
					set.status = 410;
					return { error: "Confirmation token expired" };
				case "already-final":
					set.status = 409;
					return { error: `Action already ${result.status}` };
				case "ok":
					break;
			}

			// Execute the now-confirmed action. Only reassign-presentation exists.
			const { presentationId, targetUserId } = result.action.params as {
				presentationId: string;
				targetUserId: string;
			};
			const updated = await assignOwner(presentationId, targetUserId);
			if (!updated) {
				adminStore.markFailed(
					result.action.id,
					"Presentation vanished before the reassignment ran",
				);
				set.status = 404;
				return { error: "Presentation not found" };
			}

			return { ok: true, action: result.action };
		},
		{
			body: z.object({ confirmationToken: z.string().min(1) }),
			detail: {
				tags: ["Admin"],
				summary: "Confirm and execute an admin action",
				description:
					"Executes a previously prepared action by echoing its `confirmationToken`. Bound to the same admin who prepared it and only while still pending and unexpired: 400 invalid token, 403 different admin, 404 unknown action / vanished target, 409 already finalized, 410 expired.",
			},
		},
	)

	// ── Admin audit log ────────────────────────────────────
	.get(
		"/events",
		async ({ request, set }) => {
			const admin = await requireAdmin(request);
			if (admin instanceof Response) return admin;
			set.headers["Cache-Control"] = "no-store";
			return adminStore.listEvents();
		},
		{
			detail: {
				tags: ["Admin"],
				summary: "Read the admin audit log",
				description:
					"Returns the append-only admin event log (newest first): every requested / executed / rejected / failed / expired step, who did it, and its detail. Requires an admin cookie session.",
			},
		},
	);

/**
 * The administrators' read of the feedback database (REQ185) over a given
 * store, or `null` for a deployment with both feedback channels off. While
 * either is on both channels are read, so answers sent while a channel was on
 * stay readable, and the participant channel is readable on a deployment that
 * runs only the prompt after a session (REQ186). A factory
 * for the reason the feedback routes are one: the tests read both postures
 * over their own store. It is the only route that reads the feedback database.
 */
export function createAdminFeedbackRoutes(
	feedback: FeedbackStore | null = defaultFeedbackStore,
) {
	return new Elysia({ prefix: "/api/admin", name: "admin-feedback" })
		.get(
			"/feedback",
			({ query, set }) => {
				set.headers["Cache-Control"] = "no-store";
				// Both channels off is the answer each write gives: nothing is
				// collected, and no database is opened to say there is nothing in it.
				if (!feedback) {
					return status(404, {
						error: "Feedback is not collected on this server",
					});
				}

				const pageRequest = {
					cursor: query.cursor ?? null,
					limit: FEEDBACK_PAGE_SIZE,
				};
				let page: AdminFeedbackPage;
				if (query.channel === "user") {
					const listed = feedback.listUserFeedback(pageRequest);
					if (!listed) return status(400, { error: "Unknown cursor" });
					page = {
						channel: "user",
						...feedback.summarize("user"),
						nextCursor: listed.nextCursor,
						// Field by field, so the account id never leaves this handler.
						entries: listed.entries.map((entry) => ({
							id: entry.id,
							rating: entry.rating,
							comment: entry.comment,
							surface: entry.surface,
							language: entry.language,
							createdOn: entry.createdOn,
							contact: resolveFeedbackContact(entry.contactAccountId),
						})),
					};
				} else {
					const listed = feedback.listParticipantFeedback(pageRequest);
					if (!listed) return status(400, { error: "Unknown cursor" });
					page = {
						channel: "participant",
						...feedback.summarize("participant"),
						nextCursor: listed.nextCursor,
						entries: listed.entries,
					};
				}
				return page;
			},
			{
				// The admin gate runs before the query is validated, so a caller who
				// may not read feedback learns nothing from it — not even that the
				// channel it asked for is malformed.
				transform: async ({ request }) => {
					const admin = await resolveAdmin(request);
					if ("error" in admin) {
						throw status(admin.status, { error: admin.error });
					}
				},
				query: AdminFeedbackQuerySchema,
				response: {
					200: AdminFeedbackPageSchema,
					400: AdminFeedbackErrorSchema,
					401: AdminFeedbackErrorSchema,
					403: AdminFeedbackErrorSchema,
					404: AdminFeedbackErrorSchema,
				},
				detail: {
					tags: ["Admin"],
					summary: "Read the feedback sent about omul",
					description:
						"Returns one channel of the feedback database (REQ185) — `channel=user` for the app menu's form, `channel=participant` for the prompt after a session (REQ186) — with the channel's `total`, its `ratingCounts` for 1 to 5, its `unratedCount` (comment only), and fifty `entries`, newest first. Pass the answer's `nextCursor` as `cursor` for the next page; it is `null` on the last. A `user` entry's `contact` is resolved when it is read and never stored: `null` when the sender did not ask to be contacted, `{ status: \"email\", email }` with the account's current address, or `{ status: \"deleted\" }` once the account is gone. Requires an admin cookie session (`401` without a session, `403` when not an admin); then `404` while both channels are off — `OMUL_FEEDBACK_ENABLED` is not `true` and `OMUL_FEEDBACK_PROMPT_PERCENT` is unset — `400` for a cursor that names no entry of the channel, and `422` for any other channel.",
				},
			},
		);
}

/** The feedback read the server mounts, over the environment's store. */
export const adminFeedbackRoutes = createAdminFeedbackRoutes();
