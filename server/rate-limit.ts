/**
 * Abuse protection for the account-free surface (REQ145).
 *
 * omul lets anyone create a deck, join a room and answer a question without
 * ever signing in. That is the product, and it is also the whole attack
 * surface: without a login there is no other throttle in the system, so a
 * scripted client can stuff a ballot box or fill the disk with presentations.
 * This module is that throttle — an in-process sliding window per client, a
 * `429` carrying a retry hint, and one environment switch that turns the whole
 * thing off for a self-hoster on a trusted network.
 *
 * Three things it deliberately is **not**:
 *
 *  - **Not a shared store.** The counters live in this process's memory. That
 *    matches how omul ships (one container); a multi-instance deploy would
 *    divide every ceiling below by the number of replicas.
 *  - **Not ballot integrity.** omul's rooms are conference wifi and lecture
 *    halls, so hundreds of legitimate participants arrive behind one NATted
 *    address. Every per-address ceiling here is therefore sized for a large
 *    room bursting at once, which makes it flood protection rather than a
 *    per-human quota. The tighter per-participant ceiling is what bounds a
 *    single client; a determined attacker who rotates participant ids still
 *    meets the per-address one — which is only true because an "address" here
 *    is a `/64` on IPv6 rather than a single one of the 2^64 a subscriber can
 *    source from. See {@link clientBucketKey}.
 *  - **Not a set of knobs.** The windows are constants, not configuration.
 *    The only environment surface is the on/off switch and whether proxy
 *    headers are trusted.
 *
 * Environment:
 *
 *  - `OMUL_RATE_LIMITS_DISABLED=true` — turn every limit off. Anything else,
 *    including unset, leaves them **on**: the safe posture is what you get
 *    when you configure nothing.
 *  - `OMUL_TRUST_PROXY=true` — trust **one** reverse-proxy hop and take the
 *    client address from the right-hand end of `X-Forwarded-For` (a longer
 *    chain sets the number of hops instead, e.g. `2` for a CDN in front of
 *    Caddy). Unset, the header is **ignored** and the socket address is used,
 *    because a caller can write any value it likes into it and would otherwise
 *    mint itself a fresh bucket per request. Production runs behind Caddy and
 *    must set this; without it every visitor collapses into the proxy's single
 *    bucket. See {@link clientAddress} for why the *right*-hand end.
 *
 * That switch is not this module's — it says what the *server* trusts, and the
 * `/api` discovery index reads the same one to decide which origin it
 * advertises. It lives in `server/proxy-trust.ts` and is re-exported here
 * because this module's documentation and tests have always named it.
 *
 * That last variable is the one whose absence is invisible — the safe default
 * and the misconfiguration look identical from inside the process — so the
 * deployment is made to say which it is rather than left to be guessed at:
 * {@link rateLimitStartupReport} states the posture on every boot, and
 * {@link untrustedProxyNotice} fires the first time a proxied request arrives
 * at a server that is ignoring the proxy.
 */

import { trustedProxyHops } from "./proxy-trust";

/** How many hits are allowed in how long a window. */
export interface RateLimitRule {
	/** Hits allowed inside the window. */
	limit: number;
	/** Window length in milliseconds. */
	windowMs: number;
}

/** What a window says about one hit. */
export interface RateLimitVerdict {
	allowed: boolean;
	/**
	 * Seconds until the oldest hit leaves the window and capacity frees up —
	 * the retry hint. Always `0` when allowed, never below `1` when refused, so
	 * a client that sleeps for it always makes progress.
	 */
	retryAfterSeconds: number;
}

/** A counting sliding window over an opaque client key. */
export interface SlidingWindow {
	/** Record a hit for `key` and say whether it is allowed. */
	check(key: string): RateLimitVerdict;
	/** Forget every tracked key (tests). */
	reset(): void;
	/** How many keys are currently tracked (tests, introspection). */
	trackedKeys(): number;
}

interface SlidingWindowOptions {
	/** Clock override, so tests can move time without waiting for it. */
	now?: () => number;
	/** How often to sweep every key for expiry (memory bound). */
	sweepEveryChecks?: number;
}

