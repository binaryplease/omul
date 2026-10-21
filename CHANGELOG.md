# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-21

### Added

- `omul`, a command-line client that drives a running omul server with a personal API key and no browser: `health`, `auth login|status|logout`, `templates`, `create` (from a template or a deck file), `list`, `show` and `results`, with `--json` for the raw payload. Install it with `nix run github:binaryplease/omul#omul`, with `bun link` in a checkout, or run it as `mise run cli -- <command>`.
- The client handles credentials carefully:
  - The API key comes from `OMUL_API_KEY` or from `omul auth login`. There is no `--api-key` flag, so the key never lands in shell history or a process list.
  - The edit token a create returns is stored in a private file and never printed.
  - Credentials are refused over plain HTTP to a non-loopback host unless `OMUL_CLI_ALLOW_PLAINTEXT_CREDENTIALS=true` is set.
  - Redirects are reported, not followed.
- An installable agent skill (`npx skills add binaryplease/omul`) that teaches an AI agent to create a presentation and read its results through the `omul` client.
- Links to the instance's imprint, privacy policy and terms:
  - Set them with `OMUL_IMPRINT_URL`, `OMUL_PRIVACY_URL` and `OMUL_TERMS_URL`. Each takes an absolute `http(s)://` URL or a path on the same host such as `/imprint`. Any other value stops the server at startup with an error naming the variable.
  - Each one that is set appears as a link in the app menu, on every page.
  - The terms and the privacy policy are also named, with links, before a visitor signs up, creates a presentation (from the editor, a template or a generated draft), or joins one with a code, a link or the QR code.
  - Nothing is shown while the variables are unset.
  - The configured links are served at `GET /api/legal`.
- Query parameters a visitor arrived with can stay in the address bar while they move around the app:
  - List them in `OMUL_KEPT_QUERY_PARAMS`, comma-separated, as exact names (`ref`) or prefixes ending in `*` (`campaign_*`). Values are kept exactly as they arrived.
  - Nothing is kept while the variable is unset.
  - `mode`, `token` and `error`, which carry sign-in links, can never be kept. Listing one of them, or a malformed entry, stops the server at startup with an error naming the variable.
- Q&A questions can be held for approval before the audience sees them:
  - Presenters turn this on in the Q&A panel with "Approve questions first". It is off by default.
  - While it is on, a new question is visible only to people who can edit the presentation, and nobody else can upvote it until it is approved.
  - The panel shows a pending count, marks waiting questions "Awaiting approval", and lets the presenter approve each one.
- Presenters can hide the join bar on the presenter screen and show it again. The choice is saved with the presentation and followed by every open presenter screen. Hiding the bar does not change who can join.
- A workspace owner can choose a default theme for the workspace. A presentation created in the workspace starts with that theme unless another theme is chosen, and each presentation can still change its own.
- The presenter screen shows how long the session has been running. The clock stops when the session ends, survives a page reload, and is cleared by a reset.
- Anyone can send feedback about omul to the people who run the instance, from "Send feedback" in the app menu:
  - Set `OMUL_FEEDBACK_ENABLED=true` to turn it on. It is off by default; while it is off the menu has no such item and no feedback database is created.
  - The form takes an optional 1–5 star rating and a comment. Signed-in senders also get a "You can contact me about this" box, unticked by default, that names their account email. Their account is kept only if they tick it.
  - Answers are stored in a separate `feedback.sqlite` beside the other databases, or in the file `OMUL_FEEDBACK_DB` names. Only the rating, comment, screen kind, language, day and (when the box is ticked) the account are kept.
  - The routes are `GET /api/feedback/config` and `POST /api/feedback`, which accepts JSON only and allows 20 submissions per 10 minutes per client.
