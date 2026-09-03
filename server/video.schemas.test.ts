/**
 * Unit tests for the video slide as the schema holds it (REQ064).
 *
 * The server's half of this slice is one decision, and these tests are about
 * that decision being the *only* one:
 *
 *   - **How a URL is played is resolved once.** `slideVideoFor` is the single
 *     read site the editor, the preview pane, the shared screen and
 *     the phones all ask. A link to a video platform is a page rather than a
 *     file — a `<video>` element pointed at a YouTube watch URL plays nothing —
 *     so the platform's own player is what a share link resolves to, and only a
 *     URL that really is a file gets the browser's media element.
 *   - **The refusal is part of the answer.** An `<iframe src>` is a navigation,
 *     so a `javascript:` or `data:` URL in one executes in the page. The scheme
 *     is checked here, at the read site, rather than trusted at four render
 *     sites — and a URL that cannot be played comes back as `null` rather than
 *     as a repaired guess, so the organizer is told instead of the room being
 *     shown something nobody authored.
 *   - **Nothing is hosted.** There is no upload path, no stored file and no
 *     proxy: the resolver hands back a URL and the browser fetches it from
 *     wherever the video already lives. That is REQ064's own wording, and the
 *     shape of these tests is what keeps it true.
 *
 * Pure: no store, no app.
 */

import { describe, expect, test } from "bun:test";
import {
	CONTENT_SLIDE_TYPES,
	isContentSlideType,
	isInteractiveSlideType,
	type Slide,
	SlideSchema,
	type SlideType,
	SlideTypeEnum,
	type SlideVideo,
	slideHasResults,
	slideVideoFor,
} from "./schemas";

/** Parse a hand-written slide through the schema so defaults are filled in. */
function videoSlide(mediaUrl: string): Slide {
	return SlideSchema.parse({ id: "vd", type: "video", question: "", mediaUrl });
}

describe("the video slide type (REQ064)", () => {
	test("the schema accepts it, and it collects nothing", () => {
		expect(SlideTypeEnum.safeParse("video").success).toBe(true);
		expect(isInteractiveSlideType("video")).toBe(false);
		expect(slideHasResults("video")).toBe(false);
	});

	test("it is a content slide, beside the others", () => {
		// Membership rather than the whole list: what this suite is about is that a
		// video slide shows something instead of asking something. The full content
		// family is pinned once, next door in embed.schemas.test.ts, so a content
		// type added later widens one assertion rather than every neighbour's.
		expect(isContentSlideType("video")).toBe(true);
		expect(CONTENT_SLIDE_TYPES).toContain("video" as SlideType);
	});

	test("a leaderboard asks nothing and is still not content", () => {
		// The set is listed rather than derived as "not interactive" for exactly
		// this slide: it takes no votes and draws a server-derived aggregate, which
		// is the one thing a content slide never does.
		expect(isContentSlideType("leaderboard")).toBe(false);
		expect(isInteractiveSlideType("leaderboard")).toBe(false);
	});

	test("the URL is stored exactly as it was typed", () => {
		// The resolver decides how to *play* a URL; it never rewrites what the deck
		// holds. An organizer who reopens the editor sees what they pasted.
		const authored = "https://vimeo.com/76979871";
		expect(videoSlide(authored).mediaUrl).toBe(authored);
	});
});

