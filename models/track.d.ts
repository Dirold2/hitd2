export interface TrackAlbumReference {
    /** Provider-specific album ID. */
    id: string;
    /** Album title when supplied by the provider. */
    title?: string;
    /** Provider-qualified album URI, e.g. hitmos:album:7148463. */
    uri: string;
}
export interface TrackMeta {
    id: string;
    title: string;
    artist: string;
    duration: number;
    uri: string;
    name: string;
    duration_ms: number;
    explicit: boolean;
    image?: string;
    /** Raw recording version label supplied by the provider. */
    version?: string;
    /** Explicitly confirmed album relationships. */
    albums?: TrackAlbumReference[];
}
//# sourceMappingURL=track.d.ts.map