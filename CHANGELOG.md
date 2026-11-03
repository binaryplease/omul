# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A countdown slide, a new slide type that shows a clock of a set length, from 1 second to 1 hour (1 minute by default):
  - The presenter starts it with "Start countdown", and the clock runs on the shared screen and every phone. "Pause countdown" freezes it at the time left, "Resume countdown" continues from there, and "Reset countdown" returns it to its full length. A clock that reaches 0:00 stays there until it is reset.
  - A phone that joins or reloads draws the same clock as everyone else, running or paused. Moving to another slide leaves the clock as it is, and resetting the presentation's results clears every clock.
  - The editor, the preview, the results view and the PDF show the full length.
  - The route is `POST /api/presentations/:id/countdown`, which takes a `slideId` and an `action` of `start`, `pause` or `reset`, and needs edit access.
- The editor checks a presentation for accessibility problems in contrast, text size and structure, and lists what it finds.
- A presentation can require participants to be signed in. It is set in the editor, a participant who is not signed in gets a sign-in prompt on joining, and the server refuses the join until then.
- "Skip slide" in the editor marks a slide so that Next and Previous on the presenter screen step over it. The preview does not skip it.
- Several slides can be selected in the editor's slide list and moved, skipped, deleted or copied in one step. A presentation always keeps at least one slide.
- The API has editor-only routes that group a slide's word-cloud and open-ended answers into named themes, described in `docs/api.md`. No page offers this yet. Answers, results and exports do not change, and a reset or deleting the presentation removes the themes.
- A quiz question can play an audio track on the presenter screen while it is open:
  - Under "Audio cue" in the question's "Scoring & timing" settings, pick one of three tracks that ship with omul ("Ticking clock", "Heartbeat", "Plucked notes"), or "Custom" to enter a link to an audio file. Nothing is uploaded, and only `http(s)` links and paths on the same host are played; the editor says when a link cannot be.
  - The track starts when the question opens and loops until it closes: when its time runs out, when the presenter closes submissions, moves to another slide or ends the presentation. Coming back to a question that is still open, or reloading the page, picks the track up where it would have been; "Restart timer" starts it again from the beginning.
  - It never plays on participants' phones, which are not sent the link, nor in the preview. A presenter screen opened without edit access says the cue plays on the presenter's screen.
  - A switch beside the question's countdown mutes it, and also appears on the blanked screen. When the browser holds back sound until someone clicks the page, the switch reads "Play audio cue".
  - Audience-paced presentations have no shared answer window, so their audio cues do not play.
  - Each of the three tracks has a play button beside it in the editor, so a track can be heard while choosing it. It plays once, and it stops on a second press, on playing another track, on "Done" and on leaving the slide. Selecting a track stays silent, pressing play does not select it, and a track that cannot be loaded says so at the button. A "Custom" link has no play button.
  - The three tracks that ship with omul loop with no gap: the presenter screen now decodes them and plays them through Web Audio. A "Custom" link still plays through a media element, so a browser's short restart gap remains there. A reverse proxy that adds a `Content-Security-Policy` has to allow the same origin in `connect-src` for those three tracks, or they read "Audio cue unavailable", and in `media-src` for the preview and a Custom address.
- An audience-paced presentation can let one device go through it more than once, for a kiosk or a self-check people retake:
  - Turn on "Let a device answer more than once" under Pace in the presentation settings. The switch appears only while Audience pace is selected. It is off by default, and a value left on has no effect on a presenter-paced presentation.
  - A participant who reaches the last slide gets "Answer again". Each pass is kept as its own set of answers instead of replacing the last: a quiz can be answered again, a word cloud's limit starts over, and an earlier pass is never changed.
  - Every pass counts as its own respondent in the results, on the leaderboard, in segmented results and in both exports. The spreadsheet adds a Pass column to the Responses and Participants sheets, and its summary says whether the presentation allows repeat passes. Answers given before this release count as a single first pass. Segmented results still hold back a group with fewer than five people, counting devices rather than passes, so one person's repeated passes never make a group visible.
  - Turning the setting off stops new passes at once on every open phone, while a pass already started can still be answered in, so a kiosk waiting for its next person never records over the previous one. A reset or deleting the presentation removes every pass.
  - A name stated on joining belongs to the device, so every pass from that device carries it.
  - The routes are `POST /api/presentations/:id/passes`, which allows the same number of requests as voting, and an optional `pass` on votes, upvotes and the scorecard.
