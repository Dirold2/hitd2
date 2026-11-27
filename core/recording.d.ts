import type { TrackMeta } from "../models/track.js";
type RecordingCandidate = Pick<TrackMeta, "title" | "artist" | "duration">;
export declare const RECORDING_DURATION_TOLERANCE_SECONDS = 2;
/**
 * Generates an identity key for a recording.
 *
 * Version qualifiers in titles remain significant.
 * Artist order and collaboration separators do not.
 */
export declare function getRecordingKey(track: Pick<TrackMeta, "title" | "artist">): string | undefined;
/**
 * Checks whether two search candidates represent
 * the same recording.
 */
export declare function areSameRecording(first: RecordingCandidate, second: RecordingCandidate): boolean;
export {};
//# sourceMappingURL=recording.d.ts.map