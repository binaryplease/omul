# omul

Self-hosted live interactive presentations — polls, word clouds, Q&A, scales, rankings, 2x2 grids, 100-point splits, number guesses, quizzes and leaderboards. Participants join with a 6-digit code on any device. No accounts needed.

## Getting started

```sh
nix develop
```

That's it. Dependencies install and the dev servers come up. Storage is an
in-process SQLite file (zodstore), so there's no database service to start.
Ctrl+C stops everything cleanly.

For a plain shell without auto-start:

```sh
nix develop .#shell
mise trust          # once per clone, before any `mise run` task
mise run test
```

**`mise trust` is not optional in a fresh clone.** Without it `mise` refuses to
read `.mise.toml`, and every task fails with `no tasks defined … Are you in a
project directory?` rather than with anything about trust. Run it once and the
task list works.

**Use `mise run test`, not a bare `bun test`.** The Nix shell pins Bun 1.2.13,
which has no `Bun.YAML` — the requirement-catalog tooling needs it, so a bare
`bun test` reports 15 failures in `scripts/requirements.test.ts` that say
nothing about your change. `mise` supplies Bun 1.3.x and the same suite passes
2313/2313. The application itself builds and runs correctly on either.

## Stack

- **Server** — Bun + Elysia, `@binaryplease/zodstore` (SQLite), WebSocket
- **Frontend** — React 19, Tailwind 4

## Self-hosting

One container, no database sidecar, no cache and no queue — all state is
`bun:sqlite` in a single directory. The image is built from this repository by
`.github/workflows/build.yaml` and published to
`ghcr.io/binaryplease/omul`.

```sh
docker run -d --name omul \
  -p 3000:3000 \
  -v omul-data:/app/data \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e OMUL_BASE_HOST=omul.example.com \
  -e OMUL_TRUST_PROXY=1 \
  -e OMUL_ADMIN_EMAILS=you@example.com \
  ghcr.io/binaryplease/omul:latest
```

Four things decide whether that instance works, and each fails in its own way:

| Variable | What happens if you leave it out |
|---|---|
| `BETTER_AUTH_SECRET` | **The container refuses to start.** There is no fallback on purpose — a placeholder shipping in public source would let any reader forge a session. Generate one with `openssl rand -base64 32` and supply it the way your deployment supplies secrets |
| `OMUL_BASE_HOST` | **Nobody can sign in.** A bare host, no scheme and no path. It is also what puts a working link in verification mail |
| `OMUL_TRUST_PROXY` | Behind a reverse proxy, every visitor shares one rate-limit bucket. Leave it unset for a directly-exposed container |
| `OMUL_ADMIN_EMAILS` | **Nobody is an administrator** and `/api/admin/*` answers `403` to everyone. That is a complete instance — presenters and participants never touch the admin surface — so set it only if you want that surface |

**Mount the directory, not the file.** Three SQLite databases live under
`/app/data` (`omul.sqlite`, `auth.sqlite`, `admin.sqlite`); binding the single
file silently drops two of them. Nothing here backs that directory up, and
copying a live WAL-mode SQLite file is not a backup — use `VACUUM INTO`, or copy
with the container stopped.

[docs/deployment.md](docs/deployment.md) is the full reference: every
environment variable with what breaks when it is unset, the state and backup
position, the abuse limits, and the reverse-proxy notes. **No compose file or
environment example ships yet** — that is tracked as `REQ172` and the command
above is what stands in for it.

## The one external service, and it is optional

Everything above runs with no network but the one it is served on. **Drafting a
deck from a prompt is the single exception**: it sends the prompt to a model
provider (Google's Generative AI API, through the Vercel AI SDK) and turns the
answer into slides.

It is an intentional, documented exception to ADR-0016 — the remote service *is*
the feature, there is no asset to bundle instead — and it is bounded:

- **Off unless you configure it.** No `GOOGLE_GENERATIVE_AI_API_KEY`, no
  generation; nothing else in the product changes, and the UI says so on the
  control rather than hiding it. Every other way to start a deck — blank, or from
  the built-in template catalog — is unaffected.
- **Nothing else in the codebase calls a provider.** The SDK is loaded lazily
  inside the one function that makes the call, so a build, a test run and every
  other route never load it. The test suite reaches no provider at all.
- **Only the prompt leaves.** Your decks, your participants' answers and your
  session data are never sent anywhere.

See [docs/deployment.md](docs/deployment.md#generating-a-deck-from-a-prompt-req007)
for the variables and [server/deck-generator.ts](server/deck-generator.ts) for
what a generator may and may not author.

## License

Copyright (c) 2026 Enrico Scherlies

omul is dual-licensed, and you choose which of the two applies to you:

- **[GNU Affero General Public License, version 3 only](LICENSE-AGPL-3.0)** —
  free of charge, no registration, no agreement with anybody. This is the
  license that applies unless a signed commercial agreement says otherwise. Use
  it, study it, modify it, self-host it, fork it, commercially or not; the AGPL
  asks in return that users you serve it to over a network can get the source
  (§13).
- **[A commercial license](LICENSE-COMMERCIAL)** — a separate bilateral
  agreement, for those who cannot or do not wish to meet those conditions. That
  file is a pointer and carries no terms: it names the mailbox to write to
  (`support@hyhyve.com`) and nothing else. **You do not need it to use omul.**

The SPDX expression for the pair is
`AGPL-3.0-only OR LicenseRef-omul-Commercial`.

**Neither grant gives you the name or the marks under trademark law.** The
eight files under `public/brand/` and the wordmark geometry in
`src/components/BrandMark.tsx` are named by path and by name in
[TRADEMARK.md](TRADEMARK.md), which reserves the trademark rights in them under
AGPL-3.0 §7(e). It is not a copyright carve-out: those files stay under the
code license, so you may redistribute them with the source. What is not granted
is using the mark to identify a build — the short version is: if you change the
code, change the mark.

[NOTICE.md](NOTICE.md) is the third-party position for the whole tree that
ships: the MIT storage layer and the notice the bundled build carries for it,
the two OFL-1.1 webfonts and their attribution, the 242-package dependency set
with its licenses, and one transitive dependency that states no license at all.

## Contributing, conduct, and security

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to run the project, how work is
  tracked, and what to do before opening a pull request. Read the first section:
  **contribution terms are not settled yet**, so pull requests are reviewed but
  held rather than merged. Issues and discussion are open and welcome.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — the Contributor Covenant,
  reported to `support@hyhyve.com`.
- **[SECURITY.md](SECURITY.md)** — **never report a vulnerability in a public
  issue.** Use this repository's private vulnerability reporting, or email
  `support@hyhyve.com` with `omul security` in the subject.
