import { Monitor, Moon, Sun } from "lucide-react";
import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { THEME_KEY } from "../../storage";

// ── Theme system ──────────────────────────────────────────────

export type ThemePreference = "light" | "dark" | "auto";

const ThemeContext = createContext<{
	theme: ThemePreference;
	resolvedTheme: "light" | "dark";
	setTheme: (t: ThemePreference) => void;
}>({ theme: "auto", resolvedTheme: "dark", setTheme: () => {} });

export function useTheme() {
	return useContext(ThemeContext);
}

function getSystemTheme(): "light" | "dark" {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme(preference: ThemePreference) {
	document.documentElement.className = preference;
	const colorScheme = preference === "auto" ? "light dark" : preference;
	document
		.querySelector('meta[name="color-scheme"]')
		?.setAttribute("content", colorScheme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setThemeState] = useState<ThemePreference>(() => {
		return (localStorage.getItem(THEME_KEY) as ThemePreference) || "auto";
	});
	const [systemTheme, setSystemTheme] = useState<"light" | "dark">(
		getSystemTheme,
	);

	// Listen for OS theme changes
	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = (e: MediaQueryListEvent) =>
			setSystemTheme(e.matches ? "dark" : "light");
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, []);

	const resolvedTheme = theme === "auto" ? systemTheme : theme;

	const setTheme = useCallback((t: ThemePreference) => {
		setThemeState(t);
		localStorage.setItem(THEME_KEY, t);
		applyTheme(t);
	}, []);

	return (
		<ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

// ── Theme toggle component ────────────────────────────────────

export function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const options: {
		value: ThemePreference;
		icon: React.ReactNode;
		label: string;
	}[] = [
		{ value: "light", icon: <Sun size={14} />, label: "Light" },
		{ value: "dark", icon: <Moon size={14} />, label: "Dark" },
		{ value: "auto", icon: <Monitor size={14} />, label: "Auto" },
	];

	return (
		<div className="flex items-center bg-surface-raised border border-border rounded-lg p-0.5 gap-0.5">
			{options.map((opt) => (
				<button
					key={opt.value}
					type="button"
					onClick={() => setTheme(opt.value)}
					title={opt.label}
					className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer border-none ${
						theme === opt.value
							? "bg-surface-hover text-accent-text shadow-sm"
							: "text-text-dim hover:text-text-muted bg-transparent"
					}`}
				>
					{opt.icon}
					<span className="hidden sm:inline">{opt.label}</span>
				</button>
			))}
		</div>
	);
}
