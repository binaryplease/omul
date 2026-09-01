import {
	AlertTriangle,
	AtSign,
	Check,
	Copy,
	Key,
	Lock,
	LogIn,
	LogOut,
	Mail,
	MailCheck,
	Plus,
	Send,
	Trash2,
	UserCircle,
	UserCog,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	authClient,
	changeEmail,
	deleteUser,
	requestPasswordReset,
	resetPassword,
	sendVerificationEmail,
	signIn,
	signOut,
	signUp,
	useSession,
} from "./auth-client";
import { BRAND_NAME } from "./components/BrandMark";
import { Modal } from "./components/ui/Modal";
import { PENDING_EMAIL_CHANGE_KEY } from "./storage";

// Shared input styling, matching the field treatment elsewhere in the app.
const FIELD_CLASS =
	"w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-accent";

// Full-width primary/secondary action buttons (the app's `.btn-primary` /
// `.btn-secondary` don't set a flex layout, so compose it here for the icon+label).
const BTN_PRIMARY =
	"btn-primary w-full inline-flex items-center justify-center gap-2";
const BTN_SECONDARY =
	"btn-secondary w-full inline-flex items-center justify-center gap-2";
// The muted header icon-button treatment, matching HomePage's card actions.
const ICON_BTN =
	"text-text-dim hover:text-accent transition-colors p-2 rounded-lg";

// The URL query key that marks an email-verification landing. Better Auth's
// verification link is a GET that confirms the address server-side and then
// redirects the browser to this `callbackURL`; we tag it with `mode=verify-email`
// (mirroring the password-reset `mode=reset-password`) so a stray param elsewhere
// doesn't trip the landing, and read `?error=` to tell success from a stale link.
const VERIFY_MODE = "verify-email";

// The URL query key marking an email-change landing. Better Auth's change-email
// flow is a two-step chain — approve from the current address, then verify the
// new one — and both steps redirect the browser back to this `callbackURL`. We
// tag it `mode=change-email` (mirroring reset/verify) so a stray param doesn't
// trip the landing, and read `?error=` to tell success from a stale link.
const CHANGE_EMAIL_MODE = "change-email";

// Where the in-flight change's target address is stashed so the landing can tell
// "confirmed, now verify the new address" (session email unchanged) from "all
// done" (session email now equals the pending one). Same-origin localStorage
// survives the mail-link round-trips; cleared once the change completes. The
// key itself lives in `src/storage.ts` with every other key this browser holds
// and the retired spelling it was renamed from (REQ175).

// The exact phrase a user must type to confirm account deletion. A fixed
// intent-stating phrase (not the account email) is the accident guard here:
// delete-user always targets the single signed-in account, so there's no "wrong
// target" to disambiguate — the password already proves account control — and a
// short phrase you type deliberately resists the copy-paste an on-screen email
// invites. Matched case-insensitively on the trimmed input.
const DELETE_CONFIRM_PHRASE = "delete my account";

// The absolute callbackURL handed to Better Auth for both the sign-up email and
// any later resend. Absolute (not a bare path) because the link is followed from
// the recipient's mail client, which has no notion of the app's origin.
function verifyCallbackUrl(): string {
	return `${window.location.origin}/?mode=${VERIFY_MODE}`;
}

// The absolute callbackURL for the change-email links (confirmation + new-address
// verification both land here). Absolute for the same reason as verifyCallbackUrl.
function changeEmailCallbackUrl(): string {
	return `${window.location.origin}/?mode=${CHANGE_EMAIL_MODE}`;
}

/* ── Header controls ──────────────────────────────────── */

