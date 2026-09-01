/**
 * Registry of every transactional email, with a representative sample render for
 * each. The dev preview server (scripts/email-preview.ts) iterates this list to
 * build its gallery, and because the samples are the same components the sender
 * renders, the preview is faithful to what actually lands in an inbox.
 */

import type { ReactElement } from "react";
import {
	changeEmailConfirmationPreview,
	changeEmailVerifyPreview,
} from "./change-email";
import { passwordResetPreview } from "./password-reset";
import { verificationPreview } from "./verification";

export interface EmailPreview {
	// URL-safe id used in the preview route (…/render/<id>).
	id: string;
	// Human-readable label for the gallery sidebar.
	label: string;
	// The subject line the real mail would carry, shown alongside the preview.
	subject: string;
	// A sample render of the template with representative data.
	element: ReactElement;
}

/** All previewable templates, in the order they appear in the gallery. */
export const emailPreviews: EmailPreview[] = [
	{
		id: "password-reset",
		label: "Password reset",
		subject: "Reset your omul password",
		element: passwordResetPreview,
	},
	{
		id: "verification",
		label: "Email verification",
		subject: "Verify your omul email",
		element: verificationPreview,
	},
	{
		id: "change-email-confirm",
		label: "Email change · confirm (old address)",
		subject: "Confirm your omul email change",
		element: changeEmailConfirmationPreview,
	},
	{
		id: "change-email-verify",
		label: "Email change · verify (new address)",
		subject: "Verify your new omul email",
		element: changeEmailVerifyPreview,
	},
];
