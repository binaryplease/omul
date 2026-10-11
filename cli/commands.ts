/**
 * The verbs, and what each one prints.
 *
 * Every command returns both readings of its result — a `data` payload for
 * `--json` and the lines a person reads — rather than printing anything itself.
 * That keeps the decision "who is reading this" in one place (`cli/index.ts`)
 * and makes each verb a function a test can call and read the answer off.
 *
 * The surface is deliberately **narrower than the API**. REQ180's outcome is
 * the round trip a presenter cannot otherwise make without a browser — create a
 * deck, read its state, read its results — plus the two things that trip in
 * front of it: proving the server is there, and getting a credential onto disk
 * safely. Every further verb group (starting and ending a session, navigating
 * slides, exporting a workbook, the Q&A layer) is its own record, and a client
 * that cannot yet do everything the browser can is still the whole of this one.
 */

import {
	flagValue,
	type ParsedArguments,
	requiredWord,
	requireKnownFlags,
} from "./args";
import { type ApiClient, createApiClient } from "./client";
import {
	API_KEY_VARIABLE,
	configFilePath,
	readConfigFile,
	removeConfigFile,
	resolveSettings,
	type Settings,
	writeConfigFile,
} from "./config";
import { readDeckDocument, withGeneratedIds } from "./deck";
import {
	editTokensPath,
	heldPresentationIds,
	storeEditToken,
} from "./edit-tokens";
import { CliError, UsageError } from "./errors";
import {
	asArray,
	asRecord,
	optionalNumber,
	optionalString,
	optionalBoolean,
	requiredString,
} from "./payload";
import { display, EMPTY_MARKER, labelled, plural, table } from "./render";
import { readSecret } from "./secret-input";

/** What a command hands back: the same result in both readings. */
export interface CommandOutput {
	/** Printed verbatim by `--json`. */
	data: unknown;
	/** Printed otherwise, one per line. */
	lines: string[];
}

/** Options every command takes. */
const GLOBAL_FLAGS = ["server", "json"] as const;

/** Dispatch one parsed command line. */
export async function runCommand(
	parsed: ParsedArguments,
): Promise<CommandOutput> {
	const command = parsed.words[0] ?? "";
	switch (command) {
		case "health":
			return commandHealth(parsed);
		case "auth":
			return commandAuth(parsed);
		case "templates":
			return commandTemplates(parsed);
		case "create":
			return commandCreate(parsed);
		case "list":
			return commandList(parsed);
		case "show":
			return commandShow(parsed);
		case "results":
			return commandResults(parsed);
		default:
			throw new UsageError(
				`Unknown command: ${JSON.stringify(command)}. Run \`omul help\` for the list.`,
			);
	}
}

// ── Reaching a server ────────────────────────────────────────

/**
 * Resolve the settings and build the client for one command, refusing any flag
 * that command does not take.
 */
function connect(
	parsed: ParsedArguments,
	allowed: readonly string[],
	command: string,
): { client: ApiClient; settings: Settings } {
	requireKnownFlags(parsed, [...GLOBAL_FLAGS, ...allowed], command);
	const settings = resolveSettings(flagValue(parsed, "server"));
	return { client: createApiClient(settings), settings };
}

/**
 * Stop before the request for a command that is meaningless without an account.
 *
 * The server answers such a call with a `401` that says "sign in", which is the
 * right thing for it to say and the wrong thing for a caller to read: there is
 * no sign-in here, there is a key that was never configured. So the client says
 * that instead, and says where a key goes.
 */
function requireAccount(settings: Settings, command: string): void {
	if (settings.apiKey) return;
	throw new CliError(
		`\`omul ${command}\` reads what an account owns, and no API key is configured. ` +
			`Run \`omul auth login\`, or export ${API_KEY_VARIABLE}.`,
	);
}

// ── health ───────────────────────────────────────────────────

async function commandHealth(parsed: ParsedArguments): Promise<CommandOutput> {
	const { client, settings } = connect(parsed, [], "health");
	const health = asRecord(await client.get("/api/health"), "health probe");
	const discovery = asRecord(await client.get("/api"), "discovery index");
	const links = asRecord(discovery.links ?? {}, "discovery index links");

	const lines = labelled([
		["Server", `${settings.baseUrl} (${settings.baseUrlSource})`],
		["Health", optionalBoolean(health, "ok") ? "ok" : "not ok"],
		[
			"API",
			`${display(optionalString(discovery, "name"))} ${display(
				optionalString(discovery, "version"),
			)}`,
		],
	]);
	lines.push("", "Links");
	lines.push(
		...table(
			Object.entries(links).map(([name, value]) => [
				`  ${name}`,
				display(value),
			]),
		),
	);
	return { data: { baseUrl: settings.baseUrl, health, discovery }, lines };
}

