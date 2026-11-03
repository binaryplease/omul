/**
 * A deck that requires its participants to be signed in (REQ134), from the
 * client's side: the editor's switch reaches the server, and each refusal the
 * server states leads the participant to the screen written for it.
 *
 * This repo renders no DOM in tests, so the screen is asserted through the
 * three things that decide it — the store field the join door's refusal lands
 * in, the transport that reports a refusal met mid-session, and the pure
 * mapping from refusal to prompt — and the editor's markup by reading
 * `CreatePage.tsx`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, api, signInRefusalOf } from "../api";
import { getDict, type Lang } from "../i18n";
import { reportingSignInRefusals } from "../pages/ParticipantPage";
import { createAppStore } from "../store/store";
import type { ParticipantSignInRefusalCode } from "../types";
import {
	participantSignInLabelsFor,
	participantSignInPrompt,
} from "./ParticipantSignIn";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Answer every request with `status` and `body`, recording each request. */
function answerWith(
	status: number,
	body: unknown,
): { url: string; init: RequestInit | undefined }[] {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
	return calls;
}

/** What the server answers a refused participant with (`server/routes`). */
const SIGN_IN_REQUIRED = {
	error: "This presentation requires participants to sign in",
	refused: "sign-in-required",
};
const ACCOUNT_MISMATCH = {
	error: "This participant is signed in to this presentation under another account",
	refused: "participant-account-mismatch",
};

const LABELS = participantSignInLabelsFor(getDict("en"));

describe("the editor's switch reaches the server", () => {
	test("an update sends requireParticipantSignIn as the editor holds it", async () => {
		const calls = answerWith(200, { id: "deck-1" });
		const store = createAppStore();
		store.getState().resetEditor();
		store.getState().setRequireParticipantSignIn(true);
		await api.updatePresentation("deck-1", {
			requireParticipantSignIn: store.getState().requireParticipantSignIn,
		});
		expect(calls[0].init?.method).toBe("PATCH");
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({
			requireParticipantSignIn: true,
		});
	});

	test("the editor saves the switch on create and on update, and draws it", () => {
		const page = readFileSync(
			join(import.meta.dir, "../pages/CreatePage.tsx"),
			"utf8",
		);
		const save = page.slice(
			page.indexOf("await api.updatePresentation(editId"),
			page.indexOf("} catch (submitError"),
		);
		expect(save.match(/\brequireParticipantSignIn,/g)?.length).toBe(2);
		expect(page).toContain(
			"requireParticipantSignIn: data.requireParticipantSignIn",
		);
		expect(page).toContain("checked={requireParticipantSignIn}");
		expect(page).toContain("onChange={onRequireParticipantSignInChange}");
		expect(page).toContain(
			"onRequireParticipantSignInChange={setRequireParticipantSignIn}",
		);
	});
});

describe("a refused join leads to the sign-in prompt, not an error", () => {
	test("sign-in-required lands in its own field and leaves no error", async () => {
		answerWith(401, SIGN_IN_REQUIRED);
		const store = createAppStore();
		expect(await store.getState().loadByCode("ABC123")).toBeNull();
		expect(store.getState().signInRefusal).toBe("sign-in-required");
		expect(store.getState().error).toBe("");
		expect(store.getState().loading).toBe(false);
	});

	test("joining again clears it, so a signed-in retry reaches the deck", async () => {
		answerWith(401, SIGN_IN_REQUIRED);
		const store = createAppStore();
		await store.getState().loadByCode("ABC123");
		answerWith(200, { id: "deck-1", slides: [], status: "live" });
		await store.getState().loadByCode("ABC123");
		expect(store.getState().signInRefusal).toBeNull();
		expect(store.getState().presentation?.id).toBe("deck-1");
	});

	test("any other refused join is still an error", async () => {
		answerWith(404, { error: "Presentation not found" });
		const store = createAppStore();
		await store.getState().loadByCode("NOPE00");
		expect(store.getState().signInRefusal).toBeNull();
		expect(store.getState().error).toBe("Presentation not found");
	});

	test("the prompt asks the participant to sign in", () => {
		const prompt = participantSignInPrompt("sign-in-required", LABELS);
		expect(prompt.action).toBe("sign-in");
		expect(prompt.title).toBe(LABELS.title);
		expect(prompt.intro).toBe(LABELS.intro);
		expect(prompt.actionLabel).toBe(LABELS.action);
	});
});

