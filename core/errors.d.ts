export type AlbumErrorCode = "ALBUM_NOT_FOUND" | "ALBUM_HTTP_ERROR" | "ALBUM_INVALID_DATA";
export declare class AlbumError extends Error {
    readonly code: AlbumErrorCode;
    readonly albumId: string;
    readonly host: string;
    readonly status?: number | undefined;
    constructor(code: AlbumErrorCode, albumId: string, host: string, detail: string, status?: number | undefined);
}
export declare class TrackNotFoundError extends Error {
    readonly trackId: string;
    readonly host?: string;
    readonly status: 404 | 410;
    constructor(trackId: string, status?: 404 | 410, host?: string);
}
/** The page did not provide one unambiguous, track-bound trusted audio URL. */
export declare class AudioExtractionError extends Error {
    readonly trackId: string;
    readonly host: string;
    readonly code = "AUDIO_NOT_VERIFIED";
    constructor(trackId: string, host: string);
}
//# sourceMappingURL=errors.d.ts.map