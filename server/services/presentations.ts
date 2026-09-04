import { resolveUserId } from "../accounts";
import { createCoalescer } from "../coalesce";
import { createStore } from "../db";
import { createKeyedLock } from "../keyed-lock";
import {
	emptyTestVoteSet,
	generateDeckTestVotes,
	type TestVoteSet,
} from "../preview";
import {
	deckAccessLevelFor,
	listGrantsForUser,
	revokeAllDeckAccess,
} from "./collaborators";
import {
	deleteDeckParticipantNames,
	listParticipantNames,
	participantNameLookup,
	setParticipantName,
} from "./participant-names";
import { deleteDeckComments } from "./slide-comments";
import { workspaceRoleFor } from "./workspaces";
import {
	acceptedQuizAnswers,
	audienceViewBlanked,
	canGrandfatherLegacyDeck,
	canMutateDeck,
	type DeckAccessLevel,
	strongestDeckAccessLevel,
	workspaceDeckAccessLevel,
	type WorkspaceRole,
	correctGuessRangeFor,
	decodeFormSubmission,
	decodeGridPoint,
	decodeGuess,
	decodePinPoint,
	decodePoints,
	decodeQuizAnswer,
	decodeRanking,
	deckRequiresParticipantName,
	DEFAULT_DECK_THEME,
	type DeckBrand,
	type DeckThemeId,
	EDIT_TOKEN_HEADER,
	EMPTY_DECK_BRAND,
	encodeFormSubmission,
	encodeGridPoint,
	encodeGuess,
	encodePinPoint,
	encodePoints,
	encodeRanking,
	formFieldsFor,
	gridAxesFor,
	readFormSubmission,
	guessBucketsFor,
	guessRangeFor,
	guessReferenceFor,
	isCorrectQuizAnswer,
	isPinInArea,
	isQuizWindowOpen,
	isStandingQuizAnswer,
	type LeaderboardEntry,
	leaderboardEntryLabel,
	leaderboardSizeFor,
	type LeaderboardTotals,
	type LiveRoomState,
	maxResponsesFor,
	maxSelectionsFor,
	normalizeQuestionText,
	normalizeQuizAnswer,
	pinAreaFor,
	pinImageFor,
	POINTS_BUDGET,
	PREVIEW_DEFAULT_RESPONDENTS,
	type ChatMessageEntry,
	type ParticipantChannelSettings,
	participantChannelsFor,
	type ParticipantNameSettings,
	type ParticipantRosterEntry,
	ParticipantRosterEntrySchema,
	orderParticipantRoster,
	type QAListEntry,
	qaListVisibleToAudience,
	qaQuestionsVisibleTo,
	type QASettings,
	qaSettingsFor,
	type QAVisibility,
	type ReactionKind,
	recentChatMessages,
	rankLeaderboardEntries,
	rankQAQuestions,
	type ResultsCaller,
	type ResultsLink,
	RESULTS_TOKEN_HEADER,
	type ResultsVisibility,
	type TallyRevealState,
	tallyVisibleToCaller,
	withheldTally,
	withInheritedResultsVisibility,
	withoutUnwritableFields,
	withSlideParticipation,
	QUIZ_CORRECT_POINTS,
	QUIZ_MAX_POINTS,
	QUIZ_SPEED_POINTS,
	type QuizAnswerMode,
	quizAnswerModeFor,
	quizDeadlineFor,
	quizTimeLimitFor,
	scoreQuizAnswer,
	type Slide,
	type SlideType,
	slideAcceptsSubmissions,
	slideAnswersAreDeletable,
	solutionVisibleToAudience,
	type VoteRefusalCode,
	voteValueLimitFor,
	withAudienceSlides,
	StoredChatMessageSchema,
	StoredPresentationSchema,
	StoredQAQuestionSchema,
	StoredQAUpvoteSchema,
	StoredResponseVoteSchema,
	StoredVoteSchema,
	slideHasCorrectAnswers,
	PresentationSchema,
	type StoredResponseVote,
	type StoredVote,
} from "../schemas";
import { participantIdsIn, type ResultsExportInput } from "../results-export";
import {
	type SegmentBucket,
	SEGMENT_MIN_RESPONDENTS,
	SEGMENT_REFUSAL_REASONS,
	type SegmentRefusal,
	segmentBucketsFor,
	segmentDisclosure,
	segmentedTallyIsAggregate,
	segmentRefusalFor,
} from "../segmentation";
import { broadcastToPresentation } from "../ws";

// Index the fields each collection filters on so lookups hit a json_extract
// expression index instead of scanning (see the where-clauses below).
// `workspaceId` is indexed beside `creatorId` because it is the same question
// asked of the other kind of owner (REQ128): "which decks are this workspace's?"
// is the workspace's own deck list, and it runs on every visit to one.
const presentations = createStore("presentations", StoredPresentationSchema, {
	indexes: ["code", "creatorId", "workspaceId"],
});
const votes = createStore("votes", StoredVoteSchema, {
	indexes: ["presentationId", "slideId", "participantId", "statementId"],
});
const responseVotes = createStore("responseVotes", StoredResponseVoteSchema, {
	indexes: ["presentationId", "slideId", "responseId", "participantId"],
});
// The Q&A layer's own two collections (REQ036/REQ060). Presentation-scoped
// rather than slide-scoped — a question asked from slide 4 is a question for the
// deck, and the layer exists precisely so it does not belong to a slide.
const qaQuestions = createStore("qaQuestions", StoredQAQuestionSchema, {
	indexes: ["presentationId", "participantId"],
});
const qaUpvotes = createStore("qaUpvotes", StoredQAUpvoteSchema, {
	indexes: ["presentationId", "questionId", "participantId"],
});
// The deck's live chat (REQ078). Presentation-scoped for the reason the Q&A
// collections are: the channel is the session's, not any one slide's.
//
// There is deliberately **no reactions collection** beside it (REQ077) — a
// reaction is broadcast and forgotten, so there is nothing here for a tally to
// find. See `sendReaction` below.
const chatMessages = createStore("chatMessages", StoredChatMessageSchema, {
	indexes: ["presentationId", "participantId"],
});

/**
 * The queue every "read what is already stored, then decide what to store" in
 * the vote path runs in — see {@link voteWriteKey} for what one key covers and
 * `server/keyed-lock.ts` for why those sections need one at all.
 *
 * One lock rather than one per slide type: the keys below are disjoint by
 * construction (a slide has one type), and a second instance would be the same
 * queue under a second name.
 */
const voteWriteLock = createKeyedLock();

/**
 * What one participant answering one question must not interleave with: their
 * own other submissions to it, and nothing else.
 *
 * Deliberately the narrowest key that still covers the invariant — REQ054's
 * one-answer rule on a quiz, the response cap on a word cloud (REQ022/REQ026),
 * the single row every ranking, ballot, guess, pin and form holds. A whole room
 * answers the same question in the same second, and keying on the slide would
 * put all of them in one queue to protect something that is per-participant
 * anyway.
 *
 * `statementId` narrows it once more where the row is per statement rather than
 * per slide (a multi-statement scale, REQ029; a 2x2 grid, REQ046), so a
 * participant placing two items at once is not queued behind themselves.
 */
function voteWriteKey(
	presentationId: string,
	slideId: string,
	participantId: string,
	statementId: string | null = null,
): string {
	const perParticipant = `${presentationId}:${slideId}:${participantId}`;
	return statementId ? `${perParticipant}:${statementId}` : perParticipant;
}

/**
 * The one key wide enough for the duplicate fold (REQ025), which is the one
 * invariant in this file that is *not* per participant: "has anybody already
 * said this?" is a question about the whole slide, so two participants typing
 * the same words at once have to be queued behind each other or they both read
 * "nobody has" and both store a fresh response.
 *
 * Only open-text slides with response voting on ever take this key — a word
 * cloud, the higher-volume of the two types, keeps the per-participant one.
 */
function responseFoldKey(presentationId: string, slideId: string): string {
	return `${presentationId}:${slideId}`;
}

/**
 * What one participant upvoting one response must not interleave with: their own
 * other taps on it. The toggle is a read-modify-write like the rest (REQ025), and
 * two taps landing together would both read "not upvoted yet" and both insert —
 * leaving a count one person inflated and a toggle that can only take one row
 * back off.
 */
function responseUpvoteKey(
	presentationId: string,
	slideId: string,
	responseId: string,
	participantId: string,
): string {
	return `${presentationId}:${slideId}:${responseId}:${participantId}`;
}

/**
 * What one of these rows carries beyond its identity: the value, and — where the
 * row belongs to a sub-item rather than to the slide — the statement it answers
 * and whether it was skipped.
 *
 * A union rather than a bag of unknowns, so the scale and grid call sites cannot
 * pass one half of that pair without the other.
 */
type SingleRowVotePayload =
	| { value: string }
	| { value: string; statementId: string; skip: boolean };

/**
 * Store the one row a participant holds on this slide — replacing the one they
 * already hold, or writing their first — with the read and the write in the same
 * turn.
 *
 * Every single-row slide type went through its own copy of this: find the
 * participant's rows, update the first, insert if there were none. Each copy
 * `await`ed the find, so each had the gap REQ147 found on the quiz branch and
 * REQ148 reproduced on the word cloud — two submissions from one device read the
 * same "nothing is there yet" and both insert. The tidy-up the copies carried
 * ("collapse any extras") only runs if that device submits a *third* time, which
 * on a guess, a pin or a ranking is exactly what a participant who has answered
 * does not do: the room's distribution counts them twice until the deck ends.
 *
 * So the section is queued per participant per slide (see {@link voteWriteKey}),
 * and the tidy-up stays for the rows written before it was. The caller
 * broadcasts: recounting the slide and writing to every socket in the room is no
 * part of the decision the queue protects.
 */
async function storeSingleRowVote(
	presentationId: string,
	slideId: string,
	participantId: string,
	payload: SingleRowVotePayload,
	statementId: string | null = null,
): Promise<Record<string, unknown>> {
	return voteWriteLock.run(
		voteWriteKey(presentationId, slideId, participantId, statementId),
		async () => {
			// `statementId` is matched, never omitted — including when it is null.
			// Leaving it out of the where-clause would widen the lookup to *every*
			// row this participant holds on the slide, so a submission that carries
			// no statement (which the request schema allows: `statementId` is
			// nullable, and a multi-statement scale falls through to the default
			// branch without one) would replace one of their per-statement rows and
			// the collapse below would delete the rest. Stored rows default
			// `statementId` to null and the store compiles a null operand
			// to `IS NULL`, so this matches exactly the rows the key covers and
			// nothing else.
			const existing = await votes.find({
				presentationId,
				slideId,
				participantId,
				statementId,
			});
			if (existing.length > 0) {
				await votes.update(existing[0].id as string, payload);
				// A participant holds one row here by construction; collapse whatever a
				// deck written before this queue existed is still carrying, so the tally
				// cannot count one person twice.
				for (const extra of existing.slice(1)) {
					await votes.remove(extra.id as string);
				}
				return existing[0];
			}
			return votes.insert({
				presentationId,
				slideId,
				participantId,
				...payload,
				createdAt: new Date().toISOString(),
			});
		},
	);
}

/** Generate a random 6-digit join code */
async function generateCode(): Promise<string> {
	const code = Math.floor(100000 + Math.random() * 900000).toString();
	// Ensure uniqueness
	const existing = await presentations.find({ code });
	if (existing.length > 0) return generateCode();
	return code;
}

/** Hash a creator token using SHA-256. Synchronous via Bun.CryptoHasher. */
function hashToken(token: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(token);
	return hasher.digest("hex");
}

// ── Presentation CRUD ────────────────────────────────────────

export async function createPresentation(
	title: string,
	slides: Slide[],
	opts: {
		language?: string;
		mode?: "live" | "survey";
		resultsVisibility?: "instant" | "on-click" | "private";
		/** The Q&A layer, authored with the deck (REQ036/REQ037). */
		qaEnabled?: boolean;
		qaVisibility?: QAVisibility;
		/** The participant channels, authored with the deck (REQ077/REQ078). */
		reactionsEnabled?: boolean;
		chatEnabled?: boolean;
		/** Whether the room states its names on joining (REQ076). */
		requireParticipantName?: boolean;
		/**
		 * The deck's appearance (REQ079/REQ080) and the organizer's mark (REQ136) —
		 * a built-in theme's id, the theme the deck defines for itself, or both.
		 */
		theme?: DeckThemeId;
		themeBrand?: DeckBrand;
		themeLogoUrl?: string;
		themeLogoAlt?: string;
	} = {},
	auth: {
		/** The account creating this deck, when signed in (else null → anonymous). */
		creatorId?: string | null;
		/**
		 * Whether to mint a per-presentation edit token. Anonymous and cookie-session
		 * creates get one (kept in the browser so edits survive signing out); an
		 * API-key create is already owner-editable via that key, so it is NOT minted
		 * a redundant token (`creatorToken: null` in the response). Defaults to true.
		 */
		mintToken?: boolean;
		/**
		 * The workspace this deck belongs to (REQ128), when the create named one and
		 * the route confirmed the caller may create decks there.
		 *
		 * It **replaces** the account owner rather than sitting beside it: the two
		 * writes below are the whole of "a workspace can own decks itself rather than
		 * through one account", and an account recorded here as well would be one
		 * whose removal from the workspace left it holding the deck anyway. For the
		 * same reason no edit token is minted for one — a workspace deck's standing
		 * is its roster, and a forwardable capability nobody in the workspace can
		 * revoke is not something a create should hand out silently.
		 */
		workspaceId?: string | null;
	} = {},
) {
	const workspaceId = auth.workspaceId ?? null;
	const mintToken = workspaceId ? false : (auth.mintToken ?? true);
	// When minting, generate a plaintext token (returned once) and store only its
	// hash; an API-key create stores no hash and returns a null token.
	const creatorToken = mintToken ? crypto.randomUUID() : null;
	const creatorTokenHash = creatorToken ? hashToken(creatorToken) : null;

	const presentation = await presentations.insert({
		title,
		slides,
		code: await generateCode(),
		activeSlideIndex: 0,
		status: "draft",
		language: opts.language ?? "en",
		mode: opts.mode ?? "live",
		resultsVisibility: opts.resultsVisibility ?? "instant",
		revealedSlideIds: [],
		// The withholding value is what an unstated setting means (REQ037): a deck
		// created by a client that has never heard of the Q&A layer must not come
		// into being publishing its room's questions.
		qaEnabled: opts.qaEnabled ?? false,
		qaVisibility: opts.qaVisibility ?? "presenter",
		// REQ077/REQ078 — closed is what an unstated channel means, for the reason
		// directly above: a client that has never heard of reactions or of the chat
		// must not create a deck that opens either to the room.
		reactionsEnabled: opts.reactionsEnabled ?? false,
		chatEnabled: opts.chatEnabled ?? false,
		// REQ076 — and here the withholding value is the strongest of the three: a
		// client that has never heard of this setting must not create a deck that
		// asks a room for its names.
		requireParticipantName: opts.requireParticipantName ?? false,
		// REQ079/REQ080/REQ136 — the house theme is what an unstated one means, an
		// unstated brand authors nothing, and an unstated logo is no logo. All
		// spelled out rather than left to the stored schema's defaults, so what a
		// create actually writes is readable here.
		theme: opts.theme ?? DEFAULT_DECK_THEME,
		themeBrand: opts.themeBrand ?? EMPTY_DECK_BRAND,
		themeLogoUrl: opts.themeLogoUrl ?? "",
		themeLogoAlt: opts.themeLogoAlt ?? "",
		creatorId: workspaceId ? null : (auth.creatorId ?? null),
		creatorTokenHash,
		workspaceId,
		createdAt: new Date().toISOString(),
	});

	// Return the plaintext token (or null) alongside the presentation — never stored.
	return { ...presentation, creatorToken };
}

// ── Authorization: owner, edit token, or a collaborator's granted level ──────
//
// A presentation is editable by its **owner** (the account in `creatorId`, proven
// by a cookie session OR a personal API key — both resolved by `resolveUserId`)
// OR by whoever holds its **edit token** (the `creatorToken` from creation). The
// two are independent capabilities — the owner-or-edit-token
// model. Legacy presentations that pre-date auth (no owner AND no token hash) are
// grandfathered as editable so existing decks keep working.
//
// Since REQ075 there is a **third** way an account can have standing: the owner
// has shared the deck with it at a stated level (`view` / `comment` / `edit`).
// Unlike the first two it is not a yes/no — it resolves to a level, and the level
// is what every gated route is decided by. All three are answered in one place,
// {@link resolveDeckAccess}, precisely so a route cannot consult two of them and
// forget the third.

/**
 * What this request states under `name`, or `null` when it states nothing.
 *
 * A header that is present but blank is no claim, so it must not *shadow* the
 * fallback behind it either — a proxy or client that always sets the header,
 * empty when it has nothing, would otherwise silently demote a caller that did
 * state its token. Composed by both readers below so the two
 * credentials are read on one rule.
 */
function statedHeader(headers: Headers, name: string): string | null {
	return headers.get(name)?.trim() || null;
}

/**
 * Read the per-presentation edit token from a request. Prefers the dedicated
 * `X-Omul-Edit-Token` header and falls back to the `Authorization: Bearer
 * <token>` slot the web UI has always used. Returns null when none is present.
 *
 * Which header the token arrived in changes nothing about what it proves: the
 * value is checked against the deck's stored hash either way.
 */
export function editTokenFromHeaders(headers: Headers): string | null {
	const dedicated = statedHeader(headers, EDIT_TOKEN_HEADER);
	if (dedicated) return dedicated;
	const authHeader = headers.get("authorization") ?? "";
	if (authHeader.startsWith("Bearer ")) {
		const token = authHeader.slice(7).trim();
		if (token) return token;
	}
	return null;
}

/** Whether `token` matches a presentation's stored edit-token hash. */
function tokenMatches(
	pres: Record<string, unknown>,
	token: string | null,
): boolean {
	const hash = pres.creatorTokenHash as string | null;
	if (!token || !hash) return false;
	return hashToken(token) === hash;
}

/** What a request has proved about its standing on one deck (REQ075, REQ129). */
export type DeckAccess = {
	/**
	 * The caller's effective level, or `null` when they have no standing at all.
	 * Owner, edit-token holder and grandfathered legacy deck all resolve to
	 * `"edit"` — the three ways of being the deck's editor say the same thing
	 * about what may be changed, and differ only in what proved it.
	 */
	level: DeckAccessLevel | null;
	/** The account behind the request, or `null` when it is not signed in. */
	userId: string | null;
	/** Whether that account is the deck's owner (`creatorId`). */
	isOwner: boolean;
	/** Whether the level came from a collaborator grant rather than the first three. */
	viaGrant: boolean;
	/** The workspace that owns this deck (REQ128), or `null` for an account's own. */
	workspaceId: string | null;
	/**
	 * The caller's role in that workspace (REQ129), or `null` when the deck is not
	 * a workspace's or the caller is not in it. Carried alongside the level rather
	 * than folded into it because the two answer different questions: the level
	 * says what may be changed *on the deck*, while the role is what the two acts
	 * an owner keeps to themselves are decided by — deleting it, and deciding who
	 * outside the workspace it is shared with (see `canAdministerWorkspaceDecks`).
	 */
	workspaceRole: WorkspaceRole | null;
	/** Whether the level came from that role rather than from a deck-level standing. */
	viaWorkspace: boolean;
};

/**
 * Resolve what a request may do with a fetched presentation — the one place the
 * three ways of having standing on a deck are consulted.
 *
 * Order is not precedence but strength: owner, edit token and the legacy
 * grandfather each mean `edit`, so a collaborator grant is only reached when
 * none of them applied. That way an owner who has *also* been granted `view` on
 * their own deck (which the share route refuses to create, but a store can hold)
 * is not demoted by it — a weaker grant can never take away a stronger standing.
 *
 * Since REQ128 there is a **fourth**: the deck belongs to a workspace and the
 * caller is in it. It is resolved here beside the grant rather than anywhere
 * else for the reason the grant is — a route that consulted one ownership model
 * and forgot the other would refuse a workspace's own members on their own decks,
 * or worse, admit somebody the workspace has removed. A caller can hold both, and
 * the **strongest** of the two stands: two independent reasons to be on a deck do
 * not weaken each other (see `strongestDeckAccessLevel`).
 *
 * @param allowLegacy grandfather pre-auth decks (no owner, no token hash). True
 *   for ordinary edits (backward compatibility); pass false for ownership-
 *   assigning actions (claim) and for "may this caller see what the organizer
 *   authored?", where an unprovable legacy deck must not make every anonymous
 *   participant an editor. A **workspace** deck is never grandfathered whatever
 *   this says — it has no owner and no token hash by construction, so reading it
 *   as pre-auth would hand `edit` to anyone who could type its id
 *   ({@link canGrandfatherLegacyDeck}).
 */
export async function resolveDeckAccess(
	pres: Record<string, unknown>,
	headers: Headers,
	allowLegacy = true,
): Promise<DeckAccess> {
	const userId = await resolveUserId(headers);
	const ownerId = (pres.creatorId as string | null) ?? null;
	const workspaceId = (pres.workspaceId as string | null) ?? null;
	const isOwner = Boolean(ownerId && userId && ownerId === userId);
	const hasToken = tokenMatches(pres, editTokenFromHeaders(headers));
	const isLegacy =
		allowLegacy &&
		canGrandfatherLegacyDeck({
			creatorId: ownerId,
			creatorTokenHash: (pres.creatorTokenHash as string | null) ?? null,
			workspaceId,
		});
	// Only a signed-in account can be in a workspace or hold a grant: both name an
	// account, and there is nothing for an anonymous request to be matched against.
	const workspaceRole =
		userId && workspaceId ? await workspaceRoleFor(workspaceId, userId) : null;
	if (isOwner || hasToken || isLegacy) {
		return {
			level: "edit",
			userId,
			isOwner,
			viaGrant: false,
			workspaceId,
			workspaceRole,
			viaWorkspace: false,
		};
	}
	const granted = userId
		? await deckAccessLevelFor(pres.id as string, userId)
		: null;
	const fromWorkspace = workspaceDeckAccessLevel(workspaceRole);
	const level = strongestDeckAccessLevel([granted, fromWorkspace]);
	return {
		level,
		userId,
		isOwner,
		viaGrant: level !== null && level === granted,
		workspaceId,
		workspaceRole,
		viaWorkspace: level !== null && level === fromWorkspace,
	};
}

/**
 * Resolve what a request's **account** may do with a fetched presentation — the
 * same three levels as {@link resolveDeckAccess}, minus the two standings that
 * are not an account (REQ074).
 *
 * The edit token and the legacy grandfather are deliberately not consulted here,
 * and the reason is the one `requireDeckOwner` gives for refusing the token on
 * the sharing surface: it is an anonymous, forwardable capability with nobody
 * behind it. A comment has an author, so there is nothing for a token holder to
 * be recorded as; and the token is handed out as an edit *link*, so reading it
 * as standing on the deck's private conversation would mean anyone forwarded one
 * — a co-presenter, a participant who was sent the wrong URL — could read what
 * the accounts on the deck said to each other. A grandfathered pre-auth deck
 * fails the same way and worse, since it would make every anonymous caller an
 * editor of a deck nobody owns.
 *
 * So the only standings that resolve are the ones an account can hold: being the
 * deck's owner, holding a grant on it, or — since REQ128 — being in the workspace
 * that owns it, which is an account standing on exactly the same terms and is
 * what makes the deck's threads readable by the team that keeps the deck.
 * Everything else is `null`, which is the withholding answer both comment
 * predicates refuse.
 */
