# Notices

omul
Copyright (c) 2026 Enrico Scherlies

This product is licensed under the GNU Affero General Public License, version
3 only, or under a separate commercial agreement — see
[LICENSE-AGPL-3.0](LICENSE-AGPL-3.0) and [LICENSE-COMMERCIAL](LICENSE-COMMERCIAL).
The SPDX expression for the pair is `AGPL-3.0-only OR LicenseRef-omul-Commercial`.

This file enumerates everything in this distribution that the line above does
not settle on its own: the brand marks, the storage layer, the bundled webfonts
and the third-party dependency set. It is the license position for the whole
tree that ships, not a summary of it.

What "ships" means here, since the answers differ per surface:

| Surface | What it is |
| --- | --- |
| the source tree | this repository, as cloned |
| the built client | `dist/client/` — the browser bundle, the webfonts and everything copied out of `public/` |
| the built server | `dist/server/index.js` — one bundle, with its runtime dependencies inlined |
| the container image | the built client and server, `public/`, and the license files at the image root |

---

## 1. Brand marks — trademark rights reserved

The eight files under `public/brand/`, and the wordmark geometry drawn in
`src/components/BrandMark.tsx`, carry a position of their own in
[TRADEMARK.md](TRADEMARK.md), which lists them by path and by name.

It is a **reservation of trademark rights under AGPL-3.0 §7(e)**, not a
copyright carve-out: the copyright grant at the top of this file covers those
files like any others, so you may redistribute them with the source. What is
not granted is the right to use the mark to identify a build. The short
version: if you change the code, change the mark.

## 2. Storage layer — `@binaryplease/zodstore`, MIT

