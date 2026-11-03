/**
 * The profanity filter's pure half (REQ085): what a word is, what it means to
 * match a list, the lists themselves, and the deck settings that choose one.
 *
 * Four claims, each held here rather than taken on trust:
 *
 *  - **Whole words, case- and accent-blind.** An entry catches every spelling
 *    of itself that reads the same — upper case, accents dropped or added, `ß`
 *    as `ss`, a zero-width character typed into the middle — and nothing that
 *    merely *contains* it ("Scunthorpe", "classic", "puttanesca").
 *  - **Every language has a list, and every list is sound.** Each of the seven
 *    participant languages ships one; every entry in it matches itself in a
 *    sentence; no two entries are the same entry once folded.
 *  - **A list withholds nothing innocent that it was written to leave alone.**
 *    Each list's own header names the look-alikes it keeps out — the bird, the
 *    cone, Troy, Moses — and each is asserted to pass, so an entry added later
 *    that collides with one fails here rather than in a room.
 *  - **The lists ship in the build.** They are text the bundler inlines, so the
 *    server never reads one from disk or from anywhere else at runtime.
 */

import { describe, expect, test } from "bun:test";
import {
	answerFilterFor,
	compileWordList,
	PROFANITY_WORD_LISTS,
	profanityMatcherFor,
	profanityWordsOf,
	wordListEntries,
} from "./profanity-filter";
import {
	CreatePresentationSchema,
	isParticipantLanguage,
	type ParticipantLanguage,
	ParticipantLanguageSchema,
	participantLanguageFor,
	PresentationSchema,
	profanityFilterLanguageFor,
	ResultsQuerySchema,
	slideAnswersAreFiltered,
	StoredPresentationSchema,
	UpdatePresentationSchema,
} from "./schemas";

const LANGUAGES = ParticipantLanguageSchema.options;