describe("slideVideoFor — which player a URL opens", () => {
	test("a slide with no URL yet resolves to nothing", () => {
		expect(slideVideoFor(videoSlide(""))).toBeNull();
		expect(slideVideoFor(videoSlide("   "))).toBeNull();
		// A half-built slide from the editor has no field at all, and is the same
		// absence rather than a crash.
		expect(slideVideoFor({})).toBeNull();
	});

	test("surrounding whitespace is not part of the URL", () => {
		expect(slideVideoFor(videoSlide("  https://example.com/clip.mp4 "))).toEqual(
			{ kind: "file", url: "https://example.com/clip.mp4" },
		);
	});

	// ── Platform links become the platform's player ────────────

	test("every shape of a YouTube share link resolves to one embed", () => {
		const embed: SlideVideo = {
			kind: "embed",
			url: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
		};
		for (const authored of [
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
			"https://m.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://youtu.be/dQw4w9WgXcQ",
			"https://www.youtube.com/shorts/dQw4w9WgXcQ",
			"https://www.youtube.com/live/dQw4w9WgXcQ",
			"https://www.youtube.com/embed/dQw4w9WgXcQ",
		]) {
			expect(slideVideoFor(videoSlide(authored))).toEqual(embed);
		}
	});

	test("YouTube is embedded through the no-cookie host", () => {
		// The audience did not choose to visit a video platform — they walked into
		// a room — so the deck asks for the player that plants nothing on their
		// phone before they have pressed anything.
		const video = slideVideoFor(
			videoSlide("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
		);
		expect(video?.url.startsWith("https://www.youtube-nocookie.com/")).toBe(
			true,
		);
	});

	test("a YouTube URL that names no video is not an embed", () => {
		// The channel page, the search results and the bare host are pages, not
		// videos. They fall through to the file branch rather than resolving to a
		// player pointed at nothing.
		for (const authored of [
			"https://www.youtube.com/",
			"https://www.youtube.com/@someone",
			"https://www.youtube.com/results?search_query=cats",
		]) {
			expect(slideVideoFor(videoSlide(authored))?.kind).toBe("file");
		}
	});

	test("a Vimeo link resolves to its player", () => {
		expect(slideVideoFor(videoSlide("https://vimeo.com/76979871"))).toEqual({
			kind: "embed",
			url: "https://player.vimeo.com/video/76979871",
		});
		expect(
			slideVideoFor(videoSlide("https://vimeo.com/channels/staffpicks/76979871")),
		).toEqual({ kind: "embed", url: "https://player.vimeo.com/video/76979871" });
	});

	test("an unlisted Vimeo link keeps the hash its player needs", () => {
		// Dropping it would turn a playable URL into a private-video notice in
		// front of a room.
		expect(
			slideVideoFor(videoSlide("https://vimeo.com/76979871/abc123def4")),
		).toEqual({
			kind: "embed",
			url: "https://player.vimeo.com/video/76979871?h=abc123def4",
		});
	});

	test("an already-embeddable Vimeo player URL is passed through", () => {
		expect(
			slideVideoFor(videoSlide("https://player.vimeo.com/video/76979871")),
		).toEqual({
			kind: "embed",
			url: "https://player.vimeo.com/video/76979871",
		});
	});

	// ── Everything else is a file the browser plays ────────────

	test("a direct file URL is played by the browser itself", () => {
		for (const authored of [
			"https://example.com/talks/keynote.mp4",
			"https://cdn.example.org/a/b/clip.webm?token=xyz",
			"http://example.com/legacy.ogv",
		]) {
			expect(slideVideoFor(videoSlide(authored))).toEqual({
				kind: "file",
				url: authored,
			});
		}
	});

	test("the extension is never inspected", () => {
		// What is playable is the browser's answer to give, the same stance REQ052
		// takes on a pin slide's image: an allowlist here would refuse videos that
		// work while still admitting URLs that are not videos at all.
		expect(slideVideoFor(videoSlide("https://example.com/stream"))).toEqual({
			kind: "file",
			url: "https://example.com/stream",
		});
	});

	test("a root-relative path is a file this deployment already serves", () => {
		expect(slideVideoFor(videoSlide("/media/intro.mp4"))).toEqual({
			kind: "file",
			url: "/media/intro.mp4",
		});
	});

	// ── What no player may be pointed at ───────────────────────

	test("a scripting URL is refused rather than played", () => {
		// The one that matters: this string in an `<iframe src>` executes in the
		// page, while the same string in an `<img src>` merely fails to load. The
		// video slide is the surface that frames a URL, so it is the surface that
		// has to say no.
		for (const authored of [
			"javascript:alert(1)",
			"JavaScript:alert(1)",
			"  javascript:alert(1)  ",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox(1)",
		]) {
			expect(slideVideoFor(videoSlide(authored))).toBeNull();
		}
	});

	test("a file:// URL is refused — the room's browser is not our filesystem", () => {
		expect(slideVideoFor(videoSlide("file:///etc/passwd"))).toBeNull();
	});

	test("a protocol-relative URL is refused", () => {
		// `//host/clip.mp4` names no scheme, so there is nothing here to check —
		// and a URL whose scheme is decided by whatever page it lands on is not one
		// a player is pointed at.
		expect(slideVideoFor(videoSlide("//example.com/clip.mp4"))).toBeNull();
	});

	test("a string that is not a URL at all is refused", () => {
		for (const authored of ["not a url", "example.com/clip.mp4", "???"]) {
			expect(slideVideoFor(videoSlide(authored))).toBeNull();
		}
	});

	test("a refused URL is never repaired into a working one", () => {
		// Silently rewriting it would mean the deck plays something nobody
		// authored. The slide keeps the string; the resolver just declines it.
		const slide = videoSlide("javascript:alert(1)");
		expect(slideVideoFor(slide)).toBeNull();
		expect(slide.mediaUrl).toBe("javascript:alert(1)");
	});
});
