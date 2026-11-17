import { Check, Copy, Link2, Link2Off, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, getResultsToken, resultsLinkUrl } from "../api";
import { useInterfaceText } from "../interface-language";
import {
	dateLocale,
	ENGLISH_INTERFACE_TEXT,
	fillText,
	type InterfaceLanguage,
	type InterfaceText,
} from "../interface-text";
import type { ResultsLink } from "../types";
import { ICON_BUTTON_HOVER } from "./ShareCluster";
import { Modal } from "./ui/Modal";

// ── The deck's results link, as its organizer manages it (REQ098) ──────
//
// One dialog for the whole capability, because minting, copying and revoking are
// three views of one thing — whether this deck currently hands out its results —
// and splitting them across the chrome would let a presenter revoke a link
// without ever being told one existed. It sits behind a control on the results
// surface: what the link governs is the numbers, so it lives beside
// them rather than in global chrome.

/**
 * What the organizer's browser can do about the deck's link right now.
 *
 * The three states are not "loading / on / off" but a fourth that matters more:
 * a link is **active but not held here**, which happens whenever it was minted
 * in another browser or this one's storage was cleared. The secret is stored
 * hashed, so nothing can hand it back — the only way to copy a link again is to
 * mint a new one, which retires the old. Saying so is the difference between an
 * organizer replacing a link deliberately and doing it by clicking Copy.
 */
export type ResultsLinkView =
	| { kind: "none" }
	| { kind: "held"; url: string; issuedAt: string | null }
	| { kind: "elsewhere"; issuedAt: string | null };

/**
 * Resolve what this browser can do, from the deck's server-side status and the
 * token it happens to hold. Pure — the whole of the dialog's logic, testable
 * without a network or a DOM.
 *
 * A held token is offered for copying **only** when its `issuedAt` is the one
 * the server reports. Anything else is `elsewhere`, and that deliberately
 * includes a token this browser *accepted from a link* rather than minted:
 * `acceptResultsLinkToken()` records `""`, because a recipient never reads the
 * status endpoint and so has nothing to stamp it with, and a browser that cannot
 * prove it holds the current link must not offer to hand it on.
 *
 * That case is not hypothetical, and it is the organizer's own: mint here, open
 * your own results link here to see what a recipient sees — which overwrites the
 * stamp with `""` — then re-mint from a second browser. Treating the blank stamp
 * as "matches" would label the dead token with the *new* link's mint time and
 * offer Copy on it, so the organizer sends a URL that answers 401.
 */
export function resultsLinkView(
	status: ResultsLink | null,
	held: { token: string; issuedAt: string } | null,
	origin: string,
	presentationId: string,
): ResultsLinkView {
	if (!status?.active) return { kind: "none" };
	if (!held || held.issuedAt !== status.issuedAt) {
		return { kind: "elsewhere", issuedAt: status.issuedAt };
	}
	return {
		kind: "held",
		url: resultsLinkUrl(origin, presentationId, held.token),
		issuedAt: status.issuedAt,
	};
}

/**
 * When a link was minted, in words, or a plain statement that nobody knows —
 * in the interface language, the instant in its format (REQ248).
 */
export function resultsLinkIssuedLabel(
	issuedAt: string | null,
	text: InterfaceText = ENGLISH_INTERFACE_TEXT,
	language: InterfaceLanguage = "en",
): string {
	if (!issuedAt) return text.dialogs.resultsLinkActiveUnknown;
	const at = new Date(issuedAt);
	if (Number.isNaN(at.getTime())) return text.dialogs.resultsLinkActiveUnknown;
	return fillText(text.dialogs.resultsLinkActiveSince, {
		time: at.toLocaleString(dateLocale(language)),
	});
}