export async function resolveDeckAccountAccess(
	pres: Record<string, unknown>,
	headers: Headers,
): Promise<{ userId: string | null; level: DeckAccessLevel | null }> {
	const userId = await resolveUserId(headers);
	if (!userId) return { userId: null, level: null };
	const ownerId = (pres.creatorId as string | null) ?? null;
	if (ownerId && ownerId === userId) return { userId, level: "edit" };
	const workspaceId = (pres.workspaceId as string | null) ?? null;
	const fromWorkspace = workspaceId
		? workspaceDeckAccessLevel(await workspaceRoleFor(workspaceId, userId))
		: null;
	const granted = await deckAccessLevelFor(pres.id as string, userId);
	return {
		userId,
		level: strongestDeckAccessLevel([granted, fromWorkspace]),
	};
}

/**
 * Decide whether a request may **mutate** a fetched presentation.
 *
 * A thin reading of {@link resolveDeckAccess} through {@link canMutateDeck},
 * kept as its own function because it is what every gated route asks and the
 * answer must not be re-derived per route by comparing level strings.
 *
 * @returns `authorized` plus the resolved `userId` (so the route can pick 401 vs
 *   403), `isOwner` (so it can avoid re-resolving) and the `level` itself.
 */
export async function authorizeEdit(
	pres: Record<string, unknown>,
	headers: Headers,
	allowLegacy = true,
): Promise<{
	authorized: boolean;
	userId: string | null;
	isOwner: boolean;
	level: DeckAccessLevel | null;
}> {
	const access = await resolveDeckAccess(pres, headers, allowLegacy);
	return {
		authorized: canMutateDeck(access.level),
		userId: access.userId,
		isOwner: access.isOwner,
		level: access.level,
	};
}

/**
 * Attach an ownerless presentation to `userId`. Ownership is **never reassigned**:
 * a deck already owned by another account is `owned-by-other`; re-claiming your
 * own is an idempotent `already-owner`.
 *
 * A deck a **workspace** owns is `owned-by-workspace` and is never claimable
 * (REQ128), even though its `creatorId` is `null`. Ownerless is not the same as
 * unowned: the workspace is the owner, and a member who could claim it out from
 * under the workspace would be able to take a shared deck private with one
 * request that nobody else in the workspace is told about. Moving one back out is
 * a deliberate, owner-gated act — see {@link setPresentationWorkspace}.
 */
export async function claimOwnership(
	id: string,
	userId: string,
): Promise<
	| { status: "not-found" }
	| { status: "owned-by-other" }
	| { status: "owned-by-workspace" }
	| { status: "already-owner"; pres: Record<string, unknown> }
	| { status: "claimed"; pres: Record<string, unknown> }
> {
	const pres = await presentations.findOne(id);
	if (!pres) return { status: "not-found" };
	if ((pres.workspaceId as string | null) ?? null) {
		return { status: "owned-by-workspace" };
	}
	const ownerId = (pres.creatorId as string | null) ?? null;
	if (ownerId && ownerId !== userId) return { status: "owned-by-other" };
	if (ownerId === userId) return { status: "already-owner", pres };
	const updated = await presentations.update(id, { creatorId: userId });
	return { status: "claimed", pres: updated ?? pres };
}

/**
 * Every deck a workspace owns (REQ128), newest first — the workspace's own half
 * of `GET /api/presentations/mine`.
 *
 * A filter on the deck document rather than a list kept on the workspace, for the
 * reason a deck's owner is a field rather than a row in an `ownedDecks` table:
 * there is exactly one place a deck's ownership is written, so there is exactly
 * one place it can be wrong. Answers `[]` for a workspace that does not exist,
 * which is the same answer as one that owns nothing — the caller's membership was
 * checked before this was reached, and a stranger never gets here.
 */
export async function listWorkspacePresentations(workspaceId: string) {
	if (!workspaceId) return [];
	const results = await presentations.find({ workspaceId });
	return results.sort(
		(first, second) =>
			new Date(second.createdAt as string).getTime() -
			new Date(first.createdAt as string).getTime(),
	);
}

/**
 * Move one deck between a personal account and a workspace (REQ128) — the one
 * writer of `workspaceId`, and the reason it is on
 * {@link UNWRITABLE_PRESENTATION_FIELDS} rather than reachable from a patch.
 *
 * Both directions rewrite the deck's whole ownership in one write, because the
 * fields are alternatives rather than layers:
 *
 *  - **Into a workspace** — `workspaceId` is set, `creatorId` is cleared, and so
 *    is `creatorTokenHash`. Clearing the owner is REQ128's "rather than through
 *    one account"; clearing the token is the same sentence applied to the deck's
 *    other credential. An edit link handed out before the move is anonymous and
 *    forwardable, and nobody in the workspace can revoke it — so it would be a
 *    standing on a shared deck that the shared roster cannot reach, which is
 *    precisely what moving the deck in was supposed to end. Whoever held it is in
 *    the workspace or is not; either way the roster now says so.
 *  - **Out of it** — `workspaceId` is cleared and `newOwnerId` becomes the deck's
 *    account owner. No token is minted: the account owns it, and a deck's owner
 *    has never needed one.
 *
 * The deck's collaborator grants (REQ075) are deliberately untouched in both
 * directions. A grant is a decision about one account and one deck, and moving
 * the deck does not unmake it; the two models coexist, with the strongest
 * standing winning (see {@link resolveDeckAccess}).
 *
 * Who may perform either move is the route's question — it is about the caller's
 * role at both ends, and nothing about the caller reaches here.
 */
export async function setPresentationWorkspace(
	id: string,
	workspaceId: string | null,
	newOwnerId: string | null,
): Promise<Record<string, unknown> | null> {
	const pres = await presentations.findOne(id);
	if (!pres) return null;
	return presentations.update(
		id,
		workspaceId
			? { workspaceId, creatorId: null, creatorTokenHash: null }
			: { workspaceId: null, creatorId: newOwnerId },
	);
}

/**
 * Force-set a presentation's owner regardless of the current owner — the admin
 * override behind the reassign-owner action. Returns the updated deck or null
 * when the presentation is gone.
 */
export async function assignOwner(id: string, userId: string) {
	const pres = await presentations.findOne(id);
	if (!pres) return null;
	return presentations.update(id, { creatorId: userId });
}

// ── The shareable results link (REQ098) ──────────────────────
//
// A second, weaker capability on the same deck: a random token whose SHA-256
// hash is stored beside the edit token's, presented in a header of its own, and
// good for exactly one thing — reading the deck's tallies whatever its reveal
// mode says. It authorizes no mutation, no export, no answer key and no
// per-participant row; the only place it is consulted is the results caller
// below, which is what makes "carries no edit authority" a property of where the
// check lives rather than a list of routes somebody has to keep in step.
//
// One link per deck. Revoking is clearing the hash, and it therefore retires
// every copy of the link that was ever handed out — see `revokeResultsLink`.

/**
 * Read a results-link token off a request (REQ098), or `null` when none rides
 * it. Its own header, never the `Authorization` slot the edit token answers on:
 * a server that read one capability out of the other's slot would be deciding
 * which one it held by trying both.
 */
export function resultsTokenFromHeaders(headers: Headers): string | null {
	return statedHeader(headers, RESULTS_TOKEN_HEADER);
}

/**
 * What a request's results link entitles it to.
 *
 * `presented` says a token rode the request at all, and it is separate from
 * `valid` on purpose: a link that has been revoked must be answered with a
 * refusal rather than quietly demoted to the public read, or the holder would
 * be shown a deck of withheld markers and left to guess whether the organizer
 * had revoked their link or simply made the deck private.
 *
 * **No legacy grandfathering.** A deck with no stored hash grants nothing to
 * anybody — unlike {@link authorizeEdit}, where a pre-auth deck with neither
 * owner nor token is editable. This capability did not exist before it was
 * stored, so there is no deck it can be owed to, and the safe answer is the one
 * that needs no exception.
 */
export function authorizeResultsLink(
	pres: Record<string, unknown>,
	headers: Headers,
): { presented: boolean; valid: boolean } {
	const token = resultsTokenFromHeaders(headers);
	if (!token) return { presented: false, valid: false };
	const hash = (pres.resultsTokenHash as string | null) ?? null;
	if (!hash) return { presented: true, valid: false };
	return { presented: true, valid: hashToken(token) === hash };
}

/**
 * The deck's results link as its organizer reads it — never the secret, which
 * only {@link mintResultsLink} can produce. Pure: a fetched deck in, the wire
 * shape out.
 */
export function resultsLinkStatus(pres: Record<string, unknown>): ResultsLink {
	const hash = (pres.resultsTokenHash as string | null) ?? null;
	return {
		active: Boolean(hash),
		issuedAt: (pres.resultsTokenIssuedAt as string | null) ?? null,
		// The plaintext is stored nowhere, so no read after the mint can carry it.
		// Emitted as an explicit null rather than dropped.
		resultsToken: null,
	};
}

/**
 * Mint the deck's results link, returning the plaintext token **once** (REQ098).
 *
 * Minting is also a revoke: the deck holds one link, so writing a fresh hash
 * retires whatever was there and every copy of the previous link stops working
 * at its next request. That is the whole of "rotate" — there is no second slot
 * for an old token to keep answering from — and it is why the organizer's
 * surface says so before it replaces one.
 */
export async function mintResultsLink(
	id: string,
): Promise<ResultsLink | null> {
	const pres = await presentations.findOne(id);
	if (!pres) return null;
	const resultsToken = crypto.randomUUID();
	const issuedAt = new Date().toISOString();
	await presentations.update(id, {
		resultsTokenHash: hashToken(resultsToken),
		resultsTokenIssuedAt: issuedAt,
	});
	return { active: true, issuedAt, resultsToken };
}

/**
 * Revoke the deck's results link (REQ098): the hash is cleared, so the next
 * request any copy of that link makes is refused. Immediate and total — there is
 * no expiry to wait out, no grace window, and nothing server-side that still
 * remembers the secret.
 *
 * Idempotent. Revoking a deck that has no link is a no-op that reports the state
 * it is already in, because "there is no link" is the outcome the caller asked
 * for either way.
 */
export async function revokeResultsLink(
	id: string,
): Promise<ResultsLink | null> {
	const pres = await presentations.findOne(id);
	if (!pres) return null;
	await presentations.update(id, {
		resultsTokenHash: null,
		resultsTokenIssuedAt: null,
	});
	return { active: false, issuedAt: null, resultsToken: null };
}

/**
 * Verify that `token` is the correct creator token for the given presentation.
 * Returns true for presentations that pre-date auth (no hash stored) for
 * backward compatibility.
 */
export async function verifyCreatorToken(
	id: string,
	token: string,
): Promise<boolean> {
	const pres = await presentations.findOne(id);
	if (!pres) return false;
	// Backward compat: presentations without a hash are from before auth was added.
	if (!pres.creatorTokenHash) return true;
	return hashToken(token) === (pres.creatorTokenHash as string);
}

export async function getPresentation(id: string) {
	return presentations.findOne(id);
}

export async function getPresentationByCode(code: string) {
	const results = await presentations.find({ code });
	return results[0] ?? null;
}

export async function listPresentations(creatorId?: string) {
	const filter = creatorId ? { creatorId } : {};
	const results = await presentations.find(filter);
	return results.sort(
		(a, b) =>
			new Date(b.createdAt as string).getTime() -
			new Date(a.createdAt as string).getTime(),
	);
}

/**
 * The decks shared with an account, each with the level it was shared at
 * (REQ075) — the collaborator's own half of `GET /api/presentations/mine`.
 *
 * A grant whose deck has since been deleted is dropped rather than reported as
 * a hole: the delete sweeps its grants, so a dangling one means the two writes
 * were interrupted, and the honest reading of "which decks am I on?" is the
 * decks that still exist. Newest grant first — the order a person meets an
 * invitation in.
 */
export async function listPresentationsSharedWith(
	userId: string,
): Promise<{ pres: Record<string, unknown>; level: DeckAccessLevel }[]> {
	const grants = await listGrantsForUser(userId);
	const decks = await Promise.all(
		grants.map(async (grant) => {
			const pres = await presentations.findOne(grant.presentationId);
			return pres ? { pres, level: grant.level } : null;
		}),
	);
	return decks.filter((entry) => entry !== null);
}

/**
 * Apply a patch to a deck's authored fields and tell the room what moved.
 *
 * The patch is stripped of every credential-bearing field first
 * ({@link withoutUnwritableFields}): the store merges what it is given and
 * `StoredPresentationSchema` declares `creatorId`, `creatorTokenHash` and the
 * results-link pair, so a patch that named one would rewrite the very thing the
 * caller's authorization was resolved from. `PATCH /api/presentations/:id`
 * already refuses them at its body schema; this is the second lock, so the hole
 * cannot be reopened by a route that forgets one. Ownership, the edit token and
 * the results link each move through the function that exists for them alone,
 * and none of those goes through here.
 */
export async function updatePresentation(
	id: string,
	rawChanges: Record<string, unknown>,
) {
	const changes = withoutUnwritableFields(rawChanges);
	const updated = await presentations.update(id, changes);
	if (!updated) return updated;
	// REQ059 — quiz scores are derived from the slide *as it stands now*, so
	// re-marking a correct option re-orders the deck's standings without a single
	// new vote. The board is a different slide from the one that was edited, so
	// nothing else on this path would tell a participant's phone; it would keep
	// showing a race that the edit has already settled differently.
	await broadcastStandings(id);
	// REQ036/REQ037 — the editor saves the Q&A layer's two settings through this
	// same PATCH, so it is a second writer of them beside `setQASettings`. Without
	// this, a presenter who withdraws the question list from the editor mid-session
	// would be told it was saved while every phone in the room kept the setting it
	// already had — and so kept the whole list on screen, since nothing about the
	// deck a client holds would have changed to make it refetch. A control that
	// takes a decision back has to actually take it back.
	if ("qaEnabled" in changes || "qaVisibility" in changes) {
		broadcastQASettings(id, updated);
	}
	// REQ077/REQ078 — and the editor is a second writer of the participant
	// channels for exactly the same reason. A presenter who closes the chat from
	// the editor mid-session must have it close on every phone in the room, not
	// only be told it saved: nothing else about the deck a client holds would
	// change, so nothing would make it stop drawing the box it is still typing in.
	if ("reactionsEnabled" in changes || "chatEnabled" in changes) {
		broadcastChannelSettings(id, updated);
	}
	// REQ015–REQ018 — and the editor is a second writer of the deck's reveal mode
	// for exactly the same reason: "Apply to every question slide" changes the
	// document in the editor and lands here on Save, not through
	// `setDeckResultsVisibility`. Without this, an organizer who switches a live
	// deck to `private` is told it saved while every phone keeps the mode it had
	// — and, because the server does stop publishing, keeps the last tally it was
	// legitimately sent frozen on screen under a question that is now private.
	// The decision has to reach the room whichever door it came through.
	if ("resultsVisibility" in changes) {
		broadcastDeckResultsVisibility(id, updated);
	}
	// REQ076 — and this switch has to reach the room for the reason the three
	// above it do, plus one of its own. Turned **on** mid-session, a phone that
	// had not heard is never asked, so every answer it goes on to give is stored
	// under nobody and the roster silently under-collects. Turned **off**, a
	// participant still standing at the gate submits into a boundary that now
	// refuses them, and — since the gate is drawn from the deck this client holds
	// — has nothing to go back to. This is the *only* writer of the field, so it
	// is the only place the frame goes out from.
	if ("requireParticipantName" in changes) {
		broadcastParticipantNameSetting(id, updated);
	}
	return updated;
}

/**
 * Erase everything a room submitted under one presentation — the votes, the
 * upvotes on open-ended responses, the Q&A questions, the Q&A upvotes, the live
 * chat (REQ078) and the names the room stated on joining (REQ076).
 *
 * All six collections are keyed by `presentationId` and by nothing else, so the
 * deck document is the only handle any surface has on them. Written once because
 * two callers erase the same set for two different reasons — a reset clears the
 * room's answers so the deck can be re-run, a delete clears them because the deck
 * is going away — and a seventh collection remembered in one copy but not the
 * other is exactly how a delete quietly starts leaving something behind again.
 *
 * The names are **in** this set rather than swept beside it the way the comment
 * threads are, and the line between the two is who wrote the thing: a name was
 * stated by the room, so the room that states one at the second run is not the
 * room that stated the first — while a slide's comments were written by the
 * deck's authors, who did not re-run anything.
 *
 * Reactions (REQ077) are not here and need not be: nothing persists one, so
 * there is no row for either caller to miss.
 */
async function eraseParticipantRecords(presentationId: string): Promise<void> {
	await votes.deleteMany({ presentationId });
	await responseVotes.deleteMany({ presentationId });
	await qaUpvotes.deleteMany({ presentationId });
	await qaQuestions.deleteMany({ presentationId });
	await chatMessages.deleteMany({ presentationId });
	await deleteDeckParticipantNames(presentationId);
}

/**
 * Delete a presentation and everything the room wrote under it (REQ146).
 *
 * The records go **before** the deck, not after. What is stored here is not
 * anonymous aggregate — it is the text a participant typed into a word cloud, the
 * question they asked out loud, the line they wrote in the chat (REQ078), the
 * name they stated at the door (REQ076), and the
 * `participantId` tying those rows to one device — and the deck document
 * carrying the id is the only thing that can
 * resolve any of it. Removing the deck first and dying before the rest would
 * leave that behind permanently, unreachable by every route, screen and admin
 * action there is. This order fails the other way: the deck stands, and the
 * presenter's next delete finishes the job.
 *
 * The deck's collaborator grants (REQ075) go the same way and for the same
 * reason, though they are nobody's submission: a grant is a row naming an
 * account, and once the deck it points at is gone no route resolves it, no
 * screen draws it and no control reaches it. It is swept beside the room's
 * records rather than inside `eraseParticipantRecords` because a **reset** must
 * not touch it — re-running a session does not un-share the deck.
 *
 * The comment threads on its slides (REQ074) go with them, on both counts: they
 * are unreachable once the deck is, and they are text the accounts on the deck
 * wrote — which makes leaving them behind worse than leaving a grant, not
 * better. A reset must not touch those either: the room did not write them.
 */
export async function deletePresentation(id: string) {
	await eraseParticipantRecords(id);
	await revokeAllDeckAccess(id);
	await deleteDeckComments(id);
	return presentations.remove(id);
}

// ── Slide navigation ─────────────────────────────────────────

/** Read a presentation's question-opening stamps with every key present. */
function slideStartedAtIn(
	pres: Record<string, unknown>,
): Record<string, string> {
	const stamps = pres.slideStartedAt;
	return stamps && typeof stamps === "object"
		? { ...(stamps as Record<string, string>) }
		: {};
}

/**
 * The question-opening stamps after a slide is reached (REQ057), or `null` when
 * nothing changes because the slide was already opened.
 *
 * Pure, and separate from the write below, because "when did this question
 * open?" is the one input every quiz score is measured against: a slide is
 * stamped on first arrival and keeps that instant however often the presenter
 * pages back through the deck. Only {@link restartSlideTimer} — the presenter
 * deliberately reopening a question — moves it.
 */
function withSlideOpenedOnce(
	stamps: Record<string, string>,
	slideId: string,
	openedAt: string,
): Record<string, string> | null {
	if (stamps[slideId]) return null;
	return { ...stamps, [slideId]: openedAt };
}

export async function setActiveSlide(
	presentationId: string,
	slideIndex: number,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const slides = pres.slides as Slide[];
	if (slideIndex < 0 || slideIndex >= slides.length) return null;

	const slide = slides[slideIndex];
	// Arriving at a slide opens its question (REQ057). Written in the same
	// update as the navigation so a participant can never see the new slide
	// before the instant its countdown runs from.
	const openedAt = new Date().toISOString();
	const stamps = withSlideOpenedOnce(slideStartedAtIn(pres), slide.id, openedAt);

	const updated = await presentations.update(presentationId, {
		activeSlideIndex: slideIndex,
		...(stamps ? { slideStartedAt: stamps } : {}),
	});
	// The slide goes to the whole room, so it travels as the audience may see it
	// (REQ056/REQ090) — a quiz question that is still running must not arrive
	// answered, and the presenter's own notes must not arrive at all. A room is
	// broadcast to by presentation and the `role` a socket claims proves nothing,
	// so this frame is read by every connected client whatever they said they
	// were. The presenter reads solutions and notes from its own authenticated
	// fetch, not from this broadcast.
	broadcastToPresentation(presentationId, "slide.changed", {
		presentationId,
		slideIndex,
		slide: withAudienceSlides(
			[slide],
			{ ...pres, slideStartedAt: stamps ?? slideStartedAtIn(pres) },
			Date.now(),
		)[0],
	});
	if (stamps) {
		broadcastToPresentation(presentationId, "slide.started", {
			presentationId,
			slideId: slide.id,
			startedAt: openedAt,
		});
	}
	return updated;
}

/**
 * Reopen one slide's question, restarting its countdown (REQ057) — the
 * presenter's way back from a mis-navigation that burned a quiz question's
 * window, and from a room that was not ready when the clock started.
 *
 * Deliberately not automatic: see {@link withSlideOpenedOnce} for why arriving
 * at a slide a second time leaves the original instant standing. Answers
 * already given stand too — a restart hands the remaining participants a fresh
 * window, it does not clear the room's answers, which is what `reset` is for.
 */
export async function restartSlideTimer(
	presentationId: string,
	slideId: string,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const slides = pres.slides as Slide[];
	if (!slides.some((slide) => slide.id === slideId)) return null;

	// Unconditional, unlike arriving at a slide: reopening *is* the decision, so
	// there is no already-opened case to leave standing.
	const openedAt = new Date().toISOString();
	const updated = await presentations.update(presentationId, {
		slideStartedAt: { ...slideStartedAtIn(pres), [slideId]: openedAt },
	});
	if (updated) {
		broadcastToPresentation(presentationId, "slide.started", {
			presentationId,
			slideId,
			startedAt: openedAt,
		});
		// A fresh window re-measures every answer already given against it
		// (REQ057's speed half), so the standings move here too — see
		// {@link broadcastStandings} for why the board cannot hear it any other way.
		await broadcastStandings(presentationId);
	}
	return updated;
}

export async function startPresentation(presentationId: string) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	// Going live lands on the first slide, which opens its question the same way
	// navigating to any other slide does (REQ057).
	const slides = pres.slides as Slide[];
	const first = slides[0];
	const openedAt = new Date().toISOString();
	const stamps = first
		? withSlideOpenedOnce(slideStartedAtIn(pres), first.id, openedAt)
		: null;

	const updated = await presentations.update(presentationId, {
		status: "live",
		activeSlideIndex: 0,
		...(stamps ? { slideStartedAt: stamps } : {}),
	});
	if (updated) {
		broadcastToPresentation(presentationId, "presentation.started", {
			presentationId,
		});
		if (stamps && first) {
			broadcastToPresentation(presentationId, "slide.started", {
				presentationId,
				slideId: first.id,
				startedAt: openedAt,
			});
		}
	}
	return updated;
}

export async function endPresentation(presentationId: string) {
	const updated = await presentations.update(presentationId, {
		status: "ended",
	});
	if (updated) {
		broadcastToPresentation(presentationId, "presentation.ended", {
			presentationId,
		});
	}
	return updated;
}

