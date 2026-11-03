import { EyeOff, Lock, LockOpen } from "lucide-react";
import { DeckMark } from "./DeckTheme";
import type { LiveRoomState, Presentation } from "../types";
import { audienceViewBlanked, slideAcceptsSubmissions } from "../types";
import type { getDict } from "../i18n";

// ── The live room's two switches (REQ111, REQ109) ─────────────
//
// Everything the presenter decides about the room *while it is in front of
// them*, and nothing about the deck itself. There are exactly two things here
// and they are written together because they are the two REQ109 exists to keep
// apart:
//
//  - **Participation** (REQ111) — whether the slide on screen is taking
//    answers. The presenter's control, and the reason a phone gives for a dead
//    control, are one descriptor with two readings.
//  - **The blank screen** (REQ109) — whether the shared screen is showing
//    anything. It stops nothing: the slide does not move, the question stays
//    open, and every answer already given is still there.
//
// One module rather than two files of four exports each, and the shared thing
// is real: both read live-room state off the same deck, both are held by the
// presenter alone, and every surface that draws one is a surface that has to
// know about the other — the shared screen that blanks is the shared screen
// carrying the participation control, and the phone that is told a question is
// closed is the phone that must *not* be told the room's screen went dark.
//
// The predicates themselves are not here. `slideAcceptsSubmissions` and
// `audienceViewBlanked` live in `server/schemas.ts` and are re-exported through
// `src/types.ts`, because the boundary enforces the first of them and a second
// reading on the client is how a phone comes to draw a live control over a
// refusal.

// ── Participation (REQ111) ───────────────────────────────────

/**
 * What a participant is told about a slide that is not taking answers.
 *
 * A shape rather than a bare string so the mapping from the participant
 * dictionary (REQ084) has somewhere to land, exactly as `qaLabelsFor` and
 * `chatLabelsFor` do next door — and so a second line added later has one place
 * to be added to rather than one per surface.
 */
export type ParticipationLabels = {
	/** Why the control in front of them is dead. */
	closed: string;
};

/** The participation wording in the deck's language (REQ084). */
export function participationLabelsFor(
	dict: ReturnType<typeof getDict>,
): ParticipationLabels {
	return { closed: dict.participationClosed };
}

/**
 * There is deliberately no `PARTICIPATION_LABELS_EN` beside this, unlike the
 * Q&A layer and the chat: the presenter's screen never wears the gate. It
 * carries the *control*, which names the state it is in in the product's own
 * language ({@link slideParticipationToggleLabel}), and a second statement of
 * the same fact on the same screen would be one more thing on a projector.
 */

/**
 * What the presenter's participation control is called, in the state it is in
 * (the name is part of the affordance).
 *
 * It is drawn whatever the viewer's standing and disabled with its reason for a
 * spectator rather than dropped: whether the room can answer is a
 * fact about this session, and a control that vanished would leave a
 * `view` collaborator unable to tell a closed question from an open one.
 *
 * `live` is whether the deck is running (REQ198). Before the start, or after
 * the end, there is no room and nothing collected to keep: a slide closed then
 * goes live closed and opens on the presenter's cue, so that is what it says.
 */
export function slideParticipationToggleLabel({
	open,
	canControl,
	live,
}: {
	open: boolean;
	canControl: boolean;
	live: boolean;
}): string {
	if (!canControl) {
		if (!live) {
			return open
				? "This slide will go live open to submissions — you cannot edit this presentation, so it is not yours to close"
				: "This slide will go live closed to submissions — you cannot edit this presentation, so it is not yours to reopen";
		}
		return open
			? "This slide is open to submissions — you cannot edit this presentation, so it is not yours to close"
			: "This slide is closed to submissions — you cannot edit this presentation, so it is not yours to reopen";
	}
	if (!live) {
		return open
			? "Close this slide before the start — it will go live closed, and the room can answer it only once you reopen it"
			: "Reopen this slide — it will go live open, so the room can answer it from the start";
	}
	return open
		? "Close this slide — the room stops being able to answer it, and every answer already given is kept"
		: "Reopen this slide — the room can answer it again, alongside the answers already collected";
}

/** The words on the control itself, in the same two readings (REQ198). */
export function slideParticipationControlText({
	open,
	live,
}: {
	open: boolean;
	live: boolean;
}): string {
	if (!live) return open ? "Go live closed" : "Goes live closed — reopen";
	return open ? "Close submissions" : "Submissions closed — reopen";
}

/**
 * What the presenter is told once the switch has been thrown — the control's
 * own wording, so the toast cannot promise what the control did not say.
 */