export function ResultsLinkDialog({
	presentationId,
	onClose,
	onNotify,
}: {
	presentationId: string;
	onClose: () => void;
	/** How the dialog says what just happened — the surface's own toast. */
	onNotify: (message: string, tone: "success" | "info" | "error") => void;
}) {
	const { text, language } = useInterfaceText();
	const { dialogs } = text;
	const [status, setStatus] = useState<ResultsLink | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);
	/**
	 * This browser's copy of the secret. Lifted out of `localStorage` into state
	 * because the map is not reactive: without this, a mint would leave the dialog
	 * still saying it holds nothing to copy until it was closed and reopened.
	 */
	const [held, setHeld] = useState(() => getResultsToken(presentationId));

	const refresh = useCallback(async () => {
		try {
			setStatus(await api.getResultsLink(presentationId));
		} catch {
			// A status that cannot be read leaves the dialog saying there is no
			// link, which is the withholding reading: it offers Copy for nothing it
			// cannot prove it holds, and Create still works.
			setStatus(null);
		} finally {
			setLoading(false);
		}
	}, [presentationId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const view = resultsLinkView(
		status,
		held,
		window.location.origin,
		presentationId,
	);

	const mint = async () => {
		setBusy(true);
		try {
			const link = await api.mintResultsLink(presentationId);
			setStatus(link);
			setHeld(getResultsToken(presentationId));
			if (link.resultsToken) {
				await navigator.clipboard.writeText(
					resultsLinkUrl(
						window.location.origin,
						presentationId,
						link.resultsToken,
					),
				);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			}
			onNotify(dialogs.resultsLinkCreated, "success");
		} catch (mintError: unknown) {
			onNotify(
				mintError instanceof Error
					? mintError.message
					: dialogs.resultsLinkCreateFailed,
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	const copy = async () => {
		if (view.kind !== "held") return;
		await navigator.clipboard.writeText(view.url);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
		onNotify(dialogs.resultsLinkCopiedToast, "success");
	};

	const revoke = async () => {
		setBusy(true);
		try {
			setStatus(await api.revokeResultsLink(presentationId));
			setHeld(getResultsToken(presentationId));
			onNotify(dialogs.resultsLinkRevoked, "info");
		} catch (revokeError: unknown) {
			onNotify(
				revokeError instanceof Error
					? revokeError.message
					: dialogs.resultsLinkRevokeFailed,
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal title={dialogs.resultsLinkTitle} icon={Link2} onClose={onClose}>
			<div className="flex flex-col gap-4">
				<p className="text-sm text-text-muted">{dialogs.resultsLinkIntro}</p>

				<div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
					{loading ? (
						<span className="text-text-dim">{dialogs.resultsLinkChecking}</span>
					) : view.kind === "none" ? (
						<span className="text-text-muted">{dialogs.resultsLinkNone}</span>
					) : view.kind === "elsewhere" ? (
						<span className="text-text-muted">
							{resultsLinkIssuedLabel(view.issuedAt, text, language)}{" "}
							{dialogs.resultsLinkElsewhere}
						</span>
					) : (
						<div className="flex flex-col gap-2">
							<span className="text-text-muted">
								{resultsLinkIssuedLabel(view.issuedAt, text, language)}
							</span>
							<code className="font-mono text-xs text-accent-text break-all">
								{view.url}
							</code>
						</div>
					)}
				</div>

				{/* One link per deck, so creating a second one is replacing the first.
				    Said on the button rather than discovered afterwards. */}
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
						onClick={copy}
						disabled={view.kind !== "held"}
						title={
							view.kind === "held"
								? dialogs.resultsLinkCopyName
								: dialogs.resultsLinkCopyNotHeld
						}
					>
						{copied ? <Check size={14} /> : <Copy size={14} />}
						{copied ? dialogs.resultsLinkCopied : dialogs.resultsLinkCopy}
					</button>
					<button
						type="button"
						className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
						onClick={mint}
						disabled={busy}
						title={
							view.kind === "none"
								? dialogs.resultsLinkCreateName
								: dialogs.resultsLinkReplaceName
						}
					>
						<RefreshCw size={14} />
						{view.kind === "none"
							? dialogs.resultsLinkCreate
							: dialogs.resultsLinkReplace}
					</button>
					<button
						type="button"
						className={`ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
						onClick={revoke}
						disabled={busy || view.kind === "none"}
						title={
							view.kind === "none"
								? dialogs.resultsLinkRevokeNone
								: dialogs.resultsLinkRevokeName
						}
					>
						<Link2Off size={14} />
						{dialogs.resultsLinkRevoke}
					</button>
				</div>

				<p className="text-xs text-text-dim">{dialogs.resultsLinkFootnote}</p>
			</div>
		</Modal>
	);
}
