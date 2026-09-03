/**
 * Generating a deck from a prompt, over HTTP (REQ007).
 *
 * Its own route file for the reason the template catalog next door has one: what
 * it is *about* — a model, a brief, and what may be authored from one — belongs
 * to `server/deck-generator.ts` and to nothing else. What this file
 * adds is the two things generation needs from the web: a way to ask whether the
 * deployment can do it at all, and a way to do it.
 *
 * **Two routes, because the answer to "can we?" has to arrive before the click.**
 * A self-hosted server with no provider key configured is the ordinary case, not
 * an error, and a surface draws the control and disables it with its reason
 * rather than hiding it or letting it fail. `GET /api/deck-generation` is
 * where that reason comes from — public and read-only, like the catalog, because
 * "this build can generate" is a fact about the build rather than about the
 * caller.
 *
 * **A generated deck is created exactly like any other**, through the same
 * `createPresentation` the create route calls, with the same owner resolution
 * and the same edit-token rule (anonymous and cookie-session creates are minted
 * one; an API-key create is already owner-editable via the key and is not).
 * That is REQ007's "returns it as an ordinary editable deck" — not a second kind
 * of deck with a generated flag on it, but the same document, reached through a
 * different door.
 */

import { Elysia } from "elysia";
import { isApiKeyRequest, resolveUserId } from "../accounts";
import {
	ACCOUNT_REQUIRED_MESSAGE,
	type DeckGenerationRefusal,
	type DeckGenerator,
	deckGenerator as defaultDeckGenerator,
} from "../deck-generator";
import { guardGeneration } from "../rate-limit";
import { GenerateDeckSchema } from "../schemas";
import { createPresentation } from "../services/presentations";
import { sanitize } from "./presentations";

/**
 * What each stated refusal answers with.
 *
 * `503` for a deployment that cannot generate — the capability is absent, not
 * broken, and it may be present on the next boot. `401` for a caller with no
 * account where this deployment requires one: the credential is missing, which
 * is the caller's to supply, and it is the same status every other route answers
 * a signed-out caller with. `502` for both halves of "the provider let us down":
 * the call failed, or it answered with something that is not a deck. Neither of
 * the last two is the caller's fault and neither is worth a `400`, which would
 * tell an organizer their prompt was wrong when it was not.
 */
const REFUSAL_STATUS: Record<DeckGenerationRefusal, number> = {
	unavailable: 503,
	"account-required": 401,
	"provider-failed": 502,
	"unusable-draft": 502,
};

/**
 * The generation routes over a given generator.
 *
 * A factory rather than a bare `new Elysia()` for one reason, and it is the
 * reason REQ007's suite can exist: the tests drive these routes end to end over
 * a stub, so `bun test` needs no provider key, makes no network call and bills
 * nobody. Production wiring is {@link deckGenerationRoutes} below, which is this
 * function at its default.
 */
export function createDeckGenerationRoutes(
	generator: DeckGenerator = defaultDeckGenerator,
) {
	return (
		new Elysia({ prefix: "/api", name: "deck-generation" })
			// ── Can this deployment generate? (REQ007) ──────────────
			.get("/deck-generation", () => generator.availability(), {
				detail: {
					tags: ["Generation"],
					summary: "Whether this server can generate decks",
					description:
						"Reports whether this deployment is configured to generate a deck from a prompt (REQ007), and on what terms: `available`, a `reason` when it is not (an explicit `null` when it is), the `promptMaxLength` a prompt is held to, the `slideTypes` a generated deck may be built from, and `requiresAccount` — whether a caller must be signed in to spend this deployment's provider budget (true unless the operator set `OMUL_GENERATION_ALLOW_ANONYMOUS=true`). Public and read-only — all of it is a fact about the build, not about the caller. A surface offering generation reads this to disable its control with the reason rather than hiding it.",
				},
			})

			// ── Generate a draft deck (REQ007) ──────────────────────
			.post(
				"/deck-generation",
				async ({ body, request, server, set }) => {
					// Availability first, and deliberately before the rate limit: a
					// deployment that cannot generate answers the same 503 however often
					// it is asked, and spending a budget to say so would let an
					// unconfigured server lock out the moment it is configured.
					const availability = generator.availability();
					if (!availability.available) {
						set.status = REFUSAL_STATUS.unavailable;
						return {
							error: availability.reason,
							refused: "unavailable" satisfies DeckGenerationRefusal,
						};
					}
					// Who is asking, resolved once and used twice: to decide whether they
					// may spend the operator's provider budget at all, and — further down
					// — to record them as the deck's owner.
					const userId = await resolveUserId(request.headers);
					// The second control on the paid path, and the one the rate-limit
					// switch cannot reach (see DECK_GENERATION_ANONYMOUS_ENV). Refused
					// before the budget is spent as well as before the provider is called,
					// so a signed-out caller costs this deployment nothing at all and a
					// legitimate one is not drained of budget by refusals they cannot act
					// on.
					if (availability.requiresAccount && !userId) {
						set.status = REFUSAL_STATUS["account-required"];
						return {
							error: ACCOUNT_REQUIRED_MESSAGE,
							refused: "account-required" satisfies DeckGenerationRefusal,
						};
					}
					// Rate-limited before the provider is called, because *that* is the
					// expensive step and it is billed to the operator (REQ145).
					const overLimit = guardGeneration({ request, server });
					if (overLimit) return overLimit;

					const generated = await generator.generate(body.prompt, body.language);
					if (!generated.ok) {
						set.status = REFUSAL_STATUS[generated.refused];
						return { error: generated.error, refused: generated.refused };
					}

					// From here it is an ordinary create, and every rule the create route
					// keeps is kept by calling the same function it calls: the owner is
					// recorded when the request is authenticated, and an API-key create is
					// not minted a redundant edit token.
					const viaApiKey = isApiKeyRequest(request.headers) && Boolean(userId);
					const presentation = await createPresentation(
						generated.title,
						generated.slides,
						// A generated deck's room settings are the defaults, exactly as a
						// template create's are: the brief said what to ask, not whether to
						// open the room's chat.
						{ language: body.language },
						{ creatorId: userId, mintToken: !viaApiKey },
					);
					set.status = 201;
					return sanitize(presentation, { includeToken: true, canEdit: true });
				},
				{
					body: GenerateDeckSchema,
					detail: {
						tags: ["Generation"],
						summary: "Generate a draft deck from a prompt",
						description:
							"Turns a short text prompt into a draft deck and returns it as an ordinary editable presentation (REQ007) — the same document, status and one-time `creatorToken` `POST /api/presentations` answers with, created through the same path. The generator chooses the slide types and writes the question text, in the deck's own `language`. **The output is a draft:** no answer is ever marked correct — not on a quiz slide, not on a choice slide — because the generator has no field in which to express one, so marking the answer key is the organizer's first edit. Nothing records that the deck was generated. Room settings (pace, reveal mode, Q&A, participant channels, theme) take their ordinary defaults and are not the prompt's to set. Answers `503` when this deployment has no generation provider configured (ask `GET /api/deck-generation` first), `401` when it requires an account and the request carries none (`requiresAccount` on that same route — this is the control that survives `OMUL_RATE_LIMITS_DISABLED`), `502` when the provider fails or answers with something unusable, `422` for a prompt that is empty or over `promptMaxLength` or a `language` over 40 characters, and `429` over the generation budget — five per five minutes per client, which also spends the ordinary create budget (REQ145).",
					},
				},
			)
	);
}

/** The generation routes the server mounts, on the environment's generator. */
export const deckGenerationRoutes = createDeckGenerationRoutes();
