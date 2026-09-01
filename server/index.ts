import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { zodToJsonSchema } from "zod-to-json-schema";
import { auth, ensureAuthSchema } from "./accounts";
import { adminAllowlistStartupReport } from "./admins";
import { connectDb } from "./db";
import { deckGenerationStartupReport } from "./deck-generator";
import { adminRoutes } from "./routes/admin";
import { deckGenerationRoutes } from "./routes/deck-generation";
import { discoveryRoutes, publicOriginStartupReport } from "./routes/discovery";
import { rateLimitStartupReport } from "./rate-limit";
import { presentationRoutes } from "./routes/presentations";
import { staticRoutes } from "./routes/static";
import { templateRoutes } from "./routes/templates";
import { workspaceRoutes } from "./routes/workspaces";
import { joinRoom, registerClient, removeClient } from "./ws";

const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== "production";

// Open the document store before starting the server.
await connectDb();

// Create/upgrade the Better Auth tables (user, session, account, verification,
// apikey) in-process so a fresh deploy self-provisions without a separate CLI
// migrate step (single-binary model). Idempotent — safe on every boot.
await ensureAuthSchema();

const app = new Elysia()
	// ── OpenAPI docs (Scalar UI at /api/docs, spec at /api/docs/json) ─
	// Registered before routes so route schemas (Zod via Standard Schema)
	// are discovered. `mapJsonSchema.zod` converts Zod 3 schemas → JSON Schema.
	.use(
		openapi({
			path: "/api/docs",
			scalar: {
				url: "/api/docs/json",
				// Suppress Scalar's commercial upsell CTAs. The free Scalar build
				// otherwise injects buttons that link out to their hosted API
				// Client product — irrelevant for a self-hosted dev/prod docs UI.
				hideClientButton: true,
				hideTestRequestButton: true,
				hideDownloadButton: true,
				showDeveloperTools: "never",
			},
			mapJsonSchema: { zod: zodToJsonSchema },
			documentation: {
				info: {
					title: "omul API",
					version: "0.0.0",
					description:
						"REST API for live interactive presentations. Mutation routes require a `Authorization: Bearer <creatorToken>` header (returned once on creation). Realtime updates are delivered over the WebSocket at `/ws`.",
				},
				components: {
					securitySchemes: {
						bearerAuth: {
							type: "http",
							scheme: "bearer",
							description:
								"Pass the `creatorToken` returned from `POST /api/presentations` as `Authorization: Bearer <token>` on all mutation endpoints.",
						},
					},
				},
				tags: [
					{
						name: "Discovery",
						description:
							"Service metadata: discovery index, health probe, OpenAPI spec.",
					},
					{
						name: "Presentations",
						description:
							"CRUD and lifecycle (start / end / reset) for presentations.",
					},
					{
						name: "Templates",
						description:
							"The built-in catalog of prebuilt decks (REQ005). Read-only and public; an entry's id is what a create copies its slides from (REQ006).",
					},
					{
						name: "Generation",
						description:
							"Turning a short text prompt into a draft deck (REQ007). Off unless the deployment configured a model provider; ask the capability route before offering it.",
					},
					{
						name: "Workspaces",
						description:
							"Workspaces (REQ128) — an owner of decks that is not an account — and the role each member holds in one (REQ129). Every workspace-scoped mutation is authorized against that role on the server.",
					},
					{
						name: "Slides",
						description:
							"Per-slide presenter controls: navigation and result reveal.",
					},
					{
						name: "Voting",
						description:
							"Public endpoints used by participants to submit votes and upvote open-ended responses.",
					},
					{
						name: "Results",
						description: "Read aggregated voting results.",
					},
					{
						name: "Admin",
						description:
							"Operator-only surface: two-step confirmed actions (e.g. reassign presentation owner) and the admin audit log. Requires an admin cookie session.",
					},
				],
			},
		}),
	)

	// ── API discovery ─────────────────────────────────────────
	// Machine- and human-readable index of the API surface, and the resolution
	// of the origin its links carry — behind a TLS-terminating proxy the origin
	// this process observes is http:// on a host that only serves https
	// (server/routes/discovery.ts).
	// The health probe (`/api/health`) travels with it — it is a link the index
	// hands out, and it is followed to check this service before anything else.
	.use(discoveryRoutes)

	// ── User accounts (Better Auth) ───────────────────────────
	// Email + password sign-up/in/out, sessions, password reset, email
	// verification, change-email, account deletion, and personal API keys, all
	// mounted under /api/auth/* (server/accounts.ts). The Better Auth client on
	// the frontend (src/auth-client.ts) talks to this same-origin endpoint.
	.get("/api/auth/*", ({ request }) => auth.handler(request))
	.post("/api/auth/*", ({ request }) => auth.handler(request))

	// ── The template catalog (REQ005) ─────────────────────────
	// Public and read-only: prebuilt decks that ship with the build. Registered
	// before the presentation routes it feeds — a create names an entry from here
	// (REQ006) — though neither depends on the other being mounted.
	.use(templateRoutes)

	// ── Generating a deck from a prompt (REQ007) ──────────────
	// The second way a deck starts from something rather than from nothing,
	// beside the catalog above it. Off unless the deployment configured a
	// provider key — see `server/deck-generator.ts` and the boot report below.
	.use(deckGenerationRoutes)

	// ── All API routes ────────────────────────────────────────
	.use(presentationRoutes)

	// ── Workspaces (REQ128, REQ129) ───────────────────────────
	// The other owner a deck can have: a workspace, and the roles the accounts in
	// it hold. Registered after the presentation routes it lists decks from —
	// though neither depends on the other being mounted.
	.use(workspaceRoutes)

	// ── Admin surface (operator-only, /api/admin/*) ───────────
	.use(adminRoutes)

	// ── WebSocket ─────────────────────────────────────────────
	.ws("/ws", {
		open(ws) {
			const clientId = registerClient(ws);
			// NOTE: We must mutate `ws.raw.data` (the underlying Bun ServerWebSocket's
			// data slot), not `ws.data`. The Elysia wrapper is reconstructed for each
			// handler call (open/message/close) and its `.data` is re-derived from the
			// per-call Context, so assignments to it do NOT persist. `ws.raw.data`
			// belongs to Bun and survives for the lifetime of the connection.
			// raw.data is Bun's settable slot
			(ws.raw as any).data = { ...((ws.raw as any).data ?? {}), clientId };
		},
		message(ws, message) {
			try {
				const msg = typeof message === "string" ? JSON.parse(message) : message;
				if (msg.type === "join") {
					// The client id lives on ws.raw.data — see the open() note above.
					const clientId = (ws.raw as any).data?.clientId as string | undefined;
					if (!clientId) return;
					joinRoom(clientId, msg.presentationId, msg.role || "participant");
				}
			} catch {
				// ignore malformed messages
			}
		},
		close(ws) {
			// The client id lives on ws.raw.data — see the open() note above.
			const clientId = (ws.raw as any).data?.clientId as string | undefined;
			if (clientId) removeClient(clientId);
		},
	});

