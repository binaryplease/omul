/**
 * The email-change templates — the two mails in Better Auth's change-email
 * chain, both built on the shared {@link ActionLinkEmail} layout (ADR-0027):
 *
 *   1. `changeEmailConfirmationEmail` — sent to the account's *current* address
 *      when a signed-in, verified user asks to change their email. Approving the
 *      link here is what authorises the switch.
 *   2. `changeEmailVerifyEmail` — sent to the *new* address (after the
 *      confirmation above is approved, or straight away for an unverified
 *      account) to prove control of it before the change takes effect.
 *
 * Both are kept distinct from the sign-up verification mail (`verification.tsx`)
 * so the copy is accurate for an email *change* rather than a first-time welcome.
 */

import type { ReactElement } from "react";
import { ActionLinkEmail } from "./action-link";

/** Step 1: confirmation sent to the current address to authorise the change. */
export function changeEmailConfirmationEmail(
	confirmUrl: string,
	newEmail: string,
): ReactElement {
	return (
		<ActionLinkEmail
			preheader="Approve the email address change on your omul account."
			eyebrow="Account security"
			heading="Confirm your email change"
			lead={`We received a request to change your omul account email to ${newEmail}. Approve it below — we'll then email ${newEmail} to verify the new address.`}
			buttonLabel="Approve email change"
			url={confirmUrl}
			footer="If you didn't request this, you can safely ignore this email — your email address will stay unchanged."
		/>
	);
}

/** Step 2: verification sent to the new address to prove control before the switch. */
export function changeEmailVerifyEmail(
	verifyUrl: string,
	newEmail: string,
): ReactElement {
	return (
		<ActionLinkEmail
			preheader="Verify your new email address to finish the change."
			eyebrow="Account security"
			heading="Verify your new email address"
			lead={`Confirm ${newEmail} is your new omul account email. Verifying it completes the change you requested — your account email switches to this address.`}
			buttonLabel="Verify new email"
			url={verifyUrl}
			footer="If you didn't request this change, you can safely ignore this email — nothing changes without this confirmation."
		/>
	);
}

/** Sample renders for the dev preview gallery (see scripts/email-preview.ts). */
export const changeEmailConfirmationPreview = changeEmailConfirmationEmail(
	"https://omul.example/api/auth/verify-email?token=preview-change-confirm-token",
	"new-address@example.com",
);

export const changeEmailVerifyPreview = changeEmailVerifyEmail(
	"https://omul.example/api/auth/verify-email?token=preview-change-verify-token",
	"new-address@example.com",
);
