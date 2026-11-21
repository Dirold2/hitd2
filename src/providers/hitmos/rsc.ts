import type { HtmlElement } from "../../core/html.js";
import { isDomainHost } from "../../core/hosts.js";
import type { RscTrack } from "./types.js";

/**
 * Extracts decoded Next.js Flight payloads from Hitmos HTML.
 *
 * The payload is a JavaScript string literal passed to:
 * self.__next_f.push([1, "..."])
 *
 * Keep the single-quote support: existing provider fixtures and some
 * generated pages use both quote styles.
 */
export function extractRscPayloads(html: string): string[] {
  const payloads: string[] = [];
  const scriptRegex =
    /<script[^>]*>\s*self\.__next_f\.push\(\s*\[\s*1\s*,\s*(["'])((?:\\.|(?!\1)[\s\S])*)\1\s*,?\s*\]\s*\)/g;

  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const rawPayload = match[2]!;

    try {
      JSON.parse(rawPayload);
      payloads.push(rawPayload);
    } catch {
      try {
        payloads.push(JSON.parse(`"${rawPayload}"`));
      } catch {
        // Last-resort decoding for malformed or non-standard escapes.
        payloads.push(
          rawPayload
            .replace(/\\u003c/g, "<")
            .replace(/\\u003e/g, ">")
            .replace(/\\u0026/g, "&")
            .replace(/\\(["\\/bfnrt])/g, "$1")
            .replace(/\\"/g, '"'),
        );
      }
    }
  }

  return payloads;
}

function extractJsonArray(source: string, start: number): string | null {
  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = start; index < source.length; index++) {
    const character = source[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function isRscTrack(value: unknown): value is RscTrack {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const track = value as Record<string, unknown>;

  return (
    typeof track.id === "number" &&
    typeof track.artist === "string" &&
    typeof track.title === "string" &&
    typeof track.duration === "number" &&
    Number.isFinite(track.duration)
  );
}

/**
 * Reads track arrays stored under RSC "list" or "tracks" keys.
 * Multiple arrays may be present on the same page (artist, similar tracks,
 * queue, etc.); callers must scope them to linked/visible IDs when needed.
 */
export function parseRscTrackList(html: string): RscTrack[] | null {
  const results: RscTrack[] = [];
  const trackArrayRegex = /"(?:list|tracks)"\s*:\s*\[/g;

  for (const payload of extractRscPayloads(html)) {
    trackArrayRegex.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = trackArrayRegex.exec(payload)) !== null) {
      const arrayStart = match.index + match[0].length - 1;
      const rawList = extractJsonArray(payload, arrayStart);

      if (!rawList) continue;

      try {
        const parsed: unknown = JSON.parse(rawList);

        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isRscTrack)) {
          results.push(...parsed);
        }
      } catch {
        // Ignore this malformed array and continue with other RSC arrays.
      }
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Returns IDs of song links present in the parsed page.
 * Relative links are resolved against the actual page host. Absolute links
 * are accepted only from that same host or another Hitmos subdomain.
 */
export function getLinkedTrackIds(root: HtmlElement, host: string): Set<string> {
  const ids = new Set<string>();
  let baseUrl: URL;

  try {
    baseUrl = new URL(`https://${host}`);
  } catch {
    return ids;
  }

  for (const element of root.querySelectorAll("a[href]")) {
    const href = element.getAttribute("href");
    if (!href) continue;

    try {
      const url = new URL(href, baseUrl);
      const sameHost = url.hostname === baseUrl.hostname;
      const sameHitmosNetwork =
        isDomainHost(baseUrl.hostname, "hitmos.fm") && isDomainHost(url.hostname, "hitmos.fm");

      if (!sameHost && !sameHitmosNetwork) continue;

      const id = url.pathname.match(/^\/song\/([^/]+)\/?$/)?.[1];
      if (id) ids.add(id);
    } catch {
      // Ignore malformed links.
    }
  }

  return ids;
}

/**
 * If the page has song links, discard RSC records not represented by those
 * links. When it has no song links (e.g. a changed markup variant), retain
 * the RSC result rather than returning an empty search result.
 */
export function filterRscTracksByLinkedIds(
  tracks: readonly RscTrack[],
  linkedIds: ReadonlySet<string>,
): RscTrack[] {
  if (linkedIds.size === 0) return [...tracks];

  return tracks.filter((track) => linkedIds.has(String(track.id)));
}

/** Keeps the first occurrence of each provider track ID. */
export function deduplicateRscTracks(tracks: readonly RscTrack[]): RscTrack[] {
  const unique = new Map<string, RscTrack>();

  for (const track of tracks) {
    const id = String(track.id);
    if (!unique.has(id)) unique.set(id, track);
  }

  return [...unique.values()];
}
