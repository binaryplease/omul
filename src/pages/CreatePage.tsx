import {
	AlertTriangle,
	ChevronLeft,
	MessageCircleQuestion,
	MonitorPlay,
	Plus,
	Settings,
	Users,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, getCreatorToken } from "../api";
import {
	ChoiceCards,
	ColorField,
	Field,
	PanelHeader,
	Section,
	Toggle,
} from "../components/EditorControls";
import {
	deckFontOptions,
	DeckMark,
	deckThemeOptions,
} from "../components/DeckTheme";
import { PresenterNotesStrip } from "../components/PresenterNotes";
import { PreviewLink } from "../components/PreviewLink";
import { ICON_BUTTON_HOVER } from "../components/ShareCluster";
import { SlideCanvas } from "../components/SlideCanvas";
import type { SlideCanvasEditing } from "../components/SlideCanvasFields";
import type { SlideCanvasView } from "../components/SlidePreview";
import {
	SlideCommentsStrip,
	useSlideComments,
} from "../components/SlideComments";
import {
	RESULTS_VISIBILITY_LABEL,
	RESULTS_VISIBILITY_OPTIONS,
	SlideEditor,
} from "../components/SlideEditor";
import { slideRailItemSurface } from "../components/SlideRail";
import { SlideThumbnail } from "../components/SlideThumbnail";
import { SlideTypeMenu } from "../components/SlideTypeMenu";
import { LoadingState } from "../components/ui/Loading";
import { StatusBadge } from "../components/ui/StatusBadge";
import { ThemeToggle } from "../components/ui/Theme";
import { useToast } from "../components/ui/Toast";
import type { Route } from "../router";
import { usePageTitle } from "../router";
import { useStore, useStoreApi } from "../store";
import type {
	DeckAccessLevel,
	DeckBrand,
	DeckThemeId,
	PresentationMode,
	QAVisibility,
	ResultsVisibility,
	SlideType,
} from "../types";
import {
	callerCanEditDeck,
	canReadDeckComments,
	CUSTOM_DECK_THEME_ID,
	deckBrandFor,
	deckLogoFor,
	EMPTY_DECK_BRAND,
	gridAxesFor,
	guessRangeFor,
	guessReferenceFor,
	isContentSlideType,
	isReachableGuessReference,
	pinAreaFor,
	slideWriteRefusalFor,
	pinImageFor,
	slideEmbedFor,
	slideHasResults,
	slideVideoFor,
} from "../types";

// ── Create / Edit Page ────────────────────────────────────────
//
// The authoring surface mirrors the live Presenter app-shell: a top action bar,
// a left slide rail (selection, reorder, add), a centred stage, and a settings
// column beside it. Editing one slide at a time — instead of rendering the whole
// deck inline — keeps long decks navigable and matches the presenter's mental
// model of "rail + stage".
//
// The stage is the *slide* (REQ152), not the form that authors it: `SlideCanvas`
// draws it through the same rendering path and deck theming the room will get,
// at every viewport width — and the question and the option rows are written on
// it (REQ153), at the size, colour and position the room will read them. The
// per-slide form and the deck's own settings share the column beside it — one of
// them is on screen at a time, chosen by the rail.
// The canvas keeps its slide either way, so an organizer changing the deck's
// theme can watch what it does to a slide rather than reading about it.

/** Selection target in the rail: a slide by index, or the deck settings panel. */
export type Selection = number | "settings";

/**
 * What the authoring column beside the canvas is called.
 *
 * It is a named region rather than an unnamed one because it is not one surface
 * but two — the per-slide form and the deck's own settings, swapped by the rail
 * — and a reader who arrives by landmark has no other way to tell which of them
 * they are standing in. The rail's own wording for the deck panel, so the two
 * ways of reaching it agree on what it is called.
 */
export function editorColumnLabel(selected: Selection): string {
	return selected === "settings" ? "Presentation settings" : "Slide settings";
}

