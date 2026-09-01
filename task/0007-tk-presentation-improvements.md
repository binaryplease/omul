---
title: "TK-specific presentation UX improvements"
status: done
created: 2026-04-22
updated: 2026-04-23
priority: medium
tags: [ui, ux, slides, customer-tk]
---

# TK-specific presentation UX improvements

## Context

Customer-driven feature requests and bug fixes for the live presentation UX,
covering word cloud rendering, per-slide backgrounds, dark-mode contrast on the
welcome QR code, multi-question scale slides, scale presenter-view bugs, Q&A
layout, and (originally) PDF export of results — see deliverable 7 below, which
was implemented and then dropped; replacement tracked in issue #8.

## Deliverables

### 1. Word cloud renders as an actual cloud (not a horizontal list)

Currently `Results.tsx` lays word-cloud answers out horizontally and only scales
font size by frequency. A proper word cloud distributes terms in 2D around the
most frequent ones (all axes, with size proportional to count).

- [x] Replace the current horizontal flex layout in the word-cloud branch of
      `Results.tsx` with a 2D cloud layout (spiral / collision-avoiding
      placement around the centroid of the most frequent terms).
- [x] Keep the existing color/POLL_COLORS palette and font-size scaling logic.
- [x] Works in both presenter `ResultsDisplay` and participant preview contexts.
- [x] Avoid heavy dependencies if possible; small in-repo layout helper preferred
      over pulling in a full library.

### 2. Per-slide background image

Allow the creator to attach a background image per slide, displayed full-bleed
on presenter and participant views with a slight overlay/blur filter so text
remains readable.

- [x] Extend slide schema in `server/schemas.ts` (and corresponding
      `src/types.ts` mirror) with an optional `backgroundImage` field.
      Decide on storage strategy: URL only (simplest), or upload endpoint.
      Default to URL-only first iteration.
- [x] Editor UI in `CreatePage.tsx` to set/clear the background image URL per
      slide.
- [x] Render background full-bleed with overlay filter (e.g. dark scrim +
      slight blur) in `PresenterPage.tsx` and `ParticipantPage.tsx` /
      `ContentSlideView.tsx` so foreground text stays legible in both light
      and dark mode.
- [x] Persist + sync via existing PATCH route — no new endpoint needed.

### 3. Dark-mode QR code contrast on welcome slide

The QR code on the welcome (lobby) slide is hard to read in dark mode because
the contrast is low.

- [x] Inspect `src/components/ui/QRCode.tsx` and the welcome slide rendering in
      `PresenterPage.tsx`.
- [x] Ensure the QR code always renders on a high-contrast surface (e.g. force
      a white card/background behind it, regardless of theme), or invert the
      QR colors safely in dark mode without breaking scanability.

### 4. Multi-question scale slides (up to 5 statements per slide)

Today a scale slide asks one question; multiple questions require multiple
slides. Allow up to 5 statements per scale slide, each rated independently,
each with its own scale on the presenter view.

- [x] Schema: extend scale slide in `server/schemas.ts` with a `statements`
      array (id + text), max length 5. Keep backward compatibility with the
      single-question form (auto-migrate to a single-element `statements`).
- [x] Vote model already supports `statementId` (per AGENTS.md REQ029/REQ031);
      verify the `/vote` route accepts and stores per-statement votes
      correctly with the new shape.
- [x] Editor UI in `CreatePage.tsx`: add/remove statements (max 5), reorder.
- [x] Participant UI in `ParticipantPage.tsx`: render one scale row per
      statement, with skip support per statement.
