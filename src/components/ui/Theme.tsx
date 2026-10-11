import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
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

// ── Theme options ─────────────────────────────────────────────

/**
 * The three appearances a visitor can choose, in the order they are offered.
 * The one list of them: `AppMenu` renders it, and nothing restates it.
 */
export const THEME_OPTIONS = [
	{ value: "light", label: "Light", Icon: Sun },
	{ value: "dark", label: "Dark", Icon: Moon },
	{ value: "auto", label: "Auto", Icon: Monitor },
] as const satisfies readonly {
	value: ThemePreference;
	label: string;
	Icon: LucideIcon;
}[];
