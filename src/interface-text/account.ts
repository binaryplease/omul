// The account surfaces (src/auth.tsx): the header's account controls, the sign-in dialog with sign-up and the forgotten password, the verify-email banner, account settings (changing the email, deleting the account), API keys, and the landings of the reset, verification and email-change links — REQ248 slice 11.
// What the auth server answers when it refuses (a wrong password, an address
// already taken) is its own message and stays as it words it (REQ248, out of
// scope); the fallbacks here are drawn only when it gives none.
// `{email}` marks where a sentence draws an address as an element of its own,
// `{brand}` where it names the product.

export const en = {
	// The header.
	signIn: "Sign in",
	accountSettings: "Account settings",
	apiKeys: "API keys",
	signOut: "Sign out",

	// The sign-in dialog.
	signInTitle: "Sign in to {brand}",
	createAccount: "Create account",
	// Why "Create account" is disabled while the operator has closed sign-up (REQ251).
	signUpClosed:
		"Sign-ups are closed on this instance. Ask its operator for an account.",
	forgotIntro:
		"Enter your account email and we'll send a link to choose a new password.",
	namePlaceholder: "Name (optional)",
	emailPlaceholder: "you@example.com",
	passwordPlaceholder: "Password (min 8 characters)",
	working: "Working…",
	sendResetLink: "Send reset link",
	forgotPassword: "Forgot password?",
	backToSignIn: "Back to sign in",
	resetSent:
		"If an account exists for {email}, a password reset link is on its way. Check your inbox.",
	authFailed: "Authentication failed",
	resetEmailFailed: "Could not send reset email",

	// The verification landing and the banner.
	verificationTitle: "Email verification",
	verified: "Your email is verified. Thanks — your {brand} account is all set.",
	continue: "Continue",
	close: "Close",
	verificationResent:
		"A fresh verification link is on its way to {email}. Check your inbox.",
	verificationInvalid:
		"This verification link is invalid or has expired. Request a new one below.",
	resendVerification: "Resend verification email",
	verificationFailed: "Could not send verification email",
	bannerSent: "Verification link sent to {email}. Check your inbox to confirm your address.",
	bannerAsk:
		"Verify your email ({email}) to confirm your account. You can keep using {brand} in the meantime.",
	bannerResend: "Resend email",
	bannerResendTitle: "Resend the verification email",
	bannerSending: "Sending…",
	bannerSentButton: "Sent",
	bannerSentTitle: "Verification email sent",

	// Account settings.
	signInToManage: "Sign in to manage your account.",
	signedInAs: "Signed in as {email}",
	changeEmailIntro:
		"Enter a new address — we'll email a link to confirm the change before it takes effect.",
	newEmailPlaceholder: "new@example.com",
	changeEmail: "Change email",
	changeEmailFailed: "Could not start the email change",
	/** `{email}` is the current address, `{newEmail}` the one asked for. */
	changeApprove:
		"Check {email} for a link to approve the change. Once you do, we'll email {newEmail} to verify it — your account email switches after that.",
	changeVerifyNew:
		"We've emailed {newEmail}. Open the link there to verify the address and finish the switch.",
	done: "Done",

	dangerZone: "Danger zone",
	deleteIntro: "Permanently delete the account for {email}. This cannot be undone.",
	deleteAccountOpen: "Delete account…",
	yourPassword: "Your password",
	passwordField: "Password",
	/**
	 * `{phrase}` is the fixed English phrase "delete my account", drawn as an
	 * element of its own; it is what deletion checks, so it is not translated.
	 */
	typeToConfirm: "Type {phrase} to confirm",
	deletePermanently: "Delete my account permanently",
	deleting: "Deleting…",
	deleteTitlePhrase: "Type “{phrase}” to confirm",
	deleteTitlePassword: "Enter your password to confirm",
	deleteTitleReady: "Permanently delete your account",
	deleteWhyPhrase:
		"Enter your password and type “{phrase}” above to enable deletion.",
	deleteWhyPassword: "Enter your password above to enable deletion.",
	deleteFailed: "Could not delete your account",
	deleted: "Your account has been permanently deleted. Thanks for using {brand}.",

	// The email-change landing.
	emailChangeTitle: "Email change",
	changeLinkInvalid:
		"This email-change link is invalid or has expired. Start again from Account settings.",
	changeDone: "Your account email is now {email}. All set.",
	changeApproved:
		"Change approved. We've emailed {email} — open the link there to verify the new address and finish the switch.",
	changeProcessed:
		"Your email-change request was processed. If you were asked to verify a new address, open the link we sent there to finish.",

	// The password-reset landing.
	resetTitle: "Reset your password",
	resetLinkInvalid:
		"This reset link is invalid or has expired. Request a new one from the sign-in dialog.",
	resetDone: "Your password has been reset. You're now signed in.",
	resetIntro: "Choose a new password for your account.",
	newPasswordPlaceholder: "New password (min 8 characters)",
	setNewPassword: "Set new password",
	resetFailed: "Could not reset password",

	// API keys.
	apiKeysIntro:
		"Send a key as the {header} header to authenticate API requests as your account without a cookie session. The secret is shown once at creation.",
	keyNamePlaceholder: "Key name (e.g. laptop)",
	createKey: "Create",
	creatingKey: "Creating…",
	loadingKeys: "Loading keys…",
	noKeys: "No keys yet.",
	unnamedKey: "Unnamed key",
	revokeKey: "Revoke key",
	/** `{name}` is the key's name. */
	revokeNamedKey: "Revoke {name}",
	keysLoadFailed: "Failed to load keys",
	keyCreateFailed: "Failed to create key",
	keyRevokeFailed: "Failed to revoke key",
	copyKeyNow: "Copy your key now — it won't be shown again",
	copy: "Copy",
	copied: "Copied",
};

