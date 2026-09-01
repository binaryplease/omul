/**
 * Fold repeated work on the same key into one run per window.
 *
 * Some of what this server recomputes is a **whole-deck aggregate that only has
 * a latest value**. The leaderboard (REQ059) is the case this exists for: it is
 * derived rather than stored, so every quiz answer that lands re-reads and
 * re-scores every quiz slide in the deck and pushes the board to every socket in
 * the room. Three hundred people answering one question that way is three
 * hundred full deck rescans and three hundred room-wide broadcasts, of which two
 * hundred and ninety-nine describe a board nobody had time to read.
 *
 * The fix is not to run less often *than the truth changes* — it is to notice
 * that the truth is a single value, so N changes inside one window have exactly
 * one answer. This runs the work immediately for the first caller, holds the key
 * for `windowMs`, and folds everything that arrives in the meantime into one
 * trailing run at the end of it.
 *
 * The property that makes this safe to put on a hot path:
 *
 *   **No trigger is ever dropped, only merged.** A call that arrives during an
 *   open window does not "miss" the update — it marks the key and the trailing
 *   run carries it. The last caller's change is always in the last run, so the
 *   value the room ends up holding is the value the store ends up holding. That
 *   is why this is a coalescer and not a cache: a cache is correct only while
 *   every writer remembers to invalidate it, and a missed invalidation is a
 *   board that is silently wrong forever. The worst this can do is be up to
 *   `windowMs` late.
 *
 * The cost stops scaling with the room. Before, a burst of N answers cost N
 * rescans; now a question of duration D costs at most `D / windowMs` of them
 * however many people answered, so a thousand-person room costs what a forty
 * person one does.
 *
 * Two things it deliberately is **not**:
 *
 *  - **Not a debounce.** A debounce that restarted its timer on every call would
 *    starve the board for the whole time the room was answering — which is
 *    precisely when it is worth watching. The leading run fires immediately and
 *    the window is not extended by the calls it absorbs, so the board moves at
 *    the start of a burst, throughout it, and once more when it settles.
 *  - **Not a queue.** Nothing is buffered and nothing is replayed. The work is
 *    re-run from whatever is stored at the time it runs, so the merged result is
 *    the current one rather than an accumulation of stale ones. Serializing
 *    read-modify-write sections is `server/keyed-lock.ts`, a different problem.
 */

/** How a pending trailing run is scheduled, and how it is called off. */
export type TimerFactory = (callback: () => void, delayMs: number) => () => void;

/**
 * The real timer. `unref` so a pending trailing run never holds the process
 * open: a test run finishing, or a server shutting down, has nothing to gain
 * from one last board update, and a timer that kept either alive would be a
 * hang rather than a feature.
 */
function scheduleWithTimeout(callback: () => void, delayMs: number): () => void {
	const handle = setTimeout(callback, delayMs);
	handle.unref();
	return () => clearTimeout(handle);
}

interface CoalescerOptions {
	/**
	 * How long one run holds its key. Everything arriving inside the window is
	 * folded into a single run at the end of it, so this is also the longest the
	 * result can be behind the store.
	 */
	windowMs: number;
	/** The work itself. Run at most once per key per window. */
	work: (key: string) => Promise<void>;
	/**
	 * What a **trailing** run does when it throws. It runs detached from any
	 * request, so without this an unhandled rejection would take the process with
	 * it. A leading run's failure is not routed here — it belongs to the caller
	 * who is still awaiting it.
	 */
	onError?: (key: string, cause: unknown) => void;
	/** Timer override, so tests fire a trailing run instead of waiting for it. */
	setTimer?: TimerFactory;
}

/** Work folded into one run per key per window. */
export interface Coalescer {
	/**
	 * Ask for the work on `key`.
	 *
	 * The first caller of a quiet key runs it and **awaits it**, so a lone change
	 * is as immediate as it was before any of this existed — and so a caller that
	 * cares about the failure still receives it. A caller arriving inside an open
	 * window marks the key and returns at once; the trailing run carries their
	 * change.
	 */
	run(key: string): Promise<void>;
	/** Cancel every pending trailing run and forget every key (tests). */
	reset(): void;
	/** How many keys currently hold an open window (tests, introspection). */
	pendingKeys(): number;
}

/** One key's open window: whether anything moved in it, and its pending timer. */
interface OpenWindow {
	dirty: boolean;
	cancel: () => void;
}

/** Ignore a trailing run's failure when the caller supplied no handler. */
function ignoreError(): void {}

/**
 * A coalescer (ADR-0007 — factory over class).
 *
 * A key is in the map exactly while its window is open, so the map is the size
 * of the *currently busy* keys rather than of every key ever run — the same
 * stance `server/keyed-lock.ts` takes about its queues.
 */
export function createCoalescer(options: CoalescerOptions): Coalescer {
	const { windowMs, work } = options;
	const setTimer = options.setTimer ?? scheduleWithTimeout;
	const onError = options.onError ?? ignoreError;
	const windowByKey = new Map<string, OpenWindow>();

	/**
	 * Hold `key` for one window, then either run once more for whatever arrived
	 * during it or let the key go.
	 *
	 * Re-entered after each trailing run rather than looping, so a key that keeps
	 * being marked keeps its cadence — one run per window for as long as the room
	 * is answering — instead of one run and then silence.
	 */
	function holdWindow(key: string, open: OpenWindow): void {
		open.cancel = setTimer(() => {
			if (!open.dirty) {
				// Nothing moved while the window was open, so there is nothing to
				// send and no reason to keep holding the key.
				windowByKey.delete(key);
				return;
			}
			// Cleared *before* the run, not after: a change landing while this run
			// is in flight has to mark the key again and earn its own trailing run,
			// or it would be folded into a result computed before it happened.
			open.dirty = false;
			work(key)
				.catch((cause: unknown) => onError(key, cause))
				.finally(() => holdWindow(key, open));
		}, windowMs);
	}

	async function run(key: string): Promise<void> {
		const open = windowByKey.get(key);
		if (open) {
			open.dirty = true;
			return;
		}
		// Registered before the work is awaited, so a caller arriving while the
		// leading run is still in flight is absorbed by this window rather than
		// starting a second one beside it.
		const fresh: OpenWindow = { dirty: false, cancel: ignoreError };
		windowByKey.set(key, fresh);
		try {
			await work(key);
		} finally {
			holdWindow(key, fresh);
		}
	}

	function reset(): void {
		for (const open of windowByKey.values()) open.cancel();
		windowByKey.clear();
	}

	return { run, reset, pendingKeys: () => windowByKey.size };
}
