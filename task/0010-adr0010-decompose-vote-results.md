---
title: "ADR-0010 decompose submitVote / getSlideResults"
status: planned
created: 2026-06-27
updated: 2026-06-27
priority: low
tags: [refactor, adr-0010, tech-debt, voting]
review: required
---

# ADR-0010 decompose submitVote / getSlideResults

## Context

Two ADR-0010 ("one function, one thing") offenders, both in
`server/services/presentations.ts`:

- **`submitVote`** (lines ~217–398, ~182 lines): interleaves input
  validation, per-slide-type vote logic, persistence, and the
  results-broadcast. The results-broadcast block (fetch
  `getSlideResults` → broadcast `results.updated`) is copy-pasted ~8 times
  through the function's branches.
- **`getSlideResults`** (lines ~458–612, ~155 lines): fetches votes and
  aggregates every slide type inline in one long body.

Surfaced during an ADR triage pass ("ADR Tier 3 — Pervasive style
debt"). Triage decision: **defer to separate ADR-0005 task branches**, NOT
bundle into the Tier-1 correctness fix.

## Why deferred / why low priority + extra caution

`submitVote` is the **live-voting hot path**. A behavior-preserving
decomposition delivers no user-visible benefit and carries real regression
risk on the path that matters most. Parked at `planned` so a human
schedules it deliberately and a reviewer can scrutinize it in isolation
(not buried under unrelated changes).

Because this is the live-vote path, the bar is higher than a normal
refactor: the change MUST be behavior-preserving and MUST be covered by
tests that exercise each slide type's vote + result aggregation before and
after.

## Approach

Behavior-preserving extraction. No functional changes.

`submitVote`:
- Extract the repeated results-broadcast into one helper
  (e.g. `broadcastSlideResults(presentationId, slideId)` that fetches via
  `getSlideResults` and emits `results.updated`) and call it at each branch
  exit. This alone removes the ~8× duplication.
- Split validation, per-type vote handling, and persistence into named
  helpers so the top-level `submitVote` reads as a short orchestrator.

`getSlideResults`:
- Extract per-slide-type aggregation into named helpers (one per slide
  type) and have `getSlideResults` dispatch to them. Keep the public
  signature and return shape identical.

Keep the exported signatures of `submitVote` and `getSlideResults`
unchanged — callers (routes, the results endpoints, and the internal
`getSlideResults` calls within `submitVote`) must not need edits.

## Coordination

- **Overlaps `task/0009-adr0017-descriptive-names`** on this same file. Do
  not run both concurrently on `server/services/presentations.ts`. Prefer
  landing this decomposition first (it moves/rewrites the lines), then let
  the naming pass clean what remains — or apply ADR-0017 naming to the new
  helpers as they are written here. Decide at scheduling time.

## What this does NOT change

- No change to vote semantics, result shapes, WS event payloads, REST
  endpoints, or schemas.
- No change to the live-mode / survey-mode gating, `statementId`/`skip`
  multi-statement handling, or response-vote toggling.
- Exported function signatures stay identical.

## Acceptance

- [ ] Results-broadcast duplication in `submitVote` collapsed to one helper.
- [ ] `submitVote` top-level body reads as a short orchestrator over named
      helpers.
- [ ] `getSlideResults` dispatches to per-type aggregation helpers; return
      shape byte-for-byte identical.
- [ ] Tests cover vote + result aggregation for every slide type; green
      before and after.
- [ ] `bunx biome check --write server/` clean (no new warnings).
- [ ] `mise run build` clean; `mise run test` green.

## Progress log

- 2026-06-27: Task file created (status `planned`) from that triage pass. Deferred-by-default; awaiting human scheduling.
