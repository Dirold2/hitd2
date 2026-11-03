import { HITMONET_HOSTS, providerForHost } from "../core/hosts.js";
import type { HtmlElement } from "../core/html.js";
import type { Album, AlbumTrack } from "../models/album.js";
import type { TrackMeta } from "../models/track.js";
import type { SiteProvider } from "./base.js";
import { normalizeText } from "../core/normalize.js";

type RecordValue = Record<string, unknown>;

function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Decode only JSON string arguments; never execute the embedded JavaScript.
function componentProps(html: string): RecordValue[] {
  let stream = "";
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    for (const push of script[1]!.matchAll(
      /self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:\\.|[^"\\])*")\s*\]\s*\)/g,
    )) {
      try {
        stream += JSON.parse(push[1]!);
      } catch {
        return [];
      }
    }
  }

  const props: RecordValue[] = [];
  function visit(value: unknown): void {
    if (!Array.isArray(value)) return;
    if (value.length === 4 && value[0] === "$" && object(value[3])) {
      props.push(value[3]);
      // Do not descend into item/list/source: their contents are not page components.
      visit(value[3].children);
    } else {
      for (const child of value) visit(child);
    }
  }

  // Flight T records have a UTF-8 byte length, not a newline terminator. Lyrics
  // can contain both newlines and strings resembling component records.
  const bytes = new TextEncoder().encode(stream);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset < bytes.length) {
    const colon = bytes.indexOf(58, offset);
    if (colon < 0 || !/^[\da-f]*$/.test(decoder.decode(bytes.subarray(offset, colon)))) break;
    offset = colon + 1;
    if (bytes[offset] === 84) {
      const comma = bytes.indexOf(44, offset);
      if (comma < 0) break;
      const length = decoder.decode(bytes.subarray(offset + 1, comma));
      if (!/^[\da-f]+$/.test(length)) break;
      offset = comma + 1 + parseInt(length, 16);
      continue;
    }
    const newline = bytes.indexOf(10, offset);
    const end = newline < 0 ? bytes.length : newline;
    try {
      visit(JSON.parse(decoder.decode(bytes.subarray(offset, end))));
    } catch {
      // Import, hint, error and other non-JSON Flight records are not data.
    }
    offset = end + 1;
  }
  return props;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonnegativeInteger(value) && value > 0;
}

function track(value: unknown): TrackMeta | null {
  if (!object(value)) return null;
  if (
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    typeof value.artist !== "string" ||
    !normalizeText(value.artist) ||
    typeof value.title !== "string" ||
    !normalizeText(value.title) ||
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration < 0
  )
    return null;
  const id = String(value.id);
  const title = normalizeText(value.title);
  const image = object(value.imageInfo) ? httpUrl(value.imageInfo.imageUrl) : undefined;
  return {
    id,
    title,
    artist: normalizeText(value.artist),
    duration: value.duration,
    uri: `hitmonet:track:${id}`,
    name: title,
    duration_ms: value.duration * 1000,
    explicit: false,
    ...(image ? { image } : {}),
  };
}

function selected(html: string, id: string): { meta: TrackMeta; audio?: string } | null {
  if (!/^[1-9]\d*$/.test(id)) return null;
  let result: { meta: TrackMeta; audio?: string } | null = null;
  for (const props of componentProps(html)) {
    const item = props.item;
    // Album/collection cards also use item, but are not track components.
    if (!object(item) || !("duration" in item || "play" in item)) continue;
    const meta = track(item);
    if (!meta || meta.id !== id) return null;
    const audio = httpUrl(item.play);
    if (item.play !== undefined && item.play !== null && item.play !== "" && !audio) return null;
    const candidate = { meta, ...(audio ? { audio } : {}) };
    if (result && JSON.stringify(result) !== JSON.stringify(candidate)) return null;
    result = candidate;
  }
  return result;
}

export class HitmonetProvider implements SiteProvider {
  readonly name = "hitmonet";
  readonly hosts = HITMONET_HOSTS;

  matches(host: string, _html?: string): boolean {
    return providerForHost(host.toLowerCase()) === this.name;
  }

