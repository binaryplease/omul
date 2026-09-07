# Deployment & environment

Packaging, deployment topology, and the full environment-variable reference.
See [architecture.md](architecture.md) for the stack itself.

## Packaging & deployment

Packaged as a **Docker image** built by `.github/workflows/build.yaml` on every
push to `main` / `workbatch/**`. The workflow still lists `task/**` as a
trigger, the retired branch namespace; this repository contains no such branch
and will not grow one.

- **Base image**: `ghcr.io/escherlies/nixnode/nixnode`, **pinned by digest** in
  the `Dockerfile` rather than taken from a floating tag — a floating base means
  every build takes whatever the upstream namespace publishes at that moment,
  with nothing in the build output to say it changed. The digest is the
  multi-arch OCI index, so platform resolution is unaffected; bump it
  deliberately. `scripts/dockerfile.test.ts` fails if the pin is dropped.
- **Runtime**: Bun, serves both API and SPA static files on `$PORT` (default 3000).

The GHCR package name is the repo name directly — no `/app`
suffix. The workflow sets `IMAGE_NAME` to `${{ github.repository }}` and never
spells the name out, so a fork publishes under its own slug with nothing to
change. That is one half of the wider convention this project deploys under:
build a registry image here, and redeploy it on the target machine with a
webhook listener that re-pulls it.

### Running the image

The server is a **single container with no database sidecar** — everything is
`bun:sqlite` in one directory. There is nothing else to stand up: no database
service, no cache, no queue.

**A self-hoster's deployment ships in this repository** (REQ172): `compose.yaml`
at the root, with `.env.example` as the environment to copy to `.env` and fill
in. It owes nothing to any particular host — the published image, a named
volume at `/app/data`, the container port published on the host's loopback, and
an env file are the whole topology, and the reverse proxy, certificate and DNS
name in front of it are the operator's. It pulls
`ghcr.io/binaryplease/omul:latest`; its commented `build:` line builds the same
image from the tree instead, so a clone is a complete deployment with no
registry access at all. This section stays the authority on what each variable
means — the compose file and the example agree with it rather than restating it.

What a deployment has to set, and why each one matters:

| Set in the deployment | Consequence if unset |
|---|---|
| `BETTER_AUTH_SECRET` | **The container refuses to start** (REQ171). It signs every session cookie, and the container never sets `OMUL_ALLOW_INSECURE_DEV_AUTH_SECRET`, so the server fails closed rather than sign with the development literal that ships in the source — where it would hand every reader of the repository the ability to mint an administrator session. The crash names the variable and the command that produces a value. Supply it the way your deployment supplies secrets — an encrypted `env_file`, a secret manager, an orchestrator secret — not from this repository |
| `OMUL_ADMIN_EMAILS` | **Nobody is an administrator** (REQ164). `/api/admin/*` answers `403` to every account, the operator's own included. Nothing else changes: no presenter or participant path goes through the admin surface, so an instance with no administrators is a complete one. The allowlist ships empty deliberately — an image carrying one deployment's administrators would name them in every other deployment built from the same source |
| `OMUL_BASE_HOST` | Better Auth's trusted origins are only `localhost:5173` / `localhost:3000`, so every state-changing auth request from the public host fails the Origin check and **nobody can sign in at all**; it is also what puts a reachable link in verification and password-reset mail, and what the `/api` discovery index advertises (REQ151) |
| `OMUL_TRUST_PROXY` | Behind a reverse proxy, every visitor shares the proxy's one rate-limit bucket, and the `/api` discovery index falls back to the origin it observes — see **Behind a reverse proxy** below. Correct as it stands for a directly-exposed container |
| `NODE_ENV` / `PORT` | Default to `production` / `3000` in the image |

Naming administrators is an operator action and nothing in this repository can
do it: add `OMUL_ADMIN_EMAILS` to the environment the container is started
with, then restart it.

