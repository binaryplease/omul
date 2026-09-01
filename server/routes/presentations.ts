import { Elysia } from "elysia";
import { z } from "zod";
import {
	findUserByEmail,
	findUserById,
	isApiKeyRequest,
	resolveUserId,
} from "../accounts";
import {
	guardCreate,
	guardJoin,
	guardReaction,
	guardSubmission,
} from "../rate-limit";
import {
	buildDeckDocument,
	deckPdfFilename,
	PDF_CONTENT_TYPE,
	renderDeckDocument,
} from "../deck-pdf";
import {
	buildResultsWorkbook,
	renderResultsWorkbook,
	resultsExportFilename,
	XLSX_CONTENT_TYPE,
} from "../results-export";
import {
	canAdministerWorkspace,
	canAdministerWorkspaceDecks,
	canCreateWorkspaceDecks,
	canMutateDeck,
	canReadDeckAuthoring,
	canReadDeckComments,
	canWriteDeckComments,
	ChatMessageSchema,
	CreatePresentationSchema,
	type DeckCollaborator,
	DeckAccessLevelBodySchema,
	DeckCollaboratorSchema,
	DeckPdfQuerySchema,
	DeckWorkspaceSchema,
	ParticipantChannelsSchema,
	ParticipantNameSchema,
	PostSlideCommentSchema,
	PresentationSchema,
	PreviewQuerySchema,
	QAAnsweredSchema,
	QAQuestionSchema,
	QASettingsSchema,
	QAUpvoteSchema,
	ReactionSchema,
	type ResultsCaller,
	ResponseVoteSchema,
	ResultsVisibilityEnum,
	SegmentQuerySchema,
	ShareDeckSchema,
	type SlideComment,
	SlideCommentSchema,
	type Slide,
	UpdatePresentationSchema,
	VoteSchema,
	withAudienceSlides,
} from "../schemas";
import {
	type DeckCollaboratorRecord,
	grantDeckAccess,
	listDeckCollaborators,
	revokeCollaborator,
	setCollaboratorLevel,
} from "../services/collaborators";
import { workspaceRoleFor } from "../services/workspaces";
import {
	addSlideComment,
	deleteSlideComment,
	listDeckComments,
	type SlideCommentRecord,
} from "../services/slide-comments";
import {
	authorizeEdit,
	authorizeResultsLink,
	claimOwnership,
	createPresentation,
	deletePresentation,
	deleteSubmittedAnswer,
	endPresentation,
	getAllResults,
	getChat,
	getParticipantRoster,
	getParticipantScorecard,
	getPresentation,
	getPresentationByCode,
	getPreviewResults,
	getQAList,
	getResultsExport,
	getSegmentedResults,
	getSlideResults,
	isAnswerDeletionRefusal,
	isSegmentRefusal,
	isVoteRefusal,
	listPresentations,
	listPresentationsSharedWith,
	mintResultsLink,
	postChatMessage,
	resetPresentation,
	resolveDeckAccess,
	resolveDeckAccountAccess,
	restartSlideTimer,
	resultsLinkStatus,
	revokeResultsLink,
	sendReaction,
	setActiveSlide,
	setAudienceBlanked,
	setDeckResultsVisibility,
	setPresentationWorkspace,
	setParticipantChannels,
	setQASettings,
	setQuestionAnswered,
	setSlideParticipation,
	setSlideRevealed,
	startPresentation,
	stateParticipantName,
	submitQuestion,
	submitVote,
	updatePresentation,
	upvoteQuestion,
	type VoteRefusal,
	voteOnResponse,
} from "../services/presentations";
import { copyTemplateSlides, findDeckTemplate } from "../templates";
import { getParticipantCount } from "../ws";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Project a stored presentation into its public response shape.
 *
 * Parsing through `PresentationSchema` does double duty (ADR-0024 / ADR-0029):
 *   - It populates every declared key with its default, so the output shape is
 *     complete and stable record-to-record even for legacy documents that were
 *     persisted before a field existed.
 *   - It drops internal-only keys (`creatorTokenHash`, `creatorToken`,
 *     `creatorId`) because Zod strips properties the schema does not declare —
 *     so the secret hash can never leak, by construction rather than by an
 *     easy-to-forget destructuring list.
 *
 * `creatorToken` is re-attached only when `includeToken` is true (the creation
 * response), since it is intentionally not part of the persisted schema.
 *
 * The marked solutions on quiz slides are withheld unless the caller can edit
 * the deck (`canEdit`), and the presenter's notes (REQ090) are emptied on the
 * same terms — see {@link withAudienceSlides}. The default is the withholding
 * one, so a route that forgets to say who is asking leaks nothing.
 *
 * Exported because a deck is created on one route outside this file — the
 * generation route (REQ007) — and there must be exactly one projection of a
 * stored presentation into a response (ADR-0026). A second one is how the
 * hash stays stripped on one create path and not on the other.
 */
export function sanitize(
	pres: Record<string, unknown>,
	{ includeToken = false, canEdit = false } = {},
): Record<string, unknown> {
	const clean = PresentationSchema.parse(pres);
	const projected = canEdit
		? clean
		: {
				...clean,
				slides: withAudienceSlides(clean.slides, clean, Date.now()),
			};
	if (includeToken) {
		// Emit the edit token explicitly on the creation response — a plaintext
		// string when one was minted (anonymous / cookie-session create), or `null`
		// for an API-key create that is already owner-editable via the key.
		return {
			...projected,
			creatorToken:
				typeof pres.creatorToken === "string" ? pres.creatorToken : null,
		};
	}
	return projected;
}

/**
 * Whether a request may see what it authored rather than what the room sees:
 * the deck's owner, the holder of its edit token, or an account the owner has
 * shared it with at any level (REQ075).
 *
 * A collaborator at `view` reads the deck exactly as its owner does, and that is
 * the intended reading of the three levels: what a level governs is what its
 * holder may **change**, not a redacted copy of the deck they were deliberately
 * invited to. The mutation gate is {@link requireEdit}, and it is a different
 * question asked of the same resolved level.
 *
 * Legacy grandfathering is deliberately **off** here (`allowLegacy: false`).
 * A pre-auth deck has no owner and no token hash, so grandfathering would make
 * every anonymous participant on it an "editor" and hand them the answer key —
 * exactly the wrong way for this decision to fail.
 */
async function canEditDeck(
	pres: Record<string, unknown>,
	request: Request,
): Promise<boolean> {
	const access = await resolveDeckAccess(pres, request.headers, false);
	return canReadDeckAuthoring(access.level);
}

/**
 * Project one stored grant into the shape its deck's owner reads (REQ075).
 *
 * The account id the grant is stored under is turned back into the contact the
 * owner invited — and goes no further: the response is built key by key and
 * parsed through {@link DeckCollaboratorSchema}, which does not declare
 * `userId`, so an account identifier cannot reach a client by being spread into
 * an object here any more than `creatorId` can (see {@link sanitize}). An
 * account that has since been deleted reads as an empty email rather than
 * vanishing from the list, so the owner can still see — and revoke — the grant.
 */
function readCollaborator(grant: DeckCollaboratorRecord): DeckCollaborator {
	const account = findUserById(grant.userId);
	return DeckCollaboratorSchema.parse({
		id: grant.id,
		email: account?.email ?? "",
		name: account?.name ?? null,
		level: grant.level,
		createdAt: grant.createdAt,
		updatedAt: grant.updatedAt,
	});
}

/** What a stated vote refusal reads as over the wire (see `VoteRefusal`). */
const VOTE_REFUSAL_MESSAGE: Record<VoteRefusal["refused"], string> = {
	"quiz-window-closed": "The time for this quiz question is over",
	"quiz-already-answered": "Your answer to this quiz question is final",
	"participation-closed": "The presenter has closed this slide to submissions",
};

/** A JSON error Response with the given status. */
function jsonError(status: number, error: string): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * What this request may read of a deck's results — the one place the two
 * credentials a results read can carry are resolved (REQ098).
 *
 * A results token that rides the request and does **not** match is a refusal
 * rather than a silent fall-back to the public read. A revoked link would
 * otherwise answer with a deck of withheld markers, which is exactly what a
 * `private` deck answers to a stranger: the holder could not tell "the organizer
 * took my link away" from "there was never anything here", and would have no
 * reason to go ask for a new one. It is only a refusal when the caller has
 * nothing else — an organizer whose browser still holds the token they revoked
 * five seconds ago is still the organizer, and reads their own deck.
 */
async function resultsCallerFor(
	pres: Record<string, unknown>,
	request: Request,
): Promise<ResultsCaller | Response> {
	const canEdit = await canEditDeck(pres, request);
	const link = authorizeResultsLink(pres, request.headers);
	if (link.presented && !link.valid && !canEdit) {
		return jsonError(401, "This results link is no longer valid");
	}
	return { canEdit, hasResultsLink: link.valid };
}

// ── Authorization for mutation routes ───────────────────────
//
// A mutation is authorized when the caller is the presentation's **owner** (a
// cookie session or personal API key resolving to `creatorId`), holds its **edit
// token** (`Authorization: Bearer` / `X-Omul-Edit-Token`), or is an account the
// owner has **shared the deck with at `edit`** (REQ075). That is the
// owner-or-edit-token model, widened by the collaborator grant; legacy pre-auth
// decks are grandfathered.
//
// Returns the fetched presentation on success, or a Response: `401` when the
// caller presents no valid credential, `403` when signed in but without a level
// that authorizes this mutation. A missing presentation is reported as `401` (not
// `404`) to preserve the pre-existing contract and avoid leaking existence. So a
// `view` or `comment` collaborator — signed in, with real standing, and without
// the level this route needs — is refused with the same `403` a stranger's
// account gets, which is the whole of "enforced on every mutation, not only in
// the UI".
async function requireEdit(
	request: Request,
	id: string,
	{ allowCollaborators = true }: { allowCollaborators?: boolean } = {},
): Promise<Record<string, unknown> | Response> {
	const pres = await getPresentation(id);
	if (!pres) return jsonError(401, "Unauthorized");
	const access = await resolveDeckAccess(pres, request.headers);
	// `allowCollaborators: false` is for the mutations that stay with the deck
	// itself rather than with its contents — deleting it. An `edit` grant says
	// "help me build this deck", and reading it as "and you may destroy it" is
	// the wrong way for that sentence to fail.
	//
	// A **delegated** standing is what that excludes, and a workspace membership
	// is one (REQ129): every member may run the workspace's decks, and destroying
	// one is the act the workspace keeps to the roles that could have deleted the
	// workspace itself. Which is also why this is not simply "not delegated" — a
	// workspace deck has no account owner to fall back on, so refusing every role
	// would leave a deck nobody at all could delete.
	const undelegated = !access.viaGrant && !access.viaWorkspace;
	const authorized =
		canMutateDeck(access.level) &&
		(allowCollaborators ||
			undelegated ||
			canAdministerWorkspaceDecks(access.workspaceRole));
	if (!authorized) {
		return access.userId
			? jsonError(403, "Forbidden")
			: jsonError(401, "Unauthorized");
	}
	return pres;
}

