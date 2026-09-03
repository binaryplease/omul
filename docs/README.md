# Requirements

The authoritative catalog of **source-code requirements** lives in
[`requirements/`](requirements/) — **one frontmatter markdown file per
requirement**, `REQxxx.md`, triaged in place. A requirement here says what the
code must do, and nothing about what the business wants or why.

- **[Requirements.md](Requirements.md)** — the generated index of that
  directory: one row per REQ with its summary, category, priority, status and
  the business requirement it derives from.
- **This file** — the file format and how to edit it.

## Two catalogs: BR derives SCR

The *why* lives in a **private documentation sidecar**, a separate repository
that is not published, as business requirements `BRxxx`: user stories, target
users, plan and packaging decisions, competitive provenance. This repository is
headed for publication, so none of that can live here.

Business requirements derive source-code requirements, and each SCR states the
ones it answers in its `source` field.

**A BR reference is an opaque identifier and nothing more.** Write the bare
number. No BR titles, no summaries of what a BR says, no links into the private
repository — a reference that quotes its target has carried the target across,
which is the one thing this split exists to prevent.

**The two numbering lines are independent**. `REQ042` and `BR042`
sharing a number means nothing; 142 pairs match today because the two catalogs
were seeded together, which is history rather than a rule. One BR is answered by
as many SCRs as the code owes separable contracts — each taking this catalog's
next free number, all citing the same `source` — and one SCR may cite several
BRs. Nothing here is ever renumbered to line up with something over there.

**These `source:` lines are the authoritative copy of the BR → REQ edge.**
"Which SCRs answer BR042?" is a query over this tree:

```bash
grep -lE '^source:.*\bBR042\b' docs/requirements/*.md
```

The sidecar mirrors the edge from its side — each BR carries a `derived:` list
of the SCRs that answer it — but that mirror is reconciled against these lines,
never the other way round, and nothing in this repository reads it. When a
change here creates or retires an SCR citing a BR and the sidecar is in scope
for the task, the BR's `derived:` list is updated in the same change; when it
is not in scope, the mirror is reconciled on the sidecar side.

You do **not** need the sidecar to work here, and you are not expected to have
it. That is the point: an SCR is self-contained, so an engineer or an autonomous
agent can pick it up with this repository alone. If an SCR only makes sense once
you have read its BR, the SCR is underspecified — fix the SCR.

Browse and edit them with `mise run triage -- <cmd>` (see
`bun scripts/triage.ts help`), or open the files directly — they are plain
markdown and hand-editing is fine.

## File format

```markdown
---
id: REQ001
summary: Create an empty presentation
category: Deck & Slides
priority: P0
source: BR001
status: done
tags:
  - p1
updated: "2026-04-21"
---

## Description

A create call persists a new presentation document …

## Notes

Constraint: …

## Triage note

Already implemented in MVP; verified via code inspection

## Updates

- 2026-04-21 — Implemented behind the reveal endpoint.
```

Those four are the **only** permitted sections, and the keys above the **only**
permitted frontmatter fields — any other `## ` heading or key is a hard parse
error, so nothing can be silently dropped when a file is rewritten.

**Catalog fields** describe what has to be built: `summary`, `category`,
`priority`, `source`, and the `## Description` and `## Notes` sections. Optional
ones are omitted rather than written as `null`.

`source` is a **closed vocabulary**, enforced by the parser:

| Value | Meaning |
|---|---|
| `BR042` | derives from that business requirement in the sidecar |
| `BR042, BR116` | derives from several |
| `internal` | no BR behind it — a defect, a performance ceiling or a hardening this codebase raised itself |

It deliberately cannot hold a URL. A requirement points at the BR that derives
it, and provenance is recorded there, in the sidecar; a field that cannot
express a URL keeps that boundary from being crossed by hand. There is no `plan`
field and no `screenshot` field either — plan and tier are pricing decisions and
belong on the BR, and a screenshot of another product is the one kind of copying
that would be a real problem in a public repository.

