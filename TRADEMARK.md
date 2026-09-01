# omul trademark and brand-mark policy

The omul source code is licensed under the AGPL-3.0, or under a commercial
agreement — see [LICENSE-AGPL-3.0](LICENSE-AGPL-3.0) and
[LICENSE-COMMERCIAL](LICENSE-COMMERCIAL). **Those licenses are copyright
licenses. Neither of them grants you rights in the name or in the drawn marks
under trademark law — this file is where those stand.**

Copyright (c) 2026 Enrico Scherlies. Trademark rights in the name and the marks
are reserved. The SPDX expression for the code is
`AGPL-3.0-only OR LicenseRef-omul-Commercial`.

## Why this file exists

A copyright license and a trademark are different instruments over the same
files. The AGPL is generous with the first and silent on the second: it lets
every recipient copy, modify and redistribute everything in the tree, the
wordmark and the signet included — which is how a fork ends up shipping a build
that presents itself as this product.

The remedy is not to weaken the code license, and it is not to pull files out
of it. It is to say plainly which files are marks rather than ordinary content,
and to reserve — under the permission AGPL-3.0 §7(e) gives for exactly this —
the trademark rights in them. That is what this file does. **Nothing here
restricts anything the AGPL grants you over the code, the mark files included:
you may use, study, modify and redistribute all of it, commercially or not.**
What a trademark policy restricts is trading on the name and the marks while
you do so — so that if a fork ships a security hole, the name on it tells users
who is responsible.

## What is reserved, and where it is

What follows is a **reservation of trademark rights**, made under the
additional-term permission in AGPL-3.0 §7(e) — "declining to grant rights under
trademark law for use of some trade names, trademarks, or service marks". It is
**not** a copyright carve-out, and the difference is the whole of it:

- **The copyright grant over these files is untouched.** Every path below is
  part of the Corresponding Source and stays under LICENSE-AGPL-3.0 for
  copyright purposes. **You may always redistribute them** — a clone, a fork, a
  mirror, a patch series, a container image built from this tree — with the
  files intact, exactly as §4 and §5 provide, and you need no agreement with
  anybody to do it. Nothing in this file is a further restriction of the kind
  §10 forbids; if any sentence here is ever read as one, the license wins and
  that reading is void.
- **What is withheld is the right to use the mark to identify a build**, and
  the name along with it. Shipping the artwork is fine. Shipping *your*
  modified software wearing it is what this file says no to.

By path — the drawn artwork, in every form it ships in:

| Path | What it is |
| --- | --- |
| `public/brand/omul-wordmark.svg` | the wordmark |
| `public/brand/omul-wordmark.png` | the wordmark, 2400 × 979 raster export |
| `public/brand/omul-wordmark-invers.svg` | the wordmark, inverse form |
| `public/brand/omul-wordmark-invers.png` | the inverse wordmark, 2400 × 979 raster export |
| `public/brand/omul-icon-ring.svg` | the closed-ring signet |
| `public/brand/omul-icon-ring-512.png` | the closed-ring signet, 512 × 512 raster export |
| `public/brand/omul-icon-offener-ring.svg` | the open-ring signet |
| `public/brand/omul-icon-offener-ring-512.png` | the open-ring signet, 512 × 512 raster export |

Together with everything else that may come to sit under `public/brand/`: the
whole directory is mark artwork by construction and nothing else belongs in it.

By name — the same artwork where it is drawn in code rather than stored as a
file:

- the `WORDMARK_GEOMETRY` constant in `src/components/BrandMark.tsx` and the
  strokes the `Wordmark` component draws from it. That constant *is* the
  wordmark, transcribed; the file's own comments say so.

The rest of `src/components/BrandMark.tsx` — the component, its props, the
`brandMarkForm()` size rule, the `BRAND_NAME` export — is ordinary code and is
covered by the code license like any other module.

And by name, independent of any file: the word **omul** as a name for this
software or for a service running it.

## What you may do without asking

- **Redistribute the source, marks included.** Clone it, fork it, mirror it,
  send a patch, build an image from it, pass any of that on — the files listed
  above travel with the source and the AGPL's terms are the only ones that
  govern doing so. This is stated first because it is the one thing a
  trademark policy must not get in the way of.
- Self-host an unmodified copy of omul and call it omul.
- Say truthful things: "built on omul", "a fork of omul", "compatible with
  omul", "migrated from omul".
- Use the name in articles, talks, tutorials, reviews, and in package names
  that describe compatibility — for example `omul-backup-tool` — as long as it
  is clear the thing is yours and not ours.
- Link to this repository.

## What you may not do

- Name a fork, a modified version or a derived product "omul", or anything
  confusingly similar. Pick your own name: under the AGPL the code is yours to
  keep, the name is not.
- Put a modified build in front of users still wearing the wordmark or the
  signet. **If you change the code, change the mark.** This is about what your
  build presents itself as, not about which files you are allowed to pass
  along — redistributing the source with the artwork in it stays permitted
  (above). Replacing the files listed earlier with your own is the intended and
  expected thing to do, and the code is written to make it a small edit: the
  mark lives in one directory and one module.
- Offer a hosted or commercial service under the omul name, wordmark or
  signet.
- Use the name or the marks in a way that suggests endorsement by, or
  affiliation with, the copyright holder when there is none.
- Register domains, social-media handles or trademarks containing "omul" that
  could be mistaken for the official project.

## Questions

Write to **support@hyhyve.com** with "omul trademark" in the subject line, to
ask for permission this policy does not already give, or simply to ask whether
a use is permitted. The same address handles commercial licensing
(see `LICENSE-COMMERCIAL`).

For an obvious nominative use — describing, reviewing or interoperating with
omul, and saying so truthfully — you do not need to ask and do not need to wait
for an answer.
