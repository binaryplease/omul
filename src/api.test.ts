/**
 * Unit tests for the two pieces of `src/api.ts` that are more than a `fetch`:
 * the one translation of the withheld-tally marker (REQ016/REQ017), and the
 * name this browser remembers having stated on a deck (REQ076).
 *
 * Deliberately narrow on both counts. The rest of the module is `fetch` against
 * endpoints the server suites already drive end to end, and re-asserting a
 * request body here would be a second description of a contract that has one.
 *
 * ## The withheld-tally marker (REQ016/REQ017)
 *
 * The server states a withheld tally rather than emptying it, so a client cannot
 * mistake "kept from you" for "nobody answered". On screen the two are the same
 * instruction, so the client reads the marker back as `null` — and it must do so
 * on **both** results calls. A reader that forgot one would hand a surface
 * `{ type, withheld: true }` with no counts, which every renderer here would draw
 * as "0 of 0 answered" under a question the room has answered.
 *
 * `fetch` is stubbed rather than a server started: what is under test is the
 * projection the client applies to a response, not the response itself — that is
 * covered over HTTP in `server/reveal-mode.integration.test.ts`.
 *
 * ## The remembered name (REQ076)
 *
 * What has no other home is the *local* state those three functions hold,
 * because it is the one thing in the feature the server cannot correct: it
 * decides whether a participant is asked for a name again. Two properties carry
 * it — the memory is **forgettable, per deck** (a reset drops the whole roster
 * server-side, so a browser that could not forget would never be asked again and
 * every answer it gave in the re-run would be stored under nobody), and a value
 * **this browser did not write cannot break the room** (storage is shared,
 * tamperable and outlives shape changes, so a bad read falls back to "not
 * stated" rather than taking the participant screen down).
 *
 * `localStorage` is not part of Bun's runtime, so the smallest working stand-in
 * is installed at module scope below. `src/api.ts` reads the global lazily
 * inside each function rather than at load, so one stub covers all three.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	api,
	buildExportPayload,
	forgetStatedParticipantName,
	getStatedParticipantName,
	rememberStatedParticipantName,
} from "./api";

const realFetch = globalThis.fetch;

/** Answer every request with `body`, and record the paths asked for. */
function stubFetch(body: unknown): string[] {
	const asked: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		asked.push(String(input));
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
	return asked;
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("api.getResults — one slide", () => {
	test("reads a withheld tally back as null", async () => {
		stubFetch({ type: "multiple-choice", withheld: true });
		expect(await api.getResults("pres-1", "slide-a")).toBe(null);
	});

	test("passes a real tally through untouched", async () => {
		const tally = { type: "multiple-choice", totalVotes: 3, options: [] };
		stubFetch(tally);
		expect(await api.getResults("pres-1", "slide-a")).toEqual(tally);
	});
});

describe("api.getAllResults — the whole deck", () => {
	test("nulls the withheld entries and keeps the published ones", async () => {
		stubFetch([
			{ slideId: "open", question: "Open one", type: "scale", totalVotes: 4 },
			{ slideId: "shut", question: "Shut one", type: "quiz", withheld: true },
		]);

		const rows = await api.getAllResults("pres-1");

		expect(rows).toEqual([
			{
				slideId: "open",
				question: "Open one",
				results: { type: "scale", totalVotes: 4 },
			},
			// Present, named, and carrying no numbers at all — a consumer still
			// walks the whole deck and can tell a withheld slide from one that is
			// not a question.
			{ slideId: "shut", question: "Shut one", results: null },
		]);
	});

	test("an empty deck answers with an empty list", async () => {
		stubFetch([]);
		expect(await api.getAllResults("pres-1")).toEqual([]);
	});
});

// ── The name this browser stated (REQ076) ────────────────────

/** The smallest thing that behaves like `localStorage` for these three reads. */
function installStorageStub(): Map<string, string> {
	const entries = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
		removeItem: (key: string) => {
			entries.delete(key);
		},
		clear: () => entries.clear(),
	};
	return entries;
}

const storage = installStorageStub();

const PARTICIPANT_NAME_KEY = "omul-participant-names";

beforeEach(() => {
	storage.clear();
});

