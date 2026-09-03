/**
 * Run the read-modify-write sections that share a key one at a time.
 *
 * Every "check what is stored, then decide what to store" in this server is a
 * race waiting for a second caller. zodstore is synchronous underneath,
 * but the {@link Store} interface that wraps it is `async` — so an `await`
 * between the read and the write yields to the event loop, and Bun happily runs
 * the next request's handler into the same gap. Both callers read the same
 * "nothing is there yet" and both write.
 *
 * That is tolerable where a later submission replaces an earlier one: a ranking,
 * a points ballot, a guess and a pin all collapse the extras on the
 * participant's next write. It is **not** tolerable on a quiz question, which
 * permanently refuses that next write (REQ054 — one final answer), so a deck
 * that ends up holding two rows has no path back to one.
 *
 * This closes the gap the only way a single process can: the section is queued
 * behind whatever else holds its key, so the second caller reads what the first
 * one wrote rather than the state that predated it.
 *
 * Two things it deliberately is **not**:
 *
 *  - **Not a distributed lock.** The queue lives in this process's memory, which
 *    matches how omul ships (one container) and matches the stance
 *    `server/rate-limit.ts` already takes about its counters. Running several
 *    replicas would put each on its own queue, and the racing writes this
 *    prevents would come back.
 *  - **Not a transaction.** Nothing here rolls anything back. It serializes;
 *    what the section does with its turn is the section's business.
 *
 * Keys are opaque strings and the granularity is the caller's choice. Pick the
 * narrowest key that still covers the invariant — `presentation:slide:participant`
 * rather than `presentation` — so two participants answering at once are not
 * queued behind each other for no reason.
 */

/** A queue of critical sections, keyed by whatever they must not interleave on. */
export interface KeyedLock {
	/**
	 * Run `section` once every section already queued under `key` has finished,
	 * and hand back whatever it returns. A section that throws still releases the
	 * key, and the throw reaches this caller rather than the one behind it.
	 */
	run<TResult>(key: string, section: () => Promise<TResult>): Promise<TResult>;
	/** How many keys currently have a section queued (tests, introspection). */
	trackedKeys(): number;
}

/** Swallow a settled section's outcome — the queue only needs the timing. */
function ignoreOutcome(): void {}

/**
 * A keyed lock (factory over class).
 *
 * Each key holds the tail of its own promise chain, and a section is appended to
 * it. There is no timer and no cleanup pass: the key is dropped as soon as the
 * last section under it finishes, so the map is the size of the *contended*
 * keys at this instant rather than of every key ever locked.
 */
export function createKeyedLock(): KeyedLock {
	// The stored tail never rejects — see `ignoreOutcome` — so appending to it is
	// always "wait for the turn", never "inherit the failure".
	const tailByKey = new Map<string, Promise<void>>();

	async function run<TResult>(
		key: string,
		section: () => Promise<TResult>,
	): Promise<TResult> {
		const waitForTurn = tailByKey.get(key) ?? Promise.resolve();
		const settled = waitForTurn.then(section);
		const tail = settled.then(ignoreOutcome, ignoreOutcome);
		tailByKey.set(key, tail);
		try {
			return await settled;
		} finally {
			// Only the last section out clears the key. A section that queued behind
			// this one has already replaced the tail, and deleting it would let a
			// third caller start in parallel with the one still running.
			if (tailByKey.get(key) === tail) tailByKey.delete(key);
		}
	}

	return { run, trackedKeys: () => tailByKey.size };
}
