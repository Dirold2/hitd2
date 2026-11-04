import { HyperClient } from "hyperttp";
import type { Album } from "../models/album.js";
import type { InitializeOptions, InitializationReport, SearchOptions, SearchTrack } from "../models/search.js";
import type { TrackMeta } from "../models/track.js";
import type { TrackAudio } from "../models/audio.js";
export declare class HITApi {
    private readonly http;
    private readonly retry;
    private readonly providers;
    private readonly providerRetryAt;
    private cooldownMs;
    private initialization?;
    private sessionCookie?;
    private readonly fetchAudio?;
    /**
     * Stores detailed track metadata.
     * Search results are kept separately.
     */
    private readonly trackCache;
    /**
     * Allows getTrack() to use metadata found during search without inspecting
     * CacheManager internals.
     */
    private readonly searchTrackCache;
    private readonly sourceHosts;
    private readonly audioCache;
    constructor(options?: {
        httpClient?: HyperClient;
        sessionCookie?: string;
        fetch?: typeof globalThis.fetch;
    });
    /** First call wins; provider outages are reported, not thrown. */
    initialize(options?: InitializeOptions): Promise<InitializationReport>;
    private searchGroups;
    private searchProvider;
    setSessionCookie(cookie: string): void;
    private buildHeaders;
    private providerFor;
    private fetchSearchHtml;
    private verifySource;
    search(query: string, limit?: number, options?: SearchOptions): Promise<SearchTrack[]>;
    private sourceHost;
    private parseTrackUrl;
    getAlbumByUrl(url: string): Promise<Album>;
    getTrackByUrl(url: string): Promise<TrackMeta>;
    getAudioByUrl(url: string): Promise<TrackAudio>;
    getTrack(trackId: string, preferredHost?: string): Promise<TrackMeta>;
    getAudio(trackId: string, preferredHost?: string): Promise<TrackAudio>;
}
export default HITApi;
//# sourceMappingURL=HITApi.d.ts.map