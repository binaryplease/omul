import qrcode from "qrcode-generator";
import { useEffect, useState } from "react";

// ── QR Code component ─────────────────────────────────────────
//
// Always renders dark modules on transparent background. Callers are expected
// to wrap the component in a white surface (`bg-white`) to maximize scanability
// and keep contrast high in both light and dark themes.

export function QRCodeDisplay({
	url,
	size = 200,
}: {
	url: string;
	size?: number;
}) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);

	useEffect(() => {
		try {
			const qr = qrcode(0, "M");
			qr.addData(url);
			qr.make();

			const moduleCount = qr.getModuleCount();
			const cellSize = Math.floor(size / (moduleCount + 2)); // +2 for quiet zone
			const realSize = cellSize * (moduleCount + 2);

			const canvas = document.createElement("canvas");
			canvas.width = realSize;
			canvas.height = realSize;
			const ctx = canvas.getContext("2d")!;

			// transparent background
			ctx.clearRect(0, 0, realSize, realSize);

			// Always use black modules — host always provides a white surface so
			// contrast stays high regardless of theme. Light-on-light was unreadable
			// in dark mode (welcome slide bug).
			ctx.fillStyle = "#000000";
			for (let row = 0; row < moduleCount; row++) {
				for (let col = 0; col < moduleCount; col++) {
					if (qr.isDark(row, col)) {
						ctx.fillRect(
							(col + 1) * cellSize,
							(row + 1) * cellSize,
							cellSize,
							cellSize,
						);
					}
				}
			}

			setDataUrl(canvas.toDataURL("image/png"));
		} catch (e) {
			console.error("QR generation failed:", e);
		}
	}, [url, size]);

	if (!dataUrl) return null;

	return (
		<img
			src={dataUrl}
			alt={`QR code to join at ${url}`}
			width={size}
			height={size}
			className="rounded-lg"
		/>
	);
}
