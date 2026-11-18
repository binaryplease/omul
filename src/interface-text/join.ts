// The join entry (src/pages/JoinPage.tsx, `/join`): typing or scanning a six-digit code, and every message on the way — REQ248 slice 10.
// The screen has no deck yet, so no deck language: it follows the interface
// language, and the participant screen the code opens speaks the deck's.
// A code no deck uses is worded here; the server's other refusals (the rate
// limit) are its own messages and stay English (REQ248, out of scope).

export const en = {
	pageTitle: "Join",
	heading: "Join Presentation",
	enterCode: "Enter the 6-digit code shown on screen",
	pointCamera: "Point your camera at the QR code",
	codeInput: "Join code",
	join: "Join",
	joining: "Joining...",
	or: "or",
	scanQr: "Scan QR Code",
	cancelScan: "Cancel scan",
	backHome: "Back to home",

	codeIncomplete: "Enter a 6-digit code",
	codeNotFound: "No presentation uses this code. Check the code on the screen and try again.",
	scanUnsupported:
		"QR scanning is not supported in this browser. Try Chrome or Safari on mobile.",
	cameraDenied:
		"Camera access was denied. Please allow camera access to scan QR codes.",
	cameraFailed: "Could not access camera. Please enter the code manually.",
};

export const de: Partial<typeof en> = {
	pageTitle: "Beitreten",
	heading: "Präsentation beitreten",
	enterCode: "Gib den sechsstelligen Code ein, der auf dem Bildschirm steht",
	pointCamera: "Richte deine Kamera auf den QR-Code",
	codeInput: "Code zum Mitmachen",
	join: "Beitreten",
	joining: "Wird beigetreten…",
	or: "oder",
	scanQr: "QR-Code scannen",
	cancelScan: "Scannen abbrechen",
	backHome: "Zurück zur Startseite",

	codeIncomplete: "Gib einen sechsstelligen Code ein",
	codeNotFound:
		"Keine Präsentation hat diesen Code. Prüfe den Code auf dem Bildschirm und versuche es noch einmal.",
	scanUnsupported:
		"Dieser Browser kann keine QR-Codes scannen. Versuche es mit Chrome oder Safari auf dem Handy.",
	cameraDenied:
		"Der Kamerazugriff wurde verweigert. Erlaube den Zugriff auf die Kamera, um QR-Codes zu scannen.",
	cameraFailed:
		"Auf die Kamera konnte nicht zugegriffen werden. Gib den Code bitte von Hand ein.",
};