describe("the name this browser stated (REQ076)", () => {
	test("nothing stated reads as nothing", () => {
		expect(getStatedParticipantName("deck-1")).toBe("");
	});

	test("what was remembered comes back, keyed by deck", () => {
		rememberStatedParticipantName("deck-1", "Ada");
		rememberStatedParticipantName("deck-2", "Bob");
		expect(getStatedParticipantName("deck-1")).toBe("Ada");
		expect(getStatedParticipantName("deck-2")).toBe("Bob");
		expect(getStatedParticipantName("deck-3")).toBe("");
	});

	test("remembering again corrects rather than stacks", () => {
		rememberStatedParticipantName("deck-1", "Adda");
		rememberStatedParticipantName("deck-1", "Ada");
		expect(getStatedParticipantName("deck-1")).toBe("Ada");
		expect(
			Object.keys(JSON.parse(storage.get(PARTICIPANT_NAME_KEY) as string)),
		).toEqual(["deck-1"]);
	});

	test("forgetting one deck asks that room again and leaves the others alone", () => {
		// The reset case (REQ101): the server has dropped this deck's roster, so
		// the browser has to stop believing it answered — while a session running
		// in another tab is none of this deck's business.
		rememberStatedParticipantName("deck-1", "Ada");
		rememberStatedParticipantName("deck-2", "Bob");
		forgetStatedParticipantName("deck-1");
		expect(getStatedParticipantName("deck-1")).toBe("");
		expect(getStatedParticipantName("deck-2")).toBe("Bob");
	});

	test("forgetting a deck that remembered nothing is not an error", () => {
		forgetStatedParticipantName("deck-1");
		expect(getStatedParticipantName("deck-1")).toBe("");
	});
});

describe("a stored value this browser did not write (REQ076)", () => {
	test("unparseable storage reads as nothing", () => {
		storage.set(PARTICIPANT_NAME_KEY, "{not json");
		expect(getStatedParticipantName("deck-1")).toBe("");
	});

	test("a stored `null` reads as nothing rather than throwing", () => {
		// `JSON.parse("null")` throws nothing and answers `null`, so the parse
		// guard alone is one step short: the indexing is what would take the
		// participant screen down.
		storage.set(PARTICIPANT_NAME_KEY, "null");
		expect(getStatedParticipantName("deck-1")).toBe("");
	});

	test("a stored array reads as nothing", () => {
		storage.set(PARTICIPANT_NAME_KEY, "[1,2,3]");
		expect(getStatedParticipantName("deck-1")).toBe("");
	});

	test("a stored scalar reads as nothing", () => {
		storage.set(PARTICIPANT_NAME_KEY, "42");
		expect(getStatedParticipantName("deck-1")).toBe("");
	});

	test("a non-string entry is not handed back as a name", () => {
		storage.set(
			PARTICIPANT_NAME_KEY,
			JSON.stringify({ "deck-1": { name: "Ada" } }),
		);
		expect(getStatedParticipantName("deck-1")).toBe("");
	});

	test("a bad map is replaced rather than inherited on the next write", () => {
		storage.set(PARTICIPANT_NAME_KEY, "null");
		rememberStatedParticipantName("deck-1", "Ada");
		expect(getStatedParticipantName("deck-1")).toBe("Ada");
	});

	test("forgetting through a bad map does not throw", () => {
		storage.set(PARTICIPANT_NAME_KEY, "null");
		forgetStatedParticipantName("deck-1");
		expect(getStatedParticipantName("deck-1")).toBe("");
	});
});

// ── The exported deck file (REQ175) ──────────────────────────
//
// The saved deck names the product twice: in the `kind` marker inside the file
// and in the `.omul.json` suffix the download is saved under. The marker is a
// label rather than a format version — it is written and never read, the import
// gate being `title` plus `slides` — and that is worth asserting rather than
// leaving as an inference, since a file the picker accepts may carry any
// marker or none.

describe("the exported deck file (REQ175)", () => {
	const DECK = {
		title: "Q3 Review",
		language: "en",
		mode: "live",
		resultsVisibility: "instant",
		qaEnabled: false,
		qaVisibility: "public",
		reactionsEnabled: true,
		chatEnabled: false,
		slides: [{ id: "s1", type: "text", question: "Hello" }],
	};

	test("a new export is marked with the product's name", () => {
		expect(buildExportPayload(DECK).kind).toBe("omul.presentation");
	});

	test("a file carrying no marker at all imports too", async () => {
		// `kind` is a label, not a format version — the gate is `title` + `slides`.
		const asked = stubFetch({ id: "new-2", title: "Q3 Review", slides: [] });
		const { kind, ...unmarked } = buildExportPayload(DECK);
		expect(kind).toBeDefined();
		await expect(api.importPresentation(unmarked)).resolves.toMatchObject({
			id: "new-2",
		});
		expect(asked).toHaveLength(1);
	});
});
