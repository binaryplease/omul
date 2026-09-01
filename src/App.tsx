import { useCallback, useEffect, useState } from "react";
import {
	acceptResultsLinkToken,
	acceptShareToken,
	RESULTS_LINK_FRAGMENT,
} from "./api";
import { ThemeProvider } from "./components/ui/Theme";
import { ToastProvider } from "./components/ui/Toast";
import { CreatePage } from "./pages/CreatePage";
import { GeneratePage } from "./pages/GeneratePage";
import { HomePage } from "./pages/HomePage";
import { JoinPage } from "./pages/JoinPage";
import { ParticipantPage } from "./pages/ParticipantPage";
import { PresenterPage } from "./pages/PresenterPage";
import { PreviewPage } from "./pages/PreviewPage";
import { SharedResultsPage } from "./pages/SharedResultsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { WorkspacesPage } from "./pages/WorkspacesPage";
import { getInitialRoute, navigate, type Route } from "./router";
import { StoreProvider } from "./store";

/**
 * If the current URL is `/edit/:id#share=<token>`, persist the token as the
 * recipient's creator token and strip the fragment so it doesn't linger in
 * the address bar (and doesn't get re-applied on reload). Runs once at
 * module load, before the first render, so the token is in place before
 * CreatePage mounts.
 */
function consumeShareTokenFromUrl(): void {
	const path = window.location.pathname;
	const hash = window.location.hash;
	if (!path.startsWith("/edit/") || !hash.startsWith("#")) return;
	const params = new URLSearchParams(hash.slice(1));
	const token = params.get("share");
	if (!token) return;
	const id = path.slice("/edit/".length);
	if (!id) return;
	acceptShareToken(id, token);
	window.history.replaceState(null, "", path);
}

/**
 * If the current URL is `/results/:id#link=<token>`, persist the token as this
 * browser's results-link credential and strip the fragment so the secret does
 * not linger in the address bar — where the next person to look over the
 * recipient's shoulder, or the next screenshot they take of the numbers, would
 * carry it further than the organizer sent it (REQ098).
 *
 * Runs beside the edit-link consumer above and for the same reason: once, at
 * module load, before the first render, so the credential is in place before the
 * page that reads through it mounts. The two are deliberately separate — they
 * store different capabilities under different keys, and a shared parser would
 * be one edit away from putting a read-only token where a mutation looks for
 * one.
 */
function consumeResultsLinkFromUrl(): void {
	const path = window.location.pathname;
	const hash = window.location.hash;
	if (!path.startsWith("/results/") || !hash.startsWith("#")) return;
	const params = new URLSearchParams(hash.slice(1));
	const token = params.get(RESULTS_LINK_FRAGMENT);
	if (!token) return;
	const id = path.slice("/results/".length);
	if (!id) return;
	acceptResultsLinkToken(id, token);
	window.history.replaceState(null, "", path);
}

consumeShareTokenFromUrl();
consumeResultsLinkFromUrl();

export default function App() {
	const [route, setRoute] = useState<Route>(getInitialRoute);

	useEffect(() => {
		const handler = () => setRoute(getInitialRoute());
		window.addEventListener("popstate", handler);
		return () => window.removeEventListener("popstate", handler);
	}, []);

	const go = useCallback((r: Route) => {
		navigate(r);
		setRoute(r);
	}, []);

	const content = (() => {
		switch (route.page) {
			case "home":
				return <HomePage go={go} />;
			case "create":
				return <CreatePage go={go} />;
			case "templates":
				return <TemplatesPage go={go} />;
			case "generate":
				return <GeneratePage go={go} />;
			case "workspaces":
				return <WorkspacesPage go={go} />;
			case "workspace":
				return <WorkspacePage id={route.id} go={go} />;
			case "edit":
				return <CreatePage go={go} editId={route.id} />;
			case "present":
				return <PresenterPage id={route.id} go={go} />;
			case "preview":
				return <PreviewPage id={route.id} go={go} />;
			case "results":
				return <SharedResultsPage id={route.id} />;
			case "join":
				return <JoinPage go={go} />;
			case "participate":
				return <ParticipantPage code={route.code} go={go} />;
		}
	})();

	return (
		<ThemeProvider>
			<ToastProvider>
				<StoreProvider>{content}</StoreProvider>
			</ToastProvider>
		</ThemeProvider>
	);
}
