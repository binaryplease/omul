/**
 * Admin store — the append-only audit trail plus the two-step action-
 * confirmation lifecycle behind the operator-only `/api/admin/*` surface.
 *
 * A dedicated `bun:sqlite` database (separate from the auth DB and the
 * zodstore domain data) holding
 * two tables — `admin_events` (a durable record of every requested / executed /
 * rejected / failed / expired step, who did it, and its detail) and
 * `admin_actions` (the pending-confirmation lifecycle). Every privileged action
 * is prepared first (returning a one-time confirmation token, TTL-bounded) and
 * only executed once that token is echoed back, so an accidental one-shot call
 * can't mutate anything. Only the confirmation token's SHA-256 hash is stored,
 * and the terminal `pending → executed/failed/expired` transition is a guarded
 * SQL update so an action executes at most once.
 *
 * Built as a factory function rather than a class. A process-wide default store
 * is created at import from `OMUL_ADMIN_DB` (default: an `admin.sqlite` sibling
 * of the docstore file); tests build isolated stores over their own paths.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { docstorePath } from "./store-path";

/** How long a prepared action stays confirmable before it expires (10 minutes). */
export const ACTION_TTL_MS = 10 * 60 * 1000;

export type AdminActionStatus = "pending" | "executed" | "failed" | "expired";

export interface AdminAction {
	id: string;
	type: string;
	params: Record<string, unknown>;
	summary: string;
	adminUserId: string;
	adminEmail: string;
	status: AdminActionStatus;
	createdAt: string;
	expiresAt: number;
	confirmedAt: string | null;
}

export interface AdminEvent {
	id: string;
	ts: string;
	kind: "requested" | "executed" | "rejected" | "failed" | "expired";
	actionId: string | null;
	adminEmail: string;
	detail: string;
}

/** The outcome of a confirm attempt — explicit about why it did/didn't run. */
export type ConfirmResult =
	| { kind: "ok"; action: AdminAction }
	| { kind: "not-found" }
	| { kind: "invalid-token" }
	| { kind: "forbidden" }
	| { kind: "expired" }
	| { kind: "already-final"; status: AdminActionStatus };

function hashToken(token: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(token);
	return hasher.digest("hex");
}

interface ActionRow {
	id: string;
	type: string;
	params: string;
	summary: string;
	admin_user_id: string;
	admin_email: string;
	token_hash: string;
	status: string;
	created_at: string;
	expires_at: number;
	confirmed_at: string | null;
}

function rowToAction(row: ActionRow): AdminAction {
	let params: Record<string, unknown> = {};
	try {
		params = JSON.parse(row.params) as Record<string, unknown>;
	} catch {
		params = {};
	}
	return {
		id: row.id,
		type: row.type,
		params,
		summary: row.summary,
		adminUserId: row.admin_user_id,
		adminEmail: row.admin_email,
		status: row.status as AdminActionStatus,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		confirmedAt: row.confirmed_at,
	};
}

export interface AdminStore {
	prepareAction(input: {
		type: string;
		params: Record<string, unknown>;
		summary: string;
		adminUserId: string;
		adminEmail: string;
		token: string;
		now?: number;
	}): AdminAction;
	getAction(id: string): AdminAction | null;
	/** Validate + atomically flip pending→executed; the caller then performs the mutation. */
	confirmAction(input: {
		id: string;
		token: string;
		adminUserId: string;
		adminEmail: string;
		now?: number;
	}): ConfirmResult;
	/** Downgrade an executed action to failed when its mutation didn't complete. */
	markFailed(id: string, detail: string): void;
	recordEvent(input: {
		kind: AdminEvent["kind"];
		actionId: string | null;
		adminEmail: string;
		detail: string;
	}): void;
	listEvents(limit?: number): AdminEvent[];
	close(): void;
}

