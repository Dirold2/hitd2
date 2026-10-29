import assert from "node:assert/strict";
import { sortTracksByScore } from "../src/core/scoring.js";
import type { TrackMeta } from "../src/models/track.js";

function track(id: string, artist: string, title: string): TrackMeta {
  return {
    id,
    artist,
    title,
    duration: 240,
    uri: `hitmos:track:${id}`,
    name: title,
    duration_ms: 240_000,
    explicit: false,
  };
}

const candidates = [
  track("exact", "Скриптонит", "Точно не нужно новых"),
  track("live", "Скриптонит", "Точно не нужно новых (Live)"),
  track("artist-only", "Скриптонит", "Проблемы"),
  track("unrelated", "Другой артист", "Совсем другая песня"),
];

assert.deepEqual(
  sortTracksByScore("Скриптонит - Точно не нужно новых", candidates).map(
    (candidate) => candidate.id,
  ),
  ["exact", "live"],
  "artist-title queries must require matches for both the artist and the complete title",
);

assert.deepEqual(
  sortTracksByScore("Скриптонит", candidates).map((candidate) => candidate.id),
  ["exact", "artist-only", "live"],
  "plain queries must exclude candidates that contain no query terms",
);

console.log("Search scoring tests passed");