// The account widget in the app header. Signed out: a Sign in button. Signed in:
// the user's email plus buttons for account settings, API keys, and Sign out.
// Controls are always visible; availability is conveyed by state, not by hiding.
export function AuthControls() {
	const { data, isPending } = useSession();
	const [dialog, setDialog] = useState<"auth" | "keys" | "account" | null>(
		null,
	);
	// A password-reset link from email lands back here with a one-time `?token=`
	// in the URL (or `?error=` when it's stale). When present, show the reset
	// dialog regardless of signed-in state — the gate renders nothing otherwise.
	const reset = usePasswordResetLanding();
	// An email-verification link from the sign-up mail lands back here (with
	// `?error=` only when stale). Like the reset landing it shows regardless of
	// signed-in state — autoSignInAfterVerification may have just minted a session.
	const verify = useVerificationLanding();
	// A change-email link (either the confirm-from-old-address or verify-new-address
	// step) lands back here. Shown regardless of signed-in state.
	const change = useChangeEmailLanding();

	const resetModal = reset && (
		<Modal title="Reset your password" icon={Lock} onClose={reset.dismiss}>
			<ResetPasswordForm
				token={reset.token}
				tokenError={reset.error}
				onDone={reset.dismiss}
			/>
		</Modal>
	);

	const verifyModal = verify && (
		<Modal title="Email verification" icon={MailCheck} onClose={verify.dismiss}>
			<VerificationLanding tokenError={verify.error} onDone={verify.dismiss} />
		</Modal>
	);

	const changeModal = change && (
		<Modal title="Email change" icon={AtSign} onClose={change.dismiss}>
			<ChangeEmailLanding tokenError={change.error} onDone={change.dismiss} />
		</Modal>
	);

	// All landing modals are rendered in every auth state, so a verification,
	// reset, or email-change link works whether or not a session already exists.
	const landings = (
		<>
			{resetModal}
			{verifyModal}
			{changeModal}
		</>
	);

	if (isPending) {
		return (
			<>
				<div
					className="h-9 w-24 animate-pulse rounded-lg bg-surface-raised"
					aria-hidden
				/>
				{landings}
			</>
		);
	}

	if (!data) {
		return (
			<>
				<button
					type="button"
					onClick={() => setDialog("auth")}
					className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-1.5"
				>
					<LogIn size={16} /> Sign in
				</button>
				{dialog === "auth" && (
					<Modal
						title={`Sign in to ${BRAND_NAME}`}
						icon={UserCircle}
						onClose={() => setDialog(null)}
					>
						<AuthForm onDone={() => setDialog(null)} />
					</Modal>
				)}
				{landings}
			</>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<span
				className="hidden max-w-[12rem] truncate font-mono text-xs text-text-muted sm:inline"
				title={data.user.email}
			>
				{data.user.email}
			</span>
			<button
				type="button"
				onClick={() => setDialog("account")}
				className={ICON_BTN}
				title="Account settings"
				aria-label="Account settings"
			>
				<UserCog size={18} />
			</button>
			<button
				type="button"
				onClick={() => setDialog("keys")}
				className={ICON_BTN}
				title="API keys"
				aria-label="API keys"
			>
				<Key size={18} />
			</button>
			<button
				type="button"
				onClick={() => void signOut()}
				className={ICON_BTN}
				title="Sign out"
				aria-label="Sign out"
			>
				<LogOut size={18} />
			</button>
			{dialog === "account" && (
				<Modal
					title="Account settings"
					icon={UserCog}
					onClose={() => setDialog(null)}
				>
					<AccountSettings onDone={() => setDialog(null)} />
				</Modal>
			)}
			{dialog === "keys" && (
				<Modal title="API keys" icon={Key} onClose={() => setDialog(null)}>
					<ApiKeysManager />
				</Modal>
			)}
			{landings}
		</div>
	);
}

/* ── Sign in / sign up form ───────────────────────────── */

function AuthForm({ onDone }: { onDone: () => void }) {
	const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Set once a reset email has been requested, so we show a confirmation in
	// place of the form (we always claim success to avoid leaking which emails
	// have accounts — matching Better Auth's own response).
	const [resetSent, setResetSent] = useState(false);

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			if (mode === "forgot") {
				// Server emails a reset link (via Brevo) whose callback lands back on
				// this origin with `?token=…`, which ResetPasswordForm consumes.
				const result = await requestPasswordReset({
					email,
					redirectTo: `${window.location.origin}/?mode=reset-password`,
				});
				if (result.error) {
					setError(result.error.message ?? "Could not send reset email");
					setBusy(false);
					return;
				}
				setResetSent(true);
				setBusy(false);
				return;
			}
			const result =
				mode === "signup"
					? await signUp.email({
							email,
							password,
							// split always yields at least one element
							name: name.trim() || email.split("@")[0]!,
							// The verification email Better Auth sends on sign-up redirects
							// here after the address is confirmed (see VERIFY_MODE).
							callbackURL: verifyCallbackUrl(),
						})
					: await signIn.email({ email, password });
			if (result.error) {
				setError(result.error.message ?? "Authentication failed");
				setBusy(false);
				return;
			}
			// useSession updates on its own; just close the dialog.
			onDone();
		} catch (authError) {
			setError(
				authError instanceof Error
					? authError.message
					: "Authentication failed",
			);
			setBusy(false);
		}
	};

	// After requesting a reset, replace the form with a confirmation. Worded so it
	// doesn't reveal whether the address has an account.
	if (mode === "forgot" && resetSent) {
		return (
			<div className="space-y-4">
				<div className="flex items-start gap-2 rounded-lg border border-success bg-surface p-3 font-mono text-xs leading-relaxed text-text-muted">
					<Send size={16} className="mt-0.5 shrink-0 text-success" />
					<span>
						If an account exists for <span className="text-text">{email}</span>,
						a password reset link is on its way. Check your inbox.
					</span>
				</div>
				<button
					type="button"
					onClick={() => {
						setMode("signin");
						setResetSent(false);
					}}
					className={BTN_SECONDARY}
				>
					Back to sign in
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex rounded-lg border border-border-subtle p-1 font-mono text-xs uppercase tracking-widest">
				<button
					type="button"
					onClick={() => setMode("signin")}
					className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
						mode === "signin" || mode === "forgot"
							? "bg-surface-raised text-text"
							: "text-text-dim"
					}`}
				>
					Sign in
				</button>
				<button
					type="button"
					onClick={() => setMode("signup")}
					className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
						mode === "signup" ? "bg-surface-raised text-text" : "text-text-dim"
					}`}
				>
					Create account
				</button>
			</div>

			{mode === "forgot" && (
				<p className="font-mono text-xs leading-relaxed text-text-dim">
					Enter your account email and we'll send a link to choose a new
					password.
				</p>
			)}

			<form
				className="space-y-3"
				onSubmit={(submitEvent) => {
					submitEvent.preventDefault();
					void submit();
				}}
			>
				{mode === "signup" && (
					<input
						value={name}
						disabled={busy}
						onChange={(changeEvent) => setName(changeEvent.target.value)}
						className={FIELD_CLASS}
						placeholder="Name (optional)"
						autoComplete="name"
					/>
				)}
				<input
					value={email}
					disabled={busy}
					onChange={(changeEvent) => setEmail(changeEvent.target.value)}
					className={FIELD_CLASS}
					placeholder="you@example.com"
					type="email"
					autoComplete="email"
					required
				/>
				{mode !== "forgot" && (
					<input
						value={password}
						disabled={busy}
						onChange={(changeEvent) => setPassword(changeEvent.target.value)}
						className={FIELD_CLASS}
						placeholder="Password (min 8 characters)"
						type="password"
						autoComplete={
							mode === "signup" ? "new-password" : "current-password"
						}
						minLength={8}
						required
					/>
				)}

				{error && (
					<div className="flex items-center gap-2 font-mono text-xs text-error">
						<AlertTriangle size={14} className="shrink-0" />
						<span>{error}</span>
					</div>
				)}

				<button type="submit" disabled={busy} className={BTN_PRIMARY}>
					{busy
						? "Working…"
						: mode === "signup"
							? "Create account"
							: mode === "forgot"
								? "Send reset link"
								: "Sign in"}
				</button>
			</form>

			{/* Toggle between sign-in and the forgot-password form. Always visible;
			    it just flips the form mode. */}
			{mode === "forgot" ? (
				<button
					type="button"
					onClick={() => {
						setMode("signin");
						setError(null);
					}}
					className="w-full text-center font-mono text-xs text-text-dim underline"
				>
					Back to sign in
				</button>
			) : (
				mode === "signin" && (
					<button
						type="button"
						onClick={() => {
							setMode("forgot");
							setError(null);
						}}
						className="w-full text-center font-mono text-xs text-text-dim underline"
					>
						Forgot password?
					</button>
				)
			)}
		</div>
	);
}

