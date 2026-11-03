/**
 * The profanity filter on free text (REQ085) — the word lists, and what it
 * means for an answer to match one.
 *
 * A module of its own because it depends on nothing the presentation service
 * owns: a string in, a verdict out, against a list that ships in this
 * repository. The lists are plain text under `server/profanity-words/`, one per
 * participant language, and are imported as text — so `bun build` inlines them
 * into the server bundle and nothing is ever read from disk or fetched at
 * runtime. Nothing under `src/` imports this file, so no word list reaches a
 * browser either: the filtering happens before a payload leaves, which is the
 * whole point.
 *
 * Which deck filters, and against which list, is decided in `server/schemas.ts`
 * ({@link profanityFilterLanguageFor}); which slides it reads, there too
 * ({@link slideAnswersAreFiltered}). This module turns those two answers into a
 * predicate ({@link answerFilterFor}) and holds the one rule for matching.
 */

import {
	type ParticipantLanguage,
	type ProfanityFilterState,
	profanityFilterLanguageFor,
	type QuizAnswerMode,
	type SlideType,
	slideAnswersAreFiltered,
} from "./schemas";
import de from "./profanity-words/de.txt" with { type: "text" };
import en from "./profanity-words/en.txt" with { type: "text" };
import es from "./profanity-words/es.txt" with { type: "text" };
import fr from "./profanity-words/fr.txt" with { type: "text" };
import it from "./profanity-words/it.txt" with { type: "text" };
import nl from "./profanity-words/nl.txt" with { type: "text" };
import pt from "./profanity-words/pt.txt" with { type: "text" };

/** Every participant language's word list, as the file it ships in. */
export const PROFANITY_WORD_LISTS: Record<ParticipantLanguage, string> = {
	en,
	de,
	fr,
	es,
	it,
	pt,
	nl,
};

// ── What a word is ───────────────────────────────────────────

/**
 * Characters that are not part of how a word reads: zero-width spaces and
 * joiners, the soft hyphen, the word joiner, the byte-order mark — Unicode's
 * format characters — and every other code point Unicode marks as drawn as
 * nothing, among them the Hangul fillers, which are letters by category and
 * would otherwise hold a word together around a gap nobody sees. Dropped before
 * words are found, so a word with one typed into the middle of it still reads
 * as the word it looks like on the wall.
 */