export const de: Partial<typeof en> = {
	signIn: "Anmelden",
	accountSettings: "Kontoeinstellungen",
	apiKeys: "API-Schlüssel",
	signOut: "Abmelden",

	signInTitle: "Bei {brand} anmelden",
	createAccount: "Konto anlegen",
	signUpClosed:
		"Auf dieser Instanz können keine Konten angelegt werden. Frag ihren Betreiber nach einem Konto.",
	forgotIntro:
		"Gib die E-Mail-Adresse deines Kontos ein, und wir schicken dir einen Link, mit dem du ein neues Passwort wählen kannst.",
	namePlaceholder: "Name (optional)",
	emailPlaceholder: "du@beispiel.de",
	passwordPlaceholder: "Passwort (mind. 8 Zeichen)",
	working: "Einen Moment…",
	sendResetLink: "Link zum Zurücksetzen senden",
	forgotPassword: "Passwort vergessen?",
	backToSignIn: "Zurück zur Anmeldung",
	resetSent:
		"Falls es für {email} ein Konto gibt, ist ein Link zum Zurücksetzen des Passworts unterwegs. Sieh in dein Postfach.",
	authFailed: "Anmeldung fehlgeschlagen",
	resetEmailFailed: "Die E-Mail zum Zurücksetzen konnte nicht gesendet werden",

	verificationTitle: "E-Mail-Bestätigung",
	verified: "Deine E-Mail-Adresse ist bestätigt. Danke — dein {brand}-Konto ist startklar.",
	continue: "Weiter",
	close: "Schließen",
	verificationResent:
		"Ein neuer Bestätigungslink ist an {email} unterwegs. Sieh in dein Postfach.",
	verificationInvalid:
		"Dieser Bestätigungslink ist ungültig oder abgelaufen. Fordere unten einen neuen an.",
	resendVerification: "Bestätigungs-E-Mail erneut senden",
	verificationFailed: "Die Bestätigungs-E-Mail konnte nicht gesendet werden",
	bannerSent:
		"Bestätigungslink an {email} gesendet. Sieh in dein Postfach, um deine Adresse zu bestätigen.",
	bannerAsk:
		"Bestätige deine E-Mail-Adresse ({email}), um die Einrichtung deines Kontos abzuschließen. Du kannst {brand} in der Zwischenzeit weiter nutzen.",
	bannerResend: "E-Mail erneut senden",
	bannerResendTitle: "Die Bestätigungs-E-Mail erneut senden",
	bannerSending: "Wird gesendet…",
	bannerSentButton: "Gesendet",
	bannerSentTitle: "Bestätigungs-E-Mail gesendet",

	signInToManage: "Melde dich an, um dein Konto zu verwalten.",
	signedInAs: "Angemeldet als {email}",
	changeEmailIntro:
		"Gib eine neue Adresse ein — wir schicken dir einen Link, mit dem du die Änderung bestätigst, bevor sie wirksam wird.",
	newEmailPlaceholder: "neu@beispiel.de",
	changeEmail: "E-Mail ändern",
	changeEmailFailed: "Die Änderung der E-Mail-Adresse konnte nicht gestartet werden",
	changeApprove:
		"Sieh bei {email} nach einem Link, mit dem du die Änderung freigibst. Danach schicken wir {newEmail} eine E-Mail zur Bestätigung — erst dann wechselt die E-Mail-Adresse deines Kontos.",
	changeVerifyNew:
		"Wir haben {newEmail} eine E-Mail geschickt. Öffne den Link darin, um die Adresse zu bestätigen und den Wechsel abzuschließen.",
	done: "Fertig",

	dangerZone: "Gefahrenbereich",
	deleteIntro:
		"Das Konto für {email} endgültig löschen. Das lässt sich nicht rückgängig machen.",
	deleteAccountOpen: "Konto löschen…",
	yourPassword: "Dein Passwort",
	passwordField: "Passwort",
	typeToConfirm: "Gib {phrase} ein, um zu bestätigen",
	deletePermanently: "Mein Konto endgültig löschen",
	deleting: "Wird gelöscht…",
	deleteTitlePhrase: "Gib „{phrase}“ ein, um zu bestätigen",
	deleteTitlePassword: "Gib dein Passwort ein, um zu bestätigen",
	deleteTitleReady: "Dein Konto endgültig löschen",
	deleteWhyPhrase:
		"Gib oben dein Passwort und „{phrase}“ ein, um das Löschen freizuschalten.",
	deleteWhyPassword: "Gib oben dein Passwort ein, um das Löschen freizuschalten.",
	deleteFailed: "Dein Konto konnte nicht gelöscht werden",
	deleted: "Dein Konto wurde endgültig gelöscht. Danke, dass du {brand} genutzt hast.",

	emailChangeTitle: "E-Mail-Änderung",
	changeLinkInvalid:
		"Dieser Link zur E-Mail-Änderung ist ungültig oder abgelaufen. Starte noch einmal über die Kontoeinstellungen.",
	changeDone: "Die E-Mail-Adresse deines Kontos ist jetzt {email}. Alles erledigt.",
	changeApproved:
		"Änderung freigegeben. Wir haben {email} eine E-Mail geschickt — öffne den Link darin, um die neue Adresse zu bestätigen und den Wechsel abzuschließen.",
	changeProcessed:
		"Deine Anfrage zur E-Mail-Änderung wurde bearbeitet. Falls du eine neue Adresse bestätigen sollst, öffne den Link, den wir dorthin geschickt haben.",

	resetTitle: "Passwort zurücksetzen",
	resetLinkInvalid:
		"Dieser Link zum Zurücksetzen ist ungültig oder abgelaufen. Fordere im Anmeldedialog einen neuen an.",
	resetDone: "Dein Passwort wurde zurückgesetzt. Du bist jetzt angemeldet.",
	resetIntro: "Wähle ein neues Passwort für dein Konto.",
	newPasswordPlaceholder: "Neues Passwort (mind. 8 Zeichen)",
	setNewPassword: "Neues Passwort festlegen",
	resetFailed: "Das Passwort konnte nicht zurückgesetzt werden",

	apiKeysIntro:
		"Sende einen Schlüssel im Header {header}, um API-Anfragen ohne Cookie-Sitzung als dein Konto zu authentifizieren. Das Geheimnis wird nur einmal beim Erstellen angezeigt.",
	// Short enough for the field beside "Erstellen" (REQ248); the dialog's own
	// title already says whose name it is.
	keyNamePlaceholder: "Name (z. B. Laptop)",
	createKey: "Erstellen",
	creatingKey: "Wird erstellt…",
	loadingKeys: "Schlüssel werden geladen…",
	noKeys: "Noch keine Schlüssel.",
	unnamedKey: "Unbenannter Schlüssel",
	revokeKey: "Schlüssel widerrufen",
	revokeNamedKey: "{name} widerrufen",
	keysLoadFailed: "Die Schlüssel konnten nicht geladen werden",
	keyCreateFailed: "Der Schlüssel konnte nicht erstellt werden",
	keyRevokeFailed: "Der Schlüssel konnte nicht widerrufen werden",
	copyKeyNow: "Kopiere deinen Schlüssel jetzt — er wird nicht noch einmal angezeigt",
	copy: "Kopieren",
	copied: "Kopiert",
};
