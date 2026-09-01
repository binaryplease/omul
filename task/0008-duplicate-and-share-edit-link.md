---
title: "Duplicate presentation + dedicated share-edit link"
status: done
created: 2026-05-22
updated: 2026-05-22
priority: medium
tags: [ui, ux, sharing]
---

# Duplicate presentation + dedicated share-edit link

## Context

Two small UX additions requested by the user:

1. **Duplicate a presentation** — clone an existing presentation (title +
   slides + language + mode) into a fresh draft so creators can reuse a
   structure without rebuilding it.
2. **Dedicated share link with edit permissions** — generate a URL that
   transfers the creator token to a recipient so they can edit the
   presentation. Currently the creator token lives only in the original
   browser's `localStorage`; there is no way to grant edit access to a
   teammate without copy/pasting tokens manually.

## Approach

### Duplicate

Pure client-side: fetch the source presentation via the existing public
`GET /api/presentations/:id`, regenerate IDs for slides and option/statement
sub-items (so the copy is fully independent), and call the existing
`POST /api/presentations` with title suffixed " (copy)". The server returns
a fresh `creatorToken` for the duplicate, which is automatically stored by
`createPresentation()` in `src/api.ts`. No new endpoint needed.

### Share-edit link

Use a URL fragment to carry the creator token to the recipient:

```
${origin}/edit/${id}#share=<plaintext-creator-token>
```

The fragment is never sent to the server (so it does not appear in HTTP
logs / Caddy access logs), but is readable by the receiving browser. On
app boot, if the path is `/edit/:id` and a `share=` fragment is present,
the token is written into the same `omul-tokens` localStorage map used
by the original creator and the fragment is stripped from the URL. The
recipient then has full edit/delete/start/end authority because the
creator token grants all mutations.

Anyone with the link has full control — this is intentional and matches
how the creator's own browser holds the token. The dedicated share button
lives next to the existing copy-join-code / copy-link / QR / embed
cluster on the PresenterPage header.

## Phases

### Phase 1: Duplicate
- [x] **1.1** Add `duplicatePresentation(id)` in `src/api.ts` (fetch
      source, regenerate IDs, create new presentation).
- [x] **1.2** Add duplicate icon button to each presentation card on
      `HomePage.tsx`, with toast + redirect to the duplicate's edit page.

### Phase 2: Share-edit link
- [x] **2.1** Export `acceptShareToken()` from `src/api.ts` (thin wrapper
      over `setCreatorToken()`) so the boot handler can persist a token
      received via the fragment.
- [x] **2.2** Detect `#share=<token>` on `/edit/:id` boot in `App.tsx`
      (before the first render), persist the token, strip the fragment
      from the URL.
- [x] **2.3** Add a "Copy edit link" button to the PresenterPage share
      cluster (both the wide xl cluster and the narrow row), with a
      confirmation modal warning that anyone with the link can edit.
      Gated by `getCreatorToken(id)` — only shown when the current
      browser actually holds the token.

### Phase 3: Polish + ship
- [x] **3.1** `bunx biome check --write src/` (no new lint errors
      introduced — pre-existing `noExplicitAny` in `src/api.ts` and the
      pre-existing `useExhaustiveDependencies` / `noUselessFragments` in
      `PresenterPage.tsx` per `AGENTS.md`).
- [x] **3.2** `bunx vite build` confirms clean build.
- [x] **3.3** Two commits (one per phase), push, open PR.

## What this does NOT change

- No new server endpoints or schemas.
- No multi-user / multi-token model — the duplicate gets one creator
  token (same as any newly created presentation); the share link
  re-shares the existing creator token rather than minting a separate
  "editor" token.
- No expiry / revocation of shared tokens (out of scope for MVP).

## Progress log

- 2026-05-22: Task branch + tracking file created.
- 2026-05-22: Phase 1 (duplicate) committed — `api.duplicatePresentation`
  + HomePage duplicate icon. ID regeneration covers slides + nested
  options + scaleStatements so the copy is fully decoupled from the
  source.
- 2026-05-22: Phase 2 (share-edit link) committed —
  `consumeShareTokenFromUrl()` in `App.tsx` runs at module load, before
  React mounts, to persist any `#share=<token>` fragment and strip it
  from the URL. PresenterPage share cluster now includes a "Copy edit
  link" button gated by token possession with a confirmation modal.
  `bunx vite build` clean; biome check shows only pre-existing
  warnings.
- 2026-05-22: Follow-up fix — `/present/:id` URL was showing all
  edit/lifecycle controls (Edit, Start, End, Reset, Restart, slide
  nav, results-reveal) to non-owners. Mutation calls returned 401, but
  the UI suggested edit power, and the Edit button let strangers
  navigate to `/edit/:id` and modify form fields locally. Gated all
  PresenterPage controls behind `getCreatorToken(id)` and added a small
  "View only" badge for non-owners. `CreatePage` in edit mode now
  redirects immediately to `/present/:id` when no token is held, so
  non-owners can't even see the editor scaffolding. Server-side auth
  was already correct (verified via curl on prod: 401 with no token
  and 401 with wrong token).