/**
 * A sliding-window counter (factory over class).
 *
 * Each key holds the timestamps of its hits inside the window. There is no
 * timer: a key's own expired hits are dropped when it is next checked, and an
 * occasional full sweep drops keys that were abandoned and will never be
 * checked again, so memory stays bounded by the number of *active* clients
 * rather than by every client ever seen.
 */
export function createSlidingWindow(
	rule: RateLimitRule,
	options: SlidingWindowOptions = {},
): SlidingWindow {
	const hitsByKey = new Map<string, number[]>();
	const readClock = options.now ?? Date.now;
	const sweepEveryChecks = options.sweepEveryChecks ?? 500;
	let checksSinceSweep = 0;

	function sweep(cutoff: number): void {
		for (const [trackedKey, timestamps] of hitsByKey) {
			const surviving = timestamps.filter((stamp) => stamp > cutoff);
			if (surviving.length === 0) hitsByKey.delete(trackedKey);
			else hitsByKey.set(trackedKey, surviving);
		}
	}

	function check(key: string): RateLimitVerdict {
		const currentTime = readClock();
		const cutoff = currentTime - rule.windowMs;

		if (++checksSinceSweep >= sweepEveryChecks) {
			checksSinceSweep = 0;
			sweep(cutoff);
		}

		const recent = (hitsByKey.get(key) ?? []).filter((stamp) => stamp > cutoff);
		if (recent.length >= rule.limit) {
			// Refused hits are not recorded — a client that keeps hammering must
			// not push its own window forward and lock itself out indefinitely.
			hitsByKey.set(key, recent);
			const freesUpInMs = recent[0] + rule.windowMs - currentTime;
			return {
				allowed: false,
				retryAfterSeconds: Math.max(1, Math.ceil(freesUpInMs / 1000)),
			};
		}
		recent.push(currentTime);
		hitsByKey.set(key, recent);
		return { allowed: true, retryAfterSeconds: 0 };
	}

	return {
		check,
		reset: () => hitsByKey.clear(),
		trackedKeys: () => hitsByKey.size,
	};
}

// ── Environment switches ────────────────────────────────────

/**
 * Whether the limits apply at all. Off is an explicit `"true"` and nothing
 * else: a typo in the variable leaves the protection standing rather than
 * quietly removing it.
 */
export function rateLimitsEnabled(): boolean {
	return process.env.OMUL_RATE_LIMITS_DISABLED !== "true";
}

/**
 * How many reverse-proxy hops may be believed — see `server/proxy-trust.ts`.
 * Re-exported so `OMUL_TRUST_PROXY`'s reader stays reachable from the module
 * that documents it.
 */
export { trustedProxyHops };

// ── Telling a misconfigured deployment about itself ─────────
//
// The default above (`0` — distrust the header) is the safe one and stays the
// safe one: believing `X-Forwarded-For` on a directly-exposed server hands
// every caller a fresh bucket per request. But it is only *correct* on a server
// that is in fact directly exposed, and the process cannot tell which it is
// from the inside — so the one configuration that silently removes the
// per-client key is also the one that looks exactly like the right one.
//
// So the deployment is asked, not guessed at: a request arriving with an
// `X-Forwarded-For` while no hop is trusted is a proxy in front of a server
// that is ignoring it, and that is said out loud. Once, because it is a
// configuration fact rather than a per-request event, and a line repeated per
// request is a line an operator filters out.

/** Whether the untrusted-proxy notice has already been given this process. */
let untrustedProxyNoticed = false;

/**
 * What that notice says. Both readings are spelled out, because from in here
 * they are genuinely indistinguishable and only the operator knows which
 * applies — a notice that asserted the wrong one would be noise.
 */