// ── auth ─────────────────────────────────────────────────────

async function commandAuth(parsed: ParsedArguments): Promise<CommandOutput> {
	const subcommand = parsed.words[1] ?? "";
	switch (subcommand) {
		case "login":
			return commandAuthLogin(parsed);
		case "status":
			return commandAuthStatus(parsed);
		case "logout":
			return commandAuthLogout(parsed);
		default:
			throw new UsageError(
				"`omul auth` takes one of: login, status, logout.",
			);
	}
}

/**
 * Take the personal API key and put it somewhere only its owner can read.
 *
 * The key is read from a prompt that does not echo it, or from standard input —
 * never from a flag (see `cli/args.ts`). It is **checked before it is stored**:
 * a typo saved to disk would come back later as an unexplained `401` on some
 * other command, so the key is spent once on the account's own deck list and is
 * written only if the server accepts it.
 */
async function commandAuthLogin(
	parsed: ParsedArguments,
): Promise<CommandOutput> {
	requireKnownFlags(parsed, [...GLOBAL_FLAGS], "auth login");
	const serverFlag = flagValue(parsed, "server");
	const settings = resolveSettings(serverFlag);
	const stored = readConfigFile();

	const key = await readSecret(
		`Personal API key for ${settings.baseUrl} (not echoed): `,
	);
	if (key === "") {
		throw new CliError("No key was given — nothing was written.");
	}

	const probe = createApiClient({
		...settings,
		apiKey: key,
		apiKeySource: "prompt",
	});
	try {
		await probe.get("/api/presentations/mine");
	} catch (error) {
		throw new CliError(
			`${(error as Error).message}\n` +
				`The key was not stored. Mint one under account settings at ${settings.baseUrl} and try again.`,
		);
	}

	const path = writeConfigFile({
		// `--server` is what says "this key belongs to that server"; without it the
		// file keeps whatever server it already named, rather than pinning the
		// default and surprising a caller who had been passing --server all along.
		serverUrl: serverFlag ? settings.baseUrl : stored.serverUrl,
		apiKey: key,
	});

	const lines = [
		`Key accepted by ${settings.baseUrl} and written to ${path} (mode 0600).`,
	];
	if (settings.apiKeySource === "environment") {
		lines.push(
			`Note: ${API_KEY_VARIABLE} is set in this environment and takes precedence over the file.`,
		);
	}
	return {
		data: {
			baseUrl: settings.baseUrl,
			configFile: path,
			apiKeyStored: true,
			environmentOverride: settings.apiKeySource === "environment",
		},
		lines,
	};
}

/** What this client would use, and from where — without printing either secret. */
async function commandAuthStatus(
	parsed: ParsedArguments,
): Promise<CommandOutput> {
	requireKnownFlags(parsed, [...GLOBAL_FLAGS], "auth status");
	const settings = resolveSettings(flagValue(parsed, "server"));
	const held = heldPresentationIds();
	const data = {
		baseUrl: settings.baseUrl,
		baseUrlSource: settings.baseUrlSource,
		apiKeyConfigured: settings.apiKey !== null,
		apiKeySource: settings.apiKeySource,
		configFile: configFilePath(),
		editTokenStore: editTokensPath(),
		editTokensHeld: held.length,
	};
	const lines = labelled([
		["Server", `${settings.baseUrl} (${settings.baseUrlSource})`],
		[
			"API key",
			settings.apiKey
				? `configured (${settings.apiKeySource})`
				: `not configured — run \`omul auth login\` or set ${API_KEY_VARIABLE}`,
		],
		["Config file", configFilePath()],
		["Edit tokens", `${plural(held.length, "deck")} in ${editTokensPath()}`],
	]);
	return { data, lines };
}

/**
 * Forget the stored key. The edit tokens are deliberately left alone: they are
 * the only copy of the authorization for the decks this client created without
 * an account, and dropping them with a sign-out would destroy those decks'
 * editability for good. Signing out of an account is not disowning them.
 */