export async function resetPresentation(presentationId: string) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	// Reset status to draft and activeSlideIndex to 0. The question-opening
	// stamps go with the votes they timed (REQ057): a re-run is a fresh quiz,
	// and a deck that kept its old stamps would open every question already
	// expired.
	//
	// The live-room switches go with them for the same reason (REQ111/REQ109).
	// A re-run that inherited the last session's closed questions would refuse a
	// room that had done nothing, and one that inherited a blanked screen would
	// start behind a dark projector with no answer to why.
	const updated = await presentations.update(presentationId, {
		status: "draft",
		activeSlideIndex: 0,
		revealedSlideIds: [],
		slideStartedAt: {},
		closedSlideIds: [],
		audienceBlanked: false,
	});

	// Clear all votes for this presentation, and the questions the room asked
	// alongside them (REQ036), the chat it held (REQ078) and the names it stated
	// on joining (REQ076): a re-run starts with an empty Q&A queue, an empty
	// transcript and an empty roster for the same reason it starts with an empty
	// tally — the audience in front of you is not the one that asked, not the one
	// that was talking, and not the one that gave its names.
	await eraseParticipantRecords(presentationId);

	if (updated) {
		broadcastToPresentation(presentationId, "presentation.reset", {
			presentationId,
		});
	}
	return updated;
}

/**
 * The queue every read-modify-write on a deck's per-slide id lists runs in
 * (`revealedSlideIds`, `closedSlideIds`). Keyed per presentation: two
 * presenters (owner and an edit collaborator) toggling different slides at
 * once would otherwise both read the same stored list and the second write
 * would silently drop the first one's slide — while both broadcasts still go
 * out, leaving every connected client holding a state the server does not.
 */
const slideListLock = createKeyedLock();

/**
 * Reveal or hide aggregated results for a specific slide when its
 * `resultsVisibility === "on-click"` (REQ102). Passing `reveal: false`
 * removes the slide from the revealed list.
 */
export async function setSlideRevealed(
	presentationId: string,
	slideId: string,
	reveal: boolean,
) {
	const updated = await slideListLock.run(
		`revealed:${presentationId}`,
		async () => {
			const pres = await presentations.findOne(presentationId);
			if (!pres) return null;

			const slides = pres.slides as Slide[];
			if (!slides.some((s) => s.id === slideId)) return null;

			const current = (pres.revealedSlideIds as string[] | undefined) ?? [];
			const next = reveal
				? Array.from(new Set([...current, slideId]))
				: current.filter((id) => id !== slideId);

			return presentations.update(presentationId, {
				revealedSlideIds: next,
			});
		},
	);
	if (updated) {
		broadcastToPresentation(presentationId, "slide.revealed", {
			presentationId,
			slideId,
			revealed: reveal,
		});
	}
	return updated;
}

// ── The live room: participation and the blank screen (REQ111, REQ109) ──
//
// Two switches the presenter holds during a session, kept apart on purpose: see
// the section of the same name in `server/schemas.ts` for why neither reads the
// other. Both write one field, broadcast one frame, and touch nothing else —
// no vote is deleted, no slide is navigated, no question's window moves.

/** Read a stored presentation's live-room state, as the schema helpers take it. */
function liveRoomStateOf(pres: Record<string, unknown>): LiveRoomState {
	return {
		closedSlideIds: pres.closedSlideIds as string[] | undefined,
		audienceBlanked: pres.audienceBlanked as boolean | undefined,
	};
}

/**
 * Open or close one slide to submissions (REQ111).
 *
 * The refusal itself lives at the boundary ({@link submitVote} and
 * {@link voteOnResponse}), which is where it has to be: what a client draws is
 * a courtesy, and a closed question that only stopped *looking* answerable
 * would still take an answer from a phone that had not heard yet, or from a
 * hand-built request.
 *
 * Nothing collected is touched. Closing a question keeps every answer already
 * given and every tally built from them, and reopening it does not clear the
 * ones that arrived before — which is the whole difference between this and a
 * reset, and the reason a presenter can close a question, discuss it, and open
 * it again for the people who were still typing.
 *
 * A slide id the deck does not have is a `null` rather than a stored id nothing
 * points at: an unknown id in the closed set would silently outlive the slide
 * it named and could not be reopened from any surface.
 */
export async function setSlideParticipation(
	presentationId: string,
	slideId: string,
	open: boolean,
) {
	const updated = await slideListLock.run(
		`participation:${presentationId}`,
		async () => {
			const pres = await presentations.findOne(presentationId);
			if (!pres) return null;

			const slides = pres.slides as Slide[];
			if (!slides.some((slide) => slide.id === slideId)) return null;

			return presentations.update(presentationId, {
				closedSlideIds: withSlideParticipation(
					(pres.closedSlideIds as string[] | undefined) ?? [],
					slideId,
					open,
				),
			});
		},
	);
	if (updated) {
		broadcastToPresentation(presentationId, "slide.participation", {
			presentationId,
			slideId,
			open,
		});
	}
	return updated;
}

/**
 * Blank the shared screen, or bring it back (REQ109).
 *
 * **The shared screen and nothing else.** What goes dark is the one view the
 * room looks at together — the projected slide — and a participant's own phone
 * is untouched: it keeps its question, its control and its answer. That is not
 * a limitation of this implementation, it is what makes the requirement's own
 * sentence true, since a phone drawn blank could not go on collecting answers
 * and "without closing participation" would mean nothing.
 *
 * So this deliberately writes **one boolean** and leaves `status`,
 * `activeSlideIndex`, `closedSlideIds`, `slideStartedAt` and every stored vote
 * exactly where they were. A blank that also paused the session would be three
 * decisions taken because the presenter asked for one.
 */
export async function setAudienceBlanked(
	presentationId: string,
	blanked: boolean,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const updated = await presentations.update(presentationId, {
		audienceBlanked: blanked,
	});
	if (updated) {
		broadcastToPresentation(presentationId, "presentation.blanked", {
			presentationId,
			blanked: audienceViewBlanked(liveRoomStateOf(updated)),
		});
	}
	return updated;
}

/**
 * Tell the room the deck's reveal mode has moved (REQ015–REQ018).
 *
 * The mode changes what the room may see *now*: a deck switched to `private`
 * mid-session has to stop publishing on the phones already holding it, and one
 * switched to `instant` has to start. The frame carries the deck's own setting
 * and nothing else — every client already holds a copy of it, so there is
 * nothing here an audience was not already sent.
 *
 * Sent from **every** path that writes the mode, which is why it is a function
 * rather than a line inside one of them: the deck-wide operation below is not
 * its only writer — the editor saves the same field through the ordinary deck
 * PATCH (see {@link updatePresentation}) — and a write that told nobody would
 * leave a room reading a tally the organizer had just made private, frozen on
 * the last frame it was legitimately sent, until each participant reloaded.
 * Exactly the failure the Q&A settings broadcast beside it exists to prevent.
 *
 * The frame says the mode moved; it does not say what became of the per-slide
 * overrides, because that depends on which writer sent it. Clients re-read the
 * deck to find out (see `refreshDeckSlides`), which is also how a Pin on Image
 * target area that the new mode has made publishable reaches them (REQ053).
 */
function broadcastDeckResultsVisibility(
	presentationId: string,
	pres: Record<string, unknown>,
): void {
	broadcastToPresentation(presentationId, "presentation.results-visibility", {
		presentationId,
		resultsVisibility:
			(pres.resultsVisibility as ResultsVisibility | undefined) ?? "instant",
	});
}

/**
 * Set the deck's reveal mode and apply it to every question slide in it, in one
 * operation (REQ018).
 *
 * Two writes that have to be one: the deck-level default, and the clearing of
 * the per-slide overrides that would otherwise sit above it
 * ({@link withInheritedResultsVisibility}). Split across two requests, an
 * organizer who ran only the first would have a deck whose setting says
 * `private` and whose four overridden slides still publish live — which is the
 * failure this requirement exists to remove.
 */
export async function setDeckResultsVisibility(
	presentationId: string,
	resultsVisibility: ResultsVisibility,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const updated = await presentations.update(presentationId, {
		resultsVisibility,
		slides: withInheritedResultsVisibility(pres.slides as Slide[]),
	});
	if (updated) {
		broadcastDeckResultsVisibility(presentationId, updated);
	}
	return updated;
}

// ── Submissions ──────────────────────────────────────────────

/**
 * Whether a presentation is in a state that takes anything from the audience at
 * all — a vote, a response upvote, or a question on the Q&A layer.
 *
 * One rule, three callers: a **live** deck is paced by the presenter
 * and collects only once they have started it, a **survey** deck (REQ003/REQ082)
 * is paced by the audience and collects at any status until it is ended. Three
 * copies of that pair is how one of them eventually drifts and a deck starts
 * accepting questions it refuses votes on.
 */
function acceptsSubmissions(pres: Record<string, unknown>): boolean {
	const mode = (pres.mode as "live" | "survey" | undefined) ?? "live";
	if (mode === "survey") return pres.status !== "ended";
	return pres.status === "live";
}

// ── Voting ───────────────────────────────────────────────────

/**
 * Which slide's tally a coalesced run is for. Two values in the coalescer's one
 * string key: a presentation and a slide inside it, because two slides of one
 * deck are two independent tallies and must not throttle each other.
 *
 * Split at the **first** separator, which is exact rather than merely likely: a
 * presentation id is a `crypto.randomUUID()` and so contains no colon, while a
 * slide id is whatever the deck that was saved calls it (`SlideSchema.id` is a
 * plain `z.string()`) and may contain anything at all — including a colon, which
 * lands harmlessly in the second half.
 */
const TALLY_KEY_SEPARATOR = ":";

function tallyKey(presentationId: string, slideId: string): string {
	return `${presentationId}${TALLY_KEY_SEPARATOR}${slideId}`;
}

function parseTallyKey(key: string): {
	presentationId: string;
	slideId: string;
} {
	const boundary = key.indexOf(TALLY_KEY_SEPARATOR);
	return {
		presentationId: key.slice(0, boundary),
		slideId: key.slice(boundary + TALLY_KEY_SEPARATOR.length),
	};
}

/**
 * Re-aggregate one slide and push the fresh tally to everyone watching it.
 *
 * Read **without** `canEdit`, deliberately: this frame goes to the whole room,
 * so what it may carry is what the audience may see (REQ015–REQ017). A slide
 * collecting silently broadcasts its `withheld` marker and no numbers — the
 * presenter's own screen is not fed from here but from its credentialed poll of
 * the results endpoint, which is where the edit token is proven. Passing
 * `canEdit: true` here to "keep the presenter in sync" would publish a withheld
 * tally to every phone in the room. Coalescing changes *when* this runs and
 * never what it reads, so that stays true of every frame the room receives.
 *
 * A quiz answer also moves the deck's standings, which are their own aggregate
 * on their own window ({@link broadcastStandings}).
 */
async function sendSlideTally(key: string): Promise<void> {
	const { presentationId, slideId } = parseTallyKey(key);
	const results = await getSlideResults(presentationId, slideId);
	broadcastToPresentation(presentationId, "results.updated", {
		presentationId,
		slideId,
		results,
	});
	if ((results as { type?: string } | null)?.type === "quiz") {
		await broadcastStandings(presentationId);
	}
}

/**
 * How long one slide's tally holds its key, and so the longest a chart on screen
 * can be behind the store (REQ150).
 *
 * A tenth of a second, a fifth of what the standings take — and the difference
 * is the point rather than a tuning. A leaderboard is a *summary*, read between
 * questions; a slide tally is the **direct feedback for the gesture the
 * participant just made**, and a word cloud filling in word by word is part of
 * what the product is. So the bound is set from the participant's side: a
 * hundred milliseconds is the long-standing threshold under which a response
 * still reads as instantaneous, which makes it the largest window that costs the
 * feedback nothing.
 *
 * What that leaves untouched is the case the feel is actually made of. The
 * leading run fires immediately, so **a room answering slower than ten times a
 * second still gets exactly one frame per answer, byte for byte as before** —
 * every small room, every trickle at the end of a question, every lone
 * participant watching their own word land. Frames merge only above that rate,
 * where "word by word" was never something a person could follow in the first
 * place: at a hundred and fifty answers a second the cloud is a blur, and 15
 * words arriving in one frame is what the eye was going to see either way.
 *
 * The bound is per-slide-type-free on purpose. The type with the strongest claim
 * to every frame is the word cloud, and this window already honours it; no other
 * type needs *more*, and giving a bar chart a slower one would buy a rounding
 * error on a burst that lasts seconds while adding a second cadence to reason
 * about on the one path where a mistake is published to a whole room.
 */
const TALLY_BROADCAST_WINDOW_MS = 100;

/**
 * The slide tally, folded to one run per slide per window — see
 * `server/coalesce.ts` for why that is safe on a path a whole room walks.
 *
 * The re-aggregation is folded **with** the fan-out rather than left to run per
 * answer behind it. Recomputing more often than sending would keep half the cost
 * REQ150 measured (300 full-slide rescans per question) and buy nothing: the
 * coalescer re-reads the store at send time, so what goes out is already the
 * current tally rather than the one that was current when the last answer
 * landed. Recomputing a value nobody is sent is work with no reader.
 */
const tallyBroadcasts = createCoalescer({
	windowMs: TALLY_BROADCAST_WINDOW_MS,
	work: sendSlideTally,
	onError: (key, cause) =>
		console.error(`[tally] recount failed for ${key}:`, cause),
});

/** Drop every pending tally broadcast. For tests that need a clean slate. */
export function resetTallyBroadcasts(): void {
	tallyBroadcasts.reset();
}

/**
 * Tell everyone watching that a slide's tally moved. Every vote path ends here,
 * so the "recount, then broadcast" pair is written once instead of at each of
 * the branches below.
 *
 * **Every change still arrives; what changed is how often the same news is
 * sent** (REQ150). One of the callers — an answer landing — is walked by every
 * person in the room, and re-aggregating the slide and fanning out per
 * individual answer made one question on a room of 300 cost 300 re-aggregations
 * and 90,000 socket writes. It is therefore coalesced on
 * {@link TALLY_BROADCAST_WINDOW_MS}: the first caller of a quiet slide runs
 * immediately and is awaited, and everything arriving inside the window behind
 * it is folded into one trailing run carrying the settled tally. The cost of a
 * question stops scaling with the size of the room and starts scaling with its
 * duration.
 *
 * It also makes a slide's frames **ordered**, which they were not: two answers
 * landing together used to put two aggregations in flight over the same socket,
 * and the one that started first could finish last and overwrite a fresher tally
 * with a staler one.
 */
async function broadcastResults(presentationId: string, slideId: string) {
	await tallyBroadcasts.run(tallyKey(presentationId, slideId));
}

/**
 * Recount the deck's standings and push them to everyone watching (REQ059).
 *
 * The deck is read once here and handed to the aggregation rather than re-read
 * per board: `getSlideResults` exists to fetch a deck for a caller that has not
 * got one, and this caller has (the logic is `aggregateSlideResults`,
 * and fetching is the orchestration around it).
 *
 * Nothing is broadcast for a deck with no leaderboard slide, which is most of
 * them: the loop simply has nothing to walk.
 */
async function sendStandings(presentationId: string): Promise<void> {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return;
	const source = storedResultsSource(presentationId);
	for (const slide of pres.slides as Slide[]) {
		if (slide.type !== "leaderboard") continue;
		const results = await aggregateSlideResults(
			presentationId,
			pres,
			slide.id,
			source,
		);
		broadcastToPresentation(presentationId, "results.updated", {
			presentationId,
			slideId: slide.id,
			results,
		});
	}
}

/**
 * How long one recount holds a deck, and so the longest a board on screen can be
 * behind the store.
 *
 * Half a second: far below what anybody reads a changing scoreboard at, and far
 * above the interval a room answering together arrives on. The room sees the
 * board move at the start of the burst, throughout it, and once more when it
 * settles — which is every bit of what a leaderboard communicates.
 */
const STANDINGS_BROADCAST_WINDOW_MS = 500;

/**
 * The standings recount, folded to one run per deck per window — see
 * `server/coalesce.ts` for why that is safe on a path a whole room walks.
 *
 * A trailing recount runs detached from the request that asked for it, so its
 * failure is logged rather than left to become an unhandled rejection. A leading
 * one still throws to its caller, exactly as the direct call used to.
 */
const standingsBroadcasts = createCoalescer({
	windowMs: STANDINGS_BROADCAST_WINDOW_MS,
	work: sendStandings,
	onError: (presentationId, cause) =>
		console.error(
			`[standings] recount failed for presentation ${presentationId}:`,
			cause,
		),
});

/** Drop every pending standings recount. For tests that need a clean slate. */
export function resetStandingsBroadcasts(): void {
	standingsBroadcasts.reset();
}

/**
 * Tell everyone watching that the deck's standings moved (REQ059).
 *
 * The one aggregate that changes because of something done to a *different*
 * slide, and so the one recount that cannot follow the edited slide's id.
 * Without it a leaderboard on screen would sit at whatever it said when the room
 * arrived — a board reporting a race that has already moved on.
 *
 * Called from all three things that re-score a board, because scores are derived
 * from the deck as it stands now rather than stored: an **answer** landing on a
 * quiz question, an **edit** to what counts as correct, and a **restarted
 * window**, which re-measures the speed half of every answer given under it. The
 * presenter's poll would eventually catch all three on the projector; a
 * participant's phone only ever hears about them here.
 *
 * **All three still arrive; what changed is how often the same news is sent.**
 * One of the three — an answer landing — is walked by every person in the room,
 * and re-scoring the whole deck per individual answer made a 300-person question
 * cost 300 deck rescans and 300 room-wide broadcasts, 299 of which described a
 * board nobody had time to read. The recount is therefore coalesced: the first
 * caller runs it immediately, and everything arriving inside the next window is
 * folded into one trailing run. The board is never more than
 * {@link STANDINGS_BROADCAST_WINDOW_MS} behind the store, and the cost of a
 * question stops scaling with the size of the room and starts scaling with its
 * duration — a thousand-person room now costs what a forty-person one does.
 *
 * It also makes the board's frames **ordered**, which they were not. Two answers
 * landing together used to put two recounts in flight over the same socket, and
 * the one that started first could finish last and overwrite a fresher board
 * with a staler one. Runs on one deck can no longer overlap.
 */
async function broadcastStandings(presentationId: string) {
	await standingsBroadcasts.run(presentationId);
}

/**
 * Why a submission was turned away, when the reason is worth telling the
 * participant rather than folding into the generic "cannot vote" (REQ054).
 *
 * The quiz rules produce one, because they refuse a submission the participant
 * had every reason to believe would land: they were in time, they picked a real
 * option, and the answer still bounced — either because the question closed, or
 * because an answer they no longer remember giving (a reload loses the client's
 * own record of it) is already final.
 *
 * A slide the presenter has closed produces one for the same reason and on
 * every slide type (REQ111): the answer was well-formed and arrived at a deck
 * that is live, and the only thing wrong with it is a decision taken in the room
 * a moment ago. Folding that into the generic `null` would tell the participant
 * their answer was invalid, which is the one thing it was not.
 */
export type VoteRefusal = {
	refused: VoteRefusalCode;
};

/** Whether a `submitVote` result is a stated refusal rather than a stored vote. */
export function isVoteRefusal(result: unknown): result is VoteRefusal {
	return (
		typeof result === "object" &&
		result !== null &&
		typeof (result as VoteRefusal).refused === "string"
	);
}

