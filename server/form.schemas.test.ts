/**
 * Unit tests for the Form question type (REQ061).
 *
 * Covers the schema surface and the shared submission codec (no DB, no network):
 *   - the "form" slide type is interactive, and `formFields[]` is capped
 *   - what makes a field answerable at all (`isUsableFormField` / `formFieldsFor`)
 *   - the encode/decode pair — one participant's several typed answers as a
 *     single submission, with each field's type enforced at the boundary
 *   - the per-type value bound (`voteValueLimitFor`), and that a maximal form
 *     still fits inside what `VoteSchema` accepts
 *
 * The codec is tested here rather than through the API because it is the
 * contract *both* ends share: the participant surface writes the
 * submission and the aggregation, the export and the results table read it back.
 */

import { describe, expect, test } from "bun:test";
import {
	decodeFormSubmission,
	describeFormSubmission,
	encodeFormSubmission,
	FORM_ANSWER_MAX_LENGTH,
	FORM_FIELD_LIMIT,
	FORM_FIELD_OPTION_LIMIT,
	FORM_VALUE_MAX_LENGTH,
	type FormField,
	FormFieldSchema,
	formFieldsFor,
	INTERACTIVE_SLIDE_TYPES,
	isFormEmail,
	isInteractiveSlideType,
	isUsableFormField,
	readFormSubmission,
	SlideSchema,
	SlideTypeEnum,
	StoredPresentationSchema,
	VOTE_VALUE_MAX_LENGTH,
	VoteSchema,
	voteValueLimitFor,
} from "./schemas";

/**
 * The wire format's two separators, spelled out here rather than imported: they
 * are private to the codec, and a test that reached for the module's own
 * constant could not tell a changed format from an unchanged one.
 */
const FIELD_SEPARATOR = "\u001e";
const ANSWER_SEPARATOR = "\u001f";

/** A three-field signup form: a name, an address, and a track to pick. */
function formSlide(overrides: Record<string, unknown> = {}) {
	return SlideSchema.parse({
		id: "fm",
		type: "form",
		question: "Sign up for the workshop",
		formFields: [
			{ id: "name", label: "Your name" },
			{ id: "mail", label: "Email", type: "email", required: true },
			{
				id: "track",
				label: "Track",
				type: "choice",
				options: [
					{ id: "design", text: "Design" },
					{ id: "eng", text: "Engineering" },
				],
			},
		],
		...overrides,
	});
}

/** The fields of the slide above, as every read site sees them. */
function fieldsOf(overrides: Record<string, unknown> = {}): FormField[] {
	return formFieldsFor(formSlide(overrides));
}

describe("SlideTypeEnum — form (REQ061)", () => {
	test("form is a known slide type", () => {
		expect(SlideTypeEnum.safeParse("form").success).toBe(true);
	});

	test("form is interactive — participants submit to it", () => {
		expect(isInteractiveSlideType("form")).toBe(true);
		expect(INTERACTIVE_SLIDE_TYPES).toContain("form");
	});
});

describe("SlideSchema — form fields (REQ061)", () => {
	test("formFields defaults to an empty array on every other slide type", () => {
		const slide = SlideSchema.parse({
			id: "mc",
			type: "multiple-choice",
			question: "Pick",
			options: [{ id: "a", text: "A" }],
		});
		expect(slide.formFields).toEqual([]);
	});

	test("an authored field lands with every default applied", () => {
		const field = FormFieldSchema.parse({ id: "a", label: "Your name" });
		expect(field).toEqual({
			id: "a",
			label: "Your name",
			type: "text",
			required: false,
			options: [],
		});
	});

	test("rejects a field with no id and one with no label", () => {
		expect(FormFieldSchema.safeParse({ label: "No id" }).success).toBe(false);
		expect(FormFieldSchema.safeParse({ id: "a" }).success).toBe(false);
	});

	test("rejects an unknown field type", () => {
		expect(
			FormFieldSchema.safeParse({ id: "a", label: "Age", type: "number" })
				.success,
		).toBe(false);
	});

	test(`caps a slide at ${FORM_FIELD_LIMIT} fields`, () => {
		const build = (count: number) =>
			SlideSchema.safeParse({
				id: "fm",
				type: "form",
				question: "Sign up",
				formFields: Array.from({ length: count }, (_, index) => ({
					id: `f${index}`,
					label: `Field ${index}`,
				})),
			});
		expect(build(FORM_FIELD_LIMIT).success).toBe(true);
		expect(build(FORM_FIELD_LIMIT + 1).success).toBe(false);
	});

	test(`caps a choice field at ${FORM_FIELD_OPTION_LIMIT} options`, () => {
		const build = (count: number) =>
			FormFieldSchema.safeParse({
				id: "a",
				label: "Track",
				type: "choice",
				options: Array.from({ length: count }, (_, index) => ({
					id: `o${index}`,
					text: `Option ${index}`,
				})),
			});
		expect(build(FORM_FIELD_OPTION_LIMIT).success).toBe(true);
		expect(build(FORM_FIELD_OPTION_LIMIT + 1).success).toBe(false);
	});

	test("a stored deck round-trips a form slide", () => {
		const stored = StoredPresentationSchema.parse({
			id: "p1",
			slides: [formSlide()],
		});
		expect((stored.slides[0] as { formFields: FormField[] }).formFields).toHaveLength(
			3,
		);
	});
});

