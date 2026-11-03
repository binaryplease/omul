/**
 * Unit tests for a quiz's audio cue (REQ058) — the stored field, the write
 * boundary's ceiling on it, the one resolver every surface reads it through, and
 * the projection that keeps it off everybody else's screen (no DB, no network).
 *
 * Three claims, each of which the feature is worthless without:
 *
 *   - **Off by default, and forward-compatible.** A quiz authored before the
 *     field existed — in a request, or in a row already on disk — reads back
 *     with the key present and empty, so it runs in silence exactly as it did,
 *     with no migration and no read site reaching for `??`.
 *   - **One grammar for an authored address.** The track is held to the rule
 *     every other authored media URL meets (`browserSafeAssetUrl`), at one read
 *     site, and a cue left behind on a slide that is no longer a quiz is inert.
 *   - **Presenter-only on the wire.** `withAudienceSlides` empties the field on
 *     every slide, whatever the deck's state — a participant's phone is never
 *     handed an address it could load.
 *
 * The integration half — that the empty field is what actually lands in each
 * response and broadcast, and who may write it — lives in
 * `quiz-audio.integration.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	browserSafeAssetUrl,
	CreatePresentationSchema,
	PresentationSchema,
	quizAudioCueFor,
	SLIDE_MEDIA_URL_MAX_LENGTH,
	SlideSchema,
	slideAppearanceFor,
	SlideTypeEnum,
	StoredPresentationSchema,
	UpdatePresentationSchema,
	withAudienceSlides,
	withAudienceSolutions,
	withoutQuizAudioCues,
} from "./schemas";
import { QUIZ_AUDIO_PRESETS } from "../src/components/QuizAudioCue";

const TRACK = "https://cdn.example.com/audio/thinking-music.mp3";
const NOTE = "Count down out loud with them.";

/** A quiz slide carrying a cue — and, unless overridden, an answer key. */
function cuedQuiz(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "qz",
		type: "quiz",
		question: "Which planet is closest to the sun?",
		timeLimit: 30,
		options: [
			{ id: "mercury", text: "Mercury", isCorrect: true },
			{ id: "venus", text: "Venus" },
		],
		quizAudioUrl: TRACK,
		...overrides,
	});
}

/** A deck state to project against: live, nothing revealed, no question opened. */
function deck(overrides: Record<string, unknown> = {}) {
	return StoredPresentationSchema.parse({
		id: "p1",
		status: "live",
		resultsVisibility: "instant",
		...overrides,
	});
}

/** A one-slide deck as a request writes it. */
function deckOf(slide: Record<string, unknown>) {
	return {
		title: "Deck",
		slides: [{ id: "qz", type: "quiz", question: "Q", ...slide }],
	};
}