```
OMUL_ADMIN_EMAILS=first.admin@example.com,second.admin@example.com
```

Sign-in addresses of existing accounts, comma-separated, matched
case-insensitively. The container log says which posture is in force on every
boot, so a restart confirms it landed:

```
[admin] 2 administrator(s) from OMUL_ADMIN_EMAILS: first.admin@example.com, second.admin@example.com.
```

```
[admin] No administrators: OMUL_ADMIN_EMAILS is unset, so /api/admin/* answers 403 to every account.
[admin] Set it to a comma-separated list of account emails to name some. Correct as it stands for a deployment that wants no admin surface.
```

### State and backups

All state lives in **one directory, mounted at `/app/data`**. The image sets
`DATABASE_PATH=/app/data/omul.sqlite` and declares `VOLUME ["/app/data"]`, so
without a bind mount or a named volume the data lands in an anonymous volume
that `up --force-recreate` walks away from.

**Three** SQLite files live there, not one — `omul.sqlite` (zodstore:
presentations, votes), `auth.sqlite` (Better Auth accounts and sessions) and
`admin.sqlite` (admin event log). The latter two resolve as siblings of
`DATABASE_PATH`, so the *directory* is what gets mounted; mounting the single
file would silently drop two of the three.

**Nothing in this repository backs that directory up, and a snapshot of a live
SQLite file is not a backup.** All three databases run in WAL mode, so copying
the `.sqlite` file while the server is writing can yield an archive that
restores to a torn state. A correct backup is `VACUUM INTO` or `.backup`
against the live database, or a copy taken with the container stopped. **What
is not backed up is lost with the host.**

## Sharing one host with the marketing site (REQ179)

This app does not own the whole of its origin. It is built to sit on one host
beside a separate marketing site, split by **path** rather than by subdomain,
and the reason is a spoken sentence: a presenter reads the join link off the
slide to a room. `<host>/join/1234` is a sentence a room can hold;
`app.<host>/join/1234` is not.

So the split is asymmetric, and deliberately so:

| Path | Whose | Why |
|---|---|---|
| `/app`, `/app/*` | **the app** | Its own home page, and every built asset — Vite's `base` is `/app/`, so the HTML asks for `/app/assets/…` |
| `/join/*` | **the app** | The link that is read aloud and printed on the slide. The one path the whole arrangement exists to keep where it is |
| `/present/*`, `/preview/*`, `/results/*`, `/edit/*` | **the app** | Links already handed out — a deck being run, a results link given to somebody who was not in the room (REQ098), an edit link mailed to a co-presenter |
| `/workspaces`, `/workspaces/*`, `/templates`, `/generate` | **the app** | Pages that exist *because* they are linkable; a tab left open on one must not stop resolving |
| `/api/*`, `/ws` | **the app** | The HTTP surface, its docs and discovery index (REQ151), and the WebSocket |
| **everything else, `/` included** | **the site** | Including `/assets/*`: both products build into a directory of that name, which is the collision that makes `/app/` a move rather than a preference |

**`server/app-paths.ts` is the authority on that table**, not this page. It is
read by the build (the base stamped into asset URLs), by the static handler
(which file, which fallback) and by the client router (which page a URL is), so
the three cannot drift apart; `server/app-paths.test.ts` asserts the boundary,
including that `/templates-for-teams` is the site's and not ours.

**What the reverse proxy in front has to do**, and it is the whole of its job
here: route the prefixes above to this server, and everything else to the site.
A matcher *wider* than that list has the app's fallback shadowing a site page; a
matcher narrower than it has a link the app hands out 404ing on the site.
Deriving it from `APP_OWNED_PREFIXES` rather than transcribing it keeps the two
halves honest. **No proxy, TLS or DNS configuration lives in this repository**,
for the reason **Running the image** above already gives: the reverse proxy, the
certificate and the name in front of the port are the operator's.

