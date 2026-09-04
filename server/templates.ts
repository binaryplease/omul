/**
 * The built-in deck templates (REQ005) and what it means to start from one
 * (REQ006).
 *
 * A module of its own rather than a section of the presentation service,
 * because it depends on nothing the service owns: no store, no
 * ownership, no join code, no lifecycle. Delete `services/presentations.ts` and
 * every line here still works — the catalog is content plus two pure functions
 * over it. What the two modules share is `Slide`, and that already lives in
 * `schemas.ts`.
 *
 * **This catalog is code, not data.** There is no collection behind the entries
 * below and no way to write one: a built-in template is authored here, shipped
 * with the build, and read-only at runtime — the same six entries for every
 * caller of every deployment.
 *
 * The *other* kind of template is a document, and it lives elsewhere: a
 * workspace publishes one of its own decks (REQ004,
 * `server/services/workspace-templates.ts`), the workspace owns the published
 * entry, and its roster is what decides who sees and uses it. Nothing here knows
 * about that one — the two meet at {@link copyTemplateSlides} below, which is
 * what "starting from a template" means for both, and at the create route that
 * calls it.
 *
 * **A copy is a copy.** {@link copyTemplateSlides} re-identifies every slide and
 * every identified row inside it, so the deck a template produces shares no id
 * with the entry it came from and nothing links the two afterwards. Editing the
 * deck cannot reach the template, and re-running the same template twice produces
 * two decks that cannot reach each other either.
 *
 * Deliberately plain content: no images or videos, because a template that
 * pointed at somebody else's asset host would be a runtime dependency on it,
 * and every slide here has to render on a projector that has never
 * been online.
 */

import {
	type DeckTemplate,
	type DeckTemplateQuery,
	DeckTemplateSchema,
	filterDeckTemplates,
	type Slide,
	withFreshSlideIds,
} from "./schemas";

/**
 * The catalog as authored. Parsed through {@link DeckTemplateSchema} below, so
 * a malformed entry is a startup crash rather than a card that renders empty in
 * somebody's gallery, and every slide comes out of here fully defaulted — the
 * same complete shape a stored deck's slides have.
 *
 * Six entries, generic on purpose. The set is meant to be recognisable enough
 * that an organizer sees their own meeting in one of them and small enough that
 * the gallery is skimmed rather than searched — the filters (REQ005) are there
 * for when it grows, not because it needs them today.
 */