/**
 * Require that the caller **owns** the deck — the gate on managing who else it
 * is shared with (REQ075). Returns the fetched presentation, or a Response.
 *
 * Deliberately narrower than {@link requireEdit} on two counts, and both are
 * the failing-safe reading:
 *
 *  - The **edit token opens nothing here.** It is an anonymous, forwardable
 *    capability with no account behind it, so a holder granting standing to
 *    arbitrary accounts would be an escalation nobody could be held to — and it
 *    would survive the owner rotating nothing, since there is nothing to rotate.
 *  - A **collaborator cannot re-share**, whatever their level. Sharing is the
 *    owner deciding who is on their deck; an `edit` grant is help with the deck,
 *    not the authority to widen who has it.
 *
 * `401` when there is no account behind the request at all, `403` when there is
 * one and it is not the owner's — including on an **ownerless** deck, which has
 * no owner to be: such a deck is claimed first (`POST …/claim`) and shared after.
 *
 * A deck a **workspace** owns has no account owner either, and there that is the
 * design rather than a gap to be claimed (REQ128) — so the question becomes who
 * speaks for the workspace, and the answer is a role rather than an account:
 * `canAdministerWorkspaceDecks`, the same one that may delete the deck. Without
 * it a workspace deck would have no sharing surface at all, which is coexistence
 * with REQ075 failing shut rather than the two models standing beside each other.
 * Every other member is refused here exactly as an `edit` collaborator is:
 * helping with a deck is not deciding who else gets it.
 */
async function requireDeckOwner(
	request: Request,
	id: string,
): Promise<Record<string, unknown> | Response> {
	const pres = await getPresentation(id);
	if (!pres) return jsonError(401, "Unauthorized");
	const userId = await resolveUserId(request.headers);
	if (!userId) {
		return jsonError(401, "Sign in to manage who this deck is shared with");
	}
	const workspaceId = (pres.workspaceId as string | null) ?? null;
	if (workspaceId) {
		const role = await workspaceRoleFor(workspaceId, userId);
		if (!canAdministerWorkspaceDecks(role)) {
			return jsonError(
				403,
				"Only a workspace admin can decide who this deck is shared with",
			);
		}
		return pres;
	}
	const ownerId = (pres.creatorId as string | null) ?? null;
	if (!ownerId || ownerId !== userId) {
		return jsonError(403, "Only the deck's owner can share it");
	}
	return pres;
}

/**
 * Require that the caller's **account** has standing on the deck, at a level
 * that authorizes what they came to do with its comment threads (REQ074).
 *
 * The gate is `resolveDeckAccountAccess`, so neither the edit token nor a
 * grandfathered pre-auth deck resolves here — see that function for why a
 * forwardable capability with no account behind it must not reach a
 * conversation between accounts. Which predicate decides is the caller's:
 * {@link canReadDeckComments} for a read, {@link canWriteDeckComments} for a
 * write, both read off the one resolved level rather than re-derived by
 * comparing level strings.
 *
 * `401` when there is no account behind the request at all — which is every
 * participant, every stranger and every anonymous caller — and `403` when there
 * is one whose level does not open this door: a `view` collaborator posting a
 * comment, or an account with no grant at all. A missing deck is `401` for the
 * reason {@link requireEdit} gives: it leaks no existence.
 *
 * Hands back the fetched deck (a comment is anchored to one of its slides, and
 * the route has to check that) with the resolved account id beside it.
 */
async function requireDeckComments(
	request: Request,
	id: string,
	{ write }: { write: boolean },
): Promise<{ pres: Record<string, unknown>; userId: string } | Response> {
	const pres = await getPresentation(id);
	if (!pres) return jsonError(401, "Unauthorized");
	const access = await resolveDeckAccountAccess(pres, request.headers);
	if (!access.userId) {
		return jsonError(401, "Sign in to read this deck's comments");
	}
	const authorized = write
		? canWriteDeckComments(access.level)
		: canReadDeckComments(access.level);
	if (!authorized) {
		return jsonError(
			403,
			write
				? "You need comment access on this deck to write on it"
				: "This deck has not been shared with your account",
		);
	}
	return { pres, userId: access.userId };
}

/**
 * Project one stored comment into the shape the accounts on the deck read
 * (REQ074).
 *
 * The author id it is stored under is turned into a display name and goes no
 * further: the response is built key by key and parsed through
 * {@link SlideCommentSchema}, which declares neither `authorId` nor
 * `presentationId`, so an account identifier cannot reach a client by being
 * spread into an object here any more than `creatorId` can (see
 * {@link sanitize}). An account that has since been deleted reads as a `null`
 * name rather than dropping its comment out of the thread, which would leave a
 * reply answering nothing.
 *
 * `mine` is decided here, from the account this request resolved to — never from
 * anything the client sent, and never trusted by the delete route, which asks
 * the same question again of the row itself.
 */
function readSlideComment(
	comment: SlideCommentRecord,
	viewerId: string,
): SlideComment {
	const account = findUserById(comment.authorId);
	return SlideCommentSchema.parse({
		id: comment.id,
		slideId: comment.slideId,
		body: comment.body,
		authorName: account?.name ?? null,
		mine: comment.authorId === viewerId,
		createdAt: comment.createdAt,
	});
}

// ── Routes ──────────────────────────────────────────────────

