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
