import type { LucideIcon } from "lucide-react";
import { Download, FileChartColumn, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { api, type DownloadedExport } from "../api";
import { saveBlobAs } from "../download";
import { ICON_BUTTON_HOVER } from "./ShareCluster";
import { Modal } from "./ui/Modal";
import { useToast } from "./ui/Toast";

// ── Taking the session out of the building (REQ095, REQ096) ───────────
//
// A deck leaves in more than one shape now — a workbook to analyse, a document
// to read or hand round — and "which shape?" is one question with several
// answers rather than several unrelated buttons. So the formats are a single
// descriptor and this dialog is the single surface that composes it:
// a format added later (REQ097's slide images, say) is a row in the
// list below and nothing else.
//
// It sits behind a control on the presenter's own results surface —
// what an export takes out is the session, so it belongs beside it rather than
// in global chrome — and every row is always drawn, disabled with its reason
// where it cannot be used.

/** Which shape a deck leaves in. */
export type DeckExportFormatId = "xlsx" | "pdf-results" | "pdf-deck";

export type DeckExportFormat = {
	id: DeckExportFormatId;
	/** What the row is called. */
	label: string;
	/** What that file actually is, in one line — the row is the whole choice. */
	summary: string;
	icon: LucideIcon;
	/** How the browser fetches it. Every one of these is authorized as an edit. */
	download: (presentationId: string) => Promise<DownloadedExport>;
};

/**
 * The formats, in the order they are offered: the analysable one first, because
 * it is the one that keeps *everything* and is what a reset (REQ101) is
 * survived by, then the two readings of the rendered one.
 */
export const DECK_EXPORT_FORMATS: DeckExportFormat[] = [
	{
		id: "xlsx",
		label: "Spreadsheet (.xlsx)",
		summary:
			"Every response, the per-participant matrix and every tally in long form — the file to analyse the session in.",
		icon: FileSpreadsheet,
		download: (presentationId) => api.downloadResults(presentationId),
	},
	{
		id: "pdf-results",
		label: "PDF with results",
		summary:
			"The deck rendered slide by slide with the tallies underneath — the file to read or hand round.",
		icon: FileChartColumn,
		download: (presentationId) =>
			api.downloadDeckPdf(presentationId, { includeResults: true }),
	},
	{
		id: "pdf-deck",
		label: "PDF of the deck",
		summary:
			"The same document without what the room submitted — the questions, the options and the answer key.",
		icon: FileText,
		download: (presentationId) =>
			api.downloadDeckPdf(presentationId, { includeResults: false }),
	},
];

/**
 * The accessible name of the control that opens this dialog.
 *
 * Spelled here beside the formats rather than in the page, for the reason the
 * Q&A and reset chips spell theirs: the control carries an icon and no text, so
 * this string is the whole of what a screen reader announces — and it has to
 * say both what leaves the building and, for somebody who does not hold the
 * deck, why it cannot.
 */
export function exportButtonLabel(canExport: boolean): string {
	return canExport
		? "Export this session — download it as a spreadsheet or as a PDF"
		: "Export this session — you cannot edit this presentation, so its responses are not yours to download";
}

export function ExportDialog({
	presentationId,
	onClose,
}: {
	presentationId: string;
	onClose: () => void;
}) {
	const { addToast } = useToast();
	/** Which format is in flight, or `null` — one at a time, per format. */
	const [downloading, setDownloading] = useState<DeckExportFormatId | null>(null);

	const run = async (format: DeckExportFormat): Promise<void> => {
		setDownloading(format.id);
		try {
			const file = await format.download(presentationId);
			saveBlobAs(file.blob, file.filename);
			addToast(`${format.label} exported`, "success");
			onClose();
		} catch (exportError: unknown) {
			addToast(
				exportError instanceof Error
					? exportError.message
					: `Failed to export the ${format.label}`,
				"error",
			);
		} finally {
			setDownloading(null);
		}
	};

	return (
		<Modal title="Export this session" icon={Download} onClose={onClose}>
			<div className="flex flex-col gap-2">
				{DECK_EXPORT_FORMATS.map((format) => {
					const busy = downloading === format.id;
					const label = busy ? `Exporting the ${format.label}…` : format.label;
					return (
						<button
							key={format.id}
							type="button"
							onClick={() => run(format)}
							disabled={downloading !== null}
							aria-label={label}
							title={label}
							className={`flex items-start gap-3 rounded-xl border border-border bg-surface-raised p-3 text-left hover:border-accent/50 ${ICON_BUTTON_HOVER} disabled:opacity-50 disabled:cursor-not-allowed`}
						>
							{/* The icon carries the row's interaction state, composed from the
							    shared token rather than re-declared — which is
							    also why it is not given a colour of its own here. */}
							<span className="mt-0.5 shrink-0">
								<format.icon size={18} />
							</span>
							<span className="flex-1">
								<span className="block text-sm font-semibold text-text">{label}</span>
								<span className="block text-xs text-text-muted">{format.summary}</span>
							</span>
						</button>
					);
				})}
			</div>
			<p className="mt-4 text-xs text-text-dim">
				Each file is a snapshot of the session as it stands right now. Export
				before you reset the deck — clearing the results cannot be undone.
			</p>
		</Modal>
	);
}
