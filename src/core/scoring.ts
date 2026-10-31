import type { TrackMeta } from "../models/track.js";
import { isBadTitle } from "./filters.js";

interface StructuredQuery {
  artist: string;
  title: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function parseStructuredQuery(query: string): StructuredQuery | undefined {
  const match = query.normalize("NFKC").match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  if (!match) return undefined;

  const artist = normalize(match[1]!);
  const title = normalize(match[2]!);
  return artist && title ? { artist, title } : undefined;
}

function matchesArtist(artist: string, expected: string): boolean {
  if (normalize(artist) === expected) return true;

  // Only explicit collaboration separators introduce participant identities.
  return artist
    .normalize("NFKC")
    .split(/\s+(?:feat\.?|ft\.?|featuring|and)\s+|\s*&\s*/iu)
    .some((participant) => normalize(participant) === expected);
}

function containsAllTokens(value: string, expectedTokens: string[]): boolean {
  const tokens = new Set(tokenize(value));
  return expectedTokens.length > 0 && expectedTokens.every((token) => tokens.has(token));
}

function matchesQueryIntent(title: string, artist: string, query: string): boolean {
  const structured = parseStructuredQuery(query);
  if (structured) {
    return matchesArtist(artist, structured.artist) && normalize(title) === structured.title;
  }
  return containsAllTokens(`${artist} ${title}`, tokenize(query));
}

const variantTerms = [
  "live",
  "concert",
  "concert version",
  "лайв",
  "концерт",
  "концертная версия",
  "remix",
  "ремикс",
  "mix",
  "cover",
  "кавер",
  "instrumental",
  "инструментал",
  "karaoke",
  "караоке",
  "минус",
  "acoustic",
  "акустика",
  "акустическая",
  "version",
  "версия",
  "edit",
  "remaster",
  "remastered",
  "рингтон",
  "rington",
  "8d",
  "bass boost",
  "bass boosted",
  "nightcore",
  "slowed",
  "sped up",
  "lyrics",
  "текст",
  "vk",
  "tiktok",
  "instagram",
];

function variants(value: string): string[] {
  const normalized = ` ${normalize(value)} `;
  return variantTerms.filter((term) => normalized.includes(` ${term} `));
}

function allowsBadTitle(title: string, query: string): boolean {
  if (!isBadTitle(title.normalize("NFKC"))) return true;

  // Artist names must not implicitly authorize a remix/cover of the requested song.
  const requestedTitle = parseStructuredQuery(query)?.title ?? query;
  const requested = new Set(variants(requestedTitle));
  const actual = variants(title);
  return actual.length > 0 && actual.every((variant) => requested.has(variant));
}

export function getTrackType(title: string): number {
  const t = normalize(title);
  if (variants(title).length > 0) return 4;
  if (
    containsAllTokens(t, ["2017"]) ||
    containsAllTokens(t, ["album"]) ||
    containsAllTokens(t, ["original"])
  )
    return 1;
  if (!isBadTitle(title) && !/[([]/u.test(title)) return 0;
  if (/[([]/u.test(title)) return 3;
  return 4;
}

export function scoreSearchCandidate(title: string, artist: string, query: string): number {
  if (!matchesQueryIntent(title, artist, query) || !allowsBadTitle(title, query)) {
    return -1000;
  }

  const structured = parseStructuredQuery(query);
  const q = structured?.title ?? normalize(query);
  const t = normalize(title);
  const a = normalize(artist);
  let score = tokenize(query).length * 10;

  if (t === q) score += 120;
  if (a === q) score += 25;
  score += (4 - getTrackType(title)) * 20;
  if (t.length < 40) score += 5;

  return score;
}

export function sortTracksByScore(query: string, tracks: TrackMeta[]): TrackMeta[] {
  return tracks
    .map((track) => ({
      track,
      score: scoreSearchCandidate(track.title, track.artist, query),
    }))
    .filter(({ score }) => score >= 8)
    .sort((a, b) => b.score - a.score || b.track.duration - a.track.duration)
    .map(({ track }) => track);
}