export function CreatePage({
	go,
	editId,
}: {
	go: (r: Route) => void;
	editId?: string;
}) {
	// Authoring document lives in the editor slice (the CRDT-ready seam).
	const title = useStore((state) => state.title);
	const language = useStore((state) => state.language);
	const mode = useStore((state) => state.mode);
	const resultsVisibility = useStore((state) => state.resultsVisibility);
	const qaEnabled = useStore((state) => state.qaEnabled);
	const qaVisibility = useStore((state) => state.qaVisibility);
	const reactionsEnabled = useStore((state) => state.reactionsEnabled);
	const chatEnabled = useStore((state) => state.chatEnabled);
	const requireParticipantName = useStore(
		(state) => state.requireParticipantName,
	);
	const theme = useStore((state) => state.theme);
	const themeBrand = useStore((state) => state.themeBrand);
	const themeLogoUrl = useStore((state) => state.themeLogoUrl);
	const themeLogoAlt = useStore((state) => state.themeLogoAlt);
	const slides = useStore((state) => state.slides);
	const setTitle = useStore((state) => state.setTitle);
	const setLanguage = useStore((state) => state.setLanguage);
	const setMode = useStore((state) => state.setMode);
	const setResultsVisibility = useStore((state) => state.setResultsVisibility);
	const applyResultsVisibilityToDeck = useStore(
		(state) => state.applyResultsVisibilityToDeck,
	);
	const setQAEnabled = useStore((state) => state.setQAEnabled);
	const setQAVisibility = useStore((state) => state.setQAVisibility);
	const setReactionsEnabled = useStore((state) => state.setReactionsEnabled);
	const setChatEnabled = useStore((state) => state.setChatEnabled);
	const setRequireParticipantName = useStore(
		(state) => state.setRequireParticipantName,
	);
	const setTheme = useStore((state) => state.setTheme);
	const setThemeBrand = useStore((state) => state.setThemeBrand);
	const setThemeLogoUrl = useStore((state) => state.setThemeLogoUrl);
	const setThemeLogoAlt = useStore((state) => state.setThemeLogoAlt);
	const loadEditor = useStore((state) => state.loadEditor);
	const resetEditor = useStore((state) => state.resetEditor);
	const addSlide = useStore((state) => state.addSlide);
	const updateSlide = useStore((state) => state.updateSlide);
	const removeSlide = useStore((state) => state.removeSlide);
	const moveSlide = useStore((state) => state.moveSlide);
	const reorderSlide = useStore((state) => state.reorderSlide);
	const addOption = useStore((state) => state.addOption);
	const updateOption = useStore((state) => state.updateOption);
	const removeOption = useStore((state) => state.removeOption);

	// Ephemeral, single-component editor UI stays local (triage decision).
	const [saving, setSaving] = useState(false);
	const [loadingEdit, setLoadingEdit] = useState(!!editId);
	/**
	 * The caller's **account** standing (REQ074) — what the comment strip below
	 * the canvas is gated on, and a narrower question than the `accessLevel` the
	 * redirect below reads off the fetch: the comment routes refuse the edit
	 * token, so the two disagree exactly where it matters — the token holder
	 * with no account edits the deck and reads no thread. `null` until the fetch
	 * answers, which also holds the comment read back until the standing is
	 * known: a caller with none is never asked for on their behalf. A *report*,
	 * like everywhere else a level is read — the routes re-resolve it per
	 * request, so getting it wrong here mis-draws a box and nothing more.
	 */
	const [commentAccess, setCommentAccess] = useState<DeckAccessLevel | null>(
		null,
	);
	/**
	 * The caller's own standing on the deck being edited (REQ075), as the fetch
	 * below reported it — the wider question `commentAccess` above is the account
	 * half of, and the one the deck's controls are gated on. `null` until the
	 * fetch answers, and on a new deck it stays that way: a deck that does not
	 * exist yet has no standing to report.
	 */
	const [accessLevel, setAccessLevel] = useState<DeckAccessLevel | null>(null);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<Selection>(0);
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	/**
	 * Which of the stage's two views is on screen (REQ154). It lives here rather
	 * than inside the canvas because it is not only the canvas that moves it: a
	 * chart setting changed in the column beside it sends the stage to the
	 * rendering that setting selects, which is the whole point of judging a chart
	 * style against a chart.
	 */
	const [canvasView, setCanvasView] = useState<SlideCanvasView>("question");
	// Drag-to-reorder cursor: the rail index being dragged and the slot it hovers.
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const { addToast } = useToast();
	const storeApi = useStoreApi();
	const isEdit = !!editId;

	/**
	 * Whether this caller may edit the deck that is open — the same question the
	 * redirect below decides on, asked here of what the fetch reported so the
	 * header's controls read it too. The Preview control is the one that needs it:
	 * a dry run carries the deck's answer keys, so the endpoint authorizes it
	 * exactly as it authorizes an edit, and gating it on this browser's token map
	 * alone left an owner unable to rehearse their own deck (REQ149).
	 */
	const canEditDeck = callerCanEditDeck({
		heldEditToken: !!(editId && getCreatorToken(editId)),
		accessLevel,
	});

	/**
	 * The deck's comment threads (REQ074), loaded once for the whole deck so
	 * paging through the rail costs nothing. A deck that does not exist yet has
	 * none — the hook is handed `null` and asks the server nothing, since a
	 * comment is anchored to a stored slide and there are none until Save. Gated
	 * on the account standing the fetch reported: a browser holding only the
	 * deck's edit link has none, and asking on its behalf would be a read the
	 * server refuses on every load.
	 */
	const {
		comments,
		loading: commentsLoading,
		error: commentsError,
		addComment,
		removeComment,
	} = useSlideComments(
		canReadDeckComments(commentAccess) ? (editId ?? null) : null,
	);

	usePageTitle(isEdit ? "Edit Presentation" : "Create Presentation");

	// Populate the editor: a blank draft for Create, the fetched document for
	// Edit. Callers who cannot save are redirected to the presenter view, which
	// renders read-only. Without this gate, anyone with the /edit URL could
	// modify the form locally even though Save would 401.
	//
	// Two ways in, because there are two ways to be able to save: a creator token
	// in this browser's localStorage, or the server's own answer that this
	// account may edit the deck (REQ075) — which is how an `edit` collaborator
	// gets in, and how an owner on a browser that never held the token stops being
	// locked out of their own deck. Both are read through the shared predicate
	// rather than by comparing a level string here (REQ149). The redirect is
	// therefore decided *after* the fetch rather than before it; the fetch itself
	// is a public read, so it costs a caller with no standing nothing but a
	// round trip on the way to the page they were going to anyway.
	useEffect(() => {
		if (!editId) {
			resetEditor();
			return;
		}
		api
			.getPresentation(editId)
			.then((data) => {
				if (
					!callerCanEditDeck({
						heldEditToken: !!getCreatorToken(editId),
						accessLevel: data.accessLevel,
					})
				) {
					go({ page: "present", id: editId });
					return;
				}
				setAccessLevel(data.accessLevel ?? null);
				setCommentAccess(data.commentAccess ?? null);
				loadEditor({
					title: data.title,
					slides: data.slides,
					language: data.language,
					mode: data.mode,
					resultsVisibility: data.resultsVisibility,
					qaEnabled: data.qaEnabled,
					qaVisibility: data.qaVisibility,
					reactionsEnabled: data.reactionsEnabled,
					chatEnabled: data.chatEnabled,
					requireParticipantName: data.requireParticipantName,
					theme: data.theme,
					themeBrand: data.themeBrand,
					themeLogoUrl: data.themeLogoUrl,
					themeLogoAlt: data.themeLogoAlt,
				});
			})
			.catch((loadError: Error) => setError(loadError.message))
			.finally(() => setLoadingEdit(false));
	}, [editId, go, resetEditor, loadEditor]);

	/**
	 * The question slides standing on their own reveal mode rather than the
	 * deck's (REQ018) — exactly what the deck-wide apply would change, and so
	 * both what the button says and whether it has anything to do. Counted from
	 * the same `slideHasResults` set the operation itself sweeps, so the number
	 * shown and the slides changed can never disagree.
	 */
	const overriddenSlideCount = slides.filter(
		(slide) =>
			slideHasResults(slide.type) &&
			(slide.resultsVisibility ?? "inherit") !== "inherit",
	).length;

	/**
	 * The deck's own theme as every render site reads it (REQ080) — asked of the
	 * same resolver the projector asks, so the swatch on the picker card, the
	 * canvas beside it and the room all agree on what a half-typed colour
	 * amounts to. Resolved with the theme id forced to `custom` because the
	 * organizer is authoring this brand whichever theme is currently applied.
	 */
	const authoredBrand = deckBrandFor({
		theme: CUSTOM_DECK_THEME_ID,
		themeBrand,
	});

	// The slide on the canvas: the selected slide, or the first one while the
	// deck-settings panel is open — the deck's theme is authored against a slide,
	// so the stage keeps one rather than going blank. Clamped so a stale index
	// from a removal never points past the end of the list.
	const canvasIndex =
		selected === "settings" ? 0 : Math.min(selected, slides.length - 1);
	const activeSlide = slides[canvasIndex];
	const activeSlideId = activeSlide?.id ?? null;

	/**
	 * How the canvas writes back (REQ153): the editor store's own actions with
	 * the slide already bound, so the fields on the slide report straight through
	 * the CRDT-ready seam and nothing on the stage holds authoring state of its
	 * own.
	 *
	 * Memoised on the slide's **id** rather than on the slide, which is what keeps
	 * a keystroke from rebuilding the layer: the object handed to the stage is the
	 * same object from the first character of a question to the last, so React
	 * reconciles the field the caret is in instead of replacing it. The structure
	 * changes when the selected slide does — the only time it should.
	 *
	 * It is handed over while the *deck-settings* panel is open too, deliberately.
	 * The alternative — a canvas that looks identical and silently refuses the
	 * caret — is the worse of the two: the stage is drawing one real slide either
	 * way, its caption names which one ("Slide 1 of n"), and REQ153 puts a slide's
	 * question on the slide rather than on whatever the rail happens to have
	 * selected. Nothing here is written to a slide the author cannot see.
	 */
	const canvasEditing = useMemo<SlideCanvasEditing | null>(() => {
		if (activeSlideId === null) return null;
		return {
			onUpdate: (changes) => updateSlide(activeSlideId, changes),
			onAddOption: () => addOption(activeSlideId),
			onUpdateOption: (optionId, changes) =>
				updateOption(activeSlideId, optionId, changes),
			onRemoveOption: (optionId) => removeOption(activeSlideId, optionId),
		};
	}, [activeSlideId, updateSlide, addOption, updateOption, removeOption]);

	/**
	 * The deck's theming as both surfaces on this page read it: the canvas is
	 * drawn in it (REQ079/REQ152), and the form beside it reads what each
	 * unauthored slide colour currently inherits from it (REQ087). One object, so
	 * the stage and the fields beside it cannot disagree about what the room
	 * wears.
	 */
	const deckTheme = { theme, themeBrand, themeLogoUrl, themeLogoAlt, title };

	/**
	 * How many quiz questions the deck holds (REQ059) — read by two surfaces that
	 * must agree: the settings column, which tells a leaderboard's author whether
	 * the board will have anything to rank, and the canvas, whose results view
	 * draws that same empty or populated board.
	 */
	const deckQuizCount = slides.filter(
		(deckSlide) => deckSlide.type === "quiz",
	).length;

	const handleAddSlide = (type: SlideType) => {
		addSlide(type);
		setSelected(slides.length);
		setAddMenuOpen(false);
	};

	const handleRemoveSlide = () => {
		if (slides.length <= 1 || selected === "settings") return;
		removeSlide(slides[selected].id);
		// After removal there are slides.length - 1 slides; keep the cursor on the
		// slide that slid into this position, clamping at the new end.
		setSelected(Math.max(0, Math.min(selected, slides.length - 2)));
	};

	const handleMoveSlide = (direction: -1 | 1) => {
		if (selected === "settings") return;
		const target = selected + direction;
		if (target < 0 || target >= slides.length) return;
		moveSlide(slides[selected].id, direction);
		setSelected(target);
	};

	// Drag-to-reorder. The dragged slide is addressed by its stable id; once the
	// store has reordered, the selection cursor re-acquires whichever slide it
	// pointed at by id, so editing focus rides along with the move.
	const handleDragStart = (index: number) => setDraggingIndex(index);

	const handleDragEnterSlide = (index: number) => {
		if (draggingIndex === null) return;
		setDropIndex(index === draggingIndex ? null : index);
	};

	const handleDragEnd = () => {
		setDraggingIndex(null);
		setDropIndex(null);
	};

	const handleDropOnSlide = (toIndex: number) => {
		if (draggingIndex === null || draggingIndex === toIndex) {
			handleDragEnd();
			return;
		}
		const selectedSlideId =
			typeof selected === "number" ? slides[selected]?.id : null;
		reorderSlide(slides[draggingIndex].id, toIndex);
		if (selectedSlideId) {
			const nextSelected = storeApi
				.getState()
				.slides.findIndex((slide) => slide.id === selectedSlideId);
			if (nextSelected !== -1) setSelected(nextSelected);
		}
		handleDragEnd();
	};

	const handleSubmit = async () => {
		if (!title.trim()) {
			setError("Title is required");
			return;
		}
		for (let index = 0; index < slides.length; index++) {
			const slide = slides[index];
			const isContent = isContentSlideType(slide.type);
			const fail = (message: string) => {
				setSelected(index);
				setError(message);
			};
			if (!isContent && !slide.question.trim()) {
				fail("All slides need a question");
				return;
			}
			if (slide.type === "image" && !slide.mediaUrl?.trim()) {
				fail("Image slides need an image URL");
				return;
			}
			// REQ064 — a video slide is the video, so a deck cannot ship one that
			// points at nothing, and it is refused here rather than discovered as a
			// dead rectangle on a projector. Both failures are the same failure: the
			// resolver is what the three rendering surfaces ask, so a URL it will not
			// play is a slide that will not play.
			if (slide.type === "video" && !slide.mediaUrl?.trim()) {
				fail("Video slides need a video URL");
				return;
			}
			if (slide.type === "video" && !slideVideoFor(slide)) {
				fail("That video link can't be played — use an http(s) address");
				return;
			}
			// REQ066/REQ067/REQ068 — an embed slide is the external deck or board, so
			// the same rule applies for the same reason, against the same resolver
			// the three rendering surfaces ask. A link outside the three providers is
			// refused here rather than framed on a guess later.
			if (slide.type === "embed" && !slide.mediaUrl?.trim()) {
				fail("Embed slides need a deck or board URL");
				return;
			}
			if (slide.type === "embed" && !slideEmbedFor(slide)) {
				fail(
					"That link can't be embedded — use an https Google Slides, PowerPoint or Miro address",
				);
				return;
			}
			if (
				(slide.type === "multiple-choice" || slide.type === "quiz") &&
				slide.options?.some((option) => !option.text.trim())
			) {
				fail("All options need text");
				return;
			}
			// REQ034: a nameless item is unrankable — participants would be
			// ordering a blank row against the ones they can read.
			if (
				slide.type === "ranking" &&
				slide.rankingItems?.some((item) => !item.text.trim())
			) {
				fail("All ranking items need text");
				return;
			}
			// REQ045: a nameless item cannot be funded — participants would be
			// weighing a blank row against the ones they can read. Two items is
			// the floor: with one, the whole budget has nowhere else to go, so
			// there is no trade-off to force (REQ044).
			if (slide.type === "points") {
				if ((slide.pointsItems?.length ?? 0) < 2) {
					fail("100 Points slides need at least two items");
					return;
				}
				if (slide.pointsItems?.some((item) => !item.text.trim())) {
					fail("All 100 Points items need text");
					return;
				}
			}
			// REQ040/REQ043 — the frame is what makes an estimate an estimate, so
			// an unusable one is refused before it can be answered rather than
			// leaving participants to discover it by having every guess rejected.
			if (slide.type === "guess-number") {
				const range = guessRangeFor(slide);
				if (range.max <= range.min) {
					fail(
						"A Guess the Number slide needs a highest value above its lowest",
					);
					return;
				}
				if (range.step < 1 || range.step > range.max - range.min) {
					fail("The step must be at least 1 and no wider than the range");
					return;
				}
				// REQ041/REQ042 — a reference no selectable value can reach claims a
				// correct answer while scoring every participant wrong forever, which
				// is worse than having no reference at all. The reference itself need
				// not sit on the step grid (a true figure of 517 on a slide stepping
				// in tens is a fine question at ±10); what must hold is that the
				// tolerance window contains at least one value the slide offers.
				if (!isReachableGuessReference(range, guessReferenceFor(slide))) {
					fail(
						"The correct answer is out of reach — no selectable value falls inside its tolerance",
					);
					return;
				}
			}
			// REQ061 — a form with no answerable field asks nothing: the vote
			// boundary refuses every submission to it, and the slide would meet the
			// room as a heading over a submit button. Both failures are the same
			// failure — `isUsableFormField` is what the boundary, the phone and the
			// tally all read, so a field it will not accept is a field that is not
			// there. Refused at save rather than discovered in front of an audience.
			if (slide.type === "form") {
				const fields = slide.formFields ?? [];
				if (fields.length === 0) {
					fail("Form slides need at least one field");
					return;
				}
				if (fields.some((field) => !(field.label ?? "").trim())) {
					fail("All form fields need a label");
					return;
				}
				// A choice field with nothing to choose between is the one way a
				// labelled field can still be unanswerable.
				if (
					fields.some(
						(field) =>
							field.type === "choice" &&
							!(field.options ?? []).some((option) => option.text.trim()),
					)
				) {
					fail("Choice fields need at least one option with text");
					return;
				}
			}
			// REQ052 — the image *is* the question here: without it there is no
			// coordinate space for a pin, the vote boundary refuses every submission,
			// and the slide would meet the room as a blank frame. Refused at save
			// rather than left to be discovered on the projector.
			if (slide.type === "pin-image") {
				if (!pinImageFor(slide).url) {
					fail("Pin on Image slides need an image URL");
					return;
				}
				// REQ053 — an area part of which nobody can reach makes "how many were
				// inside?" a number about the picture rather than about the room, so a
				// target that runs off the image is refused the way an unreachable
				// guess reference is. A slide with no area at all is fine: it simply
				// claims no correct answer.
				if (slide.pinArea && !pinAreaFor(slide)) {
					fail(
						"The correct area runs off the image — keep it inside the picture",
					);
					return;
				}
			}
			if (slide.type === "grid") {
				// REQ047 — a nameless item cannot be judged on either dimension.
				if (
					!slide.gridItems?.length ||
					slide.gridItems.some((item) => !item.text.trim())
				) {
					fail("All grid items need text");
					return;
				}
				// REQ048 — an unnamed axis leaves "left vs right" to guesswork,
				// which is exactly the misreading axis titles exist to prevent.
				const { xAxis, yAxis } = gridAxesFor(slide);
				if (!xAxis.title.trim() || !yAxis.title.trim()) {
					fail("Both grid axes need a title");
					return;
				}
				// REQ049 — endpoints must describe a range to place items along.
				if (xAxis.min >= xAxis.max || yAxis.min >= yAxis.max) {
					fail("Each grid axis needs a low value below its high value");
					return;
				}
			}
		}

		// REQ159 — the write caps, checked with the same schema the boundary
		// parses with (ADR-0013) so the refusal names the slide and the field
		// instead of coming back as a bare 422 the banner can only call "the save
		// failed". This is also the only way an author learns what to trim on a
		// deck stored before a cap existed: such a deck still reads (the stored
		// shape is deliberately uncapped) but no save of it lands until the
		// oversized field is cut down.
		const writeRefusal = slideWriteRefusalFor(slides);
		if (writeRefusal) {
			if (writeRefusal.slideIndex !== null) setSelected(writeRefusal.slideIndex);
			setError(writeRefusal.message);
			return;
		}

		// REQ080 — what is stored is what the resolver could read: a colour still
		// being typed goes up as unauthored rather than as a 4xx on Save, which is
		// the same stance the editor takes on a logo URL it cannot resolve. The
		// field itself says so beside the input while it is being fixed.
		const savedBrand = authoredBrand ?? EMPTY_DECK_BRAND;

		setSaving(true);
		setError("");
		try {
			if (isEdit && editId) {
				await api.updatePresentation(editId, {
					title: title.trim(),
					slides,
					language,
					mode,
					resultsVisibility,
					qaEnabled,
					qaVisibility,
					reactionsEnabled,
					chatEnabled,
					requireParticipantName,
					theme,
					themeBrand: savedBrand,
					themeLogoUrl: themeLogoUrl.trim(),
					themeLogoAlt: themeLogoAlt.trim(),
				});
				addToast("Presentation updated", "success");
				go({ page: "present", id: editId });
			} else {
				const pres = await api.createPresentation({
					title: title.trim(),
					slides,
					language,
					mode,
					resultsVisibility,
					qaEnabled,
					qaVisibility,
					reactionsEnabled,
					chatEnabled,
					requireParticipantName,
					theme,
					themeBrand: savedBrand,
					themeLogoUrl: themeLogoUrl.trim(),
					themeLogoAlt: themeLogoAlt.trim(),
				});
				go({ page: "present", id: pres.id });
			}
		} catch (submitError: unknown) {
			setError(
				submitError instanceof Error ? submitError.message : "Unknown error",
			);
		} finally {
			setSaving(false);
		}
	};

	const leave = () =>
		isEdit
			? go({ page: "present", id: editId as string })
			: go({ page: "home" });

	if (loadingEdit)
		return (
			<div className="min-h-screen bg-void flex items-center justify-center">
				<LoadingState />
			</div>
		);

	return (
		<div className="h-screen w-full bg-void bg-grid bg-noise flex flex-col overflow-hidden">
			{/* Top action bar */}
			<header className="relative z-10 border-b border-border bg-surface/80 backdrop-blur-sm flex-shrink-0">
				<div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2.5">
					<button
						type="button"
						className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors flex-shrink-0"
						onClick={leave}
					>
						<ChevronLeft size={16} />
						<span className="hidden sm:inline">Back</span>
					</button>
					<div className="w-px h-5 bg-border hidden sm:block" />

					{/* Inline editable deck title */}
					<input
						className="flex-1 min-w-0 bg-transparent rounded-lg px-2 py-1 text-base sm:text-xl font-bold outline-none hover:bg-surface-raised focus:bg-surface-raised focus:ring-1 focus:ring-accent/40 transition-colors placeholder:text-text-muted placeholder:font-medium"
						placeholder="Untitled presentation"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						aria-label="Presentation title"
						// title is the first thing a new deck needs
						autoFocus={!isEdit}
					/>

					<StatusBadge status="draft" />

					<div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
						<ThemeToggle />
						{/* The dry run, beside the deck it rehearses (ADR-0031, REQ103).
						    Only on a saved deck: a preview reads the presentation the
						    server holds, so there is nothing to preview until there is
						    one. */}
						{isEdit && editId && (
							<PreviewLink
								presentationId={editId}
								go={go}
								canPreview={canEditDeck}
							/>
						)}
						<button
							type="button"
							className="btn-secondary text-sm hidden sm:block"
							onClick={leave}
						>
							Cancel
						</button>
						<button
							type="button"
							className="btn-primary text-sm"
							onClick={handleSubmit}
							disabled={saving}
						>
							{saving
								? isEdit
									? "Saving…"
									: "Creating…"
								: isEdit
									? "Save Changes"
									: "Create"}
						</button>
					</div>
				</div>

				{error && (
					<div className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-error/10 border-t border-error/30 text-error text-sm">
						<AlertTriangle size={15} className="flex-shrink-0" />
						{error}
					</div>
				)}
			</header>

			{/* Rail + canvas stage + settings column */}
			<div className="relative z-10 flex-1 flex flex-col md:flex-row md:overflow-hidden">
				{/* Slide rail */}
				<nav className="md:w-60 flex-shrink-0 border-b md:border-b-0 md:border-r border-border bg-surface/50 overflow-x-auto md:overflow-y-auto p-2 md:p-3 flex md:flex-col gap-2">
					<button
						type="button"
						className={`flex-shrink-0 md:w-full flex items-center gap-2 p-2 md:p-3 rounded-lg border text-sm transition-all ${slideRailItemSurface(
							selected === "settings",
						)}`}
						onClick={() => setSelected("settings")}
					>
						<Settings size={15} />
						<span className="hidden md:inline">Presentation settings</span>
					</button>

					<div className="hidden md:flex items-center justify-between px-1 pt-2 pb-1">
						<span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
							Slides
						</span>
						<span className="font-mono text-xs text-text-muted">
							{slides.length}
						</span>
					</div>

					{slides.map((slide, index) => (
						<SlideThumbnail
							key={slide.id}
							index={index}
							slide={slide}
							active={selected === index}
							onClick={() => setSelected(index)}
							dragging={draggingIndex === index}
							dropTarget={dropIndex === index}
							onDragStart={() => handleDragStart(index)}
							onDragEnter={() => handleDragEnterSlide(index)}
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => {
								event.preventDefault();
								handleDropOnSlide(index);
							}}
							onDragEnd={handleDragEnd}
						/>
					))}

					{/* Add slide — visible affordance that expands a type picker */}
					<div className="flex-shrink-0 md:w-full md:pt-1">
						<button
							type="button"
							className={`w-full flex items-center justify-center md:justify-start gap-2 p-2 md:p-3 rounded-lg border border-dashed border-border text-sm hover:border-accent/50 ${ICON_BUTTON_HOVER}`}
							onClick={() => setAddMenuOpen((open) => !open)}
						>
							{addMenuOpen ? <X size={15} /> : <Plus size={15} />}
							<span className="hidden md:inline">
								{addMenuOpen ? "Close" : "Add slide"}
							</span>
						</button>
						{addMenuOpen && (
							<SlideTypeMenu
								className="mt-2 slide-in"
								onSelect={handleAddSlide}
							/>
						)}
					</div>
				</nav>

				{/* The stage and the column that authors it. Stacked up to `xl` — the
				    slide first, because it is what the page is about — and side by
				    side above it, where there is room for both (REQ152). One scroll
				    while stacked, one per column while split, so a form three
				    thousand pixels deep never drags the rail or the canvas with it.

				    Both columns are inside `<main>`, and the authoring one is a named
				    region rather than an `<aside>`: promoting the slide to the stage
				    moved the page's subject, not its work. An `<aside>` is announced
				    as tangential and skippable, so a reader who navigates by landmark
				    would have been sent to a picture with nothing to operate while
				    every control on the page sat in the region they were told to
				    skip. */}
				<main className="flex-1 min-w-0 flex flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
					{/* The canvas: the selected slide, as the room will see it, and the
					    surface its question and options are written on (REQ153). Drawn
					    whichever panel the column beside it is showing — the deck's
					    theme is authored against a slide, not against a blank. */}
					<div className="min-w-0 space-y-3 p-4 sm:p-6 xl:flex-1 xl:overflow-y-auto xl:p-8">
						{activeSlide && (
							<>
								<SlideCanvas
									slide={activeSlide}
									index={canvasIndex}
									total={slides.length}
									deck={deckTheme}
									editing={canvasEditing}
									view={canvasView}
									onViewChange={setCanvasView}
									deckQuizCount={deckQuizCount}
								/>
								{/* The presenter's own script for this slide, under the slide
								    it is about (REQ156): it is written in the same pass as the
								    words above it, and read while presenting them. */}
								<PresenterNotesStrip
									key={activeSlide.id}
									slide={activeSlide}
									onUpdate={(changes) => updateSlide(activeSlide.id, changes)}
								/>
								{/* What the accounts this deck is shared with have said about
								    this slide (REQ074), under the slide it is about
								    (ADR-0031) — a comment is made while looking at the thing
								    it is about. Only on a deck that exists: a comment is
								    anchored to a stored slide, and a draft has none until it
								    is saved. */}
								{isEdit && (
									<SlideCommentsStrip
										comments={comments}
										slideId={activeSlide.id}
										accessLevel={commentAccess}
										error={commentsError}
										loading={commentsLoading}
										onSubmit={addComment}
										onDelete={removeComment}
									/>
								)}
							</>
						)}
					</div>

					{/* The settings column: the per-slide form, or the deck's own
					    settings — whichever the rail has selected.

					    The ~300px width is the *slide* column's requirement (REQ155) and
					    it is scoped to it: the deck panel keeps the width it was built
					    for, because it was explicitly left in its current form and its
					    two-up choice cards and full-length hints would be squeezed into
					    something nobody redesigned. The narrow column holds what the
					    canvas cannot show, composed from controls compact enough that a
					    common slide type fits without scrolling; it keeps its own
					    overflow as a floor, because a structured answer shape — twenty
					    form fields, a scale's statements — is longer than any column. */}
					<section
						aria-label={editorColumnLabel(selected)}
						className={`w-full flex-shrink-0 border-t border-border bg-surface/30 p-4 sm:p-6 xl:border-t-0 xl:border-l xl:overflow-y-auto ${
							selected === "settings"
								? "xl:w-[26rem] 2xl:w-[30rem]"
								: "xl:w-[19rem] 2xl:w-[21rem]"
						}`}
					>
						{selected === "settings" ? (
							<DeckSettings
								language={language}
								mode={mode}
								resultsVisibility={resultsVisibility}
								overriddenSlideCount={overriddenSlideCount}
								qaEnabled={qaEnabled}
								qaVisibility={qaVisibility}
								reactionsEnabled={reactionsEnabled}
								chatEnabled={chatEnabled}
								requireParticipantName={requireParticipantName}
								onLanguageChange={setLanguage}
								onModeChange={setMode}
								onResultsVisibilityChange={setResultsVisibility}
								onApplyResultsVisibilityToDeck={() =>
									applyResultsVisibilityToDeck(resultsVisibility)
								}
								onQAEnabledChange={setQAEnabled}
								onQAVisibilityChange={setQAVisibility}
								onReactionsEnabledChange={setReactionsEnabled}
								onChatEnabledChange={setChatEnabled}
								onRequireParticipantNameChange={setRequireParticipantName}
								theme={theme}
								themeBrand={themeBrand}
								authoredBrand={authoredBrand}
								themeLogoUrl={themeLogoUrl}
								themeLogoAlt={themeLogoAlt}
								deckTitle={title}
								onThemeChange={setTheme}
								onThemeBrandChange={setThemeBrand}
								onThemeLogoUrlChange={setThemeLogoUrl}
								onThemeLogoAltChange={setThemeLogoAlt}
							/>
						) : (
							activeSlide && (
								<SlideEditor
									key={activeSlide.id}
									slide={activeSlide}
									index={canvasIndex}
									total={slides.length}
									canRemove={slides.length > 1}
									onUpdate={(changes) => updateSlide(activeSlide.id, changes)}
									onMove={handleMoveSlide}
									onRemove={handleRemoveSlide}
									onPreviewResults={() => setCanvasView("results")}
									deckResultsVisibility={resultsVisibility}
									deckMode={mode}
									deckQuizCount={deckQuizCount}
									deck={deckTheme}
								/>
							)
						)}
					</section>
				</main>
			</div>
		</div>
	);
}

