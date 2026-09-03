/**
 * User accounts — Better Auth (email + password) plus per-user API keys.
 *
 * Better Auth over MongoDB (replica set) is the auth stack this project would
 * otherwise reach for. omul deliberately deviates to **bun:sqlite**: the whole
 * app is a single Bun binary whose domain data already lives in SQLite
 * (zodstore), so it is inherently single-node. Putting auth in MongoDB would
 * mean running a second storage system for an app that can never be truly
 * multi-instance anyway — exactly the "two stores for one app" cost that
 * default exists to avoid, in the other direction. Better Auth runs the same
 * library on SQLite, so we keep the single-binary model and gain nothing
 * operational from Mongo here.
 *
 * The instance is built with a factory function rather than a class, like every
 * other service module here. It exposes the standard Better Auth surface
 * (`auth.handler`, `auth.api`, `auth.options`) plus
 * two helpers this app needs: `ensureAuthSchema` (idempotent runtime migration,
 * so a fresh DB self-provisions without a separate CLI step in the single-binary
 * deploy) and `resolveUserId` (the authenticated user behind a request — cookie
 * session OR personal API key).
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { resolveAuthSecret } from "./auth-secret";
import { docstorePath } from "./store-path";
import {
	buildChangeEmailConfirmationEmail,
	buildChangeEmailVerifyEmail,
	buildPasswordResetEmail,
	buildVerificationEmail,
	emailer,
} from "./email";

// The domain data lives at DATABASE_PATH (zodstore); the auth DB is kept
// separate so Better Auth's migrations only ever touch its own tables. Defaults
// to an `auth.sqlite` sibling of the docstore file (same writable state dir),
// or `:memory:` when the docstore is ephemeral (integration tests). Override
// with OMUL_AUTH_DB.
const DATABASE_PATH = docstorePath();
const CONFIGURED_AUTH_DB = process.env.OMUL_AUTH_DB;
const AUTH_DB_PATH = CONFIGURED_AUTH_DB
	? resolve(CONFIGURED_AUTH_DB)
	: DATABASE_PATH === ":memory:"
		? ":memory:"
		: resolve(join(dirname(DATABASE_PATH), "auth.sqlite"));

// The canonical public origin. Explicit BETTER_AUTH_URL wins; otherwise derive
// it from the public host (OMUL_BASE_HOST) in prod. Left undefined in plain
// dev, where Better Auth infers it per-request (correct behind the Vite proxy).
function resolveBaseURL(): string | undefined {
	const explicit = (process.env.BETTER_AUTH_URL || "").trim();
	if (explicit) return explicit;
	const baseHost = (process.env.OMUL_BASE_HOST || "").trim().toLowerCase();
	return baseHost ? `https://${baseHost}` : undefined;
}

// Origins allowed to drive auth (CSRF/Origin check on state-changing requests).
// The app UI is the only legitimate caller: dev Vite (5173) + a directly-hit
// server (3000), plus the public host when OMUL_BASE_HOST is set. Extra
// origins can be added via OMUL_TRUSTED_ORIGINS (comma-separated).
function resolveTrustedOrigins(): string[] {
	const origins = new Set<string>([
		"http://localhost:5173",
		"http://localhost:3000",
	]);
	const baseHost = (process.env.OMUL_BASE_HOST || "").trim().toLowerCase();
	if (baseHost) origins.add(`https://${baseHost}`);
	for (const candidate of (process.env.OMUL_TRUSTED_ORIGINS || "").split(",")) {
		const trimmed = candidate.trim();
		if (trimmed) origins.add(trimmed);
	}
	return [...origins];
}

// Better Auth reuses one `emailVerification.sendVerificationEmail` hook for both
// a first-time sign-up verification and the *new-address* verification of an
// email change. They're distinguished only by the verification token's payload:
// a change-email token carries `requestType: "change-email-verification"` and the
// target address in `updateTo` (see Better Auth's createEmailVerificationToken),
// whereas a sign-up token carries neither. The token is a JWT, so we read its
// (base64url) payload segment to route the send to the right template. No
// signature check is needed here — Better Auth still verifies the token when the
// link is followed; we only peek at it to pick copy. Never throws: any decode
// failure (or a future token-format change) falls back to the sign-up template.
function changeEmailTargetFromToken(token: string): string | null {
	try {
		const payloadSegment = token.split(".")[1];
		if (!payloadSegment) return null;
		const payload = JSON.parse(
			Buffer.from(payloadSegment, "base64url").toString("utf8"),
		) as {
			requestType?: unknown;
			updateTo?: unknown;
		};
		if (
			payload.requestType === "change-email-verification" &&
			typeof payload.updateTo === "string"
		) {
			return payload.updateTo;
		}
		return null;
	} catch {
		return null;
	}
}

// A handle to the very Database instance Better Auth writes through, captured in
// `createAuth`. Read helpers (`findUserByEmail`) query the SAME connection rather
// than opening a second one, so they work even when AUTH_DB_PATH is `:memory:`
// (a second `:memory:` connection would be a separate, empty database).
let authDatabase: Database | null = null;

export function createAuth() {
	if (AUTH_DB_PATH !== ":memory:") {
		mkdirSync(dirname(AUTH_DB_PATH), { recursive: true });
	}
	const database = new Database(AUTH_DB_PATH, { create: true });
	authDatabase = database;
	// WAL so a read (session lookup on every gated request) never blocks a write
	// (sign-up / key creation). Not applicable to an in-memory database.
	if (AUTH_DB_PATH !== ":memory:") {
		database.exec("PRAGMA journal_mode = WAL");
		database.exec("PRAGMA busy_timeout = 5000");
	}

	return betterAuth({
		database,
		// Throws when the operator supplied no usable secret and this process was
		// not explicitly told it may use the development one, which makes it a
		// boot crash: this module is imported from `server/index.ts`, so the
		// process never reaches `listen`. See `server/auth-secret.ts`.
		secret: resolveAuthSecret(),
		// Mount under /api/* alongside the rest of the HTTP surface. This
		// matches the Better Auth client default, so the client needs no path config.
		basePath: "/api/auth",
		// Explicit base URL when provided (prod behind Caddy); otherwise Better Auth
		// infers it from the request, which is correct for the dev Vite proxy.
		baseURL: resolveBaseURL(),
		trustedOrigins: resolveTrustedOrigins(),
		emailAndPassword: {
			// The requested method: self-serve email + password sign-up and sign-in.
			// autoSignIn (Better Auth default) issues a session right after sign-up.
			enabled: true,
			// Password reset over email (Brevo). Better Auth mints a one-time token,
			// builds the callback `url` (which lands the user back on the app with
			// `?token=…`), and hands both here; we email the link. The send is awaited
			// so a hard Brevo failure surfaces to the caller rather than silently
			// dropping the reset. With email sending disabled (local dev) the emailer
			// logs the URL instead — see server/email.ts.
			sendResetPassword: async ({ user, url }) => {
				const { subject, htmlContent, textContent } =
					await buildPasswordResetEmail(url);
				await emailer.sendEmail({
					to: user.email,
					toName: user.name,
					subject,
					htmlContent,
					textContent,
				});
			},
			// One hour to use the reset link (Better Auth default), stated explicitly.
			resetPasswordTokenExpiresIn: 60 * 60,
			// Soft email verification, NOT a hard gate. `requireEmailVerification` is
			// deliberately left off (its default): a fresh sign-up is still signed in
			// immediately (autoSignIn) and can use every feature — we send a
			// verification email and nudge with a UI banner instead of locking the
			// account out until it's confirmed. Hard-gating sign-in would make local
			// dev (where SEND_EMAILS is off and the link only appears in the server
			// log) painful and could strand a user who mistypes their address. Flip
			// this to `true` if a future feature needs a verified address.
			requireEmailVerification: false,
		},
		// Email verification over the same Brevo emailer as password reset. Better
		// Auth mints a one-time token, builds the callback `url` (a GET that verifies
		// the address server-side then redirects the browser back to the app's
		// callbackURL), and hands both here; we email the link. The send is awaited so
		// a hard Brevo failure surfaces rather than silently dropping. With sending
		// disabled (local dev) the emailer logs the URL instead — see server/email.ts.
		emailVerification: {
			// Email the verification link automatically on every new sign-up.
			sendOnSignUp: true,
			// Once the link is clicked, sign the user in on the verifying device — the
			// signup may have happened in a different tab/device, and this lands them
			// straight into a usable, verified session.
			autoSignInAfterVerification: true,
			// One hour to use the verification link, matching the reset-token window.
			expiresIn: 60 * 60,
			sendVerificationEmail: async ({ user, url, token }) => {
				// This one hook serves both sign-up verification and the change-email
				// flow's new-address verification; the token tells them apart so each
				// gets copy written for its context. In the change case `user.email` is
				// already the new address (Better Auth passes it through), matching the
				// decoded target — we send there either way.
				const changeTarget = changeEmailTargetFromToken(token);
				const { subject, htmlContent, textContent } = changeTarget
					? await buildChangeEmailVerifyEmail(url, changeTarget)
					: await buildVerificationEmail(url);
				await emailer.sendEmail({
					to: user.email,
					toName: user.name,
					subject,
					htmlContent,
					textContent,
				});
			},
		},
		user: {
			// Let a signed-in user change their account email. Better Auth guards this
			// as a double opt-in when the current address is verified: it emails a
			// *confirmation* link to the CURRENT address (so only whoever controls the
			// existing inbox can start a change), and only once that's approved does it
			// email a *verification* link to the NEW address to prove control of it
			// before the switch takes effect. An unverified account skips straight to
			// verifying the new address. The confirmation runs through this app's
			// dedicated template; the new-address verification flows through
			// `emailVerification.sendVerificationEmail` above (routed to
			// `buildChangeEmailVerifyEmail` by the token). The send is awaited so a
			// hard Brevo failure surfaces rather than silently dropping.
			changeEmail: {
				enabled: true,
				sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
					const { subject, htmlContent, textContent } =
						await buildChangeEmailConfirmationEmail(url, newEmail);
					await emailer.sendEmail({
						to: user.email,
						toName: user.name,
						subject,
						htmlContent,
						textContent,
					});
				},
			},
			// Self-serve account deletion. `enabled: true` mounts `POST
			// /api/auth/delete-user`; with email+password the client must pass the
			// account **password**, which Better Auth verifies before proceeding (the
			// UI additionally requires typing a confirmation phrase as an accident
			// guard). No `sendDeleteAccountVerification` is set, so a password-verified
			// request deletes immediately rather than emailing a second confirmation.
			deleteUser: {
				enabled: true,
			},
		},
		// Per-user API keys: a logged-in user mints a key and presents it as the
		// `x-api-key` header to authenticate programmatic requests without a cookie
		// session. `enableSessionForAPIKeys` (off by default) is what makes
		// getSession honour that header, so resolveUserId covers both a cookie
		// session and an API key with one call.
		//
		// `rateLimit.enabled: false` disables the plugin's built-in per-key request
		// cap (a default 10 requests / rolling 24h). Once exceeded, every subsequent
		// getSession throws TOO_MANY_REQUESTS — which resolveUserId swallows to
		// `null`, so an over-budget key silently degrades to a misleading 401 rather
		// than a 429. These are *personal* programmatic keys (CLIs, daemons); a
		// 10/day cap is nonsensical for that and the sliding window never resets
		// while a daemon keeps polling. Turning it off here also unblocks keys
		// already minted with the cap baked in.
		plugins: [
			apiKey({ enableSessionForAPIKeys: true, rateLimit: { enabled: false } }),
		],
	});
}

export const auth = createAuth();

export type AuthInstance = typeof auth;

/**
 * Create/upgrade the Better Auth tables (user, session, account, verification,
 * apikey) to match the current config. Idempotent — safe to run on every boot.
 * This is what the `@better-auth/cli migrate` command does under the hood; doing
 * it in-process keeps the single-binary deploy free of a separate migrate step.
 */