async function commandAuthLogout(
	parsed: ParsedArguments,
): Promise<CommandOutput> {
	requireKnownFlags(parsed, [...GLOBAL_FLAGS], "auth logout");
	const stored = readConfigFile();
	const path = configFilePath();
	const lines: string[] = [];
	let removed = false;

	if (stored.apiKey === null) {
		lines.push(`No API key was stored in ${path}.`);
	} else if (stored.serverUrl === null) {
		removeConfigFile();
		removed = true;
		lines.push(`Removed ${path}; it held nothing but the key.`);
	} else {
		writeConfigFile({ serverUrl: stored.serverUrl, apiKey: null });
		removed = true;
		lines.push(`Removed the API key from ${path}.`);
	}

	if (process.env[API_KEY_VARIABLE]) {
		lines.push(
			`Note: ${API_KEY_VARIABLE} is still set in this environment; this command cannot unset it.`,
		);
	}
	lines.push(
		`Edit tokens in ${editTokensPath()} were left alone — they are the only copy of what authorizes the decks created without an account.`,
	);
	return {
		data: { configFile: path, apiKeyRemoved: removed },
		lines,
	};
}

// ── templates ────────────────────────────────────────────────

async function commandTemplates(
	parsed: ParsedArguments,
): Promise<CommandOutput> {
	const { client } = connect(parsed, [], "templates");
	const payload = asArray(await client.get("/api/templates"), "templates");
	const rows = payload.map((entry) => {
		const template = asRecord(entry, "template");
		const slides = template.slides;
		return [
			requiredString(template, "id", "template"),
			display(optionalString(template, "title")),
			display(optionalString(template, "category")),
			plural(Array.isArray(slides) ? slides.length : 0, "slide"),
		];
	});
	const lines =
		rows.length === 0
			? ["This build ships no deck templates."]
			: table([["ID", "TITLE", "CATEGORY", "SLIDES"], ...rows]);
	return { data: payload, lines };
}

// ── create ───────────────────────────────────────────────────

/**
 * The two paces a deck can be run at, checked here so a typo is refused by
 * name rather than as a schema error from the far end.
 */
const DECK_MODES = ["live", "survey"];

/** Whether a field of a deck document states something rather than nothing. */
function isNonEmptyString(value: unknown): boolean {
	return typeof value === "string" && value.trim() !== "";
}

async function commandCreate(parsed: ParsedArguments): Promise<CommandOutput> {
	const { client, settings } = connect(
		parsed,
		["title", "deck", "template", "language", "mode"],
		"create",
	);

	const deckPath = flagValue(parsed, "deck");
	const body: Record<string, unknown> = deckPath
		? await readDeckDocument(deckPath)
		: {};

	const title = flagValue(parsed, "title");
	if (title !== null) body.title = title;
	const templateId = flagValue(parsed, "template");
	if (templateId !== null) body.templateId = templateId;
	const language = flagValue(parsed, "language");
	if (language !== null) body.language = language;
	const mode = flagValue(parsed, "mode");
	if (mode !== null) {
		if (!DECK_MODES.includes(mode)) {
			throw new UsageError(
				`--mode takes one of: ${DECK_MODES.join(", ")} — got ${JSON.stringify(mode)}.`,
			);
		}
		body.mode = mode;
	}

	// The server's own rule (`CreatePresentationSchema`): a deck carries its
	// slides, or it names the template they are copied from. Checked here so the
	// commonest mistake — `omul create --title x` and nothing else — is answered
	// with what to type rather than with a schema error from the far end.
	const slides = body.slides;
	const hasSlides = Array.isArray(slides) && slides.length > 0;
	const namesTemplate =
		isNonEmptyString(body.templateId) ||
		isNonEmptyString(body.workspaceTemplateId);
	if (!hasSlides && !namesTemplate) {
		throw new UsageError(
			"A deck has to come from somewhere: pass --deck <file> with its slides, or --template <id> " +
				"(`omul templates` lists them).",
		);
	}

	const created = asRecord(
		await client.post("/api/presentations", { body: withGeneratedIds(body) }),
		"create",
	);
	const presentationId = requiredString(created, "id", "create");

	// The edit token is returned exactly once. It goes straight to the store and
	// is dropped from everything this command reports — `--json` included, which
	// is the output most likely to be piped into a log.
	const editToken = optionalString(created, "creatorToken");
	const withoutToken = { ...created };
	delete withoutToken.creatorToken;
	const editTokenStore = editToken
		? storeEditToken(presentationId, editToken)
		: null;

	const joinCode = optionalString(created, "code");
	const lines = labelled([
		["Title", optionalString(created, "title")],
		["ID", presentationId],
		["Join code", joinCode],
		["Join link", joinCode ? `${settings.baseUrl}/join/${joinCode}` : null],
		["Status", optionalString(created, "status")],
		["Slides", Array.isArray(created.slides) ? created.slides.length : null],
		[
			"Edit token",
			editTokenStore
				? `stored in ${editTokenStore} — the server returns it once, and this is now the only copy`
				: `${EMPTY_MARKER} — none was minted; this deck is authorized by the account that created it`,
		],
	]);

	return {
		data: { ...withoutToken, editTokenStored: editToken !== null, editTokenStore },
		lines,
	};
}

