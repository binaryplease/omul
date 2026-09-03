/**
 * Unit tests for the Form slide's client half (REQ061) — the two things the
 * phone and the editor decide for themselves, with no store and no React:
 *
 *   - **What a fresh form slide is.** `newSlide("form")` seeds the fields an
 *     author starts from *and* the private posture the slide is authored under,
 *     because a slide that collects names must not open on a reveal mode that
 *     would publish them.
 *   - **When the submit button may act.** `formEntryIssue` is the phone's read
 *     of the same rules `decodeFormSubmission` enforces at the boundary,
 *    so the two are asserted against each other here: a form this
 *     lets through is one the server accepts, and a form it refuses is one the
 *     server would have refused too. A disabled button that was wrong in either
 *     direction is the defect this file exists to prevent.
 */

import { describe, expect, test } from "bun:test";
import type { FormField, Slide } from "../types";
import {
	decodeFormSubmission,
	encodeFormSubmission,
	FORM_ANSWER_MAX_LENGTH,
	formFieldsFor,
} from "../types";
import { newFormField, newSlide } from "../store/editorDocument";
import { formEntryIssue } from "./ParticipantSlideView";

/** A three-field signup form as the editor would have authored it. */
const FORM_SLIDE: Slide = {
	id: "fm",
	type: "form",
	question: "Sign up for the workshop",
	formFields: [
		{ id: "name", label: "Your name", type: "text", required: false, options: [] },
		{ id: "mail", label: "Email", type: "email", required: true, options: [] },
		{
			id: "track",
			label: "Track",
			type: "choice",
			required: false,
			options: [
				{ id: "design", text: "Design" },
				{ id: "eng", text: "Engineering" },
			],
		},
	],
};

const FIELDS: FormField[] = formFieldsFor(FORM_SLIDE);

/** Whether the boundary would accept what the phone is holding. */
function serverAccepts(answers: Record<string, string>): boolean {
	const value = encodeFormSubmission(answers);
	// An empty value never reaches the codec — `VoteSchema.value` has a minimum
	// of one character — so it is refused either way.
	if (value.length === 0) return false;
	return decodeFormSubmission(value, FIELDS) !== null;
}

describe("newSlide('form') — what a fresh form slide is (REQ061)", () => {
	test("seeds the two fields an author starts from", () => {
		const slide = newSlide("form");
		expect(slide.formFields).toHaveLength(2);
		expect(slide.formFields?.[0]).toMatchObject({
			label: "Name",
			type: "text",
			required: false,
		});
		expect(slide.formFields?.[1]).toMatchObject({
			label: "Email",
			type: "email",
			required: false,
		});
	});

	test("opens private — a slide that collects names never inherits a reveal", () => {
		expect(newSlide("form").resultsVisibility).toBe("private");
		// And only this slide type: nothing else acquires the posture by accident.
		expect(newSlide("multiple-choice").resultsVisibility).toBeUndefined();
	});

	test("a choice field opens with two blanks — one option is not a choice", () => {
		expect(newFormField("choice").options).toHaveLength(2);
		expect(newFormField("text").options).toEqual([]);
		expect(newFormField("email").options).toEqual([]);
	});
});

describe("formEntryIssue — the phone agrees with the boundary (REQ061)", () => {
	test("a complete form is sendable, and the server accepts it", () => {
		const answers = {
			name: "Ada Lovelace",
			mail: "ada@example.org",
			track: "eng",
		};
		expect(formEntryIssue(FIELDS, answers)).toBeNull();
		expect(serverAccepts(answers)).toBe(true);
	});

	test("only the required field filled in is still sendable", () => {
		const answers = { mail: "ada@example.org" };
		expect(formEntryIssue(FIELDS, answers)).toBeNull();
		expect(serverAccepts(answers)).toBe(true);
	});

	test("an untouched form says so rather than complaining about a field", () => {
		expect(formEntryIssue(FIELDS, {})).toBe("empty");
		expect(formEntryIssue(FIELDS, { name: "   " })).toBe("empty");
		expect(serverAccepts({})).toBe(false);
	});

	test("a slide with no answerable field says the slide is unfinished", () => {
		// The submit button is rendered and disabled on such a slide rather than
		// hidden, so this issue is what the line under it carries — and
		// the instruction paragraph above it no longer repeats the same sentence.
		expect(formEntryIssue([], { name: "Ada" })).toBe("no-fields");
		expect(formEntryIssue([], {})).toBe("no-fields");
	});

	test("a required field left blank blocks the button, as it blocks the row", () => {
		const answers = { name: "Ada" };
		expect(formEntryIssue(FIELDS, answers)).toBe("required");
		expect(serverAccepts(answers)).toBe(false);
	});

	test("an email field holding something else blocks it too", () => {
		const answers = { mail: "not-an-address" };
		expect(formEntryIssue(FIELDS, answers)).toBe("email");
		expect(serverAccepts(answers)).toBe(false);
	});

	test("an over-long answer blocks it, and exactly at the cap does not", () => {
		const tooLong = {
			mail: "ada@example.org",
			name: "x".repeat(FORM_ANSWER_MAX_LENGTH + 1),
		};
		expect(formEntryIssue(FIELDS, tooLong)).toBe("too-long");
		expect(serverAccepts(tooLong)).toBe(false);

		const atCap = {
			mail: "ada@example.org",
			name: "x".repeat(FORM_ANSWER_MAX_LENGTH),
		};
		expect(formEntryIssue(FIELDS, atCap)).toBeNull();
		expect(serverAccepts(atCap)).toBe(true);
	});

	test("a choice answer the field does not offer is caught by the server", () => {
		// The phone cannot produce one — the options are buttons — so this is the
		// one rule it does not duplicate. Asserted anyway, because "the boundary is
		// the authority" is only true while the boundary actually checks.
		expect(serverAccepts({ mail: "ada@example.org", track: "sales" })).toBe(
			false,
		);
	});
});
