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
