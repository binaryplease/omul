import { useInterfaceText } from "../../interface-language";

// ── Status badge ──────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
	const { text } = useInterfaceText();
	const pageText = text.presenterPage;
	const config = {
		draft: {
			color: "text-text-dim",
			bg: "bg-surface-hover",
			label: pageText.statusDraft,
		},
		live: { color: "text-error", bg: "bg-error/10", label: pageText.statusLive },
		ended: {
			color: "text-text-muted",
			bg: "bg-surface-hover",
			label: pageText.statusEnded,
		},
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
