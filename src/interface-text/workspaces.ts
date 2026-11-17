// The workspaces a deck can belong to (REQ128, REQ129, REQ004): the list at /workspaces (src/pages/WorkspacesPage.tsx), one workspace at /workspace/<id> (src/pages/WorkspacePage.tsx) with its decks, its default theme, its published templates and its roster, the roles' words (src/components/WorkspaceRoles.tsx), and the dialogs those pages and the home page open — moving a deck into a workspace and publishing one as a template — with the template card they draw (src/components/TemplateCard.tsx) — REQ248 slice 9.
// The template gallery at /templates draws the same card, and its category
// filter reads `templateCategories` too; the rest of that page is `templates`.

import type { DeckTemplateCategory, WorkspaceRole } from "../types";
import type { PluralText } from "./index";

/** One role in words: its name, the name inside a sentence, and what it grants. */
type RoleWording = { label: string; inSentence: string; summary: string };

export const en = {
	// ── The roles (REQ129, REQ131) ──
	roles: {
		commenter: {
			label: "Commenter",
			inSentence: "commenter",
			summary:
				"Opens every deck the workspace owns and comments on its slides. Cannot create, edit or present a deck, or start one from a template.",
		},
		member: {
			label: "Member",
			inSentence: "member",
			summary:
				"Opens, edits and presents every deck the workspace owns, and creates new ones in it. Cannot delete a deck, change who is in the workspace, or rename it.",
		},
		admin: {
			label: "Admin",
			inSentence: "admin",
			summary:
				"Everything a member can do, plus deleting the workspace's decks, deciding who else those decks are shared with, and adding or removing members.",
		},
		owner: {
			label: "Owner",
			inSentence: "owner",
			summary:
				"Everything an admin can do, plus renaming and deleting the workspace, making somebody else an owner, and moving a deck back out into a personal account.",
		},
	} as Record<WorkspaceRole, RoleWording>,
	noAccess: "No access",
	notInWorkspace: "You are not in this workspace.",
	accountGone: "Account no longer exists",

	// ── The list at /workspaces ──
	pageTitle: "Workspaces",
	back: "Back",
	eyebrow: "workspaces",
	headingStart: "Decks a ",
	headingAccent: "team",
	headingEnd: " owns",
	intro:
		"A workspace owns its decks itself. Everybody in it can open, edit and present every one of them, and removing somebody leaves the decks exactly where they were — no deck belongs to one account.",
	namePlaceholder: "Name your workspace",
	workspaceName: "Workspace name",
	createSignedOut: "Create a workspace — sign in first",
	createThis: "Create this workspace",
	createNameFirst: "Create a workspace — give it a name first",
	creating: "Creating…",
	create: "Create",
	ownerNote:
		"You become its owner: the only role that can rename it, delete it, hand out the owner role, or move one of its decks back into a personal account.",
	signInTitle: "Sign in to use workspaces",
	signInBody:
		"A workspace is shared between accounts, so it needs one. Sign in from the top right and your workspaces appear here.",
	noneTitle: "You are not in a workspace yet",
	noneBody:
		"Create one above, or ask somebody who has one to add you by the email address you signed up with.",
	/** `{name}` is the new workspace's name. */
	created: "“{name}” created — you are its owner",
	createFailed: "Could not create that workspace",

	// ── One workspace ──
	workspaceFallbackTitle: "Workspace",
	allWorkspaces: "All workspaces",
	workspaceEyebrow: "workspace",
	rename: "Rename this workspace",
	renameOwnerOnly: "Rename this workspace — only its owner can",
	/** `{role}` is the caller's role in a sentence, drawn in the accent. */
	youAre: "You are {role} here.",
	openFailed: "This workspace could not be opened",

	decksHeading: "Decks this workspace owns",
	createDeck: "Create a deck the workspace owns",
	createDeckRefused:
		"Create a deck here — your role in this workspace does not allow it",
	newDeck: "New deck",
	newDeckTitle: "Untitled presentation",
	newDeckSlide: "New slide",
	defaultThemeHeading: "New decks start in",
	defaultThemeNote:
		"A deck created here without a theme of its own takes this one, and can change it afterwards. Decks that already exist keep theirs.",
	defaultThemeOwnerOnly: " Only the workspace's owner can change it.",
	defaultThemeName: "Default theme for new decks in this workspace",
	defaultThemeSaving: "Saving the default theme…",
	defaultThemeRefused:
		"Only the workspace's owner can change its default theme",
	noDecks:
		"No decks yet. One created here belongs to the workspace rather than to you — everybody in it can open it, every role but a commenter can edit and present it, and it stays when anybody leaves.",
	slideCount: { one: "{count} slide", other: "{count} slides" } as PluralText,
	publishRefused:
		"Publish this deck as a template — only a workspace admin can",
	republish:
		"Republish this deck as a template — the entry takes its slides as they are now",
	publish:
		"Publish this deck as a template the whole workspace can start from",
	moveOut: "Move this deck out of the workspace and into your account",
	moveOutOwnerOnly: "Move this deck out — only the workspace's owner can",

	templatesHeading: "Templates this workspace publishes",
	noTemplates:
		"None yet. Publish one of the decks above and everybody here can start from a copy of it — the copy is taken at the moment you publish, so the deck stays yours to keep editing.",
	noTemplatesAdminOnly:
		" Publishing needs the admin role; ask somebody who has it.",
	/** `{name}` is who published it, `{date}` when. */
	publishedBy: "Published by {name} · {date}",
	formerMember: "a former member",
	/** `{title}` is the template's title. */
	useTemplate: "Create a new deck in this workspace from “{title}”",
	useTemplateRefused:
		"Create a deck from this template — your role in this workspace does not allow it",
	unpublish: "Unpublish",
	unpublishTitle: "Take this template out of the gallery — no deck is touched",
	unpublishAdminOnly: "Take this template down — only a workspace admin can",

	rosterHeading: "Who is in this workspace",
	emailPlaceholder: "their@email.address",
	emailToAdd: "Email address to add",
	roleToGive: "What this person will be able to do",
	addRefused: "Add somebody — your role in this workspace does not allow it",
	addThis: "Add this account to the workspace",
	addEmailFirst: "Add somebody — type the account's email address first",
	add: "Add",
	you: " (you)",
	changeRole: "Change what this person can do here",
	changeRoleRefused: "Change this role — your own role does not allow it",
	leave: "Leave this workspace",
	remove: "Remove this person from the workspace",
	removeRefused:
		"Remove somebody — your role in this workspace does not allow it",
	/** `{owner}` is the owner role in a sentence. */
	rosterNote:
		"Removing somebody takes effect at once — there is nothing of theirs to expire — and the workspace keeps every deck they worked on. Deleting a deck and deciding who outside the workspace it is shared with need the admin role; {owner} is the only role that can rename or delete the workspace itself, or change the theme its new decks start in.",
	deleteWorkspace: "Delete this workspace",
	deleteWorkspaceHasDecks:
		"Delete this workspace — move or delete its decks first",
	deleteWorkspaceOwnerOnly: "Delete this workspace — only its owner can",

	// The confirmations. `{workspace}` is the workspace's name.
	leaveTitle: "Leave workspace",
	removeTitle: "Remove member",
	leaveMessage:
		"Leave “{workspace}”? You lose access to its decks — the decks themselves stay with the workspace.",
	/** `{name}` is the member being removed. */
	removeMessage:
		"Remove {name} from “{workspace}”? They lose access at once. Every deck they worked on stays with the workspace.",
	leaveConfirm: "Leave",
	removeConfirm: "Remove",
	moveOutTitle: "Move deck out of the workspace",
	/** `{title}` is the deck's title. */
	moveOutMessage:
		"Move “{title}” into your own account? It leaves this workspace's list, everybody else in it loses access, and its old edit link stays retired.",
	moveOutConfirm: "Move to my account",
	unpublishConfirmTitle: "Unpublish template",
	/** `{title}` is the template's title. */
	unpublishMessage:
		"Take “{title}” out of this workspace's gallery? Nobody will be able to start from it again. No deck is touched — not the one it was published from, and not any deck already made from it.",
	deleteWorkspaceTitle: "Delete workspace",
	deleteWorkspaceBlocked: {
		one: "“{workspace}” still owns {count} deck. Move them out or delete them first — deleting the workspace never deletes a deck.",
		other:
			"“{workspace}” still owns {count} decks. Move them out or delete them first — deleting the workspace never deletes a deck.",
	} as PluralText,
	deleteWorkspaceMessage:
		"Delete “{workspace}”? Everybody in it loses it, and this cannot be undone.",
	deleteConfirm: "Delete",

	// Toasts. `{name}` is the member, `{role}` their role in a sentence.
	memberAdded: "{name} is now {role}",
	roleChanged: "{name} — {role}",
	addFailed: "Could not add that account",
	roleFailed: "Could not change that role",
	youLeft: "You have left the workspace",
	memberRemoved:
		"{name} is no longer in this workspace — its decks are untouched",
	removeFailed: "Could not remove that member",
	defaultThemeChanged:
		"New decks here start in this theme — existing decks keep theirs",
	defaultThemeFailed: "Could not change the default theme",
	renamed: "Workspace renamed",
	renameFailed: "Could not rename this workspace",
	deleted: "Workspace deleted",
	deleteFailed: "Could not delete this workspace",
	deckCreated: "Deck created in this workspace",
	deckCreateFailed: "Could not create a deck here",
	/** `{title}` is the template's title. */
	createdFromTemplate: "Created from “{title}”",
	createFromTemplateFailed: "Could not create a deck from this template",
	unpublished:
		"“{title}” is no longer a template — every deck made from it stays",
	unpublishFailed: "Could not take that template down",
	/** `{title}` is the deck's title. */
	movedOut: "“{title}” is now yours alone",
	moveOutFailed: "Could not move that deck out",

	// ── Handing a deck to a workspace (MoveToWorkspaceDialog) ──
	moveTitle: "Move to a workspace",
	/** `{title}` is the deck's title, drawn emphasised. */
	moveIntro:
		"Hand {title} to a workspace. Everybody in it can then open, edit and present it, and it stays there whoever comes or goes — including you. It stops being yours: the deck's existing edit link is retired by the move, and only a workspace owner can take it back out.",
	checking: "Checking…",
	noWorkspaceTakesDecks:
		"You are not in a workspace that takes new decks. Create one from the Workspaces page, or ask somebody to add you to theirs.",
	/** `{workspace}` is the workspace's name. */
	handTo: "Hand this deck to {workspace}",
	/** `{title}` is the deck's title, `{workspace}` the workspace's name. */
	moved: "“{title}” now belongs to {workspace}",
	moveFailed: "Could not move this deck",

	// ── Publishing a deck as a template (PublishTemplateDialog) ──
	publishDialogTitle: "Publish as template",
	republishDialogTitle: "Republish as template",
	republishIntro:
		"This deck is already a template here. Republishing replaces the entry's slides with the deck's as they are right now — decks somebody already made from it are untouched.",
	publishIntro:
		"Everybody in this workspace will be able to start a new deck from a copy of this one. The copy is taken now: editing this deck afterwards will not change the template, and republishing is how you update it.",
	galleryName: "Name in the gallery",
	whatFor: "What it is for",
	descriptionLabel: "A sentence or two",
	optional: "(optional)",
	descriptionPlaceholder: "What this deck is for, and when to reach for it.",
	tagsLabel: "Words to find it by",
	tagsOptional: "(optional, comma-separated)",
	tagsPlaceholder: "retro, sprint, team",
	/** `{limit}` is how many words an entry may carry. */
	tagsNote:
		"Up to {limit}; every one of them is shown on the card, so a search always has a visible reason.",
	cancel: "Cancel",
	publishNameFirst: "Publish — give the template a name first",
	republishAction: "Replace this template's slides with the deck's",
	publishAction: "Publish this deck as a template for the workspace",
	publishing: "Publishing…",
	republishButton: "Republish",
	publishButton: "Publish",
	/** `{title}` is the template's title. */
	republished: "“{title}” now holds this deck's slides as they are today",
	published: "“{title}” is a template this workspace can start from",
	publishFailed: "Could not publish this deck",

	// ── The template card (TemplateCard, UseTemplateButton) ──
	templateCategories: {
		meeting: "Meetings",
		workshop: "Workshops",
		education: "Teaching",
		feedback: "Feedback",
		engagement: "Engagement",
	} as Record<DeckTemplateCategory, string>,
	templateBusy: "Another template is being created — one at a time.",
	templateCreating: "Creating…",
	templateUse: "Use template",
};

