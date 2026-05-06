import { HttpClientImproved, HttpClientOptions, Request } from "hyperttp";
import { LRUCache } from "lru-cache";
import { TrackMeta, TrackAudio, normalizeTrackId } from "../core/index.js";

const DEFAULT_HTTP_CONFIG: HttpClientOptions = {
  timeout: 15_000,
  maxRetries: 2,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  enableCache: false,
  verbose: true,
  allowHttp2: false,
  maxResponseBytes: 100 * 1024 * 1024,
  logger: (level, message, meta) => {
    console.log(`[HTTP ${level.toUpperCase()}] ${message}`, meta || "");
  },
};

export class HITApi {
  private http: HttpClientImproved;
  private inflight = new Map<string, Promise<any>>();

  private searchCache = new LRUCache<string, any>({ max: 200, ttl: 60_000 });

  constructor(httpClient?: HttpClientImproved) {
    this.http = httpClient || new HttpClientImproved(DEFAULT_HTTP_CONFIG);
  }

  async getTrack(trackId: string): Promise<TrackMeta> {
    const id = normalizeTrackId(trackId);
    return this.dedupe(`meta:${id}`, async () => {
      return console.log(`ok`);
    });
  }

  async getAudio(trackId: string): Promise<TrackAudio> {
    const cacheKey = `getaudio:${trackId}`;
    return this.dedupe(cacheKey, async () => {
      return console.log(`ok`);
    });
  }

  async search(query: string, limit: number = 20) {
    const cacheKey = `search:${query}:${limit}`;
    return this.dedupe(cacheKey, async () => {
      const req = new Request({
        scheme: "https",
        host: "rus.hitmoz.org",
        port: 443,
        path: `/search`,
        query: {
          q: query,
        },
        headers: {
          "Content-Type": "application/json",
        },
      });

      const res = await this.http.get<any>(req, "json");
      this.searchCache.set(cacheKey, res);
      return res;
    });
  }

  private async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }
}

export default HITApi;