export async function submitVote(
	presentationId: string,
	slideId: string,
	value: string,
	participantId: string,
	opts: { statementId?: string | null; skip?: boolean } = {},
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;
	if (!acceptsSubmissions(pres)) return null;

	const slides = pres.slides as Slide[];
	const slide = slides.find((s) => s.id === slideId);
	if (!slide) return null;

	// The slide has to be open to submissions (REQ111). Ahead of every type
	// branch and ahead of the value bound below, because a closed question is
	// closed to a well-formed answer and a malformed one alike, and the
	// participant reading the refusal needs the reason that is actually theirs to
	// act on — "the presenter closed this" rather than "your answer was invalid".
	if (!slideAcceptsSubmissions(liveRoomStateOf(pres), slideId)) {
		return { refused: "participation-closed" } satisfies VoteRefusal;
	}

	// The per-type half of the value bound (see `VOTE_VALUE_LIMIT`). The request
	// schema has already refused anything past what the widest slide type could
	// send; this is where "widest" narrows to *this* type, which is the first
	// moment the type is known. Before every branch, so no branch can forget it.
	if (value.length > voteValueLimitFor(slide.type)) return null;

	const { statementId, skip } = opts;

	// ── Scales: per-statement dedup, optional skip (REQ029, REQ031) ────────
	if (slide.type === "scale" && statementId) {
		if (skip && !slide.scaleAllowSkip) return null;
		const vote = await storeSingleRowVote(
			presentationId,
			slideId,
			participantId,
			{ value, statementId, skip: !!skip },
			statementId,
		);
		await broadcastResults(presentationId, slideId);
		return vote;
	}

	// ── Word Cloud / Open Ended: maxResponses enforcement (REQ022, REQ026) ─
	if (slide.type === "word-cloud" || slide.type === "open-text") {
		// The cap is a read-modify-write and so is the duplicate fold below it, and
		// both were reproduced racing (REQ148): a cap of 1 with three submissions
		// from one device stored all three, and two participants typing the same
		// words at once were both stored as fresh responses. So the whole section
		// takes a turn — but the two invariants are not the same width, and the key
		// is the wider of the two that is actually in force:
		//
		//  - The **cap** is per participant: how many answers *this device* has
		//    given. Keying it on the slide would queue a whole word cloud — the
		//    slide type where a room most reliably types at the same moment — to
		//    protect something nobody else's submission can break.
		//  - The **fold** (REQ025) is per slide: "has anybody already said this?"
		//    reads every row on the slide, so a per-participant key would leave it
		//    exactly as raced as it was found.
		//
		// A slide whose fold is on therefore queues on the slide, which covers its
		// cap too; every other one queues on the participant. Toggling
		// `allowResponseVotes` mid-session moves submissions between the two keys,
		// and a fold racing across that switch is not covered — the alternative is
		// serializing every word cloud in the product for a window a presenter
		// closes in a second, and an unfolded duplicate is a legitimate response row
		// rather than a row nothing can account for.
		const foldsDuplicates =
			slide.type === "open-text" && !!slide.allowResponseVotes;
		const outcome = await voteWriteLock.run(
			foldsDuplicates
				? responseFoldKey(presentationId, slideId)
				: voteWriteKey(presentationId, slideId, participantId),
			async (): Promise<Record<string, unknown> | null> => {
				const cap = maxResponsesFor(slide);
				if (cap > 0) {
					const existing = await votes.find({
						presentationId,
						slideId,
						participantId,
					});
					if (existing.length >= cap) {
						if (cap === 1) {
							// Replace the single existing response
							await votes.update(existing[0].id as string, { value });
							return existing[0];
						}
						// Cap reached (>1): reject extra submissions
						return null;
					}
				}

				// ── Q&A auto-upvote on duplicate text ────────────────────────────
				// If this is an open-text slide with response voting enabled and the
				// participant submits a value that matches an existing response (case-
				// and whitespace-insensitive), upsert an upvote on the existing
				// response instead of creating a new duplicate entry. This keeps the
				// list focused on distinct topics while still surfacing demand.
				if (foldsDuplicates) {
					// The same fold the Q&A layer applies to a re-asked question:
					// "did these two people say the same thing?" is one
					// judgement, and it is made in `normalizeQuestionText` for both.
					const target = normalizeQuestionText(value);
					const allForSlide = await votes.find({ presentationId, slideId });
					const match = allForSlide.find(
						(existingResponse) =>
							normalizeQuestionText(String(existingResponse.value ?? "")) ===
							target,
					);
					if (match && match.participantId !== participantId) {
						// The upvote this fold writes is the same row `voteOnResponse`
						// toggles, so it takes that function's key rather than riding on
						// the fold's: holding the slide-wide key alone would leave one
						// participant able to fold a duplicate and tap upvote in the same
						// tick, both read "not upvoted yet", and both insert.
						//
						// Taken *inside* the fold's turn, which is safe because the order
						// is always this way round — the fold reaches for the upvote key,
						// nothing holding the upvote key ever reaches for the fold's — so
						// the two cannot wait on each other.
						await voteWriteLock.run(
							responseUpvoteKey(
								presentationId,
								slideId,
								match.id as string,
								participantId,
							),
							async () => {
								const existingUpvote = await responseVotes.find({
									presentationId,
									slideId,
									responseId: match.id as string,
									participantId,
								});
								if (existingUpvote.length > 0) return;
								await responseVotes.insert({
									presentationId,
									slideId,
									responseId: match.id as string,
									participantId,
									createdAt: new Date().toISOString(),
								});
							},
						);
						return match;
					}
				}

				return votes.insert({
					presentationId,
					slideId,
					value,
					participantId,
					createdAt: new Date().toISOString(),
				});
			},
		);
		// Cap reached on a multi-response slide: nothing was written, so there is
		// nothing to tell the room about.
		if (!outcome) return null;
		await broadcastResults(presentationId, slideId);
		return outcome;
	}

	// ── Quiz competition: one final answer, inside the window (REQ054–REQ057) ─
	//
	// A quiz is the one slide type here where a participant may **not** change
	// their mind. Everywhere else a re-submission replaces the last one, because
	// the datum is the opinion the participant ended up holding. On a quiz the
	// datum is what they knew *at that moment*, and part of the score is how fast
	// they knew it (REQ054) — so a second answer would let someone bank an
	// instant response and then correct it once the room reacted.
	//
	// The window is enforced here rather than trusted from the countdown on the
	// participant's phone (REQ057): a clock that is wrong, or a hand-built
	// request, must not buy time nobody else in the room had. A short grace is
	// allowed for the flight time of a tap made just before the buzzer, and it
	// buys acceptance only — `scoreQuizAnswer` clamps the elapsed time to the
	// window, so a late-but-graced answer scores what an on-the-buzzer one does.
	if (slide.type === "quiz") {
		// What a submission has to be is the one thing the two answer modes differ
		// on (REQ055): an id the slide offers, or text the participant wrote. Both
		// resolve to the single string that is stored, so everything below — the
		// one-answer rule, the window, the score — is written once for both.
		const submitted =
			quizAnswerModeFor(slide) === "type"
				? decodeQuizAnswer(value)
				: (slide.options ?? []).some((option) => option.id === value)
					? value
					: null;
		if (submitted === null) return null;
		// One answer per *participant*, so there has to be one. An empty id is the
		// shape a hand-built request takes, and under the one-answer rule the first
		// of them would lock out every other id-less caller — which on a browser
		// surface that always mints a UUID means locking out nobody real, and on a
		// scripted one means a whole room sharing a single answer.
		if (!participantId) return null;

		// The one-answer rule is a read-modify-write, and this is the one slide
		// type where it has to survive two submissions arriving at once. Everywhere
		// else a later submission replaces the earlier one and collapses whatever a
		// race left behind; a quiz permanently refuses that later submission, so two
		// rows written into the same gap would stand for the rest of the session —
		// one participant in two bars of the room's chart, with no path back.
		//
		// A double-tap or a retried POST is enough to reach it: the `find` below
		// awaits, and the next request's handler runs in that gap and reads the
		// state that predated the first one's insert. Queued per participant per
		// question (see {@link voteWriteKey}), so a whole room answering together
		// is not serialized — only one participant's own submissions are, and the
		// second of them then reads the first's row and meets the rule it was
		// always meant to meet.
		//
		// The broadcast stays outside the queue: it recounts the slide and writes to
		// every socket in the room, and none of that is part of the decision the
		// queue protects.
		const outcome = await voteWriteLock.run(
			voteWriteKey(presentationId, slideId, participantId),
			async (): Promise<VoteRefusal | Record<string, unknown>> => {
				const existing = await votes.find({
					presentationId,
					slideId,
					participantId,
				});
				// An answer to a question the slide no longer asks — an option since
				// deleted, or an option id on a question that now takes typed answers —
				// is not an answer to the question as it now stands: the tally already
				// drops it (it cannot be scored), so it must not lock the participant
				// out either. Their stale rows are cleared and they answer the
				// re-authored question once.
				const standing = existing.filter((quizVote) =>
					isStandingQuizAnswer(slide, String(quizVote.value ?? "")),
				);
				if (standing.length > 0) return { refused: "quiz-already-answered" };

				const deadline = quizDeadlineFor(
					slideStartedAtIn(pres)[slideId],
					quizTimeLimitFor(slide),
				);
				if (!isQuizWindowOpen(deadline, Date.now())) {
					return { refused: "quiz-window-closed" };
				}

				for (const stale of existing) await votes.remove(stale.id as string);
				return votes.insert({
					presentationId,
					slideId,
					value: submitted,
					participantId,
					createdAt: new Date().toISOString(),
				});
			},
		);
		if (isVoteRefusal(outcome)) return outcome;
		await broadcastResults(presentationId, slideId);
		return outcome;
	}

	// ── Multiple Choice: per-participant selection limit (REQ014) ──────────
	//
	// `value` is an option id. The limit resolved by `maxSelectionsFor` decides
	// the shape of a submission:
	//   - 1 (single choice, the default): the participant holds exactly one vote
	//     row, replaced on every re-vote — the behaviour every existing deck has.
	//   - 0 / n > 1 ("all that apply"): one row per selected option. Re-submitting
	//     an option the participant already holds **deselects** it, so the same
	//     endpoint drives both halves of a checkbox; a submission that would
	//     exceed the cap is rejected outright rather than silently trimmed.
	//
	// Unknown option ids are rejected: on a capped multi-select a bogus value
	// would otherwise burn a selection slot that the participant can never see
	// or clear.
	if (slide.type === "multiple-choice") {
		const optionIds = new Set((slide.options ?? []).map((option) => option.id));
		if (!optionIds.has(value)) return null;

		const limit = maxSelectionsFor(slide);
		// Both halves are read-modify-writes on the participant's own rows — the
		// single-select replace, and the multi-select cap that decides whether one
		// more selection still fits — so both take a turn under the participant's
		// key (REQ148, and see {@link voteWriteKey}). Two taps arriving together
		// used to read the same "nothing selected yet" and both write, which on a
		// single-select slide put one person in two bars and on a capped multi-select
		// spent one more slot than the author allowed.
		const outcome = await voteWriteLock.run(
			voteWriteKey(presentationId, slideId, participantId),
			async (): Promise<Record<string, unknown> | null> => {
				const existing = await votes.find({
					presentationId,
					slideId,
					participantId,
				});

				if (limit === 1) {
					if (existing.length > 0) {
						await votes.update(existing[0].id as string, { value });
						// A slide switched from multi- to single-select mid-session can
						// leave a participant holding several rows; collapse them onto the
						// new one.
						for (const extra of existing.slice(1)) {
							await votes.remove(extra.id as string);
						}
						return existing[0];
					}
				} else {
					const alreadySelected = existing.find(
						(existingVote) => existingVote.value === value,
					);
					if (alreadySelected) {
						await votes.remove(alreadySelected.id as string);
						return alreadySelected;
					}
					if (limit > 0 && existing.length >= limit) return null;
				}

				return votes.insert({
					presentationId,
					slideId,
					value,
					participantId,
					createdAt: new Date().toISOString(),
				});
			},
		);
		// The cap refused this selection: nothing changed, so nothing is broadcast.
		if (!outcome) return null;
		await broadcastResults(presentationId, slideId);
		return outcome;
	}

	// ── Ranking: one ordered submission per participant (REQ033, REQ034) ───
	//
	// The whole ordering is one `value` on one row, so a re-submission *replaces*
	// the participant's previous order rather than adding to it — reordering is
	// the normal gesture, not a second vote. The submission is re-encoded from
	// the decoded ids before it is stored, so what the tally reads back is
	// always canonical whatever spacing the client sent.
	if (slide.type === "ranking") {
		const order = decodeRanking(value, slide.rankingItems ?? []);
		if (!order) return null;
		const normalized = encodeRanking(order);
		const vote = await storeSingleRowVote(
			presentationId,
			slideId,
			participantId,
			{ value: normalized },
		);
		await broadcastResults(presentationId, slideId);
		return vote;
	}

	// ── 100 Points: one budget allocation per participant (REQ044, REQ045) ─
	//
	// The whole allocation is one `value` on one row, exactly as a ranking's
	// ordering is: the budget is what ties the items together, so a re-submission
	// *replaces* the participant's previous allocation rather than adding to it —
	// moving points between items is the normal gesture, not a second vote.
	//
	// `decodePoints` is where "exactly 100" is enforced: a ballot that
	// under- or over-spends is rejected at the boundary rather than trusted from
	// the client, stored, and left to skew every share it is counted into. What
	// is stored is re-encoded from what the codec read, so the tally always sees
	// a canonical allocation whatever spacing — or explicit zero — came in.
	if (slide.type === "points") {
		const allocation = decodePoints(value, slide.pointsItems ?? []);
		if (!allocation) return null;
		const normalized = encodePoints(allocation);
		const vote = await storeSingleRowVote(
			presentationId,
			slideId,
			participantId,
			{ value: normalized },
		);
		await broadcastResults(presentationId, slideId);
		return vote;
	}

	// ── Guess the Number: one estimate per participant (REQ039–REQ043) ─────
	//
	// One number, one row, replaced on re-submission the way a ranking's ordering
	// and a points budget are: a participant holds one estimate, and changing
	// their mind before the reveal is the normal gesture, not a second guess that
	// would let one person weight the distribution twice.
	//
	// `decodeGuess` is where the authored frame is enforced: a number
	// outside the range (REQ040) or off the step grid (REQ043) is rejected with
	// 400 rather than clamped or rounded into the nearest legal value. On this
	// slide type the number *is* the whole answer, so a silently adjusted one is
	// not a normalization — it is an estimate the participant never made, sitting
	// in the distribution the room is about to read.
	if (slide.type === "guess-number") {
		const guess = decodeGuess(value, guessRangeFor(slide));
		if (guess === null) return null;
		// Stored re-encoded from what the codec read, so the tally always sees a
		// canonical number whatever spacing or leading zeroes came in.
		const normalized = encodeGuess(guess);
		const vote = await storeSingleRowVote(
			presentationId,
			slideId,
			participantId,
			{ value: normalized },
		);
		await broadcastResults(presentationId, slideId);
		return vote;
	}

	// ── Pin on Image: one pin per participant (REQ051, REQ052) ─────────────
	//
	// One point, one row, replaced on re-submission — the shape a guess takes, for
	// the same reason: a participant holds one pin, and moving it before the reveal
	// is the normal gesture rather than a second answer that would let one person
	// weight the distribution twice.
	//
	// Two things are refused at the boundary rather than trusted from the client:
	//
	//  - **A pin off the image's lattice** (`decodePinPoint`). Coordinates are
	//    per-mille of the image's own size, so anything outside 0…1000 is not a
	//    point on the picture the room is looking at. It is rejected rather than
	//    clamped: on this slide type the position *is* the whole answer, so a pin
	//    pulled onto the edge is an opinion nobody gave.
	//  - **Every submission at all to a slide with no image** (REQ052). Without an
	//    interaction area there is no coordinate space for a pin to be a pin in,
	//    and a row stored against one would be a position on a picture that does
	//    not exist — the same stance `decodeGuess` takes on an unusable range.
	if (slide.type === "pin-image") {
		if (!pinImageFor(slide).url) return null;
		const point = decodePinPoint(value);
		if (!point) return null;
		// Stored re-encoded from what the codec read, so the tally always sees a
		// canonical `"x,y"` whatever spacing came in.
		const normalized = encodePinPoint(point);
		const vote = await storeSingleRowVote(
			presentationId,
			slideId,
			participantId,
			{ value: normalized },
		);
		await broadcastResults(presentationId, slideId);
		return vote;
	}

	// ── Form: one filled-in form per participant (REQ061) ──────────────────
	//
	// The whole form is one `value` on one row, the shape a ranking's ordering
	// and a points budget take — and for the sharpest version of the reason. A
	// form's fields are answered *together*, by one person, in one gesture: the
	// name belongs to the email address beside it, and rows that could arrive
	// separately would let a required field be left out one submission at a time
	// and turn "who wrote this?" into a join across the vote table.
	//
	// A re-submission **replaces** the previous form rather than adding a second
	// one: correcting a typo in your own address is the normal gesture here, and
	// keeping both would put one person in the organizer's export twice, once
	// with an address that does not work.
	//
	// `decodeFormSubmission` is where the field types are enforced: an
	// address that is not one, an option the field does not offer, an answer past
	// the per-field cap and a required field left blank are all refused at the
	// boundary rather than trusted from the client and discovered in a
	// spreadsheet weeks later. What is stored is re-encoded from what the codec
	// read, so the tally and the export always see a canonical submission in
	// authored field order.
	if (slide.type === "form") {
		// One form per *participant*, so there has to be one — the rule the quiz
		// branch already keeps, and it bites harder here. An empty id is the shape
		// a hand-built request takes, and since a re-submission replaces the row
		// held under that key, the first id-less caller and every one after it
		// share a single row: each new submission silently overwrites a real
		// person's name and address. A browser surface always mints a UUID, so
		// nothing legitimate is turned away by refusing this.
		if (!participantId) return null;
		const fields = formFieldsFor(slide);
		const answers = decodeFormSubmission(value, fields);
		if (!answers) return null;
		const normalized = encodeFormSubmission(answers);
		const vote = await storeSingleRowVote(
			presentationId,
			slideId,
			participantId,
			{ value: normalized },
		);
		await broadcastResults(presentationId, slideId);
		return vote;
	}

	// ── 2x2 Grid: one placement per item per participant (REQ046, REQ050) ──
	//
	// Mirrors the multi-statement scale branch above, because a grid is a scale
	// in two dimensions: the item is named by `statementId`, a re-placement
	// replaces that item's row (participants nudge items around before settling),
	// and `skip` marks the item "not assessable" — but only when the organizer
	// allowed it (REQ050), so a deck without the setting cannot be skipped past
	// by a hand-built request.
	//
	// A placement is stored re-encoded from what `decodeGridPoint` read, so the
	// aggregation always reads a canonical `"x,y"` whatever spacing came in. A
	// point off the authored grid is rejected outright rather than clamped: a
	// clamp would silently record an opinion the participant did not give.
	if (slide.type === "grid") {
		const items = slide.gridItems ?? [];
		if (!statementId || !items.some((item) => item.id === statementId)) {
			return null;
		}
		if (skip && !slide.gridAllowSkip) return null;
		const { xAxis, yAxis } = gridAxesFor(slide);
		const point = skip ? null : decodeGridPoint(value, xAxis, yAxis);
		if (!skip && !point) return null;
		// A skipped item carries no coordinates; `value` is kept as sent (the
		// scale branch does the same) and ignored by the tally.
		const storedValue = point ? encodeGridPoint(point) : value;
		const vote = await storeSingleRowVote(
			presentationId,
			slideId,
			participantId,
			{ value: storedValue, statementId, skip: !!skip },
			statementId,
		);
		await broadcastResults(presentationId, slideId);
		return vote;
	}

	// ── Default (single-statement scale): dedup on participant ────────────
	//
	// The dedup is the same replace-or-insert every branch above holds, so it is
	// queued the same way. A slide that allows several answers per participant has
	// no invariant to protect and takes no turn: every submission is a new row.
	if (!slide.allowMultiple) {
		const vote = await storeSingleRowVote(
			presentationId,
			slideId,
			participantId,
			{ value },
		);
		await broadcastResults(presentationId, slideId);
		return vote;
	}

	const vote = await votes.insert({
		presentationId,
		slideId,
		value,
		participantId,
		createdAt: new Date().toISOString(),
	});
	await broadcastResults(presentationId, slideId);
	return vote;
}

/**
 * Upvote a submitted open-ended response (REQ025). Dedup per
 * (participantId, responseId) — a second call by the same participant toggles
 * the vote off.
 */
export async function voteOnResponse(
	presentationId: string,
	slideId: string,
	responseId: string,
	participantId: string,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;
	if (!acceptsSubmissions(pres)) return null;

	const slides = pres.slides as Slide[];
	const slide = slides.find((s) => s.id === slideId);
	if (!slide || slide.type !== "open-text" || !slide.allowResponseVotes) {
		return null;
	}

	// An upvote is a submission to the slide (REQ111), so a closed slide refuses
	// it on the same terms and with the same stated reason a vote gets. Leaving
	// this door open would let a closed question keep re-ordering its own
	// responses while nobody can add one.
	if (!slideAcceptsSubmissions(liveRoomStateOf(pres), slideId)) {
		return { refused: "participation-closed" } satisfies VoteRefusal;
	}

	// Verify the response exists
	const response = await votes.findOne(responseId);
	if (!response || response.slideId !== slideId) return null;

	// The toggle is the same read-modify-write the vote path is queued for
	// (REQ148): the `find` awaits, so two taps landing together both read "not
	// upvoted yet" and both insert. That leaves the response one upvote heavier
	// than the people behind it, and a toggle that can only take one of the two
	// rows back off — nothing later collapses it. Queued per participant per
	// response (see {@link responseUpvoteKey}), so one busy response is not a
	// queue for the room. The broadcast stays outside, as it does on every branch
	// of `submitVote`.
	await voteWriteLock.run(
		responseUpvoteKey(presentationId, slideId, responseId, participantId),
		async () => {
			const existing = await responseVotes.find({
				presentationId,
				slideId,
				responseId,
				participantId,
			});

			if (existing.length > 0) {
				// Toggle off
				await responseVotes.remove(existing[0].id as string);
				return;
			}
			await responseVotes.insert({
				presentationId,
				slideId,
				responseId,
				participantId,
				createdAt: new Date().toISOString(),
			});
		},
	);

	await broadcastResults(presentationId, slideId);
	return { ok: true };
}

// ── Taking one answer back out (REQ027) ──────────────────────

/**
 * Why an answer was not deleted, when the reason is a rule rather than the row
 * simply not being there.
 *
 * One code, because there is one such rule: the slide type. "There is no such
 * answer on this deck" is reported as `null` for the reason the comment routes
 * give — a row belonging to another deck must answer exactly as a row that
 * never existed, or the endpoint becomes a way to ask whether an id is real.
 */
export type AnswerDeletionRefusal = { refused: "slide-type" };

/** Whether a `deleteSubmittedAnswer` result is a stated refusal. */
export function isAnswerDeletionRefusal(
	result: unknown,
): result is AnswerDeletionRefusal {
	return (
		typeof result === "object" &&
		result !== null &&
		typeof (result as AnswerDeletionRefusal).refused === "string"
	);
}

/**
 * Delete one submitted answer from a word cloud or an open-ended slide (REQ027)
 * — the manual half of moderation, and the only half this product has: a
 * presenter reads something the room must not go on looking at and takes it off
 * the wall.
 *
 * **The row is removed, not marked.** Every surface that reports on this deck is
 * a projection of the stored rows — the live tally, both results endpoints, the
 * spreadsheet (REQ095) and the PDF (REQ096) — so deleting the row is what makes
 * "reflected in the tally the room sees and in every export" true by
 * construction rather than by five read sites each remembering to skip a flag.
 * A hidden-but-stored answer would still be in the workbook the organizer hands
 * round, which is the one place a line they took off the projector must not
 * reappear.
 *
 * **Its upvotes go with it** (REQ025). They are rows naming a response that no
 * longer exists, and the exports count them: the cover of the PDF and the
 * summary sheet of the workbook both report how many upvotes the session
 * collected, so leaving them would report a deleted answer's popularity under
 * the deck's total.
 *
 * Which slide types this is offered on is {@link slideAnswersAreDeletable}, not
 * a union spelled here — the same predicate the presenter's screen draws the
 * control from, so a surface cannot offer a deletion the boundary refuses.
 *
 * The caller is authorized by the route (owner, edit token, or an `edit` grant),
 * as every presentation mutation is. Nothing about the deck's status is checked:
 * an answer is worth taking down after the session has ended as much as during
 * it, and an ended deck is precisely when its exports get made.
 */
export async function deleteSubmittedAnswer(
	presentationId: string,
	answerId: string,
): Promise<{ ok: true; slideId: string } | AnswerDeletionRefusal | null> {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const answer = await votes.findOne(answerId);
	// Scoped to the deck the caller proved standing on, and refused the same way
	// a missing row is: an edit token opens *its own* deck, so a vote id learned
	// elsewhere must not be deletable through it.
	if (!answer || answer.presentationId !== presentationId) return null;

	const slideId = String(answer.slideId ?? "");
	const slide = (pres.slides as Slide[]).find((one) => one.id === slideId);
	// A row whose slide has since been authored off the deck is deletable: it is
	// still a line the room submitted and still in both exports, and there is no
	// slide left to read a type off. What is refused is a row on a slide that
	// *is* there and is not one of the two types this is for.
	if (slide && !slideAnswersAreDeletable(slide.type)) {
		return { refused: "slide-type" } satisfies AnswerDeletionRefusal;
	}

	// The upvotes first, then the answer: the other order leaves a window in
	// which the response is gone and its upvotes are not, and a reader landing
	// in it would count them under a deck whose total no longer has the row they
	// belong to. Nothing here is queued — a delete removes rows by id rather
	// than reading a count and writing it back, so there is no read-modify-write
	// for a concurrent submission to interleave with (REQ148). An upvote that
	// lands on this response in the very same tick is a row naming nothing: the
	// tally keys its counts by the responses it found, so it is invisible on
	// every screen, and it is one row in the deck's upvote total until the next
	// reset (REQ101).
	const orphanedUpvotes = await responseVotes.find({
		presentationId,
		responseId: answerId,
	});
	for (const upvote of orphanedUpvotes) {
		await responseVotes.remove(upvote.id as string);
	}
	await votes.remove(answerId);

	// The room is told, on the same channel a vote's tally moves on: an answer
	// coming off the wall is a change to the tally exactly as an answer landing
	// on it is, and a phone that only learned about additions would keep drawing
	// the deleted line until its next reload.
	await broadcastResults(presentationId, slideId);
	return { ok: true, slideId };
}

// ── Q&A layer (REQ036, REQ037, REQ060) ───────────────────────
//
// Q&A here is a property of the *presentation*, not of a slide: switched on once
// (REQ036), it takes questions from whatever is on screen, and the list it
// builds outlives every slide the deck pages through. That is the whole shape of
// the feature, and it is why none of the code below touches `slides`.
//
// The one thing to be careful with is REQ037. Who may read the list is decided
// **on the server, on every fetch**, from the caller's own credentials — never
// by broadcasting the list and letting a client decide what to draw. The
// WebSocket's `role` is self-declared by whoever connects, so it proves nothing;
// a broadcast carrying question text would hand a moderated Q&A to anybody with
// a socket. So the socket carries a *signal* (`qa.updated`) and every surface
// re-fetches through `GET /qa`, which is where the edit token is proven.

/** Read a stored presentation's Q&A settings as the schema helpers take them. */
function qaSettingsOf(pres: Record<string, unknown>): QASettings {
	return {
		qaEnabled: pres.qaEnabled as boolean | undefined,
		qaVisibility: pres.qaVisibility as QAVisibility | undefined,
	};
}

/**
 * Tell everyone watching that the question list moved — and nothing else.
 *
 * Deliberately payload-free beyond the presentation id: see the note above. What
 * each surface may actually see is settled by its own authenticated re-fetch.
 */
function broadcastQAChanged(presentationId: string): void {
	broadcastToPresentation(presentationId, "qa.updated", { presentationId });
}

