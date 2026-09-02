/**
 * The license claim has to be true, and it is spread over nine files.
 *
 * REQ161 and REQ170 put a dual-license instrument, a third-party enumeration
 * and a trademark reservation into the tree, and REQ162 added the contributor
 * license agreement that keeps the dual half offerable. None of that is
 * executed by anything, so nothing else in this repository notices when one of
 * the copies drifts — and publication is one-way, so a contradiction that
 * reaches the public tree cannot be withdrawn from the clones.
 *
 * Five drifts are held here. The first four have each already happened once:
 *
 *   - **The storage layer's license going unstated.** It was a vendored source
 *     tree whose manifest said the repository's dual license while its own
 *     README, two files away, said "Proprietary — <a company>". It is an MIT
 *     package from npm now, so the drift that replaces that one is the MIT
 *     notice going missing from a distribution that inlines the library.
 *   - **The SPDX expression spelled differently in different files.** It
 *     appears in five, and a licence-detection tool reads them literally.
 *   - **A mark file with no row in `TRADEMARK.md`.** REQ170's exclusion is
 *     "by name or by path", so an unlisted file under `public/brand/` is a hole
 *     in it — and a row that mis-describes the file it names (two of them said
 *     "512 px" for a 2400 × 979 export) is a claim that is simply false.
 *   - **The trademark reservation re-worded as a copyright carve-out.**
 *     AGPL-3.0 §7(e) permits declining to grant *trademark* rights; §10 forbids
 *     imposing further restrictions, so pulling Corresponding Source out of the
 *     copyright grant is the one shape this file must not take.
 *   - **The CLA's signing sentence drifting from the bot that accepts it.**
 *     The fifth, and the only one written before it happened: the sentence
 *     lives in CLA.md and twice in `.github/workflows/cla.yaml`, and a
 *     contributor who copies it out of the document and gets no acknowledgement
 *     has no route at all — the check that blocks the merge is the same one
 *     that would have recorded the signature.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

function readRepoFile(relativePath: string): string {
	return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function readRepoJson(relativePath: string): Record<string, unknown> {
	return JSON.parse(readRepoFile(relativePath));
}

/** The one spelling of the dual grant, taken from the manifest that ships it. */
const SPDX_EXPRESSION = readRepoJson("package.json").license as string;

/** The copyright holder is a natural person, never an organisation (D6). */
const COPYRIGHT_HOLDER = "Enrico Scherlies";

describe("the dual-license expression is spelled the same everywhere", () => {
	test("the root manifest carries it at all", () => {
		expect(SPDX_EXPRESSION).toBe(
			"AGPL-3.0-only OR LicenseRef-omul-Commercial",
		);
	});

	for (const file of [
		"README.md",
		"NOTICE.md",
		"LICENSE-COMMERCIAL",
		"TRADEMARK.md",
	]) {
		test(`${file} spells it identically`, () => {
			expect(readRepoFile(file)).toContain(SPDX_EXPRESSION);
		});
	}

	test("the root manifest and the npm lockfile agree on the package name", () => {
		const name = readRepoJson("package.json").name;
		const lock = readRepoJson("package-lock.json");
		expect(name).toBe("omul");
		expect(lock.name).toBe(name);
		expect((lock.packages as Record<string, { name?: string }>)[""].name).toBe(
			name,
		);
	});
});

