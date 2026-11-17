// The presenter bar's share controls (ShareCluster.tsx) and the bar's small parts it composes — REQ248 slice 2.

export const en = {
	// The actions (`buildShareControls`): each one's name, short label and
	// copied confirmation.
	copyJoinLink: "Copy join link",
	showQrCode: "Show QR code",
	copyEmbedCode: "Copy embed code (iframe snippet)",
	copyEditLink: "Copy share link with edit permissions",
	linkShort: "Link",
	qrShort: "QR",
	embedShort: "Embed",
	editLinkShort: "Edit Link",
	copied: "Copied!",
	copyJoinCode: "Copy join code",

	// The join chip from `sm`: "Join:" below `2xl`, "Join at <host>" from it.
	joinChip: "Join:",
	joinChipAt: "Join at",

	// The Share menu from `sm` (`shareMenuLabel`).
	share: "Share",
	shareMenuLabel: "Share — copy the join link or the embed code",
	shareMenuLabelWithEditLink:
		"Share — copy the join link, the embed code or the edit link",
	/** `{code}` is the join code. */
	shareMenuHeading: "Share · join {code}",

	// The Join menu below `sm` (`joinMenuLabel`). Its name leads with the
	// code on its face, so a voice user can say what they see.
	joinMenuLabel:
		"Join {code} — show the QR code, copy the code, the join link or the embed code",
	joinMenuLabelWithEditLink:
		"Join {code} — show the QR code, copy the code, the join link, the embed code or the edit link",
	joinMenuTitle: "Join {code}",
	joinMenuHeading: "Join · {code}",
};

export const de: Partial<typeof en> = {
	copyJoinLink: "Link zum Mitmachen kopieren",
	showQrCode: "QR-Code zeigen",
	copyEmbedCode: "Einbettungscode kopieren (iframe-Snippet)",
	copyEditLink: "Link mit Bearbeitungsrechten kopieren",
	linkShort: "Link",
	qrShort: "QR",
	embedShort: "Einbetten",
	editLinkShort: "Bearbeitungslink",
	copied: "Kopiert!",
	copyJoinCode: "Code zum Mitmachen kopieren",

	joinChip: "Code:",
	joinChipAt: "Mitmachen unter",

	share: "Teilen",
	shareMenuLabel: "Teilen — Link zum Mitmachen oder Einbettungscode kopieren",
	shareMenuLabelWithEditLink:
		"Teilen — Link zum Mitmachen, Einbettungscode oder Bearbeitungslink kopieren",
	shareMenuHeading: "Teilen · Code {code}",

	joinMenuLabel:
		"Mitmachen {code} — QR-Code zeigen, Code, Link zum Mitmachen oder Einbettungscode kopieren",
	joinMenuLabelWithEditLink:
		"Mitmachen {code} — QR-Code zeigen, Code, Link zum Mitmachen, Einbettungscode oder Bearbeitungslink kopieren",
	joinMenuTitle: "Mitmachen {code}",
	joinMenuHeading: "Mitmachen · {code}",
};
