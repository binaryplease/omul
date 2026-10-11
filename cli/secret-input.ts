/**
 * Reading a secret from a person, without putting it anywhere it can be read
 * back.
 *
 * `omul auth login` takes the API key here rather than from a flag, and that is
 * the whole point of the command existing: a key typed as an argument is in the
 * shell's history file and in `/proc/<pid>/cmdline` for every process the user
 * runs, permanently and by the time anyone notices. Typed at this prompt it is
 * echoed nowhere, held in one string, and written straight to a `0600` file.
 *
 * Two paths, because both callers are real:
 *
 *  - **A terminal.** Raw mode, so the key is not echoed as it is typed and does
 *    not end up on a shared screen or in a recorded session. Terminal state is
 *    restored in a `finally`, including when the caller interrupts.
 *  - **A pipe.** `omul auth login < key.txt`, or a secret manager piping into
 *    it. The first line is the key, and everything after it is ignored — a
 *    trailing newline from `echo` must not become part of the credential.
 */

import { CliError } from "./errors";

/**
 * Ctrl-C, as a raw-mode terminal delivers it — there is no signal handler in
 * raw mode, so the interrupt has to be recognized by its byte.
 */
const END_OF_TEXT = "\u0003";

/**
 * The key most terminals send for backspace. `\b` is handled beside it for the
 * ones that send that instead.
 */
const DELETE = "\u007f";

/** The first line of a piped secret, with the line ending stripped. */
export function firstLine(text: string): string {
	const [line = ""] = text.split(/\r?\n/, 1);
	return line.trim();
}

/**
 * Prompt on stderr (so `--json` on stdout stays machine-readable) and read a
 * secret without echoing it.
 */
export async function readSecret(promptText: string): Promise<string> {
	if (!process.stdin.isTTY) {
		return firstLine(await Bun.stdin.text());
	}
	return readFromTerminal(promptText);
}

/**
 * The terminal path. Not covered by the test suite — it needs a real TTY — so
 * it is kept to the smallest thing that can work: read code points, act on the
 * four control characters that matter, and always put the terminal back.
 */
async function readFromTerminal(promptText: string): Promise<string> {
	const input = process.stdin;
	process.stderr.write(promptText);
	input.setRawMode(true);
	input.resume();
	const decoder = new TextDecoder();
	let typed = "";
	try {
		reading: for await (const chunk of input) {
			const text = decoder.decode(chunk as Uint8Array, { stream: true });
			for (const character of text) {
				if (character === END_OF_TEXT) {
					throw new CliError("Interrupted — nothing was written.");
				}
				if (character === "\r" || character === "\n") break reading;
				if (character === DELETE || character === "\b") {
					typed = typed.slice(0, -1);
					continue;
				}
				typed += character;
			}
		}
	} finally {
		input.setRawMode(false);
		input.pause();
		process.stderr.write("\n");
	}
	return typed.trim();
}
