// Better Auth browser client — the counterpart to server/accounts.ts.
//
// The server mounts Better Auth at `/api/auth` (its own default base path) on
// the same origin that serves this app, so the client needs no `baseURL`: it
// talks to the current origin, which is the app's own host in prod and the Vite
// dev server (proxied to Elysia) in dev. The apiKey client plugin adds the
// `authClient.apiKey.*` methods used by the API-key manager.

import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	plugins: [apiKeyClient()],
});

// Re-export the handful of methods the UI uses, so components import from one
// place rather than reaching into the client object everywhere.
// `requestPasswordReset` emails a reset link (server sends it via Brevo);
// `resetPassword` consumes the one-time token from that link to set a new
// password. `sendVerificationEmail` (re)sends the email-verification link to an
// address; the link itself is a GET that verifies server-side and redirects
// back, so there is no client-side `verifyEmail` call. `changeEmail` starts a
// signed-in user's email change — the server emails a confirmation link to the
// current address, then a verification link to the new one (see
// server/accounts.ts) — so this call only kicks the flow off. `deleteUser`
// permanently deletes the signed-in account: it takes the account `password`
// (verified server-side) before the user is removed.
export const {
	useSession,
	signIn,
	signUp,
	signOut,
	requestPasswordReset,
	resetPassword,
	sendVerificationEmail,
	changeEmail,
	deleteUser,
} = authClient;

// The signed-in user's shape, derived from the client session so the UI never
// keeps a parallel type that could drift (ADR-0013).
export type SessionUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"];
