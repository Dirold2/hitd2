import { HyperClient, Request } from "hyperttp";
import { CacheManager } from "hcacher";

import { parseHtml } from "../core/html.js";
import { DEFAULT_HTTP_CONFIG } from "../core/config.js";
import { Retry } from "../core/retry.js";
import { normalizeQuery, normalizeTrackId, normalizeText } from "../core/normalize.js";
import { sortTracksByScore } from "../core/scoring.js";
import { HttpClient } from "../core/http.js";
import { ProviderRegistry } from "../providers/registry.js";
import { HitmosProvider } from "../providers/hitmos.provider.js";
import { HitmozProvider } from "../providers/hitmoz.provider.js";
import type { SiteProvider } from "../providers/base.js";
import { isValidAudioUrl } from "../core/filters.js";
import { isSupportedHost } from "../core/hosts.js";
import { TrackNotFoundError, AudioExtractionError } from "../core/errors.js";

import type { TrackMeta } from "../models/track.js";
import type { TrackAudio } from "../models/audio.js";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

const SEARCH_CACHE_SIZE = 200;
const SEARCH_CACHE_TTL = 10 * 60_000;

const TRACK_CACHE_SIZE = 1000;
const TRACK_CACHE_TTL = 15 * 60_000;

const SEARCH_TRACK_CACHE_SIZE = 1000;
const SEARCH_TRACK_CACHE_TTL = 10 * 60_000;

const AUDIO_CACHE_SIZE = 500;
const AUDIO_CACHE_TTL = 50 * 60_000;

const AUDIO_URL_TTL = 60 * 60_000;

const MIN_TRACK_DURATION_SECONDS = 45;
const MAX_TRACK_DURATION_SECONDS = 60 * 60;

const TRACK_ID_PATTERN = /^\/(?:song|track)\/([a-zA-Z0-9_-]+)\/?$/;

const VERSION_TITLE_PATTERN =
  /\b(?:remix|live|radio edit|extended|instrumental|karaoke|nightcore|slowed|sped[\s-]*up|acoustic)\b/i;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }

  return String(error);
}

function isRetryableError(error: unknown): boolean {
  return /timeout|ECONNRESET|429|5\d\d|network|ENOTFOUND|ETIMEDOUT/i.test(getErrorMessage(error));
}

function cloneTrack(track: TrackMeta): TrackMeta {
  return { ...track };
}

function cloneTracks(tracks: TrackMeta[]): TrackMeta[] {
  return tracks.map(cloneTrack);
}

function cloneAudio(audio: TrackAudio): TrackAudio {
  return {
    ...audio,
    files: audio.files.map((file) => ({ ...file })),
    urls: [...audio.urls],
  };
}

function isUsableText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim() !== "Unknown";
}

function hasCompleteMetadata(track: TrackMeta): boolean {
  return isUsableText(track.title) && isUsableText(track.artist);
}

/**
 * Validates and normalizes the basic fields returned by a provider.
 */
function cleanTrack(track: TrackMeta): TrackMeta | undefined {
  if (!track || typeof track !== "object") {
    return undefined;
  }

  if (
    typeof track.id !== "string" ||
    typeof track.title !== "string" ||
    typeof track.artist !== "string"
  ) {
    return undefined;
  }

  const id = track.id.trim();
  const title = track.title.trim();
  const artist = track.artist.trim();

  if (!id || !title || !artist) {
    return undefined;
  }

  const duration = Number.isFinite(track.duration) && track.duration >= 0 ? track.duration : 0;

  return {
    ...track,
    id,
    title,
    artist,
    duration,
  };
}

function isAcceptableTrack(track: TrackMeta): boolean {
  if (track.duration > 0 && track.duration < MIN_TRACK_DURATION_SECONDS) {
    return false;
  }

  return true;
}

/**
 * Scores a track when duplicate entries represent the same recording.
 *
 * This is a metadata completeness heuristic, not a guarantee that one
 * recording is the original version.
 */
