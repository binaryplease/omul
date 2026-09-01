{
  description = "omul – live interactive presentations (dev shell only; runtime is built as a Docker image via .github/workflows/build.yaml)";

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
      in
      {
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
            echo "  mise run check          ADR convention + requirement guards"
            echo "  mise run test           run tests"
            echo ""
          '';
        };
      }
    );
}