// ── Deck settings panel (language + pace) ─────────────────────────────
//
// Presentation-level settings. Composed from the same EditorControls as the
// per-slide editor (PanelHeader / Section / Field / ChoiceCards) so the deck
// and slide authoring surfaces read as one coherent system rather than two
// look-alikes.

function DeckSettings({
	language,
	mode,
	resultsVisibility,
	overriddenSlideCount,
	qaEnabled,
	qaVisibility,
	reactionsEnabled,
	chatEnabled,
	requireParticipantName,
	theme,
	themeBrand,
	authoredBrand,
	themeLogoUrl,
	themeLogoAlt,
	deckTitle,
	onLanguageChange,
	onModeChange,
	onResultsVisibilityChange,
	onApplyResultsVisibilityToDeck,
	onQAEnabledChange,
	onQAVisibilityChange,
	onReactionsEnabledChange,
	onChatEnabledChange,
	onRequireParticipantNameChange,
	onThemeChange,
	onThemeBrandChange,
	onThemeLogoUrlChange,
	onThemeLogoAltChange,
}: {
	language: string;
	mode: PresentationMode;
	resultsVisibility: ResultsVisibility;
	/**
	 * How many question slides currently override the deck's reveal mode — what
	 * the deck-wide apply below would actually change, stated rather than left
	 * for the organizer to count by clicking through the rail (REQ018).
	 */
	overriddenSlideCount: number;
	qaEnabled: boolean;
	qaVisibility: QAVisibility;
	/** The participant channels the deck starts with (REQ077/REQ078). */
	reactionsEnabled: boolean;
	chatEnabled: boolean;
	/** Whether the room states its names on joining (REQ076). */
	requireParticipantName: boolean;
	/** The deck's theme (REQ079/REQ080) and the organizer's mark (REQ136). */
	theme: DeckThemeId;
	/** The brand as it is being authored, and as the resolver reads it back. */
	themeBrand: DeckBrand;
	authoredBrand: DeckBrand | null;
	themeLogoUrl: string;
	themeLogoAlt: string;
	/** What the logo falls back to being called when it is given no name. */
	deckTitle: string;
	onLanguageChange: (language: string) => void;
	onModeChange: (mode: PresentationMode) => void;
	onResultsVisibilityChange: (resultsVisibility: ResultsVisibility) => void;
	onApplyResultsVisibilityToDeck: () => void;
	onQAEnabledChange: (qaEnabled: boolean) => void;
	onQAVisibilityChange: (qaVisibility: QAVisibility) => void;
	onReactionsEnabledChange: (reactionsEnabled: boolean) => void;
	onChatEnabledChange: (chatEnabled: boolean) => void;
	onRequireParticipantNameChange: (requireParticipantName: boolean) => void;
	onThemeChange: (theme: DeckThemeId) => void;
	onThemeBrandChange: (changes: Partial<DeckBrand>) => void;
	onThemeLogoUrlChange: (themeLogoUrl: string) => void;
	onThemeLogoAltChange: (themeLogoAlt: string) => void;
}) {
	// REQ136 — what the logo field actually resolves to, asked of the same
	// function every render surface asks. A URL no `<img>` may be pointed at
	// resolves to nothing, and the organizer is told so here, in the editor,
	// while they can still fix it — rather than discovering a missing mark on a
	// projector.
	const logo = deckLogoFor({
		themeLogoUrl,
		themeLogoAlt,
		title: deckTitle,
	});
	const authoredLogoUrl = themeLogoUrl.trim();
	// REQ080 — whether the deck is drawn in the theme it authored, asked once so
	// the sentence and the control below it cannot disagree.
	const wearsOwnTheme = theme === CUSTOM_DECK_THEME_ID;
	return (
		<div className="max-w-2xl mx-auto slide-in space-y-6">
			<PanelHeader
				icon={<Settings size={18} />}
				eyebrow="Deck"
				title="Presentation settings"
			/>

			{/* Theme (REQ079) — the deck's colours, type and slide backgrounds, on
			    the presenter's screen, every participant's phone and the join
			    screen alike. The set is built in: a deck names one of them, and
			    what that name looks like stays the product's decision, so a deck
			    authored today is not pinned to today's palette. */}
			<Section
				title="Theme"
				description="Colours, typeface and slide backgrounds, across the presenter, participant and join surfaces."
			>
				<ChoiceCards
					ariaLabel="Deck theme"
					columns={2}
					value={theme}
					onChange={onThemeChange}
					options={deckThemeOptions(authoredBrand)}
				/>
			</Section>

			{/* The deck's own theme (REQ080/REQ092/REQ135) — three colours and a
			    face, stored on the deck and applied wherever a built-in theme would
			    be. Authored beside the picker that applies it (ADR-0031), and
			    authorable whichever theme is currently selected: trying `Ember` on
			    must not throw away the colours somebody typed in. */}
			<Section
				title="Your own theme"
				description="An organization's colours and typeface, authored on this deck and applied exactly as a built-in theme is."
			>
				<div className="flex flex-col gap-3">
					<Field
						label="Theme name"
						hint="What this theme is called in the picker above."
					>
						<input
							className="input"
							placeholder="Custom"
							value={themeBrand.name}
							onChange={(event) =>
								onThemeBrandChange({ name: event.target.value })
							}
						/>
					</Field>
					<ColorField
						label="Brand colour"
						hint="Everything live: bars, links, the wash behind a slide."
						placeholder="#2e5cff"
						value={themeBrand.accent}
						onChange={(accent) => onThemeBrandChange({ accent })}
					/>
					<ColorField
						label="Canvas"
						hint="The surface a slide is drawn on. How light it is decides which colour scheme these colours were authored for — the other one is derived from them, so a reader who prefers the opposite still gets your brand."
						placeholder="#131316"
						value={themeBrand.canvas}
						onChange={(canvas) => onThemeBrandChange({ canvas })}
					/>
					<ColorField
						label="Text"
						hint="The words on that canvas. Left empty, it is derived from the canvas."
						placeholder="#f4f4f5"
						value={themeBrand.text}
						onChange={(text) => onThemeBrandChange({ text })}
					/>
					<Field
						label="Typeface"
						hint="Only faces this build ships, so every screen in the room resolves the same one."
					>
						<ChoiceCards
							ariaLabel="Theme typeface"
							columns={2}
							value={themeBrand.font}
							onChange={(font) => onThemeBrandChange({ font })}
							options={deckFontOptions()}
						/>
					</Field>
					{/* Whether these colours are the ones on screen is a different
					    question from whether they are authored, and the panel answers it
					    rather than leaving the organizer to infer it from the picker
					    above. The control stays put and states why it is unavailable
					    (ADR-0025). */}
					<div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 p-3">
						<p className="text-xs text-text-muted">
							{wearsOwnTheme
								? "This deck is drawn in the theme above."
								: "Stored with the deck, but not what the room sees — it currently wears the built-in theme selected above."}
						</p>
						<button
							type="button"
							className="btn-secondary flex-shrink-0 text-sm"
							onClick={() => onThemeChange(CUSTOM_DECK_THEME_ID)}
							disabled={wearsOwnTheme}
							title={
								wearsOwnTheme
									? "This deck already wears its own theme."
									: undefined
							}
						>
							Use this theme
						</button>
					</div>
				</div>
			</Section>

			{/* Logo (REQ136) — the organizer's own mark, worn by the participant-
			    facing surfaces in place of ours. An image URL, exactly like a
			    slide's: nothing here uploads or stores a picture. */}
			<Section
				title="Logo"
				description="Shown on the join, waiting and participant screens in place of the default mark."
			>
				<div className="flex flex-col gap-3">
					<Field
						label="Logo image URL"
						hint="An http(s) link, or a path this deployment serves. Leave empty to keep the default mark."
					>
						<input
							className="input"
							type="url"
							inputMode="url"
							placeholder="https://example.com/logo.svg"
							value={themeLogoUrl}
							onChange={(event) => onThemeLogoUrlChange(event.target.value)}
						/>
					</Field>
					<Field
						label="Logo description"
						hint={
							logo && logo.alt === ""
								? "Read out by screen readers. With no description and no deck title, the mark is treated as decorative."
								: "Read out by screen readers. Defaults to the deck's title."
						}
					>
						<input
							className="input"
							placeholder={deckTitle.trim() || "Acme"}
							value={themeLogoAlt}
							onChange={(event) => onThemeLogoAltChange(event.target.value)}
							disabled={authoredLogoUrl === ""}
							title={
								authoredLogoUrl === ""
									? "There is no logo to describe yet — add an image URL above."
									: undefined
							}
						/>
					</Field>
					{/* The mark as the room will meet it, beside the fields that set it
					    (ADR-0031). A URL the resolver refuses says so here rather than
					    silently falling back on a projector. */}
					<div className="flex items-center gap-3 rounded-xl border border-border bg-surface/40 p-3">
						<DeckMark
							deck={{ themeLogoUrl, themeLogoAlt, title: deckTitle }}
							size="md"
						/>
						<p className="text-xs text-text-muted">
							{logo
								? "This is the mark the audience sees."
								: authoredLogoUrl === ""
									? "No logo set — the audience sees the default mark."
									: "That link can't be used as an image — use an http(s) address or a path starting with “/”. The audience sees the default mark until it is fixed."}
						</p>
					</div>
				</div>
			</Section>

			{/* Language (REQ084) */}
			<Section
				title="Language"
				description="Participant-facing UI strings are shown in this language."
			>
				<Field label="Audience language">
					<select
						className="input"
						value={language}
						onChange={(event) => onLanguageChange(event.target.value)}
					>
						<option value="en">English</option>
						<option value="de">Deutsch</option>
						<option value="fr">Français</option>
						<option value="es">Español</option>
						<option value="it">Italiano</option>
						<option value="pt">Português</option>
						<option value="nl">Nederlands</option>
					</select>
				</Field>
			</Section>

			{/* Pace mode (REQ003 / REQ082) */}
			<Section
				title="Pace"
				description="Who advances the slides during the presentation."
			>
				<ChoiceCards
					ariaLabel="Presentation pace"
					columns={2}
					value={mode}
					onChange={onModeChange}
					options={[
						{
							value: "live",
							label: "Presenter pace",
							description: "You control the slide. Participants follow along.",
							icon: <MonitorPlay size={18} />,
						},
						{
							value: "survey",
							label: "Audience pace",
							description:
								"Participants navigate on their own. Great for async surveys.",
							icon: <Users size={18} />,
						},
					]}
				/>
			</Section>

			{/* Results visibility (REQ015/REQ016/REQ017) — the deck's reveal mode:
			    publish each tally as answers land, publish on the presenter's
			    reveal, or never publish one. Deck-level default; each slide may
			    override it from its own Settings panel — and the button below
			    takes those overrides back so the mode governs the whole deck in
			    one operation (REQ018). It sits here, under the setting it applies,
			    rather than in the page chrome (ADR-0031). */}
			<Section
				title="Results visibility"
				description="When aggregated results reach the audience. Any slide can override this from its own settings."
			>
				<ChoiceCards
					ariaLabel="Results visibility"
					value={resultsVisibility}
					onChange={onResultsVisibilityChange}
					options={RESULTS_VISIBILITY_OPTIONS}
				/>
				<div className="mt-3 flex flex-col gap-2">
					<button
						type="button"
						className="btn-secondary self-start text-sm"
						disabled={overriddenSlideCount === 0}
						title={
							overriddenSlideCount === 0
								? "Every question slide already follows this setting — there is no per-slide override left to clear."
								: `Clear the results-visibility override on ${overriddenSlideCount} slide${
										overriddenSlideCount === 1 ? "" : "s"
									} so the whole deck follows “${RESULTS_VISIBILITY_LABEL[resultsVisibility]}”.`
						}
						onClick={onApplyResultsVisibilityToDeck}
					>
						Apply to every question slide
					</button>
					<p className="text-xs text-text-muted">
						{overriddenSlideCount === 0
							? "Every question slide follows this setting."
							: `${overriddenSlideCount} slide${
									overriddenSlideCount === 1 ? " overrides" : "s override"
								} it. Applying clears those overrides — including any that were withholding a Pin on Image target area until you reveal it.`}
					</p>
				</div>
			</Section>

			{/* The Q&A layer (REQ036/REQ037) — deck-level, because that is what a
			    layer is: no slide can turn it on for itself, and a question asked
			    from slide 4 belongs to the presentation, not to slide 4. The
			    presenter can still flip both switches live from the Q&A panel
			    during a session; this is where the deck starts out. */}
			<Section
				title="Q&A"
				description="Let the audience ask questions from any slide, not only from a Q&A slide."
			>
				<div className="flex flex-col gap-3">
					<Toggle
						label="Questions from the audience"
						description="Questions can be asked at any point during the presentation."
						checked={qaEnabled}
						onChange={onQAEnabledChange}
					/>
					<ChoiceCards
						ariaLabel="Who sees the submitted questions"
						columns={2}
						value={qaVisibility}
						onChange={onQAVisibilityChange}
						options={[
							{
								value: "presenter",
								label: "Only the presenter",
								description:
									"Questions arrive in your moderation panel. Participants see only what they asked themselves.",
								icon: <Settings size={18} />,
							},
							{
								value: "everyone",
								label: "Everyone",
								description:
									"The whole room reads the list and upvotes it, which is what orders your queue.",
								icon: <MessageCircleQuestion size={18} />,
							},
						]}
					/>
				</div>
			</Section>

			{/* The two participant channels (REQ077/REQ078) — deck-level for the same
			    reason the Q&A layer is: neither belongs to a slide, and a reaction
			    sent from slide 4 or a line typed during it belongs to the
			    presentation.

			    A separate Section from Q&A on purpose. All three are things the room
			    sends that are not answers, but they are three different channels with
			    three different fates — a question goes into a queue somebody works
			    through, a chat message goes into a transcript, and a reaction goes
			    nowhere at all — and one combined block would invite reading them as
			    settings of a single feature.

			    Both start closed, and the presenter can open either live from the
			    audience panel during a session; this is where the deck starts out. */}
			<Section
				title="Audience channels"
				description="What the room can send besides answers to your questions."
			>
				<div className="flex flex-col gap-3">
					<Toggle
						label="Reactions"
						description="Participants can react to any slide, whatever its type. Reactions are shown live and never stored — counted in no tally, and in no export."
						checked={reactionsEnabled}
						onChange={onReactionsEnabledChange}
					/>
					<Toggle
						label="Live chat"
						description="A channel the room talks in during the session, separate from the Q&A queue and from slide answers. Messages are kept with the session and cleared when you reset it."
						checked={chatEnabled}
						onChange={onChatEnabledChange}
					/>
				</div>
			</Section>

			{/* Participant names (REQ076) — deck-level, and its own Section rather
			    than a fourth switch under "Audience channels": the three above decide
			    what the room may *send*, and this decides what the deck *asks for*
			    before anybody sends anything. It is also the only switch on this page
			    that turns personal data on, which is worth its own heading rather
			    than a line in a list about reactions.

			    Off on every fresh deck, here as everywhere else. */}
			<Section
				title="Participants"
				description="Whether the people joining this deck say who they are."
			>
				<Toggle
					label="Ask for a name on joining"
					description="Everyone joining states a name before their first slide. The name is stored with their answers, listed on your participants panel while you present, and carried into both exports. Names are cleared when you reset the session, and a deck that never asks collects none."
					checked={requireParticipantName}
					onChange={onRequireParticipantNameChange}
				/>
			</Section>
		</div>
	);
}