**`/` is not this app's, and it does not answer as if it were.** A request for
it gets a `302` to `/app/` rather than the app's home page: on a shared host the
proxy never sends `/` here at all, and on a **standalone** deployment — a
self-hoster running this container with no marketing site in front of it —
there is nobody else to answer, and the visitor typing the bare host is looking
for the app. Any other path the app does not own answers `404`, which is what
keeps a standalone instance from claiming to be a page it is not.

`OMUL_BASE_HOST` is unaffected by all of this: it is still the **bare host**,
with no path (`omul.example.com`, not `omul.example.com/app`), and a value
carrying one is still a fatal startup error.

## Environment variables

Set via `.mise.toml` for dev, override as needed:

- `PORT` — HTTP listen port (default `3000`)
- `DATABASE_PATH` — zodstore SQLite file (default `data/omul.sqlite`; use `:memory:` for an ephemeral store, as the integration tests do)
- `NODE_ENV` — set to `production` to disable dev mode. It has **no bearing on the auth signing secret** (below): that gate is a purpose-named switch precisely because `bun build` constant-folds `process.env.NODE_ENV` into the bundle, which would let the build environment decide a security posture at compile time
- `OMUL_AUTH_DB` — Better Auth SQLite file (default `auth.sqlite` beside the docstore file)
- `OMUL_ADMIN_DB` — admin store SQLite file (default `admin.sqlite` beside the docstore file)
- `BETTER_AUTH_SECRET` — auth signing secret. **Required everywhere except local development, and enforced: the server refuses to start without it** (REQ171). There is no fallback — a placeholder that ships in the source would let anyone who has read the source forge any session cookie, administrators' included, so an absent secret is a fatal startup error naming the variable rather than a server that looks healthy. The same crash refuses the development literal if it is copied into the variable, and refuses anything shorter than 32 characters (Better Auth's own bar). Generate one with `openssl rand -base64 32`. The value is used **trimmed** of surrounding whitespace. Supplied by the deployment's own secret delivery, not by this repository
- `OMUL_ALLOW_INSECURE_DEV_AUTH_SECRET` — set to exactly `"true"` to permit the built-in development signing secret instead of the variable above. **Off unless set, and nothing but local development sets it**: the dev tasks in `.mise.toml` and `server/test-preload.ts` do, and no build, container or deployment does. Do not set it on a host that serves anyone but you — it re-opens exactly the hole REQ171 closed. It is a purpose-named runtime switch rather than a `NODE_ENV` check because `bun build` folds `process.env.NODE_ENV` into the bundle at build time: gated on that, a bundle built with `NODE_ENV` unset froze **open** and signed every cookie with the placeholder no matter what the running server's environment said
- `OMUL_ADMIN_EMAILS` — comma-separated sign-in addresses of the accounts that may use the admin surface (`/api/admin/*`), matched case-insensitively after trimming and read once at startup (REQ164, `server/admins.ts`). **Unset is the default and means nobody is an administrator**: every admin route answers `403`, including to the operator, and the instance is otherwise complete — nothing a presenter or participant does goes through that surface. The empty default is deliberate rather than an omission. The list used to be compiled in, which named one deployment's administrators in every image built from this source and left a self-hoster no way to name their own short of forking and rebuilding; a shipped fallback list would restore exactly that. Blank, whitespace and stray commas all read as "nobody", so a typo cannot promote anyone. There is still no role column and no self-service grant — who is an administrator is an operator's decision, now taken in configuration instead of in source. Which posture is in force is printed on every boot (`[admin] …`). Supply it the way the signing secret is supplied, by the deployment's own secret/environment delivery, not from this repository
- `BETTER_AUTH_URL` / `OMUL_BASE_HOST` — canonical public origin for auth callbacks (production, behind a reverse proxy); inferred per-request in dev. `OMUL_BASE_HOST` also adds the public host to Better Auth's trusted origins, so behind a proxy it is **required for sign-in to work at all**, not just for correct mail links. It is a **bare host** (`omul.example.com`, a `:port` allowed) read as `https://`, never a URL — a value carrying a scheme, path or trailing slash is a fatal startup error rather than a silently ignored one. It is also what the `/api` discovery index advertises (REQ151)
- `OMUL_TRUSTED_ORIGINS` — extra comma-separated origins allowed to drive auth
- `SEND_EMAILS` — set to exactly `"true"` to actually send mail (else the emailer logs)
- `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` — Brevo transactional-email credentials. Sending needs all three of `SEND_EMAILS="true"`, the key and the sender address; short of that the emailer stays in log mode and names the one that is missing
- `BREVO_REPLY_TO_EMAIL` / `BREVO_REPLY_TO_NAME` — the default `Reply-To` on outgoing mail, when replies should not go to the sender address. Both optional and both unset by default; a single message may override them, and the `From` address is always the verified sender either way
- `OMUL_RATE_LIMITS_DISABLED` — set to exactly `"true"` to switch the abuse limits off (default: on) — see **Abuse limits** below. It takes the generation budget with it, which is why generation carries an account requirement that this switch cannot reach
- `OMUL_TRUST_PROXY` — number of trusted reverse-proxy hops in front of the server; `"true"` reads as `1` (default `0`: `X-Forwarded-For` is ignored and the socket address is used). **Required behind a reverse proxy** — see below
- `GOOGLE_GENERATIVE_AI_API_KEY` — the model-provider credential that switches deck generation on (REQ007). **Unset by default, and unset means the feature is off** — see **Generating a deck from a prompt** below
- `OMUL_GENERATION_MODEL` — which model a generation asks (default `gemini-flash-latest`); ignored while the key above is unset