- A presentation can keep profanity in free-text answers off the shared screen and every phone:
  - Turn on "Withhold answers containing profanity" under Profanity filter in the presentation settings. It is off by default, and while it is off nothing changes.
  - It reads word-cloud, open-ended and typed quiz answers. An answer containing a word on the list is left out of the cloud, the response wall and the typed answers, on the presenter screen as well as on phones, and a line under the results says how many were withheld. A typed quiz answer is still scored.
  - The list follows the presentation's audience language unless another one is picked. Lists for English, German, French, Spanish, Italian, Portuguese and Dutch ship with omul; nothing is downloaded. Matching is by whole word and ignores case and accents, so "Scunthorpe" or "classic" are never caught.
  - Withheld answers are still stored. The presentation's owner, whoever holds its edit link and the accounts it is shared with see them, marked as filtered, on the results page (`/results/:id`, behind a "Show" control), and the exports carry them: the spreadsheet adds a Filtered column to the Responses sheet and counts withheld answers per slide, and the PDF lists them under the results the room saw. Anyone reading through a results link sees only the count.
  - Switching the filter, or its list, during a session updates every open screen at once, for answers already given as well as new ones.
  - The settings are `profanityFilterEnabled` and `profanityFilterLanguage` on the presentation; `GET /api/presentations/:id/results` and `…/results/:slideId` return `filteredCount`, and `?filtered=include` adds the withheld answers for the owner, the edit-link holder and collaborators.
- Slide headings, body text and presenter notes can carry mathematical notation, typeset on the presenter screen, every phone, the editor, the preview and the results page:
  - Write TeX between dollar signs: `$x^2$` within a line, `$$…$$` for a formula on a line, or lines, of its own. A plain dollar sign is written `\$`. Text without formulas looks exactly as before, and prices stay prices: `$5 or $10` is not read as a formula.
  - Formulas are typeset by KaTeX, which ships with omul together with its fonts; nothing is fetched from another host, and a browser loads it only once a slide shows a formula.
  - A formula that cannot be typeset — a typo, or a command that is not allowed, such as `\href` or `\includegraphics` — is shown exactly as it was written. No link, picture or HTML attribute is ever produced from a formula.
  - In the editor a heading with a formula in it is shown typeset, and turns back into its TeX while you type in it. A formula wider than a phone's screen scrolls sideways instead of running off the edge.
  - The PDF and spreadsheet exports show a formula as its TeX source.

### Changed

- **BREAKING** — Existing slide text with a `$…$` pair whose closing `$` follows a non-space now renders as a formula, for example `From $5 to infinity$`. There is no migration: edit such text and write `\$` to keep a literal dollar sign. Common price text stays text: `From $5 to $10`, `$5-$10`, `US$5`.
- The button on a participant's screen after a presentation ends is now in the presentation's language ("Zur omul-Startseite", "Go to the omul homepage", …) instead of always "Back to home". An instance can point it at its product website's home with `OMUL_WEBSITE_HOME_URL_EN` and `OMUL_WEBSITE_HOME_URL_DE`: a German presentation links to the German home, every other language to the English one, and to whichever is set when only one is. Each takes an absolute `http(s)://` URL or a path on the same host; any other value stops the server at startup with an error naming the variable. While both are unset the button opens the app's home page as before. The configured addresses are served at `GET /api/website`.
- The bar on the presenter screen no longer runs off the side of the screen at any width from 360 px. It holds the presentation's title, the room's controls (join code, Blank, panel switches) and the commands (a Deck menu with Edit, Preview, Share results, Export and Reset, one main button to start, end or restart, and the app menu), on one line from 1280 px and two lines below that. Every control on the bar has the same height.
- Below 640 px the presenter screen works as a remote. The top line holds Back, the title, the main button and a More menu. A dock at the bottom edge holds the join code, Blank, Panels, Previous and Next. Open panels stack in a sheet above the dock, which "Hide panels" or Escape closes.
- The join code is always on the presenter bar, with copy, a QR button and a Share menu. The QR button opens a room-sized dialog with the address, the large code and how many people are in the room.
- On a presentation that is not live, closing a slide now says the slide goes live closed, with nothing about answers already given. Starting a presentation with closed slides shows a notice naming them by slide number.
- An unset `maxResponses` on a slide and an unset `isCorrect` on an option now read as `null` in the API.

### Removed

- The switch that hides the join bar on the presenter screen. A choice saved earlier no longer has any effect on that screen.

### Fixed

