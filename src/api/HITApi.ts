import { parseHtml } from "../core/html.js";
import { HyperClient, Request } from "hyperttp";
import { CacheManager } from "hcacher";
import { DEFAULT_HTTP_CONFIG } from "../core/config.js";
import { Retry } from "../core/retry.js";
import {
  normalizeQuery,
  normalizeTrackId,
  normalizeText,
  normalizeTitle,
} from "../core/normalize.js";
import { sortTracksByScore } from "../core/scoring.js";
import type { TrackMeta } from "../models/track.js";
import type { TrackAudio } from "../models/audio.js";
import { HttpClient } from "../core/http.js";
import { ProviderRegistry } from "../providers/registry.js";
import { HitmosProvider } from "../providers/hitmos.provider.js";
import { HitmozProvider } from "../providers/hitmoz.provider.js";
import type { SiteProvider } from "../providers/base.js";
import { isValidAudioUrl, scoreAudioUrl } from "../core/filters.js";

export class HITApi {
  private readonly http: HttpClient;
  private readonly retry: Retry;
  private readonly providers: ProviderRegistry;

  private sessionCookie?: string;

  private readonly trackCache = new CacheManager<TrackMeta>(1000, 15 * 60_000);
  private readonly searchCache = new CacheManager<TrackMeta[]>(200, 10 * 60_000);
  private readonly audioCache = new CacheManager<TrackAudio>(500, 50 * 60_000);

  constructor(options?: { httpClient?: HyperClient; sessionCookie?: string }) {
    this.http = new HttpClient(options?.httpClient);
    this.retry = new Retry({
      httpClient: options?.httpClient,
      sessionCookie: options?.sessionCookie,
    });
    this.sessionCookie = options?.sessionCookie;
    this.providers = new ProviderRegistry([new HitmosProvider(), new HitmozProvider()]);
  }

  setSessionCookie(cookie: string) {
    this.sessionCookie = cookie;
    this.retry.setSessionCookie(cookie);
  }

  private buildHeaders(host: string, accept: string): Record<string, string> {
    return {
      "User-Agent": DEFAULT_HTTP_CONFIG.userAgent,
      Accept: accept,
      Referer: `https://${host}/`,
      ...(this.sessionCookie ? { Cookie: `sid=${this.sessionCookie}` } : {}),
    };
  }

  private async fetchSearchHtml(host: string, query: string): Promise<string> {
    const req = new Request({
      scheme: "https",
      host,
      port: 443,
      path: "/search",
      query: { q: query },
      headers: this.buildHeaders(host, "text/html"),
    });

    return this.retry.asText(
      await this.retry.withRetry(() => this.http.getText(req), {
        attempts: 3,
        retryOn: (error) => {
          const msg = String((error as any)?.message ?? error);
          return /timeout|ECONNRESET|429|5\d\d|network|ENOTFOUND|ETIMEDOUT/i.test(msg);
        },
      }),
    );
  }

  private providerFor(host: string, html?: string): SiteProvider {
    return this.providers.resolve(host, html);
  }

  private findTrackInSearchCache(id: string): TrackMeta | undefined {
    for (const value of this.searchCacheValues()) {
      const found = value.find((t) => t.id === id);
      if (found) return found;
    }
    return undefined;
  }

  private *searchCacheValues(): Iterable<TrackMeta[]> {
    // small helper because Cache is opaque
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner = (this.searchCache as any).cache;
    if (!inner?.values) return;
    for (const value of inner.values()) {
      if (Array.isArray(value)) yield value as TrackMeta[];
    }
  }

