import type { HtmlElement } from "../core/html.js";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
import { normalizeText } from "../core/normalize.js";

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
    /<script[^>]*>\s*self\.__next_f\.push\(\s*\[\s*1\s*,\s*["'](.*?)["']\s*,?\s*\]\s*\)/gs;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    payloads.push(
      match[1]!
        .replace(/\\u003c/g, "<")
        .replace(/\\u003e/g, ">")
        .replace(/\\u0026/g, "&")
        .replace(/\\(["\\/bfnrt])/g, "$1")
        .replace(/\\"/g, '"'),
    );
  }

  return payloads;
}

function parseRscTrackList(html: string): RscTrack[] | null {
  const payloads = extractRscPayload(html);

  for (const payload of payloads) {
    const listMatch = payload.match(/"list":(\[.*?\]),\s*"footer"/);
    if (listMatch) {
      try {
        const tracks: RscTrack[] = JSON.parse(listMatch[1]!);
        return tracks;
      } catch {
        continue;
      }
    }
  }

  return null;
}

export class HitmosProvider implements SiteProvider {
  readonly name = "hitmos";

  readonly hosts = ["hitmos.fm", "rus.hitmos.fm", "www.hitmos.fm"];

  matches(host: string, html?: string): boolean {
    return (
      host.includes("hitmos") ||
      html?.includes("li.relative") === true ||
      html?.includes("__next_f.push") === true
    );
  }

  parseSearch(root: HtmlElement): TrackMeta[] {
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

      return verifiedTracks.map((track) => ({
        id: String(track.id),
        title: normalizeText(track.title),
        artist: normalizeText(track.artist),
        duration: track.duration,
        uri: `hitmos:track:${track.id}`,
        name: normalizeText(track.title),
        duration_ms: track.duration * 1000,
        explicit: false,
      }));
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

  parseTrackPage(root: HtmlElement, _host: string, _trackId: string): Partial<TrackMeta> {
    const ogTitle =
      root.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() || "";
    const parsed = ogTitle ? { title: ogTitle } : {};
    return parsed;
  }

  extractAudioUrl(_root: HtmlElement, html: string, _host: string, trackId: string): string | null {
    const rscTracks = parseRscTrackList(html);
    const track = rscTracks?.find((candidate) => String(candidate.id) === trackId);

    return track?.play?.replace(/\\/g, "").trim() || null;
  }
}
