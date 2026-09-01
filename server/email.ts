/**
 * Transactional email via Brevo's v3 HTTP API.
 *
 * Brevo is the org's transactional-mail provider; we talk to it over plain HTTPS
 * (`POST https://api.brevo.com/v3/smtp/email`) rather than SMTP so the single Bun
 * binary needs no mail-transport dependency. Built as a factory function per
 * ADR-0007 — `createEmailer()` closes over the resolved sender identity and key
 * and returns a small `{ enabled, sendEmail }` surface.
 *
 * Two safety gates decide whether a message actually goes out:
 *   1. `SEND_EMAILS` must be exactly `"true"` (the master switch).
 *   2. `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` must be set.
 * When either is missing the emailer is **disabled**: instead of failing, it logs
 * the message it *would* have sent (including the body) so flows like password
 * reset stay fully testable in local dev without a Brevo account — the reset URL
 * shows up in the server log.
 *
 * Message templating is kept as pure builder functions (ADR-0010) separate from
 * the transport. The HTML bodies are authored as React Email components under
 * `server/emails/` (composed, inline-styled, email-client-safe markup) and
 * rendered here; the hand-authored plain-text parts stay alongside them. Because
 * the builders and the dev preview server render the same components, what you
 * preview is what actually sends.
 */

import { render } from "@react-email/render";
import { z } from "zod";
import {
	changeEmailConfirmationEmail,
	changeEmailVerifyEmail,
} from "./emails/change-email";
import { passwordResetEmail } from "./emails/password-reset";
import { verificationEmail } from "./emails/verification";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

// Master switch — mail is only ever sent when this is exactly "true".
const SEND_EMAILS = process.env.SEND_EMAILS === "true";
const BREVO_API_KEY = (process.env.BREVO_API_KEY || "").trim();

// Brevo's success payload — only the message id is of interest, and even that is
// informational (we log it). `.default(null)` per ADR-0029 so a shape change on
// Brevo's side never makes a successful send read as a parse failure.
const BrevoSuccessSchema = z.object({
	messageId: z.string().nullable().default(null),
});

// Brevo's error payload, used to surface a human-readable reason on a non-2xx.
const BrevoErrorSchema = z.object({
	code: z.string().default(""),
	message: z.string().default(""),
});

/** A single outgoing message. `to`/`subject`/`*Content` are the required inputs. */
export interface EmailMessage {
	to: string;
	// Recipient display name, when known (e.g. the account's name). Optional.
	toName?: string | null;
	subject: string;
	htmlContent: string;
	textContent: string;
	// Per-message Reply-To override. When set, recipients reply to this address
	// instead of the configured `BREVO_REPLY_TO_*` default. Omit/null to fall
	// back to the environment default. The From address is always the verified
	// sender, so this only steers replies and can't be used to spoof.
	replyToEmail?: string | null;
	replyToName?: string | null;
}

/** The outcome of a send attempt — explicit about why nothing was sent. */
export interface SendResult {
	// True only when Brevo accepted the message.
	sent: boolean;
	// Brevo's message id when sent, else null (disabled, skipped, or failed).
	messageId: string | null;
	// null on success; otherwise why it wasn't sent (disabled reason or API error).
	error: string | null;
}

export interface Emailer {
	// Whether real sending is active: master switch on AND key + sender present.
	// When false, sendEmail logs instead of calling Brevo.
	readonly enabled: boolean;
	sendEmail(message: EmailMessage): Promise<SendResult>;
}

export function createEmailer(): Emailer {
	const senderEmail = (process.env.BREVO_SENDER_EMAIL || "").trim();
	const senderName = (process.env.BREVO_SENDER_NAME || "omul").trim();
	const replyToEmail = (process.env.BREVO_REPLY_TO_EMAIL || "").trim();
	const replyToName = (process.env.BREVO_REPLY_TO_NAME || "").trim();

	const enabled = SEND_EMAILS && Boolean(BREVO_API_KEY) && Boolean(senderEmail);

	// The specific reason sending is off, so the disabled-path log is actionable.
	const disabledReason = !SEND_EMAILS
		? 'SEND_EMAILS is not "true"'
		: !BREVO_API_KEY
			? "BREVO_API_KEY is unset"
			: "BREVO_SENDER_EMAIL is unset";

	async function sendEmail(message: EmailMessage): Promise<SendResult> {
		if (!enabled) {
			// Disabled: log what we would have sent so local flows still work without
			// a Brevo account (e.g. the password-reset URL appears in the server log).
			console.log(
				`[email] not sent (${disabledReason}) — would send to ${message.to}: ${message.subject}`,
			);
			console.log(`[email] text body:\n${message.textContent}`);
			return { sent: false, messageId: null, error: disabledReason };
		}

		// A per-message Reply-To overrides the configured default; otherwise fall
		// back to the environment Reply-To.
		const effectiveReplyToEmail = message.replyToEmail || replyToEmail;
		const effectiveReplyToName = message.replyToEmail
			? message.replyToName || ""
			: replyToName;

		try {
			const response = await fetch(BREVO_ENDPOINT, {
				method: "POST",
				headers: {
					"api-key": BREVO_API_KEY,
					"content-type": "application/json",
					accept: "application/json",
				},
				body: JSON.stringify({
					sender: { name: senderName, email: senderEmail },
					to: [
						message.toName
							? { email: message.to, name: message.toName }
							: { email: message.to },
					],
					...(effectiveReplyToEmail
						? {
								replyTo: effectiveReplyToName
									? { email: effectiveReplyToEmail, name: effectiveReplyToName }
									: { email: effectiveReplyToEmail },
							}
						: {}),
					subject: message.subject,
					htmlContent: message.htmlContent,
					textContent: message.textContent,
				}),
			});

			const payload = await response.json().catch(() => null);

			if (!response.ok) {
				const parsed = BrevoErrorSchema.safeParse(payload);
				const detail =
					parsed.success && parsed.data.message
						? parsed.data.message
						: `HTTP ${response.status}`;
				console.error(`[email] Brevo send to ${message.to} failed: ${detail}`);
				return { sent: false, messageId: null, error: detail };
			}

			const parsed = BrevoSuccessSchema.safeParse(payload);
			const messageId = parsed.success ? parsed.data.messageId : null;
			console.log(
				`[email] sent to ${message.to} (messageId: ${messageId ?? "unknown"})`,
			);
			return { sent: true, messageId, error: null };
		} catch (sendError) {
			const detail =
				sendError instanceof Error ? sendError.message : "unknown error";
			console.error(
				`[email] Brevo request to ${message.to} errored: ${detail}`,
			);
			return { sent: false, messageId: null, error: detail };
		}
	}

	return { enabled, sendEmail };
}