describe("a write refused for another account gets its own message", () => {
	test("the refusal code survives the API client", async () => {
		answerWith(403, ACCOUNT_MISMATCH);
		const thrown = await api
			.vote("deck-1", "slide-1", "option-1", "participant-1")
			.catch((voteError: unknown) => voteError);
		expect(thrown).toBeInstanceOf(ApiError);
		expect(signInRefusalOf(thrown)).toBe("participant-account-mismatch");
	});

	test("the live transport reports it to the page, and still rejects", async () => {
		const reported: ParticipantSignInRefusalCode[] = [];
		const refusal = new ApiError(
			ACCOUNT_MISMATCH.error,
			"participant-account-mismatch",
			403,
		);
		const transport = reportingSignInRefusals(
			{
				participantId: "participant-1",
				vote: async () => {
					throw refusal;
				},
				upvoteResponse: async () => {
					throw new ApiError(SIGN_IN_REQUIRED.error, "sign-in-required", 401);
				},
				scorecard: async () => null,
			},
			(refused) => reported.push(refused),
		);
		await expect(
			transport.vote({ slideId: "slide-1", value: "option-1" }),
		).rejects.toBe(refusal);
		await expect(
			transport.upvoteResponse({ slideId: "slide-1", responseId: "r-1" }),
		).rejects.toBeInstanceOf(ApiError);
		expect(reported).toEqual(["participant-account-mismatch", "sign-in-required"]);
	});

	test("a refusal about the answer itself is not mistaken for one", async () => {
		const reported: ParticipantSignInRefusalCode[] = [];
		const transport = reportingSignInRefusals(
			{
				participantId: "participant-1",
				vote: async () => {
					throw new ApiError("closed", "quiz-window-closed", 400);
				},
				upvoteResponse: async () => {},
				scorecard: async () => null,
			},
			(refused) => reported.push(refused),
		);
		await expect(
			transport.vote({ slideId: "slide-1", value: "option-1" }),
		).rejects.toBeInstanceOf(ApiError);
		expect(reported).toEqual([]);
		expect(signInRefusalOf(new Error("offline"))).toBeNull();
		expect(signInRefusalOf(new ApiError("Unauthorized", null, 401))).toBeNull();
	});

	test("the prompt says so and offers to switch account", () => {
		const prompt = participantSignInPrompt(
			"participant-account-mismatch",
			LABELS,
		);
		const signIn = participantSignInPrompt("sign-in-required", LABELS);
		expect(prompt.action).toBe("switch-account");
		expect(prompt.title).toBe(LABELS.mismatchTitle);
		expect(prompt.intro).toBe(LABELS.mismatchIntro);
		expect(prompt.actionLabel).toBe(LABELS.switchAccount);
		expect(prompt.title).not.toBe(signIn.title);
		expect(prompt.intro).not.toBe(signIn.intro);
	});
});

describe("the prompt is in the room's language (REQ084)", () => {
	test("every language words it, and none falls back to English", () => {
		const english = participantSignInLabelsFor(getDict("en"));
		for (const lang of ["de", "fr", "es", "it", "pt", "nl"] as Lang[]) {
			const labels = participantSignInLabelsFor(getDict(lang));
			for (const key of Object.keys(english) as (keyof typeof english)[]) {
				expect(labels[key].trim().length).toBeGreaterThan(0);
				expect(labels[key]).not.toBe(english[key]);
			}
		}
	});
});
