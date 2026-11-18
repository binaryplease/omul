import type { ReactNode } from "react";
import { ReasonButton } from "./ui/ReasonTip";

/**
 * A control that creates a presentation (REQ252): drawn as the page's own
 * button while this visitor may create, and as a `ReasonButton` — focusable,
 * `aria-disabled`, its click guarded, its reason shown on hover, focus or tap —
 * while `refusal` says why they may not (REQ127).
 *
 * Available, it renders exactly the button the page drew before, so an
 * instance that never closed creating without an account draws what it always
 * did. `refusal` comes from `useGuestCreationRefusal()` (`src/guest-creation.ts`)
 * on every surface, so the reason reads the same wherever it is met.
 */
export function CreateControl({
	refusal,
	label,
	title,
	className,
	disabled = false,
	onClick,
	children,
}: {
	/** Why this visitor may not create, or `null` when they may. */
	refusal: string | null;
	/** What the control does — its accessible name while it is refused. */
	label: string;
	/** The available button's own `title`, when it carries one. */
	title?: string;
	className: string;
	/** The available button's own disabled state (a create already in flight). */
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	if (refusal !== null) {
		return (
			<ReasonButton
				label={label}
				reason={refusal}
				className={className}
				onClick={onClick}
			>
				{children}
			</ReasonButton>
		);
	}
	return (
		<button
			type="button"
			className={className}
			onClick={onClick}
			disabled={disabled}
			title={title}
		>
			{children}
		</button>
	);
}
