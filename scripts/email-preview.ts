/**
 * Local email-template preview server.
 *
 * Renders every transactional email (server/emails/) with representative sample
 * data and serves a small gallery so you can eyeball them in a real browser
 * without sending anything. It renders the *same* React Email components the
 * sender uses, so the preview is faithful to what lands in an inbox.
 *
 *   bun run scripts/email-preview.ts    # → http://localhost:3999
 *   EMAIL_PREVIEW_PORT=4000 bun run scripts/email-preview.ts
 *
 * This is a dev-only tool; it is never bundled into the production server.
 */

import { render } from "@react-email/render";
import { emailPreviews } from "../server/emails/index";

const port = Number(process.env.EMAIL_PREVIEW_PORT ?? 3999);

// Mirror the app's light-mode tokens so the gallery chrome reads as the same
// product as the emails it previews — Ground / Card / Hairline / Text / Muted /
// Accent / Wash from `src/index.css`'s `:root.light` block (REQ166).
const palette = {
	background: "#fafafa",
	panel: "#ffffff",
	border: "#e7e7ea",
	text: "#09090b",
	muted: "#4e4e57",
	accent: "#1f3bff",
	wash: "#eceaff",
};

/** Escape a value for safe interpolation into the gallery chrome's HTML. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** The gallery chrome: a sidebar of templates + the selected email in a frame. */
function galleryPage(selectedId: string, device: "desktop" | "mobile"): string {
	const selected =
		emailPreviews.find((preview) => preview.id === selectedId) ??
		emailPreviews[0];

	const sidebarItems = emailPreviews
		.map((preview) => {
			const isActive = preview.id === selected.id;
			return `<a
        href="/?id=${encodeURIComponent(preview.id)}&device=${device}"
        style="
          display:block;padding:12px 14px;border-radius:10px;text-decoration:none;
          margin-bottom:6px;border:1px solid ${isActive ? palette.accent : "transparent"};
          background:${isActive ? palette.wash : "transparent"};
          color:${isActive ? palette.text : palette.muted};
        ">
        <div style="font-size:14px;font-weight:600;color:${isActive ? palette.text : palette.muted};">${escapeHtml(preview.label)}</div>
        <div style="font-size:12px;color:${palette.muted};margin-top:2px;">${escapeHtml(preview.subject)}</div>
      </a>`;
		})
		.join("\n");

	const deviceToggle = (["desktop", "mobile"] as const)
		.map((mode) => {
			const isActive = mode === device;
			return `<a
        href="/?id=${encodeURIComponent(selected.id)}&device=${mode}"
        style="
          padding:6px 14px;border-radius:8px;text-decoration:none;font-size:13px;
          border:1px solid ${palette.border};
          background:${isActive ? palette.accent : "transparent"};
          color:${isActive ? palette.background : palette.muted};font-weight:600;
        ">${mode === "desktop" ? "Desktop" : "Mobile"}</a>`;
		})
		.join("\n");

	const frameWidth = device === "mobile" ? "400px" : "100%";

	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>omul email previews</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        background: ${palette.background}; color: ${palette.text}; height: 100vh;
        display: grid; grid-template-columns: 300px 1fr;
      }
      aside {
        border-right: 1px solid ${palette.border}; padding: 20px; overflow-y: auto;
      }
      main { display: flex; flex-direction: column; min-width: 0; }
      header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 16px 20px; border-bottom: 1px solid ${palette.border};
      }
      .frame-wrap { flex: 1; padding: 24px; overflow: auto; display: flex; justify-content: center; }
      iframe {
        width: ${frameWidth}; height: 100%; border: 1px solid ${palette.border};
        border-radius: 12px; background: #fff; transition: width 0.15s ease;
      }
      a.source {
        font-size: 13px; color: ${palette.accent}; text-decoration: none;
        border: 1px solid ${palette.border}; padding: 6px 12px; border-radius: 8px;
      }
    </style>
  </head>
  <body>
    <aside>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px;">omul emails</div>
      <div style="font-size:12px;color:${palette.muted};margin-bottom:18px;">Transactional template previews</div>
      ${sidebarItems}
    </aside>
    <main>
      <header>
        <div>
          <div style="font-size:15px;font-weight:600;">${escapeHtml(selected.label)}</div>
          <div style="font-size:12px;color:${palette.muted};">Subject: ${escapeHtml(selected.subject)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${deviceToggle}
          <a class="source" href="/render/${encodeURIComponent(selected.id)}" target="_blank" rel="noreferrer">Open raw</a>
        </div>
      </header>
      <div class="frame-wrap">
        <iframe title="${escapeHtml(selected.label)} preview" src="/render/${encodeURIComponent(selected.id)}"></iframe>
      </div>
    </main>
  </body>
</html>`;
}

const server = Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);

		// The rendered email itself, loaded into the gallery iframe (and openable
		// raw). This is the exact HTML the sender produces.
		if (url.pathname.startsWith("/render/")) {
			const id = decodeURIComponent(url.pathname.slice("/render/".length));
			const preview = emailPreviews.find((entry) => entry.id === id);
			if (!preview) return new Response("Unknown template", { status: 404 });
			// Render compact (not pretty) so the preview is byte-for-byte what the
			// sender produces.
			const html = await render(preview.element);
			return new Response(html, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		if (url.pathname === "/") {
			const id = url.searchParams.get("id") ?? emailPreviews[0].id;
			const device =
				url.searchParams.get("device") === "mobile" ? "mobile" : "desktop";
			return new Response(galleryPage(id, device), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log(
	`[email-preview] serving ${emailPreviews.length} templates at http://localhost:${server.port}`,
);
