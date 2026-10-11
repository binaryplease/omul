/**
 * Where the personal API key comes from and what the file holding it looks like
 * on disk (`cli/config.ts`).
 *
 * This is credential-handling code, so the cases that matter are the ones that
 * would leak or lose the key rather than the ones that read it back:
 *
 *  - the file is written **owner-readable only**, inside an owner-only
 *    directory, and it is written that way on the *first* write rather than
 *    after a chmod that a crash could skip;
 *  - a config file that is present but unreadable is a **crash naming the
 *    path**, not an empty configuration — the second one tells a caller who has
 *    a key on disk that they have none, and sends them to mint another;
 *  - a server URL carrying credentials is refused, because it would ride every
 *    request and be echoed back by any error that names the base URL.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	configDirectory,
	configFilePath,
	DEFAULT_SERVER_URL,
	normalizeBaseUrl,
	readConfigFile,
	removeConfigFile,
	resolveSettings,
	writeConfigFile,
} from "./config";
import { CliError } from "./errors";

const INHERITED = {
	config: process.env.XDG_CONFIG_HOME,
	apiKey: process.env.OMUL_API_KEY,
	serverUrl: process.env.OMUL_SERVER_URL,
};

let home = "";

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "omul-cli-config-"));
	process.env.XDG_CONFIG_HOME = home;
	delete process.env.OMUL_API_KEY;
	delete process.env.OMUL_SERVER_URL;
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	restore("XDG_CONFIG_HOME", INHERITED.config);
	restore("OMUL_API_KEY", INHERITED.apiKey);
	restore("OMUL_SERVER_URL", INHERITED.serverUrl);
});

function restore(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

describe("the config file", () => {
	test("is written owner-only, in an owner-only directory", () => {
		const path = writeConfigFile({ serverUrl: null, apiKey: "secret-key" });
		expect(path).toBe(configFilePath());
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(configDirectory()).mode & 0o777).toBe(0o700);
	});

	test("reads back what was written", () => {
		writeConfigFile({ serverUrl: "https://omul.example.com", apiKey: "k" });
		expect(readConfigFile()).toEqual({
			serverUrl: "https://omul.example.com",
			apiKey: "k",
		});
	});

	test("an absent file is the empty configuration, not an error", () => {
		expect(readConfigFile()).toEqual({ serverUrl: null, apiKey: null });
	});

	test("a malformed file crashes naming the path rather than reading as empty", () => {
		mkdirSync(configDirectory(), { recursive: true });
		writeFileSync(configFilePath(), "{ not json");
		expect(() => readConfigFile()).toThrow(CliError);
		expect(() => readConfigFile()).toThrow(configFilePath());
	});

	test("a field of the wrong type is refused by name", () => {
		mkdirSync(configDirectory(), { recursive: true });
		writeFileSync(configFilePath(), JSON.stringify({ apiKey: 42 }));
		expect(() => readConfigFile()).toThrow(/"apiKey" must be a string/);
	});

	test("removing it is idempotent", () => {
		writeConfigFile({ serverUrl: null, apiKey: "k" });
		removeConfigFile();
		removeConfigFile();
		expect(readConfigFile().apiKey).toBeNull();
	});
});

describe("normalizeBaseUrl", () => {
	test("drops a trailing slash and keeps a proxied path prefix", () => {
		expect(normalizeBaseUrl("https://omul.example.com/", "config file")).toBe(
			"https://omul.example.com",
		);
		expect(normalizeBaseUrl("https://host/omul/", "config file")).toBe(
			"https://host/omul",
		);
	});

	test("refuses credentials in the URL", () => {
		expect(() => normalizeBaseUrl("https://user:pw@host", "--server")).toThrow(
			/must not carry credentials/,
		);
	});

	test("refuses a scheme this API is not reachable over", () => {
		expect(() => normalizeBaseUrl("ftp://host", "--server")).toThrow(
			/http:\/\/ or https:\/\//,
		);
	});

	test("refuses a query or a fragment", () => {
		expect(() => normalizeBaseUrl("https://host/?a=1", "--server")).toThrow(
			/query or a fragment/,
		);
	});

	test("says which source a bad value came from", () => {
		expect(() => normalizeBaseUrl("not a url", "environment")).toThrow(
			/from environment/,
		);
	});
});

describe("resolveSettings", () => {
	test("falls back to the dev server when nothing is configured", () => {
		const settings = resolveSettings(null);
		expect(settings.baseUrl).toBe(DEFAULT_SERVER_URL);
		expect(settings.baseUrlSource).toBe("default");
		expect(settings.apiKey).toBeNull();
		expect(settings.apiKeySource).toBe("none");
	});

	test("the environment wins over the file, and --server over both", () => {
		writeConfigFile({ serverUrl: "https://from-file", apiKey: "file-key" });
		process.env.OMUL_SERVER_URL = "https://from-environment";
		process.env.OMUL_API_KEY = "environment-key";

		const environmentOnly = resolveSettings(null);
		expect(environmentOnly.baseUrl).toBe("https://from-environment");
		expect(environmentOnly.baseUrlSource).toBe("environment");
		expect(environmentOnly.apiKey).toBe("environment-key");
		expect(environmentOnly.apiKeySource).toBe("environment");

		const withFlag = resolveSettings("https://from-flag");
		expect(withFlag.baseUrl).toBe("https://from-flag");
		expect(withFlag.baseUrlSource).toBe("--server");
	});

	test("an empty value in the environment is no value at all", () => {
		writeConfigFile({ serverUrl: null, apiKey: "file-key" });
		process.env.OMUL_API_KEY = "   ";
		const settings = resolveSettings(null);
		expect(settings.apiKey).toBe("file-key");
		expect(settings.apiKeySource).toBe("config file");
	});
});
