/**
 * Unit tests for the pieces of `src/api.ts` that are more than a `fetch`: the
 * one translation of the withheld-tally marker (REQ016/REQ017), the name this
 * browser remembers having stated on a deck (REQ076), the pass through a deck it
 * is answering in (REQ083), and which edit tokens this browser forgets once the
 * signed-in account adopts their decks (REQ194, at the end of the file).
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

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	jest,
	setSystemTime,
	test,
} from "bun:test";
import {
	api,
	buildExportPayload,
	claimLocalPresentations,
	connectWs,
	disconnectWs,
	forgetParticipantPass,
	forgetStatedParticipantName,
	getParticipantPass,
	getStatedParticipantName,
	rememberParticipantPass,
	onWsEvent,
	pulseWs,
	rememberStatedParticipantName,
	SOCKET_PULSE_MS,
} from "./api";
import { RESULTS_TOKEN_KEY, TOKEN_KEY } from "./storage";

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

// ── The pass this browser is on (REQ083) ─────────────────────
//
// Local state like the name above, and for a sharper reason: a browser that
// forgot which pass it is on would answer on into its first one and replace
// what it said the first time through — on a shared kiosk, what somebody else
// said. And the one property of the request bodies below that the server cannot
// correct is that the pass rides them at all: an answer that left it off would
// land in the first pass for exactly that reason.

const PARTICIPANT_PASS_KEY = "omul-participant-passes";

/** Answer every request with `body`, and record each one's URL and init. */
function captureFetch(
	body: unknown,
): { url: string; init: RequestInit | undefined }[] {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
	return calls;
}

function bodyOf(call: { init: RequestInit | undefined }): Record<string, unknown> {
	return JSON.parse(String(call.init?.body ?? "{}"));
}

describe("the pass this browser is on (REQ083)", () => {
	test("a deck this browser never went through again is on its first pass", () => {
		expect(getParticipantPass("deck-1")).toBe(1);
	});

	test("the pass the server handed out comes back, keyed by deck", () => {
		rememberParticipantPass("deck-1", 3);
		rememberParticipantPass("deck-2", 2);
		expect(getParticipantPass("deck-1")).toBe(3);
		expect(getParticipantPass("deck-2")).toBe(2);
		expect(getParticipantPass("deck-3")).toBe(1);
	});

	test("forgetting one deck puts it back on the first pass and leaves the others", () => {
		// The reset case (REQ101): the server has dropped every pass this device
		// made, so the re-run's first answer is a first pass again.
		rememberParticipantPass("deck-1", 3);
		rememberParticipantPass("deck-2", 2);
		forgetParticipantPass("deck-1");
		expect(getParticipantPass("deck-1")).toBe(1);
		expect(getParticipantPass("deck-2")).toBe(2);
	});

	test("anything stored that is not a pass reads as the first", () => {
		for (const stored of [
			"{not json",
			"null",
			"[2]",
			JSON.stringify({ "deck-1": "2" }),
			JSON.stringify({ "deck-1": 0 }),
			JSON.stringify({ "deck-1": 2.5 }),
			JSON.stringify({ "deck-1": -4 }),
		]) {
			storage.set(PARTICIPANT_PASS_KEY, stored);
			expect(getParticipantPass("deck-1")).toBe(1);
		}
	});

	test("a bad map is replaced rather than inherited on the next write", () => {
		storage.set(PARTICIPANT_PASS_KEY, "null");
		rememberParticipantPass("deck-1", 2);
		expect(getParticipantPass("deck-1")).toBe(2);
		forgetParticipantPass("deck-1");
		expect(getParticipantPass("deck-1")).toBe(1);
	});

	test("an answer names its pass past the first, and only past it", async () => {
		const calls = captureFetch({});
		await api.vote("deck-1", "s1", "a", "p1", { pass: 2 });
		await api.vote("deck-1", "s1", "a", "p1", { pass: 1 });
		await api.vote("deck-1", "s1", "a", "p1");
		expect(bodyOf(calls[0]).pass).toBe(2);
		// The first pass is what an answer naming none already is, so the request
		// a deck without repeat passes sends is the one it always sent.
		expect("pass" in bodyOf(calls[1])).toBe(false);
		expect("pass" in bodyOf(calls[2])).toBe(false);
	});

	test("an upvote and the scorecard name the pass the same way", async () => {
		const calls = captureFetch({});
		await api.voteOnResponse("deck-1", "s1", "r1", "p1", 3);
		await api.voteOnResponse("deck-1", "s1", "r1", "p1");
		await api.getScorecard("deck-1", "p1", 2);
		await api.getScorecard("deck-1", "p1");
		expect(bodyOf(calls[0]).pass).toBe(3);
		expect("pass" in bodyOf(calls[1])).toBe(false);
		expect(new URL(calls[2].url, "http://omul.test").searchParams.get("pass")).toBe(
			"2",
		);
		expect(new URL(calls[3].url, "http://omul.test").searchParams.has("pass")).toBe(
			false,
		);
	});

	test("starting a pass asks the server, and reads the pass it opened", async () => {
		const calls = captureFetch({ pass: 4 });
		const started = await api.startPass("deck-1", "p1");
		expect(started.pass).toBe(4);
		expect(calls[0].url).toBe("/api/presentations/deck-1/passes");
		expect(calls[0].init?.method).toBe("POST");
		// Which pass comes next is the server's to say: this browser states who
		// it is and nothing else.
		expect(bodyOf(calls[0])).toEqual({ participantId: "p1" });
	});

	test("the switch travels with an exported deck, and imports only when it says true", async () => {
		const exported = buildExportPayload({
			title: "Kiosk",
			mode: "survey",
			allowRepeatPasses: true,
			slides: [],
		});
		expect(exported.allowRepeatPasses).toBe(true);

		const calls = captureFetch({ id: "new-1", title: "Kiosk", slides: [] });
		await api.importPresentation(exported);
		await api.importPresentation({ ...exported, allowRepeatPasses: "yes" });
		await api.importPresentation({ title: "Old file", slides: [] });
		expect(bodyOf(calls[0]).allowRepeatPasses).toBe(true);
		expect(bodyOf(calls[1]).allowRepeatPasses).toBe(false);
		expect(bodyOf(calls[2]).allowRepeatPasses).toBe(false);
	});

	test("a duplicate keeps the switch its source had", async () => {
		const calls = captureFetch({
			id: "source",
			title: "Kiosk",
			mode: "survey",
			allowRepeatPasses: true,
			slides: [],
		});
		await api.duplicatePresentation("source");
		const created = calls.find((call) => call.init?.method === "POST");
		expect(created && bodyOf(created).allowRepeatPasses).toBe(true);
	});
});