/* ── Password reset (from email link) ─────────────────── */

interface ResetLanding {
	// The one-time token from the reset email's callback (null when the link was
	// stale — Better Auth redirects with `?error=` instead of `?token=`).
	token: string | null;
	// A token error reported by the redirect (e.g. INVALID_TOKEN), else null.
	error: string | null;
	// Clear the reset query params from the URL and close the dialog.
	dismiss: () => void;
}

// Detect a password-reset landing in the current URL. Better Auth's reset link
// redirects here with `?token=…` (valid) or `?error=…` (stale/invalid); we keyed
// it with `mode=reset-password` via redirectTo so a stray `token`/`error` param
// elsewhere doesn't trip the dialog. Returns null when this isn't a reset land.
function usePasswordResetLanding(): ResetLanding | null {
	const [landing, setLanding] = useState<Omit<ResetLanding, "dismiss"> | null>(
		() => readResetLanding(),
	);
	// Read once on mount (the redirect is a full navigation, so query is present).
	useEffect(() => {
		setLanding(readResetLanding());
	}, []);

	if (!landing) return null;
	return {
		...landing,
		dismiss: () => {
			clearLandingParamsFromUrl();
			setLanding(null);
		},
	};
}

function readResetLanding(): Omit<ResetLanding, "dismiss"> | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	if (params.get("mode") !== "reset-password") return null;
	const token = params.get("token");
	const error = params.get("error");
	if (!token && !error) return null;
	return { token, error };
}

// Strip the landing query params (shared by the reset and verify flows — same
// `mode`/`token`/`error` keys) but keep the user on the same page, so the link
// can't be re-triggered on reload and the address bar stays clean.
function clearLandingParamsFromUrl(): void {
	if (typeof window === "undefined") return;
	const url = new URL(window.location.href);
	for (const key of ["mode", "token", "error"]) url.searchParams.delete(key);
	window.history.replaceState(
		{},
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
}

/* ── Email verification (from email link) ─────────────── */

interface VerificationLandingState {
	// A token error reported by the redirect (e.g. TOKEN_EXPIRED / INVALID_TOKEN),
	// else null. Unlike password reset there is no token to consume here — Better
	// Auth's link verifies server-side and only the error (if any) comes back.
	error: string | null;
	// Clear the verify query params from the URL and close the dialog.
	dismiss: () => void;
}

// Detect an email-verification landing in the current URL. Better Auth's link
// verifies the address server-side then redirects here with `?mode=verify-email`
// (success) or the same plus `&error=…` (stale/invalid). Returns null otherwise.
function useVerificationLanding(): VerificationLandingState | null {
	const [landing, setLanding] = useState<{ error: string | null } | null>(() =>
		readVerificationLanding(),
	);
	// Read once on mount (the redirect is a full navigation, so query is present).
	useEffect(() => {
		setLanding(readVerificationLanding());
	}, []);

	if (!landing) return null;
	return {
		error: landing.error,
		dismiss: () => {
			clearLandingParamsFromUrl();
			setLanding(null);
		},
	};
}

function readVerificationLanding(): { error: string | null } | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	if (params.get("mode") !== VERIFY_MODE) return null;
	return { error: params.get("error") };
}

