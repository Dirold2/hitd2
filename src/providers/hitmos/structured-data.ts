import type { HtmlElement } from "../../core/html.js";
import { isDomainHost } from "../../core/hosts.js";
import { normalizeText } from "../../core/normalize.js";
import type {
  HitmosAlbum,
  HitmosAlbumReference,
  HitmosArtist,
  HitmosRecording,
  HitmosStructuredData,
} from "./types.js";

type JsonRecord = Record<string, unknown>;
type EntityKind = "song" | "album" | "artist";

interface InternalEntityUrl {
  id: string;
  url: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function getString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return normalizeText(value) || undefined;
}

function getTypeNames(value: JsonRecord): string[] {
  return asArray(value["@type"])
    .filter((type): type is string => typeof type === "string")
    .map((type) => type.split(/[\/#:]/).pop() ?? "")
    .filter(Boolean);
}

function hasType(value: JsonRecord, expected: string): boolean {
  return getTypeNames(value).includes(expected);
}

function getRawEntityUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;

  if (typeof value.url === "string") return value.url;
  if (typeof value["@id"] === "string") return value["@id"];

  return undefined;
}

function getInternalEntityUrl(
  value: unknown,
  kind: EntityKind,
  host: string,
): InternalEntityUrl | undefined {
  const rawUrl = getRawEntityUrl(value);
  if (!rawUrl) return undefined;

  let baseUrl: URL;
  let url: URL;

  try {
    baseUrl = new URL(`https://${host}`);
    url = new URL(rawUrl, baseUrl);
  } catch {
    return undefined;
  }

  const sameHost = url.hostname === baseUrl.hostname;
  const sameHitmosNetwork =
    isDomainHost(baseUrl.hostname, "hitmos.fm") && isDomainHost(url.hostname, "hitmos.fm");

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (!sameHost && !sameHitmosNetwork)
  ) {
    return undefined;
  }

  const id = url.pathname.match(new RegExp(`^/${kind}/([^/]+)/?$`))?.[1];

  if (!id) return undefined;

  try {
    return {
      id: decodeURIComponent(id),
      url: url.href,
    };
  } catch {
    return undefined;
  }
}

function parseIsoDuration(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  const match = value.match(
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
  );

  if (!match) return undefined;

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const duration = days * 86400 + hours * 3600 + minutes * 60 + seconds;

  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function parseArtistReference(value: unknown, host: string): HitmosArtist | undefined {
  if (typeof value === "string") {
    const name = getString(value);
    return name ? { name } : undefined;
  }

  if (!isRecord(value)) return undefined;

  const name = getString(value.name);
  const entity = getInternalEntityUrl(value, "artist", host);

  if (!name && !entity) return undefined;

  return {
    ...(entity ? { id: entity.id, url: entity.url } : {}),
    ...(name ? { name } : {}),
  };
}

function parseArtists(value: unknown, host: string): HitmosArtist[] {
  const artists = new Map<string, HitmosArtist>();

  for (const item of asArray(value)) {
    const artist = parseArtistReference(item, host);
    if (!artist) continue;

    const key = artist.id ?? artist.url ?? artist.name ?? "";
    if (!key) continue;

    const previous = artists.get(key);
    artists.set(key, previous ? { ...previous, ...artist } : artist);
  }

  return [...artists.values()];
}

function parseAlbumReference(value: unknown, host: string): HitmosAlbumReference | undefined {
  if (typeof value === "string") {
    const name = getString(value);
    return name ? { name } : undefined;
  }

  if (!isRecord(value)) return undefined;

  const name = getString(value.name);
  const rawUrl = getRawEntityUrl(value);
  const entity = getInternalEntityUrl(value, "album", host);

  // Do not downgrade an external or malformed URL into an unlinked
  // name-only album reference. Plain string album names remain supported.
  if (rawUrl && !entity) return undefined;
  if (!name && !entity) return undefined;

  return {
    ...(entity ? { id: entity.id, url: entity.url } : {}),
    ...(name ? { name } : {}),
  };
}

function parseAlbumReferences(value: unknown, host: string): HitmosAlbumReference[] {
  const albums = new Map<string, HitmosAlbumReference>();

  for (const item of asArray(value)) {
    const album = parseAlbumReference(item, host);
    if (!album) continue;

    const key = album.id ?? album.url ?? album.name ?? "";
    if (!key) continue;

    const previous = albums.get(key);
    albums.set(key, previous ? { ...previous, ...album } : album);
  }

  return [...albums.values()];
}

function collectTypedNodes(value: unknown, expectedType: string, output: JsonRecord[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTypedNodes(item, expectedType, output);
    }
    return;
  }

  if (!isRecord(value)) return;

  if (hasType(value, expectedType)) output.push(value);

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectTypedNodes(child, expectedType, output);
    }
  }
}

