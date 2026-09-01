// ── API client for omul ───────────────────────────────────

import { filenameFromContentDisposition } from "./download";
import {
	type DeckAccessLevel,
	type DeckBrand,
	type DeckCollaborator,
	type DeckGenerationAvailability,
	type DeckTemplate,
	type DeckThemeId,
	isVoteRefusalCode,
	isWithheldTally,
	type ParticipantRosterEntry,
	type ReactionKind,
	RESULTS_TOKEN_HEADER,
	type ResultsLink,
	type ResultsVisibility,
	type SlideComment,
	type VoteRefusalCode,
	withFreshSlideIds,
	type Workspace,
	type WorkspaceMember,
	type WorkspaceRole,
} from "./types";
import {
	PARTICIPANT_ID_KEY,
	PARTICIPANT_NAME_KEY,
	RESULTS_TOKEN_KEY,
	TOKEN_KEY,
} from "./storage";

const BASE = "";

/**
 * A refused request, keeping what the error body *said* beyond its prose. The
 * `refused` code is how a stated vote refusal (REQ054/REQ057/REQ111) reaches
 * the UI machine-readably, so the participant screen can name the reason in
 * the deck's own language (REQ084) instead of guessing it from local state.
 */
export class ApiError extends Error {
	readonly refused: VoteRefusalCode | null;

	constructor(message: string, refused: VoteRefusalCode | null) {
		super(message);
		this.name = "ApiError";
		this.refused = refused;
	}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}/api${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		// `error` is this API's own vocabulary; `summary`/`message` are what a
		// validation refusal at the framework layer carries instead — better
		// news than a bare status line for the surfaces with no gate of their
		// own in front of the write.
		throw new ApiError(
			err.error || err.summary || err.message || res.statusText,
			isVoteRefusalCode(err.refused) ? err.refused : null,
		);
	}
	return res.json();
}

// ── Creator token storage ─────────────────────────────────────
//
// Tokens are stored in localStorage as a JSON map of presentationId → plaintext token.
// The server stores only the SHA-256 hash. Tokens are returned once (on creation) and
// must be persisted by the client. Losing localStorage = losing write access.
// The key itself lives in `src/storage.ts`, with every other key this browser
// holds and the retired spelling it was renamed from (REQ175).

function getTokenMap(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(TOKEN_KEY) || "{}");
	} catch {
		return {};
	}
}

/** Look up the creator token for a specific presentation, or null if not stored. */
export function getCreatorToken(presentationId: string): string | null {
	return getTokenMap()[presentationId] ?? null;
}

/** Persist a creator token for a presentation (called after creation). */
function setCreatorToken(presentationId: string, token: string): void {
	const map = getTokenMap();
	map[presentationId] = token;
	localStorage.setItem(TOKEN_KEY, JSON.stringify(map));
}

/**
 * Accept a creator token received via a share-edit link (URL fragment
 * `#share=<token>` on `/edit/:id`). Stores it in the same token map the
 * original creator's browser uses, granting full edit/delete authority.
 */
export function acceptShareToken(presentationId: string, token: string): void {
	setCreatorToken(presentationId, token);
}

/**
 * Forget this browser's copy of a deck's edit token.
 *
 * One caller today, and it is the reason this exists rather than the map being
 * left to grow: moving a deck into a workspace (REQ128) retires the token
 * server-side, so a copy kept here would be a credential that authorizes nothing
 * — and, worse, one that `authHeaders` would keep attaching to every mutation on
 * a deck the caller now reaches by their membership instead.
 */
function forgetCreatorToken(presentationId: string): void {
	const map = getTokenMap();
	delete map[presentationId];
	localStorage.setItem(TOKEN_KEY, JSON.stringify(map));
}

/**
 * Build the Authorization header for a presentation mutation.
 * Returns an empty object if no token is stored (the request will fail with 401).
 */