describe("the storage layer is an MIT dependency, and its notice travels", () => {
	// The vendored snapshot at `vendor/binp-docstore/` is gone: the library is
	// installed from npm as `@binaryplease/zodstore` and NOTICE.md §2 states the
	// MIT position instead of the repository's own. What used to drift here was
	// two files disagreeing about the vendored tree's license; what can drift
	// now is the notice going missing from a distribution that bundles the code.
	const notice = readRepoFile("NOTICE.md");
	const manifest = readRepoJson("package.json") as {
		dependencies: Record<string, string>;
	};

	test("it is a registry dependency, not a file: path into the tree", () => {
		const specifier = manifest.dependencies["@binaryplease/zodstore"];
		expect(specifier).toBeDefined();
		expect(specifier).not.toContain("file:");
		expect(Object.keys(manifest.dependencies)).not.toContain("binp-docstore");
	});

	test("nothing is vendored into the tree any more", () => {
		expect(existsSync(join(REPO_ROOT, "vendor"))).toBe(false);
	});

	test("NOTICE.md names the package and its license", () => {
		expect(notice).toContain("@binaryplease/zodstore");
		expect(notice).toContain("MIT License");
	});

	test("NOTICE.md reproduces the MIT notice the bundle has to carry", () => {
		// MIT §"The above copyright notice … shall be included in all copies or
		// substantial portions" — the library is inlined into
		// dist/server/index.js, so this file is where that obligation is met.
		expect(notice).toContain(`Copyright (c) 2026 ${COPYRIGHT_HOLDER}`);
		expect(notice).toContain(
			"The above copyright notice and this permission notice shall be included",
		);
		expect(notice).toMatch(/THE SOFTWARE IS PROVIDED "AS IS"/);
	});

	test("the notice in the tree matches the one the package ships", () => {
		// Read from the installed package rather than restated, so a version
		// that changes its notice cannot leave a stale copy standing here.
		const shipped = readFileSync(
			join(REPO_ROOT, "node_modules/@binaryplease/zodstore/LICENSE"),
			"utf8",
		);
		for (const line of shipped.split("\n\n")) {
			const paragraph = line.trim().replace(/\s+/g, " ");
			if (paragraph.length === 0) continue;
			expect(notice.replace(/\n> ?/g, " ").replace(/\s+/g, " ")).toContain(
				paragraph,
			);
		}
	});
});

describe("every brand mark is named in the trademark policy", () => {
	const policy = readRepoFile("TRADEMARK.md");
	const markFiles = readdirSync(join(REPO_ROOT, "public/brand")).sort();

	test("there are marks to name", () => {
		expect(markFiles.length).toBeGreaterThan(0);
	});

	for (const name of markFiles) {
		test(`${name} has a row`, () => {
			expect(policy).toContain(`\`public/brand/${name}\``);
		});
	}

	for (const name of markFiles.filter((f) => f.endsWith(".png"))) {
		test(`${name}'s row states the raster's real size`, () => {
			// PNG: 8-byte signature, then the IHDR chunk — 4-byte length, the
			// "IHDR" tag, then width and height as big-endian uint32.
			const png = readFileSync(join(REPO_ROOT, "public/brand", name));
			const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
			const dimensions = `${view.getUint32(16)} × ${view.getUint32(20)}`;

			const row = policy
				.split("\n")
				.find((line) => line.includes(`\`public/brand/${name}\``));
			expect(row).toBeDefined();
			expect(row).toContain(dimensions);
		});
	}
});

describe("the mark position is a trademark reservation, not a copyright carve-out", () => {
	const policy = readRepoFile("TRADEMARK.md");

	test("it rests on the additional-term permission that allows it", () => {
		expect(policy).toContain("§7(e)");
	});

	test("it does not withhold the copyright license over the mark files", () => {
		// AGPL-3.0 §10 forbids further restrictions, and every path the policy
		// names is Corresponding Source: `public/brand/` is loaded by
		// src/index.html and WORDMARK_GEOMETRY is dereferenced at render time.
		expect(policy).not.toMatch(/not\s+licensed\s+under\s+LICENSE-AGPL-3\.0/i);
		expect(policy).not.toMatch(/excluded\s+from\s+the\s+code\s+license/i);
	});

	test("it grants redistribution of the marks with the source, in writing", () => {
		expect(policy).toMatch(/you\s+may\s+always\s+redistribute\s+them/i);
	});

	test("what it withholds is identifying a build with the mark", () => {
		expect(policy).toMatch(/if you change the code, change the mark/i);
		expect(policy).toMatch(/modified build in front of users/i);
	});
});

describe("the contact route is real, singular and identical in every file", () => {
	// Three files are the only route a reader has: LICENSE-COMMERCIAL is the only
	// way to reach the commercial half of the dual license, TRADEMARK.md the only
	// way to ask whether a use of the name is permitted, and CLA.md the only way
	// to sign without a GitHub account or to send an employer's waiver. A dead or
	// drifting address in any of them is a route that silently discards every
	// message, and publishing it does not reverse.
	const CONTACT = "support@hyhyve.com";
	const ANY_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

	for (const file of ["LICENSE-COMMERCIAL", "TRADEMARK.md", "CLA.md"]) {
		test(`${file} names the contact and nothing else`, () => {
			const text = readRepoFile(file);
			expect(text).toContain(CONTACT);
			// A second address here means two routes, one of which will go stale.
			expect([...new Set(text.match(ANY_ADDRESS) ?? [])]).toEqual([CONTACT]);
		});

		test(`${file} no longer carries the unresolved-contact banner`, () => {
			expect(readRepoFile(file)).not.toContain("UNRESOLVED");
		});
	}
});

