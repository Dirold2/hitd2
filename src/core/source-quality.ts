import type { SearchAvailability, SearchSource } from "../models/search.js";

interface HostHealth {
  attempts: number;
  successes: number;
  averageLatencyMs?: number;
  lastCheckedAt: number;
}

interface HealthSnapshot {
  reliability: number;
  attempts: number;
  averageLatencyMs?: number;
}

const STATUS_PRIORITY: Record<SearchAvailability["status"], number> = {
  available: 5,
  unchecked: 4,
  timeout: 3,
  error: 2,
  unavailable: 1,
};

const HEALTH_HALF_LIFE_MS = 30 * 60_000;
const LATENCY_EWMA_ALPHA = 0.25;

function validLatency(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function compareLatency(a: number | undefined, b: number | undefined): number {
  if (validLatency(a) && validLatency(b)) return a - b;
  if (validLatency(a)) return -1;
  if (validLatency(b)) return 1;
  return 0;
}

/**
 * Ranks audio sources using current verification results and in-memory
 * historical host reliability. History is scoped to one HITApi instance.
 */
export class SourceQualityRanker {
  private readonly hosts = new Map<string, HostHealth>();

  private hostKey(source: SearchSource): string {
    return `${source.provider}:${source.host}`;
  }

  /** Records one completed source verification. */
  record(source: SearchSource): void {
    const availability = source.availability;

    if (availability.status === "unchecked") return;

    const key = this.hostKey(source);
    const previous = this.hosts.get(key);
    const success = availability.status === "available";
    const attempts = (previous?.attempts ?? 0) + 1;
    const successes = (previous?.successes ?? 0) + Number(success);

    let averageLatencyMs = previous?.averageLatencyMs;

    // Only successful probes contribute to successful-resolution latency.
    if (success && validLatency(availability.latencyMs)) {
      averageLatencyMs =
        averageLatencyMs === undefined
          ? availability.latencyMs
          : averageLatencyMs + (availability.latencyMs - averageLatencyMs) * LATENCY_EWMA_ALPHA;
    }

    this.hosts.set(key, {
      attempts,
      successes,
      averageLatencyMs,
      lastCheckedAt: availability.checkedAt ?? Date.now(),
    });
  }

  private getHealth(source: SearchSource, now: number): HealthSnapshot {
    const health = this.hosts.get(this.hostKey(source));

    if (!health) {
      return { reliability: 0.5, attempts: 0 };
    }

    // Laplace smoothing prevents extreme confidence after very few probes.
    const historicalReliability = (health.successes + 1) / (health.attempts + 2);

    // Old observations gradually move back toward neutral (0.5).
    const age = Math.max(0, now - health.lastCheckedAt);
    const freshness = Math.exp(-age / HEALTH_HALF_LIFE_MS);
    const reliability = 0.5 + (historicalReliability - 0.5) * freshness;

    return {
      reliability,
      attempts: health.attempts,
      averageLatencyMs: health.averageLatencyMs,
    };
  }

  /** Negative means `a` should be preferred over `b`. */
  compare(a: SearchSource, b: SearchSource): number {
    const statusA = a.availability.status;
    const statusB = b.availability.status;

    // Current verification status always outranks historical estimates.
    const statusDifference = STATUS_PRIORITY[statusB]! - STATUS_PRIORITY[statusA]!;

    if (statusDifference !== 0) return statusDifference;

    // For currently available sources, prefer the faster current probe.
    if (statusA === "available") {
      const latencyDifference = compareLatency(a.availability.latencyMs, b.availability.latencyMs);

      if (latencyDifference !== 0) return latencyDifference;
    }

    const now = Date.now();
    const healthA = this.getHealth(a, now);
    const healthB = this.getHealth(b, now);

    const reliabilityDifference = healthB.reliability - healthA.reliability;

    if (Math.abs(reliabilityDifference) > Number.EPSILON) {
      return reliabilityDifference;
    }

    if (healthA.attempts !== healthB.attempts) {
      return healthB.attempts - healthA.attempts;
    }

    const historicalLatencyDifference = compareLatency(
      healthA.averageLatencyMs,
      healthB.averageLatencyMs,
    );

    if (historicalLatencyDifference !== 0) {
      return historicalLatencyDifference;
    }

    const checkedA = a.availability.checkedAt ?? 0;
    const checkedB = b.availability.checkedAt ?? 0;
    return checkedB - checkedA;
  }

  /** Returns a ranked copy and preserves original order for exact ties. */
  sort(sources: readonly SearchSource[]): SearchSource[] {
    return sources
      .map((source, index) => ({ source, index }))
      .sort((a, b) => this.compare(a.source, b.source) || a.index - b.index)
      .map(({ source }) => source);
  }
}
