import type { LucideIcon } from "lucide-react";
import { Heart, Laugh, Lightbulb, PartyPopper, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { getDict } from "../i18n";
import {
	type LiveReaction,
	pruneReactions,
	REACTION_LIFETIME_MS,
} from "../reactions";
import { useStore } from "../store";
import type { ReactionKind } from "../types";
import { REACTION_KINDS } from "../types";
import { Toggle } from "./EditorControls";

// ── Reactions on any slide (REQ077) ───────────────────────────────────
//
// A reaction is the lightest thing a participant can say: one tap, no text, no
// answer, nothing counted. That makes it a cross-surface affordance in the plain
// sense — the phone sends them, the shared screen draws them,
// and both have to agree on which five there are and what each one is called —
// so it is one descriptor ({@link REACTION_ICONS}), one shared wrapper
// ({@link ReactionBar} / {@link ReactionStream}) and one set of labels.
//
// It lives in its own module rather than inside either page because it depends
// on nothing either of them owns: the closed reaction set from the
// schema, the live-reaction stream rules from `src/reactions.ts`, and the
// session slice the socket feeds.
//
// **Which five reactions there are is the server's decision, not this file's.**
// The set is a Zod enum validated at the boundary (`REACTION_KINDS`), and the
// descriptor below is indexed by it — so a reaction added to the schema is a
// type error here until it is given an icon and a name, rather than a silently
// undrawable value.

/** How one reaction is drawn and what it is called in English. */
type ReactionDescriptor = {
	/**
	 * The icon *component*, not a rendered element: the row draws it at a phone's
	 * size and the overlay at a projector's, and a descriptor holding one fixed
	 * element would force the second surface to re-declare the mapping.
	 */
	Icon: LucideIcon;
	/** The presenter's wording, and the fallback the participant's maps onto. */
	label: string;
	/** The tint the flying icon is drawn in — a Tailwind text colour class. */
	tone: string;
};

/**
 * The five reactions, drawn (REQ077).
 *
 * Icons rather than emoji, per this project's lucide-react
 * convention: an emoji is a font's opinion, and a room half of which is on a
 * platform that draws a party popper differently is a room having two different
 * conversations. The record is keyed by the schema's enum, so it cannot fall out
 * of step with what the boundary accepts.
 */
export const REACTION_ICONS: Record<ReactionKind, ReactionDescriptor> = {
	like: { Icon: ThumbsUp, label: "Nice", tone: "text-accent" },
	love: { Icon: Heart, label: "Love it", tone: "text-error" },
	celebrate: { Icon: PartyPopper, label: "Celebrate", tone: "text-warning" },
	laugh: { Icon: Laugh, label: "Funny", tone: "text-success" },
	insight: { Icon: Lightbulb, label: "Good point", tone: "text-accent" },
};

/** How big a reaction is drawn in the row a phone sends it from. */
const REACTION_BUTTON_SIZE = 18;

/**
 * And in the overlay. Larger, because that surface is a projected slide read
 * from the back of a room — the same icon at the button's size would be a speck.
 */
const REACTION_FLOAT_SIZE = 30;

/**
 * The words a reaction surface wears. The participant's is translated (REQ084)
 * and the shared screen's is not, so they arrive as a parameter — the shape
 * `QAPanel` and `Leaderboard` already take theirs in.
 */
export type ReactionLabels = {
	/** Names the row of buttons. */
	title: string;
	/** One per reaction — the accessible name of the button that sends it. */
	kinds: Record<ReactionKind, string>;
	/** Why the row cannot be used right now. */
	unavailable: string;
};

/** The presenter's wording — the shared screen is not translated. */
export const REACTION_LABELS_EN: ReactionLabels = {
	title: "Reactions",
	kinds: {
		like: REACTION_ICONS.like.label,
		love: REACTION_ICONS.love.label,
		celebrate: REACTION_ICONS.celebrate.label,
		laugh: REACTION_ICONS.laugh.label,
		insight: REACTION_ICONS.insight.label,
	},
	unavailable: "Reactions are closed for this presentation",
};

/**
 * The same labels in the deck's language (REQ084) — the one place the
 * participant-facing dictionary is mapped onto them, so the phone and the shared
 * screen wear the same wording in two languages rather than two wordings.
 */
export function reactionLabelsFor(
	dict: ReturnType<typeof getDict>,
): ReactionLabels {
	return {
		title: dict.reactionsTitle,
		kinds: {
			like: dict.reactionLike,
			love: dict.reactionLove,
			celebrate: dict.reactionCelebrate,
			laugh: dict.reactionLaugh,
			insight: dict.reactionInsight,
		},
		unavailable: REACTION_LABELS_EN.unavailable,
	};
}

/**
 * The row a reaction is sent from (REQ077).
 *
 * Every slide type gets the same row, which is the requirement: a reaction is
 * not an answer to the question on screen, so nothing about the question decides
 * whether it can be sent. There is no busy state and no confirmation — a
 * reaction that had to be acknowledged would not be the lightweight thing it is
 * meant to be, and a failed send is a reaction nobody saw rather than an answer
 * nobody recorded.
 */
export function ReactionBar({
	labels,
	onReact,
	disabled = false,
}: {
	labels: ReactionLabels;
	onReact: (kind: ReactionKind) => void;
	/** Offered and disabled rather than dropped when unusable. */
	disabled?: boolean;
}) {
	return (
		<div
			className="flex items-center justify-center gap-2"
			role="group"
			aria-label={labels.title}
		>
			{REACTION_KINDS.map((kind) => {
				const { Icon, tone } = REACTION_ICONS[kind];
				const name = disabled ? labels.unavailable : labels.kinds[kind];
				return (
					<button
						key={kind}
						type="button"
						onClick={() => !disabled && onReact(kind)}
						disabled={disabled}
						aria-label={name}
						title={name}
						className={`inline-flex items-center justify-center rounded-full border border-border bg-surface-raised p-2.5 transition hover:border-accent hover:scale-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:border-border ${tone}`}
					>
						<Icon size={REACTION_BUTTON_SIZE} />
					</button>
				);
			})}
		</div>
	);
}

/**
 * Where across the surface one reaction rises, from its own id.
 *
 * Derived rather than random for two reasons: `Math.random()` in a render puts
 * the icon on a new path every re-render, and a burst has to fan out rather than
 * stack — two hearts on the same pixel read as one heart.
 */
function reactionLane(id: string): number {
	let spread = 0;
	for (const character of id.slice(0, 8)) {
		spread = (spread * 31 + character.charCodeAt(0)) % 997;
	}
	return spread;
}

/**
 * The reactions currently crossing the screen (REQ077), drawn over whatever is
 * behind them.
 *
 * Pointer-events-none and absolutely positioned, deliberately: this floats over
 * a slide somebody is answering, and a burst of hearts must not eat a tap meant
 * for a radio button.
 *
 * It re-renders on a slow tick rather than on a timer per reaction. The stream
 * expires by age (`src/reactions.ts`), so the only thing a timer is needed for
 * is noticing that time has passed — one interval for the whole overlay does
 * that, and it stops itself when there is nothing left on screen rather than
 * ticking through a two-hour session that had one reaction in it.
 */
export function ReactionStream({ reactions }: { reactions: LiveReaction[] }) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (reactions.length === 0) return;
		const tick = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(tick);
	}, [reactions.length]);

	const alive = pruneReactions(reactions, now);
	if (alive.length === 0) return null;

	return (
		<div
			className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
			aria-hidden="true"
		>
			{alive.map((reaction, index) => {
				const { Icon, tone } = REACTION_ICONS[reaction.kind];
				// Spread across the surface from the reaction's own id, so a burst fans
				// out instead of stacking — derived rather than random, so a re-render
				// puts the same icon back on the same path. Several characters rather
				// than one: an id's first character is a hex digit and would put a
				// whole burst into a narrow band.
				const lane = (reactionLane(reaction.id) + index * 37) % 80;
				return (
					<span
						key={reaction.id}
						className={`reaction-float absolute bottom-4 ${tone}`}
						style={{
							left: `${10 + lane}%`,
							animationDuration: `${REACTION_LIFETIME_MS}ms`,
						}}
					>
						<Icon size={REACTION_FLOAT_SIZE} />
					</span>
				);
			})}
		</div>
	);
}

/**
 * The reactions currently on screen, off the session slice.
 *
 * A hook rather than a prop drilled through two pages: both surfaces draw the
 * same stream and neither owns it, and the slice is where the socket puts it.
 */
export function useLiveReactions(): LiveReaction[] {
	return useStore((state) => state.liveReactions);
}

/**
 * The switch that opens the channel (REQ077), placed on the panel that governs
 * the room's participation rather than in the page's chrome.
 *
 * The reaction overlay has no panel of its own — it is drawn over the whole
 * slide — so its switch sits beside the chat's, in the one place a presenter
 * goes to decide what this room may send besides answers.
 */
export function ReactionChannelControl({
	enabled,
	onChange,
}: {
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<Toggle
			label="Reactions from the audience"
			description="Participants can react to any slide. Reactions are shown live and are never stored or counted."
			checked={enabled}
			onChange={onChange}
		/>
	);
}
