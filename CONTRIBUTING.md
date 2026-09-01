# Contributing to omul

Thanks for looking. This file is the short version; [AGENTS.md](AGENTS.md) is
the project's own operating manual and it is authoritative wherever the two
disagree.

## Contribution terms — a CLA is coming, and code is on hold until it lands

omul is **dual-licensed**: AGPL-3.0-only for everyone, or a separate commercial
agreement (see [LICENSE-COMMERCIAL](LICENSE-COMMERCIAL)). That second half is
the reason this section exists. Under a dual license, the copyright holder can
only offer the commercial half over code they hold the rights to offer — so
contributed code needs a **Contributor License Agreement (CLA)**: a document in
which you grant the maintainer the right to license your contribution under
both halves, while keeping your own copyright and your own right to use your
work however else you like.

**A CLA is the decided instrument, and its text is being drafted with legal
advice rather than assembled from a template.** Until it is published here:

- **Issues, bug reports, questions and discussion are open and very welcome.**
  Nothing in this section applies to them.
- **Pull requests will be read and reviewed, but not merged.** We would rather
  say so plainly than take your work and sit on it without explanation.

If you want to send code now, open an issue first and say so. When the CLA
lands, this section is replaced by it and by the instructions for accepting it,
and held pull requests can go ahead.

## Getting the project running

One command, and it needs [Nix](https://nixos.org/download/) with flakes
enabled:

```sh
nix develop
```

Dependencies install and both dev servers come up — Elysia on port 3000, Vite on
port 5173. Open <http://localhost:5173>. Storage is an in-process SQLite file,
so there is no database service to start and nothing to seed. `Ctrl+C` stops
everything.

For a shell without the auto-start:

```sh
nix develop .#shell
```

Everything after that runs through [mise](https://mise.jdx.dev), and a fresh
clone needs one command before any of it works:

```sh
mise trust
```

Without it `mise` will not read `.mise.toml`, and every task fails with
`no tasks defined in … Are you in a project directory?` — an error that says
nothing about trust. Run it once per clone.

| Command | What it does |
|---|---|
| `mise run dev` | Server + client together |
| `mise run dev:server` / `dev:client` | One side only |
| `mise run test` | The test suite — 2300-odd tests, about 30 seconds |
| `mise run build` | Vite → `dist/client/`, Bun → `dist/server/` |
| `mise run check` | The convention and requirement gate — see the caveat below |

## Three things that will surprise you

**Run the suite as `mise run test`, never as a bare `bun test`.** The Nix shell
pins Bun 1.2.13, which has no `Bun.YAML`; `scripts/requirements.ts` parses the
requirement catalog's frontmatter with it, so a bare `bun test` under
`nix develop` reports 15 failures in `scripts/requirements.test.ts` and
`bun scripts/triage.ts validate` errors out — none of it about your change.
`mise` supplies Bun 1.3.x, where the same suite is 2313/2313 green. Fixing the
pin so both agree is tracked as an open follow-up; until then, use the task.

**`mise run check` needs a CLI this repository does not ship.** It calls a tool
named `index`, which regenerates the listing of the requirement catalog. It is
not on npm and `mise install` does not fetch it, so the task exits 127 with
`index: command not found` unless you already have it. Everything else — `dev`,
`build`, `test`, and `bun scripts/triage.ts validate`, which checks every
requirement file — needs only `bun`. **If `check` fails that way for you, say so
in the pull request and leave `docs/Requirements.md` exactly as you found it**;
a hand-edited index is worse than a stale one.

**There is no linter and no formatter.** Nothing in this repository will
reformat your code and nothing will catch a style drift. Read the neighbouring
lines and match them by hand: tabs, double quotes, trailing commas.

## How the work is tracked

Everything planned, in progress and done lives in `docs/requirements/`, one
`REQxxx.md` file per requirement. That catalog is the single authority — not
issues, and not the closed historical logs under `task/`.

```sh
bun scripts/triage.ts stats            # how many, by status and priority
bun scripts/triage.ts list --status pending --priority P0
bun scripts/triage.ts show REQ102
bun scripts/triage.ts validate         # every file well-formed
```

**If your change touches something a requirement covers, update that
requirement in the same change** — move its `status`, and append an entry with
`bun scripts/triage.ts log REQ102 --message "…"`. The `## Updates` section is
append-only: add to it, never rewrite or delete what is there.

`docs/README.md` documents the file format and the full triage CLI.

## Sending a change

1. **Open an issue first** for anything larger than an obvious fix, and see the
   terms section above.
2. **Branch from `main`.** Name it whatever is clear.
3. **`mise run test` green, `mise run build` green**, and `mise run check` green
   if you have the `index` CLI.
4. **One concern per pull request.** A change that fixes a bug and reformats
   four files is two changes.
5. **Describe what a reviewer cannot see from the diff** — what you tried, what
   you rejected, and how you convinced yourself it works.

Commit messages are conventional-commit style (`feat:`, `fix:`, `docs:`,
`refactor:`, `chore:`) with a body that explains why. Copy the shape of
`git log`.

## Where to read next

| Document | What is in it |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Stack, project layout, storage model |
| [docs/api.md](docs/api.md) | Auth model, endpoints, WebSocket events |
| [docs/frontend.md](docs/frontend.md) | Shared UI primitives and the conventions `check` guards |
| [docs/deployment.md](docs/deployment.md) | Container packaging and every environment variable |

## Conduct, and reporting a security problem

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
**Never report a security vulnerability in a public issue** — use one of the two
private routes in [SECURITY.md](SECURITY.md).