**An ordinary registry dependency, under the MIT License.** The SQLite document
store this product persists to is installed from npm as
[`@binaryplease/zodstore`](https://www.npmjs.com/package/@binaryplease/zodstore)
and is counted in section 6 like every other dependency. It is written by the
same author who holds copyright in this repository, so the copyright line below
is the same one at the top of this file — but the grant it travels under is its
own, and this repository claims nothing further over it.

It is not a vendored source tree any more. Until 2026-08-31 an older,
pre-release snapshot of it sat at `vendor/binp-docstore/` as a `file:`
dependency, distributed under this repository's own license because that
snapshot predated the upstream `LICENSE`; the standing follow-up recorded here
was to replace it with the published package once one existed, and this entry
is that replacement. Nothing under `vendor/` remains.

The library is inlined into `dist/server/index.js`, so the MIT notice travels
with the built server and the container image. It is reproduced in full here,
which is what that requires:

> MIT License
>
> Copyright (c) 2026 Enrico Scherlies
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

MIT is compatible with distribution under the AGPL-3.0, so the combined work
conveys under the license at the top of this file with the notice above kept
intact.

## 3. Webfonts — SIL Open Font License 1.1

These typefaces ship inside the built client as `.woff2`/`.woff`/`.ttf` files
under `dist/client/assets/`, pulled in by `src/index.css` — all but Noto Sans,
Sarasa Gothic and Unifont, which ship beside the built server instead (see
below):

| Font | Package | Copyright | License |
| --- | --- | --- | --- |
| Figtree | `@fontsource-variable/figtree` | Copyright 2022 The Figtree Project Authors | OFL-1.1 |
| DM Mono | `@fontsource/dm-mono` | Copyright 2020 The DM Mono Project Authors | OFL-1.1 |
| KaTeX's twelve math faces — KaTeX_AMS, \_Caligraphic, \_Fraktur, \_Main, \_Math, \_SansSerif, \_Script, \_Size1–4, \_Typewriter | `katex` | Copyright (c) 2009-2010 Design Science, Inc.; Copyright (c) 2014-2018 Khan Academy | OFL-1.1, each face's name reserved |
| Noto Sans, Regular and Bold | vendored, `server/fonts/` (release NotoSans-v2.015, hinted TTF) | Copyright 2022 The Noto Project Authors | OFL-1.1 |
| Sarasa Gothic SC, Regular | vendored, `server/fonts/` (release v1.0.42, hinted TTF) | Copyright (c) 2015-2025, Renzhi Li; portions Copyright (c) 2016 The Inter Project Authors, (c) 2014-2021 Adobe Systems Incorporated with Reserved Font Name 'Source', (c) 2012 Google Inc. | OFL-1.1 |
| GNU Unifont and Unifont Upper | vendored, `server/fonts/` (release 15.0.06, TrueType) | Copyright © 1998-2023 Roman Czyborra, Paul Hardy, Qianqian Fang, Andrew Miller, Johnnie Weaver, David Corbett, Nils Moskopp, Rebecca Bettencourt, Minseo Lee, et al. | OFL-1.1 (dual-licensed with GPL-2.0-or-later plus the GNU font embedding exception; used under the OFL) |

The KaTeX faces typeset slide formulas (REQ093). They are worth a sentence of
their own because the package that brings them declares **MIT**, which is the
license of KaTeX's code: the font files inside it say OFL-1.1 in their own
name tables, and that is the license they travel under. A browser downloads one
only when a formula on screen needs it.

Noto Sans sets the text of the deck PDF export (REQ158), Sarasa Gothic SC sets
the Chinese, Japanese and Korean in it, and Unifont the emoji. None is ever
served to a browser: `bun build` copies the five `.ttf` files into
`dist/server/` beside the bundle that reads them, and each exported PDF embeds
a subset of the glyphs it draws — which the OFL permits for documents made with
the font. Sarasa Gothic is used under its own name, which is not the reserved
name 'Source' that one of its upstream portions carries. Unifont is offered
under two licenses at the recipient's choice since its 13.0.04 release; this
distribution takes the OFL, which is why it is listed here with the others, and
declares no reserved font name.

The OFL requires the copyright notice and the license text to travel with the
font files. They do: the notices and the full license text are in
[`public/licenses/OFL-1.1-fonts.txt`](public/licenses/OFL-1.1-fonts.txt), which
Vite copies into `dist/client/licenses/` alongside the fonts and which the
running server serves at `/app/licenses/OFL-1.1-fonts.txt` — under the app's
base path, with the rest of the built client (REQ179). The container image
carries it by the same route, through `COPY public ./public`.

No typeface is modified, renamed or sold on its own — for the KaTeX faces, whose
names are reserved, that is also what lets them keep the names they ship with.

## 4. Everything else in `public/` and `src/`

Original work by the copyright holder, under the license at the top of this
file — with the single exception of the brand marks in section 1. No
third-party artwork, icon set, seed data, sample content or copy-pasted snippet
is vendored into either directory. Icons are drawn at runtime by
`lucide-react`, an ISC-licensed dependency (section 6), not copied into the
tree.

The three quiz audio tracks in `public/audio/` (REQ058) belong to this section:
they were synthesized for this repository with ffmpeg from mathematical
expressions and contain no sample or recording made by anybody else.
[`public/licenses/quiz-audio-tracks.txt`](public/licenses/quiz-audio-tracks.txt)
names each track with its source and license and records the commands that
rebuild it. A later track from a third party would need its own entry in this
file, because this section would no longer be true of it.

## 5. Contributor agreement text — Creative Commons Attribution 3.0

`CLA.md` is not original work. The agreement it contains is the **Harmony
Individual Contributor License Agreement, version 1.0**, published by
[Project Harmony](https://www.harmonyagreements.org/) on 2011-07-04 and
licensed under a
[Creative Commons Attribution 3.0 Unported License](https://creativecommons.org/licenses/by/3.0/).
Its operative text is reproduced word for word.

CC BY 3.0 permits reproduction and adaptation, commercial use included, on one
condition: attribution. `CLA.md` carries it in its own *Attribution* section,
and this section is the second place it is recorded. The adaptation made is
limited to what the template is designed for — filling its bracketed blanks
(project name, jurisdiction, submission and non-owner instructions, media
licenses) and choosing one of the five alternative §2.3 clauses the template
offers. The file lists every one of those choices at the top, so a reader can
diff it against the published form.

The version this replaced, `CLA.md` 1.0, was drafted for this project and is
the copyright holder's own work. It was retired on 2026-09-07, before any
signature existed, in favour of a form contributors have met elsewhere.

## 6. Third-party dependency set

Re-measured on 2026-09-07 over a **clean** installed dependency tree —
`rm -rf node_modules && bun install --frozen-lockfile`, then each package's own
`license` field read — **233 packages**, runtime and build-time together,
transitive dependencies included. The clean install is not incidental: the
previous measurement, 242 packages on 2026-08-31, was taken over a tree that
still carried packages the lockfile had stopped naming, and a stale directory
counts as a dependency in a scan that walks `node_modules`. The drop of nine is
the `unzipper` pin below removing a chain of them.

That measurement has not been re-taken since. Two changes have landed on top
of it: on 2026-10-21 REQ093 added `katex` and the `commander` it depends on, both
MIT; and on 2026-10-23 REQ158 added `@pdf-lib/fontkit`, MIT, whose one
dependency, `pako`, was already in the set — so the set is **236 packages** and
the MIT row below would read 193.
The table is left as measured rather than edited to match, so that its numbers
stay the ones a clean install on 2026-09-07 produced.

| License | Packages |
| --- | --- |
| MIT | 190 |
| ISC | 15 |
| Apache-2.0 | 11 |
| BSD-2-Clause | 4 |
| BSD-3-Clause | 3 |
| MPL-2.0 | 3 |
| OFL-1.1 | 2 |
| 0BSD | 1 |
| Unlicense | 1 |
| `(AFL-2.1 OR BSD-3-Clause)` | 1 |
| `(MIT AND Zlib)` | 1 |
| `(MIT OR GPL-3.0-or-later)` | 1 |

**Every package states a license, and every one of them is compatible with
distribution under the AGPL-3.0.** The rows that are worth a sentence each
rather than a number:

- **MPL-2.0** — `lightningcss` and its two platform binaries, which arrive
  through Tailwind. MPL-2.0 is file-level copyleft and is compatible with
  AGPL-3.0 distribution. They are **build-time tooling only**: neither name
  appears in `dist/client/` or `dist/server/`, so they are not conveyed by
  either built artifact or by the container image.
- **`(MIT OR GPL-3.0-or-later)`** — `jszip`, reached through `exceljs` for the
  spreadsheet export. A dual grant with a choice; **MIT is the option taken
  here**. It is bundled into the built server.
- **`(MIT AND Zlib)`** — `pako`, under `jszip`. Both halves are permissive.
  Bundled into the built server.
- **`(AFL-2.1 OR BSD-3-Clause)`** — `json-schema`. A dual grant with a choice;
  **BSD-3-Clause is the option taken here**. Bundled into the built server.
- **`Unlicense`** (`big-integer`) and **`0BSD`** (`tslib`) — public-domain-
  equivalent and permissive respectively; both bundled into the built server.
  `big-integer` arrives through the `unzipper` pin below.
- **MIT, with OFL-1.1 inside** — `katex`, the formula typesetter (REQ093). Its
  code is bundled into the built client as a chunk of its own, loaded only when
  a slide carries a formula; its fonts are OFL-1.1 and listed in section 3.
  `commander`, which it depends on, serves only KaTeX's command-line tool and is
  in neither built artifact.
- **MIT** — `@pdf-lib/fontkit`, which lets `pdf-lib` embed the Noto Sans faces
  of section 3 in the deck PDF export (REQ158). Reached by no module but
  `server/deck-pdf.ts`, and bundled into the built server.

### The one dependency that stated no license is pinned out — `unzipper`

Until 2026-09-07 this section recorded an open finding, and it is worth keeping
what it said: `buffers@0.1.1` carried **no `license` field, no license file and
no terms in its README**, it was reached transitively through
`exceljs → unzipper → binary → buffers`, and `bun build` inlined it into
`dist/server/index.js`. The repository's own claim was never affected — no copy
of it is in this source tree — but every container image built from this tree
conveyed a component whose terms its author never stated, which a downstream
redistributor inherits with no way to comply.

**Closed by pinning around it.** `package.json` carries an
[`overrides`](package.json) entry forcing `unzipper` to `^0.11.6`, past the
`^0.10.11` that `exceljs` asks for. The 0.11 line dropped the `binary`
dependency, and `buffers` went with it, along with `chainsaw` and `traverse` —
nine packages in total, which is the drop in the count above.

Two things make the pin safe rather than merely convenient, and both are the
reason this was preferred to replacing `exceljs`:

- **Nothing here reaches the code that changed.** `unzipper` is required by
  exceljs's *streaming* reader alone (`lib/stream/xlsx/workbook-reader.js`);
  every read in this repository and its tests goes through
  `workbook.xlsx.load()`, which uses `jszip`. The bundler cannot know that,
  which is why the fix is a dependency pin and not a build exclusion.
- **No advisory is traded for it.** The only published advisory against
  `unzipper` is GHSA-884w-698f-927f, fixed in 0.8.13 — both the old and the new
  version are past it.

The 0.12 line drops `big-integer` and `fstream` as well, and was not taken: its
`Open` path carries a static `require("@aws-sdk/client-s3")` that `bun build`
cannot resolve, so it would buy two rows in the table above at the price of a
build flag and a `require` that throws if it is ever reached. **Re-check this
pin whenever `exceljs` moves** — the point of it is the license, and a newer
`exceljs` that asks for a newer `unzipper` on its own retires it.

## 7. What this file is not

It is not a license, it grants nothing, and it takes nothing away. Where it and
an actual license file disagree, the license file is right.