// In production, serve Vite build output from dist/client/ as static files.
// Must be registered last (catch-all route).
// In development, Vite's dev server (port 5173) handles the frontend via proxy.
if (!isDev) {
	app.use(staticRoutes);
}

// ── Start server ──────────────────────────────────────────────
// In production we run inside a Docker container; binding to 127.0.0.1
// makes the port unreachable through Docker's port mapping, producing 502s
// at the reverse proxy in front of it. Binding to 0.0.0.0 is safe when the
// container publishes its port on the host's loopback only, which is what a
// deployment behind a proxy should do.
const HOSTNAME = isDev ? "127.0.0.1" : "0.0.0.0";

app.listen({
	port: PORT,
	hostname: HOSTNAME,
	development: isDev,
});

console.log(`Server running at http://${HOSTNAME}:${PORT}`);

// What the abuse limits (REQ145) amount to in *this* deployment — stated on
// every boot, because "on, but every visitor shares one bucket" is a posture
// that otherwise looks exactly like a healthy one from the outside.
for (const line of rateLimitStartupReport()) console.log(line);

// Which origin the /api discovery index will hand out, for the same reason: a
// proxied deployment that reports its own loopback-observed origin looks
// exactly like a direct one that is right to. Reading it here also makes a
// malformed OMUL_BASE_HOST fatal at boot rather than wrong on a link.
for (const line of publicOriginStartupReport()) console.log(line);

// Whether this build can generate a deck from a prompt (REQ007), for the same
// reason again: an unconfigured provider makes the feature absent rather than
// broken, and that difference is only visible from in here.
for (const line of deckGenerationStartupReport()) console.log(line);

// Who, if anyone, this deployment made an administrator (REQ164). Same reason a
// third time: an empty allowlist is the safe default and is indistinguishable
// from outside — every /api/admin/* call answers 403 either way — so the process
// says which one it is rather than leaving an operator at a 403 they cannot read.
for (const line of adminAllowlistStartupReport()) console.log(line);
