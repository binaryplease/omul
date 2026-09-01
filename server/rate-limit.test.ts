/**
 * Unit tests for the abuse limiter (REQ145) — the sliding window itself, the
 * two environment switches, and how a client is identified.
 *
 * The route wiring is covered separately in `rate-limit.integration.test.ts`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	clientAddress,
	clientBucketKey,
	clientKey,
	createSlidingWindow,
	rateLimitsEnabled,
	rateLimitStartupReport,
	resetRateLimitNotices,
	tooManyRequests,
	trustedProxyHops,
	untrustedProxyNotice,
} from "./rate-limit";

/** A request carrying whatever proxy headers a case wants to present. */
function requestWith(headers: Record<string, string> = {}): Request {
	return new Request("http://omul.test/api/presentations", { headers });
}

/** A stand-in for Bun's server, reporting a fixed socket address. */
function socketAt(address: string | null) {
	return {
		requestIP: () => (address === null ? null : { address }),
	};
}

describe("sliding window", () => {
	test("allows up to the limit, then refuses with a retry hint", () => {
		let clock = 1_000_000;
		const window = createSlidingWindow(
			{ limit: 3, windowMs: 10_000 },
			{ now: () => clock },
		);

		expect(window.check("alice").allowed).toBe(true);
		clock += 1_000;
		expect(window.check("alice").allowed).toBe(true);
		clock += 1_000;
		expect(window.check("alice").allowed).toBe(true);

		clock += 1_000;
		const refused = window.check("alice");
		expect(refused.allowed).toBe(false);
		// The first hit landed 3s ago in a 10s window, so capacity returns in 7s.
		expect(refused.retryAfterSeconds).toBe(7);
	});

	test("the retry hint is never zero while refusing", () => {
		let clock = 0;
		const window = createSlidingWindow(
			{ limit: 1, windowMs: 1_000 },
			{ now: () => clock },
		);
		window.check("alice");
		clock += 999;
		const refused = window.check("alice");
		expect(refused.allowed).toBe(false);
		expect(refused.retryAfterSeconds).toBe(1);
	});

	test("capacity returns as the window slides past the old hits", () => {
		let clock = 0;
		const window = createSlidingWindow(
			{ limit: 2, windowMs: 10_000 },
			{ now: () => clock },
		);
		expect(window.check("alice").allowed).toBe(true);
		expect(window.check("alice").allowed).toBe(true);
		expect(window.check("alice").allowed).toBe(false);

		clock += 10_001;
		expect(window.check("alice").allowed).toBe(true);
	});

	test("a refused hit does not push the window forward", () => {
		let clock = 0;
		const window = createSlidingWindow(
			{ limit: 1, windowMs: 10_000 },
			{ now: () => clock },
		);
		window.check("alice");

		// Hammer while refused — the recorded hit must stay the original one.
		clock += 5_000;
		for (const _attempt of [1, 2, 3, 4, 5]) window.check("alice");

		// 10s after the *first* hit, capacity is back despite the hammering.
		clock = 10_001;
		expect(window.check("alice").allowed).toBe(true);
	});

	test("keys are counted independently", () => {
		const window = createSlidingWindow({ limit: 1, windowMs: 10_000 });
		expect(window.check("alice").allowed).toBe(true);
		expect(window.check("alice").allowed).toBe(false);
		expect(window.check("bob").allowed).toBe(true);
	});

	test("the sweep drops keys whose hits have all expired", () => {
		let clock = 0;
		const window = createSlidingWindow(
			{ limit: 5, windowMs: 1_000 },
			{ now: () => clock, sweepEveryChecks: 3 },
		);
		window.check("alice");
		window.check("bob");
		expect(window.trackedKeys()).toBe(2);

		clock += 5_000;
		// The third check triggers the sweep, which drops alice and bob.
		window.check("carol");
		expect(window.trackedKeys()).toBe(1);
	});

	test("reset forgets everything", () => {
		const window = createSlidingWindow({ limit: 1, windowMs: 10_000 });
		window.check("alice");
		expect(window.trackedKeys()).toBe(1);
		window.reset();
		expect(window.trackedKeys()).toBe(0);
		expect(window.check("alice").allowed).toBe(true);
	});
});

