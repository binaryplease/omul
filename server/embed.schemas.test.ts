/**
 * Unit tests for the embed slide as the schema holds it (REQ066, REQ067,
 * REQ068).
 *
 * The server's half of this slice is one decision, and these tests are about
 * that decision being the *only* one:
 *
 *   - **Whose viewer a link opens is resolved once.** `slideEmbedFor` is the
 *     single read site the editor, the preview pane, the shared
 *     screen and the phones all ask. A share link is a page for a human — an
 *     `<iframe>` pointed at a Google Slides `/edit` URL frames an editor rather
 *     than a deck — so each provider's link is normalised to that provider's own
 *     embed entry point.
 *   - **The allowlist is the security boundary.** An `<iframe src>` is a
 *     navigation into our frame tree, so a link that is not one of the three
 *     providers resolves to `null` rather than being framed on a guess. That is
 *     stricter than the video slide next door, and deliberately so: an
 *     unrecognised page in a frame is arbitrary third-party script running
 *     beside the deck, while an unrecognised video URL is a file a `<video>`
 *     element plays with no scripting of its own.
 *   - **Nothing is hosted or converted.** There is no upload path, no stored
 *     copy and no proxy: the resolver hands back the provider's URL and the
 *     browser fetches the deck or board from where it already lives. Turning a
 *     *file* into slides is a different requirement and is not this one.
 *
 * Pure: no store, no app.
 */

import { describe, expect, test } from "bun:test";
import {
	CONTENT_SLIDE_TYPES,
	EMBED_PROVIDERS,
	EmbedProviderEnum,
	isContentSlideType,
	isInteractiveSlideType,
	type Slide,
	SlideSchema,
	type SlideType,
	SlideTypeEnum,
	slideEmbedFor,
	slideHasResults,
} from "./schemas";

/** Parse a hand-written slide through the schema so defaults are filled in. */
function embedSlide(mediaUrl: string): Slide {
	return SlideSchema.parse({ id: "em", type: "embed", question: "", mediaUrl });
}

const GOOGLE_ID = "1FvIH-DcTLBoP2Zk9OaMHV3sJ4mQr7yXaBcDeFgHiJkL";
const PUBLISHED_ID = "2PACX-1vQx8tPzL9mNbVcXsAdFgHjKlOpQrStUvWxYz";
const MIRO_BOARD = "uXjVNQOLDDk=";

describe("the embed slide type (REQ066, REQ067, REQ068)", () => {
	test("the schema accepts it, and it collects nothing", () => {
		expect(SlideTypeEnum.safeParse("embed").success).toBe(true);
		expect(isInteractiveSlideType("embed")).toBe(false);
		expect(slideHasResults("embed")).toBe(false);
	});

	test("it is a content slide, beside the other four", () => {
		// A Miro board is worked in rather than read (REQ068) and is still content:
		// nothing the room does to it comes back here as an answer, so there is no
		// aggregate to draw — which is the test this set is listed by.
		expect(isContentSlideType("embed")).toBe(true);
		expect([...CONTENT_SLIDE_TYPES].sort()).toEqual(
			(
				["embed", "image", "instruction", "text", "video"] as SlideType[]
			).sort(),
		);
	});

	test("the URL is stored exactly as it was typed", () => {
		// The resolver decides which viewer to *open*; it never rewrites what the
		// deck holds. An organizer who reopens the editor sees what they pasted.
		const authored = `https://docs.google.com/presentation/d/${GOOGLE_ID}/edit#slide=id.p3`;
		expect(embedSlide(authored).mediaUrl).toBe(authored);
	});

	test("every provider in the enum is described exactly once", () => {
		// The descriptor is what the editor's note, the rail's gist and the frame's
		// own capabilities all read, so a provider added to the enum and
		// not to the descriptor is a surface with nothing to say about it.
		expect(Object.keys(EMBED_PROVIDERS).sort()).toEqual(
			[...EmbedProviderEnum.options].sort(),
		);
		// A board is worked in; a deck is read. That difference is a property of
		// what is embedded, not of the surface drawing it.
		expect(EMBED_PROVIDERS.miro.interactive).toBe(true);
		expect(EMBED_PROVIDERS.powerpoint.interactive).toBe(false);
		expect(EMBED_PROVIDERS["google-slides"].interactive).toBe(false);
	});
});

