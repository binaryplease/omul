import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import type { ReactNode } from "react";

// ── Modal ──────────────────────────────────────────────────────
//
// A generic dialog shell used by the auth surfaces (sign-in, account settings,
// API keys, and the reset/verify/change-email landings). Mirrors ConfirmModal's
// backdrop treatment (dimmed `bg-void`, blur, click-outside to close) with a
// titled header row — an optional leading icon, the title, and a close button —
// over an arbitrary body. Escape and backdrop clicks both invoke `onClose`.

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
	return (
		// Modal backdrop — click or Escape dismisses (mirrors ConfirmModal).
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="absolute inset-0 bg-void/80 backdrop-blur-sm" />
			{/* The panel's only handler stops clicks from reaching the backdrop's
			    dismiss handler; it is not an interactive control, so there is no
			    keyboard affordance to mirror. */}
			<div
				className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl slide-in"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-5 flex items-center gap-3">
					{Icon ? (
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised border border-border-subtle text-accent">
							<Icon size={18} />
						</span>
					) : null}
					<h3 className="flex-1 text-lg font-semibold">{title}</h3>
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