/**
 * Tell everyone watching where the Q&A layer now stands (REQ036/REQ037).
 *
 * Unlike the list itself these two values *do* ride the broadcast, because they
 * are already on the public presentation document every phone holds. That is
 * what lets a participant's panel open the moment the presenter opens the floor
 * — and, more importantly, close the moment they withdraw it, without waiting
 * for a fetch that a client with no reason to refetch will never make.
 *
 * Sent from **every** path that writes them, which is the point of it being a
 * function: the settings endpoint is not their only writer (see
 * {@link updatePresentation}), and a write that told nobody would leave a
 * withdrawn question list on screen.
 */
function broadcastQASettings(
	presentationId: string,
	pres: Record<string, unknown>,
): void {
	const settings = qaSettingsFor(qaSettingsOf(pres));
	broadcastToPresentation(presentationId, "qa.settings", {
		presentationId,
		qaEnabled: settings.enabled,
		qaVisibility: settings.visibility,
	});
}

/**
 * Turn the Q&A layer on or off (REQ036) and choose who reads it (REQ037).
 */
export async function setQASettings(
	presentationId: string,
	changes: { enabled?: boolean; visibility?: QAVisibility },
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const current = qaSettingsFor(qaSettingsOf(pres));
	const updated = await presentations.update(presentationId, {
		qaEnabled: changes.enabled ?? current.enabled,
		qaVisibility: changes.visibility ?? current.visibility,
	});
	if (updated) broadcastQASettings(presentationId, updated);
	return updated;
}

/**
 * Project stored questions into what one caller may read (REQ037/REQ060).
 *
 * The asking participant's id is dropped here and nowhere later, so no route can
 * forget to: what comes back carries `own` and `upvoted` — the two things a
 * client needs from an id it must never be handed.
 */
async function qaEntriesFor(
	presentationId: string,
	pres: Record<string, unknown>,
	caller: { canEdit: boolean; participantId: string },
): Promise<QAListEntry[]> {
	const stored = await qaQuestions.find({ presentationId });
	const visible = qaQuestionsVisibleTo(
		stored.map((question) => ({
			id: question.id as string,
			text: question.text as string,
			participantId: (question.participantId as string) ?? "",
			answered: !!question.answered,
			answeredAt: (question.answeredAt as string | null) ?? null,
			createdAt: (question.createdAt as string) ?? "",
		})),
		qaSettingsOf(pres),
		caller,
	);

	// Counted as **distinct participants**, not as rows. An upvote is one person
	// saying "ask this one", so that is the unit the queue is ordered by — and it
	// is the reading that survives a duplicate row, which a double-tap or a
	// network retry can still slip past the check in `addQAUpvote` (the store has
	// no unique index to lean on). Counting rows would let one participant's
	// stutter outrank a question the room actually wants.
	const upvotes = await qaUpvotes.find({ presentationId });
	const upvoters = new Map<string, Set<string>>();
	const ownUpvotes = new Set<string>();
	for (const upvote of upvotes) {
		const questionId = upvote.questionId as string;
		const forQuestion = upvoters.get(questionId) ?? new Set<string>();
		forQuestion.add((upvote.participantId as string) ?? "");
		upvoters.set(questionId, forQuestion);
		if (caller.participantId && upvote.participantId === caller.participantId) {
			ownUpvotes.add(questionId);
		}
	}

	return rankQAQuestions(
		visible.map((question) => ({
			id: question.id,
			text: question.text,
			upvotes: upvoters.get(question.id)?.size ?? 0,
			answered: question.answered,
			answeredAt: question.answeredAt,
			createdAt: question.createdAt,
			own: !!caller.participantId && question.participantId === caller.participantId,
			upvoted: ownUpvotes.has(question.id),
		})),
	);
}

/**
 * The Q&A list as one caller may read it, with the layer's settings alongside
 * it so a client renders from a single payload.
 *
 * The counts describe **the list that came back**, not everything stored: a
 * participant under `presenter` visibility gets their own questions and a count
 * of their own questions. A total over rows they cannot see would report the
 * volume of a list the organizer decided to keep back — which is most of what
 * keeping it back was for.
 */
export async function getQAList(
	presentationId: string,
	caller: { canEdit: boolean; participantId: string },
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const settings = qaSettingsFor(qaSettingsOf(pres));
	const questions = await qaEntriesFor(presentationId, pres, caller);

	return {
		presentationId,
		enabled: settings.enabled,
		visibility: settings.visibility,
		/** Whether this caller is reading the room's list or only their own. */
		canSeeAll: qaListVisibleToAudience(qaSettingsOf(pres), caller.canEdit),
		questions,
		totalCount: questions.length,
		openCount: questions.filter((question) => !question.answered).length,
		answeredCount: questions.filter((question) => question.answered).length,
	};
}

/**
 * Ask a question through the Q&A layer (REQ036).
 *
 * Refused when the layer is off, and when the deck is not taking submissions at
 * all — the same rule a vote meets, so a room cannot be asked questions on a
 * deck it cannot vote on.
 *
 * **Duplicates fold only into a published list.** On a deck whose questions the
 * room can see (REQ037 `everyone`), a re-asked question becomes an upvote on the
 * one already there — the REQ060 goal of keeping a long list on distinct topics,
 * and the same fold an open-text slide already applies to a re-typed response.
 * On a **moderated** deck it does not: nothing there tells the asker their words
 * merged into somebody else's row, the presenter is reading every submission
 * anyway, and folding onto a question they cannot see is the one path by which a
 * withheld list could be probed from the outside.
 *
 * Re-asking a question **you** already asked is a no-op either way: it is one
 * person saying one thing, and neither a second row nor an upvote on yourself is
 * a truthful record of that.
 *
 * What came of the submission is reported rather than flattened into `ok`, so no
 * caller has to guess: `stored` says a new question was written, `merged` says it
 * became an upvote on one already there, and **both false is the no-op above** —
 * the one outcome a client must not announce as "question sent", because nothing
 * was.
 */
export async function submitQuestion(
	presentationId: string,
	text: string,
	participantId: string,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;
	if (!acceptsSubmissions(pres)) return null;

	const settings = qaSettingsFor(qaSettingsOf(pres));
	if (!settings.enabled) return null;

	const trimmed = text.trim();
	if (!trimmed) return null;

	if (settings.visibility === "everyone") {
		const target = normalizeQuestionText(trimmed);
		const existing = await qaQuestions.find({ presentationId });
		const duplicate = existing.find(
			(question) =>
				normalizeQuestionText(String(question.text ?? "")) === target,
		);
		if (duplicate && duplicate.participantId !== participantId) {
			await addQAUpvote(
				presentationId,
				duplicate.id as string,
				participantId,
				{ toggle: false },
			);
			broadcastQAChanged(presentationId);
			return { ok: true, stored: false, merged: true };
		}
		if (duplicate) return { ok: true, stored: false, merged: false };
	}

	await qaQuestions.insert({
		presentationId,
		text: trimmed,
		participantId,
		answered: false,
		answeredAt: null,
		createdAt: new Date().toISOString(),
	});
	broadcastQAChanged(presentationId);
	return { ok: true, stored: true, merged: false };
}

/**
 * Add or toggle one participant's upvote on a question. Shared by the public
 * upvote endpoint and the duplicate fold above, which wants the "add, never
 * remove" half of it: somebody asking a question again is stating support, and a
 * second attempt must not quietly retract the first.
 *
 * Toggling off clears **every** row this participant holds on the question, not
 * just the first. The check below is a find-then-insert with no unique index
 * under it, so two requests racing — a double-tap, a retried POST — can both see
 * nothing and both write; taking one row off a pair would leave the upvote
 * standing and read as a control that does nothing. The tally counts distinct
 * participants for the other half of the same problem (see `qaEntriesFor`).
 */
async function addQAUpvote(
	presentationId: string,
	questionId: string,
	participantId: string,
	{ toggle }: { toggle: boolean },
): Promise<void> {
	const existing = await qaUpvotes.find({
		presentationId,
		questionId,
		participantId,
	});
	if (existing.length > 0) {
		if (toggle) {
			for (const row of existing) await qaUpvotes.remove(row.id as string);
		}
		return;
	}
	await qaUpvotes.insert({
		presentationId,
		questionId,
		participantId,
		createdAt: new Date().toISOString(),
	});
}

/**
 * Upvote a question, or take the upvote back (REQ060).
 *
 * Only on a deck whose list the room can actually read: voting on a question you
 * were not shown is not prioritization, and an endpoint that accepted a question
 * id from a withheld list would answer whether that id exists.
 *
 * A participant id is required rather than defaulted, for the reason the quiz
 * requires one: without it the first id-less caller's row would be the row every
 * other id-less caller toggles, so one script would speak for a whole room.
 *
 * You cannot upvote your own question. Asking it *is* the support, and counting
 * it twice would mean a question's score started at one for its asker and zero
 * for everyone else — a scale on which nothing the room does can be read.
 */
export async function upvoteQuestion(
	presentationId: string,
	questionId: string,
	participantId: string,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;
	if (!acceptsSubmissions(pres)) return null;
	if (!participantId) return null;

	const settings = qaSettingsFor(qaSettingsOf(pres));
	if (!settings.enabled || settings.visibility !== "everyone") return null;

	const question = await qaQuestions.findOne(questionId);
	if (!question || question.presentationId !== presentationId) return null;
	if (question.participantId === participantId) return null;

	await addQAUpvote(presentationId, questionId, participantId, { toggle: true });
	broadcastQAChanged(presentationId);
	return { ok: true };
}

/**
 * Mark a question answered, or put it back in the queue (REQ060).
 *
 * Authorized as a presentation mutation (owner or edit token) at the route, like
 * every other thing the presenter does to the deck: the processing status is the
 * presenter's reading of their own session, and a room that could set it would
 * be able to retire a question nobody had answered.
 *
 * Reversible on purpose. "Answered" is a working state, not a deletion, and a
 * mis-click during a live session must cost one more click rather than a
 * question the presenter can no longer find.
 */
export async function setQuestionAnswered(
	presentationId: string,
	questionId: string,
	answered: boolean,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const question = await qaQuestions.findOne(questionId);
	if (!question || question.presentationId !== presentationId) return null;

	const updated = await qaQuestions.update(questionId, {
		answered,
		answeredAt: answered ? new Date().toISOString() : null,
	});
	if (!updated) return null;

	broadcastQAChanged(presentationId);
	return { ok: true, answered };
}

// ── Participant channels: reactions and live chat (REQ077, REQ078) ──
//
// Two more participant-originated channels, and neither is an answer. What that
// means concretely, and what every function below is arranged around:
//
//  - **Nothing here writes a vote, and nothing here is read by an aggregation.**
//    There is no call from this section into `broadcastResults`, into
//    `getSlideResults` or into any scoring path, so "not counted in any tally"
//    is a property of the call graph rather than a filter that could be dropped.
//  - **A reaction is never stored.** `sendReaction` validates, broadcasts and
//    returns; there is no reactions collection for it to write to and none for a
//    later feature to start reading. That is the same stance `server/preview.ts`
//    takes with test votes, and it is the whole of REQ077's "not stored as
//    answers": the code to store one does not exist.
//  - **The chat is a signal on the socket and a fetch on the wire**, exactly
//    like the Q&A list. Not because the transcript is secret — every reader of a
//    given deck's chat reads the same list — but because one authority for what
//    the feed contains is what keeps `own` honest, keeps the order in one place,
//    and leaves room for the projection to grow a filter later without every
//    client having to learn about it.

/**
 * The instant a chat message is stamped with — strictly increasing, whatever the
 * wall clock does.
 *
 * A transcript is ordered by when each line was written, and `Date.now()` has
 * millisecond resolution: a room of two hundred people typing produces
 * collisions constantly, and two messages sharing a stamp would fall back to
 * {@link orderChatMessages}'s id tie-break — which is stable across readers but
 * is not the order anybody said anything in. So a stamp that would not advance
 * is nudged forward by a millisecond instead.
 *
 * A closure over the last stamp rather than a class, and process-wide
 * rather than per-presentation: the value only has to be monotonic, and one
 * counter cannot be raced by two rooms into going backwards. It is deliberately
 * **not** a sequence number — what is stored stays a real ISO instant that a
 * reader, an export and a support question can all make sense of, at most a few
 * milliseconds ahead of the clock under load.
 *
 * The tie-break in `orderChatMessages` stays where it is: this process restarts,
 * and a stable order across two runs is still worth having.
 */
function createMonotonicStamp(): () => string {
	let previousMs = 0;
	return () => {
		const now = Date.now();
		previousMs = now > previousMs ? now : previousMs + 1;
		return new Date(previousMs).toISOString();
	};
}

const chatStamp = createMonotonicStamp();

/** Read a stored presentation's two channel switches, as the helper takes them. */
function participantChannelsOf(
	pres: Record<string, unknown>,
): ParticipantChannelSettings {
	return {
		reactionsEnabled: pres.reactionsEnabled as boolean | undefined,
		chatEnabled: pres.chatEnabled as boolean | undefined,
	};
}

/**
 * Tell everyone watching which participant channels are open (REQ077/REQ078).
 *
 * Both values ride the broadcast, like the Q&A layer's settings and for the same
 * reason: they are already on the public presentation document every phone
 * holds, and a phone that learned about a closed channel only on its next reload
 * would keep offering a reaction bar the server has started refusing.
 *
 * Sent from **every** path that writes them — the channels endpoint and the
 * ordinary deck PATCH the editor saves through (see {@link updatePresentation}).
 */
function broadcastChannelSettings(
	presentationId: string,
	pres: Record<string, unknown>,
): void {
	const channels = participantChannelsFor(participantChannelsOf(pres));
	broadcastToPresentation(presentationId, "channels.settings", {
		presentationId,
		reactionsEnabled: channels.reactions,
		chatEnabled: channels.chat,
	});
}

/** Open or close the two participant channels (REQ077/REQ078). */
export async function setParticipantChannels(
	presentationId: string,
	changes: { reactionsEnabled?: boolean; chatEnabled?: boolean },
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const current = participantChannelsFor(participantChannelsOf(pres));
	const updated = await presentations.update(presentationId, {
		reactionsEnabled: changes.reactionsEnabled ?? current.reactions,
		chatEnabled: changes.chatEnabled ?? current.chat,
	});
	if (updated) broadcastChannelSettings(presentationId, updated);
	return updated;
}

/**
 * Send a reaction from whatever slide is on screen (REQ077).
 *
 * **Broadcast and forgotten.** The frame goes out and the function returns;
 * nothing is inserted, no aggregate is recomputed, and no results payload
 * changes. A room reacting is therefore free of disk entirely, which is what
 * lets a reaction be as cheap to send as REQ077 says it is.
 *
 * Refused when the channel is closed, and when the deck is not taking
 * submissions at all — the same rule a vote and a question meet, so a room
 * cannot react at a deck it cannot answer.
 *
 * The frame carries its own id and instant. The id is what lets a client key one
 * flying icon per reaction rather than collapse a burst into a single element;
 * the instant is the server's, so every screen in the room animates against the
 * same clock rather than against whatever each device believes the time is.
 *
 * `slideId` is passed through untouched and nothing is keyed by it: it says
 * where the sender was looking, so a presenter's screen can burst over the slide
 * the room is reacting to. A reaction that names no slide is still a reaction and
 * reads as an explicit `null`.
 */
export async function sendReaction(
	presentationId: string,
	kind: ReactionKind,
	slideId: string | null,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;
	if (!acceptsSubmissions(pres)) return null;

	const channels = participantChannelsFor(participantChannelsOf(pres));
	if (!channels.reactions) return null;

	const reaction = {
		id: crypto.randomUUID(),
		kind,
		slideId,
		at: new Date().toISOString(),
	};
	broadcastToPresentation(presentationId, "reaction.sent", {
		presentationId,
		...reaction,
	});
	return { ok: true, ...reaction };
}

/**
 * Project stored chat rows into what one caller reads (REQ078).
 *
 * The writing participant's id is dropped here and nowhere later, so no route
 * can forget to — the same discipline `qaEntriesFor` applies to a question.
 * What comes back carries `own`, which is the one thing a client needs from an
 * id it must never be handed.
 */
function chatEntriesFor(
	stored: Record<string, unknown>[],
	participantId: string,
): ChatMessageEntry[] {
	return recentChatMessages(
		stored.map((message) => ({
			id: message.id as string,
			text: (message.text as string) ?? "",
			createdAt: (message.createdAt as string) ?? "",
			own:
				!!participantId &&
				((message.participantId as string) ?? "") === participantId,
		})),
	);
}

/**
 * The deck's chat as one caller reads it (REQ078), with the channel's own switch
 * alongside it so a client renders from a single payload.
 *
 * Readable whether or not the channel is currently open, and that is deliberate
 * in both directions: a presenter closing the chat mid-session must still be able
 * to read what was said, and a participant whose last message is on screen must
 * not have it vanish and read as deleted. What closing the channel stops is
 * *posting* — see {@link postChatMessage}.
 */
export async function getChat(
	presentationId: string,
	caller: { participantId: string },
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const channels = participantChannelsFor(participantChannelsOf(pres));
	const stored = await chatMessages.find({ presentationId });
	const messages = chatEntriesFor(stored, caller.participantId);

	return {
		presentationId,
		enabled: channels.chat,
		messages,
		/** How many the feed came back with — the capped list, not the whole store. */
		messageCount: messages.length,
	};
}

/**
 * Post a message to the deck's chat (REQ078).
 *
 * Separate from the Q&A queue and from every slide's answers, at every level
 * that matters: its own collection, its own endpoint, its own broadcast, and no
 * slide id anywhere in the row. A message is not a question waiting to be taken
 * and not an answer waiting to be counted — it is a line in a conversation, and
 * nothing downstream treats it as anything else.
 *
 * Refused when the channel is closed and when the deck is not taking submissions,
 * the same rule a vote and a question meet. Duplicates are **not** folded the way
 * a published Q&A question's are: two people saying "same here" is a chat
 * working, not a list that needs de-duplicating, and merging repeated lines would
 * silently rewrite a transcript.
 */
export async function postChatMessage(
	presentationId: string,
	text: string,
	participantId: string,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;
	if (!acceptsSubmissions(pres)) return null;

	const channels = participantChannelsFor(participantChannelsOf(pres));
	if (!channels.chat) return null;

	// Defence in depth rather than the boundary: `ChatMessageSchema` already
	// refuses a blank message, and refuses it *as* a blank message, so a caller
	// coming through the route never lands here. This stays for a caller that does
	// not — the service is exported and directly callable.
	const trimmed = text.trim();
	if (!trimmed) return null;

	const stored = await chatMessages.insert({
		presentationId,
		text: trimmed,
		participantId,
		// Strictly increasing — see {@link createMonotonicStamp}. A transcript is
		// ordered by when each line was written, and two lines a millisecond apart
		// must not be drawn in whichever order their ids happen to sort in.
		createdAt: chatStamp(),
	});
	// Payload-free beyond the presentation id, like `qa.updated`: every surface
	// re-reads the feed, which is the one place `own` and the order are decided.
	broadcastToPresentation(presentationId, "chat.updated", { presentationId });
	return { ok: true, stored: true, id: stored.id as string };
}

// ── Participant names (REQ076) ───────────────────────────────
//
// The rows live in `services/participant-names.ts`, which owns nothing but them.
// What is here is the composition: the two questions that are about the *deck*
// rather than about a name — does this deck ask for one, and is there still a
// session to join — plus the join against the votes that makes the roster worth
// reading.

/**
 * Tell everyone watching whether this deck asks for a name (REQ076).
 *
 * The value rides the broadcast, like the Q&A layer's settings and the two
 * channel switches and for the same reason: it is already on the public
 * presentation document every phone holds, so there is nothing to withhold and
 * a client that had not heard would be drawing the wrong door.
 *
 * What it carries is the **switch and nothing else** — never a name, never a
 * count. A frame naming somebody would put a name on every phone in the room,
 * which is the one thing this feature must not do; the roster is fetched, by a
 * credentialed caller, and only ever by them.
 */
function broadcastParticipantNameSetting(
	presentationId: string,
	pres: Record<string, unknown>,
): void {
	broadcastToPresentation(presentationId, "presentation.participant-name", {
		presentationId,
		requireParticipantName: deckRequiresParticipantName(
			pres as ParticipantNameSettings,
		),
	});
}

/**
 * Record what one participant is called on this deck (REQ076).
 *
 * Two refusals, and each is a deliberate reading of "on joining":
 *
 *  - **A deck that did not ask for names does not collect one.** This is not
 *    politeness about an unused field; it is the whole of the switch failing
 *    safe. A public endpoint that stored a name on any deck it was pointed at
 *    would make `requireParticipantName` a decision about the join *screen*
 *    rather than about whether the deck holds personal data at all.
 *  - **An ended deck takes none either.** Deliberately *not*
 *    {@link acceptsSubmissions}, which is the rule for an answer: a live deck
 *    collects answers only once the presenter has started it, and a participant
 *    standing at the door of a deck that has not started yet is exactly who this
 *    question is asked of. What ending a session closes is the door itself —
 *    there is no room left to state a name to.
 *
 * Answers with the stored name so the caller can see what was kept, since the
 * normalisation ({@link normalizeParticipantName}) may have folded what they
 * typed; `null` is a refusal, on either count, or a deck that does not exist.
 */
export async function stateParticipantName(
	presentationId: string,
	participantId: string,
	name: string,
): Promise<{ name: string } | null> {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;
	if (!deckRequiresParticipantName(pres as ParticipantNameSettings)) return null;
	if (pres.status === "ended") return null;
	if (!participantId) return null;

	const stored = await setParticipantName(presentationId, participantId, name);
	return stored ? { name: stored.name } : null;
}

/**
 * Who took part, by name — the deck's roster (REQ076).
 *
 * The join the two collections cannot do on their own: a name is a row keyed by
 * `participantId`, every answer carries the same key, and "who was here and how
 * much did they answer?" is the one question an organizer asks of both at once.
 * `answeredSlides` counts **slides**, not rows: a multi-statement scale (REQ029)
 * or a 2x2 grid (REQ047) stores one row per item, and a roster that reported
 * those as eleven answers would be counting the deck's shape rather than the
 * participant's participation.
 *
 * People who answered without stating a name are **not** listed. Two reasons,
 * and the second is the load-bearing one: a deck only collects names while the
 * switch is on, so rows cast before it was turned on legitimately have none —
 * and a roster that padded itself with untitled entries would read as a list of
 * people whose names went missing. What those rows are is what they have always
 * been, an anonymous participant id, and the export is where they are counted.
 *
 * Ordered by name ({@link orderParticipantRoster}). Returns `null` for a deck
 * that does not exist, like every other read here.
 */
export async function getParticipantRoster(
	presentationId: string,
): Promise<ParticipantRosterEntry[] | null> {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const [names, deckVotes] = await Promise.all([
		listParticipantNames(presentationId),
		votes.find({ presentationId }),
	]);

	const slidesAnswered = new Map<string, Set<string>>();
	for (const row of deckVotes) {
		const participantId = String(row.participantId ?? "");
		if (!participantId) continue;
		const seen = slidesAnswered.get(participantId) ?? new Set<string>();
		seen.add(String(row.slideId ?? ""));
		slidesAnswered.set(participantId, seen);
	}

	return orderParticipantRoster(
		names.map((record) =>
			ParticipantRosterEntrySchema.parse({
				participantId: record.participantId,
				name: record.name,
				answeredSlides: slidesAnswered.get(record.participantId)?.size ?? 0,
				statedAt: record.createdAt,
			}),
		),
	);
}

// ── Quiz scoring (REQ054, REQ056, REQ057) ────────────────────
//
// Scores are **derived**, never stored: one function of the slide as it stands
// now and the votes cast on it. That is what lets an organizer fix a
// mis-marked answer and have the room re-scored with no migration and no stale
// total left behind — and it is why both read sites below (the room's tally and
// one participant's card) call the same function rather than each re-deriving
// what a point is worth.

