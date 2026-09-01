/**
 * The email-verification element. `verifyUrl` is the Better Auth callback link
 * (a GET that verifies the address server-side then redirects back to the app).
 * Shares the {@link ActionLinkEmail} layout with the reset mail so the two stay
 * visually consistent; only the copy differs.
 */

import type { ReactElement } from "react";
import { ActionLinkEmail } from "./action-link";

export function verificationEmail(verifyUrl: string): ReactElement {
	return (
		<ActionLinkEmail
			preheader="Confirm your email to finish setting up your omul account."
			eyebrow="Welcome to omul"
			heading="Verify your omul email"
			lead="Welcome to omul! Confirm this is your email address to finish setting up your account."
			buttonLabel="Verify email"
			url={verifyUrl}
			footer="If you didn't create an omul account, you can safely ignore this email."
		/>
	);
}

/** Sample render for the dev preview gallery (see scripts/email-preview.ts). */
export const verificationPreview = verificationEmail(
	"https://omul.example/api/auth/verify-email?token=preview-verify-token",
);
