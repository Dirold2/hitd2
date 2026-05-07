import { TrackMeta } from "../models/track.js";
import { isBadTitle } from "./filters.js";
import { normalizeQuery } from "./normalize.js";

export function getTrackType(title: string): number {
  const t = normalizeQuery(title);

  if (!isBadTitle(t) && !t.includes("(")) return 0;

  if (t.includes("2017") || t.includes("album") || t.includes("original"))
    return 1;

  if (t.includes("version") || t.includes("версия")) return 2;

  if (/\(([^)]*)\)/.test(t)) return 3;

  return 4;
}

export function scoreSearchCandidate(
  title: string,
  artist: string,
  query: string,
): number {
  const q = normalizeQuery(query);
  const t = normalizeQuery(title);
  const a = normalizeQuery(artist);
  const haystack = `${a} ${t}`;

  let score = 0;

  const hardNoise = [
    /популярн(ое|ый)\s*вк/i,
    /\bvk\b/i,
    /tiktok/i,
    /instagram/i,
    /8d/i,
    /bass\s*boost/i,
    /nightcore/i,
    /slowed/i,
    /sped\s*up/i,
    /lyrics|текст/i,
    /radio edit/i,
  ];

  const badVariants = [
    /\b(минус|instrumental|karaoke|cover|remix|mix|rington|рингтон)\b/i,
    /\(([^)]*(минус|remix|cover|instrumental|8d)[^)]*)\)/i,
  ];

  if (hardNoise.some((r) => r.test(t))) score -= 60;
  if (badVariants.some((r) => r.test(t))) score -= 35;

  const qTokens = q.split(/\s+/).filter(Boolean);
  const hits = qTokens.filter((x) => haystack.includes(x)).length;

  score += hits * 10;

  if (t === q) score += 120;
  if (t.startsWith(q)) score += 70;
  if (t.includes(q)) score += 40;
  if (a.includes(q)) score += 25;

  const type = getTrackType(title);
  score += (4 - type) * 20;

  const baseTitle = t.replace(/\([^)]*\)/g, "").trim();
  if (baseTitle === q) score += 15;

  if (t.length < 40) score += 5;

  return score;
}

export function sortTracksByScore(
  query: string,
  tracks: TrackMeta[],
): TrackMeta[] {
  return tracks
    .map((track) => ({
      track,
      score: scoreSearchCandidate(track.title, track.artist, query),
    }))
    .filter(({ score, track }) => score >= 8 && !isBadTitle(track.title))
    .sort((a, b) => b.score - a.score || b.track.duration - a.track.duration)
    .map(({ track }) => track);
}
