import { POLL_COLORS } from "../constants";
import type { DeckThemeSettings, Slide } from "../types";
import {
	acceptedQuizAnswers,
	correctGuessRangeFor,
	gridAxesFor,
	guessBucketsFor,
	guessRangeFor,
	guessReferenceFor,
	isContentSlideType,
	leaderboardSizeFor,
	pinAreaFor,
	pinImageFor,
	POINTS_BUDGET,
	quizAnswerModeFor,
	slideMediaIsInteractionArea,
} from "../types";
import { ContentSlideView } from "./ContentSlideView";
import { GridPlot } from "./GridPlot";
import { GuessDistribution } from "./GuessDistribution";
import {
	LEADERBOARD_LABELS_EN,
	Leaderboard,
	readLeaderboard,
} from "./Leaderboard";
import { PinCanvas } from "./PinImage";
import { ResultsDisplay } from "./Results";
import { sampleTallyFor, sampleTallyNote } from "./SampleTally";
import { SlideAppearanceScope, slidePlacementClasses } from "./SlideAppearance";
import { SlideBackground } from "./SlideBackground";
import {
	isChoiceShapedSlide,
	type SlideCanvasEditing,
	SlideOptionList,
	SlideQuestion,
} from "./SlideCanvasFields";
import { SlideTypeIcon } from "./SlideTypeIcon";

// ── Slide preview panel (the editor's stage, framed by SlideCanvas) ──
//
// Handed the editor's layer (REQ153) the same rendering becomes the surface the
// slide is authored on: the heading and the option cards grow fields, and every
// other thing drawn here stays exactly what the room will get. One rendering
// path with an editing layer over it, rather than a second renderer beside it —
// which is the whole reason REQ152 promoted this component instead of writing a
// canvas of its own (ADR-0026).
//
// The stage has two views (REQ154), and they are two views of one frame rather
// than two components: the same border, the same background, the same placement
// and the same theming scope, so flipping between the question and its results
// moves nothing on screen except what is being drawn inside it. The results view
// is the room's own renderer (`ResultsDisplay`) fed a stand-in tally — the
// editor cannot promise a chart the projector will not draw, because it draws
// through the projector's code.

/** Which of the stage's two views is on screen (REQ152 question / REQ154 results). */
export type SlideCanvasView = "question" | "results";

/**
 * What the room reads as this slide's heading when nothing is authored — real
 * text, because it is real text (REQ059's board title, and the placeholder every
 * other type shows in its place). One reading, so the question view and the
 * results view cannot title the same slide two ways.
 */
function slidePreviewHeading(slide: Slide): string {
	return slide.type === "leaderboard"
		? LEADERBOARD_LABELS_EN.title
		: "Untitled question";
}

