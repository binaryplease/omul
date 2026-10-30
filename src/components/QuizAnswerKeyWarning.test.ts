/**
 * A quiz question nobody can get right, said where the author meets it (REQ219).
 *
 * The three surfaces compose one descriptor, so the claims are made against it
 * and against the markup each surface renders from it:
 *
 *   - **The slide's settings say it, and keep saying it to a screen reader.**
 *     The warning sits in a status region that is in the tree whether or not
 *     it has anything to say, so it is announced as it comes and goes.
 *   - **The slide list says it inside the thumbnail's button**, so the words are
 *     part of the name a keyboard or screen-reader user hears when tabbing the
 *     rail — not only an icon for the eye.
 *   - **Going live names the slides**, by number and question, in deck order —
 *     and says nothing at all on a deck whose quizzes all have a key, which every
 *     catalog template does.
 */

import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DECK_TEMPLATES } from "../../server/templates";
import { newSlide } from "../store/editorDocument";
import type { Slide } from "../types";
import {
	QUIZ_NO_ANSWER_KEY_WARNING,
	QuizAnswerKeyWarning,
	quizAnswerKeyGoLiveWarning,
} from "./QuizAnswerKeyWarning";
import { SlideThumbnail } from "./SlideThumbnail";

function quiz(question: string, marked: boolean): Slide {
	return {
		...newSlide("quiz"),
		question,
		options: [
			{ id: "a", text: "Wien", isCorrect: marked },
			{ id: "b", text: "Graz", isCorrect: false },
		],
	};
}

function typedQuiz(question: string, accepted: string[]): Slide {
	return {
		...newSlide("quiz"),
		question,
		quizAnswerMode: "type",
		quizAnswers: accepted.map((text, index) => ({ id: `q${index}`, text })),
	};
}

const settingsMarkup = (slide: Slide) =>
	renderToStaticMarkup(createElement(QuizAnswerKeyWarning, { slide }));

const thumbnailMarkup = (slide: Slide) =>
	renderToStaticMarkup(
		createElement(SlideThumbnail, {
			index: 0,
			slide,
			active: false,
			onClick: () => {},
		}),
	);

describe("on the slide's settings (REQ219)", () => {
	test("a select-answer quiz with nothing marked is warned, and told where to mark", () => {
		const markup = settingsMarkup(quiz("Capital of Austria?", false));
		expect(markup).toContain(QUIZ_NO_ANSWER_KEY_WARNING);
		expect(markup).toContain("Mark the correct option on the slide.");
	});

	test("a typed quiz with no accepted answer is warned, and told where to add one", () => {
		const markup = settingsMarkup(typedQuiz("Capital of Austria?", []));
		expect(markup).toContain(QUIZ_NO_ANSWER_KEY_WARNING);
		expect(markup).toContain("Add an accepted answer below.");
	});

	test("the status region stays in the tree once the key is there, empty", () => {
		const markup = settingsMarkup(quiz("Capital of Austria?", true));
		expect(markup).toBe('<div role="status"></div>');
		expect(settingsMarkup(typedQuiz("Capital?", ["Wien"]))).toBe(
			'<div role="status"></div>',
		);
	});
});

describe("on the slide-list thumbnail (REQ219)", () => {
	test("the warning is inside the button, for a screen reader, and in its tooltip", () => {
		const markup = thumbnailMarkup(quiz("Capital of Austria?", false));
		expect(markup).toContain(
			`<span class="sr-only">${QUIZ_NO_ANSWER_KEY_WARNING}</span>`,
		);
		expect(markup).toContain(
			`title="Capital of Austria? — ${QUIZ_NO_ANSWER_KEY_WARNING}"`,
		);
	});

	test("a quiz with a key, or any other slide, carries no warning", () => {
		expect(thumbnailMarkup(quiz("Capital of Austria?", true))).not.toContain(
			QUIZ_NO_ANSWER_KEY_WARNING,
		);
		expect(thumbnailMarkup(newSlide("leaderboard"))).not.toContain(
			QUIZ_NO_ANSWER_KEY_WARNING,
		);
	});
});

describe("going live names the slides (REQ219)", () => {
	test("one slide: named by number and question", () => {
		expect(
			quizAnswerKeyGoLiveWarning([
				newSlide("instruction"),
				quiz("Capital of Austria?", false),
				quiz("Capital of France?", true),
			]),
		).toEqual({
			title: "A quiz question has no correct answer",
			message:
				"Slide 2 (“Capital of Austria?”) has no correct answer, so every answer to it scores 0. Start anyway, or cancel and mark the answers in the editor.",
		});
	});

	test("several slides: all named, in deck order, typed ones included", () => {
		const warning = quizAnswerKeyGoLiveWarning([
			quiz("Capital of Austria?", false),
			newSlide("leaderboard"),
			typedQuiz("Longest river?", []),
		]);
		expect(warning?.title).toBe("Some quiz questions have no correct answer");
		expect(warning?.message).toStartWith(
			"Slide 1 (“Capital of Austria?”) and slide 3 (“Longest river?”) have no correct answer, so every answer to them scores 0.",
		);
	});

	test("a slide's markup comes off its name", () => {
		expect(
			quizAnswerKeyGoLiveWarning([quiz("**Capital** of Austria?", false)])
				?.message,
		).toStartWith("Slide 1 (“Capital of Austria?”)");
	});

	test("a deck whose quizzes all have a key starts without a word", () => {
		expect(
			quizAnswerKeyGoLiveWarning([
				quiz("Capital of Austria?", true),
				newSlide("leaderboard"),
			]),
		).toBeNull();
		for (const template of DECK_TEMPLATES) {
			expect(quizAnswerKeyGoLiveWarning(template.slides)).toBeNull();
		}
	});
});
