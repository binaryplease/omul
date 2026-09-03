// ── UI slice: reserved seam for genuinely-global UI state ──────────────
//
// The triage decision split the frontend state into three domains —
// `session`, `editor`, and `ui` — but with the explicit caveat that
// *ephemeral, single-component* UI state (copied-flags, the QR toggle, modal
// open/close, input values) stays in local `useState` and is NOT lifted here.
//
// That leaves this slice intentionally empty today: the only currently-global
// UI concerns — theme and toasts — already have dedicated providers
// (`ThemeProvider`, `ToastProvider`) that own them, and an affordance has
// exactly one owner. This slice exists as the named seam where
// *cross-surface* UI state would live if any emerged (e.g. a global command
// palette or a shared navigation drawer), keeping the three-domain shape the
// triage answer asked for without forcing local state to go global.

import type { StoreApi } from "zustand";
import type { AppState } from "./store";

type AppSet = StoreApi<AppState>["setState"];
type AppGet = StoreApi<AppState>["getState"];

// `Record<never, never>` is an empty object type with NO string index
// signature — important, because an index signature here would propagate into
// the combined `AppState` and collapse every other slice's field types.
export type UiSlice = Record<never, never>;

export function createUiSlice(_set: AppSet, _get: AppGet): UiSlice {
	return {};
}
