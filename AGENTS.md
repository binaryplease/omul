# omul — AGENTS.md

Self-hosted live audience interaction: presentations with polls, word clouds,
quizzes, and Q&A. Bun + Elysia server with React SPA frontend, backed by
`@binaryplease/zodstore` (a Zod-gated SQLite document store).

**Stack in one line:** Bun · Elysia · Zod · `@binaryplease/zodstore`
(`bun:sqlite`, from npm) · Better Auth · React 19 · Tailwind v4 · Vite · mise.

## Further reading

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Full tech-stack table, project structure, database/storage model |
| [docs/api.md](docs/api.md) | Auth model (owner-or-edit-token, admin surface), API endpoint table, WebSocket events |
| [docs/deployment.md](docs/deployment.md) | Docker/GHCR packaging, deploy topology, environment-variable reference |
| [docs/frontend.md](docs/frontend.md) | Binding UI conventions, shared primitives |
| [docs/README.md](docs/README.md) | Source-code requirement catalog: file format, the BR→SCR split, triage CLI |
| [docs/Requirements.md](docs/Requirements.md) | Generated index of `docs/requirements/` — one row per REQ (never hand-edit) |

## Dev commands

All via mise (`.mise.toml`):

| Command | Description |
|---|---|
| `mise run dev` | Start Elysia (port 3000) + Vite (port 5173) concurrently |
| `mise run dev:server` / `dev:client` | Start one side only |
| `mise run build` | Build frontend (Vite → `dist/client/`) + server (Bun → `dist/server/`) |
| `mise run start` | Start production server |
| `mise run check` | **The gate.** Frontend ADR convention guards (ADR-0022/0026/0028) + the publication-residue guard (REQ163) + requirement checks — read-only, never writes |
| `mise run test` | Run tests |
| `mise run triage -- <cmd>` | Filter and triage requirements in `docs/requirements/` |
| `mise run requirements:index` | Regenerate `docs/Requirements.md` with the shared `index` CLI (ADR-0040) |

Running locally:

```bash
mise install && bun install
mise run dev           # Elysia at :3000, Vite at :5173 (open http://localhost:5173)
```

**`check` and `requirements:index` need one tool this repo does not ship: a
CLI named `index`, which writes the generated listing of a knowledge
directory** (ADR-0040 §7 permits exactly one implementation of it, so there is
no repo-local fallback to write). It is not on npm and `mise install` does not
fetch it; it has to be on `PATH` already. Without it those two tasks fail with
`index: command not found` (exit 127), and the `index check` half of the gate
cannot be made green.

Everything else — `dev`, `build`, `start`, `test`, `triage` — needs only `bun`,
so a contributor without that CLI can still develop, test and build, and
`bun scripts/triage.ts validate` still checks every requirement file. What is
lost is only the generated index in `docs/Requirements.md`: leave it as it
stands rather than hand-editing it, and say in the change that it could not be
regenerated.

Environment variables (defaults in `.mise.toml`) are documented in
[docs/deployment.md](docs/deployment.md).

## History begins at the clean-slate snapshot

**This repository's git history starts at its initial commit and has no
ancestry.** It was created as a clean-slate snapshot of the working tree of a
predecessor repository, which is kept private and intact and is not published.
Everything before the initial commit lives there: every earlier commit, every
branch including the `task/*` ones, and the full authorship record.

What follows from that, and bites if you forget it:

- **Every commit reference written before the snapshot resolves only in that
  private predecessor.** Requirement update logs, `task/*.md` files and ADR
  notes in this tree may name commits, branches or merges this repository does
  not contain. They are not stale or wrong — they point at history that was not
  carried over, and you cannot resolve them from here.
- **`git blame` and `git log` reach back to the snapshot and no further.** The
  history of a line older than that is not in this repository at all.
- The snapshot is a *tree* copy, not a filtered history: nothing here was
  rewritten or force-pushed to produce it.
