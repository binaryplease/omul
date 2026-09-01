// ── App store: the single sliced Zustand store ────────────────────────
//
// One store instance, composed from domain slices (`session` / `editor` /
// `ui`). It is created through a **factory** rather than as a module
// singleton: each call to `createAppStore()` yields a fresh, isolated store.
// Production mounts exactly one (via `StoreProvider`); every test gets its own,
// so module-level state never bleeds between tests.

import { createStore } from "zustand/vanilla";
import { createEditorSlice, type EditorSlice } from "./editor";
import { createSessionSlice, type SessionSlice } from "./session";
import { createUiSlice, type UiSlice } from "./ui";

export interface AppState extends SessionSlice, EditorSlice, UiSlice {}

export type AppStore = ReturnType<typeof createAppStore>;

/**
 * Create a fresh store instance. Pass `initialState` to seed it for tests or
 * previews ("seed a state → render → assert"), overriding slice defaults.
 */
export function createAppStore(initialState?: Partial<AppState>) {
	return createStore<AppState>()((set, get) => ({
		...createSessionSlice(set, get),
		...createEditorSlice(set, get),
		...createUiSlice(set, get),
		...initialState,
	}));
}
