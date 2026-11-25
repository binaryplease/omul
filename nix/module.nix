# `services.omul`: run the omul server on a NixOS host (REQ254).
#
# The flake passes itself in, so the default package is this flake's own
# `packages.<system>.omul-server`. The module serves on a port and stops there:
# reverse proxy, TLS, DNS and backups stay with the host's configuration, as in
# docs/deployment.md.
self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.omul;

  inherit (lib)
    mkEnableOption
    mkIf
    mkOption
    optional
    optionalAttrs
    types
    ;

  # The server reads its secrets from the environment and nowhere else. They
  # reach it through systemd credentials: systemd reads each file as root and
  # hands the service a private copy under $CREDENTIALS_DIRECTORY, and this
  # script exports it right before it starts the server. So the secret is in no
  # Nix store path, in no `Environment=` line of the unit, and in no file the
  # service user could read outside its own credentials directory.
  startScript = pkgs.writeShellScript "omul-start" ''
    set -euo pipefail
    BETTER_AUTH_SECRET="$(< "$CREDENTIALS_DIRECTORY/better-auth-secret")"
    export BETTER_AUTH_SECRET
    ${lib.optionalString (cfg.generationApiKeyFile != null) ''
      GOOGLE_GENERATIVE_AI_API_KEY="$(< "$CREDENTIALS_DIRECTORY/generation-api-key")"
      export GOOGLE_GENERATIVE_AI_API_KEY
    ''}
    exec ${lib.getExe cfg.package}
  '';

  stateDirectory = "/var/lib/omul";

  notInStore =
    name: path:
    {
      assertion = path == null || !(lib.hasPrefix builtins.storeDir (toString path));
      message = "services.omul.${name} points into the Nix store, which every local user can read. Point it at a file outside the store, readable by root only.";
    };
