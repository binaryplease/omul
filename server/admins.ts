/**
 * Admin allowlist — supplied by the deployment, never compiled in (REQ164).
 *
 * An admin is a signed-in Better Auth account whose login email is on the list
 * this deployment puts in `OMUL_ADMIN_EMAILS`. There is still no role column
 * and no self-service grant — that posture is unchanged and deliberate. What
 * changed is where the list lives: naming an administrator is configuration an
 * operator supplies, not a source edit, a rebuild and a redeploy of everyone
 * else's image.
 *
 * **Unset means nobody, and that is the safe direction**. The
 * allowlist ships empty, so an operator who has named no one runs an admin
 * surface with no one on it — `/api/admin/*` answers `403` to every account,
 * including theirs — rather than inheriting whichever administrators the image
 * happened to be built with. Absent configuration is not fatal here, unlike the
 * auth signing secret (`server/auth-secret.ts`, REQ171): an omul with no
 * administrators is a complete product, because the admin surface is an operator
 * convenience and nothing a presenter or participant does goes through it, so
 * refusing to boot would break every deployment that never wanted one. It says
 * which posture it is on every boot instead ({@link adminAllowlistStartupReport}).
 *
 * The variable is read once, when this module is first imported, so every
 * request is judged against the allowlist the process started with. Emails are
 * compared case-insensitively after trimming. Kept tiny and dependency-free so
 * it can be imported by both the route layer and tests.
 */

/** The variable a deployment names its administrators in. */
export const ADMIN_EMAILS_VAR = "OMUL_ADMIN_EMAILS";

/**
 * Read `OMUL_ADMIN_EMAILS` and reduce it to canonical addresses — trimmed,
 * lower-cased, de-duplicated, in the order they were written.
 *
 * Every way of supplying nothing — unset, blank, whitespace, a line of commas —
 * lands on `[]`, which is the fail-closed default: an operator's typo names no
 * administrator rather than some other list.
 */
export function resolveAdminEmails(): readonly string[] {
	const configured = process.env[ADMIN_EMAILS_VAR] ?? "";
	const supplied = configured
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0);
	return [...new Set(supplied)];
}

/** The admin emails, exposed for diagnostics/tests (not a security boundary). */
export const adminEmails: readonly string[] = resolveAdminEmails();

const ADMIN_EMAIL_SET = new Set(adminEmails);

/** Whether `email` belongs to an admin. Null/blank/unknown → false. */
export function isAdminEmail(email: string | null | undefined): boolean {
	if (!email) return false;
	return ADMIN_EMAIL_SET.has(email.trim().toLowerCase());
}

/**
 * What the admin surface amounts to in *this* deployment, said on every boot.
 *
 * For the reason the rate-limit and discovery reports exist: "nobody is an
 * administrator" is invisible from outside — it looks exactly like a signed-in
 * operator who mistyped their own address — and the difference is only knowable
 * in here. An operator who upgrades into this change and never sets the variable
 * reads it in the container log rather than discovering it at a `403`.
 */
export function adminAllowlistStartupReport(): string[] {
	if (adminEmails.length === 0) {
		return [
			`[admin] No administrators: ${ADMIN_EMAILS_VAR} is unset, so /api/admin/* answers 403 to every account.`,
			`[admin] Set it to a comma-separated list of account emails to name some. Correct as it stands for a deployment that wants no admin surface.`,
		];
	}
	return [
		`[admin] ${adminEmails.length} administrator(s) from ${ADMIN_EMAILS_VAR}: ${adminEmails.join(", ")}.`,
	];
}
