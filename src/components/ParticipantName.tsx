import { Pencil, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { getDict } from "../i18n";
import { PARTICIPANT_NAME_MAX_LENGTH } from "../types";
import type { ParticipantRosterEntry } from "../types";
import { ICON_BUTTON_HOVER } from "./ShareCluster";

// ── Participant names (REQ076) ────────────────────────────────
//
// A deck can ask the people joining it to say who they are. That question has
// two surfaces and they are genuinely different screens — the phone that
// answers it, and the organizer's roster of who answered — so both live here,
// beside each other, for the reason `QAPanel` holds both ends of the Q&A layer:
// the invariant they share is what a participant is *called on this deck*,
// and a second module would be a second answer to it.
//
// The module depends on nothing either page owns: the cap from the
// schema, the participant dictionary for the phone's wording (REQ084), and the
// shared hover token for its one icon button.
//
// **The gate is a gate and not a nag.** Until a name is stated the participant
// screen shows this and nothing else — no slide, no question, no answer control
// — because a deck that *requires* a name has to be able to say the room stated
// one. What it is not is a wall: nothing here can fail in a way that traps
// somebody, so a refused write leaves the field and its reason on screen rather
// than an empty room.

/**
 * The words the name surfaces wear. The participant's are translated (REQ084)
 * and the organizer's roster is not, so they arrive as a parameter — the shape
 * `QAPanel`, `ReactionBar` and `ChatPanel` already take theirs in.
 */
export type ParticipantNameLabels = {
	/** The question itself, and what becomes of the answer. */
	title: string;
	intro: string;
	placeholder: string;
	/** The button that states it, and its stated reason when it cannot act. */
	submit: string;
	empty: string;
	/** How a stated name is reported back, and the control that corrects it. */
	joinedAs: string;
	change: string;
	cancel: string;
};

/** The organizer's wording — the presenter's screen is not translated. */
export const PARTICIPANT_NAME_LABELS_EN: ParticipantNameLabels = {
	title: "What's your name?",
	intro:
		"This presentation asks everyone joining to say who they are. Your name is stored with your answers and shown to the organizer.",
	placeholder: "Your name",
	submit: "Continue",
	empty: "Enter your name to continue",
	joinedAs: "Joined as",
	change: "Change",
	cancel: "Cancel",
};

/**
 * The same labels in the deck's language (REQ084) — the one place the
 * participant-facing dictionary is mapped onto them, so the question a room is
 * asked and the question this module draws cannot come to differ.
 */
export function participantNameLabelsFor(
	dict: ReturnType<typeof getDict>,
): ParticipantNameLabels {
	return {
		title: dict.nameTitle,
		intro: dict.nameIntro,
		placeholder: dict.namePlaceholder,
		submit: dict.nameContinue,
		empty: dict.nameEmpty,
		joinedAs: dict.nameJoinedAs,
		change: dict.nameChange,
		cancel: dict.nameCancel,
	};
}

/**
 * Whether this browser still owes the deck a name (REQ076).
 *
 * Pure and exported, because it is the one predicate that decides whether the
 * participant screen draws a slide at all — and a predicate that lives in the
 * page is one no test can ask about without rendering the page.
 *
 * A deck that does not require a name never owes one, whatever this browser
 * happens to have stored: turning the switch off mid-session must return the
 * room to the deck rather than leave it holding a question nobody is asking.
 */
export function participantNameOutstanding(
	deck: { requireParticipantName?: boolean } | null,
	statedName: string,
): boolean {
	if (!deck?.requireParticipantName) return false;
	return statedName.trim().length === 0;
}

/**
 * The door: the question, the field and the button that answers it.
 *
 * Used twice from one definition — as the screen a participant meets before
 * their first slide, and as the same screen re-opened to correct a typo, which
 * is the only difference `onCancel` makes. A correction is the same write as the
 * first statement (one row per participant, overwritten in place), so it must
 * not be a second form with a second set of rules.
 */
export function ParticipantNameGate({
	labels,
	initialName = "",
	busy = false,
	error = "",
	onSubmit,
	onCancel,
}: {
	labels: ParticipantNameLabels;
	/** What to prefill — the name being corrected, or nothing at the door. */
	initialName?: string;
	/** Whether a statement is in flight, so the button cannot fire twice. */
	busy?: boolean;
	/** Why the last attempt did not land, or `""` when none has failed. */
	error?: string;
	onSubmit: (name: string) => void;
	/** Offered only when there is something to go back to — see above. */
	onCancel?: () => void;
}) {
	const [name, setName] = useState(initialName);
	const typed = name.trim();

	return (
		<div className="w-full max-w-sm flex flex-col items-center gap-4">
			<UserRound size={28} className="text-accent" />
			<h2 className="text-2xl font-bold text-center">{labels.title}</h2>
			<p className="text-sm text-text-muted text-center">{labels.intro}</p>

			{error && (
				<p className="w-full rounded-lg border border-error/30 bg-error/10 p-3 text-center text-sm text-error">
					{error}
				</p>
			)}

			<input
				className="input w-full text-center"
				value={name}
				placeholder={labels.placeholder}
				maxLength={PARTICIPANT_NAME_MAX_LENGTH}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && typed && !busy) onSubmit(typed);
				}}
				aria-label={labels.placeholder}
				// intentional — this screen exists to take one field
				autoFocus
			/>

			{/* The button is drawn and disabled with its reason, never
			    hidden, so an empty field explains itself instead of reading as a
			    form that has stopped working. */}
			<button
				type="button"
				className="btn-primary w-full"
				disabled={!typed || busy}
				title={typed ? labels.submit : labels.empty}
				onClick={() => onSubmit(typed)}
			>
				{labels.submit}
			</button>
			{!typed && <p className="text-xs text-text-dim">{labels.empty}</p>}

			{onCancel && (
				<button
					type="button"
					className="text-sm text-text-muted hover:text-text transition-colors"
					onClick={onCancel}
				>
					{labels.cancel}
				</button>
			)}
		</div>
	);
}

