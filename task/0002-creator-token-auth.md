---
title: "Phase 0.3: Basic creator token auth"
status: done
created: 2026-04-17
updated: 2026-04-17
---

# Phase 0.3: Basic creator token auth

## Context

Phase 0 (foundation restructuring) is merged. The follow-up identified in
`task/0001-phase0-foundation.md` is to add minimal creator token auth so that
mutation routes (PATCH/DELETE/POST lifecycle actions) are protected.

Without this, anyone who knows a presentation ID can delete or modify it.
The current `creatorId` approach is a client-generated UUID — unverifiable by
the server and therefore not real access control.

## Approach

- On creation, generate a random token server-side, store its SHA-256 hash, return the
  plaintext token once in the creation response.
- Frontend stores tokens in a `Record<presentationId, token>` map in localStorage.
- Mutation routes require `Authorization: Bearer <token>`, verified by hashing and
  comparing to stored hash.
- `listPresentations` moves to the frontend: read IDs from the localStorage token map,
  fetch each presentation individually via `GET /api/presentations/:id`.
- `creatorId` is removed from `CreatePresentationSchema` and from the creation request body.
- Backward compat: presentations without a `creatorTokenHash` (pre-auth records) allow
  all mutations (they're in the same trust domain anyway).

## Phases

### Phase 0.3.1: Server — add token to presentations
- [x] **0.3.1.1** Add `hashToken()` helper in `server/services/presentations.ts`
- [x] **0.3.1.2** Update `createPresentation()` to generate token, store hash, return plaintext
- [x] **0.3.1.3** Add `verifyCreatorToken()` to services
- [x] **0.3.1.4** Remove `creatorId` from `CreatePresentationSchema`

### Phase 0.3.2: Server — protect mutation routes
- [x] **0.3.2.1** Add `requireToken` middleware in `server/routes/presentations.ts`
- [x] **0.3.2.2** Apply to PATCH, DELETE, POST /start, /end, /reset, /slide
- [x] **0.3.2.3** Add `sanitize()` helper to strip `creatorTokenHash` from responses

### Phase 0.3.3: Frontend — store and send tokens
- [x] **0.3.3.1** Add token map helpers in `src/api.ts` (`getTokenMap`, `setCreatorToken`, `getCreatorToken`, `authHeaders`)
- [x] **0.3.3.2** Update `createPresentation()` to store returned token
- [x] **0.3.3.3** Add `Authorization: Bearer` header to all mutation requests

### Phase 0.3.4: Frontend — token-scoped listing
- [x] **0.3.4.1** Rewrite `listPresentations()` to fetch from localStorage token map IDs
- [x] **0.3.4.2** Remove `getCreatorId()` and its `creatorId` usage from requests

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Token format | `crypto.randomUUID()` (128 bits) | Sufficient entropy for MVP creator identity |
| Hash algorithm | SHA-256 via `Bun.CryptoHasher` | Built-in, synchronous, no dependency |
| Hash exposure | Strip `creatorTokenHash` from all API responses | No reason for clients to see it |
| Listing strategy | Frontend fetches each owned ID via `Promise.all` | No new endpoint needed; N is small |
| Backward compat | Presentations without hash → mutations allowed | Pre-auth records share same trust domain |

## What this does NOT change

- Participant voting — still public, no auth needed
- Join by code — still public
- `GET /api/presentations/:id` — still public (presentations are shareable)
- `GET /api/presentations/:id/results` — still public
- `GET /api/join/:code` — still public
- `GET /api/presentations?creatorId=` — kept in server but no longer used by frontend

## Progress log

- 2026-04-17: Task worktree created, tracking file written.
- 2026-04-17: All phases complete (0.3.1–0.3.4). Server generates/hashes token on
  creation; mutation routes protected by `requireToken` middleware; frontend stores
  tokens in localStorage and sends `Authorization: Bearer` on all mutations;
  `listPresentations()` rewritten to fetch from token map IDs. Build verified clean
  (109 modules). AGENTS.md updated with auth model docs. PR opened.
