# Frontend conventions

Binding UI conventions and the shared primitives that implement them. See
[architecture.md](architecture.md) for the file layout.

## Shared primitives

The binding conventions: **no Unicode glyphs as icons** — use the SVG set — and
**cross-surface affordances are one descriptor + one wrapper + one shared
interaction-state token**, guarded by `mise run check`. The shared primitives
that already exist — compose these, never re-hand-roll:

- **Icons** — `lucide-react` (chosen for its thin rounded-outline
  look). Import icon components directly where used, e.g.
  `import { BarChart3 } from "lucide-react"`. Never use arrow/check/triangle
  glyphs (`←→↑↓✓▲`) as icons.
- **The product's own mark** — `src/components/BrandMark.tsx` (REQ167).
  `BRAND_NAME` is the one spelling of the product's name — every surface that
  says it in words says it from here — `brandMarkForm()` the single rule for
  which of the two drawn forms a size gets (below roughly 56px of wordmark width
  the closed-ring signet takes over, and the closed ring is also the icon, tile
  and avatar form), and `<BrandMark heightPx=…/>` the one rendering that asks
  it. A caller states how much room it has, never which drawing it wants. The
  wordmark is drawn in `--color-mark` — the ink on light, the paper on dark,
  which is its supplied inverse form — so the mark and the chrome hold those two
  values once between them (REQ166) rather than each holding a copy; it is never
  drawn in the accent, which belongs to the interface. The signet is a fixed
  tile and stays the supplied file, `public/brand/omul-icon-ring.svg`, which is
  also what `index.html` points the tab icon and the home-screen tile at. This
  is *not* `<DeckMark/>` next door: that one is the **organizer's** mark on a
  participant-facing surface (REQ136), and the two never stand in for each
  other.
- **Share controls** — `src/components/ShareCluster.tsx`. `buildShareControls()`
  is the single descriptor for the join-code / link / QR / embed / edit-link
  controls; `<ShareCluster variant="bar"|"compact" …>` owns their layout on both
  the presenter's wide bar and compact row.
- **Icon-button hover** — `ICON_BUTTON_HOVER` in `ShareCluster.tsx` is the shared
  muted→accent interaction-state token. Compose it; don't inline
  `text-text-muted hover:text-accent` per surface.
- **Deck sharing** — `src/components/CollaboratorsDialog.tsx` (REQ075).
  `DECK_ACCESS_LEVEL_DESCRIPTORS` is the single descriptor for the three access
  levels — one entry per level the API accepts, in the same order — and
  `deckAccessLevelLabel()` / `deckAccessLevelSummary()` the one reading of it,
  composed by the owner's picker in the dialog *and* by the badge on a shared
  deck's card in `HomePage`. Never name a level with a literal: two spellings of
  "Can edit" is how the picker and the badge come to describe the same grant
  differently. The dialog itself sits on the deck's own card and is
  the owner's surface only — it enforces nothing, and it must not be read as if
  it did: the level is enforced server-side on every mutation route, and holds
  whether this dialog was ever drawn. What a surface *may* read is the
  `accessLevel` the server puts on a deck it hands back — but it is a report, not
  a credential, so getting it wrong mis-draws a button and nothing more.
- **Workspace roles** — `src/components/WorkspaceRoles.tsx` (REQ128/REQ129).
  `WORKSPACE_ROLE_DESCRIPTORS` is the single descriptor for the three roles — one
  entry per role the API accepts, in the same order — and `workspaceRoleLabel()`
  / `workspaceRoleSummary()` the one reading of it, composed by the roster's
  picker and the badge on a workspace card. `assignableWorkspaceRoles()` is what
  keeps a picker from drawing a choice the server answers `403` to (an admin
  cannot hand out `owner`). What a role *may do* is not restated here at all: the
  predicates come from `server/schemas.ts` through `src/types.ts`
  (`canCreateWorkspaceDecks`, `canAdministerWorkspaceDecks`,
  `canManageWorkspaceMembers`, `canAdministerWorkspace`, `canReadWorkspace`,
  `canPublishWorkspaceTemplates`), so
  a control stops being drawn on the same day the route behind it stops
  authorizing — a surface that compared role strings would drift the first time
  the server's answer changed. Every control the caller's role does not open is
  drawn **disabled with its reason**, and the two directions a deck
  moves live beside the deck each time: into a workspace from the
  deck's card in `HomePage` (`MoveToWorkspaceDialog`), back out from the deck's
  row on `WorkspacePage`.
- **A template on a card** — `src/components/TemplateCard.tsx`
  (REQ005/REQ004). Two galleries draw a template — the built-in catalog on
  `TemplatesPage` and the templates a workspace publishes on `WorkspacePage` —
  and what they draw is the same entry, because a published one *is* a catalog
  entry plus a publisher. So `<TemplateCard/>` owns that presentation (the name,
  the category badge, the description, the deck's shape as one icon per slide,
  the tags) and `DECK_TEMPLATE_CATEGORY_LABELS` the words for the five
  categories, guarded by `mise run check`. Each surface passes its own actions as
  children: the catalog offers `<UseTemplateButton/>` alone, the workspace adds
  who published it and an unpublish control. Everything a search looks at is on
  the card, so a match always has a visible reason (REQ019) — and both surfaces
  narrow with the schema's own `filterDeckTemplates()`, never a second filter.
  Publishing is `src/components/PublishTemplateDialog.tsx`, on the deck's own
  card on `WorkspacePage`, beside the control that moves that deck out.
