# Maintaining omul — the private copy and promotion

This page is for maintainers. **If you work in a fork, none of it applies to
you**: name your branches however you like and open a pull request against
`main`; the test suite and the CLA check run on that pull request
([CONTRIBUTING.md](../CONTRIBUTING.md)). Nothing described here runs in a fork —
the CLA job runs only in this repository, and the image build pushes only from
binaryplease's own repositories (REQ193).

## Where work happens: a private copy, then promotion

Maintainers develop in a **private copy of this repository** that shares its
history. A maintainer's checkout has two remotes: `origin` is the private copy,
and `public` is this repository with its push URL set to `NO_PUSH`, so nothing
pushes here by accident.

- **Workbatch branches live in the private copy.** They are pushed there, never
  here.
- **The private `main` is never merged into.** It only fast-forwards to this
  repository's `main` (`mise run sync:public-main`); a branch ruleset there
  refuses every other update except a repository admin's. Cut new workbatches
  from it, so they apply cleanly here.
- **`rc` is the private copy's staging branch**: `main` plus the workbatches
  picked for staging, rebuilt whenever needed, built into an image by
  `build.yaml`. It is never merged anywhere and never promoted, because it would
  carry merge commits and unrelated work across.
- **Promotion moves one workbatch at a time, from the maintainer's checkout.**
  No second clone is needed: `public` already cannot be pushed to. Fetch
  `public`, rebase the branch onto `public/main`, run
  `mise run publish:gate -- public/main <branch> --terms <file>`, push it here
  as `publish/<id>` with this repository's URL written out in the push command
  (that deliberate step is the only way a push reaches this repository), and
  open a pull request. If sessions are working in the checkout, rebase in a
  `git worktree` of it instead of switching their branch. If the rebase moved
  the branch, force-push it to the private copy too, so both name the same
  commits. The CLA check and the test suite run on that pull request. If the gate fails on any commit, squash the branch into
  one commit that passes and run the gate again: pushing a branch publishes
  every commit on it, including ones a later commit undid.
- **The terms file stays outside the tree.** It lists what must not cross, and
  a list of those terms committed here would be an occurrence of each one.

## Maintainer tasks

Both are hidden from `mise tasks`; `mise tasks --hidden` lists them.

| Command | Description |
|---|---|
| `mise run publish:gate -- <base> <head> --terms <file>` | Check a range before it is promoted to this repository (`scripts/publish-gate.ts`) |
| `mise run sync:public-main` | Fast-forward the private copy's `main` to the public `main` |

## The server package's dependency hash

This section applies in a fork too: it concerns anyone who changes `bun.lock`.

The flake builds the server (`packages.omul-server`, REQ254) in a sandbox
without network. Its npm dependencies are installed by a fixed-output
derivation, `bun install --frozen-lockfile`, whose result Nix checks against the
hash in `serverNodeModulesHashes` in `flake.nix`. **Every change to `bun.lock`
needs a new hash in the same change.** An update of the `nixpkgs` input can
change it as well, because it can bring a different Bun.

A stale hash does not always fail. Nix stores a fixed-output derivation's result
under its hash, so a machine that still holds the tree for the old hash reuses
it and builds the server against the old dependencies. A machine without it
fails with `hash mismatch in fixed-output derivation`. So replace the hash
before you build, never after:

```sh
# 1. In flake.nix, set serverNodeModulesHashes.x86_64-linux to
#    "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
# 2. Build the dependency tree. It fails and prints the hash it got:
nix build .#omul-server.nodeModules
#    error: hash mismatch in fixed-output derivation '…-omul-server-node-modules-…':
#             specified: sha256-AAAA…
#                got:    sha256-<new value>
# 3. Put the "got:" value into flake.nix, then build the server and run the
#    NixOS module's VM test:
nix build .#omul-server
nix build -L .#checks.x86_64-linux.nixos-module
# 4. Optional: install again from scratch and compare, which confirms that the
#    install is reproducible.
nix build .#omul-server.nodeModules --rebuild
```

The hash is per system, because Bun installs only the running platform's native
optional dependencies. Only `x86_64-linux` has one, so only `x86_64-linux` has
the server package; adding a system means running step 2 on that system and
adding its value.
