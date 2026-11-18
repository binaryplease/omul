// The home page (src/pages/HomePage.tsx): its hero and actions, the list of your presentations with its folders and empty states, each deck card's actions and their disabled reasons, the shared-with-you list, the folder dialogs and the delete confirmations — REQ248 slice 8.
// The account controls, the verify-email banner and the sign-in dialog are the
// account surfaces of slice 11; the email-recovery notice reads the deck
// dictionary's words for the interface language, as it was built to.

import type { PluralText } from "./index";

export const en = {
	// The hero.
	heroTitleStart: "Live Interactive",
	heroTitleAccent: " Presentations",
	heroIntro:
		"Create polls, word clouds, Q&A sessions, and quizzes. Participants join with a code on any device.",

	// The ways a deck starts, and the rest of the actions row.
	createPresentation: "Create Presentation",
	useTemplate: "Use a Template",
	useTemplateTitle: "Start from a prebuilt deck you can edit",
	generateDraft: "Generate a Draft",
	generateDraftTitle: "Describe a session and get a draft deck to edit",
	workspaces: "Workspaces",
	workspacesTitle: "Decks a team owns together",
	joinWithCode: "Join with Code",
	importDeck: "Import",
	importing: "Importing…",
	importTitle: "Import a presentation from a .omul.json file",

	// The list of your own decks.
	yourPresentations: "Your Presentations",
	newFolder: "New folder",
	newFolderSignedOut: "New folder — sign in to group your decks into folders",
	newFolderTitle: "Make a folder to group your decks",
	noPresentations: "No presentations yet",
	noPresentationsBody:
		"Create your first presentation to start collecting live responses from your audience.",
	createFirst: "Create your first presentation",
	startFromTemplate: "Start from a template",
	unfiled: "Unfiled",
	/** `{name}` is the folder's name. */
	shareFolderTitle:
		"Share the folder “{name}” and every deck in it with another account",
	renameFolderTitle: "Rename the folder “{name}”",
	deleteFolderTitle: "Delete the folder “{name}” — its decks are kept",
	emptyFolder:
		"No decks in this folder yet. Use the folder button on a deck to file it here.",
	sharedWithYou: "Shared with You",

	// One of your own decks, on its card.
	slideCount: { one: "{count} slide", other: "{count} slides" } as PluralText,
	shareDeck: "Share this deck with another account",
	shareDeckNotOwner:
		"Share this deck — only its owner can, and this account does not own it",
	shareDeckSignedOut:
		"Share this deck — sign in with the account that owns it first",
	fileDeck: "Move this deck into a folder",
	fileDeckNotOwner:
		"Move this deck into a folder — only its owner can, and this account does not own it",
	fileDeckSignedOut:
		"Move this deck into a folder — sign in with the account that owns it first",
	moveDeck: "Move this deck into a workspace",
	moveDeckNotOwner:
		"Move this deck into a workspace — only its owner can, and this account does not own it",
	moveDeckSignedOut:
		"Move this deck into a workspace — sign in with the account that owns it first",
	exportDeck: "Export presentation as JSON",
	duplicateDeck: "Duplicate presentation",
	deleteDeck: "Delete presentation",

	// Choosing a deck's folder.
	moveToFolder: "Move to a folder",
	alreadyHere: "The deck is already here",
	/** `{title}` is the deck's title, `{folder}` the folder's name. */
	fileIn: "File “{title}” in {folder}",
	takeOutOfFolder: "Take “{title}” out of its folder",
	noFolder: "No folder",
	noFoldersYet:
		"You have no folders yet — make one with New folder above your decks.",

	// Naming a folder.
	renameFolder: "Rename folder",
	folderNamePlaceholder: "Name the folder",
	folderName: "Folder name",
	saveName: "Save this name",
	nameFirst: "Give the folder a name first",
	rename: "Rename",
	create: "Create",

	// The confirmations.
	deleteFolder: "Delete folder",
	/** `{name}` is the folder's name. */
	deleteFolderMessage:
		"Delete the folder \"{name}\"? Its decks are kept and go back to Unfiled.",
	deletePresentation: "Delete presentation",
	/** `{title}` is the deck's title. */
	deletePresentationMessage:
		"Are you sure you want to delete \"{title}\"? This action cannot be undone.",
	deleteConfirm: "Delete",

	// Toasts.
	presentationDeleted: "Presentation deleted",
	presentationImported: "Presentation imported",
	presentationDuplicated: "Presentation duplicated",
	invalidJson: "Invalid JSON file",
	/** A JSON file that is not a presentation export (`ImportFileError`). */
	importNotObject: "Invalid file: expected a JSON object",
	importMissingFields: "Invalid file: missing `title` or `slides`",
	importFailed: "Failed to import presentation",
	duplicateFailed: "Failed to duplicate presentation",
	foldersFailed: "Could not change your folders",
	/** `{folder}` is the folder's name. */
	filedIn: "Filed in {folder}",
	movedToUnfiled: "Moved to Unfiled",
	folderRenamed: "Folder renamed",
	/** `{name}` is the new folder's name. */
	folderCreated: "Folder “{name}” created",
	folderDeleted: "Folder deleted",
};

