// The export and share-results-link dialogs (ExportDialog.tsx, ResultsLinkDialog.tsx) on the presenter screen — REQ248 slice 2.

export const en = {
	exportTitle: "Export this session",
	/** The name of the control that opens the export dialog. */
	exportButton: "Export this session — download it as a spreadsheet or as a PDF",
	exportButtonNoAccess:
		"Export this session — you cannot edit this presentation, so its responses are not yours to download",
	exportXlsxLabel: "Spreadsheet (.xlsx)",
	exportXlsxSummary:
		"Every response, the per-participant matrix and every tally in long form — the file to analyse the session in.",
	exportPdfResultsLabel: "PDF with results",
	exportPdfResultsSummary:
		"The deck rendered slide by slide with the tallies underneath — the file to read or hand round.",
	exportPdfDeckLabel: "PDF of the deck",
	exportPdfDeckSummary:
		"The same document without what the room submitted — the questions, the options and the answer key.",
	/** `{format}` is a row's label. */
	exportBusy: "Exporting the {format}…",
	exportDone: "{format} exported",
	exportFailed: "Failed to export the {format}",
	exportFootnote:
		"Each file is a snapshot of the session as it stands right now. Export before you reset the deck — clearing the results cannot be undone.",

	resultsLinkTitle: "Share the results",
	resultsLinkIntro:
		"A results link opens this deck's results in a read-only page, with no account and no sign-in. Whoever holds it reads every slide's tally — including the ones this deck keeps back from the room — and nothing else: it cannot edit, start, end or reset the presentation, download the spreadsheet, or read a running quiz question's answer key.",
	resultsLinkChecking: "Checking…",
	resultsLinkNone:
		"This deck has no results link. Nothing is shared until you create one.",
	/** Follows the "Active …" line for a link minted in another browser. */
	resultsLinkElsewhere:
		"This browser cannot show it: the link is stored only as a fingerprint, so a copy of it that cannot be matched against this mint is not one to hand on. Creating a new one replaces it.",
	resultsLinkActiveUnknown: "Active — minted at an unrecorded time.",
	/** `{time}` is the minting instant in the interface language's format. */
	resultsLinkActiveSince: "Active since {time}.",
	resultsLinkCopy: "Copy link",
	resultsLinkCopied: "Copied!",
	resultsLinkCopyName: "Copy the results link to the clipboard",
	resultsLinkCopyNotHeld:
		"Copy the results link — this browser does not hold it, so create a new one instead",
	resultsLinkCreate: "Create link",
	resultsLinkCreateName: "Create a results link and copy it",
	resultsLinkReplace: "Replace link",
	resultsLinkReplaceName:
		"Create a new results link — the current one stops working immediately",
	resultsLinkRevoke: "Revoke",
	resultsLinkRevokeName:
		"Revoke the results link — every copy of it stops working immediately",
	resultsLinkRevokeNone:
		"Revoke the results link — there is none to revoke",
	resultsLinkFootnote:
		"Revoking takes effect at once and applies to every copy of the link — there is one per deck, not one per recipient. A results page somebody already has open keeps the numbers it was last sent until it refreshes, and anything they have already read stays with them.",
	resultsLinkCreated: "Results link created and copied to clipboard",
	/** A mint whose link could not be put on the clipboard. */
	resultsLinkCreatedNotCopied:
		"Results link created, but it could not be copied. Select it in this dialog to copy it.",
	resultsLinkCopiedToast: "Results link copied to clipboard",
	resultsLinkRevoked: "Results link revoked — it no longer opens anything",
	resultsLinkCreateFailed: "Could not create the results link",
	resultsLinkRevokeFailed: "Could not revoke the results link",
};