`mise run preview:email` serves a browser gallery of the transactional email
templates (dev-only, port 3999).

## Generating a deck from a prompt (REQ007)

omul can turn a short text prompt into a draft deck. It is the **only** part of
the product that talks to anything outside this deployment, so it gets its own
section rather than a line in the list above.

**It is an intentional exception to the rule that production depends on no
third-party runtime host, and this section is the documentation that exception
asks for.** The rule forbids depending on a third-party host to serve
first-party assets and allows explicit third-party product integrations where
the remote service *is* the feature. This is that case: there
is no asset that could be bundled instead, because the thing being fetched is the
provider's own answer to a prompt written seconds ago. Everything else in omul
— fonts, icons, the template catalog, the QR generator — is bundled or vendored,
and stays that way.

| Variable | Default | Effect |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | unset | The credential. **Unset is the default and means generation is off.** |
| `OMUL_GENERATION_MODEL` | `gemini-flash-latest` | Which model is asked. A floating "latest" alias rather than a pinned snapshot. |
| `OMUL_GENERATION_ALLOW_ANONYMOUS` | unset (i.e. `false`) | Set to exactly `"true"` to let callers **with no account** generate. The default requires a signed-in account — see below. |

Provider: Google's Generative AI API, reached through the Vercel AI SDK
(`ai` + `@ai-sdk/google`) — the same SDK and the same variable name
`scripts/translate.ts` already uses, because two names for one credential is how
a deployment ends up half-configured.

Five properties worth knowing before you turn it on:

- **Off is the default, and off fails closed.** With no key the capability route
  answers `available: false` with a reason, the generate route answers `503`, and
  nothing else in the product changes — a deck still starts blank or from the
  template catalog. The posture is printed on every boot (`[deck-generation] on
  — …` / `off — …`), for the reason the rate-limit and discovery postures are: an
  unconfigured provider looks exactly like a broken feature from the outside.
- **Only the prompt leaves the building.** The request carries the organizer's
  brief and the deck's language. No existing deck, no participant's answer, no
  session data and no account detail is sent anywhere, and nothing about the
  generated deck records that it was generated.
