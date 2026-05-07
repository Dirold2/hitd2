import { HttpClientImproved, Request } from "hyperttp";
import { parse, type HTMLElement } from "node-html-parser";
import { DEFAULT_HTTP_CONFIG } from "./config.js";
import { normalizeText, normalizeTrackId } from "./normalize.js";

export interface HostCacheState {
  value: string | null;
  expiresAt: number;
}

export class Retry {
  private readonly inflight = new Map<string, Promise<any>>();
  private readonly pageCache = new Map<string, string>();
  private readonly http: HttpClientImproved;
  private sessionCookie?: string;

  private hostPromise: Promise<string> | null = null;
  private hostCache: HostCacheState = { value: null, expiresAt: 0 };

  constructor(options?: {
    httpClient?: HttpClientImproved;
    sessionCookie?: string;
  }) {
    this.http =
      options?.httpClient ?? new HttpClientImproved(DEFAULT_HTTP_CONFIG);
    this.sessionCookie = options?.sessionCookie;
  }

  setSessionCookie(cookie: string) {
    this.sessionCookie = cookie;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async withRetry<T>(
    fn: () => Promise<T>,
    options: {
      attempts?: number;
      baseDelayMs?: number;
      maxDelayMs?: number;
      retryOn?: (error: unknown) => boolean;
    } = {},
  ): Promise<T> {
    const attempts = options.attempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 300;
    const maxDelayMs = options.maxDelayMs ?? 3000;
    const retryOn = options.retryOn ?? (() => true);

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt >= attempts || !retryOn(error)) {
          throw error;
        }

        const jitter = Math.floor(Math.random() * 150);
        const delay = Math.min(
          maxDelayMs,
          baseDelayMs * 2 ** (attempt - 1) + jitter,
        );
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  asText(value: unknown): string {
    return typeof value === "string" ? value : String(value ?? "");
  }

  normalizeText(value?: string | null): string {
    return normalizeText(value);
  }

  parseDuration(durationStr: string): number {
    if (!durationStr) return 0;

    const match = durationStr.match(/(\d+):(\d+)/);
    if (match) {
      return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }

    return parseInt(durationStr, 10) || 0;
  }

  parseOgTitle(ogTitle: string): { title: string; artist: string } {
    const cleaned = normalizeText(ogTitle)
      .replace(/\s*-\s*скачать.*$/i, "")
      .replace(/\s*-\s*download.*$/i, "")
      .trim();

    if (!cleaned) return { title: "Unknown", artist: "Unknown" };

    const parenMatch = cleaned.match(/^(.+?)\s*\((.+?)\)$/);
    if (parenMatch) {
      return {
        title: normalizeText(parenMatch[1]),
        artist: normalizeText(parenMatch[2]),
      };
    }

    const dashParts = cleaned
      .split(" - ")
      .map((part) => normalizeText(part))
      .filter(Boolean);

    if (dashParts.length >= 2) {
      return {
        artist: dashParts[0],
        title: dashParts.slice(1).join(" - "),
      };
    }

    return { title: cleaned, artist: "Unknown" };
  }

  extractDuration(root: HTMLElement): number {
    const candidates = [
      root.querySelector("span.shrink-0")?.textContent,
      root.querySelector(".track__fulltime")?.textContent,
      root.querySelector("[class*=duration]")?.textContent,
      root.querySelector("time")?.textContent,
      root.querySelector(".section span.text-gray")?.textContent,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const parsed = this.parseDuration(candidate.trim());
      if (parsed > 0) return parsed;
    }

    return 0;
  }

  extractImage(host: string, root: HTMLElement): string {
    const ogImage =
      root
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content")
        ?.trim() || "";

    if (
      ogImage &&
      !ogImage.includes("default") &&
      !ogImage.includes("android-chrome") &&
      !ogImage.endsWith(".svg")
    ) {
      return ogImage.startsWith("http") ? ogImage : `https://${host}${ogImage}`;
    }

    const imgEl = root.querySelector(
      ".section img[src*='cover'], .section img[src*='art'], img",
    );

    if (imgEl) {
      const src = imgEl.getAttribute("src") || "";
      if (src) return src.startsWith("http") ? src : `https://${host}${src}`;
    }

    return "";
  }

  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
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

  invalidateHost(): void {
    this.hostCache.value = null;
    this.hostCache.expiresAt = 0;
    this.pageCache.clear();
  }

  async probeHost(candidateHost: string): Promise<string | null> {
    try {
      const res = await fetch(`https://${candidateHost}/`, {
        redirect: "follow",
      });

      const html = await res.text();
      const root = parse(html);

      const canonical =
        root.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
        root
          .querySelector('meta[property="og:url"]')
          ?.getAttribute("content") ||
        "";

      if (canonical) {
        try {
          return new URL(canonical).host;
        } catch {
          // ignore
        }
      }

      return new URL(res.url).host;
    } catch {
      return null;
    }
  }

  async resolveHost(forceRefresh = false): Promise<string> {
    const now = Date.now();

    if (
      !forceRefresh &&
      this.hostCache.value &&
      this.hostCache.expiresAt > now
    ) {
      return this.hostCache.value;
    }

    if (this.hostPromise && !forceRefresh) {
      return this.hostPromise;
    }

    this.hostPromise = (async (): Promise<string> => {
      const candidates = ["rus.hitmos.fm", "hitmos.fm", "www.hitmos.fm"];

      for (const candidate of candidates) {
        const host = await this.probeHost(candidate);

        if (host) {
          this.hostCache = {
            value: host,
            expiresAt: Date.now() + 30 * 60_000,
          };
          return host;
        }
      }

      const fallbackHost = "rus.hitmos.fm";
      this.hostCache = {
        value: fallbackHost,
        expiresAt: Date.now() + 10 * 60_000,
      };
      return fallbackHost;
    })();

    try {
      return await this.hostPromise;
    } finally {
      this.hostPromise = null;
    }
  }

  async fetchTrackPage(
    trackId: string,
  ): Promise<{ html: string; root: HTMLElement; host: string }> {
    const id = normalizeTrackId(trackId);
    const cacheKey = `page:${id}`;

    const cached = this.pageCache.get(cacheKey);
    if (cached) {
      const host = await this.resolveHost();
      return { html: cached, root: parse(cached), host };
    }

    try {
      const host = await this.resolveHost();

      const req = new Request({
        scheme: "https",
        host,
        port: 443,
        path: `/song/${id}`,
        headers: {
          "User-Agent": DEFAULT_HTTP_CONFIG.userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: `https://${host}/`,
          ...(this.sessionCookie && { Cookie: `sid=${this.sessionCookie}` }),
        },
      });

      const html = this.asText(
        await this.withRetry(() => this.http.get(req, "text"), {
          attempts: 3,
          retryOn: (error) => {
            const msg = String((error as any)?.message ?? error);
            return /timeout|ECONNRESET|429|5\d\d|network|ENOTFOUND|ETIMEDOUT/i.test(
              msg,
            );
          },
        }),
      );

      this.pageCache.set(cacheKey, html);
      return { html, root: parse(html), host };
    } catch (error) {
      this.invalidateHost();
      throw error;
    }
  }
}
