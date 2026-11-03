import type { HostProvider } from "../core/hosts.js";
import type { TrackMeta } from "./track.js";

export interface SearchOptions {
  /** Verify source candidates with at most 3 concurrent checks per search call (default true). */
  verifyAudio?: boolean;
  /** Maximum source candidates checked per search call, default 6. */
  maxProbes?: number;
  /** Combined page extraction and audio probe deadline, default 3000ms. */
  probeTimeoutMs?: number;
  /** Total search budget shared by each provider's sequential mirrors, default 5000ms. */
  searchTimeoutMs?: number;
}

export interface SearchAvailability {
  status: "available" | "unavailable" | "timeout" | "error" | "unchecked";
  checkedAt?: number;
  latencyMs?: number;
  reason?: string;
}

export interface SearchSource {
  host: string;
  provider: HostProvider;
  /** Native provider ID; only meaningful together with its host. */
  id: string;
  url: string;
  availability: SearchAvailability;
  audioUrl?: string;
}

export interface SearchTrack extends TrackMeta {
  host: string;
  url: string;
  sources: SearchSource[];
}