/** One participant's answer to one quiz question, scored. */
type ScoredQuizAnswer = {
	participantId: string;
	/**
	 * What they submitted, as it is stored: an option id on a select-answer
	 * question, the text they wrote on a typed one (REQ055).
	 */
	submitted: string;
	/** How this question was answered, so a read site never re-derives it. */
	answerMode: QuizAnswerMode;
	isCorrect: boolean;
	/** Time from the question opening to the answer landing; null if untimed. */
	elapsedMs: number | null;
	points: number;
};

/** A quiz question's window and every answer scored inside it. */
type ScoredQuizSlide = {
	/** Seconds the question stayed open, or null when it has no limit (REQ057). */
	timeLimit: number | null;
	/** When the question opened, ISO — null until a presenter reached it. */
	startedAt: string | null;
	/** When it closes, ISO — null when it never does. */
	deadline: string | null;
	answers: ScoredQuizAnswer[];
};

/**
 * The rows that count on one quiz question: **one answer per participant, the
 * first they gave** (REQ054).
 *
 * The single judgement about what a quiz slide's votes mean, composed by every
 * number the payload reports. It settles two separate things, and it
 * has to settle them in one place or the same payload reports the same room two
 * ways — one respondent beside two answers, or a 50% correct share on a question
 * one person got right.
 *
 *  - **Standing.** A row that is no longer an answer to the question as it
 *    stands — an option since deleted, or an option id left over from before the
 *    question took typed answers (REQ055) — is dropped rather than scored as
 *    wrong, the same stance every other tally here takes toward a vote its slide
 *    was re-authored out from under. A renamed option is not a mistake the
 *    participant made.
 *  - **One per participant.** `submitVote` now writes at most one (see the quiz
 *    branch and `server/keyed-lock.ts`), but a deck may already hold two from
 *    before it did, and a read that counted both would report a room that does
 *    not exist. The first is kept, because on a quiz the datum is what the
 *    participant knew at that moment and the answer they gave first is the one
 *    the one-answer rule made final.
 *
 * An absent participant id counts as one participant rather than as none: it is
 * the bucket `respondentCount` and `guardSubmission` (`server/rate-limit.ts`)
 * already put such rows in, and the whole point here is that every number agrees.
 *
 * Rows are returned in the order they landed, so the scorecard reads as the
 * question was answered.
 */
function finalQuizAnswers(
	slide: Slide,
	slideVotes: Record<string, unknown>[],
): Record<string, unknown>[] {
	const final: Record<string, unknown>[] = [];
	const answered = new Set<string>();
	for (const quizVote of slideVotes) {
		if (!isStandingQuizAnswer(slide, String(quizVote.value ?? ""))) continue;
		const participantId = String(quizVote.participantId ?? "");
		if (answered.has(participantId)) continue;
		answered.add(participantId);
		final.push(quizVote);
	}
	return final;
}

/**
 * Score every answer on one quiz slide, whichever way it is answered (REQ055).
 *
 * Which rows those are is {@link finalQuizAnswers}' call, made here rather than
 * by the caller so that no caller can forget it: this runs from the room's
 * tally, from one participant's scorecard and from the deck's standings, and a
 * de-duplication applied at two of the three is how the board and the bars
 * beside it start reporting different rooms.
 */
function scoreQuizSlide(
	slide: Slide,
	slideVotes: Record<string, unknown>[],
	startedAt: string | null,
): ScoredQuizSlide {
	const timeLimit = quizTimeLimitFor(slide);
	const deadline = quizDeadlineFor(startedAt, timeLimit);
	const openedAt = startedAt ? Date.parse(startedAt) : Number.NaN;
	const answerMode = quizAnswerModeFor(slide);

	const answers: ScoredQuizAnswer[] = [];
	for (const quizVote of finalQuizAnswers(slide, slideVotes)) {
		const submitted = String(quizVote.value ?? "");
		const answeredAt = Date.parse(String(quizVote.createdAt ?? ""));
		const elapsedMs =
			Number.isNaN(openedAt) || Number.isNaN(answeredAt)
				? null
				: answeredAt - openedAt;
		const isCorrect = isCorrectQuizAnswer(slide, submitted);
		answers.push({
			participantId: String(quizVote.participantId ?? ""),
			submitted,
			answerMode,
			isCorrect,
			elapsedMs,
			points: scoreQuizAnswer({ isCorrect, elapsedMs, timeLimitSeconds: timeLimit }),
		});
	}

	return {
		timeLimit,
		startedAt: startedAt ?? null,
		deadline: deadline === null ? null : new Date(deadline).toISOString(),
		answers,
	};
}

/**
 * What the room typed on a free-text quiz question (REQ055) — the block that
 * takes the place of a choice slide's per-option counts.
 *
 * Answers are grouped by {@link normalizeQuizAnswer}, so "paris", "Paris" and
 * "Paris." are one row rather than three: they are one answer by the same rule
 * that scored them, and a tally that split them would report a room that
 * disagreed when it did not. The row is labelled with the **first spelling that
 * arrived**, because a group has to be shown in words somebody actually typed —
 * the normalized form is a comparison key, not prose.
 *
 * Both the answer key and the room's answers are withheld from a client that
 * may not see the solution yet, and they are withheld together on purpose: on a
 * typed question the answer most of the room wrote *is* the answer, so shipping
 * the rows while the question runs would hand a competitor reading the network
 * tab the thing the key itself is being kept back for. Withheld reads as an
 * explicit `null` rather than an empty list, which would claim
 * nobody has answered.
 *
 * Counted over {@link finalQuizAnswers}, so a group's `count` is people rather
 * than rows — the same unit `respondentCount` and the scoring block report, and
 * the reason a participant cannot appear twice in the same group.
 */
function tallyTypedQuizAnswers(
	slide: Slide,
	slideVotes: Record<string, unknown>[],
	revealsCorrect: boolean,
) {
	// A Map keyed on the normalized form: insertion order is arrival order, which
	// is what breaks ties between equally popular answers below.
	const groups = new Map<
		string,
		{ text: string; count: number; isCorrect: boolean }
	>();
	for (const quizVote of finalQuizAnswers(slide, slideVotes)) {
		const submitted = String(quizVote.value ?? "");
		const key = normalizeQuizAnswer(submitted);
		const group = groups.get(key);
		if (group) {
			group.count++;
			continue;
		}
		groups.set(key, {
			text: submitted,
			count: 1,
			isCorrect: isCorrectQuizAnswer(slide, submitted),
		});
	}

	// Most-given first; ties keep the order they arrived in, so the same answers
	// always render the same way.
	const entries = [...groups.values()].sort(
		(left, right) => right.count - left.count,
	);

	return {
		/** The solutions the organizer accepts — `null` until the key may be seen. */
		accepted: revealsCorrect ? acceptedQuizAnswers(slide) : null,
		/** Distinct answers the room gave, however many may be shown. */
		distinctCount: entries.length,
		entries: revealsCorrect
			? entries.map((entry) => ({
					text: entry.text,
					count: entry.count,
					isCorrect: entry.isCorrect,
				}))
			: null,
	};
}

/**
 * How the room did on one quiz question (REQ056) — the shape that rides along
 * with the choice tally on the results endpoint.
 *
 * Deliberately **anonymous**: it reports how many answered, how many were right
 * and what they scored, never who. The results endpoint is public and
 * unauthenticated, and a participant id is the only credential a vote carries —
 * listing them would let anyone overwrite another participant's answer. One
 * participant's own card is served separately, to whoever already holds that id
 * ({@link getParticipantScorecard}).
 */
function summarizeQuizScores(scored: ScoredQuizSlide, now: number) {
	const { answers } = scored;
	const correctCount = answers.filter((answer) => answer.isCorrect).length;
	const totalPoints = answers.reduce((sum, answer) => sum + answer.points, 0);
	return {
		/** What one correct answer is worth before and with the speed bonus. */
		correctPoints: QUIZ_CORRECT_POINTS,
		speedPoints: QUIZ_SPEED_POINTS,
		maxPoints: QUIZ_MAX_POINTS,
		/** The authored window and where it currently stands (REQ057). */
		timeLimit: scored.timeLimit,
		startedAt: scored.startedAt,
		deadline: scored.deadline,
		/**
		 * Whether the question is closed *now*. A question with no deadline is
		 * never closed — either it is untimed or it has not been opened yet, and
		 * both are "still answerable" rather than "over".
		 */
		closed:
			scored.deadline !== null &&
			!isQuizWindowOpen(Date.parse(scored.deadline), now),
		/** Answers the tally scored — the denominator behind the averages. */
		answeredCount: answers.length,
		correctCount,
		totalPoints,
		// Emit both keys either way. A question nobody has answered has
		// no average and no correct share at all — an explicit `null`, not a `0`
		// that would read as a room that answered and got everything wrong.
		averagePoints: answers.length
			? Math.round((totalPoints / answers.length) * 100) / 100
			: null,
		correctShare: answers.length
			? Math.round((correctCount / answers.length) * 10000) / 100
			: null,
	};
}

/** Every quiz question in a deck, scored across the whole room. */
type ScoredQuizDeck = { slide: Slide; scored: ScoredQuizSlide }[];

/**
 * Score the deck's quiz questions — all of them, for everybody (REQ056,
 * REQ059).
 *
 * The one read of the room's quiz answers, shared by the two things that need
 * it: one participant's card, and the standings every card is placed in. They
 * were separate reads while a scorecard only had to describe itself; the moment
 * a card carries a rank, deriving the ranking twice from two different reads is
 * how the number under "you are 4th" stops matching the board beside it.
 *
 * **This reads the whole room, on a request every phone makes per quiz slide.**
 * The scorecard used to read only its own participant's rows; a place cannot be
 * derived from those, so the wider read is the price of `rank` rather than an
 * oversight. It is charged even to a deck with no leaderboard slide, deliberately:
 * the alternative is a card whose `rank` means "your place" in one deck and
 * `null` in another, which is a worse contract than a read that scales with the
 * room. The cost is bounded by the deck's own quiz votes (participants ×
 * questions), each an indexed lookup — the same order the results endpoint
 * already pays per slide. If a room ever outgrows it, the fix is a cached
 * standings snapshot invalidated by {@link broadcastStandings}, not a second
 * ranking derived somewhere else.
 */
async function scoreQuizDeck(
	presentationId: string,
	pres: Record<string, unknown>,
	source: ResultsSource,
): Promise<ScoredQuizDeck> {
	const stamps = slideStartedAtIn(pres);
	const quizSlides = (pres.slides as Slide[]).filter(
		(slide) => slide.type === "quiz",
	);
	return Promise.all(
		quizSlides.map(async (slide) => {
			const slideVotes = await source.votesFor(slide.id);
			return {
				slide,
				scored: scoreQuizSlide(slide, slideVotes, stamps[slide.id] ?? null),
			};
		}),
	);
}

/**
 * The answer one participant has standing on a scored question — the first, on
 * the rare row where history left more than one (the boundary allows a single
 * final answer, but a deck re-authored under its votes can leave two standing).
 * The same one the score, the lock and the card all read.
 */
function answerOf(
	scored: ScoredQuizSlide,
	participantId: string,
): ScoredQuizAnswer | null {
	return (
		scored.answers.find((answer) => answer.participantId === participantId) ??
		null
	);
}

/**
 * The public, one-way handle one participant's row is named by (REQ059).
 *
 * A digest, not the participant id, because the id a vote carries **is** that
 * participant's credential: the vote endpoint is public and accepts whatever id
 * it is handed, so publishing the room's ids on the most-watched surface in the
 * product would hand anyone the means to overwrite anyone's answer. A SHA-256
 * of a v4 UUID cannot be walked back to it, so the board can name a row without
 * naming a credential.
 *
 * Scoped by presentation so the same participant is a different handle in a
 * different deck — two boards cannot be joined to follow one person around.
 */
function leaderboardEntryIdFor(
	presentationId: string,
	participantId: string,
): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(`${presentationId}:${participantId}`);
	// Sixteen hex characters: 64 bits, far past collision inside one room, and
	// short enough to travel in every row of the payload.
	return hasher.digest("hex").slice(0, 16);
}

/**
 * The deck's standings, in competition order (REQ059).
 *
 * A participant is on the board once they have given a standing answer to one
 * quiz question — including a wrong one, which earns nothing and still places
 * them: a competition where the people who guessed wrong vanish reports a
 * smaller, luckier room than the one that played.
 *
 * A vote with **no** participant id is left out entirely. It cannot be
 * attributed to anybody, and folding every such row into one entry would invent
 * a competitor that is really several people — a phantom that could outscore
 * the room by being all of it. (The tally beside the board does count them, as
 * one participant — see {@link finalQuizAnswers}. The two readings differ on
 * purpose: "somebody answered" is a fact about the question, and being ranked is
 * a claim about a person.)
 *
 * One question is worth one answer per participant, which the board no longer
 * has to establish for itself: {@link finalQuizAnswers} settles it once, for
 * every read of a quiz slide's votes. Restating it here was a second copy of the
 * same rule, and the copy the room's own tally did not have.
 */
function rankQuizDeck(
	presentationId: string,
	deck: ScoredQuizDeck,
): LeaderboardEntry[] {
	const totals = new Map<string, LeaderboardTotals>();
	for (const { scored } of deck) {
		for (const answer of scored.answers) {
			if (!answer.participantId) continue;
			const entryId = leaderboardEntryIdFor(
				presentationId,
				answer.participantId,
			);
			const running = totals.get(entryId) ?? {
				entryId,
				totalPoints: 0,
				correctCount: 0,
				answeredCount: 0,
			};
			running.totalPoints += answer.points;
			running.correctCount += answer.isCorrect ? 1 : 0;
			running.answeredCount += 1;
			totals.set(entryId, running);
		}
	}
	return rankLeaderboardEntries([...totals.values()]);
}

/**
 * The whole board behind a leaderboard slide (REQ059) — every ranked
 * participant, plus what the deck's quiz questions are worth. What a *slide*
 * shows is a prefix of this ({@link leaderboardSizeFor}); what a participant is
 * told about themselves is their row in it, wherever it sits.
 */
function leaderboardFrom(presentationId: string, deck: ScoredQuizDeck) {
	const entries = rankQuizDeck(presentationId, deck);
	return {
		/** Quiz questions the standings are summed over. */
		quizCount: deck.length,
		/** What the whole deck's quiz questions are worth at best. */
		maxPoints: deck.length * QUIZ_MAX_POINTS,
		/** How many participants are ranked — the denominator behind a place. */
		rankedCount: entries.length,
		entries,
	};
}

/**
 * One participant's standing across a deck's quiz questions (REQ056, REQ059) —
 * what they answered, whether it was right, what it scored, and where that puts
 * them in the room.
 *
 * This is the participant's own result after a question ("you were right,
 * +840") and, since REQ059, the only place a participant learns their own rank:
 * the leaderboard is anonymous by construction, so a phone cannot find its owner
 * on the board without being told which row is theirs. It is served to whoever
 * already holds the participant id, and it hands out nobody else's.
 *
 * Every quiz slide in the deck is listed, answered or not, so a client never has
 * to reason about a missing key to know a question went unanswered.
 */
export async function getParticipantScorecard(
	presentationId: string,
	participantId: string,
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const deck = await scoreQuizDeck(
		presentationId,
		pres,
		storedResultsSource(presentationId),
	);
	const board = leaderboardFrom(presentationId, deck);
	const entryId = leaderboardEntryIdFor(presentationId, participantId);
	const standing = board.entries.find((entry) => entry.entryId === entryId);

	const slides = deck.map(({ slide, scored }) => {
		const answer = answerOf(scored, participantId);
		const answerMode = quizAnswerModeFor(slide);
		return {
			slideId: slide.id,
			question: slide.question,
			/** How the question was answered (REQ054 select, REQ055 type). */
			answerMode,
			timeLimit: scored.timeLimit,
			startedAt: scored.startedAt,
			deadline: scored.deadline,
			maxPoints: QUIZ_MAX_POINTS,
			answered: answer !== null,
			// An unanswered question is spelled with explicit nulls
			// rather than dropped keys — "did not answer" is a result too, and a
			// `false` for `isCorrect` would claim they answered and got it wrong.
			// The two answer shapes get a key each and only one is ever filled:
			// an option id is not a typed answer, and a client that renders "you
			// answered X" must not have to guess which of the two it holds.
			optionId: answer && answerMode === "select" ? answer.submitted : null,
			answer: answer && answerMode === "type" ? answer.submitted : null,
			isCorrect: answer ? answer.isCorrect : null,
			elapsedMs: answer ? answer.elapsedMs : null,
			points: answer ? answer.points : 0,
		};
	});

	const answered = slides.filter((slide) => slide.answered);
	return {
		participantId,
		/**
		 * REQ059 — how this participant appears on the deck's leaderboard, and
		 * where they stand in it. The handle is theirs whether or not they have
		 * scored yet, so a client can match itself against the board the moment
		 * they do; the place is an explicit `null` until they have answered
		 * something, because "unranked" is a standing too and a `0` would read as
		 * a place they hold.
		 */
		entryId,
		label: leaderboardEntryLabel(entryId),
		rank: standing?.rank ?? null,
		rankedCount: board.rankedCount,
		quizCount: slides.length,
		answeredCount: answered.length,
		correctCount: answered.filter((slide) => slide.isCorrect === true).length,
		totalPoints: slides.reduce((sum, slide) => sum + slide.points, 0),
		/** What the whole deck's quiz questions are worth at best. */
		maxPoints: slides.length * QUIZ_MAX_POINTS,
		slides,
	};
}

// ── Results aggregation ──────────────────────────────────────
//
// The tally is one function of a slide, a deck and a pile of vote rows — and it
// reads those rows through a **source** rather than reaching for the store
// itself. That seam is what REQ103/REQ104 are built on: a preview run feeds
// synthetic rows through the very same aggregation a live session's rows go
// through, so a previewed chart is the chart the room will see rather than a
// second implementation of it that drifts (logic separated from
// orchestration, composed at the call site).
//
// It also makes the isolation guarantee structural. The preview source holds its
// rows in memory and the aggregation only ever *reads* — there is no write path
// on this side of the seam at all, so a test vote has nowhere to land.

/**
 * Where a tally reads its rows. Two implementations: the stored one below, and
 * the in-memory one a preview run supplies (factories, not classes).
 */
export type ResultsSource = {
	/** Every vote row on one slide. */
	votesFor(slideId: string): Promise<Record<string, unknown>[]>;
	/** Every open-ended upvote on one slide (REQ025). */
	responseVotesFor(slideId: string): Promise<Record<string, unknown>[]>;
};

/** The live source: one indexed lookup per slide, exactly as before. */
function storedResultsSource(presentationId: string): ResultsSource {
	return {
		votesFor: (slideId) => votes.find({ presentationId, slideId }),
		responseVotesFor: (slideId) =>
			responseVotes.find({ presentationId, slideId }),
	};
}

/**
 * The preview source (REQ104): rows the run generated, held in memory and never
 * written. Grouped by slide once so a deck-wide preview does not re-scan the
 * whole pile per slide.
 */
function testVoteResultsSource(set: TestVoteSet): ResultsSource {
	const bySlide = new Map<string, Record<string, unknown>[]>();
	for (const vote of set.votes) {
		const rows = bySlide.get(vote.slideId) ?? [];
		rows.push(vote as Record<string, unknown>);
		bySlide.set(vote.slideId, rows);
	}
	const upvotesBySlide = new Map<string, Record<string, unknown>[]>();
	for (const upvote of set.responseVotes) {
		const rows = upvotesBySlide.get(upvote.slideId) ?? [];
		rows.push(upvote as Record<string, unknown>);
		upvotesBySlide.set(upvote.slideId, rows);
	}
	return {
		votesFor: async (slideId) => bySlide.get(slideId) ?? [],
		responseVotesFor: async (slideId) => upvotesBySlide.get(slideId) ?? [],
	};
}

export async function getSlideResults(
	presentationId: string,
	slideId: string,
	/**
	 * What this caller has proved about itself (see {@link ResultsCaller}). Only
	 * an editor sees a quiz slide's marked solution while its question is still
	 * running (REQ056); a results-link holder (REQ098) sees the tally whatever
	 * the reveal mode says and nothing else an editor sees. Both default to the
	 * withholding value, so the broadcast path — which reaches the whole room —
	 * cannot leak by omission.
	 */
	opts: ResultsCaller = {},
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;
	return aggregateSlideResults(
		presentationId,
		pres,
		slideId,
		storedResultsSource(presentationId),
		opts,
	);
}

/**
 * The tally itself: what one slide's rows add up to, given the deck they sit in.
 *
 * `pres` is passed rather than fetched because a preview run hands in a deck
 * state that was never stored — live, with its questions opened at the instant
 * the run began — and the aggregation must read *that* rather than whatever the
 * draft in the database says.
 */
