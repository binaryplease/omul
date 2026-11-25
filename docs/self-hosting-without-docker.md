# Running omul without Docker

The Docker image is not the only way to run omul. The image does nothing but
build this repository with Bun and run the result, and a plain Linux host can do
the same: build once with the Dockerfile's two build commands, then run
`dist/server/index.js` with Bun under systemd. It is the same server, the same
single process and the same state directory as the container described in
[deployment.md](deployment.md#running-the-image). Nothing new is packaged for it
(REQ249).

On NixOS, use the flake's NixOS module instead (`services.omul`, REQ254): it
does what this page does by hand, from the system configuration. A minimal
configuration is in
[README.md](../README.md#on-nixos-the-flakes-module-recommended).

This page is the path from a fresh Linux host to an instance that keeps its data
and comes back after a reboot. **What each variable means, and what breaks
without it, is in [deployment.md](deployment.md#environment-variables)**, and
this page does not restate it.

## What the host needs

- **Linux with systemd.** The unit below needs it; everything before it does
  not.
- **git**, to clone the repository.
- **Bun 1.x**, which is the only runtime. Building and running need no Node, no
  database service, no cache and no queue. The repository pins Bun through
  [mise](https://mise.jdx.dev) in `.mise.toml`, so installing mise and running
  `mise install` in the checkout gets the right version.
- **openssl**, once, to generate the signing secret.

## 1. Build

Put the checkout outside any home directory, owned by the account you build
with. The service will run as a separate, unprivileged user that can read the
checkout but not change it.

```sh
sudo mkdir /opt/omul && sudo chown "$USER" /opt/omul
git clone https://github.com/binaryplease/omul.git /opt/omul
cd /opt/omul
git checkout v1.2.0          # or the release you want; `git tag` lists them
mise trust && mise install   # once per clone
mise exec -- bun install --frozen-lockfile
mise exec -- env NODE_ENV=production bunx vite build      # dist/client/
mise exec -- env NODE_ENV=production \
  bun build server/index.ts --outdir dist/server --target bun  # dist/server/
```

**Both halves are built with `NODE_ENV=production`, set inside `mise exec`**, as
the Dockerfile builds them. `.mise.toml` sets `NODE_ENV=development` for every
command mise runs, over anything exported in the shell, so neither
`mise run build` nor `export NODE_ENV=production` gives a production build:
`mise run build` sets it for the server half only, and its client ships React's
development build. The server half matters more. `bun build` writes the value
into the bundle, and a server bundled without it runs in development mode: it
listens on `127.0.0.1` only and does not serve the app's pages.

The unit needs Bun at a path outside any home directory. Copy the binary that
mise installed:

```sh
sudo install -m 0755 "$(mise which bun)" /usr/local/bin/bun
```

## 2. Try it in the foreground

Before you install anything, start the build by hand with a throwaway state
directory:

```sh
cd /opt/omul
NODE_ENV=production PORT=3000 DATABASE_PATH=/tmp/omul-try/omul.sqlite \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  bun dist/server/index.js
```

From a second shell:

```sh
curl http://127.0.0.1:3000/api/health      # {"ok":true}
```

The boot log prints each posture in lines tagged with its name (`[rate-limit] …`,
`[discovery] …`, `[admin] …`). Without `BETTER_AUTH_SECRET` the server stops at once with
`BETTER_AUTH_SECRET is not set — refusing to start.`, as the container does.
Stop it with Ctrl+C and delete `/tmp/omul-try`.

Use the command above rather than `mise run start`. That task runs the same
bundle, but it takes `PORT=3000` and `DATABASE_PATH=data/omul.sqlite` from
`.mise.toml`, over anything you export in the shell, so it always listens on
3000 and writes its data into `data/` inside the checkout. It sets no
`BETTER_AUTH_SECRET` either: without one exported it refuses to start, after it
has already created `data/auth.sqlite` there.

## 3. The environment file

Create `/etc/omul/omul.env`, readable by root only. systemd reads it before it
drops privileges, so the service user never needs to read it.

```sh
sudo install -d -m 0755 /etc/omul
sudo install -m 0600 /dev/null /etc/omul/omul.env
openssl rand -base64 32      # the value for BETTER_AUTH_SECRET
sudoedit /etc/omul/omul.env
```

```sh
NODE_ENV=production
PORT=3000
DATABASE_PATH=/var/lib/omul/omul.sqlite
BETTER_AUTH_SECRET=<the openssl output>
OMUL_BASE_HOST=omul.example.com
OMUL_TRUST_PROXY=true
# OMUL_ADMIN_EMAILS=you@example.com
```

Set `DATABASE_PATH` explicitly. Every database file is placed next to it, and
unset it resolves relative to the working directory. `OMUL_AUTH_DB`,
`OMUL_ADMIN_DB` and `OMUL_FEEDBACK_DB` can move one file elsewhere; under the
unit below, such a path has to stay inside `/var/lib/omul`, the only directory
the service can write.
For `BETTER_AUTH_SECRET`, `OMUL_BASE_HOST`, `OMUL_TRUST_PROXY` and
`OMUL_ADMIN_EMAILS`, see
[what a deployment has to set](deployment.md#running-the-image). The two lines
above are right for a single reverse proxy on the same host, which is the setup
this page assumes. Every other variable is optional and is in the
[full list](deployment.md#environment-variables).

## 4. The systemd unit

`/etc/systemd/system/omul.service`:

```ini
[Unit]
Description=omul
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=omul
StateDirectoryMode=0700
WorkingDirectory=/opt/omul
EnvironmentFile=/etc/omul/omul.env
ExecStart=/usr/local/bin/bun dist/server/index.js
Restart=on-failure
RestartSec=5

NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes

# The server listens on every interface (0.0.0.0) and has no setting for that.
# These two lines let only loopback reach it, so the reverse proxy on this host
# is the way in. They also block outbound connections; see below.
IPAddressDeny=any
IPAddressAllow=localhost

[Install]
WantedBy=multi-user.target
```

The unit makes these choices:

- **`DynamicUser=yes`** runs the server as an unprivileged user that systemd
  creates for it. You add no account. `ProtectSystem=strict` leaves it one
  writable place: `StateDirectory=omul`, which is `/var/lib/omul`, where
  `DATABASE_PATH` points. Data stays there across restarts, reboots and
  upgrades.
- **`Restart=on-failure`** restarts the process after a crash. A configuration
  error makes it fail again on every retry: a missing secret or a malformed
  variable stops the boot with a message naming it, every five seconds, until
  you fix the file. Read the message with `journalctl -u omul`.
- **The `IPAddress…` lines are the default on purpose.** Unconfined, a plain
  host serves port 3000 to its whole network, without TLS, past your proxy. The
  container avoids that by publishing on loopback. These two lines do the same
  job here, at a cost: they also block every outbound connection. Two optional
  features need one, and neither works while the lines are in place: sending
  mail (`SEND_EMAILS` with Brevo) and
  [drafting a deck from a prompt](deployment.md#generating-a-deck-from-a-prompt-req007)
  (REQ007). If you turn one on, delete both lines and close port 3000 with the
  host firewall instead. On a host whose systemd cannot enforce these lines
  (they need cgroup v2), systemd logs a warning and ignores them. The check in
  step 5 shows which case you are in.

Enable it and check it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now omul
systemctl status omul
journalctl -u omul -b                       # the boot postures, as above
curl http://127.0.0.1:3000/api/health       # {"ok":true}
```

## 5. In front of it

Point a TLS-terminating reverse proxy on this host at `127.0.0.1:3000`. It must
forward the paths the app owns, listed in
[the path table](deployment.md#sharing-one-host-with-the-marketing-site-req179).
It must pass WebSocket upgrades on `/ws`, because live sessions use them. It
must append `X-Forwarded-For` to match `OMUL_TRUST_PROXY`; see
[behind a reverse proxy](deployment.md#behind-a-reverse-proxy-set-omul_trust_proxy).
This repository ships no proxy, TLS or DNS configuration, because those belong
to the operator.

Then, from another machine,
`curl --max-time 5 http://<host>:3000/api/health` must fail to connect or time
out. If it answers, port 3000 is open to the network, and the host firewall
has to close it.

## Backups

`/var/lib/omul` holds the whole instance: `omul.sqlite`, `auth.sqlite`,
`admin.sqlite` and, once either feedback channel is on (`OMUL_FEEDBACK_ENABLED`
or `OMUL_FEEDBACK_PROMPT_PERCENT`), `feedback.sqlite`. Each has its `-wal` and
`-shm` files. A file that `OMUL_AUTH_DB`, `OMUL_ADMIN_DB` or `OMUL_FEEDBACK_DB`
moved is wherever that variable points, and it needs the same backup. Nothing
here backs any of them up, and copying the live files is not a backup. Read
[state and backups](deployment.md#state-and-backups) for the reasons. The
simplest correct copy is taken with the service stopped:

```sh
sudo systemctl stop omul
sudo cp -a /var/lib/omul/. /path/to/backup/
sudo systemctl start omul
```

## Upgrading

```sh
cd /opt/omul
git fetch --tags && git checkout <new release>
mise exec -- bun install --frozen-lockfile
mise exec -- env NODE_ENV=production bunx vite build
mise exec -- env NODE_ENV=production \
  bun build server/index.ts --outdir dist/server --target bun
sudo systemctl restart omul
```

The build overwrites `dist/` while the old process keeps running, so restart
right after it. The unit runs the copy in `/usr/local/bin`, so when you update
Bun through mise, run the `install` line from step 1 again before you restart.
