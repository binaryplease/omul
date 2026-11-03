import {
	type ReactNode,
	type Ref,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { appMenuPlacement, menuPortalHost } from "./BarMenu";

// ── A control that says why it is unavailable (ADR-0025) ──
//
// A `disabled` button explains itself to nobody: it leaves the tab order, most
// browsers deliver it no pointer events, and a `title` on it is a delayed native
// tooltip that a touch screen never shows — which is how a tester looked at a
// greyed-out bin with every slide selected and could not find out why (REQ127).
// So an unavailable control here stays a focusable button marked
// `aria-disabled`, with its click guarded, and its reason drawn as a visible tip
// while the pointer rests on it, while it holds focus, or after a tap — and
// linked by `aria-describedby`, so a screen reader announces the same words.
//
// The tip is portaled to the nearest theme scope and placed by the bar menu's
// `appMenuPlacement()`, because the controls that wear it sit in a scrolling
// rail and under an entrance animation whose transform would capture a fixed
// child. Until it is shown it stays in place, hidden, so the description always
// resolves to an element.

/**
 * The unavailable look, held once: dimmed, a refusing cursor, and no hover
 * colour or surface, so an inert control never lights up under the pointer.
 */
export const UNAVAILABLE_CONTROL =
	"aria-disabled:cursor-not-allowed aria-disabled:opacity-30 aria-disabled:hover:bg-transparent aria-disabled:hover:text-text-muted";

const REASON_TIP_FRAME =
	"z-50 w-max max-w-56 rounded-md border border-border bg-surface px-2 py-1 text-left text-xs font-normal leading-snug text-text shadow-lg pointer-events-none";

/**
 * The tip itself. `shown` draws it fixed beside its control; otherwise it is
 * kept out of sight but present, as the target of the control's description.
 */
export function ReasonTipBubble({
	id,
	reason,
	shown,
	ref,
}: {
	id: string;
	reason: string;
	shown: boolean;
	ref?: Ref<HTMLSpanElement>;
}) {
	return (
		<span
			ref={ref}
			id={id}
			role="tooltip"
			className={shown ? `fixed popover-in ${REASON_TIP_FRAME}` : "hidden"}
		>
			{reason}
		</span>
	);
}

/**
 * An icon control that is either available, or unavailable with `reason`.
 * `className` is the control's own frame and hover token; the unavailable look
 * is composed here.
 */
export function ReasonButton({
	label,
	reason,
	pressed,
	className,
	onClick,
	children,
}: {
	/** What the control does — its accessible name, available or not. */
	label: string;
	/** Why the control is unavailable; `null` when it is available. */
	reason: string | null;
	pressed?: boolean | "mixed";
	className: string;
	onClick: () => void;
	children: ReactNode;
}) {
	const tipId = useId();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const tipRef = useRef<HTMLSpanElement>(null);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [tapped, setTapped] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const unavailable = reason !== null;
	const shown = unavailable && !dismissed && (hovered || focused || tapped);

	// Placed before it paints and kept beside the control while anything scrolls.
	useLayoutEffect(() => {
		if (!shown) return;
		const place = () => {
			const button = buttonRef.current;
			const tip = tipRef.current;
			if (!button || !tip) return;
			const { top, left } = appMenuPlacement(
				button.getBoundingClientRect(),
				{ width: tip.offsetWidth, height: tip.offsetHeight },
				{ width: window.innerWidth, height: window.innerHeight },
			);
			tip.style.top = `${top}px`;
			tip.style.left = `${left}px`;
		};
		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [shown]);

	// A tap shows the reason until the next touch anywhere else.
	useEffect(() => {
		if (!tapped) return;
		const release = (event: PointerEvent) => {
			if (!buttonRef.current?.contains(event.target as Node)) setTapped(false);
		};
		document.addEventListener("pointerdown", release, true);
		return () => document.removeEventListener("pointerdown", release, true);
	}, [tapped]);

	const tip = (
		<ReasonTipBubble id={tipId} reason={reason ?? ""} shown={shown} ref={tipRef} />
	);

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				className={`${className} ${UNAVAILABLE_CONTROL}`}
				onClick={() => {
					if (!unavailable) {
						onClick();
						return;
					}
					setDismissed(false);
					setTapped(true);
				}}
				onPointerEnter={(event) => {
					if (event.pointerType !== "mouse") return;
					setDismissed(false);
					setHovered(true);
				}}
				onPointerLeave={(event) => {
					if (event.pointerType === "mouse") setHovered(false);
				}}
				onFocus={() => {
					setDismissed(false);
					setFocused(true);
				}}
				onBlur={() => {
					setFocused(false);
					setTapped(false);
				}}
				onKeyDown={(event) => {
					// Dismissible without moving the pointer or focus (WCAG 1.4.13).
					if (event.key === "Escape" && shown) {
						event.stopPropagation();
						setDismissed(true);
					}
				}}
				aria-disabled={unavailable}
				aria-pressed={pressed}
				aria-label={label}
				aria-describedby={unavailable ? tipId : undefined}
				title={unavailable ? undefined : label}
			>
				{children}
			</button>
			{unavailable &&
				(shown && buttonRef.current
					? createPortal(tip, menuPortalHost(buttonRef.current))
					: tip)}
		</>
	);
}
