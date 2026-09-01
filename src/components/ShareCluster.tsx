import { Check, Code, Copy, Link, Pencil, QrCode } from "lucide-react";
import { Fragment, type ReactNode } from "react";

// ── Share cluster (REQ: join-code / link / QR / embed / edit-link) ─────
//
// The presenter offers the same set of share affordances on two surfaces —
// a wide segmented bar (xl viewports) and a compact chip row (below xl) — that
// differ only by chrome density and whether text labels are shown. Per
// ADR-0026/0027 the affordance is expressed once: a pure descriptor
// (`buildShareControls`) is the single source of truth for *which* controls
// exist, their order, icons, labels, copied-state, and handlers; the
// `ShareCluster` wrapper owns *how* they render and where they sit relative to
// one another. A surface composes the wrapper with a `variant` — it never
// re-derives the control set or re-arranges the cluster.

/**
 * Shared interaction-state token (ADR-0028): the muted → accent hover treatment
 * for an icon button. Composed by every share control on both variants — never
 * re-declared inline per surface. Each variant adds its own surface chrome
 * (background/border) on top; the *interaction state* itself lives here once.
 */
export const ICON_BUTTON_HOVER =
	"transition-all group cursor-pointer text-text-muted hover:text-accent";

/** A single non-join share control (copy link, QR, embed, edit-link). */
export type ShareAction = {
	key: string;
	title: string;
	icon: ReactNode;
	/** Idle label, shown only on the labelled (bar) variant. */
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
			copied: params.copied.code,
			onClick: params.onCopyCode,
		},
		actions,
	};
}

function JoinCodeBody({
	join,
	stretch,
}: {
	join: ShareJoin;
	/** Compact chip stretches (flex-1), so push the copy icon to the edge. */
	stretch: boolean;
}) {
	return (
		<>
			<span className="text-xs text-text-muted">Join:</span>
			<span className="font-mono font-bold text-accent-text tracking-widest text-lg">
				{join.code}
			</span>
			<span
				className={`text-text-dim group-hover:text-accent transition-colors ${
					stretch ? "ml-auto" : ""
				}`}
			>
				{join.copied ? <Check size={14} /> : <Copy size={14} />}
			</span>
		</>
	);
}

/**
 * Renders the share-control cluster. `variant` selects the chrome:
 * - `bar`: a segmented pill with dividers and text labels (wide viewports).
 * - `compact`: independent icon-only chips (narrow viewports).
 * `className` carries the surface-specific shell — visibility, position, and
 * outer padding — which is the only latitude a surface has (ADR-0026).
 */
export function ShareCluster({
	variant,
	className = "",
	controls,
}: {
	variant: "bar" | "compact";
	className?: string;
	controls: ShareControls;
}) {
	const { join, actions } = controls;

	if (variant === "bar") {
		return (
			<div
				className={`${className} items-center gap-1 rounded-lg bg-surface-raised border border-border overflow-hidden`}
			>
				<button
					type="button"
					className="flex items-center gap-2 px-4 py-2 hover:bg-surface-hover transition-all group cursor-pointer"
					onClick={join.onClick}
					title="Copy join code"
				>
					<JoinCodeBody join={join} stretch={false} />
				</button>
				{actions.map((action) => (
					<Fragment key={action.key}>
						<div className="w-px h-6 bg-border" />
						<button
							type="button"
							className={`flex items-center gap-1.5 px-3 py-2 hover:bg-surface-hover ${ICON_BUTTON_HOVER}`}
							onClick={action.onClick}
							title={action.title}
						>
							{action.copied ? <Check size={14} /> : action.icon}
							<span className="text-xs">
								{action.copied ? action.copiedLabel : action.label}
							</span>
						</button>
					</Fragment>
				))}
			</div>
		);
	}

	return (
		<div className={`${className} gap-2`}>
			<button
				type="button"
				className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-raised border border-border hover:border-accent/50 transition-all group cursor-pointer flex-1"
				onClick={join.onClick}
				title="Copy join code"
			>
				<JoinCodeBody join={join} stretch={true} />
			</button>
			{actions.map((action) => (
				<button
					key={action.key}
					type="button"
					className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-raised border border-border hover:border-accent/50 ${ICON_BUTTON_HOVER}`}
					onClick={action.onClick}
					title={action.title}
				>
					{action.copied ? <Check size={14} /> : action.icon}
				</button>
			))}
		</div>
	);
}