const AUTHORED_TEMPLATES: unknown[] = [
	{
		id: "team-check-in",
		title: "Team check-in",
		description:
			"Open a recurring team meeting: how everyone is arriving, where the week stands, and what each person needs from the group.",
		category: "meeting",
		tags: ["standup", "weekly", "mood", "team"],
		slides: [
			{
				id: "team-check-in-join",
				type: "instruction",
				question: "Join the check-in",
				body: "Scan the code or open the link and enter the join code. Nothing you send here is tied to your name.",
			},
			{
				id: "team-check-in-mood",
				type: "word-cloud",
				question: "In one word, how are you arriving today?",
				maxResponses: 1,
			},
			{
				id: "team-check-in-week",
				type: "scale",
				question: "How is the week looking?",
				scaleMin: 1,
				scaleMax: 5,
				scaleMinLabel: "Struggling",
				scaleMaxLabel: "On top of it",
				scaleStatements: [
					{ id: "team-check-in-week-workload", text: "My workload" },
					{ id: "team-check-in-week-clarity", text: "Clarity of my priorities" },
					{ id: "team-check-in-week-energy", text: "My energy" },
				],
				scaleAllowSkip: true,
			},
			{
				id: "team-check-in-needs",
				type: "open-text",
				question: "What is the one thing you need from this group this week?",
				allowResponseVotes: true,
			},
		],
	},
	{
		id: "icebreaker",
		title: "Icebreaker",
		description:
			"Three quick, low-stakes questions to get a room that has just met answering something before it has to answer anything that matters.",
		category: "engagement",
		tags: ["warm-up", "fun", "onboarding", "kickoff"],
		slides: [
			{
				id: "icebreaker-join",
				type: "instruction",
				question: "Grab your phone",
				body: "Open the link, enter the code, and answer as fast as you like — none of this is scored.",
			},
			{
				id: "icebreaker-soundtrack",
				type: "multiple-choice",
				question: "What is playing while you work?",
				options: [
					{ id: "icebreaker-soundtrack-silence", text: "Silence" },
					{ id: "icebreaker-soundtrack-instrumental", text: "Something instrumental" },
					{ id: "icebreaker-soundtrack-loud", text: "Something loud" },
					{ id: "icebreaker-soundtrack-noise", text: "Whatever the room is playing" },
				],
				mcDisplayStyle: "donut",
			},
			{
				id: "icebreaker-guess",
				type: "guess-number",
				question: "How many cups of coffee does this room get through in a week?",
				guessRange: { min: 0, max: 200, step: 5 },
			},
			{
				id: "icebreaker-word",
				type: "word-cloud",
				question: "Describe your week so far in one word",
				maxResponses: 1,
			},
		],
	},
	{
		id: "retrospective",
		title: "Retrospective",
		description:
			"Close out a sprint or a project: rate how it went, then collect what to keep and what to change, with the room upvoting what it recognises.",
		category: "feedback",
		tags: ["retro", "sprint", "review", "team"],
		slides: [
			{
				id: "retrospective-intro",
				type: "text",
				question: "Retrospective",
				body: "Three questions. Answers are anonymous — say the thing you would say afterwards in the corridor.",
			},
			{
				id: "retrospective-scale",
				type: "scale",
				question: "How did this one go?",
				scaleMin: 1,
				scaleMax: 5,
				scaleMinLabel: "Badly",
				scaleMaxLabel: "Well",
				scaleStatements: [
					{ id: "retrospective-scale-outcome", text: "What we delivered" },
					{ id: "retrospective-scale-pace", text: "The pace we worked at" },
					{ id: "retrospective-scale-together", text: "How well we worked together" },
				],
			},
			{
				id: "retrospective-keep",
				type: "open-text",
				question: "What should we keep doing?",
				allowResponseVotes: true,
			},
			{
				id: "retrospective-change",
				type: "open-text",
				question: "What should we change before the next one?",
				allowResponseVotes: true,
			},
		],
	},
	{
		id: "quiz-round",
		title: "Quiz round",
		description:
			"A scored round against the clock: one question to pick an answer to, one to type, and a leaderboard to finish on.",
		category: "engagement",
		tags: ["quiz", "game", "scores", "competition"],
		slides: [
			{
				id: "quiz-round-join",
				type: "instruction",
				question: "Join the quiz",
				body: "Every question is scored on being right **and** being quick. Your first answer is your final answer.",
			},
			{
				id: "quiz-round-select",
				type: "quiz",
				question: "Which planet is closest to the Sun?",
				timeLimit: 20,
				options: [
					{ id: "quiz-round-select-mercury", text: "Mercury", isCorrect: true },
					{ id: "quiz-round-select-venus", text: "Venus" },
					{ id: "quiz-round-select-mars", text: "Mars" },
					{ id: "quiz-round-select-earth", text: "Earth" },
				],
			},
			{
				id: "quiz-round-typed",
				type: "quiz",
				question: "Which is the largest ocean on Earth?",
				timeLimit: 30,
				quizAnswerMode: "type",
				quizAnswers: [
					{ id: "quiz-round-typed-pacific", text: "Pacific" },
					{ id: "quiz-round-typed-pacific-ocean", text: "Pacific Ocean" },
				],
			},
			{
				id: "quiz-round-board",
				type: "leaderboard",
				question: "Where everyone landed",
				leaderboardSize: 5,
			},
		],
	},
	{
		id: "lecture-pulse",
		title: "Lecture pulse-check",
		description:
			"Find out mid-session whether a class is still with you: one knowledge check, the terms that are still unclear, and the questions nobody wanted to raise a hand for.",
		category: "education",
		tags: ["teaching", "class", "training", "comprehension"],
		slides: [
			{
				id: "lecture-pulse-join",
				type: "instruction",
				question: "Join the session",
				body: "Answers are anonymous. Ask anything — the questions are read out, not attributed.",
			},
			{
				id: "lecture-pulse-confidence",
				type: "scale",
				question: "How confident are you with what we have covered so far?",
				scaleMin: 1,
				scaleMax: 5,
				scaleMinLabel: "Lost",
				scaleMaxLabel: "Confident",
			},
			{
				id: "lecture-pulse-check",
				type: "multiple-choice",
				question: "Replace this with a check on the point you just made",
				options: [
					{ id: "lecture-pulse-check-a", text: "The answer you are looking for", isCorrect: true },
					{ id: "lecture-pulse-check-b", text: "A plausible near-miss" },
					{ id: "lecture-pulse-check-c", text: "The common misconception" },
				],
				// Collected silently and revealed when the class has committed: a live
				// bar chart on a knowledge check tells the room what to answer.
				resultsVisibility: "on-click",
			},
			{
				id: "lecture-pulse-unclear",
				type: "word-cloud",
				question: "Which term is still unclear?",
			},
			{
				id: "lecture-pulse-questions",
				type: "open-text",
				question: "What would you like me to go back over?",
				allowResponseVotes: true,
			},
		],
	},
	{
		id: "prioritization-workshop",
		title: "Prioritization workshop",
		description:
			"Work a shortlist down to a decision: fund it, place it by effort and impact, order it, then catch what the list is missing.",
		category: "workshop",
		tags: ["planning", "roadmap", "decision", "backlog"],
		slides: [
			{
				id: "prioritization-workshop-intro",
				type: "text",
				question: "What do we do next?",
				body: "Four rounds on the same shortlist. Replace the placeholder options with yours before you start.",
			},
			{
				id: "prioritization-workshop-points",
				type: "points",
				question: "Split 100 points across the shortlist",
				pointsItems: [
					{ id: "prioritization-workshop-points-first", text: "First option" },
					{ id: "prioritization-workshop-points-second", text: "Second option" },
					{ id: "prioritization-workshop-points-third", text: "Third option" },
					{ id: "prioritization-workshop-points-fourth", text: "Fourth option" },
				],
			},
			{
				id: "prioritization-workshop-grid",
				type: "grid",
				question: "Place each one by effort and impact",
				gridItems: [
					{ id: "prioritization-workshop-grid-first", text: "First option" },
					{ id: "prioritization-workshop-grid-second", text: "Second option" },
					{ id: "prioritization-workshop-grid-third", text: "Third option" },
					{ id: "prioritization-workshop-grid-fourth", text: "Fourth option" },
				],
				gridXAxis: {
					title: "Effort",
					min: 0,
					max: 10,
					minLabel: "Small",
					maxLabel: "Large",
				},
				gridYAxis: {
					title: "Impact",
					min: 0,
					max: 10,
					minLabel: "Low",
					maxLabel: "High",
				},
				gridAllowSkip: true,
			},
			{
				id: "prioritization-workshop-ranking",
				type: "ranking",
				question: "Put them in the order you would tackle them",
				rankingItems: [
					{ id: "prioritization-workshop-ranking-first", text: "First option" },
					{ id: "prioritization-workshop-ranking-second", text: "Second option" },
					{ id: "prioritization-workshop-ranking-third", text: "Third option" },
					{ id: "prioritization-workshop-ranking-fourth", text: "Fourth option" },
				],
			},
			{
				id: "prioritization-workshop-missing",
				type: "open-text",
				question: "What is missing from this list?",
				allowResponseVotes: true,
			},
		],
	},
];