/** A string with its Latin accents taken off, the way a keyboard without them types it. */
function withoutAccents(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ── What a word is ───────────────────────────────────────────

describe("profanityWordsOf (REQ085) — the form words are compared in", () => {
	test("folds case and drops Latin accents", () => {
		expect(profanityWordsOf("ENCULÉ Fück Ñandú")).toEqual([
			"encule",
			"fuck",
			"nandu",
		]);
	});

	test("spells ß, æ, œ and their kin out, as a keyboard without them does", () => {
		expect(profanityWordsOf("Scheiße SCHEIẞE Æsir cœur Øl")).toEqual([
			"scheisse",
			"scheisse",
			"aesir",
			"coeur",
			"ol",
		]);
	});

	test("reads full-width letters and ligatures as the letters they draw", () => {
		expect(profanityWordsOf("ＦＵＣＫ ﬁne")).toEqual(["fuck", "fine"]);
	});

	test("an invisible character typed into a word does not split it", () => {
		// Zero-width space, soft hyphen, zero-width joiner, word joiner.
		expect(
			profanityWordsOf("fu​ck sh­it cu‍nt bi⁠tch"),
		).toEqual(["fuck", "shit", "cunt", "bitch"]);
	});

	test("nor does a Hangul filler, though Unicode files it as a letter", () => {
		// Hangul filler, choseong filler, halfwidth Hangul filler — each drawn as
		// nothing, each a letter by category rather than a format character.
		expect(
			profanityWordsOf("fuㅤck fuᅟck fuﾠck"),
		).toEqual(["fuck", "fuck", "fuck"]);
		expect(profanityMatcherFor("en")("fuㅤck")).toBe(true);
		// A word in another script keeps every character it is written with.
		expect(profanityWordsOf("한국어 हिन्दी")).toEqual([
			"한국어".normalize("NFKD"),
			"हिन्दी".normalize("NFKD"),
		]);
	});

	test("anything that is not a letter or a digit ends a word — apostrophes and hyphens too", () => {
		expect(profanityWordsOf("d'enculé, foda-se! (merde) l’idiota 3d")).toEqual([
			"d",
			"encule",
			"foda",
			"se",
			"merde",
			"l",
			"idiota",
			"3d",
		]);
	});

	test("any mark riding on a Latin letter is decoration — a variation selector, an overlay, a foreign mark", () => {
		// U+FE0F and U+E0100 pick a glyph and draw nothing; U+0336 strikes a letter
		// through; U+20D0 and U+0483 belong to other blocks. On a Latin letter all
		// of them leave the word it was.
		expect(
			profanityWordsOf("fu️ck f̶uck fu⃐ck fu҃ck fu\u{E0100}ck"),
		).toEqual(["fuck", "fuck", "fuck", "fuck", "fuck"]);
		expect(profanityMatcherFor("en")("what the fu️ck")).toBe(true);
	});

	test("another script's combining marks are letters and stay", () => {
		// Devanagari vowel signs are not accents: dropping them would change the word.
		expect(profanityWordsOf("कील")).toEqual(["कील"]);
	});

	test("nothing at all reads as no words", () => {
		expect(profanityWordsOf("")).toEqual([]);
		expect(profanityWordsOf(" ... !! ")).toEqual([]);
	});
});

// ── What a list is ───────────────────────────────────────────

describe("compileWordList (REQ085) — whole words and phrases", () => {
	const matcher = compileWordList(
		[
			"# a comment line is not an entry",
			"",
			"   ",
			"darn",
			"heck off",
			"Grüße",
		].join("\n"),
	);

	test("comments and blank lines are skipped", () => {
		expect(
			wordListEntries("# note\n\n  darn  \n#x\nheck off\n"),
		).toEqual(["darn", "heck off"]);
		expect(matcher("a comment line is not an entry")).toBe(false);
	});

	test("an entry matches as a whole word, anywhere in the answer", () => {
		expect(matcher("darn")).toBe(true);
		expect(matcher("Well, DARN it!")).toBe(true);
		expect(matcher("darn-it")).toBe(true);
	});

	test("an entry never matches inside a longer word", () => {
		expect(matcher("darned")).toBe(false);
		expect(matcher("undarn")).toBe(false);
		expect(matcher("darnation")).toBe(false);
	});

	test("a phrase matches only as those words in that order", () => {
		expect(matcher("oh heck off now")).toBe(true);
		expect(matcher("HECK—OFF")).toBe(true);
		expect(matcher("heck")).toBe(false);
		expect(matcher("off heck")).toBe(false);
		expect(matcher("heck you off")).toBe(false);
		// A phrase running off the end of the answer is not a match.
		expect(matcher("what the heck")).toBe(false);
	});

	test("an entry and an answer are folded alike", () => {
		expect(matcher("GRUSSE")).toBe(true);
		expect(matcher("grüsse")).toBe(true);
	});

	test("an empty list matches nothing", () => {
		expect(compileWordList("")("darn")).toBe(false);
		expect(compileWordList("# only a comment")("darn")).toBe(false);
	});
});

// ── The seven lists ──────────────────────────────────────────

describe("the word lists (REQ085) — one per participant language", () => {
	test("exist for exactly the participant languages", () => {
		expect(Object.keys(PROFANITY_WORD_LISTS).sort()).toEqual(
			[...LANGUAGES].sort(),
		);
	});

	for (const language of LANGUAGES) {
		describe(language, () => {
			const entries = wordListEntries(PROFANITY_WORD_LISTS[language]);
			const matcher = profanityMatcherFor(language);

			test("is not empty", () => {
				expect(entries.length).toBeGreaterThan(20);
			});

			test("every entry matches itself — as written, shouted, unaccented and mid-sentence", () => {
				for (const entry of entries) {
					expect([entry, matcher(entry)]).toEqual([entry, true]);
					expect([entry, matcher(entry.toUpperCase())]).toEqual([entry, true]);
					expect([entry, matcher(withoutAccents(entry))]).toEqual([
						entry,
						true,
					]);
					expect([entry, matcher(`so: ${entry}, really.`)]).toEqual([
						entry,
						true,
					]);
				}
			});

			test("no entry appears twice once folded", () => {
				const folded = entries.map((entry) => profanityWordsOf(entry).join(" "));
				expect(folded.filter((entry) => entry.length === 0)).toEqual([]);
				expect(new Set(folded).size).toBe(folded.length);
			});
		});
	}

	/**
	 * What each list's own header says it keeps out, plus the substrings a naive
	 * filter trips on. These are the answers a room gives innocently, and a list
	 * that withheld one of them would be switched off by the organizer it embarrassed.
	 */
	const INNOCENT: Record<ParticipantLanguage, string[]> = {
		en: [
			"Scunthorpe",
			"a classic assassin",
			"cocktail in the cockpit",
			"Moby Dick by Herman Melville",
			"blue tits at the feeder",
			"magna cum laude",
			"turn the door knob",
			"crap",
			"damn",
			"hell",
			"Arsenal",
			"therapist",
			"Penistone",
			"shiitake",
			// Found withheld by the review of REQ085, each a word whose everyday
			// meaning is innocent — off the list now, and held off it here.
			"a chink in the armour",
			"chinks of light",
			"honky-tonk piano",
			"pussy willow",
			"going out for a fag",
			"a packet of fags",
			"to retard growth",
			"it retards the reaction",
			"retarded spark timing",
		],
		de: [
			"die fünf Bücher Mose",
			"der Schwanz der Katze",
			"behinderte Menschen",
			"Mongo",
			"ein Hurenkind im Satz",
			"Schlamperei",
			"Spastik",
			"verdammt",
			"Ficus",
		],
		fr: [
			"un cul-de-sac",
			"la chatte et ses chatons",
			"une tapette à mouches",
			"le pour et le con",
			"a quick bite",
			"une salopette",
			"la connaissance",
			"la pédagogie",
			"bordel",
			"pain bâtard",
			"des pains bâtards",
		],
		es: [
			"el área de un cono",
			"la polla de la granja",
			"coger el autobús",
			"el pinche de cocina",
			"un capullo de rosa",
			"la computadora",
			"una disputa",
			"carajo",
			"hostia",
			"la zorra y el cuervo",
		],
		it: [
			"il cavallo di Troia",
			"finocchio al forno",
			"el gato negro",
			"che figa",
			"il bocchino del sax",
			"una cazzuola",
			"lo stronzio",
			"spaghetti alla puttanesca",
			"pirla",
		],
		pt: [
			"Cu",
			"uma bicha para o autocarro",
			"a piranha do rio",
			"o veado na floresta",
			"uma pica no braço",
			"o crioulo cabo-verdiano",
			"o computador",
			"a cabra",
			"uma foca",
			"o puto da escola",
		],
		nl: [
			"kanker",
			"het kankeronderzoek",
			"tyfus",
			"tering",
			"een eikel van de eik",
			"een mongool uit de steppe",
			"klootjesvolk",
			"de lamp flikkert",
			"hoera",
		],
	};

	for (const language of LANGUAGES) {
		test(`${language} withholds none of the look-alikes it was written to leave alone`, () => {
			const matcher = profanityMatcherFor(language);
			for (const answer of INNOCENT[language]) {
				expect([answer, matcher(answer)]).toEqual([answer, false]);
			}
		});
	}

	test("each language's list is its own — an English-only insult passes a German deck", () => {
		expect(profanityMatcherFor("en")("wanker")).toBe(true);
		expect(profanityMatcherFor("de")("wanker")).toBe(false);
		expect(profanityMatcherFor("de")("Arschloch")).toBe(true);
		expect(profanityMatcherFor("en")("Arschloch")).toBe(false);
		// The English swearwords other languages borrow are on their lists too.
		for (const language of LANGUAGES) {
			expect([language, profanityMatcherFor(language)("FUCK")]).toEqual([
				language,
				true,
			]);
		}
	});

	test("the lists are compiled once and handed out again", () => {
		expect(profanityMatcherFor("fr")).toBe(profanityMatcherFor("fr"));
	});

	test("the lists ship inside the server bundle, read from no file at runtime", async () => {
		const built = await Bun.build({
			entrypoints: [new URL("./profanity-filter.ts", import.meta.url).pathname],
			target: "bun",
		});
		expect(built.success).toBe(true);
		const bundled = await built.outputs[0].text();
		for (const language of LANGUAGES) {
			// Each list is in the bundle as text — looked for by an entry written in
			// plain ASCII, since the bundler may escape any other character…
			const plain = wordListEntries(PROFANITY_WORD_LISTS[language]).find(
				(entry) => /^[a-z ]+$/.test(entry),
			);
			expect([language, plain !== undefined]).toEqual([language, true]);
			expect([language, bundled.includes(plain ?? "")]).toEqual([
				language,
				true,
			]);
		}
		// …and no line of code goes looking for one anywhere else. The bundler
		// heads each inlined file with a `// server/profanity-words/…` comment
		// naming where it came from; that is provenance, not a read.
		const code = bundled
			.split("\n")
			.filter((line) => !line.trim().startsWith("//"))
			.join("\n");
		expect(code).not.toContain("profanity-words/");
		expect(code).not.toContain("readFile");
		expect(code).not.toContain("Bun.file(");
		expect(code).not.toContain("fetch(");
	});
});

// ── Which deck filters, and with which list ──────────────────

describe("participantLanguageFor (REQ085) — the deck's language as a list", () => {
	test("reads the primary subtag when it is one of the seven", () => {
		expect(participantLanguageFor("de")).toBe("de");
		expect(participantLanguageFor("de-AT")).toBe("de");
		expect(participantLanguageFor("PT-br")).toBe("pt");
		expect(participantLanguageFor("nl")).toBe("nl");
	});

	test("reads anything else as English, as the phone's dictionary does", () => {
		expect(participantLanguageFor("ja")).toBe("en");
		expect(participantLanguageFor("")).toBe("en");
		expect(participantLanguageFor(undefined)).toBe("en");
		expect(participantLanguageFor(null)).toBe("en");
		expect(participantLanguageFor("deutsch")).toBe("en");
	});
});

describe("isParticipantLanguage (REQ085) — a list named exactly", () => {
	test("is one of the seven, spelled as the schema spells it", () => {
		for (const language of LANGUAGES) {
			expect(isParticipantLanguage(language)).toBe(true);
		}
	});

	test("is nothing else — a region, a name, another case, another type", () => {
		for (const value of ["de-AT", "Deutsch", "DE", "", "xx", null, undefined, 42, {}]) {
			expect([value, isParticipantLanguage(value)]).toEqual([value, false]);
		}
	});
});

describe("profanityFilterLanguageFor (REQ085) — the list in force", () => {
	test("is null while the filter is off, whatever list is chosen", () => {
		expect(profanityFilterLanguageFor({})).toBeNull();
		expect(
			profanityFilterLanguageFor({
				profanityFilterEnabled: false,
				profanityFilterLanguage: "de",
				language: "fr",
			}),
		).toBeNull();
	});

	test("follows the deck's language until a list is chosen", () => {
		expect(
			profanityFilterLanguageFor({
				profanityFilterEnabled: true,
				profanityFilterLanguage: null,
				language: "it",
			}),
		).toBe("it");
		expect(
			profanityFilterLanguageFor({ profanityFilterEnabled: true, language: "es-MX" }),
		).toBe("es");
		expect(
			profanityFilterLanguageFor({ profanityFilterEnabled: true, language: "ko" }),
		).toBe("en");
	});

	test("a chosen list stands whatever the deck's language is", () => {
		expect(
			profanityFilterLanguageFor({
				profanityFilterEnabled: true,
				profanityFilterLanguage: "nl",
				language: "de",
			}),
		).toBe("nl");
	});
});

describe("slideAnswersAreFiltered (REQ085) — which answers are free text", () => {
	test("a word cloud, an open-ended slide and a typed quiz question", () => {
		expect(slideAnswersAreFiltered({ type: "word-cloud" })).toBe(true);
		expect(slideAnswersAreFiltered({ type: "open-text" })).toBe(true);
		expect(
			slideAnswersAreFiltered({ type: "quiz", quizAnswerMode: "type" }),
		).toBe(true);
	});

	test("and nothing else — a picked option, a form's rows, a leftover answer mode", () => {
		expect(
			slideAnswersAreFiltered({ type: "quiz", quizAnswerMode: "select" }),
		).toBe(false);
		expect(slideAnswersAreFiltered({ type: "quiz" })).toBe(false);
		// A quiz converted to a choice slide keeps the field; it means nothing there.
		expect(
			slideAnswersAreFiltered({ type: "multiple-choice", quizAnswerMode: "type" }),
		).toBe(false);
		for (const type of [
			"form",
			"scale",
			"ranking",
			"grid",
			"points",
			"guess-number",
			"pin-image",
			"leaderboard",
			"text",
		] as const) {
			expect([type, slideAnswersAreFiltered({ type })]).toEqual([type, false]);
		}
	});
});

describe("answerFilterFor (REQ085) — the filter on one slide of one deck", () => {
	const filtering = { profanityFilterEnabled: true, language: "en" };

	test("is the deck's list on a slide it reads", () => {
		const filter = answerFilterFor(filtering, { type: "word-cloud" });
		expect(filter).toBe(profanityMatcherFor("en"));
		expect(filter?.("what the fuck")).toBe(true);
		expect(filter?.("what the duck")).toBe(false);
	});

	test("is null on a deck with the filter off", () => {
		expect(answerFilterFor({ language: "en" }, { type: "word-cloud" })).toBeNull();
	});

	test("is null on a slide whose answers it does not read", () => {
		expect(answerFilterFor(filtering, { type: "multiple-choice" })).toBeNull();
		expect(answerFilterFor(filtering, { type: "form" })).toBeNull();
	});
});

// ── The stored fields and the query ──────────────────────────

describe("the deck's filter settings as stored fields (REQ085)", () => {
	const legacy = {
		id: "deck-1",
		code: "123456",
		title: "Stored before REQ085",
		slides: [],
		createdAt: "2026-01-01T00:00:00.000Z",
	};

	test("a deck written before the fields existed reads off, following its language", () => {
		const stored = StoredPresentationSchema.parse(legacy);
		expect(stored.profanityFilterEnabled).toBe(false);
		expect(stored.profanityFilterLanguage).toBeNull();
		const published = PresentationSchema.parse(legacy);
		expect(published.profanityFilterEnabled).toBe(false);
		expect(published.profanityFilterLanguage).toBeNull();
		expect(profanityFilterLanguageFor(published)).toBeNull();
	});

	test("both are emitted on every published deck, never dropped", () => {
		const published = PresentationSchema.parse(legacy);
		expect("profanityFilterEnabled" in published).toBe(true);
		expect("profanityFilterLanguage" in published).toBe(true);
	});

	test("a create that names neither gets the filter off", () => {
		const created = CreatePresentationSchema.parse({
			title: "Deck",
			slides: [{ id: "s", type: "word-cloud", question: "?" }],
		});
		expect(created.profanityFilterEnabled).toBe(false);
		expect(created.profanityFilterLanguage).toBeNull();
	});

	test("a list is one of the seven languages, or null", () => {
		for (const language of LANGUAGES) {
			expect(
				StoredPresentationSchema.parse({ ...legacy, profanityFilterLanguage: language })
					.profanityFilterLanguage,
			).toBe(language);
		}
		expect(
			CreatePresentationSchema.safeParse({
				title: "Deck",
				slides: [{ id: "s", type: "word-cloud", question: "?" }],
				profanityFilterLanguage: "ja",
			}).success,
		).toBe(false);
		expect(
			UpdatePresentationSchema.safeParse({ profanityFilterLanguage: "en-GB" })
				.success,
		).toBe(false);
		expect(
			UpdatePresentationSchema.safeParse({ profanityFilterEnabled: "yes" }).success,
		).toBe(false);
	});

	test("a PATCH carries only the keys it names — no default turns a save into a claim", () => {
		expect(UpdatePresentationSchema.parse({ title: "Renamed" })).toEqual({
			title: "Renamed",
		});
		expect(
			UpdatePresentationSchema.parse({
				profanityFilterEnabled: true,
				profanityFilterLanguage: null,
			}),
		).toEqual({ profanityFilterEnabled: true, profanityFilterLanguage: null });
	});
});

describe("ResultsQuerySchema (REQ085) — asking for what the filter withheld", () => {
	test("withholds unless asked", () => {
		expect(ResultsQuerySchema.parse({})).toEqual({ filtered: "withhold" });
		expect(ResultsQuerySchema.parse({ filtered: "include" })).toEqual({
			filtered: "include",
		});
	});

	test("refuses anything that is not one of the two words", () => {
		expect(ResultsQuerySchema.safeParse({ filtered: "true" }).success).toBe(false);
		expect(ResultsQuerySchema.safeParse({ filtered: "yes" }).success).toBe(false);
	});
});