- **The retired working name is gone from the whole tree, history included.** It
  used to survive where nothing else resolved to it — an image path, a closed
  log entry — and this section used to tell you to read an unfamiliar identifier
  as an old spelling. It no longer does: the identifier sweep of 2026-08-29
  (REQ176) rewrote every occurrence that named *this product* to its current
  spelling and retired the passages that only named a predecessor's registry,
  host or deploy path. Take an unfamiliar identifier here as something other
  than an old spelling of this product, and do not reintroduce one.

## Branches, commits and pushes — not yours to make

Isolated work happens on a **`workbatch/<random-id>`** branch (ADR-0005). The
`task/<slug>` namespace is **retired** — never cut a new `task/*` branch.

- **Reuse before inventing.** If the repo is already on an isolation branch — a
  `workbatch/*` one, or a legacy `task/*` one — stay on it and append there. A
  fresh id is for work that starts from a clean `main`.
- **The id carries no meaning.** It is a random token, not a summary. One
  workbatch is a shared home for several sessions, so it may hold unrelated work.
- **Legacy `task/*` branches remain valid history**, in the private predecessor
  repository this tree was snapshotted from; nothing was migrated, rewritten or
  deleted. This repository has none, and what is retired is the *creation* of new
  ones, so on a clean `main` you cut a `workbatch/*` branch.

