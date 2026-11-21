import type { TrackMeta } from "../models/track.js";
import { isBadTitle } from "./filters.js";
import { getArtistParticipants } from "./artists.js";

interface StructuredQuery {
  artist: string;
  title: string;
}

interface ArtistMatch {
  exactText: boolean;
  exactParticipants: boolean;
  sameOrder: boolean;
  extraParticipants: number;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function parseStructuredQuery(query: string): StructuredQuery | undefined {
  const match = query.normalize("NFKC").match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  if (!match) return undefined;

  const artist = match[1]!.trim();
  const title = normalize(match[2]!);

  return artist && title ? { artist, title } : undefined;
}

/**
 * Compares the requested and actual artist composition.
 *
 * Extra artists are allowed, but reduce the match quality.
 */
function getArtistMatch(artist: string, expected: string): ArtistMatch | undefined {
  const actual = getArtistParticipants(artist);
  const requested = getArtistParticipants(expected);

  if (actual.length === 0 || requested.length === 0) {
    return undefined;
  }

  const actualSet = new Set(actual);

  // Every requested participant must be present.
  if (!requested.every((participant) => actualSet.has(participant))) {
    return undefined;
  }

  const exactParticipants =
    actual.length === requested.length &&
    requested.every((participant) => actualSet.has(participant));

  const sameOrder =
    actual.length === requested.length &&
    actual.every((participant, index) => participant === requested[index]);

  return {
    exactText: normalize(artist) === normalize(expected),
    exactParticipants,
    sameOrder,
    extraParticipants: Math.max(0, actual.length - requested.length),
  };
}

function matchesArtist(artist: string, expected: string): boolean {
  return getArtistMatch(artist, expected) !== undefined;
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
  ) {
    return 1;
  }

  if (!isBadTitle(title) && !/[([]/u.test(title)) return 0;

  if (/[([]/u.test(title)) return 3;

  return 4;
}

/**
 * Calculates the relevance score of a search candidate.
 */
export function scoreSearchCandidate(title: string, artist: string, query: string): number {
  if (!matchesQueryIntent(title, artist, query) || !allowsBadTitle(title, query)) {
    return -1000;
  }

  const structured = parseStructuredQuery(query);
  const artistMatch = structured ? getArtistMatch(artist, structured.artist) : undefined;

  const q = structured?.title ?? normalize(query);
  const t = normalize(title);
  const a = normalize(artist);

  let score = tokenize(query).length * 10;

  // Title relevance.
  if (t === q) score += 120;

  // Preserve the original artist-only query behavior.
  if (!structured && a === q) score += 25;

  // Artist composition relevance.
  if (artistMatch) {
    if (artistMatch.exactText) {
      score += 90;
    } else if (artistMatch.exactParticipants) {
      score += 65;
    } else {
      score += Math.max(-20, 25 - artistMatch.extraParticipants * 35);
    }

    // Prefer the requested participant order.
    if (!artistMatch.sameOrder) {
      score -= 8;
    }
  }

  // Recording type.
  score += (4 - getTrackType(title)) * 20;

  // Prefer concise, clean titles.
  if (t.length < 40) score += 5;

  return score;
}

export function sortTracksByScore(query: string, tracks: TrackMeta[]): TrackMeta[] {
  return tracks
    .map((track, index) => ({
      track,
      index,
      score: scoreSearchCandidate(track.title, track.artist, query),
    }))
    .filter(({ score }) => score >= 8)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ track }) => track);
}