describe("slideEmbedFor — Google Slides (REQ067)", () => {
	test("a shared deck resolves to its embed URL, whatever the link's tail says", () => {
		for (const tail of ["edit", "edit?usp=sharing", "preview", "htmlpresent"]) {
			expect(
				slideEmbedFor(
					embedSlide(
						`https://docs.google.com/presentation/d/${GOOGLE_ID}/${tail}`,
					),
				),
			).toEqual({
				provider: "google-slides",
				url: `https://docs.google.com/presentation/d/${GOOGLE_ID}/embed`,
			});
		}
	});

	test("the `/edit` tail never survives — a room is not shown an editor", () => {
		const embed = slideEmbedFor(
			embedSlide(
				`https://docs.google.com/presentation/d/${GOOGLE_ID}/edit#slide=id.g1`,
			),
		);
		expect(embed?.url.endsWith("/embed")).toBe(true);
		expect(embed?.url).not.toContain("edit");
	});

	test("a published deck keeps the different id it is published under", () => {
		// `/d/e/<id>` is not `/d/<id>` with an extra segment — it is a different
		// identifier, and reading it as the former would frame somebody else's deck
		// or nothing at all.
		expect(
			slideEmbedFor(
				embedSlide(
					`https://docs.google.com/presentation/d/e/${PUBLISHED_ID}/pub?start=true&loop=true&delayms=3000`,
				),
			),
		).toEqual({
			provider: "google-slides",
			url: `https://docs.google.com/presentation/d/e/${PUBLISHED_ID}/embed`,
		});
	});

	test("a publish link's autoplay parameters are dropped", () => {
		// `start`/`loop`/`delayms` would hand the deck an autoplay nobody asked this
		// slide for — the same stance the video slide takes on not starting itself.
		const embed = slideEmbedFor(
			embedSlide(
				`https://docs.google.com/presentation/d/e/${PUBLISHED_ID}/pub?start=true&loop=true&delayms=3000`,
			),
		);
		expect(embed?.url).not.toContain("start");
		expect(embed?.url).not.toContain("loop");
		expect(embed?.url).not.toContain("delayms");
	});

	test("an already-embeddable Google URL is passed through as itself", () => {
		expect(
			slideEmbedFor(
				embedSlide(`https://docs.google.com/presentation/d/${GOOGLE_ID}/embed`),
			),
		).toEqual({
			provider: "google-slides",
			url: `https://docs.google.com/presentation/d/${GOOGLE_ID}/embed`,
		});
	});

	test("a Google URL that is not a presentation is not an embed", () => {
		// A document, a spreadsheet and the bare host are not decks. They fall out
		// of the allowlist rather than being framed as one.
		for (const authored of [
			"https://docs.google.com/",
			`https://docs.google.com/document/d/${GOOGLE_ID}/edit`,
			`https://docs.google.com/spreadsheets/d/${GOOGLE_ID}/edit`,
			"https://docs.google.com/presentation/",
			"https://docs.google.com/presentation/d/",
			"https://docs.google.com/presentation/d/short/edit",
		]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});

	test("a look-alike host is not Google", () => {
		for (const authored of [
			`https://docs.google.com.evil.example/presentation/d/${GOOGLE_ID}/edit`,
			`https://evil.example/docs.google.com/presentation/d/${GOOGLE_ID}/edit`,
		]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});
});

describe("slideEmbedFor — PowerPoint (REQ066)", () => {
	test("a PowerPoint file on any web host is handed to Microsoft's viewer", () => {
		// This is what REQ066 is about: a deck the organizer already has, hosted
		// wherever it already lives, paged through in the browser's frame.
		const file = "https://example.com/talks/keynote.pptx";
		expect(slideEmbedFor(embedSlide(file))).toEqual({
			provider: "powerpoint",
			url: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file)}`,
		});
	});

	test("every extension a deck is published under is recognised", () => {
		for (const extension of ["ppt", "pptx", "pps", "ppsx", "pot", "potx"]) {
			const embed = slideEmbedFor(
				embedSlide(`https://example.com/deck.${extension}`),
			);
			expect(embed?.provider).toBe("powerpoint");
		}
	});

	test("the file's own query survives being handed to the viewer", () => {
		// A signed or tokenised download URL is only fetchable *with* its query, so
		// encoding it away would hand the viewer a file it cannot open.
		const file = "https://cdn.example.org/d/keynote.pptx?token=xyz&v=2";
		const embed = slideEmbedFor(embedSlide(file));
		expect(embed?.url).toBe(
			`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file)}`,
		);
		expect(decodeURIComponent(embed?.url.split("src=")[1] ?? "")).toBe(file);
	});

	test("the full-page Office viewer becomes the framed one", () => {
		const file = "https://example.com/keynote.pptx";
		expect(
			slideEmbedFor(
				embedSlide(
					`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(file)}`,
				),
			),
		).toEqual({
			provider: "powerpoint",
			url: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file)}`,
		});
	});

	test("a viewer URL pointed at nothing usable is refused", () => {
		// The `src` is re-read rather than trusted: a viewer with no file, or one
		// naming something that is not a fetchable URL, frames an error page rather
		// than the organizer's deck.
		for (const authored of [
			"https://view.officeapps.live.com/op/embed.aspx",
			"https://view.officeapps.live.com/op/embed.aspx?src=",
			"https://view.officeapps.live.com/op/embed.aspx?src=not%20a%20url",
			"https://view.officeapps.live.com/op/embed.aspx?src=javascript%3Aalert(1)",
		]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});

	test("a OneDrive share link becomes OneDrive's own reader", () => {
		const embed = slideEmbedFor(
			embedSlide(
				"https://onedrive.live.com/view.aspx?cid=ABC123&resid=ABC123%21107&authkey=AKey",
			),
		);
		expect(embed?.provider).toBe("powerpoint");
		const url = new URL(embed?.url ?? "");
		expect(url.origin + url.pathname).toBe("https://onedrive.live.com/embed");
		// The sharing parameters are what make the file reachable at all, so they
		// are carried over rather than rebuilt.
		expect(url.searchParams.get("cid")).toBe("ABC123");
		expect(url.searchParams.get("resid")).toBe("ABC123!107");
		expect(url.searchParams.get("authkey")).toBe("AKey");
		expect(url.searchParams.get("em")).toBe("2");
	});

	test("a SharePoint presentation link asks for the embed view", () => {
		const embed = slideEmbedFor(
			embedSlide(
				"https://contoso.sharepoint.com/:p:/g/personal/someone_contoso_com/EaBcDeFg?e=4%3Axyz#page=2",
			),
		);
		expect(embed?.provider).toBe("powerpoint");
		const url = new URL(embed?.url ?? "");
		expect(url.searchParams.get("action")).toBe("embedview");
		expect(url.searchParams.get("e")).toBe("4:xyz");
		// The fragment addresses a place in SharePoint's own UI, which is not the
		// UI the room is about to be shown.
		expect(url.hash).toBe("");
	});

	test("a SharePoint link that is not a presentation is not one", () => {
		for (const authored of [
			"https://contoso.sharepoint.com/:w:/g/personal/someone/EaBcDeFg",
			"https://contoso.sharepoint.com/sites/marketing",
		]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});

	test("a SharePoint look-alike host is not SharePoint", () => {
		expect(
			slideEmbedFor(
				embedSlide("https://sharepoint.com.evil.example/:p:/g/personal/x/y"),
			),
		).toBeNull();
	});
});

describe("slideEmbedFor — Miro (REQ068)", () => {
	test("a board link resolves to the live embed the room can work in", () => {
		// REQ068 asks for a board participants interact with, so nothing here asks
		// for the view-only frame.
		const embed = slideEmbedFor(
			embedSlide(`https://miro.com/app/board/${MIRO_BOARD}/`),
		);
		expect(embed).toEqual({
			provider: "miro",
			url: `https://miro.com/app/live-embed/${MIRO_BOARD}/`,
		});
		expect(embed?.url).not.toContain("view_only");
	});

	test("a board link keeps the share-link id it was reached through", () => {
		// A board shared by link is only reachable *with* that link's id — the same
		// reason an unlisted Vimeo link keeps its hash. Dropping it would frame a
		// board the room is not allowed to open.
		const embed = slideEmbedFor(
			embedSlide(
				`https://miro.com/app/board/${MIRO_BOARD}/?share_link_id=123456789012`,
			),
		);
		const url = new URL(embed?.url ?? "");
		expect(url.pathname).toBe(`/app/live-embed/${MIRO_BOARD}/`);
		expect(url.searchParams.get("share_link_id")).toBe("123456789012");
	});

	test("an already-embeddable Miro URL resolves to the same frame", () => {
		expect(
			slideEmbedFor(
				embedSlide(
					`https://miro.com/app/live-embed/${MIRO_BOARD}/?moveToViewport=1%2C2%2C3%2C4`,
				),
			),
		).toEqual({
			provider: "miro",
			url: `https://miro.com/app/live-embed/${MIRO_BOARD}/`,
		});
	});

	test("a Miro URL that names no board is not an embed", () => {
		for (const authored of [
			"https://miro.com/",
			"https://miro.com/app/",
			"https://miro.com/app/dashboard/",
			"https://miro.com/app/board/",
			"https://miro.com/templates/brainstorming/",
		]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});
});

