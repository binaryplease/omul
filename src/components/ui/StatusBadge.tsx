// ── Status badge ──────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
	const config = {
		draft: { color: "text-text-dim", bg: "bg-surface-hover", label: "Draft" },
		live: { color: "text-error", bg: "bg-error/10", label: "LIVE" },
		ended: { color: "text-text-muted", bg: "bg-surface-hover", label: "Ended" },
	}[status] ?? {
		color: "text-text-dim",
		bg: "bg-surface-hover",
		label: status,
	};

	return (
		<span
			className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color} ${config.bg}`}
		>
			{status === "live" && <span className="live-dot" />}
			{config.label}
		</span>
	);
}
