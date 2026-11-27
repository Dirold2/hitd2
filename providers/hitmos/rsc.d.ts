import type { HtmlElement } from "../../core/html.js";
import type { RscTrack } from "./types.js";
/**
 * Extracts decoded Next.js Flight payloads from Hitmos HTML.
 *
 * The payload is a JavaScript string literal passed to:
 * self.__next_f.push([1, "..."])
 *
 * Keep the single-quote support: existing provider fixtures and some
 * generated pages use both quote styles.
 */
export declare function extractRscPayloads(html: string): string[];
/**
 * Reads track arrays stored under RSC "list" or "tracks" keys.
 * Multiple arrays may be present on the same page (artist, similar tracks,
 * queue, etc.); callers must scope them to linked/visible IDs when needed.
 */
export declare function parseRscTrackList(html: string): RscTrack[] | null;
/**
 * Returns IDs of song links present in the parsed page.
 * Relative links are resolved against the actual page host. Absolute links
 * are accepted only from that same host or another Hitmos subdomain.
 */
export declare function getLinkedTrackIds(root: HtmlElement, host: string): Set<string>;
/**
 * If the page has song links, discard RSC records not represented by those
 * links. When it has no song links (e.g. a changed markup variant), retain
 * the RSC result rather than returning an empty search result.
 */
export declare function filterRscTracksByLinkedIds(tracks: readonly RscTrack[], linkedIds: ReadonlySet<string>): RscTrack[];
/** Keeps the first occurrence of each provider track ID. */
export declare function deduplicateRscTracks(tracks: readonly RscTrack[]): RscTrack[];
//# sourceMappingURL=rsc.d.ts.map