/** Process-wide emailer, configured once from the environment at import. */
export const emailer = createEmailer();

/* ── Templates (pure builders, ADR-0010) ──────────────────────────────── */

/**
 * Build the password-reset email. `resetUrl` is the Better Auth callback link
 * (it lands the user back on the app with a one-time `?token=`); we just present
 * it. The HTML is rendered from the shared React Email component; the plain-text
 * part is hand-authored. Async because React Email's `render` returns a promise.
 */
export async function buildPasswordResetEmail(resetUrl: string): Promise<{
	subject: string;
	htmlContent: string;
	textContent: string;
}> {
	const subject = "Reset your omul password";

	const textContent = [
		"You (or someone using your email) asked to reset your omul password.",
		"",
		"Open this link to choose a new password:",
		resetUrl,
		"",
		"If you didn't request this, you can safely ignore this email — your",
		"password will stay unchanged.",
		"",
		"— omul",
	].join("\n");

	const htmlContent = await render(passwordResetEmail(resetUrl));

	return { subject, htmlContent, textContent };
}

/**
 * Build the email-verification email. `verifyUrl` is the Better Auth callback
 * link (a GET that verifies the address server-side and then redirects the
 * browser back to the app); we just present it. Mirrors
 * {@link buildPasswordResetEmail} — same shared component layout, different copy.
 */
export async function buildVerificationEmail(verifyUrl: string): Promise<{
	subject: string;
	htmlContent: string;
	textContent: string;
}> {
	const subject = "Verify your omul email";

	const textContent = [
		"Welcome to omul! Confirm this is your email address to finish setting",
		"up your account.",
		"",
		"Open this link to verify your email:",
		verifyUrl,
		"",
		"If you didn't create an omul account, you can safely ignore this email.",
		"",
		"— omul",
	].join("\n");

	const htmlContent = await render(verificationEmail(verifyUrl));

	return { subject, htmlContent, textContent };
}

/**
 * Build the change-email confirmation email. Sent to the account's *current*
 * address when a verified user requests an email change: `confirmUrl` is the
 * Better Auth callback link (a GET that, when clicked, approves the change and
 * triggers a verification mail to the new address). `newEmail` is shown so the
 * recipient can see which address the change would move them to. Mirrors
 * {@link buildVerificationEmail} — same shared component layout, different copy.
 */
export async function buildChangeEmailConfirmationEmail(
	confirmUrl: string,
	newEmail: string,
): Promise<{
	subject: string;
	htmlContent: string;
	textContent: string;
}> {
	const subject = "Confirm your omul email change";

	const textContent = [
		`You (or someone using your account) asked to change your omul email to ${newEmail}.`,
		"",
		"Open this link to approve the change:",
		confirmUrl,
		"",
		`Once approved, we'll email ${newEmail} to verify the new address.`,
		"",
		"If you didn't request this, you can safely ignore this email — your email",
		"address will stay unchanged.",
		"",
		"— omul",
	].join("\n");

	const htmlContent = await render(
		changeEmailConfirmationEmail(confirmUrl, newEmail),
	);

	return { subject, htmlContent, textContent };
}

/**
 * Build the change-email *new-address* verification email. Sent to the **new**
 * address (after the confirmation above is approved, or immediately for an
 * unverified account) to prove control of it before the switch takes effect.
 * `verifyUrl` is the Better Auth callback link (a GET that, when clicked,
 * completes the change). Distinct from {@link buildVerificationEmail} — that one
 * welcomes a first-time sign-up, this one confirms an email *change* — so the
 * copy reads correctly for the context (they share the visual layout only).
 */
export async function buildChangeEmailVerifyEmail(
	verifyUrl: string,
	newEmail: string,
): Promise<{
	subject: string;
	htmlContent: string;
	textContent: string;
}> {
	const subject = "Verify your new omul email";

	const textContent = [
		`Confirm ${newEmail} is your new omul account email.`,
		"",
		"Open this link to verify the new address and finish the change:",
		verifyUrl,
		"",
		"Once verified, your account email switches to this address.",
		"",
		"If you didn't request this change, you can safely ignore this email —",
		"nothing changes without this confirmation.",
		"",
		"— omul",
	].join("\n");

	const htmlContent = await render(changeEmailVerifyEmail(verifyUrl, newEmail));

	return { subject, htmlContent, textContent };
}
