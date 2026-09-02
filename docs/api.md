# API & auth

The HTTP surface (all routes under `/api`), the auth model behind it, and the
WebSocket events. See [architecture.md](architecture.md) for the stack and
storage model.

## Auth model

There are **four independent ways** to authorize a presentation mutation — an
account that **owns** the deck, the per-presentation **edit token**, an account
the owner has **shared the deck with at `edit`** (REQ075), or an account in the
**workspace that owns the deck** (REQ128/REQ129). The first two are the
owner-or-edit-token model; the third is described in full under
**Sharing a deck with other accounts** below, the fourth under **Workspaces**,
and those two are the ones that are not all-or-nothing: each resolves to a
*level*, and the level is what every gated route is decided by. A caller can hold
both, and the **strongest** of the two stands — two independent reasons to be on
a deck do not weaken each other.

A deck also carries a **third, weaker credential that authorizes no mutation at
all**: the per-presentation **results token** behind the shareable results link
(REQ098). It is described in full under **The shareable results link** below;
what belongs here is that it is deliberately *not* a third way to prove an edit.
It rides its own header, it is consulted in exactly one place, and the only
thing it opens is the deck's tallies.

**User accounts (Better Auth).** `server/accounts.ts` builds a Better Auth
instance (email + password, per-user API keys, factory per ADR-0007) on a
**dedicated `bun:sqlite` file** (`$OMUL_AUTH_DB`, default an `auth.sqlite`
sibling of the docstore file) — a documented deviation from ADR-0023's
Mongo default, for the single-node reason this product is built around. It is mounted at
`/api/auth/*` (`auth.handler`) and its schema is created/upgraded in-process at
boot via `ensureAuthSchema()`. The surface it exposes: sign-up / sign-in /
sign-out / session, **password reset** and **email verification** (soft — a
fresh account is auto-signed-in; a UI banner nudges verification) over Brevo
email, **change-email** (double opt-in), **account deletion** (password-
verified), and **personal API keys** (`x-api-key`). The browser client is
`src/auth-client.ts`; the header UI (sign-in dialog, reset/verify/change-email
landings, verify banner, account settings, API-key manager) is `src/auth.tsx`,
mounted in `HomePage`.

- `resolveUserId(headers)` resolves the account behind a request from a cookie
  session **or** an `x-api-key` (with a defensive Bearer→x-api-key fallback);
  `isApiKeyRequest(headers)` reports the credential shape.
- Transactional email is Brevo v3 HTTP (`server/email.ts`), bodies authored as
  React Email components (`server/emails/`). Sending is gated by `SEND_EMAILS ===
  "true"` **and** `BREVO_API_KEY` + `BREVO_SENDER_EMAIL`; otherwise it **logs**
  the message (so reset/verify links appear in the dev server log). Preview them
  with `mise run preview:email` (port 3999).

**Per-presentation edit token (`creatorToken`).** On an **anonymous** or
**cookie-session** `POST /api/presentations`, the server generates a
`crypto.randomUUID()`, stores only its SHA-256 hash, and returns the plaintext
token **once** as `creatorToken`. An **API-key** create is already owner-editable
via the key, so it is **not** minted a redundant token (`creatorToken: null`).
The frontend keeps tokens in `localStorage` under `omul-tokens`
(`Record<presentationId, token>`, `src/api.ts`). The token is sent as
`Authorization: Bearer <token>` (legacy) or the dedicated `X-Omul-Edit-Token`
header. A header that is present but blank is no claim, and does not shadow the
`Authorization` slot behind it. The header is where the token was put, never
what it proves — the same token is accepted and the same wrong token refused
whichever slot it rides in — so nothing about who may mutate a deck turns on
which one a caller picks.

**Authorization (`resolveDeckAccess` / `authorizeEdit` in
`server/services/presentations.ts`).** `resolveDeckAccess` is the one place the
four standings are consulted, and it returns a **level** rather than a boolean:
`edit` for the deck's **owner** (`creatorId`, proven by cookie session or API
key), for the holder of a valid **edit token**, and for a grandfathered legacy
deck (no owner, no token hash and **no workspace**); otherwise the strongest of
whatever level the caller's collaborator grant carries (`view` / `comment` /
`edit`) and whatever their role in the deck's workspace resolves to
(`workspaceDeckAccessLevel`), or `null` for no standing at all. Order is
strength, not precedence — a weak grant can never take away a stronger standing,
so an owner who somehow also holds a `view` grant on their own deck is not
demoted by it, and neither is a workspace member who holds one on a deck their
own workspace owns.

The **workspace clause of the grandfather rule is load-bearing**
(`canGrandfatherLegacyDeck` in `server/schemas.ts`): a workspace deck carries no
owner and no token hash *by construction*, which is exactly the shape a pre-auth
deck has, so reading one as legacy would hand `edit` to every anonymous caller
who could type its id. The two are told apart by `workspaceId`, in one function,
with the withholding answer as the default. `authorizeEdit` is that level read through
`canMutateDeck()`, i.e. `level === "edit"`, and it is what every mutation route
asks. Routes return `401` (no account and no valid credential) or `403` (an
account with a level that does not authorize this route — which is exactly what a
`view` or `comment` collaborator gets on every mutation). `creatorTokenHash` and
`creatorId` are **never** sent to clients (stripped by `sanitize()` — Zod drops
undeclared keys), and neither is any collaborator's account id.

**Claiming.** `POST /api/presentations/:id/claim` attaches an ownerless deck to
the signed-in account (session **and** control required), the path a browser-
created deck takes to gain an owner after sign-up. A deck a **workspace** owns is
never claimable (`409`) however ownerless it looks — see **Workspaces** below. The frontend calls
`claimLocalPresentations()` for every locally-held token on sign-in;
`GET /api/presentations/mine` then lists the account's owned decks, merged with
local history in `HomePage`.