describe("environment switches", () => {
	afterEach(() => {
		// The preload (server/test-preload.ts) leaves the run with limits off.
		process.env.OMUL_RATE_LIMITS_DISABLED = "true";
		delete process.env.OMUL_TRUST_PROXY;
	});

	test("limits are on unless the switch says exactly 'true'", () => {
		delete process.env.OMUL_RATE_LIMITS_DISABLED;
		expect(rateLimitsEnabled()).toBe(true);

		// A near miss must not disarm the protection.
		process.env.OMUL_RATE_LIMITS_DISABLED = "1";
		expect(rateLimitsEnabled()).toBe(true);
		process.env.OMUL_RATE_LIMITS_DISABLED = "yes";
		expect(rateLimitsEnabled()).toBe(true);
		process.env.OMUL_RATE_LIMITS_DISABLED = "TRUE";
		expect(rateLimitsEnabled()).toBe(true);

		process.env.OMUL_RATE_LIMITS_DISABLED = "true";
		expect(rateLimitsEnabled()).toBe(false);
	});

	test("no proxy hop is trusted unless the switch names one", () => {
		delete process.env.OMUL_TRUST_PROXY;
		expect(trustedProxyHops()).toBe(0);

		// A mis-set variable distrusts the header rather than believing it.
		for (const misconfigured of ["", "false", "yes", "TRUE", "0", "-1", "1.5"]) {
			process.env.OMUL_TRUST_PROXY = misconfigured;
			expect(trustedProxyHops()).toBe(0);
		}

		process.env.OMUL_TRUST_PROXY = "true";
		expect(trustedProxyHops()).toBe(1);
		process.env.OMUL_TRUST_PROXY = "2";
		expect(trustedProxyHops()).toBe(2);
	});
});

describe("client identity", () => {
	afterEach(() => {
		delete process.env.OMUL_TRUST_PROXY;
	});

	test("a spoofed X-Forwarded-For is ignored by default", () => {
		const request = requestWith({
			"x-forwarded-for": "1.2.3.4",
			"x-real-ip": "5.6.7.8",
		});
		expect(clientAddress(request, socketAt("198.51.100.7"))).toBe(
			"198.51.100.7",
		);
	});

	test("a forwarded hop the caller prepended is never taken for the client", () => {
		// The shipping posture: one Caddy hop, which *appends* the peer it saw.
		// An attacker writing its own X-Forwarded-For lands to the left of that
		// appended entry and must not be the value counted, or every limit here
		// is bypassed by sending a fresh random value per request.
		process.env.OMUL_TRUST_PROXY = "true";
		const spoofed = requestWith({ "x-forwarded-for": "9.9.9.9, 127.0.0.1" });
		expect(clientAddress(spoofed, socketAt("127.0.0.1"))).toBe("127.0.0.1");

		// Two callers spoofing different values behind the same peer stay in the
		// same bucket — there is no fresh identity to mint.
		const otherSpoof = requestWith({
			"x-forwarded-for": "8.8.8.8, 203.0.113.5, 127.0.0.1",
		});
		expect(clientAddress(otherSpoof, socketAt("127.0.0.1"))).toBe("127.0.0.1");
	});

	test("with one trusted hop, the proxy's own observation wins", () => {
		process.env.OMUL_TRUST_PROXY = "true";
		const request = requestWith({
			"x-forwarded-for": "1.2.3.4, 10.0.0.1, 203.0.113.9",
		});
		expect(clientAddress(request, socketAt("10.0.0.9"))).toBe("203.0.113.9");
	});

	test("a longer trusted chain counts that many hops in from the right", () => {
		process.env.OMUL_TRUST_PROXY = "2";
		const request = requestWith({
			"x-forwarded-for": "1.2.3.4, 203.0.113.9, 10.0.0.1",
		});
		expect(clientAddress(request, socketAt("10.0.0.9"))).toBe("203.0.113.9");
	});

	test("fewer forwarded entries than trusted hops falls back to the socket", () => {
		// Nothing in the header was written by a hop this server trusts, so the
		// header is not believed at all.
		process.env.OMUL_TRUST_PROXY = "2";
		const request = requestWith({ "x-forwarded-for": "9.9.9.9" });
		expect(clientAddress(request, socketAt("10.0.0.9"))).toBe("10.0.0.9");
	});

	test("X-Real-IP is not believed even with proxy trust on", () => {
		// It carries no hop chain, so a proxy's observation and a caller's claim
		// are indistinguishable.
		process.env.OMUL_TRUST_PROXY = "true";
		const request = requestWith({ "x-real-ip": "5.6.7.8" });
		expect(clientAddress(request, socketAt("10.0.0.9"))).toBe("10.0.0.9");
	});

	test("with proxy trust on but no headers, the socket address is used", () => {
		process.env.OMUL_TRUST_PROXY = "true";
		expect(clientAddress(requestWith(), socketAt("10.0.0.9"))).toBe("10.0.0.9");
	});

	test("an unidentifiable caller falls into one shared bucket", () => {
		expect(clientAddress(requestWith(), socketAt(null))).toBe("unknown");
		expect(clientAddress(requestWith(), null)).toBe("unknown");
	});
});

