/**
 * Test-run preload (`bunfig.toml` → `[test] preload`).
 *
 * The integration suites drive hundreds of creates, joins and votes through
 * one loopback address inside a few seconds — exactly the shape the abuse
 * limits (REQ145, `server/rate-limit.ts`) exist to refuse. Left on, they would
 * turn every suite into a 429 the moment it got busy, so the whole test run
 * starts with them switched off, through the same documented environment
 * switch a self-hoster would use.
 *
 * `server/rate-limit.test.ts` is the exception and turns them back on for its
 * own cases, because it is the suite whose subject is the limit itself. It
 * reads the switch on every check rather than at import, so flipping it in a
 * `beforeAll`/`afterAll` pair is enough.
 *
 * The second switch is the auth signing secret (REQ171,
 * `server/auth-secret.ts`). Every suite that touches `server/accounts.ts` would
 * otherwise crash at import, because the module resolves the secret at
 * evaluation and refuses to start without one. Setting it *here* rather than in
 * `.mise.toml`'s `[env]` is deliberate: this runs in-process, at test time, so
 * no build can observe it and no bundler can bake it into a shipped artifact.
 * `server/auth-secret.test.ts` is the exception and clears it for its own cases,
 * because it is the suite whose subject is the switch itself.
 */

process.env.OMUL_RATE_LIMITS_DISABLED = "true";
process.env.OMUL_ALLOW_INSECURE_DEV_AUTH_SECRET = "true";
