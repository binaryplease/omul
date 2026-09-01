#!/usr/bin/env nix

/*
#! nix shell nixpkgs#bun --command bun run
*/

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

const SCRIPT_DIR = (() => {
	try {
		return dirname(realpathSync(Bun.argv[1]));
	} catch {}
	return dirname(fileURLToPath(import.meta.url));
})();

const INPUT_PATH = join(SCRIPT_DIR, "omul.json");
const OUTPUT_PATH = join(SCRIPT_DIR, "omul.en.json");
const CONCURRENCY = 10;

const google = createGoogleGenerativeAI({
	apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const model = google("gemini-flash-latest");

type OmulItem = Record<string, string | null>;

const TEXT_FIELDS = ["Kategorie", "Kurz-Was", "Was", "Notizen"];

async function translateItem(
	item: OmulItem,
	index: number,
	total: number,
): Promise<OmulItem> {
	const fieldsToTranslate = TEXT_FIELDS.filter((f) => item[f]);
	if (fieldsToTranslate.length === 0) return item;

	const payload = Object.fromEntries(
		fieldsToTranslate.map((f) => [f, item[f]]),
	);

	const prompt = `Translate the following JSON object fields from German to English.
Return ONLY valid JSON with the same keys and translated values. Do not add any explanation or markdown formatting.

${JSON.stringify(payload, null, 2)}`;

	const { text } = await generateText({ model, prompt });

	// Strip markdown code fences if present
	const cleaned = text
		.replace(/^```(?:json)?\n?/, "")
		.replace(/\n?```$/, "")
		.trim();

	let translated: Record<string, string>;
	try {
		translated = JSON.parse(cleaned);
	} catch (err) {
		console.error(
			`[${index + 1}/${total}] ✗ Failed to parse LLM response for: ${item["Kurz-Was"]}`,
		);
		console.error("Raw response:", cleaned.slice(0, 200));
		return item; // keep original on failure
	}

	process.stdout.write(
		`[${index + 1}/${total}] ✓ ${item["Kurz-Was"] ?? "(no title)"}\n`,
	);
	return { ...item, ...translated };
}

// Run in batches of CONCURRENCY
async function runBatched<T, R>(
	items: T[],
	fn: (item: T, index: number, total: number) => Promise<R>,
	concurrency: number,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	for (let i = 0; i < items.length; i += concurrency) {
		const batch = items.slice(i, i + concurrency);
		const settled = await Promise.all(
			batch.map((item, j) => fn(item, i + j, items.length)),
		);
		for (let j = 0; j < settled.length; j++) {
			results[i + j] = settled[j];
		}
	}
	return results;
}

const items: OmulItem[] = JSON.parse(readFileSync(INPUT_PATH, "utf-8"));
console.log(
	`Translating ${items.length} items (concurrency: ${CONCURRENCY})…\n`,
);

const results = await runBatched(items, translateItem, CONCURRENCY);

writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), "utf-8");
console.log(`\nDone → ${OUTPUT_PATH}`);
