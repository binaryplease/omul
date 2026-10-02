# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  - Each one that is set appears as a link in a footer under every page.
  - The terms and the privacy policy are also named, with links, before a visitor signs up, creates a presentation (from the editor, a template or a generated draft), or joins one with a code, a link or the QR code.
  - Nothing is shown while the variables are unset.
  - The configured links are served at `GET /api/legal`.
- Q&A questions can be held for approval before the audience sees them:
  - Presenters turn this on in the Q&A panel with "Approve questions first". It is off by default.
  - While it is on, a new question is visible only to people who can edit the presentation, and nobody else can upvote it until it is approved.
  - The panel shows a pending count, marks waiting questions "Awaiting approval", and lets the presenter approve each one.
- Presenters can hide the join bar on the presenter screen and show it again. The choice is saved with the presentation and followed by every open presenter screen. Hiding the bar does not change who can join.
- A workspace owner can choose a default theme for the workspace. A presentation created in the workspace starts with that theme unless another theme is chosen, and each presentation can still change its own.
- The presenter screen shows how long the session has been running. The clock stops when the session ends, survives a page reload, and is cleared by a reset.

### Changed

- The storage library `@binaryplease/zodstore` is updated from 0.4.2 to 0.5.0, which brings its fixes to filtering on empty values and to how it checks a database file on open. The first start on an existing database renames the indexes that cover two fields to the library's new naming scheme. This needs no action and keeps every stored presentation, vote and question.
