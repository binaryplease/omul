// ── Loading spinner ──────────────────────────────────────────

export function LoadingState() {
	return (
		<div className="flex items-center justify-center py-16">
			<div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
		</div>
	);
}