const INVISIBLE_FORMAT_CHARACTERS = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Every combining mark riding on a Latin letter: the accents a precomposed
 * letter decomposes into, and anything else a keyboard or a copy-paste can stack
 * on one — a variation selector that picks a glyph without changing the letter,
 * a strike-through overlay, another script's mark. On a Latin letter a mark is
 * decoration, so "fück", "fu︎ck" and "f̶uck" all read as the word they draw.
 *
 * Only on a Latin letter, and that is the point rather than a convenience: in
 * Devanagari or Thai a combining mark is a vowel, part of the letter it sits on
 * (`normalizeQuizAnswer`'s reasoning for folding Latin accents alone), so a word
 * in another script keeps every mark it was written with.
 */
const MARKS_ON_LATIN_LETTERS = /(?<=\p{Script=Latin}\p{M}*)\p{M}/gu;

/** Latin letters no decomposition splits, spelled as a keyboard without them spells them. */
const LETTER_SPELLINGS: Record<string, string> = {
	ß: "ss",
	æ: "ae",
	œ: "oe",
	ø: "o",
	đ: "d",
	ł: "l",
};

/**
 * Anything that is neither a letter, a digit nor a combining mark ends a word.
 * The marks are in because those on Latin letters are already gone by the time
 * words are found, so what is left is another script's marks — which are part
 * of its letters, and splitting on one would cut a Devanagari word in two.
 */
const WORD_BOUNDARY = /[^\p{L}\p{M}\p{N}]+/u;

/**
 * The words a piece of text reads as, in the form the filter compares them in:
 * compatibility-decomposed (so `ｆｕｃｋ` and a ligature read as the letters they
 * draw), without format characters or the marks riding on Latin letters,
 * lower-cased, with `ß`, `æ` and their kin spelled out — and split wherever
 * something that is not part of a word stands ({@link WORD_BOUNDARY}),
 * apostrophes and hyphens included, so "d'enculé" reads as "d" and "encule" and
 * "foda-se" as "foda" and "se".
 *
 * Written once and applied to a list's entries and to an answer alike, so an
 * entry matches exactly the answers that read as it. What it does not attempt
 * is spelling: a letter swapped for a digit or for a look-alike from another
 * alphabet is a different word to a whole-word list.
 */
export function profanityWordsOf(text: string): string[] {
	return text
		.normalize("NFKD")
		.replace(INVISIBLE_FORMAT_CHARACTERS, "")
		.replace(MARKS_ON_LATIN_LETTERS, "")
		.toLowerCase()
		.replace(/[ßæœøđł]/gu, (letter) => LETTER_SPELLINGS[letter] ?? letter)
		.split(WORD_BOUNDARY)
		.filter((word) => word.length > 0);
}

// ── What a list is ───────────────────────────────────────────

/**
 * A list's entries, as written: one per line, blank lines and `#` comments
 * skipped. An entry of several words is a phrase, matched as those words in
 * that order.
 */
export function wordListEntries(source: string): string[] {
	return source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Whether a piece of text contains an entry of a word list — whole words only,
 * in the form {@link profanityWordsOf} reads them.
 *
 * Whole words, never substrings: "Scunthorpe", "assassin" and "classic" contain
 * nothing a word list names, and a filter that withheld them would be one an
 * organizer switches off. The price is that every inflection a speaker uses has
 * to be its own entry, which is what the lists are written to.
 */
export type ProfanityMatcher = (text: string) => boolean;

/**
 * Compile a list into its matcher: single words into one set, phrases indexed by
 * their first word, so an answer is read once, word by word.
 */
export function compileWordList(source: string): ProfanityMatcher {
	const words = new Set<string>();
	const phrasesByFirstWord = new Map<string, string[][]>();
	for (const entry of wordListEntries(source)) {
		const entryWords = profanityWordsOf(entry);
		if (entryWords.length === 0) continue;
		if (entryWords.length === 1) {
			words.add(entryWords[0]);
			continue;
		}
		const phrases = phrasesByFirstWord.get(entryWords[0]) ?? [];
		phrases.push(entryWords);
		phrasesByFirstWord.set(entryWords[0], phrases);
	}
	return (text) => {
		const answerWords = profanityWordsOf(text);
		return answerWords.some(
			(word, index) =>
				words.has(word) ||
				(phrasesByFirstWord.get(word) ?? []).some((phrase) =>
					phrase.every(
						(phraseWord, offset) => answerWords[index + offset] === phraseWord,
					),
				),
		);
	};
}

/** Each language's matcher, compiled the first time a deck filters with it. */
const compiledMatchers = new Map<ParticipantLanguage, ProfanityMatcher>();

/** The matcher for one participant language's word list. */
export function profanityMatcherFor(
	language: ParticipantLanguage,
): ProfanityMatcher {
	const compiled = compiledMatchers.get(language);
	if (compiled) return compiled;
	const matcher = compileWordList(PROFANITY_WORD_LISTS[language]);
	compiledMatchers.set(language, matcher);
	return matcher;
}

/**
 * The filter in force on one slide of one deck (REQ085): a predicate over a
 * stored answer's value that says whether its words are withheld from the room,
 * or `null` where nothing is filtered — a deck with the filter off, or a slide
 * whose answers are not free text the filter reads.
 *
 * The one place the deck's setting, the slide's type and the list meet, read by
 * every surface that hands an answer on: the aggregation every results payload
 * comes out of, and the spreadsheet that marks each stored row.
 */
export function answerFilterFor(
	deck: ProfanityFilterState,
	slide: {
		type?: SlideType | undefined;
		quizAnswerMode?: QuizAnswerMode | undefined;
	},
): ProfanityMatcher | null {
	const language = profanityFilterLanguageFor(deck);
	if (language === null || !slideAnswersAreFiltered(slide)) return null;
	return profanityMatcherFor(language);
}
