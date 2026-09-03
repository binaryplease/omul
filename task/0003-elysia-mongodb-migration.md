---
title: "Migrate to Elysia + MongoDB, remove SA.md"
status: done
created: 2026-04-20
updated: 2026-04-20
priority: high
---

# Migrate to Elysia + MongoDB

## Context
omul deviated from the default server framework by using Hono instead of Elysia (for WebSocket support).
Elysia now has built-in WebSocket with pub/sub. Also migrating from bun:sqlite to MongoDB
for a more scalable foundation, and removing SA.md to keep only feature-focused documentation.

## Approach
- Replace Hono with Elysia for all routes and WebSocket handling
- Replace bun:sqlite Store with MongoDB collections
- Remove SA.md, update AGENTS.md to reflect new stack
- Keep all existing API endpoints and WebSocket events unchanged

## Phases

### Phase 1: Server framework + DB migration
- [x] **1.1** Replace Hono with Elysia in server/index.ts
- [x] **1.2** Rewrite server/db.ts as MongoDB connection + store factory
- [x] **1.3** Rewrite server/routes/presentations.ts for Elysia
- [x] **1.4** Rewrite server/ws.ts for Elysia WebSocket
- [x] **1.5** Update server/services/presentations.ts for async MongoDB ops
- [x] **1.6** Update package.json dependencies

### Phase 2: Cleanup
- [x] **2.1** Remove SA.md
- [x] **2.2** Update AGENTS.md
- [x] **2.3** Update flake.nix (MongoDB env vars, NixOS module, npmDepsHash)
- [x] **2.4** Verify build works (bun build + nix build both pass)
- [x] **2.5** Update README.md for new stack

## Progress log
- 2026-04-20: Started migration
- 2026-04-20: Completed all phases. bun build and nix build verified. Server loads cleanly (hangs on MongoDB connect when no DB available, as expected).
