---
title: "P1 slide-type settings — Word Cloud, Open Ended, Scales"
status: done
created: 2026-04-21
updated: 2026-04-22
priority: high
tags: [p1, requirements, slide-types]
---

# P1 slide-type settings — Word Cloud, Open Ended, Scales

## Context

Configurable settings for the core interactive slide types are the next MVP
gap after P0. These 8 P1 requirements from `docs/requirements/` round out
Word Cloud, Open Ended, and Scales so they behave the way an organizer
expects in a real presentation.

Scales was already a slide type — rather than introduce a new `scales`
(plural) type, we extended the existing `scale` type with an optional
`scaleStatements[]` array. Zero statements = legacy single-statement
scale (backward compatible); one or more statements = multi-statement
rendering.

Use `bun scripts/triage.ts show REQ###` to read the full user story and
notes for each item before implementing.

Implementation details are left to the executing agent — this file is a
simple todo/tracking list, not a design doc.

## Todos

- [x] **REQ022** — Word Cloud: configurable max answers per participant (1–5, Unlimited)
- [x] **REQ024** — Open Ended: choose result visualization (speech bubbles vs dynamic grid)
- [x] **REQ025** — Open Ended: allow participants to vote on submitted answers
- [x] **REQ026** — Multiple responses per participant for Word Cloud / Open Ended
- [x] **REQ029** — Scales: multiple statements on one scale (extended existing `scale` type)
- [x] **REQ030** — Scales: display average per statement in results
- [x] **REQ031** — Scales: make items skippable
- [x] **REQ032** — Scales: define scale values & labels (range, endpoints, intermediate labels)

## Workflow per item

1. `bun scripts/triage.ts show REQ###` → read story + source link
2. `bun scripts/triage.ts set REQ### --status in-progress`
3. Implement (types, API, server, UI as needed)
4. Commit with message `task/0005-slide-type-settings: REQ### <summary>`
5. `bun scripts/triage.ts set REQ### --status done`
6. Check the box above, bump `updated`, push

## Progress log

- 2026-04-21: Task created. 8 P1 REQs clustered under this task, status `planned`.
- 2026-04-22: Server + API foundation for all 8 REQs (b4309a6) — schema
  extensions (`scaleStatements`, `scaleLabels`, `scaleAllowSkip`,
  `maxResponses`, `openTextLayout`, `allowResponseVotes`, vote
  `statementId`+`skip`), new `responseVotes` store, rewritten
  `submitVote` branches, new `voteOnResponse()` service + route,
  rewritten `getSlideResults` for per-statement scale aggregation and
  upvote-aware open-text responses.
- 2026-04-22: Client UI for all 8 REQs (a04a92c) — editor controls in
  CreatePage, participant voting UI (per-statement submit/skip,
  maxResponses cap, upvote toggle), results display (speech-bubbles vs
  grid layout, per-response upvotes, per-statement scale cards,
  intermediate label support). All 43 tests pass. Task complete.
