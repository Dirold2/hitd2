export type AlbumErrorCode = "ALBUM_NOT_FOUND" | "ALBUM_HTTP_ERROR" | "ALBUM_INVALID_DATA";

export class AlbumError extends Error {
  constructor(
    readonly code: AlbumErrorCode,
    readonly albumId: string,
    readonly host: string,
    detail: string,
    readonly status?: number,
  ) {
    super(`Album ${albumId} on ${host}: ${detail}`);
    this.name = "AlbumError";
  }
}

export class TrackNotFoundError extends Error {
  readonly trackId: string;
  readonly host?: string;
  readonly status: 404 | 410;

  constructor(trackId: string, status: 404 | 410 = 404, host?: string) {
    super(`Track ${trackId} was not found${host ? ` on ${host}` : ""} (HTTP ${status})`);
    this.name = "TrackNotFoundError";
    this.trackId = trackId;
    this.host = host;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The page did not provide one unambiguous, track-bound trusted audio URL. */
export class AudioExtractionError extends Error {
  readonly code = "AUDIO_NOT_VERIFIED";
  constructor(
    readonly trackId: string,
    readonly host: string,
  ) {
    super(`Failed to extract verified audio URL for track ${trackId} on ${host}`);
    this.name = "AudioExtractionError";
  }
}