- Administrators (`OMUL_ADMIN_EMAILS`) read the feedback at `/app/admin/feedback`, with one tab per channel, totals, a count per rating and paging. When the sender asked to be contacted, the page shows their current account email, or that the account has been deleted. The same data is served at `GET /api/admin/feedback`.
- A share of participants can be asked what they think of omul when a session ends:
  - Set `OMUL_FEEDBACK_PROMPT_PERCENT` to a whole number from 1 to 100 to choose the share. It is off while unset. `OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS` (default 30) sets how long before a device is asked again. A malformed value of either stops the server at startup with an error naming the variable.
  - Only a device that was in the room before the deck ended can be asked. It sees a card on the ended screen, in omul's own look and the deck's language, and can answer or dismiss it.
  - Answers are anonymous: only the rating, comment, language and day are stored, never an account, participant or deck. They are sent to `POST /api/feedback/participant`, which allows 300 answers per 10 minutes per client so a whole room behind one network can answer.
- The home page tells a presenter who is not signed in that their presentations are stored only in this browser and are lost if its data is cleared. "Add email" opens the sign-in dialog on "Create account"; signing up or signing in attaches the presentations to the account and removes the notice. The notice can be closed, and the browser remembers that. It is not shown while signed in or to a browser that holds no presentation. In a browser that has been signed in to an account before, on any page with the account controls, the notice asks to sign in instead, and its "Sign in" opens the dialog on the sign-in tab. A browser signed in before this release and signed out before opening such a page is not recognised and is offered "Create account".
- A presentation made in a browser without an account now moves into the account when the presenter signs up or signs in: after signing out it is no longer listed or editable in that browser, and signing in again brings it back. A presentation that belongs to another account or a workspace and was opened through an edit link keeps its edit link access. Edit links already handed out keep working. A presentation created while signed in (blank, from a template, generated, imported or duplicated) belongs to the account from the start and is not kept in the browser at all, so it is never listed while signed out, even when the session ends on another page. For presentations that live in the account, the presenter screen offers no "Edit Link" from that browser; share them with another account instead.

### Changed

- The cards under "Your Presentations" on the home page show the title in full width on a line of its own, with the status beside it, then the code, slide count and date, then the five actions (share, move, export, duplicate, delete) in a row of their own. The actions are always visible instead of appearing only while the pointer is over the card, so they can also be found on a touch screen. The slide-count square at the left of the card is gone; the count is in the metadata line.
- The Light / Dark / Auto theme switch is now a small app menu, opened from a three-dot button in the same place on every page. It holds the theme choice and, when they are configured, the links to the imprint, privacy policy and terms. The menu also appears on the shared results page, on error screens and on the presenter's blanked screen, where there was no theme switch before.
- The storage library `@binaryplease/zodstore` is updated from 0.4.2 to 0.5.0, which brings its fixes to filtering on empty values and to how it checks a database file on open. The first start on an existing database renames the indexes that cover two fields to the library's new naming scheme. This needs no action and keeps every stored presentation, vote and question.
- In a fork with GitHub Actions enabled, the CLA check no longer runs, and the image build no longer pushes to the fork owner's container registry. The image is still built, so a broken Dockerfile still shows up. Pull requests from a fork to this repository are still checked for the CLA.
- The CLA check skips a pull request whose commits are all the copyright holder's own, verified commits. A pull request that mixes those with a contributor's commits is judged commit by commit, so the holder's commits are no longer reported as an unsigned contributor.

### Removed

- Dependabot version updates for the repository's GitHub Actions. The actions stay pinned to the same commits and versions, but nothing proposes updates for them any more; they are now updated by hand.

### Fixed

- Setting `OMUL_AUTH_DB=:memory:` or `OMUL_ADMIN_DB=:memory:` now gives an in-memory database, as it already did for `DATABASE_PATH`, instead of creating a file named `:memory:` in the working directory.
- A pull request from a fork no longer fails its build check. The check used to try to push the image with the pull request's read-only token, and the registry refused it.
- The image build workflow reads the branch name and commit of a pull request from environment variables instead of writing them into the shell script. A fork branch whose name contained shell syntax could otherwise have run commands on the build runner.
- `mise run check` and `mise run test` no longer fail when a tracked file has been deleted in a checkout but the deletion is not yet committed.