// ── The profanity filter (REQ085) ────────────────────────────
//
// Two promises the client keeps. The setting travels with the deck wherever a
// copy is made of it, and an imported file can only ever name a list the
// server has words for. And of every results read the browser makes, exactly
// one asks for what the filter withheld — the results surface's — while the
// presenter's poll, which feeds the projector, never does.

describe("the profanity filter (REQ085)", () => {
	test("travels with an exported deck, and imports only what the server accepts", async () => {
		const exported = buildExportPayload({
			title: "Town hall",
			profanityFilterEnabled: true,
			profanityFilterLanguage: "de",
			slides: [],
		});
		expect(exported.profanityFilterEnabled).toBe(true);
		expect(exported.profanityFilterLanguage).toBe("de");

		const calls = captureFetch({ id: "new-1", title: "Town hall", slides: [] });
		await api.importPresentation(exported);
		await api.importPresentation({
			...exported,
			profanityFilterEnabled: "yes",
			profanityFilterLanguage: "de-AT",
		});
		await api.importPresentation({ ...exported, profanityFilterLanguage: "xx" });
		await api.importPresentation({ ...exported, profanityFilterLanguage: 42 });
		await api.importPresentation({ title: "Old file", slides: [] });
		expect(bodyOf(calls[0]).profanityFilterEnabled).toBe(true);
		expect(bodyOf(calls[0]).profanityFilterLanguage).toBe("de");
		// Only an explicit `true` switches it on, and a list must be one of the
		// seven by name — anything else follows the deck's language.
		expect(bodyOf(calls[1]).profanityFilterEnabled).toBe(false);
		expect(bodyOf(calls[1]).profanityFilterLanguage).toBeNull();
		expect(bodyOf(calls[2]).profanityFilterLanguage).toBeNull();
		expect(bodyOf(calls[3]).profanityFilterLanguage).toBeNull();
		expect(bodyOf(calls[4]).profanityFilterEnabled).toBe(false);
		expect(bodyOf(calls[4]).profanityFilterLanguage).toBeNull();
	});

	test("a duplicate keeps the filter its source had", async () => {
		const calls = captureFetch({
			id: "source",
			title: "Town hall",
			profanityFilterEnabled: true,
			profanityFilterLanguage: "nl",
			slides: [],
		});
		await api.duplicatePresentation("source");
		const created = calls.find((call) => call.init?.method === "POST");
		expect(created && bodyOf(created).profanityFilterEnabled).toBe(true);
		expect(created && bodyOf(created).profanityFilterLanguage).toBe("nl");
	});

	test("only the results surface asks for the withheld answers", async () => {
		const calls = captureFetch([]);
		await api.getSharedResults("deck-1");
		await api.getAllResults("deck-1");
		await api.getResults("deck-1", "wc");
		const filteredOf = (call: { url: string }) =>
			new URL(call.url, "http://omul.test").searchParams.get("filtered");
		expect(filteredOf(calls[0])).toBe("include");
		// The presenter's poll is the projector: it never asks.
		expect(filteredOf(calls[1])).toBeNull();
		expect(filteredOf(calls[2])).toBeNull();
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

// ── Adopting this browser's decks into the account (REQ194) ──

describe("claiming this browser's decks after sign-in (REQ194)", () => {
	const TOKEN_KEY = "omul-tokens";

	/** Answer each deck's claim with the status `statusFor` names, or throw. */
	function stubClaims(statusFor: Record<string, number | "network-error">) {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const id = String(input).split("/presentations/")[1]?.split("/")[0];
			const status = statusFor[id ?? ""];
			if (status === undefined || status === "network-error") {
				throw new TypeError("Failed to fetch");
			}
			return new Response("{}", {
				status,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;
	}

	function heldTokens(): Record<string, string> {
		return JSON.parse(storage.get(TOKEN_KEY) ?? "{}");
	}

	beforeEach(() => {
		storage.set(
			TOKEN_KEY,
			JSON.stringify({
				adopted: "token-adopted",
				"someone-elses": "token-someone-elses",
				refused: "token-refused",
				unreachable: "token-unreachable",
			}),
		);
	});

	test("a deck the account now owns leaves this browser's token map", async () => {
		stubClaims({
			adopted: 200,
			"someone-elses": 409,
			refused: 403,
			unreachable: "network-error",
		});
		expect(await claimLocalPresentations()).toBe(1);
		expect(heldTokens()).not.toHaveProperty("adopted");
	});

	test("a deck another account or a workspace owns keeps its token", async () => {
		stubClaims({
			adopted: 200,
			"someone-elses": 409,
			refused: 403,
			unreachable: "network-error",
		});
		await claimLocalPresentations();
		expect(heldTokens()["someone-elses"]).toBe("token-someone-elses");
	});

	test("a refused or failed claim keeps its token", async () => {
		stubClaims({
			adopted: 200,
			"someone-elses": 409,
			refused: 403,
			unreachable: "network-error",
		});
		await claimLocalPresentations();
		expect(heldTokens()).toEqual({
			"someone-elses": "token-someone-elses",
			refused: "token-refused",
			unreachable: "token-unreachable",
		});
	});

	test("a signed-out claim (401) keeps every token", async () => {
		stubClaims({
			adopted: 401,
			"someone-elses": 401,
			refused: 401,
			unreachable: 401,
		});
		expect(await claimLocalPresentations()).toBe(0);
		expect(Object.keys(heldTokens())).toHaveLength(4);
	});
});

// ── A deck created under a session is the account's (REQ194) ─

describe("keeping the edit token a create returns (REQ194)", () => {
	const TOKEN_KEY = "omul-tokens";

	/**
	 * Answer the create (or the generation) with a fresh deck and its token, and
	 * the claim that follows with `claimStatus` — 200 when a session owns the
	 * deck, 401 for an anonymous create — or a network error.
	 */
	function stubCreate(claimStatus: number | "network-error"): string[] {
		const asked: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			asked.push(url);
			if (url.endsWith("/claim")) {
				if (claimStatus === "network-error") {
					throw new TypeError("Failed to fetch");
				}
				return new Response("{}", { status: claimStatus });
			}
			return new Response(
				JSON.stringify({ id: "fresh", creatorToken: "token-fresh" }),
				{ status: 201, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;
		return asked;
	}

	function heldTokens(): Record<string, string> {
		return JSON.parse(storage.get(TOKEN_KEY) ?? "{}");
	}

	test("a signed-in create keeps no token in this browser", async () => {
		const asked = stubCreate(200);
		await api.createPresentation({ title: "Mine", slides: [] });
		const claimed = asked.some((url) =>
			url.endsWith("/presentations/fresh/claim"),
		);
		expect(claimed).toBe(true);
		expect(heldTokens()).toEqual({});
	});

	test("a signed-in generation keeps no token either", async () => {
		stubCreate(200);
		await api.generatePresentation({ prompt: "A retro for the team" });
		expect(heldTokens()).toEqual({});
	});

	test("an anonymous create keeps its token, its only credential", async () => {
		stubCreate(401);
		await api.createPresentation({ title: "Only here", slides: [] });
		expect(heldTokens()).toEqual({ fresh: "token-fresh" });
	});

	test("an anonymous generation keeps its token", async () => {
		stubCreate(401);
		await api.generatePresentation({ prompt: "A retro for the team" });
		expect(heldTokens()).toEqual({ fresh: "token-fresh" });
	});

	test("a claim that cannot be asked keeps the token", async () => {
		stubCreate("network-error");
		await api.createPresentation({ title: "Offline", slides: [] });
		expect(heldTokens()).toEqual({ fresh: "token-fresh" });
	});

	test("a create that mints no token stores nothing", async () => {
		// An API-key create and a workspace create both answer creatorToken null.
		const asked: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			asked.push(String(input));
			return new Response(
				JSON.stringify({ id: "team", creatorToken: null }),
				{ status: 201, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;
		await api.createPresentation({
			title: "Team",
			slides: [],
			workspaceId: "w",
		});
		expect(asked.some((url) => url.endsWith("/claim"))).toBe(false);
		expect(heldTokens()).toEqual({});
	});
});

// ── The live socket (REQ209) ──────────────────────────────────

/** A WebSocket stand-in that records what is sent and opens on demand. */
class FakeSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	static created: FakeSocket[] = [];
	readyState = FakeSocket.CONNECTING;
	sent: Record<string, unknown>[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((message: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	constructor(readonly url: string) {
		FakeSocket.created.push(this);
	}
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	/** A socket that died without telling anyone closes without an event. */
	close() {
		this.readyState = FakeSocket.CLOSED;
	}
	open() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}
	hear(event: string, data: unknown) {
		this.onmessage?.({ data: JSON.stringify({ event, data }) });
	}
}

describe("the live socket (REQ209)", () => {
	const realWebSocket = globalThis.WebSocket;
	const visibilityHandlers: (() => void)[] = [];
	const fakeDocument = {
		visibilityState: "visible",
		addEventListener: (_event: string, handler: () => void) =>
			visibilityHandlers.push(handler),
		removeEventListener: (_event: string, handler: () => void) =>
			visibilityHandlers.splice(visibilityHandlers.indexOf(handler), 1),
	};

	beforeEach(() => {
		FakeSocket.created = [];
		globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
		Object.assign(globalThis, {
			location: { protocol: "http:", host: "localhost:5173" },
			document: fakeDocument,
		});
		jest.useFakeTimers();
	});

	afterEach(() => {
		disconnectWs();
		jest.useRealTimers();
		setSystemTime();
		globalThis.WebSocket = realWebSocket;
		Reflect.deleteProperty(globalThis, "location");
		Reflect.deleteProperty(globalThis, "document");
	});

	const JOIN = { type: "join", presentationId: "deck-1", role: "participant" };

	test("a socket that stops answering is replaced, and the new one joins again", () => {
		// A phone that moved from Wi-Fi to cellular: the browser still calls the
		// socket open, nothing reaches it, and no close event ever fires.
		connectWs("deck-1", "participant");
		const first = FakeSocket.created[0];
		first.open();
		expect(first.sent).toEqual([JOIN]);

		jest.advanceTimersByTime(SOCKET_PULSE_MS);
		expect(first.sent).toEqual([JOIN, { type: "ping" }]);
		jest.advanceTimersByTime(SOCKET_PULSE_MS);

		expect(FakeSocket.created).toHaveLength(2);
		const second = FakeSocket.created[1];
		second.open();
		expect(second.sent).toEqual([JOIN]);
	});

	test("a socket that answers its ping is kept", () => {
		connectWs("deck-1", "participant");
		const socket = FakeSocket.created[0];
		socket.open();
		for (let beat = 0; beat < 3; beat++) {
			jest.advanceTimersByTime(SOCKET_PULSE_MS);
			socket.hear("pong", {});
		}
		expect(FakeSocket.created).toHaveLength(1);
		expect(socket.sent.filter((frame) => frame.type === "ping")).toHaveLength(3);
	});

	test("a page back from sleep opens a fresh socket at once", () => {
		const asleepAt = new Date("2026-10-23T12:00:00.000Z");
		setSystemTime(asleepAt);
		connectWs("deck-1", "participant");
		FakeSocket.created[0].open();

		setSystemTime(new Date(asleepAt.getTime() + 5 * 60_000));
		for (const handler of visibilityHandlers) handler();

		expect(FakeSocket.created).toHaveLength(2);
	});

	test("a socket replaced by a fresh one reconnects nothing when it closes", () => {
		connectWs("deck-1", "participant");
		const first = FakeSocket.created[0];
		first.open();
		pulseWs();
		pulseWs();
		expect(FakeSocket.created).toHaveLength(2);

		first.onclose?.();
		jest.advanceTimersByTime(1000);
		expect(FakeSocket.created).toHaveLength(2);
	});

	test("frames from a replaced socket are not delivered", () => {
		const heard: unknown[] = [];
		connectWs("deck-1", "participant");
		onWsEvent("presentation.reset", (data) => heard.push(data));
		const first = FakeSocket.created[0];
		first.open();
		pulseWs();
		pulseWs();

		first.hear("presentation.reset", { presentationId: "deck-1" });
		expect(heard).toEqual([]);
		FakeSocket.created[1].hear("presentation.reset", { presentationId: "deck-1" });
		expect(heard).toEqual([{ presentationId: "deck-1" }]);
	});
});
