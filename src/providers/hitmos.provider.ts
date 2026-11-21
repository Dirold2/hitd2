import type { HtmlElement } from "../core/html.js";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
import { HITMOS_HOSTS, isDomainHost } from "../core/hosts.js";
import { normalizeText } from "../core/normalize.js";
import { extractImageUrl } from "./image.js";
import { isValidAudioUrl } from "../core/filters.js";
import {
  deduplicateRscTracks,
  filterRscTracksByLinkedIds,
  getLinkedTrackIds,
  parseRscTrackList,
} from "./hitmos/rsc.js";
import { parseHitmosStructuredData } from "./hitmos/structured-data.js";
import type { HitmosRecording, RscTrack } from "./hitmos/types.js";

function extractImageMap(root: HtmlElement, host: string): Map<string, string> {
  const images = new Map<string, string>();

  for (const item of root.querySelectorAll("li.relative")) {
    const href = item.querySelector('a[href^="/song/"]')?.getAttribute("href");

    const id = href?.match(/^\/song\/([^/]+)\/?$/)?.[1];
    if (!id || images.has(id)) continue;

    const image = extractImageUrl(item, `https://${host}`);
    if (image) images.set(id, image);
  }

  return images;
}

function parseClockDuration(value: string): number {
  const parts = value.trim().split(":");

  if (parts.length < 2 || parts.length > 3) return 0;

  const numbers = parts.map(Number);

  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    return 0;
  }

  return numbers.reduce((total, part) => total * 60 + part, 0);
}

function parseOpenGraphTitle(root: HtmlElement): string | undefined {
  const value = root.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim();

  return value ? normalizeText(value) || undefined : undefined;
}

/** Converts only URL-backed, explicitly identified album relationships. */
function getTrackAlbums(recording: HitmosRecording | undefined): TrackMeta["albums"] {
  const albums = new Map<string, NonNullable<TrackMeta["albums"]>[number]>();

  for (const album of recording?.albums ?? []) {
    const id = album.id?.trim();
    if (!id) continue;

    const reference = {
      id,
      uri: `hitmos:album:${id}`,
      ...(album.name ? { title: normalizeText(album.name) } : {}),
    };

    const previous = albums.get(reference.uri);
    albums.set(reference.uri, previous ? { ...previous, ...reference } : reference);
  }

  return albums.size > 0 ? [...albums.values()] : undefined;
}

function getTrackAudioUrls(tracks: readonly RscTrack[], trackId?: string): Set<string> {
  const urls = new Set<string>();

  for (const track of tracks) {
    if (trackId !== undefined && String(track.id) !== trackId) {
      continue;
    }

    if (typeof track.play !== "string") continue;

    const url = track.play.trim();
    if (url && isValidAudioUrl(url)) urls.add(url);
  }

  return urls;
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

    if (!rscTracks?.length) {
      return this.parseSearchLegacy(root);
    }

    const linkedIds = getLinkedTrackIds(root, host);
    const visibleTracks = filterRscTracksByLinkedIds(rscTracks, linkedIds);
    const uniqueTracks = deduplicateRscTracks(visibleTracks);
    const imagesById = extractImageMap(root, host);
    const structuredRecordings = parseHitmosStructuredData(root, host).recordings;

    return uniqueTracks.map((track): TrackMeta => {
      const id = String(track.id);
      const title = normalizeText(track.title);
      const version = normalizeText(track.version);
      const image = imagesById.get(id);
      const albums = getTrackAlbums(structuredRecordings.get(id));

      return {
        id,
        title,
        artist: normalizeText(track.artist),
        duration: track.duration,
        uri: `hitmos:track:${id}`,
        name: title,
        duration_ms: track.duration * 1000,
        explicit: false,
        ...(version ? { version } : {}),
        ...(image ? { image } : {}),
        ...(albums ? { albums } : {}),
      };
    });
  }

  extractSearchAudioUrls(
    root: HtmlElement,
    html: string,
    host: string,
  ): ReadonlyMap<string, string> {
    const tracks = parseRscTrackList(html);
    if (!tracks?.length) return new Map();

    const linkedIds = getLinkedTrackIds(root, host);
    const visibleTracks = filterRscTracksByLinkedIds(tracks, linkedIds);

    const urlsById = new Map<string, Set<string>>();

    for (const track of visibleTracks) {
      if (typeof track.play !== "string") continue;

      const url = track.play.trim();
      if (!url || !isValidAudioUrl(url)) continue;

      const id = String(track.id);
      let urls = urlsById.get(id);

      if (!urls) {
        urls = new Set<string>();
        urlsById.set(id, urls);
      }

      urls.add(url);
    }

    const result = new Map<string, string>();

    for (const [id, urls] of urlsById) {
      // Conflicting URLs for one ID are ambiguous; do not pick one.
      if (urls.size === 1) {
        result.set(id, urls.values().next().value!);
      }
    }

    return result;
  }

  parseTrackPage(root: HtmlElement, host: string, trackId: string): Partial<TrackMeta> {
    const rscTrack = parseRscTrackList(root.innerHTML)?.find(
      (candidate) => String(candidate.id) === trackId,
    );

    // Always inspect JSON-LD, even when RSC has the core track metadata:
    // album membership may be exposed only through inAlbum/MusicAlbum.track.
    const structured = parseHitmosStructuredData(root, host).recordings.get(trackId);
    const albums = getTrackAlbums(structured);

    const title = rscTrack
      ? normalizeText(rscTrack.title)
      : (structured?.title ?? parseOpenGraphTitle(root));
    const artist = rscTrack ? normalizeText(rscTrack.artist) : structured?.artist;
    const duration = rscTrack?.duration ?? structured?.duration;
    const version = normalizeText(rscTrack?.version);

    return {
      ...(title ? { title } : {}),
      ...(artist ? { artist } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(version ? { version } : {}),
      ...(albums ? { albums } : {}),
    };
  }

  extractAudioUrl(_root: HtmlElement, html: string, _host: string, trackId: string): string | null {
    const tracks = parseRscTrackList(html);
    if (!tracks?.length) return null;

    const urls = getTrackAudioUrls(tracks, trackId);

    return urls.size === 1 ? urls.values().next().value! : null;
  }

  private parseSearchLegacy(root: HtmlElement): TrackMeta[] {
    const results: TrackMeta[] = [];
    const seen = new Set<string>();

    for (const item of root.querySelectorAll("li.relative")) {
      const songLink = item.querySelector('a[href^="/song/"]');
      const artistLink = item.querySelector('a[href^="/artist/"]');

      if (!songLink || !artistLink) continue;

      const href = songLink.getAttribute("href") || "";
      const id = href.match(/^\/song\/([^/]+)\/?$/)?.[1];

      if (!id || seen.has(id)) continue;

      const title = normalizeText(songLink.textContent);
      const artist = normalizeText(artistLink.textContent);
      if (!title || !artist) continue;

      const durationText = item.querySelector("span.shrink-0")?.textContent?.trim() ?? "";
      const duration = parseClockDuration(durationText);

      seen.add(id);

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
}
