# Requirements

Generated index of [`requirements/`](requirements/), the catalog of source-code
requirements — one row per file in that directory, with the category, priority
and triage status each file declares, and the business requirement it derives
from: `BRxxx` in a private documentation sidecar, or `internal` where this
codebase raised the requirement itself.

The rows between the markers are written by `index build`; never edit
them by hand, and never write a second listing of `requirements/` anywhere else.
Prose outside the markers is preserved.

- **Counts** — status, priority and category breakdowns are computed on demand
  by `bun scripts/triage.ts stats`, not kept here.
- **Filtering** — `bun scripts/triage.ts list --category Quiz --priority P1`.
- **File format** — [README.md](README.md).

<!-- index:start fields=category,priority,status,source -->
| File | Summary | Category | Priority | Status | Source |
| --- | --- | --- | --- | --- | --- |
| [REQ001.md](requirements/REQ001.md) | Create an empty presentation | Deck & Slides | P0 | done | BR001 |
| [REQ002.md](requirements/REQ002.md) | Create a quiz-shaped deck | Deck & Slides | P0 | done | BR002 |
| [REQ003.md](requirements/REQ003.md) | Create an audience-paced deck | Deck & Slides | P0 | done | BR003 |
| [REQ004.md](requirements/REQ004.md) | Publish a deck as a workspace template | Accounts & Workspaces | P1 | done | BR004 |
| [REQ005.md](requirements/REQ005.md) | Template library | Deck & Slides | P1 | done | BR005 |
| [REQ006.md](requirements/REQ006.md) | Create a deck from a template | Deck & Slides | P1 | done | BR006 |
| [REQ007.md](requirements/REQ007.md) | Generate a draft deck from a prompt | Deck & Slides | P1 | done | BR007 |
| [REQ008.md](requirements/REQ008.md) | Add a slide | Deck & Slides | P0 | done | BR008 |
| [REQ009.md](requirements/REQ009.md) | Multiple choice slide | Question Types | P0 | done | BR009 |
| [REQ010.md](requirements/REQ010.md) | Result visualization per question | Question Types | P1 | done | BR010 |
| [REQ011.md](requirements/REQ011.md) | Counts or percentages in a tally | Question Types | P1 | done | BR011 |
| [REQ012.md](requirements/REQ012.md) | Manage multiple-choice options | Question Types | P1 | done | BR012 |
| [REQ013.md](requirements/REQ013.md) | Mark options correct | Question Types | P1 | done | BR013 |
| [REQ014.md](requirements/REQ014.md) | Allow multiple selections | Question Types | P1 | done | BR014 |
| [REQ015.md](requirements/REQ015.md) | Publish the tally as answers land | Live Session | P1 | done | BR015 |
| [REQ016.md](requirements/REQ016.md) | Publish the tally on the presenter's reveal | Live Session | P1 | done | BR016 |
| [REQ017.md](requirements/REQ017.md) | Collect answers with no audience-facing tally | Live Session | P1 | done | BR017 |
| [REQ018.md](requirements/REQ018.md) | Apply one reveal mode to the whole deck | Live Session | P1 | done | BR018 |
| [REQ019.md](requirements/REQ019.md) | Per-slide element colors | Rendering & Theming | P2 | done | BR019 |
| [REQ020.md](requirements/REQ020.md) | Segment a tally by an earlier question | Results & Export | P2 | done | BR020 |
| [REQ021.md](requirements/REQ021.md) | Word cloud slide | Question Types | P0 | done | BR021 |
| [REQ022.md](requirements/REQ022.md) | Response cap per participant on open input | Question Types | P1 | done | BR022 |
| [REQ023.md](requirements/REQ023.md) | Open-ended slide | Question Types | P0 | done | BR023 |
| [REQ024.md](requirements/REQ024.md) | Open-ended result layout | Question Types | P1 | done | BR024 |
| [REQ025.md](requirements/REQ025.md) | Upvote open-ended answers | Question Types | P1 | done | BR025 |
| [REQ026.md](requirements/REQ026.md) | Repeated submissions on open input | Live Session | P1 | done | BR026 |
| [REQ027.md](requirements/REQ027.md) | Remove a submitted answer | Live Session | P2 | done | BR027 |
| [REQ028.md](requirements/REQ028.md) | Scales slide | Question Types | P1 | done | BR028 |
| [REQ029.md](requirements/REQ029.md) | Multiple statements on one scale | Question Types | P1 | done | BR029 |
| [REQ030.md](requirements/REQ030.md) | Mean per statement | Question Types | P1 | done | BR030 |
| [REQ031.md](requirements/REQ031.md) | Skippable scale statements | Question Types | P1 | done | BR031 |
| [REQ032.md](requirements/REQ032.md) | Scale bounds and labels | Question Types | P1 | done | BR032 |
| [REQ033.md](requirements/REQ033.md) | Ranking slide | Question Types | P1 | done | BR033 |
| [REQ034.md](requirements/REQ034.md) | Ranking items | Question Types | P1 | done | BR034 |
| [REQ035.md](requirements/REQ035.md) | Q&A layer | Q&A | P0 | done | BR035 |
| [REQ036.md](requirements/REQ036.md) | Enable Q&A for a deck | Q&A | P1 | done | BR036 |
| [REQ037.md](requirements/REQ037.md) | Audience visibility of the question list | Q&A | P1 | done | BR037 |
| [REQ038.md](requirements/REQ038.md) | Approve questions before publication | Q&A | P2 | pending | BR038 |
| [REQ039.md](requirements/REQ039.md) | Guess-the-number slide | Question Types | P2 | done | BR039 |
| [REQ040.md](requirements/REQ040.md) | Guess-the-number range | Question Types | P1 | done | BR040 |
| [REQ041.md](requirements/REQ041.md) | Guess-the-number reference value | Question Types | P1 | done | BR041 |
| [REQ042.md](requirements/REQ042.md) | Guess-the-number tolerance | Question Types | P1 | done | BR042 |
| [REQ043.md](requirements/REQ043.md) | Guess-the-number step | Question Types | P1 | done | BR043 |
| [REQ044.md](requirements/REQ044.md) | 100-points slide | Question Types | P1 | done | BR044 |
| [REQ045.md](requirements/REQ045.md) | 100-points items | Question Types | P1 | done | BR045 |
| [REQ046.md](requirements/REQ046.md) | 2×2 grid slide | Question Types | P1 | done | BR046 |
| [REQ047.md](requirements/REQ047.md) | 2×2 grid items | Question Types | P1 | done | BR047 |
| [REQ048.md](requirements/REQ048.md) | 2×2 grid axis titles | Question Types | P1 | done | BR048 |
| [REQ049.md](requirements/REQ049.md) | 2×2 grid axis endpoints | Question Types | P1 | done | BR049 |
| [REQ050.md](requirements/REQ050.md) | Skippable grid items | Question Types | P1 | done | BR050 |
| [REQ051.md](requirements/REQ051.md) | Pin-on-image slide | Question Types | P1 | done | BR051 |
| [REQ052.md](requirements/REQ052.md) | Pin-on-image picture | Question Types | P1 | done | BR052 |
| [REQ053.md](requirements/REQ053.md) | Pin-on-image target area | Question Types | P1 | done | BR053 |
| [REQ054.md](requirements/REQ054.md) | Quiz question, option answer | Quiz & Scoring | P1 | done | BR054 |
| [REQ055.md](requirements/REQ055.md) | Quiz question, typed answer | Quiz & Scoring | P1 | done | BR055 |
| [REQ056.md](requirements/REQ056.md) | Automatic scoring | Quiz & Scoring | P1 | done | BR056 |
| [REQ057.md](requirements/REQ057.md) | Answer window per quiz question | Quiz & Scoring | P1 | done | BR057 |
| [REQ058.md](requirements/REQ058.md) | Quiz audio cue | Quiz & Scoring | P3 | pending | BR058 |
| [REQ059.md](requirements/REQ059.md) | Leaderboard slide | Quiz & Scoring | P1 | done | BR059 |
| [REQ060.md](requirements/REQ060.md) | Question upvotes and answered state | Q&A | P1 | done | BR060 |
| [REQ061.md](requirements/REQ061.md) | Form slide | Question Types | P1 | done | BR061 |
| [REQ062.md](requirements/REQ062.md) | Text slide | Deck & Slides | P0 | done | BR062 |
| [REQ063.md](requirements/REQ063.md) | Image slide | Deck & Slides | P0 | done | BR063 |
| [REQ064.md](requirements/REQ064.md) | Video slide | Deck & Slides | P1 | done | BR064 |
| [REQ065.md](requirements/REQ065.md) | Join instruction slide | Deck & Slides | P0 | done | BR065 |
| [REQ066.md](requirements/REQ066.md) | Embed a PowerPoint deck | Integrations | P1 | done | BR066 |
| [REQ067.md](requirements/REQ067.md) | Embed a Google Slides deck | Integrations | P1 | done | BR067 |
| [REQ068.md](requirements/REQ068.md) | Embed a Miro board | Integrations | P2 | done | BR068 |
| [REQ069.md](requirements/REQ069.md) | Slide images and GIFs | Deck & Slides | P0 | done | BR069 |
| [REQ070.md](requirements/REQ070.md) | Per-slide background color | Rendering & Theming | P2 | done | BR070 |
| [REQ071.md](requirements/REQ071.md) | Per-slide background image | Rendering & Theming | P2 | done | BR071 |
| [REQ072.md](requirements/REQ072.md) | QR code for the join link | Access & Sharing | P0 | done | BR072 |
| [REQ073.md](requirements/REQ073.md) | Toggle the join bar | Access & Sharing | P2 | pending | BR073 |
| [REQ074.md](requirements/REQ074.md) | Comments on slides | Accounts & Workspaces | P1 | done | BR074 |
| [REQ075.md](requirements/REQ075.md) | Invite collaborators to a deck | Accounts & Workspaces | P1 | done | BR075 |
| [REQ076.md](requirements/REQ076.md) | Participant names | Live Session | P2 | done | BR076 |
| [REQ077.md](requirements/REQ077.md) | Reactions on any slide | Live Session | P1 | done | BR077 |
| [REQ078.md](requirements/REQ078.md) | Live chat | Live Session | P1 | done | BR078 |
| [REQ079.md](requirements/REQ079.md) | Built-in themes | Rendering & Theming | P1 | done | BR079 |
| [REQ080.md](requirements/REQ080.md) | Custom themes | Rendering & Theming | P2 | done | BR080 |
| [REQ081.md](requirements/REQ081.md) | Presenter-paced mode | Live Session | P0 | done | BR081 |
| [REQ082.md](requirements/REQ082.md) | Audience-paced mode | Live Session | P0 | done | BR082 |
| [REQ083.md](requirements/REQ083.md) | Repeat runs per device in audience-paced mode | Live Session | P2 | pending | BR083 |
| [REQ084.md](requirements/REQ084.md) | Presentation language | Rendering & Theming | P0 | done | BR084 |
| [REQ085.md](requirements/REQ085.md) | Profanity filter on free text | Live Session | P2 | pending | BR085 |
| [REQ086.md](requirements/REQ086.md) | Workspace default theme | Accounts & Workspaces | P2 | pending | BR086 |
| [REQ087.md](requirements/REQ087.md) | Per-slide layout | Rendering & Theming | P1 | done | BR087 |
| [REQ088.md](requirements/REQ088.md) | Links in slide text | Rendering & Theming | P1 | done | BR088 |
| [REQ089.md](requirements/REQ089.md) | Markdown in slide text | Rendering & Theming | P1 | done | BR089 |
| [REQ090.md](requirements/REQ090.md) | Presenter notes | Deck & Slides | P1 | done | BR090 |
| [REQ091.md](requirements/REQ091.md) | Text size | Rendering & Theming | P1 | done | BR091 |
| [REQ092.md](requirements/REQ092.md) | Font family | Rendering & Theming | P2 | done | BR092 |
| [REQ093.md](requirements/REQ093.md) | Math notation | Rendering & Theming | P2 | pending | BR093 |
| [REQ094.md](requirements/REQ094.md) | Results surface | Results & Export | P0 | done | BR094 |
| [REQ095.md](requirements/REQ095.md) | Spreadsheet export | Results & Export | P1 | done | BR095 |
| [REQ096.md](requirements/REQ096.md) | PDF export | Results & Export | P1 | done | BR096 |
| [REQ097.md](requirements/REQ097.md) | Slide image export | Results & Export | P2 | pending | BR097 |
| [REQ098.md](requirements/REQ098.md) | Shareable results link | Access & Sharing | P1 | done | BR098 |
| [REQ099.md](requirements/REQ099.md) | Email the results link to a participant | Results & Export | P2 | pending | BR099 |
| [REQ100.md](requirements/REQ100.md) | Sessions and trends | Results & Export | P2 | pending | BR100 |
| [REQ101.md](requirements/REQ101.md) | Reset results | Results & Export | P1 | done | BR101 |
| [REQ102.md](requirements/REQ102.md) | Reveal control during a session | Live Session | P0 | done | BR102 |
| [REQ103.md](requirements/REQ103.md) | Preview | Live Session | P1 | done | BR103 |
| [REQ104.md](requirements/REQ104.md) | Test answers | Live Session | P1 | done | BR104 |
| [REQ105.md](requirements/REQ105.md) | Presenter surface | Live Session | P0 | done | BR105 |
| [REQ106.md](requirements/REQ106.md) | Mobile presenter remote | Live Session | P2 | pending | BR106 |
| [REQ107.md](requirements/REQ107.md) | Countdown slide | Deck & Slides | P2 | pending | BR107 |
| [REQ108.md](requirements/REQ108.md) | Session timer | Live Session | P2 | pending | BR108 |
| [REQ109.md](requirements/REQ109.md) | Blank the audience view | Live Session | P3 | done | BR109 |
| [REQ110.md](requirements/REQ110.md) | Skip a slide | Deck & Slides | P3 | pending | BR110 |
| [REQ111.md](requirements/REQ111.md) | Open and close participation per slide | Live Session | P2 | done | BR111 |
| [REQ112.md](requirements/REQ112.md) | Join code lifetime | Access & Sharing | P3 | pending | BR112 |
| [REQ113.md](requirements/REQ113.md) | Insights over collected answers | Results & Export | P2 | pending | BR113 |
| [REQ114.md](requirements/REQ114.md) | Group free-text answers | Results & Export | P2 | pending | BR114 |
| [REQ115.md](requirements/REQ115.md) | Summarize free-text answers | Results & Export | P2 | pending | BR115 |
| [REQ116.md](requirements/REQ116.md) | Segmented result views | Results & Export | P2 | done | BR116 |
| [REQ117.md](requirements/REQ117.md) | Direct join link | Access & Sharing | P0 | done | BR117 |
| [REQ118.md](requirements/REQ118.md) | Join screen with code, link and QR | Access & Sharing | P0 | done | BR118 |
| [REQ119.md](requirements/REQ119.md) | Embeddable presentation | Access & Sharing | P2 | pending | BR119 |
| [REQ120.md](requirements/REQ120.md) | Import a presentation file | Integrations | P1 | pending | BR120 |
| [REQ121.md](requirements/REQ121.md) | Drive interactive slides from PowerPoint | Integrations | P1 | pending | BR121 |
| [REQ122.md](requirements/REQ122.md) | Microsoft Teams app | Integrations | P1 | pending | BR122 |
| [REQ123.md](requirements/REQ123.md) | Zoom app | Integrations | P1 | pending | BR123 |
| [REQ124.md](requirements/REQ124.md) | Screen-shared remote sessions | Live Session | P2 | pending | BR124 |
| [REQ125.md](requirements/REQ125.md) | Concurrent sessions | Live Session | P3 | pending | BR125 |
| [REQ126.md](requirements/REQ126.md) | Shared editing of decks and folders | Accounts & Workspaces | P1 | pending | BR126 |
| [REQ127.md](requirements/REQ127.md) | Bulk slide operations | Deck & Slides | P2 | pending | BR127 |
| [REQ128.md](requirements/REQ128.md) | Workspace-owned decks | Accounts & Workspaces | P2 | done | BR128 |
| [REQ129.md](requirements/REQ129.md) | Workspace roles | Accounts & Workspaces | P2 | done | BR129 |
| [REQ130.md](requirements/REQ130.md) | Workspace settings | Accounts & Workspaces | P2 | pending | BR130 |
| [REQ131.md](requirements/REQ131.md) | Reduced-capability member role | Accounts & Workspaces | P2 | pending | BR131 |
| [REQ132.md](requirements/REQ132.md) | Accessibility check | Rendering & Theming | P2 | pending | BR132 |
| [REQ133.md](requirements/REQ133.md) | Per-passage language marking | Rendering & Theming | P3 | pending | BR133 |
| [REQ134.md](requirements/REQ134.md) | Require an authenticated participant | Access & Sharing | P2 | pending | BR134 |
| [REQ135.md](requirements/REQ135.md) | Organization branding on a deck | Rendering & Theming | P1 | done | BR135 |
| [REQ136.md](requirements/REQ136.md) | Custom logo | Rendering & Theming | P1 | done | BR136 |
| [REQ137.md](requirements/REQ137.md) | Single sign-on | Accounts & Workspaces | P1 | pending | BR137 |
| [REQ138.md](requirements/REQ138.md) | Directory provisioning | Accounts & Workspaces | P2 | pending | BR138 |
| [REQ139.md](requirements/REQ139.md) | Workspace-level access control | Accounts & Workspaces | P2 | pending | BR139 |
| [REQ140.md](requirements/REQ140.md) | Data retention window | Platform & Operations | P2 | pending | BR140 |
| [REQ141.md](requirements/REQ141.md) | Workspace usage reporting | Accounts & Workspaces | P2 | pending | BR141 |
| [REQ144.md](requirements/REQ144.md) | Workspace subscription and seats | Accounts & Workspaces | P2 | pending | BR144 |
| [REQ145.md](requirements/REQ145.md) | Abuse limits on the account-free routes | Platform & Operations | P1 | done | internal |
| [REQ146.md](requirements/REQ146.md) | Deleting a presentation must erase the participant data keyed to it | Platform & Operations | P1 | done | internal |
| [REQ147.md](requirements/REQ147.md) | A quiz answer must stay final when two submissions arrive at once | Quiz & Scoring | P1 | done | internal |
| [REQ148.md](requirements/REQ148.md) | The Word Cloud / Open Ended response cap must hold under concurrent submissions | Live Session | P2 | done | internal |
| [REQ149.md](requirements/REQ149.md) | The presenter screen must recognize an account owner who holds no local edit token | Access & Sharing | P2 | done | internal |
| [REQ150.md](requirements/REQ150.md) | A slide's live tally must not cost one full-room broadcast per individual answer | Live Session | P2 | done | internal |
| [REQ151.md](requirements/REQ151.md) | The /api discovery index must advertise an origin clients can actually reach | Platform & Operations | P2 | done | internal |
| [REQ152.md](requirements/REQ152.md) | The editor's stage renders the slide being edited, at every viewport width | Deck & Slides | P1 | done | BR145 |
| [REQ153.md](requirements/REQ153.md) | Question and answer options are authored in place on the canvas | Deck & Slides | P1 | done | BR145 |
| [REQ154.md](requirements/REQ154.md) | The canvas previews results through the real renderers | Deck & Slides | P1 | done | BR145 |
| [REQ155.md](requirements/REQ155.md) | Slide settings compact to a single side column | Deck & Slides | P1 | done | BR145 |
| [REQ156.md](requirements/REQ156.md) | Presenter notes are a strip under the canvas | Deck & Slides | P2 | done | BR145 |
| [REQ157.md](requirements/REQ157.md) | Editor structural text meets AA contrast | Rendering & Theming | P1 | done | internal |
| [REQ158.md](requirements/REQ158.md) | PDF export renders text outside Latin-1 | Results & Export | P2 | pending | internal |
| [REQ159.md](requirements/REQ159.md) | Rendering a deck must cost time proportional to what a deck may hold | Platform & Operations | P0 | done | internal |
| [REQ160.md](requirements/REQ160.md) | A slide comment lands on the slide it was written about | Accounts & Workspaces | P0 | done | internal |
| [REQ161.md](requirements/REQ161.md) | The repository carries a license and a provenance claim it can stand behind | Platform & Operations | P0 | in-progress | internal |
| [REQ162.md](requirements/REQ162.md) | A published repository has a reporting path and a contribution surface | Platform & Operations | P0 | in-progress | internal |
| [REQ163.md](requirements/REQ163.md) | The publishable tree carries no internal-estate or deployment detail | Platform & Operations | P0 | in-progress | internal |
| [REQ164.md](requirements/REQ164.md) | The administrator allowlist is deployment-supplied, not compiled in | Platform & Operations | P0 | done | internal |
| [REQ165.md](requirements/REQ165.md) | Publication ships a fresh repository, because this remote still serves an unreferenced commit | Platform & Operations | P0 | pending | internal |
| [REQ166.md](requirements/REQ166.md) | Application chrome carries the neutral-base blue-accent colour direction | Rendering & Theming | P1 | done | BR146 |
| [REQ167.md](requirements/REQ167.md) | Product surfaces carry the drawn omul wordmark and ring signet | Rendering & Theming | P1 | done | BR146 |
| [REQ168.md](requirements/REQ168.md) | House deck theme carries the neutral-base blue-accent colour direction | Rendering & Theming | P1 | done | BR146 |
| [REQ169.md](requirements/REQ169.md) | The product's fallback mark on participant surfaces is the ring signet | Rendering & Theming | P1 | done | BR146 |
| [REQ170.md](requirements/REQ170.md) | The brand marks in the tree carry a use position the code license does not grant | Platform & Operations | P0 | done | internal |
| [REQ171.md](requirements/REQ171.md) | The auth signing secret fails closed outside development instead of falling back to a shipped placeholder | Platform & Operations | P0 | done | internal |
| [REQ172.md](requirements/REQ172.md) | A stranger can run a production instance from this repository alone | Platform & Operations | P0 | in-progress | internal |
| [REQ173.md](requirements/REQ173.md) | A full-history secret scan over this repository returns nothing | Platform & Operations | P0 | blocked | internal |
| [REQ174.md](requirements/REQ174.md) | The server's configuration surface and database filenames are named for the product | Platform & Operations | P2 | done | BR147 |
| [REQ175.md](requirements/REQ175.md) | The names on the wire, in browser storage and in an exported file carry the product's name | Access & Sharing | P2 | done | BR147 |
| [REQ176.md](requirements/REQ176.md) | The working name is gone from the tree, history included | Platform & Operations | P2 | done | BR147 |
| [REQ177.md](requirements/REQ177.md) | The storage layer is the published zodstore package, not a vendored snapshot | Platform & Operations | P2 | done | internal |
| [REQ178.md](requirements/REQ178.md) | The app is set in one sans typeface, Figtree | Rendering & Theming | P2 | done | internal |

_176 entries — one row per file in `requirements/`._
<!-- index:end -->
