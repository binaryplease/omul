/**
 * Where this client's settings and its personal API key come from, and the file
 * the key is kept in.
 *
 * The key is a **long-lived account credential** — it authenticates every
 * programmatic call the way a password authenticates a browser session — so the
 * question this module answers is not only "what is it" but "how did it get
 * here, and who else can read it". Three sources, most explicit first:
 *
 *  1. **`OMUL_API_KEY`** in the environment. What CI and a container pass, and
 *     the only source that needs no file on disk. It is readable by the user's
 *     own processes and it lands in shell history if it is *typed* inline, so
 *     the help text says to export it from somewhere else.
 *  2. **The config file**, `$XDG_CONFIG_HOME/omul/config.json` (falling back to
 *     `~/.config`), written by `omul auth login` with mode `0600` inside a
 *     `0700` directory. The recommended source for a person at a terminal: the
 *     key is typed once, into a prompt that does not echo it, and never appears
 *     in argv or history again.
 *  3. **Nothing.** An unauthenticated client, which can still create a deck and
 *     read it back through the edit token the server mints for an anonymous
 *     create (`cli/edit-tokens.ts`) — it simply owns nothing and can list
 *     nothing.
 *
 * There is deliberately **no `--api-key` flag**. A process's argv is readable by
 * every other process of the same user through `/proc`, and a shell writes it
 * to history verbatim; an option that invites a caller to paste a long-lived
 * credential onto a command line is a credential leak with a convenient
 * interface, so this client does not have one.
 *
 * The server URL is not a secret and takes the ordinary path: `--server`, then
 * `OMUL_SERVER_URL`, then the config file, then `http://localhost:3000` — the
 * origin `mise run dev` serves on.
 */

import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors";

/** Where a client with nothing configured looks — the dev server's origin. */
export const DEFAULT_SERVER_URL = "http://localhost:3000";

/** The environment variables this client reads, named once. */
export const API_KEY_VARIABLE = "OMUL_API_KEY";
export const SERVER_URL_VARIABLE = "OMUL_SERVER_URL";

/**
 * What the config file may hold. Both keys are optional; neither defaults to
 * a value that would reach the network on its own.
 */
export interface StoredConfig {
	serverUrl: string | null;
	apiKey: string | null;
}

/** Where a resolved value came from, for `auth status` to report. */
export type SettingSource =
	| "--server"
	| "environment"
	| "config file"
	| "default"
	| "prompt"
	| "none";

/** Everything a command needs to reach a server, and the provenance of each. */
export interface Settings {
	/** Base URL with no trailing slash — `/api/...` is appended to it. */
	baseUrl: string;
	baseUrlSource: SettingSource;
	apiKey: string | null;
	apiKeySource: SettingSource;
}

/** `$XDG_CONFIG_HOME/omul`, or `~/.config/omul`. */
export function configDirectory(): string {
	const xdg = process.env.XDG_CONFIG_HOME?.trim();
	const base = xdg ? xdg : join(homedir(), ".config");
	return join(base, "omul");
}

/** The file `omul auth login` writes. */
export function configFilePath(): string {
	return join(configDirectory(), "config.json");
}

/**
 * Read the config file, or the empty configuration when there is none.
 *
 * A file that exists and is not readable configuration is a **crash** naming
 * the path, not an empty default: a caller whose `config.json` lost its closing
 * brace has a key on disk and would otherwise be told only that they are not
 * signed in, which sends them to mint a second key for a problem an editor
 * fixes.
 */
export function readConfigFile(): StoredConfig {
	const path = configFilePath();
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { serverUrl: null, apiKey: null };
		}
		throw new CliError(`Cannot read ${path}: ${(error as Error).message}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new CliError(`${path} is not valid JSON: ${(error as Error).message}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new CliError(`${path} must hold a JSON object.`);
	}
	const record = parsed as Record<string, unknown>;
	return {
		serverUrl: readOptionalString(record, "serverUrl", path),
		apiKey: readOptionalString(record, "apiKey", path),
	};
}

