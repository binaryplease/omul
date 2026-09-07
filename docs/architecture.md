# Architecture

Tech stack, project layout, and storage model. See [api.md](api.md) for the
HTTP/WS surface and auth model, [deployment.md](deployment.md) for packaging
and environment variables, and [frontend.md](frontend.md) for UI conventions.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | |
| Server | Elysia | The project's default server framework. Built-in WebSocket support. |
| Validation | Zod | Route validation via Elysia's Standard Schema support; schema types in `server/schemas.ts` |
| Database | `@binaryplease/zodstore` | Native `bun:sqlite` + Zod document store, installed from npm (MIT). Persists to one SQLite file at `$DATABASE_PATH` (default `data/omul.sqlite`; `:memory:` for an ephemeral store). In-process — no database service to run. |
| Auth | Better Auth (email + password) + `@better-auth/api-key` | User accounts + personal API keys, embedded in the Elysia server on a **dedicated `bun:sqlite`** file (`$OMUL_AUTH_DB`) — a documented deviation from the Mongo store Better Auth would otherwise use, for the single-node reason this product is built around. See [api.md — Auth model](api.md#auth-model). |
| Email | Brevo v3 HTTP API + React Email | Transactional mail (password reset, verification, change-email). Bodies authored as React components in `server/emails/`, rendered by `server/email.ts`. Disabled-mode logs instead of sending. |
| Deck generation | Vercel AI SDK (`ai`) + `@ai-sdk/google` | **Optional and off by default.** The only part of the product that talks to anything outside the deployment (REQ007) — an intentional, documented exception to the rule that production depends on no third-party runtime host, since the remote model *is* the feature. Loaded by a dynamic import inside the one function that calls it, so nothing else resolves it. See [deployment.md](deployment.md#generating-a-deck-from-a-prompt-req007) |
| Frontend | React 19 | |
| Styling | Tailwind CSS v4 | |
| Build | Vite (`bunx vite build`) + Bun bundler (server) | `vite.config.ts`; frontend → `dist/client/`, server → `dist/server/` |
| Dev env | mise | `.mise.toml` declares tool versions, env vars, and tasks |

## Project structure

```
server/
  index.ts                   # Elysia app; mounts discovery, /api/auth + admin routes; WS handler; static serving (prod only)
  schemas.ts                 # Zod schemas + TypeScript types (server-side); includes the Stored* storage schemas
  db.ts                      # zodstore store + async Store factory (createStore)
  ws.ts                      # WebSocket broadcaster (room-based)
  accounts.ts                # Better Auth instance (email+password + API keys, bun:sqlite); ensureAuthSchema, resolveUserId, findUserByEmail, resolveSessionAccount
  email.ts                   # Brevo v3 transactional-email sender + async template builders (render React Email components)
  emails/                    # React Email templates (theme, shell, action-link, password-reset, verification, change-email) + preview registry
  templates.ts               # The built-in deck templates (REQ005) + what copying one means (REQ006). Content plus two pure functions; no store, no collection — the catalog is code, read-only at runtime
  deck-generator.ts          # Drafting a deck from a prompt (REQ007). Its own module for the reason templates.ts is: it depends on a model provider and the slide vocabulary, on nothing the presentation service owns. What a generator may author is a closed set of slide types, and what it may NOT is the requirement's draft rule — there is no field in its schema that can mark an answer correct. Strict in what the provider is asked, forgiving in what is read back
  preview.ts                 # Test-vote generator (REQ104) — deterministic, store-less, returns rows it never writes
  results-export.ts          # Results workbook builder (REQ095) — pure model out of deck + rows + aggregates; the only exceljs site
  deck-pdf.ts                # Deck-to-PDF renderer (REQ096) — same input as the workbook, plus "with or without results"; pure document model + a flow that breaks it onto pages; the only pdf-lib site. Reads the workbook's own aggregate flattening rather than a second one
  segmentation.ts            # Breaking a tally down by an earlier slide's answers (REQ020/REQ116) — the join on participant id, and the one descriptor of which slides may group which. Depends on schemas.ts alone, so the browser composes the same rule the endpoint enforces. Computes no tally: the service feeds each group through the ordinary aggregation
  admins.ts                  # Hardcoded admin-email allowlist + isAdminEmail
  admin-events.ts            # bun:sqlite admin store: append-only audit log + two-step action-confirmation lifecycle
  rate-limit.ts              # Abuse limits (REQ145): in-process sliding window + the create/join/submission route guards; a client is an IPv4 address or an IPv6 /64, and the boot posture is printed because a proxied deployment that distrusts its proxy is otherwise invisible
  proxy-trust.ts             # What this server believes a proxy told it (OMUL_TRUST_PROXY): the hop count, and the value a trusted hop wrote into a forwarded header. Shared by the limiter's client address and the discovery index's origin, so the two cannot disagree about what is trusted
  keyed-lock.ts              # In-process queue for read-modify-write sections sharing a key (REQ147): keeps a quiz answer final under concurrent submissions
  store-path.ts              # Which SQLite file this instance opens: one reading of DATABASE_PATH and one default basename that db.ts / accounts.ts / admin-events.ts all hang off, so the path is not spelled out three times
  app-paths.ts               # Where this app lives on a host it shares with the marketing site (REQ179): the base its home page and built assets moved under, and the root-level prefixes it kept — `/join/*` above all, because that link is read aloud to a room. Dependency-free, because the build (vite.config.ts), the static handler and the client router all have to agree on it
  test-preload.ts            # bunfig.toml test preload — switches the abuse limits off for the test run
  routes/
    discovery.ts             # GET /api discovery index + /api/health, and the public origin its absolute links carry (REQ151): OMUL_BASE_HOST, else a trusted X-Forwarded-Proto/Host, else the origin observed
    templates.ts             # GET /api/templates (+ /:id) — the *built-in* catalog, listed and filtered (REQ005). Public and read-only; creating *from* an entry is a presentation create. What a workspace publishes for itself (REQ004) is written and read against its roster and lives with the workspace routes
    deck-generation.ts       # GET /api/deck-generation (can this build generate, and on what terms — read before the control is drawn) + POST (a prompt in, an ordinary deck out, REQ007). A factory over the generator rather than a bare instance, which is what lets the whole HTTP path be tested with no key and no network
    presentations.ts         # Presentation REST endpoints (owner-or-edit-token auth, claim, /mine); POST also takes a `templateId` (REQ006), a `workspaceId` (REQ128) and a `workspaceTemplateId` (REQ004), and the deck's move between an account and a workspace lives here because it is a presentation mutation
    workspaces.ts            # /api/workspaces/* (REQ128, REQ129, REQ004) — the workspace, its roster, the decks it owns and the templates it publishes. Every route asks two questions and never mixes them: is this caller in this workspace at all (401 vs 403, and no existence leaked), and does their role authorize this
    admin.ts                 # /api/admin/* operator surface (prepare/confirm actions + events)
    static.ts                # SPA static file serving (production only, dist/client/), and the server half of the path split (REQ179): assets under /app/, index.html for the app's own pages, 404 for anything at the root the app does not own — because on a shared host that belongs to the marketing site
  services/
    presentations.ts         # Business logic (async); authorizeEdit / claimOwnership / assignOwner ownership helpers
    collaborators.ts         # One account's standing on one deck (REQ075) — the grants collection and nothing else
    workspaces.ts            # An owner of decks that is not an account, and the roles in it (REQ128, REQ129) — two collections and nothing else. Imports no presentation service, so the presentation service can ask it "what may this account do with a deck this workspace owns?" without a cycle; which decks a workspace owns is a question about the presentations collection and is answered there
    workspace-templates.ts   # The templates a workspace publishes out of its own decks (REQ004) — one collection, and everything it needs of a workspace is the id. Reads and writes no presentation: it is handed slides already copied and hands them back the same way, which is the whole of the requirement's independence
    slide-comments.ts        # The authoring conversation on a deck's slides (REQ074) — its own collection, read by its own routes
    participant-names.ts     # What each participant is called on a deck (REQ076) — one row per (deck, participant), corrected in place. Owns the collection; decides neither whether the deck asks for a name nor who may read the list, both of which are the deck's questions and are answered where the deck is fetched

src/
  index.html                 # HTML entry point (Vite root: src/)
  index.tsx                  # React mount
  index.css                  # Tailwind v4 + design system tokens
  App.tsx                    # Thin router shell
  api.ts                     # Client-side fetch + WebSocket helpers; listMyPresentations / claimLocalPresentations
  storage.ts                 # Every localStorage key this browser holds, declared once and imported at every read site — these keys hold the only copy of a deck's edit token (REQ175), so a key a refactor gets wrong is a presentation nobody can edit again
  download.ts                # Saving a file from the browser: saveBlobAs, filenameFromContentDisposition (the title→filename slug is deckFilenameSlug in server/schemas.ts)
  auth-client.ts             # Better Auth browser client (useSession / signIn / signUp / … / apiKey)
  auth.tsx                   # Header auth controls: sign in/up, reset/verify/change-email landings, verify banner, account settings, API-key manager
  constants.ts               # POLL_COLORS and other shared constants
  router.ts                  # Route type, navigate, getInitialRoute, usePageTitle — and the two pure halves under them, routeForLocation / pathForRoute, which is where the split of REQ179 is spelled: home under /app, every link somebody may already hold still at the root
  types.ts                   # Shared TypeScript types (client-side)
  components/
    Results.tsx              # ResultsDisplay component
    SegmentedResults.tsx     # One slide's tally re-drawn per group of the room, as an earlier slide's answers divide it (REQ020/REQ116). The picker composes ChoiceCards, the groups compose ResultsDisplay, and the eligibility rule is the server's own
    PresenterSlideView.tsx   # The shared screen's slide — presenter page + preview pane (REQ103)
    ParticipantSlideView.tsx # A participant's slide + the vote transport — participant page + preview pane (REQ103/REQ104)
    ParticipantName.tsx      # The name a deck can ask for at its door (REQ076): the gate a phone answers it on, the badge that reports it back, and the organizer's roster of who took part — one module, because what both ends share is what a participant is called on this deck
    LiveRoom.tsx             # The live room's two switches (REQ111/REQ109): whether the slide on screen takes answers, and whether the shared screen is showing anything — the presenter's controls, and the participant's gate
    HighlightedText.tsx      # Marks the searched-for term inside a result
    PreviewLink.tsx          # The way into a preview, from the editor and the presenter's screen
    ResultsLinkDialog.tsx    # Mint / copy / revoke the deck's read-only results link (REQ098)
    ExportDialog.tsx         # Every shape the session leaves in (REQ095/REQ096): one descriptor of the formats, one dialog composing it
    SlideCanvas.tsx          # The editor's stage: the slide as the room will see it, themed and captioned (REQ152)
    SlidePreview.tsx         # The stage's renderer, composed only by SlideCanvas (not REQ103's preview)
    SlideTypeIcon.tsx        # SlideTypeIcon component
    WorkspaceRoles.tsx       # What a workspace role means in words (REQ129) — one descriptor, composed by the roster's picker, the workspace card's badge and the add-member line
    MoveToWorkspaceDialog.tsx # Handing one of your decks to a workspace (REQ128), from the deck's own card. The other direction lives on the workspace's page
    TemplateCard.tsx         # One template on a card, and the words for its five categories — the descriptor two galleries share, because a template a workspace published (REQ004) *is* a catalog entry (REQ005) plus a publisher. Each surface passes its own actions as children
    PublishTemplateDialog.tsx # Publishing one of a workspace's decks as its template (REQ004), from the deck's own card: everything about the gallery entry except the slides, which are the deck's and are copied server-side
    ui/
      ConfirmModal.tsx
      Modal.tsx              # Generic titled dialog shell (used by the auth surfaces)
      Icons.tsx
      Loading.tsx
      QRCode.tsx
      StatusBadge.tsx
      Theme.tsx              # ThemeProvider + ThemeToggle; exports useTheme
      Toast.tsx              # ToastProvider; exports useToast
  pages/
    HomePage.tsx
    WorkspacesPage.tsx       # The workspaces this account is in (REQ128) — and creating one
    WorkspacePage.tsx        # One workspace: the decks it owns, the templates it publishes (REQ004) and who is in it, on one screen because they are views of one question. Every control is drawn for every member and disabled with its reason when their role does not open it
    TemplatesPage.tsx        # The built-in prebuilt-deck gallery (REQ005) — filtered in the browser with the endpoint's own filter, and the way into a deck from one (REQ006)
    GeneratePage.tsx         # Drafting a deck from a prompt (REQ007) — the brief, the draft caveat above the box it qualifies, and the control drawn disabled with its reason on a build with no provider configured
    CreatePage.tsx
    PresenterPage.tsx
    PreviewPage.tsx          # Preview mode (REQ103) — both perspectives side by side, test-vote controls
    SharedResultsPage.tsx    # /results/:id — the read-only results surface a results link opens (REQ098)
    JoinPage.tsx
    ParticipantPage.tsx

public/
  brand/                     # The drawn omul mark (REQ167), served as static assets by Vite
    omul-wordmark.svg        #   primary form, ink
    omul-wordmark-invers.svg #   inverse form, paper
    omul-icon-ring.svg       #   closed-ring signet — tab icon, tile, avatar
    omul-icon-offener-ring.svg # open-ring signet — supplied, not yet wired to a surface
    *.png                    #   raster exports (wordmarks 2400px, signets 512px)
```

## Database

Storage is [`@binaryplease/zodstore`](https://www.npmjs.com/package/@binaryplease/zodstore)
— a native `bun:sqlite` + Zod document store, installed from npm under the MIT
License. It is synchronous and in-process; the whole store is one SQLite file at
`$DATABASE_PATH`. To update the library, bump the version like any other
dependency; its changelog ships in the package
(`node_modules/@binaryplease/zodstore/CHANGELOG.md`).

Until 2026-08-31 an older, pre-release snapshot of the same library was vendored
at `vendor/binp-docstore/` as a `file:` dependency. Nothing under `vendor/`
remains — the license position is [NOTICE.md §2](../NOTICE.md).

Collections (each one Zod-gated SQLite table of `(id TEXT PRIMARY KEY, doc TEXT)`):
- `presentations` — one document per presentation; slides embedded as array. Gated by `StoredPresentationSchema`.
- `votes` — one document per vote; queried by `{ presentationId, slideId, … }`. Gated by `StoredVoteSchema`.
- `responseVotes` — one document per open-ended upvote (REQ025). Gated by `StoredResponseVoteSchema`.
- `qaQuestions` — one document per question asked on the deck-wide Q&A layer (REQ036). Keyed by `presentationId`, **not** by slide: the layer takes questions from whatever is on screen, so a question belongs to the presentation. Gated by `StoredQAQuestionSchema`.
- `qaUpvotes` — one document per participant upvote on such a question (REQ060). Gated by `StoredQAUpvoteSchema`.
- `deckCollaborators` — one document per (deck, account) sharing grant (REQ075), carrying the level it was shared at. Indexed on **both** ends because both are read: a deck asks who is on it, an account asks which decks it is on. Gated by `StoredDeckCollaboratorSchema`; owned by `server/services/collaborators.ts`.
- `participantNames` — one document per (deck, participant) name stated on joining (REQ076). A collection rather than a field on each vote for the reason a name is one fact about a person: denormalising it would make correcting a typo a rewrite of every answer already given, and a rewrite that missed one would put the same person in the export twice under two spellings. The join is `participantId`, which every stored row already carries. Gated by `StoredParticipantNameSchema`; owned by `server/services/participant-names.ts`. Swept by `eraseParticipantRecords`, so a **reset** takes it as well as a delete — a re-run is a different room.
- `workspaces` — one document per workspace (REQ128): an owner of decks that is not an account. A deck it owns names it in `workspaceId` and carries **no** `creatorId` and no `creatorTokenHash` — the two ownership fields are alternatives rather than layers, which is what makes a deck survive any single member's removal. Gated by `StoredWorkspaceSchema`; owned by `server/services/workspaces.ts`.
- `workspaceMembers` — one document per (workspace, account) membership (REQ129), carrying the role it was added at. Indexed on **both** ends because both are read, and the second constantly: a workspace asks who is in it, and every request touching one of its decks asks what this account's role is. The pair is unique, so "what may this account do here?" has one answer. Gated by `StoredWorkspaceMemberSchema`; owned by `server/services/workspaces.ts`.
- `workspaceTemplates` — one document per template a workspace has published out of one of its own decks (REQ004), holding a **copy** of that deck's slides taken at publish time. A collection rather than a field on the workspace because a workspace holds many and each is a deck's worth of slides. The (workspace, source deck) pair is unique, so publishing the same deck again refreshes its entry rather than stacking a second beside it, and the copy on the way in — plus a second copy on the way out, when a deck is created from the entry — is the whole of "the instance is an independent deck; later edits to the template do not reach it". Gated by `StoredWorkspaceTemplateSchema`; owned by `server/services/workspace-templates.ts`, and swept when the workspace is deleted.
- `slideComments` — one document per comment on a slide (REQ074), keyed by `presentationId` and `slideId` and carrying the account that wrote it. A collection rather than a field on the presentation document *because* of the requirement's second half: the deck document is what `GET /join/:code` and every `slide.changed` broadcast are projections of, so a comment stored on it would be one forgotten projection away from the room — here there is nothing to strip, since no participant-facing surface loads this collection at all. Gated by `StoredSlideCommentSchema`; owned by `server/services/slide-comments.ts`.

The `Stored*` schemas live in `server/schemas.ts` (the single source of truth
for every shape that crosses a boundary) and give every non-identity field a
`.default(...)` so the shape grows
without a migration: old rows read forward with defaults filling any
gap. Identity fields (`id` and the presentation/slide/response references) carry
no default and fail loudly when absent.
`server/stored-defaults.test.ts` enforces that over every collection, with each
one's identity fields named.

`server/db.ts` exports `createStore(name, schema, { indexes })` which wraps one
zodstore collection behind an **async** `Store` (`insert`, `update`, `remove`,
`findOne`, `find`, `deleteMany`) so the service layer is storage-agnostic. Plain
equality `filter` objects map directly onto the store's typed where-clause (a
bare value is shorthand for `eq`). `connectDb()` / `closeDb()` open and close the
underlying SQLite connection.

Two of the library's defaults are deliberately not taken, both in `server/db.ts`
and both commented there:

- **`maxRows: null`** — the library caps a `find()` that names no `limit` at
  10 000 rows and throws rather than truncating. Every read here is already
  narrowed by a presentation id, and one large event crosses that legitimately
  (1 000 participants over ten slides is 10 000 rows of `votes` for one deck),
  so the cap would turn that event into a 500.
- **`enforceDefaults: false`** — the library's own defaults walk recognises an
  identity field by the schema object its `ref()` helper returns, and `ref()`
  requires a `prefix_` on the stored value. This catalog's foreign keys are
  plain `z.string()` over `crypto.randomUUID()`, so the walk reads all twenty
  of them — nine distinct names over ten of the twelve collections — as fields
  that forgot a default. The rule is enforced instead by
  `server/stored-defaults.test.ts`, which spells the exemption out per
  collection — and, so that a hand-written list cannot silently fall behind the
  code, checks its own completeness against the collection names `createStore`
  actually opened (`openedCollectionNames()`).

Documents use a string `id` field (UUID) as primary key.