function parseRecording(value: JsonRecord, host: string): HitmosRecording | undefined {
  const entity = getInternalEntityUrl(value.url ?? value["@id"], "song", host);

  if (!entity) return undefined;

  const title = getString(value.name);
  const artists = parseArtists(value.byArtist ?? value.artist, host);
  const artistNames = artists
    .map((artist) => artist.name)
    .filter((name): name is string => Boolean(name));
  const duration = parseIsoDuration(value.duration);
  const albums = parseAlbumReferences(value.inAlbum, host);

  return {
    id: entity.id,
    url: entity.url,
    ...(title ? { title } : {}),
    ...(artistNames.length ? { artist: artistNames.join(", ") } : {}),
    artists,
    ...(duration !== undefined ? { duration } : {}),
    albums,
  };
}

function parseNumTracks(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }

  if (isRecord(value)) {
    return parseNumTracks(value.value ?? value.numberOfItems);
  }

  return undefined;
}

function mergeUnique<T extends object>(
  first: readonly T[],
  second: readonly T[],
  getKey: (value: T) => string,
): T[] {
  const result = new Map<string, T>();

  for (const item of [...first, ...second]) {
    const key = getKey(item);
    if (!key) continue;

    const previous = result.get(key);
    result.set(key, previous ? { ...previous, ...item } : item);
  }

  return [...result.values()];
}

function mergeRecording(previous: HitmosRecording, incoming: HitmosRecording): HitmosRecording {
  const artists = mergeUnique(
    previous.artists,
    incoming.artists,
    (artist) => artist.id ?? artist.url ?? artist.name ?? "",
  );
  const albums = mergeUnique(
    previous.albums,
    incoming.albums,
    (album) => album.id ?? album.url ?? album.name ?? "",
  );
  const artistNames = artists
    .map((artist) => artist.name)
    .filter((name): name is string => Boolean(name));

  return {
    ...previous,
    title: previous.title ?? incoming.title,
    artist:
      previous.artist ??
      incoming.artist ??
      (artistNames.length ? artistNames.join(", ") : undefined),
    duration: previous.duration ?? incoming.duration,
    artists,
    albums,
  };
}

function collectSongReferences(value: unknown, host: string, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSongReferences(item, host, output);
    }
    return;
  }

  if (typeof value === "string") {
    const entity = getInternalEntityUrl(value, "song", host);
    if (entity) output.add(entity.id);
    return;
  }

  if (!isRecord(value)) return;

  const entity = getInternalEntityUrl(value.url ?? value["@id"], "song", host);

  if (entity) output.add(entity.id);

  // These are the schema.org containers used by ItemList/ListItem.track.
  for (const key of ["track", "itemListElement", "item"]) {
    if (value[key] !== undefined) {
      collectSongReferences(value[key], host, output);
    }
  }
}

function parseAlbum(
  value: JsonRecord,
  host: string,
  recordings: ReadonlyMap<string, HitmosRecording>,
): HitmosAlbum | undefined {
  const entity = getInternalEntityUrl(value.url ?? value["@id"], "album", host);

  if (!entity) return undefined;

  const title = getString(value.name);
  const albumReference: HitmosAlbumReference = {
    id: entity.id,
    url: entity.url,
    ...(title ? { name: title } : {}),
  };

  const hasTrackList = value.track !== undefined && value.track !== null;
  const trackNodes: JsonRecord[] = [];
  collectTypedNodes(value.track, "MusicRecording", trackNodes);

  const tracks = new Map<string, HitmosRecording>();

  for (const node of trackNodes) {
    const parsed = parseRecording(node, host);
    if (!parsed) continue;

    const existing = recordings.get(parsed.id);
    const recording = existing ? mergeRecording(existing, parsed) : parsed;

    const linked: HitmosRecording = {
      ...recording,
      albums: mergeUnique(
        recording.albums,
        [albumReference],
        (album) => album.id ?? album.url ?? album.name ?? "",
      ),
    };

    const previous = tracks.get(linked.id);
    tracks.set(linked.id, previous ? mergeRecording(previous, linked) : linked);
  }

  // Some JSON-LD uses ItemList/ListItem.item references instead of embedding
  // the full MusicRecording object. Resolve those references when the same
  // document exposes the corresponding recording elsewhere.
  const referencedIds = new Set<string>();
  if (hasTrackList) {
    collectSongReferences(value.track, host, referencedIds);
  }

  for (const id of referencedIds) {
    if (tracks.has(id)) continue;

    const recording = recordings.get(id);
    if (!recording) continue;

    tracks.set(id, {
      ...recording,
      albums: mergeUnique(
        recording.albums,
        [albumReference],
        (album) => album.id ?? album.url ?? album.name ?? "",
      ),
    });
  }

  const artists = parseArtists(value.byArtist ?? value.artist, host);
  const datePublished = getString(value.datePublished);
  const albumReleaseType = getString(value.albumReleaseType);
  const trackListContainer = isRecord(value.track) ? value.track : undefined;
  const numTracks = parseNumTracks(
    value.numTracks ?? value.numberOfItems ?? trackListContainer?.numberOfItems,
  );
  const trackListComplete =
    hasTrackList &&
    numTracks !== undefined &&
    referencedIds.size === numTracks &&
    tracks.size === referencedIds.size;

  return {
    id: entity.id,
    url: entity.url,
    ...(title ? { title } : {}),
    artists,
    ...(datePublished ? { datePublished } : {}),
    ...(albumReleaseType ? { albumReleaseType } : {}),
    ...(numTracks !== undefined ? { numTracks } : {}),
    tracks: [...tracks.values()],
    trackListComplete,
  };
}