export async function ensureAuthSchema(): Promise<void> {
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
}

// One getSession attempt with the given headers, mapping every failure mode
// (invalid key, malformed/expired token, plugin error) to "not signed in" —
// never crash the route that called us.
async function sessionUserId(headers: Headers): Promise<string | null> {
	try {
		const session = await auth.api.getSession({ headers });
		return session?.user?.id ?? null;
	} catch {
		return null;
	}
}

/**
 * Resolve the authenticated user id behind a request, or `null` when there is
 * no valid session. Honours both a Better Auth cookie session and a personal
 * API key (the apiKey plugin reads the `x-api-key` header), so a single call
 * covers the browser UI and key-based programmatic clients alike.
 *
 * omul assigns no account meaning to the `Authorization` header (agents keep
 * stuffing arbitrary keys into it), so it is stripped before Better Auth ever
 * sees the headers — a wrong/foreign Bearer value can never break an otherwise
 * valid `x-api-key` or cookie session. As a defensive fallback, when NO
 * `x-api-key` is present and the request carries `Authorization: Bearer
 * <token>`, the token is retried in the `x-api-key` slot: a personal API key
 * sent in the Bearer slot by mistake still resolves its account instead of
 * silently downgrading the request to anonymous.
 */
export async function resolveUserId(headers: Headers): Promise<string | null> {
	const primary = new Headers(headers);
	primary.delete("authorization");
	const direct = await sessionUserId(primary);
	if (direct) return direct;

	// The defensive Bearer fallback. Deliberately skipped when an `x-api-key`
	// is present — that slot is authoritative, and an invalid value there must
	// not be rescued by whatever happens to sit in `Authorization`.
	if (!headers.has("x-api-key")) {
		const authHeader = headers.get("authorization") ?? "";
		if (authHeader.startsWith("Bearer ")) {
			const bearerToken = authHeader.slice(7).trim();
			if (bearerToken) {
				const fallback = new Headers(headers);
				fallback.delete("authorization");
				fallback.set("x-api-key", bearerToken);
				return sessionUserId(fallback);
			}
		}
	}
	return null;
}

