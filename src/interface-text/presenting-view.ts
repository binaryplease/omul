// The presenting view on the presenter screen (PresentingView.tsx, REQ247) — REQ248 slice 2.
// Its join line is the room's, and reads the deck's `Dict` (`roomJoinAt`).

export const en = {
	startCard:
		"Drag this window to the projector, then press F or choose Full screen",
	fullScreen: "Full screen",
	fullScreenUnavailable: "Full screen — this browser does not offer it here",
	dismiss: "Dismiss",
	controls: "Presenting controls",
	showQrCode: "Show QR code",
	leave: "Leave presenting view (Esc)",
	/** Leave's visible label from `sm`. */
	exit: "Exit",
};

export const de: Partial<typeof en> = {
	startCard:
		"Zieh dieses Fenster auf den Projektor und drück dann F oder wähle Vollbild",
	fullScreen: "Vollbild",
	fullScreenUnavailable: "Vollbild — dieser Browser bietet das hier nicht an",
	dismiss: "Schließen",
	controls: "Steuerung der Präsentation",
	showQrCode: "QR-Code zeigen",
	leave: "Präsentationsansicht verlassen (Esc)",
	exit: "Verlassen",
};
