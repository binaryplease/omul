---
title: "Migrate omul to a Docker-based build and a webhook redeploy"
status: done
created: 2026-04-22
updated: 2026-04-23
priority: high
tags: [infra, deployment, docker]
---

# Migrate omul to Docker-based deployment

## Context

omul is currently packaged as a Nix `buildNpmPackage` exposed via
`nixosModules.default` and consumed directly by the deployment's own
configuration repository. This couples the app build to that repository's flake
and forces a host rebuild for every app change.

Migrate omul to a Docker-based flow instead: a container image built here,
pushed to a registry, and redeployed on the target machine by a webhook
listener that re-pulls it.

## Approach (copy-first, then adapt)

Transplant the Dockerfile and compose layout from an existing image-based
deployment as the template. This repo is simpler than that one (single
container, no split /var/www, WS handled in-process), so the Dockerfile and
docker-compose are simplified accordingly.

## Rules followed

- Registry image + webhook redeploy for deployment.
- GHCR package name = repo name directly (no `/app` suffix).
- Agenix secret filenames do not start with a dot.

## Deliverables (this repo)

- [x] `Dockerfile` building client (`bunx vite build`) + server (`bun build`), runtime on `ghcr.io/escherlies/nixnode/nixnode:latest`.
- [x] `.dockerignore` to keep the image slim.
- [x] `.github/workflows/build.yaml` — build + push to the GHCR package named by the repository slug (`IMAGE_NAME` is `${{ github.repository }}`).
- [x] Remove `nixosModules.default` and `buildNpmPackage` from `flake.nix` (keep minimal dev shell or rely on `.mise.toml`).
- [x] Update `AGENTS.md` to describe Docker packaging.

## Related changes (deployment configuration, outside this repository)

The other half of this migration lands in whatever repository holds the
deployment's own configuration, and none of it is tracked here. In outline:
provision a docker-compose file and a reverse-proxy snippet for the container,
provision the server environment and the redeploy token as encrypted secrets,
drop the old Nix module that built the app from source, and stand up the
webhook listener that re-pulls the image.

## Progress log

- 2026-04-22: Task created, branch cut from main.
