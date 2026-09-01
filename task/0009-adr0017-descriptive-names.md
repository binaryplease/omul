---
title: "ADR-0017 descriptive-naming pass (frontend + backend)"
status: planned
created: 2026-06-27
updated: 2026-06-27
priority: low
tags: [style, refactor, adr-0017, tech-debt]
review: required
---

# ADR-0017 descriptive-naming pass (frontend + backend)

## Context

Pervasive ADR-0017 ("descriptive names") debt: ~100+ single-letter and
acronym identifiers spread across ~12–14 files, spanning both the React
frontend and the Elysia backend. Recurring offenders: `(e) =>`,
`catch (e)`, `res`, `err`, `msg`, `idx`, `(s, i)`.

**Hotspots:**
- `src/pages/CreatePage.tsx` — by far the densest (~60+ short identifiers).
- `server/services/presentations.ts` — ~11 backend instances.
- ~10 other files carry a handful each (`(e) =>` handlers, `catch (e)`,
  `.map((s, i) => …)`).

Surfaced during an ADR triage pass ("ADR Tier 3 — Pervasive style
debt"). Triage decision: **defer to separate ADR-0005 task branches** rather
than fold into the Tier-1 correctness fix (where it would bury the
meaningful diff) or do it in one undifferentiated pass.

## Why deferred / why low priority

This is purely stylistic — zero behavioral benefit. The cost is real: a
high-churn, diffuse rename touches many files at once, inflating review
surface and risking merge conflicts with any in-flight feature work. It is
parked at `planned` (not `ready`) so a human schedules it deliberately,
ideally during a quiet window with no large feature branches outstanding.

## Approach

Mechanical, behavior-preserving renames only. No logic changes — a reviewer
should be able to confirm correctness by reading the diff as pure
substitution.

Recommended sequencing (one commit per file or per cohesive group, so each
diff stays reviewable):

1. **`src/pages/CreatePage.tsx` first** — the largest single concentration;
   landing it alone keeps the review tractable.
2. **`server/services/presentations.ts`** — the backend instances. Note the
   submitVote / getSlideResults decomposition is tracked separately in
   `task/0010-adr0010-decompose-vote-results`; if both tasks run, sequence
   them so the rename doesn't churn lines the decomposition will move
   anyway (do the decomposition first, then rename, OR rename inside each
   task as it touches the code — see "Coordination" below).
3. **Remaining files** — sweep the `(e) =>`, `catch (e)`, `(s, i)`,
   `res`/`err`/`msg`/`idx` occurrences file-by-file.

Per-rename guidance:
- `(e) =>` event handlers → name the event (`event`, `clickEvent`, etc.) or
  destructure what's used (`({ target }) =>`).
- `catch (e)` → `catch (error)`.
- `(s, i)` / array callbacks → name the element and index for the domain
  (`(slide, slideIndex)`, `(option, optionIndex)`).
- `res` → `response`, `err` → `error`, `msg` → `message`, `idx` → `index`
  (or a domain-specific index name).

## Coordination

- **Overlaps `task/0010-adr0010-decompose-vote-results`** on
  `server/services/presentations.ts`. To avoid double-churn and conflicts,
  do NOT run both concurrently on that file. Either land 0010 first then
  rename, or let 0010 apply ADR-0017 naming to the lines it already
  rewrites and scope this task to the *other* files. Decide at scheduling
  time.

## What this does NOT change

- No behavioral changes, no API/schema changes, no new dependencies.
- Does not decompose any functions (that is `task/0010`).
- Does not touch the pre-existing biome warnings called out in
  `AGENTS.md` (those are explicitly left alone unless asked).

## Acceptance

- [ ] `CreatePage.tsx` short identifiers renamed; diff is pure substitution.
- [ ] `server/services/presentations.ts` backend instances renamed
      (coordinated with `task/0010`).
- [ ] Remaining files swept for `(e)`/`catch (e)`/`(s, i)`/`res`/`err`/
      `msg`/`idx`.
- [ ] `bunx biome check --write src/ server/` clean (no new warnings beyond
      the pre-existing set in `AGENTS.md`).
- [ ] `mise run build` clean; `mise run test` green.

## Progress log

- 2026-06-27: Task file created (status `planned`) from that triage pass. Deferred-by-default; awaiting human scheduling.
