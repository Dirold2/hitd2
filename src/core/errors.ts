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
