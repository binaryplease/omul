# The omul server as a Nix package (REQ254).
#
# Two derivations. The first is the npm dependency tree: `bun install
# --frozen-lockfile` needs the registry, and the build sandbox has no network,
# so it runs as a fixed-output derivation whose result Nix checks against
# `nodeModulesHash`. The second builds the client and the server bundle from
# that tree exactly as `.mise.toml` `[tasks.build]` and the `Dockerfile` do, in
# a sandbox without network.
#
# The installed result needs no `node_modules`: `bun build` inlines every
# dependency into `dist/server/index.js` and copies the fonts beside it, so the
# runtime closure is Bun and the two `dist/` directories.
#
# Running cost: every change to `bun.lock` changes the dependency tree, so
# `nodeModulesHash` has to be replaced in the same change. How to obtain the new
# value is in docs/maintaining.md ("The server package's dependency hash").
{
  lib,
  stdenv,
  bun,
  makeWrapper,
  # sha256 of the installed `node_modules` for this platform. Bun installs only
  # the native optional dependencies of the platform it runs on (rolldown,
  # lightningcss, the Tailwind oxide engine), so the hash differs per system.
  nodeModulesHash,
}:
let
  packageJson = lib.importJSON ../package.json;

  # The dependency tree depends on these two files and nothing else, so an
  # edit anywhere else in the repository does not invalidate it.
  lockSource = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
    ];
  };

  # The paths the Dockerfile copies into its build stage, plus the license
  # instrument, which travels with the artifact for the reason given there
  # (AGPL-3.0 §4). `node_modules/` and `dist/` from a working tree are not in
  # the set, so a local build never leaks into this one.
  buildSource = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
      ../tsconfig.json
      ../vite.config.ts
      ../public
      ../src
      ../server
      ../LICENSE-AGPL-3.0
      ../LICENSE-COMMERCIAL
      ../NOTICE.md
      ../TRADEMARK.md
    ];
  };

  nodeModules = stdenv.mkDerivation {
    pname = "omul-server-node-modules";
    version = packageJson.version;
    src = lockSource;

    nativeBuildInputs = [ bun ];

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR"
      # --ignore-scripts: no install script runs in a fixed-output
      # derivation, so nothing it fetched or compiled can make the tree
      # differ between two machines.
      bun install --frozen-lockfile --ignore-scripts --no-progress
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      # Bun's install cache and timestamps are not part of the tree.
      rm -rf node_modules/.cache
      cp -R node_modules "$out"
      runHook postInstall
    '';

    # Fixup would rewrite `#!/usr/bin/env node` lines into store paths, and a
    # fixed-output derivation may not reference the store.
    dontFixup = true;

    outputHash = nodeModulesHash;
    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
  };
in
stdenv.mkDerivation {
  pname = "omul-server";
  version = packageJson.version;
  src = buildSource;

  nativeBuildInputs = [
    bun
    makeWrapper
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    # A writable copy: Vite writes its cache under node_modules/.vite.
    cp -R ${nodeModules} node_modules
    chmod -R u+w node_modules
    # NODE_ENV=production for both halves, as the Dockerfile sets it.
    # `bun build` writes the value into the bundle, and a server bundled
    # without it listens on 127.0.0.1 only and serves no pages.
    export NODE_ENV=production
    # Vite's entry point run by Bun directly, where `bunx vite build` would
    # follow its `#!/usr/bin/env node` line: the sandbox has neither
    # /usr/bin/env nor Node.
    bun node_modules/vite/bin/vite.js build
    bun build server/index.ts --outdir dist/server --target bun
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/omul" "$out/bin"
    cp -R dist "$out/share/omul/dist"
    cp LICENSE-AGPL-3.0 LICENSE-COMMERCIAL NOTICE.md TRADEMARK.md "$out/share/omul/"
    # Wrapped rather than shebanged, like the command-line client: the bundle
    # runs on the Bun this package was built with.
    makeWrapper ${bun}/bin/bun "$out/bin/omul-server" \
      --add-flags "$out/share/omul/dist/server/index.js" \
      --set-default NODE_ENV production
    runHook postInstall
  '';

  passthru = {
    inherit nodeModules;
  };

  meta = {
    description = "omul server: the HTTP and WebSocket server with the built web client";
    homepage = "https://github.com/binaryplease/omul";
    license = [ lib.licenses.agpl3Only ];
    mainProgram = "omul-server";
    platforms = lib.platforms.linux;
  };
}