  parseSearch(root: HtmlElement, host: string): TrackMeta[] {
    if (!this.matches(host)) return [];
    const results = new Map<string, TrackMeta>();
    const conflicts = new Set<string>();
    for (const props of componentProps(root.innerHTML)) {
      // /search/:query uses this explicit source; related/similar/top/radio
      // lists and arbitrary track links must never become search results.
      const queryList =
        object(props.source) &&
        props.source.entity === "query" &&
        typeof props.source.query === "string" &&
        props.source.query.trim() &&
        Array.isArray(props.list)
          ? props.list
          : undefined;
      // Track-only search returns a category-1 list with its own query prop.
      const trackOnlyList =
        typeof props.query === "string" &&
        props.query.trim() &&
        object(props.list) &&
        props.list.category === 1 &&
        Array.isArray(props.list.items)
          ? props.list.items
          : undefined;
      const list = queryList ?? trackOnlyList;
      if (!list) continue;
      for (const value of list) {
        const meta = track(value);
        if (!meta) continue;
        const previous = results.get(meta.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(meta)) conflicts.add(meta.id);
        results.set(meta.id, meta);
      }
    }
    return [...results.values()].filter((meta) => !conflicts.has(meta.id));
  }

  parseAlbum(root: HtmlElement, host: string, albumId: string): Album | null {
    if (!this.matches(host) || !/^[1-9]\d*$/.test(albumId)) return null;
    let result: Album | null = null;
    for (const props of componentProps(root.innerHTML)) {
      const source = props.source;
      if (
        !object(source) ||
        source.entity !== "album" ||
        source.type !== "albums" ||
        !positiveInteger(source.id) ||
        String(source.id) !== albumId
      )
        continue;
      if (!Array.isArray(props.tracks) || !object(source.pagination)) return null;
      const pagination = source.pagination;
      const { page, lastPage, itemsPerPage, totalItems, itemsPerCurrentPage } = pagination;
      if (
        !positiveInteger(page) ||
        !positiveInteger(lastPage) ||
        !positiveInteger(itemsPerPage) ||
        !nonnegativeInteger(totalItems) ||
        !nonnegativeInteger(itemsPerCurrentPage) ||
        page > lastPage ||
        lastPage !== Math.max(1, Math.ceil(totalItems / itemsPerPage)) ||
        itemsPerCurrentPage !== props.tracks.length ||
        itemsPerCurrentPage !==
          Math.min(itemsPerPage, Math.max(0, totalItems - (page - 1) * itemsPerPage))
      )
        return null;

      let metadata: { title: string; artist: string; image?: string } | undefined;
      const tracks: AlbumTrack[] = [];
      const ids = new Set<string>();
      const sourceIds = new Set<string>();
      for (const value of props.tracks) {
        if (!object(value) || !positiveInteger(value.fileId)) return null;
        const meta = track(value);
        if (!meta || !Array.isArray(value.albumsList)) return null;
        const albums = value.albumsList.filter(
          (album) => object(album) && positiveInteger(album.id) && String(album.id) === albumId,
        );
        if (!albums.length) return null;
        for (const album of albums) {
          if (
            !object(album) ||
            typeof album.title !== "string" ||
            !normalizeText(album.title) ||
            typeof album.artist !== "string" ||
            !normalizeText(album.artist)
          )
            return null;
          const image = object(album.imageInfo) ? httpUrl(album.imageInfo.imageUrl) : undefined;
          if (album.imageInfo != null && (!object(album.imageInfo) || !image)) return null;
          const candidate = {
            title: normalizeText(album.title),
            artist: normalizeText(album.artist),
            ...(image ? { image } : {}),
          };
          if (metadata && JSON.stringify(metadata) !== JSON.stringify(candidate)) return null;
          metadata = candidate;
        }
        if (
          value.imageInfo != null &&
          (!object(value.imageInfo) || !httpUrl(value.imageInfo.imageUrl))
        )
          return null;
        const id = String(value.fileId);
        if (ids.has(id) || sourceIds.has(meta.id)) return null;
        ids.add(id);
        sourceIds.add(meta.id);
        tracks.push({
          ...meta,
          id,
          sourceId: meta.id,
          uri: `hitmonet:track:${id}`,
          url: `https://${host}/track/${id}`,
        });
      }
      // Without a matching albumsList there is no verified album metadata, even for an empty list.
      if (!metadata) return null;
      const candidate: Album = {
        id: albumId,
        ...metadata,
        tracks,
        totalTracks: totalItems,
        complete: page === 1 && lastPage === 1 && tracks.length === totalItems,
      };
      if (result && JSON.stringify(result) !== JSON.stringify(candidate)) return null;
      result = candidate;
    }
    return result;
  }

  parseTrackPage(root: HtmlElement, host: string, trackId: string): Partial<TrackMeta> {
    if (!this.matches(host)) return {};
    const meta = selected(root.innerHTML, trackId)?.meta;
    if (!meta) return {};
    return {
      title: meta.title,
      artist: meta.artist,
      duration: meta.duration,
      ...(meta.image ? { image: meta.image } : {}),
    };
  }

  extractAudioUrl(_root: HtmlElement, html: string, host: string, trackId: string): string | null {
    return this.matches(host) ? (selected(html, trackId)?.audio ?? null) : null;
  }
}