describe("what an address counts as (IPv6 /64)", () => {
	test("an IPv4 address is one client, keyed whole", () => {
		expect(clientBucketKey("198.51.100.7")).toBe("198.51.100.7");
		expect(clientBucketKey("10.0.0.1")).toBe("10.0.0.1");
	});

	test("every address in one IPv6 /64 is the same client", () => {
		// The evasion this exists to refuse: a subscriber holding a routed /64 can
		// source from any of 2^64 addresses in it, so keying the full address lets
		// one machine mint a fresh bucket per request through the socket — the
		// same bypass the X-Forwarded-For rules refuse through the header.
		const first = clientBucketKey("2001:db8:1234:5678::1");
		expect(clientBucketKey("2001:db8:1234:5678::2")).toBe(first);
		expect(clientBucketKey("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd")).toBe(first);
		expect(first).toBe("2001:db8:1234:5678::/64");
	});

	test("a different /64 is a different client", () => {
		expect(clientBucketKey("2001:db8:1234:5678::1")).not.toBe(
			clientBucketKey("2001:db8:1234:9999::1"),
		);
	});

	test("the prefix is read the same however the address is spelled", () => {
		// Leading zeroes, case, and where the `::` run sits are notation, not
		// identity — two spellings of one prefix must not be two buckets.
		const canonical = clientBucketKey("2001:db8:0:1::5");
		expect(clientBucketKey("2001:0DB8:0000:0001:0000:0000:0000:0005")).toBe(
			canonical,
		);
		expect(clientBucketKey("2001:db8::1:0:0:0:5")).toBe(canonical);
	});

	test("an IPv4-mapped address is its IPv4 client, never a /64", () => {
		// This is the form a dual-stack socket reports every IPv4 peer in, so
		// truncating it would put the entire IPv4 internet into one `::/64`
		// bucket — a far worse collapse than the one being fixed.
		expect(clientBucketKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
		expect(clientBucketKey("::ffff:127.0.0.1")).toBe("127.0.0.1");
		expect(clientBucketKey("::FFFF:10.0.0.1")).toBe("10.0.0.1");
		expect(clientBucketKey("::ffff:198.51.100.7")).not.toBe(
			clientBucketKey("::ffff:198.51.100.8"),
		);
	});

	test("a port never makes a second bucket out of one client", () => {
		// Some proxies write the peer's port into X-Forwarded-For. Left on, every
		// connection from one client would be its own bucket.
		expect(clientBucketKey("198.51.100.7:54321")).toBe("198.51.100.7");
		expect(clientBucketKey("[2001:db8:1234:5678::1]:443")).toBe(
			"2001:db8:1234:5678::/64",
		);
		expect(clientBucketKey("198.51.100.7:1")).toBe(
			clientBucketKey("198.51.100.7:2"),
		);
	});

	test("a zone id is not part of the identity", () => {
		expect(clientBucketKey("fe80::1%eth0")).toBe(clientBucketKey("fe80::2%wlan0"));
	});

	test("something that is not an address is still one client, not the shared bucket", () => {
		// Keyed whole rather than discarded into `unknown`, where it would spend a
		// budget belonging to callers it has nothing to do with.
		expect(clientBucketKey("not-an-address")).toBe("not-an-address");
		expect(clientBucketKey("Mixed-CASE-Host")).toBe("mixed-case-host");
		expect(clientBucketKey("   ")).toBe("unknown");
		expect(clientBucketKey("unknown")).toBe("unknown");
	});

	test("the key is what the guards count, address resolution and all", () => {
		process.env.OMUL_TRUST_PROXY = "true";
		const first = requestWith({
			"x-forwarded-for": "9.9.9.9, 2001:db8:1234:5678::1",
		});
		const second = requestWith({
			"x-forwarded-for": "8.8.8.8, 2001:db8:1234:5678::ffff",
		});
		// Two addresses, one subscriber: the same budget.
		expect(clientKey(first, socketAt("10.0.0.9"))).toBe(
			clientKey(second, socketAt("10.0.0.9")),
		);
		delete process.env.OMUL_TRUST_PROXY;
	});

	test("an IPv6 socket peer is bucketed by /64 too", () => {
		// No proxy trusted: the address comes off the socket, and the truncation
		// has to apply there as well or a directly-exposed server keeps the hole.
		expect(
			clientKey(requestWith(), socketAt("2001:db8:1234:5678::1")),
		).toBe(clientKey(requestWith(), socketAt("2001:db8:1234:5678::2")));
	});
});

describe("saying so when the deployment is misconfigured", () => {
	afterEach(() => {
		process.env.OMUL_RATE_LIMITS_DISABLED = "true";
		delete process.env.OMUL_TRUST_PROXY;
		resetRateLimitNotices();
	});

	test("the startup report names the posture when limits are off", () => {
		process.env.OMUL_RATE_LIMITS_DISABLED = "true";
		const report = rateLimitStartupReport().join(" ");
		expect(report).toContain("OFF");
		expect(report).toContain("OMUL_RATE_LIMITS_DISABLED");
	});

	test("the startup report names the trusted hop count when one is set", () => {
		delete process.env.OMUL_RATE_LIMITS_DISABLED;
		process.env.OMUL_TRUST_PROXY = "2";
		const report = rateLimitStartupReport().join(" ");
		expect(report).toContain("on");
		expect(report).toContain("2 proxy hop");
		// Nothing to warn about: this deployment has said what it is.
		expect(report).not.toContain("Behind a reverse proxy this is wrong");
	});

	test("the startup report warns when no hop is trusted", () => {
		// The posture that is right for a directly-exposed server and silently
		// wrong behind a proxy — the whole reason this report exists.
		delete process.env.OMUL_RATE_LIMITS_DISABLED;
		delete process.env.OMUL_TRUST_PROXY;
		const report = rateLimitStartupReport().join(" ");
		expect(report).toContain("socket address");
		expect(report).toContain("OMUL_TRUST_PROXY");
		expect(report).toContain("Behind a reverse proxy this is wrong");
	});

	test("a proxied request at an untrusting server warns exactly once", () => {
		delete process.env.OMUL_RATE_LIMITS_DISABLED;
		delete process.env.OMUL_TRUST_PROXY;
		const warned: string[] = [];
		const original = console.warn;
		console.warn = (...parts: unknown[]) => warned.push(parts.join(" "));
		try {
			const proxied = requestWith({ "x-forwarded-for": "203.0.113.9" });
			clientAddress(proxied, socketAt("10.0.0.1"));
			clientAddress(proxied, socketAt("10.0.0.1"));
			clientAddress(proxied, socketAt("10.0.0.1"));
		} finally {
			console.warn = original;
		}
		expect(warned).toEqual([untrustedProxyNotice()]);
		expect(warned[0]).toContain("OMUL_TRUST_PROXY");
		// Both readings are spelled out, because from in here they are genuinely
		// indistinguishable and asserting the wrong one would be noise.
		expect(warned[0]).toContain("If a reverse proxy sits in front");
		expect(warned[0]).toContain("If this server is directly exposed");
	});

	test("nothing is said when the header is absent, trusted, or the limits are off", () => {
		const warned: string[] = [];
		const original = console.warn;
		console.warn = (...parts: unknown[]) => warned.push(parts.join(" "));
		try {
			// No header: nothing suggests a proxy is in front.
			delete process.env.OMUL_RATE_LIMITS_DISABLED;
			clientAddress(requestWith(), socketAt("10.0.0.1"));

			// Header present and a hop trusted: the deployment is configured.
			process.env.OMUL_TRUST_PROXY = "true";
			clientAddress(
				requestWith({ "x-forwarded-for": "203.0.113.9" }),
				socketAt("10.0.0.1"),
			);

			// Limits off: there is no per-client key to be missing.
			delete process.env.OMUL_TRUST_PROXY;
			process.env.OMUL_RATE_LIMITS_DISABLED = "true";
			clientAddress(
				requestWith({ "x-forwarded-for": "203.0.113.9" }),
				socketAt("10.0.0.1"),
			);
		} finally {
			console.warn = original;
		}
		expect(warned).toEqual([]);
	});
});

describe("the 429", () => {
	test("carries the retry hint in both the header and the body", async () => {
		const response = tooManyRequests(42, "Slow down");
		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("42");
		expect(response.headers.get("Content-Type")).toBe("application/json");
		expect(await response.json()).toEqual({
			error: "Slow down",
			retryAfterSeconds: 42,
		});
	});
});
