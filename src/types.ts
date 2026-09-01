// ── Domain types shared across all pages ──────────────────────
//
// `server/schemas.ts` is the single source of truth for every shape that
// crosses the API boundary (ADR-0013). This module exists only to project
// those Zod schemas into client-facing types and to re-export the shared
// slide-type helpers — it deliberately hand-writes nothing.
//
// Construction vs. consumption: pages build slides incrementally in the
// editor before any default has been applied, so `Slide`/`SlideOption` are
// derived from the schema *input* type (defaulted fields stay optional).
// A `Presentation` is only ever received from the server, which now drives
// every response through the schema (ADR-0024), so it is derived from the
// *output* type where those same fields are guaranteed present.

import type { z } from "zod";
import type {
	BuiltInDeckThemeId,
	ChatMessageEntry,
	DeckAccessLevel,
	DeckBrand,
	DeckCollaborator,
	DeckFontId,
	DeckLogo,
	DeckTemplate,
	DeckTemplateCategory,
	DeckTemplateQuery,
	DeckThemeId,
	DeckThemeSettings,
	EmbedProvider,
	FormField,
	FormFieldOption,
	FormFieldType,
	McDisplayStyle,
	McValueDisplay,
	LiveRoomState,
	ParticipantChannelSettings,
	QAListEntry,
	QAVisibility,
	QuizAnswerMode,
	ReactionKind,
	ResultsLink,
	ResultsVisibility,
	SlideAppearance,
	SlideAppearanceSettings,
	SlideComment,
	SlideEmbed,
	SlideLayout,
	SlidePlacement,
	SlideResultsVisibility,
	SlideTextSize,
	SlideType,
	SlideVideo,
	TallyRevealState,
	WithheldTally,
} from "../server/schemas";
import {
	acceptedQuizAnswers,
	audienceViewBlanked,
	authoredColorFor,
	browserSafeAssetUrl,
	BUILT_IN_DECK_THEME_IDS,
	builtInDeckThemeIdFor,
	callerCanEditDeck,
	canMutateDeck,
	canReadDeckAuthoring,
	canReadDeckComments,
	canWriteDeckComments,
	CHAT_HISTORY_LIMIT,
	CHAT_TEXT_MAX_LENGTH,
	CONTENT_SLIDE_TYPES,
	correctGuessRangeFor,
	CUSTOM_DECK_THEME_ID,
	DECK_ACCESS_LEVELS,
	DECK_FONT_IDS,
	DECK_PROMPT_MAX_LENGTH,
	DECK_TEMPLATE_CATEGORIES,
	DECK_THEME_IDS,
	deckBrandColorFor,
	deckBrandFor,
	deckFilenameSlug,
	deckFontIdFor,
	deckLogoFor,
	deckTemplateMatchesSearch,
	deckTemplateSearchText,
	deckThemeIdFor,
	decodeFormSubmission,
	decodeGridPoint,
	decodeGuess,
	decodePinPoint,
	decodePoints,
	DEFAULT_DECK_FONT,
	DEFAULT_DECK_THEME,
	DEFAULT_SLIDE_PLACEMENT,
	describeFormSubmission,
	effectiveResultsVisibility,
	EMBED_PROVIDERS,
	encodeFormSubmission,
	encodeGridPoint,
	encodeGuess,
	encodePinPoint,
	encodePoints,
	encodeRanking,
	EMPTY_DECK_BRAND,
	filterDeckTemplates,
	FORM_ANSWER_MAX_LENGTH,
	FORM_FIELD_LIMIT,
	FORM_FIELD_OPTION_LIMIT,
	type FormFieldOptionSchema,
	type FormFieldSchema,
	formFieldsFor,
	GRID_ITEM_LIMIT,
	type GridAxis,
	type GridItemSchema,
	type GuessBucket,
	type GuessRange,
	type GuessReference,
	gridAxesFor,
	guessBucketsFor,
	guessRangeFor,
	guessReferenceFor,
	highestGuessValue,
	INTERACTIVE_SLIDE_TYPES,
	isContentSlideType,
	isCorrectQuizAnswer,
	isFormEmail,
	isInteractiveSlideType,
	isMultiSelect,
	isPinInArea,
	isQuizWindowOpen,
	isReachableGuessReference,
	isStandingQuizAnswer,
	isUsableFormField,
	isUsableGuessRange,
	isUsablePinArea,
	isWithheldTally,
	LEADERBOARD_DEFAULT_SIZE,
	LEADERBOARD_SIZE_LIMIT,
	type LeaderboardEntry,
	leaderboardEntryLabel,
	leaderboardSizeFor,
	matchesQuizAnswer,
	type MultipleChoiceOptionSchema,
	middleGuessValue,
	maxResponsesFor,
	maxSelectionsFor,
	normalizeParticipantName,
	normalizeQuizAnswer,
	orderChatMessages,
	orderParticipantRoster,
	PARTICIPANT_NAME_MAX_LENGTH,
	PIN_COORDINATE_MAX,
	type PinArea,
	type PinAreaSchema,
	pinAreaFor,
	pinImageFor,
	POINTS_BUDGET,
	POINTS_ITEM_LIMIT,
	type PointsItemSchema,
	participantChannelsFor,
	deckRequiresParticipantName,
	type ParticipantNameSettings,
	type ParticipantRosterEntry,
	type PresentationSchema,
	PREVIEW_DEFAULT_RESPONDENTS,
	PREVIEW_RESPONDENT_LIMIT,
	QA_TEXT_MAX_LENGTH,
	qaListVisibleToAudience,
	qaSettingsFor,
	QUIZ_ANSWER_LIMIT,
	QUIZ_CORRECT_POINTS,
	QUIZ_MAX_POINTS,
	QUIZ_SPEED_POINTS,
	type QuizAnswerSchema,
	quizAnswerModeFor,
	quizDeadlineFor,
	quizRemainingMs,
	quizTimeLimitFor,
	RANKING_ITEM_LIMIT,
	type RankingItemSchema,
	REACTION_KINDS,
	readFormSubmission,
	recentChatMessages,
	RESULTS_TOKEN_HEADER,
	type ScaleLabelSchema,
	type ScaleStatementSchema,
	scoreQuizAnswer,
	SLIDE_COMMENT_MAX_LENGTH,
	SLIDE_ITEM_TEXT_MAX_LENGTH,
	SLIDE_LAYOUTS,
	SLIDE_LIMIT,
	SLIDE_MEDIA_URL_MAX_LENGTH,
	SLIDE_OPTION_LIMIT,
	SLIDE_TEXT_MAX_LENGTH,
	SLIDE_TYPE_LABELS,
	type SlideSchema,
	slideAppearanceFor,
	slideEmbedFor,
	slideHasCorrectAnswers,
	slideHasResults,
	slideMediaIsInteractionArea,
	slideTextSizeFor,
	slideVideoFor,
	slideWriteRefusalFor,
	snapGuessToGrid,
	slideAcceptsSubmissions,
	slideAnswersAreDeletable,
	tallyVisibleToAudience,
	VOTE_REFUSAL_CODES,
	VOTE_VALUE_MAX_LENGTH,
	type VoteRefusalCode,
	isVoteRefusalCode,
	voteValueLimitFor,
	withAudienceSlides,
	withAudienceSolutions,
	withFreshSlideIds,
	withheldTally,
	withInheritedResultsVisibility,
	withSlideParticipation,
	withoutPresenterNotes,
	WORKSPACE_NAME_MAX_LENGTH,
	WORKSPACE_ROLES,
	type Workspace,
	type WorkspaceMember,
	type WorkspaceRole,
	canAdministerWorkspace,
	canAdministerWorkspaceDecks,
	canCreateWorkspaceDecks,
	canManageWorkspaceMembers,
	canReadWorkspace,
	DEFAULT_WORKSPACE_ROLE,
	workspaceDeckAccessLevel,
} from "../server/schemas";

