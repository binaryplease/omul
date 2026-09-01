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
 * Admins are a deployment-supplied email allowlist (server/admins.ts, REQ164),
 * empty unless `OMUL_ADMIN_EMAILS` names someone — so an instance nobody has
 * been named on refuses every route here, which is the safe posture rather than
 * a broken one. The gate is a **cookie session only** (a privileged operator at
 * a browser), never a personal API key: 401 when not signed in, 403 when signed
 * in but not an admin.
 */

import { Elysia } from "elysia";
import { z } from "zod";
import { findUserByEmail, resolveSessionAccount } from "../accounts";
import { adminStore } from "../admin-events";
import { isAdminEmail } from "../admins";
import { assignOwner, getPresentation } from "../services/presentations";

/** A JSON error Response with the given status. */
function jsonError(status: number, error: string): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Resolve the admin behind a request, or a Response to short-circuit with.
 * 401 when there is no cookie session; 403 when the session's email is not on
 * the allowlist. API keys are deliberately not honoured here.
 */
async function requireAdmin(
	request: Request,
): Promise<{ userId: string; email: string } | Response> {
	const account = await resolveSessionAccount(request.headers);
	if (!account) return jsonError(401, "Sign in to use the admin surface");
	if (!isAdminEmail(account.email)) return jsonError(403, "Not an admin");
	return account;
}

// The action catalog. Only `reassign-presentation` exists today; new privileged
// actions slot in here with their own params schema and executor.
const PrepareActionSchema = z.object({
	type: z.literal("reassign-presentation"),
	presentationId: z.string().min(1),
	targetEmail: z.string().email(),
});

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