export function SlidePreview({
	slide,
	index,
	deck = null,
	editing = null,
	view = "question",
	deckQuizCount = 0,
}: {
	slide: Slide;
	index: number;
	/**
	 * The deck this slide is previewed against (REQ087) — the layer its own
	 * appearance is laid over. `null` draws the built-in default, the way
	 * `DeckThemeScope` takes a null deck: a preview asked for before a deck is
	 * known is still a preview.
	 */
	deck?: DeckThemeSettings | null;
	/**
	 * The editor's authoring layer (REQ153) — present exactly when this rendering
	 * is the Create/Edit page's canvas, absent everywhere else.
	 */
	editing?: SlideCanvasEditing | null;
	/**
	 * Which view the stage is showing (REQ154). The results view is read-only by
	 * construction — it draws no field at all — so an author who flipped to it
	 * cannot type into a slide they are looking at a tally of.
	 */
	view?: SlideCanvasView;
	/**
	 * How many quiz questions the deck holds (REQ059) — the one fact a
	 * leaderboard's results need that its own slide does not carry.
	 */
	deckQuizCount?: number;
}) {
	const isContent = isContentSlideType(slide.type);
	// The slide's own placement (REQ087) — what an organizer is looking at while
	// they author it has to be the layout the room will get.
	const placement = slidePlacementClasses(slide);

	return (
		<SlideAppearanceScope deck={deck} slide={slide}>
			<div className="rounded-xl border border-border bg-surface overflow-hidden">
				{/* Mock slide display */}
				<div
					className={`relative bg-void p-6 min-h-[320px] flex flex-col justify-center ${placement.items} ${placement.text}`}
				>
					<SlideBackground slide={slide} />
					<div className={`relative z-10 flex w-full flex-col justify-center ${placement.items}`}>
						{view === "results" ? (
							<SlideSampleResults slide={slide} deckQuizCount={deckQuizCount} />
						) : isContent ? (
							<ContentSlideView
								slide={slide}
								compact
								joinCode="------"
								joinUrl={`${window.location.origin}/join/------`}
								editing={editing}
							/>
						) : (
							<>
								<SlideTypeIcon type={slide.type} large />
								{/* The heading with its markup resolved and at the author's own
								    step (REQ088/REQ089/REQ091), so what an organizer looks at
								    while they type is what the room will read — and, on the
								    canvas, the field they type it in (REQ153).
								    A leaderboard asks nothing, so an unset heading is not an
								    untitled *question*: it is the board's own default name,
								    which is what the slide will actually show (REQ059). */}
								<SlideQuestion
									slide={slide}
									className="text-lg font-bold mt-3 mb-1 px-2 break-words w-full max-w-full"
									fallback={slidePreviewHeading(slide)}
									editing={editing}
								/>
								<p className="text-xs text-text-dim mb-4">Slide {index + 1}</p>

								{/* Optional media thumbnail — not on a pin slide, whose picture is
								    the answer surface previewed below rather than an illustration
								    beside the question (REQ052). */}
								{slide.mediaUrl && !slideMediaIsInteractionArea(slide.type) && (
									<img
										src={slide.mediaUrl}
										alt={slide.mediaAlt ?? ""}
										className="mx-auto mb-3 max-h-24 rounded-md object-contain"
									/>
								)}

								{/* Pin on Image preview (REQ051–REQ053) — the picture as
								    participants will meet it, with the target area the author has
								    marked so far. Drawn by the same PinCanvas the participant taps
								    and the shared screen fills, so the preview cannot drift from
								    what either renders. No pins are seeded: every pin is a real
								    answer, and a mocked cloud would preview a room that has not
								    answered. */}
								{slide.type === "pin-image" && (
									<div className="w-full space-y-2 px-2">
										<PinCanvas
											image={pinImageFor(slide)}
											area={pinAreaFor(slide)}
											areaLabel={pinAreaFor(slide) ? "Correct area" : undefined}
											className="mx-auto max-w-[13rem]"
											emptyLabel="Add an image for participants to pin on"
										/>
										<p className="text-center text-xs text-text-dim">
											{pinAreaFor(slide)
												? "Participants tap a spot · correct area marked"
												: "Participants tap a spot"}
										</p>
									</div>
								)}

								{/* Typed quiz preview (REQ055) — the empty answer field the
								    participant will meet, with the answer key underneath so the
								    author can read back what they will accept. The key is
								    editor-only by construction: this surface never renders for
								    an audience. */}
								{slide.type === "quiz" &&
									quizAnswerModeFor(slide) === "type" &&
									(() => {
										const accepted = acceptedQuizAnswers(slide);
										return (
											<div className="w-full space-y-2 px-2">
												<div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-left text-sm text-text-dim italic">
													Type your answer...
												</div>
												<p className="text-xs text-text-dim">
													{accepted.length === 0
														? "No accepted answer yet"
														: `Accepted: ${accepted.join(" · ")}`}
												</p>
											</div>
										);
									})()}

								{/* MC / Quiz options (REQ012/REQ013/REQ014) — the cards the room
								    will meet, and on the canvas the rows they are authored in.
								    Both readings come out of one component, so an option can
								    never be typed into a card the audience gets a different
								    shape of (REQ153). */}
								{isChoiceShapedSlide(slide) && (
									<SlideOptionList slide={slide} editing={editing} />
								)}

								{/* Word cloud placeholder */}
								{slide.type === "word-cloud" && (
									<div className="flex flex-wrap items-center justify-center gap-2 px-2">
										{["idea", "creativity", "teamwork", "innovation"].map(
											(w, i) => (
												<span
													key={w}
													className="rounded-full px-3 py-1 text-sm font-medium"
													style={{
														background: POLL_COLORS[i % POLL_COLORS.length],
														opacity: 0.7 + (i % 3) * 0.1,
														fontSize: `${0.75 + (i % 3) * 0.15}rem`,
														color: "white",
													}}
												>
													{w}
												</span>
											),
										)}
									</div>
								)}

								{/* Open text placeholder */}
								{slide.type === "open-text" && (
									<div className="w-full space-y-2 px-2">
										{["Great session!", "Very informative"].map((t) => (
											<div
												key={t}
												className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-dim italic text-left"
											>
												{t}
											</div>
										))}
									</div>
								)}

								{/* Ranking preview (REQ033/REQ034) — the items in the order the
								    author entered them, which is the starting order participants
								    are shown before they rearrange it. */}
								{slide.type === "ranking" && (
									<div className="w-full space-y-2 px-2">
										{(slide.rankingItems ?? []).map((item, itemIndex) => (
											<div
												key={item.id}
												className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
											>
												<span className="w-4 shrink-0 text-center font-mono text-xs text-accent-text">
													{itemIndex + 1}
												</span>
												<span
													className={
														item.text ? "text-text" : "text-text-dim italic"
													}
												>
													{item.text || `Item ${itemIndex + 1}`}
												</span>
											</div>
										))}
									</div>
								)}

								{/* 100 Points preview (REQ044/REQ045) — the items with an empty
								    allocation each, and the budget the participant will have to
								    spend across them. Zero rather than an even pre-split: the
								    slide's whole point is that the participant does the
								    weighting, and a seeded split would preview an opinion. */}
								{slide.type === "points" && (
									<div className="w-full space-y-2 px-2">
										{(slide.pointsItems ?? []).map((item, itemIndex) => (
											<div
												key={item.id}
												className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm"
											>
												<span
													className={
														item.text
															? "flex-1 text-text"
															: "flex-1 text-text-dim italic"
													}
												>
													{item.text || `Item ${itemIndex + 1}`}
												</span>
												<span className="shrink-0 font-mono text-xs text-text-dim">
													0
												</span>
											</div>
										))}
										<p className="text-center text-xs text-text-dim">
											{POINTS_BUDGET} points to distribute
										</p>
									</div>
								)}

								{/* Guess the Number preview (REQ039–REQ043) — the empty
								    distribution over the frame the author has set so far, with
								    the reference line and its tolerance band once they name a
								    correct number. The histogram is drawn by the same component
								    the shared screen fills, so the picture an author previews is
								    the picture the audience will read. No columns are seeded:
								    every guess is the participant's, and a pre-filled shape would
								    preview a room that has not answered. */}
								{slide.type === "guess-number" &&
									(() => {
										const range = guessRangeFor(slide);
										const reference = guessReferenceFor(slide);
										return (
											<div className="w-full space-y-2 px-2">
												<GuessDistribution
													range={range}
													columns={guessBucketsFor(range).map((bucket) => ({
														...bucket,
														count: 0,
													}))}
													correctRange={correctGuessRangeFor(reference)}
													reference={reference ? reference.value : null}
												/>
												<p className="text-center text-xs text-text-dim">
													{`${range.min}–${range.max}`}
													{range.step > 1 ? ` in steps of ${range.step}` : ""}
													{reference ? ` · correct answer ${reference.value}` : ""}
												</p>
											</div>
										);
									})()}

								{/* Form preview (REQ061) — the fields as the author has written
								    them so far, drawn as the empty inputs a participant will meet.
								    Nothing is pre-filled: every answer is somebody's, and a seeded
								    one would preview a submission that has not happened. A field
								    with no label yet is shown as the placeholder it is, so the
								    author can see which row is still unfinished. */}
								{slide.type === "form" && (
									<div className="w-full space-y-2 px-2 text-left">
										{(slide.formFields ?? []).map((field, fieldIndex) => (
											<div key={field.id} className="space-y-1">
												<p className="text-xs">
													<span
														className={
															field.label ? "text-text" : "text-text-dim italic"
														}
													>
														{field.label || `Field ${fieldIndex + 1}`}
													</span>
													{field.required && (
														<span className="ml-1 text-accent-text">*</span>
													)}
												</p>
												{field.type === "choice" ? (
													<div className="flex flex-wrap gap-1">
														{(field.options ?? []).map((option, optionIndex) => (
															<span
																key={option.id}
																className={`rounded-md border border-border bg-surface-raised px-2 py-0.5 text-xs ${
																	option.text ? "text-text" : "text-text-dim italic"
																}`}
															>
																{option.text || `Option ${optionIndex + 1}`}
															</span>
														))}
													</div>
												) : (
													<div className="h-7 rounded-lg border border-border bg-surface-raised" />
												)}
											</div>
										))}
										<p className="text-center text-xs text-text-dim">
											Answers go to you only — the room sees how many replied.
										</p>
									</div>
								)}

								{/* Leaderboard preview (REQ059) — the empty board, drawn by the
								    same component the shared screen fills. No rows are seeded:
								    every row is a real participant's, and a mocked-up podium would
								    preview a competition that has not happened. */}
								{slide.type === "leaderboard" && (
									<div className="w-full space-y-2 px-2">
										<Leaderboard board={readLeaderboard(null)} compact />
										<p className="text-center text-xs text-text-dim">
											{`Top ${leaderboardSizeFor(slide)} across the deck's quiz questions`}
										</p>
									</div>
								)}

								{/* 2x2 Grid preview (REQ046/REQ048/REQ049) — the empty field as
								    the author has labelled it so far, with the items that will
								    be placed on it listed underneath. The field is drawn by the
								    same GridPlot the participant and the shared screen use, so
								    the preview cannot drift from what either of them renders. */}
								{slide.type === "grid" &&
									(() => {
										const { xAxis, yAxis } = gridAxesFor(slide);
										return (
											<div className="w-full space-y-2 px-2">
												<GridPlot
													xAxis={xAxis}
													yAxis={yAxis}
													marks={[]}
													className="mx-auto max-w-[13rem]"
												/>
												<div className="flex flex-wrap justify-center gap-1.5">
													{(slide.gridItems ?? []).map((item, itemIndex) => (
														<span
															key={item.id}
															className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-xs"
														>
															<span className="font-mono text-[10px] text-accent-text">
																{itemIndex + 1}
															</span>
															<span
																className={
																	item.text ? "text-text" : "text-text-dim italic"
																}
															>
																{item.text || `Item ${itemIndex + 1}`}
															</span>
														</span>
													))}
												</div>
											</div>
										);
									})()}

								{/* Scale preview */}
								{slide.type === "scale" && (
									<div className="w-full px-2">
										{(() => {
											const statements = slide.scaleStatements ?? [];
											const min = slide.scaleMin ?? 1;
											const max = slide.scaleMax ?? 5;
											const minLabel = slide.scaleMinLabel || String(min);
											const maxLabel = slide.scaleMaxLabel || String(max);

											// Multi-statement preview: show each statement as a thin row.
											if (statements.length > 0) {
												return (
													<div className="space-y-2">
														{statements.map((st) => (
															<div key={st.id} className="space-y-0.5">
																<p className="text-[10px] text-text-dim truncate text-left">
																	{st.text || "(empty statement)"}
																</p>
																<div className="h-1.5 rounded-full bg-surface-raised border border-border overflow-hidden">
																	<div className="h-full rounded-full bg-accent/40 w-1/2" />
																</div>
															</div>
														))}
														<div className="flex items-center justify-between text-[9px] text-text-dim pt-1">
															<span>{minLabel}</span>
															<span>{maxLabel}</span>
														</div>
													</div>
												);
											}

											// Single-statement (legacy preview).
											return (
												<>
													<div className="flex items-center justify-between text-xs text-text-muted mb-2">
														<span>{minLabel}</span>
														<span>{maxLabel}</span>
													</div>
													<div className="h-3 rounded-full bg-surface-raised border border-border overflow-hidden">
														<div className="h-full rounded-full bg-accent/40 w-3/5" />
													</div>
													<div className="flex justify-between mt-1">
														{Array.from(
															{
																length: max - min + 1,
															},
															(_, i) => {
																const val = min + i;
																return (
																	<span key={val} className="text-xs text-text-dim">
																		{val}
																	</span>
																);
															},
														)}
													</div>
												</>
											);
										})()}
									</div>
								)}
							</>
						)}
					</div>
				</div>

				{/* Footer info */}
				<div className="border-t border-border bg-surface/50 px-4 py-2 flex items-center justify-between">
					<span className="text-xs text-text-dim font-mono">#{index + 1}</span>
					<span className="text-xs text-text-muted capitalize">
						{slide.type.replace("-", " ")}
					</span>
				</div>
			</div>
		</SlideAppearanceScope>
	);
}

