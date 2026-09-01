/**
 * What this server believes a reverse proxy in front of it has told it.
 *
 * `X-Forwarded-*` headers are caller-supplied: a client talking to a
 * directly-exposed server can write anything it likes into them. So this server
 * reads none of them by default, and reads them only as far as the operator has
 * said a proxy exists — `OMUL_TRUST_PROXY`, one number, applying to every
 * forwarded header alike. There is deliberately no per-header switch: "is there
 * a proxy in front of me, and how many hops" is one fact about a deployment,
 * and two surfaces answering it differently is how one of them ends up wrong.
 *
 * Two surfaces consume it today, for different reasons:
 *
 *  - `clientAddress` in `server/rate-limit.ts` — which client a request is
 *    counted under (`X-Forwarded-For`). Believing a caller here hands it a
 *    fresh bucket per request and voids every abuse limit.
 *  - `publicOrigin` in `server/routes/discovery.ts` — the origin the `/api`
 *    discovery index advertises (`X-Forwarded-Proto` / `X-Forwarded-Host`).
 *    Believing a caller here lets it choose the links this server hands the
 *    next client.
 *
 * This module owns the trust decision itself. Reading a *specific* header is the
 * consumer's job, because what to do when the header is absent differs: the
 * limiter falls back to the socket address and says so once, the discovery index
 * falls back to the origin the request arrived on.
 */

/**
 * How many reverse-proxy hops in front of this server are trusted to have
 * written the tail of a forwarded header. `0` (the default) means no forwarded
 * header is believed at all.
 *
 * `"true"` reads as `1` — the documented Caddy topology, one proxy — and a
 * positive integer names a longer chain (CDN in front of Caddy is `2`).
 * Anything else, including `"false"`, a typo or a non-integer, reads as `0`,
 * so a mis-set variable distrusts the headers rather than believing them.
 */
export function trustedProxyHops(): number {
	const configured = process.env.OMUL_TRUST_PROXY;
	if (!configured) return 0;
	if (configured === "true") return 1;
	const hops = Number(configured);
	return Number.isInteger(hops) && hops > 0 ? hops : 0;
}

/**
 * What the trusted proxy hop wrote into `headerName`, or `null` when no hop is
 * trusted, the header is absent, or the chain in it is shorter than the trusted
 * hop count.
 *
 * A forwarded header is a comma-separated list that each proxy **appends** its
 * own observation to, so it reads `<whatever the caller wrote>, <what proxy 1
 * saw>, … <what proxy N saw>`: everything left of the trusted tail is
 * attacker-supplied. The entry `trustedProxyHops()` in from the **right** is
 * therefore the one taken — the last observation this server has a reason to
 * believe. A proxy that *sets* rather than appends (Caddy does this for
 * `X-Forwarded-Proto` and `X-Forwarded-Host`) leaves a one-entry list, which is
 * the same entry under the same rule.
 */
export function trustedForwardedValue(
	request: Request,
	headerName: string,
): string | null {
	const hops = trustedProxyHops();
	if (hops < 1) return null;
	const chain = (request.headers.get(headerName) ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	return chain[chain.length - hops] ?? null;
}