/**
 * Whether a request presents a personal API-key credential rather than a cookie
 * session. True when the `x-api-key` header is set, or — mirroring
 * `resolveUserId`'s defensive fallback — a token rides in the `Authorization:
 * Bearer` slot with no `x-api-key`. A browser (cookie-session) request carries
 * neither, so this cleanly separates programmatic key callers from the web UI.
 *
 * It reports only the *shape* of the credential, not that it resolved an
 * account: pair it with a non-null `resolveUserId` before acting.
 */
export function isApiKeyRequest(headers: Headers): boolean {
	if (headers.has("x-api-key")) return true;
	return (headers.get("authorization") ?? "").startsWith("Bearer ");
}

/** A registered account resolved by email — its id plus contact identity. */
export interface UserAccount {
	id: string;
	email: string;
	name: string | null;
}

/**
 * Resolve a registered account (id + contact) by its login email, or `null` when
 * no such user exists. Used by the admin surface to turn a target email into the
 * user id a presentation is reassigned to. Reads Better Auth's own `user` table
 * through the same connection Better Auth writes on (a deliberate, single-node,
 * same-process coupling); `COLLATE NOCASE` matches regardless of casing. Never
 * crashes the caller on a malformed input or a not-yet-migrated table.
 */
export function findUserByEmail(email: string): UserAccount | null {
	const normalized = email.trim();
	if (!normalized || !authDatabase) return null;
	try {
		const row = authDatabase
			.query<
				{ id: string; email: string; name: string | null },
				{ $email: string }
			>("SELECT id, email, name FROM user WHERE email = $email COLLATE NOCASE")
			.get({ $email: normalized });
		if (!row || !row.id || !row.email) return null;
		return { id: row.id, email: row.email, name: row.name ?? null };
	} catch {
		return null;
	}
}

