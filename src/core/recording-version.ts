import type { SearchTrack } from "../models/search.js";
import type { RecordingVersionDetection } from "../models/search.js";
import { normalizeQuery } from "./normalize.js";
import { getRecordingKey } from "./recording.js";

const SPEED_FACTORS = [0.95, 0.9, 0.85, 0.8] as const;
const SPEED_FACTOR_TOLERANCE = 0.008;

function getMatchedSpeedFactor(first: SearchTrack, second: SearchTrack): number | undefined {
  if (
    !Number.isFinite(first.duration) ||
    !Number.isFinite(second.duration) ||
    first.duration <= 0 ||
    second.duration <= 0
  ) {
    return undefined;
  }

  const ratio =
    Math.min(first.duration, second.duration) / Math.max(first.duration, second.duration);

  let bestFactor: number | undefined;
  let bestDelta = Infinity;

  for (const factor of SPEED_FACTORS) {
    const delta = Math.abs(ratio - factor);

    if (delta < bestDelta) {
      bestDelta = delta;
      bestFactor = factor;
    }
  }

  return bestDelta <= SPEED_FACTOR_TOLERANCE ? bestFactor : undefined;
}

/**
 * Extracts a release-like annotation from a detailed page title.
 *
 * Example:
 * "Порнозвезда (Кондитерская 2016)"
 * with search title "Порнозвезда"
 *
 * This is deliberately conservative: only parenthetical annotations
 * containing a year are accepted.
 */
function getReleaseAnnotation(pageTitle: string, searchTitle: string): string | undefined {
  const detail = normalizeQuery(pageTitle).normalize("NFC");
  const base = normalizeQuery(searchTitle).normalize("NFC");

  if (!detail.startsWith(base)) return undefined;

  const suffix = detail.slice(base.length).trim();
  const match = /^\(([^()]{2,80})\)$/u.exec(suffix);

  if (!match) return undefined;

  const annotation = match[1]!.trim();

  // These indicate recording variants, not release context.
  if (
    /\b(slow(?:ed)?|sped\s*up|remix|live|edit|acoustic|instrumental|karaoke|cover)\b/iu.test(
      annotation,
    ) ||
    /(замедлен|ремикс|лайв|акустик|инструментал)/iu.test(annotation)
  ) {
    return undefined;
  }

  if (!/(?:^|\s)(?:19|20)\d{2}(?:$|\s)/u.test(annotation)) {
    return undefined;
  }

  return annotation;
}

function detection(
  type: RecordingVersionDetection["type"],
  speedFactor: number,
  evidence: string[],
): RecordingVersionDetection {
  return {
    type,
    confidence: "medium",
    speedFactor,
    evidence,
  };
}

/**
 * Detects likely speed variants among different recordings
 * of the same composition.
 *
 * It only classifies a pair when:
 * - title and artist identity match;
 * - durations match a known speed factor;
 * - exactly one page has a release-like annotation.
 */
export function classifyRecordingVersions(
  tracks: SearchTrack[],
  pageTitles: ReadonlyMap<SearchTrack, string>,
): void {
  const groups = new Map<string, SearchTrack[]>();

  for (const track of tracks) {
    const key = getRecordingKey(track);
    if (!key) continue;

    const group = groups.get(key);

    if (group) {
      group.push(track);
    } else {
      groups.set(key, [track]);
    }
  }

  for (const group of groups.values()) {
    // Do not guess when there are multiple competing candidates.
    if (group.length !== 2) continue;

    const first = group[0]!;
    const second = group[1]!;

    const factor = getMatchedSpeedFactor(first, second);
    if (factor === undefined) continue;

    const firstAnnotation = pageTitles.has(first)
      ? getReleaseAnnotation(pageTitles.get(first)!, first.title)
      : undefined;

    const secondAnnotation = pageTitles.has(second)
      ? getReleaseAnnotation(pageTitles.get(second)!, second.title)
      : undefined;

    // Both or neither have release context: insufficient evidence.
    if (Boolean(firstAnnotation) === Boolean(secondAnnotation)) {
      continue;
    }

    const shorter = first.duration <= second.duration ? first : second;
    const longer = shorter === first ? second : first;

    const shorterAnnotation = shorter === first ? firstAnnotation : secondAnnotation;

    const longerAnnotation = shorter === first ? secondAnnotation : firstAnnotation;

    const durationRatio = shorter.duration / longer.duration;

    if (shorterAnnotation) {
      // The release-associated shorter recording is the baseline.
      shorter.recordingVersion = detection("original", 1, [
        `Release annotation: ${shorterAnnotation}`,
        `Duration-related sibling ratio: ${durationRatio.toFixed(4)}`,
      ]);

      longer.recordingVersion = detection("slow", factor, [
        `Sibling release annotation: ${shorterAnnotation}`,
        `Duration ratio: ${durationRatio.toFixed(4)}`,
        `Closest playback speed factor: ${factor.toFixed(2)}x`,
      ]);
    } else if (longerAnnotation) {
      // The release-associated longer recording is the baseline.
      longer.recordingVersion = detection("original", 1, [
        `Release annotation: ${longerAnnotation}`,
        `Duration-related sibling ratio: ${durationRatio.toFixed(4)}`,
      ]);

      shorter.recordingVersion = detection("sped_up", 1 / factor, [
        `Sibling release annotation: ${longerAnnotation}`,
        `Duration ratio: ${durationRatio.toFixed(4)}`,
        `Closest playback speed factor: ${(1 / factor).toFixed(2)}x`,
      ]);
    }
  }
}

/**
 * Prefer the original recording within a classified variant pair.
 * Other search result positions remain unchanged.
 */
export function prioritizeOriginalRecordings(tracks: SearchTrack[]): void {
  const positionsByKey = new Map<string, number[]>();

  for (let index = 0; index < tracks.length; index++) {
    const key = getRecordingKey(tracks[index]!);
    if (!key) continue;

    const positions = positionsByKey.get(key);

    if (positions) {
      positions.push(index);
    } else {
      positionsByKey.set(key, [index]);
    }
  }

  for (const positions of positionsByKey.values()) {
    if (positions.length !== 2) continue;

    const pair = positions.map((index) => tracks[index]!);

    const original = pair.find((track) => track.recordingVersion?.type === "original");

    const alternative = pair.find(
      (track) =>
        track.recordingVersion?.type === "slow" || track.recordingVersion?.type === "sped_up",
    );

    if (!original || !alternative) continue;

    tracks[positions[0]!] = original;
    tracks[positions[1]!] = alternative;
  }
}

/** Avoid fetching pages for unrelated duration differences. */
export function couldBeSpeedVariant(first: SearchTrack, second: SearchTrack): boolean {
  return getMatchedSpeedFactor(first, second) !== undefined;
}
