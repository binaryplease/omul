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
and is counted in section 5 like every other dependency. It is written by the
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

Two typefaces ship inside the built client as `.woff2`/`.woff` files under
`dist/client/assets/`, pulled in by `src/index.css`:

| Font | Package | Copyright | License |
| --- | --- | --- | --- |
| Sora | `@fontsource-variable/sora` | Copyright 2019 The Sora Project Authors | OFL-1.1 |
| DM Mono | `@fontsource/dm-mono` | Copyright 2020 The DM Mono Project Authors | OFL-1.1 |

The OFL requires the copyright notice and the license text to travel with the
font files. They do: the notices and the full license text are in
[`public/licenses/OFL-1.1-fonts.txt`](public/licenses/OFL-1.1-fonts.txt), which
Vite copies into `dist/client/licenses/` alongside the fonts and which the
running server serves at `/licenses/OFL-1.1-fonts.txt`. The container image
carries it by the same route, through `COPY public ./public`.

Neither typeface is modified, renamed or sold on its own.

## 4. Everything else in `public/` and `src/`

Original work by the copyright holder, under the license at the top of this
file — with the single exception of the brand marks in section 1. No
third-party artwork, icon set, seed data, sample content or copy-pasted snippet
is vendored into either directory. Icons are drawn at runtime by
`lucide-react`, an ISC-licensed dependency (section 5), not copied into the
tree.

## 5. Third-party dependency set

Re-measured on 2026-08-31 over the installed dependency tree — **242 packages**,
runtime and build-time together, transitive dependencies included — by reading
each package's own `license` field. The previous measurement, on 2026-08-28,
read 229 packages; the storage-layer swap in section 2 accounts for one of the
MIT rows, ordinary dependency drift for the rest.

| License | Packages |
| --- | --- |
| MIT | 195 |
| ISC | 16 |
| Apache-2.0 | 11 |
| BSD-2-Clause | 4 |
| MPL-2.0 | 3 |
| BSD-3-Clause | 3 |
| MIT/X11 | 2 |
| OFL-1.1 | 2 |
| 0BSD | 1 |
| Unlicense | 1 |
| `(AFL-2.1 OR BSD-3-Clause)` | 1 |
| `(MIT AND Zlib)` | 1 |
| `(MIT OR GPL-3.0-or-later)` | 1 |
| none stated | 1 |

Everything above is compatible with distribution under the AGPL-3.0. The rows
that are worth a sentence each rather than a number:

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
- **`MIT/X11`** — a legacy spelling of MIT in two old manifests, not a
  different grant.

### One dependency states no license, and it is bundled

`buffers@0.1.1` carries **no `license` field and no license file**, and its
README states no terms either. It is reached transitively —
`exceljs → unzipper → binary → buffers` — and it *is* inlined into
`dist/server/index.js`.

This does not affect the license claim over this repository, whose source tree
contains no copy of it. It is recorded here because the enumeration has to be
true rather than tidy: the built server artifact carries a component whose
terms its own author never stated. It is a small, sixteen-year-old utility, and
the routes out are to pin around it, to replace `exceljs`'s zip path, or to
obtain a statement from its author. **Open, and not closed by this file.**

## 6. What this file is not

It is not a license, it grants nothing, and it takes nothing away. Where it and
an actual license file disagree, the license file is right.
