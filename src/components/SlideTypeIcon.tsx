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
	Trophy,
	Type,
	Video,
	Zap,
} from "lucide-react";
import type { SlideType } from "../types";

// ── Slide type icon with label ────────────────────────────────

export function SlideTypeIcon({
	type,
	large,
}: {
	type: SlideType;
	large?: boolean;
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
	};
	const labels: Record<SlideType, string> = {
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
