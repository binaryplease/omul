// ── Store public surface ──────────────────────────────────────────────
//
// Pages import from `../store` only. The slice modules and the vanilla store
// factory are implementation details surfaced here in one place.

export type { EditorSlice } from "./editor";
export {
	applyEditorOperation,
	type EditorDocument,
	type EditorOperation,
} from "./editorDocument";
export { StoreProvider, useStore, useStoreApi } from "./StoreProvider";
export type { SessionSlice, SlideResults } from "./session";
export { type AppState, type AppStore, createAppStore } from "./store";
export type { UiSlice } from "./ui";
export { useSessionSocket } from "./useSessionSocket";