  async search(query: string, limit: number = 20): Promise<TrackMeta[]> {
    const normalizedQuery = normalizeQuery(query);
    const cacheKey = `${normalizedQuery}:${limit}`;

    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    const host = await this.retry.resolveHost();

    const html = await this.fetchSearchHtml(host, query);

    const root = parseHtml(html);

    const provider = this.providerFor(host, html);

    const raw = provider.parseSearch(root);

    // remove invalid
    const valid = raw.filter((track) => {
      if (!track.id) return false;
      if (!track.title?.trim()) return false;
      if (!track.artist?.trim()) return false;

      return true;
    });

    // remove garbage
    const filtered = valid.filter((track) => {
      const title = normalizeTitle(track.title);

      const blocked = [
        "ringtone",
        "рингтон",
        "минус",
        "remix",
        "edit",
        "nightcore",
        "8d",
        "bassboost",
        "slowed",
        "speed up",
      ];

      if (blocked.some((x) => title.includes(x))) {
        return false;
      }

      // skip tiny audio
      if (track.duration > 0 && track.duration < 45) {
        return false;
      }

      return true;
    });

    // dedupe by id
    const dedupedById = new Map<string, TrackMeta>();

    for (const track of filtered) {
      if (!dedupedById.has(track.id)) {
        dedupedById.set(track.id, track);
      }
    }

    // dedupe by normalized title+artist
    const canonical = new Map<string, TrackMeta>();

    for (const track of dedupedById.values()) {
      const key = [normalizeTitle(track.artist), normalizeTitle(track.title)].join(":");

      const existing = canonical.get(key);

      if (!existing) {
        canonical.set(key, track);
        continue;
      }

      // prefer canonical versions
      const existingPenalty = existing.title.includes("(") ? 1 : 0;
      const currentPenalty = track.title.includes("(") ? 1 : 0;

      if (currentPenalty < existingPenalty) {
        canonical.set(key, track);
        continue;
      }

      // prefer realistic duration
      const existingDurationScore = Math.abs(existing.duration - 180);
      const currentDurationScore = Math.abs(track.duration - 180);

      if (currentDurationScore < existingDurationScore) {
        canonical.set(key, track);
      }
    }

    const ranked = sortTracksByScore(normalizedQuery, [...canonical.values()]).slice(0, limit);

    this.searchCache.set(cacheKey, ranked);

    for (const track of ranked) {
      this.trackCache.set(track.id, track);
    }

    return ranked;
  }

  private parseTrackUrl(url: string): { host: string; id: string } {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const provider = this.providerFor(host);

    if (!provider.hosts.includes(host)) {
      throw new Error(`Unsupported Hitmo host: ${host}`);
    }

    const id = parsed.pathname.match(/\/(?:song|track)\/([a-zA-Z0-9_-]+)/)?.[1];
    if (!id) {
      throw new Error(`Unsupported Hitmo track URL: ${url}`);
    }

    return { host, id: normalizeTrackId(id) };
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
    const id = normalizeTrackId(trackId);
    const cacheKey = preferredHost ? `${preferredHost}:${id}` : id;

    return this.retry.dedupe(`meta:${cacheKey}`, async () => {
      const cached = this.trackCache.get(cacheKey);
      const { html, root, host } = await this.retry.fetchTrackPage(id, preferredHost);
      const provider = this.providerFor(host, html);

      let title = cached?.title ?? "Unknown";
      let artist = cached?.artist ?? "Unknown";
      let duration = cached?.duration ?? 0;
      let image = cached?.image ?? "";

      if (title === "Unknown" || artist === "Unknown") {
        const searchHit = this.findTrackInSearchCache(id);
        if (searchHit) {
          title = searchHit.title;
          artist = searchHit.artist;
          duration = duration || searchHit.duration;
        }
      }

      const providerMeta = provider.parseTrackPage(root, host, id);
      if (providerMeta.title && title === "Unknown") title = providerMeta.title;
      if (providerMeta.artist && artist === "Unknown") artist = providerMeta.artist;
      if (providerMeta.duration && !duration) duration = providerMeta.duration;
      if (providerMeta.image && !image) image = providerMeta.image;

      if (title === "Unknown" || artist === "Unknown") {
        const ogTitle =
          root.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() || "";

        if (ogTitle) {
          const cleaned = normalizeText(ogTitle);
          const parsed = this.retry.parseOgTitle(cleaned);

          if (title === "Unknown" && parsed.title !== "Unknown") title = parsed.title;
          if (artist === "Unknown" && parsed.artist !== "Unknown") artist = parsed.artist;
        }
      }

      if (!duration) duration = this.retry.extractDuration(root);
      if (!image) image = this.retry.extractImage(host, root);

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

      this.trackCache.set(cacheKey, track);
      return track;
    });
  }