/**
 * What generating a deck from a prompt looks like from a browser (REQ007).
 *
 * Type-only, and deliberately: `server/deck-generator.ts` reaches a model
 * provider, and nothing on the client has any business importing a value from
 * it. What the client needs is the *shape* of the capability report it reads
 * from `GET /api/deck-generation` — which is the schema's, like every other
 * shape crossing this boundary (ADR-0013).
 */
export type {
	DeckGenerationAvailability,
	GeneratedSlideType,
} from "../server/deck-generator";

/**
 * Breaking a slide's results down by an earlier slide's answers (REQ020,
 * REQ116).
 *
 * Composed rather than restated, values and all: `server/segmentation.ts` is the
 * one guard the endpoint runs, so a picker built from anything else would offer
 * groupings the API refuses — or, worse, hide ones it would have allowed. It
 * reaches for `./schemas` and nothing else, so the browser can hold it (ADR-0032
 * — a unit of code lives where its dependencies are), exactly as it holds the
 * slide-type and reveal-mode rules above.
 */
export {
	SEGMENT_MIN_RESPONDENTS,
	SEGMENT_REFUSAL_REASONS,
	segmentSourcesFor,
} from "../server/segmentation";
export type { SegmentRefusal, SegmentSource } from "../server/segmentation";

export type {
	BuiltInDeckThemeId,
	ChatMessageEntry,
	DeckAccessLevel,
	DeckBrand,
	DeckCollaborator,
	DeckFontId,
	DeckLogo,
	DeckTemplate,
	DeckTemplateCategory,
	DeckTemplateQuery,
	DeckThemeId,
	DeckThemeSettings,
	EmbedProvider,
	FormField,
	FormFieldOption,
	FormFieldType,
	GridAxis,
	LeaderboardEntry,
	LiveRoomState,
	GuessBucket,
	GuessRange,
	GuessReference,
	McDisplayStyle,
	McValueDisplay,
	ParticipantChannelSettings,
	ParticipantNameSettings,
	ParticipantRosterEntry,
	PinArea,
	QAListEntry,
	QAVisibility,
	QuizAnswerMode,
	ReactionKind,
	ResultsLink,
	ResultsVisibility,
	SlideAppearance,
	SlideAppearanceSettings,
	SlideComment,
	SlideEmbed,
	SlideLayout,
	SlidePlacement,
	SlideResultsVisibility,
	SlideTextSize,
	SlideType,
	SlideVideo,
	TallyRevealState,
	VoteRefusalCode,
	WithheldTally,
	Workspace,
	WorkspaceMember,
	WorkspaceRole,
};
export {
	acceptedQuizAnswers,
	audienceViewBlanked,
	authoredColorFor,
	browserSafeAssetUrl,
	BUILT_IN_DECK_THEME_IDS,
	builtInDeckThemeIdFor,
	callerCanEditDeck,
	canMutateDeck,
	canReadDeckAuthoring,
	canReadDeckComments,
	canWriteDeckComments,
	CHAT_HISTORY_LIMIT,
	CHAT_TEXT_MAX_LENGTH,
	CONTENT_SLIDE_TYPES,
	correctGuessRangeFor,
	CUSTOM_DECK_THEME_ID,
	DECK_ACCESS_LEVELS,
	DECK_FONT_IDS,
	DECK_PROMPT_MAX_LENGTH,
	DECK_TEMPLATE_CATEGORIES,
	DECK_THEME_IDS,
	deckBrandColorFor,
	deckBrandFor,
	deckFilenameSlug,
	deckFontIdFor,
	deckLogoFor,
	deckTemplateMatchesSearch,
	deckTemplateSearchText,
	deckThemeIdFor,
	decodeFormSubmission,
	decodeGridPoint,
	decodeGuess,
	decodePinPoint,
	decodePoints,
	DEFAULT_DECK_FONT,
	DEFAULT_DECK_THEME,
	DEFAULT_SLIDE_PLACEMENT,
	describeFormSubmission,
	effectiveResultsVisibility,
	EMBED_PROVIDERS,
	encodeFormSubmission,
	encodeGridPoint,
	encodeGuess,
	encodePinPoint,
	encodePoints,
	encodeRanking,
	EMPTY_DECK_BRAND,
	filterDeckTemplates,
	FORM_ANSWER_MAX_LENGTH,
	FORM_FIELD_LIMIT,
	FORM_FIELD_OPTION_LIMIT,
	formFieldsFor,
	GRID_ITEM_LIMIT,
	gridAxesFor,
	guessBucketsFor,
	guessRangeFor,
	guessReferenceFor,
	highestGuessValue,
	INTERACTIVE_SLIDE_TYPES,
	isContentSlideType,
	isCorrectQuizAnswer,
	isFormEmail,
	isInteractiveSlideType,
	isMultiSelect,
	isPinInArea,
	isQuizWindowOpen,
	isReachableGuessReference,
	isStandingQuizAnswer,
	isUsableFormField,
	isUsableGuessRange,
	isUsablePinArea,
	isWithheldTally,
	LEADERBOARD_DEFAULT_SIZE,
	LEADERBOARD_SIZE_LIMIT,
	leaderboardEntryLabel,
	leaderboardSizeFor,
	matchesQuizAnswer,
	maxResponsesFor,
	maxSelectionsFor,
	middleGuessValue,
	deckRequiresParticipantName,
	normalizeParticipantName,
	normalizeQuizAnswer,
	orderChatMessages,
	orderParticipantRoster,
	PARTICIPANT_NAME_MAX_LENGTH,
	participantChannelsFor,
	PIN_COORDINATE_MAX,
	pinAreaFor,
	pinImageFor,
	POINTS_BUDGET,
	POINTS_ITEM_LIMIT,
	PREVIEW_DEFAULT_RESPONDENTS,
	PREVIEW_RESPONDENT_LIMIT,
	QA_TEXT_MAX_LENGTH,
	qaListVisibleToAudience,
	qaSettingsFor,
	QUIZ_ANSWER_LIMIT,
	QUIZ_CORRECT_POINTS,
	QUIZ_MAX_POINTS,
	QUIZ_SPEED_POINTS,
	quizAnswerModeFor,
	quizDeadlineFor,
	quizRemainingMs,
	quizTimeLimitFor,
	RANKING_ITEM_LIMIT,
	REACTION_KINDS,
	readFormSubmission,
	recentChatMessages,
	RESULTS_TOKEN_HEADER,
	scoreQuizAnswer,
	SLIDE_COMMENT_MAX_LENGTH,
	SLIDE_ITEM_TEXT_MAX_LENGTH,
	SLIDE_LAYOUTS,
	SLIDE_LIMIT,
	SLIDE_MEDIA_URL_MAX_LENGTH,
	SLIDE_OPTION_LIMIT,
	SLIDE_TEXT_MAX_LENGTH,
	SLIDE_TYPE_LABELS,
	slideAcceptsSubmissions,
	slideAnswersAreDeletable,
	slideAppearanceFor,
	slideEmbedFor,
	slideHasCorrectAnswers,
	slideHasResults,
	slideMediaIsInteractionArea,
	slideTextSizeFor,
	slideVideoFor,
	slideWriteRefusalFor,
	snapGuessToGrid,
	tallyVisibleToAudience,
	VOTE_REFUSAL_CODES,
	VOTE_VALUE_MAX_LENGTH,
	isVoteRefusalCode,
	voteValueLimitFor,
	withAudienceSlides,
	withAudienceSolutions,
	withFreshSlideIds,
	withheldTally,
	withInheritedResultsVisibility,
	withSlideParticipation,
	withoutPresenterNotes,
	// Workspaces (REQ128, REQ129). The role predicates are composed rather than
	// restated for the reason every other rule above is: what a role may do is one
	// decision, made in `server/schemas.ts` and enforced on every workspace-scoped
	// mutation, and a surface that re-derived it by comparing role strings would
	// eventually disagree with the server about who may press a button.
	WORKSPACE_NAME_MAX_LENGTH,
	WORKSPACE_ROLES,
	canAdministerWorkspace,
	canAdministerWorkspaceDecks,
	canCreateWorkspaceDecks,
	canManageWorkspaceMembers,
	canReadWorkspace,
	DEFAULT_WORKSPACE_ROLE,
	workspaceDeckAccessLevel,
};

