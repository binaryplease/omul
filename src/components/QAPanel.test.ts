/**
 * Unit tests for the Q&A layer's labels (REQ036, REQ084, REQ248).
 *
 * The list is drawn by the participant's phone and the presenter's queue from
 * one set of labels, arriving as a parameter: the phone's are the deck's
 * language (`qaLabelsFor`), the presenter's the interface language
 * (`presenterQALabels`). What is worth asserting is that the presenter's
 * English is exactly the wording it always was, and that its German comes from
 * the interface text rather than from the deck's dictionary.
 */

import { describe, expect, test } from "bun:test";
import { getDict } from "../i18n";
import { ENGLISH_INTERFACE_TEXT, interfaceTextFor } from "../interface-text";
import { presenterQALabels, QA_LABELS_EN, qaLabelsFor } from "./QAPanel";

describe("presenterQALabels (REQ248)", () => {
	test("in English it is the presenter's wording exactly as it was", () => {
		expect(presenterQALabels(ENGLISH_INTERFACE_TEXT)).toEqual(QA_LABELS_EN);
	});

	test("in German every label is the interface text's", () => {
		const german = interfaceTextFor("de");
		const labels = presenterQALabels(german);
		expect(labels.title).toBe("Fragen");
		expect(labels.answered).toBe(german.panels.qaAnswered);
		expect(labels.open).toBe("offen");
	});

	test("the participant's labels still come from the deck's dictionary", () => {
		// The presenter's interface language must not reach the phone.
		expect(qaLabelsFor(getDict("fr")).title).toBe(getDict("fr").qaTitle);
	});
});
