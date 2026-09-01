import type React from "react";
import { createContext, useCallback, useContext, useState } from "react";

// ── Toast system ──────────────────────────────────────────────

interface Toast {
	id: string;
	message: string;
	type: "success" | "error" | "info";
}

const ToastContext = createContext<{
	addToast: (message: string, type?: Toast["type"]) => void;
}>({ addToast: () => {} });

export function useToast() {
	return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);

	const addToast = useCallback(
		(message: string, type: Toast["type"] = "info") => {
			const id = crypto.randomUUID();
			setToasts((prev) => [...prev, { id, message, type }]);
			setTimeout(
				() => setToasts((prev) => prev.filter((t) => t.id !== id)),
				3000,
			);
		},
		[],
	);

	return (
		<ToastContext.Provider value={{ addToast }}>
			{children}
			<div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
				{toasts.map((toast) => (
					<div
						key={toast.id}
						className={`slide-in px-4 py-3 rounded-xl border text-sm font-medium shadow-lg backdrop-blur-sm max-w-xs ${
							toast.type === "success"
								? "bg-success-dim border-success/30 text-success"
								: toast.type === "error"
									? "bg-error/10 border-error/30 text-error"
									: "bg-surface-raised border-border text-text"
						}`}
					>
						{toast.message}
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
}
