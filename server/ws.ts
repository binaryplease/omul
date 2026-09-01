/**
 * WebSocket broadcaster for real-time presentation updates.
 *
 * Clients are organized into rooms (by presentationId).
 * Events:
 *   slide.changed     – presenter moved to a new slide
 *   vote.received     – a participant submitted a vote
 *   results.updated   – aggregated results changed
 *   participants.count – participant count changed
 *   slide.revealed    – results for one slide were revealed/hidden (REQ102)
 *   slide.started     – a slide's question was opened (REQ057)
 *   slide.participation
 *                     – one slide was opened or closed to submissions (REQ111)
 *   presentation.blanked
 *                     – the shared screen was blanked, or brought back (REQ109)
 *   presentation.results-visibility
 *                     – the deck's reveal mode was set for every question slide
 *                       in it, in one operation (REQ018)
 *   qa.settings       – the Q&A layer was switched on/off, or its visibility
 *                       changed (REQ036/REQ037)
 *   qa.updated        – the Q&A question list moved: asked, upvoted or marked
 *                       answered (REQ036/REQ060)
 *   channels.settings – the participant channels were opened or closed:
 *                       reactions (REQ077) and the live chat (REQ078)
 *   reaction.sent     – somebody reacted to what is on screen (REQ077)
 *   chat.updated      – the live chat has a new message (REQ078)
 *
 * Every frame here is read by **every** client in the room: a room is broadcast
 * to by presentation, and the `role` below is whatever the connecting client
 * said it was. So a broadcast carries only what the audience may see — the
 * `slide.changed` slide is projected through `withAudienceSlides` before it is
 * sent (REQ056 answer keys, REQ090 presenter notes), the `results.updated`
 * tally through the deck's reveal mode (`tallyVisibleToAudience`, REQ015–REQ017)
 * so a slide collecting silently broadcasts a `withheld` marker and not its
 * numbers, and the Q&A frames below carry no question text at all.
 *
 * `qa.updated` carries the presentation id and **nothing else** — no text, no
 * counts. A room is broadcast to by presentation, and the `role` below is
 * whatever the connecting client said it was, so it proves nothing: a broadcast
 * carrying question text would hand a deck's moderated Q&A (REQ037) to anybody
 * holding a socket. Surfaces re-fetch `GET /api/presentations/:id/qa`, which is
 * where the edit token is proven and who-sees-what is decided. `chat.updated`
 * (REQ078) is payload-free for the neighbouring reason: the feed has one
 * projection, and keeping it in one place is what keeps each reader's `own`
 * marks and the transcript's order honest.
 *
 * `slide.participation` and `presentation.blanked` (REQ111/REQ109) carry their
 * values for the reason the Q&A and channel settings do: both already ride the
 * public presentation document every phone holds, and a room that learned about
 * a closed question only by having an answer bounce — or looked at a screen
 * whose blanking was known to one browser — would be the failure each switch
 * exists to prevent.
 *
 * `reaction.sent` is the exception that carries its content, and it can: a
 * reaction is one value out of a five-member enum (REQ077), it names nobody, and
 * it is not stored anywhere for a later read to disagree with.
 *
 * With Elysia's built-in WebSocket, each connection gets a `ws` object
 * that supports .send(), .subscribe(), .publish() etc. We keep our own
 * client map for participant counting and targeted broadcast.
 */

interface Client {
	ws: { send(data: string | ArrayBuffer): void };
	presentationId: string | null;
	role: "presenter" | "participant";
}

const clients = new Map<string, Client>();

/** Register a new WS connection. Returns the client id. */
export function registerClient(ws: Client["ws"]): string {
	const id = crypto.randomUUID();
	clients.set(id, { ws, presentationId: null, role: "participant" });
	console.log(`[ws] client connected (${clients.size} total)`);
	return id;
}

/** Handle a "join" message – associate a client with a presentation room. */
export function joinRoom(
	clientId: string,
	presentationId: string,
	role: "presenter" | "participant",
): void {
	const client = clients.get(clientId);
	if (client) {
		client.presentationId = presentationId;
		client.role = role || "participant";
		broadcastParticipantCount(presentationId);
	}
}

/** Remove a client on disconnect. */
export function removeClient(clientId: string): void {
	const client = clients.get(clientId);
	const presId = client?.presentationId;
	clients.delete(clientId);
	console.log(`[ws] client disconnected (${clients.size} total)`);
	if (presId) {
		broadcastParticipantCount(presId);
	}
}

/** Get participant count for a presentation */
export function getParticipantCount(presentationId: string): number {
	let count = 0;
	for (const client of clients.values()) {
		if (
			client.presentationId === presentationId &&
			client.role === "participant"
		) {
			count++;
		}
	}
	return count;
}

/** Broadcast event to all clients in a specific presentation */
export function broadcastToPresentation(
	presentationId: string,
	event: string,
	data: unknown,
): void {
	const msg = JSON.stringify({ event, data });
	for (const client of clients.values()) {
		if (client.presentationId === presentationId) {
			client.ws.send(msg);
		}
	}
}

/** Broadcast event to all connected clients */
export function broadcastToAll(event: string, data: unknown): void {
	const msg = JSON.stringify({ event, data });
	for (const client of clients.values()) {
		client.ws.send(msg);
	}
}

/** Notify all clients in a presentation about the current participant count */
function broadcastParticipantCount(presentationId: string): void {
	const count = getParticipantCount(presentationId);
	broadcastToPresentation(presentationId, "participants.count", {
		count,
		presentationId,
	});
}
