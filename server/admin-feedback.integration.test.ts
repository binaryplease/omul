/**
 * Reading the feedback database as an administrator, over HTTP (REQ185).
 *
 *   - **Only administrators read it.** `GET /api/admin/feedback` answers `401`
 *     signed-out and `403` to a signed-in non-admin, before anything else —
 *     the channel being off or the query being malformed included.
 *   - **Off is absent.** With both channels off an administrator gets `404`,
 *     and no database is opened to say so. With only the prompt after a
 *     session on (REQ186), its answers are read while the menu's route is 404.
 *   - **Totals, then a page.** Each channel answers its total, the count per
 *     rating and of comment-only entries, and its entries newest first, fifty at
 *     a time behind a cursor.
 *   - **The contact is resolved when read.** An app-menu entry's account turns
 *     into its current email, `null` when the box was not ticked, and `deleted`
 *     once the account is gone — and no email address ever lands in the file.
 *
 * Stands up the admin routes over file-backed stores in a temp directory, so
 * the file itself can be searched for an address after the read.
 */

// Env must be set before importing ./accounts, ./admin-events and ./admins
// (they read it at module load).
process.env.DATABASE_PATH = ":memory:";
process.env.OMUL_ADMIN_DB = ":memory:";
process.env.NODE_ENV = "test";

// This suite's administrator, named the way an operator names one (REQ164).
// `bun test` runs every file in one process, so whichever suite imports
// ./admins and ./accounts first fixes the allowlist and the auth database for
// all of them. This is the address server/ownership.integration.test.ts names
// too, so the allowlist holds it in either order; the account itself is taken
// over in beforeAll and deleted in afterAll, so neither suite finds the other's.
const ADMIN_EMAIL = "admin@example.com";
process.env.OMUL_ADMIN_EMAILS = ADMIN_EMAIL;

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "omul-admin-feedback-"));
process.env.OMUL_AUTH_DB = join(directory, "auth.sqlite");
const FEEDBACK_DB = join(directory, "feedback.sqlite");
const PAGING_DB = join(directory, "paging.sqlite");

const CONTACT_EMAIL = "feedback-contact@example.com";
const LEAVER_EMAIL = "feedback-leaver@example.com";
const LEAVER_PASSWORD = "correct-horse-leaver";

// loose test types
type Any = any;

let routes: Any;
let pagingRoutes: Any;
let disabledRoutes: Any;
let closeStores = () => {};

let adminCookie = "";
let nonAdminCookie = "";
let leaverCookie = "";
let contactUserId = "";
let leaverUserId = "";

// The seeded app-menu entries, by what they are for.
const seeded: Record<string, string> = {};

function read(
	adminRoutes: Any,
	search: string,
	cookie = adminCookie,
): Promise<Response> {
	return adminRoutes.handle(
		new Request(`http://localhost/api/admin/feedback${search}`, {
			headers: cookie ? { cookie } : {},
		}),
	);
}

// Every account this suite signed up and still holds, deleted again afterwards:
// the auth database is shared by every suite in the run (see ADMIN_EMAIL), and
// the next one to sign up the administrator expects to find nobody there.
const signedUpAccounts: { cookie: string; password: string }[] = [];

async function signUp(
	email: string,
	password: string,
): Promise<{ cookie: string; userId: string }> {
	const { auth } = await import("./accounts");
	const signedUp = await auth.api.signUpEmail({
		body: { email, password, name: email.split("@")[0] ?? "" },
		asResponse: true,
	});
	expect(signedUp.ok).toBe(true);
	const cookie = signedUp.headers
		.getSetCookie()
		.map((setCookie) => setCookie.split(";")[0])
		.join("; ");
	const userId = ((await signedUp.json()) as Any).user.id;
	signedUpAccounts.push({ cookie, password });
	return { cookie, userId };
}

async function deleteAccount(cookie: string, password: string): Promise<void> {
	const { auth } = await import("./accounts");
	await auth.api.deleteUser({ body: { password }, headers: new Headers({ cookie }) });
	const held = signedUpAccounts.findIndex((account) => account.cookie === cookie);
	if (held >= 0) signedUpAccounts.splice(held, 1);
}

/** Every byte of a store's database, its write-ahead log included. */
function storedBytes(path: string): string {
	return [path, `${path}-wal`]
		.filter((file) => existsSync(file))
		.map((file) => readFileSync(file).toString("latin1"))
		.join("");
}

