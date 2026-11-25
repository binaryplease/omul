# NixOS VM test for `services.omul` (REQ254): a machine that enables the
# module serves /api/health, lets a deck be created and joined over the API,
# and still has the deck after the service restarts. No container runtime is
# involved: the server runs from the flake's package under systemd.
{
  pkgs,
  omulModule,
}:
pkgs.testers.runNixOSTest {
  name = "omul-nixos-module";

  nodes.machine =
    { pkgs, ... }:
    {
      imports = [ omulModule ];

      # A copied file rather than a store symlink, mode 0400 and owned by root,
      # as a real host's secret would be. The value is a fixed test string; it
      # signs nothing outside this VM.
      environment.etc."omul/auth-secret" = {
        text = "vm-test-signing-secret-not-for-any-real-instance";
        mode = "0400";
      };

      services.omul = {
        enable = true;
        baseHost = "omul.test";
        secretFile = "/etc/omul/auth-secret";
      };

      environment.systemPackages = [
        pkgs.curl
        pkgs.jq
      ];

      virtualisation.memorySize = 2048;
    };

  testScript = ''
    import json

    base = "http://127.0.0.1:3000"

    machine.wait_for_unit("omul.service")
    machine.wait_for_open_port(3000)

    with subtest("health answers ok"):
        health = json.loads(machine.succeed(f"curl -sf {base}/api/health"))
        assert health == {"ok": True}, health

    with subtest("the secret is not in the unit's environment"):
        unit_environment = machine.succeed("systemctl show omul.service -p Environment")
        assert "vm-test-signing-secret" not in unit_environment, unit_environment
        assert "BETTER_AUTH_SECRET" not in unit_environment, unit_environment

    with subtest("a deck is created and joined"):
        created = json.loads(machine.succeed(
            f"curl -sf -X POST -H 'content-type: application/json' "
            f"-d '{{\"templateId\":\"team-check-in\",\"title\":\"VM test deck\"}}' "
            f"{base}/api/presentations"
        ))
        deck_id = created["id"]
        join_code = created["code"]
        edit_token = created["creatorToken"]
        assert edit_token, created
        joined = json.loads(machine.succeed(f"curl -sf {base}/api/join/{join_code}"))
        assert joined["id"] == deck_id, joined
        assert joined["title"] == "VM test deck", joined

    with subtest("the databases are in the state directory"):
        machine.succeed("test -s /var/lib/omul/omul.sqlite")
        machine.succeed("test -s /var/lib/omul/auth.sqlite")

    with subtest("the deck survives a restart of the service"):
        machine.succeed("systemctl restart omul.service")
        machine.wait_for_unit("omul.service")
        machine.wait_for_open_port(3000)
        rejoined = json.loads(machine.succeed(f"curl -sf {base}/api/join/{join_code}"))
        assert rejoined["id"] == deck_id, rejoined
        fetched = json.loads(machine.succeed(f"curl -sf {base}/api/presentations/{deck_id}"))
        assert fetched["title"] == "VM test deck", fetched
        machine.succeed(
            f"curl -sf -X POST -H 'X-Omul-Edit-Token: {edit_token}' "
            f"{base}/api/presentations/{deck_id}/start"
        )
        started = json.loads(machine.succeed(f"curl -sf {base}/api/join/{join_code}"))
        assert started["status"] == "live", started
  '';
}