export const de: Partial<typeof en> = {
	roles: {
		commenter: {
			label: "Kommentator",
			inSentence: "Kommentator",
			summary:
				"Öffnet jede Präsentation des Arbeitsbereichs und kommentiert ihre Folien. Kann keine Präsentation erstellen, bearbeiten oder vorführen und keine aus einer Vorlage starten.",
		},
		member: {
			label: "Mitglied",
			inSentence: "Mitglied",
			summary:
				"Öffnet, bearbeitet und führt jede Präsentation des Arbeitsbereichs vor und erstellt neue darin. Kann keine Präsentation löschen, nicht ändern, wer im Arbeitsbereich ist, und ihn nicht umbenennen.",
		},
		admin: {
			label: "Admin",
			inSentence: "Admin",
			summary:
				"Alles, was ein Mitglied kann, und dazu: Präsentationen des Arbeitsbereichs löschen, entscheiden, mit wem sie sonst noch geteilt sind, und Mitglieder hinzufügen oder entfernen.",
		},
		owner: {
			label: "Inhaber",
			inSentence: "Inhaber",
			summary:
				"Alles, was ein Admin kann, und dazu: den Arbeitsbereich umbenennen und löschen, jemand anderen zum Inhaber machen und eine Präsentation zurück in ein persönliches Konto verschieben.",
		},
	},
	noAccess: "Kein Zugriff",
	notInWorkspace: "Du bist nicht in diesem Arbeitsbereich.",
	accountGone: "Konto existiert nicht mehr",

	pageTitle: "Arbeitsbereiche",
	back: "Zurück",
	eyebrow: "Arbeitsbereiche",
	headingStart: "Präsentationen, die einem ",
	headingAccent: "Team",
	headingEnd: " gehören",
	intro:
		"Ein Arbeitsbereich besitzt seine Präsentationen selbst. Alle darin können jede davon öffnen, bearbeiten und vorführen, und wird jemand entfernt, bleiben die Präsentationen genau, wo sie waren — keine Präsentation gehört einem einzelnen Konto.",
	namePlaceholder: "Benenne deinen Arbeitsbereich",
	workspaceName: "Name des Arbeitsbereichs",
	createSignedOut: "Einen Arbeitsbereich erstellen — melde dich zuerst an",
	createThis: "Diesen Arbeitsbereich erstellen",
	createNameFirst: "Einen Arbeitsbereich erstellen — gib ihm zuerst einen Namen",
	creating: "Wird erstellt…",
	create: "Erstellen",
	ownerNote:
		"Du wirst sein Inhaber: die einzige Rolle, die ihn umbenennen, löschen, die Inhaber-Rolle vergeben oder eine seiner Präsentationen zurück in ein persönliches Konto verschieben kann.",
	signInTitle: "Melde dich an, um Arbeitsbereiche zu nutzen",
	signInBody:
		"Ein Arbeitsbereich wird zwischen Konten geteilt, deshalb braucht er eines. Melde dich oben rechts an, dann erscheinen deine Arbeitsbereiche hier.",
	noneTitle: "Du bist noch in keinem Arbeitsbereich",
	noneBody:
		"Erstelle oben einen oder bitte jemanden, der einen hat, dich mit der E-Mail-Adresse hinzuzufügen, mit der du dich registriert hast.",
	created: "„{name}“ erstellt — du bist sein Inhaber",
	createFailed: "Dieser Arbeitsbereich konnte nicht erstellt werden",

	workspaceFallbackTitle: "Arbeitsbereich",
	allWorkspaces: "Alle Arbeitsbereiche",
	workspaceEyebrow: "Arbeitsbereich",
	rename: "Diesen Arbeitsbereich umbenennen",
	renameOwnerOnly: "Diesen Arbeitsbereich umbenennen — das kann nur sein Inhaber",
	youAre: "Du bist hier {role}.",
	openFailed: "Dieser Arbeitsbereich konnte nicht geöffnet werden",

	decksHeading: "Präsentationen dieses Arbeitsbereichs",
	createDeck: "Eine Präsentation erstellen, die dem Arbeitsbereich gehört",
	createDeckRefused:
		"Hier eine Präsentation erstellen — deine Rolle in diesem Arbeitsbereich erlaubt das nicht",
	newDeck: "Neue Präsentation",
	newDeckTitle: "Unbenannte Präsentation",
	newDeckSlide: "Neue Folie",
	defaultThemeHeading: "Neue Präsentationen starten in",
	defaultThemeNote:
		"Eine hier erstellte Präsentation ohne eigenes Design übernimmt dieses und kann es danach ändern. Bestehende Präsentationen behalten ihres.",
	defaultThemeOwnerOnly: " Nur der Inhaber des Arbeitsbereichs kann es ändern.",
	defaultThemeName:
		"Standarddesign für neue Präsentationen in diesem Arbeitsbereich",
	defaultThemeSaving: "Standarddesign wird gespeichert…",
	defaultThemeRefused:
		"Nur der Inhaber des Arbeitsbereichs kann sein Standarddesign ändern",
	noDecks:
		"Noch keine Präsentationen. Eine hier erstellte gehört dem Arbeitsbereich statt dir — alle darin können sie öffnen, jede Rolle außer Kommentator kann sie bearbeiten und vorführen, und sie bleibt, wenn jemand geht.",
	slideCount: { one: "{count} Folie", other: "{count} Folien" },
	publishRefused:
		"Diese Präsentation als Vorlage veröffentlichen — das kann nur ein Admin des Arbeitsbereichs",
	republish:
		"Diese Präsentation erneut als Vorlage veröffentlichen — der Eintrag übernimmt ihre Folien, wie sie jetzt sind",
	publish:
		"Diese Präsentation als Vorlage veröffentlichen, mit der der ganze Arbeitsbereich starten kann",
	moveOut:
		"Diese Präsentation aus dem Arbeitsbereich in dein Konto verschieben",
	moveOutOwnerOnly:
		"Diese Präsentation herausnehmen — das kann nur der Inhaber des Arbeitsbereichs",

	templatesHeading: "Vorlagen dieses Arbeitsbereichs",
	noTemplates:
		"Noch keine. Veröffentliche eine der Präsentationen oben, dann können alle hier mit einer Kopie davon starten — die Kopie entsteht beim Veröffentlichen, die Präsentation selbst kannst du also weiter bearbeiten.",
	noTemplatesAdminOnly:
		" Zum Veröffentlichen braucht es die Admin-Rolle; frag jemanden, der sie hat.",
	publishedBy: "Veröffentlicht von {name} · {date}",
	formerMember: "einem ehemaligen Mitglied",
	useTemplate:
		"Eine neue Präsentation in diesem Arbeitsbereich aus „{title}“ erstellen",
	useTemplateRefused:
		"Eine Präsentation aus dieser Vorlage erstellen — deine Rolle in diesem Arbeitsbereich erlaubt das nicht",
	unpublish: "Zurückziehen",
	unpublishTitle:
		"Diese Vorlage aus der Galerie nehmen — keine Präsentation wird angefasst",
	unpublishAdminOnly:
		"Diese Vorlage zurückziehen — das kann nur ein Admin des Arbeitsbereichs",

	rosterHeading: "Wer in diesem Arbeitsbereich ist",
	emailPlaceholder: "name@beispiel.de",
	emailToAdd: "Hinzuzufügende E-Mail-Adresse",
	roleToGive: "Was diese Person tun darf",
	addRefused:
		"Jemanden hinzufügen — deine Rolle in diesem Arbeitsbereich erlaubt das nicht",
	addThis: "Dieses Konto zum Arbeitsbereich hinzufügen",
	addEmailFirst:
		"Jemanden hinzufügen — gib zuerst die E-Mail-Adresse des Kontos ein",
	add: "Hinzufügen",
	you: " (du)",
	changeRole: "Ändern, was diese Person hier tun darf",
	changeRoleRefused: "Diese Rolle ändern — deine eigene Rolle erlaubt das nicht",
	leave: "Diesen Arbeitsbereich verlassen",
	remove: "Diese Person aus dem Arbeitsbereich entfernen",
	removeRefused:
		"Jemanden entfernen — deine Rolle in diesem Arbeitsbereich erlaubt das nicht",
	rosterNote:
		"Das Entfernen wirkt sofort — es gibt nichts, das erst ablaufen müsste —, und der Arbeitsbereich behält jede Präsentation, an der die Person gearbeitet hat. Eine Präsentation zu löschen und zu entscheiden, mit wem außerhalb des Arbeitsbereichs sie geteilt ist, braucht die Admin-Rolle; nur die Rolle {owner} kann den Arbeitsbereich selbst umbenennen oder löschen oder das Design ändern, in dem seine neuen Präsentationen starten.",
	deleteWorkspace: "Diesen Arbeitsbereich löschen",
	deleteWorkspaceHasDecks:
		"Diesen Arbeitsbereich löschen — verschiebe oder lösche zuerst seine Präsentationen",
	deleteWorkspaceOwnerOnly:
		"Diesen Arbeitsbereich löschen — das kann nur sein Inhaber",

	leaveTitle: "Arbeitsbereich verlassen",
	removeTitle: "Mitglied entfernen",
	leaveMessage:
		"„{workspace}“ verlassen? Du verlierst den Zugriff auf seine Präsentationen — die Präsentationen selbst bleiben im Arbeitsbereich.",
	removeMessage:
		"{name} aus „{workspace}“ entfernen? Der Zugriff endet sofort. Jede Präsentation, an der die Person gearbeitet hat, bleibt im Arbeitsbereich.",
	leaveConfirm: "Verlassen",
	removeConfirm: "Entfernen",
	moveOutTitle: "Präsentation aus dem Arbeitsbereich nehmen",
	moveOutMessage:
		"„{title}“ in dein eigenes Konto verschieben? Sie verschwindet aus der Liste dieses Arbeitsbereichs, alle anderen darin verlieren den Zugriff, und ihr alter Bearbeitungslink bleibt ungültig.",
	moveOutConfirm: "In mein Konto verschieben",
	unpublishConfirmTitle: "Vorlage zurückziehen",
	unpublishMessage:
		"„{title}“ aus der Galerie dieses Arbeitsbereichs nehmen? Niemand kann danach noch damit starten. Keine Präsentation wird angefasst — weder die, aus der sie veröffentlicht wurde, noch eine, die schon daraus entstanden ist.",
	deleteWorkspaceTitle: "Arbeitsbereich löschen",
	deleteWorkspaceBlocked: {
		one: "„{workspace}“ besitzt noch {count} Präsentation. Verschiebe oder lösche sie zuerst — das Löschen des Arbeitsbereichs löscht nie eine Präsentation.",
		other:
			"„{workspace}“ besitzt noch {count} Präsentationen. Verschiebe oder lösche sie zuerst — das Löschen des Arbeitsbereichs löscht nie eine Präsentation.",
	},
	deleteWorkspaceMessage:
		"„{workspace}“ löschen? Alle darin verlieren ihn, und das lässt sich nicht rückgängig machen.",
	deleteConfirm: "Löschen",

	memberAdded: "{name} ist jetzt {role}",
	roleChanged: "{name} — {role}",
	addFailed: "Dieses Konto konnte nicht hinzugefügt werden",
	roleFailed: "Diese Rolle konnte nicht geändert werden",
	youLeft: "Du hast den Arbeitsbereich verlassen",
	memberRemoved:
		"{name} ist nicht mehr in diesem Arbeitsbereich — die Präsentationen bleiben unberührt",
	removeFailed: "Dieses Mitglied konnte nicht entfernt werden",
	defaultThemeChanged:
		"Neue Präsentationen starten hier in diesem Design — bestehende behalten ihres",
	defaultThemeFailed: "Das Standarddesign konnte nicht geändert werden",
	renamed: "Arbeitsbereich umbenannt",
	renameFailed: "Dieser Arbeitsbereich konnte nicht umbenannt werden",
	deleted: "Arbeitsbereich gelöscht",
	deleteFailed: "Dieser Arbeitsbereich konnte nicht gelöscht werden",
	deckCreated: "Präsentation in diesem Arbeitsbereich erstellt",
	deckCreateFailed: "Hier konnte keine Präsentation erstellt werden",
	createdFromTemplate: "Aus „{title}“ erstellt",
	createFromTemplateFailed:
		"Aus dieser Vorlage konnte keine Präsentation erstellt werden",
	unpublished:
		"„{title}“ ist keine Vorlage mehr — jede daraus erstellte Präsentation bleibt",
	unpublishFailed: "Diese Vorlage konnte nicht zurückgezogen werden",
	movedOut: "„{title}“ gehört jetzt nur dir",
	moveOutFailed: "Diese Präsentation konnte nicht herausgenommen werden",

	moveTitle: "In einen Arbeitsbereich verschieben",
	moveIntro:
		"Übergib {title} an einen Arbeitsbereich. Alle darin können sie dann öffnen, bearbeiten und vorführen, und sie bleibt dort, egal wer kommt oder geht — auch du. Sie gehört dann nicht mehr dir: Der bisherige Bearbeitungslink wird durch die Übergabe ungültig, und nur ein Inhaber des Arbeitsbereichs kann sie wieder herausnehmen.",
	checking: "Wird geprüft…",
	noWorkspaceTakesDecks:
		"Du bist in keinem Arbeitsbereich, der neue Präsentationen aufnimmt. Erstelle einen auf der Seite „Arbeitsbereiche“ oder bitte jemanden, dich zu seinem hinzuzufügen.",
	handTo: "Diese Präsentation an {workspace} übergeben",
	moved: "„{title}“ gehört jetzt zu {workspace}",
	moveFailed: "Diese Präsentation konnte nicht verschoben werden",

	publishDialogTitle: "Als Vorlage veröffentlichen",
	republishDialogTitle: "Erneut als Vorlage veröffentlichen",
	republishIntro:
		"Diese Präsentation ist hier schon eine Vorlage. Erneutes Veröffentlichen ersetzt die Folien des Eintrags durch die der Präsentation, wie sie gerade sind — Präsentationen, die schon daraus erstellt wurden, bleiben unberührt.",
	publishIntro:
		"Alle in diesem Arbeitsbereich können eine neue Präsentation aus einer Kopie dieser starten. Die Kopie entsteht jetzt: Spätere Änderungen an dieser Präsentation ändern die Vorlage nicht, und mit erneutem Veröffentlichen aktualisierst du sie.",
	galleryName: "Name in der Galerie",
	whatFor: "Wofür sie gedacht ist",
	descriptionLabel: "Ein, zwei Sätze",
	optional: "(optional)",
	descriptionPlaceholder:
		"Wofür diese Präsentation gedacht ist und wann man zu ihr greift.",
	tagsLabel: "Suchbegriffe",
	tagsOptional: "(optional, durch Kommas getrennt)",
	tagsPlaceholder: "Retro, Sprint, Team",
	tagsNote:
		"Bis zu {limit}; jeder steht auf der Karte, damit eine Suche immer einen sichtbaren Grund hat.",
	cancel: "Abbrechen",
	publishNameFirst: "Veröffentlichen — gib der Vorlage zuerst einen Namen",
	republishAction:
		"Die Folien dieser Vorlage durch die der Präsentation ersetzen",
	publishAction:
		"Diese Präsentation als Vorlage für den Arbeitsbereich veröffentlichen",
	publishing: "Wird veröffentlicht…",
	republishButton: "Aktualisieren",
	publishButton: "Veröffentlichen",
	republished:
		"„{title}“ enthält jetzt die Folien dieser Präsentation, wie sie heute sind",
	published: "„{title}“ ist eine Vorlage, mit der dieser Arbeitsbereich starten kann",
	publishFailed: "Diese Präsentation konnte nicht veröffentlicht werden",

	templateCategories: {
		meeting: "Meetings",
		workshop: "Workshops",
		education: "Unterricht",
		feedback: "Feedback",
		engagement: "Beteiligung",
	},
	templateBusy: "Eine andere Vorlage wird gerade erstellt — eine nach der anderen.",
	templateCreating: "Wird erstellt…",
	templateUse: "Vorlage verwenden",
};