beforeAll(async () => {
	const { auth, ensureAuthSchema, findUserByEmail } = await import("./accounts");
	const { createFeedbackStore } = await import("./feedback-store");
	const { createAdminFeedbackRoutes } = await import("./routes/admin");
	await ensureAuthSchema();

	// An administrator a suite run earlier left behind, whose password is not
	// this suite's to know.
	const leftBehind = findUserByEmail(ADMIN_EMAIL);
	if (leftBehind) {
		await (await auth.$context).internalAdapter.deleteUser(leftBehind.id);
	}

	adminCookie = (await signUp(ADMIN_EMAIL, "correct-horse-admin")).cookie;
	nonAdminCookie = (await signUp("feedback-reader@example.com", "correct-horse-reader")).cookie;
	contactUserId = (await signUp(CONTACT_EMAIL, "correct-horse-contact")).userId;
	const leaver = await signUp(LEAVER_EMAIL, LEAVER_PASSWORD);
	leaverCookie = leaver.cookie;
	leaverUserId = leaver.userId;

	const store = createFeedbackStore(FEEDBACK_DB);
	const day = (date: string) => Date.parse(`${date}T12:00:00Z`);
	seeded.contact = store.recordUserFeedback({
		rating: 5,
		comment: "Write back, please",
		surface: "presenter",
		contactAccountId: contactUserId,
		language: "en",
		now: day("2026-01-01"),
	}).id;
	seeded.commentOnly = store.recordUserFeedback({
		rating: null,
		comment: "Only words",
		surface: "participant",
		contactAccountId: null,
		language: "de",
		now: day("2026-01-02"),
	}).id;
	seeded.leaver = store.recordUserFeedback({
		rating: 3,
		comment: "",
		surface: "other",
		contactAccountId: leaverUserId,
		language: "en",
		now: day("2026-01-03"),
	}).id;
	// The same day as the one before, written after it — so newer.
	seeded.sameDayLater = store.recordUserFeedback({
		rating: 5,
		comment: "",
		surface: "presenter",
		contactAccountId: null,
		language: "en",
		now: day("2026-01-03"),
	}).id;

	// The participant channel (REQ186), seeded straight into its table so the
	// entries carry ids and days the assertions can name.
	const direct = new Database(FEEDBACK_DB);
	const insert = direct.query(
		"INSERT INTO participant_feedback (id, rating, comment, language, createdOn) VALUES (?, ?, ?, ?, ?)",
	);
	insert.run("participant-older", 4, "Fun quiz", "fr", "2026-02-01");
	insert.run("participant-newer", null, "Too fast", "en", "2026-02-02");
	direct.close();

	// A channel long enough to page through: 120 entries over 12 days.
	const pagingStore = createFeedbackStore(PAGING_DB);
	for (let written = 0; written < 120; written++) {
		pagingStore.recordUserFeedback({
			rating: (written % 5) + 1,
			comment: `entry ${written}`,
			surface: "other",
			contactAccountId: null,
			language: "en",
			now: day(`2026-03-${String(10 + Math.floor(written / 10)).padStart(2, "0")}`),
		});
	}

	closeStores = () => {
		store.close();
		pagingStore.close();
	};
	routes = createAdminFeedbackRoutes(store);
	pagingRoutes = createAdminFeedbackRoutes(pagingStore);
	disabledRoutes = createAdminFeedbackRoutes(null);
});

afterAll(async () => {
	for (const account of [...signedUpAccounts]) {
		await deleteAccount(account.cookie, account.password);
	}
	closeStores();
	rmSync(directory, { recursive: true, force: true });
});

describe("who may read feedback (REQ185)", () => {
	test("signed out is 401, on either channel and whatever the query", async () => {
		for (const search of ["?channel=user", "?channel=participant", "?channel=nope", ""]) {
			expect((await read(routes, search, "")).status).toBe(401);
		}
	});

	test("a signed-in non-admin is 403, on either channel and whatever the query", async () => {
		for (const search of ["?channel=user", "?channel=participant", "?channel=nope"]) {
			const response = await read(routes, search, nonAdminCookie);
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: "Not an admin" });
		}
	});

	test("an administrator reads both channels", async () => {
		for (const channel of ["user", "participant"]) {
			const response = await read(routes, `?channel=${channel}`);
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(((await response.json()) as Any).channel).toBe(channel);
		}
	});

	test("any other channel, or none, is refused 422", async () => {
		for (const search of ["?channel=nope", "?channel=", ""]) {
			expect((await read(routes, search)).status).toBe(422);
		}
	});
});

