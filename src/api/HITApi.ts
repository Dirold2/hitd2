import { streamAudio } from "../core/stream.js";
import type { HITApiOptions, StreamTrackOptions } from "../models/stream.js";
import { Request } from "hyperttp";
import { CacheManager } from "hcacher";

import { parseHtml } from "../core/html.js";
import { DEFAULT_HTTP_CONFIG } from "../core/config.js";
import { Retry } from "../core/retry.js";
import { normalizeQuery, normalizeTrackId, normalizeText } from "../core/normalize.js";
import { sortTracksByScore } from "../core/scoring.js";
import { HttpClient } from "../core/http.js";
import { ProviderRegistry } from "../providers/registry.js";
import { HitmosProvider } from "../providers/hitmos.provider.js";
import { HitmonetProvider } from "../providers/hitmonet.provider.js";
import { HitmozProvider } from "../providers/hitmoz.provider.js";
import type { SiteProvider } from "../providers/base.js";
import { isValidAudioUrl } from "../core/filters.js";
import { isSupportedHost, providerForHost, getSearchHosts, trackPagePath } from "../core/hosts.js";
import { TrackNotFoundError, AudioExtractionError, AlbumError } from "../core/errors.js";
import type { Album } from "../models/album.js";

import { probeAudio } from "../core/audio-probe.js";
import type { HostProvider } from "../core/hosts.js";
import type {
  InitializeOptions,
  InitializationReport,
  ProviderInitializationStatus,
  SearchDiagnostic,
  SearchOptions,
  SearchSource,
  SearchTrack,
} from "../models/search.js";
import type { TrackMeta } from "../models/track.js";
import type { TrackAudio } from "../models/audio.js";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

const TRACK_CACHE_SIZE = 1000;
const TRACK_CACHE_TTL = 15 * 60_000;

const SEARCH_TRACK_CACHE_SIZE = 1000;
const SEARCH_TRACK_CACHE_TTL = 10 * 60_000;

const AUDIO_CACHE_SIZE = 500;
const AUDIO_CACHE_TTL = 50 * 60_000;

const AUDIO_URL_TTL = 60 * 60_000;

const MIN_TRACK_DURATION_SECONDS = 45;
const TRACK_ID_PATTERN = /^\/(?:song|track)\/([a-zA-Z0-9_-]+)\/?$/;

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
  return structuredClone(track);
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

function searchNumber(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 0 || result > 2_147_483_647) {
    throw new RangeError(`${name} must be a non-negative integer <= 2147483647`);
  }
  return result;
}

// Preserve punctuation and version qualifiers: search normalization must not
// turn a live/remix recording into its studio counterpart.
function recordingKey(track: TrackMeta): string {
  return JSON.stringify([
    normalizeQuery(track.artist).normalize("NFC"),
    normalizeQuery(track.title).normalize("NFC"),
  ]);
}

export class HITApi {
  private readonly http: HttpClient;
  private readonly retry: Retry;
  private readonly providers: ProviderRegistry;
  private readonly providerRetryAt = new Map<HostProvider, number>();
  private cooldownMs = 5 * 60_000;
  private initialization?: Promise<InitializationReport>;

  private sessionCookie?: string;
  private readonly fetchAudio?: typeof globalThis.fetch;
  private readonly fetchStream?: typeof globalThis.fetch;

  /**
   * Stores detailed track metadata.
   * Search results are kept separately.
   */
  private readonly trackCache = new CacheManager<TrackMeta>(TRACK_CACHE_SIZE, TRACK_CACHE_TTL);

  /**
   * Allows getTrack() to use metadata found during search without inspecting
   * CacheManager internals.
   */
  private readonly searchTrackCache = new CacheManager<TrackMeta>(
    SEARCH_TRACK_CACHE_SIZE,
    SEARCH_TRACK_CACHE_TTL,
  );

  private readonly sourceHosts = new CacheManager<string | null>(
    SEARCH_TRACK_CACHE_SIZE,
    SEARCH_TRACK_CACHE_TTL,
  );

  private readonly audioCache = new CacheManager<TrackAudio>(AUDIO_CACHE_SIZE, AUDIO_CACHE_TTL);