export function slideParticipationToast({
	open,
	live,
}: {
	open: boolean;
	live: boolean;
}): string {
	if (!live) {
		return open
			? "This slide will go live open to submissions"
			: "This slide will go live closed — reopen it when you want the room to answer";
	}
	return open
		? "Submissions reopened on this slide"
		: "Submissions closed on this slide — the answers already given are kept";
}

/**
 * What starting a deck tells the presenter about the slides that begin closed
 * (REQ198), or `null` when none do. A slide closed on the draft — or left closed
 * by the last session, since End keeps them — refuses every answer until it is
 * reopened, and that is the one moment the presenter must hear it.
 *
 * Slides are named by the number the presenter's counter shows, in deck order;
 * a closed id whose slide has since been deleted names nothing and is skipped.
 */
export function closedAtStartNotice(
	deck: Pick<Presentation, "slides" | "closedSlideIds">,
): string | null {
	const closedNumbers = deck.slides.flatMap((slide, slideIndex) =>
		slideAcceptsSubmissions(deck, slide.id) ? [] : [slideIndex + 1],
	);
	if (closedNumbers.length === 0) return null;
	if (closedNumbers.length === 1) {
		return `Slide ${closedNumbers[0]} starts closed — reopen it when you want the room to answer`;
	}
	const leading = closedNumbers.slice(0, -1).join(", ");
	const last = closedNumbers[closedNumbers.length - 1];
	return `Slides ${leading} and ${last} start closed — reopen each when you want the room to answer`;
}

/**
 * The presenter's open/close control, on the slide it governs.
 *
 * It sits beside the reveal and the timer restart rather than in the page's
 * chrome, because all three are decisions about *this question*. It is drawn
 * before the start as well: a slide closed on a draft goes live closed and
 * opens on the presenter's cue (REQ198), which is why its wording follows
 * `live`.
 */
export function SlideParticipationControl({
	open,
	canControl,
	live,
	onChange,
}: {
	open: boolean;
	canControl: boolean;
	live: boolean;
	onChange: (open: boolean) => void;
}) {
	const label = slideParticipationToggleLabel({ open, canControl, live });
	return (
		<button
			type="button"
			onClick={() => onChange(!open)}
			disabled={!canControl}
			aria-pressed={!open}
			aria-label={label}
			title={label}
			className={`inline-flex items-center gap-1.5 text-xs underline transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
				open ? "text-text-muted hover:text-text" : "text-warning"
			}`}
		>
			{open ? <LockOpen size={13} /> : <Lock size={13} />}
			{slideParticipationControlText({ open, live })}
		</button>
	);
}

/**
 * The participant's half of the same switch: the answer controls, dead while
 * the presenter has this slide closed, and the reason they are dead.
 *
 * **A `<fieldset disabled>` rather than a `disabled` prop threaded through a
 * dozen branches.** Every control a participant answers with is a form control,
 * so one native ancestor turns all of them off at once — and, more to the
 * point, turns off the ones somebody adds next year without this component
 * being edited. `display: contents` means the box is not there at all, so
 * wrapping the slide moves nothing on screen.
 *
 * **`display: contents` on a `<fieldset>` carries the box resets beside it on
 * purpose.** The precedents one layer up (`DeckThemeScope`,
 * `SlideAppearanceScope`) put it on a plain `<div>`; a fieldset is
 * form-associated and has UA-defined rendering of its own, so those do not
 * vouch for this one. The resets cost nothing while `contents` is honoured —
 * there is no box for a width, margin, padding or border to apply to — and if a
 * renderer ever computes the element to a block instead, they are what keeps
 * the answer controls laid out as they were rather than collapsing to their
 * content inside the participant column's `items-center`. The `disabled`
 * behaviour is DOM semantics and is unaffected by layout either way.
 *
 * **It is not the enforcement, and must not be read as if it were.** A closed
 * slide is refused at the boundary with a stated reason (REQ111), on every
 * slide type and whatever a client draws; this exists so the phone tells the
 * truth about what the tap in front of it will do. The two surfaces that answer
 * by tapping a *picture* rather than a form control — the pin canvas and the
 * grid plot — are not reachable by a fieldset at all, which is why the vote
 * transport is guarded too and reports this same string.
 *
 * The notice sits **above** the question rather than under one control: what is
 * closed is the whole slide, not the button somebody happened to reach first.
 */
export function ParticipationGate({
	open,
	labels,
	children,
}: {
	open: boolean;
	labels: ParticipationLabels;
	children: React.ReactNode;
}) {
	return (
		<>
			{!open && (
				<p
					role="status"
					className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2 text-center text-sm text-text-muted"
				>
					<Lock size={14} />
					{labels.closed}
				</p>
			)}
			<fieldset disabled={!open} className="contents m-0 w-full border-0 p-0">
				{children}
			</fieldset>
		</>
	);
}

