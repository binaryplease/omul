// ── useSessionSocket: the single WebSocket → session-reducer wiring ────
//
// Previously the Presenter and Participant pages each re-implemented the same
// `slide.changed / results.updated / participants.count / presentation.* /
// slide.revealed` subscription block. That duplication is gone: this one hook
// connects the socket for a presentation and routes every broadcast to the
// matching session-slice reducer. Both pages call it; neither owns the wiring.

import { useEffect } from "react";
import { connectWs, disconnectWs, onWsEvent } from "../api";
import { useStoreApi } from "./StoreProvider";

export function useSessionSocket(
	presentationId: string | null,
	role: "presenter" | "participant",
) {
	const store = useStoreApi();

	useEffect(() => {
		if (!presentationId) return;

		// Reducers are stable across renders, so reading them once here is safe
		// and keeps the effect from re-subscribing on every state change.
		const {
			applySlideChanged,
			applyResultsUpdated,
			applyParticipantCount,
			applyStarted,
			applyEnded,
			applyReset,
			applyRevealed,
			applyDeckResultsVisibility,
			applySlideStarted,
			applyParticipantNameSetting,
			applyQASettings,
			applyQAChanged,
			applyChannelSettings,
			applyReaction,
			applyChatChanged,
			applySlideParticipation,
			applyAudienceBlanked,
		} = store.getState();

		connectWs(presentationId, role);

		const unsubscribes = [
			onWsEvent("results.updated", (data) => applyResultsUpdated(data)),
			onWsEvent("participants.count", (data) => applyParticipantCount(data)),
			onWsEvent("slide.changed", (data) => applySlideChanged(data)),
			onWsEvent("presentation.started", () => applyStarted()),
			onWsEvent("presentation.ended", () => applyEnded()),
			onWsEvent("presentation.reset", () => applyReset()),
			onWsEvent("slide.revealed", (data) => applyRevealed(data)),
			// The deck's reveal mode, set for every question slide at once (REQ018).
			// It changes what the room may see *now*, so both surfaces take it live
			// rather than on the next full reload.
			onWsEvent("presentation.results-visibility", (data) =>
				applyDeckResultsVisibility(data),
			),
			onWsEvent("slide.started", (data) => applySlideStarted(data)),
			// The live room's two switches (REQ111/REQ109). Both take effect on
			// every screen at once rather than on the next reload, for the reason
			// the channel switches do: a phone that had not heard would offer a
			// control the boundary is already refusing, and a projector that had not
			// heard would keep showing a room what the presenter has just taken off
			// the wall.
			onWsEvent("slide.participation", (data) => applySlideParticipation(data)),
			onWsEvent("presentation.blanked", (data) => applyAudienceBlanked(data)),
			// Whether this deck asks joiners for a name (REQ076). It rides the
			// socket for the reason the switches above it do, and one of its own:
			// turned on, a phone that had not heard is never asked and every answer
			// it gives lands under nobody; turned off, a participant still at the
			// gate is left holding a question the boundary has started refusing.
			onWsEvent("presentation.participant-name", (data) =>
				applyParticipantNameSetting(data),
			),
			onWsEvent("qa.settings", (data) => applyQASettings(data)),
			// Payload-free by design (REQ037): the list itself is fetched, never
			// broadcast, because who may read it is decided per request from the
			// caller's own credentials.
			onWsEvent("qa.updated", () => applyQAChanged()),
			// The participant channels (REQ077/REQ078). Their two switches ride the
			// broadcast for the reason the Q&A layer's do — they are already on the
			// public deck every phone holds — so a channel the presenter closes
			// closes on every screen rather than on the next reload.
			onWsEvent("channels.settings", (data) => applyChannelSettings(data)),
			// The one frame here that carries its content rather than a signal: a
			// reaction is a value out of a closed set, it names nobody, and it is
			// stored nowhere for a later read to disagree with (REQ077).
			onWsEvent("reaction.sent", (data) => applyReaction(data)),
			// Payload-free like `qa.updated` (REQ078): the feed has one projection,
			// and keeping it in one place is what keeps `own` and the transcript's
			// order honest.
			onWsEvent("chat.updated", () => applyChatChanged()),
		];

		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
			disconnectWs();
		};
	}, [presentationId, role, store]);
}
