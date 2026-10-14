import type { ReactNode } from "react";

// ── NoticeFrame ────────────────────────────────────────────────
//
// The frame an inline account notice sits in: an icon, a line of mono text and
// its controls, stacked on a phone and in one row from `sm` up. Two notices wear
// it — `VerifyEmailBanner` in `src/auth.tsx` (a step still owed, so `warning`)
// and the home page's offer to add an email (REQ194, an offer, so `neutral`) —
// and they differ only in the border, so the frame is said once here.

const NOTICE_FRAME_BORDER = {
	warning: "border-warning",
	neutral: "border-border",
} as const;

export function NoticeFrame({
	tone,
	role,
	children,
}: {
	tone: keyof typeof NOTICE_FRAME_BORDER;
	role?: "note" | "status";
	children: ReactNode;
}) {
	return (
		<div
			role={role}
			className={`flex flex-col gap-3 rounded-xl border ${NOTICE_FRAME_BORDER[tone]} bg-surface px-4 py-3 text-left sm:flex-row sm:items-center`}
		>
			{children}
		</div>
	);
}
