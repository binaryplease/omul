---
title: "P1 Multiple Choice question-type settings"
status: done
created: 2026-07-28
updated: 2026-07-28
priority: high
tags: [p1, requirements, slide-types, multiple-choice]
---

# P1 Multiple Choice question-type settings

## Context

Direct sequel to `task/0005-slide-type-settings`, which gave Word Cloud,
Open Ended and Scales their settings pass. Multiple Choice (REQ009, done
since the MVP) was the last implemented question type whose settings
requirements were still `pending`.

The five entries are one vertical increment on an existing slide type, and
they establish the option/result patterns that the still-unbuilt question
types (Ranking, 2x2 Grid, 100 Points, Guess the Number, Pin on Image) will
reuse: a shared choice-tally shape, a shared selection-limit resolver, and
a results payload that separates *selections cast* from *people who
answered*.

Deliberately **not** in scope: quiz competition scoring, timers and
leaderboards (REQ054–REQ059), any new question type, results visibility
modes (REQ015–REQ018, restating the already-done REQ102), and per-option
image/GIF upload.

Use `bun scripts/triage.ts show REQ###` to read the full user story and
notes for each item.

## Todos

- [x] **REQ010** — Visualization type: `mcDisplayStyle` extended to bars /
      donut / pie / dots, with pie and donut sharing one stroked-circle
      renderer
- [x] **REQ011** — Absolute vs. percentage: authored `mcValueDisplay`
      default (count / percentage / both) plus a presenter-local live
      switch on the shared screen
- [x] **REQ012** — Options: verified add / remove / name in the running
      editor; closed with the visual-enrichment gap recorded
- [x] **REQ013** — Correct answers on plain multiple-choice slides, not
      just quiz — marked in the editor, revealed with the results
- [x] **REQ014** — Multiple options selectable: `mcMaxSelections`,
      server-enforced per-participant limit with toggle-to-deselect, and a
      results payload whose percentage denominator is the head count

## Decisions

- **Selection limit lives on the slide, resolved in one place.**
  `mcMaxSelections` is `null` by default; `maxSelectionsFor()` in
  `server/schemas.ts` falls back to the legacy `allowMultiple` flag, so
  slides authored before this task behave exactly as they did. The server,
  the participant UI, the aggregation and the editor all read that one
  function (ADR-0026).
- **Multi-select percentages divide by the head count.** With "all that
  apply", `totalVotes` (selections) and `respondentCount` (people) diverge.
  Options report `count / respondentCount` — "62% of the room picked this"
  — which is stable as participants tick more boxes; a share of selections
  would silently shrink every option. Shares then sum past 100%, so the
  presenter/participant surfaces print a footnote saying so, and pie/donut
  slice geometry divides by `totalVotes` so the disc still closes.
- **The presenter's count/percentage switch is local, not persisted.** It
  changes the shared screen for the room in front of you without
  re-authoring the deck; the slide's `mcValueDisplay` remains the default
  it starts from.
- **Unknown option ids are rejected.** Previously a bogus `value` simply
  went uncounted; on a capped multi-select it would burn a selection slot
  the participant can neither see nor clear.
- **Quiz slides stay single-answer.** REQ014 is about multiple choice;
  multi-answer quizzes belong with quiz scoring (REQ054–REQ059).

## Progress log

- 2026-07-28: Task created; REQ010–REQ014 clustered under it.
- 2026-07-28: Schema, server, client and tests landed in one slice —
  `mcDisplayStyle` extended plus `mcValueDisplay` / `mcMaxSelections` added
  (ADR-0029 defaults, legacy fallback); `maxSelectionsFor` /
  `isMultiSelect` / `slideHasCorrectAnswers` resolvers shared by both ends;
  a choice branch in `submitVote` enforcing the limit with
  toggle-to-deselect; `respondentCount` / `maxSelections` / MC `isCorrect`
  in the results payload; pie + donut renderers, shared value formatter and
  correct-answer mark in `Results.tsx`; editor controls for all four
  settings; multi-select participant UI with disabled-past-cap cards;
  presenter live value switch. 25 new tests
  (`server/mc-settings.schemas.test.ts`,
  `server/mc-settings.integration.test.ts`) plus editor-slice cases; 233
  tests pass. Verified end to end in the running app (editor, presenter,
  participant).
