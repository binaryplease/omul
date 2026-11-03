import { LogIn, LogOut, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthDialog } from "../auth";
import { signOut, useSession } from "../auth-client";
import type { getDict } from "../i18n";
import type { ParticipantSignInRefusalCode } from "../types";

// ── Signed-in participants (REQ134) ───────────────────────────
//
// A deck can require the people in its room to be signed in, and the server
// turns away anybody else — at the join door, where it sends nothing of the
// deck, and on every write after it. This is the screen a participant meets
// instead: not an error, but the door and the way through it.
//
// It has two shapes, one per refusal the server states. With no account at
// all it asks the participant to sign in, in the one sign-in dialog the app
// has, and that dialog finishes on this page — so the participant comes back to
// the same `/join/<code>` without going anywhere. With the wrong account (this
// device already answered here as somebody else) it says so and offers to
// switch, because signing in again as the same person changes nothing.
//
// The session is read here, and only here: a room on a deck that lets anybody
// in never mounts this, so it never spends a request asking who it is.

/** The words the prompt wears, in the deck's language when it has one (REQ084). */
export type ParticipantSignInLabels = {
	title: string;
	intro: string;
	action: string;
	mismatchTitle: string;
	mismatchIntro: string;
	switchAccount: string;
};

/** The one place the participant dictionary is mapped onto the prompt. */
export function participantSignInLabelsFor(
	dict: ReturnType<typeof getDict>,
): ParticipantSignInLabels {
	return {
		title: dict.signInTitle,
		intro: dict.signInIntro,
		action: dict.signInAction,
		mismatchTitle: dict.signInMismatchTitle,
		mismatchIntro: dict.signInMismatchIntro,
		switchAccount: dict.signInSwitchAccount,
	};
}

/** What the prompt draws for one refusal: its words and what its button does. */
export type ParticipantSignInPrompt = {
	title: string;
	intro: string;
	actionLabel: string;
	action: "sign-in" | "switch-account";
};

/**
 * The prompt for the reason the deck gave. Pure and exported, because which
 * screen a refusal leads to is the thing this module exists to get right, and a
 * mapping that lives in markup is one no test can ask about without a DOM.
 */
export function participantSignInPrompt(
	refused: ParticipantSignInRefusalCode,
	labels: ParticipantSignInLabels,
): ParticipantSignInPrompt {
	if (refused === "participant-account-mismatch") {
		return {
			title: labels.mismatchTitle,
			intro: labels.mismatchIntro,
			actionLabel: labels.switchAccount,
			action: "switch-account",
		};
	}
	return {
		title: labels.title,
		intro: labels.intro,
		actionLabel: labels.action,
		action: "sign-in",
	};
}

/**
 * The door. `onSignedIn` fires when the session comes to name an account it
 * did not name before — a sign-in, a new account, or a switch — and the page
 * answers by joining again; `onSignedOut` fires when it stops naming one, which
 * is how a switch starts. `returnTo` is the deck's own path, handed to the
 * dialog for the one step that leaves the page (a password reset email).
 */
export function ParticipantSignInGate({
	refused,
	labels,
	returnTo,
	onSignedIn,
	onSignedOut,
}: {
	refused: ParticipantSignInRefusalCode;
	labels: ParticipantSignInLabels;
	returnTo: string;
	onSignedIn: () => void;
	onSignedOut: () => void;
}) {
	const { data, isPending } = useSession();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [switching, setSwitching] = useState(false);
	const prompt = participantSignInPrompt(refused, labels);

	// `undefined` until the session has been read once, so the account a page
	// arrives with is a starting point rather than a change to act on.
	const userId = isPending ? undefined : (data?.user?.id ?? null);
	const lastUserId = useRef<string | null | undefined>(undefined);
	useEffect(() => {
		if (userId === undefined) return;
		const previous = lastUserId.current;
		lastUserId.current = userId;
		if (previous === undefined || previous === userId) return;
		if (userId === null) onSignedOut();
		else onSignedIn();
	}, [userId, onSignedIn, onSignedOut]);

	const handleAction = async () => {
		if (prompt.action === "sign-in") {
			setDialogOpen(true);
			return;
		}
		setSwitching(true);
		try {
			await signOut();
			setDialogOpen(true);
		} finally {
			setSwitching(false);
		}
	};

	const Icon = prompt.action === "sign-in" ? LogIn : UserX;
	const ActionIcon = prompt.action === "sign-in" ? LogIn : LogOut;

	return (
		<div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
			<Icon size={28} className="text-accent" />
			<h2 className="text-2xl font-bold">{prompt.title}</h2>
			<p className="text-sm text-text-muted">{prompt.intro}</p>
			<button
				type="button"
				className="btn-primary w-full inline-flex items-center justify-center gap-2"
				disabled={switching}
				onClick={() => void handleAction()}
			>
				<ActionIcon size={16} />
				{prompt.actionLabel}
			</button>
			{dialogOpen && (
				<AuthDialog returnTo={returnTo} onClose={() => setDialogOpen(false)} />
			)}
		</div>
	);
}
