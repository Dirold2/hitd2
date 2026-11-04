import type { HyperClient } from "hyperttp";

export interface HITApiOptions {
  httpClient?: HyperClient;
  sessionCookie?: string;
  /** Transport for provider pages and audio probes (legacy behavior). */
  fetch?: typeof globalThis.fetch;
  /** Streaming transport; defaults to fetch above, then global fetch. */
  fetchAudio?: typeof globalThis.fetch;
}

/** Quality of the exact selected file; never includes signed URLs. */
export interface StreamTrackAudio {
  format?: string;
  bitrateKbps?: number;
}

export interface StreamTrackOptions {
  /** Called once after HTTP success, before reading bytes. Not proof of playable audio. */
  onAudio?: (audio: StreamTrackAudio) => void;
}