  constructor(options?: HITApiOptions) {
    this.http = new HttpClient(
      options?.httpClient,
      options?.httpClient ? undefined : options?.fetch,
    );
    this.fetchAudio = options?.fetch;
    this.fetchStream = options?.fetchAudio ?? options?.fetch;

    this.retry = new Retry({
      httpClient: options?.httpClient,
      sessionCookie: options?.sessionCookie,
    });

    this.sessionCookie = options?.sessionCookie;

    this.providers = new ProviderRegistry([
      new HitmosProvider(),
      new HitmozProvider(),
      new HitmonetProvider(),
    ]);
  }

  /** First call wins; provider outages are reported, not thrown. */
  initialize(options: InitializeOptions = {}): Promise<InitializationReport> {
    if (!this.initialization) {
      // Defer execution so concurrent/reentrant calls see the same pending run.
      this.initialization = Promise.resolve().then(async () => {
        const query = options.query ?? "music";
        if (!normalizeQuery(query)) throw new RangeError("query must not be empty");
        const timeoutMs = searchNumber(options.searchTimeoutMs, 1500, "searchTimeoutMs");
        const cooldownMs = searchNumber(options.cooldownMs, 5 * 60_000, "cooldownMs");
        const groups = this.searchGroups();
        this.cooldownMs = cooldownMs;
        const deadline = performance.now() + timeoutMs;
        const providers = await Promise.all(
          [...groups].map(async ([provider, hosts]): Promise<ProviderInitializationStatus> => {
            try {
              await this.searchProvider(provider, hosts, query, deadline, () => {});
              return { provider, hosts, status: "healthy" };
            } catch {
              return {
                provider,
                hosts,
                status: "temporarily_disabled",
                retryAt: this.providerRetryAt.get(provider)!,
              };
            }
          }),
        );
        return { providers };
      });
    }
    // Keep the stored snapshot safe from caller mutation.
    return this.initialization.then((report) => structuredClone(report));
  }

  private searchGroups(): Map<HostProvider, string[]> {
    const groups = new Map<HostProvider, string[]>();
    for (const host of getSearchHosts()) {
      const provider = providerForHost(host)!;
      groups.set(provider, [...(groups.get(provider) ?? []), host]);
    }
    return groups;
  }

  private async searchProvider(
    provider: HostProvider,
    hosts: string[],
    query: string,
    deadline: number,
    emit: (event: SearchDiagnostic) => void,
  ): Promise<SearchTrack[]> {
    const errors: unknown[] = [];
    for (const host of hosts) {
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        errors.push(new DOMException("Provider search deadline exceeded", "TimeoutError"));
        break;
      }
      const mirrorStarted = performance.now();
      let timedOut = false;
      try {
        const html = await this.fetchSearchHtml(host, query.trim(), Math.ceil(remainingMs), () => {
          timedOut = true;
        });
        const tracks = this.providerFor(host)
          .parseSearch(parseHtml(html), host)
          .map(cleanTrack)
          .filter((track): track is TrackMeta => !!track && isAcceptableTrack(track));
        const result = tracks.map((track): SearchTrack => ({
          ...track,
          host,
          url: `https://${host}${trackPagePath(host, track.id)}`,
          sources: [
            {
              host,
              provider,
              id: track.id,
              url: `https://${host}${trackPagePath(host, track.id)}`,
              availability: { status: "unchecked" },
            },
          ],
        }));
        this.providerRetryAt.delete(provider);
        emit({
          type: "mirror",
          provider,
          host,
          durationMs: performance.now() - mirrorStarted,
          outcome: "success",
          trackCount: result.length,
        });
        return result;
      } catch (error) {
        emit({
          type: "mirror",
          provider,
          host,
          durationMs: performance.now() - mirrorStarted,
          outcome: timedOut ? "timeout" : "error",
        });
        errors.push(error);
      }
    }
    this.providerRetryAt.set(provider, Date.now() + this.cooldownMs);
    throw new AggregateError(errors, `Search mirrors failed: ${hosts.join(", ")}`);
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

