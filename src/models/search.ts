import type { HostProvider } from "../core/hosts.js";
import type { TrackMeta } from "./track.js";

export type SearchDiagnostic =
  | ({
      /** One attempted mirror request, including parsing and metadata filtering. */
      type: "mirror";
      provider: HostProvider;
      host: string;
      durationMs: number;
    } & ({ outcome: "success"; trackCount: number } | { outcome: "error" | "timeout" }))
  | {
      /** Entire search, including verification; zero tracks when the call rejects. */
      type: "complete";
      durationMs: number;
      trackCount: number;
    };

export interface InitializeOptions {
  /** Diagnostic search query, default "music". Must not be empty. */
  query?: string;
  /** Shared mirror-chain deadline per provider, default 1500ms. */
  searchTimeoutMs?: number;
  /** Per-instance provider cooldown after a failed search, default 300000ms. */
  cooldownMs?: number;
}

export type ProviderInitializationStatus = {
  provider: HostProvider;
  hosts: string[];
} & (
  | { status: "healthy" }
  | { status: "temporarily_disabled"; /** Unix timestamp in milliseconds. */ retryAt: number }
);

/** Snapshot of the first initialization, not live provider health. */
export interface InitializationReport {
  providers: ProviderInitializationStatus[];
}

export interface SearchOptions {
  /** Verify source candidates with at most 3 concurrent checks per search call (default true). */
  verifyAudio?: boolean;
  /** Maximum source candidates checked per search call, default 6. */
  maxProbes?: number;
  /** Combined page extraction and audio probe deadline, default 3000ms. */
  probeTimeoutMs?: number;
  /** Total search budget shared by each provider's sequential mirrors, default 5000ms. */
  searchTimeoutMs?: number;
  /** Opt-in, metadata-only diagnostics. Callback throws/rejections are ignored, never awaited. */
  onDiagnostic?: (event: SearchDiagnostic) => void | Promise<void>;
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