// ── list ─────────────────────────────────────────────────────

async function commandList(parsed: ParsedArguments): Promise<CommandOutput> {
	const { client, settings } = connect(parsed, [], "list");
	requireAccount(settings, "list");
	const payload = asArray(
		await client.get("/api/presentations/mine"),
		"presentation list",
	);
	const rows = payload.map((entry) => {
		const deck = asRecord(entry, "presentation");
		return [
			requiredString(deck, "id", "presentation"),
			display(optionalString(deck, "code")),
			display(optionalString(deck, "status")),
			display(optionalString(deck, "title")),
		];
	});
	const lines =
		rows.length === 0
			? ["This account owns no presentations."]
			: table([["ID", "CODE", "STATUS", "TITLE"], ...rows]);
	return { data: payload, lines };
}

// ── show ─────────────────────────────────────────────────────

async function commandShow(parsed: ParsedArguments): Promise<CommandOutput> {
	const { client, settings } = connect(parsed, [], "show");
	const presentationId = requiredWord(parsed, 1, "show", "a presentation id");
	const deck = asRecord(
		await client.get(`/api/presentations/${encodeURIComponent(presentationId)}`, {
			presentationId,
		}),
		"presentation",
	);

	const joinCode = optionalString(deck, "code");
	const slides = Array.isArray(deck.slides) ? deck.slides : [];
	const lines = labelled([
		["Title", optionalString(deck, "title")],
		["ID", requiredString(deck, "id", "presentation")],
		["Join code", joinCode],
		["Join link", joinCode ? `${settings.baseUrl}/join/${joinCode}` : null],
		["Status", optionalString(deck, "status")],
		["Mode", optionalString(deck, "mode")],
		["Language", optionalString(deck, "language")],
		["Active slide", optionalNumber(deck, "activeSlideIndex")],
		["Participants", optionalNumber(deck, "participantCount")],
		// `null` here means "this caller has no standing on the deck" — a report,
		// not a credential, and worth printing as itself rather than as a blank.
		["Access level", optionalString(deck, "accessLevel")],
		["Slides", slides.length],
	]);

	if (slides.length > 0) {
		lines.push("", ...table(slideRows(slides)));
	}
	return { data: deck, lines };
}

/** One row per slide: its position, its type and what it asks. */
function slideRows(slides: unknown[]): string[][] {
	return slides.map((entry, index) => {
		const slide = asRecord(entry, "slide");
		return [
			`  ${index + 1}.`,
			display(optionalString(slide, "type")),
			display(optionalString(slide, "question")),
		];
	});
}

// ── results ──────────────────────────────────────────────────

async function commandResults(parsed: ParsedArguments): Promise<CommandOutput> {
	const { client } = connect(parsed, [], "results");
	const presentationId = requiredWord(parsed, 1, "results", "a presentation id");
	const payload = asArray(
		await client.get(
			`/api/presentations/${encodeURIComponent(presentationId)}/results`,
			{ presentationId },
		),
		"results",
	);

	const lines: string[] = [];
	if (payload.length === 0) {
		lines.push("This presentation has no slides.");
	}
	payload.forEach((entry, index) => {
		const slideResults = asRecord(entry, "slide results");
		lines.push(
			`${index + 1}. ${display(optionalString(slideResults, "question"))}`,
		);
		lines.push(`   ${summarizeTally(slideResults)}`);
	});
	return { data: payload, lines };
}

/**
 * One line for one slide's tally.
 *
 * Every tally the server publishes carries its slide `type` and a
 * `totalVotes`, and the choice-shaped ones also carry `respondentCount` — so
 * that is what is summarized, and the full aggregation (which differs per slide
 * type, down to per-option counts and per-statement averages) is what `--json`
 * is for. A slide whose tally the deck's reveal mode has not published comes
 * back as a marker with no numbers in it at all, and says so here rather than
 * reading as an empty room.
 */
function summarizeTally(slideResults: Record<string, unknown>): string {
	const type = display(optionalString(slideResults, "type"));
	if (optionalBoolean(slideResults, "withheld")) {
		return `${type} · results withheld — this deck has not published this tally to the room`;
	}
	const parts = [type];
	const totalVotes = optionalNumber(slideResults, "totalVotes");
	if (totalVotes !== null) parts.push(plural(totalVotes, "vote"));
	const respondents = optionalNumber(slideResults, "respondentCount");
	if (respondents !== null) parts.push(plural(respondents, "respondent"));
	parts.push("--json for the full tally");
	return parts.join(" · ");
}
