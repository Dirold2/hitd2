import type { HITApiOptions, StreamTrackOptions } from "../models/stream.js";
import type { Album } from "../models/album.js";
import type { InitializeOptions, InitializationReport, SearchOptions, SearchTrack } from "../models/search.js";
import type { TrackMeta } from "../models/track.js";
import type { TrackAudio } from "../models/audio.js";
export declare class HITApi {
    private readonly http;
    private readonly retry;
    private readonly providers;
    private readonly sourceQuality;
    private readonly providerRetryAt;
    private cooldownMs;
    private initialization?;
    private readonly fetchProbe?;
    private sessionCookie?;
    private readonly fetchStream?;
    /** Stores detailed track metadata. Search results are kept separately. */
    private readonly trackCache;
    /** Allows getTrack() to use metadata found during search. */
    private readonly searchTrackCache;
    private readonly sourceHosts;
    private readonly audioCache;
    constructor(options?: HITApiOptions);
    /** First call wins; provider outages are reported, not thrown. */
    initialize(options?: InitializeOptions): Promise<InitializationReport>;
    private searchGroups;
    private searchProvider;
    setSessionCookie(cookie: string): void;
    private classifyVersionCandidates;
    private buildHeaders;
    private providerFor;
    private fetchSearchHtml;
    /**
     * Verifies one source and updates the instance-level host quality history.
     * Latency includes track-page extraction plus the small MP3 probe.
     */
    private verifySource;
    search(query: string, limit?: number, options?: SearchOptions): Promise<SearchTrack[]>;
    private sourceHost;
    private parseTrackUrl;
    getAlbumByUrl(url: string): Promise<Album>;
    getTrackByUrl(url: string): Promise<TrackMeta>;
    getAudioByUrl(url: string): Promise<TrackAudio>;
    getTrack(trackId: string, preferredHost?: string): Promise<TrackMeta>;
    /** Lazy, backpressured audio bytes. Each call is an independent opening. */
    streamTrack(trackId: string, options?: StreamTrackOptions, signal?: AbortSignal): AsyncGenerator<Uint8Array>;
    getAudio(trackId: string, preferredHost?: string): Promise<TrackAudio>;
}
export default HITApi;
//# sourceMappingURL=HITApi.d.ts.map