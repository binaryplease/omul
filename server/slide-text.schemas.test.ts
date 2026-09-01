/**
 * Unit tests for a slide's authored text as the schema holds it (REQ088
 * hyperlinks, REQ089 markdown, REQ091 text size).
 *
 * The server's half of this slice is deliberately small — it stores the markup
 * and the size step and resolves neither — and these tests are about keeping it
 * that way:
 *
 *   - **The markup is stored, never interpreted.** `question` and `body` come
 *     back byte for byte, stars and brackets included. A boundary that trimmed,
 *     normalised or escaped them would be a second opinion about what the
 *     organizer wrote, and the client's parser would then be rendering a string
 *     nobody typed.
 *   - **The size step has one reading.** `slideTextSizeFor` is the single read
 *     site (ADR-0026): a slide with no step, a half-built one from the editor
 *     and a hand-built deck carrying nonsense all land on `medium`, which is the
 *     size every deck was drawn at before the setting existed.
 *
 * Pure: no store, no app.
 */

import { describe, expect, test } from "bun:test";
import {
	type Slide,
	SlideSchema,
	SlideTextSizeEnum,
	slideTextSizeFor,
} from "./schemas";

/** Parse a hand-written slide through the schema so defaults are filled in. */
function slide(fields: Record<string, unknown>): Slide {
	return SlideSchema.parse(fields);
}

const MARKDOWN_BODY = [
	"# Agenda",
	"",
	"- **Kick-off** at 09:00",
	"- Read [the handbook](https://example.com/handbook) first",
	"",
	"Questions? mail us at hello@example.com",
].join("\n");

describe("authored text is stored exactly as written (REQ088, REQ089)", () => {
	test("markdown in the body survives the schema untouched", () => {
		const parsed = slide({ id: "s1", type: "text", question: "Q", body: MARKDOWN_BODY });
		expect(parsed.body).toBe(MARKDOWN_BODY);
	});

	test("markdown in the question survives it too — every slide type has one", () => {
		const written = "**Q3** — see [the report](https://example.com/r)";
		expect(slide({ id: "s1", type: "quiz", question: written }).question).toBe(
			written,
		);
	});

	test("a body nobody wrote is an empty string, not a missing field", () => {
		// ADR-0029: every non-identity field carries a default, so a read site
		// never reaches for `??` to find out whether a slide has a body.
		expect(slide({ id: "s1", type: "multiple-choice", question: "Q" }).body).toBe(
			"",
		);
	});

	test("the markup is not escaped, quoted or trimmed on the way through", () => {
		// The one thing the boundary must not do is have an opinion: rendering is
		// the client's job, and a server that HTML-escaped a slide here would show
		// the room `&lt;` where its author typed `<`.
		const written = '  <b>not html</b> & "quoted" \\*escaped\\*  ';
		expect(slide({ id: "s1", type: "text", question: "Q", body: written }).body).toBe(
			written,
		);
	});
});

describe("slideTextSizeFor — one reading of the step (REQ091)", () => {
	test("a slide that never set a size is drawn at medium", () => {
		expect(slideTextSizeFor(slide({ id: "s1", type: "text", question: "Q" }))).toBe(
			"medium",
		);
		// The editor's half-built slide, before any default has been applied.
		expect(slideTextSizeFor({})).toBe("medium");
		expect(slideTextSizeFor({ textSize: undefined })).toBe("medium");
	});

	test("every step the schema defines reads back as itself", () => {
		for (const step of SlideTextSizeEnum.options) {
			expect(
				slideTextSizeFor(
					slide({ id: "s1", type: "text", question: "Q", textSize: step }),
				),
			).toBe(step);
		}
	});

	test("a step nobody defined falls back rather than reaching a surface", () => {
		// A hand-built deck can carry anything. It lands on the one size every
		// surface agrees on instead of on whatever each of them would have
		// guessed — which is how a projector and a phone come to disagree about
		// how big the same sentence is.
		expect(slideTextSizeFor({ textSize: "gigantic" as never })).toBe("medium");
		expect(slideTextSizeFor({ textSize: null as never })).toBe("medium");
		expect(slideTextSizeFor({ textSize: 42 as never })).toBe("medium");
	});

	test("the default is the size an untouched deck already had", () => {
		expect(SlideSchema.shape.textSize.parse(undefined)).toBe("medium");
	});
});

describe("the boundary refuses a size it cannot draw (REQ091)", () => {
	test("an undefined step is not accepted as a slide field", () => {
		// Loud at the boundary (ADR-0018's stance, applied to input): a deck
		// posted with a size no surface implements is a bug in the caller, and
		// silently storing it would defer the surprise to the projector.
		expect(() =>
			slide({ id: "s1", type: "text", question: "Q", textSize: "gigantic" }),
		).toThrow();
	});
});
