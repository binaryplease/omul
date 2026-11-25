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
bun install         # the plain shell does not do this for you
mise trust          # once per clone, before any `mise run` task
mise run test
```

**`bun install` is not optional in this shell.** `nix develop` installs
dependencies on the way in and `.#shell` does not, so a fresh clone that skips
it has no `node_modules` and `mise run test` reports 84 failures and 43 errors
that all read `Cannot find package …` and say nothing about your checkout. With
the install, a fresh clone of this repository passes 2424 tests across 130
files.

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
- **Command-line client** — Bun, no dependencies (`cli/`)

## Driving it from a terminal

The whole HTTP API is documented and programmatically reachable, and this
repository ships a client for it — one `omul` command that creates a
presentation and reads its results back, authenticated by a personal API key you
mint in your account settings. No browser step, nothing to hand-write against
`/api`.

```sh
nix run github:binaryplease/omul#omul -- --server https://omul.example.com health
```

```sh
omul auth login                        # paste the key at a prompt that does not echo it
omul create --template retrospective --title "Sprint 42"
omul results <id>                      # add --json for the full tally
omul help
```

A coding agent drives the same client from the skill this repository carries in
[skills/omul/](skills/omul/SKILL.md) — `npx skills add binaryplease/omul`
installs it, and the agent then knows the verbs and the credential rules without
reading this codebase.

