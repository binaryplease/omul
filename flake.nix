{
  description = "omul – live interactive presentations: the dev shell, and the command-line client as a runnable output (the server runtime is built as a Docker image via .github/workflows/build.yaml)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # ── The command-line client (REQ180) ────────────────────────────────
        #
        # `nix run github:…/omul` creates a presentation and reads its results
        # back with nothing installed but Nix. What makes that buildable here is
        # that `cli/` imports nothing outside itself — no npm package, not even
        # this repository's own `server/schemas.ts` — so the bundle is produced
        # from the source tree alone, in a sandbox with no network and no
        # `node_modules` to vendor and no lockfile hash to keep in step. The
        # reasoning, and the test that holds the one duplicated constant to the
        # server's copy, are in `cli/protocol.ts`.
        #
        # The source is narrowed to the two paths the build reads, so a rebuild
        # is not triggered by every edit elsewhere in the tree.
        omulCli = pkgs.stdenv.mkDerivation {
          pname = "omul-cli";
          version = "1.0.0";

          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./cli
              ./package.json
            ];
          };

          nativeBuildInputs = [
            pkgs.bun
            pkgs.makeWrapper
          ];

          buildPhase = ''
            runHook preBuild
            # Bun writes its install/build cache under $HOME; the sandbox's is
            # not writable.
            export HOME="$TMPDIR"
            bun build cli/index.ts --target bun --outfile omul.js
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p "$out/share/omul" "$out/bin"
            cp omul.js "$out/share/omul/omul.js"
            # Wrapped rather than shebanged: the bundle is run by the Bun this
            # package depends on, not by whatever happens to be on the caller's
            # PATH.
            makeWrapper ${pkgs.bun}/bin/bun "$out/bin/omul" \
              --add-flags "$out/share/omul/omul.js"
            runHook postInstall
          '';

          meta = {
            description = "Command-line client for an omul server";
            mainProgram = "omul";
          };
        };
      in
      {
        packages.default = omulCli;
        packages.omul = omulCli;

        apps.default = {
          type = "app";
          program = "${omulCli}/bin/omul";
        };
        apps.omul = {
          type = "app";
          program = "${omulCli}/bin/omul";
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.bun
            pkgs.mise
          ];

          shellHook = ''
            echo ""
            echo "  omul dev shell"
            echo ""

            # ── 1. Install dependencies ───────────────────────────────────────
            echo "--> bun install..."
            bun install
            echo ""

            # ── 2. Environment variables (mirrors .mise.toml [env]) ──────────
            # Storage is zodstore over an in-process bun:sqlite file, so
            # there is no database service to start or stop.
            export PORT="3000"
            export NODE_ENV="development"
            export DATABASE_PATH="data/omul.sqlite"

            # ── 3. Launch dev servers, then exit shell when they stop ─────────
            echo "--> Starting Elysia + Vite  (Ctrl+C to stop everything)"
            echo ""
            bunx concurrently -k -n server,client \
              "bun --watch server/index.ts" \
              "bunx vite"
            exit
          '';
        };

        # Manual shell — just the environment, no auto-start.
        # Usage: nix develop .#shell
        devShells.shell = pkgs.mkShell {
          buildInputs = [
            pkgs.bun
            pkgs.mise
          ];

          shellHook = ''
            export PORT="3000"
            export NODE_ENV="development"
            export DATABASE_PATH="data/omul.sqlite"

            echo ""
            echo "  omul  (manual shell)"
            echo ""
            echo "  mise run dev            start Elysia + Vite concurrently"
            echo "  mise run dev:server     start Elysia only"
            echo "  mise run dev:client     start Vite only"
            echo "  mise run build          build for production"
            echo "  mise run check          convention + requirement guards"
            echo "  mise run test           run tests"
            echo ""
          '';
        };
      }
    );
}