function trackQuality(track: TrackMeta): number {
  let score = 0;

  if (track.image?.trim()) {
    score += 2;
  }

  if (
    Number.isFinite(track.duration) &&
    track.duration >= MIN_TRACK_DURATION_SECONDS &&
    track.duration <= MAX_TRACK_DURATION_SECONDS
  ) {
    score += 3;
  }

  if (VERSION_TITLE_PATTERN.test(track.title)) {
    score -= 2;
  }

  return score;
}

/**
 * Removes duplicate IDs first, then duplicate normalized artist/title pairs.
 */
function dedupeTracks(tracks: TrackMeta[]): TrackMeta[] {
  const byId = new Map<string, TrackMeta>();

  for (const track of tracks) {
    const id = track.id.trim();
    const existing = byId.get(id);

    if (!existing || trackQuality(track) > trackQuality(existing)) {
      byId.set(id, track);
    }
  }

  const byCanonicalName = new Map<string, TrackMeta>();

  for (const track of byId.values()) {
    const key = JSON.stringify([normalizeQuery(track.artist), normalizeQuery(track.title)]);

    const existing = byCanonicalName.get(key);

    if (!existing || trackQuality(track) > trackQuality(existing)) {
      byCanonicalName.set(key, track);
    }
  }

  return [...byCanonicalName.values()];
}

export class HITApi {
  private readonly http: HttpClient;
  private readonly retry: Retry;
  private readonly providers: ProviderRegistry;

  private sessionCookie?: string;

  /**
   * Stores detailed track metadata.
   * Search results are kept separately.
   */
  private readonly trackCache = new CacheManager<TrackMeta>(TRACK_CACHE_SIZE, TRACK_CACHE_TTL);

  /**
   * Stores complete search results by host, normalized query and limit.
   */
  private readonly searchCache = new CacheManager<TrackMeta[]>(SEARCH_CACHE_SIZE, SEARCH_CACHE_TTL);

  /**
   * Allows getTrack() to use metadata found during search without inspecting
   * CacheManager internals.
   */
  private readonly searchTrackCache = new CacheManager<TrackMeta>(
    SEARCH_TRACK_CACHE_SIZE,
    SEARCH_TRACK_CACHE_TTL,
  );

  private readonly sourceHosts = new CacheManager<string>(
    SEARCH_TRACK_CACHE_SIZE,
    SEARCH_TRACK_CACHE_TTL,
  );

  private readonly audioCache = new CacheManager<TrackAudio>(AUDIO_CACHE_SIZE, AUDIO_CACHE_TTL);

  constructor(options?: { httpClient?: HyperClient; sessionCookie?: string }) {
    this.http = new HttpClient(options?.httpClient);

    this.retry = new Retry({
      httpClient: options?.httpClient,
      sessionCookie: options?.sessionCookie,
    });

    this.sessionCookie = options?.sessionCookie;

    this.providers = new ProviderRegistry([new HitmosProvider(), new HitmozProvider()]);
  }

  setSessionCookie(cookie: string): void {
    this.sessionCookie = cookie;
    this.retry.setSessionCookie(cookie);
  }

  private buildHeaders(host: string, accept: string): Record<string, string> {
    const cookie = this.sessionCookie?.trim().replace(/[\r\n]/g, "");

    const cookieHeader = cookie ? (/^sid=/i.test(cookie) ? cookie : `sid=${cookie}`) : undefined;

    return {
      "User-Agent": DEFAULT_HTTP_CONFIG.userAgent,
      Accept: accept,
      Referer: `https://${host}/`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };
  }

  private providerFor(host: string, html?: string): SiteProvider {
    return this.providers.resolve(host, html);
  }

  private async fetchSearchHtml(host: string, query: string): Promise<string> {
    const request = new Request({
      scheme: "https",
      host,
      port: 443,
      path: "/search",
      query: { q: query },
      headers: this.buildHeaders(host, "text/html"),
    });

    const response = await this.retry.withRetry(
      async () => {
        const result = await this.http.getTextResponse(request);
        if (!result.ok) throw new Error(`Search request failed with HTTP ${result.status}`);
        return result.data;
      },
      {
        attempts: 3,
        retryOn: isRetryableError,
      },
    );

    return this.retry.asText(response);
  }

