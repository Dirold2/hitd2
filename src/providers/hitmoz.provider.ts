import type { HtmlElement } from "../core/html.js";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
import { HITMOZ_HOSTS, isDomainHost } from "../core/hosts.js";
import { normalizeText } from "../core/normalize.js";
import { extractImageUrl, normalizeImageUrl } from "./image.js";

interface HitmozTrackData {
  artist?: string;
  img?: string;
  title?: string;
  url?: string;
}

function getTrackData(root: HtmlElement, trackId: string): HitmozTrackData | null {
  const records = root
    .querySelectorAll("[data-musid]")
    .filter((item) => item.getAttribute("data-musid") === `track-id-${trackId}`);
  const parsed: HitmozTrackData[] = [];
  for (const item of records) {
    try {
      const value: unknown = JSON.parse(item.getAttribute("data-musmeta") ?? "null");
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const record = value as Record<string, unknown>;
      if (
        ["artist", "title", "img", "url"].some(
          (key) => record[key] !== undefined && typeof record[key] !== "string",
        )
      )
        return null;
      parsed.push(record as HitmozTrackData);
    } catch {
      return null;
    }
  }
  if (!parsed.length) return null;
  if (new Set(parsed.map((item) => item.url).filter(Boolean)).size > 1) return null;
  return parsed.find((item) => item.url) ?? parsed[0]!;
}

export class HitmozProvider implements SiteProvider {
  readonly name = "hitmoz";

  readonly hosts = HITMOZ_HOSTS;
  matches(host: string, html?: string): boolean {
    return isDomainHost(host, "hitmoz.org") || html?.includes("tracks__item") === true;
  }

  parseSearch(root: HtmlElement, host: string): TrackMeta[] {
    const results: TrackMeta[] = [];
    const items = root.querySelectorAll("li.tracks__item, .tracks__item, li.relative");

    for (const item of items) {
      const songLink =
        item.querySelector('a[href^="/song/"], a[href*="/song/"]') ||
        item.querySelector(".track__title a") ||
        item.querySelector(".track__title");

      if (!songLink) continue;

      const href = songLink.getAttribute("href") || "";
      let route: URL;
      try {
        route = new URL(href, `https://${host}`);
      } catch {
        continue;
      }
      if (route.origin !== `https://${host}` || route.search || route.hash) continue;
      const id = route.pathname.match(/^\/song\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
      if (!id) continue;
      const declaredId = item.getAttribute("data-id") || item.getAttribute("data-track-id");
      const musid = item.getAttribute("data-musid");
      if ((declaredId && declaredId !== id) || (musid && musid !== `track-id-${id}`)) continue;

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

      const rawMeta = item.getAttribute("data-musmeta");
      let image: string | undefined;

      if (rawMeta) {
        try {
          const metadata = JSON.parse(rawMeta) as HitmozTrackData;
          image = normalizeImageUrl(metadata.img, `https://${host}`);
        } catch {
          //
        }
      }

      image ??= extractImageUrl(item, `https://${host}`);

      results.push({
        id,
        title,
        artist,
        duration,
        uri: `hitmoz:track:${id}`,
        image,
        name: title,
        duration_ms: duration * 1000,
        explicit: false,
      });
    }

    return results;
  }

  parseTrackPage(root: HtmlElement, host: string, trackId: string): Partial<TrackMeta> {
    const trackData = getTrackData(root, trackId);
    if (!trackData) return {};
    return {
      title: normalizeText(trackData.title),
      artist: normalizeText(trackData.artist),
      image: normalizeImageUrl(trackData.img, `https://${host}`),
    };
  }

  extractAudioUrl(root: HtmlElement, _html: string, host: string, trackId: string): string | null {
    const rawUrl = getTrackData(root, trackId)?.url;
    if (!rawUrl) return null;

    const url = rawUrl.trim();

    try {
      return new URL(url, `https://${host}`).toString();
    } catch {
      return null;
    }
  }
}
