import {
	ChevronLeft,
	ChevronRight,
	Maximize,
	Minimize2,
	Monitor,
	MonitorOff,
	QrCode,
} from "lucide-react";
import {
	type PointerEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { getDict, resolveLang } from "../i18n";
import { useInterfaceText } from "../interface-language";
import { BAR_GROUP, BAR_GROUP_ITEM } from "./ShareCluster";

// ── Presenting view (REQ247) ─────────────────────────────────
//
// The presenter screen's second state: the slide alone, for the room, with the
// presenter's controls a pointer move or a Tab away. The page owns what is
// drawn and what each control does; this module owns the view's frame, its
// control layer and the rules for the keys that enter and leave it.

/** The address fragment that opens `/present/<id>` in the presenting view. */
export const PRESENTING_HASH = "#presenting";

/**
 * The keys that page the deck forward and back on the presenter screen, in
 * both its views. PageDown and PageUp are what a presentation clicker sends.
 * The room-sized QR dialog closes on every one of them, and on Escape (REQ191).
 */
export const NEXT_SLIDE_KEYS: readonly string[] = [
	"ArrowRight",
	"ArrowDown",
	" ",
	"PageDown",
];
export const PREVIOUS_SLIDE_KEYS: readonly string[] = [
	"ArrowLeft",
	"ArrowUp",
	"PageUp",
];

/** How long the control layer stays up after the last pointer activity. */
export const PRESENTING_LAYER_IDLE_MS = 3000;

/**
 * The window "Open presenting window" opens into. Named per deck, so a second
 * use brings back the window already open rather than opening another.
 */
export function presentingWindowName(presentationId: string): string {
	return `omul-presenting-${presentationId}`;
}

/** Whether a key went to a field the presenter is typing into. */
export function isTypingTarget(
	target: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
	return (
		target !== null &&
		(["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? "") ||
			target.isContentEditable === true)
	);
}

/** The roles of a control that Space presses, as it presses a button. */
const SPACE_PRESSED_ROLES: readonly string[] = [
	"button",
	"checkbox",
	"switch",
	"radio",
	"tab",
	"option",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
];

/**
 * Whether Space belongs to the focused element rather than to the deck: a
 * button or a control like one presses on Space, and a field types it. There
 * Space is not Next, or pressing Present, Blank or Exit from the keyboard
 * would page the room instead (REQ247).
 */
export function takesSpace(
	target: {
		tagName?: string;
		isContentEditable?: boolean;
		getAttribute?: (name: string) => string | null;
	} | null,
): boolean {
	return (
		target !== null &&
		(isTypingTarget(target) ||
			["BUTTON", "SUMMARY"].includes(target.tagName ?? "") ||
			SPACE_PRESSED_ROLES.includes(target.getAttribute?.("role") ?? ""))
	);
}

/**
 * The single-letter shortcuts of the presenter screen: `F` enters or leaves
 * the presenting view, `B` toggles Blank (REQ109). Each is pressed with no
 * modifier, outside a field and with no dialog or menu open; `null` when the
 * key is neither or one of those holds it.
 */
export function presentingShortcut({
	key,
	modified,
	typing,
	overlayOpen,
}: {
	key: string;
	modified: boolean;
	typing: boolean;
	overlayOpen: boolean;
}): "presenting" | "blank" | null {
	const free = !modified && !typing && !overlayOpen;
	const letter = key.toLowerCase();
	return free && letter === "f"
		? "presenting"
		: free && letter === "b"
			? "blank"
			: null;
}

/**
 * How long after a full screen ends an Escape still counts as the press that
 * ended it. A browser that spends Esc on its full screen may hand the same key
 * to the page around `fullscreenchange`; that delivery is not a second press.
 * The page passes `0` for a press that arrives after the document left full
 * screen but before that event reached it.
 */
export const FULLSCREEN_ESCAPE_GRACE_MS = 500;

/**
 * What Escape does in the presenting view (REQ247). One press never ends both
 * the full screen and the view: in full screen it ends the full screen alone,
 * an Escape that arrives within `FULLSCREEN_ESCAPE_GRACE_MS` of a full screen
 * ending is that same press and does nothing more, and any other Escape leaves
 * the view. So the view stays on the projector after full screen until the
 * presenter takes it off with a further Esc or Exit.
 */
export function presentingEscape({
	inFullscreen,
	msSinceFullscreenEnded,
}: {
	inFullscreen: boolean;
	/** `null` when no full screen has ended on this page. */
	msSinceFullscreenEnded: number | null;
}): "end-fullscreen" | "spent" | "leave" {
	if (inFullscreen) return "end-fullscreen";
	if (
		msSinceFullscreenEnded !== null &&
		msSinceFullscreenEnded < FULLSCREEN_ESCAPE_GRACE_MS
	) {
		return "spent";
	}
	return "leave";
}

/** One paging direction, as the strip draws it (`slidePagingFor`). */
type PagingDirection = { index: number | null; disabled: boolean; label: string };

/**
 * The slide's own controls inside the stage (reveal, participation, timers,
 * the audio cue, answer moderation, the count/percentage switch), and any line
 * the slide marks `data-presenter-hint` because it tells the presenter what to
 * do, hidden with the layer by visibility and opacity rather than removed, so
 * the slide does not reflow as the layer comes and goes.
 *
 * `PresenterSlideView` draws no such line today: under a hidden or private
 * tally it shows only the room's sentence in the deck's language (REQ225). The
 * marker is how a presenter-only line added later stays off the projector.
 *
 * Visibility follows the fade only on the way down. On the way up it switches
 * at once, so a control is focusable the moment the layer is up — `Tab` hands
 * focus to the strip in the same keypress.
 */
const STAGE_CONTROLS_SHOWN =
	"[&_:is(button,input,select,textarea,[data-presenter-hint])]:transition-opacity [&_:is(button,input,select,textarea,[data-presenter-hint])]:duration-150 motion-reduce:[&_:is(button,input,select,textarea,[data-presenter-hint])]:transition-none";
const STAGE_CONTROLS_HIDDEN =
	"[&_:is(button,input,select,textarea,[data-presenter-hint])]:invisible [&_:is(button,input,select,textarea,[data-presenter-hint])]:opacity-0 [&_:is(button,input,select,textarea,[data-presenter-hint])]:transition-[opacity,visibility] [&_:is(button,input,select,textarea,[data-presenter-hint])]:duration-150 motion-reduce:[&_:is(button,input,select,textarea,[data-presenter-hint])]:transition-none";
const LAYER_SHOWN =
	"visible opacity-100 transition-opacity duration-150 motion-reduce:transition-none";
const LAYER_HIDDEN =
	"invisible opacity-0 transition-[opacity,visibility] duration-150 motion-reduce:transition-none";

export function PresentingView({
	join,
	blanked,
	stage,
	paging,
	onPage,
	position,
	blank,
	onShowQr,
	held,
	fullscreenOffered,
	onRequestFullscreen,
	onLeave,
	startCardShown,
	onDismissStartCard,
}: {
	/**
	 * Where the room joins. The join line is the room's, so it is in the deck's
	 * `language` (REQ084) rather than the interface language (REQ248).
	 */
	join: { host: string; code: string; language?: string };
	/** Whether the room's screen is blanked (REQ109): the stage is then controls only. */
	blanked: boolean;
	/** The slide, or on a blanked screen its curtain's controls. */
	stage: ReactNode;
	paging: { previous: PagingDirection; next: PagingDirection };
	onPage: (target: number | null) => void;
	/** "4 / 12". */
	position: string;
	blank: {
		pressed: boolean;
		disabled: boolean;
		label: string;
		onToggle: () => void;
	};
	onShowQr: () => void;
	/** A dialog opened from the layer is up, which keeps the layer up. */
	held: boolean;
	/** Whether the browser can go full screen and is not already. */
	fullscreenOffered: boolean;
	onRequestFullscreen: () => void;
	onLeave: () => void;
	startCardShown: boolean;
	onDismissStartCard: () => void;
}) {
	const { text } = useInterfaceText();
	const viewText = text.presentingView;
	const roomLanguage = resolveLang(join.language);
	const [layerUp, setLayerUp] = useState(false);
	const viewRef = useRef<HTMLDivElement>(null);
	const stripRef = useRef<HTMLDivElement>(null);
	const startCardRef = useRef<HTMLDivElement>(null);
	const startCardTextId = useId();
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const heldRef = useRef(held);
	heldRef.current = held;

	// The layer goes down once the pointer has been still for the idle time,
	// unless the pointer is on the strip, keyboard focus is in the layer, or a
	// dialog opened from it is up. A focus left on a control by a click does not
	// hold it, or one click on Next would keep the controls on the wall. The
	// start card is not the layer's: it stays until it is answered.
	const scheduleHide = useCallback(() => {
		if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		hideTimerRef.current = setTimeout(() => {
			const focused = document.activeElement;
			const focusInLayer =
				focused instanceof HTMLElement &&
				(viewRef.current?.contains(focused) ?? false) &&
				!(startCardRef.current?.contains(focused) ?? false);
			const keyboardFocusInLayer =
				focusInLayer && focused.matches(":focus-visible");
			if (
				heldRef.current ||
				keyboardFocusInLayer ||
				(stripRef.current?.matches(":hover") ?? false)
			) {
				scheduleHide();
				return;
			}
			// A hidden control must not keep focus, or Enter would press it.
			if (focusInLayer) focused.blur();
			setLayerUp(false);
		}, PRESENTING_LAYER_IDLE_MS);
	}, []);

	const raiseLayer = useCallback(() => {
		setLayerUp(true);
		scheduleHide();
	}, [scheduleHide]);

	useEffect(
		() => () => {
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
		},
		[],
	);

	// `Tab` brings the layer up before focus moves, so focus lands in the strip.
	// The strip's items fade their own visibility in with it (their hover token
	// transitions every property), so focus is handed over in the first frame
	// the first enabled one can take it, rather than in the keypress itself.
	useEffect(() => {
		const focusStrip = (framesLeft: number) => {
			const first = stripRef.current?.querySelector<HTMLButtonElement>(
				"button:not(:disabled)",
			);
			first?.focus();
			if (first && document.activeElement !== first && framesLeft > 0) {
				requestAnimationFrame(() => focusStrip(framesLeft - 1));
			}
		};
		const raiseOnTab = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || layerUp || heldRef.current) return;
			// Between the start card's own actions Tab moves as it does anywhere.
			const cardActions = [
				...(startCardRef.current?.querySelectorAll<HTMLButtonElement>(
					"button:not(:disabled)",
				) ?? []),
			];
			const cardAction = cardActions.indexOf(
				document.activeElement as HTMLButtonElement,
			);
			if (
				cardAction !== -1 &&
				(event.shiftKey ? cardAction > 0 : cardAction < cardActions.length - 1)
			) {
				return;
			}
			event.preventDefault();
			flushSync(raiseLayer);
			focusStrip(30);
		};
		window.addEventListener("keydown", raiseOnTab);
		return () => window.removeEventListener("keydown", raiseOnTab);
	}, [layerUp, raiseLayer]);

	// The start card is what a window opened into the view asks first, so it is
	// a dialog with focus on its first action, ahead of the strip in Tab order.
	useEffect(() => {
		if (!startCardShown) return;
		startCardRef.current
			?.querySelector<HTMLButtonElement>("button:not(:disabled)")
			?.focus();
	}, [startCardShown]);

	const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
		if (event.pointerType !== "touch") raiseLayer();
	};
	// A tap on the slide brings the layer up, and takes it down while it is up.
	// A tap on a control is that control's.
	const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (event.pointerType !== "touch") return;
		if (
			event.target instanceof Element &&
			event.target.closest("button, a, input, select, textarea")
		) {
			raiseLayer();
			return;
		}
		if (layerUp) setLayerUp(false);
		else raiseLayer();
	};

	return (
		<div
			ref={viewRef}
			data-presenting-view
			className={`relative h-dvh w-full overflow-hidden ${layerUp ? "" : "cursor-none"}`}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
		>
			{/* The room's standing invitation (REQ191), made quiet. Gone with
			    everything else while the screen is blanked. */}
			{!blanked && (
				<p
					lang={roomLanguage}
					className="pointer-events-none absolute inset-x-0 top-3 z-20 px-4 text-center text-sm text-text-muted"
				>
					{getDict(join.language).roomJoinAt} {join.host}{" "}
					<span className="font-mono font-bold text-accent-text tracking-widest">
						{join.code}
					</span>
				</p>
			)}

			<main
				className={`relative flex h-full items-center justify-center overflow-y-auto p-4 sm:p-8 ${
					layerUp ? STAGE_CONTROLS_SHOWN : STAGE_CONTROLS_HIDDEN
				}`}
			>
				{stage}
			</main>

			{startCardShown && (
				<div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
					<div
						ref={startCardRef}
						role="dialog"
						aria-labelledby={startCardTextId}
						className="pointer-events-auto flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-surface-raised p-6 text-center shadow-lg"
					>
						<p id={startCardTextId} className="text-sm text-text">
							{viewText.startCard}
						</p>
						<div className="flex flex-wrap items-center justify-center gap-3">
							<button
								type="button"
								className="btn-primary text-sm flex items-center gap-2"
								onClick={onRequestFullscreen}
								disabled={!fullscreenOffered}
								title={
									fullscreenOffered
										? viewText.fullScreen
										: viewText.fullScreenUnavailable
								}
							>
								<Maximize size={16} aria-hidden />
								{viewText.fullScreen}
							</button>
							<button
								type="button"
								className="btn-secondary text-sm"
								onClick={onDismissStartCard}
							>
								{viewText.dismiss}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* The strip: the presenter's controls, while the layer is up. */}
			<div className="pointer-events-none absolute inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
				<div
					ref={stripRef}
					role="toolbar"
					aria-label={viewText.controls}
					className={`${BAR_GROUP} pointer-events-auto shadow-lg ${
						layerUp ? LAYER_SHOWN : LAYER_HIDDEN
					}`}
				>
					<button
						type="button"
						onClick={() => onPage(paging.previous.index)}
						disabled={paging.previous.disabled}
						aria-label={paging.previous.label}
						title={paging.previous.label}
						className={BAR_GROUP_ITEM}
					>
						<ChevronLeft size={18} aria-hidden />
					</button>
					<span className="px-1.5 font-mono text-sm tabular-nums text-text-muted">
						{position}
					</span>
					<button
						type="button"
						onClick={() => onPage(paging.next.index)}
						disabled={paging.next.disabled}
						aria-label={paging.next.label}
						title={paging.next.label}
						className={BAR_GROUP_ITEM}
					>
						<ChevronRight size={18} aria-hidden />
					</button>
					<div aria-hidden className="w-px h-5 bg-border" />
					<button
						type="button"
						onClick={blank.onToggle}
						disabled={blank.disabled}
						aria-pressed={blank.pressed}
						aria-label={blank.label}
						title={blank.label}
						className={BAR_GROUP_ITEM}
					>
						{blank.pressed ? <MonitorOff size={16} /> : <Monitor size={16} />}
					</button>
					<button
						type="button"
						onClick={onShowQr}
						aria-haspopup="dialog"
						aria-label={viewText.showQrCode}
						title={viewText.showQrCode}
						className={BAR_GROUP_ITEM}
					>
						<QrCode size={16} aria-hidden />
					</button>
					{fullscreenOffered && (
						<button
							type="button"
							onClick={onRequestFullscreen}
							aria-label={viewText.fullScreen}
							title={viewText.fullScreen}
							className={BAR_GROUP_ITEM}
						>
							<Maximize size={16} aria-hidden />
						</button>
					)}
					<div aria-hidden className="w-px h-5 bg-border" />
					<button
						type="button"
						onClick={onLeave}
						aria-label={viewText.leave}
						title={viewText.leave}
						className={BAR_GROUP_ITEM}
					>
						<Minimize2 size={16} aria-hidden />
						<span className="hidden sm:inline">{viewText.exit}</span>
					</button>
				</div>
			</div>
		</div>
	);
}
