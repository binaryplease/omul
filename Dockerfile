# Pinned by digest, not by tag alone: a floating `:latest` means every build
# takes whatever that namespace publishes at that moment, so a compromise of the
# upstream account would reach every image built from here with nothing to
# detect it. The digest is the multi-arch OCI index, so platform resolution is
# unchanged. Bump it deliberately, the way any other dependency is bumped.
FROM ghcr.io/escherlies/nixnode/nixnode:latest@sha256:157d7f72c9d2a5d41a158c8acaff359333cf8bdb860b032206dffd31eb378dbf

USER root

ARG VERSION

# Install bun
RUN nix-env -i bun

WORKDIR /app

# Copy manifests first so the dependency layer can be cached. Every dependency
# now resolves from the registry — the SQLite storage layer used to be a
# `file:./vendor/binp-docstore` tree that had to be copied in ahead of the
# install, and is `@binaryplease/zodstore` from npm since 2026-08-31.
COPY package.json bun.lock ./

# Install deps (including dev deps — needed for the Vite build).
RUN bun install --frozen-lockfile

# Copy sources
COPY tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
COPY server ./server

# The license instrument travels with the artifact. Distributing this image is
# conveying the program, and AGPL-3.0 §4 requires a copy of the license to
# reach every recipient — so the two license files, the third-party notices and
# the trademark policy sit at the image root. The webfonts' own OFL notice
# arrives by a different route: it is under `public/licenses/`, which the
# `COPY public` above already brings along, so it stays beside the .woff2 files
# it belongs to.
COPY LICENSE-AGPL-3.0 LICENSE-COMMERCIAL NOTICE.md TRADEMARK.md ./

# Build client → dist/client, server → dist/server
# NODE_ENV must be set as a Docker ENV (not just a bash prefix) because
# `bun build` inlines `process.env.NODE_ENV` at bundle time. A bash `VAR=x cmd1 && cmd2`
# only applies to cmd1, which meant `bun build` ran without NODE_ENV=production and
# baked `isDev = true` into the bundle, binding the server to 127.0.0.1 in the container.
ENV NODE_ENV=production
RUN bunx vite build \
 && bun build server/index.ts --outdir dist/server --target bun

# Trim dev deps to slim the runtime image.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

ENV PORT=3000

# zodstore persists to a single bun:sqlite file. Mount a volume at
# /app/data to keep presentations and votes across container restarts; without
# a mount the store lives inside the container's writable layer and is lost on
# recreate. The directory is created on startup if absent.
ENV DATABASE_PATH=/app/data/omul.sqlite
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["bun", "dist/server/index.js"]