export type SlideOption = z.input<typeof MultipleChoiceOptionSchema>;
export type ScaleStatement = z.input<typeof ScaleStatementSchema>;
export type ScaleLabel = z.input<typeof ScaleLabelSchema>;
export type RankingItem = z.input<typeof RankingItemSchema>;
export type GridItem = z.input<typeof GridItemSchema>;
export type PointsItem = z.input<typeof PointsItemSchema>;
/**
 * One field of a Form slide as the editor holds it (REQ061), and one option of a
 * `choice` field. The *input* shape, like every other authoring type here: a
 * field exists half-authored — a label typed, no type chosen yet — before it is
 * something the schema would accept.
 */
export type FormFieldInput = z.input<typeof FormFieldSchema>;
export type FormFieldOptionInput = z.input<typeof FormFieldOptionSchema>;
/**
 * The target area of a Pin on Image question as the editor holds it (REQ053).
 * The *input* shape, like every other authoring type here: an area is built by
 * dragging a box across the picture, so it exists half-drawn before it is a
 * rectangle the schema would accept.
 */
export type PinAreaInput = z.input<typeof PinAreaSchema>;
/** One solution a typed quiz answer is accepted against (REQ055). */
export type QuizAcceptedAnswer = z.input<typeof QuizAnswerSchema>;
export type OpenTextLayout = NonNullable<
	z.input<typeof SlideSchema>["openTextLayout"]
