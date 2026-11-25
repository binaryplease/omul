{
  description = "omul – live interactive presentations: the dev shell, the command-line client (packages.omul), the server (packages.omul-server) and the NixOS module services.omul (nixosModules.default) that runs it";

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
    let
      # sha256 of the server's installed `node_modules`, per system (REQ254,
      # nix/server-package.nix). Bun installs only the running platform's native
      # optional dependencies, so each system has its own value, and a system
      # without one gets no `omul-server` package. Every change to `bun.lock`
      # needs new values here — docs/maintaining.md says how to obtain them.
      serverNodeModulesHashes = {
        x86_64-linux = "sha256-ZmX0Y5FQBiE3zNPSdlTX1r6wES2VC6T4E2eAUongt00=";
      };
    in
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        lib = nixpkgs.lib;

        # ── The server (REQ254) ─────────────────────────────────────────────
        #
        # The same build as `.mise.toml` `[tasks.build]` and the Dockerfile,
        # run by Bun from the Nix store; `services.omul` runs it.
        omulServer = pkgs.callPackage ./nix/server-package.nix {
          nodeModulesHash = serverNodeModulesHashes.${system};
        };
        hasServer = serverNodeModulesHashes ? ${system};

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
          version = "1.4.1";

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
        packages =
          {
            default = omulCli;
            omul = omulCli;
          }
          // lib.optionalAttrs hasServer {
            omul-server = omulServer;
          };

        # The VM test boots a NixOS machine that enables `services.omul`, so it
        # needs a Linux system with the server package.
        checks = lib.optionalAttrs (hasServer && pkgs.stdenv.hostPlatform.isLinux) {
          nixos-module = import ./nix/vm-test.nix {
            inherit pkgs;
            omulModule = self.nixosModules.default;
          };
        };

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
    )
    // {
      # `services.omul` (REQ254): the recommended way to self-host on NixOS.
      nixosModules.default = import ./nix/module.nix self;
    };
}
