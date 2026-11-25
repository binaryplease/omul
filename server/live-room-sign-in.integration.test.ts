/**
 * Integration tests for the live socket on a deck that requires a signed-in
 * participant (REQ134).
 *
 * The join route refuses an anonymous caller on such a deck `401` and sends
 * nothing of it; these tests hold the socket to the same door. A socket that
 * has not passed the sign-in is refused the room with `room.refused`, so no
 * `presentation.slides`, no `slide.changed` and no `room.joined` reaches it. A
 * socket whose upgrade carries a session cookie or an API key, and a presenter
 * screen whose join carries the deck's edit token, are seated and keep every
 * frame. A deck without the switch seats an anonymous socket as before.
 *
 * Stands up the real Elysia app — auth handler, presentation routes and the
 * `/ws` route the server mounts (`server/routes/live-socket.ts`) — against a
 * throw-away in-memory docstore and a temp auth DB, as
 * `participant-sign-in.integration.test.ts` does.
 */

// Env must be set before importing ./db and ./accounts (both read it at module
// load).
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OMUL_AUTH_DB = join(
	mkdtempSync(join(tmpdir(), "omul-live-room-sign-in-")),
	"auth.sqlite",
);

// loose test types
type Any = any;

interface Envelope {
	event: string;
	data: Any;
}

let baseUrl = "";
let wsUrl = "";
let server: { stop: () => Promise<void> } | null = null;

let ownerKey = "";
/** A Better Auth session cookie for a participant's account. */
let participantCookie = "";

const PASSWORD = "correct-horse-battery";

const SLIDES = [
	{
		id: "s1",
		type: "multiple-choice",
		question: "Pick one",
		options: [
			{ id: "a", text: "A" },
			{ id: "b", text: "B" },
		],
	},
	{ id: "s2", type: "open-text", question: "Anything else?" },
];

/** The deck's slides with the second question reworded, for a slide save. */
const EDITED_SLIDES = [
	SLIDES[0],
	{ id: "s2", type: "open-text", question: "What should we fix first?" },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Open a socket, with `headers` on its upgrade request, and record every frame
 * it is sent.
 */
async function openSocket(headers: Record<string, string> = {}) {
	const socket = new WebSocket(wsUrl, { headers } as Any);
	const received: Envelope[] = [];
	socket.addEventListener("message", (event) => {
		const raw = (event as MessageEvent).data;
		received.push(
			JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)),
		);
	});
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("ws error")), {
			once: true,
		});
	});

	async function waitFor(eventName: string, timeoutMs = 3000): Promise<Envelope> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const found = received.find((envelope) => envelope.event === eventName);
			if (found) return found;
			await wait(10);
		}
		throw new Error(
			`Timed out waiting for "${eventName}". Received: ${
				received.map((envelope) => envelope.event).join(", ") || "(none)"
			}`,
		);
	}

	return {
		received,
		waitFor,
		events: () => received.map((envelope) => envelope.event),
		join(
			presentationId: string,
			role: "presenter" | "participant" = "participant",
			extra: Record<string, unknown> = {},
		) {
			socket.send(JSON.stringify({ type: "join", presentationId, role, ...extra }));
		},
		async close() {
			socket.close();
			await wait(50);
		},
	};
}

type Socket = Awaited<ReturnType<typeof openSocket>>;

/** A deck created and started by the owner's account. */
async function createOwnedDeck(requireParticipantSignIn: boolean): Promise<Any> {
	const res = await fetch(`${baseUrl}/api/presentations`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
		body: JSON.stringify({
			title: "Signed-in room",
			slides: SLIDES,
			requireParticipantSignIn,
		}),
	});
	expect(res.status).toBe(201);
	const pres = await res.json();
	const started = await fetch(`${baseUrl}/api/presentations/${pres.id}/start`, {
		method: "POST",
		headers: { "x-api-key": ownerKey },
	});
	expect(started.status).toBe(200);
	return pres;
}

