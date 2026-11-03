import {
	Check,
	ChevronDown,
	Code,
	Copy,
	Link,
	Pencil,
	QrCode,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { BarMenu, BarMenuRow, MENU_DIVIDER } from "./ui/BarMenu";

// ── Share cluster (REQ: join-code / link / QR / embed / edit-link) ─────
//
// The presenter bar's door into the room (REQ190, REQ191): the join code, one
// tap to copy, the QR code, one tap to show, and a Share menu holding every
// other way in. The affordance is
// expressed once: a pure descriptor
// (`buildShareControls`) is the single source of truth for *which* controls
// exist, their order, icons, labels, copied-state, and handlers; the
// `ShareCluster` wrapper owns *how* they render and where they sit relative to
// one another. A surface composes the wrapper with a `variant` — it never
// re-derives the control set or re-arranges the cluster.

/**
 * Shared interaction-state token: the muted → accent hover treatment
 * for an icon button. Composed by every icon control — never re-declared
 * inline per surface. Each surface adds its own chrome (background/border) on
 * top; the *interaction state* itself lives here once.
 */
export const ICON_BUTTON_HOVER =
	"transition-all group cursor-pointer text-text-muted hover:text-accent";

/**
 * One pill per group of controls in the presenter bar (REQ190) — the items
 * inside carry no border of their own.
 */
export const BAR_GROUP =
	"flex flex-none items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-0.5";

/**
 * One control inside a `BAR_GROUP`. Pressed and expanded read as a fill, a
 * change in luminance rather than in hue alone.
 *
 * Its height is what makes the bar one height per width (REQ192, REQ199): with
 * the pill's 2px padding and 1px border, a 38px item is a 44px pill below `sm`,
 * where the phone's controls are thumb targets, a 34px item a 40px pill below
 * `xl`, and a 32px item a 38px pill from `xl` — each the `BAR_CONTROL_HEIGHT`
 * of that width. Held here rather than per site, so no group can come to stand
 * a different height from its neighbours.
 */
export const BAR_GROUP_ITEM = `${ICON_BUTTON_HOVER} flex h-8 min-w-8 max-xl:h-8.5 max-xl:min-w-8.5 max-sm:h-9.5 max-sm:min-w-9.5 items-center justify-center gap-1.5 rounded-md px-2 text-sm hover:bg-surface-hover aria-pressed:bg-accent-dim aria-pressed:text-accent-text aria-expanded:bg-accent-dim aria-expanded:text-accent-text disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-muted`;

/**
 * The one `BAR_GROUP_ITEM` that carries the screen's primary fill while it can
 * be pressed — the phone dock's Next (REQ199). The fill is the primary
 * button's; disabled, it is a neutral item like its neighbours.
 */
export const BAR_GROUP_ITEM_PRIMARY = `${BAR_GROUP_ITEM} enabled:bg-primary enabled:text-on-primary enabled:hover:bg-primary-hover enabled:hover:text-on-primary`;

/**
 * The height of every bordered or filled bar control that stands alone rather
 * than in a `BAR_GROUP` — the Deck trigger, the lifecycle button, the View only
 * marker: a `BAR_GROUP` pill's height at each width, 38px from `xl`, 40px below
 * it and 44px below `sm` (REQ192, REQ199).
 */
export const BAR_CONTROL_HEIGHT = "h-9.5 max-xl:h-10 max-sm:h-11";

/**
 * `BAR_CONTROL_HEIGHT` for a square control — the app menu's trigger, which
 * `AppMenu` sizes `size-8.5` on its own, so the `xl` size is a variant that
 * outranks it there rather than a second base size competing with it.
 */
export const BAR_CONTROL_SIZE = "xl:size-9.5 max-xl:size-10 max-sm:size-11";

/** A single non-join share control (copy link, QR, embed, edit-link). */
export type ShareAction = {
	key: string;
	title: string;
	icon: ReactNode;
	/** Short idle label. */
	label: string;
	/** Label shown while the copied confirmation is visible. */
	copiedLabel: string;
	/** When true the control swaps its icon/label for the copied confirmation. */
	copied: boolean;
	onClick: () => void;
};

/** The leading join-code control, which renders the code inline. */
export type ShareJoin = {
	code: string;
	/** Where the room joins, named beside the code from `2xl` (REQ191). */
	host: string;
	copied: boolean;
	onClick: () => void;
};

export type ShareControls = { join: ShareJoin; actions: ShareAction[] };

/**
 * Pure descriptor builder — the single source of truth for the share-control
 * set. Data in, data out: no state, no DOM. The edit-link control is owner-only
 * (a non-owner has no creator token to mint an edit link from), so it is
 * omitted from the set rather than rendered inert.
 */
export function buildShareControls(params: {
	code: string;
	host: string;
	isOwner: boolean;
	copied: { code: boolean; link: boolean; embed: boolean; editLink: boolean };
	onCopyCode: () => void;
	onCopyLink: () => void;
	onShowQr: () => void;
	onCopyEmbed: () => void;
	onShareEdit: () => void;
}): ShareControls {
	const actions: ShareAction[] = [
		{
			key: "link",
			title: "Copy join link",
			icon: <Link size={14} />,
			label: "Link",
			copiedLabel: "Copied!",
			copied: params.copied.link,
			onClick: params.onCopyLink,
		},
		{
			key: "qr",
			title: "Show QR code",
			icon: <QrCode size={14} />,
			label: "QR",
			copiedLabel: "QR",
			copied: false,
			onClick: params.onShowQr,
		},
		{
			key: "embed",
			title: "Copy embed code (iframe snippet)",
			icon: <Code size={14} />,
			label: "Embed",
			copiedLabel: "Copied!",
			copied: params.copied.embed,
			onClick: params.onCopyEmbed,
		},
	];
	if (params.isOwner) {
		actions.push({
			key: "edit-link",
			title: "Copy share link with edit permissions",
			icon: <Pencil size={14} />,
			label: "Edit Link",
			copiedLabel: "Copied!",
			copied: params.copied.editLink,
			onClick: params.onShareEdit,
		});
	}
	return {
		join: {
			code: params.code,
			host: params.host,
			copied: params.copied.code,
			onClick: params.onCopyCode,
		},
		actions,
	};
}

/**
 * What the Share trigger is called: every action the menu behind it holds. The
 * QR code is not among them — it has its own button beside the code (REQ191).
 */
export function shareMenuLabel(actions: ShareAction[]): string {
	const editLink = actions.some((action) => action.key === "edit-link");
	return `Share — copy the join link${
		editLink ? ", the embed code or the edit link" : " or the embed code"
	}`;
}

/**
 * What the phone's Join trigger is called (REQ199): the code it shows, then
 * everything the menu behind it holds. The visible code leads the name, so a
 * voice user can say what they see (WCAG 2.5.3).
 */
export function joinMenuLabel(code: string, actions: ShareAction[]): string {
	const editLink = actions.some((action) => action.key === "edit-link");
	return `Join ${code} — show the QR code, copy the code, the join link${
		editLink ? ", the embed code or the edit link" : " or the embed code"
	}`;
}

/**
 * The Share menu's rows, one per action in descriptor order — drawn by the
 * Share menu and again at the foot of the phone's Join menu, so the two cannot
 * come to offer different ways in.
 */
function shareMenuRows(menuActions: ShareAction[], close: () => void) {
	return menuActions.map((action) => (
		<Fragment key={action.key}>
			{action.key === "edit-link" && (
				<div aria-hidden className={MENU_DIVIDER} />
			)}
			<BarMenuRow
				icon={action.copied ? <Check size={14} /> : action.icon}
				label={action.copied ? action.copiedLabel : action.title}
				title={action.title}
				onClick={() => {
					if (action.key === "edit-link") close();
					action.onClick();
				}}
			/>
		</Fragment>
	));
}

/**
 * Renders the share-control cluster (`variant="menu"`, the only one since
 * REQ190 retired the wide bar and the compact row) in one of two shapes drawn
 * from the same descriptor, chosen by width:
 *
 * - From `sm`, REQ191's group: the join code, which copies itself on a tap, the
 *   QR button, one tap from the room-sized code, and the Share menu with one
 *   row per remaining action in descriptor order.
 * - Below `sm` (REQ199), one button with the code on its face, opening a Join
 *   menu: Show QR code, Copy join code, then the Share menu's rows. Below 640px
 *   this screen is a phone in the presenter's hand rather than the room's
 *   screen, so the QR is for the person beside them and is one menu deep; the
 *   code is still never folded away, because it is the button's face.
 *
 * A copy row stays open so its confirmation is seen; the QR and the edit link
 * close the menu before opening their own dialog. `className` carries the
 * surface-specific shell, which is the only latitude a surface has.
 */
export function ShareCluster({
	className = "",
	controls,
}: {
	variant: "menu";
	className?: string;
	controls: ShareControls;
}) {
	const { join, actions } = controls;
	const qr = actions.find((action) => action.key === "qr");
	const menuActions = actions.filter((action) => action.key !== "qr");
	return (
		<>
			<div className={`${BAR_GROUP} max-sm:hidden ${className}`}>
				<button
					type="button"
					className={`${BAR_GROUP_ITEM} px-2.5`}
					onClick={join.onClick}
					title="Copy join code"
				>
					<span className="text-xs text-text-muted">
						<span className="2xl:hidden">Join:</span>
						<span className="hidden 2xl:inline">
							Join at{" "}
							<span className="inline-block max-w-56 truncate align-bottom font-mono text-text">
								{join.host}
							</span>
						</span>
					</span>
					<span className="font-mono font-bold text-accent-text text-base tracking-wider sm:text-lg sm:tracking-widest">
						{join.code}
					</span>
					<span className="text-text-dim group-hover:text-accent transition-colors">
						{join.copied ? <Check size={14} /> : <Copy size={14} />}
					</span>
				</button>
				<div aria-hidden className="w-px h-5 bg-border" />
				{qr && (
					<button
						type="button"
						className={BAR_GROUP_ITEM}
						onClick={qr.onClick}
						aria-haspopup="dialog"
						aria-label={qr.title}
						title={qr.title}
					>
						<QrCode size={16} aria-hidden />
					</button>
				)}
				<BarMenu
					label={shareMenuLabel(menuActions)}
					title="Share"
					heading={`Share · join ${join.code}`}
					triggerClassName={BAR_GROUP_ITEM}
					trigger={<ChevronDown size={14} aria-hidden />}
				>
					{(close) => shareMenuRows(menuActions, close)}
				</BarMenu>
			</div>
			<div className={`${BAR_GROUP} sm:hidden ${className}`}>
				<BarMenu
					label={joinMenuLabel(join.code, menuActions)}
					title={`Join ${join.code}`}
					heading={`Join · ${join.code}`}
					triggerClassName={`${BAR_GROUP_ITEM} px-2`}
					trigger={
						<>
							<span className="font-mono font-bold text-accent-text text-base tracking-wider">
								{join.code}
							</span>
							<ChevronDown size={14} aria-hidden />
						</>
					}
				>
					{(close) => (
						<>
							{qr && (
								<BarMenuRow
									icon={<QrCode size={14} />}
									label={qr.title}
									title={qr.title}
									onClick={() => {
										close();
										qr.onClick();
									}}
								/>
							)}
							<BarMenuRow
								icon={join.copied ? <Check size={14} /> : <Copy size={14} />}
								label={join.copied ? "Copied!" : "Copy join code"}
								title="Copy join code"
								onClick={join.onClick}
							/>
							{shareMenuRows(menuActions, close)}
						</>
					)}
				</BarMenu>
			</div>
		</>
	);
}