- [x] Presenter results UI: one bar/scale per statement (see #5 below).

### 5. Scale slide presenter-view bug fixes

Currently the presenter view of a scale slide shows only the average as a
number (no bar) and the axis labels appear duplicated.

- [x] Render an actual bar/scale visualization showing the average position
      between the min and max labels (and ideally the distribution).
- [x] Fix the duplicated labels — render each label exactly once.
- [x] Ensure this works for both single-statement (legacy) and the new
      multi-statement scale slides from #4.

### 6. Q&A slide: card-based layout using full slide width

Today Q&A questions are a vertically scrolling list. Switch to a card grid
layout that uses the full slide width on both presenter and participant views
and remains vertically scrollable.

- [x] Update Q&A rendering (likely `Results.tsx` and/or a Q&A-specific block
      in `PresenterPage.tsx` / `ParticipantPage.tsx`) to use a responsive
      card grid (e.g. CSS grid `auto-fill minmax`).
- [x] Cards should accommodate varying question lengths gracefully and
      preserve upvote interaction (REQ025-style behavior already in `api.ts`).

### 7. PDF export of presentation results — DROPPED

**Status: removed from this task.** Implemented in commit `689b792` (in-browser
`jsPDF` + `html2canvas-pro` with a dedicated `/print/:id` route and
`PrintResultsPage`), then removed in commit `e8d7465` after TK review: the
output was cluttered, fought the theme, and did not match the polish of the
live presenter view. Both `jspdf` and `html2canvas-pro` have been uninstalled;
`PrintResultsPage`, the `/print/:id` route, and the print stylesheet block
have been removed.

Follow-up work — a proper, server-rendered, branded PDF report — is tracked
in **issue #8** ("Polished PDF report export of presentation results") and
will be handled in a separate task. No PDF export exists in the UI on this
branch.

Original scope (for historical context only):

- [x] ~~Decide on approach: client-side (e.g. `jsPDF` + `html2canvas` or browser
      print stylesheet) vs server-side (headless render).~~ Chose browser
      print stylesheet + in-browser jsPDF; both rejected — see issue #8.
- [x] ~~Add an "Export PDF" action in the presenter UI.~~ Added, then removed.
- [x] ~~Each PDF page = one slide's `ResultsDisplay`.~~ Implemented, then removed.
- [x] ~~Handle long content by paginating within a slide or scaling to fit.~~
      Moot — feature dropped.

## Out of scope

- Server-side image hosting / uploads (URL-only for #2 in this iteration).
- Real-time collaborative editing.
- New slide types beyond the existing set.

## Notes

- Touches both schema and UI; coordinate schema changes with existing tests
  in `server/p0.integration.test.ts`, `server/p1.integration.test.ts`, and
  `server/schemas.test.ts`. Add/extend tests where shape changes.
- Run `mise run lint` and `mise run test` before each push.
- Commit + push after each numbered deliverable; update `updated:` and the
  checkbox state in this file alongside the code change.

## Progress log

- 2026-04-22: Task created, worktree on branch
  `task/0007-tk-presentation-improvements`.
- 2026-04-23: All 7 deliverables implemented in a single pass.
  - Word-cloud now uses Archimedean-spiral layout with collision-avoiding
    bounding-box checks (no new deps).
  - Added optional `backgroundImage` to `SlideSchema`; new `<SlideBackground>`
    component renders full-bleed with blur + dark scrim. Editor exposes
    URL-only field for now.
  - Removed theme-aware QR colors (`QRCode.tsx`) — always renders black on
    white; callers wrap in white surface, fixing dark-mode contrast.
  - Capped `scaleStatements` at 5 in schema and editor ("+ Add statement"
    button disables at 5).
  - Replaced `ScaleDistributionBar` with new `ScaleAxisBar` (CSS-grid
    histogram + axis bar with average marker, single label row) — fixes
    missing bar and duplicated labels.
  - Q&A / open-text results now render as a responsive
    `auto-fill minmax(...)` card grid with vertical scroll; presenter and
    participant containers widened for open-text slides.
  - PDF export: new `/print/:id` route + `<PrintResultsPage>`; one page per
    slide via `@page` + `page-break-after`; "Export PDF" buttons on
    presenter UI for live and ended states. **(Later removed — see
    2026-04-23 drop-PDF entry below.)**
  - New unit tests in `server/p1.schemas.test.ts` cover the 5-statement
    cap and `backgroundImage` round-trip. All 65 unit tests pass.
  - Integration tests not run locally due to a pre-existing Bun cache /
    Elysia peer-dep resolution issue on the dev machine (also broken on
    `main`); CI will exercise them.
- 2026-04-23: Fix — participant-side word-cloud results were never shown
  (both live and click-to-reveal). The gating condition in
  `ParticipantPage.tsx` listed multiple-choice/quiz/open-text only, so
  word-cloud silently dropped through. Added `word-cloud` to the allowed
  types.
- 2026-04-23: Polish — slide background scrim is now theme-aware. Dark mode
  darkens (black gradient) as before; light mode whitens (white gradient)
  and pairs with dark title-overlay text for legibility. Moved scrim styles
  from inline JSX into `.slide-scrim` / `.slide-title-overlay` rules in
  `index.css` so they respond to `:root.light` / `:root.auto` + OS
  `prefers-color-scheme`.
- 2026-04-23: **Dropped PDF export (deliverable 7).** After TK review both
  the `/print/:id` print-stylesheet route and the in-browser
  `jsPDF` + `html2canvas-pro` renderer produced output that fought the
  theme and did not match the polish of the live presenter view. Removed
  `PrintResultsPage`, the `/print/:id` route entry, the print stylesheet
  block, and uninstalled `jspdf` + `html2canvas-pro`. Proper
  server-rendered PDF report tracked in issue #8; will be a separate task.
- 2026-04-23: Doc sync — updated deliverable 7 above to mark the feature as
  dropped, annotated the earlier "PDF export" progress-log entry, and
  removed the `export` tag from frontmatter. The PR description / UI may
  still have referenced PDF export; the feature does not exist in the UI
  on this branch.
