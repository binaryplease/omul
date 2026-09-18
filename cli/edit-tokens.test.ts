/**
 * The edit-token store (`cli/edit-tokens.ts`).
 *
 * The token a create returns is the **only** copy of what authorizes that deck
 * — the server keeps a hash and returns the plaintext once — so the two
 * failures worth a test are the two ways the file stops being that copy: it
 * becomes readable by somebody else, or a later write drops what an earlier one
 * put in it. A third is held here too: an unreadable file must not be treated
 * as empty, because the next create would then overwrite every token in it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	dataDirectory,
	editTokensPath,
	heldPresentationIds,
	readEditToken,
	storeEditToken,
} from "./edit-tokens";
import { CliError } from "./errors";

const INHERITED_DATA_HOME = process.env.XDG_DATA_HOME;
let home = "";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "omul-cli-tokens-"));
	process.env.XDG_DATA_HOME = home;
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	if (INHERITED_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME;
	else process.env.XDG_DATA_HOME = INHERITED_DATA_HOME;
});

describe("the edit-token store", () => {
	test("is written owner-only, in an owner-only directory", () => {
		const path = storeEditToken("deck-1", "token-1");
		expect(path).toBe(editTokensPath());
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(dataDirectory()).mode & 0o777).toBe(0o700);
	});

	test("a second create does not drop the first deck's token", () => {
		storeEditToken("deck-1", "token-1");
		storeEditToken("deck-2", "token-2");
		expect(readEditToken("deck-1")).toBe("token-1");
		expect(readEditToken("deck-2")).toBe("token-2");
		expect(heldPresentationIds()).toEqual(["deck-1", "deck-2"]);
	});

	test("a deck this client never created holds no token", () => {
		expect(readEditToken("deck-nobody-created")).toBeNull();
		expect(heldPresentationIds()).toEqual([]);
	});

	test("a malformed store is a crash, never an empty one", () => {
		mkdirSync(dataDirectory(), { recursive: true });
		writeFileSync(editTokensPath(), "{ not json");
		expect(() => readEditToken("deck-1")).toThrow(CliError);
		expect(() => readEditToken("deck-1")).toThrow(editTokensPath());
	});

	test("an entry that is not a string is refused by id", () => {
		mkdirSync(dataDirectory(), { recursive: true });
		writeFileSync(
			editTokensPath(),
			JSON.stringify({ tokens: { "deck-1": { token: "nested" } } }),
		);
		expect(() => readEditToken("deck-1")).toThrow(/deck-1/);
	});
});