function mergeAlbum(previous: HitmosAlbum, incoming: HitmosAlbum): HitmosAlbum {
  const tracks = new Map<string, HitmosRecording>();

  for (const track of previous.tracks) {
    tracks.set(track.id, track);
  }

  for (const track of incoming.tracks) {
    const existing = tracks.get(track.id);
    tracks.set(track.id, existing ? mergeRecording(existing, track) : track);
  }

  const countsConflict =
    previous.numTracks !== undefined &&
    incoming.numTracks !== undefined &&
    previous.numTracks !== incoming.numTracks;
  const numTracks = countsConflict ? undefined : (previous.numTracks ?? incoming.numTracks);
  const mergedTracks = [...tracks.values()];
  const trackListComplete =
    !countsConflict &&
    numTracks !== undefined &&
    mergedTracks.length === numTracks &&
    (previous.trackListComplete || incoming.trackListComplete);

  return {
    ...previous,
    title: previous.title ?? incoming.title,
    artists: previous.artists.length ? previous.artists : incoming.artists,
    datePublished: previous.datePublished ?? incoming.datePublished,
    albumReleaseType: previous.albumReleaseType ?? incoming.albumReleaseType,
    ...(numTracks !== undefined ? { numTracks } : {}),
    tracks: mergedTracks,
    trackListComplete,
  };
}

/**
 * Parses JSON-LD from an already downloaded Hitmos page. It performs no
 * network requests and only accepts entity URLs belonging to the current
 * host or the Hitmos.fm domain family.
 *
 * Album membership is derived only from explicit MusicRecording.inAlbum or
 * MusicAlbum.track relationships. It is never inferred from title text.
 */
export function parseHitmosStructuredData(root: HtmlElement, host: string): HitmosStructuredData {
  const documents: unknown[] = [];

  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      documents.push(JSON.parse(script.textContent));
    } catch {
      // A malformed JSON-LD block must not invalidate other blocks.
    }
  }

  const recordingNodes: JsonRecord[] = [];
  const albumNodes: JsonRecord[] = [];

  for (const document of documents) {
    collectTypedNodes(document, "MusicRecording", recordingNodes);
    collectTypedNodes(document, "MusicAlbum", albumNodes);
  }

  const recordings = new Map<string, HitmosRecording>();

  for (const node of recordingNodes) {
    const recording = parseRecording(node, host);
    if (!recording) continue;

    const previous = recordings.get(recording.id);
    recordings.set(recording.id, previous ? mergeRecording(previous, recording) : recording);
  }

  const albums = new Map<string, HitmosAlbum>();

  for (const node of albumNodes) {
    const album = parseAlbum(node, host, recordings);
    if (!album) continue;

    const previous = albums.get(album.id);
    albums.set(album.id, previous ? mergeAlbum(previous, album) : album);

    for (const recording of album.tracks) {
      const existing = recordings.get(recording.id);
      recordings.set(recording.id, existing ? mergeRecording(existing, recording) : recording);
    }
  }

  // Apply explicit inAlbum relationships in the reverse direction too.
  // This also enriches references that initially contained only an ID.
  for (const [albumId, album] of albums) {
    const related = [...recordings.values()].filter((recording) =>
      recording.albums.some((reference) => reference.id === albumId),
    );

    const merged = mergeAlbum(album, {
      ...album,
      tracks: related,
    });

    albums.set(albumId, merged);
  }

  return { recordings, albums };
}