Business prose does not belong in an SCR. If a requirement cannot be understood
without a price, a tier or a competitor's behaviour, it is a BR and that detail
stays in the sidecar.

**Triage fields** describe how *we* are handling it and are what
`scripts/triage.ts` writes: `status`, `tags`, `updated`, and the
`## Triage note` section.

**`## Updates`** is the requirement's append-only work log — one dated bullet
per change, newest last, written by `triage log`. Add entries, never rewrite or
delete them. It is distinct from `## Triage note`, which holds only the current
rationale and is overwritten by `set --note`. Whenever you work on something a
requirement covers, move its `status` and append an entry here; see the
"How work is tracked here" section of the repo's `AGENTS.md`.

`id` must match the filename. `status` is omul's own state set, defined by
`VALID_STATUSES` in `scripts/requirements.ts` and enforced by `validate`:
`pending`, `planned`, `ready`, `in-progress`, `done`, `blocked`, `cancelled`,
`deferred`, `rejected`. Every file starts at `pending`; a requirement counts as
**untriaged** (`triage list --untriaged`) while it still has status `pending`,
no tags and no triage note.

The catalog does not record which branch a requirement's work landed on — that
is git's to answer. The commit that closes a requirement is the implementation
commit, and the merge commit names the branch.

Which git, though, depends on when: this repository's history begins at a
clean-slate snapshot, and anything closed before it is not answered by `git log`
here at all. Update-log entries below that snapshot name commits and branches
this repository does not contain — they point at history that was not carried
over, not at nothing. See "History begins at the clean-slate snapshot" in the
repo's `AGENTS.md`.

Body sections are delimited by `## ` headings, so requirement prose must not
contain a line starting with `## `.

## Editing

```bash
# Discover candidates for a batch of work
bun scripts/triage.ts list --category Quiz --priority P0 --untriaged

# Plan them as a batch
bun scripts/triage.ts set REQ010 REQ011 REQ012 --status planned --tag quiz

# Append a dated entry to a requirement's work log
bun scripts/triage.ts log REQ010 --message "Scoring implemented; timer still open"

# Status, priority and category breakdowns
bun scripts/triage.ts stats

# Check every file still parses (also useful after hand-editing)
bun scripts/triage.ts validate

# Regenerate Requirements.md after triaging
mise run requirements:index
```

## The index

`requirements/` is a **declared knowledge directory**: its
listing lives in the sibling [`Requirements.md`](Requirements.md), named for the
directory and sitting beside it rather than inside it, so
`ls -p requirements/ | grep -v /` and the row count are the same number — a
check anyone can run without trusting the generator.

That file is **generated** by the shared `index` CLI (`index build
docs/requirements`, wrapped as `mise run requirements:index`) and never edited
by hand between its markers; prose above them is ours to write. There is no
repo-local generator — exactly one implementation of it may exist — and **no
second listing of `requirements/` exists anywhere else**, whatever it might be
called. Aggregates are not kept in a file either: `triage stats` computes them
on demand, so they cannot go stale.

`requirements/` holds nothing but the `REQxxx.md` files; `validate` fails on
anything else in there. `mise run check` runs `validate` plus `index check
docs/requirements`, which names the directory rather than sweeping — a bare
sweep only visits directories that still have an index file, so a *deleted*
index would pass unnoticed.

**`index` is not vendored here, it is not on npm, and `mise install` does not
fetch it.** It has to be on `PATH` already; because exactly one implementation
of it may exist, there is deliberately no repo-local fallback. Without it on
`PATH`, `mise run requirements:index` and the `index check` step of
`mise run check` fail with `index: command not found` (exit 127) — the catalog
itself is unaffected, and `bun scripts/triage.ts validate` still checks every
file. When you cannot regenerate it, leave `Requirements.md` as it stands rather
than hand-editing it, and say so in the change.

The parser and writer live in `scripts/requirements.ts`; `scripts/triage.ts` is
the triage CLI.