- The PDF export of a presentation now prints accented Latin letters such as Polish, Czech and Turkish, Greek, Cyrillic, Chinese, Japanese and Korean exactly as they were written, in the slides and in the audience's answers, and prints emoji in a single colour. Before, accents were dropped (`č` printed as `c`), and these scripts and emoji printed as `?`. An emoji the bundled font does not cover still prints as `?`.
- Restarting an ended presentation now puts every phone and every other presenter tab on the presenter's slide. This also holds when the slide it stopped on was deleted before the restart, where phones stayed on the deleted slide and a vote there was refused.
- A participant no longer stays on "Waiting for presenter" while the presenter is live. Every join is answered with the live state, a phone replaces a connection that has gone silent and reconnects at once when the page wakes or the network returns, and it reads the slides again when the presenter is on one it does not have.
- A space or an arrow key typed into a field on the presenter screen, such as the chat, no longer moves the live presentation to another slide.
- The move up, move down and delete controls in a slide's header say why they are unavailable, on hover, on focus and after a tap.

### Security

- Exporting a presentation as PDF can no longer stall the server. Turning slide text into plain words for the PDF took time that grew with the square of the text for some markup; it now grows linearly, and the output is unchanged.
- `GET /api/presentations/:id/deck.pdf` is now rate-limited: 60 exports per 5 minutes per client. Over the limit it answers `429` with a `Retry-After` header, like the other limited routes. `OMUL_RATE_LIMITS_DISABLED=true` turns it off with the rest.
- A PDF export no longer holds up other requests while it renders: the renderer hands the server's thread back every few milliseconds. One export renders at a time across all callers, with up to four waiting; past that the export answers `503` with a `Retry-After` header. This bound protects the server rather than limiting a rate, so `OMUL_RATE_LIMITS_DISABLED` does not turn it off.

## [1.1.0] - 2026-10-21

### Added

- `omul`, a command-line client that drives a running omul server with a personal API key and no browser: `health`, `auth login|status|logout`, `templates`, `create` (from a template or a deck file), `list`, `show` and `results`, with `--json` for the raw payload. Install it with `nix run github:binaryplease/omul#omul`, with `bun link` in a checkout, or run it as `mise run cli -- <command>`.
- The client handles credentials carefully:
  - The API key comes from `OMUL_API_KEY` or from `omul auth login`. There is no `--api-key` flag, so the key never lands in shell history or a process list.
  - The edit token a create returns is stored in a private file and never printed.
  - Credentials are refused over plain HTTP to a non-loopback host unless `OMUL_CLI_ALLOW_PLAINTEXT_CREDENTIALS=true` is set.
  - Redirects are reported, not followed.
- An installable agent skill (`npx skills add binaryplease/omul`) that teaches an AI agent to create a presentation and read its results through the `omul` client.
- Links to the instance's imprint, privacy policy and terms:
  - Set them with `OMUL_IMPRINT_URL`, `OMUL_PRIVACY_URL` and `OMUL_TERMS_URL`. Each takes an absolute `http(s)://` URL or a path on the same host such as `/imprint`. Any other value stops the server at startup with an error naming the variable.
  - Each one that is set appears as a link in the app menu, on every page.
  - The terms and the privacy policy are also named, with links, before a visitor signs up, creates a presentation (from the editor, a template or a generated draft), or joins one with a code, a link or the QR code.
  - Nothing is shown while the variables are unset.
  - The configured links are served at `GET /api/legal`.
- Query parameters a visitor arrived with can stay in the address bar while they move around the app:
  - List them in `OMUL_KEPT_QUERY_PARAMS`, comma-separated, as exact names (`ref`) or prefixes ending in `*` (`campaign_*`). Values are kept exactly as they arrived.
  - Nothing is kept while the variable is unset.
  - `mode`, `token` and `error`, which carry sign-in links, can never be kept. Listing one of them, or a malformed entry, stops the server at startup with an error naming the variable.
- Q&A questions can be held for approval before the audience sees them:
  - Presenters turn this on in the Q&A panel with "Approve questions first". It is off by default.
  - While it is on, a new question is visible only to people who can edit the presentation, and nobody else can upvote it until it is approved.
  - The panel shows a pending count, marks waiting questions "Awaiting approval", and lets the presenter approve each one.
- Presenters can hide the join bar on the presenter screen and show it again. The choice is saved with the presentation and followed by every open presenter screen. Hiding the bar does not change who can join.
- A workspace owner can choose a default theme for the workspace. A presentation created in the workspace starts with that theme unless another theme is chosen, and each presentation can still change its own.
- The presenter screen shows how long the session has been running. The clock stops when the session ends, survives a page reload, and is cleared by a reset.
- Anyone can send feedback about omul to the people who run the instance, from "Send feedback" in the app menu:
  - Set `OMUL_FEEDBACK_ENABLED=true` to turn it on. It is off by default; while it is off the menu has no such item and no feedback database is created.
  - The form takes an optional 1–5 star rating and a comment. Signed-in senders also get a "You can contact me about this" box, unticked by default, that names their account email. Their account is kept only if they tick it.
  - Answers are stored in a separate `feedback.sqlite` beside the other databases, or in the file `OMUL_FEEDBACK_DB` names. Only the rating, comment, screen kind, language, day and (when the box is ticked) the account are kept.
  - The routes are `GET /api/feedback/config` and `POST /api/feedback`, which accepts JSON only and allows 20 submissions per 10 minutes per client.