In a checkout, `bun link` puts the same command on your PATH and
`mise run cli -- help` runs it without installing anything. The key is read from
`OMUL_API_KEY` or a `0600` file in `~/.config/omul/` — never from a flag, so it
stays out of your shell history — and neither it nor a deck's edit token is sent
to a plain-`http://` host that is not your own machine. Full reference:
[docs/api.md](docs/api.md#driving-the-api-from-a-terminal-req180).

## Self-hosting

omul is one process with no database sidecar, no cache and no queue: all state
is `bun:sqlite` in a single directory. On NixOS, the recommended way to run it
is the NixOS module this repository's flake exports. On a host without NixOS,
run the container image.

### On NixOS: the flake's module (recommended)

The flake exports the server as `packages.omul-server` and a NixOS module,
`nixosModules.default`, that runs it as the systemd service `omul.service`
(REQ254). Add the flake as an input of your system's flake and import the
module:

```nix
{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  inputs.omul.url = "github:binaryplease/omul";

  outputs = { nixpkgs, omul, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        omul.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

Then enable it in `configuration.nix`:

```nix
services.omul = {
  enable = true;
  # A file that holds only the output of `openssl rand -base64 32`, owned by
  # root with mode 0400. Give it as a string: a Nix path literal would be
  # copied into the world-readable Nix store, and the module refuses that.
  secretFile = "/run/secrets/omul-auth-secret";
  baseHost = "omul.example.com";   # bare host, no scheme and no path
  trustProxy = 1;                  # one reverse proxy in front
  # adminEmails = [ "you@example.com" ];
};
```

`nixos-rebuild switch` builds the server from the flake and starts it. The
first build downloads the npm dependencies once and checks them against a hash
in the flake. The service listens on port 3000 (`services.omul.port`) on every
interface, because the server has no bind-address setting, and the module
leaves that port closed in the NixOS firewall unless you set
`services.omul.openFirewall = true`. Put a TLS-terminating reverse proxy on the
same host in front of `127.0.0.1:3000`; the module configures no proxy, TLS,
DNS or backup.

- **Data.** Every database is in `/var/lib/omul`, the service's state
  directory, and stays there across restarts, upgrades and reboots. The service
  runs as a user that systemd creates for it (`DynamicUser`), and that directory
  is the only place it can write.
- **Secrets.** `secretFile` and the optional `generationApiKeyFile` (deck
  generation, see below) reach the service as systemd credentials, so neither
  value enters the Nix store or the unit file. Further secrets, such as
  `BREVO_API_KEY`, go in a file named by `services.omul.environmentFile`.
  Further non-secret variables from
  [docs/deployment.md](docs/deployment.md#environment-variables) go in
  `services.omul.environment`.
- **Platform.** The flake builds the server package for `x86_64-linux`.

The four options in the example set the four variables in
[the table below](#what-every-instance-has-to-be-told).

### On a host without NixOS: the container image

The image is built from this repository by `.github/workflows/build.yaml` and
published to `ghcr.io/binaryplease/omul`.

Two files here are the whole deployment — [compose.yaml](compose.yaml) and
[.env.example](.env.example) — and this is the path from a clone to a running
instance:

```sh
cp .env.example .env
openssl rand -base64 32     # paste the output into BETTER_AUTH_SECRET= in .env
# uncomment the `build: .` line in compose.yaml — see the note right below
docker compose up -d --build
```

**Build the image, don't pull it — for now.** The workflow publishes to
`ghcr.io/binaryplease/omul`, but that package is **not public yet**: an
anonymous pull is refused, so a plain `docker compose up -d` fails at the pull
with a permission error rather than at anything in your setup. Uncommenting
`compose.yaml`'s one `build:` line builds the identical image from this tree —
same `Dockerfile` the workflow uses — and needs no registry account at all.
When the package is made public this note goes and the pull becomes the shorter
path; nothing else about the deployment changes.

That serves a working instance at `http://localhost:3000` **on the machine you
ran it on, and nowhere else**: the container is published on the host's
loopback, so exposing it stays a deliberate step rather than something you get
by not thinking about it. It is already complete — sign up, build a deck, put
the 6-digit code on screen, and anything that can reach that port can join.

The app's own front door is `/app`, and the bare host redirects there. It sits
under a prefix because omul is built to share one host with a separate
marketing site, split by path — but **join links keep the host root**
(`http://localhost:3000/join/1234`), which is the entire point of that
arrangement: the presenter reads that link out loud. Nothing about it requires
you to run a site; a standalone instance answers everything the app owns and
`404`s the rest. See
[docs/deployment.md](docs/deployment.md#sharing-one-host-with-the-marketing-site-req179).

To serve it to other people, put a TLS-terminating reverse proxy in front of
that port under a name of yours, and add two lines to `.env`:

```sh
OMUL_BASE_HOST=omul.example.com   # bare host, no scheme and no path
OMUL_TRUST_PROXY=true             # trusted proxy hops; "true" is 1
```

`docker compose up -d` again picks them up. Without compose, the same
deployment spelled out by hand:

```sh
docker run -d --name omul \
  -p 127.0.0.1:3000:3000 \
  -v omul-data:/app/data \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e OMUL_BASE_HOST=omul.example.com \
  -e OMUL_TRUST_PROXY=1 \
  -e OMUL_ADMIN_EMAILS=you@example.com \
  ghcr.io/binaryplease/omul:latest
```

**`compose.yaml` needs no registry, either** — and today it needs the build
line. Its default is the published image, but that package is not public yet
(see the note above), so uncommenting the one `build:` line is what makes a
clone a complete deployment: same `Dockerfile`, no `ghcr.io` account, nothing
else to change.

The same applies to the `docker run` line above: it names
`ghcr.io/binaryplease/omul:latest`, which an anonymous Docker cannot pull today.
Build it locally first — `docker build -t omul .` — and run that tag instead.

**Without Docker**, build with the Dockerfile's two build commands and run the
result under systemd. You need Bun, and no database service.
[docs/self-hosting-without-docker.md](docs/self-hosting-without-docker.md)
covers the whole path, including where the data lives and how to back it up and
upgrade.

### What every instance has to be told

Four variables decide whether an instance works, and each fails in its own way.
Under the NixOS module, the option beside each variable sets it:

| Variable | NixOS option | What happens if you leave it out |
|---|---|---|
| `BETTER_AUTH_SECRET` | `secretFile` | **The server refuses to start**, wherever you run it. There is no fallback on purpose — a placeholder shipping in public source would let any reader forge a session. Generate one with `openssl rand -base64 32` and supply it the way your deployment supplies secrets |
| `OMUL_BASE_HOST` | `baseHost` | Fine on `localhost`, but on a public host **nobody can sign in**: the public origin is not among the ones allowed to drive auth until this names it. A bare host, no scheme and no path. It is also what puts a working link in verification mail, and what the `/api` index advertises |
| `OMUL_TRUST_PROXY` | `trustProxy` | Behind a reverse proxy, every visitor shares one rate-limit bucket. Leave it unset (`0`) for a server that is reached directly |
| `OMUL_ADMIN_EMAILS` | `adminEmails` | **Nobody is an administrator** and `/api/admin/*` answers `403` to everyone. That is a complete instance — presenters and participants never touch the admin surface — so set it only if you want that surface |

**Keep the whole directory.** Up to four SQLite databases live in one
directory (`omul.sqlite`, `auth.sqlite`, `admin.sqlite`, and `feedback.sqlite`
once feedback is switched on): `/var/lib/omul` under the NixOS module,
`/app/data` in the container. In the container, mount the directory, not the
file: binding the single file silently drops the others. Nothing here backs
that directory up, and copying a live WAL-mode SQLite file is not a backup — use
`VACUUM INTO`, or copy with the service or the container stopped.

[docs/deployment.md](docs/deployment.md) is the full reference: every
environment variable with what breaks when it is unset, the state and backup
position, the abuse limits, and the reverse-proxy notes. `.env.example`
carries the subset a deployment actually decides, with the same warnings beside
the lines they apply to.

## The one external service, and it is optional

Everything above runs with no network but the one it is served on. **Drafting a
deck from a prompt is the single exception**: it sends the prompt to a model
provider (Google's Generative AI API, through the Vercel AI SDK) and turns the
answer into slides.

It is an intentional, documented exception to the project's rule that
production depends on no third-party runtime host — the remote service *is*
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
the two OFL-1.1 webfonts and their attribution, the CC BY 3.0 contributor
agreement text, and the 233-package dependency set with its licenses — every
one of which states a license.

## Contributing, conduct, and security

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to run the project, how work is
  tracked, and what to do before opening a pull request.
- **[CLA.md](CLA.md)** — the contributor license agreement, which every author
  of a merged commit signs once. It is the **Harmony Individual Contributor
  License Agreement 1.0**, a standard off-the-shelf form, with its blanks filled
  in and nothing drafted for this project. It is a
  **license, not an assignment**: you keep your copyright and your right to use
  your own work anywhere else, the maintainer gets the right to license it under
  both halves
  of the dual license, and in return your contribution goes on being licensed
  under omul's open license as well (§2.3). You sign by replying to the check on
  your own pull request. Issues and discussion need none of it.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — the Contributor Covenant,
  reported to `support@hyhyve.com`.
- **[SECURITY.md](SECURITY.md)** — **never report a vulnerability in a public
  issue.** Use this repository's private vulnerability reporting, or email
  `support@hyhyve.com` with `omul security` in the subject.