async function aggregateSlideResults(
	presentationId: string,
	pres: Record<string, unknown>,
	slideId: string,
	source: ResultsSource,
	opts: ResultsCaller = {},
) {
	const slides = pres.slides as Slide[];
	const slide = slides.find((s) => s.id === slideId);
	if (!slide) return null;

	// REQ015/REQ016/REQ017 — the deck's reveal mode decides whether this tally is
	// published at all, and it is enforced *here* rather than at each of the four
	// surfaces that hand a tally out. Every one of them lands on this function:
	// the two results endpoints, the `results.updated` broadcast, and the
	// preview's audience pane. A caller that can edit the deck reads the numbers
	// whatever the mode says — that is the results surface REQ017 keeps them
	// reachable on, and it is authorized as an edit (owner or edit token) — and so
	// does the holder of the deck's results link (REQ098), which is the
	// read-only delegation of that same surface.
	//
	// Before the gate, not after: the withheld marker must not be assembled from
	// a tally that was computed and then blanked field by field, because that is
	// the shape one forgotten field leaks through.
	if (!tallyVisibleToCaller(slide, pres as TallyRevealState, opts)) {
		return withheldTally(slide.type);
	}

	const slideVotes = await source.votesFor(slideId);

	switch (slide.type) {
		case "multiple-choice":
		case "quiz": {
			// Count votes per option, and the distinct participants behind them.
			// With multi-select (REQ014) a participant contributes several rows, so
			// the two numbers diverge: `totalVotes` counts selections, while
			// `respondentCount` counts people. The share a client renders per option
			// is "how many of the people who answered picked this" — i.e. it divides
			// by `respondentCount`, which is the only denominator that stays
			// meaningful when the shares deliberately sum past 100%. For a
			// single-select slide the two are equal, so nothing changes there.
			//
			// A **quiz** is the exception to that divergence: one participant is one
			// answer (REQ054), so its three numbers have to agree. They are all read
			// off `countedVotes` — the same rows the score and the typed tally read
			// through `finalQuizAnswers` — because counting rows here while counting
			// people there is precisely how one payload came to report a
			// `respondentCount` of 1 beside a `scoring.answeredCount` of 2.
			const answerMode = quizAnswerModeFor(slide);
			const countedVotes =
				slide.type === "quiz" ? finalQuizAnswers(slide, slideVotes) : slideVotes;
			const counts: Record<string, number> = {};
			for (const opt of slide.options || []) {
				counts[opt.id] = 0;
			}
			const respondents = new Set<string>();
			for (const countedVote of countedVotes) {
				const val = countedVote.value as string;
				// One gate for the head count, and it is the one the score and the
				// typed tally already use: a row that is no longer an answer to the
				// question as it stands — an option since deleted, or an option id on
				// a question that now takes typed answers (REQ055) — counts nowhere.
				// Reading it here and dropping it there would let the same payload
				// report a `respondentCount` of 1 beside an `answeredCount` of 0.
				// On a plain choice slide this is exactly "the option still exists",
				// which is what the count map already said, so nothing changes there;
				// on a quiz it has already been applied, and re-applying it is free.
				if (!isStandingQuizAnswer(slide, val)) continue;
				// A typed answer has no option to be counted under, but it is still
				// one participant answering.
				if (counts[val] !== undefined) counts[val]++;
				respondents.add(countedVote.participantId as string);
			}
			// A plain choice slide reveals its solution as soon as it has one to
			// reveal (REQ013). A quiz slide has a notion of correctness always, but
			// it is the answer to a question the room is being scored on, so the
			// tally carries it only for an editor or once the question is over —
			// the same gate the deck payload passes through (REQ056).
			const revealsCorrect =
				slide.type === "quiz"
					? Boolean(opts.canEdit) ||
						solutionVisibleToAudience(slide, pres, Date.now())
					: slideHasCorrectAnswers(slide);
			return {
				type: slide.type,
				/**
				 * How this question was answered (REQ054 select, REQ055 type), so a
				 * client picks a renderer from the tally it is holding. Always
				 * `"select"` on a plain choice slide, which has no answer mode.
				 */
				answerMode,
				/**
				 * Selections on a choice slide, where a multi-select participant casts
				 * several. On a quiz it is answers, which is people: `countedVotes` is
				 * already one row per participant, so this reads equal to
				 * `respondentCount` and to `scoring.answeredCount` rather than
				 * contradicting them.
				 */
				totalVotes: countedVotes.length,
				respondentCount: respondents.size,
				maxSelections: maxSelectionsFor(slide),
				// REQ055 — what the room typed, or an explicit `null` on a question
				// answered by picking an option.
				typedAnswers:
					answerMode === "type"
						? tallyTypedQuizAnswers(slide, slideVotes, revealsCorrect)
						: null,
				// REQ054/REQ056/REQ057 — how the room scored and where the question's
				// window stands. The key is emitted for a plain choice slide
				// too, as an explicit `null`; a choice slide can reveal a solution
				// (REQ013) but keeps no score, and the two must stay distinguishable.
				scoring:
					slide.type === "quiz"
						? summarizeQuizScores(
								scoreQuizSlide(
									slide,
									slideVotes,
									slideStartedAtIn(pres)[slideId] ?? null,
								),
								Date.now(),
							)
						: null,
				// A typed question offers no options to anyone, so its tally carries
				// none — the same rule `withAudienceSolutions` applies to the deck,
				// and for the same reason: a question switched from `select` keeps
				// the options it was authored with (deliberately, so the stale
				// answers under it stay recognisable), and the correct one is still
				// spelled out among them. This payload is re-broadcast to the whole
				// room after every answer, so an option list left in would be a
				// shortlist containing the answer, on a question whose entire point
				// is that there is nothing to read off.
				//
				// Emptied for the editor too, not just the audience: the option text
				// is not a result of *this* question, and a shared screen drawing
				// bars for options nobody was offered would be reporting a tally that
				// does not exist. What the author wrote is still theirs to read on
				// the deck, which their own fetch returns in full.
				options:
					answerMode === "type"
						? []
						: (slide.options || []).map((opt) => ({
								id: opt.id,
								text: opt.text,
								count: counts[opt.id] || 0,
								// Emit the key for every option. A slide with no
								// correct answer to reveal has no notion of correctness, so
								// the value is an explicit `null` (a key dropped via
								// `undefined` would be invisible to consumers) rather than a
								// misleading `false`.
								isCorrect: revealsCorrect ? Boolean(opt.isCorrect) : null,
							})),
			};
		}

		// ── Leaderboard (REQ059) ──────────────────────────────────
		//
		// The one slide whose results are not a tally of its own votes: it has
		// none, and reports on the deck's quiz questions instead. It rides the
		// results endpoint rather than getting one of its own because that is
		// already the channel both screens read a slide's aggregate on — the
		// presenter's poll, the participant's fetch on arrival, the broadcast
		// after an answer lands — so the board updates by the same route
		// everything else does.
		//
		// Anonymous by construction, and it has to be: this payload is public and
		// unauthenticated. Every row is named by a one-way handle, so the board
		// can be read from the back row without handing anybody the id that would
		// let them answer as somebody else.
		case "leaderboard": {
			const board = leaderboardFrom(
				presentationId,
				await scoreQuizDeck(presentationId, pres, source),
			);
			const size = leaderboardSizeFor(slide);
			return {
				type: "leaderboard",
				// A leaderboard collects nothing itself. Emitted anyway, because
				// every results payload carries it and a client that reads "how many
				// responses" off a slide must not find the key missing.
				totalVotes: 0,
				quizCount: board.quizCount,
				maxPoints: board.maxPoints,
				/** Everyone ranked — the denominator behind "4th of 31". */
				rankedCount: board.rankedCount,
				/** How many ranks this slide asked to show (REQ059). */
				size,
				// A hard cut at the authored size, deliberately — even when it lands
				// inside a tied block, so two participants level on 5th place with
				// `size: 5` see one of them projected and the other counted in "+1 more
				// ranked". Extending the board through a tie would make the setting a
				// suggestion: one popular question everybody scored the same on would
				// put the whole room on the projector, on a slide whose cap exists
				// precisely so it stays legible from the back. What ties buy is
				// *equality of place*, and that survives the cut — the row below it
				// carries the same rank number, and its holder is told that rank on
				// their own screen.
				entries: board.entries.slice(0, size),
			};
		}

		case "word-cloud": {
			// Count word frequencies
			const wordCounts: Record<string, number> = {};
			for (const v of slideVotes) {
				const word = (v.value as string).trim().toLowerCase();
				if (word) {
					wordCounts[word] = (wordCounts[word] || 0) + 1;
				}
			}
			const words = Object.entries(wordCounts)
				.map(([text, count]) => ({ text, count }))
				.sort((a, b) => b.count - a.count);
			return {
				type: "word-cloud",
				totalVotes: slideVotes.length,
				words,
				// The individual answers behind those counts (REQ027) — for an editor
				// only, and an explicit `null` for everybody else, on the
				// same terms a form slide's rows are (see the `form` branch).
				//
				// The cloud itself is an aggregate: "pizza (3)" says three people
				// typed it and names none of the three rows, so an editor reading only
				// the cloud has nothing to point a deletion at. This is the list that
				// makes one of them nameable. It carries the row's id, its text as it
				// was written — not the folded lower-case the cloud draws, since the
				// editor is deciding about the line somebody actually typed — and when
				// it arrived. It carries **no participant id**: that is a participant's
				// only credential, and taking one line down needs nothing about who
				// wrote it.
				answers: opts.canEdit
					? slideVotes.map((wordVote) => ({
							id: wordVote.id as string,
							text: String(wordVote.value ?? ""),
							createdAt: String(wordVote.createdAt ?? ""),
						}))
					: null,
			};
		}

		case "open-text": {
			// REQ025: include per-response upvote counts when response voting is on.
			const upvotes = slide.allowResponseVotes
				? await source.responseVotesFor(slideId)
				: [];
			const upvoteCounts: Record<string, number> = {};
			for (const u of upvotes) {
				const rid = u.responseId as string;
				upvoteCounts[rid] = (upvoteCounts[rid] || 0) + 1;
			}
			const responses = slideVotes.map((v) => ({
				id: v.id as string,
				text: v.value as string,
				createdAt: v.createdAt as string,
				upvotes: upvoteCounts[v.id as string] || 0,
			}));
			return {
				type: "open-text",
				totalVotes: slideVotes.length,
				layout: slide.openTextLayout ?? "speech-bubbles",
				allowResponseVotes: !!slide.allowResponseVotes,
				responses,
			};
		}

		case "ranking": {
			// REQ033: turn a pile of individual orderings into one aggregated
			// ranking. Scoring is Borda-style — an item placed p-th (0-indexed)
			// on a ballot earns `itemCount - p` points, so the top of every
			// ordering is worth the same regardless of how far down the
			// participant went. That is what makes a partial ordering (REQ034 —
			// participants may rank only some items) comparable with a complete
			// one: an item nobody placed simply earns nothing, instead of an
			// averaged position that would flatter a single enthusiast's pick.
			const items = slide.rankingItems ?? [];
			const itemCount = items.length;
			const tallies = new Map(
				items.map((item, authoredIndex) => [
					item.id,
					{
						id: item.id,
						text: item.text,
						authoredIndex,
						points: 0,
						/** Ballots that placed this item anywhere. */
						rankedCount: 0,
						/** Sum of 1-indexed positions, for the readable average. */
						positionSum: 0,
					},
				]),
			);

			// Ballots the tally could actually read. A row whose value no longer
			// decodes — its slide was re-authored under it, dropping an item the
			// order named — is skipped rather than counted as an empty opinion.
			let ballots = 0;
			for (const rankingVote of slideVotes) {
				const order = decodeRanking(String(rankingVote.value ?? ""), items);
				if (!order) continue;
				ballots++;
				order.forEach((itemId, position) => {
					const tally = tallies.get(itemId);
					if (!tally) return;
					tally.points += itemCount - position;
					tally.rankedCount++;
					tally.positionSum += position + 1;
				});
			}

			// Most points first. Ties break on the better average position, then
			// on the authored order, so the same votes always render the same way.
			const ordered = [...tallies.values()].sort((left, right) => {
				if (right.points !== left.points) return right.points - left.points;
				const leftAverage = left.rankedCount
					? left.positionSum / left.rankedCount
					: Number.POSITIVE_INFINITY;
				const rightAverage = right.rankedCount
					? right.positionSum / right.rankedCount
					: Number.POSITIVE_INFINITY;
				if (leftAverage !== rightAverage) return leftAverage - rightAverage;
				return left.authoredIndex - right.authoredIndex;
			});

			return {
				type: "ranking",
				totalVotes: slideVotes.length,
				/** Orderings the tally read — the denominator for "not ranked". */
				ballots,
				itemCount,
				items: ordered.map((tally, index) => ({
					id: tally.id,
					text: tally.text,
					/** 1-indexed place in the aggregated ranking. */
					rank: index + 1,
					points: tally.points,
					rankedCount: tally.rankedCount,
					notRanked: ballots - tally.rankedCount,
					// Emit the key either way. An item no ballot placed has
					// no average position at all — an explicit `null`, not a `0` that
					// would read as "ranked first by everyone".
					averageRank: tally.rankedCount
						? Math.round((tally.positionSum / tally.rankedCount) * 100) / 100
						: null,
				})),
			};
		}

		case "points": {
			// REQ044: what the room's budgets add up to. Every readable ballot
			// spends exactly POINTS_BUDGET — the codec rejects anything else — so
			// the denominator below is `ballots * budget` and the shares sum to
			// 100%: that is the whole reason the format forces a full spend, and
			// it is what lets one item's weight be compared against another's
			// rather than against how generous a given participant felt.
			const items = slide.pointsItems ?? [];
			const tallies = new Map(
				items.map((item, authoredIndex) => [
					item.id,
					{
						id: item.id,
						text: item.text,
						authoredIndex,
						points: 0,
						/** Ballots that gave this item at least one point. */
						funderCount: 0,
					},
				]),
			);

			// Allocations the tally could actually read. A row whose value no
			// longer decodes — its slide was re-authored under it, dropping an
			// item the allocation funded, so the remainder no longer sums to the
			// budget — is skipped rather than counted as a partial budget.
			let ballots = 0;
			for (const pointsVote of slideVotes) {
				const allocation = decodePoints(String(pointsVote.value ?? ""), items);
				if (!allocation) continue;
				ballots++;
				for (const [itemId, points] of Object.entries(allocation)) {
					if (points <= 0) continue;
					const tally = tallies.get(itemId);
					if (!tally) continue;
					tally.points += points;
					tally.funderCount++;
				}
			}

			const totalPoints = ballots * POINTS_BUDGET;

			// Most points first. Ties break on the broader backing (more people
			// funded it), then on the authored order, so the same votes always
			// render the same way.
			const ordered = [...tallies.values()].sort((left, right) => {
				if (right.points !== left.points) return right.points - left.points;
				if (right.funderCount !== left.funderCount) {
					return right.funderCount - left.funderCount;
				}
				return left.authoredIndex - right.authoredIndex;
			});

			return {
				type: "points",
				totalVotes: slideVotes.length,
				/** Allocations the tally read — the denominator for "not funded". */
				ballots,
				/** The budget each of those ballots spent, in full. */
				budget: POINTS_BUDGET,
				itemCount: items.length,
				/** Points actually distributed across the room. */
				totalPoints,
				items: ordered.map((tally, index) => ({
					id: tally.id,
					text: tally.text,
					/** 1-indexed place in the aggregated priority order. */
					rank: index + 1,
					points: tally.points,
					/** Share of everything the room distributed, as a percentage. */
					share: totalPoints
						? Math.round((tally.points / totalPoints) * 10000) / 100
						: 0,
					funderCount: tally.funderCount,
					notFunded: ballots - tally.funderCount,
					// Emit the key either way. The mean is taken over the
					// ballots that actually funded the item, which is a different
					// reading from `share` — that spreads the same points across
					// everyone. A niche item a handful of people bet heavily on
					// scores a low share and a high average; a bland one everybody
					// tips a few points to scores the reverse, and the trade-off the
					// slide exists to surface is the gap between them. An item
					// nobody funded has no such mean at all — an explicit `null`,
					// not a `0` that would read as a deliberate zero from everyone.
					averagePoints: tally.funderCount
						? Math.round((tally.points / tally.funderCount) * 100) / 100
						: null,
				})),
			};
		}

		case "guess-number": {
			// REQ039: the shape of the room's estimates. The distribution is the
			// point of the slide — a single average would hide the two things it
			// exists to show, whether the room clustered or split, and how far the
			// spread reaches — so the columns are the payload and the summary
			// statistics ride along beside them.
			const range = guessRangeFor(slide);
			const reference = guessReferenceFor(slide);
			const correctRange = correctGuessRangeFor(reference);
			const buckets = guessBucketsFor(range);
			const bucketCounts = buckets.map(() => 0);

			// Guesses the tally could actually read. A row whose value no longer
			// decodes — the organizer narrowed the range or coarsened the step
			// under it — is skipped rather than plotted off the end of the axis.
			const guesses: number[] = [];
			for (const guessVote of slideVotes) {
				const guess = decodeGuess(String(guessVote.value ?? ""), range);
				if (guess === null) continue;
				guesses.push(guess);
				const bucketIndex = buckets.findIndex(
					(bucket) => guess >= bucket.from && guess <= bucket.to,
				);
				if (bucketIndex >= 0) bucketCounts[bucketIndex]++;
			}

			const guessCount = guesses.length;
			const sorted = [...guesses].sort((left, right) => left - right);
			const middle = Math.floor(sorted.length / 2);
			// The median is reported beside the mean because a guessing room is
			// exactly where they disagree: one participant who reads the range as
			// "millions" drags the mean somewhere nobody guessed, while the median
			// still names where the room actually sat.
			const median = guessCount
				? sorted.length % 2 === 1
					? sorted[middle]
					: (sorted[middle - 1] + sorted[middle]) / 2
				: null;
			const total = guesses.reduce((sum, guess) => sum + guess, 0);

			const correctCount = correctRange
				? guesses.filter(
						(guess) => guess >= correctRange.min && guess <= correctRange.max,
					).length
				: null;

			return {
				type: "guess-number",
				totalVotes: slideVotes.length,
				/** Guesses the tally read — the denominator behind every share. */
				guessCount,
				/** The frame the columns and the input were built from (REQ040/043). */
				range,
				/** The distribution, in authored order; empty columns included. */
				buckets: buckets.map((bucket, bucketIndex) => ({
					from: bucket.from,
					to: bucket.to,
					count: bucketCounts[bucketIndex],
					share: guessCount
						? Math.round((bucketCounts[bucketIndex] / guessCount) * 10000) / 100
						: 0,
				})),
				// Emit every statistic's key. A slide nobody has guessed on
				// has no lowest, highest, mean or median guess at all — an explicit
				// `null`, not a `0` that would plot as an estimate somebody made.
				lowestGuess: guessCount ? sorted[0] : null,
				highestGuess: guessCount ? sorted[sorted.length - 1] : null,
				averageGuess: guessCount
					? Math.round((total / guessCount) * 100) / 100
					: null,
				medianGuess: median,
				/**
				 * REQ041/REQ042 — all four are `null` together when the author set no
				 * reference: the slide has no notion of correctness at all, which is a
				 * different statement from "nobody was right" and must stay
				 * distinguishable by consumers.
				 */
				reference: reference ? reference.value : null,
				tolerance: reference ? reference.tolerance : null,
				correctRange,
				correctCount,
				// A percentage of no responses does not exist, so it stays null until
				// somebody has guessed — the same reading `averagePoints` takes for an
				// item nobody funded.
				correctShare:
					correctCount !== null && guessCount
						? Math.round((correctCount / guessCount) * 10000) / 100
						: null,
			};
		}

		case "pin-image": {
			// REQ051: the room's pins on the image — the distribution *is* the
			// result here, so every readable pin travels in the payload and the
			// average rides along beside them. It is the opposite emphasis from a
			// scale, where the average is the answer: "where did the room point?"
			// is answered by a cluster, and a single mean coordinate of two
			// opposite hotspots names a spot nobody chose.
			//
			// REQ053: whether a pin landed in the target area is counted here, and
			// the area is only *reported* to a client that may see it — an editor
			// always, everyone else on the reveal the organizer's results-visibility
			// setting decides (`solutionVisibleToAudience`). The count and the share
			// are withheld together with the area, so a withheld target stays
			// indistinguishable from a question that never named one: a client told
			// "8 of 20 were inside" but not where would know both that a target
			// exists and how hard it is to hit.
			const image = pinImageFor(slide);
			const area = pinAreaFor(slide);
			const revealsArea =
				Boolean(opts.canEdit) ||
				solutionVisibleToAudience(slide, pres, Date.now());

			const pins: { x: number; y: number }[] = [];
			for (const pinVote of slideVotes) {
				const point = decodePinPoint(String(pinVote.value ?? ""));
				if (point) pins.push(point);
			}
			const pinCount = pins.length;
			const average = (values: number[]) =>
				Math.round((values.reduce((sum, one) => sum + one, 0) / pinCount) * 100) /
				100;
			const inArea = area
				? pins.filter((point) => isPinInArea(point, area)).length
				: null;
			const reportedArea = revealsArea ? area : null;
			const reportedInArea = revealsArea ? inArea : null;

			return {
				type: "pin-image",
				totalVotes: slideVotes.length,
				/** Pins the tally read — the denominator behind every share. */
				pinCount,
				/**
				 * The image the pins are positions on (REQ052), so a client draws the
				 * canvas from the tally it is holding rather than re-reading the slide.
				 * An empty `url` is a slide whose author has not supplied one yet —
				 * which is also a slide the boundary accepts no pins for.
				 */
				image: { url: image.url, alt: image.alt },
				/** Where the pins actually are, in submission order (REQ051). */
				pins,
				/**
				 * The centre of the cloud, to two decimals — or an explicit `null`
				 * before anyone has pinned, never a `0,0` that would draw
				 * a pin in the image's top-left corner that nobody placed.
				 */
				averageX: pinCount ? average(pins.map((point) => point.x)) : null,
				averageY: pinCount ? average(pins.map((point) => point.y)) : null,
				/**
				 * REQ053 — all three are `null` together, both when the author named
				 * no target area and while it is withheld from this caller. A slide
				 * with no notion of correctness and one whose reveal has not come look
				 * the same on purpose; the presenter's own payload carries both.
				 */
				correctArea: reportedArea,
				correctCount: reportedInArea,
				// A percentage of no responses does not exist, so it stays null until
				// somebody has pinned — the same reading `correctShare` takes on a
				// guess slide.
				correctShare:
					reportedInArea !== null && pinCount
						? Math.round((reportedInArea / pinCount) * 10000) / 100
						: null,
			};
		}

		case "grid": {
			// REQ046/REQ047: the average coordinate per item — the one thing a
			// 2x2 grid exists to produce — plus the individual placements behind
			// it, so the shared screen can draw the cluster and not just its
			// centre. Skips (REQ050) are counted, never averaged: "not
			// assessable" is an answer about the item, not a position on it.
			const items = slide.gridItems ?? [];
			const { xAxis, yAxis } = gridAxesFor(slide);
			const perItem = items.map((item) => {
				const itemVotes = slideVotes.filter(
					(itemVote) => itemVote.statementId === item.id,
				);
				const placements: { x: number; y: number }[] = [];
				let skipped = 0;
				for (const itemVote of itemVotes) {
					if (itemVote.skip) {
						skipped++;
						continue;
					}
					// A row the tally can no longer read — its slide was re-authored
					// under it, narrowing an axis past where the point sits — is
					// dropped rather than counted as a placement at the boundary.
					const point = decodeGridPoint(
						String(itemVote.value ?? ""),
						xAxis,
						yAxis,
					);
					if (point) placements.push(point);
				}
				const placed = placements.length;
				const average = (values: number[]) =>
					Math.round((values.reduce((sum, one) => sum + one, 0) / placed) * 100) /
					100;
				return {
					itemId: item.id,
					text: item.text,
					totalVotes: itemVotes.length,
					placed,
					skipped,
					// Emit both keys either way. An item nobody placed has
					// no coordinate at all — an explicit `null`, not a `0` that would
					// pin it to the bottom-left corner of the field.
					averageX: placed ? average(placements.map((point) => point.x)) : null,
					averageY: placed ? average(placements.map((point) => point.y)) : null,
					/** Every readable placement, for the cluster behind the average. */
					placements,
				};
			});

			return {
				type: "grid",
				totalVotes: slideVotes.length,
				itemCount: items.length,
				allowSkip: !!slide.gridAllowSkip,
				xAxis,
				yAxis,
				items: perItem,
			};
		}

		// ── Form (REQ061) ─────────────────────────────────────────
		//
		// The one interactive slide whose result is a **list of rows** rather than
		// a distribution, and the one whose rows must not be published to the room.
		//
		// A form collects what people wrote about themselves — REQ061 names an
		// email field among its three types — so the submissions are handed only to
		// a caller that can edit the deck (owner or edit token), exactly as a quiz
		// slide's answer key is (REQ056). This is a stronger gate than the deck's
		// reveal mode, deliberately: reveal mode is the organizer's choice about
		// their *numbers*, and a choice made about numbers must not be able to put
		// a stranger's address on a projector. The counts below stay public, so an
		// audience still sees the form filling up.
		case "form": {
			const fields = formFieldsFor(slide);
			const submissions: {
				answers: { fieldId: string; label: string; answer: string }[];
				/**
				 * Who filled this in, when the deck asked the room for names (REQ076),
				 * and an explicit `null` when it did not or when this row was cast
				 * before it started asking.
				 *
				 * Read only when the rows themselves are, which is the whole point of
				 * where it sits: the block is `null` for a caller who cannot edit the
				 * deck, so the name cannot travel without the row it labels — and the
				 * lookup is not even performed for such a caller.
				 */
				participantName: string | null;
				submittedAt: string;
			}[] = [];
			// One read per form slide and only for a caller who will be sent the rows.
			// A deck that never asked for names has an empty roster, so this is a
			// lookup that finds nothing rather than a branch on the switch — which
			// keeps "was this row cast before names were switched on?" and "does this
			// deck collect names?" the same answer here (`null`) instead of two.
			const nameByParticipant = opts.canEdit
				? await participantNameLookup(presentationId)
				: {};
			// Per-field: how many people answered it, and — for a choice field — how
			// the picks split, which is the one part of a form that really is a
			// distribution and the only part worth drawing on a shared screen.
			const answeredCounts = new Map(fields.map((field) => [field.id, 0]));
			const optionCounts = new Map<string, Map<string, number>>(
				fields.map((field) => [
					field.id,
					new Map(field.options.map((option) => [option.id, 0])),
				]),
			);

			for (const submissionVote of slideVotes) {
				// `readFormSubmission`, never `decodeFormSubmission`: a stored row is a
				// record of what somebody wrote under the slide as it stood *then*, and
				// re-judging it by today's rules is how ticking "Required" on a field
				// after the fact deletes every row that left it blank. What is dropped
				// here is only a row that was never a submission at all.
				const answers = readFormSubmission(
					String(submissionVote.value ?? ""),
					fields,
				);
				if (!answers) continue;
				for (const field of fields) {
					const answer = answers[field.id] ?? "";
					if (answer.length === 0) continue;
					answeredCounts.set(
						field.id,
						(answeredCounts.get(field.id) ?? 0) + 1,
					);
					const perOption = optionCounts.get(field.id);
					if (perOption && perOption.has(answer)) {
						perOption.set(answer, (perOption.get(answer) ?? 0) + 1);
					}
				}
				submissions.push({
					answers: fields
						.filter((field) => (answers[field.id] ?? "").length > 0)
						.map((field) => ({
							fieldId: field.id,
							label: field.label,
							// The stored answer, which for a choice field is an option id.
							// Spelled out into the option's text by the surfaces that draw
							// it (`describeFormSubmission`) rather than here, so one payload
							// carries what was stored and one function decides how it reads.
							answer: answers[field.id],
						})),
					participantName:
						nameByParticipant[String(submissionVote.participantId ?? "")] ?? null,
					submittedAt: String(submissionVote.createdAt ?? ""),
				});
			}

			return {
				type: "form",
				totalVotes: slideVotes.length,
				/** Rows the tally could read — the denominator behind every count. */
				submissionCount: submissions.length,
				fieldCount: fields.length,
				fields: fields.map((field) => ({
					fieldId: field.id,
					label: field.label,
					type: field.type,
					required: field.required,
					answered: answeredCounts.get(field.id) ?? 0,
					// The key is emitted for every field. A text or email
					// field has nothing to tally, so it carries an empty list rather
					// than the key going missing on some fields and not others.
					options: field.options.map((option) => ({
						optionId: option.id,
						text: option.text,
						count: optionCounts.get(field.id)?.get(option.id) ?? 0,
					})),
				})),
				// What the room actually wrote — for an editor only, and an explicit
				// `null` for everybody else, so "withheld" is a shape a
				// client can read rather than an empty list it would draw as "nobody
				// has answered".
				//
				// Nothing in this product *renders* it: every screen that draws a
				// tally is pointed at a room, and a list of names and addresses does
				// not belong on one (see `FormResults`). This is the credentialed read
				// an integrator makes, and it is what the spreadsheet export is built
				// from (REQ095) — which is where the organizer reads their form.
				submissions: opts.canEdit ? submissions : null,
			};
		}

		case "scale": {
			// REQ029/REQ030/REQ031: multi-statement aggregation when
			// `scaleStatements` is set. Otherwise fall back to single-statement.
			const statements = slide.scaleStatements ?? [];
			const emptyDist = () => {
				const d: Record<number, number> = {};
				for (let i = slide.scaleMin; i <= slide.scaleMax; i++) d[i] = 0;
				return d;
			};

			if (statements.length > 0) {
				const perStatement = statements.map((st) => {
					const stVotes = slideVotes.filter((v) => v.statementId === st.id);
					const answered = stVotes.filter((v) => !v.skip);
					const skipped = stVotes.length - answered.length;
					const values = answered.map((v) => Number(v.value));
					const avg = values.length
						? values.reduce((a, b) => a + b, 0) / values.length
						: 0;
					const dist = emptyDist();
					for (const val of values) {
						if (dist[val] !== undefined) dist[val]++;
					}
					return {
						statementId: st.id,
						text: st.text,
						totalVotes: stVotes.length,
						answered: answered.length,
						skipped,
						average: Math.round(avg * 100) / 100,
						distribution: dist,
					};
				});
				return {
					type: "scale",
					totalVotes: slideVotes.length,
					min: slide.scaleMin,
					max: slide.scaleMax,
					minLabel: slide.scaleMinLabel,
					maxLabel: slide.scaleMaxLabel,
					labels: slide.scaleLabels ?? [],
					allowSkip: !!slide.scaleAllowSkip,
					statements: perStatement,
				};
			}

			// Legacy single-statement scale
			const answered = slideVotes.filter((v) => !v.skip);
			const values = answered.map((v) => Number(v.value));
			const avg = values.length
				? values.reduce((a, b) => a + b, 0) / values.length
				: 0;
			const distribution = emptyDist();
			for (const val of values) {
				if (distribution[val] !== undefined) distribution[val]++;
			}
			return {
				type: "scale",
				totalVotes: slideVotes.length,
				average: Math.round(avg * 100) / 100,
				distribution,
				min: slide.scaleMin,
				max: slide.scaleMax,
				minLabel: slide.scaleMinLabel,
				maxLabel: slide.scaleMaxLabel,
				labels: slide.scaleLabels ?? [],
				allowSkip: !!slide.scaleAllowSkip,
				skipped: slideVotes.length - answered.length,
			};
		}

		default:
			return { type: slide.type, totalVotes: slideVotes.length };
	}
}

