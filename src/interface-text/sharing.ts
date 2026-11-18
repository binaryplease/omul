// Who a deck or a folder is shared with (`CollaboratorsDialog` in src/components/CollaboratorsDialog.tsx, REQ075, REQ126), and the access levels' names on a shared deck's card — REQ248 slice 8, where the home page opens the dialog from a deck's card and a folder's heading.

import type { DeckAccessLevel } from "../types";

/** How the dialog speaks about one kind of subject. */
type SubjectWording = {
	title: string;
	/** Follows the intro's first sentence; empty for a deck. */
	reach: string;
	/** Completes "They sign in … and {found} under …". */
	found: string;
	/** What a grant reaches, completing "can now … {granted}". */
	granted: string;
	inviteTitle: string;
	unshared: string;
	kept: string;
};

export const en = {
	/** Each level's name on the picker and on a shared deck's card, its name inside a sentence, and what it grants today. */
	accessLevels: {
		view: {
			label: "Can view",
			inSentence: "can view",
			summary:
				"Opens the deck and its results, including what the room is kept from. Changes nothing.",
		},
		comment: {
			label: "Can comment",
			inSentence: "can comment",
			summary:
				"Everything a viewer can do. Commenting on slides is not built yet, so today this grants no more than “Can view”.",
		},
		edit: {
			label: "Can edit",
			inSentence: "can edit",
			summary:
				"Edits the slides, runs the session and reveals results. Cannot delete the deck or change who it is shared with — both stay with you.",
		},
	} as Record<
		DeckAccessLevel,
		{ label: string; inSentence: string; summary: string }
	>,
	noAccess: "No access",
	notSharedWithYou: "This deck is not shared with you.",
	accountGone: "Account no longer exists",

	subjects: {
		deck: {
			title: "Share this deck",
			reach: "",
			found: "find it",
			granted: "this deck",
			inviteTitle: "Share this deck with that account",
			unshared:
				"This deck is shared with nobody. Only you can open, edit and run it.",
			kept: "Deleting this deck, and deciding who it is shared with, stay with you whatever level you grant.",
		},
		folder: {
			title: "Share this folder",
			reach:
				" The level reaches every deck filed in it — the ones there now and any you file later — and a deck you move out of it is no longer reached.",
			found: "find its decks",
			granted: "the decks in this folder",
			inviteTitle: "Share this folder and its decks with that account",
			unshared:
				"This folder is shared with nobody. Its decks are reached only by you and by whoever each deck is shared with.",
			kept: "Deleting its decks, and deciding who the folder is shared with, stay with you whatever level you grant.",
		},
	} as Record<"deck" | "folder", SubjectWording>,

	/** `{brand}` is the product's name, `{title}` the deck's or folder's. */
	intro: "Give another {brand} account access to {title}.",
	/** `{found}` is the subject's own phrase above. */
	introHow:
		" They sign in with their own account and {found} under “Shared with you” — there is no link to pass on and nothing for them to forward. The level you choose is enforced on the server for every change they try to make, not just in what they are shown.",
	emailPlaceholder: "their@email.address",
	emailName: "Email address to share with",
	levelName: "What this person will be able to do",
	/** `{invite}` is the subject's invite title. */
	inviteEmailFirst: "{invite} — type the account's email address first",
	invite: "Invite",
	checking: "Checking…",
	changeLevel: "Change what this person can do",
	revoke: "Remove this person's access — it stops at their next request",
	/** `{kept}` is the subject's own sentence. */
	removalNote:
		"Removing somebody takes effect at once — there is nothing of theirs to expire. What it cannot reach is a page they already have open, which keeps what it was last sent until it next asks the server. {kept}",

	// Toasts. `{name}` is the person, `{level}` their level in a sentence.
	/** `{granted}` is what the grant reaches. */
	shared: "{name} can now {level} {granted}",
	levelChanged: "{name} — {level}",
	revoked: "{name} no longer has access",
	shareFailed: "Could not share {granted}",
	levelFailed: "Could not change that access level",
	revokeFailed: "Could not remove that collaborator",

	// A deck's grants that come through the folder it is filed in (REQ126).
	// `{folder}` is the folder's name, `{level}` a level's name.
	revokeThroughFolder:
		"Remove this person's access through this folder — it stops at their next request",
	revokeKeepsFolder:
		"Remove this grant — they keep “{level}” through the folder “{folder}”",
	revokedThroughFolder: "{name} no longer has access through this folder",
	revokedKeepsFolder:
		"{name} no longer has a grant on this deck, but keeps “{level}” through the folder “{folder}”",
	noOwnGrants: "No account has a grant on this deck itself.",
	folderManagedThere:
		"Change or revoke this in the share dialog of the folder “{folder}”",
	/** `{folder}` is drawn as the folder's name, emphasised. */
	folderStandingNote:
		"These accounts reach this deck through the shared folder {folder}. Revoking a grant above leaves this access in place. An account listed in both places has the stronger of its two levels. Change or revoke this access in that folder's share dialog.",
};