Some work here is driven by an automated session runner, and in that mode git is
owned by a post-session hook rather than by the agent (ADR-0005, "Commit,
branch, and push ownership"):

- The **in-session coding agent completes its work and stops — it does not
  commit, create branches, or push.** It leaves all changes uncommitted in the
  working tree.
- The **post-session hook is the authoritative and sole committer, brancher,
  and pusher.** It opens or reuses the isolation branch, stages and commits the
  changes, and pushes.

If you are not running under such a hook — a human, or an agent invoked
directly — there is nothing to own this for you, so the general discipline
applies unchanged: branch, commit and push yourself.

## How work is tracked here — this is not optional

ADR-0005 leaves work tracking to each repo and asks it to declare the mechanism
here. **omul's mechanism is `docs/requirements/`**, one `REQxxx.md` file per
requirement — the single authority for what is planned, in progress and done.
How many there are is a count, not a fact worth freezing in prose: ask
`bun scripts/triage.ts stats`, for the same reason the last section of this
chapter gives. File format and full CLI reference in
[docs/README.md](docs/README.md).

These are **source-code requirements (SCR)**: what the code must do. The
business half — user stories, target users, plan and packaging, competitive
provenance — lives in a **private documentation sidecar**, a separate
repository that is not published, as business requirements `BRxxx`. Business
requirements derive source-code requirements, and each SCR names the ones it
answers in its `source` field.

- **You never need the sidecar to work here, and you are not expected to have
  it.** An SCR is self-contained by construction, so an agent can pick one up
  with this repository alone. That is the whole reason the split exists.
- **`source` is a closed vocabulary** — `BR042`, `BR042, BR116`, or `internal`
  for a requirement this codebase raised itself (a defect, a performance
  ceiling, a hardening). The parser rejects anything else, a URL above all.
- **A BR reference is an opaque identifier.** The bare number, nowhere else in
  the file: no BR title, no gloss on what the BR says, no link into the private
  repository. A reference that quotes its target has carried the target across.
- **The two numbering lines are independent** (ADR-0042 §3). A `BR<n>` and a
  `REQ<n>` sharing a number are unrelated facts; 142 of them currently match
  because the catalogs were seeded together, and that is history, not a rule.
  One BR may be answered by several SCRs — write as many as the code owes,
  each at this catalog's next free number — and one SCR may cite several BRs.
  Nothing here is renumbered to line up with anything there.
- **This repo's `source:` lines are the authoritative copy of the BR → REQ
  edge.** `grep -lE '^source:.*\bBR042\b' docs/requirements/*.md` answers
  "which SCRs answer BR042?" from this repo alone. The sidecar mirrors the edge
  from its side — each BR carries a `derived:` list of the SCRs that answer it,
  reconciled over there against these lines — but the mirror never overrules
  them, and nothing here reads it: an agent working in this repo alone still
  has the whole edge. If your change creates or retires an SCR that cites a BR
  and the sidecar is in scope for the task, update that BR's `derived:` list in
  the same change; if it is not in scope, the mirror is reconciled on the
  sidecar side.
- **No business detail in an SCR.** No prices, no plan tiers, no competitor
  behaviour, no screenshots of another product. If a requirement cannot be
  understood without one of those, it is a BR — put it in the sidecar and
  reduce what is left into the SCR.
- **A new requirement that starts from a business need starts in the sidecar.**
  Write `BR<n>` there, then the SCRs it derives here — each at this catalog's
  next free number, with `source: BR<n>`. A requirement that starts from the
  code (defect, perf, hardening) is written here alone with `source: internal`.
- **The `status` set is omul's own**, defined in `scripts/requirements.ts`
  (`VALID_STATUSES`) — not a corpus-wide vocabulary. `validate` enforces it.
  Status lives here and only here; a BR carries none.
- **Provenance is git's job, not the catalog's.** A requirement records *what*
  and *how far*, never which branch carried it: the commit that closes a
  requirement is the implementation commit, and the merge commit names the
  branch. For everything closed before the clean-slate snapshot, that git is the
  private predecessor's — this repository's history does not reach back past its
  initial commit (see "History begins at the clean-slate snapshot").
- **`task/*.md` is a closed historical log** of past multi-commit work, ending
  at `0012`. Read it for context if you like; never read status out of it, and
  do not add new files there. Status lives in the requirement, nowhere else. It
  was reopened exactly once, for the identifier sweep described at the end of
  this section, and is otherwise not revised.
- **The catalog's listing is generated, and it is the only one** (ADR-0040).
  `docs/requirements/` is a declared knowledge directory, indexed by its sibling
  [docs/Requirements.md](docs/Requirements.md) — one row per file, written by the
  shared `index` CLI and never by hand. There is no repo-local generator and no
  second listing of those files anywhere in this repo, so counts and breakdowns
  come from `bun scripts/triage.ts stats` on demand rather than from a table that
  can go stale.

**Whenever you work on something a requirement covers, update that requirement
in the same change** — leaving it stale is a defect, not a follow-up:

1. **Move the status** (`in-progress` / `done` / `blocked`).
2. **Append an update-log entry** with `triage log` — the `## Updates` section
   is the requirement's append-only history; never rewrite or delete entries.
   Update logs belong in the requirement itself, not in task files or commits.
   One exception to that has ever been taken; it is recorded below and it is not
   a precedent you may extend on your own judgement.
3. **Regenerate the index** with `mise run requirements:index`.

```bash
bun scripts/triage.ts set REQ102 --status done
bun scripts/triage.ts log REQ102 --message "Reveal endpoint + presenter toggle shipped"
mise run requirements:index
```

If a requirement's description, notes or priority turn out wrong, correct them
too (hand-editing is fine), then run `bun scripts/triage.ts validate`.

### The one exception to append-only: the identifier sweep of 2026-08-29

Append-only stands for ordinary work. It was set aside once, by the owner's
decision, and only for naming (REQ176):

- **What was traded.** The product's retired working name outlived the rename in
  requirement `## Updates` entries and in `task/*.md`, so grepping this
  repository for context kept surfacing a name that names nothing here. The
  owner weighed that dilution against append-only and decided the residue goes.
- **What the sweep was allowed to do.** Rewrite an occurrence naming *this
  product* to its current spelling; restate a sentence whose subject was the old
  spelling, in terms that do not name it; and retire an entry that existed only
  to track a predecessor's registry, host or deploy path — those identifiers
  could not be rewritten, because the rewritten names would resolve to no
  registry, host or repository that exists. Beyond that, the only other thing an
  entry was allowed to gain was a tense: a claim *about this tree's own
  contents* that the sweep had just made false was put in the past and dated, so
  it reads as a record of that day rather than as a description of now. No
  reasoning was dropped — before an entry is retired, whatever it carries that
  is still load-bearing has to be in its requirement's `## Notes` already, and
  that is verified rather than assumed. For REQ145's proxy-trust default and
  per-client bucket keying it already was, so the Notes there did not change.
- **What it does not license.** This is not permission to edit history. An entry
  is still never rewritten to make a past decision read better, to correct a
  fact (append a correcting entry instead), or to drop something inconvenient.
  Another sweep of this kind is an owner decision and gets recorded here the way
  this one is.

## Conventions that will bite you

- **Auth**: presentation mutations are authorized by **owner or edit token**;
  `creatorTokenHash` / `creatorId` must never reach clients. Read
  [docs/api.md](docs/api.md) before touching auth or routes.
- **Schemas**: `server/schemas.ts` is the single source of truth (ADR-0013);
  every non-identity `Stored*` field needs a `.default(...)` (ADR-0029).
- **Frontend**: compose the shared primitives (lucide-react icons,
  `ShareCluster`, `ICON_BUTTON_HOVER`) — never re-hand-roll; `mise run check`
  guards this. Details in [docs/frontend.md](docs/frontend.md).
- **One external runtime dependency exists, it is optional, and it is the only
  one.** Drafting a deck from a prompt (REQ007, `server/deck-generator.ts`) sends
  the prompt to a model provider. That is a deliberate ADR-0016 exception — the
  remote service *is* the feature, so there is no asset to bundle instead — and
  ADR-0016 requires it to be recorded here, which this bullet is. It stays inside
  the exception only while three things hold: it is **off unless a key is
  configured** and nothing else changes when it is not, **only the prompt leaves**
  (never a deck, an answer or an account), and **no other module imports a
  provider** — the SDK is reached by a dynamic import inside the single function
  that calls it, so `bun test` resolves no provider and needs no key. Adding a
  second external call is an architecture decision, not a drive-by: read ADR-0016
  in full first. Full rationale in
  [docs/deployment.md](docs/deployment.md#generating-a-deck-from-a-prompt-req007).
- **This repository is headed for publication.** Nothing that belongs to the
  business side may land here: pricing and plan tiers, product strategy,
  competitive research, or a link into another product's documentation. The
  requirement parser refuses the last of those outright; the rest is on you.
- **Nor does the internal estate land here** (REQ163). Keeping it out is on you,
  file by file — name a private sibling repository, an internal host or an
  internal project by role rather than by slug, and prefer the in-tree reference
  a reader can actually resolve. **One** term is refused mechanically rather
  than swept by hand: the private infrastructure repository that owns the deploy
  configuration, which had been swept out twice and came back within a day both
  times, because a sweep is a measurement and nothing failed when the vocabulary
  returned. `scripts/guard-publication-residue.ts` fails `mise run check` on it
  anywhere in the tracked *or* the not-yet-committed tree, in any section, with
  no allowance. That is the guard's whole coverage — everything else in this
  bullet is convention, not a gate, so do not read a green `check` as a swept
  tree. Write "the deploy configuration lives in a separate private
  infrastructure repository" and it passes; write the slug and it does not. And
  the guard holds its term as a digest rather than as a literal on purpose: a
  guard that names the string it refuses is an occurrence of that string, which
  is why three earlier negative-assertion tests were deleted. Do not "clarify"
  it by writing one down.
- **An internal work-queue task identifier is ordinary text here** (REQ163
  class 3, retired by the owner on 2026-08-31). Every commit is stamped with one
  by the session runner and the published tree will go on collecting them, so
  citing a review by its identifier in a requirement, a docblock or ordinary
  prose costs nothing and no gate refuses it. Prefer an in-tree reference where
  one exists — a reader of this repository can resolve a `REQ` and cannot
  resolve a ticket — but that is a courtesy, not a rule, and nothing needs
  sweeping.
- **No linter or formatter**: the repo has no lint/format tooling — match the
  surrounding file's style by hand (tabs, double quotes, trailing commas). There
  is nothing to run that will reformat code for you, and nothing that will catch
  a style drift, so read the neighbours before you write. `mise run check` is the
  read-only gate that stays green; it checks conventions and requirements, not
  style.