describe("slideEmbedFor — what is not framed at all", () => {
	test("a slide with no URL yet resolves to nothing", () => {
		expect(slideEmbedFor(embedSlide(""))).toBeNull();
		expect(slideEmbedFor(embedSlide("   "))).toBeNull();
		// A half-built slide from the editor has no field at all, and is the same
		// absence rather than a crash.
		expect(slideEmbedFor({})).toBeNull();
	});

	test("surrounding whitespace is not part of the URL", () => {
		expect(
			slideEmbedFor(embedSlide(`  https://miro.com/app/board/${MIRO_BOARD}/ `)),
		).toEqual({
			provider: "miro",
			url: `https://miro.com/app/live-embed/${MIRO_BOARD}/`,
		});
	});

	test("an ordinary web page is refused rather than framed", () => {
		// The whole difference between this slide and the video slide next door: a
		// link naming no known provider is nothing, not a frame around whatever the
		// author pasted.
		for (const authored of [
			"https://example.com/",
			"https://example.com/deck.html",
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://example.com/slides/deck.pdf",
		]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});

	test("a scripting URL is refused rather than framed", () => {
		// The one that matters: this string in an `<iframe src>` executes in the
		// page. The scheme is checked here, at the single read site, rather than
		// trusted at the render sites.
		for (const authored of [
			"javascript:alert(1)",
			"JavaScript:alert(1)",
			"  javascript:alert(1)  ",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox(1)",
			"file:///etc/passwd",
		]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});

	test("http is refused — every provider here serves https", () => {
		// A deck shown to a room should not be fetched over a connection anybody on
		// its wifi can rewrite, and no provider in the allowlist needs it.
		for (const authored of [
			`http://docs.google.com/presentation/d/${GOOGLE_ID}/edit`,
			`http://miro.com/app/board/${MIRO_BOARD}/`,
			"http://example.com/keynote.pptx",
		]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});

	test("a protocol-relative or root-relative URL is refused", () => {
		// Neither names a scheme, and the material is externally hosted by
		// definition — there is nothing of this deployment's to frame.
		expect(slideEmbedFor(embedSlide("//miro.com/app/board/abc/"))).toBeNull();
		expect(slideEmbedFor(embedSlide("/decks/keynote.pptx"))).toBeNull();
	});

	test("a string that is not a URL at all is refused", () => {
		for (const authored of ["not a url", "docs.google.com/presentation", "???"]) {
			expect(slideEmbedFor(embedSlide(authored))).toBeNull();
		}
	});

	test("a refused URL is never repaired into a working one", () => {
		// Silently rewriting it would mean the deck frames something nobody
		// authored. The slide keeps the string; the resolver just declines it.
		const slide = embedSlide("javascript:alert(1)");
		expect(slideEmbedFor(slide)).toBeNull();
		expect(slide.mediaUrl).toBe("javascript:alert(1)");
	});
});
