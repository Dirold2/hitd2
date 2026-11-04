export interface AudioProbeResult {
    status: "available" | "unavailable" | "timeout" | "error";
    checkedAt: number;
    latencyMs: number;
    reason?: string;
}
/** Checks only a small MP3 sample, not the completeness of a recording. */
export declare function probeAudio(url: string, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}): Promise<AudioProbeResult>;
//# sourceMappingURL=audio-probe.d.ts.map