// ── The blank screen (REQ109) ────────────────────────────────

/**
 * What the presenter's blank control is called, in the state it is in.
 *
 * Spelled out because the chip carries an icon and no text, so this string is
 * the whole control — and because "blank" on its own says nothing about the one
 * thing an organizer needs to know before pressing it: that it costs them
 * nothing they have collected.
 */
export function audienceBlankToggleLabel({
	blanked,
	canControl,
}: {
	blanked: boolean;
	canControl: boolean;
}): string {
	if (!canControl) {
		return blanked
			? "The shared screen is blanked — you cannot edit this presentation, so it is not yours to bring back"
			: "Blank the shared screen — you cannot edit this presentation, so its screen is not yours to blank";
	}
	return blanked
		? "Show the slide again — the shared screen comes back exactly where it was"
		: "Blank the shared screen — the room's screen goes dark on this slide, and nothing else changes: the deck stays here, submissions are left as they are and every answer is kept";
}

/** What stands in the slide's place while the shared screen is blanked. */
export const AUDIENCE_BLANK_TITLE = "The screen is blank";

/**
 * Which of its two screens the shared surface is drawing right now (REQ109).
 *
 * A named decision rather than a `blanked ? … : …` inside the page, because of
 * what the answer has to mean: `"blank"` is not "swap the middle column", it is
 * **the deck is not on this screen** — no question, no title, no join code, no
 * rail of what is coming next, no open panel of what the room has been saying.
 * The presenter's laptop *is* the projector, so anything still drawn beside the
 * curtain is drawn in front of the room, and a rail of slide titles is the room
 * reading the questions off a screen that says it is blank.
 *
 * The page composes this as an **early return**, so on the `"blank"` path there
 * is no deck-bearing JSX to forget to hide — which is the shape of the bug this
 * function exists to make unrepeatable, not merely to describe.
 */
export type SharedScreenView = "deck" | "blank";

export function sharedScreenView(deck: LiveRoomState | null): SharedScreenView {
	return deck && audienceViewBlanked(deck) ? "blank" : "deck";
}

/**
 * The curtain the shared screen wears while it is blanked (REQ109).
 *
 * Deliberately something rather than nothing: a projector that simply went dark
 * is indistinguishable from one that has lost its signal, and the room would
 * spend the pause the presenter just bought wondering whether the laptop had
 * died. The deck's own mark and one line of explanation say the screen is like
 * this on purpose.
 *
 * The way back is **on the curtain**, not only in the chrome (an affordance sits
 * beside what it changes): the presenter is looking at the thing they need to
 * undo, and a
 * control that lived only in a header they have to hunt for is how a room sits
 * in front of a blank wall a beat too long. A spectator sees the curtain
 * without the button — the screen really is blanked for them, and there is
 * nothing here for them to correct.
 *
 * `controls` is the one thing allowed on screen beside it, and the rule for
 * what may go in it is narrow: **a control names what it does, never what the
 * deck says.** "Close submissions", "Next", "3 / 12" tell the room nothing;
 * a slide title, a tally, a join code or a chat transcript tell it everything.
 * The slot exists because the presenter's screen is also the presenter's
 * console — blanking to talk over a question and then wanting to close it must
 * not force them to put the question back in front of the room first — and it
 * is drawn only for a viewer who can actually act on it.
 */
export function AudienceBlankCurtain({
	deck,
	canControl,
	onShow,
	controls = null,
}: {
	deck: Presentation | null;
	canControl: boolean;
	onShow: () => void;
	controls?: React.ReactNode;
}) {
	return (
		<div className="flex w-full flex-col items-center justify-center gap-4 py-24 text-center">
			<DeckMark deck={deck} size="sm" fallback="none" />
			<EyeOff size={32} className="text-text-dim" />
			<p className="text-lg font-semibold text-text-muted">
				{AUDIENCE_BLANK_TITLE}
			</p>
			{/* What it says has to be true whatever else the presenter has done, so
			    it states what blanking *did not* touch rather than the state of
			    anything: this screen can be blank while the question on it is also
			    closed (REQ111), and a curtain claiming the question was open would
			    be reporting the other switch's state and getting it wrong. */}
			<p className="max-w-sm text-sm text-text-dim">
				The room sees nothing on the shared screen. Nothing else changed — the
				deck has not moved, submissions are as you left them, and every answer
				is still here.
			</p>
			{canControl && (
				<button type="button" className="btn-primary mt-2" onClick={onShow}>
					Show the slide again
				</button>
			)}
			{canControl && controls && (
				<div className="mt-6 flex w-full max-w-md flex-col items-center gap-4 border-t border-border pt-6">
					{controls}
				</div>
			)}
		</div>
	);
}