  private async fetchSearchHtml(
    host: string,
    query: string,
    timeoutMs: number,
    onTimeout: () => void,
  ): Promise<string> {
    const request = new Request({
      scheme: "https",
      host,
      port: 443,
      path:
        providerForHost(host) === "hitmonet"
          ? `/search/${encodeURIComponent(normalizeQuery(query))}`
          : "/search",
      query: providerForHost(host) === "hitmonet" ? { type: "tracks" } : { q: query },
      headers: this.buildHeaders(host, "text/html"),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      onTimeout();
      controller.abort(new DOMException("Search deadline exceeded", "TimeoutError"));
    }, timeoutMs);
    try {
      const response = await this.http.getTextResponse({
        url: request.url,
        headers: request.headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Search ${host} failed with HTTP ${response.status}`);
      return response.data;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async verifySource(source: SearchSource, timeoutMs: number): Promise<void> {
    const started = performance.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Verification deadline exceeded", "TimeoutError"));
    }, timeoutMs);
    const finish = (status: SearchSource["availability"]["status"], reason?: string) => {
      source.availability = {
        status,
        checkedAt: Date.now(),
        latencyMs: performance.now() - started,
        ...(reason ? { reason } : {}),
      };
    };
    try {
      const response = await this.http.getTextResponse({
        url: source.url,
        headers: this.buildHeaders(source.host, "text/html"),
        signal: controller.signal,
      });
      if (!response.ok) {
        finish(
          response.status === 404 || response.status === 410 ? "unavailable" : "error",
          `Track page HTTP ${response.status}`,
        );
        return;
      }
      const provider = this.providerFor(source.host);
      const audioUrl = provider.extractAudioUrl(
        parseHtml(response.data),
        response.data,
        source.host,
        source.id,
      );
      if (!audioUrl || !isValidAudioUrl(audioUrl)) {
        finish("unavailable", "Selected track has no trusted audio URL");
        return;
      }
      const result = await probeAudio(audioUrl, {
        signal: controller.signal,
        timeoutMs: Math.max(0, timeoutMs - (performance.now() - started)),
        fetch: this.fetchAudio,
      });
      finish(
        timedOut ? "timeout" : result.status,
        timedOut ? "Verification deadline exceeded" : result.reason,
      );
      if (source.availability.status === "available") source.audioUrl = audioUrl;
    } catch (error) {
      finish(
        timedOut ? "timeout" : "error",
        timedOut ? "Verification deadline exceeded" : getErrorMessage(error),
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async search(
    query: string,
    limit = DEFAULT_SEARCH_LIMIT,
    options: SearchOptions = {},
  ): Promise<SearchTrack[]> {
    const started = performance.now();
    const onDiagnostic = options.onDiagnostic;
    const emit = (event: SearchDiagnostic): void => {
      if (!onDiagnostic) return;
      try {
        const pending = onDiagnostic(event);
        if (pending) void Promise.resolve(pending).catch(() => {});
      } catch {
        // Diagnostics must not affect search results or mirror failover.
      }
    };
    let trackCount = 0;
    try {
      const normalizedQuery = normalizeQuery(query);
      if (!normalizedQuery) return [];
      const safeLimit = Math.min(
        MAX_SEARCH_LIMIT,
        Math.max(0, Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_SEARCH_LIMIT),
      );
      if (!safeLimit) return [];
      const maxProbes = searchNumber(options.maxProbes, 6, "maxProbes");
      const probeTimeoutMs = searchNumber(options.probeTimeoutMs, 3000, "probeTimeoutMs");
      const searchTimeoutMs = searchNumber(options.searchTimeoutMs, 5000, "searchTimeoutMs");
      const groups = this.searchGroups();
      const searchDeadline = performance.now() + searchTimeoutMs;
      const responses = await Promise.allSettled(
        [...groups]
          .filter(([provider]) => (this.providerRetryAt.get(provider) ?? 0) <= Date.now())
          .map(([provider, hosts]) =>
            this.searchProvider(provider, hosts, query, searchDeadline, emit),
          ),
      );
      const successes = responses.filter((response) => response.status === "fulfilled");
      if (!successes.length) {
        throw new AggregateError(
          responses.map((response) =>
            response.status === "rejected" ? response.reason : undefined,
          ),
          "All search providers failed",
        );
      }
      const candidates = successes.flatMap((response) => response.value);
      // Record every observed source before grouping/limiting, including collisions
      // between different recordings that happen to share a native ID.
      for (const track of candidates) {
        this.searchTrackCache.set(`${track.host}:${track.id}`, cloneTrack(track));
        const previous = this.sourceHosts.get(track.id);
        this.sourceHosts.set(
          track.id,
          previous === null || (previous !== undefined && previous !== track.host)
            ? null
            : track.host,
        );
      }
      const ranked = sortTracksByScore(normalizedQuery, candidates) as SearchTrack[];
      const grouped: SearchTrack[] = [];
      for (const track of ranked) {
        const existing = grouped.find(
          (entry) =>
            recordingKey(entry) === recordingKey(track) &&
            entry.duration > 0 &&
            track.duration > 0 &&
            Math.abs(entry.duration - track.duration) <= 2,
        );
        if (existing) {
          const source = track.sources[0]!;
          if (!existing.sources.some((entry) => entry.url === source.url))
            existing.sources.push(source);
        } else grouped.push(track);
      }
      const results = grouped.slice(0, safeLimit);
      if (options.verifyAudio !== false) {
        const sources = results.flatMap((track) => track.sources).slice(0, maxProbes);
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(3, sources.length) }, async () => {
            while (next < sources.length) await this.verifySource(sources[next++]!, probeTimeoutMs);
          }),
        );
      }
      const preference = (source: SearchSource) =>
        source.availability.status === "available"
          ? 0
          : source.availability.status === "unchecked"
            ? 1
            : 2;
      for (const track of results) {
        const primary = [...track.sources].sort((a, b) => preference(a) - preference(b))[0]!;
        Object.assign(track, {
          id: primary.id,
          host: primary.host,
          url: primary.url,
          uri: `${primary.provider}:track:${primary.id}`,
        });
      }
      const output = structuredClone(results);
      trackCount = output.length;
      return output;
    } finally {
      emit({ type: "complete", durationMs: performance.now() - started, trackCount });
    }
  }

  private sourceHost(id: string): string | undefined {
    const host = this.sourceHosts.get(id);
    if (host === null) throw new Error(`Ambiguous track ID ${id}; use a track URL instead`);
    return host;
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

  async getAlbumByUrl(url: string): Promise<Album> {
    // Check the raw authority/path too: URL normalizes explicit :443 and dot segments away.
    const raw = /^https:\/\/([^/?#]+)(\/album\/[1-9]\d*)$/i.exec(url);
    const parsed = new URL(url);
    if (
      !raw ||
      raw[1]!.toLowerCase() !== parsed.hostname ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      providerForHost(parsed.hostname) !== "hitmonet"
    )
      throw new Error(`Unsupported Hitmo album URL: ${url}`);
    const host = parsed.hostname;
    const id = parsed.pathname.slice("/album/".length);
    const request = new Request({
      scheme: "https",
      host,
      port: 443,
      path: `/album/${id}`,
      headers: this.buildHeaders(host, "text/html"),
    });
    const html = await this.retry.withRetry(
      async () => {
        const response = await this.http.getTextResponse(request);
        if (!response.ok) {
          throw new AlbumError(
            response.status === 404 || response.status === 410
              ? "ALBUM_NOT_FOUND"
              : "ALBUM_HTTP_ERROR",
            id,
            host,
            `request failed with HTTP ${response.status}`,
            response.status,
          );
        }
        return response.data;
      },
      {
        attempts: 3,
        retryOn: (error) =>
          error instanceof AlbumError
            ? error.status === 429 ||
              (error.status !== undefined && error.status >= 500 && error.status < 600)
            : isRetryableError(error),
      },
    );
    const album = new HitmonetProvider().parseAlbum(parseHtml(html), host, id);
    if (!album)
      throw new AlbumError(
        "ALBUM_INVALID_DATA",
        id,
        host,
        "missing, malformed or conflicting album data",
      );
    return album;
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

    preferredHost = preferredHost?.trim().toLowerCase() || this.sourceHost(id);

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

  /** Lazy, backpressured audio bytes. Each call is an independent opening. */
  streamTrack(
    trackId: string,
    options: StreamTrackOptions = {},
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    return streamAudio(
      () => this.getAudio(trackId),
      this.fetchStream ?? globalThis.fetch,
      options,
      signal,
    );
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

    preferredHost = preferredHost?.trim().toLowerCase() || this.sourceHost(id);

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
