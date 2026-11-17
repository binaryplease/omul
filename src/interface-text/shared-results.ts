// The shared results page (src/pages/SharedResultsPage.tsx, `/results/<id>`, REQ098) and the breakdown under each chart (src/components/SegmentedResults.tsx, REQ020, REQ116) — REQ248 slice 10.
// The charts' own captions are the room's words, as on the shared screen: they
// read the deck's dictionary (REQ084). A group's label comes from the server
// and stays as it words it; why an earlier slide cannot group these results is
// read from the refusal's code, so it is worded here (`segmentRefusals`, held
// to the server's English by interface-text.test.ts).

import type { SegmentRefusal } from "../types";
import type { PluralText } from "./index";

export const en = {
	pageTitle: "Results",
	/** `{title}` is the deck's title. */
	deckPageTitle: "{title} — Results",

	revokedTitle: "This results link is no longer valid",
	revokedBody:
		"The organizer has withdrawn it, or replaced it with a newer one. Ask them for the current link.",
	missingTitle: "These results are not available",
	missingBody: "The presentation behind this link has been deleted.",
	failedTitle: "The results could not be loaded",

	sharedByLink:
		"Results, shared read-only. This link shows the numbers and grants nothing else — it cannot change the presentation, and the organizer can withdraw it at any time.",
	sharedPublicly:
		"Results, as this presentation publishes them. Slides whose organizer has kept their numbers back are not shown here.",
	noSlides: "This presentation has no slides that collect answers.",
	notPublished: "The organizer has not published this slide's results.",
	/** A quiz question the room is still answering (REQ215). */
	quizStillRunning:
		"This quiz question is still being answered — its results appear here once it is over.",


	// The breakdown.
	breakDownBy: "Break these results down by",
	breakDownByLabel: "Break these results down by an earlier slide's answers",
	everyone: "Everyone",
	/** The group of people who never answered the grouping slide (its key is `null`). */
	didNotAnswer: "Did not answer",
	noSources:
		"Nothing earlier in this deck collects answers these results could be grouped by.",
	answeredCount: { one: "{count} answered", other: "{count} answered" } as PluralText,
	/** `{count}` is the fewest people a group needs to be published. */
	groupSuppressed:
		"Not published. A group of fewer than {count} people would name the people in it, and groups are held back at least two at a time so the missing answers cannot be worked out by subtracting the rest — so this one is held back too. The organizer reads every group in full.",
	withheldIdentifiable:
		"This slide's results list what each person answered, and no group is small enough — or large enough — to make that anonymous. Only the organizer can break these results down.",
	withheldRevealMode:
		"This breakdown is not published — the organizer has kept one of the two slides' results back.",
	/** The grouping question is a quiz question that is still running. */
	withheldQuizNotOver:
		"This breakdown groups people by a quiz question that is not over yet, and how many picked each answer would give that answer away. It appears once the question is over.",
	/** Why an earlier slide cannot group these results, by the refusal's code. */
	segmentRefusals: {
		"unknown-slide": "That slide is not part of this deck.",
		"same-slide": "A slide cannot group its own results by itself.",
		"not-earlier":
			"It comes later in the deck. A breakdown reads backwards: only a slide the same people had already answered can group them.",
		"no-tally": "That slide has no results to break down.",
		"no-answers":
			"It collects no answers of its own, so there is nothing to group people by.",
		"multi-select":
			"Its participants may pick more than one option, so a single person would land in several groups at once.",
		"typed-answers":
			"Its answers are typed rather than picked, so there is no fixed set of groups to split the room into.",
		"unsupported-type":
			"Its answers are not one choice from a fixed set, so they do not divide the room into groups.",
	} as Record<SegmentRefusal, string>,
};

