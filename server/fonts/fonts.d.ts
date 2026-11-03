/**
 * A font file imported `with { type: "file" }` is its path (see
 * `server/deck-pdf.ts`): absolute under `bun test`, relative to the bundle once
 * `bun build` has copied it beside `dist/server/index.js`.
 */
declare module "*.ttf" {
	const path: string;
	export default path;
}