describe("isUsableFormField / formFieldsFor (REQ061)", () => {
	test("a labelled text field is usable", () => {
		expect(
			isUsableFormField(FormFieldSchema.parse({ id: "a", label: "Name" })),
		).toBe(true);
	});

	test("an unlabelled field asks nothing, so it is not a field", () => {
		expect(
			isUsableFormField(FormFieldSchema.parse({ id: "a", label: "   " })),
		).toBe(false);
	});

	test("a choice field with nothing to choose between is not a field", () => {
		expect(
			isUsableFormField(
				FormFieldSchema.parse({
					id: "a",
					label: "Track",
					type: "choice",
					options: [{ id: "o1", text: "  " }],
				}),
			),
		).toBe(false);
	});

	test("formFieldsFor drops the half-authored rows and keeps the rest", () => {
		const fields = fieldsOf({
			formFields: [
				{ id: "name", label: "Your name" },
				{ id: "blank", label: "" },
			],
		});
		expect(fields.map((field) => field.id)).toEqual(["name"]);
	});
});

describe("isFormEmail (REQ061)", () => {
	test("accepts ordinary addresses", () => {
		expect(isFormEmail("ada@example.org")).toBe(true);
		expect(isFormEmail("ada.lovelace+talks@mail.example.co.uk")).toBe(true);
		expect(isFormEmail("  ada@example.org  ")).toBe(true);
	});

	test("refuses what is plainly not an address", () => {
		expect(isFormEmail("Ada Lovelace")).toBe(false);
		expect(isFormEmail("ada@")).toBe(false);
		expect(isFormEmail("@example.org")).toBe(false);
		expect(isFormEmail("ada example.org")).toBe(false);
		// A dotless host is only reachable inside one machine, and a form exists
		// to collect a way to reach somebody from outside the room.
		expect(isFormEmail("ada@localhost")).toBe(false);
	});
});

