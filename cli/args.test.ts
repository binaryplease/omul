/**
 * The command line the client is driven by (`cli/args.ts`).
 *
 * What these hold is the refusals rather than the happy path: a flag this
 * client does not know, a flag given twice, a flag whose value went missing.
 * Each of those has a silent reading — ignore it, take the last one, treat the
 * next flag as the value — and every silent reading ends with a caller
 * believing a deck was created with a title, a template or a server it never
 * got.
 */

import { describe, expect, test } from "bun:test";
import {
	flagPresent,
	flagValue,
	parseArguments,
	requireKnownFlags,
	requiredWord,
} from "./args";
import { UsageError } from "./errors";

describe("parseArguments", () => {
	test("keeps positional words in order", () => {
		const parsed = parseArguments(["results", "deck-1"]);
		expect(parsed.words).toEqual(["results", "deck-1"]);
		expect(parsed.flags).toEqual({});
	});

	test("reads both --flag value and --flag=value", () => {
		const parsed = parseArguments(["create", "--title", "Retro", "--mode=survey"]);
		expect(parsed.words).toEqual(["create"]);
		expect(parsed.flags).toEqual({ title: "Retro", mode: "survey" });
	});

	test("a bare flag is true", () => {
		expect(parseArguments(["list", "--json"]).flags.json).toBe(true);
	});

	test("a flag with no value does not swallow the flag behind it", () => {
		const parsed = parseArguments(["create", "--title", "--json"]);
		expect(parsed.flags.title).toBe(true);
		expect(parsed.flags.json).toBe(true);
		expect(() => flagValue(parsed, "title")).toThrow(UsageError);
	});

	test("the same flag twice is refused rather than resolved", () => {
		expect(() => parseArguments(["create", "--title", "a", "--title", "b"])).toThrow(
			/--title was given twice/,
		);
	});

	test('"--" on its own is not an option', () => {
		expect(() => parseArguments(["create", "--"])).toThrow(UsageError);
	});
});

describe("flag helpers", () => {
	test("an unknown flag names itself and what the command does take", () => {
		const parsed = parseArguments(["create", "--titel", "Retro"]);
		expect(() => requireKnownFlags(parsed, ["title", "json"], "create")).toThrow(
			/--titel/,
		);
		expect(() => requireKnownFlags(parsed, ["title", "json"], "create")).toThrow(
			/--title/,
		);
	});

	test("a missing flag reads as null rather than as an empty value", () => {
		expect(flagValue(parseArguments(["create"]), "title")).toBeNull();
	});

	test("a boolean flag given a value is refused", () => {
		const parsed = parseArguments(["list", "--json=yes"]);
		expect(() => flagPresent(parsed, "json")).toThrow(UsageError);
	});

	test("a required word is named in the refusal when it is absent", () => {
		expect(() =>
			requiredWord(parseArguments(["results"]), 1, "results", "a presentation id"),
		).toThrow(/a presentation id/);
		expect(
			requiredWord(parseArguments(["results", "deck-1"]), 1, "results", "an id"),
		).toBe("deck-1");
	});
});