describe("with the channel off (REQ185)", () => {
	test("an administrator gets 404 on either channel", async () => {
		for (const channel of ["user", "participant"]) {
			const response = await read(disabledRoutes, `?channel=${channel}`);
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({
				error: "Feedback is not collected on this server",
			});
		}
	});

	test("the admin gate still answers first", async () => {
		expect((await read(disabledRoutes, "?channel=user", "")).status).toBe(401);
		expect(
			(await read(disabledRoutes, "?channel=user", nonAdminCookie)).status,
		).toBe(403);
	});
});

describe("the user channel (REQ185)", () => {
	test("totals count every rating and the comment-only entries", async () => {
		const page = (await (await read(routes, "?channel=user")).json()) as Any;
		expect(page.total).toBe(4);
		expect(page.ratingCounts).toEqual({ "1": 0, "2": 0, "3": 1, "4": 0, "5": 2 });
		expect(page.unratedCount).toBe(1);
		expect(page.nextCursor).toBeNull();
	});

	test("entries are newest first — by day, then by the order they were sent", async () => {
		const page = (await (await read(routes, "?channel=user")).json()) as Any;
		expect(page.entries.map((entry: Any) => entry.id)).toEqual([
			seeded.sameDayLater,
			seeded.leaver,
			seeded.commentOnly,
			seeded.contact,
		]);
	});

	test("an entry carries the fields REQ185 names and never its account id", async () => {
		const response = await read(routes, "?channel=user");
		const body = await response.text();
		expect(body).not.toContain("contactAccountId");
		expect(body).not.toContain(contactUserId);
		expect(body).not.toContain(leaverUserId);
		const entry = (JSON.parse(body) as Any).entries.find(
			(candidate: Any) => candidate.id === seeded.commentOnly,
		);
		expect(entry).toEqual({
			id: seeded.commentOnly,
			rating: null,
			comment: "Only words",
			surface: "participant",
			language: "de",
			createdOn: "2026-01-02",
			contact: null,
		});
	});

	test("the contact is the account's email, null without the box, deleted once the account is gone", async () => {
		const contactOf = async () => {
			const page = (await (await read(routes, "?channel=user")).json()) as Any;
			return Object.fromEntries(
				page.entries.map((entry: Any) => [entry.id, entry.contact]),
			);
		};

		const before = await contactOf();
		expect(before[seeded.contact]).toEqual({ status: "email", email: CONTACT_EMAIL });
		expect(before[seeded.leaver]).toEqual({ status: "email", email: LEAVER_EMAIL });
		expect(before[seeded.commentOnly]).toBeNull();
		expect(before[seeded.sameDayLater]).toBeNull();

		await deleteAccount(leaverCookie, LEAVER_PASSWORD);

		const after = await contactOf();
		expect(after[seeded.leaver]).toEqual({ status: "deleted" });
		expect(after[seeded.contact]).toEqual({ status: "email", email: CONTACT_EMAIL });
		expect(after[seeded.commentOnly]).toBeNull();
	});

	test("after the reads, no email address exists in the feedback database", async () => {
		await read(routes, "?channel=user");
		const bytes = storedBytes(FEEDBACK_DB);
		expect(bytes.length).toBeGreaterThan(0);
		for (const email of [ADMIN_EMAIL, CONTACT_EMAIL, LEAVER_EMAIL]) {
			expect(bytes).not.toContain(email);
		}
		expect(bytes).not.toContain("@example.com");
	});
});

describe("the participant channel (REQ185, REQ186)", () => {
	test("totals and entries, newest first, with no contact or surface", async () => {
		const page = (await (await read(routes, "?channel=participant")).json()) as Any;
		expect(page.total).toBe(2);
		expect(page.ratingCounts).toEqual({ "1": 0, "2": 0, "3": 0, "4": 1, "5": 0 });
		expect(page.unratedCount).toBe(1);
		expect(page.nextCursor).toBeNull();
		expect(page.entries).toEqual([
			{
				id: "participant-newer",
				rating: null,
				comment: "Too fast",
				language: "en",
				createdOn: "2026-02-02",
			},
			{
				id: "participant-older",
				rating: 4,
				comment: "Fun quiz",
				language: "fr",
				createdOn: "2026-02-01",
			},
		]);
	});

	test("an empty channel answers zeros and no entries", async () => {
		const response = await read(pagingRoutes, "?channel=participant");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			channel: "participant",
			total: 0,
			ratingCounts: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
			unratedCount: 0,
			nextCursor: null,
			entries: [],
		});
	});
});

