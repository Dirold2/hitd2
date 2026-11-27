import type { SearchTrack } from "../models/search.js";
/**
 * Detects likely speed variants among different recordings
 * of the same composition.
 *
 * It only classifies a pair when:
 * - title and artist identity match;
 * - durations match a known speed factor;
 * - exactly one page has a release-like annotation.
 */
export declare function classifyRecordingVersions(tracks: SearchTrack[], pageTitles: ReadonlyMap<SearchTrack, string>): void;
/**
 * Prefer the original recording within a classified variant pair.
 * Other search result positions remain unchanged.
 */
export declare function prioritizeOriginalRecordings(tracks: SearchTrack[]): void;
/** Avoid fetching pages for unrelated duration differences. */
export declare function couldBeSpeedVariant(first: SearchTrack, second: SearchTrack): boolean;
//# sourceMappingURL=recording-version.d.ts.map