// ── Store provider + selector hook ────────────────────────────────────
//
// Bridges the vanilla (factory-created) store into React. `StoreProvider`
// holds one store instance for the subtree; `useStore` subscribes a component
// to a slice of it via a selector. Tests render a subtree with their own
// seeded store passed to `<StoreProvider store={...}>`, giving full isolation.

import { createContext, type ReactNode, useContext, useRef } from "react";
import { useStore as useZustandStore } from "zustand";
import { type AppState, type AppStore, createAppStore } from "./store";

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({
	store,
	children,
}: {
	/** Optional pre-seeded store (tests/previews); defaults to a fresh one. */
	store?: AppStore;
	children: ReactNode;
}) {
	const storeRef = useRef<AppStore | null>(null);
	if (storeRef.current === null) {
		storeRef.current = store ?? createAppStore();
	}
	return (
		<StoreContext.Provider value={storeRef.current}>
			{children}
		</StoreContext.Provider>
	);
}

/** Subscribe to a slice of the store. Throws if used outside the provider. */
export function useStore<T>(selector: (state: AppState) => T): T {
	const store = useContext(StoreContext);
	if (!store) {
		throw new Error("useStore must be used within a StoreProvider");
	}
	return useZustandStore(store, selector);
}

/** Access the raw store API (for imperative reads/subscriptions). */
export function useStoreApi(): AppStore {
	const store = useContext(StoreContext);
	if (!store) {
		throw new Error("useStoreApi must be used within a StoreProvider");
	}
	return store;
}
