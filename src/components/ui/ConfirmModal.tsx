import { useEffect, useId, useRef } from "react";
import { useInterfaceText } from "../../interface-language";

// ── Confirmation modal ────────────────────────────────────────
//
// A dialog in the accessibility tree, not only on screen (REQ219): it says what
// it is and what it asks, takes focus when it opens — on Cancel, the choice that
// changes nothing — and hands it back to whatever opened it when it closes.
// Without that a keyboard or screen-reader user who pressed "Start" was left on
// the button behind the prompt, with the question it asked them out of reach.

export function ConfirmModal({
	open,
	title,
	message,
	confirmLabel,
	variant,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	title: string;
	message: string;
	confirmLabel?: string;
	variant?: "danger" | "default";
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const titleId = useId();
	const messageId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const opener =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		cancelRef.current?.focus();
		// Back where the reader was. An opener the confirmed action removed —
		// "Start" once the deck is live — is no longer in the document, and
		// focusing it does nothing.
		return () => opener?.focus();
	}, [open]);

	const { text } = useInterfaceText();
	if (!open) return null;
	return (
		// Click-outside-to-dismiss on the full-screen backdrop. Keyboard users
		// dismiss with Escape or the focusable Cancel button below, so the
		// backdrop is not the only path out; giving it a role and its own key
		// handler would put a second, redundant "Cancel" in the tab order instead
		// of adding an affordance.
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			onClick={onCancel}
		>
			<div className="absolute inset-0 bg-void/80 backdrop-blur-sm" />
			{/* The click handler is not an affordance — it only stops clicks inside
			    the panel from reaching the backdrop's dismiss handler. Escape is
			    heard here because focus is inside the panel while it is open. */}
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={messageId}
				className="relative bg-surface border border-border rounded-2xl p-6 max-w-sm w-full slide-in shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key === "Escape") onCancel();
				}}
			>
				<h3 id={titleId} className="text-lg font-semibold mb-2">
					{title}
				</h3>
				<p id={messageId} className="text-text-muted text-sm mb-6">
					{message}
				</p>
				<div className="flex gap-3 justify-end">
					<button
						ref={cancelRef}
						type="button"
						className="btn-secondary text-sm px-4 py-2"
						onClick={onCancel}
					>
						{text.presenterPage.confirmCancel}
					</button>
					<button
						type="button"
						className={`text-sm px-4 py-2 rounded-lg font-semibold cursor-pointer border-none transition-all ${
							variant === "danger"
								? "bg-error text-white hover:bg-error/80"
								: "btn-primary"
						}`}
						onClick={onConfirm}
					>
						{confirmLabel ?? text.presenterPage.confirmConfirm}
					</button>
				</div>
			</div>
		</div>
	);
}
