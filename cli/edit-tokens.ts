/**
 * The per-presentation edit tokens this client holds, and the file they live
 * in.
 *
 * A deck created **without** an account is authorized by a token the server
 * generates on the create, returns exactly once, and keeps only the hash of
 * (`docs/api.md`, "Per-presentation edit token"). There is no second copy
 * anywhere: a caller who loses it has a deck nobody can ever edit again, and a
 * caller who leaks it has handed someone else full control of that deck without
 * an account to revoke. So the token is written straight to disk on the create
 * — mode `0600`, in a `0700` directory — and is **never printed**, not by
 * `create`, not by `--json`, not by an error. The browser client makes the same
 * trade with `localStorage` (`src/storage.ts`); this is its terminal
 * equivalent, and the same warning applies to both: the store is the only copy.
 *
 * A create authenticated by a personal API key is minted **no** token at all —
 * the key already owns the deck — so nothing is written here for it. That is
 * the server's decision (`server/routes/presentations.ts`), not this client's
 * to second-guess: it stores a token when one comes back and stays empty when
 * one does not.
 *
 * `$XDG_DATA_HOME/omul/edit-tokens.json` (falling back to `~/.local/share`)
 * rather than the config directory, because this is state the client
 * accumulated rather than configuration a person wrote.
 */

import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors";

/**
 * The file's shape. Nested under a key rather than stored as a bare map so a
 * later field has somewhere to go without every existing file becoming one.
 */
interface TokenFile {
	tokens: Record<string, string>;
}

/** `$XDG_DATA_HOME/omul`, or `~/.local/share/omul`. */
export function dataDirectory(): string {
	const xdg = process.env.XDG_DATA_HOME?.trim();
	const base = xdg ? xdg : join(homedir(), ".local", "share");
	return join(base, "omul");
}

/** The file the tokens are kept in. */
export function editTokensPath(): string {
	return join(dataDirectory(), "edit-tokens.json");
}

/**
 * Every token this client holds, keyed by presentation id — or an empty map
 * when the file does not exist yet.
 *
 * A file that exists and cannot be parsed is a crash naming the path. The
 * alternative, treating it as empty, would let the next create overwrite a file
 * whose other entries are the only copies of the tokens in it.
 */
function readTokenFile(): TokenFile {
	const path = editTokensPath();
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { tokens: {} };
		}
		throw new CliError(`Cannot read ${path}: ${(error as Error).message}`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new CliError(`${path} is not valid JSON: ${(error as Error).message}`);
	}
	const tokens = (parsed as { tokens?: unknown } | null)?.tokens;
	if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens)) {
		throw new CliError(`${path}: "tokens" must be a JSON object.`);
	}
	const collected: Record<string, string> = {};
	for (const [presentationId, token] of Object.entries(tokens)) {
		if (typeof token !== "string") {
			throw new CliError(
				`${path}: the entry for ${presentationId} must be a string.`,
			);
		}
		collected[presentationId] = token;
	}
	return { tokens: collected };
}

/**
 * Write the file back, owner-readable only — see {@link writeConfigFile} in
 * `cli/config.ts` for why it goes through a temporary file.
 */
function writeTokenFile(file: TokenFile): void {
	const directory = dataDirectory();
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = editTokensPath();
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(file, null, "\t")}\n`, {
		mode: 0o600,
	});
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
}

/** The token held for one presentation, or `null`. */
export function readEditToken(presentationId: string): string | null {
	return readTokenFile().tokens[presentationId] ?? null;
}

/**
 * Record the token a create returned. Returns the path it was written to, so
 * the caller can say *where* the secret went without saying what it is.
 */
export function storeEditToken(presentationId: string, token: string): string {
	const file = readTokenFile();
	file.tokens[presentationId] = token;
	writeTokenFile(file);
	return editTokensPath();
}

/**
 * Which presentations this client holds a token for. The ids are not secret —
 * they are in every URL — so they may be listed; the tokens may not.
 */
export function heldPresentationIds(): string[] {
	return Object.keys(readTokenFile().tokens).sort();
}