>;
export type PresentationMode = NonNullable<
	z.input<typeof PresentationSchema>["mode"]
>;

/** A slide as built/edited on the client — defaulted fields stay optional. */
export type Slide = z.input<typeof SlideSchema>;

/**
 * A presentation as received from the API. Server responses are parsed through
 * the schema, so the persisted fields are fully populated (the output shape).
 * `participantCount` (derived from live WebSocket connections) and the
 * one-time `creatorToken` are added by the route on top of the schema and are
 * therefore optional here.
 */
export type Presentation = Omit<
	z.infer<typeof PresentationSchema>,
	"slides"
> & {
	slides: Slide[];
	participantCount?: number;
	/** Only present in the POST /presentations creation response — store it in localStorage. */
	creatorToken?: string;
	/**
	 * What this browser's caller may do with the deck (REQ075), as the server
	 * resolved it on the response that carried the deck: `edit` for its owner, the
	 * holder of its edit token and an account it is shared with at `edit`;
	 * `comment` or `view` for a weaker grant; `null` for no standing at all.
	 *
	 * A **report**, never a credential — every gated route re-resolves it from the
	 * request's own credentials, so a client that got this wrong only mis-draws its
	 * own buttons. Optional here because the routes that hand a deck to the *room*
	 * (the join door, the public list) do not report one, and a surface that reads
	 * it must treat its absence as "no standing".
	 */
	accessLevel?: DeckAccessLevel | null;
	/**
	 * What this caller's **account** may do with the deck (REQ074) — the standing
	 * its comment threads are gated on, which refuses the edit token: a comment
	 * has an author, and a forwardable token has no account behind it. `null` for
	 * the token holder with no account, where `accessLevel` reads `edit` — gating
	 * a comment surface on `accessLevel` instead of this fires reads the server
	 * is guaranteed to refuse. A report on the same terms as `accessLevel`.
	 */
	commentAccess?: DeckAccessLevel | null;
};