- **Nothing else loads a provider.** The SDK is imported dynamically inside the
  single function that calls the model, so a build, a test run and every route
  that is not this one never resolve it. `bun test` reaches no provider at all —
  the routes take their generator as an argument and the suites hand them a stub.
- **It is rate-limited harder than anything else**, because it is the one route
  whose cost is not yours to absorb but your provider bill's: five per five
  minutes per client, and it spends the ordinary create budget too (see **Abuse
  limits** below). A prompt is capped at 500 characters, the language tag at 40,
  a draft at 12 slides, and one call at 8192 output tokens. **Both** forwarded
  fields are bounded, deliberately: a ceiling on one and not the other is a
  ceiling on nothing, since the caller simply puts the volume in the other field.
- **It requires an account by default, and that is a second control the rate
  limits do not give you.** `OMUL_RATE_LIMITS_DISABLED="true"` — offered just
  below for a self-hoster on a trusted network — takes the disk limiter and the
  *money* limiter off together, so an operator who switches it off would
  otherwise inherit an unauthenticated LLM proxy without ever deciding to. The
  account requirement is independent of that switch and ships in its most
  restrictive setting; `OMUL_GENERATION_ALLOW_ANONYMOUS="true"` is the explicit,
  documented opt-out for a deployment that really does want open drafting. A
  refused caller gets `401` before the provider is reached, so an anonymous flood
  costs nothing. Which posture is in force is printed on every boot.
