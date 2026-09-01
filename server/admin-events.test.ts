/**
 * Unit tests for the admin store (server/admin-events.ts): the two-step action-
 * confirmation lifecycle and the append-only audit log. Uses an in-memory
 * bun:sqlite store so nothing touches disk.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
	ACTION_TTL_MS,
	type AdminStore,
	createAdminStore,
} from "./admin-events";

/**
 * Two administrators, in reserved example domains (REQ164).
 *
 * The store never consults the allowlist — `adminEmail` is a column it records
 * and compares actions on, so these are payload rather than configuration and
 * are not read from `OMUL_ADMIN_EMAILS`. What matters is only that they are
 * two distinct addresses and that neither is anybody's.
 */
const ADMIN_EMAIL = "admin@example.com";
const SECOND_ADMIN_EMAIL = "second-admin@example.com";

let store: AdminStore;

beforeEach(() => {
	store = createAdminStore(":memory:");
});

function prepare(now = 1_000_000) {
	return store.prepareAction({
		type: "reassign-presentation",
		params: { presentationId: "p1", targetUserId: "u2", targetEmail: "b@x.io" },
		summary: "Reassign p1 to b@x.io",
		adminUserId: "admin1",
		adminEmail: ADMIN_EMAIL,
		token: "secret-token",
		now,
	});
}

describe("admin action lifecycle", () => {
	test("prepare records a pending action and a 'requested' event", () => {
		const action = prepare();
		expect(action.status).toBe("pending");
		expect(action.expiresAt).toBe(1_000_000 + ACTION_TTL_MS);
		const events = store.listEvents();
		expect(events[0]?.kind).toBe("requested");
		expect(events[0]?.actionId).toBe(action.id);
	});

	test("confirm with the right token executes exactly once", () => {
		const action = prepare();
		const first = store.confirmAction({
			id: action.id,
			token: "secret-token",
			adminUserId: "admin1",
			adminEmail: ADMIN_EMAIL,
			now: 1_000_100,
		});
		expect(first.kind).toBe("ok");
		expect(store.getAction(action.id)?.status).toBe("executed");
		// A second confirm is rejected — the action is already final.
		const second = store.confirmAction({
			id: action.id,
			token: "secret-token",
			adminUserId: "admin1",
			adminEmail: ADMIN_EMAIL,
			now: 1_000_200,
		});
		expect(second.kind).toBe("already-final");
		expect(store.listEvents().some((e) => e.kind === "executed")).toBe(true);
	});

	test("an invalid token is rejected and logged, action stays pending", () => {
		const action = prepare();
		const result = store.confirmAction({
			id: action.id,
			token: "wrong",
			adminUserId: "admin1",
			adminEmail: ADMIN_EMAIL,
			now: 1_000_100,
		});
		expect(result.kind).toBe("invalid-token");
		expect(store.getAction(action.id)?.status).toBe("pending");
		expect(store.listEvents().some((e) => e.kind === "rejected")).toBe(true);
	});

	test("a different admin cannot confirm another admin's action", () => {
		const action = prepare();
		const result = store.confirmAction({
			id: action.id,
			token: "secret-token",
			adminUserId: "admin2",
			adminEmail: SECOND_ADMIN_EMAIL,
			now: 1_000_100,
		});
		expect(result.kind).toBe("forbidden");
		expect(store.getAction(action.id)?.status).toBe("pending");
	});

	test("an expired token cannot be confirmed and is marked expired", () => {
		const action = prepare(1_000_000);
		const result = store.confirmAction({
			id: action.id,
			token: "secret-token",
			adminUserId: "admin1",
			adminEmail: ADMIN_EMAIL,
			now: 1_000_000 + ACTION_TTL_MS + 1,
		});
		expect(result.kind).toBe("expired");
		expect(store.getAction(action.id)?.status).toBe("expired");
	});

	test("confirming an unknown action id returns not-found", () => {
		const result = store.confirmAction({
			id: "does-not-exist",
			token: "x",
			adminUserId: "admin1",
			adminEmail: ADMIN_EMAIL,
		});
		expect(result.kind).toBe("not-found");
	});

	test("markFailed downgrades an executed action and logs it", () => {
		const action = prepare();
		store.confirmAction({
			id: action.id,
			token: "secret-token",
			adminUserId: "admin1",
			adminEmail: ADMIN_EMAIL,
			now: 1_000_100,
		});
		store.markFailed(action.id, "target vanished");
		expect(store.getAction(action.id)?.status).toBe("failed");
		expect(store.listEvents().some((e) => e.kind === "failed")).toBe(true);
	});
});