export const presentationRoutes = new Elysia({ prefix: "/api" })
	// ── List presentations ──────────────────────────────────
	.get(
		"/presentations",
		async ({ query }) => {
			const results = await listPresentations(query.creatorId);
			return results.map((p) => sanitize(p));
		},
		{
			query: z.object({
				creatorId: z.string().optional(),
			}),
			detail: {
				tags: ["Presentations"],
				summary: "List presentations",
				description:
					"Returns presentations visible to the caller. When `creatorId` is provided, results are filtered to that creator. Internal fields (`creatorTokenHash`, `creatorToken`) are stripped from every entry, and every slide is projected as an audience sees it — withheld quiz answer keys (REQ056) and empty presenter notes (REQ090).",
			},
		},
	)

	// ── Create presentation ────────────────────────────────
	.post(
		"/presentations",
		async ({ body, request, server, set }) => {
			// Rate-limited before anything is written: this is the disk-fill path
			// (REQ145). A create that names a template spends the same budget — it
			// writes the same deck, and the slides being free to the caller is
			// exactly why it must not be cheaper.
			const overLimit = guardCreate({ request, server });
			if (overLimit) return overLimit;
			// REQ005/REQ006 — a create that names a catalog entry takes its slides
			// from there instead of from the body, as **copies**: `copyTemplateSlides`
			// re-identifies every one of them, and nothing about the new deck records
			// where they came from, so it is detached from the template from the
			// moment it exists. An id nothing is filed under is refused rather than
			// quietly producing an empty deck.
			const requestedTemplateId = body.templateId.trim();
			const template = requestedTemplateId
				? findDeckTemplate(requestedTemplateId)
				: null;
			if (requestedTemplateId && !template) {
				set.status = 400;
				return { error: "No such template" };
			}
			// A template create may leave both out and take them from the entry; the
			// body schema's refinement is what guarantees they are present otherwise.
			const slides = template ? copyTemplateSlides(template) : body.slides;
			const title = body.title.trim() || (template?.title ?? "");
			// Record the owner when the create is authenticated (cookie session or
			// personal API key). An API-key create is already owner-editable via that
			// key, so it is NOT minted a redundant edit token; anonymous and
			// cookie-session creates still get one.
			const userId = await resolveUserId(request.headers);
			const viaApiKey = isApiKeyRequest(request.headers) && Boolean(userId);
			// REQ128/REQ129 — a create that names a workspace makes a deck the
			// *workspace* owns, and the claim that the caller may do that is checked
			// here, before anything is written. A workspace they are not in and one
			// that does not exist answer the same `403`, deliberately: the difference
			// is exactly the existence oracle the sharing endpoint next door is rate
			// limited to blunt, and here there is nothing to gain by admitting it.
			const requestedWorkspaceId = body.workspaceId.trim();
			if (requestedWorkspaceId) {
				const role = userId
					? await workspaceRoleFor(requestedWorkspaceId, userId)
					: null;
				if (!canCreateWorkspaceDecks(role)) {
					set.status = userId ? 403 : 401;
					return {
						error: userId
							? "You cannot create decks in that workspace"
							: "Sign in to create a deck in a workspace",
					};
				}
			}
			const presentation = await createPresentation(
				title,
				slides,
				{
					language: body.language,
					mode: body.mode,
					resultsVisibility: body.resultsVisibility,
					qaEnabled: body.qaEnabled,
					qaVisibility: body.qaVisibility,
					reactionsEnabled: body.reactionsEnabled,
					chatEnabled: body.chatEnabled,
					requireParticipantName: body.requireParticipantName,
					theme: body.theme,
					themeBrand: body.themeBrand,
					themeLogoUrl: body.themeLogoUrl,
					themeLogoAlt: body.themeLogoAlt,
				},
				{
					creatorId: userId,
					mintToken: !viaApiKey,
					workspaceId: requestedWorkspaceId || null,
				},
			);
			set.status = 201;
			return sanitize(presentation, { includeToken: true, canEdit: true });
		},
		{
			body: CreatePresentationSchema,
			detail: {
				tags: ["Presentations"],
				summary: "Create presentation",
				description:
					"Creates a new presentation in `draft` status. Pass `templateId` (an id from `GET /api/templates`) to start from a catalog entry (REQ005/REQ006): the deck's slides are **copies** of that template's under fresh ids, fully editable and detached from it — nothing records the origin, so editing the deck cannot reach the template and two decks made from one entry cannot reach each other. A template create may omit `title` (it inherits the template's) and `slides` (they come from the template); every other create still requires a non-empty title and at least one slide. An unknown `templateId` is a 400. The deck's own settings — language, pace, reveal mode, the Q&A layer, the participant channels, the theme — are always the request's, never the template's: a template holds slides, not a room's settings. When the request is anonymous or carries a cookie session, the response includes a one-time `creatorToken` that authorizes subsequent mutations and is never returned again. When authenticated with a personal API key (`x-api-key`), the deck is owned by that account and editable via the key, so `creatorToken` is `null`. A signed-in create also records the account as the deck's owner. Pass `workspaceId` to create a deck the **workspace** owns instead (REQ128): the deck records no account owner and is minted no edit token — its standing is the workspace's roster, and every member reads, edits and presents it — so `creatorToken` is `null` and the deck appears in `GET /api/workspaces/:id/presentations` rather than in `/presentations/mine`. The caller must be a member with a role that may create decks there (REQ129); a workspace they are not in and one that does not exist answer the same `403`. Rate-limited per client address (REQ145): over the limit answers `429` with a `Retry-After` header and `retryAfterSeconds` in the body.",
			},
		},
	)

	// ── List my presentations (owner-scoped) ───────────────
	// Registered before `/presentations/:id` so the static path wins the match.
	.get(
		"/presentations/mine",
		async ({ request, set }) => {
			const userId = await resolveUserId(request.headers);
			if (!userId) {
				set.status = 401;
				return { error: "Sign in to list your presentations" };
			}
			const results = await listPresentations(userId);
			// The caller owns every deck in this list, so it is their own authoring
			// that comes back — solutions included.
			return results.map((p) => sanitize(p, { canEdit: true }));
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "List the signed-in account's presentations",
				description:
					"Returns presentations owned by the caller (newest first). Requires a cookie session or a personal API key (`x-api-key`); returns 401 otherwise. Scoped to the caller — it cannot enumerate other accounts' decks.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── List decks shared with me (collaborator-scoped) ────
	// Registered before `/presentations/:id` so the static path wins the match,
	// for the same reason `/presentations/mine` above is.
	.get(
		"/presentations/shared",
		async ({ request, set }) => {
			const userId = await resolveUserId(request.headers);
			if (!userId) {
				set.status = 401;
				return { error: "Sign in to list the decks shared with you" };
			}
			const shared = await listPresentationsSharedWith(userId);
			// A collaborator reads the deck as its author wrote it whatever their
			// level (REQ075) — the level governs what they may change, and this
			// route changes nothing. `accessLevel` rides each entry so the surface
			// drawing the list can say what the caller may do with each deck without
			// asking again per card.
			return shared.map(({ pres, level }) => ({
				...sanitize(pres, { canEdit: true }),
				accessLevel: level,
			}));
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "List the decks shared with the signed-in account",
				description:
					"Returns the decks another account has shared with the caller (REQ075), newest grant first, each carrying the `accessLevel` it was shared at — `view`, `comment` or `edit`. Requires a cookie session or a personal API key (`x-api-key`); returns 401 otherwise. Scoped to the caller — it cannot enumerate anyone else's grants, and it never reports who else a deck is shared with (that list is its owner's, see `GET /presentations/:id/collaborators`). Decks the caller **owns** are not here; they are `GET /presentations/mine`. A grant whose deck has been deleted is simply absent.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Get presentation by ID ─────────────────────────────
	.get(
		"/presentations/:id",
		async ({ params, request, set }) => {
			const pres = await getPresentation(params.id);
			if (!pres) {
				set.status = 404;
				return { error: "Not found" };
			}
			// The editor and the presenter reach a deck through this route and need
			// the solutions they authored; anyone else gets the audience's view of
			// a quiz slide (REQ056). Resolved once: `accessLevel` below is the same
			// resolution, so what the response *carries* and what it *says the
			// caller may do* cannot disagree.
			const access = await resolveDeckAccess(pres, request.headers, false);
			// The *account* standing, resolved separately because it answers a
			// different question than `accessLevel`: the comment routes refuse the
			// edit token (a comment has an author, a forwardable token has nobody
			// behind it — REQ074), so a client gating its comment surfaces on
			// `accessLevel` would fire reads the server is guaranteed to 401.
			const accountAccess = await resolveDeckAccountAccess(
				pres,
				request.headers,
			);
			return {
				...sanitize(pres, { canEdit: canReadDeckAuthoring(access.level) }),
				participantCount: getParticipantCount(pres.id as string),
				serverNow: new Date().toISOString(),
				// The caller's own standing (REQ075), so a surface can disable what
				// this caller may not do and say why (ADR-0025) instead of letting
				// them find out from a 403. `null` for a caller with no standing at
				// all, emitted rather than omitted (ADR-0024). It is not a
				// credential and grants nothing: the routes re-resolve it per request.
				accessLevel: access.level,
				// What the caller's account may do (REQ074) — what the comment
				// threads are gated on. `null` for the edit-token holder with no
				// account, emitted rather than omitted (ADR-0024). A report on the
				// same terms as `accessLevel`.
				commentAccess: accountAccess.level,
			};
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Get presentation by ID",
				description:
					"Fetches a presentation by its internal ID. Includes `participantCount` derived from live WebSocket connections, `serverNow` (the server's clock at the moment of the response, so a client can render the quiz countdown against the same instant the deadline was written in — REQ057), and `accessLevel` — the caller's own standing on this deck (REQ075): `edit` for its owner, the holder of its edit token and an account it is shared with at `edit`, `comment` or `view` for a weaker grant, and `null` for a caller with none. `accessLevel` is a *report*, not a credential: every gated route re-resolves it from the request's own credentials, so a client that lies to itself about it only mis-draws its own buttons. `commentAccess` reports the caller's **account** standing on the same terms — what the deck's comment threads are gated on (REQ074), which refuses the edit token — so it reads `null` for a token holder with no account where `accessLevel` reads `edit`. Quiz slides carry their answer key — `options[].isCorrect`, and `quizAnswers` on a typed question (REQ055) — only for a caller the deck is authored for (its owner, its edit token, or any collaborator); everyone else sees it once the question is over (REQ056). A slide's presenter notes (REQ090) are carried on the same terms and read `\"\"` for everyone else, whatever the deck's state — they have no reveal to wait for. Returns 404 if not found.",
			},
		},
	)

	// ── Join by code ───────────────────────────────────────
	.get(
		"/join/:code",
		async ({ params, request, server, set }) => {
			// The room's door, and the only route a 6-digit code can be guessed at
			// (REQ145).
			const overLimit = guardJoin({ request, server });
			if (overLimit) return overLimit;
			const pres = await getPresentationByCode(params.code);
			if (!pres) {
				set.status = 404;
				return { error: "Presentation not found" };
			}
			// Always return the presentation regardless of status. The client
			// renders the appropriate screen (waiting / ended / live) based on
			// `status`. Returning 4xx for "ended" caused stale browser caches to
			// keep participants stuck on the error screen even after a restart.
			set.headers["Cache-Control"] = "no-store";
			// Never `canEdit`: this is the participants' door, and the deck they
			// receive must not carry the answer key to a question still running
			// (REQ056). An organizer opening their own join link is in the room as
			// a participant, and sees what the room sees.
			return {
				...sanitize(pres),
				participantCount: getParticipantCount(pres.id as string),
				serverNow: new Date().toISOString(),
			};
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Look up presentation by join code",
				description:
					"Resolves a short human-friendly join code to a presentation. Slides never carry their presenter notes here (REQ090): `notes` reads `\"\"` for every caller, since this is the participants' door. Quiz slides never carry their answer key here — `options[].isCorrect`, and `quizAnswers` on a typed question (REQ055) — until the question is over, whoever asks (REQ056). Returned regardless of lifecycle status so participants on `ended` presentations still receive context. Includes `serverNow`, the server's clock at the moment of the response, so a participant's quiz countdown runs against the same instant the deadline was written in (REQ057). Response is marked `Cache-Control: no-store` to avoid stale browser caches across restarts. Rate-limited per client address (REQ145): over the limit answers `429` with a `Retry-After` header and `retryAfterSeconds` in the body.",
			},
		},
	)

	// ── Update presentation (requires creator token) ───────
	.patch(
		"/presentations/:id",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await updatePresentation(params.id, body as any);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: UpdatePresentationSchema,
			detail: {
				tags: ["Presentations"],
				summary: "Update presentation",
				description:
					"Partially updates a deck's **authored** fields (title, slides, settings). This is also where a deck's theme is set (REQ079/REQ080): `theme` names one of the built-in themes or `custom`, `themeBrand` carries the theme the deck defines for itself — its colours as `#rgb`/`#rrggbb` and the id of a face this build ships (REQ092) — and `themeLogoUrl` / `themeLogoAlt` the organizer's own mark (REQ136), which the participant-facing surfaces wear in place of the product's. Only the keys the request carries are changed; a key it omits is left exactly as it stood. Anything outside the authored set is **dropped**, not merged: the deck's owner (`creatorId`), its edit-token hash and its results-link pair are credentials the caller's own authorization is resolved from, so this route cannot write them under any spelling — ownership moves through `…/claim` (or the admin reassign action) and the results link through `…/results-link`. Server-managed state has its own routes too: `status` (`…/start`, `…/end`), `activeSlideIndex` (`…/slide`), `revealedSlideIds` (`…/reveal`) and the question stamps (`…/timer`). Requires `Authorization: Bearer <creatorToken>`, deck ownership, or an `edit` collaborator grant (REQ075).",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Delete presentation (requires creator token) ───────
	.delete(
		"/presentations/:id",
		async ({ params, request, set }) => {
			// The one mutation a collaborator's `edit` grant does **not** reach
			// (REQ075): being trusted to build the deck is not being trusted to
			// destroy it, and a delete takes the room's answers with it (REQ146).
			const auth = await requireEdit(request, params.id, {
				allowCollaborators: false,
			});
			if (auth instanceof Response) return auth;
			const success = await deletePresentation(params.id);
			if (!success) {
				set.status = 404;
				return { error: "Not found" };
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Delete presentation",
				description:
					"Permanently removes the presentation and everything the room submitted under it (REQ146): its slides, every vote and open-ended response, the upvotes on those responses, the Q&A questions with their upvotes, and the deck's chat (REQ078). Every collaborator grant on it goes too (REQ075) — a grant naming a deck that no longer exists is a row nothing can reach. Nothing a participant wrote survives the presentation they wrote it in. Reactions (REQ077) are not on that list and need not be — nothing persists one. Requires deck **ownership** or `Authorization: Bearer <creatorToken>`: unlike every other mutation here, an `edit` collaborator is refused with `403`, because being trusted to build a deck is not being trusted to destroy it. Irreversible.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Start presentation (requires creator token) ────────
	.post(
		"/presentations/:id/start",
		async ({ params, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await startPresentation(params.id);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Start presentation",
				description:
					"Transitions the presentation from `draft` to `live`, allowing participants to vote. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── End presentation (requires creator token) ──────────
	.post(
		"/presentations/:id/end",
		async ({ params, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await endPresentation(params.id);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "End presentation",
				description:
					"Transitions the presentation to `ended`. No further votes are accepted; results remain readable. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Reset presentation (requires creator token) ────────
	.post(
		"/presentations/:id/reset",
		async ({ params, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await resetPresentation(params.id);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Reset presentation",
				description:
					"Clears all votes and responses, returns the presentation to `draft`, and rewinds the active slide. Requires `Authorization: Bearer <creatorToken>`. Destructive — vote data is lost.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Navigate slides (requires creator token) ───────────
	.post(
		"/presentations/:id/slide",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await setActiveSlide(params.id, body.index);
			if (!updated) {
				set.status = 400;
				return { error: "Invalid slide index or presentation" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: z.object({
				index: z.number().int().min(0),
			}),
			detail: {
				tags: ["Slides"],
				summary: "Navigate to slide",
				description:
					"Sets the active slide of the presentation to the zero-based `index`. Returns 400 if the index is out of range. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Reveal / hide slide results (requires creator token) ─
	.post(
		"/presentations/:id/reveal",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await setSlideRevealed(
				params.id,
				body.slideId,
				body.reveal ?? true,
			);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: z.object({
				slideId: z.string(),
				reveal: z.boolean().optional(),
			}),
			detail: {
				tags: ["Slides"],
				summary: "Reveal or hide slide results",
				description:
					"Publishes the given slide's tally to the audience, or takes it back (REQ016/REQ102). This is the reveal an `on-click` slide waits for: until it comes, the slide collects answers and the results endpoints and broadcasts report `withheld` to everyone who cannot edit the deck. It has no effect on a slide whose effective mode is `instant` (already published) or `private` (never published — that mode is changed in the editor, not from here). Defaults to revealing (`reveal: true`). Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Set the deck's reveal mode (requires creator token) ─
	.post(
		"/presentations/:id/results-visibility",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await setDeckResultsVisibility(
				params.id,
				body.resultsVisibility,
			);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: z.object({
				resultsVisibility: ResultsVisibilityEnum,
			}),
			detail: {
				tags: ["Slides"],
				summary: "Set the reveal mode for the whole deck",
				description:
					"Sets when aggregated results reach the audience for the **whole deck**, in one operation (REQ018): `instant` publishes each tally as answers land (REQ015), `on-click` collects silently and publishes only when the presenter reveals that slide (REQ016), and `private` never publishes one — the answers are still recorded and stay readable to whoever can edit the deck (REQ017). Every question slide is returned to the deck setting: the per-slide overrides authored from a slide's own Visibility section are cleared, so the mode really does apply to all of them rather than to whichever ones nobody had touched. Content slides are untouched — they show something rather than ask something and have no tally. This **loosens as readily as it tightens**: applying `instant` publishes live on slides an earlier decision had pinned to `on-click`, a Pin on Image target area (REQ053) among them. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Open or close a slide to submissions (requires creator token, REQ111) ─
	//
	// `open` is required rather than defaulted, which is where this parts company
	// with `/reveal` next door. A reveal has a natural direction — the presenter
	// reveals, and taking it back is the rare correction — so defaulting it to
	// `true` reads as the operation. Opening and closing a question are two
	// equally ordinary halves of one control, so neither is the default and the
	// request says which one it is.
	.post(
		"/presentations/:id/participation",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await setSlideParticipation(
				params.id,
				body.slideId,
				body.open,
			);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: z.object({
				slideId: z.string(),
				open: z.boolean(),
			}),
			detail: {
				tags: ["Slides"],
				summary: "Open or close a slide to submissions",
				description:
					"Decides whether the named slide is currently accepting submissions (REQ111). While it is closed, a vote and an open-ended response upvote are both refused with `400` and a stated reason — `The presenter has closed this slide to submissions` — rather than silently discarded, on every slide type. **Nothing collected is touched**: the answers already given stand, their tally goes on being readable and reveal-able, and reopening the slide does not clear them, so a presenter can close a question, discuss it and open it again for the people who were still typing. Independent of the deck's reveal mode (a closed question can still publish its tally), of the quiz window (REQ057 — a quiz question closes on its own clock as well), and of the blanked screen (REQ109 — blanking shows the room nothing and stops nothing). `open` is required: opening and closing are two halves of one control and neither is a default. A `slideId` the deck does not have answers `404`. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Blank the shared screen (requires creator token, REQ109) ─
	.post(
		"/presentations/:id/blank",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await setAudienceBlanked(params.id, body.blanked);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: z.object({
				blanked: z.boolean(),
			}),
			detail: {
				tags: ["Presentations"],
				summary: "Blank the shared screen, or bring it back",
				description:
					"Takes the deck off the shared screen without leaving the slide (REQ109). What goes dark is the one view the room looks at together — the projected slide — and only that: a participant's own phone keeps its question and its control, the slide the deck is on does not move, the question's window (REQ057) goes on running, whether the slide accepts submissions (REQ111) is untouched, and every answer already collected stays exactly where it was. Deck-level and sticky across navigation, so a presenter can line up what comes next behind a dark screen. Broadcast as `presentation.blanked`, because the screen being projected may be a second browser rather than the presenter's own. A **reset** (REQ101) clears it, along with the closed slides and the votes. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Restart a quiz question's timer (requires creator token) ─
	.post(
		"/presentations/:id/timer",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await restartSlideTimer(params.id, body.slideId);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: z.object({
				slideId: z.string(),
			}),
			detail: {
				tags: ["Slides"],
				summary: "Restart a slide's question timer",
				description:
					"Reopens the slide's question, restarting the countdown a quiz slide runs on (REQ057). Arriving at a slide opens its question automatically and *keeps* that instant however often the presenter pages back, so this is the deliberate way to hand the room a fresh window after a mis-navigation. Answers already given stand — use `reset` to clear votes. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Claim an ownerless presentation ────────────────────
	// Attaches an existing anonymous/local deck to the signed-in account, the
	// path that lets a browser-created presentation gain an account owner (e.g.
	// after signing up). Gated two ways at once: a signed-in user (else 401) AND
	// control of the deck — its owner already, or its edit token (else 403).
	// Ownership is never reassigned: a deck owned by another account is 409;
	// re-claiming your own is an idempotent 200.
	.post(
		"/presentations/:id/claim",
		async ({ params, request, set }) => {
			const userId = await resolveUserId(request.headers);
			if (!userId) {
				set.status = 401;
				return { error: "Sign in to claim this presentation" };
			}
			const pres = await getPresentation(params.id);
			if (!pres) {
				set.status = 404;
				return { error: "Not found" };
			}
			// Prove control with destructive semantics: no legacy grandfathering, so a
			// pre-auth deck with no owner and no token can't be claimed out from under.
			const { authorized } = await authorizeEdit(pres, request.headers, false);
			if (!authorized) {
				set.status = 403;
				return { error: "Forbidden" };
			}
			const result = await claimOwnership(params.id, userId);
			if (result.status === "not-found") {
				set.status = 404;
				return { error: "Not found" };
			}
			if (result.status === "owned-by-other") {
				set.status = 409;
				return { error: "Already owned by another account" };
			}
			// A workspace deck has no `creatorId` and is still not ownerless (REQ128):
			// the workspace owns it, and a member claiming it would take a shared deck
			// private in one request nobody else in the workspace is told about.
			if (result.status === "owned-by-workspace") {
				set.status = 409;
				return { error: "This deck belongs to a workspace" };
			}
			return sanitize(result.pres, { canEdit: true });
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Claim an ownerless presentation",
				description:
					"Attaches an ownerless presentation to the signed-in account. Requires a session (cookie or API key) AND control of the deck (already its owner, or its edit token via `Authorization: Bearer` / `X-Omul-Edit-Token`). 401 without a session, 403 without control, 409 when another account already owns it, 200 (idempotent) when you already own it. A deck a **workspace** owns (REQ128) is also `409` and is never claimable, its absent `creatorId` notwithstanding: the workspace is its owner, and moving one back into an account is `POST /presentations/:id/workspace` with `workspaceId: null`, which only a workspace owner may do.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Move a deck between an account and a workspace (REQ128) ─
	//
	// The one writer of a deck's `workspaceId`, and the reason that field is
	// unwritable everywhere else: the caller's own standing on a workspace deck is
	// resolved from their role in the workspace it names, so a route that let a
	// body write it would let anyone who can edit a deck move it somewhere they
	// administer and take it.
	//
	// Both directions are authorized at **both ends**, which is what makes this a
	// move rather than two half-authorized writes:
	//
	//  - **In** — the caller must own the deck today (`requireDeckOwner`, so not
	//    its edit token and not a collaborator) *and* be a member of the target
	//    workspace with a role that may create decks there.
	//  - **Out** — the caller must be able to administer the workspace that owns
	//    it. `requireDeckOwner` already answers that for a workspace deck at the
	//    admin level, so the owner check here is the deliberate second, narrower
	//    one: taking a deck out ends the shared ownership the workspace exists to
	//    provide, and that stays with the role that could have deleted the
	//    workspace anyway.
	.post(
		"/presentations/:id/workspace",
		async ({ params, body, request, set }) => {
			const auth = await requireDeckOwner(request, params.id);
			if (auth instanceof Response) return auth;
			// `requireDeckOwner` proves an account is behind the request, so the two
			// resolutions below cannot disagree about who is asking.
			const userId = await resolveUserId(request.headers);
			if (!userId) return jsonError(401, "Unauthorized");
			const currentWorkspaceId = (auth.workspaceId as string | null) ?? null;
			const targetWorkspaceId = body.workspaceId?.trim() || null;
			if (currentWorkspaceId === targetWorkspaceId) {
				// Idempotent: asking for the state it is already in is not an error, and
				// answering one would make a retry look like a failure.
				return sanitize(auth, { canEdit: true });
			}
			if (currentWorkspaceId) {
				const role = await workspaceRoleFor(currentWorkspaceId, userId);
				if (!canAdministerWorkspace(role)) {
					set.status = 403;
					return {
						error: "Only a workspace owner can move a deck out of it",
					};
				}
			}
			if (targetWorkspaceId) {
				const role = await workspaceRoleFor(targetWorkspaceId, userId);
				if (!canCreateWorkspaceDecks(role)) {
					set.status = 403;
					return { error: "You cannot move decks into that workspace" };
				}
			}
			const updated = await setPresentationWorkspace(
				params.id,
				targetWorkspaceId,
				targetWorkspaceId ? null : userId,
			);
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: DeckWorkspaceSchema,
			detail: {
				tags: ["Workspaces"],
				summary: "Move a deck into a workspace, or back out of it",
				description:
					"Moves one deck between an account and a workspace (REQ128). `{ \"workspaceId\": \"…\" }` hands it to that workspace: the deck's account owner is cleared and so is its **edit token**, because an edit link handed out before the move is anonymous and forwardable and nobody in the workspace could revoke it. `{ \"workspaceId\": null }` moves it back, with the caller becoming its account owner; no new edit token is minted, since an owner has never needed one. Authorized at both ends (REQ129): moving in needs ownership of the deck *and* a role in the target workspace that may create decks there; moving out needs the `owner` role in the workspace that holds it. `401` without an account, `403` when either end refuses, and an idempotent `200` when the deck is already where the request asks for. The deck's collaborator grants (REQ075) survive the move untouched — a grant is a decision about one account and one deck, and moving the deck does not unmake it.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Submit vote (public) ───────────────────────────────
	.post(
		"/presentations/:id/vote",
		async ({ params, body, request, server, set }) => {
			const overLimit = guardSubmission(
				{ request, server },
				body.participantId ?? "",
			);
			if (overLimit) return overLimit;
			const vote = await submitVote(
				params.id,
				body.slideId,
				body.value,
				body.participantId ?? "",
				{ statementId: body.statementId, skip: body.skip },
			);
			// A stated refusal says which rule turned the answer away — a quiz's
			// window or its finality (REQ054/REQ057), or the presenter having closed
			// this slide (REQ111). "You were too slow", "the presenter stopped taking
			// answers" and "the presentation isn't live" are three different pieces
			// of news for the participant who reads them.
			// The `refused` code rides beside the prose so a client can map the
			// reason onto the participant's own language (REQ084) instead of
			// guessing it back out of local state; the English `error` stays for
			// bare API callers.
			if (isVoteRefusal(vote)) {
				set.status = 400;
				return {
					error: VOTE_REFUSAL_MESSAGE[vote.refused],
					refused: vote.refused,
				};
			}
			if (!vote) {
				set.status = 400;
				return {
					error: "Cannot vote – presentation not live or slide not found",
				};
			}
			return vote;
		},
		{
			body: VoteSchema,
			detail: {
				tags: ["Voting"],
				summary: "Submit a vote",
				description:
					"Records a participant vote on a slide. Public endpoint — no auth required. The shape of `value` depends on the slide type (e.g. choice IDs for multiple-choice, free text for word-cloud, numeric for scale, `\"x,y\"` coordinates for a 2x2 grid item named by `statementId`, `\"itemId:points\"` pairs summing to exactly 100 for a 100 Points slide, a whole number inside the authored range and on its step grid for a Guess the Number slide, `\"x,y\"` per-mille coordinates on the image for a Pin on Image slide — which is also refused with 400 when the slide carries no image at all, and a whole filled-in form as `fieldId`/`answer` pairs for a Form slide (REQ061), where each field's type is enforced at the boundary and a required field left blank, an `email` field given a non-address, a `choice` field given anything but one of its own option ids, or an answer past 200 characters is refused). A quiz slide takes an option id, or — when its `quizAnswerMode` is `type` (REQ055) — the answer the participant wrote, judged against the slide's `quizAnswers` after normalization (case, Latin-script accents, spacing and surrounding punctuation folded; nothing else — other scripts' combining marks are letters, not accents, and are compared as written). Returns 400 if the presentation is not `live`, the slide does not exist, or the value is not a valid submission for that slide type. A quiz slide states which of its own rules refused the answer — the question's window has closed, or this participant's answer is already final (REQ054/REQ057). Every stated refusal carries a machine-readable `refused` code (`quiz-window-closed`, `quiz-already-answered`, `participation-closed`) beside the English `error` text, so a client can name the reason in its own language. Rate-limited per client address **and** per `participantId` (REQ145): over either limit answers `429` with a `Retry-After` header and `retryAfterSeconds` in the body.",
			},
		},
	)

	// ── Upvote an open-ended response (public, REQ025) ─────
	.post(
		"/presentations/:id/response-vote",
		async ({ params, body, request, server, set }) => {
			const overLimit = guardSubmission(
				{ request, server },
				body.participantId ?? "",
			);
			if (overLimit) return overLimit;
			const result = await voteOnResponse(
				params.id,
				body.slideId,
				body.responseId,
				body.participantId ?? "",
			);
			// An upvote is a submission, so a slide the presenter has closed refuses
			// it with the same stated reason a vote gets (REQ111) rather than folding
			// into the generic "disabled or invalid state" below, which names two
			// things that are both fine.
			if (isVoteRefusal(result)) {
				set.status = 400;
				return {
					error: VOTE_REFUSAL_MESSAGE[result.refused],
					refused: result.refused,
				};
			}
			if (!result) {
				set.status = 400;
				return {
					error: "Cannot upvote – response voting disabled or invalid state",
				};
			}
			return result;
		},
		{
			body: ResponseVoteSchema,
			detail: {
				tags: ["Voting"],
				summary: "Upvote an open-ended response",
				description:
					"Adds a participant upvote to an existing open-ended response on a word-cloud or open-text slide. Public endpoint. Returns 400 if response voting is disabled for that slide or the presentation is not in a votable state. Rate-limited on the same per-address and per-`participantId` submission budget a vote spends (REQ145), answering `429` over the limit.",
			},
		},
	)

	// ── Delete one submitted answer (REQ027) ───────────────
	//
	// The one route that removes something a *participant* wrote, and the only
	// mutation on this API whose subject is a single stored answer. Authorized as
	// every presentation mutation is — owner, edit token, or an `edit` grant — and
	// deliberately not narrower: moderating what is on the shared screen is part
	// of running the deck, which is exactly what that gate names.
	.delete(
		"/presentations/:id/answers/:answerId",
		async ({ params, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const removed = await deleteSubmittedAnswer(params.id, params.answerId);
			if (isAnswerDeletionRefusal(removed)) {
				set.status = 400;
				return {
					error:
						"Only word-cloud and open-ended answers can be deleted individually",
					refused: removed.refused,
				};
			}
			if (!removed) {
				set.status = 404;
				return { error: "No such submitted answer on this deck" };
			}
			return removed;
		},
		{
			detail: {
				tags: ["Voting"],
				summary: "Delete one submitted answer",
				description:
					"Removes one individual answer from a word-cloud or open-ended slide (REQ027), named by the `id` the results payload gives it — a `responses[].id` on an open-text slide, an `answers[].id` on a word cloud (the editor-only list beside its `words`). The row is deleted rather than hidden, so the deletion is in the tally the room is broadcast a moment later, in both results endpoints, and in every export of this deck taken afterwards — the spreadsheet's response rows and per-participant matrix (REQ095) and the PDF's aggregates (REQ096). The upvotes on a deleted response go with it (REQ025), so the deck's upvote totals do not go on counting an answer that is no longer there. Answers on other slide types are refused with `400` and a `refused: \"slide-type\"` code: every other type's answer is a choice, and removing one would re-weight a distribution rather than take a line off a screen. An answer id belonging to another deck answers the same `404` an unknown one does, so the route cannot be used to probe for one. Works whatever the deck's status — a line is worth taking down after a session as much as during it. Requires deck ownership, `Authorization: Bearer <creatorToken>`, or an `edit` grant. Irreversible: nothing here keeps a copy, and REQ101's reset is the only other way a stored answer leaves.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Q&A layer: read the question list (public, REQ036/REQ037/REQ060) ─
	//
	// Who sees what is decided here, on the caller's own credentials, and never
	// by a broadcast: the edit token rides this GET exactly as it does on
	// `/results/:slideId`, and `participantId` is what a participant is shown
	// their own submissions by when the organizer has kept the list back.
	.get(
		"/presentations/:id/qa",
		async ({ params, query, request, set }) => {
			const pres = await getPresentation(params.id);
			if (!pres) {
				set.status = 404;
				return { error: "Not found" };
			}
			const list = await getQAList(params.id, {
				canEdit: await canEditDeck(pres, request),
				participantId: query.participantId ?? "",
			});
			if (!list) {
				set.status = 404;
				return { error: "Not found" };
			}
			return list;
		},
		{
			query: z.object({
				participantId: z.string().optional(),
			}),
			detail: {
				tags: ["Q&A"],
				summary: "List the deck's Q&A questions",
				description:
					"Returns the presentation-wide Q&A list (REQ036) as this caller may read it, with the layer's `enabled`/`visibility` settings alongside it. A caller that can edit the deck (owner or edit token) always reads the whole list, layer switched off included. Everyone else reads it when the layer is on and `visibility` is `everyone` (REQ037); otherwise they read only the questions their own `participantId` asked, and `canSeeAll` is `false`. Each entry carries its `upvotes` and `answered` state (REQ060) plus `own`/`upvoted` for this caller — never the asking participant's id, which is that participant's only credential. Questions are ordered open-first, then most upvoted, then longest-waiting. 404 if the presentation is missing.",
			},
		},
	)

	// ── Q&A layer: ask a question (public, REQ036) ─────────
	.post(
		"/presentations/:id/qa",
		async ({ params, body, request, server, set }) => {
			// Free text a participant writes to disk — the same submission budget a
			// vote spends (REQ145).
			const overLimit = guardSubmission(
				{ request, server },
				body.participantId ?? "",
			);
			if (overLimit) return overLimit;
			const result = await submitQuestion(
				params.id,
				body.text,
				body.participantId ?? "",
			);
			if (!result) {
				set.status = 400;
				return {
					error: "Cannot ask – Q&A is off or the presentation is not accepting submissions",
				};
			}
			return result;
		},
		{
			body: QAQuestionSchema,
			detail: {
				tags: ["Q&A"],
				summary: "Ask a Q&A question",
				description:
					"Submits a question to the presentation-wide Q&A layer (REQ036) from whatever slide is on screen. Public endpoint. Returns 400 when the layer is off, or when the deck is not accepting submissions (a `live` deck must be started; a survey deck must not be ended) — the same rule a vote meets. On a deck whose list is published to the room (`visibility: everyone`), a question that repeats one already asked becomes an upvote on it instead of a second row (`merged: true`); on a moderated deck every submission is stored as its own question. Rate-limited on the same per-address and per-`participantId` submission budget a vote spends (REQ145), answering `429` over the limit.",
			},
		},
	)

	// ── Q&A layer: settings (requires creator token, REQ036/REQ037) ─
	.post(
		"/presentations/:id/qa/settings",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await setQASettings(params.id, {
				enabled: body.enabled,
				visibility: body.visibility,
			});
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: QASettingsSchema,
			detail: {
				tags: ["Q&A"],
				summary: "Turn the Q&A layer on/off and set who reads it",
				description:
					"Switches the presentation-wide Q&A layer on or off (REQ036) and chooses whether submitted questions are published to the room or kept to the moderation view (REQ037). Both keys are independently optional — an absent one is left as it stands. A fresh deck carries `enabled: false` and `visibility: presenter`, so publishing the room's questions is always a deliberate choice. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Q&A layer: upvote a question (public, REQ060) ──────
	.post(
		"/presentations/:id/qa/:questionId/upvote",
		async ({ params, body, request, server, set }) => {
			const overLimit = guardSubmission(
				{ request, server },
				body.participantId ?? "",
			);
			if (overLimit) return overLimit;
			const result = await upvoteQuestion(
				params.id,
				params.questionId,
				body.participantId ?? "",
			);
			if (!result) {
				set.status = 400;
				return {
					error: "Cannot upvote – the question list is not open to participants",
				};
			}
			return result;
		},
		{
			body: QAUpvoteSchema,
			detail: {
				tags: ["Q&A"],
				summary: "Upvote a Q&A question",
				description:
					"Toggles this participant's upvote on a submitted question (REQ060), which is what orders the presenter's queue. Public endpoint, and only on a deck whose list the room can actually read (`visibility: everyone`) — voting on a question you were not shown is not prioritization. Returns 400 without a `participantId`, when the layer is off or moderated, when the deck is not accepting submissions, or when the question does not belong to this presentation. Rate-limited on the same per-address and per-`participantId` submission budget a vote spends (REQ145), answering `429` over the limit.",
			},
		},
	)

	// ── Q&A layer: mark answered (requires creator token, REQ060) ─
	.post(
		"/presentations/:id/qa/:questionId/answered",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const result = await setQuestionAnswered(
				params.id,
				params.questionId,
				body.answered ?? true,
			);
			if (!result) {
				set.status = 404;
				return { error: "Not found" };
			}
			return result;
		},
		{
			body: QAAnsweredSchema,
			detail: {
				tags: ["Q&A"],
				summary: "Mark a Q&A question answered (or reopen it)",
				description:
					"Sets a question's processing status (REQ060) so a long list stays workable: answered questions sink below the open ones on every surface. Defaults to marking answered (`answered: true`); pass `answered: false` to put it back in the queue, because a mis-click during a live session should cost one click and not a question the presenter can no longer find. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Participant channels: open/close them (requires creator token, REQ077/REQ078) ─
	//
	// One endpoint for both switches rather than one each: they are the same
	// decision at two settings — what, besides an answer, this room may send —
	// and the presenter's panel moves them from one place (ADR-0026).
	.post(
		"/presentations/:id/channels",
		async ({ params, body, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const updated = await setParticipantChannels(params.id, {
				reactionsEnabled: body.reactionsEnabled,
				chatEnabled: body.chatEnabled,
			});
			if (!updated) {
				set.status = 404;
				return { error: "Not found" };
			}
			return sanitize(updated, { canEdit: true });
		},
		{
			body: ParticipantChannelsSchema,
			detail: {
				tags: ["Participant channels"],
				summary: "Open or close the room's reactions and live chat",
				description:
					"Switches the deck's two participant channels: reactions on any slide (REQ077) and the live chat (REQ078). Both keys are independently optional — an absent one is left as it stands. A fresh deck carries both `false`, so opening either is always a deliberate choice. Requires `Authorization: Bearer <creatorToken>`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Reactions: send one (public, REQ077) ───────────────
	//
	// The one write endpoint in this file that writes nothing. A reaction is
	// broadcast to the room and forgotten — no store is touched, so it can never
	// be read back as an answer or counted in a tally.
	.post(
		"/presentations/:id/reactions",
		async ({ params, body, request, server, set }) => {
			// Throttled on a budget of its own (REQ145). A reaction writes nothing
			// but reaches every socket in the room, so it has to be bounded — on
			// **its own** counters, never the submission ones: a participant who
			// taps through an applause moment must still be able to answer the quiz
			// question that follows it. See `REACTION_PARTICIPANT_RULE`.
			const overLimit = guardReaction(
				{ request, server },
				body.participantId ?? "",
			);
			if (overLimit) return overLimit;
			const result = await sendReaction(
				params.id,
				body.kind,
				body.slideId ?? null,
			);
			if (!result) {
				set.status = 400;
				return {
					error:
						"Cannot react – reactions are off or the presentation is not accepting submissions",
				};
			}
			return result;
		},
		{
			body: ReactionSchema,
			detail: {
				tags: ["Participant channels"],
				summary: "Send a reaction",
				description:
					"Sends a lightweight reaction from whatever slide is on screen (REQ077) — `kind` is one of `like`, `love`, `celebrate`, `laugh`, `insight`, and anything else is refused rather than passed through. Public endpoint. **Nothing is stored**: the reaction is broadcast to the room as `reaction.sent` and forgotten, so it is never an answer and is counted in no tally. The response echoes the broadcast frame (`id`, `kind`, `slideId`, `at`). `slideId` is optional and is passed through untouched — it says where the sender was looking, and nothing is keyed by it. Returns 400 when the channel is off, or when the deck is not accepting submissions — the same rule a vote meets. Rate-limited on a per-address and per-`participantId` budget **of its own**, never the one a vote spends (REQ145): reacting a lot must not cost a participant the answer to the next question. Answers `429` over the limit.",
			},
		},
	)

	// ── Live chat: read the feed (public, REQ078) ──────────
	.get(
		"/presentations/:id/chat",
		async ({ params, query, set }) => {
			const feed = await getChat(params.id, {
				participantId: query.participantId ?? "",
			});
			if (!feed) {
				set.status = 404;
				return { error: "Not found" };
			}
			return feed;
		},
		{
			query: z.object({
				participantId: z.string().optional(),
			}),
			detail: {
				tags: ["Participant channels"],
				summary: "Read the deck's live chat",
				description:
					"Returns the deck's chat (REQ078) with the channel's `enabled` switch alongside it. One projection for everybody — a chat is the room's, not a moderated queue — except for `own`, which marks the lines this `participantId` wrote; the writing participant's id itself is never returned. Ordered oldest-first, capped at the newest 200 messages. Readable whether or not the channel is currently open, so closing it does not make what was said vanish; what closing it stops is posting. 404 if the presentation is missing.",
			},
		},
	)

	// ── Live chat: post a message (public, REQ078) ─────────
	.post(
		"/presentations/:id/chat",
		async ({ params, body, request, server, set }) => {
			// Free text a participant writes to disk — the same submission budget a
			// vote and a Q&A question spend (REQ145).
			const overLimit = guardSubmission(
				{ request, server },
				body.participantId ?? "",
			);
			if (overLimit) return overLimit;
			const result = await postChatMessage(
				params.id,
				body.text,
				body.participantId ?? "",
			);
			if (!result) {
				set.status = 400;
				return {
					error:
						"Cannot post – the chat is off or the presentation is not accepting submissions",
				};
			}
			return result;
		},
		{
			body: ChatMessageSchema,
			detail: {
				tags: ["Participant channels"],
				summary: "Post a chat message",
				description:
					"Posts a message to the deck's live chat (REQ078), separate from the Q&A queue and from every slide's answers: its own collection, no slide id, and no tally reads it. Public endpoint. Returns 400 when the channel is off, or when the deck is not accepting submissions (a `live` deck must be started; a survey deck must not be ended) — the same rule a vote meets. Repeated lines are **not** folded into one the way a published Q&A question's duplicates are: two people saying the same thing is a conversation, not a list to de-duplicate. Rate-limited on the same per-address and per-`participantId` submission budget a vote spends (REQ145), answering `429` over the limit.",
			},
		},
	)

	// ── Participant names: state one (public, REQ076) ──────
	//
	// Public in the same sense the vote endpoint is: the `participantId` is the
	// caller's own credential, minted in their browser and never published. What
	// bounds this endpoint is the deck rather than the caller — a deck that did
	// not ask for names refuses every call, so the switch is a decision about
	// whether the deck holds names at all and not about which screen draws a
	// field.
	.post(
		"/presentations/:id/participant-name",
		async ({ params, body, request, server, set }) => {
			// Free text a participant writes to disk — the same submission budget a
			// vote, a question and a chat message spend (REQ145).
			const overLimit = guardSubmission({ request, server }, body.participantId);
			if (overLimit) return overLimit;
			const stated = await stateParticipantName(
				params.id,
				body.participantId,
				body.name,
			);
			if (!stated) {
				set.status = 400;
				return {
					error:
						"Cannot state a name – this deck does not ask for one, or the presentation has ended",
				};
			}
			return stated;
		},
		{
			body: ParticipantNameSchema,
			detail: {
				tags: ["Participants"],
				summary: "State this participant's name",
				description:
					"Records what one participant is called on this deck (REQ076), so their answers can be read back under a name on the results surface and in both exports. Public endpoint. The name is trimmed, collapsed to a single line and capped at 80 characters; a longer or blank one is refused by the body schema (`422`). One name per (deck, participant): stating a second corrects the first rather than adding a row, so the roster can never list one person twice. The response carries the name **as stored**, which may differ from what was sent — the normalisation is the server's. Returns `400` when the deck does not ask for names (`requireParticipantName` is false) or when the presentation has ended: unlike a vote, this is accepted on a deck that has not been started yet, because stating a name is what a participant does at the door rather than in answer to a question. Rate-limited on the same per-address and per-`participantId` submission budget a vote spends (REQ145), answering `429` over the limit.",
			},
		},
	)

	// ── Participant names: the deck's roster (REQ076) ──────
	.get(
		"/presentations/:id/participants",
		async ({ params, request, set }) => {
			// Gated as an edit rather than as a results read, and deliberately not
			// reachable through the deck's results link (REQ098). The link is the
			// read-only delegation of the deck's *numbers*; a list of who was in the
			// room is not a number, and nobody minting a link to their tallies
			// decided to hand over a roster with it.
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const roster = await getParticipantRoster(params.id);
			if (!roster) {
				set.status = 404;
				return { error: "Not found" };
			}
			return roster;
		},
		{
			detail: {
				tags: ["Participants"],
				summary: "Who took part, by name",
				description:
					"Returns the deck's roster (REQ076): one entry per participant who stated a name, each with the `participantId` their answers are stored under, the `name` they gave, `answeredSlides` — how many of the deck's slides they have answered, counted in slides rather than in stored rows, so a multi-statement scale is one — and `statedAt`. Ordered by name. People who answered without ever stating one are **not** listed: a deck only collects names while the switch is on, so those rows legitimately have none, and they are counted in the spreadsheet export (REQ095) under their participant id. Requires deck ownership, `Authorization: Bearer <creatorToken>`, or an `edit` collaborator grant (REQ075) — the deck's read-only **results link** does not open it. 404 if the presentation is missing.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Get one participant's quiz scorecard (public, REQ056) ─
	//
	// Public in the same sense the vote endpoint is: the participant id *is* the
	// credential, minted in the participant's own browser and never published.
	// The aggregate results payload deliberately reports quiz scores without
	// naming anyone (see `summarizeQuizScores`), so this is the only way a
	// participant learns their own result — and it hands out nobody else's.
	.get(
		"/presentations/:id/scorecard",
		async ({ params, query, set }) => {
			const scorecard = await getParticipantScorecard(
				params.id,
				query.participantId,
			);
			if (!scorecard) {
				set.status = 404;
				return { error: "Not found" };
			}
			return scorecard;
		},
		{
			query: z.object({
				participantId: z.string().min(1),
			}),
			detail: {
				tags: ["Results"],
				summary: "Get one participant's quiz scorecard",
				description:
					"Returns what the given participant scored across the deck's quiz slides (REQ054/REQ055/REQ056): every quiz question, how it was answered (`answerMode`), the option they picked (`optionId`) or the answer they typed (`answer`), whether they were right, the time they took, and the points it earned — plus the deck totals. Every quiz slide is listed whether answered or not, with explicit `null`s for an unanswered one (ADR-0024). Scores are derived from the votes and the slide as it stands now, so re-marking the correct answer — or adding an accepted spelling — re-scores immediately. It also carries this participant's place on the deck's leaderboard (REQ059): `entryId` and `label` are the one-way handle their row is named by on the anonymous board, `rank` their place (`null` until they have answered something) and `rankedCount` how many participants are ranked. 404 if the presentation is missing.",
			},
		},
	)

	// ── Get results for a slide ────────────────────────────
	.get(
		"/presentations/:id/results/:slideId",
		async ({ params, request, set }) => {
			const pres = await getPresentation(params.id);
			if (!pres) {
				set.status = 404;
				return { error: "Not found" };
			}
			const caller = await resultsCallerFor(pres, request);
			if (caller instanceof Response) return caller;
			const results = await getSlideResults(params.id, params.slideId, caller);
			if (!results) {
				set.status = 404;
				return { error: "Not found" };
			}
			return results;
		},
		{
			detail: {
				tags: ["Results"],
				summary: "Get results for a single slide",
				description:
					"Returns the aggregated tally for one slide (counts, response list, or scale stats depending on slide type). **The slide's reveal mode decides whether there is a tally here at all** (REQ015/REQ016/REQ017): a caller who cannot edit the deck reads `{ \"type\": <slide type>, \"withheld\": true }` in place of the numbers whenever the effective mode is `private`, or `on-click` before the presenter has revealed that slide — including after the deck has ended, since ending a session is not the organizer revealing what they chose to withhold. The answers are still recorded and still counted; they are simply not published to the room, and stay readable to the owner or the holder of the edit token, who reads the tally under every mode. The holder of the deck's **results link** (REQ098) reads it under every mode too — that is the one thing the link grants — by sending its token as `X-Omul-Results-Token`; a token that has been revoked, or that never belonged to this deck, answers `401` rather than falling back to the public read. A quiz slide's `options[].isCorrect` — and, on a typed question (REQ055), the `typedAnswers.entries` and `typedAnswers.accepted` blocks — is emitted only to a caller that can edit the deck (owner or edit token), or once the question is over; everyone else reads `null` there while it is still running (REQ056). A Pin on Image slide's `correctArea`, `correctCount` and `correctShare` (REQ053) are emitted on the same terms — to an editor always, and to everyone else only once the slide's effective results visibility reveals it — and all three read `null` together, so a withheld target area is indistinguishable from a question that named none. A Form slide's `submissions` (REQ061) — the rows the room actually wrote — are emitted only to a caller that can edit the deck, and read `null` for everybody else *whatever the reveal mode says*: reveal mode is a decision about the organizer's numbers, and a decision about numbers must not publish a participant's email address to the room. The per-field `answered` counts and a choice field's per-option counts stay public either way. A leaderboard slide (REQ059) takes no votes of its own: its payload is the deck's standings across every quiz question — `entries` (the top `size` rows, each with `rank`, an anonymous `entryId`/`label`, `totalPoints`, `correctCount` and `answeredCount`), `rankedCount` for everyone ranked behind them, and `quizCount`/`maxPoints` for what the deck is worth. Rows are named by a one-way handle derived from the participant id, never the id itself, so the board stays public and anonymous. 404 if the presentation or slide is missing.",
			},
		},
	)

	// ── Break one slide's results down by an earlier one (REQ020) ──
	//
	// Read on exactly the terms the tally it is built from is read on: the same
	// `resultsCallerFor`, the same reveal-mode gate — twice, once per slide — and
	// no credential of its own. What it adds is a floor under how few people a
	// published group may stand on (`SEGMENT_MIN_RESPONDENTS`), because the join
	// is the one read here that can turn two anonymous tallies into one person's
	// answers.
	.get(
		"/presentations/:id/results/:slideId/segments",
		async ({ params, query, request, set }) => {
			const pres = await getPresentation(params.id);
			if (!pres) {
				set.status = 404;
				return { error: "Not found" };
			}
			const caller = await resultsCallerFor(pres, request);
			if (caller instanceof Response) return caller;
			const segmented = await getSegmentedResults(
				params.id,
				params.slideId,
				query.by,
				caller,
			);
			if (!segmented) {
				set.status = 404;
				return { error: "Not found" };
			}
			if (isSegmentRefusal(segmented)) {
				set.status = 400;
				return { error: segmented.reason, refused: segmented.refused };
			}
			return segmented;
		},
		{
			query: SegmentQuerySchema,
			detail: {
				tags: ["Results"],
				summary: "Break one slide's results down by an earlier slide's answers",
				description:
					"Returns the slide's tally split into one group per answer the same participants gave on the slide named by `?by=`, joined on participant id (REQ020). Each entry in `segments` carries the option id it stands for (`key`), its `label`, how many people in it answered this slide (`respondentCount`), and `results` — **the same payload shape the unsegmented results endpoints publish**, computed by the same aggregation over that group alone, so a segment's numbers are the numbers this slide's own chart would draw for a room of exactly those people. Every authored option gets a group, empty ones included, and a final group with `key: null` holds the people who answered this slide but not the grouping one. Only a slide whose answers are **one choice from a fixed set** may group another — a single-select multiple-choice slide, or a quiz question answered by picking (REQ054) — and only one that comes **earlier** in the deck; the slide being broken down must itself have a tally. Anything else answers `400` with a `refused` code and the reason in words. Both slides pass the reveal-mode gate (REQ015–REQ017): if either tally is withheld from this caller the payload carries `withheld: true`, `withheldReason: \"reveal-mode\"` and no segments, since the group labels and counts *are* the grouping slide's tally under another name. The **results link** (REQ098) lifts that gate here exactly as it does elsewhere. It lifts nothing else, and three limits apply to every caller who cannot edit the deck. **A slide whose tally lists one entry per respondent is not broken down at all** — open-text, word cloud, pin, grid, guess, leaderboard, and a typed quiz question — answering `withheld: true` with `withheldReason: \"identifiable\"`: no group size makes such a list anonymous, and its entries are matchable across two breakdowns of the same slide by different groupings. **Groups are held back at least two at a time**: the groups partition the people who answered and the unsegmented tally is readable on the same terms, so holding back one group alone would publish it as `unsegmented - the rest`; whenever a group falls under `minRespondents`, the smallest group that clears the floor is held back with it. `suppressed: true` therefore does not mean \"too few answered\" — a group above the floor wears it too when it is that complement. **A held-back group publishes no head count**: `respondentCount` is `null` beside `results: null`, because \"exactly one person picked this and answered that\" is a fact about a person rather than a number about the room. An owner or edit-token holder reads every group whatever its size, and every slide type. 404 if the presentation or either slide is missing.",
			},
		},
	)

	// ── Preview the deck with test votes (REQ103, REQ104) ──
	//
	// Authorized like a mutation (owner or edit token) although it writes
	// nothing: a preview is the organizer's own dry run of their own deck, it
	// carries the presenter's view of every quiz answer key, and the deck it
	// previews is not one the room has been let into yet. Everything about it is
	// derived and discarded — see `getPreviewResults` for why not one row of it
	// can reach the store.
	.get(
		"/presentations/:id/preview",
		async ({ params, query, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const preview = await getPreviewResults(params.id, {
				respondents: query.respondents,
				seed: query.seed,
				startedAt: query.startedAt,
			});
			if (!preview) {
				set.status = 404;
				return { error: "Not found" };
			}
			return preview;
		},
		{
			query: PreviewQuerySchema,
			detail: {
				tags: ["Results"],
				summary: "Preview the deck with generated test votes",
				description:
					"Returns a dry run of the whole deck (REQ103) populated with synthetic responses (REQ104): every slide, twice — `presenterResults` as the shared screen reads the tally (quiz answer keys included, because the presenter authored them) and `audienceResults` as a participant's phone reads it (keys withheld until the question is over, REQ056). The run is computed against a deck state that is live with every question opened at `startedAt`; the stored presentation is untouched, stays in whatever status it was, and **no generated response is written** — nothing here reaches the `votes` collection, a live session, or a participant's screen. `respondents` (default 24, max 200) sizes the simulated room and `0` previews empty slides; `seed` selects a reproducible run; `startedAt` fixes the instant the questions opened so a polling client does not restart every countdown it refreshes. All three are echoed back. Requires `Authorization: Bearer <creatorToken>` (or deck ownership).",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Get all results ────────────────────────────────────
	.get(
		"/presentations/:id/results",
		async ({ params, request, set }) => {
			const pres = await getPresentation(params.id);
			if (!pres) {
				set.status = 404;
				return { error: "Not found" };
			}
			const caller = await resultsCallerFor(pres, request);
			if (caller instanceof Response) return caller;
			const results = await getAllResults(params.id, caller);
			if (!results) {
				set.status = 404;
				return { error: "Not found" };
			}
			return results;
		},
		{
			detail: {
				tags: ["Results"],
				summary: "Get results for all slides",
				description:
					"Returns aggregated results for every slide in the presentation, keyed by slide ID. Useful for export and final summary views. Each entry passes the same reveal-mode gate as the single-slide endpoint (REQ015/REQ016/REQ017): for a caller who cannot edit the deck, a slide whose tally is not published carries `withheld: true` and no numbers, while the owner or the holder of the edit token reads every tally whatever the mode. So does the holder of the deck's **results link** (REQ098), which is what the read-only results page is fed by: send its token as `X-Omul-Results-Token`. A revoked or foreign token answers `401` rather than falling back to the public read, so a holder learns their link is gone instead of reading a deck of withheld markers.",
			},
		},
	)

	// ── Download the results as a spreadsheet (REQ095) ─────
	//
	// Authorized as an edit (owner or edit token), not as a read, and the file
	// itself is why: it carries every stored response beside the participant id
	// it was cast under, and every quiz answer key the running room is still
	// being kept from (REQ056). The public results endpoints report a tally
	// anonymously precisely so they can stay public — this one cannot, so it is
	// gated with the strictest credential the deck has rather than the one that
	// would be convenient to link.
	.get(
		"/presentations/:id/results.xlsx",
		async ({ params, request }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;

			const exportedAt = new Date().toISOString();
			const input = await getResultsExport(params.id, { exportedAt });
			if (!input) return jsonError(404, "Not found");

			const workbook = await renderResultsWorkbook(buildResultsWorkbook(input));
			const filename = resultsExportFilename(
				input.presentation.title,
				exportedAt,
			);
			return new Response(workbook, {
				headers: {
					"Content-Type": XLSX_CONTENT_TYPE,
					"Content-Disposition": `attachment; filename="${filename}"`,
					// A results file is a snapshot of a session still being run; a
					// cached copy would hand the organizer the tally from before the
					// last five answers landed.
					"Cache-Control": "no-store",
				},
			});
		},
		{
			detail: {
				tags: ["Results"],
				summary: "Download all results as an XLSX spreadsheet",
				description:
					"Returns the whole deck's results as an Excel workbook (REQ095): a **Summary** sheet of deck metadata and totals, a **Slides** sheet of what was asked and how many answered, a **Responses** sheet with one row per stored submission (decoded into readable text, carrying its participant id, sub-item and timestamp), a **Participants** matrix of one row per participant against one column per interactive slide, and an **Aggregates** sheet holding every tally in tidy long form — one row per slide/entry/metric/value, taken from the same aggregation the results endpoints publish rather than recomputed. Requires `Authorization: Bearer <creatorToken>` (or deck ownership): the file carries raw per-participant responses and every quiz answer key, including one a running question is still withholding from the room (REQ056). A results link (REQ098) does **not** open this route — it delegates the tallies, not the rows behind them. Served as an attachment and marked `Cache-Control: no-store`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Render the deck to PDF (REQ096) ────────────────────
	//
	// The second export format, and it is authorized exactly as the first one is
	// — owner or edit token — whichever reading is asked for. `?results=false`
	// draws less, and that is a decision about the *document*, not about who may
	// have it: even without a tally the file carries every quiz answer key the
	// running room is being kept from (REQ056), and with one it carries what the
	// room wrote. Gating the two readings differently would make the query
	// parameter part of the authorization, which is the one place a caller's own
	// input must not reach.
	.get(
		"/presentations/:id/deck.pdf",
		async ({ params, query, request }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;

			const exportedAt = new Date().toISOString();
			// The same read the workbook is built from, for both readings. A
			// deck-only PDF does not draw the aggregates it gathers, and gathering
			// them anyway is what keeps "the export never recomputes a tally" a
			// property of one code path rather than of two that have to agree.
			const input = await getResultsExport(params.id, { exportedAt });
			if (!input) return jsonError(404, "Not found");

			const includeResults = query.results !== "false";
			const pdf = await renderDeckDocument(
				buildDeckDocument({ ...input, includeResults }),
			);
			const filename = deckPdfFilename(
				input.presentation.title,
				exportedAt,
				includeResults,
			);
			return new Response(pdf, {
				headers: {
					"Content-Type": PDF_CONTENT_TYPE,
					"Content-Disposition": `attachment; filename="${filename}"`,
					// Same reason the workbook is uncacheable: a rendered session is a
					// snapshot of one still being run.
					"Cache-Control": "no-store",
				},
			});
		},
		{
			query: DeckPdfQuerySchema,
			detail: {
				tags: ["Results"],
				summary: "Render the deck to PDF, with or without its results",
				description:
					"Renders the whole deck as a self-contained PDF (REQ096): a cover page naming the deck and its counts, then one section per slide — what it asked, and what it offered to answer with (options and the marked answer key, scale statements, ranking and 100 Points items, grid axes, a guess range and its reference, form fields). `results=true` (the default) draws each slide's tally underneath it, as bars where the aggregation publishes a share of the whole and as a table where it does not; `results=false` renders the deck alone. The numbers are the same aggregation the results endpoints publish, flattened by the same function the XLSX export's Aggregates sheet is written from — never recomputed. Nothing outside the file is referenced: a slide's media is named by its URL rather than fetched, and the text is set in the PDF standard fonts, whose WinAnsi encoding folds text outside Latin-1 to its nearest unaccented form (REQ158). Requires `Authorization: Bearer <creatorToken>` (or deck ownership) for **both** readings — even without a tally the document carries every quiz answer key, including one a running question is still withholding from the room (REQ056). A results link (REQ098) does not open this route. Served as an attachment and marked `Cache-Control: no-store`.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── The shareable results link (REQ098) ────────────────
	//
	// One link per deck, minted and revoked by whoever can edit it. The secret
	// itself is returned once, by the mint, and stored only as a hash — so
	// "revoke" is clearing that hash, and the status read below can say whether a
	// link exists without being able to say what it is.
	.post(
		"/presentations/:id/results-link",
		async ({ params, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const link = await mintResultsLink(params.id);
			if (!link) {
				set.status = 404;
				return { error: "Not found" };
			}
			set.status = 201;
			return link;
		},
		{
			detail: {
				tags: ["Results"],
				summary: "Mint the deck's shareable results link",
				description:
					"Issues a read-only results link for the deck (REQ098) and returns its `resultsToken` **once** — only the token's SHA-256 hash is stored, so no later read can produce it again. The token grants exactly one thing: the deck's tallies through `GET /presentations/:id/results` and `/results/:slideId` under **every** reveal mode, including `private` and an unrevealed `on-click` (REQ015–REQ017). It authorizes no mutation, no spreadsheet export, no running question's answer key (REQ056), no presenter notes (REQ090) and no Form slide's per-participant rows (REQ061) — a caller holding only this token is refused or withheld from on every one of those exactly as an anonymous caller is. A deck holds **one** link: minting again issues a new secret and retires the previous one by the same act. Requires `Authorization: Bearer <creatorToken>` (or deck ownership).",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.delete(
		"/presentations/:id/results-link",
		async ({ params, request, set }) => {
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			const link = await revokeResultsLink(params.id);
			if (!link) {
				set.status = 404;
				return { error: "Not found" };
			}
			return link;
		},
		{
			detail: {
				tags: ["Results"],
				summary: "Revoke the deck's shareable results link",
				description:
					"Clears the deck's results link (REQ098). Immediate and total: the stored hash is the only thing that made the token answer, so the next request any copy of that link makes is refused with `401` — there is no expiry to wait out and no grace window. Because a deck holds one link, this retires every copy that was ever handed out, not one recipient's; re-mint and re-send to whoever should still have it. What it cannot reach is a results page already open, which keeps the numbers it was already sent until its next poll, and anything the holder has already read or copied down. Idempotent — revoking a deck with no link reports the state it is already in. Requires `Authorization: Bearer <creatorToken>` (or deck ownership).",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.get(
		"/presentations/:id/results-link",
		async ({ params, request }) => {
			// `requireEdit` hands back the fetched deck, which is everything the
			// status is read from — no second round trip to the store.
			const auth = await requireEdit(request, params.id);
			if (auth instanceof Response) return auth;
			return resultsLinkStatus(auth);
		},
		{
			detail: {
				tags: ["Results"],
				summary: "Read whether the deck has a results link",
				description:
					"Reports whether the deck currently has a results link (REQ098) and when it was minted. `resultsToken` is always an explicit `null` here (ADR-0024): the secret is stored only as a hash, so the mint is the one moment it exists in a response, and a browser that has lost its copy re-mints rather than re-reading it. `issuedAt` is what lets a surface tell the link it is holding from a newer one minted elsewhere. Requires `Authorization: Bearer <creatorToken>` (or deck ownership) — whether a deck hands out results is the organizer's business, not the room's.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Collaborators on the deck (REQ075) ─────────────────
	//
	// All four routes are **owner-only** (`requireDeckOwner`): who is on a deck is
	// its owner's decision, not something the edit token opens and not something a
	// collaborator can widen. What a grant then authorizes is enforced by
	// `requireEdit` on every mutation route above, which is where "not only in the
	// UI" is actually kept — nothing below is a control surface for it.
	.get(
		"/presentations/:id/collaborators",
		async ({ params, request }) => {
			const auth = await requireDeckOwner(request, params.id);
			if (auth instanceof Response) return auth;
			const grants = await listDeckCollaborators(params.id);
			return grants.map(readCollaborator);
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "List who the deck is shared with",
				description:
					"Returns the accounts this deck is shared with (REQ075), oldest grant first: each entry's `id` (the grant's own handle, used to change or revoke it), the collaborator's `email` and `name` as the owner invited them, the `level` (`view` / `comment` / `edit`), and when the grant was made and last changed. **No account identifier is ever in this payload** — the collaborator's user id stays server-side exactly as `creatorId` does. Owner-only: `401` without a session, `403` for anyone else including the holder of the deck's edit token and its own collaborators, since who else is on a deck is not a collaborator's to enumerate.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.post(
		"/presentations/:id/collaborators",
		async ({ params, body, request, server, set }) => {
			// Budgeted before the lookup, because the lookup is the oracle: a `404`
			// here and a `201` there tell an owner whether an address has an omul
			// account, which is defensible for an invite flow and indefensible at
			// full speed (REQ145). Keyed by the deck, so one deck cannot be used to
			// probe faster than the participant budget allows, on top of the
			// per-client-address ceiling every submission spends.
			const overLimit = guardSubmission(
				{ request, server },
				`share:${params.id}`,
			);
			if (overLimit) return overLimit;
			const auth = await requireDeckOwner(request, params.id);
			if (auth instanceof Response) return auth;
			// A grant names a **registered account**, so an address with none is a
			// refusal rather than a pending invitation this slice cannot deliver.
			const target = findUserByEmail(body.email);
			if (!target) {
				set.status = 404;
				return { error: "No account is registered with that email" };
			}
			if (target.id === (auth.creatorId as string | null)) {
				set.status = 400;
				return { error: "You already own this deck" };
			}
			const { created, grant } = await grantDeckAccess(
				params.id,
				target.id,
				body.level,
				(auth.creatorId as string | null) ?? null,
			);
			set.status = created ? 201 : 200;
			return readCollaborator(grant);
		},
		{
			body: ShareDeckSchema,
			detail: {
				tags: ["Presentations"],
				summary: "Share the deck with an account",
				description:
					"Shares the deck with a registered account at a stated level (REQ075): `view`, `comment` or `edit`, defaulting to `view` when the body omits it — a request that does not say what it is granting must not grant the strongest thing there is. Idempotent per account: sharing again with an address that already has a grant **changes that grant's level** rather than adding a second, and answers `200` instead of the `201` a new grant gets. The account is named by its login email and never by an id, because a caller is never handed one. `404` when no account is registered with that address (this endpoint does not send invitations or create accounts), `400` when the address is the deck's own owner. Owner-only: `401` without a session, `403` for the edit-token holder and for collaborators — sharing is not something a grant can widen. Rate-limited (REQ145): the `404`/`201` distinction reports whether an address has an account, so the route is budgeted per deck and per client address like the public writes are, and answers `429` with a `Retry-After` header over the limit.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.patch(
		"/presentations/:id/collaborators/:collaboratorId",
		async ({ params, body, request, set }) => {
			const auth = await requireDeckOwner(request, params.id);
			if (auth instanceof Response) return auth;
			const grant = await setCollaboratorLevel(
				params.id,
				params.collaboratorId,
				body.level,
			);
			if (!grant) {
				set.status = 404;
				return { error: "No such collaborator on this deck" };
			}
			return readCollaborator(grant);
		},
		{
			body: DeckAccessLevelBodySchema,
			detail: {
				tags: ["Presentations"],
				summary: "Change a collaborator's access level",
				description:
					"Moves one grant to another level (REQ075) — `view`, `comment` or `edit` — named by the grant's own `id` from the list endpoint. `level` is required here, unlike on the share endpoint: this request exists only to state one, so an absent level is a malformed request (`422`) rather than a silent demotion. Takes effect on the collaborator's very next request; nothing is cached and nothing was issued to them that could outlive the change. A grant id belonging to another deck answers `404`, so an id learned elsewhere cannot be used to write across decks. Owner-only, on the same terms as the share endpoint.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.delete(
		"/presentations/:id/collaborators/:collaboratorId",
		async ({ params, request, set }) => {
			const auth = await requireDeckOwner(request, params.id);
			if (auth instanceof Response) return auth;
			const removed = await revokeCollaborator(
				params.id,
				params.collaboratorId,
			);
			if (!removed) {
				set.status = 404;
				return { error: "No such collaborator on this deck" };
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Revoke a collaborator's access",
				description:
					"Removes one grant (REQ075), named by its own `id`. Immediate and total: the standing **is** the stored grant, so there is no token to expire, no cache to wait out and nothing the collaborator was handed that keeps working — their next request is refused exactly as a stranger's is, and the deck leaves their `GET /presentations/shared`. What it cannot reach is a page they already have open, which keeps what it was last sent until it next asks the server. A grant id belonging to another deck answers `404`. Owner-only, on the same terms as the share endpoint.",
				security: [{ bearerAuth: [] }],
			},
		},
	)

	// ── Comment threads on the deck's slides (REQ074) ──────
	//
	// The three routes an account on the deck reaches its threads through, and the
	// only three that touch the collection at all — which is what makes "never
	// visible to participants" a property of the storage model rather than of a
	// projection every future read site has to remember (see
	// `StoredSlideCommentSchema`). All three are gated by `requireDeckComments`,
	// which resolves standing from the **account** alone: no edit token, no
	// grandfathered legacy deck, and so nothing a link can be forwarded to.
	.get(
		"/presentations/:id/comments",
		async ({ params, request }) => {
			const auth = await requireDeckComments(request, params.id, {
				write: false,
			});
			if (auth instanceof Response) return auth;
			// The whole deck's conversation in one read, so a client can draw the
			// thread it is looking at and a count on every other slide without a
			// request per slide. Comments whose slide has since been authored off the
			// deck are left out: a thread nothing on screen is anchored to is not
			// something a client can draw or a reader can find.
			const slideIds = new Set(
				(auth.pres.slides as Slide[]).map((slide) => slide.id),
			);
			const comments = await listDeckComments(params.id);
			return comments
				.filter((comment) => slideIds.has(comment.slideId))
				.map((comment) => readSlideComment(comment, auth.userId));
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Read the deck's comment threads",
				description:
					"Returns every comment on the deck's slides (REQ074), oldest first, each carrying the `slideId` it is anchored to, its `body`, the author's display `name` as `authorName`, whether it is the caller's own (`mine`) and when it was written. The whole deck in one read, because the screen that consumes it draws one slide's thread and a count on the rest. **No account identifier is in this payload**, and no email either — a thread is read by every account on the deck, and who else is on it is not a collaborator's to enumerate (REQ075). Requires an **account** with standing on the deck: its owner, or any grant (`view`, `comment` or `edit`). `401` for a caller with no account — the deck's edit token is explicitly not standing here, since it is anonymous and forwardable — and `403` for an account the deck has not been shared with. No participant-facing payload carries a comment anywhere in this API.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.post(
		"/presentations/:id/comments",
		async ({ params, body, request, set }) => {
			const auth = await requireDeckComments(request, params.id, {
				write: true,
			});
			if (auth instanceof Response) return auth;
			// A comment is anchored to a slide, so it is refused when there is no
			// slide to anchor it to — rather than stored against an id that draws
			// nowhere and that no reader could ever find.
			const slides = auth.pres.slides as Slide[];
			if (!slides.some((slide) => slide.id === body.slideId)) {
				set.status = 404;
				return { error: "No such slide on this deck" };
			}
			const comment = await addSlideComment(
				params.id,
				body.slideId,
				auth.userId,
				body.body,
			);
			set.status = 201;
			return readSlideComment(comment, auth.userId);
		},
		{
			body: PostSlideCommentSchema,
			detail: {
				tags: ["Presentations"],
				summary: "Comment on one of the deck's slides",
				description:
					"Writes one comment onto one slide's thread (REQ074) and returns it as the caller now reads it. The body is trimmed and capped at 2000 characters, and stored **verbatim** otherwise — nothing here escapes or rewrites what was typed, because nothing downstream turns it into HTML (the same stance authored slide text takes, REQ088). `slideId` must name a slide the deck currently has, else `404`. Requires an account holding `comment` or `edit` on the deck, or owning it: a `view` collaborator reads the threads and is refused this with `403`, which is the first thing in this API that tells the two weaker levels apart. `401` for a caller with no account at all, the edit-token holder included — a comment has an author, and a forwardable token has nobody behind it to be recorded as.",
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.delete(
		"/presentations/:id/comments/:commentId",
		async ({ params, request, set }) => {
			// A read-level gate, because the write this authorizes is not a write to
			// the deck's conversation but the retraction of one line of it — the
			// account's own. Which line is theirs is decided against the stored row,
			// so a demoted author can still take back what they said and no level
			// change turns into somebody else's comment becoming deletable.
			const auth = await requireDeckComments(request, params.id, {
				write: false,
			});
			if (auth instanceof Response) return auth;
			const removed = await deleteSlideComment(
				params.id,
				params.commentId,
				auth.userId,
			);
			if (!removed) {
				set.status = 404;
				return { error: "No such comment of yours on this deck" };
			}
			return { ok: true };
		},
		{
			detail: {
				tags: ["Presentations"],
				summary: "Delete one of your own comments",
				description:
					"Removes one comment (REQ074), named by its own `id`. **Only the account that wrote it** can: taking back what you said is part of writing, while removing what somebody else said is moderation, which this slice does not implement — for anybody, the deck's owner included. A comment that belongs to another account, to another deck, or to nobody all answer the same `404`, so the route cannot be used to probe for one. Requires an account with standing on the deck (`401`/`403` on the same terms as reading the threads).",
				security: [{ bearerAuth: [] }],
			},
		},
	);
