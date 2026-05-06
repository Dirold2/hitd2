export * from "./types.js";

/**
 * Normalize Spotify track ID (remove spotify:track: prefix if present)
 */
export function normalizeTrackId(id: string): string {
  return id.replace(/^spotify:track:/, "");
}