- Administrators (`OMUL_ADMIN_EMAILS`) read the feedback at `/app/admin/feedback`, with one tab per channel, totals, a count per rating and paging. When the sender asked to be contacted, the page shows their current account email, or that the account has been deleted. The same data is served at `GET /api/admin/feedback`.
- A share of participants can be asked what they think of omul when a session ends:
  - Set `OMUL_FEEDBACK_PROMPT_PERCENT` to a whole number from 1 to 100 to choose the share. It is off while unset. `OMUL_FEEDBACK_PROMPT_COOLDOWN_DAYS` (default 30) sets how long before a device is asked again. A malformed value of either stops the server at startup with an error naming the variable.
  - Only a device that was in the room before the deck ended can be asked. It sees a card on the ended screen, in omul's own look and the deck's language, and can answer or dismiss it.
  - Answers are anonymous: only the rating, comment, language and day are stored, never an account, participant or deck. They are sent to `POST /api/feedback/participant`, which allows 300 answers per 10 minutes per client so a whole room behind one network can answer.
- The home page tells a presenter who is not signed in that their presentations are stored only in this browser and are lost if its data is cleared. "Add email" opens the sign-in dialog on "Create account"; signing up or signing in attaches the presentations to the account and removes the notice. The notice can be closed, and the browser remembers that. It is not shown while signed in or to a browser that holds no presentation. In a browser that has been signed in to an account before, on any page with the account controls, the notice asks to sign in instead, and its "Sign in" opens the dialog on the sign-in tab. A browser signed in before this release and signed out before opening such a page is not recognised and is offered "Create account".
- A presentation made in a browser without an account now moves into the account when the presenter signs up or signs in: after signing out it is no longer listed or editable in that browser, and signing in again brings it back. A presentation that belongs to another account or a workspace and was opened through an edit link keeps its edit link access. Edit links already handed out keep working. A presentation created while signed in (blank, from a template, generated, imported or duplicated) belongs to the account from the start and is not kept in the browser at all, so it is never listed while signed out, even when the session ends on another page. For presentations that live in the account, the presenter screen offers no "Edit Link" from that browser; share them with another account instead.

### Changed

- The cards under "Your Presentations" on the home page show the title in full width on a line of its own, with the status beside it, then the code, slide count and date, then the five actions (share, move, export, duplicate, delete) in a row of their own. The actions are always visible instead of appearing only while the pointer is over the card, so they can also be found on a touch screen. The slide-count square at the left of the card is gone; the count is in the metadata line.
- The Light / Dark / Auto theme switch is now a small app menu, opened from a three-dot button in the same place on every page. It holds the theme choice and, when they are configured, the links to the imprint, privacy policy and terms. The menu also appears on the shared results page, on error screens and on the presenter's blanked screen, where there was no theme switch before.
- The storage library `@binaryplease/zodstore` is updated from 0.4.2 to 0.5.0, which brings its fixes to filtering on empty values and to how it checks a database file on open. The first start on an existing database renames the indexes that cover two fields to the library's new naming scheme. This needs no action and keeps every stored presentation, vote and question.
- In a fork with GitHub Actions enabled, the CLA check no longer runs, and the image build no longer pushes to the fork owner's container registry. The image is still built, so a broken Dockerfile still shows up. Pull requests from a fork to this repository are still checked for the CLA.
- The CLA check skips a pull request whose commits are all the copyright holder's own, verified commits. A pull request that mixes those with a contributor's commits is judged commit by commit, so the holder's commits are no longer reported as an unsigned contributor.

### Removed

- Dependabot version updates for the repository's GitHub Actions. The actions stay pinned to the same commits and versions, but nothing proposes updates for them any more; they are now updated by hand.

### Fixed

- Setting `OMUL_AUTH_DB=:memory:` or `OMUL_ADMIN_DB=:memory:` now gives an in-memory database, as it already did for `DATABASE_PATH`, instead of creating a file named `:memory:` in the working directory.
- A pull request from a fork no longer fails its build check. The check used to try to push the image with the pull request's read-only token, and the registry refused it.
- The image build workflow reads the branch name and commit of a pull request from environment variables instead of writing them into the shell script. A fork branch whose name contained shell syntax could otherwise have run commands on the build runner.
- `mise run check` and `mise run test` no longer fail when a tracked file has been deleted in a checkout but the deletion is not yet committed.