export const de: Partial<typeof en> = {
	exportTitle: "Diese Sitzung exportieren",
	exportButton:
		"Diese Sitzung exportieren — lade sie als Tabelle oder als PDF herunter",
	exportButtonNoAccess:
		"Diese Sitzung exportieren — du kannst diese Präsentation nicht bearbeiten, also kannst du ihre Antworten nicht herunterladen",
	exportXlsxLabel: "Tabelle (.xlsx)",
	exportXlsxSummary:
		"Jede Antwort, die Matrix pro Teilnehmenden und jede Auszählung in Langform — die Datei, um die Sitzung auszuwerten.",
	exportPdfResultsLabel: "PDF mit Ergebnissen",
	exportPdfResultsSummary:
		"Die Präsentation Folie für Folie, mit den Auszählungen darunter — die Datei zum Lesen oder Weitergeben.",
	exportPdfDeckLabel: "PDF der Präsentation",
	exportPdfDeckSummary:
		"Dasselbe Dokument ohne das, was der Raum eingereicht hat — die Fragen, die Optionen und die Lösungen.",
	exportBusy: "{format} wird exportiert…",
	exportDone: "{format} exportiert",
	exportFailed: "{format} konnte nicht exportiert werden",
	exportFootnote:
		"Jede Datei ist eine Momentaufnahme der Sitzung, wie sie gerade ist. Exportiere, bevor du die Präsentation zurücksetzt — das Löschen der Ergebnisse lässt sich nicht rückgängig machen.",

	resultsLinkTitle: "Ergebnisse teilen",
	resultsLinkIntro:
		"Ein Ergebnislink öffnet die Ergebnisse dieser Präsentation auf einer Seite, die nur gelesen werden kann, ohne Konto und ohne Anmeldung. Wer ihn hat, sieht die Auszählung jeder Folie — auch die, die diese Präsentation dem Raum vorenthält — und sonst nichts: Mit ihm lässt sich die Präsentation nicht bearbeiten, starten, beenden oder zurücksetzen, die Tabelle nicht herunterladen und die Lösung einer laufenden Quizfrage nicht lesen.",
	resultsLinkChecking: "Wird geprüft…",
	resultsLinkNone:
		"Diese Präsentation hat keinen Ergebnislink. Nichts wird geteilt, bis du einen erstellst.",
	resultsLinkElsewhere:
		"Dieser Browser kann ihn nicht zeigen: Der Link ist nur als Fingerabdruck gespeichert, und eine Kopie, die sich nicht diesem Link zuordnen lässt, gibst du besser nicht weiter. Einen neuen zu erstellen, ersetzt ihn.",
	resultsLinkActiveUnknown: "Aktiv — erstellt zu einem nicht erfassten Zeitpunkt.",
	resultsLinkActiveSince: "Aktiv seit {time}.",
	resultsLinkCopy: "Link kopieren",
	resultsLinkCopied: "Kopiert!",
	resultsLinkCopyName: "Den Ergebnislink in die Zwischenablage kopieren",
	resultsLinkCopyNotHeld:
		"Den Ergebnislink kopieren — dieser Browser hat ihn nicht, also erstelle stattdessen einen neuen",
	resultsLinkCreate: "Link erstellen",
	resultsLinkCreateName: "Einen Ergebnislink erstellen und kopieren",
	resultsLinkReplace: "Link ersetzen",
	resultsLinkReplaceName:
		"Einen neuen Ergebnislink erstellen — der aktuelle funktioniert sofort nicht mehr",
	resultsLinkRevoke: "Widerrufen",
	resultsLinkRevokeName:
		"Den Ergebnislink widerrufen — jede Kopie davon funktioniert sofort nicht mehr",
	resultsLinkRevokeNone:
		"Den Ergebnislink widerrufen — es gibt keinen zum Widerrufen",
	resultsLinkFootnote:
		"Der Widerruf wirkt sofort und gilt für jede Kopie des Links — es gibt einen pro Präsentation, nicht einen pro Empfänger. Eine Ergebnisseite, die schon jemand offen hat, behält die zuletzt gesendeten Zahlen, bis sie neu lädt, und was schon gelesen wurde, bleibt gelesen.",
	resultsLinkCreated: "Ergebnislink erstellt und in die Zwischenablage kopiert",
	resultsLinkCreatedNotCopied:
		"Ergebnislink erstellt, aber er konnte nicht kopiert werden. Markiere ihn in diesem Dialog, um ihn zu kopieren.",
	resultsLinkCopiedToast: "Ergebnislink in die Zwischenablage kopiert",
	resultsLinkRevoked: "Ergebnislink widerrufen — er öffnet nichts mehr",
	resultsLinkCreateFailed: "Der Ergebnislink konnte nicht erstellt werden",
	resultsLinkRevokeFailed: "Der Ergebnislink konnte nicht widerrufen werden",
};
