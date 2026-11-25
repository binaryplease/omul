/**
 * The live socket at `/ws` (REQ209), and what it reads off the upgrade request
 * for a deck that requires participants to sign in (REQ134).
 *
 * A socket joins one deck's room and is sent that room's broadcasts
 * (`server/ws.ts`). On a deck with `requireParticipantSignIn`, `joinLiveRoom`
 * seats a socket only when it passed the sign-in the HTTP join route asks for:
 * the upgrade request's session cookie or API key resolves an account, or the
 * `join` message carries the deck's edit token. The account lookup starts when
 * the socket opens, so a join usually finds it already answered.
 *
 * One module for the route, so the server and the integration tests that need
 * the gate mount the same handler rather than restating it.
 */

import { Elysia } from "elysia";
import { resolveUserId } from "../accounts";
import { LiveSocketMessageSchema } from "../schemas";
import { editTokenFromHeaders, joinLiveRoom } from "../services/presentations";
import { markSignedIn, registerClient, removeClient, sendToClient } from "../ws";

/**
 * What a socket keeps on Bun's own data slot for its whole connection.
 *
 * It is written to `ws.raw.data`, not `ws.data`: the Elysia wrapper is rebuilt
 * for each handler call (open/message/close) and its `.data` is re-derived from
 * the per-call context, so an assignment to it does not persist. `ws.raw.data`
 * belongs to Bun and survives for the lifetime of the connection. Elysia puts
 * the upgrade's context there first, which is where `request` comes from.
 */
type LiveSocketData = {
	request?: Request;
	clientId?: string;
	upgradeHeaders?: Headers;
	signedIn?: Promise<boolean>;
};

/** The request headers that can carry a credential `resolveUserId` reads. */
const CREDENTIAL_HEADERS = ["cookie", "x-api-key", "authorization"];

/**
 * Whether an upgrade request resolves an account. A request carrying none of
 * the credential headers answers `false` without a lookup, which is every
 * anonymous phone in a room. A lookup that fails answers `false`, the answer
 * that keeps a socket out of a deck that requires signing in.
 */
function resolveSignedIn(headers: Headers): Promise<boolean> {
	const carriesCredential = CREDENTIAL_HEADERS.some((name) => headers.has(name));
	if (!carriesCredential) return Promise.resolve(false);
	return resolveUserId(headers)
		.then((userId) => userId !== null)
		.catch(() => false);
}

/** The connection's data slot; see {@link LiveSocketData}. */
function socketData(raw: unknown): LiveSocketData {
	return ((raw as { data?: LiveSocketData }).data ?? {}) as LiveSocketData;
}

/** A message as text or as the object Elysia already parsed, or `null`. */
function parseMessage(message: unknown) {
	try {
		const value = typeof message === "string" ? JSON.parse(message) : message;
		const parsed = LiveSocketMessageSchema.safeParse(value);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export const liveSocketRoutes = new Elysia({ name: "live-socket" }).ws("/ws", {
	open(ws) {
		const clientId = registerClient(ws);
		const data = socketData(ws.raw);
		const upgradeHeaders = new Headers(data.request?.headers);
		const signedIn = resolveSignedIn(upgradeHeaders).then((resolved) => {
			markSignedIn(clientId, resolved);
			return resolved;
		});
		(ws.raw as { data: LiveSocketData }).data = {
			...data,
			clientId,
			upgradeHeaders,
			signedIn,
		};
	},
	message(ws, message) {
		const data = socketData(ws.raw);
		const clientId = data.clientId;
		if (!clientId) return;
		// Malformed and unknown messages are ignored without closing the socket.
		const parsed = parseMessage(message);
		if (!parsed) return;
		if (parsed.type === "join") {
			// Answered with the deck's live state (REQ209), or refused on a deck
			// whose participant sign-in the socket has not passed (REQ134).
			const upgradeHeaders = data.upgradeHeaders ?? new Headers();
			// Caught here: an unhandled rejection ends the Bun process, so a join that
			// throws would take every room down with it rather than fail alone.
			joinLiveRoom(clientId, parsed.presentationId, parsed.role, {
				signedIn: data.signedIn ?? Promise.resolve(false),
				editToken: parsed.editToken ?? editTokenFromHeaders(upgradeHeaders),
			}).catch((error) => {
				console.error("[ws] join failed:", error);
			});
		} else if (parsed.type === "ping") {
			// The client's heartbeat (REQ209): a socket that stops answering is one
			// the client replaces.
			sendToClient(clientId, "pong", {});
		}
	},
	close(ws) {
		const clientId = socketData(ws.raw).clientId;
		if (clientId) removeClient(clientId);
	},
});