export async function getAllResults(
	presentationId: string,
	opts: ResultsCaller = {},
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const source = storedResultsSource(presentationId);
	const slides = pres.slides as Slide[];
	const results = await Promise.all(
		slides.map(async (slide) => ({
			slideId: slide.id,
			question: slide.question,
			...(await aggregateSlideResults(
				presentationId,
				pres,
				slide.id,
				source,
				opts,
			)),
		})),
	);
	return results;
}

// ── Segmented results (REQ020, REQ116) ───────────────────────
//
// One slide's tally, broken down by what the same participants answered on an
// earlier slide. The join — who is in which group — is `server/segmentation.ts`,
// which owns no rows and asks no store. What is left here is the composition,
// and it is deliberately the smallest thing that could work: each group is fed
// through **the same `aggregateSlideResults` an unsegmented read goes through**,
// over a source that hides everybody outside the group.
//
// That is the whole reason a segment cannot disagree with the bars above it. A
// second aggregation that filtered rows itself would have to re-derive every
// slide type's tally — the quiz's final-answer rule, the ranking's Borda
// scoring, the scale's per-statement skips — and would be wrong about one of
// them within a release (composed at the call site, not re-implemented
// at it). It is the same seam REQ104's preview run rides on, used the other way
// round: the preview swaps in rows that were never stored, this one swaps out
// rows that belong to other people.

/**
 * A source that reads each slide once, however many times it is asked.
 *
 * A breakdown runs the aggregation once per group, and every one of those runs
 * wants the same rows. Without this, a five-group breakdown of a slide is five
 * identical queries — and a five-group breakdown of a *leaderboard* slide is
 * five per quiz question in the deck (a factory over a closure, not a
 * class).
 */
function cachedResultsSource(source: ResultsSource): ResultsSource {
	const votesBySlide = new Map<string, Promise<Record<string, unknown>[]>>();
	const upvotesBySlide = new Map<string, Promise<Record<string, unknown>[]>>();
	const through = (
		cache: Map<string, Promise<Record<string, unknown>[]>>,
		slideId: string,
		read: () => Promise<Record<string, unknown>[]>,
	) => {
		const pending = cache.get(slideId) ?? read();
		cache.set(slideId, pending);
		return pending;
	};
	return {
		votesFor: (slideId) =>
			through(votesBySlide, slideId, () => source.votesFor(slideId)),
		responseVotesFor: (slideId) =>
			through(upvotesBySlide, slideId, () => source.responseVotesFor(slideId)),
	};
}

/**
 * The same rows, minus everyone outside this group.
 *
 * It filters **every** slide rather than only the one being broken down, which
 * is what makes a segmented leaderboard (REQ059) mean what it says: the
 * standings *among the people in this group*, scored from their own answers to
 * every quiz question in the deck. A wrapper that only masked the target slide
 * would draw the whole room's board under a group of four.
 *
 * A row with no participant id is in no group — it cannot be joined on, and
 * counting it everywhere would put one anonymous answer into every column.
 *
 * One consequence is worth stating rather than discovering: an open-ended
 * slide's upvote rows (REQ025) carry the **upvoter's** participant id, so inside
 * a group a response is credited only with the upvotes its own group cast. A
 * response showing `upvotes: 10` on the unsegmented tally can read `upvotes: 2`
 * inside the group that wrote it. That is the same sentence the rest of this
 * says — "as a room of exactly these people would have seen it" — and it is the
 * one number a segment can visibly differ from the chart above it on.
 */
function participantScopedSource(
	source: ResultsSource,
	participantIds: readonly string[],
): ResultsSource {
	const members = new Set(participantIds);
	const mine = (rows: Record<string, unknown>[]) =>
		rows.filter((row) => members.has(String(row.participantId ?? "")));
	return {
		votesFor: (slideId) => source.votesFor(slideId).then(mine),
		responseVotesFor: (slideId) => source.responseVotesFor(slideId).then(mine),
	};
}

/** One group of the room, and what it answered. */
export type ResultsSegment = {
	/** The option id this group answered on the grouping slide, or `null` for the ones who did not answer it. */
	key: string | null;
	label: string;
	/**
	 * How many people in this group answered the slide being broken down — or an
	 * explicit `null` where the group is suppressed.
	 *
	 * The count goes with the answers rather than surviving them. "Exactly one
	 * person picked Beta *and* answered this" is not a number about the room, it
	 * is a fact about that person; it is also the pointer that says which group is
	 * worth reconstructing. A suppressed group reports that it is suppressed and
	 * nothing else.
	 */
	respondentCount: number | null;
	/**
	 * This group's tally — the same shape the unsegmented endpoints publish — or
	 * an explicit `null` where it is suppressed, never an emptied one
	 * a client would draw as "nobody answered".
	 */
	results: Record<string, unknown> | null;
	/**
	 * Whether this group was held back (see {@link segmentDisclosure}). Emitted
	 * either way, so a reader can tell a suppressed group from an empty one.
	 *
	 * Not the same statement as "fewer than `minRespondents` answered": a group
	 * that clears the floor is held back too when it is the complement that keeps
	 * a smaller one from being recovered by subtraction.
	 */
	suppressed: boolean;
};

/** What a segmented read answers with, or the refusal that stopped it. */
export type SegmentedResults = {
	slideId: string;
	question: string;
	type: SlideType;
	/** The slide the room was grouped by. */
	segmentBy: { slideId: string; question: string; type: SlideType };
	/**
	 * `true` when the whole breakdown is kept from this caller, in which case
	 * `segments` is empty. Emitted as `false` on a published breakdown rather than
	 * left out, so the key a client tests is always there.
	 */
	withheld: boolean;
	/**
	 * Why, or an explicit `null` when it is not withheld — two very
	 * different pieces of news, and a surface that drew one sentence for both
	 * would be telling half its readers something untrue.
	 *
	 *  - `reveal-mode` — the organizer is keeping one of the two slides' results
	 *    back (REQ015–REQ017); a results link lifts it.
	 *  - `identifiable` — this slide's tally lists one entry per respondent, which
	 *    no group size makes anonymous (see {@link segmentedTallyIsAggregate}).
	 *    Only an editor reads it.
	 */
	withheldReason: "reveal-mode" | "identifiable" | null;
	/** The floor a group must clear to be published to a non-editor. */
	minRespondents: number;
	segments: ResultsSegment[];
};

/**
 * A refusal a segmented read can answer with, and the sentence that explains it.
 *
 * Shaped like {@link VoteRefusal} — a code the caller can branch on beside the
 * words a person reads — because it is the same kind of answer: the request was
 * understood and is not one this deck can be asked.
 */
export type SegmentedRefusal = { refused: SegmentRefusal; reason: string };

/** Whether a segmented read answered with a stated refusal rather than a breakdown. */
export function isSegmentRefusal(result: unknown): result is SegmentedRefusal {
	return (
		typeof result === "object" &&
		result !== null &&
		typeof (result as SegmentedRefusal).refused === "string"
	);
}

/**
 * Break one slide's tally down by an earlier slide's answers (REQ020).
 *
 * Returns `null` for a presentation or slide that does not exist, a
 * {@link SegmentedRefusal} for a pair this deck cannot be grouped by (the same
 * guard the picker's entries are drawn from), and the breakdown otherwise.
 *
 * **Both** reveal gates are checked, not just the target's. The groups are named
 * by the grouping slide's answers and counted by them, so publishing a breakdown
 * of a slide whose own tally the organizer is withholding (REQ016/REQ017) would
 * republish it sideways — "6 picked Marketing, 4 picked Sales" is that slide's
 * tally however it is labelled.
 *
 * What a caller who cannot edit the deck reads is then narrowed twice more, and
 * both narrowings are about the **set** of groups rather than any one of them:
 * a breakdown of a slide whose tally lists one entry per respondent is not
 * published at all ({@link segmentedTallyIsAggregate}), and which groups survive
 * is {@link segmentDisclosure}'s call, taken over every group at once so that no
 * held-back group can be recovered from the ones beside it.
 */
export async function getSegmentedResults(
	presentationId: string,
	slideId: string,
	sourceSlideId: string,
	opts: ResultsCaller = {},
): Promise<SegmentedResults | SegmentedRefusal | null> {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const slides = pres.slides as Slide[];
	const slide = slides.find((candidate) => candidate.id === slideId);
	const sourceSlide = slides.find(
		(candidate) => candidate.id === sourceSlideId,
	);
	if (!slide || !sourceSlide) return null;

	const refusal = segmentRefusalFor(slides, slideId, sourceSlideId);
	if (refusal) {
		return { refused: refusal, reason: SEGMENT_REFUSAL_REASONS[refusal] };
	}

	const segmentBy = {
		slideId: sourceSlide.id,
		question: sourceSlide.question,
		type: sourceSlide.type,
	};
	const head = {
		slideId: slide.id,
		question: slide.question,
		type: slide.type,
		minRespondents: SEGMENT_MIN_RESPONDENTS,
	};

	const revealState = pres as TallyRevealState;
	if (
		!tallyVisibleToCaller(slide, revealState, opts) ||
		!tallyVisibleToCaller(sourceSlide, revealState, opts)
	) {
		return withheldBreakdown("reveal-mode");
	}
	// A tally that lists one entry per respondent cannot be made anonymous by
	// grouping it, however many people a group holds: the entries are matchable
	// across two breakdowns of the same slide by different slides, and an
	// intersection of two large groups is one person. Only an editor reads one.
	if (!opts.canEdit && !segmentedTallyIsAggregate(slide)) {
		return withheldBreakdown("identifiable");
	}

	const source = cachedResultsSource(storedResultsSource(presentationId));
	const [targetVotes, sourceVotes] = await Promise.all([
		source.votesFor(slideId),
		source.votesFor(sourceSlideId),
	]);
	const buckets = segmentBucketsFor(
		sourceSlide,
		sourceVotes,
		participantIdsIn(targetVotes),
	);

	/** How many people in one group answered the slide being broken down. */
	const respondentsIn = (bucket: SegmentBucket): number => {
		const members = new Set(bucket.participantIds);
		return participantIdsIn(
			targetVotes.filter((row) => members.has(String(row.participantId ?? ""))),
		).length;
	};

	// Counted first, every group of them, because which groups may be published is
	// a decision about the whole set: hold one back on its own and it is the
	// difference between the tally above and the groups beside it.
	const respondentCounts = buckets.map(respondentsIn);
	const disclosure = segmentDisclosure(respondentCounts, opts);

	/** One group: how many of it answered, and — where that may be published — what it answered. */
	const segmentOf = async (
		bucket: SegmentBucket,
		index: number,
	): Promise<ResultsSegment> => {
		if (!disclosure[index]) {
			return {
				key: bucket.key,
				label: bucket.label,
				respondentCount: null,
				results: null,
				suppressed: true,
			};
		}
		const results = await aggregateSlideResults(
			presentationId,
			pres,
			slideId,
			participantScopedSource(source, bucket.participantIds),
			opts,
		);
		return {
			key: bucket.key,
			label: bucket.label,
			respondentCount: respondentCounts[index],
			// `aggregateSlideResults` answers `null` only for a slide that is not in
			// the deck, which this one demonstrably is.
			results: (results ?? null) as Record<string, unknown> | null,
			suppressed: false,
		};
	};

	return {
		...head,
		segmentBy,
		withheld: false,
		withheldReason: null,
		segments: await Promise.all(buckets.map(segmentOf)),
	};

	/** The whole breakdown kept back, saying which of the two reasons it was. */
	function withheldBreakdown(
		reason: "reveal-mode" | "identifiable",
	): SegmentedResults {
		return {
			...head,
			segmentBy,
			withheld: true,
			withheldReason: reason,
			segments: [],
		};
	}
}

// ── Spreadsheet export (REQ095) ──────────────────────────────

/**
 * Gather everything one spreadsheet export reads (REQ095) — and nothing more.
 *
 * The layout lives in `server/results-export.ts`, which has no store of its own;
 * this is the one place the rows come from. The aggregates are read through
 * {@link getAllResults} rather than recomputed, so the numbers in a downloaded
 * file are the numbers the shared screen drew, and `canEdit` is fixed to `true`
 * because the export is authorized as an edit (owner or edit token): a quiz
 * answer key withheld from a running room (REQ056) is exactly what a
 * post-session analysis needs, and the caller has already proved they authored
 * it.
 *
 * Returns `null` for a presentation that does not exist, like every other read
 * here.
 */
export async function getResultsExport(
	presentationId: string,
	options: { exportedAt: string },
): Promise<ResultsExportInput | null> {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const results = await getAllResults(presentationId, { canEdit: true });
	if (!results) return null;

	const [exportVotes, exportResponseVotes, exportNames] = await Promise.all([
		votes.find({ presentationId }),
		responseVotes.find({ presentationId }),
		// REQ076 — the names the room stated, as the lookup both exports read them
		// through. Fetched unconditionally rather than behind the deck's switch: a
		// deck whose organizer turned names *off* after a session still holds the
		// ones it collected, and an export that dropped them would be a record of
		// the session that is missing what the session recorded.
		participantNameLookup(presentationId),
	]);

	return {
		// Parsed through the public schema for the same two reasons `sanitize`
		// does it: every declared field is present even on a
		// document persisted before it existed, and `creatorTokenHash` /
		// `creatorId` are dropped by construction rather than by a list somebody
		// has to remember to keep in step. A spreadsheet is a file that leaves the
		// building; the secret hash must not be able to travel in it.
		presentation: PresentationSchema.parse(pres),
		votes: exportVotes as unknown as StoredVote[],
		responseVotes: exportResponseVotes as unknown as StoredResponseVote[],
		participantNames: exportNames,
		results,
		exportedAt: options.exportedAt,
	};
}

// ── Preview & test votes (REQ103, REQ104) ────────────────────
//
// A preview is a dry run: the organizer walks their own deck through both
// perspectives — the shared screen and a participant's phone — before a room
// ever sees it, and populates it with test votes so the charts on screen are the
// charts the room will produce (REQ104) rather than empty frames.
//
// **Nothing about it is written.** Not the votes, and not the deck state either.
// Two decisions carry that:
//
//  - The rows come from `server/preview.ts`, which returns them and has no store
//    to put them in, and they are read back through an in-memory
//    {@link ResultsSource}. The aggregation only reads, so there is no path from
//    a test vote to the `votes` collection to disable — the code that would do it
//    does not exist.
//  - The deck the tally is computed against is **built here and discarded here**
//    (`previewDeck` below). A preview needs a deck that is live and whose
//    questions have opened — otherwise a quiz has no window and every chart is a
//    "start the presentation to collect responses" placeholder — and taking that
//    by actually starting the deck would end the dry run by beginning the
//    session. So the preview state is a plain object the store never sees: the
//    real deck stays in `draft`, its `slideStartedAt` stays empty, and the room
//    that never came still has nothing to answer.

/**
 * The deck a preview run is computed against: the authored deck, as if it were
 * live and every question had just opened.
 *
 * Only the three runtime fields move, and each for a stated reason: `status`,
 * because a tally on a draft deck reads as "not collecting yet"; `slideStartedAt`,
 * because a quiz question with no opening instant has no window and so no speed
 * to score (REQ057); and `revealedSlideIds`, which is left exactly as authored —
 * an organizer previewing an `on-click` slide should meet the reveal step, since
 * validating the flow is half of what REQ103 asks for.
 */
function previewDeck(
	pres: Record<string, unknown>,
	startedAt: string,
): Record<string, unknown> {
	const stamps: Record<string, string> = {};
	for (const slide of pres.slides as Slide[]) stamps[slide.id] = startedAt;
	return {
		...pres,
		status: "live",
		slideStartedAt: stamps,
	};
}

/** What one preview run asks for; every field has a documented default. */
export type PreviewOptions = {
	/** Synthetic respondents to simulate (REQ104); `0` previews empty slides. */
	respondents?: number;
	/** Which run to reproduce — the same seed yields the same room. */
	seed?: number;
	/** When this run's questions opened, ISO; defaults to now. */
	startedAt?: string;
};

/**
 * A dry run of a whole deck (REQ103) populated with test votes (REQ104).
 *
 * Every slide comes back **twice**, and that is the point rather than a
 * convenience: a preview shows the organizer both perspectives, and on a quiz
 * question those two are genuinely different payloads. The shared screen carries
 * the marked solution because the presenter authored it; a participant's phone
 * does not, until the question is over (REQ056). A preview that handed the
 * participant pane the presenter's payload would be showing the organizer a
 * participant view that no participant will ever get — which is the one thing
 * REQ103 exists to prevent.
 *
 * Slides that collect nothing are listed too, with whatever aggregate they have
 * (a leaderboard's standings) or none at all (a content slide), so the caller
 * walks the deck as authored rather than a filtered subset of it.
 */
export async function getPreviewResults(
	presentationId: string,
	options: PreviewOptions = {},
) {
	const pres = await presentations.findOne(presentationId);
	if (!pres) return null;

	const respondents = Math.max(0, Math.trunc(options.respondents ?? PREVIEW_DEFAULT_RESPONDENTS));
	const seed = Math.max(0, Math.trunc(options.seed ?? 1));
	// A supplied instant is what lets the preview surface poll — for a running
	// countdown, and for the reveal that follows it — without every refresh
	// restarting the question it is refreshing. An unparseable one reads as now
	// rather than as a window in 1970 that closed before it opened.
	const suppliedStart = options.startedAt
		? Date.parse(options.startedAt)
		: Number.NaN;
	const startedAt = Number.isNaN(suppliedStart)
		? new Date().toISOString()
		: new Date(suppliedStart).toISOString();

	const slides = pres.slides as Slide[];
	const deck = previewDeck(pres, startedAt);
	const testVotes =
		respondents > 0
			? generateDeckTestVotes(slides, {
					presentationId,
					respondents,
					seed,
					startedAt,
				})
			: emptyTestVoteSet();
	const source = testVoteResultsSource(testVotes);

	const previewed = await Promise.all(
		slides.map(async (slide) => ({
			slideId: slide.id,
			question: slide.question,
			type: slide.type,
			/** The tally as the shared screen reads it — solutions included. */
			presenterResults: await aggregateSlideResults(
				presentationId,
				deck,
				slide.id,
				source,
				{ canEdit: true },
			),
			/** The same tally as a participant's phone reads it (REQ056). */
			audienceResults: await aggregateSlideResults(
				presentationId,
				deck,
				slide.id,
				source,
				{ canEdit: false },
			),
		})),
	);

	return {
		presentationId,
		/** Echoed back so a client can poll the identical run (see above). */
		respondents,
		seed,
		startedAt,
		/** How many rows the run generated — nothing to do with what is stored. */
		testVoteCount: testVotes.votes.length,
		slides: previewed,
	};
}