/**
 * The catalog, validated and fully defaulted at module load. Exported as the
 * whole set; a caller that wants part of it goes through
 * {@link listDeckTemplates}.
 */
export const DECK_TEMPLATES: readonly DeckTemplate[] = Object.freeze(
	AUTHORED_TEMPLATES.map((template) => DeckTemplateSchema.parse(template)),
);

/** The catalog, or the part of it a query asks for (REQ005). */
export function listDeckTemplates(query: DeckTemplateQuery = {}): DeckTemplate[] {
	return filterDeckTemplates(DECK_TEMPLATES, query);
}

/** One catalog entry by id, or `null` when nothing is filed under it. */
export function findDeckTemplate(id: string): DeckTemplate | null {
	return DECK_TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * The slides a deck started from this template begins life with (REQ006):
 * copies, under identities of their own, sharing nothing with the entry they
 * were taken from.
 *
 * Thin on purpose — the re-identification itself is
 * {@link withFreshSlideIds}, which is also what duplicating and importing a
 * deck use. What this function adds is the name: "the slides a
 * template hands a new deck" is the operation REQ006 describes, and the create
 * route should read as performing it rather than as spreading an array.
 *
 * Takes the *slides*, not a catalog entry, because there are two kinds of
 * template and this operation is the same one for both: a built-in entry from
 * the set above, and a template a workspace published out of one of its own
 * decks (REQ004). One function, so "later edits to the template do not reach the
 * deck" cannot come to mean two different things — and so a second
 * implementation of "copy" never gets written for the second caller.
 */
export function copyTemplateSlides(template: {
	slides: readonly Slide[];
}): Slide[] {
	return withFreshSlideIds(template.slides);
}
