import type { TrackMeta } from "../models/track.js";
import { normalizeQuery } from "./normalize.js";
import { getArtistIdentityKey } from "./artists.js";

type RecordingCandidate = Pick<TrackMeta, "title" | "artist" | "duration">;

export const RECORDING_DURATION_TOLERANCE_SECONDS = 2;

/**
 * Generates an identity key for a recording.
 *
 * Version qualifiers in titles remain significant.
 * Artist order and collaboration separators do not.
 */
export function getRecordingKey(track: Pick<TrackMeta, "title" | "artist">): string | undefined {
  const title = normalizeQuery(track.title).normalize("NFC");
  const artists = getArtistIdentityKey(track.artist);

  if (!title || !artists) {
    return undefined;
  }

  return JSON.stringify([title, artists]);
}

/**
 * Checks whether two search candidates represent
 * the same recording.
 */
export function areSameRecording(first: RecordingCandidate, second: RecordingCandidate): boolean {
  const firstKey = getRecordingKey(first);

  if (!firstKey || firstKey !== getRecordingKey(second)) {
    return false;
  }

  if (
    !Number.isFinite(first.duration) ||
    !Number.isFinite(second.duration) ||
    first.duration <= 0 ||
    second.duration <= 0
  ) {
    return false;
  }

  return Math.abs(first.duration - second.duration) <= RECORDING_DURATION_TOLERANCE_SECONDS;
}