function authHeaders(presentationId: string): Record<string, string> {
	const token = getCreatorToken(presentationId);
	return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Downloading one of the deck's exports (REQ095, REQ096) ────
//
// Two formats now leave the building through the same door — the results
// workbook and the deck's PDF — and everything about the trip is the same for
// both: not a `request()` call, because the response is a file rather than
// JSON; the stored edit token has to ride it, because both endpoints are
// authorized as an edit (they carry raw per-participant responses and every
// quiz answer key); and a failure still comes back as JSON, so it reads the way
// every other call's failure reads. One helper, so a third format cannot arrive
// with its own idea of any of that (ADR-0026).

/** A file the browser has, and the name it should be saved under. */
export type DownloadedExport = { blob: Blob; filename: string };

/**
 * Fetch one export of a deck as a saveable file.
 *
 * The filename is the server's (`Content-Disposition`) rather than a second
 * slug derived here, so the file on disk is the one the endpoint named;
 * `fallbackFilename` only stands in for a response that named none at all,
 * which would otherwise save as a file with no name.
 */
async function downloadExport(
	presentationId: string,
	path: string,
	fallbackFilename: string,
): Promise<DownloadedExport> {
	const response = await fetch(
		`${BASE}/api/presentations/${presentationId}/${path}`,
		{ headers: authHeaders(presentationId) },
	);
	if (!response.ok) {
		const failure = await response
			.json()
			.catch(() => ({ error: response.statusText }));
		throw new Error(failure.error || response.statusText);
	}
	return {
		blob: await response.blob(),
		filename:
			filenameFromContentDisposition(
				response.headers.get("Content-Disposition"),
			) ?? fallbackFilename,
	};
}

// ── Results-link token storage (REQ098) ───────────────────────
//
// A second, weaker per-presentation secret, kept in a map of its own rather than
// beside the edit tokens: the two authorize different things, and one map read
// by `authHeaders` would eventually put a read-only token in the slot a mutation
// proves itself from. Losing this map loses nothing the organizer cannot re-mint
// and nothing a recipient cannot be re-sent.

/**
 * The fragment key a results link carries its token in, and the path it points
 * at. A fragment rather than a query parameter, like the edit link's `#share=`:
 * it is never sent to the server, so the secret stays out of access logs, proxy
 * logs and `Referer` headers on the way to the page that consumes it.
 */
export const RESULTS_LINK_FRAGMENT = "link";

/** Where a minted results link points. One spelling, built here and parsed in `App.tsx`. */
export function resultsLinkUrl(
	origin: string,
	presentationId: string,
	token: string,
): string {
	return `${origin}/results/${presentationId}#${RESULTS_LINK_FRAGMENT}=${encodeURIComponent(token)}`;
}

/** Every stored results token, or `{}` where there is no usable storage. */
function getResultsTokenMap(): Record<string, { token: string; issuedAt: string }> {
	try {
		return JSON.parse(localStorage.getItem(RESULTS_TOKEN_KEY) || "{}");
	} catch {
		return {};
	}
}

function writeResultsTokenMap(
	map: Record<string, { token: string; issuedAt: string }>,
): void {
	try {
		localStorage.setItem(RESULTS_TOKEN_KEY, JSON.stringify(map));
	} catch {
		// A browser with storage denied still gets a working link — it is on the
		// clipboard the moment it is minted. What it loses is the ability to copy
		// the same one again later, which re-minting solves.
	}
}

/**
 * The results-link token this browser holds for a deck, with the instant it was
 * minted. The instant is what tells a token apart from a newer one minted in
 * another browser: the status endpoint reports `issuedAt`, and a local copy that
 * disagrees with it is a link that has already been retired.
 */
export function getResultsToken(
	presentationId: string,
): { token: string; issuedAt: string } | null {
	return getResultsTokenMap()[presentationId] ?? null;
}

/** Remember a minted (or received) results token for a deck. */
export function setResultsToken(
	presentationId: string,
	token: string,
	issuedAt: string,
): void {
	const map = getResultsTokenMap();
	map[presentationId] = { token, issuedAt };
	writeResultsTokenMap(map);
}

/** Forget this browser's copy of a deck's results token — on revoke, or on a refusal. */
export function clearResultsToken(presentationId: string): void {
	const map = getResultsTokenMap();
	delete map[presentationId];
	writeResultsTokenMap(map);
}

/**
 * Accept a results token received via a results link (URL fragment
 * `#link=<token>` on `/results/:id`). Stores it under an `issuedAt` this browser
 * cannot know — the recipient never reads the status endpoint, which is the
 * organizer's — so it is recorded as the empty string rather than as a claim.
 *
 * The empty stamp is a claim of its own downstream, and the right one: it never
 * equals a real `issuedAt`, so `resultsLinkView()` reads a token accepted this
 * way as one whose currency this browser cannot vouch for. That matters when the
 * browser accepting the link is the *organizer's* — opening your own results
 * link to check what a recipient sees must not leave the dialog offering to copy
 * a token a later re-mint has since retired.
 */
export function acceptResultsLinkToken(
	presentationId: string,
	token: string,
): void {
	setResultsToken(presentationId, token, "");
}

/** The header a results-link read proves itself with, or nothing when none is held. */
function resultsLinkHeaders(presentationId: string): Record<string, string> {
	const held = getResultsToken(presentationId);
	return held ? { [RESULTS_TOKEN_HEADER]: held.token } : {};
}

/**
 * One reading of the whole-deck results payload, composed by both callers of it
 * (ADR-0026): the presenter's `getAllResults` and the results link's
 * `getSharedResults`. A withheld entry keeps its `slideId` and `question`, so a
 * consumer still walks the whole deck, and its `results` is `null` rather than a
 * countless payload a renderer would draw as "0 of 0 answered".
 */
function readResultsRows(rows: any[]) {
	return rows.map(({ slideId, question, ...results }) => ({
		slideId,
		question,
		results: isWithheldTally(results) ? null : results,
	}));
}

// ── Presentations ─────────────────────────────────────────────

export const api = {
	/**
	 * List "my" presentations by fetching each presentation whose ID is in the
	 * localStorage token map. This is token-scoped: only presentations for which
	 * the client holds a creator token are shown.
	 */
	listPresentations: async (): Promise<any[]> => {
		const ids = Object.keys(getTokenMap());
		if (ids.length === 0) return [];
		const results = await Promise.all(
			ids.map((id) => api.getPresentation(id).catch(() => null)),
		);
		return results
			.filter(Boolean)
			.sort(
				(a, b) =>
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
	},

	/**
	 * The built-in template catalog (REQ005), whole. Fetched once and filtered in
	 * the browser with `filterDeckTemplates` — the same function the endpoint's
	 * `category`/`search` parameters run (ADR-0026), so the gallery cannot mean
	 * something different by a search than the API does, and typing in the search
	 * box costs no round trip.
	 */
	listTemplates: () => request<DeckTemplate[]>("/templates"),

	/**
	 * Create a new presentation. The server returns a one-time `creatorToken` in
	 * the response which is stored in localStorage for future mutations.
	 *
	 * `templateId` starts the deck from a catalog entry (REQ005/REQ006), in which
	 * case `title` and `slides` may both be left out — the copies come from the
	 * template. Every other create still needs them.
	 */
	createPresentation: async (data: {
		title?: string;
		slides?: any[];
		templateId?: string;
		/**
		 * The workspace that will own the deck (REQ128). The server records no
		 * account owner for one of these and mints no edit token, so there is
		 * nothing for `setCreatorToken` below to store — which is exactly right: a
		 * workspace deck's standing is its roster, and this browser holding a
		 * forwardable capability on it would be a standing the roster cannot reach.
		 */
		workspaceId?: string;
		language?: string;
		mode?: "live" | "survey";
		resultsVisibility?: "instant" | "on-click" | "private";
		qaEnabled?: boolean;
		qaVisibility?: "presenter" | "everyone";
		reactionsEnabled?: boolean;
		chatEnabled?: boolean;
		requireParticipantName?: boolean;
		theme?: DeckThemeId;
		themeBrand?: DeckBrand;
		themeLogoUrl?: string;
		themeLogoAlt?: string;
	}): Promise<any> => {
		const pres = await request<any>("/presentations", {
			method: "POST",
			body: JSON.stringify(data),
		});
		if (pres.creatorToken) {
			setCreatorToken(pres.id, pres.creatorToken);
		}
		return pres;
	},

	/**
	 * Whether this deployment can generate a deck from a prompt (REQ007), and on
	 * what terms. Read before the control is drawn, so a server with no provider
	 * configured shows the control disabled with the reason rather than hidden or
	 * failing on the click (ADR-0025).
	 */
	getDeckGeneration: () =>
		request<DeckGenerationAvailability>("/deck-generation"),

	/**
	 * Draft a deck from a prompt (REQ007). Answers with an ordinary presentation
	 * — the same shape, and the same one-time `creatorToken`, that
	 * `createPresentation` returns — so it is stored here the same way and the
	 * deck is editable from the moment it lands.
	 *
	 * The slides come back **unmarked**: nothing generated asserts a correct
	 * answer, which is the organizer's first edit rather than something this
	 * client has to strip.
	 */
	generatePresentation: async (data: {
		prompt: string;
		language?: string;
	}): Promise<any> => {
		const pres = await request<any>("/deck-generation", {
			method: "POST",
			body: JSON.stringify(data),
		});
		if (pres.creatorToken) {
			setCreatorToken(pres.id, pres.creatorToken);
		}
		return pres;
	},

	/**
	 * Fetch a deck. The stored edit token rides along when this browser holds
	 * one, because a quiz slide's marked solutions are withheld from anyone who
	 * cannot edit the deck until the question is over (REQ056) — without it the
	 * editor would open a quiz with its correct answers apparently unmarked.
	 */
	getPresentation: (id: string) =>
		request<any>(`/presentations/${id}`, { headers: authHeaders(id) }),

	joinByCode: (code: string) => request<any>(`/join/${code}`),

	startPresentation: (id: string) =>
		request<any>(`/presentations/${id}/start`, {
			method: "POST",
			headers: authHeaders(id),
		}),

	endPresentation: (id: string) =>
		request<any>(`/presentations/${id}/end`, {
			method: "POST",
			headers: authHeaders(id),
		}),

	resetPresentation: (id: string) =>
		request<any>(`/presentations/${id}/reset`, {
			method: "POST",
			headers: authHeaders(id),
		}),

	updatePresentation: (
		id: string,
		data: {
			title?: string;
			slides?: any[];
			language?: string;
			mode?: "live" | "survey";
			resultsVisibility?: "instant" | "on-click" | "private";
			qaEnabled?: boolean;
			qaVisibility?: "presenter" | "everyone";
			reactionsEnabled?: boolean;
			chatEnabled?: boolean;
			requireParticipantName?: boolean;
			theme?: DeckThemeId;
			themeBrand?: DeckBrand;
			themeLogoUrl?: string;
			themeLogoAlt?: string;
		},
	) =>
		request<any>(`/presentations/${id}`, {
			method: "PATCH",
			body: JSON.stringify(data),
			headers: authHeaders(id),
		}),

	setSlide: (id: string, index: number) =>
		request<any>(`/presentations/${id}/slide`, {
			method: "POST",
			body: JSON.stringify({ index }),
			headers: authHeaders(id),
		}),

	revealSlide: (id: string, slideId: string, reveal = true) =>
		request<any>(`/presentations/${id}/reveal`, {
			method: "POST",
			body: JSON.stringify({ slideId, reveal }),
			headers: authHeaders(id),
		}),

	/**
	 * Open or close one slide to submissions (REQ111). `open` is spelled out on
	 * every call, like the endpoint requires: closing a question and reopening it
	 * are two halves of one control, and neither is the one that goes without
	 * saying.
	 */
	setSlideParticipation: (id: string, slideId: string, open: boolean) =>
		request<any>(`/presentations/${id}/participation`, {
			method: "POST",
			body: JSON.stringify({ slideId, open }),
			headers: authHeaders(id),
		}),

	/**
	 * Blank the shared screen, or bring it back (REQ109). Deck-level: it takes
	 * the projected slide off the wall and touches nothing else — not the slide
	 * the deck is on, not whether it is collecting, not a single stored answer.
	 */
	setAudienceBlanked: (id: string, blanked: boolean) =>
		request<any>(`/presentations/${id}/blank`, {
			method: "POST",
			body: JSON.stringify({ blanked }),
			headers: authHeaders(id),
		}),

	/**
	 * Set the deck's reveal mode and apply it to every question slide in it, in
	 * one request (REQ018) — the per-slide overrides are cleared server-side, so
	 * the deck really does end up uniform rather than only its untouched slides.
	 */
	setDeckResultsVisibility: (id: string, resultsVisibility: ResultsVisibility) =>
		request<any>(`/presentations/${id}/results-visibility`, {
			method: "POST",
			body: JSON.stringify({ resultsVisibility }),
			headers: authHeaders(id),
		}),

	/**
	 * Reopen a slide's question, restarting the countdown a quiz runs on
	 * (REQ057). Arriving at a slide opens its question automatically and keeps
	 * that instant, so this is the deliberate way back from a mis-navigation.
	 */
	restartSlideTimer: (id: string, slideId: string) =>
		request<any>(`/presentations/${id}/timer`, {
			method: "POST",
			body: JSON.stringify({ slideId }),
			headers: authHeaders(id),
		}),

	vote: (
		presentationId: string,
		slideId: string,
		value: string,
		participantId: string,
		opts: { statementId?: string; skip?: boolean } = {},
	) =>
		request<any>(`/presentations/${presentationId}/vote`, {
			method: "POST",
			body: JSON.stringify({
				slideId,
				value,
				participantId,
				...(opts.statementId ? { statementId: opts.statementId } : {}),
				...(opts.skip ? { skip: true } : {}),
			}),
		}),

	/**
	 * Take one submitted answer off a word cloud or an open-ended slide (REQ027).
	 *
	 * Authed like every other deck mutation — the stored edit token rides it, and
	 * the server re-decides from the request's own credentials. The row is gone
	 * when this resolves: the room is broadcast the recounted tally, and every
	 * export taken afterwards is short one answer. Nothing here keeps a copy, so
	 * the caller confirms first.
	 */
	deleteAnswer: (presentationId: string, answerId: string) =>
		request<{ ok: true; slideId: string }>(
			`/presentations/${presentationId}/answers/${answerId}`,
			{ method: "DELETE", headers: authHeaders(presentationId) },
		),

	/** Upvote (or toggle off) an open-ended response (REQ025). */
	voteOnResponse: (
		presentationId: string,
		slideId: string,
		responseId: string,
		participantId: string,
	) =>
		request<any>(`/presentations/${presentationId}/response-vote`, {
			method: "POST",
			body: JSON.stringify({ slideId, responseId, participantId }),
		}),

	// ── Q&A layer (REQ036, REQ037, REQ060) ──────────────────────
	//
	// Who may read the question list is decided on the server, per request, from
	// the credentials this fetch carries (REQ037) — so the stored edit token rides
	// the GET exactly as it does on `getResults`, and the participant id says whose
	// own submissions to fall back to when the organizer has kept the list back.
	// Nothing here is filtered client-side: what a client holds, a client can read.

	/** Read the deck's Q&A list as this browser is entitled to see it. */
	getQA: (presentationId: string, participantId: string) =>
		request<any>(
			`/presentations/${presentationId}/qa?participantId=${encodeURIComponent(participantId)}`,
			{ headers: authHeaders(presentationId) },
		),

	/** Ask a question from whatever slide is on screen (REQ036). */
	askQuestion: (presentationId: string, text: string, participantId: string) =>
		request<any>(`/presentations/${presentationId}/qa`, {
			method: "POST",
			body: JSON.stringify({ text, participantId }),
		}),

	// ── Participant names (REQ076) ──────────────────────────────

	/**
	 * State what this participant is called on a deck that asks for one.
	 *
	 * Unauthenticated, like every other participant write: the participant id is
	 * the credential. What comes back is the name **as stored** — the server
	 * trims it and folds it to one line — so the caller keeps what was kept
	 * rather than what was typed.
	 */
	stateParticipantName: (
		presentationId: string,
		participantId: string,
		name: string,
	) =>
		request<{ name: string }>(
			`/presentations/${presentationId}/participant-name`,
			{
				method: "POST",
				body: JSON.stringify({ participantId, name }),
			},
		),

	/**
	 * The deck's roster — who took part, by name (REQ076).
	 *
	 * Authed like a mutation and not like a results read: the endpoint refuses
	 * the deck's read-only results link, because a delegation of the numbers is
	 * not a delegation of who was in the room.
	 */
	getParticipantRoster: (presentationId: string) =>
		request<ParticipantRosterEntry[]>(
			`/presentations/${presentationId}/participants`,
			{ headers: authHeaders(presentationId) },
		),

	/** Toggle this participant's upvote on a question (REQ060). */
	upvoteQuestion: (
		presentationId: string,
		questionId: string,
		participantId: string,
	) =>
		request<any>(`/presentations/${presentationId}/qa/${questionId}/upvote`, {
			method: "POST",
			body: JSON.stringify({ participantId }),
		}),

	/** Mark a question dealt with, or put it back in the queue (REQ060). */
	setQuestionAnswered: (
		presentationId: string,
		questionId: string,
		answered: boolean,
	) =>
		request<any>(`/presentations/${presentationId}/qa/${questionId}/answered`, {
			method: "POST",
			body: JSON.stringify({ answered }),
			headers: authHeaders(presentationId),
		}),

	/** Switch the layer on/off (REQ036) and choose who reads it (REQ037). */
	setQASettings: (
		presentationId: string,
		changes: { enabled?: boolean; visibility?: "presenter" | "everyone" },
	) =>
		request<any>(`/presentations/${presentationId}/qa/settings`, {
			method: "POST",
			body: JSON.stringify(changes),
			headers: authHeaders(presentationId),
		}),

	// ── Participant channels (REQ077, REQ078) ───────────────────
	//
	// Two things a participant sends that are not answers. Neither call carries the
	// edit token: both endpoints are public in the same sense the vote endpoint is
	// — the participant id is the credential, minted in this browser and never
	// published — and neither returns anything one caller may see and another may
	// not. What the *switches* need is the token, and only `setParticipantChannels`
	// below sends it.

	/**
	 * React to whatever is on screen (REQ077). Nothing is stored, on this side or
	 * the other: the server broadcasts the reaction to the room and forgets it, so
	 * this is a fire-and-forget call whose only effect is on screens.
	 */
	sendReaction: (
		presentationId: string,
		kind: ReactionKind,
		slideId: string | null,
		participantId: string,
	) =>
		request<any>(`/presentations/${presentationId}/reactions`, {
			method: "POST",
			body: JSON.stringify({ kind, slideId: slideId ?? undefined, participantId }),
		}),

	/** Read the deck's chat, with this browser's own lines marked (REQ078). */
	getChat: (presentationId: string, participantId: string) =>
		request<any>(
			`/presentations/${presentationId}/chat?participantId=${encodeURIComponent(participantId)}`,
		),

	/** Post a line to the deck's chat (REQ078). */
	postChatMessage: (
		presentationId: string,
		text: string,
		participantId: string,
	) =>
		request<any>(`/presentations/${presentationId}/chat`, {
			method: "POST",
			body: JSON.stringify({ text, participantId }),
		}),

	/** Open or close the reaction and chat channels (REQ077/REQ078). */
	setParticipantChannels: (
		presentationId: string,
		changes: { reactionsEnabled?: boolean; chatEnabled?: boolean },
	) =>
		request<any>(`/presentations/${presentationId}/channels`, {
			method: "POST",
			body: JSON.stringify(changes),
			headers: authHeaders(presentationId),
		}),

	/**
	 * Same token, same reason as `getPresentation`: the presenter's shared screen
	 * shows the marked solution on a quiz question the room is still answering,
	 * and no participant's screen does (REQ056).
	 *
	 * A tally the deck's reveal mode withholds (REQ016/REQ017) comes back as the
	 * marker the endpoint documents rather than as numbers, and is read here as
	 * `null` — **the one place that translation happens**, so no surface has to
	 * learn a second falsy shape. The distinction the marker draws matters on the
	 * wire, where a client must not mistake "kept from you" for "nobody has
	 * answered"; on screen the two are the same instruction, because a component
	 * that has no tally draws no tally either way.
	 */
	getResults: (presentationId: string, slideId: string) =>
		request<any>(`/presentations/${presentationId}/results/${slideId}`, {
			headers: authHeaders(presentationId),
		}).then((results) => (isWithheldTally(results) ? null : results)),

	/**
	 * Fetch this participant's own quiz scorecard (REQ056) — what they answered,
	 * whether it was right, and what it scored. The room's results payload
	 * reports scores anonymously, so this is how a participant learns their own.
	 */
	getScorecard: (presentationId: string, participantId: string) =>
		request<any>(
			`/presentations/${presentationId}/scorecard?participantId=${encodeURIComponent(participantId)}`,
		),

	/**
	 * A dry run of the whole deck, populated with test votes (REQ103/REQ104).
	 *
	 * Authed like a mutation, because it is the organizer's own preview of their
	 * own deck and it carries the presenter's view of every quiz answer key. It
	 * writes nothing: the run is generated, aggregated and discarded server-side
	 * — see `getPreviewResults` — so nothing this returns has been, or will be,
	 * stored. `startedAt` is sent back unchanged on every poll so a refresh does
	 * not restart the countdown it is refreshing.
	 */
	getPreview: (
		presentationId: string,
		run: { respondents: number; seed: number; startedAt: string },
	) =>
		request<any>(
			`/presentations/${presentationId}/preview?respondents=${run.respondents}&seed=${run.seed}&startedAt=${encodeURIComponent(run.startedAt)}`,
			{ headers: authHeaders(presentationId) },
		),

	/**
	 * Every slide's tally at once, each entry behind the same reveal-mode gate as
	 * the single-slide call — and read back the same way: a withheld entry keeps
	 * its `slideId` and `question`, so a consumer still walks the whole deck, and
	 * its `results` is `null` rather than a countless payload a renderer would
	 * draw as "0 of 0 answered".
	 */
	getAllResults: (presentationId: string) =>
		request<any[]>(`/presentations/${presentationId}/results`, {
			headers: authHeaders(presentationId),
		}).then(readResultsRows),

	/**
	 * Download the deck's results as an XLSX workbook (REQ095) — the tabular
	 * export: every stored response, the participant matrix, and every tally in
	 * long form. See {@link downloadExport} for what the trip has in common with
	 * the PDF below it.
	 */
	downloadResults: (presentationId: string): Promise<DownloadedExport> =>
		downloadExport(presentationId, "results.xlsx", "results.xlsx"),

	/**
	 * Download the deck rendered to PDF (REQ096) — the *readable* export, where
	 * the workbook is the analysable one.
	 *
	 * `includeResults` is the one decision REQ096 leaves to the caller, and it
	 * decides what the document draws rather than who may have it: both readings
	 * are authorized as an edit, because even the deck alone carries every quiz
	 * answer key. The server names the two files apart, so a deck exported both
	 * ways on one day does not overwrite itself in the download folder.
	 */
	downloadDeckPdf: (
		presentationId: string,
		{ includeResults }: { includeResults: boolean },
	): Promise<DownloadedExport> =>
		downloadExport(
			presentationId,
			`deck.pdf?results=${includeResults ? "true" : "false"}`,
			"deck.pdf",
		),

	// ── The shareable results link (REQ098) ─────────────────────
	//
	// Minting, revoking and reading the link are the organizer's, so all three
	// carry the edit token. Reading *through* the link is the recipient's and
	// carries the link token instead — see `getSharedResults` below.

	/**
	 * Mint the deck's results link and remember the secret it returns. The token
	 * exists in exactly one response, so a caller that drops it has to mint again
	 * — which is also the act that retires the link it just replaced.
	 */
	mintResultsLink: async (id: string): Promise<ResultsLink> => {
		const link = await request<ResultsLink>(`/presentations/${id}/results-link`, {
			method: "POST",
			headers: authHeaders(id),
		});
		if (link.resultsToken) {
			setResultsToken(id, link.resultsToken, link.issuedAt ?? "");
		}
		return link;
	},

	/**
	 * Revoke the deck's results link. The local copy goes with it: keeping a token
	 * the server has forgotten would let this browser offer a "Copy" that hands
	 * somebody a dead link.
	 */
	revokeResultsLink: async (id: string): Promise<ResultsLink> => {
		const link = await request<ResultsLink>(`/presentations/${id}/results-link`, {
			method: "DELETE",
			headers: authHeaders(id),
		});
		clearResultsToken(id);
		return link;
	},

	/** Whether the deck has a results link right now, and when it was minted. */
	getResultsLink: (id: string) =>
		request<ResultsLink>(`/presentations/${id}/results-link`, {
			headers: authHeaders(id),
		}),

	/**
	 * Every slide's tally as the holder of the deck's results link reads it
	 * (REQ098) — the read-only results page's one call.
	 *
	 * Both credentials ride it: the link token, which is what lifts the deck's
	 * reveal mode, and the edit token when this browser happens to hold one, so an
	 * organizer opening their own results page is not worse off than a recipient.
	 * A withheld entry reads back as `null` exactly as it does on `getAllResults`
	 * — a deck whose organizer never minted a link is still openable at this URL,
	 * and what it shows is what the public endpoint publishes.
	 */
	getSharedResults: (id: string) =>
		request<any[]>(`/presentations/${id}/results`, {
			headers: { ...authHeaders(id), ...resultsLinkHeaders(id) },
		}).then(readResultsRows),

	/**
	 * One slide's tally broken down by an earlier slide's answers (REQ020,
	 * REQ116) — the join the results surface draws its groups from.
	 *
	 * Carries both credentials for the same reason `getSharedResults` does: the
	 * breakdown is read on exactly the terms the tallies behind it are, so an
	 * organizer's own browser reads past the reveal mode with the edit token it
	 * already holds and a recipient reads past it with the results link. The
	 * payload comes back whole — a withheld or suppressed group is a *stated*
	 * shape (`withheld`, `suppressed`), and flattening either to `null` here
	 * would leave the surface unable to say which of them it met.
	 */
	getSegmentedResults: (presentationId: string, slideId: string, by: string) =>
		request<any>(
			`/presentations/${presentationId}/results/${slideId}/segments?by=${encodeURIComponent(by)}`,
			{
				headers: {
					...authHeaders(presentationId),
					...resultsLinkHeaders(presentationId),
				},
			},
		),

	// ── Who the deck is shared with (REQ075) ────────────────────
	//
	// All four calls are the **owner's**, and none of them carries the edit token:
	// the server refuses that credential here on purpose, so sending it would only
	// make a 401 look like a bug in this file. The Better Auth cookie session rides
	// every fetch by itself, which is the whole of the authentication these need.

	/** The accounts this deck is shared with, oldest grant first. */
	listCollaborators: (id: string) =>
		request<DeckCollaborator[]>(`/presentations/${id}/collaborators`),

	/**
	 * Share the deck with an account, by the email it signed up with. Idempotent
	 * per account: an address that already has a grant has its level changed
	 * rather than a second grant added, so pressing Invite twice is safe.
	 */
	shareDeck: (id: string, email: string, level: DeckAccessLevel) =>
		request<DeckCollaborator>(`/presentations/${id}/collaborators`, {
			method: "POST",
			body: JSON.stringify({ email, level }),
		}),

	/** Move one grant to another level, named by the grant's own id. */
	setCollaboratorLevel: (
		id: string,
		collaboratorId: string,
		level: DeckAccessLevel,
	) =>
		request<DeckCollaborator>(
			`/presentations/${id}/collaborators/${collaboratorId}`,
			{ method: "PATCH", body: JSON.stringify({ level }) },
		),

	/** Revoke one grant. Immediate — there is no token of theirs to expire. */
	removeCollaborator: (id: string, collaboratorId: string) =>
		request<{ ok: true }>(
			`/presentations/${id}/collaborators/${collaboratorId}`,
			{ method: "DELETE" },
		),

	// ── Comment threads on the deck's slides (REQ074) ───────────
	//
	// Like the four calls above, none of these carries the edit token, and here it
	// is not a courtesy: the server refuses that credential on all three routes
	// because a comment has an author and a forwardable token has nobody behind
	// it. The Better Auth cookie session rides every fetch by itself and is the
	// whole of what authenticates these — a browser holding only an edit link gets
	// a `401` and shows the panel's signed-out reason, which is the honest answer.

	/**
	 * Every comment on the deck, oldest first — the whole conversation in one
	 * read, because the surface that draws it shows one slide's thread and a count
	 * on the rest.
	 */
	listComments: (id: string) =>
		request<SlideComment[]>(`/presentations/${id}/comments`),

	/** Write one comment onto one slide's thread. */
	addComment: (id: string, slideId: string, body: string) =>
		request<SlideComment>(`/presentations/${id}/comments`, {
			method: "POST",
			body: JSON.stringify({ slideId, body }),
		}),

	/** Take back one of your own. Somebody else's is refused server-side. */
	deleteComment: (id: string, commentId: string) =>
		request<{ ok: true }>(`/presentations/${id}/comments/${commentId}`, {
			method: "DELETE",
		}),

	// ── Workspaces (REQ128, REQ129) ─────────────────────────────
	//
	// None of these carries the edit token either, and for a reason of its own: a
	// workspace membership is an account's, and the token names no account. The
	// Better Auth cookie session rides every fetch by itself and is the whole of
	// what authenticates them — a browser holding only an edit link gets a `401`,
	// which is the honest answer.
	//
	// Every one of them is a *report* on the way back: `role` says what the server
	// will let this caller do, so a surface can disable what they may not and say
	// why (ADR-0025). It is never a credential — each route re-resolves the role
	// from the request's own credentials (REQ129), so a client that gets this
	// wrong only mis-draws its own buttons.

	/** The workspaces this account is in, each with the role it holds there. */
	listWorkspaces: () => request<Workspace[]>("/workspaces"),

	/** Create one. The caller becomes its `owner` in the same act. */
	createWorkspace: (name: string) =>
		request<Workspace>("/workspaces", {
			method: "POST",
			body: JSON.stringify({ name }),
		}),

	/** One workspace, with this caller's own role on it. */
	getWorkspace: (workspaceId: string) =>
		request<Workspace>(`/workspaces/${workspaceId}`),

	/** Rename one. The `owner` role only, enforced on the server. */
	renameWorkspace: (workspaceId: string, name: string) =>
		request<Workspace>(`/workspaces/${workspaceId}`, {
			method: "PATCH",
			body: JSON.stringify({ name }),
		}),

	/** Delete one. Refused while it still owns decks — they are its, not a member's. */
	deleteWorkspace: (workspaceId: string) =>
		request<{ ok: true }>(`/workspaces/${workspaceId}`, { method: "DELETE" }),

	/** Who is in it, and at what role. Any member reads this. */
	listWorkspaceMembers: (workspaceId: string) =>
		request<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),

	/**
	 * Add an account by the email it signed up with. Idempotent per account: an
	 * address that is already a member has its role changed rather than a second
	 * membership added, so pressing Add twice is safe.
	 */
	addWorkspaceMember: (
		workspaceId: string,
		email: string,
		role: WorkspaceRole,
	) =>
		request<WorkspaceMember>(`/workspaces/${workspaceId}/members`, {
			method: "POST",
			body: JSON.stringify({ email, role }),
		}),

	/** Move one membership to another role, named by the membership's own id. */
	setWorkspaceMemberRole: (
		workspaceId: string,
		memberId: string,
		role: WorkspaceRole,
	) =>
		request<WorkspaceMember>(`/workspaces/${workspaceId}/members/${memberId}`, {
			method: "PATCH",
			body: JSON.stringify({ role }),
		}),

	/**
	 * Remove one membership — somebody else's, or your own, which is how leaving
	 * works. The workspace's decks are untouched either way (REQ128).
	 */
	removeWorkspaceMember: (workspaceId: string, memberId: string) =>
		request<{ ok: true }>(`/workspaces/${workspaceId}/members/${memberId}`, {
			method: "DELETE",
		}),

	/** The decks the workspace owns, as their authors wrote them. */
	listWorkspacePresentations: (workspaceId: string) =>
		request<any[]>(`/workspaces/${workspaceId}/presentations`),

	/**
	 * Move a deck into a workspace, or back out into this account (`null`).
	 *
	 * The stored edit token is deliberately **not** sent: this is authorized as an
	 * ownership act, which the token has never been able to prove (REQ075's
	 * reasoning for the sharing surface, applied to the bigger version of the same
	 * decision). Moving a deck in retires that token server-side, so the local map
	 * is cleaned up here rather than left holding a credential that authorizes
	 * nothing.
	 */
	setPresentationWorkspace: async (
		id: string,
		workspaceId: string | null,
	): Promise<any> => {
		const moved = await request<any>(`/presentations/${id}/workspace`, {
			method: "POST",
			body: JSON.stringify({ workspaceId }),
		});
		if (workspaceId) forgetCreatorToken(id);
		return moved;
	},

	deletePresentation: (id: string) =>
		request<any>(`/presentations/${id}`, {
			method: "DELETE",
			headers: authHeaders(id),
		}),

	/**
	 * Duplicate a presentation: fetch the source, re-identify its slides so the
	 * copy is fully independent, then create a new presentation. The server mints
	 * a fresh creator token, which `createPresentation` stores in localStorage.
	 *
	 * The re-identification is `withFreshSlideIds`, shared with import below and
	 * with the server's create-from-template path (ADR-0026) — three ways of
	 * making a copy of a deck, one definition of what a copy is.
	 */
	duplicatePresentation: async (id: string): Promise<any> => {
		// Authed: a copy made from the audience's view of the deck would lose the
		// marked solutions on any quiz question still running (REQ056).
		const source = await request<any>(`/presentations/${id}`, {
			headers: authHeaders(id),
		});
		return api.createPresentation({
			title: `${source.title} (copy)`,
			slides: withFreshSlideIds(source.slides ?? []),
			language: source.language,
			mode: source.mode,
			resultsVisibility: source.resultsVisibility,
			qaEnabled: source.qaEnabled,
			qaVisibility: source.qaVisibility,
			// The participant channels travel with the deck too (REQ077/REQ078) —
			// a copy of a deck that ran with a chat is a deck with a chat.
			reactionsEnabled: source.reactionsEnabled,
			chatEnabled: source.chatEnabled,
		});
	},

	/**
	 * Import a presentation from a parsed JSON payload (as produced by
	 * `buildExportPayload`). Slide identities are regenerated so the imported
	 * copy is independent of any source. The server validates the shape via Zod
	 * and returns 400 on malformed input.
	 */
	importPresentation: async (data: unknown): Promise<any> => {
		if (!data || typeof data !== "object") {
			throw new Error("Invalid file: expected a JSON object");
		}
		const d = data as Record<string, unknown>;
		if (typeof d.title !== "string" || !Array.isArray(d.slides)) {
			throw new Error("Invalid file: missing `title` or `slides`");
		}
		return api.createPresentation({
			title: d.title,
			slides: withFreshSlideIds(d.slides),
			language: typeof d.language === "string" ? d.language : undefined,
			mode: d.mode === "survey" ? "survey" : "live",
			resultsVisibility:
				d.resultsVisibility === "on-click" || d.resultsVisibility === "private"
					? d.resultsVisibility
					: d.resultsVisibility === "instant"
						? "instant"
						: undefined,
			// The Q&A layer travels with the deck (REQ036/REQ037), but only ever
			// tightens on import: an unrecognised `qaVisibility` falls back to the
			// schema's `presenter` rather than to whatever the file claimed, so a
			// hand-edited export cannot publish a room's questions by mistake.
			qaEnabled: d.qaEnabled === true,
			qaVisibility: d.qaVisibility === "everyone" ? "everyone" : "presenter",
			// The participant channels tighten on import the same way (REQ077/
			// REQ078): anything other than an explicit `true` reads as closed, so a
			// hand-edited export cannot open a room's chat by mistake.
			reactionsEnabled: d.reactionsEnabled === true,
			chatEnabled: d.chatEnabled === true,
		});
	},
};

// ── Account-owned presentations ───────────────────────────────
//
// A signed-in account can OWN presentations (server-side `creatorId`), which is
// independent of the per-presentation edit token kept in localStorage. These
// helpers bridge the two: `listMyPresentations` reads the account's owned decks
// from the server, and `claimLocalPresentations` attaches locally-created decks
// to the account after sign-in so they follow the user across devices.

/**
 * List the signed-in account's owned presentations (server `/presentations/mine`,
 * authenticated by the Better Auth cookie session). Returns `[]` when signed out
 * (the endpoint 401s) or on any error, so callers can merge it unconditionally.
 */
export async function listMyPresentations(): Promise<any[]> {
	try {
		return await request<any[]>("/presentations/mine");
	} catch {
		return [];
	}
}

/**
 * List the decks another account has shared with the signed-in one (REQ075),
 * each carrying the `accessLevel` it was shared at. Returns `[]` when signed out
 * (the endpoint 401s) or on any error, so callers can merge it unconditionally —
 * the same contract `listMyPresentations` above keeps.
 *
 * Deliberately a **second** call rather than a widening of `/mine`: a deck you
 * own and a deck you were invited to are different things to a person, they are
 * listed separately, and merging them here would only mean splitting them again
 * on screen.
 */
export async function listSharedPresentations(): Promise<any[]> {
	try {
		return await request<any[]>("/presentations/shared");
	} catch {
		return [];
	}
}

/**
 * Claim every locally-known presentation for the signed-in account. Best-effort
 * and idempotent: each deck is claimed with its stored edit token (proving
 * control) plus the cookie session (proving the account); decks already owned,
 * owned by someone else, or gone are silently skipped. Returns how many claim
 * calls succeeded (including no-op re-claims of decks you already own).
 */
export async function claimLocalPresentations(): Promise<number> {
	const ids = Object.keys(getTokenMap());
	if (ids.length === 0) return 0;
	const outcomes = await Promise.all(
		ids.map(async (id) => {
			try {
				const res = await fetch(`${BASE}/api/presentations/${id}/claim`, {
					method: "POST",
					headers: { "Content-Type": "application/json", ...authHeaders(id) },
				});
				return res.ok;
			} catch {
				return false;
			}
		}),
	);
	return outcomes.filter(Boolean).length;
}

/**
 * Build the JSON payload for "Export presentation". Strips runtime fields
 * (`id`, `code`, `status`, `activeSlideIndex`, `revealedSlideIds`, `createdAt`)
 * so the resulting file is portable and can be imported as a fresh copy.
 */
export function buildExportPayload(pres: any): Record<string, unknown> {
	return {
		kind: "omul.presentation",
		version: 1,
		title: pres.title,
		language: pres.language,
		mode: pres.mode,
		resultsVisibility: pres.resultsVisibility,
		// The Q&A layer is authored deck state (REQ036/REQ037), so it exports with
		// the deck. The questions themselves are session data and stay behind, like
		// every vote does.
		qaEnabled: pres.qaEnabled,
		qaVisibility: pres.qaVisibility,
		// The participant channels are authored deck state too (REQ077/REQ078), so
		// they export with the deck. What the chat *held* is session data and stays
		// behind, like every vote and every question does.
		reactionsEnabled: pres.reactionsEnabled,
		chatEnabled: pres.chatEnabled,
		slides: pres.slides ?? [],
	};
}

// ── WebSocket ─────────────────────────────────────────────────

type EventHandler = (data: any) => void;

let ws: WebSocket | null = null;
const listeners = new Map<string, Set<EventHandler>>();

export function connectWs(
	presentationId: string,
	role: "presenter" | "participant",
) {
	if (ws) {
		ws.close();
	}

	const proto = location.protocol === "https:" ? "wss:" : "ws:";
	ws = new WebSocket(`${proto}//${location.host}/ws`);

	ws.onopen = () => {
		ws?.send(JSON.stringify({ type: "join", presentationId, role }));
	};

	ws.onmessage = (evt) => {
		try {
			const msg = JSON.parse(evt.data);
			const handlers = listeners.get(msg.event);
			if (handlers) {
				for (const handler of handlers) handler(msg.data);
			}
			// Wildcard listeners
			const wildcardHandlers = listeners.get("*");
			if (wildcardHandlers) {
				for (const handler of wildcardHandlers)
					handler({ event: msg.event, data: msg.data });
			}
		} catch {
			// ignore
		}
	};

	ws.onclose = () => {
		// Auto-reconnect after 1s
		setTimeout(() => {
			if (ws?.readyState === WebSocket.CLOSED) {
				connectWs(presentationId, role);
			}
		}, 1000);
	};
}

export function onWsEvent(event: string, handler: EventHandler): () => void {
	if (!listeners.has(event)) listeners.set(event, new Set());
	listeners.get(event)!.add(handler);
	return () => listeners.get(event)?.delete(handler);
}

export function disconnectWs() {
	ws?.close();
	ws = null;
	listeners.clear();
}

// ── Participant ID (persisted in localStorage) ────────────────

export function getParticipantId(): string {
	let id = localStorage.getItem(PARTICIPANT_ID_KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(PARTICIPANT_ID_KEY, id);
	}
	return id;
}

// ── The name this browser stated, per deck (REQ076) ───────────
//
// Kept locally for one reason: so a reload does not ask again. The **server's**
// copy is the one that counts — it is what the roster and both exports read —
// and this is a note to self about a question already answered, keyed per deck
// because a name is stated on a deck rather than on a browser.
//
// Deliberately not fetched back from the server: there is no participant-facing
// read of the roster and there must not be one, since "what is participant X
// called?" answered to anybody holding an id would turn a room's names into a
// public lookup. A browser that loses its storage is asked again, which is the
// same correction path as stating a different name — one row per participant,
// overwritten in place.

/**
 * Every name this browser has stated, or `{}` where there is nothing usable to
 * read one out of.
 *
 * The shape is checked, not only the parse: `JSON.parse("null")` throws nothing
 * and answers `null`, and an array parses just as happily — either would take
 * the whole participant screen down on the next property read, over a value that
 * is a note to self about a question already answered. A map that is not a map
 * is one this browser did not write.
 */
function getParticipantNameMap(): Record<string, string> {
	try {
		const parsed = JSON.parse(localStorage.getItem(PARTICIPANT_NAME_KEY) || "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, string>)
			: {};
	} catch {
		return {};
	}
}

/** The name this browser stated on a deck, or `""` when it has stated none. */
export function getStatedParticipantName(presentationId: string): string {
	const stored = getParticipantNameMap()[presentationId];
	return typeof stored === "string" ? stored : "";
}

/** Remember the name the server kept, so a reload does not ask for it again. */
export function rememberStatedParticipantName(
	presentationId: string,
	name: string,
): void {
	try {
		const map = getParticipantNameMap();
		map[presentationId] = name;
		localStorage.setItem(PARTICIPANT_NAME_KEY, JSON.stringify(map));
	} catch {
		// Storage denied. The name is already on the server, so the session works;
		// what this browser loses is the memory that it answered, and it will be
		// asked again after a reload.
	}
}

/**
 * Forget the name stated on one deck — what a **reset** leaves behind otherwise
 * (REQ101).
 *
 * The server drops the whole roster when a session is cleared, so this note to
 * self outlives the thing it was a note about: without this the browser would
 * never be asked again, and every answer it gave in the re-run would be stored
 * under nobody. Keyed per deck, like everything else here — resetting one
 * session says nothing about another.
 */
export function forgetStatedParticipantName(presentationId: string): void {
	try {
		const map = getParticipantNameMap();
		delete map[presentationId];
		localStorage.setItem(PARTICIPANT_NAME_KEY, JSON.stringify(map));
	} catch {
		// Storage denied — there was nothing remembered to forget.
	}
}
