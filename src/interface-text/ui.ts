// The shared primitives in src/components/ui/ that carry words of their own (Modal.tsx) — REQ248 slice 2, where the presenter screen's export and share-results dialogs wear them; every other surface that mounts one reads the same keys.

export const en = {
	/** The close control in a dialog's header row. */
	close: "Close",
};

export const de: Partial<typeof en> = {
	close: "Schließen",
};
