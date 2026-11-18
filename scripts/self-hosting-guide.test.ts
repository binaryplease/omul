/**
 * The Docker-free guide builds what the container builds (REQ249).
 *
 * `.mise.toml` sets `NODE_ENV=development` for every command mise runs, over
 * anything exported in the shell, and `mise run build` overrides it for the
 * server half only. A guide that builds with that task ships React's
 * development client to production, and nothing in the build output says so —
 * the batch review found it by grepping the bundle for `jsxDEV`. Held here
 * because the guide is prose, and prose drifts back to the short command.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GUIDE = readFileSync(
	join(import.meta.dir, "..", "docs", "self-hosting-without-docker.md"),
	"utf-8",
);

/** The guide's shell blocks, with continued lines joined into one command. */
function shellCommands(): string[] {
	const blocks = [...GUIDE.matchAll(/```sh\n([\s\S]*?)```/g)].map(
		(match) => match[1] ?? "",
	);
	return blocks.flatMap((block) =>
		block
			.replace(/\\\n\s*/g, "")
			.split("\n")
			.map((line) => line.replace(/\s+#.*$/, "").trim())
			.filter((line) => line.length > 0),
	);
}

describe("the self-hosting guide's build (REQ249)", () => {
	const commands = shellCommands();
	const builds = commands.filter((command) =>
		/\bbunx vite build\b|\bbun build\b/.test(command),
	);

	test("builds the client and the server, at the first install and the upgrade", () => {
		expect(builds.filter((command) => command.includes("vite build")).length).toBe(2);
		expect(builds.filter((command) => command.includes("bun build")).length).toBe(2);
	});

	test("every build sets NODE_ENV=production inside mise, where mise cannot override it", () => {
		for (const command of builds) {
			expect(command).toMatch(/^mise exec -- env NODE_ENV=production /);
		}
	});

	test("no command builds with the mise task, whose client is a development build", () => {
		expect(commands.some((command) => command.includes("mise run build"))).toBe(false);
	});
});
