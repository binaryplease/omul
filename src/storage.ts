// ── What this browser holds ────────────────────────────────────────────
//
// Every `localStorage` key this application writes, in one place.
//
// One module rather than a constant beside each consumer, because these keys
// hold the only copy of things the server cannot re-issue: a deck's edit token
// is returned once and stored only as a hash on the server, so a key a refactor
// gets wrong is a presentation its organizer can no longer edit, from any
// browser, for ever. There is no recovery path and no message that would
// explain it. So the keys are declared once and every read site
// imports its key from here rather than spelling one.

/** Every deck's edit token, as a map of presentation id → plaintext token. */
export const TOKEN_KEY = "omul-tokens";

/** Every deck's results-link token this browser has been handed (REQ098). */
export const RESULTS_TOKEN_KEY = "omul-results-tokens";

/** This browser's participant identity — the id every answer is attributed to. */
export const PARTICIPANT_ID_KEY = "omul-participant-id";

/** The name this browser stated, per deck (REQ076). */
export const PARTICIPANT_NAME_KEY = "omul-participant-names";

/**
 * Every deck this browser saw in `draft` or `live`, as a map of presentation id
 * → when it last did (REQ186, `src/feedback-prompt.ts`).
 */
export const FEEDBACK_PROMPT_IN_ROOM_KEY = "omul-feedback-prompt-in-room";

/** When this browser was last asked the post-session question (REQ186). */
export const FEEDBACK_PROMPT_ASKED_AT_KEY = "omul-feedback-prompt-asked-at";

/** The light/dark/auto preference (`src/components/ui/Theme.tsx`). */
export const THEME_KEY = "omul-theme";

/** The address of an email change waiting on its two mail round-trips. */
export const PENDING_EMAIL_CHANGE_KEY = "omul:pending-email-change";