export function untrustedProxyNotice(): string {
	return [
		"[rate-limit] A request arrived carrying X-Forwarded-For while OMUL_TRUST_PROXY=0,",
		"so the header was ignored and the socket address was used instead.",
		'If a reverse proxy sits in front of this server, set OMUL_TRUST_PROXY to its hop count ("true" = 1)',
		"— until then every visitor shares the proxy's single bucket and a busy room is refused with 429.",
		"If this server is directly exposed, the header was caller-supplied and ignoring it is correct.",
		"This notice is not repeated.",
	].join(" ");
}

/** Give the notice, at most once, and only while the limits actually apply. */
function noteUntrustedProxy(): void {
	if (untrustedProxyNoticed || !rateLimitsEnabled()) return;
	untrustedProxyNoticed = true;
	console.warn(untrustedProxyNotice());
}

/**
 * Where the limits stand right now, as lines for the startup log.
 *
 * Printed unconditionally rather than only when something is wrong: "are the
 * abuse limits on, and what is a client?" is the pair an operator reads the log
 * to answer, and a line that only appears in the broken case teaches them that
 * silence means nothing rather than that silence means healthy.
 *
 * This is a report, not a gate. A conflict that the process can resolve on its
 * own should be fatal, but `0` hops is the correct and required
 * value for a directly-exposed server, so refusing to start on it would break
 * the deployment it is right for.
 */
export function rateLimitStartupReport(): string[] {
	if (!rateLimitsEnabled()) {
		return [
			'[rate-limit] OFF — OMUL_RATE_LIMITS_DISABLED="true". Create, join and vote are unthrottled.',
		];
	}
	const hops = trustedProxyHops();
	if (hops > 0) {
		return [
			`[rate-limit] on — a client is the address ${hops} proxy hop(s) in from the right of X-Forwarded-For.`,
		];
	}
	return [
		"[rate-limit] on — a client is the connection's socket address; X-Forwarded-For is ignored (OMUL_TRUST_PROXY=0).",
		'[rate-limit] Behind a reverse proxy this is wrong: set OMUL_TRUST_PROXY to the hop count ("true" = 1),',
		"[rate-limit] or every visitor shares the proxy's one bucket. Correct as it stands for a directly-exposed server.",
	];
}

/** Forget the one-shot notice above, so a test can provoke it again. */
export function resetRateLimitNotices(): void {
	untrustedProxyNoticed = false;
}

// ── Client identity ─────────────────────────────────────────

/** The bit of Bun's server the address resolution needs. */
interface AddressSource {
	requestIP(request: Request): { address: string } | null;
}

/**
 * The address a request came from.
 *
 * `X-Forwarded-For` is **appended** to, not replaced: each proxy adds the peer
 * it actually saw to the right-hand end, so the list reads
 * `<whatever the caller wrote>, <what proxy 1 saw>, … <what proxy N saw>`.
 * Everything left of the trusted tail is therefore attacker-supplied — reading
 * the *first* entry hands a caller a fresh identity per request and voids every
 * limit here. So the entry `trustedProxyHops()` in from the **right** is the
 * one taken: the last observation this server has a reason to believe.
 *
 * When proxy hops are not trusted, or the header carries fewer entries than
 * there are trusted hops, the socket address the connection actually came from
 * is used instead — behind a proxy that collapses callers into one bucket,
 * which fails toward limiting rather than toward letting a caller mint
 * identities. `"unknown"` when even that is unavailable, for the same reason.
 *
 * `X-Real-IP` is deliberately **not** consulted: it is a single unstructured
 * value with no hop chain, so there is no way to tell a proxy's observation
 * from a caller's claim.
 *
 * This is the *address*, which is not yet the thing a limit counts under — see
 * {@link clientKey}, which is what the guards call and what a new one should.
 */
export function clientAddress(
	request: Request,
	server: AddressSource | null,
): string {
	const forwarded = (request.headers.get("x-forwarded-for") ?? "")
		.split(",")
		.map((hop) => hop.trim())
		.filter((hop) => hop.length > 0);
	const hops = trustedProxyHops();
	if (hops > 0) {
		const observed = forwarded[forwarded.length - hops];
		if (observed) return observed;
	} else if (forwarded.length > 0) {
		noteUntrustedProxy();
	}
	const socketAddress = server?.requestIP(request)?.address;
	return socketAddress || "unknown";
}