describe("form submission codec (REQ061)", () => {
	test("a filled-in form round-trips through encode → decode", () => {
		const fields = fieldsOf();
		const value = encodeFormSubmission({
			name: "Ada Lovelace",
			mail: "ada@example.org",
			track: "design",
		});
		expect(decodeFormSubmission(value, fields)).toEqual({
			name: "Ada Lovelace",
			mail: "ada@example.org",
			track: "design",
		});
	});

	test("a field left blank decodes as an explicit empty string", () => {
		const fields = fieldsOf();
		const value = encodeFormSubmission({
			mail: "ada@example.org",
			track: "eng",
		});
		expect(decodeFormSubmission(value, fields)).toEqual({
			name: "",
			mail: "ada@example.org",
			track: "eng",
		});
	});

	test("decoding returns fields in authored order, so re-encoding is canonical", () => {
		const fields = fieldsOf();
		const scrambled = encodeFormSubmission({
			track: "eng",
			mail: "ada@example.org",
			name: "Ada",
		});
		const decoded = decodeFormSubmission(scrambled, fields);
		expect(Object.keys(decoded ?? {})).toEqual(["name", "mail", "track"]);
		expect(encodeFormSubmission(decoded ?? {})).toBe(
			encodeFormSubmission({
				name: "Ada",
				mail: "ada@example.org",
				track: "eng",
			}),
		);
	});

	test("answers are trimmed, and a whitespace-only answer is no answer", () => {
		const fields = fieldsOf();
		expect(
			decodeFormSubmission(
				encodeFormSubmission({ name: "  Ada  ", mail: "ada@example.org" }),
				fields,
			),
		).toEqual({ name: "Ada", mail: "ada@example.org", track: "" });
	});

	test("a required field left blank is refused", () => {
		const fields = fieldsOf();
		expect(
			decodeFormSubmission(encodeFormSubmission({ name: "Ada" }), fields),
		).toBeNull();
	});

	test("an email field refuses anything that is not an address", () => {
		const fields = fieldsOf();
		expect(
			decodeFormSubmission(
				encodeFormSubmission({ mail: "not-an-address" }),
				fields,
			),
		).toBeNull();
	});

	test("a choice field refuses an option it does not offer", () => {
		const fields = fieldsOf();
		expect(
			decodeFormSubmission(
				encodeFormSubmission({ mail: "ada@example.org", track: "sales" }),
				fields,
			),
		).toBeNull();
		// …including the option's *text*, which is never what is stored.
		expect(
			decodeFormSubmission(
				encodeFormSubmission({ mail: "ada@example.org", track: "Design" }),
				fields,
			),
		).toBeNull();
	});

	test("a field the slide does not have is refused", () => {
		const fields = fieldsOf();
		expect(
			decodeFormSubmission(
				encodeFormSubmission({ mail: "ada@example.org", phone: "555" }),
				fields,
			),
		).toBeNull();
	});

	test("the same field answered twice is refused", () => {
		const fields = fieldsOf();
		const twice = `${encodeFormSubmission({
			mail: "ada@example.org",
		})}${FIELD_SEPARATOR}mail${ANSWER_SEPARATOR}grace@example.org`;
		expect(decodeFormSubmission(twice, fields)).toBeNull();
	});

	test("an answer past the per-field cap is refused", () => {
		const fields = fieldsOf();
		const tooLong = "x".repeat(FORM_ANSWER_MAX_LENGTH + 1);
		expect(
			decodeFormSubmission(
				encodeFormSubmission({ name: tooLong, mail: "ada@example.org" }),
				fields,
			),
		).toBeNull();
		// Exactly at the cap still lands.
		expect(
			decodeFormSubmission(
				encodeFormSubmission({
					name: "x".repeat(FORM_ANSWER_MAX_LENGTH),
					mail: "ada@example.org",
				}),
				fields,
			),
		).not.toBeNull();
	});

	test("a form with nothing written in it is not a submission", () => {
		const fields = fieldsOf();
		expect(decodeFormSubmission("", fields)).toBeNull();
		expect(encodeFormSubmission({ name: "   " })).toBe("");
	});

	test("a slide with no usable field accepts nothing", () => {
		expect(
			decodeFormSubmission(encodeFormSubmission({ name: "Ada" }), []),
		).toBeNull();
	});

	test("a malformed entry — no separator, or an extra one — is refused", () => {
		const fields = fieldsOf();
		expect(decodeFormSubmission("name", fields)).toBeNull();
		expect(
			decodeFormSubmission(
				`name${ANSWER_SEPARATOR}Ada${ANSWER_SEPARATOR}extra`,
				fields,
			),
		).toBeNull();
	});

	test("an answer carrying a separator cannot smuggle a second field in", () => {
		// The wire format is separated by two characters no phone keyboard emits,
		// so an answer that contains one is the format being written rather than
		// filled in — and it reads as a malformed entry, not as two answers.
		const fields = fieldsOf();
		expect(
			decodeFormSubmission(
				`name${ANSWER_SEPARATOR}Ada${FIELD_SEPARATOR}mail${ANSWER_SEPARATOR}not-an-address`,
				fields,
			),
		).toBeNull();
	});
});

// ── Reading a stored row back, after the slide moved ─────────
//
// The boundary judges an incoming submission against the slide as it stands.
// A stored row is a record of what somebody wrote under the slide as it stood
// *then*, and re-judging it by today's rules is how one ordinary authoring edit
// erases a dataset that is already collected. These are the cases that made the
// two readers separate functions.