/** Save the deck's slides as the owner, which broadcasts `presentation.slides`. */
async function saveSlides(
	presentationId: string,
	headers: Record<string, string>,
	extra: Record<string, unknown> = {},
) {
	const res = await fetch(`${baseUrl}/api/presentations/${presentationId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ slides: EDITED_SLIDES, ...extra }),
	});
	expect(res.status).toBe(200);
}

/** Move the deck to its second slide, which broadcasts `slide.changed`. */
async function navigate(presentationId: string, headers: Record<string, string>) {
	const res = await fetch(`${baseUrl}/api/presentations/${presentationId}/slide`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ index: 1 }),
	});
	expect(res.status).toBe(200);
}

/** A socket that holds the slide content both broadcasts carry. */
async function expectSlideContent(socket: Socket) {
	const slides = await socket.waitFor("presentation.slides");
	expect(slides.data.slides.map((slide: Any) => slide.question)).toEqual([
		"Pick one",
		"What should we fix first?",
	]);
	const changed = await socket.waitFor("slide.changed");
	expect(changed.data.slideIndex).toBe(1);
	expect(changed.data.slide.question).toBe("What should we fix first?");
}

/** A socket that holds none of the deck's slide content, and no seat. */
function expectNoSlideContent(socket: Socket) {
	const events = socket.events();
	expect(events).not.toContain("room.joined");
	expect(events).not.toContain("presentation.slides");
	expect(events).not.toContain("slide.changed");
	// Nothing it was sent names a slide's text.
	expect(JSON.stringify(socket.received)).not.toContain("What should we fix first?");
	expect(JSON.stringify(socket.received)).not.toContain("Pick one");
}

describe("the live socket on a deck that requires a signed-in participant (REQ134)", () => {
	beforeAll(async () => {
		const db = await import("./db");
		const { auth, ensureAuthSchema } = await import("./accounts");
		const { presentationRoutes } = await import("./routes/presentations");
		const { liveSocketRoutes } = await import("./routes/live-socket");
		const { Elysia } = await import("elysia");

		await db.connectDb();
		await ensureAuthSchema();

		const app = new Elysia()
			.get("/api/auth/*", ({ request }) => auth.handler(request))
			.post("/api/auth/*", ({ request }) => auth.handler(request))
			.use(presentationRoutes)
			.use(liveSocketRoutes)
			.listen({ port: 0, hostname: "127.0.0.1" });
		baseUrl = `http://127.0.0.1:${app.server?.port}`;
		wsUrl = `ws://127.0.0.1:${app.server?.port}/ws`;
		server = { stop: async () => void app.stop(true) };

		const owner = await auth.api.signUpEmail({
			body: { email: "live-owner@example.com", password: PASSWORD, name: "Owner" },
		});
		ownerKey = (
			await auth.api.createApiKey({
				body: { userId: owner.user.id, name: "k" },
			})
		).key;
		await auth.api.signUpEmail({
			body: {
				email: "live-participant@example.com",
				password: PASSWORD,
				name: "Participant",
			},
		});
		const signedIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: baseUrl },
			body: JSON.stringify({
				email: "live-participant@example.com",
				password: PASSWORD,
			}),
		});
		expect(signedIn.status).toBe(200);
		participantCookie = (signedIn.headers.getSetCookie?.() ?? [])
			.map((cookie) => cookie.split(";")[0])
			.join("; ");
		expect(participantCookie).toContain("session_token");
	});

	afterAll(async () => {
		await server?.stop();
		if (process.env.OMUL_AUTH_DB) {
			rmSync(join(process.env.OMUL_AUTH_DB, ".."), {
				recursive: true,
				force: true,
			});
		}
	});

	test("an anonymous socket is refused the room and sent no slide; signed-in sockets keep every frame", async () => {
		const pres = await createOwnedDeck(true);
		const anonymous = await openSocket();
		const participant = await openSocket({ cookie: participantCookie });
		const presenter = await openSocket({ "x-api-key": ownerKey });

		anonymous.join(pres.id);
		const refused = await anonymous.waitFor("room.refused");
		expect(refused.data).toEqual({
			presentationId: pres.id,
			refused: "sign-in-required",
		});

		participant.join(pres.id);
		presenter.join(pres.id, "presenter");
		const joined = await participant.waitFor("room.joined");
		expect(joined.data.presentationId).toBe(pres.id);
		await presenter.waitFor("room.joined");
		// The refused socket is not counted in the room.
		const counts = participant.received.filter(
			(envelope) => envelope.event === "participants.count",
		);
		expect(counts.at(-1)?.data.count).toBe(1);

		await saveSlides(pres.id, { "x-api-key": ownerKey });
		await navigate(pres.id, { "x-api-key": ownerKey });
		await expectSlideContent(participant);
		await expectSlideContent(presenter);

		// Long enough for any frame of the two writes to have landed.
		await wait(150);
		expectNoSlideContent(anonymous);
		expect(anonymous.events()).toEqual(["room.refused"]);

		await Promise.all([anonymous.close(), participant.close(), presenter.close()]);
	});

	test("a presenter screen with no account is seated on the deck's edit token, and only on it", async () => {
		const created = await fetch(`${baseUrl}/api/presentations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Guest deck",
				slides: SLIDES,
				requireParticipantSignIn: true,
			}),
		});
		expect(created.status).toBe(201);
		const pres = await created.json();
		expect(pres.creatorToken).toBeTruthy();
		expect(pres).not.toHaveProperty("creatorTokenHash");
		const bearer = { Authorization: `Bearer ${pres.creatorToken}` };
		const started = await fetch(`${baseUrl}/api/presentations/${pres.id}/start`, {
			method: "POST",
			headers: bearer,
		});
		expect(started.status).toBe(200);

		const presenter = await openSocket();
		const impostor = await openSocket();
		presenter.join(pres.id, "presenter", { editToken: pres.creatorToken });
		impostor.join(pres.id, "presenter", { editToken: "not-the-token" });
		await presenter.waitFor("room.joined");
		await impostor.waitFor("room.refused");

		await saveSlides(pres.id, bearer);
		await navigate(pres.id, bearer);
		await expectSlideContent(presenter);
		await wait(150);
		expectNoSlideContent(impostor);
		// Neither frame the presenter was sent carries the deck's credentials.
		const sent = JSON.stringify(presenter.received);
		expect(sent).not.toContain("creatorTokenHash");
		expect(sent).not.toContain("creatorId");

		await Promise.all([presenter.close(), impostor.close()]);
	});

	test("a deck that starts requiring sign-in unseats the sockets that have not passed it", async () => {
		const pres = await createOwnedDeck(false);
		const anonymous = await openSocket();
		const participant = await openSocket({ cookie: participantCookie });
		anonymous.join(pres.id);
		participant.join(pres.id);
		await anonymous.waitFor("room.joined");
		await participant.waitFor("room.joined");
		anonymous.received.length = 0;

		// One save turns the switch on and rewrites the slides, as the editor's
		// Save sends every setting at once.
		await saveSlides(
			pres.id,
			{ "x-api-key": ownerKey },
			{ requireParticipantSignIn: true },
		);
		await navigate(pres.id, { "x-api-key": ownerKey });
		await expectSlideContent(participant);

		await wait(150);
		const refused = await anonymous.waitFor("room.refused");
		expect(refused.data.refused).toBe("sign-in-required");
		expectNoSlideContent(anonymous);

		// A join it sends again is refused again.
		anonymous.received.length = 0;
		anonymous.join(pres.id);
		await anonymous.waitFor("room.refused");
		expect(anonymous.events()).toEqual(["room.refused"]);

		await Promise.all([anonymous.close(), participant.close()]);
	});

	// Review NST18529, finding 1: switch-on, then the participant signs in. The
	// browser client replaces its socket on the account change (`noteWsAccount`
	// in src/api.ts); the new socket carries the session and is seated.
	test("after switch-on and a sign-in, the participant's new socket is seated and frames resume", async () => {
		const pres = await createOwnedDeck(false);
		const phone = await openSocket();
		phone.join(pres.id);
		await phone.waitFor("room.joined");

		const switchedOn = await fetch(`${baseUrl}/api/presentations/${pres.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", "x-api-key": ownerKey },
			body: JSON.stringify({ requireParticipantSignIn: true }),
		});
		expect(switchedOn.status).toBe(200);
		await phone.waitFor("room.refused");

		// Signed in: the page replaces the socket, whose upgrade now carries the
		// session cookie, and joins again.
		await phone.close();
		const signedInPhone = await openSocket({ cookie: participantCookie });
		signedInPhone.join(pres.id);
		await signedInPhone.waitFor("room.joined");

		await saveSlides(pres.id, { "x-api-key": ownerKey });
		await navigate(pres.id, { "x-api-key": ownerKey });
		await expectSlideContent(signedInPhone);

		await signedInPhone.close();
	});

	test("on a deck without the switch, an anonymous socket is seated and keeps every frame", async () => {
		const pres = await createOwnedDeck(false);
		const anonymous = await openSocket();
		anonymous.join(pres.id);
		await anonymous.waitFor("room.joined");

		await saveSlides(pres.id, { "x-api-key": ownerKey });
		await navigate(pres.id, { "x-api-key": ownerKey });
		await expectSlideContent(anonymous);
		expect(anonymous.events()).not.toContain("room.refused");

		await anonymous.close();
	});
});
