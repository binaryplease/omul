/**
 * The client's side of the operator's sign-up switch (REQ251): what
 * `GET /api/instance-access` is read into, and the sign-in dialog's
 * "Create account" tab, disabled with its reason while sign-up is closed.
 *
 * This repo renders no DOM in tests, so the tab is held by reading
 * `src/auth.tsx` for the props it passes, and by rendering the shared
 * `ReasonButton` with those props to static markup — which is what decides
 * whether the reason reaches a keyboard, a touch screen and a screen reader.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api } from "./api";
import { ReasonButton } from "./components/ui/ReasonTip";
import { OPEN_INSTANCE_ACCESS } from "./instance-access";
import { interfaceTextFor } from "./interface-text";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Answer every request with `status` and `body`, recording each URL. */
function answerWith(status: number, body: unknown): string[] {
	const urls: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		urls.push(String(input));
		return new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
	return urls;
}

describe("reading GET /api/instance-access", () => {
	test("an instance that set nothing is drawn open", () => {
		expect(OPEN_INSTANCE_ACCESS).toEqual({
			signUpOpen: true,
			guestCreationOpen: true,
		});
	});

	test("a closed sign-up is read as signUpOpen: false", async () => {
		const urls = answerWith(200, { signUpOpen: false, guestCreationOpen: true });
		expect(await api.getInstanceAccess()).toEqual({
			signUpOpen: false,
			guestCreationOpen: true,
		});
		expect(urls).toEqual(["/api/instance-access"]);
	});

	test("a field the answer lacks takes the schema's default", async () => {
		answerWith(200, { signUpOpen: false });
		expect(await api.getInstanceAccess()).toEqual({
			signUpOpen: false,
			guestCreationOpen: true,
		});
	});
});

describe("the sign-in dialog's Create account tab (REQ251)", () => {
	const auth = readFileSync(join(import.meta.dir, "auth.tsx"), "utf8");
	const form = auth.split("function AuthForm(")[1]?.split("\nfunction ")[0] ?? "";

	test("the tab is a ReasonButton whose reason is the closed sign-up", () => {
		const tab = form.slice(
			form.indexOf("<ReasonButton"),
			form.indexOf("</ReasonButton>"),
		);
		expect(tab).toContain("label={words.createAccount}");
		expect(tab).toContain("reason={signUpOpen ? null : words.signUpClosed}");
		expect(tab).toContain('onClick={() => setMode("signup")}');
		expect(form).toContain("const { signUpOpen } = useInstanceAccess();");
	});

	test("the form leaves the sign-up tab once sign-up is reported closed", () => {
		expect(form).toContain(
			'if (!signUpOpen && mode === "signup") setMode("signin");',
		);
	});

	test("closed, the tab stays visible, aria-disabled and described by its reason", () => {
		const words = interfaceTextFor("en").account;
		const markup = renderToStaticMarkup(
			createElement(
				ReasonButton,
				{
					label: words.createAccount,
					reason: words.signUpClosed,
					className: "tab",
					onClick: () => {},
					children: words.createAccount,
				},
			),
		);
		expect(markup).toContain('aria-disabled="true"');
		expect(markup).toContain(">Create account</button>");
		// No `disabled` attribute: the tab stays in the tab order.
		expect(markup).not.toMatch(/<button[^>]*\sdisabled[\s=>]/);
		const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];
		expect(describedBy).toBeDefined();
		expect(markup).toContain(`id="${describedBy}" role="tooltip"`);
		expect(markup).toContain(
			"Sign-ups are closed on this instance. Ask its operator for an account.",
		);
	});

	test("open, the tab is an ordinary button with no reason", () => {
		const words = interfaceTextFor("en").account;
		const markup = renderToStaticMarkup(
			createElement(
				ReasonButton,
				{
					label: words.createAccount,
					reason: null,
					className: "tab",
					onClick: () => {},
					children: words.createAccount,
				},
			),
		);
		expect(markup).toContain('aria-disabled="false"');
		expect(markup).not.toContain("aria-describedby");
		expect(markup).not.toContain("role=\"tooltip\"");
	});

	test("the reason is worded in German as well as English", () => {
		expect(interfaceTextFor("de").account.signUpClosed).toBe(
			"Auf dieser Instanz können keine Konten angelegt werden. Frag ihren Betreiber nach einem Konto.",
		);
	});
});
