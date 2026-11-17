import { QrCode } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { DeckMark, DeckThemeScope } from "../components/DeckTheme";
import { LegalNotice } from "../components/LegalLinks";
import { AppMenu } from "../components/ui/AppMenu";
import { useDocumentLanguage, useInterfaceText } from "../interface-language";
import type { Route } from "../router";
import { usePageTitle } from "../router";

// ── Join Page ─────────────────────────────────────────────────
//
// In the interface language (REQ248): no deck, and so no deck language, is
// known until the code resolves. The participant screen it opens speaks the
// deck's.

export function JoinPage({ go }: { go: (r: Route) => void }) {
	const [code, setCode] = useState("");
	const [error, setError] = useState("");
	const [joining, setJoining] = useState(false);
	const [scanning, setScanning] = useState(false);
	const joinAttempted = useRef(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const { text, language } = useInterfaceText();
	const words = text.join;

	usePageTitle(words.pageTitle);
	useDocumentLanguage(language);

	const handleJoin = useCallback(
		async (joinCode?: string) => {
			const cleanCode = (joinCode ?? code).replace(/\s/g, "");
			if (cleanCode.length !== 6) {
				setError(words.codeIncomplete);
				return;
			}

			setJoining(true);
			setError("");
			try {
				await api.joinByCode(cleanCode);
				go({ page: "participate", code: cleanCode });
			} catch (joinError: unknown) {
				if (joinError instanceof ApiError && joinError.status === 404) {
					setError(words.codeNotFound);
				} else if (
					joinError instanceof ApiError &&
					joinError.refused === "sign-in-required"
				) {
					// The deck asks its room to sign in (REQ134): its own page is
					// where the way through that door is drawn.
					go({ page: "participate", code: cleanCode });
				} else {
					setError((joinError as Error).message);
				}
			} finally {
				setJoining(false);
			}
		},
		[code, go, words],
	);

	const stopScanning = useCallback(() => {
		if (scanIntervalRef.current) {
			clearInterval(scanIntervalRef.current);
			scanIntervalRef.current = null;
		}
		if (streamRef.current) {
			for (const t of streamRef.current.getTracks()) t.stop();
			streamRef.current = null;
		}
		setScanning(false);
	}, []);

	const startScanning = useCallback(async () => {
		setError("");

		// Check for BarcodeDetector support
		if (!("BarcodeDetector" in window)) {
			setError(words.scanUnsupported);
			return;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: "environment" },
			});
			streamRef.current = stream;
			setScanning(true);

			// Wait for video element to be available
			requestAnimationFrame(() => {
				if (videoRef.current) {
					videoRef.current.srcObject = stream;
					videoRef.current.play();
				}
			});

			// BarcodeDetector is not in TS lib
			const detector = new (window as any).BarcodeDetector({
				formats: ["qr_code"],
			});

			// Poll for QR codes from video frames
			scanIntervalRef.current = setInterval(async () => {
				if (!videoRef.current || videoRef.current.readyState < 2) return;
				try {
					const barcodes = await detector.detect(videoRef.current);
					for (const barcode of barcodes) {
						const value: string = barcode.rawValue;
						// Try to extract a 6-digit code from the URL or raw value
						const codeMatch =
							value.match(/\/join\/(\d{6})/) || value.match(/^(\d{6})$/);
						if (codeMatch) {
							stopScanning();
							setCode(codeMatch[1]);
							handleJoin(codeMatch[1]);
							return;
						}
					}
				} catch {
					// detection failed for this frame, continue
				}
			}, 250);
		} catch (e: unknown) {
			const err = e as { name?: string; message?: string };
			if (err.name === "NotAllowedError") {
				setError(words.cameraDenied);
			} else {
				setError(words.cameraFailed);
			}
			setScanning(false);
		}
	}, [handleJoin, stopScanning, words]);

	// Cleanup camera on unmount
	useEffect(() => {
		return () => {
			if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
			if (streamRef.current) {
				for (const t of streamRef.current.getTracks()) t.stop();
			}
		};
	}, []);

	const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = e.target.value.replace(/\D/g, "").slice(0, 6);
		setCode(val);
		setError("");

		// Auto-submit when 6 digits entered
		if (val.length === 6 && !joinAttempted.current) {
			joinAttempted.current = true;
			// Small delay so the user sees the full code before submitting
			setTimeout(() => {
				handleJoin(val);
				joinAttempted.current = false;
			}, 300);
		}
	};

	// REQ079 — the door to a deck, drawn through the same theme scope every other
	// surface uses. There is deliberately no deck here: a code still being typed
	// names no presentation yet, so this screen wears the built-in default rather
	// than reaching for a second code path to say "unthemed".
	const themed = (screen: React.ReactNode) => (
		<DeckThemeScope deck={null}>{screen}</DeckThemeScope>
	);

	return themed(
		<div className="participant-view bg-void bg-noise">
			<div className="absolute top-4 right-4 z-20">
				<AppMenu />
			</div>
			<div className="relative z-10 flex flex-col items-center w-full max-w-md px-4">
				<DeckMark deck={null} className="mb-6" />
				<h1 className="text-3xl font-bold mb-2 text-center">
					{words.heading}
				</h1>
				<p className="text-text-muted mb-8 text-center">
					{scanning ? words.pointCamera : words.enterCode}
				</p>

				{error && (
					<div className="w-full mb-4 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm text-center">
						{error}
					</div>
				)}

				{scanning ? (
					/* QR Scanner view */
					<div className="w-full flex flex-col items-center gap-4 mb-6">
						<div className="relative w-full aspect-square max-w-[280px] rounded-2xl overflow-hidden border-2 border-accent/50 bg-black">
							<video
								ref={videoRef}
								className="w-full h-full object-cover"
								playsInline
								muted
							/>
							{/* Scanning overlay corners */}
							<div className="absolute inset-4 pointer-events-none">
								<div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-accent rounded-tl-lg" />
								<div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-accent rounded-tr-lg" />
								<div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-accent rounded-bl-lg" />
								<div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-accent rounded-br-lg" />
							</div>
							{/* Scanning line animation */}
							<div
								className="absolute inset-x-4 top-4 h-0.5 bg-accent/60 animate-pulse"
								style={{
									animation: "scan-line 2s ease-in-out infinite",
								}}
							/>
						</div>
						<button
							type="button"
							className="btn-secondary text-sm"
							onClick={stopScanning}
						>
							{words.cancelScan}
						</button>
					</div>
				) : (
					/* Code input view */
					<>
						<input
							className="join-code-input mb-6"
							placeholder="------"
							aria-label={words.codeInput}
							value={code}
							onChange={handleCodeChange}
							onKeyDown={(e) => e.key === "Enter" && handleJoin()}
							maxLength={6}
							inputMode="numeric"
							// intentional — first input on page
							autoFocus
						/>

						{/* Progress dots */}
						<div className="flex gap-2 mb-6">
							{[0, 1, 2, 3, 4, 5].map((i) => (
								<div
									key={i}
									className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
										i < code.length ? "bg-accent scale-110" : "bg-surface-hover"
									}`}
								/>
							))}
						</div>

						<button
							type="button"
							className="btn-primary text-lg px-12 py-3 w-full max-w-xs"
							onClick={() => handleJoin()}
							disabled={joining || code.length !== 6}
						>
							{joining ? words.joining : words.join}
						</button>

						{/* Divider */}
						<div className="flex items-center gap-3 w-full max-w-xs my-5">
							<div className="flex-1 h-px bg-border" />
							<span className="text-xs text-text-dim uppercase tracking-wider">
								{words.or}
							</span>
							<div className="flex-1 h-px bg-border" />
						</div>

						{/* Scan QR button */}
						<button
							type="button"
							className="btn-secondary flex items-center gap-2 text-sm w-full max-w-xs justify-center"
							onClick={startScanning}
						>
							<QrCode size={16} />
							{words.scanQr}
						</button>
					</>
				)}

				{/* Joining a room concludes a contract, so the terms and the privacy
				    policy are named before the code is submitted (REQ183) — below
				    both ways in, typed and scanned, since either one joins. In the
				    interface language like the rest of this screen. */}
				<LegalNotice
					action={text.legalNotice.joining}
					wording={text.legalNotice}
					className="mt-6 max-w-xs text-center"
				/>

				<button
					type="button"
					className="mt-6 text-sm text-text-muted hover:text-text transition-colors"
					onClick={() => go({ page: "home" })}
				>
					{words.backHome}
				</button>
			</div>
		</div>,
	);
}
