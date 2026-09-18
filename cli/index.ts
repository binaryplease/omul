#!/usr/bin/env bun
/**
 * `omul` — the command-line client for an omul server (REQ180).
 *
 * One installed command that creates a presentation and reads its state and
 * results back over the same HTTP API the web client uses, authenticated by a
 * personal API key. It adds no server surface: every call here is a route
 * `docs/api.md` already documents, and `GET /api` is the index a caller (or an
 * agent) follows to find the rest.
 *
 * Installed two ways, both of which run it with Bun:
 *   - `nix run github:…/omul#omul -- <command>` (the flake's `apps.default`);
 *   - a `bin` entry in `package.json`, so a checkout linked with `bun link`
 *     puts `omul` on the PATH.
 *
 * This file is orchestration only: parse, dispatch, print, exit. What each verb
 * does is `cli/commands.ts`, and where the two credentials come from is
 * `cli/config.ts` and `cli/edit-tokens.ts`.
 */

import { flagPresent, parseArguments } from "./args";
import { runCommand } from "./commands";
import {
	API_KEY_VARIABLE,
	configFilePath,
	DEFAULT_SERVER_URL,
	SERVER_URL_VARIABLE,
} from "./config";
import { ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE } from "./client";
import { editTokensPath } from "./edit-tokens";
import { exitCodeFor } from "./errors";

function usage(): string {
	return `omul — drive an omul server from a terminal (REQ180)

Usage:
  omul [--server URL] [--json] <command> [arguments]

Commands:
  health                     Check the server and print its discovery links
  auth login                 Store a personal API key, read from a prompt or stdin
  auth status                Report what this client would use, printing no secret
  auth logout                Forget the stored API key (edit tokens are kept)
  templates                  List the built-in deck templates
  create [options]           Create a presentation
  list                       List the presentations this account owns
  show <id>                  A presentation's current state
  results <id>               Aggregated results for every slide
  help                       This text

Create options:
  --title TEXT               The deck's title (overrides the one in --deck)
  --deck FILE                JSON body of the create ("-" reads standard input):
                             {"title": "…", "slides": [{"type": "…", "question": "…"}]}
                             Slides and their options are given ids where they carry none.
  --template ID              Start from a catalog entry (see \`omul templates\`)
  --language TAG             Participant-facing language, e.g. "de" (default "en")
  --mode live|survey         Presenter-paced (default) or audience-paced

Global options:
  --server URL               The omul server to talk to (default ${DEFAULT_SERVER_URL})
  --json                     Print the server's payload as JSON instead of a summary

Credentials:
  A personal API key is minted in the account settings of the web UI and read from
  ${API_KEY_VARIABLE}, or from ${configFilePath()} — never from a command-line flag, because
  argv is readable by other processes and is written to shell history. \`omul auth login\`
  writes that file with mode 0600.

  A deck created without an API key is authorized by an edit token the server returns
  exactly once. It is written to ${editTokensPath()} and is never
  printed: that file is the only copy, and losing it means losing the deck's editability.

  Neither credential is sent to an http:// host that is not loopback — an edit token
  least of all, since no account owns it and there is nothing to revoke. Set
  ${ALLOW_PLAINTEXT_CREDENTIALS_VARIABLE}=true to allow it on a network you trust.

Environment:
  ${API_KEY_VARIABLE}                The personal API key
  ${SERVER_URL_VARIABLE}             The server to talk to, when --server is not given

Exit codes:
  0 success · 1 the attempt failed · 2 the invocation was wrong`;
}

// Everything, parsing included, inside the one handler: a malformed command
// line is a stated refusal with exit code 2, not a stack trace.
try {
	const parsed = parseArguments(Bun.argv.slice(2));
	const firstWord = parsed.words[0] ?? "";
	if (
		firstWord === "" ||
		firstWord === "help" ||
		flagPresent(parsed, "help") ||
		flagPresent(parsed, "h")
	) {
		console.log(usage());
		process.exit(0);
	}

	const output = await runCommand(parsed);
	if (flagPresent(parsed, "json")) {
		console.log(JSON.stringify(output.data, null, "\t"));
	} else {
		for (const line of output.lines) console.log(line);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(exitCodeFor(error));
}
