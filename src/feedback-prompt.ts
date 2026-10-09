/**
 * Whether a participant is asked about omul after a session (REQ186).
 *
 * The prompt on the ended screen goes to a sample of the room, once, and only
 * when all four of these hold — `shouldAskForParticipantFeedback()` is the one
 * place they are combined:
 *
 *   1. **The prompt is on**: `promptPercent` in `GET /api/feedback/config` is a
 *      number (`useFeedbackConfig()` in `src/feedback.ts`).
 *   2. **This device was in the room.** The participant page records every deck
 *      it observes in `draft` or `live` (`rememberDeckSeenInRoom()`); a device
 *      that first opens a deck after it ended was never in that room, and is
 *      never asked about it.
 *   3. **The participant is in the sample.** `isInFeedbackSample()` draws from
 *      the participant id, the deck and the run's `sessionStartedAt`, so a reload
 *      draws the same answer, a re-run draws afresh, and the draw happens here
 *      alone — nothing about it is sent, so the server never learns who was
 *      sampled. A deck that never went live has no run to ask about.
 *   4. **The device is outside the cooldown**: it was last asked — answered or
 *      dismissed, `rememberAskedForFeedback()` — at least `promptCooldownDays`
 *      ago, or never.
 *
 * Both records live on the device and nowhere else (keys in `src/storage.ts`).
 * A browser that loses its storage loses them: it reads as never in any room,
 * so it is asked about nothing it did not attend after that, and as never
 * asked, so the cooldown starts over. Neither is a reason to keep them anywhere
 * the server could read.
 */

import {
	FEEDBACK_PROMPT_ASKED_AT_KEY,
	FEEDBACK_PROMPT_IN_ROOM_KEY,
} from "./storage";
import type { FeedbackConfig, Presentation } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── The sample ────────────────────────────────────────────────

/**
 * A 32-bit hash of a string: FNV-1a over its UTF-16 code units, then
 * MurmurHash3's finalizer, so that inputs differing in one character — two
 * participant ids, two runs of a deck — land far apart rather than in
 * neighbouring buckets. Not a secret and not meant to be one: it only has to
 * spread evenly and give the same answer everywhere.
 */
function hash32(input: string): number {
	let hash = 0x811c9dc5;
	for (let position = 0; position < input.length; position++) {
		hash ^= input.charCodeAt(position);
		hash = Math.imul(hash, 0x01000193);
	}
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x85ebca6b);
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 0xc2b2ae35);
	hash ^= hash >>> 16;
	return hash >>> 0;
}

/**
 * Whether this participant is in the share of the room asked about this run of
 * this deck, for a share of `percent` out of 100.
 *
 * Pure: the same participant, deck and run always draw the same answer. A run
 * is named by its `sessionStartedAt`, so a reset and re-run (REQ101) is a new
 * draw; a deck whose `sessionStartedAt` is null never went live, and asks
 * nobody.
 */
export function isInFeedbackSample(draw: {
	participantId: string;
	presentationId: string;
	sessionStartedAt: string | null;
	percent: number;
}): boolean {
	if (draw.sessionStartedAt === null) return false;
	const hash = hash32(
		[draw.participantId, draw.presentationId, draw.sessionStartedAt].join("\n"),
	);
	return (hash / 2 ** 32) * 100 < draw.percent;
}

// ── The cooldown ──────────────────────────────────────────────

/**
 * Whether a device last asked at `lastAskedAt` (epoch ms, `null` for never) may
 * be asked again at `now`.
 */
export function isOutsideFeedbackPromptCooldown(
	lastAskedAt: number | null,
	cooldownDays: number,
	now: number,
): boolean {
	return lastAskedAt === null || now - lastAskedAt >= cooldownDays * DAY_MS;
}

/**
 * When this device was last asked, or `null` for never — and for a stored value
 * that is not a time, which this browser did not write.
 */
export function lastAskedForFeedbackAt(): number | null {
	try {
		const stored = Number(localStorage.getItem(FEEDBACK_PROMPT_ASKED_AT_KEY));
		return Number.isFinite(stored) && stored > 0 ? stored : null;
	} catch {
		return null;
	}
}

/**
 * Record that this device was asked just now. Called on an answer and on a
 * dismissal alike: dismissing counts as being asked.
 */
export function rememberAskedForFeedback(now: number = Date.now()): void {
	try {
		localStorage.setItem(FEEDBACK_PROMPT_ASKED_AT_KEY, String(now));
	} catch {
		// Storage denied. The device cannot remember being asked, so the cooldown
		// cannot hold across a reload; the card it just closed stays closed.
	}
}

// ── Being in the room ─────────────────────────────────────────

/**
 * Every deck this device saw in `draft` or `live`, or `{}` where there is
 * nothing usable to read — the shape is checked, not only the parse, for the
 * reason `getParticipantNameMap()` in `src/api.ts` gives.
 */
function getInRoomMap(): Record<string, number> {
	try {
		const parsed = JSON.parse(
			localStorage.getItem(FEEDBACK_PROMPT_IN_ROOM_KEY) || "{}",
		);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, number>)
			: {};
	} catch {
		return {};
	}
}

/** Whether this device saw the deck in `draft` or `live` on some visit. */
export function hasSeenDeckInRoom(presentationId: string): boolean {
	return typeof getInRoomMap()[presentationId] === "number";
}

/**
 * Record that this device sees the deck in `draft` or `live` now. The
 * participant page calls it whenever it observes either; it is idempotent, so
 * calling it again only moves the time.
 */
export function rememberDeckSeenInRoom(
	presentationId: string,
	now: number = Date.now(),
): void {
	try {
		const map = getInRoomMap();
		map[presentationId] = now;
		localStorage.setItem(FEEDBACK_PROMPT_IN_ROOM_KEY, JSON.stringify(map));
	} catch {
		// Storage denied. This device will read as never in the room, so it is
		// never asked about this deck — the safe side of the rule.
	}
}

// ── The decision ──────────────────────────────────────────────

/**
 * Whether this participant is asked about omul now, on this deck: all four of
 * the conditions above, the cheapest first. The storage is read only once the
 * prompt is on, so an instance that never switched it on touches nothing.
 */
export function shouldAskForParticipantFeedback(context: {
	config: Pick<FeedbackConfig, "promptPercent" | "promptCooldownDays">;
	deck: Pick<Presentation, "id" | "sessionStartedAt">;
	participantId: string;
	now?: number;
}): boolean {
	const { config, deck, participantId, now = Date.now() } = context;
	if (config.promptPercent === null) return false;
	if (
		!isInFeedbackSample({
			participantId,
			presentationId: deck.id,
			sessionStartedAt: deck.sessionStartedAt,
			percent: config.promptPercent,
		})
	) {
		return false;
	}
	if (!hasSeenDeckInRoom(deck.id)) return false;
	return isOutsideFeedbackPromptCooldown(
		lastAskedForFeedbackAt(),
		config.promptCooldownDays,
		now,
	);
}
