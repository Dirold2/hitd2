import type { HTMLElement } from "node-html-parser";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
import { normalizeText } from "../core/normalize.js";

export class HitmosProvider implements SiteProvider {
  readonly name = "hitmos";

  readonly hosts = ["hitmos.fm", "rus.hitmos.fm", "www.hitmos.fm"];

  matches(host: string, html?: string): boolean {
    return host.includes("hitmos") || html?.includes("li.relative") === true;
  }

  parseSearch(root: HTMLElement): TrackMeta[] {
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

      const durationText =
        item.querySelector("span.shrink-0")?.textContent?.trim() || "";
      const duration = durationText.match(/(\d+):(\d+)/)
        ? parseInt(durationText.split(":")[0], 10) * 60 +
          parseInt(durationText.split(":")[1], 10)
        : 0;

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

  parseTrackPage(
    root: HTMLElement,
    _host: string,
    _trackId: string,
  ): Partial<TrackMeta> {
    const ogTitle =
      root
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content")
        ?.trim() || "";
    const parsed = ogTitle ? { title: ogTitle } : {};
    return parsed;
  }

  extractAudioUrl(
    _root: HTMLElement,
    html: string,
    _host: string,
    _trackId: string,
  ): string | null {
    const directMatch = html.match(/(https?:\/\/[^\s"'<>]+\.mp3[^\s"'<>]*)/);
    if (directMatch) return directMatch[1].replace(/\\/g, "").trim();

    const jsonMatch = html.match(/"url"\s*:\s*"([^"]+)"/);
    if (jsonMatch) return jsonMatch[1].replace(/\\/g, "").trim();

    const base64Match = html.match(/["'](\/L[a-zA-Z0-9_=]+\.mp3)["']/);
    if (base64Match)
      return `https://pl1.hitmos.fm${base64Match[1]}`.replace(/\\/g, "").trim();

    return null;
  }
}
