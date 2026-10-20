import { HyperClient } from "hyperttp";
import type { TrackMeta } from "../models/track.js";
import type { TrackAudio } from "../models/audio.js";
export declare class HITApi {
    private readonly http;
    private readonly retry;
    private readonly providers;
    private sessionCookie?;
    private readonly trackCache;
    private readonly searchCache;
    private readonly audioCache;
    constructor(options?: {
        httpClient?: HyperClient;
        sessionCookie?: string;
    });
    setSessionCookie(cookie: string): void;
    private buildHeaders;
    private fetchSearchHtml;
    private providerFor;
    private findTrackInSearchCache;
    private searchCacheValues;
    search(query: string, limit?: number): Promise<TrackMeta[]>;
    private parseTrackUrl;
    getTrackByUrl(url: string): Promise<TrackMeta>;
    getAudioByUrl(url: string): Promise<TrackAudio>;
    getTrack(trackId: string, preferredHost?: string): Promise<TrackMeta>;
    getAudio(trackId: string, preferredHost?: string): Promise<TrackAudio>;
}
export default HITApi;
//# sourceMappingURL=HITApi.d.ts.map