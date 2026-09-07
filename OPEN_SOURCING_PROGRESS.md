# Open-sourcing progress — omul

Readiness assessment, 2026-09-07, against `workbatch/8bdfd621` at `a37256d`
(2 commits ahead of `main` at `8de317e`). Read-only: no rotation act, no
extraction, no visibility change, no registry publish.

| # | Step | Status | Decision | Findings |
| --- | --- | --- | --- | --- |
| 1 | **Mandate** — owner, scope, license (SPDX id), finish line | done | — | Owner `binaryplease`; license `AGPL-3.0-only OR LicenseRef-omul-Commercial`; scope the tracked tree; finish line not written down anywhere — inferred from REQ161/REQ162 as public repo + license detected + reporting path live. No registry package ships (`package.json` has no `publishConfig`, the artifact is a container image at `ghcr.io/binaryplease/omul`) |
| 2 | **Inventory & sweep** — exported tree, full history, remote object store, right to publish | done | — | Tree and history clean: `gitleaks git . --log-opts=--all --redact` → no leaks, 20 commits, 5.38 MB. Estate vocabulary: 0 hits for the private sibling repos, internal hosts, internal tooling or `/home/` paths; the 17 `hyhyve` hits are all `support@hyhyve.com`, the owner-chosen published contact (REQ161), guarded by `scripts/licensing.test.ts` across 7 files; 35 work-queue ids and 52 ADR ids are all inside append-only `## Updates` logs, both retired/deferred by owner decision (REQ163 classes 3 and 4). Object store: no dangling objects locally (`git fsck` empty), `main` linear across every push event the API shows, no rewrite evidence — but the store cannot be enumerated, so this is "no candidate found", not "clean". Right to publish: one unresolved item, `buffers@0.1.1` (NOTICE.md §5) |
| 3 | **Rotation** — every credential the sweep named, before anything is exported | n/a | — | Nothing to rotate: no credential in the tree or in any commit on any ref. `.env.example` ships no working secret, no credential and no address; `BETTER_AUTH_SECRET` is empty and fatal-if-unset |
| 4 | **Clean slate** — new repository, reviewed tree, one commit, created **private** | done | — | Already run. `binaryplease/omul` created 2026-09-01, initial commit `15ee1bb` (`feat: omul 1.0.0`), no ancestry, still `PRIVATE`. **The requirement that describes it, REQ165, still reads `pending`** — stale record, not stale work |
| 5 | **License & provenance** — LICENSE, SPDX id, copyright line, third-party notices | in progress | `D1` | `LICENSE-AGPL-3.0` + `LICENSE-COMMERCIAL` present with no unfilled placeholder; `package.json` carries the SPDX expression; GitHub detects `agpl-3.0`; `NOTICE.md` enumerates brand marks, storage layer, both OFL webfonts and all 242 installed packages. One component blocks a complete claim: `buffers@0.1.1` states no license anywhere and is inlined into `dist/server/index.js` |
| 6 | **Community surface** — README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, templates | in progress | `D2` | `gh api .../community/profile` → `health_percentage` 100, all files resolving. The CLA is written (`CLA.md` v1.0) but **not enforced**: the `cla-signatures` branch does not exist (404), so `.github/workflows/cla.yaml` fails opaquely, and `main` carries no branch protection or ruleset, so the check reports rather than blocks |
| 7 | **Ready-to-publish gate** — the report, then full stop | not started | — | Not reached; steps 5 and 6 are open |
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
  outstanding by REQ162's own log, unchanged since 2026-09-03.
- Four dependabot pull requests (#1–#4, GitHub Actions bumps) are open and
  unmerged.

## Decisions

| id | Ask | Link |
| --- | --- | --- |
| `D1` | What happens about `buffers@0.1.1`, which states no license and is inlined into the built server? | [decision report](https://zink.bot/v/tqu4iise3vj2fauvsdgl3tl3qm) |
| `D2` | Does the CLA get its enforcement wired before the repository goes public, or does publication go ahead with the check reporting rather than blocking? | [decision report](https://zink.bot/v/tqu4iise3vj2fauvsdgl3tl3qm) |

## Rotation list

Empty. No credential was found in the tree, in any commit on any ref, or in
the remote's object store. Nothing is owed to the age-sealed vault for this
repository.

## Irreversible acts

None.
