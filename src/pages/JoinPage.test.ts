/**
 * The join entry is translated (REQ248) and does nothing more than it did:
 * a refused join shows its message on the page, a deck that asks its room to
 * sign in included (review of REQ248: the port had made that refusal open the
 * participant page instead, a behaviour change outside a text port).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "JoinPage.tsx"), "utf8");

describe("the join page's refusals (REQ248)", () => {
	test("a sign-in refusal is not routed anywhere", () => {
		expect(source).not.toContain('"sign-in-required"');
		expect(source.match(/go\(\{ page: "participate"/g)?.length).toBe(1);
	});

	test("an unknown code is worded in the interface language", () => {
		expect(source).toContain("setError(words.codeNotFound);");
	});
});
