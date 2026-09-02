import { HyperClient } from "hyperttp";
import { type HtmlElement } from "./html.js";
export interface HostCacheState {
    value: string | null;
    expiresAt: number;
}
export declare class Retry {
    private readonly inflight;
    private readonly pageCache;
    private readonly http;
    private sessionCookie?;
    private hostPromise;
    private hostCache;
    constructor(options?: {
        httpClient?: HyperClient;
        sessionCookie?: string;
    });
    setSessionCookie(cookie: string): void;
    private sleep;
    withRetry<T>(fn: () => Promise<T>, options?: {
        attempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        retryOn?: (error: unknown) => boolean;
    }): Promise<T>;
    asText(value: unknown): string;
    normalizeText(value?: string | null): string;
    parseDuration(durationStr: string): number;
    parseOgTitle(ogTitle: string): {
        title: string;
        artist: string;
    };
    extractDuration(root: HtmlElement): number;
    extractImage(host: string, root: HtmlElement): string;
    private extractRscImage;
    dedupe<T>(key: string, fn: () => Promise<T>): Promise<T>;
    invalidateHost(): void;
    probeHost(candidateHost: string): Promise<string | null>;
    resolveHost(forceRefresh?: boolean): Promise<string>;
    fetchTrackPage(trackId: string, preferredHost?: string): Promise<{
        html: string;
        root: HtmlElement;
        host: string;
    }>;
}
//# sourceMappingURL=retry.d.ts.map