/**
 * Resolve a registered account by its id, or `null` when no such user exists.
 * The reverse of {@link findUserByEmail} and read on the same connection, for
 * the one place a server-side account id has to be turned back into a contact:
 * a deck's collaborator list (REQ075), which stores the id and shows the email.
 *
 * The direction matters. An id is never accepted *from* a caller — it is never
 * sent to one either — so this only ever resolves an id the server itself wrote.
 * Never crashes the caller on a not-yet-migrated table or a stale id.
 */
export function findUserById(userId: string): UserAccount | null {
	const normalized = userId.trim();
	if (!normalized || !authDatabase) return null;
	try {
		const row = authDatabase
			.query<
				{ id: string; email: string; name: string | null },
				{ $id: string }
			>("SELECT id, email, name FROM user WHERE id = $id")
			.get({ $id: normalized });
		if (!row || !row.id || !row.email) return null;
		return { id: row.id, email: row.email, name: row.name ?? null };
	} catch {
		return null;
	}
}

/**
 * Resolve the signed-in account behind a request as `{ userId, email }`, or
 * `null` when there is no cookie session. Unlike {@link resolveUserId} this does
 * NOT honour API keys — the admin surface is deliberately a **cookie-session**
 * gate (a privileged operator at a browser), not something a programmatic key
 * should ever unlock. Returns the login email so the caller can check it against
 * the admin allowlist. Never throws.
 */
export async function resolveSessionAccount(
	headers: Headers,
): Promise<{ userId: string; email: string } | null> {
	try {
		// Strip Authorization/x-api-key so only a genuine cookie session resolves.
		const cookieOnly = new Headers(headers);
		cookieOnly.delete("authorization");
		cookieOnly.delete("x-api-key");
		const session = await auth.api.getSession({ headers: cookieOnly });
		if (!session?.user?.id || !session.user.email) return null;
		return { userId: session.user.id, email: session.user.email };
	} catch {
		return null;
	}
}