// Send (or resend) the verification email to `email`, normalising the Better
// Auth client result into a plain ok/error. Shared by the landing's error path
// and the signed-in banner so the call lives in one place (ADR-0010/0026).
async function resendVerificationEmail(
	email: string,
): Promise<{ ok: boolean; error: string | null }> {
	try {
		const result = await sendVerificationEmail({
			email,
			callbackURL: verifyCallbackUrl(),
		});
		if (result.error) {
			return {
				ok: false,
				error: result.error.message ?? "Could not send verification email",
			};
		}
		return { ok: true, error: null };
	} catch (sendError) {
		return {
			ok: false,
			error:
				sendError instanceof Error
					? sendError.message
					: "Could not send verification email",
		};
	}
}

// The modal shown when a verification link lands back on the app. Success (no
// error param) is a confirmation — the session, if any, has already been minted
// by autoSignInAfterVerification. A stale/invalid link offers a resend, asking
// for the address since the user may not be signed in.
function VerificationLanding({
	tokenError,
	onDone,
}: {
	tokenError: string | null;
	onDone: () => void;
}) {
	const { data } = useSession();
	const [email, setEmail] = useState(data?.user.email ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [resent, setResent] = useState(false);

	if (!tokenError) {
		return (
			<div className="space-y-4">
				<div className="flex items-start gap-2 rounded-lg border border-success bg-surface p-3 font-mono text-xs leading-relaxed text-text-muted">
					<MailCheck size={16} className="mt-0.5 shrink-0 text-success" />
					<span>
						Your email is verified. Thanks — your {BRAND_NAME} account is all
						set.
					</span>
				</div>
				<button type="button" onClick={onDone} className={BTN_PRIMARY}>
					Continue
				</button>
			</div>
		);
	}

	if (resent) {
		return (
			<div className="space-y-4">
				<div className="flex items-start gap-2 rounded-lg border border-success bg-surface p-3 font-mono text-xs leading-relaxed text-text-muted">
					<Send size={16} className="mt-0.5 shrink-0 text-success" />
					<span>
						A fresh verification link is on its way to{" "}
						<span className="text-text">{email}</span>. Check your inbox.
					</span>
				</div>
				<button type="button" onClick={onDone} className={BTN_SECONDARY}>
					Close
				</button>
			</div>
		);
	}

	const submit = async () => {
		setBusy(true);
		setError(null);
		const result = await resendVerificationEmail(email);
		if (!result.ok) {
			setError(result.error);
			setBusy(false);
			return;
		}
		setResent(true);
		setBusy(false);
	};

	return (
		<form
			className="space-y-3"
			onSubmit={(submitEvent) => {
				submitEvent.preventDefault();
				void submit();
			}}
		>
			<div className="flex items-start gap-2 font-mono text-xs leading-relaxed text-error">
				<AlertTriangle size={16} className="mt-0.5 shrink-0" />
				<span>
					This verification link is invalid or has expired. Request a new one
					below.
				</span>
			</div>
			<input
				value={email}
				disabled={busy}
				onChange={(changeEvent) => setEmail(changeEvent.target.value)}
				className={FIELD_CLASS}
				placeholder="you@example.com"
				type="email"
				autoComplete="email"
				required
			/>
			{error && (
				<div className="flex items-center gap-2 font-mono text-xs text-error">
					<AlertTriangle size={14} className="shrink-0" />
					<span>{error}</span>
				</div>
			)}
			<button type="submit" disabled={busy} className={BTN_PRIMARY}>
				{busy ? "Working…" : "Resend verification email"}
			</button>
		</form>
	);
}

/* ── "Verify your email" banner (signed-in, unverified) ── */

// A nudge shown to a signed-in user whose email isn't verified yet. Self-
// contained: it reads the session and renders nothing for signed-out or already-
// verified users. The button (re)sends the verification link.
export function VerifyEmailBanner() {
	const { data } = useSession();
	const [busy, setBusy] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!data || data.user.emailVerified) return null;

	const email = data.user.email;
	const resend = async () => {
		setBusy(true);
		setError(null);
		const result = await resendVerificationEmail(email);
		if (!result.ok) {
			setError(result.error);
			setBusy(false);
			return;
		}
		setSent(true);
		setBusy(false);
	};

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-warning bg-surface px-4 py-3 text-left sm:flex-row sm:items-center">
			<Mail size={18} className="shrink-0 text-warning" />
			<div className="flex-1 font-mono text-xs leading-relaxed text-text-muted">
				{sent ? (
					<span>
						Verification link sent to <span className="text-text">{email}</span>
						. Check your inbox to confirm your address.
					</span>
				) : (
					<span>
						Verify your email (<span className="text-text">{email}</span>) to
						confirm your account. You can keep using {BRAND_NAME} in the
						meantime.
					</span>
				)}
				{error && (
					<span className="mt-1 flex items-center gap-2 text-error">
						<AlertTriangle size={13} className="shrink-0" />
						{error}
					</span>
				)}
			</div>
			<button
				type="button"
				onClick={() => void resend()}
				disabled={busy || sent}
				className="btn-secondary text-sm px-3 py-1.5 shrink-0 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
				title={
					sent ? "Verification email sent" : "Resend the verification email"
				}
			>
				<Send size={15} />
				{busy ? "Sending…" : sent ? "Sent" : "Resend email"}
			</button>
		</div>
	);
}