export const de: Partial<typeof en> = {
	pageTitle: "Ergebnisse",
	deckPageTitle: "{title} — Ergebnisse",

	revokedTitle: "Dieser Ergebnislink ist nicht mehr gültig",
	revokedBody:
		"Die Person, die die Präsentation organisiert, hat ihn zurückgezogen oder durch einen neueren ersetzt. Frag sie nach dem aktuellen Link.",
	missingTitle: "Diese Ergebnisse sind nicht verfügbar",
	missingBody: "Die Präsentation hinter diesem Link wurde gelöscht.",
	failedTitle: "Die Ergebnisse konnten nicht geladen werden",

	sharedByLink:
		"Ergebnisse, nur zum Ansehen geteilt. Dieser Link zeigt die Zahlen und erlaubt sonst nichts — er kann die Präsentation nicht ändern, und er kann jederzeit zurückgezogen werden.",
	sharedPublicly:
		"Ergebnisse, so wie diese Präsentation sie veröffentlicht. Folien, deren Zahlen zurückgehalten werden, erscheinen hier nicht.",
	noSlides: "Diese Präsentation hat keine Folien, die Antworten sammeln.",
	notPublished: "Die Ergebnisse dieser Folie wurden nicht veröffentlicht.",
	quizStillRunning:
		"Diese Quizfrage wird noch beantwortet — ihre Ergebnisse erscheinen hier, sobald sie vorbei ist.",


	breakDownBy: "Diese Ergebnisse aufschlüsseln nach",
	breakDownByLabel:
		"Diese Ergebnisse nach den Antworten auf eine frühere Folie aufschlüsseln",
	everyone: "Alle",
	didNotAnswer: "Nicht geantwortet",
noSources:
		"Keine frühere Folie dieser Präsentation sammelt Antworten, nach denen sich diese Ergebnisse gruppieren ließen.",
	answeredCount: { one: "{count} hat geantwortet", other: "{count} haben geantwortet" },
	groupSuppressed:
		"Nicht veröffentlicht. Eine Gruppe mit weniger als {count} Personen würde die Menschen darin erkennbar machen, und Gruppen werden mindestens zu zweit zurückgehalten, damit sich die fehlenden Antworten nicht durch Abziehen der übrigen ausrechnen lassen — deshalb wird auch diese zurückgehalten. Wer die Präsentation organisiert, sieht jede Gruppe vollständig.",
	withheldIdentifiable:
		"Die Ergebnisse dieser Folie zeigen, was jede einzelne Person geantwortet hat, und keine Gruppengröße macht das anonym. Nur wer die Präsentation organisiert, kann diese Ergebnisse aufschlüsseln.",
	withheldRevealMode:
		"Diese Aufschlüsselung ist nicht veröffentlicht — die Ergebnisse einer der beiden Folien werden zurückgehalten.",
	withheldQuizNotOver:
		"Diese Aufschlüsselung gruppiert Leute nach einer Quizfrage, die noch läuft, und wie viele welche Antwort gewählt haben, würde die Lösung verraten. Sie erscheint, sobald die Frage vorbei ist.",
	segmentRefusals: {
		"unknown-slide": "Diese Folie gehört nicht zu dieser Präsentation.",
		"same-slide": "Eine Folie kann ihre eigenen Ergebnisse nicht nach sich selbst gruppieren.",
		"not-earlier":
			"Sie kommt später in der Präsentation. Eine Aufschlüsselung liest rückwärts: Nur eine Folie, die dieselben Leute schon beantwortet hatten, kann sie gruppieren.",
		"no-tally": "Diese Folie hat keine Ergebnisse zum Aufschlüsseln.",
		"no-answers":
			"Sie sammelt selbst keine Antworten, also gibt es nichts, wonach sich Leute gruppieren ließen.",
		"multi-select":
			"Teilnehmende können mehr als eine Option wählen, also würde eine Person in mehreren Gruppen zugleich landen.",
		"typed-answers":
			"Auf dieser Folie werden die Antworten getippt statt gewählt, also gibt es keine feste Menge von Gruppen, in die sich der Raum teilen ließe.",
		"unsupported-type":
			"Die Antworten auf dieser Folie sind keine Wahl aus einer festen Menge, also teilen sie den Raum nicht in Gruppen.",
	},
};
