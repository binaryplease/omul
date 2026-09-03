# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Two private routes exist
and either is fine:

1. **GitHub private vulnerability reporting** — the *Report a vulnerability*
   button under this repository's **Security** tab. This is the preferred
   route: it opens a private thread on the repository itself, so the report,
   the discussion and the fix stay in one place, and you are credited on the
   advisory when it is published.
2. **Email `support@hyhyve.com`** with `omul security` in the subject line. Use
   this if you would rather not have a GitHub account in the loop. It is the
   same monitored mailbox that answers licensing and trademark questions.

What helps most, in rough order: the version or commit you tested, whether the
instance was self-hosted, the smallest sequence of steps that reproduces it,
and what an attacker gets out of it. A proof of concept is welcome and never
required — a clear description of the flaw is worth more than a working
exploit.

**Please give us time before disclosing publicly.** There is no fixed embargo
and no bug bounty; what there is, is a small maintainer set that will tell you
honestly what it can fix and when.

## What we will do

| Stage | What happens | Target |
|---|---|---|
| Acknowledge | A human replies confirming we have the report | 5 working days |
| Trace | We reproduce it, or come back to you for what is missing | 10 working days |
| Fix | A patch lands on `main` and a release is tagged | depends on severity |
| Publish | A GitHub security advisory names the issue and credits you | with the release |

These are targets, not contractual commitments — omul carries no support
obligation under either of its licenses. A commercial license (see
[LICENSE-COMMERCIAL](LICENSE-COMMERCIAL)) is a separate agreement and may say
otherwise; the AGPL grant explicitly does not (sections 15 and 16).

## Supported versions

There is one release series and it is the current one. omul is at `1.0.0` (the
version in [package.json](package.json)); nothing older was ever published, so
there is no earlier line to maintain and nothing to back-port to.

| Version | Gets security fixes |
|---|---|
| `1.x` — the current release, and `main` | Yes |
| Anything earlier | Nothing earlier exists |

A fix lands on `main` and goes out with the next release, and the container
image `ghcr.io/binaryplease/omul:latest` is rebuilt from `main` by
[.github/workflows/build.yaml](.github/workflows/build.yaml). There are no
long-term-support branches and no back-ports to earlier tags, so updating to
the current release is how you get a fix. If that ever changes — a second
supported line, or a version that stops receiving fixes — this section says so
before it takes effect.

**Report against whatever you can reach.** The current release or `main` helps
most, because a flaw already fixed there costs us a lookup rather than a patch;
but if the only instance you can test is an older build, name the commit or
image tag and report it anyway, and we will check whether it still reproduces.

## Scope

**In scope** is this repository's own code: the Elysia server under `server/`,
the React client under `src/`, the container image built by
`.github/workflows/build.yaml`, and the documented deployment posture in
[docs/deployment.md](docs/deployment.md).

**Out of scope**, and better reported to whoever owns them:

- Vulnerabilities in third-party dependencies, unless omul's own use of them is
  what makes the flaw reachable. [NOTICE.md](NOTICE.md) enumerates the set.
- Anything that requires an operator to have already ignored the deployment
  documentation — in particular setting `OMUL_ALLOW_INSECURE_DEV_AUTH_SECRET`
  on a host that serves anyone but the operator, which the documentation says
  in as many words re-opens a known hole.
- Instances of omul you do not run and are not authorised to test. Report a
  problem with someone else's deployment to that deployment's operator, not
  here.

## Two things the design already assumes

Both are documented posture rather than defects, so a report that rests only on
one of them will be closed as such:

- **Participants are anonymous by design.** Joining a presentation with a
  6-digit code requires no account, so the code is the only thing standing
  between a stranger and a session. It is a join credential, not a secret, and
  the abuse limits in [docs/deployment.md](docs/deployment.md) are what bound
  the guessing rather than the code's entropy.
- **An instance with no `OMUL_ADMIN_EMAILS` has no administrators at all**, and
  that is the shipped default. Every `/api/admin/*` route answering `403` is
  the intended posture, not a broken one.