/**
 * One optional string field of the config file, refused loudly when it is
 * present as something else.
 */
function readOptionalString(
	record: Record<string, unknown>,
	field: string,
	path: string,
): string | null {
	const value = record[field];
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new CliError(`${path}: "${field}" must be a string.`);
	}
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}

/**
 * Write the config file so that nobody but its owner can read it.
 *
 * Written to a sibling temporary file and renamed, for two reasons that matter
 * for a file holding a credential: the mode is set on a file that has never had
 * the key in it under a readable mode, and a crash halfway through leaves the
 * previous key intact rather than a truncated one. `writeFileSync`'s `mode` is
 * only honoured when it *creates* the file, so the mode is set explicitly
 * afterwards as well — an existing temporary file from an interrupted run must
 * not decide the permissions of the next key.
 */
export function writeConfigFile(config: StoredConfig): string {
	const directory = configDirectory();
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = configFilePath();
	const temporary = `${path}.tmp`;
	const body = `${JSON.stringify(
		{ serverUrl: config.serverUrl, apiKey: config.apiKey },
		null,
		"\t",
	)}\n`;
	writeFileSync(temporary, body, { mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
	return path;
}

/**
 * Drop the config file entirely — what `auth logout` does when nothing but the
 * key was in it. A file that is already gone is not an error.
 */
export function removeConfigFile(): void {
	try {
		unlinkSync(configFilePath());
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw new CliError(
			`Cannot remove ${configFilePath()}: ${(error as Error).message}`,
		);
	}
}

/**
 * Normalize a server URL into the base every request is appended to.
 *
 * Refused loudly rather than repaired, because every one of these is a
 * different server from the one the caller meant:
 *
 *  - a scheme other than `http`/`https` — nothing else reaches this API;
 *  - **credentials in the URL** (`https://user:secret@host`), which would ride
 *    every request and be printed back in any error that names the base URL;
 *  - a query or a fragment, which belong to a page rather than to an origin.
 *
 * A path is kept (minus its trailing slash) so a deployment reverse-proxied
 * under a prefix works, and an origin normalizes to the empty path.
 */
export function normalizeBaseUrl(value: string, source: SettingSource): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new CliError(
			`The server URL from ${source} is not a URL: ${JSON.stringify(value)}.`,
		);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new CliError(
			`The server URL from ${source} must be http:// or https:// — got ${url.protocol}//.`,
		);
	}
	if (url.username !== "" || url.password !== "") {
		throw new CliError(
			`The server URL from ${source} must not carry credentials. Put the API key in ${API_KEY_VARIABLE} or run \`omul auth login\`.`,
		);
	}
	if (url.search !== "" || url.hash !== "") {
		throw new CliError(
			`The server URL from ${source} must not carry a query or a fragment.`,
		);
	}
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path}`;
}

/**
 * Resolve the settings for one invocation: where to talk, what to talk with,
 * and where each of the two came from.
 *
 * The config file is read once here rather than per setting, so a command sees
 * one consistent picture of it.
 */
export function resolveSettings(serverFlag: string | null): Settings {
	const stored = readConfigFile();

	const environmentServer = process.env[SERVER_URL_VARIABLE]?.trim() || null;
	const [rawBaseUrl, baseUrlSource]: [string, SettingSource] = serverFlag
		? [serverFlag, "--server"]
		: environmentServer
			? [environmentServer, "environment"]
			: stored.serverUrl
				? [stored.serverUrl, "config file"]
				: [DEFAULT_SERVER_URL, "default"];

	const environmentKey = process.env[API_KEY_VARIABLE]?.trim() || null;
	const [apiKey, apiKeySource]: [string | null, SettingSource] = environmentKey
		? [environmentKey, "environment"]
		: stored.apiKey
			? [stored.apiKey, "config file"]
			: [null, "none"];

	return {
		baseUrl: normalizeBaseUrl(rawBaseUrl, baseUrlSource),
		baseUrlSource,
		apiKey,
		apiKeySource,
	};
}
