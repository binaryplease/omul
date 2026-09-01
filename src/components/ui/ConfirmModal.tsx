// ── Confirmation modal ────────────────────────────────────────

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
	if (!open) return null;
	return (
		// Click-outside-to-dismiss on the full-screen backdrop. Keyboard users
		// dismiss with the focusable Cancel button below, so the backdrop is not
		// the only path out; giving it a role and its own key handler would put a
		// second, redundant "Cancel" in the tab order instead of adding an
		// affordance.
		<div
			className="fixed inset-0 z-50 flex items-center justify-center p-4"
			onClick={onCancel}
		>
			<div className="absolute inset-0 bg-void/80 backdrop-blur-sm" />
			{/* This handler is not an affordance — it only stops clicks inside the
			    panel from reaching the backdrop's dismiss handler. There is no user
			    action here to give a keyboard equivalent to. */}
			<div
				className="relative bg-surface border border-border rounded-2xl p-6 max-w-sm w-full slide-in shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-lg font-semibold mb-2">{title}</h3>
				<p className="text-text-muted text-sm mb-6">{message}</p>
				<div className="flex gap-3 justify-end">
					<button
						type="button"
						className="btn-secondary text-sm px-4 py-2"
						onClick={onCancel}
					>
						Cancel
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
						{confirmLabel ?? "Confirm"}
					</button>
				</div>
			</div>
		</div>
	);
}