export const de: Partial<typeof en> = {
	accessLevels: {
		view: {
			label: "Ansehen",
			inSentence: "darf ansehen",
			summary:
				"Öffnet die Präsentation und ihre Ergebnisse, auch das, was dem Raum verborgen bleibt. Ändert nichts.",
		},
		comment: {
			label: "Kommentieren",
			inSentence: "darf kommentieren",
			summary:
				"Alles, was Ansehende können. Kommentare auf Folien gibt es noch nicht, deshalb erlaubt das heute nicht mehr als „Ansehen“.",
		},
		edit: {
			label: "Bearbeiten",
			inSentence: "darf bearbeiten",
			summary:
				"Bearbeitet die Folien, führt die Sitzung und deckt Ergebnisse auf. Kann die Präsentation nicht löschen und nicht ändern, mit wem sie geteilt ist — beides bleibt bei dir.",
		},
	},
	noAccess: "Kein Zugriff",
	notSharedWithYou: "Diese Präsentation ist nicht mit dir geteilt.",
	accountGone: "Konto existiert nicht mehr",

	subjects: {
		deck: {
			title: "Diese Präsentation teilen",
			reach: "",
			found: "findet sie",
			granted: "diese Präsentation",
			inviteTitle: "Diese Präsentation mit diesem Konto teilen",
			unshared:
				"Diese Präsentation ist mit niemandem geteilt. Nur du kannst sie öffnen, bearbeiten und vorführen.",
			kept: "Die Präsentation zu löschen und zu entscheiden, mit wem sie geteilt ist, bleibt bei dir, egal welche Stufe du vergibst.",
		},
		folder: {
			title: "Diesen Ordner teilen",
			reach:
				" Die Stufe gilt für jede Präsentation im Ordner — die jetzigen und alle, die du später ablegst —, und eine Präsentation, die du herausnimmst, ist nicht mehr erfasst.",
			found: "findet seine Präsentationen",
			granted: "die Präsentationen in diesem Ordner",
			inviteTitle: "Diesen Ordner und seine Präsentationen mit diesem Konto teilen",
			unshared:
				"Dieser Ordner ist mit niemandem geteilt. Seine Präsentationen erreichen nur du und alle, mit denen die jeweilige Präsentation geteilt ist.",
			kept: "Seine Präsentationen zu löschen und zu entscheiden, mit wem der Ordner geteilt ist, bleibt bei dir, egal welche Stufe du vergibst.",
		},
	},

	intro: "Gib einem anderen {brand}-Konto Zugriff auf {title}.",
	introHow:
		" Die Person meldet sich mit ihrem eigenen Konto an und {found} unter „Mit dir geteilt“ — es gibt keinen Link weiterzugeben und nichts, was sie weiterleiten müsste. Die gewählte Stufe prüft der Server bei jeder Änderung, die sie versucht, nicht nur bei dem, was ihr angezeigt wird.",
	emailPlaceholder: "name@beispiel.de",
	emailName: "E-Mail-Adresse, mit der geteilt wird",
	levelName: "Was diese Person tun darf",
	inviteEmailFirst: "{invite} — gib zuerst die E-Mail-Adresse des Kontos ein",
	invite: "Einladen",
	checking: "Wird geprüft…",
	changeLevel: "Ändern, was diese Person tun darf",
	revoke:
		"Den Zugriff dieser Person entfernen — er endet bei ihrer nächsten Anfrage",
	removalNote:
		"Das Entfernen wirkt sofort — es gibt nichts, das erst ablaufen müsste. Nicht erreicht wird eine Seite, die die Person schon offen hat: Sie zeigt, was sie zuletzt bekommen hat, bis sie den Server das nächste Mal fragt. {kept}",

	shared: "{name} hat jetzt Zugriff auf {granted} ({level})",
	levelChanged: "{name} — {level}",
	revoked: "{name} hat keinen Zugriff mehr",
	shareFailed: "Das Teilen für {granted} hat nicht geklappt",
	levelFailed: "Diese Zugriffsstufe konnte nicht geändert werden",
	revokeFailed: "Diese Person konnte nicht entfernt werden",

	revokeThroughFolder:
		"Den Zugriff dieser Person über diesen Ordner entfernen — er endet bei ihrer nächsten Anfrage",
	revokeKeepsFolder:
		"Diese Freigabe entfernen — über den Ordner „{folder}“ bleibt „{level}“",
	revokedThroughFolder: "{name} hat über diesen Ordner keinen Zugriff mehr",
	revokedKeepsFolder:
		"{name} hat keine eigene Freigabe für diese Präsentation mehr, behält aber „{level}“ über den Ordner „{folder}“",
	noOwnGrants: "Kein Konto hat eine eigene Freigabe für diese Präsentation.",
	folderManagedThere:
		"Ändere oder entferne das im Teilen-Dialog des Ordners „{folder}“",
	folderStandingNote:
		"Diese Konten erreichen diese Präsentation über den geteilten Ordner {folder}. Eine Freigabe oben zu entfernen lässt diesen Zugriff bestehen. Ein Konto, das an beiden Stellen steht, hat die stärkere seiner beiden Stufen. Ändere oder entferne diesen Zugriff im Teilen-Dialog dieses Ordners.",
};
