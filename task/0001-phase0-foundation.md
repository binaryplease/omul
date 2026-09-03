---
title: "Phase 0: Foundation restructuring"
status: done
created: 2026-04-17
updated: 2026-04-17
---

# Phase 0: Foundation restructuring

## Context

The previous session did a full assessment of omul against the project
conventions and the upcoming
requirements in `.data/`. The verdict: continue improving the existing codebase, but complete
a foundational restructuring before any feature work.

Key findings:
- `src/App.tsx` is a monolithic 2,200-line file — all pages, all UI components, routing all in one
- `server/store.ts` is a JSONL-backed in-memory store — fine for current MVP but cannot support
  any of the P1 features (upvotes, moderation, leaderboards, Q&A threading, segmentation)
- No AGENTS.md — the deviation from the default server framework (Hono instead
  of Elysia) is undocumented; no entry point for agents

## Approach

Minimal restructuring — no behavior changes. All three phases are pure refactoring or additive.

## Phases

### Phase 0.1: Split App.tsx
- [x] **0.1.1** Extract types → `src/types.ts`
- [x] **0.1.2** Extract constants → `src/constants.ts`
- [x] **0.1.3** Extract shared UI components → `src/components/ui/`
- [x] **0.1.4** Extract shared slide components → `src/components/`
- [x] **0.1.5** Extract pages → `src/pages/`
- [x] **0.1.6** Reduce App.tsx to thin router shell

### Phase 0.2: Replace JSONL store with bun:sqlite
- [x] **0.2.1** Create `server/db.ts` with schema, migrations, typed query functions
- [x] **0.2.2** Update `server/services/presentations.ts` to use SQLite
- [x] **0.2.3** Remove `server/store.ts` (no longer needed)

### Phase 0.4: AGENTS.md
- [x] **0.4.1** Create `AGENTS.md` documenting conventions, Hono deviation, SQLite choice

### Phase 0.3: Basic creator token auth (follow-up)
- [ ] **0.3.1** Add `creator_token` to presentations (SHA-256 hash stored, plaintext returned)
- [ ] **0.3.2** Protect mutation routes (PATCH/POST/DELETE) with Bearer token middleware
- [ ] **0.3.3** Update frontend `api.ts` to include token in requests
- [ ] **0.3.4** Update `listPresentations` to be token-scoped (not creatorId-based)

> Phase 0.3 is the next task after this one merges.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| SQLite driver | `bun:sqlite` (built-in) | Zero-dependency, excellent API, Bun-native |
| No Drizzle ORM yet | Raw SQL with typed wrappers | Simpler; Drizzle can be added when moving to PostgreSQL |
| Split destination | `src/pages/` + `src/components/` | Mirrors the default project structure for this stack |

## What this does NOT change

- No API changes — REST and WebSocket behavior is identical
- No data format changes — votes and presentations stored same way, just SQLite not JSONL
- No auth — creatorId still passed as query param (Phase 0.3 follow-up)
- No new features — purely structural

## Progress log

- 2026-04-17: Started Phase 0. Created task worktree, writing tracking file (correct location this time).
- 2026-04-17: Phase 0.1 complete — App.tsx split into 19 files; build verified.
- 2026-04-17: Phase 0.2 complete — server/store.ts replaced by bun:sqlite server/db.ts; build verified.
- 2026-04-17: Phase 0.4 complete — AGENTS.md written covering tech stack, API, WS events, lint notes, convention deviations.
