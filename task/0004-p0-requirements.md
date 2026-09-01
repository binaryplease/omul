---
title: "P0 requirements — remaining MVP gaps"
status: done
created: 2026-04-21
updated: 2026-04-21
priority: high
tags: [p0, requirements]
---

# P0 requirements — remaining MVP gaps

## Context

`docs/requirements/` lists 21 P0 requirements. Of these, 12 are already implemented
in the current MVP (multi-choice, word cloud, open Q&A, quiz type, create/edit deck,
add slide, QR code modal, presenter pace, results page, keyboard shortcuts, direct
join link). They have been marked `done` in their requirement files.

This task covers the remaining **9 P0 requirements** that are not yet implemented.
Use `bun scripts/triage.ts show REQ###` to read the full user story and notes for
each item before implementing.

Implementation details are left to the executing agent — this file is a simple
todo/tracking list, not a design doc.

## Todos

- [x] **REQ003** — Create new survey (async survey mode distinct from live presentation)
- [x] **REQ062** — Text Slide (content slide type, no interaction)
- [x] **REQ063** — Image Slide (content slide type with image)
- [x] **REQ065** — Instruction Slide (content slide type with how-to-join guidance)
- [x] **REQ069** — Add images & GIFs to slides (media attachment on any slide)
- [x] **REQ082** — Survey Mode / Audience Pace (participants navigate at their own pace)
- [x] **REQ084** — Presentation language (language setting per deck)
- [x] **REQ102** — Hide / Show Results (Instant, On Click, Private)
- [x] **REQ118** — Instruction slide with code + QR (auto-generated join slide)

## Workflow per item

1. `bun scripts/triage.ts show REQ###` → read story + source link
2. `bun scripts/triage.ts set REQ### --status in-progress`
3. Implement (types, API, server, UI as needed)
4. Commit with message `task/0004-p0-requirements: REQ### <summary>`
5. `bun scripts/triage.ts set REQ### --status done`
6. Check the box above, bump `updated`, push

## Progress log

- 2026-04-21: Task created. Triage done for the 21 P0 reqs — 12 marked `done` (already
  implemented), 9 marked `ready` and linked to this task.
- 2026-04-21: Added schema + types foundation for new slide types, media fields,
  resultsVisibility, presentation language and mode (6d220cc).
- 2026-04-21: REQ062/REQ063/REQ065/REQ118 — implemented text, image and instruction
  content slide types with shared ContentSlideView component (469df31).
- 2026-04-21: REQ069 — image/GIF media attachments on interactive slides
  (URL-based; presenter, participant, preview) (85c7bf0).
- 2026-04-21: REQ102 — Hide/Show Results: per-slide visibility
  (instant/on-click/private), reveal endpoint, slide.revealed WS event,
  presenter reveal/hide buttons, participant-side gating (5203a58).
- 2026-04-21: REQ084 — Presentation language: CreatePage language select
  (en/de/fr/es/it/pt/nl), i18n dictionary module, ParticipantPage localized
  strings (53c1897).
- 2026-04-21: REQ082/REQ003 — Survey mode (audience pace): CreatePage pace
  selector, service accepts language/mode on create, submitVote accepts votes
  at any non-ended status in survey mode, ParticipantPage self-navigation with
  prev/next buttons and slide counter, ignores presenter's slide.changed in
  survey mode (4d3909f).
- 2026-04-21: All 9 P0 requirements complete. Task closed.
