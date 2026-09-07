# Open-sourcing progress — omul

Readiness assessment, 2026-09-07, first written against `workbatch/8bdfd621` at
`a37256d`, then updated after `D1` and `D2` were answered — both acted on the
same day, both against `main` at `fd8e963`. No extraction, no visibility change,
no registry publish, and nothing irreversible.

| # | Step | Status | Decision | Findings |
| --- | --- | --- | --- | --- |
| 1 | **Mandate** — owner, scope, license (SPDX id), finish line | done | — | Owner `binaryplease`; license `AGPL-3.0-only OR LicenseRef-omul-Commercial`; scope the tracked tree; finish line not written down anywhere — inferred from REQ161/REQ162 as public repo + license detected + reporting path live. No registry package ships (`package.json` has no `publishConfig`, the artifact is a container image at `ghcr.io/binaryplease/omul`) |
| 2 | **Inventory & sweep** — exported tree, full history, remote object store, right to publish | done | — | Tree and history clean: `gitleaks git . --log-opts=--all --redact` → no leaks, 20 commits, 5.38 MB. Estate vocabulary: 0 hits for the private sibling repos, internal hosts, internal tooling or `/home/` paths; the 17 hits on the operator's mail domain are all the single owner-chosen published contact address (REQ161), which `scripts/licensing.test.ts` holds across 7 files and nowhere else — this record deliberately does not spell it, because that guard measures the set of root files naming a mailbox and a copy here would enlarge it; 35 work-queue ids and 52 ADR ids are all inside append-only `## Updates` logs, both retired/deferred by owner decision (REQ163 classes 3 and 4). Object store: no dangling objects locally (`git fsck` empty), `main` linear across every push event the API shows, no rewrite evidence — but the store cannot be enumerated, so this is "no candidate found", not "clean". Right to publish: one unresolved item, `buffers@0.1.1` (NOTICE.md §5) — closed under `D1`, see step 5 |
| 3 | **Rotation** — every credential the sweep named, before anything is exported | n/a | — | Nothing to rotate: no credential in the tree or in any commit on any ref. `.env.example` ships no working secret, no credential and no address; `BETTER_AUTH_SECRET` is empty and fatal-if-unset |
| 4 | **Clean slate** — new repository, reviewed tree, one commit, created **private** | done | — | Already run. `binaryplease/omul` created 2026-09-01, initial commit `15ee1bb` (`feat: omul 1.0.0`), no ancestry, still `PRIVATE`. **The requirement that describes it, REQ165, still reads `pending`** — stale record, not stale work |
| 5 | **License & provenance** — LICENSE, SPDX id, copyright line, third-party notices | done | — | `D1` answered *pin around it* and executed. `package.json` `overrides` forces `unzipper` to `^0.11.6`, past exceljs's `^0.10.11`; the 0.11 line dropped `binary`, and `buffers`, `chainsaw` and `traverse` went with it. Bundle grep for those module paths in `dist/server/index.js`: 12 before, **0 after**. Re-measured over a clean tree — **233 packages, every one states a license**, all AGPL-3.0-compatible. Licenses present with no unfilled placeholder, SPDX expression in the manifest, GitHub detects `agpl-3.0`, copyright line names Enrico Scherlies. REQ161 → `done` |
| 6 | **Community surface** — README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, templates | in progress | — | `D2` answered *wire it first* and executed. `cla-signatures` branch created from `main` at `fd8e963` holding `signatures/v1/cla.json` = `{"signedContributors": []}`, read back through the contents API. Ruleset **`main: CLA required`** (id 22461120), enforcement active, requiring the status check `Check the contributor license agreement` on `refs/heads/main`; confirmed from the other side by `gh api .../rules/branches/main`. `community/profile` health 100. Open for one non-code reason only: **`CLA.md` §5, §7, §11 have never had a lawyer's read** |
| 7 | **Ready-to-publish gate** — the report, then full stop | not started | — | Not reached. Two things stand: the legal read above, and a written finish line (step 1) |
| 8 | **Publish** — flip public, protections, tagged release, registry | not started | — | Repository is `PRIVATE`; 0 tags, 0 releases. Actions history and the 4 open dependabot PRs flip public with it and have not been read for that |
| 9 | **Stranger's-eye verification** — fresh clone, no credentials, build, install | not started | — | Local evidence only: `mise run check` exit 0 (4/4 steps, `index check` 177 entries), `mise run test` 2424 pass / 0 fail across 130 files, `mise run build` exit 0. Not yet run from a fresh clone in a clean environment |
| 10 | **Handoff** — releases, vulnerability reports, contributor PRs | not started | — | `SECURITY.md` names two private routes and publishes response targets; nothing handed off yet |

