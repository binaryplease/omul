import {
	BarChart3,
	Cloud,
	Coins,
	FormInput,
	Grid2x2,
	Image,
	Info,
	ListOrdered,
	MapPin,
	MessageSquare,
	Presentation,
	SlidersHorizontal,
	Target,
	Timer,
	Trophy,
	Type,
	Video,
	Zap,
} from "lucide-react";
import type { SlideType } from "../types";

// ── Slide type icon with label ────────────────────────────────

/**
 * Each slide type's name in English — the default. The presenter screen passes
 * its own (REQ248): the rail's in the interface language, the slide's in the
 * deck's, because the room reads that one off the projector.
 */
export const SLIDE_TYPE_LABELS_EN: Record<SlideType, string> = {
	"multiple-choice": "Multiple Choice",
	"word-cloud": "Word Cloud",
	"open-text": "Q&A",
	scale: "Scale",
	ranking: "Ranking",
	grid: "2x2 Grid",
	points: "100 Points",
	"guess-number": "Guess the Number",
	"pin-image": "Pin on Image",
	quiz: "Quiz",
	form: "Form",
	leaderboard: "Leaderboard",
	text: "Text",
	image: "Image",
	video: "Video",
	embed: "Embedded deck",
	instruction: "How to join",
	countdown: "Countdown",
};

export function SlideTypeIcon({
	type,
	large,
	labels = SLIDE_TYPE_LABELS_EN,
}: {
	type: SlideType;
	large?: boolean;
	labels?: Record<SlideType, string>;
}) {
	const size = large ? 28 : 14;
	const icons: Record<SlideType, React.ReactNode> = {
		"multiple-choice": <BarChart3 size={size} />,
		"word-cloud": <Cloud size={size} />,
		"open-text": <MessageSquare size={size} />,
		scale: <SlidersHorizontal size={size} />,
		ranking: <ListOrdered size={size} />,
		grid: <Grid2x2 size={size} />,
		points: <Coins size={size} />,
		"guess-number": <Target size={size} />,
		"pin-image": <MapPin size={size} />,
		quiz: <Zap size={size} />,
		form: <FormInput size={size} />,
		leaderboard: <Trophy size={size} />,
		text: <Type size={size} />,
		image: <Image size={size} />,
		video: <Video size={size} />,
		embed: <Presentation size={size} />,
		instruction: <Info size={size} />,
		countdown: <Timer size={size} />,
	};
	return (
		<span
			className={`inline-flex items-center gap-1.5 text-accent ${large ? "text-lg" : "text-xs"}`}
			title={labels[type]}
		>
			{icons[type]}
			{large && (
				<span className="font-medium text-sm text-text-muted">
					{labels[type]}
				</span>
			)}
		</span>
	);
}