- **"May this caller edit this deck?"** — `callerCanEditDeck()` in
  `server/schemas.ts`, re-exported through `src/types.ts` (REQ149). The one
  reading of that question, composed by every surface that gates a deck control:
  `PresenterPage` (the lifecycle controls, the Q&A queue, the roster, the reset
  and export chips), `PreviewPage` (the Edit button) and `CreatePage` (the
  redirect that keeps a caller who cannot save out of the editor, and the Preview
  link beside the title). It takes **both** proofs a browser has, because the
  server honours both: `heldEditToken` — whether `getCreatorToken()` finds this
  deck in the `omul-tokens` map — **or** the `accessLevel` the deck read
  reported. Never derive it from the token map alone: that asks whether *this
  browser* created the deck, not whether the caller may edit it, and it hands a
  read-only screen to the owner opening their own deck from a second machine, or
  to any owner of a deck created through the API with `x-api-key` — which
  deliberately mints no edit token at all, so that owner can never hold one. The
  token map stays the right question for exactly one control: the **edit link**
  on `PresenterPage`, since the link *is* the token and there is nothing to copy
  into it without one.
- **Segmented results** — `src/components/SegmentedResults.tsx` (REQ020/REQ116).
  One slide's tally re-drawn per group of the room, as an earlier slide's answers
  divide it. Three things it deliberately does not own: **which slides may group
  which** (that is `segmentSourcesFor` in `server/segmentation.ts`, imported
  through `src/types.ts` — the same descriptor the endpoint enforces, so the
  picker cannot offer a grouping the API refuses); **how a group is
  drawn** (`ResultsDisplay`, the component the unsegmented tally uses, so a word
  cloud stays a word cloud inside a breakdown); and **the picker's
  chrome** (`ChoiceCards variant="tile"`, whose `disabled` + `disabledReason`
  already carry the "drawn, inert, and it says why" treatment). It sits under the
  chart it re-draws and polls on the page's beat rather than a clock
  of its own. A held-back group (`suppressed`) is a *stated* shape from the
  server, never an empty panel — and it is drawn with **no head count** and a
  sentence true of both cases it covers, since a group above the floor wears the
  flag too when it is the complement that keeps a smaller one from being
  subtracted out. A whole withheld breakdown says which of the two reasons it
  met (`withheldReason`), because only one of them is something the organizer
  could change — see [api.md](api.md#segmented-results-req020-req116).
- **Slide comments** — `src/components/SlideComments.tsx` (REQ074).
  `useSlideComments()` is the one load-and-write wiring (the deck's whole
  conversation in a single read, so paging the rail costs nothing),
  `slideCommentsFor()` the single split of that list into the thread on one
  slide — so a count on a chip and the panel under it cannot disagree —
  `<SlideCommentsPanel/>` the one rendering of a thread and its composer, and
  `<SlideCommentsStrip/>` that panel closed to a line under the editor's canvas
  (a comment is made while looking at the slide it is about, beside
  the presenter-notes strip it deliberately mirrors). Two surfaces wear it: the
  editor, and the presenter's screen — the latter because it is the only screen a
  `view` or `comment` collaborator can reach, and a level whose feature has no
  door is a level with no feature. Whether the composer is live is
  `slideCommentComposerState()`, which reads `canWriteDeckComments` and lets the
  **server's own refusal win** over any level a client resolved: a browser holding
  the deck's edit link is reported `edit` and has no account, so the box says
  "sign in" rather than answering 401 on the first keystroke sent. **Nothing here
  is a privacy boundary** — a comment reaches this module only when the server
  sent it, and it sends one only to an account with standing on the deck (see
  [api.md](api.md#comment-threads-on-slides-req074)); a panel that filtered
  comments itself would be a second, weaker copy of a rule already settled on the
  wire.
- **Search-match highlighting** — `src/components/HighlightedText.tsx`.
  `highlightSegments()` splits a string into matched/unmatched runs
  and `<HighlightedText text search/>` marks them; a surface passes its query
  through unconditionally, since an empty search renders plain text. The rule it
  marks by is a plain case-insensitive substring — the same rule
  `deckTemplateMatchesSearch()` filters by — so a surface whose filter matched
  some other way must not use it: a highlight that points at the wrong characters
  explains a result with a reason that is not the reason. Whatever a search reads
  must also be *rendered*, which is why a template card shows its tags.
- **Quiz countdown** — `src/components/QuizTimer.tsx` (REQ057). `quizWindowFor()`
  is the single descriptor for when a quiz question closes, `useQuizCountdown()`
  the single clock that ticks it down (on the *server's* clock, via the session
  slice's `serverClockOffsetMs`), and `<QuizTimer/>` the one rendering worn by
  both the participant's phone and the shared screen. Never re-derive a deadline
  or start an interval per surface: the one thing a countdown has to be is the
  same countdown for everybody, and the same instant the boundary enforces.
- **Quiz answer mode** — `quizAnswerModeFor()` (re-exported from `src/types.ts`)
  is the single read site for whether a quiz question is answered by picking an
  option (REQ054) or by typing (REQ055). Every surface that branches on it — the
  editor's answer set, the preview, the rail gist, the participant's control, the
  presenter's result switch, the results renderer — asks that one function; none
  reads `slide.quizAnswerMode` directly, which is also how a non-quiz slide's
  leftover value stays ignored in exactly one place.
- **Leaderboard** — `src/components/Leaderboard.tsx` (REQ059). `readLeaderboard()`
  is the single read of the board payload (it keeps the *server's* places, so a
  tie stays a tie), `<Leaderboard/>` the one board worn by the shared screen and
  the participant's phone, `leaderboardRankSurface()` the shared podium token
  and `leaderboardLabelsFor()` the one mapping of the participant
  dictionary onto its labels (REQ084). Never number the rows a board drew or
  re-derive a place on the client: the ordering, the ties and the cut are the
  server's, and a phone that recomputed them would disagree with the projector.
  A row is named by the anonymous `entryId` the server derived — a participant
  finds their own row by matching the `entryId` on their scorecard, never by
  sending a participant id to this surface. Every word in a row arrives through
  `LeaderboardLabels`; reaching for a literal here is how one English string ends
  up beside six translated ones. Both surfaces gate the board on
  `effectiveResultsVisibility` (REQ102) — a board is an aggregated result like
  any other. And `LeaderboardStandingView` distinguishes a `null` standing (the
  card is still loading) from a standing whose `rank` is `null` (it arrived, and
  they have answered nothing): collapsing the two tells somebody in 3rd place to
  go and answer a question.
- **Q&A layer** — `src/components/QAPanel.tsx` (REQ036/REQ037/REQ060).
  `readQAList()` is the single read of the Q&A payload (it keeps the *server's*
  order — open first, then most upvoted, then longest waiting — so the presenter's
  queue and every phone agree on what comes next), `useQAList()` the one fetch-and-
  subscribe wiring both pages share, `QAQuestionList` the one list worn by the
  presenter's moderation queue and every participant's screen, `QAComposer` the box
  a question is asked in, `QALayerControls` the two switches that govern the layer,
  and `qaLabelsFor()` the one mapping of the participant dictionary onto its labels
  (REQ084), beside `QA_LABELS_EN` for the untranslated presenter surface. Never
  re-sort a Q&A list on the client, and never filter one for display: **who may see
  which questions is decided on the server, per request, from the credentials that
  request carries** (REQ037) — a client holding a question it must not show would
  be one network tab away from showing it. The socket only says *that* the list
  moved (`qa.updated`); the list itself is always fetched.
- **Participant names** — `src/components/ParticipantName.tsx` (REQ076).
  `participantNameOutstanding()` is the one predicate deciding whether a phone
  still owes the deck a name — a deck that stopped asking never owes one, however
  the browser's local memory reads — `ParticipantNameGate` the single form for
  **both** stating one and correcting it (a correction is the same write: one row
  per participant, overwritten in place, so it must not be a second form with
  second rules), `ParticipantNameBadge` the confirmation-plus-edit line drawn
  where the name is shown, `participantNameLabelsFor()` the one
  mapping of the participant dictionary onto its wording (REQ084) beside
  `PARTICIPANT_NAME_LABELS_EN` for the untranslated organizer surface, and
  `useParticipantRoster()` / `ParticipantRosterPanel` the presenter's side. Both
  ends live in one module because what they share is the invariant — what a
  participant is *called on this deck*. Two rules: the gate is an
  **early return** on `ParticipantPage`, not an overlay, because a deck that
  requires a name has to be able to say the room stated one and a question beside
  an answerable slide is a question somebody scrolls past; and the roster panel is
  **closed until opened**, like every other panel on the presenter's screen and
  for the sharpest version of that reason — that screen is the projector, and a
  list of the room's own names must not put itself on a wall. The names never
  ride a broadcast, so the panel polls; nothing on the socket announces one, and
  a frame saying "Ada joined" would be a name on every phone in the room. Two
  things the *switch* does ride the socket for, and both are the same bug in
  opposite directions: `presentation.participant-name` patches the deck so a
  mid-session change reaches every phone (turned on, nobody already in the room
  is otherwise asked and their answers land under nobody; turned off, a
  participant at the gate is otherwise stranded on a screen the boundary has
  started refusing), and `presentation.reset` bumps `sessionResetRevision`, which
  is what makes `ParticipantPage` call `forgetStatedParticipantName()` — the
  server has dropped the roster, so a browser that kept its memory of answering
  would never be asked again for the re-run. The remembered name is the browser's
  own note to itself (`src/api.ts`), never re-read from the server: a
  participant-facing "what is X called?" would turn a room's names into a public
  lookup.
- **The live room's two switches** — `src/components/LiveRoom.tsx`
  (REQ111/REQ109). What the presenter decides about the room *while it is in
  front of them*, and the module exists because both halves of each switch are
  worn by two different surfaces. **Participation** (REQ111):
  `participationLabelsFor()` is the one mapping of the participant dictionary
  onto its wording (REQ084), `slideParticipationToggleLabel()` the name the
  control goes by in each of its states, `<SlideParticipationControl/>` the
  presenter's open/close switch — on the slide it governs, beside the reveal and
  the timer restart — and `<ParticipationGate/>` the participant's
  half. **Blanking** (REQ109): `audienceBlankToggleLabel()` and
  `<AudienceBlankCurtain/>`, the stated screen the projector wears instead of
  the slide.
  Four rules the module exists to keep:
  - **The predicates are not here.** `slideAcceptsSubmissions()` and
    `audienceViewBlanked()` live in `server/schemas.ts` and are re-exported
    through `src/types.ts`, because the vote boundary refuses on the first of
    them — a second reading on the client is how a phone comes to draw a live
    control over an answer the server is already turning away.
  - **The gate is a `<fieldset disabled>`, not a `disabled` prop threaded
    through a dozen branches.** Every control a participant answers with is a
    form control, so one native ancestor turns all of them off — including the
    ones somebody adds next year without this component being edited.
    `display: contents` means the box is not there at all, so wrapping the slide
    moves nothing on screen. It is **not the enforcement**: the two surfaces
    answered by tapping a *picture* (the pin canvas, the grid plot) are not
    reachable by a fieldset at all, which is why the vote path is guarded too and
    reports the same string.
  - **Neither switch reports the other's state, and neither blocks reaching
    it.** A screen can be blanked while the question on it is also closed, so
    the blank control's wording says what blanking *left alone* rather than
    claiming a participation state it does not read — the distinction REQ109 is
    written against, and one that is easy to undo in a sentence of copy. The
    same independence has to hold at the *control* surface: the participation
    switch rides the blanked screen's control slot, because a presenter who had
    to un-blank to close a question would be putting it back in front of the
    room to do so.
  - **`sharedScreenView()` decides which screen the projector is drawing**, and
    the page composes it as an **early return**. `"blank"` does not mean "swap
    the middle column" — it means the deck is not on this screen: no question,
    no title, no join code, no rail of what is coming, no open panel of what the
    room has been saying. This page is the product's only shared screen and the
    presenter's laptop *is* the projector, so anything still drawn beside the
    curtain is drawn in front of the room. Returning early is what leaves no
    deck-bearing JSX on that path to have forgotten; what survives is controls,
    and the rule for those is `AudienceBlankCurtain`'s — a control names what it
    does ("Close submissions", "Next", "3 / 12"), never what the deck says.
  - **Both controls are drawn for a spectator, disabled with their reason**.
    Whether the room can answer, and whether the screen is blank, are
    facts about the session — a control that vanished would leave a `view`
    collaborator unable to tell a closed question from an open one.
- **Taking one submitted answer down** — `src/components/Results.tsx` (REQ027).
  `answerModerationFor()` is the single descriptor deciding whether a surface
  moderates the answers it is about to draw and on what terms,
  `ANSWER_MODERATION_DENIED` the one wording a viewer who cannot is told,
  `<RemoveAnswerButton/>` the one control, and `slideAnswersAreDeletable()` (from
  `server/schemas.ts`, re-exported through `src/types.ts`) the guard — the very
  predicate the delete boundary refuses on, so a screen cannot offer a deletion
  the server turns away. Two renderings wear the control because the two slide
  types draw an answer differently: an open-ended card **is** one answer, so the
  button sits on the card, while a word cloud is an aggregate that names no row,
  so `<WordCloudAnswerList/>` lists the individual answers under it (each
  control beside the thing it removes). That list comes from the payload's
  editor-only `answers` block and is drawn only where the descriptor is passed;
  a participant's phone passes none and has no control at all, which is
  relevance rather than availability — the room is not the
  moderator of the room. A **spectator** on the shared screen does get it, inert
  and carrying its reason, like every other control that page draws for them.
- **Which player a video URL opens** — `slideVideoFor()` (re-exported from
  `src/types.ts`) is the single read site for a video slide's `mediaUrl`
  (REQ064). A link to a video platform is a *page*, not a file — a `<video>`
  element pointed at a YouTube watch URL plays nothing — so a share link resolves
  to `{kind: "embed"}` and its platform's own player, while everything else
  resolves to `{kind: "file"}` and the browser's media element. Every surface that
  draws a video slide goes through `<ContentSlideView/>`, which asks that one
  function, so the editor's preview pane cannot promise a playback the room will
  not get. **Never point a player at `slide.mediaUrl` directly**: an `<iframe src>`
  is a navigation, so a `javascript:` or `data:` URL in one executes in the page
  while the same string in an `<img src>` merely fails to load — the scheme check
  lives in the resolver, and a URL it returns `null` for is shown to the organizer
  as unplayable rather than framed. Nothing here uploads, stores or proxies a
  video; the deck references a file that lives somewhere else.
- **Whose viewer an embed URL opens** — `slideEmbedFor()` (re-exported from
  `src/types.ts`) is the single read site for an embed slide's `mediaUrl`
  (REQ066 PowerPoint, REQ067 Google Slides, REQ068 Miro), and `EMBED_PROVIDERS`
  the one descriptor saying what each provider is called and whether the room
  *works in* it or reads it. A share link is a page for a human — an `<iframe>`
  pointed at a Google Slides `/edit` URL frames an editor, not a deck — so each
  provider's link is normalised to that provider's own embed entry point, and
  every surface that draws an embed slide goes through `<ContentSlideView/>`,
  which asks that one function. **Never frame `slide.mediaUrl` directly**: the
  allowlist *is* the security boundary here and it is stricter than the video
  slide's on purpose — a link naming none of the three providers resolves to
  `null` rather than being framed on a guess, because an unrecognised page in a
  frame is arbitrary third-party script running beside the deck. `https` only,
  the frame is sandboxed to what a viewer needs, and clipboard access is granted
  only to a provider the descriptor marks interactive. Nothing here uploads,
  converts or proxies a deck; the slide frames material that lives somewhere
  else, and the provider's own controls are what page through it.
- **The image as a coordinate space** — `src/components/PinImage.tsx`
  (REQ051–REQ053). `<PinCanvas/>` is the one picture-with-marks worn by all four
  surfaces that draw a pin slide — the participant taps it, the shared screen
  fills it with the room's pins, the editor previews it, and the editor's
  target-area picker drags a box across it — because the invariant is the
  *coordinate space*, not the marks: identical image, identical aspect
  ratio, identical per-mille lattice, so the pin somebody placed on their phone
  is the pin that appears on the projector. `pinPointFromPointer()` is the single
  conversion from a tap to a coordinate and the **only** place device pixels
  appear at all; `pinOffsetPercent()` the single conversion back. `acceptedPin()`
  and `pinVerdict()` read a participant's own answer from the value the *server
  accepted*, never from wherever they last touched — a tap that was refused, or is
  still in flight, must not wear a confirmed pin, which is the same discipline
  `acceptedGridPoint` keeps next door. A pin slide's `mediaUrl` is its canvas
  rather than its illustration, and `slideMediaIsInteractionArea()` is the one
  read site for that difference: every surface that draws the optional
  image/GIF (REQ069) asks it first, or the picture appears twice with the answers
  on only one of them.
- **Presenter notes** — `src/components/PresenterNotes.tsx` (REQ090/REQ156).
  `presenterNotesFor()` is the single read of the field, `PresenterNotesPanel`
  the reading both presenter surfaces wear, and `<PresenterNotesStrip/>` the one
  place a note is *written*: a strip directly under the editor's canvas
  (notes are written in the same pass as the slide's words and read
  while presenting them), collapsed to `presenterNotesStripLabel()` — one line of
  the note, or the invitation that stands in the same position when there is none
  — and expanding in place to the full editor. **Nothing here is a privacy
  boundary**: the server empties the field for every caller that cannot edit the
  deck, and `PRESENTER_NOTES_PRIVACY_LABEL` ("Only you") states that settled fact
  at the point of authoring rather than enforcing a second, weaker copy of it.
- **Quiz verdict** — `QuizVerdict` in
  `src/components/ParticipantSlideView.tsx` is the one rendering of a
  participant's own result, worn by both answer modes. What a quiz question
  *asks* differs between them; what it tells you afterwards does not.
- **The two slide views** — `src/components/PresenterSlideView.tsx` and
  `src/components/ParticipantSlideView.tsx` (REQ103). Each is *the whole slide*
  as one surface sees it — heading, control or tally, countdown, results-
  visibility gate — worn by the live page and by the preview's matching pane. The
  unit of sharing is the slide, not its parts: a preview that
  re-assembled the same primitives in its own order would be previewing a screen
  that does not exist. `presenterSlideKind()` / `participantSlideKind()` are the
  single descriptors of which rendering a slide type gets, and
  `src/pages/PreviewPage.test.ts` walks the schema's own slide-type enum through
  both, so a slide type nobody taught the preview about fails a test rather than
  drawing a blank pane.
- **The vote transport** — `ParticipantVoteTransport` in the same module is the
  one seam between the two participant surfaces. `liveVoteTransport()` posts to
  the vote endpoint; the preview's (`previewVoteTransport` in
  `src/pages/PreviewPage.tsx`) keeps the answer in the browser. A factory rather
  than a `preview` boolean deliberately: a flag would leave
  the network call sitting in the component with an `if` around it, one edit away
  from a dry run that filled a real deck with fake responses. **Never reach for
  `api.vote` from a participant surface** — go through the transport, and the
  question "can this screen vote?" stays answerable by reading which one it was
  handed.
- **The editor's stage** — `src/components/SlideCanvas.tsx` (REQ152). The slide
  being authored, drawn as the room will get it, at the centre of the Create/Edit
  page and at every viewport width. It is `SlidePreview` **promoted**, not a
  second renderer: the guard allows exactly one `<SlidePreview/>` render site and
  this is it, because an editor with two answers to "what will they see" is an
  editor that can show a slide the room would not get. It replaced a
  384 px `hidden xl:flex` aside beside a form three thousand pixels deep — the
  thing being authored was the least visible object on the page that authors it,
  and below 1280 px it was not on the page at all.
  The frame is also the theming boundary made visible (REQ079): everything inside
  `<DeckThemeScope/>` wears the deck's colours and face, while the caption above
  it and every piece of chrome around it — top bar, rail, settings column — stay
  in the app's own scheme. `slideCanvasCaption()` is what says which of the two is
  being looked at, and it composes `SHARED_SCREEN_LABEL` from
  `PresenterSlideView.tsx` — the one name that screen has — so the stage and the
  dry run's presenter pane cannot call the projector two different things.
  The stage has **two views** (REQ154), switched on its own frame rather than
  from the page's chrome: the question, and the slide's results *as
  the reveal will draw them*. `slideCanvasViewOptions()` is the one descriptor
  the switch is built from — the results entry keeps its place on a slide that
  draws no tally and carries `NO_RESULTS_REASON` instead of disappearing
  — and `slideCanvasViewFor()` resolves a view that outlived the slide
  it was chosen on. The results view draws through `ResultsDisplay`, the room's
  own renderers, so the authored chart style, value display, chart colour and
  correct-answer mark are the ones the projector will show; editing is withheld
  there rather than ignored (`editing` is not passed at all). Changing the chart
  style or the value display in the settings column sends the stage to this view,
  because what those settings select is a picture and a labelled card is not one.
- **The room the editor draws with** — `src/components/SampleTally.ts` (REQ154).
  `sampleTallyFor(slide, deckQuizCount)` is the one stand-in tally, shaped field
  for field like what `aggregateSlideResults` puts on the wire, and seeded from
  the slide's own **id** so the same slide draws the same room on every render
  and in every session — a preview that reshuffled itself is one nobody can
  compare two chart styles with. Nothing here reads a session, a socket or the
  network, and nothing it makes is persisted or sent; `sampleTallyNote()` says so
  on screen, and says what to author instead when the slide has nothing to chart
  yet. It invents **counts, coordinates and anonymous handles only**: the
  options, accepted answers, items and fields it charts are the author's own, and
  a leaderboard in a deck with no quiz questions draws the empty board it will
  really draw.
- **The slide's settings, as a column** — `src/components/SlideEditor.tsx`
  (REQ155). Everything the canvas cannot show, in one ~300px column beside it, as
  a run of groups in the order an author works: type → content → answers →
  scoring → results → style. **Which** groups a type owns is not decided in the
  column: `SLIDE_TYPE_SECTIONS` in `SlideTypeMenu.tsx` declares it beside the
  type's own hint (one descriptor) — the **label** moved on to
  `server/schemas.ts` and is re-exported from `SlideTypeMenu.tsx`, because the
  PDF export names a slide type too (REQ096) and the server cannot import an
  editor component — including which types'
  answer shape is structured enough to scroll inside the column. A choice slide
  and a word cloud are short in every state and are not marked; a **quiz is**,
  because a typed question's accepted-answer list is a structured field set
  (REQ055) — the marking costs a select-answer quiz nothing until that list
  grows. `SlideTypeMenu.test.ts` holds the declaration to `slideHasResults` so
  the column and the tally cannot disagree about what a slide produces.
  `<SettingsGroup/>` in `EditorControls.tsx` is the group frame: a heading, at
  most **one consequence line** about the choice in force (never a description of
  the choices not taken — the canvas shows those), the marker a group wears when
  it departs from its deck or product default, and the one gesture back.
  `slideAnswerRulesDeparture()` / `slideScoringDeparture()` /
  `slideResultsDeparture()` / `slideStyleDeparture()` are that reading, one per
  group and pure: **a reset restores defaults and never deletes words** — the
  options, items, statements, fields and accepted answers an author typed are the
  slide's substance, not a setting with a default, and `SlideEditor.test.ts`
  refuses any reset that writes one. The colours read as words:
  `authoredColorLabel()` spells an unauthored colour "Theme" rather than the hex
  it currently resolves to, because those two states look identical written out
  and only one of them follows the deck when it is re-themed.
- **A setting that rests as one line** — `DisclosureRow` in `EditorControls.tsx`
  (REQ155). The shared chip a rarely-touched setting closes to — the slide's
  three colours, its background image, the optional picture beside a question,
  a quiz's countdown — naming itself and stating its current value, and opening
  where it sits. It is the one spelling of "a setting, closed";
  `ColorField collapsible` composes it rather than drawing a row of its own. This
  is disclosure, not hiding: the setting is named and legible without opening
  anything, which is what a control that is present but idle owes its reader.
  The same reasoning drives `ChoiceCards variant="tile"` and `Segmented compact`
  — the same enumerated choice at the size a 300px column can spare.
- **Authoring on the slide** — `src/components/SlideCanvasFields.tsx` (REQ153).
  The question and the option rows are written where they will be read, so an
  authored size or colour is bigger or recoloured text under the caret rather
  than a control's claim about it. Three things, and nothing else owns any of
  them: `SlideCanvasEditing` is the **one descriptor** (the four editor-store
  actions with the slide already bound — every mutation still goes through
  `updateSlide` / `addOption` / `updateOption` / `removeOption`, so the
  CRDT-ready seam is untouched and this surface stays presentational);
  `<SlideQuestion/>` and `<SlideOptionList/>` are the **one wrapper** per
  authored thing, drawing the room's reading *and* the author's field out of the
  same component so the two cannot come to show different slides; and the
  `REQ153 editing layer off the canvas` guard is the **one guard**, refusing the
  descriptor's name outside the canvas's own chain. A surface either *holds* the
  layer or it does not — there is no `editable` flag to get wrong halfway down a
  tree, which is what makes "no participant, presenter or shared-results screen
  renders an editing affordance" answerable by grep.
  `CANVAS_FIELD_SURFACE` and `CANVAS_TOOL_REVEAL` are the shared interaction
  tokens — what "this text is editable" looks like, and what a per-row
  tool does when nothing is pointing at it. The reveal fires on `focus-within` as
  well as on hover: a tool a pointer alone can find is a tool a keyboard cannot.
  Two rules the module exists to keep:
  - **An empty question is visibly untitled, and honest about it.**
    `slideQuestionPlaceholder()` draws in the muted deck-theme colour, and where
    the room has a real default for a blank heading — an instruction slide's
    front door, a leaderboard's board title — the placeholder *is* that default.
    The `fallback` passed to `<SlideQuestion/>` is the other half of the same
    distinction: it is what an audience actually reads, so it renders as real
    text through `<SlideText/>` on every live surface.
  - **The answer key is readable at rest.** A marked option wears its check
    without being hovered, and an unmarked one still shows the control that would
    mark it; only the remove tool quietens. `canvasOptionRemoval()` is
    where REQ012's two-option floor is stated, and it returns its *reason*, so a
    disabled control can carry it into an accessible name rather than into a
    hover-only tooltip nothing but a mouse ever reads.
- **Authored slide text** — `src/components/SlideText.tsx` (REQ088/REQ089/REQ091).
  `parseSlideInline()` reads a heading's markup and `parseSlideText()` a body's
  blocks; `<SlideText variant="inline"|"blocks" size=…/>` is the one rendering
  worn by the editor's preview, the shared screen, every phone and the dry run;
  `SLIDE_TEXT_SCALE` is the size step as a shared `em` token and
  `SLIDE_TEXT_SIZE_OPTIONS` / `SLIDE_MARKDOWN_HINT` the one descriptor the editor
  offers it by. Never render `slide.question` or `slide.body` raw, and never
  re-derive the size from `slide.textSize` — ask `slideTextSizeFor()`: the one
  thing authored text has to be is the *same* text everywhere, and a surface that
  printed the stars a projector resolved would be showing a different slide.
  Two rules the module exists to keep:
  - **No HTML string is ever built.** The parser emits a typed node tree and
    React escapes every leaf, so `dangerouslySetInnerHTML` is not used here and
    must not be introduced. The only attacker-controlled attribute that reaches
    the DOM is a link's `href`, and `safeSlideLinkHref()` allowlists its scheme
    (`http`/`https`/`mailto`/`tel`) — a `javascript:` target does not become a
    defanged link, it does not become a link at all.
  - **A gist is not a slide.** Surfaces that *name* a slide rather than show it —
    `SlideRailItem`, `SlideThumbnail`, a `title` tooltip — take
    `slideTextToPlain()` instead, or a truncated rail row reads as the brackets
    it was typed with.
- **The deck's theme and its mark** — `src/components/DeckTheme.tsx`
  (REQ079/REQ080/REQ092/REQ135/REQ136). `DECK_THEME_APPEARANCE` is the single
  catalog of what each built-in theme looks like — palette in both colour
  schemes, the wash behind a slide — `deckBrandAppearance()` builds the same
  shape for a theme the deck authored for itself, and `DECK_FONT_STACKS` is the
  single catalog of the faces either kind may be set in. Between them they are
  the only place in the app that declares a theme colour or a font family.
  `<DeckThemeScope deck=…>` is the one place they reach the DOM: it writes those
  values onto the existing `--color-*` / `--font-*` vocabulary `index.css`
  already declares, so every Tailwind utility and hand-written rule in the
  subtree repaints itself and a surface is themed *by being wrapped* rather than
  by being rewritten. It is `display: contents`, so wrapping a page cannot move
  or reflow anything, and it re-declares `font-family` because `index.css`
  resolves the display face on `<html>` — a token rewritten underneath an
  already-computed family would change nothing.
  An authored theme is **three colours, not thirty**: the rest of the palette is
  derived along the canvas → text axis, and the colour scheme the organizer did
  *not* author is derived from the canvas's own hue, because the reader's
  light/dark preference stays theirs (REQ080). The derivation is pure and lives
  beside the catalog, so "what does this brand look like in light mode?" is
  answerable in a test without a DOM. A face is an **id** rather than a family
  string (REQ092): nothing here is fetched from a third-party host at runtime,
  so a theme may only
  name what the bundle ships or a generic stack — a family each machine looked up
  in its own font book would not be "the same face on every surface".
  `<DeckMark deck=…>` is the mark every participant-facing surface shows:
  `deckLogoFor()` resolves it (allowlisting the scheme, so a URL no `<img>` may
  be pointed at falls back to the product's pulse dot), and `fallback="none"`
  distinguishes a screen that already carries a mark to stand in for from one
  that does not. `deckThemeOptions()` and `deckFontOptions()` are the descriptors
  the editor's two pickers are built from. Never read `themeLogoUrl` or
  `themeBrand` off the deck and never declare a theme colour on a surface —
  `mise run check` fails the first two, and the third is how a room ends up
  half-repainted.
- **A slide's own appearance** — `src/components/SlideAppearance.tsx`
  (REQ087/REQ070/REQ071/REQ019), the layer *over* the deck's theme.
  `slideAppearanceFor()` (in `server/schemas.ts`, re-exported through
  `src/types.ts`) is the single read site for the four override fields —
  placement, background colour, background image, text and chart colours — and
  it is the guard as well: an unknown layout lands on one placement, a string
  that is not a colour becomes "the theme's", and a URL no browser should be
  pointed at becomes no picture at all. **Never read `slide.backgroundColor`,
  `slide.textColor`, `slide.chartColor`, `slide.layout` or
  `slide.backgroundImage` off the field.**
  `<SlideAppearanceScope deck= slide=>` is the one place the resolved values
  reach the DOM, and it works exactly as `<DeckThemeScope/>` does one layer down:
  the same `--color-*` vocabulary, `display: contents`, and a re-declared `color`
  because `index.css` resolves `--color-text` into a computed value high up the
  tree. `SLIDE_PLACEMENT_CLASSES` / `slidePlacementClasses()` is the single
  catalog of what a placement means in layout terms, and `slideLayoutOptions()`
  the descriptor the editor's picker is built from.
  Four rules the module exists to keep:
  - **Unauthored writes nothing.** A slide that overrode nothing emits no colour
    token at all, so it *is* the deck's theme — which is what makes re-theming a
    deck re-theme every slide that did not disagree.
  - **A colour brings its consequences, and only its own.** An authored *canvas*
    moves the borders, the raised surfaces, the void and — unless the slide
    authored them too — the words, through `surfaceRampTokens()` and
    `textRampTokens()`, the same derivations a deck brand uses. An authored *text
    colour* moves the words and nothing else: the surfaces follow from a canvas
    that slide never touched, and a built-in theme's neutrals are hand-authored,
    so re-deriving them would swap a tuned value for an approximation of itself.
  - **A derived caption is never quieter than it can be read.** The muted and dim
    steps are the words walked back towards the canvas, and the mix weights are
    calibrated for a canvas and its words being far apart — true of a deck brand
    by construction, and exactly what a slide may break. The slide layer therefore
    passes `SLIDE_TEXT_MIN_CONTRAST` (4.5 for a muted caption, 3 for a dim label)
    and each step is walked back towards the words until it clears its floor
    against the canvas it sits on. The floor is on the derivation, not on the
    organizer: text authored against a canvas that swallows it stays as authored
    (that is REQ132's job to report), and the quieter steps simply collapse onto
    it rather than being invented brighter than what they came from.
  - **The picture never wins over the words.** `slideScrimFor()` picks the scrim
    over a background image *against the text that sits on it* and checks the
    contrast (AA 4.5) rather than assuming it; an authored text colour is honoured
    on an image only when it passes. The check is against the **worst backdrop
    that scrim can produce** — its weakest alpha over the most hostile picture —
    not against the pure tone, so the number is a floor a reader actually gets;
    both fallback pairings clear it by a wide margin, which is what makes it a
    guarantee rather than an approximation. The values are written as
    `--slide-scrim` / `--slide-overlay-text` / `--slide-overlay-shadow`, which
    `.slide-scrim` and `.slide-title-overlay` in `index.css` resolve with the
    per-scheme fallbacks a surface outside any scope gets.
  Two surfaces wear the layer partially, on purpose: the editor's **filmstrip**
  takes the background but not the text or chart colours (it is editor chrome and
  stays in the app's own theme), and the **shared results page** applies the scope
  — so REQ019's colours reach its charts — but draws no `SlideBackground`, so a
  slide's background colour and image are not repeated there.
  The colour arithmetic both layers share lives in `src/components/color.ts` —
  parse/format, mixing, HSL, WCAG luminance and contrast — with no dependency on
  either theming module, which is what makes every derivation above it
  assertable without a DOM.
- **An authored colour, as a control** — `ColorField` in
  `src/components/EditorControls.tsx`. One field for both theming layers: a swatch
  that opens the platform's picker, a box that takes the hex a brand guide is
  written in, and a Clear button, because a `<input type="color">` cannot express
  "unset" and unset is the value that means *inherit*. It states what the resolver
  will make of a half-typed colour, and what stands while nothing is authored.
- **Preview entry** — `src/components/PreviewLink.tsx` is the single control that
  opens a dry run, composed by the editor and the presenter's screen. It is
  offered whether or not the browser holds the deck, disabled with its reason:
  a preview reads the deck's answer keys, so it needs the same
  credential an edit does.
- **The deck's read-only results link** — `src/components/ResultsLinkDialog.tsx`
  (REQ098). One dialog for the whole capability — mint, copy, revoke — because
  they are three views of one question (*does this deck currently hand out its
  results?*), and splitting them across the chrome would let a presenter revoke a
  link without ever being told one existed. `resultsLinkView()` is the pure half:
  it resolves the server's status against the token this browser happens to hold
  into what can actually be offered, including the state nobody expects — a link
  that is **active but not held here**, which cannot be copied (only its hash is
  stored) and can only be replaced. It hangs off a chip on the presenter's
  results group, beside Export and Reset rather than in the join-code cluster:
  that cluster hands out ways *into* the deck, and this hands out a read of what
  came out of it. What the link opens is
  `src/pages/SharedResultsPage.tsx` at `/results/:id`, which composes
  `ResultsDisplay` per slide and carries no control of any kind — see
  [api.md](api.md#the-shareable-results-link-req098) for what the token does and
  does not authorize.
- **Taking the session out of the building** — `src/components/ExportDialog.tsx`
  (REQ095, REQ096). `DECK_EXPORT_FORMATS` is the single descriptor of the shapes
  a deck leaves in — the workbook to analyse it, the PDF with its results, the
  PDF of the deck alone — each entry carrying its own label, one-line summary,
  icon and download call; `<ExportDialog/>` is the one surface that composes it,
  and `exportButtonLabel()` beside it is the accessible name of the chip that
  opens it (the chip carries an icon and no text, so that string is the whole
  control). A format added later — REQ097's slide images — is a row in that
  array and nothing else. It is a dialog rather than three chips because "which
  shape?" is one question with several answers, and this row of the presenter's
  chrome has no space to say what any of them is; every row is drawn whatever
  the answer, disabled with its reason, and it sits on the results
  group beside Reset because what an export takes out is the session.
- **Saving a file** — `src/download.ts`. `saveBlobAs()` is the one anchor-click
  that puts bytes in a download folder, worn by the deck list's JSON export and
  by every format in the export dialog above (REQ095/REQ096);
  `filenameFromContentDisposition()` reads the name a *server-generated* file was
  served under, so a download saves the file the endpoint named rather than a
  second guess at the same slug. The fetch itself is one helper too —
  `downloadExport()` in `src/api.ts`, which `api.downloadResults()` and
  `api.downloadDeckPdf()` both compose: same edit token, same JSON reading of a
  failure, same filename rule. Never hand-roll `URL.createObjectURL` + anchor
  per surface — two copies is how one of them forgets to revoke its object URL
  and pins the file in memory.
  The title→filename slug is **not** here: `deckFilenameSlug()` lives in
  `server/schemas.ts` (re-exported through `src/types.ts`) because both sides of
  the wire name a download after the same deck, and one rule is what keeps the
  JSON export, the results workbook and the deck's PDF agreeing on it.

`mise run check` runs `scripts/guard-frontend-conventions.ts`, which fails the
build when a surface bypasses one of these primitives.

## What this browser holds — `src/storage.ts`

Every `localStorage` key the app writes is declared in **`src/storage.ts`**, and
nowhere else. Import the constant; never spell a key at its read site.

The reason it is one module rather than a constant beside each consumer is what
these keys hold: a deck's edit token is returned once and stored on the server
only as a hash, so the copy under `omul-tokens` is the only one there is. A key
that a refactor got wrong is a presentation its organizer can never edit again,
from any browser, with no error to read and no recovery path.

One reader cannot import the module: the inline script in `src/index.html`
paints the colour scheme before the bundle loads, so a reload does not flash the
wrong one, and it therefore spells `omul-theme` itself. It is the one place in
the client where a key is written outside `src/storage.ts`.

## Code style — no linter, no formatter

The repo carries **no lint or format tooling**. Nothing will reformat your code
and nothing will flag a style drift, so the only thing holding the codebase
consistent is reading the file you are editing before you write into it:

- Tabs for indentation, double-quoted strings, semicolons, trailing commas in
  multi-line literals.
- `mise run check` is the read-only gate. It runs the convention guards and the
  requirement checks — it does **not** look at formatting.

## Deliberate deviations — declared at the site

A handful of places knowingly depart from the obvious React or a11y pattern.
Each carries its reasoning as a comment at the occurrence; the table below and
those comments are one authority — if they disagree, fix the drift.

| Site | What it does | Why it stands |
|---|---|---|
| `ConfirmModal.tsx` / `Modal.tsx` — backdrop `<div>` | Click (and Escape, in `Modal`) dismisses, with no ARIA role | The focusable Cancel button is the keyboard path out; a role plus its own key handler would add a second, redundant "Cancel" to the tab order |
| `ConfirmModal.tsx` / `Modal.tsx` / `PresenterPage.tsx` — panel `<div>` | `onClick` that only calls `stopPropagation` | Not an affordance — there is no user action here to give a keyboard equivalent to |
| `PresenterPage.tsx` — results-poll `useEffect` | Deps narrower than the captures | The 3s poll must restart only when *what* is polled changes, not on every new `pres` object from the store |
| `PresenterPage.tsx` — `handleKeyDown` `useCallback` | Omits `handleSlide` from the deps | `handleSlide` is render-unstable; listing it would re-subscribe the window keydown listener every render |
| `Results.tsx` — poll dot cluster | Array index as `key` | Dots come from a bare count, so the index *is* the identity; the fly-in animation depends on the DOM node surviving across renders |
| `CreatePage.tsx` / `JoinPage.tsx` — first input | `autoFocus` | Intentional: the title of a new deck and the join code are the one thing the page is for |
| `PresenterNotes.tsx` — the strip's open editor | `autoFocus` | The box exists only because the author just clicked the strip open (REQ156); focusing it finishes their gesture rather than stealing focus from one |
| `src/api.ts`, `Results.tsx`, `server/routes/presentations.ts` | `any` in the `request<T>` client and the results shapes | Typing the API client end-to-end is its own piece of work, not a drive-by |
| `SlideText.tsx` — parsed markup nodes | Array index as `key` | A parsed node is addressed by position and nothing else — two identical `**bold**` runs in one sentence differ only by their neighbours — and nothing in the tree is reordered or kept across renders |

Do not "fix" these on their merits — that is separate, explicitly-requested
work. If you do fix one, delete its comment and its row here together.
