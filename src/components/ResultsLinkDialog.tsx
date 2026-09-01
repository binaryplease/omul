import { Check, Copy, Link2, Link2Off, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, getResultsToken, resultsLinkUrl } from "../api";
import type { ResultsLink } from "../types";
import { ICON_BUTTON_HOVER } from "./ShareCluster";
import { Modal } from "./ui/Modal";

// ── The deck's results link, as its organizer manages it (REQ098) ──────
//
// One dialog for the whole capability, because minting, copying and revoking are
// three views of one thing — whether this deck currently hands out its results —
// and splitting them across the chrome would let a presenter revoke a link
// without ever being told one existed. It sits behind a control on the results
// surface (ADR-0031): what the link governs is the numbers, so it lives beside
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

/** When a link was minted, in words, or a plain statement that nobody knows. */
export function resultsLinkIssuedLabel(issuedAt: string | null): string {
	if (!issuedAt) return "Active — minted at an unrecorded time.";
	const at = new Date(issuedAt);
	if (Number.isNaN(at.getTime())) return "Active — minted at an unrecorded time.";
	return `Active since ${at.toLocaleString()}.`;
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
			onNotify("Results link created and copied to clipboard", "success");
		} catch (mintError: unknown) {
			onNotify(
				mintError instanceof Error
					? mintError.message
					: "Could not create the results link",
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
		onNotify("Results link copied to clipboard", "success");
	};

	const revoke = async () => {
		setBusy(true);
		try {
			setStatus(await api.revokeResultsLink(presentationId));
			setHeld(getResultsToken(presentationId));
			onNotify("Results link revoked — it no longer opens anything", "info");
		} catch (revokeError: unknown) {
			onNotify(
				revokeError instanceof Error
					? revokeError.message
					: "Could not revoke the results link",
				"error",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal title="Share the results" icon={Link2} onClose={onClose}>
			<div className="flex flex-col gap-4">
				<p className="text-sm text-text-muted">
					A results link opens this deck's results in a read-only page, with no
					account and no sign-in. Whoever holds it reads every slide's tally —
					including the ones this deck keeps back from the room — and nothing
					else: it cannot edit, start, end or reset the presentation, download
					the spreadsheet, or read a running quiz question's answer key.
				</p>

				<div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
					{loading ? (
						<span className="text-text-dim">Checking…</span>
					) : view.kind === "none" ? (
						<span className="text-text-muted">
							This deck has no results link. Nothing is shared until you create
							one.
						</span>
					) : view.kind === "elsewhere" ? (
						<span className="text-text-muted">
							{resultsLinkIssuedLabel(view.issuedAt)} This browser cannot show
							it: the link is stored only as a fingerprint, so a copy of it that
							cannot be matched against this mint is not one to hand on. Creating
							a new one replaces it.
						</span>
					) : (
						<div className="flex flex-col gap-2">
							<span className="text-text-muted">
								{resultsLinkIssuedLabel(view.issuedAt)}
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
								? "Copy the results link to the clipboard"
								: "Copy the results link — this browser does not hold it, so create a new one instead"
						}
					>
						{copied ? <Check size={14} /> : <Copy size={14} />}
						{copied ? "Copied!" : "Copy link"}
					</button>
					<button
						type="button"
						className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
						onClick={mint}
						disabled={busy}
						title={
							view.kind === "none"
								? "Create a results link and copy it"
								: "Create a new results link — the current one stops working immediately"
						}
					>
						<RefreshCw size={14} />
						{view.kind === "none" ? "Create link" : "Replace link"}
					</button>
					<button
						type="button"
						className={`ml-auto flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
						onClick={revoke}
						disabled={busy || view.kind === "none"}
						title={
							view.kind === "none"
								? "Revoke the results link — there is none to revoke"
								: "Revoke the results link — every copy of it stops working immediately"
						}
					>
						<Link2Off size={14} />
						Revoke
					</button>
				</div>

				<p className="text-xs text-text-dim">
					Revoking takes effect at once and applies to every copy of the link —
					there is one per deck, not one per recipient. A results page somebody
					already has open keeps the numbers it was last sent until it refreshes,
					and anything they have already read stays with them.
				</p>
			</div>
		</Modal>
	);
}