describe("the CLA and the check that enforces it say the same thing", () => {
	// The commercial half of the dual license is only offerable over code whose
	// rights the holder holds, so one unsigned outside commit on `main` removes
	// that option for those lines permanently. The document alone does not stop
	// that — the pull-request check does, and the two have to quote the same
	// sentence: the action compares a reply against `custom-pr-sign-comment`,
	// and a contributor copies it out of CLA.md.
	const cla = readRepoFile("CLA.md");
	const workflow = readRepoFile(".github/workflows/cla.yaml");

	/** The signature. Changing it here is changing it in three places at once. */
	const SIGN_SENTENCE =
		"I have read the CLA Document and I hereby sign the CLA";

	test("CLA.md quotes the sentence a contributor has to reply with", () => {
		expect(cla).toContain(SIGN_SENTENCE);
	});

	test("the workflow guards on it and configures the action with it", () => {
		// Once in the `if:` that keeps unrelated comments from starting a job,
		// once as `custom-pr-sign-comment`. Both, or the bot answers a sentence
		// nobody was told to write.
		const occurrences = workflow.split(SIGN_SENTENCE).length - 1;
		expect(occurrences).toBe(2);
	});

	test("the signed document is pinned to a commit, not to a moving ref", () => {
		// The signature record stores no document version, so this URL is the
		// only evidence of what a signer agreed to — and CLA.md §10 makes a new
		// version non-retroactive, which `blob/main/` cannot express because
		// `main` moves. Matching only `/CLA.md` would also accept a URL into
		// somebody else's repository, so the owner and repo are pinned too.
		expect(workflow).toMatch(
			/path-to-document: https:\/\/github\.com\/binaryplease\/omul\/blob\/[0-9a-f]{40}\/CLA\.md\s*$/m,
		);
		expect(workflow).not.toMatch(/path-to-document:.*\/blob\/(main|master)\//);
	});

	test("the grant is a license and never an assignment", () => {
		// The whole contributor-facing promise, in CONTRIBUTING.md and README.md
		// as well as in §4. A CLA that quietly became an assignment would keep
		// every other test in this file green. The positive pair is what carries
		// this; the negative is case-insensitive and covers the phrasings an
		// assignment clause is actually written in, rather than one literal.
		expect(cla).toMatch(/This agreement is a license, not an assignment/);
		expect(cla).toMatch(/You retain all right, title and interest/);
		expect(cla).not.toMatch(
			/\b(you|contributor)\s+(do\s+)?(hereby\s+)?(irrevocably\s+)?assigns?\b/i,
		);
	});

	test("§5 keeps the contribution available as free software", () => {
		// The consideration the contributor gets back. Without it the agreement
		// is a one-way grant, and the summary in CONTRIBUTING.md and README.md
		// that promises it would be false.
		// `\s+` rather than a space: the document is hard-wrapped, so either
		// name can straddle a line break and does.
		expect(cla).toContain("AGPL-3.0-only");
		expect(cla).toMatch(/Open\s+Source\s+Initiative/);
		expect(cla).toMatch(/Free\s+Software\s+Foundation/);
	});

	test("§5 keeps the remedy that makes that promise enforceable", () => {
		// The undertaking without the reversion is a preference, not a term: it
		// is the clause that costs the Owner something if the free grant stops.
		// Deleting it leaves every other assertion above green.
		expect(cla).toMatch(/If the Owner ever fails to keep this undertaking/);
		expect(cla).toMatch(/revert to a\s+license under AGPL-3\.0-only alone/);
		// Sublicenses already granted have to survive the reversion, or the
		// clause would retroactively break third parties who relied on §2.
		expect(cla).toMatch(/a sublicense already given stays given/i);
	});

	test("the contributor-facing files point at it and describe it the same way", () => {
		for (const file of ["CONTRIBUTING.md", "README.md"]) {
			const text = readRepoFile(file);
			expect(text).toContain("CLA.md");
			expect(text).toMatch(/license, not an assignment/i);
		}
		// The pull-request template is where a contributor meets the requirement
		// at the moment it applies to them.
		expect(readRepoFile(".github/PULL_REQUEST_TEMPLATE.md")).toContain(
			"CLA.md",
		);
	});

	test("nothing still says the terms are unsettled", () => {
		// Three files said so until the text landed, and one of them contradicted
		// another for a week. The claim is false now wherever it survives.
		for (const file of [
			"CONTRIBUTING.md",
			"README.md",
			".github/PULL_REQUEST_TEMPLATE.md",
		]) {
			const text = readRepoFile(file);
			expect(text).not.toMatch(/terms are not settled/i);
			expect(text).not.toMatch(/being drafted/i);
			expect(text).not.toMatch(/held rather than merged/i);
		}
	});
});

describe("the CLA check decides on things GitHub authenticates", () => {
	// A security review of this workflow (NST10690) found that its *shape* was
	// right — no `actions/checkout`, no attacker-controlled value reaching a
	// shell, so the `pull_request_target` code-execution class is structurally
	// absent — while its *decision logic* was not. Every assertion below is one
	// of that review's failure scenarios, held so the fix cannot be undone by
	// someone restoring a convenience.
	const workflow = readRepoFile(".github/workflows/cla.yaml");

	test("no allowlist, because every allowlist entry is self-declarable", () => {
		// The bypass: when a commit author's email is linked to no GitHub
		// account the action falls through to the raw git author object, so the
		// name it matches is whatever `git config user.name` was set to. A
		// pattern containing `*` is compiled to an *unanchored* regex, so
		// `bot*` matched any name merely containing "bot"; a pattern without one
		// is an exact compare a spoofed display name satisfies just as easily.
		// `git config user.name robot` with an unlinked email was enough to make
		// this check report green with nothing signed.
		expect(workflow).not.toMatch(/^\s*allowlist:/m);
	});

	test("the third-party action is pinned to a commit, not to a tag", () => {
		// The job holds a token that can push anywhere in this repository, and a
		// tag is mutable: whoever can move it runs code with that token on every
		// pull request.
		expect(workflow).toMatch(
			/uses: contributor-assistant\/github-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/,
		);
		expect(workflow).not.toMatch(/uses:.*@v\d/);
	});

	test("the pin is maintained rather than frozen", () => {
		// A SHA nobody bumps is not hardening, it is an unmonitored dependency.
		const dependabot = readRepoFile(".github/dependabot.yml");
		expect(dependabot).toMatch(/package-ecosystem:\s*github-actions/);
	});

	test("the comment gate is no stricter than the matcher it guards", () => {
		// The action accepts `body.trim().toLowerCase()`, so an exact-equality
		// gate would drop a reply with a trailing newline before the job started
		// — no comment, no check update, no error, and the contributor has no
		// route at all. `contains` fails in the safe direction instead.
		expect(workflow).toMatch(/contains\(github\.event\.comment\.body,/);
		expect(workflow).not.toMatch(/github\.event\.comment\.body\s*==/);
	});

	test("a pull request longer than the action can enumerate is refused", () => {
		// The action reads one `commits(first: 100)` page and never follows
		// `pageInfo`, so authors of commits 101+ go unchecked: pad with 100
		// innocuous commits, put the unsigned one last.
		expect(workflow).toMatch(/github\.event\.pull_request\.commits > 100/);
		expect(workflow).toMatch(/exit 1/);
	});

	test("the concurrency group is the file, not the pull request", () => {
		// Two pull requests keyed separately read-modify-write the same
		// signature file at once; the loser takes a 409 and a contributor who
		// signed correctly sees a red check.
		expect(workflow).toMatch(/^\s*group: cla-signatures$/m);
		expect(workflow).toMatch(/^\s*cancel-in-progress: false$/m);
	});

	test("every granted permission has a code path behind it", () => {
		// The action never calls the commit-status or checks APIs, so
		// `statuses: write` was reach with nothing behind it. `actions` stays at
		// `read`: the rerun convenience lists workflows and runs unguarded on
		// the signing path, while the rerun itself needs a PAT this workflow
		// does not supply and is already caught.
		expect(workflow).not.toMatch(/^\s*statuses:/m);
		expect(workflow).toMatch(/^\s*actions: read$/m);
		expect(workflow).not.toMatch(/^\s*actions: write$/m);
	});

	test("nothing checks out or runs the pull request's own code", () => {
		// The one property that keeps `pull_request_target` safe at all. The
		// only `run:` in the file is the commit-count bound, whose script
		// interpolates nothing.
		expect(workflow).not.toMatch(/uses: actions\/checkout/);
		expect(workflow).not.toMatch(/\$\{\{\s*github\.event\.(comment|pull_request)\.[a-z_.]*(body|title|ref|label)/);
	});
});
