import {
	ChevronLeft,
	Inbox,
	Lock,
	Mail,
	MessageSquareOff,
	ShieldAlert,
	Star,
	TriangleAlert,
	UserX,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { AuthControls } from "../auth";
import { useSession } from "../auth-client";
import { type ChoiceOption, Segmented } from "../components/EditorControls";
import { AppMenu } from "../components/ui/AppMenu";
import { LoadingState } from "../components/ui/Loading";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import type {
	AdminFeedbackPage as FeedbackPage,
	FeedbackChannel,
	FeedbackContact,
} from "../types";

// ── The administrators' feedback page (REQ185) ────────────────
//
// The first admin page: one tab per feedback channel — `user`, sent from the
// app menu's form, and `participant`, the prompt after a session (REQ186) —
// each showing what `GET /api/admin/feedback` answers and nothing more. It
// reads; it deletes, exports and filters nothing.
//
// Nothing here is a permission check. The endpoint's gate decides who reads,
// and this page only turns its refusals into words: `401` asks the visitor to
// sign in, `403` says the account is not an administrator's, and `404` — which
// only an administrator ever gets — says the channel is off on this server.
//
// Every comment is somebody else's text. It is drawn as text, never as markup,
// and a contact address only ever becomes the `mailto:` it is.

/** The two channels, as the tabs name them, in the order they are drawn. */
const FEEDBACK_CHANNEL_OPTIONS: ChoiceOption<FeedbackChannel>[] = [
	{ value: "user", label: "App menu" },
	{ value: "participant", label: "After a session" },
];

/** The ratings a summary counts, highest first. */
const RATINGS = [5, 4, 3, 2, 1] as const;

/** The stars a rating is drawn as, left to right. */
const STARS = [1, 2, 3, 4, 5] as const;

/**
 * What the page is showing right now. The refusals are states of their own
 * rather than a message, because each says something different to the person
 * reading it and only one of them can be fixed from here.
 */
export type AdminFeedbackState =
	| { kind: "loading" }
	| { kind: "signedOut" }
	| { kind: "forbidden" }
	| { kind: "off" }
	| { kind: "failed"; message: string }
	| { kind: "ready"; page: FeedbackPage };

/** Read a failed feedback fetch into the state the page draws. */
export function readAdminFeedbackFailure(error: unknown): AdminFeedbackState {
	if (error instanceof ApiError) {
		if (error.status === 401) return { kind: "signedOut" };
		if (error.status === 403) return { kind: "forbidden" };
		if (error.status === 404) return { kind: "off" };
	}
	return {
		kind: "failed",
		message: error instanceof Error ? error.message : "Unknown error",
	};
}

/**
 * The entries read so far followed by the next page's. The totals are the
 * channel's whichever page carries them, so the newer page's stand.
 */
export function appendAdminFeedbackPage(
	shown: FeedbackPage,
	next: FeedbackPage,
): FeedbackPage {
	if (shown.channel === "user" && next.channel === "user") {
		return { ...next, entries: [...shown.entries, ...next.entries] };
	}
	if (shown.channel === "participant" && next.channel === "participant") {
		return { ...next, entries: [...shown.entries, ...next.entries] };
	}
	return next;
}

/**
 * The `mailto:` a contact address is written to. Built from the resolved
 * address alone, and percent-encoded but for its `@`, so an address can only
 * ever name a recipient — never smuggle in a subject, a body or a second one.
 */
export function feedbackMailto(email: string): string {
	return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`;
}

export function AdminFeedbackPage({ go }: { go: (route: Route) => void }) {
	const [channel, setChannel] = useState<FeedbackChannel>("user");
	const [state, setState] = useState<AdminFeedbackState>({ kind: "loading" });
	const [loadingMore, setLoadingMore] = useState(false);
	const { data: session } = useSession();
	const userId = session?.user?.id ?? null;

	usePageTitle("Feedback");

	// Re-read on a channel switch, and when the session changes, so signing
	// in from the signed-out screen lands on the page it was refused.
	useEffect(() => {
		let cancelled = false;
		setState({ kind: "loading" });
		api
			.getAdminFeedback(channel)
			.then((page) => {
				if (!cancelled) setState({ kind: "ready", page });
			})
			.catch((loadError: unknown) => {
				if (!cancelled) setState(readAdminFeedbackFailure(loadError));
			});
		return () => {
			cancelled = true;
		};
	}, [channel, userId]);

	const loadMore = useCallback(async () => {
		if (state.kind !== "ready" || !state.page.nextCursor) return;
		const shown = state.page;
		setLoadingMore(true);
		try {
			const next = await api.getAdminFeedback(shown.channel, shown.nextCursor);
			setState((current) =>
				current.kind === "ready" && current.page === shown
					? { kind: "ready", page: appendAdminFeedbackPage(shown, next) }
					: current,
			);
		} catch (loadError: unknown) {
			setState(readAdminFeedbackFailure(loadError));
		} finally {
			setLoadingMore(false);
		}
	}, [state]);

	return (
		<AdminFeedbackScreen
			channel={channel}
			state={state}
			loadingMore={loadingMore}
			onChannelChange={setChannel}
			onLoadMore={loadMore}
			onBack={() => go({ page: "home" })}
		/>
	);
}

/** The page as drawn for a given state — every screen of it, menu and all. */
export function AdminFeedbackScreen({
	channel,
	state,
	loadingMore,
	onChannelChange,
	onLoadMore,
	onBack,
}: {
	channel: FeedbackChannel;
	state: AdminFeedbackState;
	loadingMore: boolean;
	onChannelChange: (channel: FeedbackChannel) => void;
	onLoadMore: () => void;
	onBack: () => void;
}) {
	if (state.kind === "loading") {
		return (
			<div className="min-h-screen w-full bg-void bg-grid bg-noise flex items-center justify-center">
				<LoadingState />
			</div>
		);
	}

	if (state.kind !== "ready") {
		const refusal = refusalCopy(state);
		return (
			<div className="min-h-screen w-full bg-void bg-grid bg-noise flex items-center justify-center p-6">
				<div className="absolute top-4 right-4 z-20 flex items-center gap-2">
					<AuthControls />
					<AppMenu />
				</div>
				<div className="max-w-md text-center flex flex-col items-center gap-3">
					{refusal.icon}
					<h1 className="text-lg font-semibold">{refusal.title}</h1>
					<p className="text-sm text-text-muted">{refusal.body}</p>
				</div>
			</div>
		);
	}

	const { page } = state;
	return (
		<div className="min-h-screen w-full bg-void bg-grid bg-noise">
			<div className="absolute top-4 right-4 sm:top-6 sm:right-6 lg:right-12 z-20 flex items-center gap-2">
				<AuthControls />
				<AppMenu />
			</div>

			<div className="relative z-10 w-full max-w-4xl px-6 sm:px-12 lg:px-24 py-12 sm:py-16 flex flex-col gap-8">
				<header className="flex flex-col gap-4">
					<button
						type="button"
						className="self-start flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
						onClick={onBack}
					>
						<ChevronLeft size={16} />
						Back
					</button>
					<div className="flex items-center gap-3">
						<Inbox size={16} className="text-accent" />
						<span className="font-mono text-sm text-text-muted tracking-wider uppercase">
							admin · feedback
						</span>
					</div>
					<h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
						Feedback about omul
					</h1>
					<p className="text-text-muted max-w-xl">
						What people sent to the administrators of this server. A
						presenter or organizer never sees it.
					</p>
					<div className="self-start">
						<Segmented
							value={channel}
							onChange={onChannelChange}
							options={FEEDBACK_CHANNEL_OPTIONS}
							ariaLabel="Feedback channel"
						/>
					</div>
				</header>

				<FeedbackSummary page={page} />

				{page.entries.length === 0 ? (
					<p className="text-text-dim py-16 text-center">
						No feedback in this channel yet.
					</p>
				) : (
					<ol className="flex flex-col gap-3">
						{page.channel === "user"
							? page.entries.map((entry) => (
									<FeedbackEntryCard
										key={entry.id}
										rating={entry.rating}
										comment={entry.comment}
										createdOn={entry.createdOn}
										details={`${entry.surface} screen · ${entry.language}`}
										contact={
											entry.contact && (
												<FeedbackContactLine contact={entry.contact} />
											)
										}
									/>
								))
							: page.entries.map((entry) => (
									<FeedbackEntryCard
										key={entry.id}
										rating={entry.rating}
										comment={entry.comment}
										createdOn={entry.createdOn}
										details={entry.language}
										contact={null}
									/>
								))}
					</ol>
				)}

				{page.entries.length > 0 && (
					<div className="flex flex-col items-center gap-3 text-sm text-text-muted">
						<span>
							Showing {page.entries.length} of {page.total}
						</span>
						{page.nextCursor && (
							<button
								type="button"
								className="btn-secondary text-sm"
								onClick={onLoadMore}
								disabled={loadingMore}
							>
								{loadingMore ? "Loading…" : "Show older feedback"}
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/** What each refusal says, and the icon it says it beside. */
function refusalCopy(
	state: Exclude<AdminFeedbackState, { kind: "loading" } | { kind: "ready" }>,
): { icon: ReactNode; title: string; body: string } {
	switch (state.kind) {
		case "signedOut":
			return {
				icon: <Lock size={28} className="text-text-dim" />,
				title: "Sign in to read feedback",
				body: "This page is for the administrators of this server. Sign in from the top right with an administrator's account.",
			};
		case "forbidden":
			return {
				icon: <ShieldAlert size={28} className="text-text-dim" />,
				title: "This page is for administrators",
				body: "Only the administrators of this server can read the feedback sent about omul, and this account is not one of them.",
			};
		case "off":
			return {
				icon: <MessageSquareOff size={28} className="text-text-dim" />,
				title: "Feedback is not collected on this server",
				body: "The feedback channel is switched off (OMUL_FEEDBACK_ENABLED), so there is nothing to read.",
			};
		case "failed":
			return {
				icon: <TriangleAlert size={28} className="text-text-dim" />,
				title: "The feedback could not be loaded",
				body: state.message,
			};
	}
}

/** A channel's totals: every entry, by rating, and those with none. */
function FeedbackSummary({ page }: { page: FeedbackPage }) {
	return (
		<section
			aria-label="Summary"
			className="rounded-xl border border-border bg-surface/50 p-5 flex flex-wrap items-center gap-x-8 gap-y-3"
		>
			<div className="flex flex-col">
				<span className="text-2xl font-bold">{page.total}</span>
				<span className="text-xs text-text-muted">in total</span>
			</div>
			<dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
				{RATINGS.map((rating) => (
					<div key={rating} className="flex items-center gap-1.5">
						<dt className="flex items-center gap-0.5 text-text-muted">
							{rating}
							<Star size={13} aria-hidden="true" />
							<span className="sr-only">stars</span>
						</dt>
						<dd className="font-medium">{page.ratingCounts[rating]}</dd>
					</div>
				))}
				<div className="flex items-center gap-1.5">
					<dt className="text-text-muted">No rating</dt>
					<dd className="font-medium">{page.unratedCount}</dd>
				</div>
			</dl>
		</section>
	);
}

/** One entry: its rating, its day, where it came from, and what it said. */
function FeedbackEntryCard({
	rating,
	comment,
	createdOn,
	details,
	contact,
}: {
	rating: number | null;
	comment: string | null;
	createdOn: string;
	details: string;
	contact: ReactNode;
}) {
	return (
		<li className="rounded-xl border border-border bg-surface-raised p-4 shadow-panel flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
				<FeedbackRating rating={rating} />
				<span className="text-text-muted">{createdOn}</span>
				<span className="text-text-dim">{details}</span>
			</div>
			{comment && (
				<p className="whitespace-pre-wrap break-words">{comment}</p>
			)}
			{contact}
		</li>
	);
}

/** A rating as five stars, the given number filled — or a plain "No rating". */
function FeedbackRating({ rating }: { rating: number | null }) {
	if (rating === null) {
		return <span className="text-text-dim">No rating</span>;
	}
	return (
		<span
			role="img"
			aria-label={`Rated ${rating} of 5`}
			className="flex items-center gap-0.5 text-accent"
		>
			{STARS.map((star) => (
				<Star
					key={star}
					size={14}
					aria-hidden="true"
					fill={star <= rating ? "currentColor" : "none"}
					className={star <= rating ? undefined : "text-text-dim"}
				/>
			))}
		</span>
	);
}

/**
 * Who to write back to about one app-menu entry: the account's current
 * address as a `mailto:`, or a plain note once the account is gone. An entry
 * whose sender did not ask to be contacted draws no line at all.
 */
function FeedbackContactLine({
	contact,
}: {
	contact: NonNullable<FeedbackContact>;
}) {
	if (contact.status === "deleted") {
		return (
			<p className="flex items-center gap-1.5 text-sm text-text-dim">
				<UserX size={14} aria-hidden="true" />
				account deleted, no contact
			</p>
		);
	}
	return (
		<p className="flex items-center gap-1.5 text-sm">
			<Mail size={14} aria-hidden="true" className="text-text-muted" />
			<a
				href={feedbackMailto(contact.email)}
				className="text-accent-text underline underline-offset-2"
			>
				{contact.email}
			</a>
		</p>
	);
}
