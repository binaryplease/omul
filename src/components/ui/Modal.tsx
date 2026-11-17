import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

// ── Modal ──────────────────────────────────────────────────────
//
// A generic dialog shell used by the auth surfaces (sign-in, account settings,
// API keys, and the reset/verify/change-email landings) and the deck's sharing,
// export and workspace dialogs. Mirrors ConfirmModal's backdrop treatment
// (dimmed `bg-void`, blur, click-outside to close) with a titled header row — an
// optional leading icon, the title, and a close button — over an arbitrary body.
//
// It is a dialog in the accessibility tree as ConfirmModal is (REQ219, REQ241):
// a modal dialog named by its title, which takes focus when it opens and hands
// it back to whatever opened it when it closes. Escape closes it wherever focus
// is, not only inside the panel: a button the dialog disables while it works —
// "Create link" while the link is minted — drops focus on the page, and before
// this the panel could then only be left with the mouse.

export function Modal({
	title,
	icon: Icon,
	onClose,
	children,
}: {
	title: string;
	icon?: LucideIcon;
	onClose: () => void;
	children: ReactNode;
}) {
	const titleId = useId();
	const panelRef = useRef<HTMLDivElement>(null);
	// The latest close handler, so the listeners below are installed once per
	// open rather than once per render of a parent that passes an inline arrow.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		const opener =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		// A field the body focuses itself (`autoFocus`) keeps its focus; anything
		// else — the opener behind the backdrop above all — gives way to the panel.
		if (!panelRef.current?.contains(document.activeElement)) {
			panelRef.current?.focus();
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCloseRef.current();
		};
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("keydown", closeOnEscape);
			// An opener that is gone from the document ignores the call.
			opener?.focus();
		};
	}, []);

	// After every render: a control that went disabled or was replaced while it
	// had focus leaves focus on the page behind the backdrop. Take it back into
	// the panel, where the next Tab reaches the dialog's own controls again.
	useEffect(() => {
		if (document.activeElement === document.body) panelRef.current?.focus();
	});

	return (
		// Click-outside-to-dismiss on the full-screen backdrop. Keyboard users
		// dismiss with Escape or the focusable Close button, so the backdrop is
		// not the only path out.
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			onClick={onClose}
		>
			<div className="absolute inset-0 bg-void/80 backdrop-blur-sm" />
			{/* The panel's only handler stops clicks from reaching the backdrop's
			    dismiss handler; it is not an interactive control, so there is no
			    keyboard affordance to mirror. It is focusable from script only, so
			    that opening the dialog lands a screen reader on its name. */}
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
				className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl slide-in outline-none"
				onClick={(e) => e.stopPropagation()}
				// Keys typed in a modal dialog are the dialog's: an arrow or Space
				// on its buttons must not also page the live deck behind it through
				// the presenter's window-level shortcuts. Escape goes on to the
				// listener above.
				onKeyDown={(event) => {
					if (event.key !== "Escape") event.stopPropagation();
				}}
			>
				<div className="mb-5 flex items-center gap-3">
					{Icon ? (
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised border border-border-subtle text-accent">
							<Icon size={18} />
						</span>
					) : null}
					<h3 id={titleId} className="flex-1 text-lg font-semibold">
						{title}
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="text-text-dim hover:text-accent transition-colors p-1"
						title="Close"
						aria-label="Close"
					>
						<X size={18} />
					</button>
				</div>
				{children}
			</div>
		</div>
	);
}