- **What comes back is a draft, and the answer keys are deliberately empty.** No
  generated slide ever marks an answer correct — the generator has no field in
  which to express one — so a generated quiz scores nobody until its organizer
  marks it. See [api.md](api.md#generating-a-deck-from-a-prompt-req007).

## Abuse limits (REQ145)

omul's account-free surface has no login, so `server/rate-limit.ts` is the
only throttle in the system. It keeps an **in-process sliding window** per client over the
three account-free paths, and answers an over-limit request with `429`, a
`Retry-After` header in seconds and the same number as `retryAfterSeconds` in
the JSON body.

| Path | Window | Keyed by |
|---|---|---|
| `POST /api/presentations` (create) | 30 per 5 minutes | client |
| `POST /api/deck-generation` (generate, REQ007) | 5 per 5 minutes | client |
| `GET /api/join/:code` (join) | 600 per minute | client |
| `POST …/vote`, `…/response-vote`, `…/qa`, `…/qa/:id/upvote` (public writes) | 600 per minute | client |
| the same public writes | 60 per minute | `participantId` |

Three things to know before tuning your deployment around them:

- **The ceilings are sized for a room, not for a person.** Conference wifi and
  lecture halls put hundreds of legitimate participants behind one NATted
  address, and every participant re-reads the deck each time the presenter
  reveals a slide — so the per-client ceilings are flood protection, and the
  per-`participantId` one is what actually bounds a single client.
- **A "client" is an IPv4 address, or an IPv6 `/64`.** A `/128` is not a
  client: IPv6 hands one subscriber a whole `/64` (often a `/56` or `/48`
  above it) and every address in it is theirs to source from, so keying the
  full address would let a single machine mint a fresh bucket per request by
  walking its own prefix. The `/64` is the smallest block ever routed to a
  host, so it is the smallest unit that can still mean one client. IPv4 needs
  no equivalent and is keyed whole — including the `::ffff:a.b.c.d` form a
  dual-stack socket reports IPv4 peers in, which is read back as the IPv4
  address it is.
- **The counters are process-local.** That matches the single-container
  deployment; running several replicas divides every ceiling above by the
  number of replicas.

### Behind a reverse proxy, set `OMUL_TRUST_PROXY`

The default ignores `X-Forwarded-For` deliberately — it is a caller-supplied
header, and believing it on a directly-exposed server would let anyone mint a
fresh bucket per request. The cost of that safe default is that a proxied
deployment sees every visitor as the proxy's single address, so **a deployment
that terminates TLS at a reverse proxy must turn proxy trust on**:

```
OMUL_TRUST_PROXY=true
```

Set it in the deployment's own environment, not in this repository. The image
deliberately carries **no default for this variable**: the safe value depends
on a fact only the deployment knows — how many proxies are in front — and
baking `1` into the image would hand a bucket per request to every caller of a
directly-exposed container.

Left unset behind a proxy the limits still apply, but every visitor on the
internet shares the proxy's one bucket. That ceiling is reachable in ordinary use:
a 300-person room fires roughly 300 join lookups per slide reveal, and
`JOIN_RULE` allows 600 a minute — so two reveals inside a minute answer the
whole room with `429`.

Because that misconfiguration is invisible from inside the process — the safe
default and the broken deployment look identical — the server says which one it
is rather than leaving it to be discovered in a session:

- **On every boot** it prints the posture, whether or not anything is wrong:

  ```
  [rate-limit] on — a client is the address 1 proxy hop(s) in from the right of X-Forwarded-For.
  ```

  ```
  [rate-limit] on — a client is the connection's socket address; X-Forwarded-For is ignored (OMUL_TRUST_PROXY=0).
  [rate-limit] Behind a reverse proxy this is wrong: set OMUL_TRUST_PROXY to the hop count ("true" = 1),
  [rate-limit] or every visitor shares the proxy's one bucket. Correct as it stands for a directly-exposed server.
  ```

- **The first time a request actually arrives carrying `X-Forwarded-For` while
  no hop is trusted** — a proxy in front of a server ignoring it — one
  `console.warn` names both readings and says it will not repeat. It is a
  notice rather than a fatal error because `0` hops is the correct *and
  required* value for a directly-exposed server: refusing to start on it would
  break the deployment it is right for.

The variable is a **hop count**, and the count matters: `X-Forwarded-For` is
appended to rather than replaced, so the header arrives as
`<whatever the caller wrote>, <what proxy 1 saw>, … <what proxy N saw>` and
only the rightmost `N` entries were written by a proxy. The server counts that
many hops in from the right; everything to the left is treated as
attacker-supplied and ignored. `true` (= `1`) is correct for a single reverse
proxy. Put a CDN in front of it and it becomes `2` — set too low, a caller can inject its own
value and escape the limits; set too high, real clients collapse into one
bucket. If the header carries fewer entries than the configured hop count, the
socket address is used instead. `X-Real-IP` is not consulted at all: it has no
hop chain, so a proxy's observation cannot be told from a caller's claim.

The same hop count is what the `/api` discovery index believes about
`X-Forwarded-Proto` and `X-Forwarded-Host` (REQ151, `server/routes/discovery.ts`)
— one variable, because "is there a proxy in front of me, and how many hops" is
one fact about a deployment, and two surfaces answering it differently is how
one of them ends up wrong. Behind a TLS-terminating proxy the origin the process
observes is `http://` on a host that only serves `https`, so with neither
`OMUL_BASE_HOST` nor proxy trust set the index hands clients `http://` and
`ws://` links they cannot follow. It says which source it is using on every
boot, for the same reason the limiter does:

```
[discovery] /api advertises https://omul.example.com (OMUL_BASE_HOST).
```

```
[discovery] /api advertises the origin each request arrives on; forwarded headers are ignored (OMUL_TRUST_PROXY=0).
[discovery] Behind a TLS-terminating proxy this hands clients http:// and ws:// links for an https-only host:
[discovery] set OMUL_BASE_HOST to the public host. Correct as it stands for a directly-exposed server.
```

`OMUL_BASE_HOST` is the stronger of the two and is what a proxied deployment
should set: it is configuration rather than a header, so it holds regardless of
what any caller sends, and it is already required there for sign-in to work at
all.

`OMUL_RATE_LIMITS_DISABLED=true` removes the limits entirely — intended for a
self-hoster on a trusted network. Anything other than the exact string `"true"`
leaves them on, so a typo cannot silently disarm the protection.
