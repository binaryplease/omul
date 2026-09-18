---
name: omul
description: Create a live audience presentation on an omul server — polls, word clouds, quizzes, scales, Q&A — and read its results, with the `omul` command-line client. Use when asked to build or script a deck, set up a poll or quiz for a meeting, workshop or class, pull the tallies out of a room that has run, or wire audience interaction into a pipeline.
license: AGPL-3.0-only OR LicenseRef-omul-Commercial
---

# Drive omul from the command line

omul is a self-hosted live audience interaction server: a presenter shows a
deck, the room answers on their phones, the tallies come back. `omul` is its
command-line client, and it does the round trip you are most likely to be asked
for — create a deck, read what the room answered — with no browser step and, for
a deck you create yourself, no credential at all.

```sh
omul --server https://omul.example.com create --template retrospective --title "Sprint 42" --json
# → {"id": "…", "code": "…", …}  — keep the id; the code is what the room types
omul --server https://omul.example.com results <id> --json
```

Everything below assumes you replace `<id>` with the id that create printed.

## Get the command

Run `omul help` first — if it answers, you have it. If it is not on PATH:

- `nix run github:binaryplease/omul#omul -- help` — no checkout needed. Use
  `nix run github:binaryplease/omul#omul -- <command>` wherever this document
  writes `omul <command>`.
- Or clone the repository and run `bun link` in it, which puts `omul` on PATH.

## Point it at a server

Every command takes `--server URL`; `OMUL_SERVER_URL` in the environment says
the same thing once. The default is `http://localhost:3000`, which is a dev
server on the same machine.

Ask which server you are working against rather than guessing one — omul is
self-hosted, so there is no single public instance. `omul health` proves the
server is there and prints what it advertises.

## Credentials — read this before you touch a key

There are two secrets, they are not interchangeable, and each has a rule.

**A personal API key** is an account credential. You need it only for
`omul list` and for working on decks an account already owns. There is
deliberately **no `--api-key` flag**: argv is readable by other processes and is
written to shell history verbatim.

- Never ask anyone to paste a key into a command you run, and never put one in a
  command line, a script you write, or a file you create.
- If a command needs a key and none is configured, stop and ask the person to
  configure it themselves — by exporting `OMUL_API_KEY` in the environment you
  run in, or by running `omul auth login`, which prompts for the key without
  echoing it. The key is minted in the web UI's account settings.
- Never print a key, and never read one back out of the config file.

**A deck's edit token** is what authorizes a deck created without an account.
The server returns it **exactly once**, in the create — there is no way to fetch
it again. The client writes it to `~/.local/share/omul/edit-tokens.json` (mode
`0600`) and never prints it, not even under `--json`.

- That file is the only copy. Do not delete it, do not move it, and do not
  hand it to anything.
- It is what lets you read a deck you created anonymously in full, so a deck
  created this way is editable and fully readable from this machine only.

`omul auth status` reports what is configured and where it came from, printing
neither secret. It is the right first command when you are unsure.

## Create a deck

From a built-in template — `omul templates` lists the ids:

```sh
omul create --template retrospective --title "Sprint 42" --json
```

From your own deck document:

```sh
omul create --deck deck.json --json     # `--deck -` reads it from standard input
```

```json
{
	"title": "Sprint retro",
	"slides": [
		{
			"type": "multiple-choice",
			"question": "How did the sprint go?",
			"options": [{ "text": "Great" }, { "text": "Rough" }]
		},
		{ "type": "word-cloud", "question": "One word for it?" }
	]
}
```

You do not have to invent ids: a slide, and each option or item it offers, is
given one where it carries none. Nothing else is filled in for you — an unknown
slide type, a missing question or a value past a limit comes back as the
server's own refusal, which is the message to quote.

The slide types are `multiple-choice`, `word-cloud`, `open-text`, `scale`,
`ranking`, `grid`, `points`, `guess-number`, `pin-image`, `quiz`, `form` and
`leaderboard`, plus the content slides `text`, `image`, `video`, `embed` and
`instruction`. **To get an unfamiliar type's exact shape, read a real one rather
than guessing**: `omul templates --json` prints the built-in decks with their
slides — the retrospective carries a scale slide, the quiz round carries quiz
slides and a leaderboard, the prioritization workshop carries points, grid and
ranking slides. Copy the shape from there.

Options worth knowing, on the command line:

- `--title TEXT` names the deck (and overrides the title in `--deck`).
- `--language de` sets what the participants' screens speak; the default is
  `en`.
- `--mode survey` lets the audience move through the deck at their own pace;
  the default, `live`, is paced by the presenter.

And in the deck document, `"resultsVisibility"` decides when a tally reaches the
room: `"instant"` (the default) publishes each one as answers land, `"on-click"`
holds it until the presenter reveals that slide, and `"private"` never shows it
to the room while you go on reading it in full. `"qaEnabled": true` opens the
Q&A layer, `"requireParticipantName": true` asks the room who they are.

**Keep the `id` from the create output.** It names the deck in every later
command, and without an API key there is no `omul list` to recover it from.

## Read the deck and its results

```sh
omul show <id> --json       # title, status, join code, slides, participant count
omul results <id> --json    # the aggregated tally for every slide
```

`--json` prints the server's payload as it arrived — per-option counts,
word-cloud words, scale statistics, quiz scoring — and is what you want when you
are going to parse it. Without it each command prints a summary for a person,
one line per slide, with `(none)` where the server reported nothing.

**A slide that reads `"withheld": true` is not an empty room.** It means this
caller is not being shown that tally: the deck's results visibility is
`private`, or it is `on-click` and the presenter has not revealed that slide.
You read every tally on a deck you created (its edit token is in the local
store) and on one your API key owns; on somebody else's deck you read what the
room reads.

## Running the session itself

A new deck is `draft`, and a draft deck accepts no answers. Starting the session
is the presenter's move, in the browser:

- the room joins at `<server>/join/<code>` — the create and `show` output print
  that link;
- the presenter opens `<server>/present/<id>` and starts the session.

This client's verbs are create and read; it does not yet start, advance or end a
session. So `omul results` on a deck nobody has run is a valid, empty tally
rather than an error — if every slide reports zero, check `omul show <id>` for a
status of `draft` before looking for a bug.

## When something goes wrong

Exit codes: `0` success, `1` the attempt failed, `2` the invocation was wrong.
The message on stderr is the server's own refusal wherever there is one — quote
it rather than re-interpreting it.

- *"no API key is configured"* from `omul list` — that command reads what an
  account owns. See **Credentials** above; do not work around it by putting a
  key on the command line.
- *"Refusing to send a credential in the clear"* — you are pointing at an
  `http://` host that is not this machine, and neither secret is sent over a
  plaintext hop. Use `https://`, or set
  `OMUL_CLI_ALLOW_PLAINTEXT_CREDENTIALS=true` if the person tells you that host
  is reached over a network they trust.
- A `404` from `show` or `results` — the id belongs to another server, or to
  nothing. Check `--server`.
- A schema refusal from `create` — the deck document is wrong, and the message
  names the field.

## Beyond these verbs

Every call this client makes is plain HTTP against routes the server documents
itself. For anything it has no verb for — starting a session, exporting a
workbook, the Q&A layer — read `<server>/api`, the discovery index written to be
followed by a caller that knows nothing about the route layout, and
`<server>/api/docs` for the full OpenAPI description.
