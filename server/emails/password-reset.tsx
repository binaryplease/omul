/**
 * The password-reset email element. `resetUrl` is the Better Auth callback link
 * (it lands the user back on the app with a one-time `?token=`). Copy lives here
 * so the sent mail and the dev preview render from the exact same source.
 */

import type { ReactElement } from "react";
import { ActionLinkEmail } from "./action-link";

export function passwordResetEmail(resetUrl: string): ReactElement {
	return (
		<ActionLinkEmail
			preheader="Choose a new password for your omul account."
			eyebrow="Account security"
			heading="Reset your omul password"
			lead="You (or someone using your email) asked to reset your omul password. Click the button below to choose a new one."
			buttonLabel="Choose a new password"
			url={resetUrl}
			footer="If you didn't request this, you can safely ignore this email — your password will stay unchanged."
		/>
	);
}

/** Sample render for the dev preview gallery (see scripts/email-preview.ts). */
export const passwordResetPreview = passwordResetEmail(
	"https://omul.example/app?mode=reset-password&token=preview-reset-token",
);