in
{
  options.services.omul = {
    enable = mkEnableOption "the omul server";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.omul-server;
      defaultText = lib.literalExpression "omul.packages.\${pkgs.stdenv.hostPlatform.system}.omul-server";
      description = "The omul server package. This flake builds it for `x86_64-linux`.";
    };

    port = mkOption {
      type = types.port;
      default = 3000;
      description = ''
        TCP port the server listens on (`PORT`). The server binds every
        interface and has no setting for that, so the port is reachable from
        the network unless the firewall closes it; this module leaves the
        firewall closed unless {option}`services.omul.openFirewall` is set.
      '';
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Open {option}`services.omul.port` in the NixOS firewall. Leave it off
        when a reverse proxy on the same host is the way in.
      '';
    };

    secretFile = mkOption {
      type = types.path;
      example = "/run/secrets/omul-auth-secret";
      description = ''
        File holding the session signing secret (`BETTER_AUTH_SECRET`), and
        nothing else; a trailing newline is ignored. Required: without it the
        server refuses to start, because a placeholder shipped in public source
        would let any reader forge a session. Generate one with
        `openssl rand -base64 32`.

        The file is read by systemd as root and passed to the service as a
        credential, so it can be mode `0400` and owned by root. Give a path as
        a string, never as a Nix path literal: a path literal is copied into
        the world-readable Nix store, and the module refuses a store path.
      '';
    };

    baseHost = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "omul.example.com";
      description = ''
        The public host the instance is reached at (`OMUL_BASE_HOST`): a bare
        host, no scheme and no path. Fine to leave unset on `localhost`, but on
        a public host nobody can sign in until it is set, because the public
        origin is not among the ones allowed to drive auth. It is also what
        puts a working link in verification mail, and what the `/api` index
        advertises.
      '';
    };

    trustProxy = mkOption {
      type = types.ints.unsigned;
      default = 0;
      example = 1;
      description = ''
        How many reverse-proxy hops are believed when reading
        `X-Forwarded-For` (`OMUL_TRUST_PROXY`). Behind one reverse proxy set
        `1`; left at `0` behind a proxy, every visitor shares one rate-limit
        bucket. `0` is right for a server reached directly.
      '';
    };

    adminEmails = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [ "you@example.com" ];
      description = ''
        Sign-in addresses of the instance's administrators
        (`OMUL_ADMIN_EMAILS`). Empty means nobody is an administrator and
        `/api/admin/*` answers `403` to everyone. That is a complete instance:
        presenters and participants never touch the admin surface.
      '';
    };

    generationApiKeyFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/run/secrets/omul-generation-key";
      description = ''
        File holding the model provider key that switches on drafting a deck
        from a prompt (`GOOGLE_GENERATIVE_AI_API_KEY`, REQ007), and nothing
        else. Unset, generation stays off and nothing else changes. When set,
        each prompt is sent to the provider; only the prompt leaves the host.
        Passed as a credential the way {option}`services.omul.secretFile` is.
      '';
    };

    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = {
        OMUL_SIGNUP_DISABLED = "true";
      };
      description = ''
        Further environment variables for the server, from the list in
        docs/deployment.md. They are written into the unit and so into the Nix
        store: put no secret here, use
        {option}`services.omul.environmentFile` instead.
      '';
    };

    environmentFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/run/secrets/omul.env";
      description = ''
        A file of `NAME=value` lines read by systemd as root before the service
        starts, for further secrets such as `BREVO_API_KEY`. Give the path as a
        string, never as a Nix path literal.
      '';
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      (notInStore "secretFile" cfg.secretFile)
      (notInStore "generationApiKeyFile" cfg.generationApiKeyFile)
      (notInStore "environmentFile" cfg.environmentFile)
    ];

    networking.firewall.allowedTCPPorts = mkIf cfg.openFirewall [ cfg.port ];

    systemd.services.omul = {
      description = "omul live audience interaction server";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];

      environment =
        {
          NODE_ENV = "production";
          PORT = toString cfg.port;
          # Every database is a sibling of this file: omul.sqlite,
          # auth.sqlite, admin.sqlite and, once feedback is switched on,
          # feedback.sqlite. So the state directory holds the whole instance.
          DATABASE_PATH = "${stateDirectory}/omul.sqlite";
          OMUL_TRUST_PROXY = toString cfg.trustProxy;
        }
        // optionalAttrs (cfg.baseHost != null) { OMUL_BASE_HOST = cfg.baseHost; }
        // optionalAttrs (cfg.adminEmails != [ ]) {
          OMUL_ADMIN_EMAILS = lib.concatStringsSep "," cfg.adminEmails;
        }
        // cfg.environment;

      serviceConfig = {
        Type = "simple";
        ExecStart = startScript;
        Restart = "on-failure";
        RestartSec = 5;

        LoadCredential =
          [ "better-auth-secret:${toString cfg.secretFile}" ]
          ++ optional (
            cfg.generationApiKeyFile != null
          ) "generation-api-key:${toString cfg.generationApiKeyFile}";
        EnvironmentFile = mkIf (cfg.environmentFile != null) (toString cfg.environmentFile);

        # An unprivileged user systemd creates for the service. Its one
        # writable place is the state directory, /var/lib/omul.
        DynamicUser = true;
        StateDirectory = "omul";
        StateDirectoryMode = "0700";
        WorkingDirectory = stateDirectory;
        UMask = "0077";

        # Hardening. MemoryDenyWriteExecute is deliberately absent: Bun's
        # JavaScript engine compiles code at run time and needs W+X pages.
        NoNewPrivileges = true;
        CapabilityBoundingSet = "";
        AmbientCapabilities = "";
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        PrivateUsers = true;
        ProtectHostname = true;
        ProtectClock = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        ProtectProc = "invisible";
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        RemoveIPC = true;
        SystemCallArchitectures = "native";
        SystemCallFilter = [
          "@system-service"
          "~@privileged"
        ];
      };
    };
  };
}
