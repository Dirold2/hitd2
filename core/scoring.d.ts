import type { TrackMeta } from "../models/track.js";
export declare function getTrackType(title: string): number;
export declare function scoreSearchCandidate(title: string, artist: string, query: string): number;
export declare function sortTracksByScore(query: string, tracks: TrackMeta[]): TrackMeta[];
//# sourceMappingURL=scoring.d.ts.map