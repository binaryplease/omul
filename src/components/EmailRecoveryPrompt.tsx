// ── The offer to add an email (REQ194) ─────────────────────────
//
// The notice the home page shows above "Your Presentations" while this browser
// holds decks and nobody is signed in: they live only in its storage, and an
// account keeps them. Whether it is shown, and which of its two offers it makes
// (create an account, or sign in for a browser that has had one), is
// `emailRecoveryOfferFor()` in `src/email-recovery-prompt.ts`; this module only
// draws it. It sits at the top
// of the list it is about, not in the page's chrome, and it never stands between
// the visitor and anything — the close control is always there.

import { LogIn, MailPlus, X } from "lucide-react";
import type { EmailRecoveryOffer } from "../email-recovery-prompt";
import { type Dict, getDict } from "../i18n";
import { ICON_BUTTON_HOVER } from "./ShareCluster";
import { NoticeFrame } from "./ui/NoticeFrame";

export type EmailRecoveryPromptLabels = {
	text: Record<EmailRecoveryOffer, string>;
	action: Record<EmailRecoveryOffer, string>;
	dismiss: string;
};

/** The notice's words out of a language's dictionary, mapped in one place. */
export function emailRecoveryPromptLabelsFor(
	dict: Dict,
): EmailRecoveryPromptLabels {
	return {
		text: {
			signup: dict.emailRecoveryText,
			signin: dict.emailRecoverySignInText,
		},
		action: {
			signup: dict.emailRecoveryAction,
			signin: dict.emailRecoverySignInAction,
		},
		dismiss: dict.emailRecoveryDismiss,
	};
}

/** The notice as the home page draws it: in English, like the rest of the chrome. */
export const EMAIL_RECOVERY_PROMPT_LABELS: EmailRecoveryPromptLabels =
	emailRecoveryPromptLabelsFor(getDict("en"));

/** The action's icon per offer, beside the dialog tab it opens. */
const OFFER_ICON = { signup: MailPlus, signin: LogIn } as const;

export function EmailRecoveryPrompt({
	offer,
	labels = EMAIL_RECOVERY_PROMPT_LABELS,
	onTakeOffer,
	onDismiss,
}: {
	offer: EmailRecoveryOffer;
	labels?: EmailRecoveryPromptLabels;
	onTakeOffer: () => void;
	onDismiss: () => void;
}) {
	const OfferIcon = OFFER_ICON[offer];
	return (
		<NoticeFrame tone="neutral" role="note">
			<OfferIcon size={18} className="shrink-0 text-accent-text" />
			<p className="flex-1 font-mono text-xs leading-relaxed text-text-muted">
				{labels.text[offer]}
			</p>
			<div className="flex shrink-0 items-center gap-1">
				<button
					type="button"
					onClick={onTakeOffer}
					className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center justify-center gap-1.5"
				>
					<OfferIcon size={15} />
					{labels.action[offer]}
				</button>
				<button
					type="button"
					onClick={onDismiss}
					className={`p-2 rounded-lg ${ICON_BUTTON_HOVER}`}
					title={labels.dismiss}
					aria-label={labels.dismiss}
				>
					<X size={16} />
				</button>
			</div>
		</NoticeFrame>
	);
}
