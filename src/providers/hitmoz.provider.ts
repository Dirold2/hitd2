import type { HTMLElement } from "node-html-parser";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
import { normalizeText } from "../core/normalize.js";

export class HitmozProvider implements SiteProvider {
  readonly name = "hitmoz";

  readonly hosts = ["rus.hitmoz.org", "hitmoz.org", "www.hitmoz.org"];

  matches(host: string, html?: string): boolean {
    return host.includes("hitmoz") || html?.includes("tracks__item") === true;
  }

  parseSearch(root: HTMLElement): TrackMeta[] {
    const results: TrackMeta[] = [];
    const items = root.querySelectorAll("li.tracks__item, .tracks__item, li.relative");

    for (const item of items) {
      const songLink =
        item.querySelector('a[href^="/song/"]') ||
        item.querySelector(".track__title a") ||
        item.querySelector(".track__title");

      if (!songLink) continue;

      const href = songLink.getAttribute?.("href") || "";
      const id =
        href.match(/\/song\/([a-zA-Z0-9_-]+)/)?.[1] ||
        item.getAttribute("data-id") ||
        item.getAttribute("data-track-id") ||
        "";

      if (!id) continue;

      const artistLink =
        item.querySelector('a[href^="/artist/"]') ||
        item.querySelector(".track__artist") ||
        item.querySelector(".artist");

      const title = normalizeText(songLink.textContent);
      const artist = normalizeText(artistLink?.textContent) || "Unknown";

      const durationText =
        item.querySelector(".track__time")?.textContent?.trim() ||
        item.querySelector(".duration")?.textContent?.trim() ||
        item.querySelector("time")?.textContent?.trim() ||
        "";

      const parts = durationText.split(":");
      const duration =
        parts.length === 2 ? parseInt(parts[0]!, 10) * 60 + parseInt(parts[1]!, 10) : 0;

      results.push({
        id,
        title,
        artist,
        duration,
        uri: `hitmoz:track:${id}`,
        name: title,
        duration_ms: duration * 1000,
        explicit: false,
      });
    }

    return results;
  }

  parseTrackPage(root: HTMLElement, _host: string, _trackId: string): Partial<TrackMeta> {
    const title =
      normalizeText(root.querySelector(".track__title, h1, .title")?.textContent) || "Unknown";
    const artist =
      normalizeText(
        root.querySelector(".track__artist, .artist, a[href^='/artist/']")?.textContent,
      ) || "Unknown";

    return { title, artist };
  }

  extractAudioUrl(
    _root: HTMLElement,
    html: string,
    _host: string,
    _trackId: string,
  ): string | null {
    const directMatch = html.match(/(https?:\/\/[^\s"'<>]+\.mp3[^\s"'<>]*)/);
    if (directMatch?.[1]) return directMatch[1].replace(/\\/g, "").trim();

    const jsonMatch = html.match(/"url"\s*:\s*"([^"]+)"/);
    if (jsonMatch?.[1]) return jsonMatch[1].replace(/\\/g, "").trim();

    const base64Match = html.match(/["'](\/L[a-zA-Z0-9_=]+\.mp3)["']/);
    if (base64Match?.[1]) return `https://pl1.hitmos.fm${base64Match[1]}`.replace(/\\/g, "").trim();

    return null;
  }
}
