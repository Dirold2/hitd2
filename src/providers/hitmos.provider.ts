import type { HtmlElement } from "../core/html.js";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
import { HITMOS_HOSTS, isDomainHost } from "../core/hosts.js";
import { normalizeText } from "../core/normalize.js";
import { extractImageUrl } from "./image.js";

interface RscTrack {
  id: number;
  artist: string;
  title: string;
  version?: string;
  duration: number;
  bitrate?: number;
  play?: string;
  download?: string;
}

function extractRscPayload(html: string): string[] {
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
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

function parseRscTrackList(html: string): RscTrack[] | null {
  const payloads = extractRscPayload(html);
  const results: RscTrack[] = [];

  for (const payload of payloads) {
    const trackArrayRegex = /"(?:list|tracks)"\s*:\s*\[/g;
    let match: RegExpExecArray | null;

    while ((match = trackArrayRegex.exec(payload)) !== null) {
      const arrayStart = match.index + match[0].length - 1;
      const rawList = extractJsonArray(payload, arrayStart);
      if (!rawList) continue;

      try {
        const tracks = JSON.parse(rawList) as RscTrack[];

        if (
          tracks.length > 0 &&
          tracks.every(
            (track) =>
              typeof track.id === "number" &&
              typeof track.artist === "string" &&
              typeof track.title === "string",
          )
        ) {
          results.push(...tracks);
        }
      } catch {
        continue;
      }
    }
  }

  return results.length ? results : null;
}

export class HitmosProvider implements SiteProvider {
  readonly name = "hitmos";

  readonly hosts = HITMOS_HOSTS;

  matches(host: string, html?: string): boolean {
    return (
      isDomainHost(host, "hitmos.fm") ||
      html?.includes("li.relative") === true ||
      html?.includes("__next_f.push") === true
    );
  }

  parseSearch(root: HtmlElement, host: string): TrackMeta[] {
    const rscTracks = parseRscTrackList(root.innerHTML);

    if (rscTracks && rscTracks.length > 0) {
      const linkedTrackIds = new Set(
        root
          .querySelectorAll('a[href^="/song/"]')
          .map((link) => link.getAttribute("href")?.match(/^\/song\/([a-zA-Z0-9_-]+)$/)?.[1])
          .filter((id): id is string => Boolean(id)),
      );

      const verifiedTracks =
        linkedTrackIds.size > 0
          ? rscTracks.filter((track) => linkedTrackIds.has(String(track.id)))
          : rscTracks;

      const imagesById = new Map<string, string>();

      for (const item of root.querySelectorAll("li.relative")) {
        const href = item.querySelector('a[href^="/song/"]')?.getAttribute("href");

        const id = href?.match(/^\/song\/([a-zA-Z0-9_-]+)$/)?.[1];
        if (!id) continue;

        const image = extractImageUrl(item, `https://${host}`);
        if (image) imagesById.set(id, image);
      }

      return verifiedTracks.map((track) => {
        const id = String(track.id);
        const image = imagesById.get(id);

        return {
          id,
          title: normalizeText(track.title),
          artist: normalizeText(track.artist),
          ...(image ? { image } : {}),
          duration: track.duration,
          uri: `hitmos:track:${id}`,
          name: normalizeText(track.title),
          duration_ms: track.duration * 1000,
          explicit: false,
        };
      });
    }

    return this.parseSearchLegacy(root);
  }

  private parseSearchLegacy(root: HtmlElement): TrackMeta[] {
    const results: TrackMeta[] = [];
    const items = root.querySelectorAll("li.relative");

    for (const item of items) {
      const songLink = item.querySelector('a[href^="/song/"]');
      const artistLink = item.querySelector('a[href^="/artist/"]');

      if (!songLink || !artistLink) continue;

      const href = songLink.getAttribute("href") || "";
      const id = href.match(/\/song\/([a-zA-Z0-9_-]+)/)?.[1];
      if (!id) continue;

      const title = normalizeText(songLink.textContent);
      const artist = normalizeText(artistLink.textContent);

      const durationText = item.querySelector("span.shrink-0")?.textContent?.trim() || "";
      const parts = durationText.split(":");
      const duration =
        parts.length === 2 ? parseInt(parts[0]!, 10) * 60 + parseInt(parts[1]!, 10) : 0;

      results.push({
        id,
        title,
        artist,
        duration,
        uri: `hitmos:track:${id}`,
        name: title,
        duration_ms: duration * 1000,
        explicit: false,
      });
    }

    return results;
  }

  parseTrackPage(root: HtmlElement, _host: string, trackId: string): Partial<TrackMeta> {
    const track = parseRscTrackList(root.innerHTML)?.find(
      (candidate) => String(candidate.id) === trackId,
    );
    if (track)
      return {
        title: normalizeText(track.title),
        artist: normalizeText(track.artist),
        duration: track.duration,
      };
    const ogTitle =
      root.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() || "";
    const parsed = ogTitle ? { title: ogTitle } : {};
    return parsed;
  }

  extractAudioUrl(_root: HtmlElement, html: string, _host: string, trackId: string): string | null {
    const rscTracks = parseRscTrackList(html);
    const urls = new Set(
      (rscTracks ?? [])
        .filter(
          (candidate) => String(candidate.id) === trackId && typeof candidate.play === "string",
        )
        .map((candidate) => candidate.play!.trim()),
    );
    return urls.size === 1 ? [...urls][0]! : null;
  }
}
