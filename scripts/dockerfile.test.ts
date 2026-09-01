/**
 * The image the container is built on has to be the one that was reviewed.
 *
 * `Dockerfile`'s base image comes from a registry namespace this repository
 * does not control. Referenced by a floating tag alone, every build takes
 * whatever that namespace publishes at that moment: a compromise upstream
 * reaches every image built from here, and nothing in the build output says
 * the base changed. A digest is content-addressed, so it cannot change under
 * the build.
 *
 * Held here rather than left to review because the failure is silent — a
 * digest that gets dropped during an unrelated edit looks exactly like a
 * `Dockerfile` that never had one. Raised as a supply-chain finding against
 * REQ163, whose update log records both halves — this one, and the
 * confidentiality half of the same namespace, which is an owner decision.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOCKERFILE = readFileSync(
	join(import.meta.dir, "..", "Dockerfile"),
	"utf-8",
);

/** Every `FROM` line, with its stage-name and platform flags stripped. */
function fromReferences(): string[] {
	return DOCKERFILE.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^FROM\s/i.test(line))
		.map((line) =>
			line
				.replace(/^FROM\s+/i, "")
				.replace(/^--platform=\S+\s+/i, "")
				.replace(/\s+AS\s+\S+$/i, "")
				.trim(),
		);
}

describe("the Dockerfile's base images", () => {
	test("there is at least one FROM to check", () => {
		expect(fromReferences().length).toBeGreaterThan(0);
	});

	test("every external base image is pinned by digest", () => {
		for (const reference of fromReferences()) {
			// A reference to an earlier stage in this same file carries no
			// registry and needs no digest — it is already content-fixed.
			const isStageReference = !reference.includes("/");
			if (isStageReference) continue;

			expect(reference).toMatch(/@sha256:[0-9a-f]{64}$/);
		}
	});

	test("a tag alone does not satisfy the pin", () => {
		// The guard has to reject the shape it exists to prevent, or it passes
		// vacuously the day someone drops the digest.
		const unpinned = "ghcr.io/example/base:latest";
		expect(unpinned).not.toMatch(/@sha256:[0-9a-f]{64}$/);
	});
});