/**
 * The slide's results as the reveal will draw them (REQ154).
 *
 * Every mark on it comes out of the room's own code: `ResultsDisplay` picks the
 * visualization the author chose (REQ010), spells its values the way they asked
 * (REQ011), draws it from the chart colour the appearance layer resolved
 * (REQ019) and rings the correct answer exactly as the reveal rings it (REQ013).
 * What is stood in for is only the *room* — a deterministic tally seeded on the
 * slide's own id ({@link sampleTallyFor}), which is why the picture holds still
 * while an author compares two chart styles.
 *
 * The heading rides above it because a reveal does not drop the question — and
 * it is drawn read-only here even when the stage holds the editor's layer:
 * flipping to the results view is how an author *stops* typing and looks.
 *
 * What this view deliberately does not simulate is the reveal's *behaviour* —
 * when a tally appears, a countdown, a slide held back until a click. Those are
 * authored in the settings column (REQ155) and stay there; a canvas that acted
 * them out would be a second reading of a rule the server already owns.
 */
function SlideSampleResults({
	slide,
	deckQuizCount,
}: {
	slide: Slide;
	deckQuizCount: number;
}) {
	const tally = sampleTallyFor(slide, deckQuizCount);
	return (
		<div className="w-full space-y-4 px-2">
			<SlideQuestion
				slide={slide}
				className="text-lg font-bold break-words w-full max-w-full"
				fallback={slidePreviewHeading(slide)}
			/>
			{tally && <ResultsDisplay slide={slide} results={tally} />}
			<p className="text-center text-xs text-text-muted">
				{sampleTallyNote(slide)}
			</p>
		</div>
	);
}