/* ── Account settings (signed-in) ─────────────────────── */

// The signed-in account panel, reached from the header's Account settings button.
// Exposes the account mutations the UI offers: changing the email (top) and, in a
// visually separated danger zone, permanently deleting the account (password
// change is served by the reset-by-email flow, API keys by their own panel).
function AccountSettings({ onDone }: { onDone: () => void }) {
	const { data } = useSession();
	// The modal only opens for a signed-in user; guard so the types stay honest.
	if (!data) {
		return (
			<p className="font-mono text-xs text-text-dim">
				Sign in to manage your account.
			</p>
		);
	}
	return (
		<div className="space-y-6">
			<ChangeEmailForm
				currentEmail={data.user.email}
				emailVerified={data.user.emailVerified}
				onDone={onDone}
			/>
			<DeleteAccountForm currentEmail={data.user.email} />
		</div>
	);
}

// The danger zone: permanently delete the account. Two deliberate friction gates
// guard the button — the account password (verified server-side by Better Auth,
// which also proves this is your account) and typing the fixed confirmation
// phrase (a client-side accident guard that states the intent and resists
// copy-paste). The account email is shown for awareness of *which* account is
// being deleted, but isn't the thing you type. The button stays visible but
// disabled until both gates are satisfied, with the reason surfaced beneath it.
// On success the account is gone server-side and the session cookie cleared, so
// we hard-reload to the signed-out home rather than leave a stale session.
function DeleteAccountForm({ currentEmail }: { currentEmail: string }) {
	const [open, setOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [confirmText, setConfirmText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	// Both gates must pass: the confirmation phrase typed back, and a non-empty
	// password. The phrase match is case-insensitive on the trimmed input.
	const phraseMatches =
		confirmText.trim().toLowerCase() === DELETE_CONFIRM_PHRASE;
	const canDelete = phraseMatches && password.length > 0 && !busy;

	const submit = async () => {
		if (!canDelete) return;
		setBusy(true);
		setError(null);
		try {
			const result = await deleteUser({ password });
			if (result.error) {
				setError(result.error.message ?? "Could not delete your account");
				setBusy(false);
				return;
			}
			// Account is gone; the session cookie was cleared server-side. Reload to
			// a clean signed-out state.
			setDone(true);
		} catch (deleteError) {
			setError(
				deleteError instanceof Error
					? deleteError.message
					: "Could not delete your account",
			);
			setBusy(false);
		}
	};

	if (done) {
		return (
			<div className="space-y-4 rounded-xl border border-error bg-surface p-4">
				<div className="flex items-start gap-2 font-mono text-xs leading-relaxed text-text-muted">
					<Check size={16} className="mt-0.5 shrink-0 text-success" />
					<span>
						Your account has been permanently deleted. Thanks for using{" "}
						{BRAND_NAME}.
					</span>
				</div>
				<button
					type="button"
					onClick={() => window.location.assign(window.location.origin)}
					className={BTN_PRIMARY}
				>
					Continue
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-3 rounded-xl border border-error/60 bg-surface p-4">
			<div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-error">
				<AlertTriangle size={14} className="shrink-0" />
				Danger zone
			</div>
			<p className="font-mono text-xs leading-relaxed text-text-dim">
				Permanently delete the account for{" "}
				<span className="text-text">{currentEmail}</span>. This cannot be
				undone.
			</p>

			{!open ? (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="btn-secondary w-full inline-flex items-center justify-center gap-2 border-error/60 text-error hover:bg-error/10"
				>
					<Trash2 size={16} /> Delete account…
				</button>
			) : (
				<form
					className="space-y-3"
					onSubmit={(submitEvent) => {
						submitEvent.preventDefault();
						void submit();
					}}
				>
					<label className="block space-y-1">
						<span className="font-mono text-xs text-text-dim">
							Your password
						</span>
						<input
							value={password}
							disabled={busy}
							onChange={(changeEvent) => setPassword(changeEvent.target.value)}
							className={FIELD_CLASS}
							placeholder="Password"
							type="password"
							autoComplete="current-password"
							required
						/>
					</label>
					<label className="block space-y-1">
						<span className="font-mono text-xs text-text-dim">
							Type <span className="text-text">{DELETE_CONFIRM_PHRASE}</span> to
							confirm
						</span>
						<input
							value={confirmText}
							disabled={busy}
							onChange={(changeEvent) =>
								setConfirmText(changeEvent.target.value)
							}
							className={FIELD_CLASS}
							placeholder={DELETE_CONFIRM_PHRASE}
							type="text"
							autoComplete="off"
							autoCapitalize="none"
							spellCheck={false}
							required
						/>
					</label>

					{error && (
						<div className="flex items-center gap-2 font-mono text-xs text-error">
							<AlertTriangle size={14} className="shrink-0" />
							<span>{error}</span>
						</div>
					)}

					<button
						type="submit"
						disabled={!canDelete}
						title={
							!phraseMatches
								? `Type "${DELETE_CONFIRM_PHRASE}" to confirm`
								: password.length === 0
									? "Enter your password to confirm"
									: "Permanently delete your account"
						}
						className="btn-secondary w-full inline-flex items-center justify-center gap-2 border-error bg-error/10 text-error hover:bg-error/20"
					>
						<Trash2 size={16} />
						{busy ? "Deleting…" : "Delete my account permanently"}
					</button>
					{/* The reason the action is unavailable (disable + explain). */}
					{!canDelete && !busy && (
						<p className="font-mono text-[11px] leading-relaxed text-text-dim">
							{!phraseMatches
								? `Enter your password and type "${DELETE_CONFIRM_PHRASE}" above to enable deletion.`
								: "Enter your password above to enable deletion."}
						</p>
					)}
				</form>
			)}
		</div>
	);
}

// Start an email change. Better Auth runs a double opt-in when the current
// address is verified (approve from the old inbox, then verify the new one); an
// unverified account skips straight to verifying the new address. Either way the
// switch only completes once the user follows the emailed link(s), so on submit
// we just report what to expect and stash the target for the landing (see
// PENDING_EMAIL_CHANGE_KEY).
function ChangeEmailForm({
	currentEmail,
	emailVerified,
	onDone,
}: {
	currentEmail: string;
	emailVerified: boolean;
	onDone: () => void;
}) {
	const [newEmail, setNewEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [requested, setRequested] = useState(false);

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await changeEmail({
				newEmail: newEmail.trim(),
				callbackURL: changeEmailCallbackUrl(),
			});
			if (result.error) {
				setError(result.error.message ?? "Could not start the email change");
				setBusy(false);
				return;
			}
			// Remember the target so the landing can report accurate progress. Wrapped
			// because private-mode browsers can throw on localStorage writes.
			try {
				window.localStorage.setItem(PENDING_EMAIL_CHANGE_KEY, newEmail.trim());
			} catch {
				// Storage disabled — the landing just falls back to a generic message.
			}
			setRequested(true);
			setBusy(false);
		} catch (changeError) {
			setError(
				changeError instanceof Error
					? changeError.message
					: "Could not start the email change",
			);
			setBusy(false);
		}
	};

	if (requested) {
		// Copy depends on which flow ran: a verified account is emailed a
		// confirmation at the CURRENT address first; an unverified one is emailed a
		// verification straight to the NEW address.
		return (
			<div className="space-y-4">
				<div className="flex items-start gap-2 rounded-lg border border-success bg-surface p-3 font-mono text-xs leading-relaxed text-text-muted">
					<Send size={16} className="mt-0.5 shrink-0 text-success" />
					{emailVerified ? (
						<span>
							Check <span className="text-text">{currentEmail}</span> for a link
							to approve the change. Once you do, we'll email{" "}
							<span className="text-text">{newEmail.trim()}</span> to verify it
							— your account email switches after that.
						</span>
					) : (
						<span>
							We've emailed <span className="text-text">{newEmail.trim()}</span>
							. Open the link there to verify the address and finish the switch.
						</span>
					)}
				</div>
				<button type="button" onClick={onDone} className={BTN_PRIMARY}>
					Done
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 font-mono text-xs text-text-dim">
				<AtSign size={14} className="shrink-0" />
				<span>
					Signed in as <span className="text-text-muted">{currentEmail}</span>
				</span>
			</div>
			<p className="font-mono text-xs leading-relaxed text-text-dim">
				Enter a new address — we'll email a link to confirm the change before it
				takes effect.
			</p>
			<form
				className="space-y-3"
				onSubmit={(submitEvent) => {
					submitEvent.preventDefault();
					void submit();
				}}
			>
				<input
					value={newEmail}
					disabled={busy}
					onChange={(changeEvent) => setNewEmail(changeEvent.target.value)}
					className={FIELD_CLASS}
					placeholder="new@example.com"
					type="email"
					autoComplete="email"
					required
				/>
				{error && (
					<div className="flex items-center gap-2 font-mono text-xs text-error">
						<AlertTriangle size={14} className="shrink-0" />
						<span>{error}</span>
					</div>
				)}
				<button type="submit" disabled={busy} className={BTN_PRIMARY}>
					{busy ? "Working…" : "Change email"}
				</button>
			</form>
		</div>
	);
}

/* ── Email change (from email link) ───────────────────── */

interface ChangeEmailLandingState {
	// A token error reported by the redirect (stale/invalid link), else null.
	error: string | null;
	// Clear the change-email query params from the URL and close the dialog.
	dismiss: () => void;
}

// Detect a change-email landing in the URL. Better Auth redirects here after each
// step of the flow with `?mode=change-email` (plus `&error=…` when the link was
// stale). Returns null otherwise.
function useChangeEmailLanding(): ChangeEmailLandingState | null {
	const [landing, setLanding] = useState<{ error: string | null } | null>(() =>
		readChangeEmailLanding(),
	);
	// Read once on mount (the redirect is a full navigation, so query is present).
	useEffect(() => {
		setLanding(readChangeEmailLanding());
	}, []);

	if (!landing) return null;
	return {
		error: landing.error,
		dismiss: () => {
			clearLandingParamsFromUrl();
			setLanding(null);
		},
	};
}

function readChangeEmailLanding(): { error: string | null } | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	if (params.get("mode") !== CHANGE_EMAIL_MODE) return null;
	return { error: params.get("error") };
}

function readPendingEmailChange(): string | null {
	try {
		return window.localStorage.getItem(PENDING_EMAIL_CHANGE_KEY);
	} catch {
		return null;
	}
}

function clearPendingEmailChange(): void {
	try {
		window.localStorage.removeItem(PENDING_EMAIL_CHANGE_KEY);
	} catch {
		// ignore — storage disabled
	}
}

// The modal shown when a change-email link lands back on the app. The flow has
// two redirecting steps that share this callback, so we tell them apart by
// comparing the (possibly just-updated) session email with the address stashed
// at request time: equal ⇒ the switch is complete; different ⇒ the change was
// approved and the new address still needs verifying.
function ChangeEmailLanding({
	tokenError,
	onDone,
}: {
	tokenError: string | null;
	onDone: () => void;
}) {
	const { data } = useSession();
	// The pending target the user asked to switch to (null on a different browser).
	const [pending] = useState<string | null>(() => readPendingEmailChange());
	const done = Boolean(pending && data?.user.email === pending);

	// Once the switch completes, drop the stash so a later reload doesn't resurface
	// a stale "verify your new address" message.
	useEffect(() => {
		if (done) clearPendingEmailChange();
	}, [done]);

	if (tokenError) {
		return (
			<div className="space-y-4">
				<div className="flex items-start gap-2 font-mono text-xs leading-relaxed text-error">
					<AlertTriangle size={16} className="mt-0.5 shrink-0" />
					<span>
						This email-change link is invalid or has expired. Start again from
						Account settings.
					</span>
				</div>
				<button type="button" onClick={onDone} className={BTN_SECONDARY}>
					Close
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-start gap-2 rounded-lg border border-success bg-surface p-3 font-mono text-xs leading-relaxed text-text-muted">
				<MailCheck size={16} className="mt-0.5 shrink-0 text-success" />
				{done ? (
					<span>
						Your account email is now{" "}
						<span className="text-text">{data?.user.email}</span>. All set.
					</span>
				) : pending ? (
					<span>
						Change approved. We've emailed{" "}
						<span className="text-text">{pending}</span> — open the link there
						to verify the new address and finish the switch.
					</span>
				) : (
					<span>
						Your email-change request was processed. If you were asked to verify
						a new address, open the link we sent there to finish.
					</span>
				)}
			</div>
			<button type="button" onClick={onDone} className={BTN_PRIMARY}>
				Continue
			</button>
		</div>
	);
}

function ResetPasswordForm({
	token,
	tokenError,
	onDone,
}: {
	token: string | null;
	tokenError: string | null;
	onDone: () => void;
}) {
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	// The link itself was bad (expired/used). Nothing to submit — point the user
	// back at requesting a fresh one.
	if (tokenError || !token) {
		return (
			<div className="space-y-4">
				<div className="flex items-start gap-2 font-mono text-xs leading-relaxed text-error">
					<AlertTriangle size={16} className="mt-0.5 shrink-0" />
					<span>
						This reset link is invalid or has expired. Request a new one from
						the sign-in dialog.
					</span>
				</div>
				<button type="button" onClick={onDone} className={BTN_SECONDARY}>
					Close
				</button>
			</div>
		);
	}

	if (done) {
		return (
			<div className="space-y-4">
				<div className="flex items-start gap-2 rounded-lg border border-success bg-surface p-3 font-mono text-xs leading-relaxed text-text-muted">
					<Check size={16} className="mt-0.5 shrink-0 text-success" />
					<span>Your password has been reset. You're now signed in.</span>
				</div>
				<button type="button" onClick={onDone} className={BTN_PRIMARY}>
					Continue
				</button>
			</div>
		);
	}

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await resetPassword({ newPassword: password, token });
			if (result.error) {
				setError(result.error.message ?? "Could not reset password");
				setBusy(false);
				return;
			}
			setDone(true);
			setBusy(false);
		} catch (resetError) {
			setError(
				resetError instanceof Error
					? resetError.message
					: "Could not reset password",
			);
			setBusy(false);
		}
	};

	return (
		<form
			className="space-y-3"
			onSubmit={(submitEvent) => {
				submitEvent.preventDefault();
				void submit();
			}}
		>
			<p className="font-mono text-xs leading-relaxed text-text-dim">
				Choose a new password for your account.
			</p>
			<input
				value={password}
				disabled={busy}
				onChange={(changeEvent) => setPassword(changeEvent.target.value)}
				className={FIELD_CLASS}
				placeholder="New password (min 8 characters)"
				type="password"
				autoComplete="new-password"
				minLength={8}
				required
			/>
			{error && (
				<div className="flex items-center gap-2 font-mono text-xs text-error">
					<AlertTriangle size={14} className="shrink-0" />
					<span>{error}</span>
				</div>
			)}
			<button type="submit" disabled={busy} className={BTN_PRIMARY}>
				{busy ? "Working…" : "Set new password"}
			</button>
		</form>
	);
}

/* ── API key manager ──────────────────────────────────── */

type ApiKeyRow = NonNullable<
	Awaited<ReturnType<typeof authClient.apiKey.list>>["data"]
>["apiKeys"][number];

// List, create, and revoke the signed-in user's personal API keys. A freshly
// created key's secret is shown ONCE (Better Auth never returns it again), with
// a copy button, then drops back to the list.
function ApiKeysManager() {
	const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const [freshKey, setFreshKey] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		setError(null);
		const result = await authClient.apiKey.list();
		if (result.error) {
			setError(result.error.message ?? "Failed to load keys");
			return;
		}
		setKeys(result.data?.apiKeys ?? []);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const create = async () => {
		setCreating(true);
		setError(null);
		try {
			const result = await authClient.apiKey.create({
				name: newName.trim() || `${BRAND_NAME}-cli`,
			});
			if (result.error) {
				setError(result.error.message ?? "Failed to create key");
				return;
			}
			setFreshKey(result.data?.key ?? null);
			setNewName("");
			await refresh();
		} finally {
			setCreating(false);
		}
	};

	const revoke = async (keyId: string) => {
		setError(null);
		const result = await authClient.apiKey.delete({ keyId });
		if (result.error) {
			setError(result.error.message ?? "Failed to revoke key");
			return;
		}
		await refresh();
	};

	return (
		<div className="space-y-4">
			<p className="font-mono text-xs leading-relaxed text-text-dim">
				Send a key as the <span className="text-text-muted">x-api-key</span>{" "}
				header to authenticate API requests as your account without a cookie
				session. The secret is shown once at creation.
			</p>

			{freshKey && (
				<FreshKeyBanner value={freshKey} onDismiss={() => setFreshKey(null)} />
			)}

			<div className="flex gap-2">
				<input
					value={newName}
					disabled={creating}
					onChange={(changeEvent) => setNewName(changeEvent.target.value)}
					onKeyDown={(keyEvent) => {
						if (keyEvent.key === "Enter") {
							keyEvent.preventDefault();
							void create();
						}
					}}
					className={FIELD_CLASS}
					placeholder="Key name (e.g. laptop)"
				/>
				<button
					type="button"
					onClick={() => void create()}
					disabled={creating}
					className="btn-primary shrink-0 inline-flex items-center gap-2"
				>
					<Plus size={16} /> {creating ? "Creating…" : "Create"}
				</button>
			</div>

			{error && (
				<div className="flex items-center gap-2 font-mono text-xs text-error">
					<AlertTriangle size={14} className="shrink-0" />
					<span>{error}</span>
				</div>
			)}

			{keys === null ? (
				<div className="font-mono text-xs text-text-dim">Loading keys…</div>
			) : keys.length === 0 ? (
				<div className="font-mono text-xs text-text-dim">No keys yet.</div>
			) : (
				<ul className="space-y-1.5 max-h-60 overflow-y-auto">
					{keys.map((key) => (
						<li
							key={key.id}
							className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2"
						>
							<Key size={14} className="shrink-0 text-text-dim" />
							<span
								className="flex-1 min-w-0 truncate font-mono text-sm text-text"
								title={key.name ?? ""}
							>
								{key.name || "Unnamed key"}
								{key.start && (
									<span className="text-text-dim"> · {key.start}…</span>
								)}
							</span>
							<button
								type="button"
								onClick={() => void revoke(key.id)}
								className={ICON_BTN}
								title="Revoke key"
								aria-label={`Revoke ${key.name ?? "key"}`}
							>
								<Trash2 size={15} />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function FreshKeyBanner({
	value,
	onDismiss,
}: {
	value: string;
	onDismiss: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// ignore — older browsers without clipboard API
		}
	};
	return (
		<div className="space-y-2 rounded-xl border border-success bg-surface p-3">
			<div className="font-mono text-xs uppercase tracking-widest text-success">
				Copy your key now — it won't be shown again
			</div>
			<div className="flex gap-2">
				<input
					readOnly
					value={value}
					onFocus={(focusEvent) => focusEvent.currentTarget.select()}
					className={FIELD_CLASS}
				/>
				<button
					type="button"
					onClick={() => void copy()}
					className="btn-secondary shrink-0 inline-flex items-center gap-2"
				>
					{copied ? <Check size={16} /> : <Copy size={16} />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<button
				type="button"
				onClick={onDismiss}
				className="font-mono text-xs text-text-dim underline"
			>
				Done
			</button>
		</div>
	);
}
