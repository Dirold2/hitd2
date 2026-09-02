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
  const scriptRegex = /<script[^>]*>self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs;
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
      return rscTracks.map((t) => ({
        id: String(t.id),
        title: normalizeText(t.title),
        artist: normalizeText(t.artist),
        duration: t.duration,
        uri: `hitmos:track:${t.id}`,
        name: normalizeText(t.title),
        duration_ms: t.duration * 1000,
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
    if (rscTracks && rscTracks.length > 0) {
      const match = rscTracks.find((t) => String(t.id) === trackId && t.play);
      if (match?.play) return match.play;
      if (rscTracks[0]?.play) return rscTracks[0].play;
    }

    const directMatch = html.match(/(https?:\/\/[^\s"'<>]+\.mp3[^\s"'<>]*)/);
    if (directMatch?.[1]) return directMatch[1].replace(/\\/g, "").trim();

    const jsonMatch = html.match(/"url"\s*:\s*"([^"]+)"/);
    if (jsonMatch?.[1]) return jsonMatch[1].replace(/\\/g, "").trim();

    const base64Match = html.match(/["'](\/L[a-zA-Z0-9_=]+\.mp3)["']/);
    if (base64Match) return `https://pl1.hitmos.fm${base64Match[1]}`.replace(/\\/g, "").trim();

    return null;
  }
}
