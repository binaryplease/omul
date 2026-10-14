// ── The offer to add an email (REQ194) ─────────────────────────
//
// The notice the home page shows above "Your Presentations" while this browser
// holds decks without an account: they live only in its storage, and an account
// keeps them. Whether it is shown is `shouldOfferEmailRecovery()` in
// `src/email-recovery-prompt.ts`; this module only draws it. It sits at the top
// of the list it is about, not in the page's chrome, and it never stands between
// the visitor and anything — the close control is always there.

import { MailPlus, X } from "lucide-react";
import { type Dict, getDict } from "../i18n";
import { ICON_BUTTON_HOVER } from "./ShareCluster";

export type EmailRecoveryPromptLabels = {
	text: string;
	action: string;
	dismiss: string;
};

/** The notice's words out of a language's dictionary, mapped in one place. */
export function emailRecoveryPromptLabelsFor(
	dict: Dict,
): EmailRecoveryPromptLabels {
	return {
		text: dict.emailRecoveryText,
		action: dict.emailRecoveryAction,
		dismiss: dict.emailRecoveryDismiss,
	};
}

/** The notice as the home page draws it: in English, like the rest of the chrome. */
export const EMAIL_RECOVERY_PROMPT_LABELS: EmailRecoveryPromptLabels =
	emailRecoveryPromptLabelsFor(getDict("en"));

export function EmailRecoveryPrompt({
	labels = EMAIL_RECOVERY_PROMPT_LABELS,
	onAddEmail,
	onDismiss,
}: {
	labels?: EmailRecoveryPromptLabels;
	onAddEmail: () => void;
	onDismiss: () => void;
}) {
	return (
		<div
			role="note"
			className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left sm:flex-row sm:items-center"
		>
			<MailPlus size={18} className="shrink-0 text-accent-text" />
			<p className="flex-1 font-mono text-xs leading-relaxed text-text-muted">
				{labels.text}
			</p>
			<div className="flex shrink-0 items-center gap-1">
				<button
					type="button"
					onClick={onAddEmail}
					className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center justify-center gap-1.5"
				>
					<MailPlus size={15} />
					{labels.action}
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
		</div>
	);
}