  async getAudio(trackId: string, preferredHost?: string): Promise<TrackAudio> {
    const id = normalizeTrackId(trackId);
    const cacheKey = preferredHost ? `${preferredHost}:${id}` : id;

    const cached = this.audioCache.get(cacheKey);
    if (cached) return cached;

    return this.retry.dedupe(`audio:${cacheKey}`, async () => {
      try {
        const { html, root, host } = await this.retry.fetchTrackPage(id, preferredHost);
        const provider = this.providerFor(host, html);

        const extractedAudioUrl = provider.extractAudioUrl(root, html, host, id) ?? "";
        let audioUrl = isValidAudioUrl(extractedAudioUrl) ? extractedAudioUrl : "";
        const candidates: string[] = [];

        for (const script of root.querySelectorAll("script")) {
          const content = script.textContent || "";

          // все mp3 ссылки
          const directMatches = [...content.matchAll(/(https?:\/\/[^\s"'<>]+\.mp3[^\s"'<>]*)/g)];

          for (const match of directMatches) {
            const candidate = match[1]!.replace(/\\/g, "").trim();

            if (isValidAudioUrl(candidate)) {
              candidates.push(candidate);
            }
          }

          // JSON url
          const jsonMatches = [...content.matchAll(/"url"\s*:\s*"([^"]+)"/g)];

          for (const match of jsonMatches) {
            const candidate = match[1]!.replace(/\\/g, "").trim();

            if (candidate.includes(".mp3") && isValidAudioUrl(candidate)) {
              candidates.push(candidate);
            }
          }

          // base64 hitmos mp3
          const base64Matches = [...content.matchAll(/["'](\/L[a-zA-Z0-9_=]+\.mp3)["']/g)];

          for (const match of base64Matches) {
            const candidate = `https://pl1.hitmos.fm${match[1]}`.replace(/\\/g, "").trim();

            if (isValidAudioUrl(candidate)) {
              candidates.push(candidate);
            }
          }
        }

        // dedupe
        const uniqueCandidates = [...new Set(candidates)];

        // сортировка по score
        uniqueCandidates.sort((a, b) => scoreAudioUrl(b) - scoreAudioUrl(a));

        audioUrl ||= uniqueCandidates[0] || "";

        // fallback API
        if (!audioUrl) {
          try {
            const apiReq = new Request({
              scheme: "https",
              host,
              port: 443,
              path: `/api/track/${id}/play`,
              headers: {
                "User-Agent": DEFAULT_HTTP_CONFIG.userAgent,
                Accept: "application/json",
                Referer: `https://${host}/`,
                ...(this.sessionCookie && {
                  Cookie: `sid=${this.sessionCookie}`,
                }),
              },
            });

            const res = await this.retry.withRetry(() => this.http.getJson(apiReq), {
              attempts: 2,
              retryOn: (error) => {
                const msg = String((error as any)?.message ?? error);

                return /timeout|ECONNRESET|429|5\d\d|network|ENOTFOUND|ETIMEDOUT/i.test(msg);
              },
            });

            const url = (res as any)?.url;

            if (url && isValidAudioUrl(url)) {
              audioUrl = String(url).replace(/\\/g, "").trim();
            }
          } catch {
            // ignore fallback errors
          }
        }

        if (!audioUrl) {
          throw new Error(`Failed to extract audio URL for track ${id}`);
        }

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
          expiresAt: Date.now() + 3_600_000,
        };

        this.audioCache.set(cacheKey, result);

        return result;
      } catch (error) {
        this.retry.invalidateHost();
        throw error;
      }
    });
  }
}

export default HITApi;