describe("SlideSchema — quizAudioUrl (REQ058)", () => {
	test("a quiz carries the address its author pasted, byte for byte", () => {
		expect(cuedQuiz().quizAudioUrl).toBe(TRACK);
	});

	test("defaults to an empty string — a quiz with no track runs in silence", () => {
		const slide = SlideSchema.parse({
			id: "old",
			type: "quiz",
			question: "Authored before the field existed",
		});
		expect(slide.quizAudioUrl).toBe("");
		expect(quizAudioCueFor(slide)).toBe("");
	});

	test("a stored deck written before the field existed re-parses with the key on every slide", () => {
		// The row exactly as a build before REQ058 wrote it: no `quizAudioUrl`
		// anywhere. The default fills it in on the way out of the store, so the
		// deck reads as one complete shape — the key present, the cue off.
		const stored = StoredPresentationSchema.parse({
			id: "p-legacy",
			code: "123456",
			title: "Written before REQ058",
			slides: [
				{ id: "q1", type: "quiz", question: "One?", timeLimit: 20 },
				{ id: "mc", type: "multiple-choice", question: "Two?" },
			],
		});
		for (const slide of stored.slides) {
			expect("quizAudioUrl" in slide).toBe(true);
			expect(slide.quizAudioUrl).toBe("");
		}
	});

	test("the response schema fills it in the same way", () => {
		const response = PresentationSchema.parse({
			id: "p-legacy",
			code: "123456",
			title: "Written before REQ058",
			slides: [{ id: "q1", type: "quiz", question: "One?" }],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(response.slides[0].quizAudioUrl).toBe("");
	});

	test("a cue survives a type change on the way in — kept, and inert until it is a quiz again", () => {
		// Switching a quiz to a poll keeps what it was authored with, the way a
		// typed question keeps its options; the resolver is what makes it inert.
		const poll = SlideSchema.parse({
			id: "was-a-quiz",
			type: "multiple-choice",
			question: "Now a poll",
			quizAudioUrl: TRACK,
		});
		expect(poll.quizAudioUrl).toBe(TRACK);
		expect(quizAudioCueFor(poll)).toBe("");
		expect(quizAudioCueFor({ ...poll, type: "quiz" })).toBe(TRACK);
	});
});

describe("the write boundary — a track is an address, held to what a URL is (REQ058/REQ159)", () => {
	const atCeiling = `https://example.com/${"p".repeat(
		SLIDE_MEDIA_URL_MAX_LENGTH - "https://example.com/".length,
	)}`;
	const pastCeiling = `${atCeiling}x`;

	test("an address at the ceiling is written; one past it is refused — on create", () => {
		expect(atCeiling.length).toBe(SLIDE_MEDIA_URL_MAX_LENGTH);
		expect(
			CreatePresentationSchema.safeParse(deckOf({ quizAudioUrl: atCeiling }))
				.success,
		).toBe(true);
		expect(
			CreatePresentationSchema.safeParse(deckOf({ quizAudioUrl: pastCeiling }))
				.success,
		).toBe(false);
	});

	test("and on a PATCH, exactly as on a create", () => {
		const patchOf = (quizAudioUrl: string) => ({
			slides: [{ id: "qz", type: "quiz", question: "Q", quizAudioUrl }],
		});
		expect(UpdatePresentationSchema.safeParse(patchOf(atCeiling)).success).toBe(
			true,
		);
		expect(
			UpdatePresentationSchema.safeParse(patchOf(pastCeiling)).success,
		).toBe(false);
	});

	test("a write that never mentions the field is given the default", () => {
		const written = CreatePresentationSchema.parse(deckOf({}));
		expect(written.slides[0].quizAudioUrl).toBe("");
	});

	test("the scheme is not judged at the write — it is judged where it is played", () => {
		// The rule every authored media URL follows: stored as typed, refused at
		// the read site. A write is never failed over a URL the editor is still
		// telling its author it cannot play.
		const written = CreatePresentationSchema.parse(
			deckOf({ quizAudioUrl: "javascript:alert(1)" }),
		);
		expect(written.slides[0].quizAudioUrl).toBe("javascript:alert(1)");
		expect(quizAudioCueFor(written.slides[0])).toBe("");
	});

	test("a slide already stored past the ceiling still reads back", () => {
		// The cap lives on the input schema for the reason REQ159 gives: tightening
		// the stored shape would not shorten a field already on disk, it would make
		// the deck holding it unreadable.
		const stored = PresentationSchema.safeParse({
			id: "p1",
			code: "123456",
			title: "Written before the ceiling",
			slides: [
				{
					id: "qz",
					type: "quiz",
					question: "Q",
					quizAudioUrl: `https://example.com/${"p".repeat(SLIDE_MEDIA_URL_MAX_LENGTH * 2)}`,
				},
			],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(stored.success).toBe(true);
	});
});

describe("quizAudioCueFor — the one read site (REQ058)", () => {
	const quiz = (quizAudioUrl: string | undefined) => ({
		type: "quiz" as const,
		quizAudioUrl,
	});

	test("an http(s) address is the cue, as authored", () => {
		expect(quizAudioCueFor(quiz(TRACK))).toBe(TRACK);
		expect(quizAudioCueFor(quiz("http://intranet.example/a.ogg?v=2"))).toBe(
			"http://intranet.example/a.ogg?v=2",
		);
	});

	test("a root-relative path is a file this deployment already serves", () => {
		expect(quizAudioCueFor(quiz("/media/countdown.mp3"))).toBe(
			"/media/countdown.mp3",
		);
	});

	test("whitespace around the address is not part of it", () => {
		expect(quizAudioCueFor(quiz(`  ${TRACK}\n`))).toBe(TRACK);
	});

	test("no track is no cue", () => {
		expect(quizAudioCueFor(quiz(undefined))).toBe("");
		expect(quizAudioCueFor(quiz(""))).toBe("");
		expect(quizAudioCueFor(quiz("   "))).toBe("");
	});

	test("an address no media element should be pointed at is no cue at all", () => {
		for (const refused of [
			"javascript:alert(1)",
			"data:audio/mpeg;base64,SUQzBAAAAAAA",
			"blob:https://example.com/3f1c",
			"file:///etc/passwd",
			"ftp://example.com/a.mp3",
			"mailto:someone@example.com",
			// Protocol-relative: names a scheme the check never gets to see.
			"//cdn.example.com/a.mp3",
			"not a url at all",
		]) {
			expect(quizAudioCueFor(quiz(refused))).toBe("");
		}
	});

	test("it is the grammar every other authored media URL meets", () => {
		// "Is this a URL we may hand a browser?" is one question with one answer —
		// the deck's logo, a slide's background image and now its cue.
		for (const authored of [
			TRACK,
			"/media/countdown.mp3",
			"  https://example.com/a.wav ",
			"javascript:alert(1)",
			"//cdn.example.com/a.mp3",
			"data:audio/wav;base64,AAAA",
			"",
		]) {
			expect(quizAudioCueFor(quiz(authored))).toBe(
				browserSafeAssetUrl(authored),
			);
			expect(quizAudioCueFor(quiz(authored))).toBe(
				slideAppearanceFor({ backgroundImage: authored }).backgroundImage,
			);
		}
	});

	test("only a quiz has a cue — on every other slide type the field is inert", () => {
		for (const type of SlideTypeEnum.options) {
			const expected = type === "quiz" ? TRACK : "";
			expect(quizAudioCueFor({ type, quizAudioUrl: TRACK })).toBe(expected);
		}
	});

	test("a bundled track's stored path resolves unchanged", () => {
		for (const preset of QUIZ_AUDIO_PRESETS) {
			expect(quizAudioCueFor({ type: "quiz", quizAudioUrl: preset.path })).toBe(
				preset.path,
			);
		}
	});
});

describe("withoutQuizAudioCues (REQ058)", () => {
	test("empties the cue on every slide, whatever its type", () => {
		const leftover = SlideSchema.parse({
			id: "mc",
			type: "multiple-choice",
			question: "Was a quiz",
			quizAudioUrl: TRACK,
		});
		const audience = withoutQuizAudioCues([cuedQuiz(), leftover]);
		expect(audience.map((slide) => slide.quizAudioUrl)).toEqual(["", ""]);
	});

	test("emptied to `\"\"`, never dropped", () => {
		// A slide that carried a cue and one that never did must be the same
		// complete shape, so the audience's copy announces nothing about which
		// questions have music.
		const [audience] = withoutQuizAudioCues([cuedQuiz()]);
		expect("quizAudioUrl" in audience).toBe(true);
		expect(audience.quizAudioUrl).toBe("");
	});

	test("leaves everything else on the slide alone", () => {
		const slide = cuedQuiz();
		const [audience] = withoutQuizAudioCues([slide]);
		expect({ ...audience, quizAudioUrl: TRACK }).toEqual(slide);
	});

	test("a slide with no cue is unchanged", () => {
		const slide = cuedQuiz({ quizAudioUrl: "" });
		expect(withoutQuizAudioCues([slide])).toEqual([slide]);
	});

	test("projects a copy — the author's own slide keeps its cue", () => {
		const slide = cuedQuiz();
		withoutQuizAudioCues([slide]);
		expect(slide.quizAudioUrl).toBe(TRACK);
	});
});

describe("withAudienceSlides — the cue is presenter-only (REQ058)", () => {
	test("empties the cue together with the notes and a running answer key", () => {
		const [audience] = withAudienceSlides(
			[cuedQuiz({ notes: NOTE })],
			deck({ slideStartedAt: { qz: new Date().toISOString() } }),
			Date.now(),
		);
		expect(audience.quizAudioUrl).toBe("");
		expect(audience.notes).toBe("");
		expect(audience.options.every((option) => !("isCorrect" in option))).toBe(
			true,
		);
	});

	test("no state of the deck is a reveal for a cue", () => {
		for (const status of ["draft", "live", "ended"] as const) {
			const [audience] = withAudienceSlides(
				[cuedQuiz()],
				deck({ status }),
				Date.now(),
			);
			expect(audience.quizAudioUrl).toBe("");
		}
	});

	test("revealing the slide's results is not a reveal for a cue", () => {
		const [audience] = withAudienceSlides(
			[cuedQuiz()],
			deck({ revealedSlideIds: ["qz"] }),
			Date.now(),
		);
		// The answer key does come back on a reveal (REQ056) — the cue does not.
		expect(audience.options[0].isCorrect).toBe(true);
		expect(audience.quizAudioUrl).toBe("");
	});

	test("a question whose window has closed still sends no cue", () => {
		const longAgo = new Date(Date.now() - 10 * 60_000).toISOString();
		const [audience] = withAudienceSlides(
			[cuedQuiz()],
			deck({ slideStartedAt: { qz: longAgo } }),
			Date.now(),
		);
		expect(audience.options[0].isCorrect).toBe(true);
		expect(audience.quizAudioUrl).toBe("");
	});

	test("the address is nowhere in the projected payload", () => {
		const audience = withAudienceSlides(
			[cuedQuiz(), cuedQuiz({ id: "qz2", quizAudioUrl: "/media/b.mp3" })],
			deck(),
			Date.now(),
		);
		const serialized = JSON.stringify(audience);
		expect(serialized).not.toContain("thinking-music");
		expect(serialized).not.toContain("/media/b.mp3");
	});

	test("the solution projection on its own does not touch the cue", () => {
		// Guards the composition rather than the parts: `withAudienceSolutions` is
		// about answer keys and knows nothing about sound, which is exactly why
		// every audience-facing surface must go through `withAudienceSlides`.
		const [audience] = withAudienceSolutions([cuedQuiz()], deck(), Date.now());
		expect(audience.quizAudioUrl).toBe(TRACK);
	});
});