export function createAdminStore(path: string): AdminStore {
	if (path !== ":memory:") {
		mkdirSync(dirname(path), { recursive: true });
	}
	const db = new Database(path, { create: true });
	if (path !== ":memory:") {
		db.exec("PRAGMA journal_mode = WAL");
		db.exec("PRAGMA busy_timeout = 5000");
	}
	db.exec(`
		CREATE TABLE IF NOT EXISTS admin_actions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			params TEXT NOT NULL,
			summary TEXT NOT NULL,
			admin_user_id TEXT NOT NULL,
			admin_email TEXT NOT NULL,
			token_hash TEXT NOT NULL,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			confirmed_at TEXT
		);
		CREATE TABLE IF NOT EXISTS admin_events (
			id TEXT PRIMARY KEY,
			ts TEXT NOT NULL,
			kind TEXT NOT NULL,
			action_id TEXT,
			admin_email TEXT NOT NULL,
			detail TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS admin_events_ts ON admin_events(ts);
	`);

	function recordEvent(input: {
		kind: AdminEvent["kind"];
		actionId: string | null;
		adminEmail: string;
		detail: string;
	}): void {
		db.query(
			"INSERT INTO admin_events (id, ts, kind, action_id, admin_email, detail) VALUES (?, ?, ?, ?, ?, ?)",
		).run(
			crypto.randomUUID(),
			new Date().toISOString(),
			input.kind,
			input.actionId,
			input.adminEmail,
			input.detail,
		);
	}

	function getAction(id: string): AdminAction | null {
		const row = db
			.query<ActionRow, [string]>("SELECT * FROM admin_actions WHERE id = ?")
			.get(id);
		return row ? rowToAction(row) : null;
	}

	function prepareAction(input: {
		type: string;
		params: Record<string, unknown>;
		summary: string;
		adminUserId: string;
		adminEmail: string;
		token: string;
		now?: number;
	}): AdminAction {
		const now = input.now ?? Date.now();
		const id = crypto.randomUUID();
		const createdAt = new Date(now).toISOString();
		const expiresAt = now + ACTION_TTL_MS;
		db.query(
			`INSERT INTO admin_actions
				(id, type, params, summary, admin_user_id, admin_email, token_hash, status, created_at, expires_at, confirmed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
		).run(
			id,
			input.type,
			JSON.stringify(input.params),
			input.summary,
			input.adminUserId,
			input.adminEmail,
			hashToken(input.token),
			createdAt,
			expiresAt,
		);
		recordEvent({
			kind: "requested",
			actionId: id,
			adminEmail: input.adminEmail,
			detail: input.summary,
		});
		// just inserted
		return getAction(id)!;
	}

	function confirmAction(input: {
		id: string;
		token: string;
		adminUserId: string;
		adminEmail: string;
		now?: number;
	}): ConfirmResult {
		const now = input.now ?? Date.now();
		const action = getAction(input.id);
		if (!action) return { kind: "not-found" };
		if (action.status !== "pending") {
			if (action.status === "expired") return { kind: "expired" };
			return { kind: "already-final", status: action.status };
		}
		if (now > action.expiresAt) {
			db.query(
				"UPDATE admin_actions SET status = 'expired' WHERE id = ? AND status = 'pending'",
			).run(input.id);
			recordEvent({
				kind: "expired",
				actionId: input.id,
				adminEmail: input.adminEmail,
				detail: "Confirmation token expired before use",
			});
			return { kind: "expired" };
		}
		if (action.adminUserId !== input.adminUserId) {
			recordEvent({
				kind: "rejected",
				actionId: input.id,
				adminEmail: input.adminEmail,
				detail: "Confirm attempted by a different admin than prepared it",
			});
			return { kind: "forbidden" };
		}
		const stored = db
			.query<{ token_hash: string }, [string]>(
				"SELECT token_hash FROM admin_actions WHERE id = ?",
			)
			.get(input.id);
		if (!stored || hashToken(input.token) !== stored.token_hash) {
			recordEvent({
				kind: "rejected",
				actionId: input.id,
				adminEmail: input.adminEmail,
				detail: "Invalid confirmation token",
			});
			return { kind: "invalid-token" };
		}
		// Guarded terminal transition: only the first confirm flips pending→executed.
		const confirmedAt = new Date(now).toISOString();
		const changed = db
			.query(
				"UPDATE admin_actions SET status = 'executed', confirmed_at = ? WHERE id = ? AND status = 'pending'",
			)
			.run(confirmedAt, input.id);
		if (changed.changes === 0) {
			const fresh = getAction(input.id);
			return { kind: "already-final", status: fresh?.status ?? "executed" };
		}
		recordEvent({
			kind: "executed",
			actionId: input.id,
			adminEmail: input.adminEmail,
			detail: action.summary,
		});
		// just confirmed
		return { kind: "ok", action: getAction(input.id)! };
	}

	function markFailed(id: string, detail: string): void {
		const action = getAction(id);
		if (!action) return;
		db.query("UPDATE admin_actions SET status = 'failed' WHERE id = ?").run(id);
		recordEvent({
			kind: "failed",
			actionId: id,
			adminEmail: action.adminEmail,
			detail,
		});
	}

	function listEvents(limit = 100): AdminEvent[] {
		const rows = db
			.query<
				{
					id: string;
					ts: string;
					kind: string;
					action_id: string | null;
					admin_email: string;
					detail: string;
				},
				[number]
			>("SELECT * FROM admin_events ORDER BY ts DESC, id DESC LIMIT ?")
			.all(limit);
		return rows.map((r) => ({
			id: r.id,
			ts: r.ts,
			kind: r.kind as AdminEvent["kind"],
			actionId: r.action_id,
			adminEmail: r.admin_email,
			detail: r.detail,
		}));
	}

	function close(): void {
		db.close();
	}

	return {
		prepareAction,
		getAction,
		confirmAction,
		markFailed,
		recordEvent,
		listEvents,
		close,
	};
}

// Process-wide default admin store. Kept beside the docstore file unless
// OMUL_ADMIN_DB overrides it; `:memory:` for an ephemeral store in tests.
const DATABASE_PATH = docstorePath();
const CONFIGURED_ADMIN_DB = process.env.OMUL_ADMIN_DB;
const ADMIN_DB_PATH = CONFIGURED_ADMIN_DB
	? resolve(CONFIGURED_ADMIN_DB)
	: DATABASE_PATH === ":memory:"
		? ":memory:"
		: resolve(join(dirname(DATABASE_PATH), "admin.sqlite"));

export const adminStore = createAdminStore(ADMIN_DB_PATH);
