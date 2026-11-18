/**
 * What this instance lets a visitor do, over HTTP (REQ251, REQ252).
 *
 * One public, read-only route. The client reads it once per page load to draw
 * a closed action — "Create account" while sign-up is closed — disabled with
 * its reason. What it reports is a fact about the deployment, not about the
 * caller, so it asks for no credential. The server enforces each switch on its
 * own routes; this route only reports them.
 *
 * Built by a factory that takes the access the server resolved at boot
 * (`server/index.ts`), so the route and the Better Auth configuration describe
 * the same reading of the environment.
 */

import { Elysia } from "elysia";
import { SIGNUP_DISABLED_ENV } from "../instance-access";
import { type InstanceAccess, InstanceAccessSchema } from "../schemas";

export function createInstanceAccessRoutes(access: InstanceAccess) {
	return new Elysia({ prefix: "/api", name: "instance-access" }).get(
		"/instance-access",
		() => access,
		{
			response: InstanceAccessSchema,
			detail: {
				tags: ["Discovery"],
				summary: "What this instance lets a visitor do",
				description: `Whether a visitor may open an account (\`signUpOpen\`, REQ251) and whether a visitor without an account may create a presentation (\`guestCreationOpen\`, REQ252). \`signUpOpen\` is \`false\` while the operator set \`${SIGNUP_DISABLED_ENV}=true\`; then \`POST /api/auth/sign-up/email\` answers \`400\` with code \`EMAIL_PASSWORD_SIGN_UP_DISABLED\`, and existing accounts still sign in. \`guestCreationOpen\` is \`true\` until REQ252's switch exists. Both fields are always present. Public and read-only; read once at boot.`,
			},
		},
	);
}