describe("readFormSubmission — a stored row survives re-authoring (REQ061)", () => {
	test("a row still reads back exactly as it was written", () => {
		const fields = fieldsOf();
		const value = encodeFormSubmission({
			name: "Ada Lovelace",
			mail: "ada@example.org",
			track: "design",
		});
		expect(readFormSubmission(value, fields)).toEqual({
			name: "Ada Lovelace",
			mail: "ada@example.org",
			track: "design",
		});
	});

	test("ticking Required on a field afterwards does not erase the rows that left it blank", () => {
		// Forty people answer with `Track` optional; the organizer then makes it
		// required. Their submissions were complete when they were made.
		const before = fieldsOf({
			formFields: [
				{ id: "name", label: "Your name" },
				{ id: "track", label: "Track", type: "choice", options: [
					{ id: "design", text: "Design" },
				] },
			],
		});
		const value = encodeFormSubmission({ name: "Ada Lovelace" });
		expect(decodeFormSubmission(value, before)).not.toBeNull();

		const after = fieldsOf({
			formFields: [
				{ id: "name", label: "Your name" },
				{ id: "track", label: "Track", type: "choice", required: true, options: [
					{ id: "design", text: "Design" },
				] },
			],
		});
		// The boundary rightly refuses a *new* submission that leaves it blank …
		expect(decodeFormSubmission(value, after)).toBeNull();
		// … and the stored row is still readable, in full.
		expect(readFormSubmission(value, after)).toEqual({
			name: "Ada Lovelace",
			track: "",
		});
	});

	test("deleting one field keeps every other answer in the same row", () => {
		// The variant that used to be total: every stored row named the deleted
		// field, so every stored row became unreadable at once.
		const value = encodeFormSubmission({
			name: "Ada Lovelace",
			mail: "ada@example.org",
			track: "design",
		});
		const after = fieldsOf({
			formFields: [
				{ id: "name", label: "Your name" },
				{ id: "mail", label: "Email", type: "email" },
			],
		});
		expect(readFormSubmission(value, after)).toEqual({
			name: "Ada Lovelace",
			mail: "ada@example.org",
		});
	});

	test("an answer today's field type would refuse is still what somebody wrote", () => {
		// A text field narrowed to an email one after collection. The names under
		// it are reported as written; a silent gap would tell the organizer
		// nothing about what happened.
		const value = encodeFormSubmission({ contact: "Ada Lovelace" });
		const after = fieldsOf({
			formFields: [{ id: "contact", label: "Contact", type: "email" }],
		});
		expect(decodeFormSubmission(value, after)).toBeNull();
		expect(readFormSubmission(value, after)).toEqual({
			contact: "Ada Lovelace",
		});
	});

	test("a row that was never a submission still reads as null", () => {
		const fields = fieldsOf();
		expect(readFormSubmission("name", fields)).toBeNull();
		expect(
			readFormSubmission(
				`name${ANSWER_SEPARATOR}Ada${ANSWER_SEPARATOR}extra`,
				fields,
			),
		).toBeNull();
		// The same field written twice is ambiguous, not lenient-readable.
		expect(
			readFormSubmission(
				`name${ANSWER_SEPARATOR}Ada${FIELD_SEPARATOR}name${ANSWER_SEPARATOR}Grace`,
				fields,
			),
		).toBeNull();
		expect(readFormSubmission("", fields)).toBeNull();
	});
});

describe("describeFormSubmission (REQ061)", () => {
	test("spells a choice answer as its option text, never as the stored id", () => {
		const fields = fieldsOf();
		expect(
			describeFormSubmission(fields, {
				name: "Ada",
				mail: "ada@example.org",
				track: "design",
			}),
		).toEqual([
			{ label: "Your name", answer: "Ada" },
			{ label: "Email", answer: "ada@example.org" },
			{ label: "Track", answer: "Design" },
		]);
	});

	test("leaves out the fields that were not answered", () => {
		const fields = fieldsOf();
		expect(
			describeFormSubmission(fields, {
				name: "",
				mail: "ada@example.org",
				track: "",
			}),
		).toEqual([{ label: "Email", answer: "ada@example.org" }]);
	});

	test("an option deleted since it was picked reads back as its id", () => {
		// The row is still the row somebody submitted, so it is reported rather
		// than dropped — with the only truthful thing left to say about it.
		const fields = fieldsOf();
		expect(describeFormSubmission(fields, { track: "gone" })).toEqual([
			{ label: "Track", answer: "gone" },
		]);
	});
});

describe("vote value bounds (REQ061)", () => {
	test("a form's bound is its own; every other type keeps 500", () => {
		expect(voteValueLimitFor("form")).toBe(FORM_VALUE_MAX_LENGTH);
		expect(voteValueLimitFor("word-cloud")).toBe(VOTE_VALUE_MAX_LENGTH);
		expect(voteValueLimitFor("quiz")).toBe(VOTE_VALUE_MAX_LENGTH);
	});

	test(`a full ${FORM_FIELD_LIMIT}-field form fits VoteSchema.value`, () => {
		// UUID ids and every field answered to the last character — the worst case
		// the editor can author. If this ever fails, `FORM_VALUE_MAX_LENGTH` and
		// the constants it is derived from have drifted apart.
		const answers: Record<string, string> = {};
		for (let index = 0; index < FORM_FIELD_LIMIT; index++) {
			answers[crypto.randomUUID()] = "x".repeat(FORM_ANSWER_MAX_LENGTH);
		}
		const value = encodeFormSubmission(answers);
		expect(value.length).toBeLessThanOrEqual(FORM_VALUE_MAX_LENGTH);
		expect(VoteSchema.safeParse({ slideId: "fm", value }).success).toBe(true);
	});
});