**Admin surface (`/api/admin/*`).** Operator-only, gated by a **deployment-
supplied** email allowlist (`server/admins.ts`, REQ164) on a **cookie session**
(never an API key): `401` signed-out, `403` signed-in non-admin. The allowlist is
`OMUL_ADMIN_EMAILS`, read once at startup and **empty unless the deployment
sets it** — an instance nobody has been named on answers `403` here to everyone,
which is the fail-closed default rather than a misconfiguration (see
[deployment.md](deployment.md#environment-variables)). There is no role column
and no self-service grant. Actions are two-step, token-confirmed
(`server/admin-events.ts`, a `bun:sqlite` store with a 10-minute one-time
confirmation token whose hash is stored, plus an append-only audit log). The one
action today is **reassign a presentation's owner**.

## Endpoints

| Method | Path | Auth required | Description |
|---|---|---|---|
| GET | `/api` | — | Discovery index: absolute links to the OpenAPI spec, docs UI, health probe and WebSocket — see **The discovery index** below |
| GET | `/api/health` | — | Health check |
| ANY | `/api/auth/*` | — | Better Auth (sign-up/in/out, session, reset, verify, change-email, delete-user, API keys) |
| GET | `/api/templates` | — | The prebuilt-deck catalog, filtered by `?category=` and `?search=` (REQ005) — see **Deck templates** below |
| GET | `/api/templates/:id` | — | One catalog entry by its id (REQ005) |
| GET | `/api/deck-generation` | — | Whether this deployment can draft a deck from a prompt, and on what terms (REQ007) — see **Generating a deck from a prompt** below |
| POST | `/api/deck-generation` | ✅ session/key by default | Draft a deck from `{ prompt, language? }` and return it as an ordinary editable presentation (REQ007). The account requirement is the operator's to lift (`OMUL_GENERATION_ALLOW_ANONYMOUS`) |
| GET | `/api/presentations` | — | List presentations (`?creatorId=`) |
| GET | `/api/presentations/mine` | ✅ session/key | List the signed-in account's owned decks |
| GET | `/api/presentations/shared` | ✅ session/key | List the decks other accounts have shared with the caller, each with its `accessLevel` (REQ075) — see **Sharing a deck with other accounts** below |
| POST | `/api/presentations` | optional session/key | Create; returns `creatorToken` once (null for API-key create; records owner when signed in). `templateId` starts the deck from a catalog entry, copying its slides (REQ006) — see **Deck templates** below. `workspaceId` makes the deck the **workspace's** instead: no account owner, no edit token, and a role check on the caller (REQ128) — see **Workspaces** below |
| GET | `/api/presentations/:id` | — | Get presentation by ID. Reports the caller's own `accessLevel` (REQ075) and account-standing `commentAccess` (REQ074) on it |
| PATCH | `/api/presentations/:id` | ✅ owner, token or `edit` grant | Update the deck's **authored** fields. The owner, the edit-token hash and the results-link pair are not among them and are dropped, not merged |
| DELETE | `/api/presentations/:id` | ✅ owner or token | Delete presentation — and every collaborator grant on it. The one mutation an `edit` collaborator is **not** allowed (REQ075) |
| POST | `/api/presentations/:id/start` | ✅ owner, token or `edit` grant | Go live |
| POST | `/api/presentations/:id/end` | ✅ owner, token or `edit` grant | End presentation |
| POST | `/api/presentations/:id/reset` | ✅ owner, token or `edit` grant | Reset to draft, clear every vote, response upvote, Q&A question and chat message so the deck can be run again (REQ101) — see **Clearing a session's results** below |
| POST | `/api/presentations/:id/slide` | ✅ owner, token or `edit` grant | Navigate to slide `{ index }` |
| POST | `/api/presentations/:id/reveal` | ✅ owner, token or `edit` grant | Publish one slide's tally to the room, or take it back `{ slideId, reveal? }` (REQ016/REQ102) |
| POST | `/api/presentations/:id/results-visibility` | ✅ owner, token or `edit` grant | Set the deck's reveal mode and apply it to every question slide, in one operation `{ resultsVisibility }` (REQ018) — see **The deck's reveal mode** below |
| POST | `/api/presentations/:id/participation` | ✅ owner, token or `edit` grant | Open or close one slide to submissions `{ slideId, open }` (REQ111) — see **The live room** below |
| POST | `/api/presentations/:id/blank` | ✅ owner, token or `edit` grant | Blank the shared screen, or bring it back `{ blanked }` (REQ109) — see **The live room** below |
| POST | `/api/presentations/:id/timer` | ✅ owner, token or `edit` grant | Reopen a slide's question, restarting its countdown `{ slideId }` (REQ057) |
| POST | `/api/presentations/:id/claim` | ✅ session + control | Claim an ownerless deck for the account (409 if owned by another account, or by a workspace) |
| POST | `/api/presentations/:id/workspace` | ✅ deck owner + role at the other end | Move the deck into a workspace `{ workspaceId }`, or back into the caller's account `{ workspaceId: null }` (REQ128) — see **Workspaces** below |
| GET | `/api/presentations/:id/collaborators` | ✅ owner | Who the deck is shared with, and at what level (REQ075) |
| POST | `/api/presentations/:id/collaborators` | ✅ owner | Share it with a registered account `{ email, level? }` — idempotent per account (REQ075) |
| PATCH | `/api/presentations/:id/collaborators/:collaboratorId` | ✅ owner | Change one grant's level `{ level }` (REQ075) |
| DELETE | `/api/presentations/:id/collaborators/:collaboratorId` | ✅ owner | Revoke one grant, immediately (REQ075) |
| GET | `/api/presentations/:id/comments` | ✅ account with any grant, or owner | The deck's comment threads, oldest first (REQ074) — see **Comment threads on slides** below |
| POST | `/api/presentations/:id/comments` | ✅ account with `comment` / `edit`, or owner | Comment on one slide `{ slideId, body }` (REQ074) |
| DELETE | `/api/presentations/:id/comments/:commentId` | ✅ the comment's own author | Take back one of your own comments (REQ074) |
| POST | `/api/presentations/:id/vote` | — | Submit vote `{ slideId, value, participantId, statementId?, skip? }`. Live mode: requires `status === "live"`. Survey mode (REQ003/REQ082): accepts votes at any non-ended status. `statementId` + `skip` support multi-statement scales (REQ029/REQ031) and 2x2 grid items (REQ047/REQ050). Choice slides: see **Choice voting** below; ranking slides: see **Ranking voting** below; 100 Points slides: see **100 Points voting** below; 2x2 grid slides: see **2x2 Grid voting** below; Guess the Number slides: see **Guess the Number voting** below; Pin on Image slides: see **Pin on Image voting** below; form slides take a whole filled-in form as one value, see **Form voting** below; quiz slides add a final-answer rule and a time window, and take either an option id or a typed answer (REQ055), see **Quiz competition** below. |
| POST | `/api/presentations/:id/response-vote` | — | Upvote (toggle) an open-ended response `{ slideId, responseId, participantId }` — only when slide has `allowResponseVotes: true` (REQ025). |
| DELETE | `/api/presentations/:id/answers/:answerId` | ✅ owner, token or `edit` grant | Delete one submitted answer from a word-cloud or open-ended slide (REQ027) — see **Removing a submitted answer** below |
| GET | `/api/presentations/:id/qa?participantId=` | — | The deck-wide Q&A list, as this caller may read it (REQ036/REQ037) — see **The Q&A layer** below |
| POST | `/api/presentations/:id/qa` | — | Ask a question `{ text, participantId }` (REQ036) |
| POST | `/api/presentations/:id/qa/settings` | ✅ owner, token or `edit` grant | Switch the Q&A layer on/off and choose who reads it `{ enabled?, visibility? }` (REQ036/REQ037) |
| POST | `/api/presentations/:id/qa/:questionId/upvote` | — | Toggle this participant's upvote on a question `{ participantId }` (REQ060) |
| POST | `/api/presentations/:id/qa/:questionId/answered` | ✅ owner, token or `edit` grant | Mark a question answered, or reopen it `{ answered? }` (REQ060) |
| POST | `/api/presentations/:id/channels` | ✅ owner, token or `edit` grant | Open or close the room's reactions and live chat `{ reactionsEnabled?, chatEnabled? }` (REQ077/REQ078) — see **Participant channels** below |
| POST | `/api/presentations/:id/reactions` | — | Send a reaction from any slide `{ kind, slideId?, participantId }` (REQ077). Broadcast and **not stored** |
| GET | `/api/presentations/:id/chat?participantId=` | — | The deck's live chat, newest 200 messages, oldest-first (REQ078) |
| POST | `/api/presentations/:id/chat` | — | Post a chat message `{ text, participantId }` (REQ078) |
| POST | `/api/presentations/:id/participant-name` | — | State what this participant is called on the deck `{ participantId, name }` (REQ076) — see **Participant names** below |
| GET | `/api/presentations/:id/participants` | ✅ owner, token or `edit` grant | The deck's roster: who took part, by name (REQ076). The results link does **not** open it |
| GET | `/api/presentations/:id/scorecard?participantId=` | — | One participant's quiz scores across the deck (REQ056), and their place on its leaderboard (REQ059) |
| GET | `/api/presentations/:id/preview` | ✅ owner, token or `edit` grant | A dry run of the whole deck with generated test votes (REQ103/REQ104) — see **Preview and test votes** below. Writes nothing |
| GET | `/api/presentations/:id/results` | — | All slide results, each behind the deck's reveal mode (REQ015–REQ017) — see **The deck's reveal mode** below. Also reads the **results token** (REQ098), which lifts that mode |
| GET | `/api/presentations/:id/results/:slideId` | — | Results for one slide, behind the deck's reveal mode (REQ015–REQ017), and behind the results token the same way. On a `leaderboard` slide this is the deck's standings across its quiz questions — see **Leaderboard slide** below |
| GET | `/api/presentations/:id/results/:slideId/segments?by=` | — | One slide's tally split by the answers the same people gave on an earlier slide, joined on participant id (REQ020/REQ116) — see **Segmented results** below |
| GET | `/api/presentations/:id/results.xlsx` | ✅ owner, token or `edit` grant | The whole session as an Excel workbook (REQ095) — see **Spreadsheet export** below |
| GET | `/api/presentations/:id/deck.pdf` | ✅ owner, token or `edit` grant | The deck rendered to a self-contained PDF, with its results (`?results=true`, the default) or without them (`?results=false`) (REQ096) — see **PDF export** below |
| POST | `/api/presentations/:id/results-link` | ✅ owner, token or `edit` grant | Mint the deck's read-only results link; returns `resultsToken` once (REQ098) — see **The shareable results link** below |
| DELETE | `/api/presentations/:id/results-link` | ✅ owner, token or `edit` grant | Revoke it. Immediate, and it retires every copy (REQ098) |
| GET | `/api/presentations/:id/results-link` | ✅ owner, token or `edit` grant | Whether the deck has a link right now, and when it was minted (REQ098) |
| GET | `/api/join/:code` | — | Look up presentation by 6-digit code |
| GET | `/api/workspaces` | ✅ session/key | The workspaces the caller is in, each with the `role` they hold (REQ128/REQ129) |
| POST | `/api/workspaces` | ✅ session/key | Create one `{ name }`; the caller becomes its `owner` in the same act |
| GET | `/api/workspaces/:id` | ✅ member | One workspace, with the caller's own role on it |
| PATCH | `/api/workspaces/:id` | ✅ `owner` | Rename it `{ name }` |
| DELETE | `/api/workspaces/:id` | ✅ `owner` | Delete it and every membership — `409` while it still owns decks |
| GET | `/api/workspaces/:id/members` | ✅ member | The roster; `email` only for a reader who may manage it |
| POST | `/api/workspaces/:id/members` | ✅ `admin` / `owner` | Add a registered account `{ email, role? }` — idempotent per account; granting `owner` needs `owner` |
| PATCH | `/api/workspaces/:id/members/:memberId` | ✅ `admin` / `owner` | Change one membership's role `{ role }` — either end touching `owner` needs `owner`; `409` on the last owner |
| DELETE | `/api/workspaces/:id/members/:memberId` | ✅ `admin` / `owner`, or the member themselves | Remove one membership, or leave — `409` on the last owner. The workspace's decks are untouched |
| GET | `/api/workspaces/:id/presentations` | ✅ member | The decks the workspace owns, as their authors wrote them |
| POST | `/api/admin/actions` | ✅ admin | Prepare a two-step action; returns a one-time `confirmationToken` |
| POST | `/api/admin/actions/:id/confirm` | ✅ admin | Execute a prepared action `{ confirmationToken }` |
| GET | `/api/admin/events` | ✅ admin | Append-only admin audit log |

Ten of those routes are rate-limited and can answer `429` — see **Rate
limits** directly below.

## The discovery index (REQ151)

`GET /api` is the entry point for a client that knows nothing about the route
layout — including an AI agent. It returns the service name, version,
description and five **absolute** links:

```json
{
  "links": {
    "self": "https://omul.example.com/api",
    "openapi": "https://omul.example.com/api/docs/json",
    "docs": "https://omul.example.com/api/docs",
    "health": "https://omul.example.com/api/health",
    "websocket": "wss://omul.example.com/ws"
  }
}
```

Absolute means the origin has to be right, and behind a TLS-terminating proxy
the origin this process *observes* is not: the proxy terminates HTTPS at
`omul.example.com` and forwards over plain HTTP to loopback, so the request
arrives as `http://omul.example.com`. A browser survives that on the proxy's
redirect; a client that follows the link literally does not, and `ws://` to a
host that serves only 443 fails rather than redirecting.

So `server/routes/discovery.ts` resolves the origin from three sources, most
trustworthy first:

1. **`OMUL_BASE_HOST`** — the public host as configuration, read as
   `https://<host>`, the same variable and the same reading Better Auth's
   canonical origin uses. It wins outright because no caller can influence it. A
   value that is not a bare host is a **startup crash**, not a fallback.
2. **`X-Forwarded-Proto` / `X-Forwarded-Host`**, and only as far as
   `OMUL_TRUST_PROXY` says a proxy exists — the same switch, read the same way
   (the entry that many hops in from the right), as the rate limiter's client
   address. Unset, the headers are ignored: they are caller-supplied, and a
   directly-exposed server that believed them would let any caller choose the
   links it hands the next one.
3. **The origin the request arrived on** — correct for `mise run dev` and for a
   directly-exposed self-hosted server, which keeps advertising its own origin.

The WebSocket link is derived from the resolved origin (`https` → `wss`, `http`
→ `ws`), so it cannot disagree with the links beside it. Which of the three
sources is in force is stated in the startup log, because a proxied deployment
that sets neither variable looks, from inside the process, exactly like a direct
one that is right to report what it sees.

## Rate limits (REQ145)

The account-free routes are throttled per client, because without a login there
is no other throttle in the system. Over the limit, the route answers **`429`**
with a `Retry-After` header in seconds and the same number as `retryAfterSeconds`
in the body:

```json
{ "error": "Too many submissions — please slow down", "retryAfterSeconds": 60 }
```

| Route(s) | Window | Keyed by |
|---|---|---|
| `POST /api/presentations` | 30 per 5 minutes | client |
| `POST /api/deck-generation` (REQ007) | 5 per 5 minutes | client |
| `GET /api/join/:code` | 600 per minute | client |
| `POST …/vote`, `…/response-vote`, `…/qa`, `…/qa/:questionId/upvote`, `…/chat`, `…/participant-name` | 600 per minute | client |
| the same six public writes | 60 per minute | `participantId` |
| `POST …/reactions` (REQ077) | 3000 per minute | client |
| `POST …/reactions` (REQ077) | 120 per minute | `participantId` |
| `POST …/collaborators` (REQ075) | 600 per minute | client |
| `POST …/collaborators` (REQ075) | 60 per minute | the deck being shared |
| `POST /api/workspaces/:id/members` (REQ129) | 600 per minute | client |
| `POST /api/workspaces/:id/members` (REQ129) | 60 per minute | the workspace being added to |

Sharing a deck and adding somebody to a workspace are the two **authenticated**
routes on that list, and they are there for a reason of their own (REQ075,
REQ129): answering `404` for an address with no account and `201` for one that
has makes each an account-existence oracle, which an invite flow needs and an
enumerator must not have at full speed. Both spend the same two submission
budgets, keyed by the deck (or the workspace) rather than by a participant, so
probing faster than that means holding more of them — and still meets the
per-client ceiling.

The guards run **before** the handler, so an over-limit call never reaches
authorization or the store; a malformed body is still rejected first (`422`,
by the route schema) and costs no budget. The window is in-process
(`server/rate-limit.ts`), the per-client ceilings are sized for a whole NATted
room rather than one person, and the whole thing is switchable off with
`OMUL_RATE_LIMITS_DISABLED=true`.

That switch is why **deck generation does not rely on its budget alone** (REQ007):
it is the one route whose cost is a third party's bill rather than this server's
disk, and turning the limits off would otherwise take the money limiter with the
disk limiter. Generation carries a second, independent control — an account
requirement, on by default — which this switch cannot reach. See **Generating a
deck from a prompt** above.

A **client** is an IPv4 address, or an IPv6 `/64` — one subscriber is routed a
whole `/64` and may source from any address in it, so keying the full address
would let a single machine mint a fresh bucket per request. The
`::ffff:a.b.c.d` form a dual-stack socket reports IPv4 peers in is read back as
the IPv4 address it is, never truncated.

Behind a reverse proxy set `OMUL_TRUST_PROXY` to the number of proxy hops
(`true` = 1), otherwise `X-Forwarded-For` is ignored and every visitor keys on
the proxy's address. The client address is taken that many hops in from the
**right** of the header — the left-hand entries are whatever the caller chose
to write — so a spoofed `X-Forwarded-For` buys no extra budget. The server
prints which of the two postures it is running under on every boot, and warns
once if a request arrives carrying `X-Forwarded-For` while no hop is trusted.
Full reference in [deployment.md](deployment.md#abuse-limits-req145).

**Reactions are throttled on counters of their own, and that separation is
load-bearing.** They are throttled at all because a reaction writes nothing but
reaches every socket in the room, so it costs the same to flood as a write does.
They are not on the *submission* counters because a reaction is one tap with no
confirmation: a participant reaches a shared ceiling during a single applause
moment, and the next thing they do is answer the quiz question the presenter has
just opened — on a window that closes (REQ057), so the answer would be lost for
good. An answer is the payload and a reaction is decoration; the decoration must
not be able to starve the payload. The reaction ceilings are sized as taps
(two a second sustained per participant) and, per address, for a whole NATted
room applauding at once. Over the limit they answer `429` naming *reactions*,
which the participant surface shows beside the reaction row rather than
swallowing.

Not rate-limited, and deliberately so: the presenter's own mutations (already
gated by owner-or-edit-token), the results reads the presenter's screen polls,
and the WebSocket at `/ws`, which carries no create, join-code lookup or vote —
its `join` message only subscribes a socket to a room.

## Sharing a deck with other accounts (REQ075)

A deck's owner can give another **account** standing on it at a stated level.
This is the third way to authorize a mutation described under **Auth model**
above, and unlike the other two it is not all-or-nothing.

**Three levels, one order: `view` < `comment` < `edit`.** What separates them is
what the holder may **change**, not what they may read. A collaborator was
deliberately given the deck, so all three read it exactly as its owner does — the
answer key on a running quiz question (REQ056), the presenter's notes (REQ090), a
Form slide's per-participant rows (REQ061), a tally the reveal mode withholds
(REQ015–REQ017). The two halves of that sentence are `canMutateDeck()` and
`canReadDeckAuthoring()` in `server/schemas.ts`, and no route re-derives either
by comparing level strings.

`comment` is what a slide's comment threads are written under (REQ074), and it
is the one thing that separates it from `view` — see **Comment threads on
slides** below. Nothing else in the API tells the two apart: what a level governs
is what its holder may change, and a comment is a change to the conversation
rather than to the deck.

**Enforcement is server-side, on every mutation.** Every gated route runs
`requireEdit`, which reads the caller's resolved level through `canMutateDeck()`,
so a `view` or `comment` collaborator is refused `403` on the PATCH, the start,
the end, the reset, the slide, the reveal, the reveal-mode change, the timer, the
Q&A settings, the channels and the results-link mint alike — with the same status
codes the pre-existing model uses. `server/collaborators.integration.test.ts`
drives every one of those routes as a real second account rather than sampling
one. That list is hand-written, though, so it is a check on the routes that
existed when it was written and **not** a backstop for the next one: a mutation
route added without a level gate passes this suite silently, and the review that
found the `PATCH` body hole is what that looks like in practice. Adding a
mutation route means adding it to the sweep.

The three **comment** routes (REQ074) are deliberately not on it: they are the
one write a `comment` grant is *supposed* to pass, so they are gated by their own
two predicates rather than by `canMutateDeck`, and swept by their own suite —
which asserts the same claim in the shape that requirement takes (`view` refused
the write, no account refused everything, and no participant-facing payload
carrying a comment at all).

**Two things a grant never reaches.** *Deleting the deck* stays with its owner
and its edit token (`requireEdit(…, { allowCollaborators: false })`): being
trusted to build a deck is not being trusted to destroy it, and a delete takes
the room's answers with it (REQ146). *Deciding who else is on the deck* stays
with the owner alone — the four `…/collaborators` routes are gated by
`requireDeckOwner`, which honours neither the edit token (an anonymous,
forwardable capability with no account behind it, and nothing to hold anyone to)
nor a collaborator's own grant (a grant is help with the deck, not the authority
to widen who has it). An **ownerless** deck therefore has no sharing surface at
all: claim it first (`POST …/claim`), share it after.

A deck a **workspace** owns has no account owner either, and there the answer is
a role rather than an account: `admin` and `owner` reach the four
`…/collaborators` routes on it (`canAdministerWorkspaceDecks`), every other
member is refused `403` exactly as an `edit` collaborator is, and the deck's
delete follows the same line. Without that a workspace deck would have no sharing
surface at all and no way to be deleted — coexistence with this model failing
shut rather than the two standing beside each other.

Both limits rest on the deck's credentials being unwritable, so that is enforced
separately and twice: `PATCH /api/presentations/:id` validates its body against
`UpdatePresentationSchema`, which declares only the authored fields, and
`updatePresentation` strips `UNWRITABLE_PRESENTATION_FIELDS` again before the
store write. Without the first of those the route was a free-form merge into the
stored document, and `StoredPresentationSchema` *declares* `creatorId` and
`creatorTokenHash` — so an `edit` collaborator could write themselves into
ownership, or plant an edit-token hash they knew the secret for and survive being
revoked, and step around both limits above in one request.

**A grant names an account, and only ever by email.** `POST …/collaborators`
takes the address the target signed up with and resolves it through Better Auth's
own `user` table; an address with no account is a `404`, because this endpoint
sends no invitations and creates no accounts. Sharing again with an address that
already has a grant **changes its level** rather than adding a second (`200`
instead of `201`) — one row per (deck, account) pair, so "what may this account do
here?" has exactly one answer.

**Nothing identifying travels.** A collaborator is stored under their Better Auth
user id and read back as `{ id, email, name, level, createdAt, updatedAt }`,
where `id` is the **grant's** own random handle — the thing a level change or a
revoke names it by. The account id is dropped by the same construction that keeps
`creatorId` and `creatorTokenHash` off every deck response: `DeckCollaboratorSchema`
does not declare it, and Zod strips what a schema does not declare. The list is
owner-only, so the emails on it are the ones its reader typed.

**Changes and revokes are immediate.** The standing *is* the stored grant — there
is no token issued, no cache and nothing to expire — so a demotion or a revoke
lands on the collaborator's very next request, and a revoked deck leaves their
`GET /api/presentations/shared` at once. What neither can reach is a page they
already have open, which keeps what it was last sent until it next asks the
server. Deleting a deck sweeps every grant on it; a **reset** (REQ101) does not,
since re-running a session is not un-sharing the deck.

**What a client is told.** `GET /api/presentations/:id` reports the caller's own
`accessLevel` (`edit` / `comment` / `view` / `null`), and `GET
/api/presentations/shared` reports one per deck. Both are *reports*, never
credentials: every gated route re-resolves the level from the request's own
credentials, so a client that gets this wrong only mis-draws its own buttons.

The deck read also reports **`commentAccess`** — the caller's *account*
standing, which is what the comment threads below are gated on. The two answers
differ exactly where the gates do: the edit-token holder with no account reads
`accessLevel: "edit"` and `commentAccess: null`, because the token authorizes
every mutation and opens no thread. A client that gated its comment surfaces on
`accessLevel` would fire reads the server is guaranteed to `401`; gate them on
`commentAccess` (through `canReadDeckComments` / `canWriteDeckComments`).

## Workspaces (REQ128, REQ129)

Every standing above this section belongs to **one account** or to one
forwardable credential. A workspace is the thing neither of those can be: an
owner of decks that is not a person. It holds decks of its own (REQ128), and the
accounts in it hold a **role** on the workspace rather than a grant on each deck
(REQ129).

**A workspace deck has no account owner at all.** `creatorId` is `null`,
`workspaceId` names the workspace, and no edit token is minted for it — those
are the two writes that make "rather than through one account" true. There is no
account whose removal takes the deck with it, and, just as load-bearing, none
that keeps standing on it *after* being removed: the account that created the
deck is a member like every other and stops being one the moment the workspace
says so. Two consequences a caller meets directly:

- **It is not a pre-auth deck.** No owner and no token hash is exactly the shape
  the legacy grandfather admits, so the two are told apart by `workspaceId` in
  one function (**Auth model** above). An anonymous caller gets `401` on every
  mutation and `accessLevel: null` on the read.
- **It cannot be claimed.** `POST …/claim` answers `409` even for a member who
  can edit it: ownerless is not unowned, and a member claiming it would take a
  shared deck private in one request nobody else is told about. Moving one back
  out is deliberate and owner-gated — see below.

**Three roles, in one order: `member` < `admin` < `owner`.** Every role reads,
edits and presents every deck the workspace owns and creates new ones in it —
that is REQ128's "readable and presentable by its members", and it resolves
through `workspaceDeckAccessLevel()`, the single bridge from a role to the
`view`/`comment`/`edit` model every gated deck route is already decided by. What
separates the roles is what they may do to the *workspace*:

| | `member` | `admin` | `owner` |
|---|---|---|---|
| Read, edit, present its decks; create new ones | ✅ | ✅ | ✅ |
| Delete one of its decks; decide who outside the workspace it is shared with | — | ✅ | ✅ |
| Add, remove and re-role members | — | ✅ | ✅ |
| Grant or take back the `owner` role | — | — | ✅ |
| Rename or delete the workspace; move a deck back out of it | — | — | ✅ |

Each row is a **predicate** in `server/schemas.ts`
(`canCreateWorkspaceDecks`, `canAdministerWorkspaceDecks`,
`canManageWorkspaceMembers`, `canAdministerWorkspace`), and no route re-derives
one by comparing role strings. The set is deliberately open at the weak end:
REQ131 reserves a reduced-capability role that reads and comments but neither
creates nor presents, and it arrives as one entry at the front of
`WORKSPACE_ROLES` plus one line in each predicate rather than as a sweep for
`!== "member"` spelled five different ways.

**Enforcement is server-side, on every mutation** — the sentence REQ129 ends on.
A workspace deck's mutations run the same `requireEdit` every other deck's do,
reading the level `workspaceDeckAccessLevel()` produced; the workspace's own
routes each name the predicate they need.
`server/workspaces.integration.test.ts` drives every mutation route on a
workspace deck as a real second account rather than sampling one. That list is
hand-written, though, so — exactly as with the collaborator sweep next door — a
mutation route added without a level gate passes it silently. Adding a mutation
route means adding it to both sweeps.

**A workspace always has at least one owner.** The role change and the removal
both answer `409` when they would take the last one, because nothing in the model
could restore an owner afterwards — the routes that hand the role out are
themselves owner-gated — so the workspace would be un-renameable, un-addable-to
and un-deletable for good, with its decks stuck in it.

**Deleting a workspace never deletes a deck.** It is refused with `409`, and the
count, while the workspace still owns any: it is their owner, so deleting it
would leave each of them owned by nothing and reachable by nobody. Move them out
or delete them first. Removing a *member*, by contrast, touches no deck at all —
which is the whole point.

**A membership names a registered account, and only ever by email.** `POST
…/members` resolves the address through Better Auth's own `user` table; an
address with no account is `404`, because this endpoint sends no invitations and
creates no accounts. Adding again with an address that already has a membership
**changes its role** rather than adding a second (`200` instead of `201`) — one
row per (workspace, account) pair, so "what may this account do here?" has
exactly one answer. It is rate-limited for the reason the sharing endpoint is
(**Rate limits** above).

**Nothing identifying travels.** A member is stored under their Better Auth user
id and read back as `{ id, email, name, role, mine, createdAt, updatedAt }`,
where `id` is the **membership's** own handle — what a role change or a removal
names it by. The account id is dropped by the same construction that keeps
`creatorId` off a deck: `WorkspaceMemberSchema` does not declare it. `email` is
carried only for a reader whose role may manage the roster and is an explicit
`null` otherwise (ADR-0024): a member sees who they are working with by name,
while the address somebody was invited at is management data, and the narrower
default is the one that ships.

### Moving a deck in and out

`POST /api/presentations/:id/workspace` is the **one writer** of a deck's
`workspaceId`, which is why that field is on `UNWRITABLE_PRESENTATION_FIELDS`
beside `creatorId` and the two token hashes. It names no secret and is a
credential all the same: the caller's own standing on a workspace deck is
resolved from their role in the workspace it names, so a body that could write it
could move any deck its sender can edit — a deck shared with them at `edit`, or
one whose forwarded edit link they hold — into a workspace they administer, and
take it.

Both directions are authorized at **both ends**, which is what makes this a move
rather than two half-authorized writes:

| Direction | Body | Who |
|---|---|---|
| Into a workspace | `{ "workspaceId": "…" }` | owns the deck today (not its edit token, not a collaborator) **and** may create decks in the target |
| Back out | `{ "workspaceId": null }` | holds `owner` in the workspace that has it; becomes the deck's account owner |

Moving a deck **in retires its edit token**. An edit link handed out before the
move is anonymous and forwardable and nobody in the workspace could revoke it, so
leaving it live would be a standing on a shared deck that the shared roster
cannot reach — precisely what moving the deck in was supposed to end. Moving one
back out mints no new token: the account owns it, and an owner has never needed
one. The deck's collaborator grants (REQ075) survive both directions untouched —
a grant is a decision about one account and one deck, and moving the deck does
not unmake it. Asking for the state the deck is already in is an idempotent
`200`.

### What a client is told

`GET /api/presentations/:id` reports `workspaceId` on every deck (`null` for an
account's own), and the deck's `accessLevel` already reports what a workspace
member may do with it — the two models resolve into one answer, so no surface
asks a second question. `GET /api/workspaces` and `GET /api/workspaces/:id`
report `role`. All of it is a *report*, never a credential: every gated route
re-resolves the role from the request's own credentials, so a client that gets it
wrong only mis-draws its own buttons.

## Comment threads on slides (REQ074)

A deck carries one comment thread per slide: the authoring conversation between
the accounts it is shared with. Three routes reach it, they are the only three
that touch it, and two rules decide everything about them.

**Who.** The deck's **owner** and any account holding a grant read every thread;
`comment` and `edit` write. `canReadDeckComments()` and `canWriteDeckComments()`
in `server/schemas.ts` are the two halves, read off the same resolved level every
mutation is decided by — no route re-derives either by comparing level strings.
This is the only place in the API where `view` and `comment` differ, which is
what the middle level was reserved for (REQ075).

**Standing here is an account's, never a credential's.** The routes resolve it
through `resolveDeckAccountAccess`, which consults *only* the standings an
account can hold — being the deck's owner, holding a grant, or being in the
workspace that owns it (REQ128), which is an account standing on exactly the same
terms and is what opens a workspace deck's threads to the team that keeps it. The
per-presentation **edit token** opens nothing here, and neither does the legacy
grandfather, for the reason `requireDeckOwner` refuses the token on the sharing
surface and then some: a comment has an author and a forwardable capability has
nobody behind it to be recorded as, and the token is handed out as an edit
*link* — reading it as standing would let anyone it was forwarded to read what
the organizers said to each other. A caller with no account is `401`; an account
with no grant, or a `view` grant on the write, is `403`.

**Never visible to participants, and that is a property of the storage model.**
Comments live in their own `slideComments` collection, read by their own routes,
and no other surface loads one — so there is no projection for a future read site
to forget. Nothing about a comment reaches the join lookup, the deck read, the
public list, a `slide.changed` broadcast, any tally (including through the
results link, REQ098), the Q&A, the chat, a scorecard, the preview or the
spreadsheet. `server/slide-comments.integration.test.ts` fetches every one of
those and searches the payload rather than taking it on trust.

| Field | Meaning |
|---|---|
| `id` | The comment's own id — what a delete names it by |
| `slideId` | The slide the thread is anchored to |
| `body` | What was written, verbatim: trimmed and capped at 2000 characters at the boundary, and otherwise stored exactly as typed |
| `authorName` | The author's display name, or an explicit `null` for an account that has since been deleted (ADR-0024) |
| `mine` | Whether this caller wrote it, resolved per request from the credentials that request carries |
| `createdAt` | When it was written |

**No account identifier travels, and no email either.** `SlideCommentSchema`
declares neither, and Zod strips what a schema does not declare — the same
construction that keeps `creatorId` off a deck and `userId` off a grant. The
email is a deliberate step *narrower* than the collaborator list next door: that
list is owner-only, so the addresses on it are ones its reader typed, while a
thread is read by every account on the deck and who else is on it is not a
collaborator's to enumerate. A name is what reading a conversation needs.

**The whole deck in one read.** `GET …/comments` returns every comment on the
deck rather than one slide's, because the screen consuming it draws one thread
and a count on every other slide, and a per-slide endpoint would make the second
of those one request per slide. Comments whose slide has since been authored off
the deck are left out — a thread nothing on screen is anchored to is not
something a client can draw.

**A comment is taken back by its author and by nobody else.** Not by the deck's
owner: taking back what you said is part of writing, while removing what somebody
else said is moderation, and this slice implements none — no resolve workflow, no
editing, no notifications, no mentions. A comment belonging to another account,
to another deck, or to nobody all answer the same `404`.

**What a session does and does not clear.** A **reset** (REQ101) leaves every
thread standing: it clears what the *room* submitted, and the room wrote none of
this. **Deleting the deck** sweeps them, beside its collaborator grants and for a
sharper reason than a grant has — a comment is text people wrote, which is the
last thing that should outlive what it was about (REQ146).

## Authored slide text (REQ088, REQ089, REQ091)

A slide's `question` — and `body` on a content slide — is **markdown, stored
verbatim**. The boundary does not trim it, escape it, or resolve it: it comes
back byte for byte on every read, and `textSize` (`small` / `medium` / `large` /
`x-large`, default `medium`) rides alongside as the step the author picked.

Rendering is entirely the client's, in `src/components/SlideText.tsx` — bold,
italic, code, up to three sub-heading levels, bulleted and numbered lists, and
links written `[label](url)` or pasted bare. Two consequences for anything that
consumes this API:

- **The markup is not sanitised on the way in, because it is never turned into
  HTML on the way out.** The renderer builds React elements, so the only
  attacker-controlled attribute it can emit is a link's `href`, and only
  `http`/`https`/`mailto`/`tel` reach one. A `javascript:` target is stored as
  typed and simply never becomes a link — which is also why a client that
  rendered these strings as HTML itself would be reintroducing the hole this
  design does not have.
- **A size outside the four steps is never stored, on either write path.** A
  step no surface implements would be a slide the projector cannot draw, so it
  is refused where it is written rather than where it is read. *How* it is
  refused differs, and callers should not read one status off the other: `POST
  /api/presentations` validates its body against `CreatePresentationSchema` and
  answers **4xx**, while `PATCH /api/presentations/:id` declares no body schema
  (pre-existing — it passes the body straight through) so the rejection comes
  from the docstore's own schema gate as a **500**. Either way the write does
  not land and the stored step is left as it was.

## A slide's own appearance (REQ087, REQ070, REQ071, REQ019)

Every slide carries five fields that override the deck's theme **for that slide
and no other**:

| Field | Values | Unauthored means |
|---|---|---|
| `layout` | `inherit` (default) / `center` / `left` / `right` | the theme's placement |
| `backgroundColor` | `#rgb` / `#rrggbb` / `""` (default) | the theme's canvas |
| `backgroundImage` | a URL / `""` (default) | no picture |
| `textColor` | `#rgb` / `#rrggbb` / `""` (default) | the theme's words |
| `chartColor` | `#rgb` / `#rrggbb` / `""` (default) | the theme's poll palette |

They are public, like the deck's theme: what the room is looking at has to reach
every phone in it, so they ride the join payload, the `slide.changed` broadcast
and the shared-results page unchanged.

Four things a consumer should know:

- **The empty value is the layering.** A field is emitted on every slide,
  always, even when nothing was authored (ADR-0024) — so no client has to tell
  "on the theme" from "field missing", and none reaches for `??`. Re-theming a
  deck therefore re-themes every slide that did not disagree with it.
- **A colour is `#rgb` or `#rrggbb`, and nothing else.** No `rgb()`, no named
  colours, no `var()`. These values are written into CSS custom properties on the
  client, so the grammar is the smallest one that can express a brand. A value
  outside it is refused where it is written — `POST /api/presentations` answers
  **4xx**; `PATCH /api/presentations/:id` declares no body schema, so the
  docstore's own gate refuses it as a **500** — and either way the write does not
  land. The same is true of a `layout` outside the four.
- **A background image is a URL and nothing is uploaded.** The deck references a
  picture that lives somewhere else, exactly as `mediaUrl` and `themeLogoUrl` do.
  The stored string is whatever was authored; what a *renderer* is handed goes
  through the same scheme allowlist the deck's logo does (`http`, `https`, or a
  root-relative path), so a `javascript:` or `data:` address is stored as typed
  and simply never becomes a picture.
- **Legibility is not negotiable.** A background image is drawn under a scrim
  whose tone is chosen against the slide's own text colour, and whose contrast is
  checked against the worst backdrop that translucent scrim can produce over an
  unknown picture — so an authored text colour is honoured on a picture only
  while it stays readable. A slide that recoloured its canvas and not its words
  gets the words that canvas implies rather than the theme's, and a derived muted
  or dim step is held to a contrast floor against the canvas it sits on. All of
  it is the client's, in `src/components/SlideAppearance.tsx` — see
  [frontend.md](frontend.md#shared-primitives).

## Presenter notes (REQ090)

Every slide carries `notes`: markdown the organizer wrote **to themselves**,
rendered on the presenter surfaces and on no other. It is authored in the slide
editor beside the question, travels with the slide, and defaults to `""`.

**The withholding is on the wire, not in a renderer.** A caller that cannot edit
the deck is sent `notes: ""` — never the text — so there is nothing in the
payload for a client to reveal, deliberately or by accident. One function does
it, `withAudienceSlides()` in `server/schemas.ts`, which is also where quiz
answer keys are withheld (REQ056): the two projections stay separate pure
functions and are composed there once, so every surface that hands a slide to
somebody else's screen withholds *everything* presenter-only rather than
whatever its author remembered.

| Surface | What it sends |
|---|---|
| `GET /api/presentations/:id` **with** the owner's session or edit token | the notes, in full |
| `GET /api/presentations/:id` without one | `notes: ""` |
| `GET /api/presentations` (public list) | `notes: ""` |
| `GET /api/join/:code` | `notes: ""` — always, whoever asks; an organizer opening their own join link is in the room as a participant |
| `slide.changed` WebSocket broadcast | `notes: ""` — a room is broadcast to by presentation and the `role` a socket claims proves nothing |
| `GET /api/presentations/:id/results…`, `/scorecard`, `results.xlsx`, `deck.pdf` | nothing: no results payload carries notes, no sheet of the workbook has a notes column, and no section of the PDF draws them — a document a presenter hands round is not the place their private cue reappears |

Emptied to `""`, not dropped — the opposite of a withheld answer key, and for
the opposite reason. A withheld mark has to be indistinguishable from an
unmarked option, so it disappears; a slide with **no** notes is the ordinary
case and already carries `""`, so the audience's view of a noted slide and an
un-noted one are the same complete shape (ADR-0024) and no client reaches for
`??`.

The preview (REQ103) projects its participant pane through the same function
client-side, so the phone shown in a dry run is missing exactly what a real
phone would be missing.

## Deck templates (REQ005, REQ006)

A **template** is a prebuilt deck the catalog offers as a starting point. The
set is built in — authored in `server/templates.ts`, shipped with the build —
so the two read routes are public, unauthenticated and identical for every
caller, and there is no write route for one anywhere. (Publishing a deck *as* a
template is REQ004, which needs a workspace to own the published entry and is
still pending.)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | What a create names as `templateId` |
| `title` | string | The entry's name, and the title a deck inherits when it states none |
| `description` | string | One or two sentences on what the deck is for |
| `category` | one of `meeting`, `workshop`, `education`, `feedback`, `engagement` | What it is for, and the closed vocabulary `?category=` filters on |
| `tags` | string[] | Extra words the search reads |
| `slides` | Slide[] | The full slides a create would copy — the same shape a deck's are |

**Listed and filtered (REQ005).** `GET /api/templates` returns the whole
catalog. Two independently optional query parameters narrow it and apply
together (an AND): `category`, refused with a **4xx** if it is not one of the
five, and `search`, a case-insensitive substring matched against the title,
description, category and tags at once. Both run
`filterDeckTemplates()` from `server/schemas.ts` — the same function the gallery
in the browser filters with, so the two cannot mean different things by one
search. `GET /api/templates/:id` answers one entry, or **404**.

**Copied into a new deck (REQ006).** `POST /api/presentations` with
`{ "templateId": "quiz-round" }` creates an ordinary presentation whose slides
are **copies** of that entry's:

- Every identity is re-minted — the slide, its options, statements, items,
  accepted answers and form fields, and a form field's own options
  (`withFreshSlideIds()`, shared with the client's duplicate and import paths).
- Nothing records the origin. There is no `templateId` on the stored deck, so
  editing it cannot reach the catalog, and two decks made from one entry share
  no id with each other.
- `title` and `slides` may both be omitted on such a create (the title is
  inherited from the entry); every create that names no template still requires
  a non-empty title and at least one slide. An unknown `templateId` is a **400**
  (`{ "error": "No such template" }`) and writes nothing.
- The create is rate-limited on the ordinary create budget (REQ145). The slides
  being free to the caller is exactly why it must not be cheaper.

**A template holds slides, not a room's settings.** Language, pace, reveal mode,
the Q&A layer, the participant channels and the theme all come from the request,
with their usual defaults — a template cannot switch any of them on. The Q&A
layer and the two channels are off on a new deck by decision rather than by
omission (REQ036/REQ077/REQ078), and picking a prebuilt deck out of a gallery is
not the organizer opening their room's chat. The one deck-shaped decision a
template *can* carry is a slide's own `resultsVisibility` (REQ102), because that
lives on the slide and travels with it.

## Generating a deck from a prompt (REQ007)

The second way a deck starts from *something* rather than from nothing, beside
the template catalog above. `POST /api/deck-generation` takes a short brief and
answers with an ordinary presentation — the same document, the same `draft`
status and the same one-time `creatorToken` that `POST /api/presentations`
returns, created through the same code path. There is no second kind of deck and
no proposal to confirm: what comes back is already in the store, already has a
join code, and is already editable.

```json
{ "prompt": "a retro for my team of eight after a rough release", "language": "de" }
```

`prompt` is required and capped at 500 characters. `language` defaults to `en`,
is capped at 40 characters, and does double duty: it is the deck's participant
language (REQ084) *and* the language the generator is told to write its questions
in. **Both** are bounded because both are forwarded to the provider — the cap on
the deck's own `language` at create time exists only to bound what is stored,
while here it bounds what this server sends to a third party on a caller's word,
and a ceiling on one forwarded field alone bounds nothing. **Nothing else is
accepted** — a generated deck's pace, reveal mode, Q&A layer, participant
channels and theme all take their ordinary defaults, for the reason a template
cannot switch any of them on either (REQ036/REQ077/REQ078): the withholding value
is what an unstated setting means, and a prompt is not the organizer opening
their room's chat.

### The output is a draft, and no answer comes back marked correct

This is REQ007's second sentence, and it is enforced by the **vocabulary** rather
than by a pass that strips something afterwards. The schema a generator answers
with has no field that can express a correct answer — no `isCorrect` on an
option, no `quizAnswers`, no `guessReference`, no `pinArea` — so a generated quiz
arrives with its question, its options and **no key**. That is exactly the "no
notion of correctness at all" state a slide whose author marked nothing already
has (REQ013): nobody scores, rather than everybody scoring against a guess.

Deciding which answer is right is the organizer's first edit, and it is an
ordinary `PATCH` like any other. The distinction matters because the alternative
is a leaderboard (REQ059) built on a model's confidence — a room scored, ranked
and shown its standing against something nobody checked.

The same construction is why a prompt that *asks* for marked answers still gets
none: there is nowhere for the mark to go.

### What a generator may author

Ten of the twenty slide types: `text`, `instruction`, `multiple-choice`, `quiz`,
`word-cloud`, `open-text`, `scale`, `ranking`, `points`, `leaderboard`. The set
is reported by `GET /api/deck-generation` rather than hard-coded by a client. Two
groups are left out, each for its own reason:

- `image`, `video`, `embed`, `pin-image` need an **asset that lives somewhere
  else**, and a generator has none to point at — an invented URL is a slide that
  renders as a broken frame. Generated media is not part of this requirement.
- `grid`, `guess-number`, `form` need a **frame** before they need a question
  (two labelled axes, a numeric span, a set of typed fields). `form` is further
  out still: it collects data *about the participant*, which nothing should
  decide to do on a one-line brief.

A draft is between 3 and 12 slides, and **both ends are enforced on what comes
back** rather than only on what the provider was asked for. Slides that are not
slides are **dropped individually, not repaired and not fatal**: no question, or a
choice/ranking/points slide with fewer than two rows, and it is left out while the
rest of the deck stands. If what survives is fewer than three slides the whole
draft is refused (`502`, `unusable-draft`) instead of handing over a deck that is
really a question — a draft of exactly three whose middle slide has one usable
option is exactly that case. Row lists are cut to the type's own ceiling; authored
text that exceeds the write boundary's cap (REQ159) is refused rather than
truncated, because a shortened question is a different question.

### Asking whether it is available, first

`GET /api/deck-generation` is public and read-only — generation being configured
is a fact about the *build*, not about the caller:

```json
{
  "available": false,
  "reason": "This server is not configured to generate decks — no generation provider key is set",
  "promptMaxLength": 500,
  "slideTypes": ["text", "instruction", "…"],
  "requiresAccount": true
}
```

A self-hosted deployment with no provider key is the **default** posture, not an
error. `reason` is an explicit `null` when generation is available (ADR-0024), so
a client reads one shape either way. Ask this before drawing the control: ADR-0025
wants it drawn and disabled with the reason, and a reason that only arrives on the
click is a button that looks broken.

`requiresAccount` is the second thing a surface needs for that: it says whether
this deployment will only draft for signed-in accounts, which is **true unless the
operator set `OMUL_GENERATION_ALLOW_ANONYMOUS=true`**. Like `accessLevel` on a
deck it is a *report*, never a credential — the route re-reads the switch and
re-resolves the caller on every request, so a client that gets it wrong only
mis-draws its own button.

Why this exists as a separate control rather than leaving the abuse limits to it:
the generation budget is removed wholesale by `OMUL_RATE_LIMITS_DISABLED`, which
is documented for a self-hoster on a trusted network. Losing the disk limiter that
way is the operator's decision; inheriting an unauthenticated LLM proxy on their
own provider credential is not one they made. The account requirement is
independent of that switch and defaults to the restrictive setting.

### Refusals

| Status | When |
|---|---|
| `401` | This deployment requires an account and the request carries none — refused **before** the budget is spent and before the provider is called |
| `422` | The prompt or the language is missing, empty, or past its cap — refused by the body schema, and **never forwarded** |
| `429` | Over the generation budget (5 per 5 minutes per client), which also spends the ordinary create budget (REQ145) |
| `502` | The provider failed, or answered with something that is not a usable deck |
| `503` | This deployment has no generation provider configured |

Each carries `{ error, refused }`, where `refused` is one of `unavailable`,
`account-required`, `provider-failed` or `unusable-draft` — the prose is for a
bare API caller, the code is for a client that wants to say it in its own words,
the same split the vote refusals use. A provider's own error text never reaches the caller (it can
carry a request id, a quota state or a fragment of the prompt); it goes to the
server log.

The remote provider is an intentional, documented exception to ADR-0016 — see
[deployment.md](deployment.md#generating-a-deck-from-a-prompt-req007) for the
variables, the boot-time report and what does and does not leave the building.

## The deck's theme and its logo (REQ079, REQ080, REQ092, REQ135, REQ136)

A deck carries four theming fields, and all four are **public**: they ride the
ordinary presentation document, so they reach `GET /api/presentations/:id`,
`GET /api/join/:code` and the deck list alike. That is deliberate — the theme is
what every phone in the room draws itself in and the logo is the mark it draws
instead of ours, so none of it is a secret and all of it has to come through the
participants' door.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `theme` | one of `signal`, `pulse`, `ember`, `editorial`, `broadcast`, `custom` | `signal` | Which theme the deck is drawn in (REQ079/REQ080) |
| `themeBrand` | object, below | every field at its default | The theme the deck defines for *itself*, applied when `theme` is `custom` (REQ080/REQ135) |
| `themeLogoUrl` | string | `""` | The organizer's mark, as an image URL (REQ136) |
| `themeLogoAlt` | string | `""` | Its accessible name; falls back to the deck's title |

`themeBrand`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string, ≤ 200 chars | `""` | What the theme is called in the picker — capped where the deck's `title` is, being authored display text on the same public document |
| `accent` | `#rgb` / `#rrggbb`, or `""` | `""` | The brand colour: bars, links, everything live, the wash behind a slide |
| `canvas` | `#rgb` / `#rrggbb`, or `""` | `""` | The surface a slide is drawn on |
| `text` | `#rgb` / `#rrggbb`, or `""` | `""` | The words on that canvas; derived from the canvas when empty |
| `font` | one of `figtree`, `system`, `serif`, `mono` | `figtree` | The face the theme's text is set in (REQ092). The retired id `sora` is also accepted and reads back as `figtree` (REQ178) |

**A built-in theme stores only its id.** What `pulse` *looks* like — its palette
in both colour schemes, the wash behind a slide — lives on the client, in
`src/components/DeckTheme.tsx`, so a deck authored today renders in whatever the
palette has become tomorrow.

**A theme the deck defines for itself has no such catalog to point at, so its
colours do cross the wire** — there is nowhere else they could live, and the room
has to receive them the way it receives the deck's title. What that admits is
bounded by validating each value as narrowly as it can be: a colour is `#rgb` or
`#rrggbb` and **nothing else** (no `rgb()`, no named colour, no `var()`, no
`url()`), and the typeface is an **id** from a closed set, never a family name.
So a hand-built request can paint a room in its own colours — which is the point
— and cannot put anything but a colour into a colour.

**The face is an id because of what REQ092 asks for.** "Loaded so every surface
resolves the same face" cannot be true of a family name each machine looks up in
its own font book, and ADR-0016 forbids fetching one at runtime — so a theme
picks from what the bundle already ships (`figtree`, `mono`) or from a generic
stack every system resolves (`system`, `serif`). The stacks themselves stay on
the client beside the palettes.

**One id is retired rather than refused: `sora`.** It named the house face until
REQ178 moved that face to Figtree, and the set is closed — so dropping it
outright would have made every deck that had chosen the house face fail the
docstore's schema gate and stop opening. It is folded onto `figtree` at the
boundary instead, on the way in and on the way out, so a document stored under it
reads back as `figtree` and a request still sending it is accepted rather than
4xx'd. It is not offered in the editor and no response ever contains it.

**Three authored colours become a whole palette, twice.** The client derives the
remaining tokens — raised surfaces, borders, the muted and dim text ramps, the
accent's hover and glow — along the canvas → text axis, and derives the *other*
colour scheme from the canvas's own hue: which scheme a brand was authored for is
read off how light its canvas is, and the reader's light/dark preference stays
theirs either way. An accent that would be illegible on the derived scheme's
canvas is moved until it is not; an authored value is never adjusted (telling the
organizer their own contrast is thin is REQ132, still pending).

**Validation, and where the rejection comes from.** `POST /api/presentations`
validates the whole theming block against `CreatePresentationSchema` and answers
**4xx** for a theme id outside the set, a colour outside the grammar or a face
this build does not ship; `PATCH /api/presentations/:id` declares no body schema
(pre-existing, as above) so the same rejection arrives from the docstore's schema
gate as a **500**. Either way it is not stored. `themeBrand` is written **whole**
— the object replaces the stored one rather than merging into it, so a PATCH that
names it must carry every field it wants kept.

**Setting a theme is a presentation mutation**, authorized like every other one:
owner or edit token. All four fields travel on the ordinary `PATCH`, alongside
title, slides and the rest — there is no separate theming endpoint, because there
is no moment in a session when re-theming is a thing to do on its own. Authoring
a brand and applying it are the same mutation twice: a deck may carry a
`themeBrand` while `theme` still names a built-in one, which is what lets an
organizer try `Ember` on without discarding the colours they authored.

**A logo URL is refused rather than repaired.** `deckLogoFor()` in
`server/schemas.ts` is the single read site for the mark and allowlists the
scheme: `http(s)` and a root-relative path resolve; `javascript:`, `data:`,
`file:`, a protocol-relative `//host/…` and anything unparseable resolve to
`null`, and the surface falls back to the product's own mark. The safe answer is
the default, so a client that never asked the resolver is the only way a bad
string reaches an attribute — which is what
`scripts/guard-frontend-conventions.ts` fails the build over. The value is stored
as typed either way; it is simply never used as a URL.

**And so is a brand value.** `deckBrandFor()` beside it is the single read site
for an authored theme, gated on `theme === "custom"` so "is this deck branded?"
is one question rather than two. Every colour comes back validated or empty, and
the face comes back as an id this build has a stack for — a value a later build,
a hand-built document or a widened grammar left behind reads as unauthored, and
the house theme's own value stands in its place. Same guard, second rule: a
surface reading `themeBrand` itself fails the build.

**Nothing is broadcast.** A theme changed mid-session reaches a browser on its
next read of the deck, not over the socket — unlike the reveal mode and the Q&A
settings, which have live presenter controls that can change them while a room is
watching. Re-theming happens in the editor, which is a different screen from the
one being projected.

## The deck's reveal mode (REQ015, REQ016, REQ017, REQ018)

**When a question slide's tally reaches the audience is a publication decision,
not a rendering one.** Three modes, set on the deck and overridable per slide:

| Mode | What the audience gets |
|---|---|
| `instant` | the tally, updated as each answer lands (REQ015) |
| `on-click` | nothing until the presenter reveals that slide (REQ016); the reveal is `POST /presentations/:id/reveal` |
| `private` | never a tally (REQ017) — the answers are recorded and reachable on the results surface only |

The deck carries `resultsVisibility` (one of the three, default `instant`); each
slide carries `resultsVisibility` too, as `"inherit"` (the default) or an
override of the deck. `effectiveResultsVisibility()` resolves the pair, and
`tallyVisibleToAudience()` turns it into the one question every surface asks:
**may this caller be sent this tally?**

### The gate is on the wire, not on the renderer

A tally that reaches a participant's browser has been published, whatever the
client then chooses to draw. So the withholding happens in
`aggregateSlideResults()`, before a single number is computed, and every surface
that hands a tally out lands there:

- `GET /presentations/:id/results/:slideId` and `GET /presentations/:id/results`
- the `results.updated` WebSocket broadcast — read **without** `canEdit`,
  deliberately, because that frame goes to the whole room
- the preview's `audienceResults` pane (REQ103), which is why a dry run shows
  the organizer what the room will actually be missing

A caller who cannot prove they can edit the deck reads this in place of the
numbers:

```json
{ "type": "multiple-choice", "withheld": true }
```

Stated rather than silently emptied: an all-zero tally is a lie a client would
draw under a question twenty people have answered. Announcing it leaks nothing —
the mode itself rides the deck payload every participant already holds, and both
live surfaces say "results are private" / "results are hidden" on screen in
words. The client's `api.getResults()` reads the marker back as `null`, in one
place, so no component learns a second falsy shape.

**The owner and the holder of the edit token read every tally under every mode.**
That is the results surface REQ017 keeps a private slide's answers reachable on,
and it is why the presenter's own screen is fed by its credentialed poll of the
results endpoint rather than by the room-wide broadcast. **So does the holder of
the deck's results link** (REQ098), which is the read-only delegation of that
same surface and the *only* thing the link grants — see **The shareable results
link** below. All three answers come out of one function,
`tallyVisibleToCaller()`, which composes the gate above with the credentials a
request carries.

### Ending a session is not revealing

An unrevealed `on-click` tally, and a `private` one, stay unpublished after
`POST /presentations/:id/end`. This is deliberately stricter than the answer-key
rule two sections down (`solutionVisibleToAudience()`), which *does* release a
quiz key once the deck ends: a key has nothing left to game when the room is
done, while "never on screen" and "only when I say" are decisions the organizer
made about their own numbers. It also keeps the server in step with the
participant surface, which reads the same function.

### One mode for the whole deck (REQ018)

`POST /presentations/:id/results-visibility` with `{ resultsVisibility }` sets
the deck-level mode **and** returns every question slide to it, in one request.
What it actually writes is `withInheritedResultsVisibility()`: the per-slide
overrides are *cleared* rather than overwritten with the mode, so the deck stays
uniform under the next deck-level change instead of freezing at today's value.
Content slides are untouched — they show something rather than ask something and
have no tally; the set swept is `slideHasResults()`, so a slide type that gains
an aggregate later is included without this operation being edited.

Two writes that have to be one: an organizer who ran only the deck half would
have a deck whose setting says `private` and whose overridden slides still
publish live.

**It loosens as readily as it tightens**, and that is the operation, not an
oversight. Applying `instant` publishes live on slides an earlier decision had
pinned to `on-click` — a Pin on Image slide with a target area (REQ053) among
them, whose target is drawn on the reveal this clears. The editor states the
consequence and the number of slides affected beside the button that runs it
(ADR-0025); what it must not do is apply to some slides and not others, which
would leave the organizer believing the deck is uniform when it is not.

The editor applies the identical function to its unsaved local document and
persists it with the ordinary deck PATCH, so an authoring session and an API
caller cannot disagree about what "apply to the whole deck" means (ADR-0026).

### Reaching a live room

`resultsVisibility` has **two writers** — this endpoint and the ordinary deck
PATCH the editor saves through — and both broadcast
`presentation.results-visibility`. A write that told nobody would be worse here
than anywhere else: the server *does* stop publishing, so a silent switch to
`private` leaves the last tally every phone was legitimately sent frozen on
screen under a question that is now private, until each participant reloads. A
PATCH that does not name the field broadcasts nothing.

The frame carries the deck-level setting **and nothing else**. It deliberately
does not say what became of the per-slide overrides, because that depends on the
writer: this endpoint clears them, an ordinary Save may move the deck default
with every override left standing. Clients patch the deck field from the frame
and **re-read the deck** to settle the slides (`refreshDeckSlides`), which is
also how a Pin on Image target area (REQ053) that the new mode has made
publishable reaches them — the same re-read the reveal set triggers, reached
through a second door.

## The live room — participation and the blank screen (REQ111, REQ109)

Two things a presenter decides about the room **while it is in front of them**,
and they are documented together because they are the two REQ109 exists to keep
apart: whether the slide on screen is *taking answers*, and whether the shared
screen is *showing anything*.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `closedSlideIds` | string[] | `[]` | The slides the presenter has closed to submissions (REQ111) |
| `audienceBlanked` | boolean | `false` | Whether the shared screen is currently blanked (REQ109) |

Both are **server-managed live state**, in the family `revealedSlideIds` and
`slideStartedAt` belong to rather than the authored fields beside them. They are
absent from `UpdatePresentationSchema`, so an editor's ordinary Save cannot move
either; they are absent from the JSON export, because they belong to a session
rather than to a deck; and a **reset** (REQ101) clears both, since a re-run that
inherited the last session's closed questions would refuse a room that had done
nothing, and one that inherited a blanked screen would start behind a dark
projector with no answer to why.

**A `start` does not clear either, and that is the decision rather than the
omission** — the same standing `revealedSlideIds` has. Both are writable on a
`draft` deck and survive going live, because for each of them that is a real
workflow rather than an accident: blanking *before* starting is how an organizer
opens the room without putting the first slide on the wall until they are ready,
and closing a slide before the room arrives is how they run a deck without one
of its questions. Neither can surprise silently — a blanked screen replaces the
whole shared surface with a curtain that says so and carries its own way back,
and a closed slide says "Submissions closed" on the presenter's own copy of it.
`reset` is the one operation that means "this is a fresh run", and it is where
they are cleared.

Both are **public**, and necessarily so. A phone that did not know a question was
closed would offer a control the boundary is refusing — ADR-0025 asks a disabled
control for the *true* reason, and this is where that reason comes from — and the
screen being projected may be a second browser (the read-only presenter view)
rather than the presenter's own laptop.

### Closing a slide refuses submissions, and says so (REQ111)

`POST /presentations/:id/participation` with `{ slideId, open }`. While a slide
is closed, `POST …/vote` and `POST …/response-vote` both answer **`400`** with a
stated reason rather than dropping the submission:

```json
{
  "error": "The presenter has closed this slide to submissions",
  "refused": "participation-closed"
}
```

Stated rather than folded into the generic "cannot vote": the answer was
well-formed and the deck is live, and the only thing wrong with it is a decision
somebody took in the room a moment ago. It joins the two quiz refusals
(REQ054/REQ057) on the same mechanism — `VoteRefusal` in
`server/services/presentations.ts`, read back by `isVoteRefusal` at the route —
and, unlike them, applies to **every slide type**.

**Every stated refusal carries its machine-readable `refused` code** beside the
prose — one of `VOTE_REFUSAL_CODES` in `server/schemas.ts`
(`quiz-window-closed`, `quiz-already-answered`, `participation-closed`). The
prose is for a bare API caller; the code is for a client that wants to say the
same thing in its own words.

**That string is the API's, not the room's.** Like the quiz refusals beside it,
the participant surface pre-empts the round trip and shows the same fact in the
deck's own language (REQ084 — `participationClosed`, "The presenter has closed
this question" in English), because the phone in the room reads the deck's
language and an API caller reads English. A submission that goes out anyway — a
tap racing the broadcast — comes back with the `refused` code, which the phone
maps onto the same localized strings instead of guessing the reason from its
own countdown state. So a participant reads the deck's language either way, and
an API caller reads English; both state the reason, which is what REQ111 asks
for.

Five properties worth stating outright:

- **Nothing collected is touched.** Closing keeps every answer already given, the
  tally goes on being readable and reveal-able, and reopening does not clear what
  arrived before. That is the whole difference between this and a reset, and it
  is what lets a presenter close a question, discuss it, and open it again for
  the people who were still typing.
- **The stored set is the slides that are *closed*.** The polarity is
  load-bearing: a deck's ordinary state is that every slide takes answers, which
  is what an unopened deck, a deck written before this field existed, and a deck
  whose presenter never touched the control all mean. Storing the open set would
  make "nothing recorded" read as "nothing takes answers" — a whole room silently
  refused because a field defaulted (ADR-0029).
- **`open` is required.** This is where it parts company with `/reveal` next
  door, whose `reveal` defaults to `true`: a reveal has a natural direction, while
  opening and closing a question are two equally ordinary halves of one control,
  so neither is the default and the request says which.
- **It is one slide's state, and independent of everything around it.** The
  deck's reveal mode is a different question (a closed slide can still publish its
  tally), a quiz's window is a different question (REQ057 — the clock closes a
  question on time, this closes it on the presenter's word, and neither speaks for
  the other), and the deck-wide `acceptsSubmissions` rule is a different question
  again (a slide can be open on a deck that has not been started).
- **What it does *not* reach**: the Q&A layer (REQ036), the chat (REQ078) and
  reactions (REQ077). All three are deck-wide and belong to the session rather
  than to the slide on screen — a reaction in particular is explicitly not an
  answer to the question in front of it.

A `slideId` the deck does not have is a **`404`** and writes nothing: an unknown
id in the closed set would outlive the slide it named and could not be reopened
from any surface.

### Blanking takes the shared screen and nothing else (REQ109)

`POST /presentations/:id/blank` with `{ blanked }`. What goes dark is the one
view the room looks at together — the projected slide, its background and the
reactions crossing it. **A participant's own phone is untouched**: it keeps its
question, its control and its answer.

That is not a limitation, it is what makes the requirement's own sentence true. A
phone drawn blank could not go on collecting answers, so "without closing
participation" would mean nothing. The room's attention comes off the wall; the
room's ability to answer does not move.

So the endpoint writes **one boolean** and leaves `status`, `activeSlideIndex`,
`closedSlideIds`, `slideStartedAt` and every stored vote exactly where they were.
A blank that also paused the session would be three decisions taken because the
presenter asked for one.

- **Deck-level and sticky across navigation.** The presenter can line the next
  slide up behind a dark screen, which is most of what a blank is for — the
  presenter surface keeps its slide navigation on the curtain for exactly that.
- **It survives a reload**, because it is stored rather than held in a tab.
- **The room is shown something rather than nothing**: a projector that simply
  went dark is indistinguishable from one that has lost its signal, so the shared
  screen draws a stated curtain and the deck's own mark.

## Removing a submitted answer (REQ027)

`DELETE /api/presentations/:id/answers/:answerId` takes one individual answer
off a word cloud or an open-ended slide. It is the manual half of moderation —
the presenter reads something the room must not go on looking at and takes it
off the wall — and the only route in this API that removes something a
*participant* wrote.

Authorized as **every presentation mutation** is: the deck's owner, its edit
token, or an account holding an `edit` grant (REQ075). Deliberately not
narrower: moderating what is on the shared screen is part of running the deck,
which is exactly what that gate names. A caller with no credential gets `401`,
and an account whose level does not authorize a mutation gets `403`.

### The row is removed, not hidden

Every surface that reports on a deck is a projection of the stored rows, so
deleting the row is what makes "reflected in the tally the room sees and in
every export" true by construction rather than by each read site remembering to
skip a flag. After one call:

- the deck's room is broadcast a recounted `results.updated` for that slide, so
  a phone already looking at the wall drops the line without reloading;
- both results endpoints answer without it;
- the spreadsheet (REQ095) is short its response row, its cell in the
  per-participant matrix and its entry on the Aggregates sheet;
- the PDF (REQ096) no longer draws it.

**The upvotes on a deleted response go with it** (REQ025). They are rows naming
a response that no longer exists, and the exports report how many upvotes a
session collected — leaving them would count a deleted answer's popularity in
the deck's total.

It is **irreversible**: nothing keeps a copy, and clearing the session (REQ101)
is the only other way a stored answer leaves. It works whatever the deck's
status, since a line is worth taking down after a session as much as during one
— and after is when the exports get made.

### Which id, and which slides

The `answerId` is the id the results payload gives an answer:

- an open-text slide publishes `responses[].id` to everybody, because upvoting
  needs it (REQ025);
- a word cloud publishes an **editor-only** `answers` list beside its `words` —
  one entry per individual answer, with its `id`, the text **as it was
  submitted** and its `createdAt`. The cloud itself is an aggregate ("pizza (3)"
  names none of the three rows), so this is the list a deletion can be pointed
  at. It carries no participant id, and it is `null` for every caller who cannot
  edit the deck — stated rather than absent, on the same terms a form slide's
  rows are (ADR-0024).

Answers on other slide types are refused with `400` and a machine-readable
`refused: "slide-type"`, decided by `slideAnswersAreDeletable` in
`server/schemas.ts` — the same predicate the presenter's screen draws the
control from, so no surface can offer a deletion the boundary turns away. Every
other type's answer is a *choice* — an option id, a rating, a point on a grid —
which carries nothing to withdraw and whose removal would silently re-weight a
distribution instead of taking something off a screen. A typed quiz answer
(REQ055) is free text and still refused: that row is scored, so removing it
would move a competitor's standing.

An answer id belonging to another deck answers the same `404` an unknown id
does, so the route cannot be used to probe for one.

Automatic moderation — a profanity filter over incoming submissions — is a
separate requirement (REQ085) and is not implemented; this route is what a
presenter has instead.

## Choice voting and results (REQ013, REQ014)

On a `multiple-choice` / `quiz` slide the vote `value` is an **option id**; an id
that is not on the slide is rejected with 400. How many options one participant
may hold is `maxSelectionsFor(slide)` in `server/schemas.ts` — `mcMaxSelections`
when the author set one, otherwise the legacy `allowMultiple` flag (`1` single
choice, `0` unlimited, `n` capped). A **quiz** slide is always `1` and adds two
rules of its own — one final answer, inside a time window — described under
**Quiz competition** below; everything else on this page applies to both:

- **Single choice (`1`, the default)** — the participant holds one vote row; a
  new submission replaces it.
- **Multi-select (`0` or `n > 1`)** — one row per selected option. Submitting an
  option the participant already holds **deselects** it (the same endpoint drives
  both halves of a checkbox); a submission past the cap returns 400.

The results payload for a choice slide carries both denominators, because with
multi-select they diverge:

| Field | Meaning |
|---|---|
| `totalVotes` | selections cast |
| `respondentCount` | distinct participants who answered — what percentages divide by |
| `maxSelections` | the resolved selection limit (`1` / `0` / `n`) |
| `options[].isCorrect` | `true`/`false` once the slide has a solution to reveal (REQ013), else an explicit `null`. On a **quiz** slide it is withheld (`null`) from anyone who cannot edit the deck until the question is over — see **Quiz competition** below |
| `answerMode` | how a quiz question is answered (`select` / `type`, REQ055); always `select` on a plain choice slide |
| `typedAnswers` | what the room typed on a free-text quiz question, or an explicit `null` everywhere else — see **Quiz competition** below |
| `scoring` | the quiz score behind those answers (see **Quiz competition** below), or an explicit `null` on a plain choice slide — which can reveal a solution without keeping score |

Clients render an option's share as `count / respondentCount`, so "62% of the
room picked this" survives a participant ticking several boxes; pie/donut slice
*geometry* divides by `totalVotes` instead so the disc still closes.

## Ranking voting and results (REQ033, REQ034)

On a `ranking` slide the vote `value` is the participant's whole ordering: the
`rankingItems` ids they placed, **best first**, comma-separated. Build it with
`encodeRanking()` and read it with `decodeRanking()` from `server/schemas.ts` —
neither end spells the wire format itself. A submission is rejected with 400
when it is empty, names an item the slide does not have, or places the same item
twice; a **partial** ordering (only some of the items) is accepted, since REQ034
lets participants rank just part of the list.

One participant holds one ordering: re-submitting **replaces** it rather than
adding a second, so a participant can keep adjusting their order. Item counts
are capped at `RANKING_ITEM_LIMIT` (10) by the schema.

Results aggregate the orderings Borda-style — an item placed p-th (0-indexed) on
a ballot earns `itemCount - p` points, so the top of every ordering is worth the
same however far down that participant went, and an item nobody placed simply
earns nothing:

| Field | Meaning |
|---|---|
| `totalVotes` | vote rows stored for the slide |
| `ballots` | orderings the tally could read — the denominator behind `notRanked` |
| `itemCount` | items the slide offers |
| `items[]` | the aggregated ranking, best first |
| `items[].rank` | 1-indexed place in that aggregated ranking |
| `items[].points` | total Borda points |
| `items[].rankedCount` / `notRanked` | ballots that placed this item / left it out |
| `items[].averageRank` | mean 1-indexed position among ballots that placed it, or an explicit `null` when none did (ADR-0024) |

Ties break on the better average position, then on the authored item order, so
the same votes always render the same way.

## 100 Points voting and results (REQ044, REQ045)

On a `points` slide the vote `value` is the participant's whole allocation:
`itemId:points` pairs joined by commas, over the slide's `pointsItems`. Build it
with `encodePoints()` and read it with `decodePoints()` from `server/schemas.ts`
— neither end spells the wire format itself. Items given nothing are simply
absent from the value; `decodePoints()` reads them back as an explicit `0`, so
no consumer has to reach for `??` to learn an item went unfunded.

**A ballot must spend exactly `POINTS_BUDGET` (100).** Anything else is rejected
with 400 at the boundary rather than trusted from the client: the forced
trade-off is the format, an under-spent ballot would still be divided by a full
budget in the tally and flatter every item it did fund, and an over-spent one
would buy a participant more say than the room. Also rejected: an empty
submission, a fractional or negative amount, an item the slide does not have,
and the same item funded twice. Item counts are capped at `POINTS_ITEM_LIMIT`
(8) by the schema.

One participant holds one budget: re-submitting **replaces** it rather than
adding a second, so a participant can keep moving points around. What is stored
is re-encoded from what the codec read, so the tally always sees a canonical
allocation (authored item order, zeros dropped).

| Field | Meaning |
|---|---|
| `totalVotes` | vote rows stored for the slide |
| `ballots` | allocations the tally could read — the denominator behind `notFunded` |
| `budget` | the points each of those ballots spent, in full (100) |
| `itemCount` | items the slide offers |
| `totalPoints` | points actually distributed — `ballots × budget` |
| `items[]` | the aggregated priority order, most points first |
| `items[].rank` | 1-indexed place in that order |
| `items[].points` | total points the room gave the item |
| `items[].share` | those points as a percentage of `totalPoints`, to two decimals — the shares sum to 100% |
| `items[].funderCount` / `notFunded` | ballots that gave the item at least one point / gave it nothing |
| `items[].averagePoints` | mean points **among the ballots that funded it**, or an explicit `null` when none did (ADR-0024) |

`share` and `averagePoints` are deliberately different readings: `share` spreads
an item's points across everyone, `averagePoints` across only its backers. A
niche item a few people bet heavily on scores a low share and a high average; a
bland one everybody tips scores the reverse, and the gap between them is the
trade-off the slide exists to surface.

Ties break on the broader backing (more funders), then on the authored item
order, so the same votes always render the same way. A stored allocation that no
longer decodes — the organizer dropped an item it funded, so the rest no longer
sums to the budget — stops counting entirely rather than being read as a
half-spent budget.

## Quiz competition — scoring and the question window (REQ054–REQ057)

A `quiz` slide is a choice slide that keeps score. It votes like one — `value`
is an option id — with two rules a plain `multiple-choice` slide does not have,
both enforced at the boundary and both in `server/schemas.ts` so no surface
re-states them:

- **One answer, final.** A participant holds exactly one answer and a second
  submission returns 400 — unless the option they picked has since been authored
  off the slide, which is not an answer to the question as it now stands (the
  tally already drops it), so the stale row is cleared and they answer once more. Everywhere else here a re-submission replaces the last
  one, because the datum is the opinion the participant ended up holding; on a
  quiz the datum is what they knew *at that moment*, and speed is part of the
  score, so a re-answer would let someone bank an instant response and correct
  it once the room reacted. `maxSelectionsFor()` therefore returns `1` for a
  quiz whatever `mcMaxSelections` says.
- **Inside the window.** An answer after the question closed returns 400.

### Two ways to answer (REQ054, REQ055)

How the answer is *given* is a mode on the slide (`quizAnswerMode`), not a
second slide type, because everything that makes a quiz a quiz is the same
either way — one final answer, one window, one scoring model, one scorecard,
one withheld answer key. Read it through `quizAnswerModeFor()`, which is also
where a non-quiz slide's leftover value is ignored.

| `quizAnswerMode` | The answer set | `value` on the vote |
|---|---|---|
| `select` (default, and what every deck authored before REQ055 carries) | `options[]`, with `isCorrect` marking the solution (REQ013) | an option id |
| `type` (REQ055) | `quizAnswers[]` — up to `QUIZ_ANSWER_LIMIT` (10) accepted solutions | the text the participant wrote, via `encodeQuizAnswer()` / `decodeQuizAnswer()` |

A typed submission is rejected with 400 when it states no answer at all (empty,
whitespace, or nothing but punctuation). What is **stored** is the participant's
own spelling, trimmed and otherwise untouched: normalization is how two answers
are *compared*, never how one is recorded, and a rewritten answer would show a
participant words they did not type under a verdict about whether they were
right.

**A typed answer is correct when it matches one of the organizer's accepted
solutions exactly, after normalization** (`normalizeQuizAnswer()`). Normalization
folds case, strips Latin-script diacritics (so `Muller` answers `Müller`), collapses
internal whitespace, and trims surrounding punctuation and quotes (so `Paris.`
answers `Paris`). It folds nothing else — no reordering, no abbreviation, no edit
distance, and punctuation *inside* the answer stays (`C++` is not `C`).

That line is where it is for one reason: a scored competition must never award
a wrong answer. Distance-based matching cannot have that property on the answers
quizzes are made of — `1997` and `1987` are one edit apart — and a grader that
silently credits the wrong year fails in the direction the organizer cannot see.
Refusing a right answer over a keyboard is the failure they *can* see and fix, so
variants that no normalization could fairly fold (`USA` / `United States`) are
admitted by the organizer adding them to `quizAnswers`, where the decision is
visible and theirs. A slide with no accepted answer has no notion of correctness
at all and scores nobody — the same stance a choice slide takes when its author
marked no option (REQ013).

The accent fold is scoped to the three **Combining Diacritical Marks** blocks —
what NFD decomposes a precomposed Latin letter into — and deliberately not to
`\p{M}`, every combining mark in Unicode. In Devanagari, Thai, Hebrew and Arabic
those marks are not accents on a letter, they *are* letters: `\p{M}` would fold
`कील` onto `कल` and `ที่` onto `ท`, awarding full marks for a different word,
which is exactly the invisible failure the rule above exists to prevent. The
cost is that a non-Latin accent is not folded — `καφε` does not answer `καφέ` —
and that is the visible, fixable direction the rule always errs in.

An organizer may switch an existing question between modes. A stored answer that
is no longer an answer to the question **as it now stands** — an option since
deleted, or an option id on a question that now takes typed answers — is dropped
by the tally and does not lock its participant out (`isStandingQuizAnswer()`).

### The window

A question **opens** when the presenter reaches its slide: the server stamps
`slideStartedAt[slideId]` (an ISO instant on the presentation document, public
because both the shared screen and every phone have to agree on when the
question closes) and broadcasts `slide.started`. It **closes**
`timeLimit` seconds later.

| Setting / field | Meaning |
|---|---|
| `timeLimit` (slide) | seconds the question stays open. **`0` means no limit** — the authored spelling of "the pace is mine, not a clock's" — and is kept apart from a number of seconds everywhere downstream |
| `slideStartedAt` (presentation) | ISO instant per slide id; the only thing a deadline is derived from |
| `serverNow` (on `GET /presentations/:id` and `GET /join/:code`) | the server's clock at the moment of the response, so a client renders its countdown against the clock the deadline was written in rather than the device's |

A slide is stamped **once**, on first arrival, and re-stamped only by
`POST /presentations/:id/timer`. Re-stamping on every visit would make a
question's window — and so every score measured against it — depend on how often
the presenter paged back through the deck. Restarting hands the remaining
participants a fresh window; answers already given stand (`reset` is what clears
votes, and it clears the stamps with them).

Two cases have **no deadline at all**, and they must not read as one already
past: a question the presenter has not reached, and a survey (REQ003/REQ082),
where nobody paces the room so there is no shared instant a question started. A
survey quiz is therefore untimed by construction.

Submissions are accepted for `QUIZ_SUBMISSION_GRACE_MS` (1.5 s) past the
deadline, because a tap made at half a second left still has to reach the
server. The grace buys acceptance, never points — elapsed time is clamped to the
window before it is scored.

A quiz slide states **why** it refused an answer, rather than folding it into the
generic "cannot vote": `The time for this quiz question is over` and `Your answer
to this quiz question is final`. Only the quiz rules produce a stated refusal,
because only they turn away a submission the participant had every reason to
believe would land. A submission with no `participantId` is refused outright on a
quiz slide — under the one-answer rule the first id-less caller would otherwise
lock out every other one.

**Survey decks are untimed by construction**, and the editor says so where the
limit is authored: nobody paces the room, so there is no shared instant a
question started, the countdown never runs, and every correct answer scores the
full 1000.

### What an answer scores

Points are **derived, never stored**: a function of the votes and the slide as it
stands now, so re-marking which option is correct re-scores the room with no
migration and no stale total left behind.

| Constant | Value | Meaning |
|---|---|---|
| `QUIZ_CORRECT_POINTS` | 500 | what a correct answer is worth on its own, however late in the window it lands |
| `QUIZ_SPEED_POINTS` | 500 | the most a *fast* correct answer adds, falling linearly from the instant the question opens to nothing at the deadline |
| `QUIZ_MAX_POINTS` | 1000 | instant and correct |

A wrong answer scores nothing — a quiz competition ranks knowledge, and a
consolation point for answering would rank participation. A slide whose author
marked nothing correct has no correct answer, so nobody scores on it. An
**untimed** question awards the speed component in full: there is no window to be
fast inside, so nobody is ranked against a clock the slide never offered, and
every question stays worth the same at its best.

An answer that **predates** the window it is measured against — the presenter
restarted the question's timer under it — earns the correctness half and no
speed bonus. Crediting it as instant instead would invert the ranking the score
exists to produce: whoever answered last before the restart would take the
maximum, outscoring everyone who answers the fresh window quickly.

### The answer key is not shipped to competitors

A quiz slide's `options[].isCorrect` — and, on a typed question, the
`quizAnswers` themselves — is the answer to the question the room is being
scored on, so it does not reach a browser that cannot edit the deck until that
question is over. Suppressing it in the UI would not be enough: what a client
holds, a client can read out of the network tab.

Two audiences, one predicate (`solutionVisibleToAudience` in
`server/schemas.ts`):

- **Can edit the deck** — the owner, or the holder of the edit token: the author
  in the editor and the presenter on the shared screen. Always sees the marks.
  The browser proves this by sending the stored token on `GET /presentations/:id`
  and `GET /presentations/:id/results/:slideId`, exactly as it already does on
  mutations.
- **Everyone else** — sees a quiz slide's marks only once the question is over:
  its window has closed, the presenter deliberately revealed that slide's results
  (REQ102 — the reveal signal an *untimed* question has instead of a deadline),
  or the presentation has ended.

This covers all three channels a competitor could read: the deck itself
(`GET /join/:code`, which is never treated as an editor — an organizer opening
their own join link is in the room as a participant), the `slide.changed`
broadcast on navigation, and the `results.updated` frame pushed after every
answer that lands. A question the presenter has **not reached yet** is withheld
too: the whole deck arrives at the join, so a quiz three slides ahead would
otherwise land answered.

Withheld marks are **dropped** from the slide's options rather than emitted as an
explicit marker, because there the absence is the point: a withheld solution has
to be indistinguishable from a slide whose author marked nothing. `quizAnswers`
empties to `[]` for the same reason and reads the same way. A typed question's
`options` are emptied too: it offers none to anyone, and a question switched from
`select` keeps the options it was authored with (deliberately — that is what
makes the stale answers under it recognisable), with the correct one still
spelled out among them. The tally keeps ADR-0024's explicit `null`, where the key
is a documented part of the contract.

A plain `multiple-choice` slide is unchanged (REQ013): it keeps no score, and a
knowledge check that hid its own answer key from its tally would have no point.

### The room's score, on the results payload

`scoring` on a quiz slide's results is deliberately **anonymous** — how many
answered, how many were right, what they scored, never who. The results endpoint
is public and unauthenticated, and a participant id is the only credential a
vote carries, so listing ids would let anyone overwrite another participant's
answer.

| Field | Meaning |
|---|---|
| `correctPoints` / `speedPoints` / `maxPoints` | the constants above, so a client never hardcodes them |
| `timeLimit` / `startedAt` / `deadline` | the window; all `null` together when there is none |
| `closed` | whether the question is past its window *now* (grace included). A question with no deadline is never closed |
| `answeredCount` / `correctCount` | answers the tally scored, and how many were right |
| `totalPoints` | what the room banked on this question |
| `averagePoints` / `correctShare` | mean points (two decimals) and the correct percentage, both an explicit `null` until somebody has answered (ADR-0024) |

Beside `scoring`, a quiz tally carries `answerMode` (so a client picks a renderer
from the payload it holds) and, on a typed question, `typedAnswers` — an explicit
`null` on a select-answer one:

| Field | Meaning |
|---|---|
| `typedAnswers.distinctCount` | distinct answers the room gave |
| `typedAnswers.entries[]` | those answers, most-given first, each `{ text, count, isCorrect }` — or `null` while withheld |
| `typedAnswers.accepted[]` | the organizer's accepted solutions — or `null` while withheld |
| `options[]` | empty on a typed question; it has no options to tally |

`entries` and `accepted` are withheld **together**, on the gate that withholds
`isCorrect`. Grouping is by `normalizeQuizAnswer()`, so `paris`, `Paris` and
`Paris.` are one row rather than three — they are one answer by the same rule
that scored them — labelled with the first spelling that arrived, because a group
has to be shown in words somebody actually typed. The rows are withheld with the
key because on a typed question the answer most of the room wrote *is* the
answer: shipping them mid-question would hand a competitor reading the network
tab exactly what the key is being kept back for, and putting them on the
projector would hand it to the whole room. `respondentCount` and
`scoring.answeredCount` still read throughout, which is what a presenter is
actually watching for.

### One participant's own score

`GET /api/presentations/:id/scorecard?participantId=…` is how a participant
learns their own result. Public in the same sense the vote endpoint is: the
participant id *is* the credential, minted in that browser and never published;
the endpoint hands out nobody else's.

| Field | Meaning |
|---|---|
| `quizCount` / `answeredCount` / `correctCount` | quiz slides in the deck, how many they answered, how many they got right |
| `totalPoints` / `maxPoints` | their score, and what the deck's quiz questions are worth at best |
| `slides[]` | **every** quiz slide, answered or not, in deck order |
| `slides[].answered` | whether they answered at all |
| `slides[].answerMode` | how that question was answered (`select` / `type`) |
| `slides[].optionId` / `answer` | what they picked, or what they typed (REQ055). Both keys are always emitted and only one is ever filled: an option id is not a typed answer, and a client rendering "you answered X" must not have to guess which it holds |
| `slides[].isCorrect` / `elapsedMs` | whether it was right, and how long they took — explicit `null` when they did not answer (ADR-0024); a `false` for `isCorrect` would claim they answered and got it wrong |
| `slides[].points` | what that answer scored (`0` when unanswered) |
| `entryId` / `label` | the one-way handle their row is named by on the deck's leaderboard (REQ059), and what that row is called on screen. Always present, even before they have scored, so a client can match its own row the moment they do |
| `rank` / `rankedCount` | their place on that board and how many participants are ranked — `rank` is an explicit `null` until they have answered something, because unranked is a standing too and a `0` would read as a place they hold |

Both surfaces render the countdown from the same descriptor
(`quizWindowFor` / `useQuizCountdown` in `src/components/QuizTimer.tsx`, ADR-0026).
The participant's verdict waits for the question to close — a verdict on screen
mid-question is the answer itself, one whispered row away from the people still
deciding — and rides the existing results-visibility gate (REQ102), so it can
never outrun a presenter's deliberate reveal.


## Leaderboard slide (REQ059)

A `leaderboard` slide is the deck's standings across its quiz questions: what
every participant has scored so far, ordered, with the top of the field on the
shared screen. It is the one slide type that **collects nothing** — no vote path,
no `isInteractiveSlideType`, no results-visibility override — and still has an
aggregate, which is why the gate every surface fetches through is
`slideHasResults()` rather than "does this slide take answers".

| Field on the slide | Meaning |
|---|---|
| `leaderboardSize` | how many places the shared screen shows; 1–`LEADERBOARD_SIZE_LIMIT` (20), default 5. Read through `leaderboardSizeFor()`, which is also where a hand-built deck's out-of-range number is clamped |

It rides the ordinary results endpoint — `GET /api/presentations/:id/results/:slideId`
— because that is already the channel both screens read a slide's aggregate on:
the presenter's poll, the participant's fetch on arrival, and the broadcast after
an answer lands.

Because scores are **derived from the deck as it stands now**, three different
things move a board, and all three re-broadcast every leaderboard slide in the
deck (`broadcastStandings`): an **answer** landing on a quiz question, a **PATCH**
that changes what counts as correct, and a **restarted question window**
(`POST /:id/timer`), which re-measures the speed half of every answer already
given. Each is a change to a *different* slide from the board that reports it, so
none of them would reach a participant's phone otherwise. A deck with no board
broadcasts nothing extra.

A leaderboard **is** an aggregated result, so it sits behind the ordinary
results-visibility gate (REQ102) on both screens — the shared one and every
participant's — and carries the same per-slide `resultsVisibility` override every
other aggregate does. `private` hides the standings (the participant's own place
included: that number *is* the board, seen from one row); `on-click` holds them
until the presenter reveals that slide, which is the dramatic-reveal path a
leaderboard wants anyway. The override is what keeps the deck-level default a
setting rather than a wall: a deck defaulted to `private` can still turn a single
board on.

| Field on the payload | Meaning |
|---|---|
| `quizCount` / `maxPoints` | quiz questions the standings are summed over, and what they are worth at best |
| `rankedCount` | **everyone** ranked, including the rows below the cut |
| `size` | how many rows this slide asked for |
| `totalVotes` | always `0` — a board collects nothing, and says so rather than omitting the key (ADR-0024) |
| `entries[]` | the top `size` rows, each `{ rank, entryId, label, totalPoints, correctCount, answeredCount }` |

**Nobody is named, and the size caps the view, not the ranking.** Two decisions
carry the slice:

- A row is named by `entryId`, a truncated SHA-256 of `presentationId:participantId`
  — never the participant id itself. That id *is* the participant's credential
  (the vote endpoint is public and accepts whatever id it is handed), and this
  payload is the most-watched surface in the product; publishing the room's ids
  would hand anyone the means to answer as anyone. The digest is scoped by
  presentation, so two boards cannot be joined to follow one person between
  decks. `label` is derived from the handle (`Player 3F9A2C`) so a room has
  something to read out loud — no participant is asked to register or pick a
  nickname, because no requirement asks for one.
- Everybody who gave a standing answer is ranked, including a participant who
  scored nothing; only the *display* is cut at `size`. That is what lets a
  participant outside the top five be told "4th of 31" on their own screen —
  which they learn from their own scorecard, the one place their handle is
  attached to their id.

Places are standard competition ranks (`rankLeaderboardEntries()`): level scores
share a place and the next takes the one its position implies (1, 2, 2, 4), and
ties are ordered by handle so the same board is drawn the same way every time it
is re-rendered. Scores stay **derived, never stored** (REQ056), so re-marking a
solution re-orders the board with no migration.


## 2x2 Grid voting and results (REQ046–REQ050)

A `grid` slide is Scales in two dimensions, and it votes like one: **one row per
item**, named by `statementId` (a `gridItems` id), with `value` carrying that
item's coordinates as `"x,y"`. Build the value with `encodeGridPoint()` and read
it with `decodeGridPoint()` from `server/schemas.ts` — neither end spells the
wire format itself. A submission is rejected with 400 when it names no item or
an item the slide does not have, when the coordinates are not two whole numbers,
or when either coordinate falls outside its axis (REQ049). Points are never
clamped onto the grid: a clamp would record an opinion nobody gave.

Items are answered independently — a participant may place some, leave others,
and come back — and re-submitting an item **replaces** that item's placement
only. `skip: true` marks an item "not assessable" (REQ050) and is refused with
400 unless the slide sets `gridAllowSkip`; `value` is ignored for a skip. Item
counts are capped at `GRID_ITEM_LIMIT` (8) by the schema.

Each axis is authored as a `GridAxisSchema` on the slide (`gridXAxis` /
`gridYAxis`): a `title` for the dimension (REQ048), `min`/`max` for its numeric
endpoints, and `minLabel`/`maxLabel` for its poles (REQ049). An empty pole label
is not missing data — it means "read this end as its number", the way the scale
endpoints already behave.

| Field | Meaning |
|---|---|
| `totalVotes` | vote rows stored for the slide (placements + skips) |
| `itemCount` | items the slide offers |
| `allowSkip` | whether "not assessable" was offered (REQ050) |
| `xAxis` / `yAxis` | the axes as authored, so a client can draw the field without re-reading the slide |
| `items[].placed` / `skipped` | placements the tally read / participants who marked it not assessable |
| `items[].averageX` / `averageY` | the room's mean coordinate for that item, or an explicit `null` when nobody placed it (ADR-0024) |
| `items[].placements[]` | the individual `{ x, y }` behind the average — the cluster on the shared screen |

Skips are counted, never averaged. A stored placement that is no longer a point
on the grid — the organizer narrowed an axis under it — stops counting rather
than snapping to the boundary.

## Pin on Image voting and results (REQ051–REQ053)

On a `pin-image` slide the vote `value` is where the participant pointed:
`"x,y"`, in **per-mille of the image's own size** — whole numbers `0…1000`, `x`
from the left edge and `y` from the **top**. Build it with `encodePinPoint()` and
read it with `decodePinPoint()` from `server/schemas.ts`; neither end spells the
wire format itself.

Per-mille of the image rather than pixels, because the same answer has to mean
the same spot on a phone held in one hand and on a projector three metres wide —
device pixels would make a room's pins un-comparable the moment two devices
differed, which on this slide type is every room. Whole numbers, because "is this
pin inside the target area?" is then an exact integer comparison with no epsilon.
The lattice is the image's own edges, so unlike a grid placement a stored pin can
never stop decoding: nothing the organizer edits afterwards moves the bounds.

**The image is the slide's `mediaUrl`** (REQ052) — the same field an image slide
uses for its content and every other interactive slide for its illustration.
Which of the three a slide means is answered by `slideMediaIsInteractionArea()`,
and the URL itself by `pinImageFor()`. Nothing checks the file extension: the
picture is supplied by URL and rendered by the browser, so what is displayable is
the browser's answer to give. REQ052 names `.png`, `.gif`, `.jpg`, `.jpeg`,
`.svg`, `.webp`, `.avif`, `.heic` and `.heif` as the formats it expects to work.

A submission is rejected with 400 when it is not two whole numbers, when either
coordinate falls outside `0…1000`, **or when the slide carries no image at all**
— without an interaction area there is no coordinate space for a pin to be a pin
in. Nothing is clamped onto the picture: the position *is* the entire answer, so
a pin pulled onto an edge is an opinion nobody gave. One participant holds one
pin — re-submitting **replaces** it, so a tap in a better spot is a correction
rather than a second answer — and what is stored is re-encoded from what the
codec read.

| Setting | Meaning |
|---|---|
| `mediaUrl` / `mediaAlt` | the picture participants pin on, and its alt text (REQ052) |
| `pinArea` | `{ x, y, width, height }` in the same per-mille coordinates, `x`/`y` at the top-left corner — or `null` (the default) for a question with no correct area (REQ053) |

**`pinArea: null` means the slide has no notion of correctness at all** — the
normal shape for "where would you put it?" rather than "where is it?". A
rectangle rather than a shape vocabulary: it answers the only question a hotspot
check asks with two comparisons per edge, is authored by dragging a box across
the picture, and reads identically at any aspect ratio. Every edge is
**inclusive** — a pin on the line the organizer drew is on the target
(`isPinInArea()`) — and an area running off the image is refused
(`isUsablePinArea()`), since part of it would be a region nobody can reach.

| Field | Meaning |
|---|---|
| `totalVotes` | vote rows stored for the slide |
| `pinCount` | pins the tally could read — the denominator behind the share |
| `image` | `{ url, alt }`, so a client draws the canvas from the tally without re-reading the slide |
| `pins[]` | every readable `{ x, y }`, in submission order — the distribution itself |
| `averageX` / `averageY` | the centre of the cloud to two decimals, or an explicit `null` before anyone pins (ADR-0024) |
| `correctArea` | the target area, or `null` — both when none is authored and while it is withheld |
| `correctCount` | pins inside it; `null` on the same terms |
| `correctShare` | those as a percentage of `pinCount`; `null` on the same terms **and** `null` while nobody has pinned |

The distribution is the payload and the average rides beside it, which is the
opposite emphasis from a scale: on a picture the mean of two opposite hotspots
names a spot nobody chose, so a payload reporting only the average would report
agreement that does not exist.

**The target area is withheld until the organizer reveals it.** A pin slide gets
no second reveal switch — the reveal is the results-visibility setting it already
has (REQ102), read through `solutionVisibleToAudience()`:

| Effective visibility | When the room may see `pinArea` |
|---|---|
| `instant` | from the start — the room is already watching the aggregate drawn over the target, so withholding one while showing the other would be incoherent |
| `on-click` | once the presenter reveals that slide, or the deck ends |

| `private` | never, not even once the deck has ended — "never on screen" is the whole content of that setting |

Because that table's open row is the deck's own default, **the editor authors
`on-click` onto the slide the moment a target area is turned on** — the safe
posture is the one an organizer gets without having to remember it, and showing
the answer up front stays available as an explicit `instant` on the slide. A deck
built directly against this API gets no such help: a `pinArea` on a slide left at
`inherit` under an `instant` deck ships the target to the room from the start.

A revealed target reaches a participant only when their client **re-reads the
deck**: the `slide.revealed` broadcast says the reveal set moved, and the deck
payload — which is where the projection happens — has to be fetched again for the
area to arrive. A client that only patched `revealedSlideIds` would keep drawing
`pinArea: null` until it reloaded.

Withholding applies **on the wire**, not only where the area is drawn:
`withAudienceSolutions()` strips it from the deck payload on `GET /join/:code`
and `GET /presentations/:id`, and the results payload emits `correctArea`,
`correctCount` and `correctShare` as `null` together. A caller told "8 of 20 were
inside" but not where would know both that a target exists and how hard it is to
hit, so all three travel together — and a withheld target is indistinguishable
from a question that named none. A caller that can edit the deck (owner or edit
token) always sees what it authored.

Under `on-click` and `private` the results payload does not reach that
projection at all: the deck's reveal mode (REQ016/REQ017, above) withholds the
**whole tally**, so the room is sent `{ type: "pin-image", withheld: true }` and
neither the pins nor the region they were aimed at. The `null`-together rule
above is what an `instant` slide relies on, and the belt to that pair of braces
for anything reading the payload directly. This is deliberately stricter than a guess
slide's reference number (REQ041), which rides the deck payload openly: a pin
target is a region of the picture a participant is looking at *while they aim*.

## Guess the Number voting and results (REQ039–REQ043)

On a `guess-number` slide the vote `value` is the participant's estimate — the
number itself, as a decimal string. Build it with `encodeGuess()` and read it
with `decodeGuess()` from `server/schemas.ts`; neither end spells the wire format
itself.

The slide carries two authored settings:

| Setting | Meaning |
|---|---|
| `guessRange` | `{ min, max, step }` — the permitted values (REQ040) and their resolution (REQ043). Whole numbers only, `step ≥ 1`, counted **from `min`**: 1–10 in twos offers 1, 3, 5, 7, 9. Defaults to `{ min: 0, max: 100, step: 1 }`. |
| `guessReference` | `{ value, tolerance }` or `null` (the default) — the correct number to reveal (REQ041) and the deviation from it that still counts (REQ042); `7 ±1` accepts 6–8, `7 ±0` only 7. |

**`guessReference: null` means the slide has no notion of correctness at all** —
the normal shape for an estimation or forecasting question. It is not "tolerance
zero", and consumers must keep the two apart. Tolerance lives *inside* the
reference so it cannot exist without one; it is the same stance a choice slide
takes when its author marked no option correct (REQ013).

A submission is rejected with 400 when it is not a whole number, falls outside
the range, or does not sit on the step grid. Nothing is clamped or rounded onto
the grid: on this slide type the number **is** the entire answer, so an adjusted
one is an estimate the participant never made. One participant holds one guess —
re-submitting **replaces** it, so a participant can revise until the reveal — and
what is stored is re-encoded from what the codec read.

| Field | Meaning |
|---|---|
| `totalVotes` | vote rows stored for the slide |
| `guessCount` | guesses the tally could read — the denominator behind every share |
| `range` | the frame the columns and the input were built from |
| `buckets[]` | the distribution, low to high; empty columns included |
| `buckets[].from` / `to` | lowest and highest selectable value in the column (equal for a one-value column) |
| `buckets[].count` / `share` | guesses in the column, and that as a percentage of `guessCount` (two decimals) |
| `lowestGuess` / `highestGuess` | the extremes, or an explicit `null` before anyone guesses (ADR-0024) |
| `averageGuess` / `medianGuess` | mean (two decimals) and median, or `null` on the same terms |
| `reference` / `tolerance` | the authored correct number and its window width — both `null` together when there is no reference |
| `correctRange` | `{ min, max }` the tolerance accepts, inclusive at both ends; `null` with no reference |
| `correctCount` | guesses inside that window; `null` with no reference |
| `correctShare` | those as a percentage of `guessCount`; `null` with no reference **and** `null` while nobody has guessed — a percentage of no responses does not exist |

Columns are capped at `GUESS_BUCKET_LIMIT` (24) so the histogram stays legible on
a projector. A range offering fewer values than that gets one column per value;
a wider one groups a whole number of steps per column, so every column spans the
same count of selectable values and the heights stay comparable. The reference
rides the existing results-visibility gate (REQ102) rather than a second reveal
switch: set the slide to `on-click` for a deliberate reveal after the vote.

A stored guess that no longer decodes — the organizer narrowed the range or
coarsened the step under it — stops counting entirely rather than being plotted
off the end of the axis.

## Form voting and results (REQ061)

A `form` slide asks one *participant* several typed questions and reads their
answers as a record, where every other interactive slide asks the room one
question and reads a distribution. The whole filled-in form is therefore a
**single vote row**: the fields are answered together, in one gesture, and half a
form is a person interrupted rather than a milder opinion.

The vote `value` is `fieldId`+`answer` pairs, separated by the ASCII unit (U+001F)
and record (U+001E) separators. Build it with `encodeFormSubmission()` and read
it with `decodeFormSubmission()` (judging an incoming submission) or
`readFormSubmission()` (reading a stored row back) from `server/schemas.ts`;
neither end spells the wire format itself. Control characters rather than a printable delimiter because
a form packs **free text**, which a printable separator would have to escape —
and an escaping scheme is a second thing to get wrong on both ends. Answers bind
to fields by **id**, never by position: a form is the slide type most likely to
be re-authored between sessions, and positional binding would silently
re-attribute last month's email addresses to this month's job titles.

| Setting | Meaning |
|---|---|
| `formFields[]` | the fields, capped at 6 (`FORM_FIELD_LIMIT`) |
| `formFields[].id` / `label` | the field's stable id and what it asks — both required, no default (ADR-0018) |
| `formFields[].type` | `text`, `email` or `choice` — what the boundary will accept as an answer |
| `formFields[].required` | whether the form may be sent without this field answered; `false` by default |
| `formFields[].options[]` | `{ id, text }` on a `choice` field, capped at 8 (`FORM_FIELD_OPTION_LIMIT`); empty on the other two |

A field is only part of the question once it can be answered
(`isUsableFormField()` / `formFieldsFor()`): it needs a label, and a `choice`
field needs at least one option with text. A slide with no usable field asks
nothing, and the boundary accepts nothing for it — the stance a Pin on Image
slide with no image takes.

A submission is rejected with 400 when it names a field the slide does not have,
answers the same field twice, exceeds `FORM_ANSWER_MAX_LENGTH` (200) on any one
field, gives an `email` field something that is not shaped like an address
(`isFormEmail()` — a local part, an `@`, and a host with a dot in it), gives a
`choice` field anything but one of its own option ids, or leaves a `required`
field blank. A form with nothing written in it at all is not a submission and is
rejected by the request schema, which requires a non-empty `value`. One
participant holds one form — re-sending **replaces** it, so correcting a mistyped
address is a correction rather than a second person in the export — and what is
stored is re-encoded from what the codec read, in authored field order. A
submission with no `participantId` is refused: since a re-send replaces the row
held under that key, two id-less callers would share one row and the second would
overwrite the first person's answers.

**A stored row is never re-judged by the rules of a later edit.** The boundary's
strictness above applies to an *incoming* submission, against the slide as it
stands at that instant. The tally and the export read stored rows back through
`readFormSubmission()` instead, which drops only what it can no longer name — an
entry whose field has been deleted — and keeps everything else exactly as
written, a required flag added afterwards and an answer today's field type would
refuse included. Without that split, ticking **Required** on an optional field
after forty people have answered would retroactively invalidate every row that
left it blank, and deleting a field would make *all* of them unreadable at once —
the rows still in the database, and no surface able to show them. This is
deliberately unlike `decodeGuess`/`decodeGridPoint`, where re-authoring a frame
does stop a row counting: a guess outside its range has no place on the axis it
would be plotted on, while a name and an email address mean what they always
meant. `readFormSubmission()` returns `null` only for a value that was never a
submission — a malformed entry, or the same field written twice.

A form's submission is longer than any other slide type's, so `VoteSchema.value`
is bounded by `VOTE_VALUE_LIMIT` — the widest any type could legitimately send —
and the per-type bound is applied where the slide type is known
(`voteValueLimitFor()`, read once in `submitVote`). Every non-form type keeps the
500-character `VOTE_VALUE_MAX_LENGTH` it always had; over either bound is a 400.

| Field | Meaning |
|---|---|
| `totalVotes` | vote rows stored for the slide |
| `submissionCount` | rows the tally could read — the denominator behind every count |
| `fieldCount` | fields the slide currently asks |
| `fields[].fieldId` / `label` / `type` / `required` | the field as authored |
| `fields[].answered` | readable submissions that wrote something into it |
| `fields[].options[]` | `{ optionId, text, count }` on a `choice` field — the one part of a form that is a distribution; an empty list on the other two (ADR-0024) |
| `submissions[]` | what the room actually wrote, or an explicit `null` when this caller was not sent it |
| `submissions[].participantName` | who filled it in, on a deck that asked the room for names (REQ076); an explicit `null` on a deck that did not, or for a row cast before it started asking. It travels only where the rows do, so a name can never arrive without the row it labels |

**What people wrote is never published to the room.** `submissions` is emitted
only to a caller that can edit the deck (owner or edit token) — the same gate a
quiz slide's answer key passes (REQ056) — and this is deliberately *stronger*
than the deck's reveal mode: reveal mode is the organizer's decision about their
own **numbers**, and a decision about numbers must not be able to put a
stranger's email address on a projector. So even an `instant` form slide sends
the audience the counts and `null` submissions. `null` rather than an empty list,
because an empty table under a form twenty people have filled in is a lie about
the room.

The editor authors a fresh form slide as `private` on top of that gate — the safe
posture made visible in the Visibility section, where the organizer can see the
slide is not feeding the shared screen. A deck built directly against this API
gets no such help, but the gate above still holds: the rows do not travel.

**No surface in this product draws the submissions.** Every screen that renders a
tally is pointed at a room — the projector, and a participant's phone, which is
the projector seen from a seat — so the shared results view shows only the fill
rate, and the answers are read where they belong: in the credentialed
`submissions` block, and in the spreadsheet export the organizer downloads
(REQ095), whose Responses sheet carries one row per submission with every
answered field named by what it asked.

## The Q&A layer (REQ036, REQ037, REQ060)

Q&A is **not a slide type** — it is an overarching interactivity layer switched
on for the whole deck (REQ036), so a participant asks from whatever slide is on
screen and the list they ask into outlives every slide the deck pages through.
The `open-text` slide type is untouched: a deck that wants a dedicated
"questions for the panel" slide still authors one, with REQ025's per-response
upvotes on the votes it collects. What changed is that a deck no longer *has* to
have one for questions to be askable.

Two settings live on the presentation, beside `resultsVisibility` and its
neighbours, and are authored in the editor's deck settings or flipped live from
the presenter's Q&A panel:

| Setting | Meaning |
|---|---|
| `qaEnabled` | Whether questions can be asked at all. `false` on a fresh deck |
| `qaVisibility` | `presenter` (the default) keeps the list to the moderation view; `everyone` publishes it to the room, upvotes included |

**The restrictive value is the default, deliberately.** Publishing unfiltered
audience questions to a projector is the failure an organizer cannot take back,
and the control that does it sits directly beside the switch that opens the
floor — so opening the room up is a choice they make, never one they forget to
prevent. An import tightens the same way: an unrecognised `qaVisibility` in a
hand-edited export file reads as `presenter`, not as whatever the file claimed.

### Who reads the list

Decided on the server, per request, from the credentials that request carries —
the same stance the quiz answer key takes (`solutionVisibleToAudience`), and for
the same reason: what a client holds, a client can read out of the network tab.

- **Can edit the deck** — the owner, or the holder of the edit token. Reads the
  whole list **always**, layer switched off included: working through what was
  collected during a Q&A phase is most of why a presenter switches it off again.
  The browser proves this by sending the stored token on `GET /qa`, exactly as it
  already does on `GET /results/:slideId`.
- **Everyone else** — reads the room's list only while the layer is **on** and
  `qaVisibility` is `everyone`. Otherwise they read the questions their own
  `participantId` asked, and nothing else (`canSeeAll: false`).

That is one rule, not two: **you always see what you asked, and you see everyone
else's only while the layer is on and published.** So a presenter closing the
floor mid-session takes the room's list away without also taking each
participant's own words off their screen, which would read as a deletion.

An anonymous caller (no `participantId`) owns nothing, and so is shown nothing,
rather than matching every row that also has no id.

| Field on the payload | Meaning |
|---|---|
| `enabled` / `visibility` | The layer's two settings, so a client renders from one payload |
| `canSeeAll` | Whether this caller has the room's list or only their own questions |
| `questions[]` | Ordered — see below. Each `{ id, text, upvotes, answered, answeredAt, createdAt, own, upvoted }` |
| `totalCount` / `openCount` / `answeredCount` | Counts over **the list that came back**, never the volume behind it — a total over rows the caller cannot see would report the size of a list the organizer decided to keep back |

**The asking participant's id is never emitted.** It is that participant's only
credential — the ask and upvote endpoints are public and accept whatever id they
are handed — so it is projected down to the two booleans a client actually needs
(`own`, `upvoted`). Same stance the leaderboard takes with `entryId`.

### Prioritization and processing status (REQ060)

The list is ordered **open questions first, then the most upvoted, then the ones
that have waited longest**, with the id as a final tie-break so the same list
draws the same way every render. Answered questions sink whatever their score:
the list is a queue, and a popular question already dealt with would otherwise
push the thing the presenter should take next off the screen — exactly the
failure "make the processing status visible" exists to prevent. Clients render
the server's order and never re-sort; a phone that did would disagree with the
queue the presenter is working from.

- **Upvotes** ride `POST /qa/:questionId/upvote` and toggle. Only on a deck whose
  list the room can actually read: voting on a question you were not shown is not
  prioritization, and an endpoint that took a question id from a withheld list
  would answer whether that id exists. A `participantId` is **required** (without
  one the first id-less caller's row is the row every other id-less caller
  toggles), and **you cannot upvote your own question** — asking it *is* the
  support, and counting it twice would start every question at one for its asker
  and zero for everyone else. The tally counts **distinct upvoters, not rows**:
  the store has no unique index under the find-then-insert, so a double-tap or a
  retried POST can slip a duplicate row past it, and one participant's stutter
  must not outrank a question the room actually wants. Toggling off clears every
  row that participant holds, for the same reason.
- **Duplicates fold only into a published list.** On a deck whose questions the
  room can see, a re-asked question becomes an upvote on the one already there
  (`stored: false, merged: true`) — REQ060's "reduce duplicates", and the same fold an open-text
  slide already applies to a re-typed response (`normalizeQuestionText`, shared by
  both). On a **moderated** deck it does not: nothing there tells the asker their
  words merged into somebody else's row, the presenter is reading every
  submission anyway, and folding onto a question they cannot see is the one path
  by which a withheld list could be probed from the outside. Re-asking a question
  **you** asked is a no-op either way. `POST /qa` reports which of the three
  happened rather than flattening them into `ok` — `stored` (a new question was
  written), `merged` (it became an upvote on one already there), and **both
  `false` for the no-op**, which is the one outcome a client must not announce as
  "question sent", because nothing was.
- **"Mark as answered"** is a presentation mutation (owner or edit token): the
  processing status is the presenter's reading of their own session, and a room
  that could set it would be able to retire a question nobody answered. It is
  **reversible** on purpose — a mis-click during a live session should cost one
  more click, not a question the presenter can no longer find.

Asking, upvoting and marking answered all meet the same submission rule a vote
does: a `live` deck must have been started, a survey deck must not have ended.
A **reset** clears the questions and their upvotes along with the votes — the
audience in front of you is not the one that asked — while leaving the layer's
own settings, which are deck authoring rather than session data.

## Participant channels — reactions and live chat (REQ077, REQ078)

Two more things a participant sends during a session, and **neither is an
answer**: a reaction on whatever is on screen (REQ077) and a message in the
deck's chat (REQ078). They are documented together because they are the same
kind of thing — participant-originated traffic that no tally counts and no
results payload reports — and because a deck governs both from one place.

Two settings live on the presentation, beside `qaEnabled` and its neighbours,
and are authored in the editor's deck settings or flipped live from the
presenter's audience panel:

| Setting | Meaning |
|---|---|
| `reactionsEnabled` | Whether the room may react to any slide. `false` on a fresh deck |
| `chatEnabled` | Whether the deck carries a live chat. `false` on a fresh deck |

Both default closed, deliberately, and for the reason `qaVisibility` does:
reactions crossing a projector and an unmoderated chat beside it are two things
an organizer cannot take back mid-session, so a deck carries neither until
somebody asks for it. An import tightens the same way — anything other than an
explicit `true` in a hand-edited export file reads as closed.

One endpoint moves both (`POST /api/presentations/:id/channels`, owner or edit
token), and both keys are independently optional, so sending one never
re-asserts the other. It is not their only writer: the ordinary
`PATCH /presentations/:id` the editor saves through moves them too, and **both
paths broadcast `channels.settings`** — a presenter who closes the chat from the
editor mid-session must have it close on every phone in the room, not merely be
told it saved.

### A reaction is not stored (REQ077)

`POST /api/presentations/:id/reactions` validates, broadcasts `reaction.sent` to
the room, and returns. Nothing is written. There is no reactions collection, no
stored-reaction schema, and no code path from the endpoint to any aggregation —
so REQ077's "not stored as answers or counted in any tally" is a property of the
*shape* of the feature rather than a filter somebody has to remember, exactly as
it is for a preview's test votes further below.

Three things follow from that:

- **`kind` is a closed set** — `like`, `love`, `celebrate`, `laugh`, `insight` —
  validated as a Zod enum at the boundary. What rides the wire is *which*
  reaction it is, never a glyph or an image, so a hand-built request cannot paint
  a room with an arbitrary string and the client owns what each one looks like.
  Anything else is refused (`422`), not passed through.
- **Any slide type takes one.** Nothing about the slide on screen decides
  whether a reaction can be sent, including a content slide that collects no
  answers at all — which is precisely the case that proves a reaction is not one.
- **`slideId` is optional and nothing is keyed by it.** It says where the sender
  was looking, so a presenter's screen can burst over the slide the room is
  reacting to. A reaction that names none reads back as an explicit `null`.

Rate-limited on **its own** per-address and per-`participantId` counters, never
the ones a vote spends — see **Rate limits** above for why that separation is
not cosmetic.

The response echoes the frame the room was sent — `id`, `kind`, `slideId`, `at`
— so the sender needs no second call to know what was broadcast. The `id` is
what lets a client key one flying icon per reaction rather than collapse a burst
into a single element; `at` is the **server's** instant, so every screen in the
room reasons about the same clock.

### The chat is separate, and separate at every level (REQ078)

`GET`/`POST /api/presentations/:id/chat`. Separate from the Q&A queue and from
slide answers structurally, not merely by convention: its own collection, its
own endpoint, its own broadcast, **no slide id anywhere in a stored message**,
and no tally that reads it. A chat message is not a question waiting to be taken
and not an answer waiting to be counted.

- **One projection, for everybody.** Unlike the Q&A list (REQ037) there is no
  per-caller withholding here — a chat is the room's, and every reader of a given
  deck reads the same transcript. What differs between two readers is only `own`,
  which marks the lines that reader wrote.
- **The writing participant's id never comes back.** It is that participant's
  only credential and the post endpoint is public, so it is projected down to
  `own` and emitted nowhere — the same stance a Q&A question's asker gets. An
  anonymous reader owns nothing rather than owning every anonymous line.
- **Ordered oldest-first**, capped at the newest `200`. A transcript is read in
  the order it happened, not worked like a queue, so it is sorted by nothing
  else; the stored instant is strictly increasing per server process, so two
  messages a fraction of a millisecond apart are still drawn in the order they
  were written. The cap is a read cap, not a retention rule — nothing is deleted
  by it.
- **Repeated lines stay repeated.** A published Q&A question folds a duplicate
  into an upvote; a chat does not. Two people saying "same here" is a
  conversation working, and merging them would silently rewrite a transcript.
- **Closing the channel stops posting, not reading.** `GET /chat` answers with
  the transcript and `enabled: false`, so a presenter can still read what was
  said and a participant's own last line does not vanish and read as deleted.
  The participant surface honours that: it draws the chat while the channel is
  open **or** while there is anything to read, and only the composer goes dead
  (with its reason). Gating the section on the switch would have undone the
  guarantee on the one screen it was written for.
- **A blank message is refused as a blank message.** `" "` satisfies the
  minimum length and trims to nothing, so it is caught at the boundary (`422`)
  alongside the empty string rather than falling through to the "chat is off or
  not accepting submissions" refusal, which would name two settings that are
  both fine.

Posting meets the same submission rule a vote does: a `live` deck must have been
started, a survey deck must not have ended. A **reset** clears the chat along
with the votes and the Q&A questions (REQ101) — the audience in front of you is
not the one that was talking — and a **delete** erases it with everything else
the room wrote (REQ146). Reactions need neither: there is no row of theirs to
clear.

## Participant names (REQ076)

A deck can **require** the people joining it to state a name. What that buys is
one sentence: the name is stored with that participant's answers and read back
under it on the results surface and in both exports. What it is not is a login —
nothing verifies a stated name and nothing signs anybody in (REQ134/REQ137 are
separate entries), so the `participantId` minted in the browser stays the handle
every stored row is keyed by, and the name is a *label on that handle*.

**The switch is the deck's, it is authored with the deck, and it is off.**
`requireParticipantName` rides `POST /api/presentations` and the ordinary
`PATCH`, defaults to `false` on every schema that carries it, and is **public** —
it travels on the deck document to `GET /api/presentations/:id`, the deck list
and `GET /join/:code` alike, because every phone in the room has to know whether
to ask before it can draw the question. It is the one setting on that document
whose *contents* are deliberately elsewhere.

**Moving it mid-session reaches the room**, on the `presentation.participant-name`
frame, exactly as the Q&A layer's and the two channels' switches do — and it has
to, in both directions. Turned on silently, nobody already in the room is ever
asked and every answer they go on to give is stored under nobody. Turned off
silently, a participant still standing at the gate submits into a boundary that
has just started refusing them and has nothing to go back to, because the gate
their own screen draws is read off the deck they are holding.

**Stating one.** `POST /api/presentations/:id/participant-name` takes
`{ participantId, name }` and answers with the name **as stored** — trimmed,
folded to a single line and capped at 80 characters, so a client shows what was
kept rather than what was typed. Public, in the same sense the vote endpoint is:
the participant id is the credential. Two refusals, each a reading of "on
joining":

- **A deck that did not ask stores nothing** (`400`). Not politeness about an
  unused field — it is the switch failing safe. An endpoint that stored a name
  on any deck it was pointed at would make `requireParticipantName` a decision
  about a *screen* rather than about whether the deck holds personal data.
- **An ended deck takes none either** (`400`). Deliberately *not* the rule a
  vote meets: a name is accepted on a deck the presenter has **not started
  yet**, because somebody standing at the door of a draft deck is exactly who
  the question is asked of. What ending a session closes is the door.

One row per (deck, participant): stating a second name **corrects** the first in
place, so the roster can never list one person twice and correcting a typo is not
a rewrite of every answer already given. A blank or oversized name is refused by
the body schema (`422`). The write spends the same submission budget a vote, a
question and a chat message do (REQ145).

**Reading them back.** `GET /api/presentations/:id/participants` is the roster —
one entry per participant who stated a name, each with `participantId`, `name`,
`answeredSlides` (counted in **slides**, not stored rows, so a multi-statement
scale is one) and `statedAt`, ordered by name. Two things about who may read it:

- It is gated as a **mutation** is (owner, edit token, or an `edit` grant), not
  as a results read. The deck's read-only **results link** (REQ098) does *not*
  open it: that link is the delegation of the organizer's *numbers*, and nobody
  minting one decided to hand over a list of who was in the room.
- **Nothing here reaches a participant.** No name rides the join lookup, the deck
  read, any tally, the `results.updated` broadcast, the Q&A, the chat or a
  scorecard, and there is no participant-facing read of the roster — "what is
  participant X called?" answered to anybody holding an id would turn a room's
  names into a public lookup. `server/participant-names.integration.test.ts`
  fetches every one of those doors and searches the payload rather than taking
  it on trust.

People who **answered without stating a name** are deliberately not on the
roster: a deck only collects names while the switch is on, so rows cast before it
was turned on legitimately have none, and padding the list with untitled entries
would read as people whose names went missing. They are counted in the exports
under their participant id.

**"Require" is a gate the participant surface draws, not a precondition the vote
endpoint enforces.** No submission route consults `requireParticipantName`: a
direct `POST …/vote` — or a browser that never loaded this client — stores an
unnamed answer on a deck that asks for names, and it is accepted. That is
deliberate rather than an omission. A `participantId` is minted in the browser
and verified by nothing, so a server-side check would only force an unnamed
caller to invent a name first; what it *would* buy is a way for one participant
to lock another out of answering by stating a name under their id. So an unnamed
row is a shape every read here already handles — `null` in the workbook's Name
column, `—` on the PDF roster, absent from the roster endpoint — and the two
causes of one (a row cast before the switch went on, and a caller that skipped
the door) are indistinguishable by construction.

**Where a name appears.**

| Surface | What it carries |
|---|---|
| `GET …/participants` | The roster itself — the organizer's list of who took part |
| `GET …/results/:slideId` on a **Form** slide (REQ061) | `submissions[].participantName` — the name beside the row it labels, and `null` for a row whose participant stated none. Emitted only where the rows themselves are, i.e. to a caller who can edit the deck; the lookup is not even performed for anyone else |
| `GET …/results.xlsx` (REQ095) | A **Name** column on the Responses sheet beside the participant id, a **Name** column on the Participants matrix, and `Names required` / `Participants named` on the Summary sheet |
| `GET …/deck.pdf?results=true` (REQ096) | A **roster page** directly behind the cover whenever a name was stated in the session, listing name and slides answered — **no participant id**, since an id is that participant's only credential and this is the artefact most likely to be handed round. Names are listed and never joined to answers there: a handout that printed who said what is one left on a table |

The exports read the names **unconditionally**, not behind the deck's switch: a
deck whose organizer turned names off after a session still holds the ones it
collected, and an export that dropped them would be a record of the session
missing what the session recorded. A row with no name is an explicit `null` in
the workbook and the document's `—` in the PDF (ADR-0024), never an empty cell.

**What clears them.** A **reset** (REQ101) takes the names with the answers — a
re-run is a different room, which is the same reason it clears the chat — and a
**delete** takes them with everything else the room wrote (REQ146). A reset also
has to reach the *browser*: a participant surface remembers the name it stated so
a reload does not re-ask, and a phone that kept believing it had answered would
never be asked again for the re-run. The `presentation.reset` frame is what tells
it to forget. This is the
opposite of the slide comment threads next door, and the line between them is who
wrote the thing: the room stated these names, and the deck's authors wrote those
comments.

Two things the roster is explicitly **not**: it does not re-point the leaderboard
(REQ059 names its rows by a one-way derived handle on purpose, and that stays),
and it does not name the author of a Q&A question or a chat message — both of
those channels stay anonymous to the room.

## Preview and test votes (REQ103, REQ104)

A **preview** is a dry run of a deck before a room exists: the organizer walks
both perspectives — the shared screen and a participant's phone — populated with
**test votes** so the charts on screen are the charts the room will produce
rather than empty frames.

`GET /api/presentations/:id/preview` serves the whole thing in one call.
Authorized like a mutation (owner or edit token) although it writes nothing: it
is the organizer's own deck, it carries the presenter's view of every quiz
answer key, and the deck has not been let into a room yet.

| Query | Meaning |
|---|---|
| `respondents` | Synthetic respondents to simulate. Default `PREVIEW_DEFAULT_RESPONDENTS` (24), max `PREVIEW_RESPONDENT_LIMIT` (200); `0` previews the empty deck |
| `seed` | Which run to reproduce — the same deck, seed and size always yield the same room |
| `startedAt` | ISO instant the run's questions opened. Sent back unchanged by a polling client so a refresh does not restart the countdown it is refreshing |

All three are echoed on the response, beside `testVoteCount` (rows the run
generated — nothing to do with what is stored) and `slides[]`, in deck order.

**Every slide comes back twice, and that is the point.** On a quiz question the
two perspectives are genuinely different payloads, so a preview that showed one
of them twice would be showing the organizer a participant view no participant
will ever get:

| Field | Meaning |
|---|---|
| `presenterResults` | The tally as the shared screen reads it — quiz answer keys included (`canEdit: true`) |
| `audienceResults` | The same tally as a phone reads it — the key withheld until that question is over (REQ056) |

Both are the ordinary results shapes documented above, produced by the **same
aggregation** the live results endpoint uses (`aggregateSlideResults`), over a
`ResultsSource` that reads generated rows out of memory instead of the store.
That shared path is what makes a previewed chart the chart the room will see.

### A test vote is not a response

Nothing a preview generates is written — not the votes, and not the deck state
either. Two decisions carry that, and both are properties of the *shape* of the
feature rather than checks inside it:

- The rows come from `server/preview.ts`, which returns them and has no store to
  put them in. The aggregation only ever reads. There is no path from a test vote
  to the `votes` collection to disable, because the code that would do it does
  not exist.
- The deck the tally is computed against is built and discarded in
  `getPreviewResults` (`previewDeck`): live, with every question opened at
  `startedAt`. A preview needs that — a draft deck's charts all read "start the
  presentation to collect responses" — and taking it by actually starting the
  deck would end the dry run by beginning the session. So the stored
  presentation keeps its status, its empty `slideStartedAt` and its empty
  `revealedSlideIds`.

Test votes are built through the same encoders a participant's phone uses and
parsed through `StoredVoteSchema`, so a synthetic response is the same shape —
and passes the same decoders — as one the vote endpoint would have stored. A
test vote the real boundary would have refused would be a preview of a slide
that does not exist. The generator also reproduces the endpoint's own folds: a
re-typed response on a slide with `allowResponseVotes` becomes an upvote rather
than a second row (REQ025), a quiz holds one final answer per participant
(REQ054), and a 100 Points ballot spends exactly the budget (REQ044).

On the client, `/preview/:id` (`src/pages/PreviewPage.tsx`) draws both panes and
keeps navigation, the REQ102 reveal and the organizer's own trial answers in
local state — it sends no mutation at all. See
[frontend.md](frontend.md#shared-primitives) for the two shared slide views and
the vote transport that is the seam between a live answer and a previewed one.

## Spreadsheet export (REQ095)

`GET /api/presentations/:id/results.xlsx` returns the whole session as an Excel
workbook, served as an attachment
(`Content-Disposition: attachment; filename="<slug>-results-<YYYY-MM-DD>.xlsx"`,
`Cache-Control: no-store`).

**Authorized as an edit — owner or edit token — not as a read.** The public
results endpoints report a tally *anonymously*, which is exactly what lets them
stay public; this file cannot, because it carries every stored response beside
the participant id it was cast under, and every quiz answer key including one a
running question is still withholding from the room (REQ056). It is therefore
gated with the strictest credential the deck has: `401` without one, `403` when
signed in as somebody else.

Five sheets — the two halves of the requirement, raw data and result overviews:

| Sheet | One row per | Columns |
|---|---|---|
| `Summary` | deck fact | `Field`, `Value` — title, join code, status, mode, language, results visibility, Q&A settings, slide counts, participants, whether names were required and how many were stated (REQ076), responses, created/exported instants |
| `Slides` | slide | `Slide #`, `Slide ID`, `Type`, `Question`, `Participants`, `Responses` |
| `Responses` | stored submission | `Slide #`, `Slide ID`, `Type`, `Question`, `Item`, `Participant`, `Name`, `Answer`, `Skipped`, `Submitted at` |
| `Participants` | participant | `Participant`, `Name`, then one column per **interactive** slide (`1. <question>`) |
| `Aggregates` | slide/entry/metric | `Slide #`, `Question`, `Type`, `Entry`, `Metric`, `Value` |

Three properties are worth stating, because each is load-bearing:

- **A stored value is never printed as storage.** `"opt-3"`, `"1,4"` and
  `"a:40,b:60"` are how a submission is persisted, not what a participant said,
  so every answer is read back through the codec the vote endpoint judged it
  with (`decodeRanking`, `decodePoints`, `decodeGridPoint`, `decodeGuess`,
  `decodePinPoint`, `decodeQuizAnswer`). A row those codecs refuse — its slide
  was re-authored underneath it — reads as an explicit empty cell, exactly as
  the live tally drops it.
- **The tallies are read, never recomputed.** `Aggregates` is a flattening of
  `GET /results`' own payload, so a number in the file is the number the shared
  screen drew. The layout lives in `server/results-export.ts`, which is pure —
  deck, rows, aggregates and the export instant in, a workbook model out — and
  the only place `exceljs` is touched is the render step at its foot.
- **`Aggregates` is tidy long form.** One row per (slide, entry, metric, value)
  rather than a per-type wide table: every number keeps its own name, a column
  never means "count here and average there" depending on which slide type it is
  describing, and a pivot over the sheet is immediately usable — which is what
  the requirement's stated goal, analysis outside the tool, actually needs.

An empty cell is always a deliberate one (ADR-0024): "this participant did not
answer this slide" and "the average is zero" are different readings and stay
distinguishable.

## PDF export (REQ096)

`GET /api/presentations/:id/deck.pdf` renders the deck to a **self-contained
PDF**, served as an attachment
(`Content-Disposition: attachment; filename="<slug>-<results|deck>-<YYYY-MM-DD>.pdf"`,
`Cache-Control: no-store`).

One query parameter, and it is the whole of what a caller decides:

| Query | Values | Meaning |
|---|---|---|
| `results` | `true` (default) / `false` | Whether the collected results are drawn into the document. Anything else is a **4xx** — a string enum rather than a coerced boolean, because `"false"` read as `true` is a switch whose off position means on |

**Authorized as an edit — owner or edit token — for both readings.** The
spreadsheet next door is gated that way because it carries raw per-participant
rows; this one is gated the same way for a reason that survives
`?results=false`: **even the deck alone carries every quiz answer key**,
including one a running question is still withholding from the room (REQ056).
Drawing less is a decision about the *document*, never about who may have it —
gating the two readings differently would put a caller's own query parameter
inside the authorization. `401` without a credential, `403` signed in as
somebody else, and a results link (REQ098) does not open it.

What the document holds:

| Section | Contents |
|---|---|
| Cover | The deck's title, which reading this is, its join code, status, mode, language and reveal mode, its slide counts, the created and exported instants — and, with results, the participant/response/upvote counts and, on a deck that asked for names, that it did (REQ076) |
| Roster (REQ076) | Whenever a name was stated in the session, with results: who took part — name and slides answered, ordered by name, with the unnamed rows last under `—`. **No participant id**: this codebase treats one as a bearer credential, and a handout is the artefact most likely to be left on a table; the join to the workbook's Participants sheet is the workbook's own job. Names only; who said what stays the workbook's |
| One per slide | `Slide n of m · <type>`, the question, then what the slide **asked**: options and the marked answer key (or a typed quiz's accepted answers), the selection rule, scale statements and their ends, ranking and 100 Points items, grid axes, a guess range and its reference, a pin target area, form fields with their shape and choices, a content slide's body |
| …with results | Under each slide: its slide-level totals as a list, and its per-entry numbers as **bars** where the aggregation publishes a share of the whole and as a **table** — one column per metric — where it does not |

Four properties are worth stating, because each is load-bearing:

- **The tallies are read, never recomputed.** The results half is a re-layout of
  `aggregateRowsFor()` — the *same* flattening of `GET /results`' own payload
  that the workbook's `Aggregates` sheet is written from — so the two exports
  cannot disagree with each other, and neither can disagree with the shared
  screen. A slide type that gains an aggregate later appears here without
  `server/deck-pdf.ts` being edited.
- **A stored value is never printed as storage.** A slide type is named
  ("Guess the Number", not `guess-number`) from the same descriptor the editor's
  type picker draws from, and authored markdown is reduced to the words it
  marked up — a link keeps its address beside its label, because a printed page
  cannot be clicked.
- **Self-contained means nothing is fetched.** A slide's `mediaUrl` and
  background image are printed as URLs rather than downloaded: an exporter that
  fetched them would be a signed-in caller making this server issue requests to
  an address they chose.
- **The text is set in the PDF standard fonts**, so nothing is embedded and
  every reader draws the file the same way. Their encoding is WinAnsi, which
  covers Latin-1 and a handful of typographic characters: text beyond it is
  folded to its nearest unaccented form (`č` → `c`), and a script these fonts
  cannot express at all collapses to a single `?` rather than failing the
  export. **REQ158** is the entry that replaces the fold with an embedded face.

An absent number is drawn as an explicit `—` rather than left blank, for the
reason the workbook keeps its `null` cells (ADR-0024).

**The two exports are the two readings of one session, not a duplicate.** The
workbook is the analysable one — every stored row, the per-participant matrix,
tidy long form for a pivot table. The PDF is the readable one: what the room was
asked and what it answered, laid out to be handed round. Per-participant rows
are deliberately not in the PDF; that is the workbook's job, and a document with
one line per submission is not a document anybody reads. The roster page is the
one place the PDF names people at all, and it names them *without* their answers
for exactly that reason (REQ076).

The name column and the roster page are also where the two formats deliberately
differ on an unused setting: a spreadsheet column is a schema and keeps its place
whatever it holds, so `Name` is there on an anonymous deck with every cell empty;
a printed page is prose, so a line reading "Names required: no" on every handout
of every anonymous deck is noise about a setting nobody used. What they do **not**
differ on is whether a collected name is printed at all: both read the roster off
what the session recorded rather than off the switch as it stands today, so an
organizer who turns names off afterwards still gets the session they ran.

## The shareable results link (REQ098)

A deck can mint **one** link that opens its results in a read-only page with no
account, no sign-in and no edit authority. Three routes manage it — all three
authorized as an edit, because whether a deck hands out its results is the
organizer's decision and nobody else's:

| Route | What it does |
|---|---|
| `POST /api/presentations/:id/results-link` | Mint. Returns `{ active, issuedAt, resultsToken }` with the plaintext token **once** (`201`) |
| `DELETE /api/presentations/:id/results-link` | Revoke. Returns the state it leaves behind, `{ active: false, issuedAt: null, resultsToken: null }` |
| `GET /api/presentations/:id/results-link` | Status: `active`, `issuedAt`, and `resultsToken` as an explicit `null` (ADR-0024) — the secret is stored hashed, so the mint is the one response it exists in |

The holder sends it as **`X-Omul-Results-Token`** on `GET …/results` and
`GET …/results/:slideId`. Its own header rather than the `Authorization: Bearer`
slot the edit token also answers on: they are different capabilities, and a
server that read one out of the other's slot would be deciding which it held by
trying both. The link itself is `/results/:id#link=<token>` — the token in the
**fragment**, like the edit link's `#share=`, so it never reaches the server in a
request line and stays out of access logs, proxy logs and `Referer` headers.

Stored as `resultsTokenHash` + `resultsTokenIssuedAt` on the presentation, both
`null` by default (ADR-0029) and neither declared by `PresentationSchema` — so
neither can travel to a client, by the same construction that keeps
`creatorTokenHash` in.

### It lifts the reveal mode, and lifts nothing else

**The link holder reads every slide's tally under every reveal mode** — `private`
included, and an `on-click` slide the presenter never revealed — exactly as the
owner and the edit-token holder do (REQ015–REQ017).

That is the decision, and the alternative is why: gated *by* the reveal mode, the
link would grant nothing the bare URL already grants, and would be emptiest on
precisely the decks it exists for. REQ017 keeps a `private` slide's answers
"reachable on the results surface only", and REQ094 gates that surface on the
deck's **edit** authorization — so before this, the only way to let somebody read
a withheld tally was to hand them a credential that could also delete the deck.
REQ098 is the read-only delegation of that surface. The reveal mode is a decision
about what the **room** is shown while the session runs; minting a link is a
separate, deliberate act aimed at a named recipient, and it is the organizer's
own read of their own numbers that it delegates.

Everything else an editor reads stays behind the edit credential, and the link
holder is treated as any other stranger:

| Withheld from a results-link holder | Why |
|---|---|
| Every mutation — `PATCH`, `DELETE`, start/end/reset, navigate, reveal, results-visibility, timer, Q&A settings, channels | "Carries no edit authority" is the requirement. `401`/`403`, exactly as for an anonymous caller |
| `GET …/results.xlsx` (REQ095), `GET …/deck.pdf` (REQ096) and `GET …/preview` (REQ103) | The workbook and the preview carry every stored response beside the `participantId` it was cast under; all three carry every answer key, the PDF included and in **both** its readings. The tallies are anonymous aggregates; these are the rows and the key behind them |
| A running quiz question's answer key (REQ056) | The gate is "is the question over", and a results link is not the presenter ending it. `options[].isCorrect` reads `null` |
| Presenter notes (REQ090) | They reach a client on the deck payload, which the results token is not a credential on at all — the holder's `GET /presentations/:id` is the public one |
| A Form slide's `submissions` (REQ061) | Already withheld from non-editors *whatever the reveal mode says*, because a decision about numbers must not publish a participant's email address. A results link is a decision about numbers — and REQ099 will hand this link to participants |
| The deck's roster, `GET …/participants` (REQ076) | Gated as a mutation is, so the token is refused with `401`. A link to the tallies is the delegation of the organizer's numbers; who was in the room is not one, and nobody minting one decided to hand that over — the same sentence the row above makes about a form's rows |

The gate is one function, `tallyVisibleToCaller()` in `server/schemas.ts`, which
composes `tallyVisibleToAudience()` with the two credentials a request can carry.
It is read once, in `aggregateSlideResults()`, before a single number is
computed — the same place and the same order the reveal mode is enforced in, so a
surface cannot acquire a second answer to "may this caller be sent this tally?".

### What "revocable" means

`DELETE …/results-link` clears the stored hash, and the hash is the only thing
that made the token answer. So:

- **It takes effect on the next request**, with no expiry to wait out and no
  grace window. There is nothing server-side that still remembers the secret.
- **A revoked token is refused, not demoted.** Both results endpoints answer
  `401 { "error": "This results link is no longer valid" }` when a results token
  rides the request and does not match. Falling back to the public read would
  answer a revoked link with a deck of withheld markers — indistinguishable, from
  the holder's side, from a deck that never published anything, so they would
  have no reason to go and ask for a new link. The refusal is only for a caller
  who has *nothing else*: an organizer whose browser still holds the token they
  revoked five seconds ago is still the organizer and still reads their own deck.
- **It is all-or-nothing, because there is one link per deck.** Revoking retires
  every copy that was ever handed out, not one recipient's; re-mint and re-send to
  whoever should still have it. Per-recipient links are not what REQ098 asks for
  ("*a* link"), and the read-only page's honesty depends on the holder being able
  to tell a dead link from a quiet deck — which a bag of independent tokens with
  no surface listing them would not give them.
- **Minting again is also a revoke.** One slot, so a fresh mint overwrites it and
  the previous link stops working by the same act. The organizer's dialog says so
  on the button (`Replace link`) rather than after the click.
- **What it cannot reach**: a results page already open keeps the numbers it was
  last sent until its next poll (five seconds), and anything the holder has
  already read, screenshotted or written down stays with them. Revocation ends
  *access*, not what access already produced.

Revoking is idempotent — a deck with no link reports the state it is already in —
and deleting the deck takes the link with it, since the hash lives on the deck
document and nowhere else. A `reset` (REQ101) deliberately does **not** revoke:
it clears the answers under the deck, not the decisions about who may read them.

### The page behind the link

`/results/:id` (`src/pages/SharedResultsPage.tsx`) is every slide that has a
tally, its question, and `ResultsDisplay` under it — no navigation, no reveal
control, no export, no reset, no Q&A, no chat and no vote, and not disabled
versions of them either: they are not this page's controls, and drawing a greyed
out "End presentation" for a stakeholder reading a summary would be inventing an
affordance in order to take it away. It re-reads every five seconds, which is
also how a revocation reaches an open tab.

The URL works **without** a token, and answers with whatever the public results
endpoint publishes — under `instant` that is the whole tally. What the link
changes is the reveal-mode gate, so the page says which of the two readings the
visitor is getting rather than leaving them to infer it from the numbers.

## Segmented results (REQ020, REQ116)

`GET /api/presentations/:id/results/:slideId/segments?by=<earlierSlideId>`
answers the question two tallies side by side cannot: *did the people who
answered one way over here answer differently over there?* It is a **join on
participant id** — the room is divided by what each person answered on the slide
`by` names, and this slide's tally is computed once per group.

```jsonc
{
  "slideId": "topic",
  "question": "Should we ship the redesign this quarter?",
  "type": "multiple-choice",
  "segmentBy": { "slideId": "team", "question": "Which team are you on?", "type": "multiple-choice" },
  "withheld": false,
  "withheldReason": null,
  "minRespondents": 5,
  "segments": [
    { "key": "eng",   "label": "Engineering",    "respondentCount": 7,    "suppressed": false, "results": { /* … */ } },
    { "key": "sales", "label": "Sales",          "respondentCount": 6,    "suppressed": false, "results": { /* … */ } },
    { "key": "ops",   "label": "Operations",     "respondentCount": null, "suppressed": true,  "results": null },
    { "key": null,    "label": "Did not answer", "respondentCount": null, "suppressed": true,  "results": null }
  ]
}
```

Every authored option gets a group, **empty ones included** — "nobody who picked
Operations answered this" is a result, and a group that vanished when it emptied
would make a breakdown change shape as answers land. The last group, `key: null`,
holds the people who answered *this* slide and not the grouping one. Somebody who
answered the grouping slide and nothing else is in no group at all: the breakdown
is of the people this slide heard from.

### `results` is the ordinary tally, not a second one

Each group's `results` is the **same payload shape** `/results/:slideId`
publishes, produced by the same aggregation function over that group's rows
alone (`server/services/presentations.ts`, `getSegmentedResults`). Nothing here
re-derives a quiz's final-answer rule, a ranking's Borda scoring or a scale's
per-statement skips, so a segment cannot disagree with the chart above it — a
breakdown whose groups happen to hold the whole room reproduces that slide's own
tally field for field, and there is a test that says so. It is the seam the
preview run (REQ104) rides on, used the other way round: the preview swaps in
rows that were never stored, this swaps out rows belonging to other people.

The filter applies to **every** slide, not only the one being broken down, which
is what makes a segmented `leaderboard` slide (REQ059) mean "the standings among
these people" rather than the whole room's board drawn under a group of four.

One number does then read differently inside a group than above it, and it is the
only one: an open-ended slide's upvote rows (REQ025) carry the **upvoter's**
participant id, so within a group a response is credited only with the upvotes
that group cast. A response showing `upvotes: 10` on the unsegmented tally can
read `upvotes: 2` inside the group that wrote it. That is the same sentence as
everything else here — "as a room of exactly these people would have seen it" —
but it is worth knowing before reading the two side by side.

### Only an earlier slide, and only one choice from a fixed set

The slide being broken down must have a tally at all — a content slide is
refused rather than answered with one empty group per option. A slide may group
another when each participant's answer on it is **one choice from a closed
authored set**: a single-select `multiple-choice` slide, or a
`quiz` question answered by picking (REQ054). And it must come **earlier** in the
deck — REQ020's "an earlier slide", and the only order in which the join has a
meaning.

Anything else answers `400` with a `refused` code and the reason in words, the
same sentence the picker draws under a disabled entry
(`server/segmentation.ts`, `SEGMENT_REFUSAL_REASONS` — one descriptor, shared
with the client, ADR-0026):

| `refused` | When |
|---|---|
| `same-slide` | `by` names the slide being broken down |
| `no-tally` | the slide being broken down has no results of its own (a content slide) |
| `not-earlier` | `by` names a slide at or after it |
| `no-answers` | `by` names a content slide, or a leaderboard — nothing to group by |
| `multi-select` | `by` names a multi-select choice slide (REQ014): one person would be in several groups |
| `typed-answers` | `by` names a typed quiz question (REQ055): no authored set to divide by |
| `unsupported-type` | `by` names a scale, ranking, allocation, placement, guess, pin or form slide |
| `unknown-slide` | (client-side only — over HTTP a slide this deck does not have is a `404`) |

A first answer wins where a participant somehow left several rows on a
single-answer slide, and a row naming an option the organizer has since deleted
groups nobody — both the rules the tally itself already applies, borrowed rather
than restated.

### It publishes nothing the tallies behind it do not — and rather less

**Both** slides pass the reveal-mode gate (REQ015–REQ017). If either tally is
withheld from the caller the payload is `withheld: true`, `withheldReason:
"reveal-mode"` and no segments: the group labels and their head counts *are* the
grouping slide's tally under another name, so publishing a breakdown of a
withheld slide would republish it sideways. The **results link** (REQ098) lifts
that gate here exactly as it does on the two results endpoints.

Three things it does not lift, each of which is a **default rather than a
setting**, and none of which an owner or edit-token holder meets — they can
already download every row beside the participant id it was cast under (REQ095),
so withholding any of it from them would protect nobody from anybody.

**A slide whose tally names individuals is not broken down at all.** A breakdown
is published to a non-editor only where the slide's tally is a count over an
authored set: `multiple-choice`, a select-answer `quiz`, `scale`, `ranking`,
`points`, `form`. Everything else answers `withheld: true` with `withheldReason:
"identifiable"`. The floor below bounds how *few* people a group may hold; it
cannot bound what the group's payload says about them, and a list with one entry
per respondent — open-text `responses`, a word one person wrote, `pins`, grid
`placements`, a guess that is somebody's actual number, a leaderboard row under a
handle stable across every breakdown — is not made anonymous by any group size.
Those entries are matchable across two breakdowns of the same slide by two
different groupings, so intersecting a group of five with a group of six can
leave one person with every group clearing the floor the whole way down.

**Groups are held back at least two at a time.** The groups partition the people
who answered, and the unsegmented tally is readable by the same caller on the
same terms — so the answers of the groups held back are `unsegmented − Σ(published)`.
Hold back one group of one person and you have published that person's answers
under a different heading. Whenever a group has to be held back, therefore, at
least one more group *holding people* goes with it (the smallest that clears the
floor, so the reader loses least), and every residual mixes at least two groups.
Empty groups never count towards that pair: they contribute nothing to a
residual. The one exception needs none — a breakdown whose only non-empty group
is the whole room is held back alone, because its residual is the unsegmented
tally the caller may already read.

**A held-back group publishes no head count.** `respondentCount` is `null`
alongside `results: null`. "Exactly one person picked Operations *and* answered
this" is a fact about that person rather than a number about the room, and it is
also the pointer saying which group is worth reconstructing. Note that
`suppressed: true` therefore does **not** mean "fewer than `minRespondents`
answered" — a group above the floor wears it too when it is the complement.

`minRespondents` is five, the small-cell threshold disclosure control
conventionally uses.

### The surface

`/results/:id` draws the control under each slide's chart, where it belongs
(ADR-0031): every earlier slide as an entry, the ones that cannot group drawn
**disabled with their reason** rather than dropped (ADR-0025), and each group
rendered by the same `ResultsDisplay` the unsegmented tally uses
(`src/components/SegmentedResults.tsx`). The eligibility rule is imported from
the server module that enforces it, so the picker cannot offer a grouping the API
refuses. A held-back group draws no head count and says why it is held back in
words that are true of both cases it covers — the group too small to publish, and
the group held back beside it — and a whole withheld breakdown says which of
`reveal-mode` and `identifiable` it met, since only one of the two is something
the organizer could change.

## Clearing a session's results (REQ101)

`POST /api/presentations/:id/reset` is how a deck is reused without mixing old
data into a new run. It returns the presentation to `draft`, rewinds the active
slide, drops `revealedSlideIds` and the `slideStartedAt` stamps (a re-run is a
fresh quiz — a deck that kept its old stamps would open every question already
expired, REQ057), clears the live-room switches `closedSlideIds` and
`audienceBlanked` (REQ111/REQ109 — a re-run that inherited the last session's
closed questions would refuse a room that had done nothing), and deletes every
vote, response upvote, Q&A question, Q&A
upvote, chat message (REQ078) and stated participant name (REQ076) the
presentation holds. Reactions (REQ077) are
not on that list and need not be: nothing persists one. A `presentation.reset`
event goes out to the room.

**Destructive and irreversible.** Keeping the previous run's results is a
separate catalog entry (REQ100 — historical sessions and trends); until it
ships, the way to keep a session is to download it first — `GET /results.xlsx`
to keep it analysable, `GET /deck.pdf` to keep it readable. The presenter
surface puts the export and the reset side by side for exactly that reason, and
confirms the reset with what it costs (`src/pages/PresenterPage.tsx`).

## WebSocket events

Single endpoint: `ws://host/ws`. Clients send `{ type: "join", presentationId, role }`.
Server broadcasts to all subscribers of a presentationId.

| Event | Direction | Payload |
|---|---|---|
| `slide.changed` | server → clients | `{ presentationId, slideIndex, slide }` — the slide as the audience may see it: answer key withheld while the question runs (REQ056), presenter notes empty (REQ090) |
| `results.updated` | server → clients | `{ presentationId, slideId, results }` — the tally as the **audience** may read it, so a slide whose mode withholds it broadcasts `{ type, withheld: true }` and no numbers (REQ016/REQ017), and an editor-only block on it (a word cloud's `answers`, a form's `submissions`) is `null`. Sent when an answer *lands* and when one is *taken down* (REQ027) — a tally moves both ways |
| `presentation.started` | server → clients | `{ presentationId }` |
| `presentation.ended` | server → clients | `{ presentationId }` |
| `presentation.reset` | server → clients | `{ presentationId }` |
| `slide.revealed` | server → clients | `{ presentationId, slideId, revealed }` (REQ016/REQ102) |
| `presentation.results-visibility` | server → clients | `{ presentationId, resultsVisibility }` — the deck's reveal mode moved (REQ015–REQ018). Sent by both its writers: the deck-wide endpoint, and a deck PATCH that names the field. Carries the deck-level setting only; clients re-read the deck for the per-slide overrides — see **The deck's reveal mode** above |
| `slide.started` | server → clients | `{ presentationId, slideId, startedAt }` — a slide's question was opened, which is what a quiz countdown runs from (REQ057) |
| `slide.participation` | server → clients | `{ presentationId, slideId, open }` — one slide was opened or closed to submissions (REQ111). Carries its value, like the settings frames below: a phone that learned about a closed question only by having an answer bounce is the failure the switch exists to prevent |
| `presentation.blanked` | server → clients | `{ presentationId, blanked }` — the shared screen was blanked, or brought back (REQ109). Broadcast because the screen being projected may be a second browser rather than the presenter's own |
| `presentation.participant-name` | server → clients | `{ presentationId, requireParticipantName }` — the deck started or stopped asking joiners for a name (REQ076). Sent by its one writer, the deck PATCH. Carries the **switch and nothing else**: a frame naming somebody would put a name on every phone in the room, and the roster is fetched by a credentialed caller instead |
| `qa.settings` | server → clients | `{ presentationId, qaEnabled, qaVisibility }` — the Q&A layer was switched on/off or re-scoped (REQ036/REQ037) |
| `qa.updated` | server → clients | `{ presentationId }` — the question list moved: asked, upvoted or marked answered (REQ036/REQ060) |
| `channels.settings` | server → clients | `{ presentationId, reactionsEnabled, chatEnabled }` — a participant channel was opened or closed (REQ077/REQ078). Sent by both its writers: the channels endpoint, and a deck PATCH that names either field |
| `reaction.sent` | server → clients | `{ presentationId, id, kind, slideId, at }` — somebody reacted to what is on screen (REQ077). The one frame here that carries its content; nothing is stored behind it |
| `chat.updated` | server → clients | `{ presentationId }` — the live chat has a new message (REQ078). Surfaces re-fetch `GET /api/presentations/:id/chat` |

`qa.updated` carries the presentation id and **nothing else** — no text, no
counts. A room is broadcast to by presentation, and the `role` a client sends on
join is whatever that client said it was, so it proves nothing: a broadcast
carrying question text would hand a moderated Q&A (REQ037) to anybody holding a
socket. Surfaces re-fetch `GET /api/presentations/:id/qa`, which is where the
edit token is proven and who-sees-what is decided. `chat.updated` is payload-free for the neighbouring reason (REQ078): the feed has
one projection, and keeping it in one place is what keeps each reader's `own`
marks and the transcript's order honest. `qa.settings` and `channels.settings`
are the exceptions among the *settings* frames, and only because their values
are already on the public presentation document every phone holds; `reaction.sent`
is the exception among the rest, and can be — a reaction is one value out of a
closed five-member set, it names nobody, and it is stored nowhere for a later
read to disagree with (REQ077).

`qa.settings` is broadcast by **every** path that writes those two values —
`POST /qa/settings` *and* the ordinary `PATCH /presentations/:id`, which is how
the editor saves them. `channels.settings` works the same way, from
`POST /channels` and from the same deck PATCH. It reports the deck as it then stands, not the keys that
happened to be sent. A silent write would leave a withdrawn question list on
every screen in the room: nothing about the deck a client holds would have
changed, so nothing would make it refetch, and a presenter who took the list
back would be told it was saved without it having taken effect.