  async search(query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<TrackMeta[]> {
    const trimmedQuery = query.trim();
    const normalizedQuery = normalizeQuery(trimmedQuery);

    if (!trimmedQuery || !normalizedQuery) {
      return [];
    }

    const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_SEARCH_LIMIT;

    const safeLimit = Math.min(MAX_SEARCH_LIMIT, Math.max(0, requestedLimit));

    if (safeLimit === 0) {
      return [];
    }

    const host = await this.retry.resolveHost();

    const cacheKey = JSON.stringify([host, normalizedQuery, safeLimit]);

    const cached = this.searchCache.get(cacheKey);

    if (cached) {
      return cloneTracks(cached);
    }

    return this.retry.dedupe(`search:${cacheKey}`, async () => {
      const cachedAgain = this.searchCache.get(cacheKey);

      if (cachedAgain) {
        return cloneTracks(cachedAgain);
      }

      const html = await this.fetchSearchHtml(host, trimmedQuery);
      const root = parseHtml(html);
      const provider = this.providerFor(host, html);

      const raw = provider.parseSearch(root, host);

      const valid = raw.map(cleanTrack).filter((track): track is TrackMeta => track !== undefined);

      const filtered = valid.filter(isAcceptableTrack);
      const deduped = dedupeTracks(sortTracksByScore(trimmedQuery, filtered));

      const ranked = sortTracksByScore(normalizedQuery, deduped).slice(0, safeLimit);

      const cachedResults = cloneTracks(ranked);

      this.searchCache.set(cacheKey, cachedResults);

      for (const track of cachedResults) {
        this.searchTrackCache.set(`${host}:${track.id}`, cloneTrack(track));
        this.sourceHosts.set(track.id, host);
      }

      return cloneTracks(cachedResults);
    });
  }

  private parseTrackUrl(url: string): {
    host: string;
    id: string;
  } {
    const parsed = new URL(url);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported track URL protocol: ${parsed.protocol}`);
    }

    if (parsed.username || parsed.password) {
      throw new Error("Track URLs must not contain credentials");
    }

    const host = parsed.hostname.toLowerCase();

    if (!isSupportedHost(host) || parsed.port) {
      throw new Error(`Unsupported Hitmo host: ${host}`);
    }

    const id = parsed.pathname.match(TRACK_ID_PATTERN)?.[1];

    if (!id) {
      throw new Error(`Unsupported Hitmo track URL: ${url}`);
    }

    return {
      host,
      id: normalizeTrackId(id),
    };
  }

  async getTrackByUrl(url: string): Promise<TrackMeta> {
    const { host, id } = this.parseTrackUrl(url);

    return this.getTrack(id, host);
  }

  async getAudioByUrl(url: string): Promise<TrackAudio> {
    const { host, id } = this.parseTrackUrl(url);

    return this.getAudio(id, host);
  }

  async getTrack(trackId: string, preferredHost?: string): Promise<TrackMeta> {
    let id: string;

    if (/^https?:\/\//i.test(trackId)) {
      const parsed = this.parseTrackUrl(trackId);

      id = parsed.id;
      preferredHost = parsed.host;
    } else {
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(trackId)) {
        throw new Error(`Unsupported track URL: ${trackId}`);
      }

      id = normalizeTrackId(trackId);
    }

    if (!id) {
      throw new Error("Track ID is required");
    }

    preferredHost = preferredHost?.trim().toLowerCase() || this.sourceHosts.get(id);

    const cacheKey = preferredHost ? `${preferredHost}:${id}` : id;

    return this.retry.dedupe(`meta:${cacheKey}`, async () => {
      const cached = this.trackCache.get(cacheKey);

      if (cached && hasCompleteMetadata(cached)) {
        return cloneTrack(cached);
      }

      const { html, root, host } = await this.retry.fetchTrackPage(id, preferredHost);

      const actualHost = host.toLowerCase();
      const provider = this.providerFor(actualHost, html);

      const searchHit = this.searchTrackCache.get(`${actualHost}:${id}`);

      const titleSeed = isUsableText(cached?.title) ? cached.title : searchHit?.title;

      const artistSeed = isUsableText(cached?.artist) ? cached.artist : searchHit?.artist;

      let title = titleSeed ?? "Unknown";
      let artist = artistSeed ?? "Unknown";

      let duration =
        cached?.duration && cached.duration > 0 ? cached.duration : (searchHit?.duration ?? 0);

      let image = cached?.image?.trim() || searchHit?.image?.trim() || "";

      const providerMeta = provider.parseTrackPage(root, actualHost, id);

      if (isUsableText(providerMeta.title)) {
        title = providerMeta.title.trim();
      }

      if (isUsableText(providerMeta.artist)) {
        artist = providerMeta.artist.trim();
      }

      if (
        typeof providerMeta.duration === "number" &&
        Number.isFinite(providerMeta.duration) &&
        providerMeta.duration > 0
      ) {
        duration = providerMeta.duration;
      }

      if (isUsableText(providerMeta.image)) {
        image = providerMeta.image.trim();
      }

      if (title === "Unknown" || artist === "Unknown") {
        const ogTitle =
          root.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ?? "";

        if (ogTitle) {
          const parsed = this.retry.parseOgTitle(normalizeText(ogTitle));

          if (title === "Unknown" && isUsableText(parsed.title)) {
            title = parsed.title;
          }

          if (artist === "Unknown" && isUsableText(parsed.artist)) {
            artist = parsed.artist;
          }
        }
      }

      if (!(duration > 0)) {
        duration = this.retry.extractDuration(root);
      }

      if (!Number.isFinite(duration) || duration < 0) {
        duration = 0;
      }

      if (!image) {
        image = this.retry.extractImage(actualHost, root);
      }

      const track: TrackMeta = {
        id,
        title,
        artist,
        duration,
        uri: `hitmos:track:${id}`,
        name: title,
        duration_ms: duration * 1000,
        explicit: false,
        image,
      };

      this.trackCache.set(`${actualHost}:${id}`, cloneTrack(track));

      const genericCached = this.trackCache.get(id);

      if (hasCompleteMetadata(track) || !genericCached) {
        this.trackCache.set(id, cloneTrack(track));
      }

      return cloneTrack(track);
    });
  }

  async getAudio(trackId: string, preferredHost?: string): Promise<TrackAudio> {
    let id: string;

    if (/^https?:\/\//i.test(trackId)) {
      const parsed = this.parseTrackUrl(trackId);

      id = parsed.id;
      preferredHost = parsed.host;
    } else {
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(trackId)) {
        throw new Error(`Unsupported track URL: ${trackId}`);
      }

      id = normalizeTrackId(trackId);
    }

    if (!id) {
      throw new Error("Track ID is required");
    }

    preferredHost = preferredHost?.trim().toLowerCase() || this.sourceHosts.get(id);

    const cacheKey = preferredHost ? `${preferredHost}:${id}` : id;

    const cached = this.audioCache.get(cacheKey);

    if (cached) {
      return cloneAudio(cached);
    }

    return this.retry.dedupe(`audio:${cacheKey}`, async () => {
      const cachedAgain = this.audioCache.get(cacheKey);

      if (cachedAgain) {
        return cloneAudio(cachedAgain);
      }

      try {
        const { html, root, host } = await this.retry.fetchTrackPage(id, preferredHost);

        const actualHost = host.toLowerCase();
        const provider = this.providerFor(actualHost, html);

        const extractedAudioUrl = provider.extractAudioUrl(root, html, actualHost, id) ?? "";

        const audioUrl = isValidAudioUrl(extractedAudioUrl) ? extractedAudioUrl : "";
        if (!audioUrl) throw new AudioExtractionError(id, actualHost);

        const result: TrackAudio = {
          id,
          url: audioUrl,
          format: "mp3",
          files: [
            {
              url: audioUrl,
              format: "mp3",
              bitrate: 320,
            },
          ],
          urls: [audioUrl],
          expiresAt: Date.now() + AUDIO_URL_TTL,
        };

        this.audioCache.set(`${actualHost}:${id}`, cloneAudio(result));

        if (!preferredHost || preferredHost === actualHost) {
          this.audioCache.set(cacheKey, cloneAudio(result));
        }

        return cloneAudio(result);
      } catch (error) {
        if (!(error instanceof TrackNotFoundError) && !(error instanceof AudioExtractionError)) {
          this.retry.invalidateHost();
        }

        throw error;
      }
    });
  }
}

export default HITApi;