## Notes

- **This file is now inside the publication artifact.** The extraction already
  ran, so the repository being worked in is the one that flips, not a parked
  original. `scripts/guard-publication-residue.ts` exempts this path by name
  (`EXEMPT_PATHS`), which keeps `check` green — it does **not** keep the file
  out of the published tree. Deleting it is a gate item for step 8.
- **The branch under review is publication-safe on its own.** `workbatch/8bdfd621`
  (REQ179, the `/app/` path split) adds no dependency, names no internal host,
  repository or tool, and its one license-facing change is a correction:
  moving the client under `/app/` moved the bundled webfonts' OFL-1.1 notice
  with it, and `a37256d` corrects `NOTICE.md` §3 to match. Verified against a
  real build rather than read: `/app/licenses/OFL-1.1-fonts.txt` → 200
  `text/plain; charset=utf-8`, the root path → 404, and the file carries both
  the Figtree and the DM Mono copyright lines plus the full OFL text.
- **`REQ179` is assigned twice.** This branch uses it for the path split
  (`source: internal`); the unmerged remote branch `workbatch/fda089a2` uses it
  for an instance growth view (`source: BR148`, with REQ180 and REQ181). Both
  are pushed. One of the two has to be renumbered before either merges.
- **CLA §5, §7 and §11 have never had a lawyer's read** — recorded as
  outstanding by REQ162's own log since 2026-09-02. It is now the **only** open
  item on the community surface, and the last thing between here and the step-7
  gate other than a written finish line.
- **`npm` cannot install this repository at all, and `package-lock.json` is
  stale enough to mislead.** `npm install --package-lock-only` fails `ERESOLVE`:
  `better-call@1.4.0` declares `peerOptional zod@"^4.0.0"` while the project
  pins `zod@^3.24.0`. The tracked `package-lock.json` still says
  `"version": "0.0.0"` and holds 59 packages against the 233 `bun install`
  resolves, and it carries no `overrides` — so an `npm ci` from it would
  reinstall the very `buffers@0.1.1` that `D1` just removed. Nothing in the
  repository uses it: the Dockerfile copies `package.json` and `bun.lock`, and
  the only reader is a name-agreement assertion in `scripts/licensing.test.ts`.
  **Recommended: delete it and drop that assertion** — `bun.lock` is the real
  lockfile — but that is a build decision, so it is left standing and flagged.
- The **ruleset carries an admin bypass** (`RepositoryRole` 5, `bypass_mode`
  `always`), which is a deliberate departure from the command
  `.github/workflows/cla.yaml` used to carry. A required status check is
  enforced on direct pushes too, and the CLA job runs only on
  `pull_request_target` / `issue_comment`, so without the bypass the rule would
  reject every push to `main` — this project's own merge commits included.
  Reasoning and the standing maintainer rule are in that file's header.
- Four dependabot pull requests (#1–#4, GitHub Actions bumps) are open and
  unmerged. They will now show the CLA check red by design.

## Decisions

| id | Ask | Answered | Link |
| --- | --- | --- | --- |
| `D1` | What happens about `buffers@0.1.1`, which states no license and is inlined into the built server? | 2026-09-07 — **pin around it**, executed | [decision report](https://zink.bot/v/tqu4iise3vj2fauvsdgl3tl3qm) |
| `D2` | Does the CLA get its enforcement wired before the repository goes public, or does publication go ahead with the check reporting rather than blocking? | 2026-09-07 — **wire it first**, executed | [decision report](https://zink.bot/v/tqu4iise3vj2fauvsdgl3tl3qm) |

## Rotation list

Empty. No credential was found in the tree, in any commit on any ref, or in
the remote's object store. Nothing is owed to the age-sealed vault for this
repository.

## Irreversible acts

None. Publication has not happened: the repository is still `PRIVATE`, there is
no tag and no release, and nothing has been pushed to a registry.

Two acts against the remote were taken on 2026-09-07 under `D2`, in this order.
Both are reversible, and this is where they are recorded because they are
repository state rather than tree content — a fork or a restored repository
starts without them:

1. Created `refs/heads/cla-signatures` from `main` at `fd8e963`, then wrote
   `signatures/v1/cla.json` = `{"signedContributors": []}` on it
   (commit `146b745`). Undo: delete the branch.
2. Created repository ruleset **`main: CLA required`**, id 22461120, enforcement
   `active`, one `required_status_checks` rule naming
   `Check the contributor license agreement` on `refs/heads/main`, with
   `bypass_actors` `[{actor_id: 5, RepositoryRole, bypass_mode: always}]`.
   Undo: `gh api -X DELETE repos/binaryplease/omul/rulesets/22461120`.
