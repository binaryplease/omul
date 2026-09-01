---
title: "Wire up binp-docstore as the storage solution"
status: done
created: 2026-07-10
updated: 2026-07-10
priority: high
---

# Wire up binp-docstore as the storage solution

## Context
Storage was MongoDB (via the `mongodb` driver), reached through the async
`Store` seam in `server/db.ts` that task/0003 introduced. binp-docstore — a
native `bun:sqlite` + Zod document store (github.com/binaryplease/binp-docstore)
— replaces it: in-process, no external database service, Zod-gated on every read
and write (ADR-0013), forward-compatible via field defaults (ADR-0029).

## Approach
- Consume docstore behind the existing `Store` seam so the service/route layer
  is unchanged. `createStore(name, schema, { indexes })` now wraps one docstore
  collection; methods stay async even though docstore is synchronous.
- Vendor docstore at `vendor/binp-docstore` and depend on it as
  `file:./vendor/binp-docstore` (mirrors the `tools/inspector` pattern). This
  keeps the private library inside the single-repo Docker build context and
  makes it resolve omul's Zod (v3) instead of its own peer (v4).
- Define `Stored*` schemas in `server/schemas.ts` (ADR-0013/0029) — distinct
  from the API schemas because stored docs carry `id`, timestamps, and the
  creator-token hash.

## Changes
- `vendor/binp-docstore/` — vendored library source (sync from upstream to update).
- `server/db.ts` — rewritten over docstore; `$DATABASE_PATH` (default
  `data/omul.sqlite`, `:memory:` for ephemeral); parent dir created on start.
- `server/schemas.ts` — `StoredPresentationSchema`, `StoredVoteSchema`,
  `StoredResponseVoteSchema`.
- `server/services/presentations.ts` — pass schemas + indexes to `createStore`.
- `server/{p0,p1,ws}.integration.test.ts` — run against an in-memory store
  (no Mongo probe / skip; the shared singleton is torn down at process exit).
- `package.json`, `.mise.toml`, `flake.nix`, `Dockerfile`, `.dockerignore` —
  drop MongoDB (dep, env vars, dev docker-compose), add docstore + `DATABASE_PATH`.
- Removed `docker-compose-dev.yaml` (was MongoDB-only for local dev).

## Verification
- `bunx tsc --noEmit` — clean (one pre-existing `schemas.test.ts` error unrelated).
- `bun test` — 143 pass / 0 fail (the 3 integration suites now run instead of skip).
- Production bundle boots on docstore; drove `POST /presentations` → `start` →
  `vote` → `results/:slideId` over HTTP, confirmed data persists across a restart
  and the creator-token hash never leaks (ADR-0024 `sanitize`).

## Progress log
- 2026-07-10: Completed migration and end-to-end verification.