/**
 * How many leading hextets of an IPv6 address name one client — four, a `/64`.
 *
 * A `/128` is not a client. IPv6 gives a single subscriber a whole `/64` (often
 * a `/56` or `/48` above it), and every address inside it is theirs to source
 * from, so keying on the full address lets one machine mint 2^64 buckets by
 * binding a fresh address per request. That is the same evasion the header
 * rules above exist to refuse, arriving through the socket instead — and it
 * would leave the per-address ceiling, which this module's own documentation
 * calls the backstop behind a rotated `participantId`, backstopping nothing.
 *
 * A `/64` is the smallest block that is ever routed to a host, so it is the
 * smallest unit that can still mean "one client". IPv4 needs no equivalent: an
 * address there is already the smallest routed unit, and is keyed whole.
 */
const IPV6_CLIENT_PREFIX_HEXTETS = 4;

/** The four octets of a dotted quad, or `null` when it is not one. */
function ipv4Octets(candidate: string): number[] | null {
	const pieces = candidate.split(".");
	if (pieces.length !== 4) return null;
	const octets = pieces.map((piece) =>
		/^\d{1,3}$/.test(piece) ? Number.parseInt(piece, 10) : Number.NaN,
	);
	return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

/**
 * An IPv6 address as its eight hextets, or `null` when the string is not one.
 *
 * Handles the `::` run-of-zeroes and a trailing dotted quad (`::ffff:1.2.3.4`),
 * which is the form a dual-stack socket reports an IPv4 peer in — the case that
 * matters most below.
 */
function ipv6Hextets(candidate: string): number[] | null {
	if (!candidate.includes(":")) return null;
	const halves = candidate.split("::");
	if (halves.length > 2) return null;

	const readGroups = (part: string): number[] | null => {
		if (part.length === 0) return [];
		const groups: number[] = [];
		for (const piece of part.split(":")) {
			if (piece.includes(".")) {
				const quad = ipv4Octets(piece);
				if (!quad) return null;
				groups.push(
					((quad[0] as number) << 8) | (quad[1] as number),
					((quad[2] as number) << 8) | (quad[3] as number),
				);
				continue;
			}
			if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
			groups.push(Number.parseInt(piece, 16));
		}
		return groups;
	};

	const head = readGroups(halves[0] ?? "");
	const tail = halves.length === 2 ? readGroups(halves[1] ?? "") : null;
	if (head === null) return null;
	if (halves.length === 1) return head.length === 8 ? head : null;
	if (tail === null) return null;
	const zeroes = 8 - head.length - tail.length;
	if (zeroes < 1) return null;
	return [...head, ...Array<number>(zeroes).fill(0), ...tail];
}

/** The IPv4 address an IPv4-mapped `::ffff:a.b.c.d` carries, or `null`. */
function ipv4MappedIn(hextets: number[]): string | null {
	const mapped =
		hextets[0] === 0 &&
		hextets[1] === 0 &&
		hextets[2] === 0 &&
		hextets[3] === 0 &&
		hextets[4] === 0 &&
		hextets[5] === 0xffff;
	if (!mapped) return null;
	const high = hextets[6] as number;
	const low = hextets[7] as number;
	return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** An address with its zone id (`fe80::1%eth0`) taken off. */
function withoutZone(address: string): string {
	const zone = address.indexOf("%");
	return zone === -1 ? address : address.slice(0, zone);
}

/**
 * An address with any port taken off — `[2001:db8::1]:443` and `1.2.3.4:5678`
 * are shapes a proxy can write into `X-Forwarded-For`, and a port left on would
 * make every connection from one client its own bucket.
 *
 * A bare IPv6 address is full of colons, so the trailing one is only read as a
 * port when it is the *only* colon there is.
 */
function withoutPort(address: string): string {
	if (address.startsWith("[")) {
		const close = address.indexOf("]");
		return close === -1 ? address.slice(1) : address.slice(1, close);
	}
	const colon = address.indexOf(":");
	if (colon !== -1 && address.indexOf(":", colon + 1) === -1) {
		return address.slice(0, colon);
	}
	return address;
}

/**
 * The bucket an address is counted under — the address itself for IPv4, its
 * `/64` for IPv6 (see {@link IPV6_CLIENT_PREFIX_HEXTETS}).
 *
 * Anything that does not parse as an address is keyed whole and lower-cased.
 * That is the conservative reading: an unfamiliar string counts as one client
 * rather than being discarded into the shared `"unknown"` bucket, where it
 * would spend somebody else's budget.
 */
export function clientBucketKey(address: string): string {
	const bare = withoutZone(withoutPort(address.trim()));
	if (bare.length === 0) return "unknown";

	const hextets = ipv6Hextets(bare);
	if (hextets === null) return bare.toLowerCase();

	// An IPv4-mapped address is an IPv4 client wearing IPv6 notation, and it is
	// the form Bun reports every IPv4 peer on a dual-stack socket in. Truncating
	// one to its /64 would put *every* IPv4 visitor on the internet into `::/64`
	// — the exact collapse this whole slice exists to undo.
	const mapped = ipv4MappedIn(hextets);
	if (mapped) return mapped;

	return `${hextets
		.slice(0, IPV6_CLIENT_PREFIX_HEXTETS)
		.map((hextet) => hextet.toString(16))
		.join(":")}::/64`;
}

/**
 * The key a request is counted under: which address it came from
 * ({@link clientAddress}), read as which client that is
 * ({@link clientBucketKey}).
 *
 * Composed here rather than at each guard so no guard can key on the raw
 * address by forgetting the second half — a per-address ceiling
 * missing its truncation is a ceiling that quietly does nothing on IPv6.
 */
export function clientKey(
	request: Request,
	server: AddressSource | null,
): string {
	return clientBucketKey(clientAddress(request, server));
}

// ── The 429 ─────────────────────────────────────────────────

/**
 * The over-limit response: `429` with a `Retry-After` header in seconds and
 * the same number in the body, because a browser client reads the JSON and a
 * script reads the header (both are emitted, neither is implied).
 */
export function tooManyRequests(
	retryAfterSeconds: number,
	message: string,
): Response {
	return new Response(
		JSON.stringify({ error: message, retryAfterSeconds }),
		{
			status: 429,
			headers: {
				"Content-Type": "application/json",
				"Retry-After": String(retryAfterSeconds),
			},
		},
	);
}

// ── The policy ──────────────────────────────────────────────
//
// Every ceiling below is per client and per window, and every one of them is
// sized against the room it has to survive rather than against a single human:
// a lecture hall behind one NATted address is the normal case, not the abuse
// case.

/**
 * Creating a deck writes a document and its slides — the disk-fill path, and
 * the only one of the three that is expensive per call. A human creating decks
 * manages a handful in five minutes; a workshop where thirty people each build
 * their own poll from the same wifi fits, and a script filling the store does
 * not.
 */
export const CREATE_RULE: RateLimitRule = { limit: 30, windowMs: 5 * 60_000 };

/**
 * Generating a deck from a prompt (REQ007) — the one route on this list whose
 * cost is not the server's.
 *
 * Every other ceiling here is sized against disk, sockets or CPU, all of which
 * are the operator's and all of which recover. A generation spends a **third
 * party's** call on the operator's credential, so the thing being rationed is
 * money, and the honest ceiling is a human's working rate rather than a room's:
 * five in five minutes is more drafts than anybody reads in that time and
 * useless to a script pointed at somebody else's bill.
 *
 * A generate also spends {@link CREATE_RULE}, because it writes exactly the
 * document a create writes — being the more expensive door in must not make it
 * the cheaper way through the disk ceiling.
 */
export const GENERATION_RULE: RateLimitRule = { limit: 5, windowMs: 5 * 60_000 };

/**
 * Looking up a join code writes nothing, so the ceiling here is flood and
 * code-enumeration protection. It has to clear a real burst: every participant
 * re-reads the deck when the presenter reveals a slide, so a 300-person room
 * can legitimately fire 300 lookups inside a second.
 */
export const JOIN_RULE: RateLimitRule = { limit: 600, windowMs: 60_000 };

/**
 * The public writes — a vote, a response upvote, a Q&A question, a Q&A upvote
 * and a chat message (REQ078). Counted twice: once against the address, sized
 * for a whole room answering together, and once against the participant id the
 * submission carries, which is the ceiling that actually bounds one client.
 *
 * **Reactions are deliberately not on this budget** — see
 * {@link REACTION_PARTICIPANT_RULE}.
 */
export const SUBMISSION_ADDRESS_RULE: RateLimitRule = {
	limit: 600,
	windowMs: 60_000,
};
export const SUBMISSION_PARTICIPANT_RULE: RateLimitRule = {
	limit: 60,
	windowMs: 60_000,
};

/**
 * Reactions (REQ077), on a budget of their own.
 *
 * They are throttled for a real reason — a reaction writes nothing but is
 * broadcast to every socket in the room, so it costs the same to flood as a
 * write does — but they must **not** share a counter with the submissions above,
 * and that is the whole point of these two constants.
 *
 * The failure they exist to prevent: a reaction is one tap with no confirmation
 * and no cost, so an enthusiastic participant reaches sixty of them during a
 * single applause moment without noticing. On a shared counter, the next thing
 * they do — answer the quiz question the presenter has just opened — meets an
 * exhausted budget, and because a quiz window is bounded (REQ057) the budget can
 * fail to free before the question closes. **The answer is then lost for good.**
 * An answer is the product's payload and a reaction is decoration; letting the
 * decoration starve the payload is the wrong way round, and punishes a
 * participant for using a feature the deck advertised as lightweight.
 *
 * Sized as taps rather than as submissions: two a second sustained is past what
 * a thumb does and still an order of magnitude below what a script would want,
 * and the per-address ceiling is sized for a whole NATted room applauding at
 * once rather than for one person — the same reasoning {@link JOIN_RULE}
 * carries, and for the same reason (hundreds of legitimate clients behind one
 * address).
 */
export const REACTION_ADDRESS_RULE: RateLimitRule = {
	limit: 3000,
	windowMs: 60_000,
};
export const REACTION_PARTICIPANT_RULE: RateLimitRule = {
	limit: 120,
	windowMs: 60_000,
};

const createWindow = createSlidingWindow(CREATE_RULE);
const generationWindow = createSlidingWindow(GENERATION_RULE);
const joinWindow = createSlidingWindow(JOIN_RULE);
const submissionAddressWindow = createSlidingWindow(SUBMISSION_ADDRESS_RULE);
const submissionParticipantWindow = createSlidingWindow(
	SUBMISSION_PARTICIPANT_RULE,
);
const reactionAddressWindow = createSlidingWindow(REACTION_ADDRESS_RULE);
const reactionParticipantWindow = createSlidingWindow(
	REACTION_PARTICIPANT_RULE,
);

/** Drop every counter. For tests that need a clean slate between cases. */
export function resetRateLimits(): void {
	createWindow.reset();
	generationWindow.reset();
	joinWindow.reset();
	submissionAddressWindow.reset();
	submissionParticipantWindow.reset();
	reactionAddressWindow.reset();
	reactionParticipantWindow.reset();
}

// ── Route guards ────────────────────────────────────────────
//
// Each guard returns the `429` to send, or `null` to carry on — the same shape
// the routes already use for authorization (`requireEdit`), so a guarded
// handler reads as two lines at the top and nothing else changes.

/** What a guard needs from the Elysia handler context. */
export interface GuardContext {
	request: Request;
	server: AddressSource | null;
}

const CREATE_MESSAGE =
	"Too many presentations created from here — please wait a moment";
/**
 * Names generation rather than creation, for the reason the reaction message
 * next door names reactions: the caller has been generating, and being refused
 * for the thing they were not doing reads as a broken feature.
 */
const GENERATION_MESSAGE =
	"Too many decks generated from here — please wait a moment";
const JOIN_MESSAGE = "Too many join attempts from here — please wait a moment";
const SUBMISSION_MESSAGE = "Too many submissions — please slow down";
/**
 * Names reactions rather than "submissions", because that is what the
 * participant has actually been doing and because the two budgets are now
 * separate: being told to slow down on the thing you were not doing is how a
 * refusal gets read as a broken feature.
 */
const REACTION_MESSAGE = "Too many reactions — please slow down";

/** Rate-limit `POST /api/presentations`. */
export function guardCreate({ request, server }: GuardContext): Response | null {
	if (!rateLimitsEnabled()) return null;
	const verdict = createWindow.check(clientKey(request, server));
	if (verdict.allowed) return null;
	return tooManyRequests(verdict.retryAfterSeconds, CREATE_MESSAGE);
}

/**
 * Rate-limit `POST /api/deck-generation` (REQ007).
 *
 * Its own window **and** the create one, checked in that order: the generation
 * ceiling is the tighter and the more specific, so a caller past it is told
 * about generation and has not also had a create slot taken off them for a deck
 * that was never written.
 */
export function guardGeneration({
	request,
	server,
}: GuardContext): Response | null {
	if (!rateLimitsEnabled()) return null;
	const key = clientKey(request, server);
	const generationVerdict = generationWindow.check(key);
	if (!generationVerdict.allowed) {
		return tooManyRequests(
			generationVerdict.retryAfterSeconds,
			GENERATION_MESSAGE,
		);
	}
	const createVerdict = createWindow.check(key);
	if (!createVerdict.allowed) {
		return tooManyRequests(createVerdict.retryAfterSeconds, CREATE_MESSAGE);
	}
	return null;
}

/** Rate-limit `GET /api/join/:code`. */
export function guardJoin({ request, server }: GuardContext): Response | null {
	if (!rateLimitsEnabled()) return null;
	const verdict = joinWindow.check(clientKey(request, server));
	if (verdict.allowed) return null;
	return tooManyRequests(verdict.retryAfterSeconds, JOIN_MESSAGE);
}

/**
 * Rate-limit a public write. Both windows are consulted and the first refusal
 * wins; an absent `participantId` is counted under one shared bucket, so the
 * submissions that name nobody cannot escape the limit by staying anonymous.
 */
export function guardSubmission(
	{ request, server }: GuardContext,
	participantId: string,
): Response | null {
	if (!rateLimitsEnabled()) return null;
	const addressVerdict = submissionAddressWindow.check(clientKey(request, server));
	if (!addressVerdict.allowed) {
		return tooManyRequests(addressVerdict.retryAfterSeconds, SUBMISSION_MESSAGE);
	}
	const participantVerdict = submissionParticipantWindow.check(
		participantId || "anonymous",
	);
	if (!participantVerdict.allowed) {
		return tooManyRequests(
			participantVerdict.retryAfterSeconds,
			SUBMISSION_MESSAGE,
		);
	}
	return null;
}

/**
 * Rate-limit `POST /api/presentations/:id/reactions` (REQ077), on the reaction
 * windows rather than the submission ones.
 *
 * Same two-window shape as {@link guardSubmission} and deliberately *not* the
 * same counters — see {@link REACTION_PARTICIPANT_RULE} for why a participant
 * who reacts a lot must still be able to answer the next question.
 */
export function guardReaction(
	{ request, server }: GuardContext,
	participantId: string,
): Response | null {
	if (!rateLimitsEnabled()) return null;
	const addressVerdict = reactionAddressWindow.check(clientKey(request, server));
	if (!addressVerdict.allowed) {
		return tooManyRequests(addressVerdict.retryAfterSeconds, REACTION_MESSAGE);
	}
	const participantVerdict = reactionParticipantWindow.check(
		participantId || "anonymous",
	);
	if (!participantVerdict.allowed) {
		return tooManyRequests(
			participantVerdict.retryAfterSeconds,
			REACTION_MESSAGE,
		);
	}
	return null;
}