/**
 * The stated name, reported back above the slide with the control that corrects
 * it beside it.
 *
 * Adjacent to what it changes: the name is shown here, so this is
 * where it is edited — not in a settings screen a participant on a phone would
 * have to leave the question to find. Small and quiet, because it is a
 * confirmation rather than a feature: the participant's attention belongs to the
 * slide underneath.
 */
export function ParticipantNameBadge({
	labels,
	name,
	onChange,
}: {
	labels: ParticipantNameLabels;
	name: string;
	onChange: () => void;
}) {
	return (
		<div className="flex items-center gap-1.5 text-xs text-text-muted">
			<UserRound size={12} />
			<span>
				{labels.joinedAs} <span className="text-text">{name}</span>
			</span>
			<button
				type="button"
				className={`${ICON_BUTTON_HOVER} inline-flex items-center p-1`}
				onClick={onChange}
				title={labels.change}
				aria-label={labels.change}
			>
				<Pencil size={12} />
			</button>
		</div>
	);
}

// ── The organizer's roster ────────────────────────────────────

/** How often an open roster panel re-reads itself while a session is running. */
export const ROSTER_POLL_MS = 5000;

/** What the roster panel is called, and what it says when it holds nothing. */
export function participantRosterHeading(
	roster: ParticipantRosterEntry[] | null,
): string {
	if (!roster) return "Participants";
	return `Participants (${roster.length})`;
}

/**
 * The deck's roster, kept current while the panel is open (REQ076).
 *
 * Polled rather than driven off a broadcast, and that is a deliberate limit
 * worth stating rather than discovering: nothing on the socket announces a name
 * — the write is not a room event and must not become one, since a frame saying
 * "Ada joined" would put a name on every phone in the room. So this re-reads on
 * a clock, and only while somebody is actually looking: the panel is closed by
 * default and the interval stops with it, so a two-hour session nobody opened
 * this on costs no requests at all.
 *
 * Fetched only when `open`, for the same reason and one more: the endpoint is
 * gated on editing the deck, so a spectator's browser would spend the whole
 * session collecting 401s.
 */
export function useParticipantRoster(
	presentationId: string | null,
	open: boolean,
): ParticipantRosterEntry[] | null {
	const [roster, setRoster] = useState<ParticipantRosterEntry[] | null>(null);

	useEffect(() => {
		if (!presentationId || !open) {
			setRoster(null);
			return;
		}
		let current = true;
		const read = () => {
			api
				.getParticipantRoster(presentationId)
				.then((entries) => {
					if (current) setRoster(entries);
				})
				.catch(() => {});
		};
		read();
		const timer = setInterval(read, ROSTER_POLL_MS);
		return () => {
			current = false;
			clearInterval(timer);
		};
	}, [presentationId, open]);

	return roster;
}

/**
 * Who took part, by name (REQ076) — the organizer's side of the same question.
 *
 * Read on the presenter's screen, which is the one being projected, so it is
 * drawn only when deliberately opened — the rule the chat transcript, the Q&A
 * queue and the presenter's notes are all held to on that surface. A list of
 * the room's names is exactly the kind of thing that must not put itself on a
 * wall.
 *
 * A deck that asked for names and has not been given any yet says so rather
 * than drawing an empty box; a room that answered without stating names is not
 * padded with blank rows, and the note says where those people are counted
 * instead (the export, REQ095) so nobody goes looking for a control.
 */
export function ParticipantRosterPanel({
	roster,
	requiresName,
}: {
	roster: ParticipantRosterEntry[] | null;
	/** Whether the deck asks for names at all — what an empty list means. */
	requiresName: boolean;
}) {
	if (!requiresName) {
		return (
			<p className="text-sm text-text-dim">
				This deck does not ask participants for a name, so there is no roster.
				Turn it on in the editor to collect one.
			</p>
		);
	}

	if (!roster) {
		return <p className="text-sm text-text-dim">Loading participants...</p>;
	}

	if (roster.length === 0) {
		return (
			<p className="text-sm text-text-dim">
				Nobody has stated a name yet — the question is asked as each participant
				joins.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<ul className="flex flex-col gap-1">
				{roster.map((entry) => (
					<li
						key={entry.participantId}
						className="flex items-baseline justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2"
					>
						<span className="min-w-0 truncate text-sm">{entry.name}</span>
						<span className="shrink-0 font-mono text-xs text-text-muted">
							{entry.answeredSlides === 1
								? "1 slide"
								: `${entry.answeredSlides} slides`}
						</span>
					</li>
				))}
			</ul>
			<p className="text-xs text-text-dim">
				Anyone who answered without stating a name is not listed here — they are
				in the results export, under their participant id.
			</p>
		</div>
	);
}
