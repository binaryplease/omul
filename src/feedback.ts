/**
 * Feedback about omul, from a browser (REQ185).
 *
 * The client half of the two public routes in `server/routes/feedback.ts`:
 *
 *   - **Whether to offer it.** `useFeedbackConfig()` is the one read of
 *     `GET /api/feedback/config`, once per page load and shared by every
 *     surface that asks — the way `useLegalLinks()` reads `GET /api/legal`.
 *     Until it answers, and when it fails, the channel reads as off, so a menu
 *     never offers a form whose endpoint answers `404`.
 *   - **What to send.** `buildUserFeedbackSubmission()` turns what the form
 *     holds into the body `POST /api/feedback` takes. It never carries an
 *     account: the server resolves that from the session, and only when the
 *     sender left the contact box ticked.
 *
 * The rules a form needs before anything is sent — when the send button wakes
 * up, what a second tap on the chosen star does — live here too, beside the
 * body they guard, so the form and its tests read one copy of them.
 */

import { useEffect, useState } from "react";
import { api } from "./api";
import type { Route } from "./router";
import {
	FEEDBACK_PROMPT_COOLDOWN_DAYS_DEFAULT,
	type FeedbackConfig,
	type FeedbackSurface,
	type UserFeedbackSubmission,
} from "./types";

/** The number of stars a rating is given out of. */
export const FEEDBACK_RATING_STARS = 5;

/** What a form holds when its sender presses send. */
export type FeedbackDraft = {
	/** 1–5, or `null` for no rating. */
	rating: number | null;
	comment: string;
	/** Whether the contact box is ticked — meaningless where none was drawn. */
	contactMe: boolean;
};

/**
 * The rating after a tap on star `tapped`: that star, or none when it was
 * already the chosen one — a rating is optional, so it has to be retractable.
 */
export function nextFeedbackRating(
	current: number | null,
	tapped: number,
): number | null {
	return current === tapped ? null : tapped;
}

/**
 * Whether a draft is worth sending: a rating, a comment with something in it,
 * or both. The same rule the route answers `400` by, so the button is never
 * enabled for a body the server refuses.
 */
export function canSendFeedback(
	draft: Pick<FeedbackDraft, "rating" | "comment">,
): boolean {
	return draft.rating !== null || draft.comment.trim() !== "";
}

/**
 * The body for `POST /api/feedback`. `contactOffered` is whether the form drew
 * the contact box at all: a box nobody saw cannot have been left ticked, so
 * without it `contactMe` is false whatever the draft holds.
 */
export function buildUserFeedbackSubmission(
	draft: FeedbackDraft,
	context: {
		surface: FeedbackSurface;
		language: string;
		contactOffered: boolean;
	},
): UserFeedbackSubmission {
	return {
		rating: draft.rating,
		comment: draft.comment.trim(),
		surface: context.surface,
		language: context.language,
		contactMe: context.contactOffered && draft.contactMe,
	};
}

/**
 * The kind of screen a route is, as a feedback entry records it: the screens a
 * deck is built, previewed and presented on are the presenter's, the ones a
 * code is typed into and a room joined on are the participant's, and the rest
 * — the home page, the catalogs, the workspaces, a shared results page — are
 * neither.
 */
export function feedbackSurfaceForRoute(route: Route): FeedbackSurface {
	switch (route.page) {
		case "create":
		case "edit":
		case "preview":
		case "present":
			return "presenter";
		case "join":
		case "participate":
			return "participant";
		default:
			return "other";
	}
}

/** What a screen that declares no language is written in. */
const DEFAULT_SCREEN_LANGUAGE = "en";

/**
 * The UI language of the screen an element sits on: the nearest `lang` above
 * it. The app's chrome is English (`<html lang="en">`); the participant's
 * screens are in the deck's language and say so on their own wrapper.
 */
export function screenLanguage(element: Element | null): string {
	const declared = element?.closest("[lang]")?.getAttribute("lang")?.trim();
	return declared || DEFAULT_SCREEN_LANGUAGE;
}

// ── Loading ───────────────────────────────────────────────────

/** What a surface reads before — or without — an answer: off. */
export const FEEDBACK_OFF: FeedbackConfig = {
	enabled: false,
	promptPercent: null,
	promptCooldownDays: FEEDBACK_PROMPT_COOLDOWN_DAYS_DEFAULT,
};

/**
 * One request per page load, shared by every surface that asks. A failed read
 * is forgotten, so the next surface to mount tries again, and is drawn as off
 * meanwhile — the same as an instance that never switched the channel on.
 */
let resolvedFeedbackConfig: FeedbackConfig | null = null;
let pendingFeedbackConfig: Promise<FeedbackConfig> | null = null;

function loadFeedbackConfig(): Promise<FeedbackConfig> {
	pendingFeedbackConfig ??= api.getFeedbackConfig().then(
		(config) => {
			resolvedFeedbackConfig = config;
			return config;
		},
		() => {
			pendingFeedbackConfig = null;
			return FEEDBACK_OFF;
		},
	);
	return pendingFeedbackConfig;
}

export function useFeedbackConfig(): FeedbackConfig {
	const [config, setConfig] = useState<FeedbackConfig>(
		() => resolvedFeedbackConfig ?? FEEDBACK_OFF,
	);
	useEffect(() => {
		if (resolvedFeedbackConfig) return;
		let mounted = true;
		void loadFeedbackConfig().then((loaded) => {
			if (mounted) setConfig(loaded);
		});
		return () => {
			mounted = false;
		};
	}, []);
	return config;
}