export const de: Partial<typeof en> = {
	heroTitleStart: "Interaktive",
	heroTitleAccent: " Live-Präsentationen",
	heroIntro:
		"Erstelle Umfragen, Wortwolken, Fragerunden und Quizze. Teilnehmende machen mit einem Code auf jedem Gerät mit.",

	createPresentation: "Präsentation erstellen",
	useTemplate: "Vorlage verwenden",
	useTemplateTitle: "Mit einer fertigen Präsentation starten, die du bearbeiten kannst",
	generateDraft: "Entwurf generieren",
	generateDraftTitle:
		"Beschreibe eine Sitzung und erhalte einen Entwurf zum Bearbeiten",
	workspaces: "Arbeitsbereiche",
	workspacesTitle: "Präsentationen, die einem Team gemeinsam gehören",
	joinWithCode: "Mit Code beitreten",
	importDeck: "Importieren",
	importing: "Wird importiert…",
	importTitle: "Eine Präsentation aus einer .omul.json-Datei importieren",

	yourPresentations: "Deine Präsentationen",
	newFolder: "Neuer Ordner",
	newFolderSignedOut:
		"Neuer Ordner — melde dich an, um deine Präsentationen in Ordnern zu gruppieren",
	newFolderTitle: "Einen Ordner anlegen, um deine Präsentationen zu gruppieren",
	noPresentations: "Noch keine Präsentationen",
	noPresentationsBody:
		"Erstelle deine erste Präsentation und sammle live die Antworten deines Publikums.",
	createFirst: "Erste Präsentation erstellen",
	startFromTemplate: "Mit einer Vorlage starten",
	unfiled: "Ohne Ordner",
	shareFolderTitle:
		"Den Ordner „{name}“ und alle Präsentationen darin mit einem anderen Konto teilen",
	renameFolderTitle: "Den Ordner „{name}“ umbenennen",
	deleteFolderTitle:
		"Den Ordner „{name}“ löschen — seine Präsentationen bleiben erhalten",
	emptyFolder:
		"Noch keine Präsentationen in diesem Ordner. Lege eine über die Ordner-Schaltfläche auf ihrer Karte hier ab.",
	sharedWithYou: "Mit dir geteilt",

	slideCount: { one: "{count} Folie", other: "{count} Folien" },
	shareDeck: "Diese Präsentation mit einem anderen Konto teilen",
	shareDeckNotOwner:
		"Diese Präsentation teilen — das kann nur ihr Inhaber, und dieses Konto ist es nicht",
	shareDeckSignedOut:
		"Diese Präsentation teilen — melde dich zuerst mit dem Konto an, dem sie gehört",
	fileDeck: "Diese Präsentation in einen Ordner verschieben",
	fileDeckNotOwner:
		"Diese Präsentation in einen Ordner verschieben — das kann nur ihr Inhaber, und dieses Konto ist es nicht",
	fileDeckSignedOut:
		"Diese Präsentation in einen Ordner verschieben — melde dich zuerst mit dem Konto an, dem sie gehört",
	moveDeck: "Diese Präsentation in einen Arbeitsbereich verschieben",
	moveDeckNotOwner:
		"Diese Präsentation in einen Arbeitsbereich verschieben — das kann nur ihr Inhaber, und dieses Konto ist es nicht",
	moveDeckSignedOut:
		"Diese Präsentation in einen Arbeitsbereich verschieben — melde dich zuerst mit dem Konto an, dem sie gehört",
	exportDeck: "Präsentation als JSON exportieren",
	duplicateDeck: "Präsentation duplizieren",
	deleteDeck: "Präsentation löschen",

	moveToFolder: "In einen Ordner verschieben",
	alreadyHere: "Die Präsentation liegt schon hier",
	fileIn: "„{title}“ in {folder} ablegen",
	takeOutOfFolder: "„{title}“ aus ihrem Ordner nehmen",
	noFolder: "Kein Ordner",
	noFoldersYet:
		"Du hast noch keine Ordner — lege einen mit „Neuer Ordner“ über deinen Präsentationen an.",

	renameFolder: "Ordner umbenennen",
	folderNamePlaceholder: "Ordner benennen",
	folderName: "Ordnername",
	saveName: "Diesen Namen speichern",
	nameFirst: "Gib dem Ordner zuerst einen Namen",
	rename: "Umbenennen",
	create: "Anlegen",

	deleteFolder: "Ordner löschen",
	deleteFolderMessage:
		"Den Ordner „{name}“ löschen? Seine Präsentationen bleiben erhalten und landen wieder unter „Ohne Ordner“.",
	deletePresentation: "Präsentation löschen",
	deletePresentationMessage:
		"Möchtest du „{title}“ wirklich löschen? Das lässt sich nicht rückgängig machen.",
	deleteConfirm: "Löschen",

	presentationDeleted: "Präsentation gelöscht",
	presentationImported: "Präsentation importiert",
	presentationDuplicated: "Präsentation dupliziert",
	invalidJson: "Ungültige JSON-Datei",
	importNotObject: "Ungültige Datei: Erwartet wird ein JSON-Objekt",
	importMissingFields: "Ungültige Datei: `title` oder `slides` fehlt",
	importFailed: "Die Präsentation konnte nicht importiert werden",
	duplicateFailed: "Die Präsentation konnte nicht dupliziert werden",
	foldersFailed: "Deine Ordner konnten nicht geändert werden",
	filedIn: "In {folder} abgelegt",
	movedToUnfiled: "Nach „Ohne Ordner“ verschoben",
	folderRenamed: "Ordner umbenannt",
	folderCreated: "Ordner „{name}“ angelegt",
	folderDeleted: "Ordner gelöscht",
};