describe("paging (REQ185)", () => {
	test("the cursor walks every entry once, newest first, fifty at a time", async () => {
		const { FEEDBACK_PAGE_SIZE } = await import("./schemas");
		const pages: Any[] = [];
		let cursor: string | null = null;
		do {
			const search: string = cursor
				? `?channel=user&cursor=${encodeURIComponent(cursor)}`
				: "?channel=user";
			const response: Response = await read(pagingRoutes, search);
			expect(response.status).toBe(200);
			const page = (await response.json()) as Any;
			pages.push(page);
			cursor = page.nextCursor;
		} while (cursor !== null && pages.length < 10);

		expect(pages.map((page) => page.entries.length)).toEqual([
			FEEDBACK_PAGE_SIZE,
			FEEDBACK_PAGE_SIZE,
			120 - 2 * FEEDBACK_PAGE_SIZE,
		]);
		// The totals are the channel's, on every page.
		for (const page of pages) {
			expect(page.total).toBe(120);
			expect(page.ratingCounts).toEqual({ "1": 24, "2": 24, "3": 24, "4": 24, "5": 24 });
			expect(page.unratedCount).toBe(0);
		}
		const comments = pages.flatMap((page) =>
			page.entries.map((entry: Any) => entry.comment),
		);
		// Written oldest first, so read back they run from the last to the first.
		expect(comments).toEqual(
			Array.from({ length: 120 }, (_, offset) => `entry ${119 - offset}`),
		);
	});

	test("a cursor that names no entry of the channel is refused 400", async () => {
		for (const cursor of ["no-such-entry", "participant-older"]) {
			const response = await read(routes, `?channel=user&cursor=${cursor}`);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: "Unknown cursor" });
		}
		const otherChannel = await read(
			routes,
			`?channel=participant&cursor=${seeded.contact}`,
		);
		expect(otherChannel.status).toBe(400);
	});
});

describe("a deployment that runs only the prompt after a session (REQ186)", () => {
	test("participant answers are stored and readable while the menu channel stays 404", async () => {
		const { createFeedbackStore, readFeedbackSettings } = await import(
			"./feedback-store"
		);
		const { createFeedbackRoutes } = await import("./routes/feedback");
		const { createAdminFeedbackRoutes } = await import("./routes/admin");
		// The environment such a deployment sets: the prompt, and nothing else.
		const settings = readFeedbackSettings({ OMUL_FEEDBACK_PROMPT_PERCENT: "100" });
		expect(settings.menuEnabled).toBe(false);
		const store = createFeedbackStore(join(directory, "prompt-only.sqlite"));
		try {
			const feedbackRoutes = createFeedbackRoutes(store, settings);
			const post = (path: string, body: unknown) =>
				feedbackRoutes.handle(
					new Request(`http://localhost/api${path}`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					}),
				);

			const answered = await post("/feedback/participant", {
				rating: 4,
				comment: "Smooth",
				language: "nl",
			});
			expect(answered.status).toBe(201);
			const menu = await post("/feedback", {
				rating: 4,
				surface: "other",
				language: "en",
			});
			expect(menu.status).toBe(404);

			const adminRoutes = createAdminFeedbackRoutes(store);
			const participant = (await (
				await read(adminRoutes, "?channel=participant")
			).json()) as Any;
			expect(participant.total).toBe(1);
			expect(participant.entries).toEqual([
				{
					id: ((await answered.json()) as Any).id,
					rating: 4,
					comment: "Smooth",
					language: "nl",
					createdOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
				},
			]);
			// The menu's tab still answers, empty, so the page can draw both.
			const user = await read(adminRoutes, "?channel=user");
			expect(user.status).toBe(200);
			expect(((await user.json()) as Any).total).toBe(0);
		} finally {
			store.close();
		}
	});
});
