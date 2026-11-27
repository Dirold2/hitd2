export interface AudioProbeResult {
    status: "available" | "unavailable" | "timeout" | "error";
    checkedAt: number;
    latencyMs: number;
    /** Time spent waiting for HTTP response headers, including redirects. */
    requestMs: number;
    /** Time spent waiting for response body chunks. */
    bodyReadMs: number;
    /** Time from probe start until the first non-empty body chunk. */
    firstByteMs?: number;
    /** Number of bytes inspected from the response body. */
    bytesRead: number;
    /** Number of HTTP redirects encountered. */
    redirects: number;
    /** Last received HTTP status. */
    httpStatus?: number;
    reason?: string;
}
/**
 * Checks a small MP3 sample.
 *
 * This verifies the beginning of an audio response,
 * not the completeness of the recording.
 */
export declare function probeAudio(url: string, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}): Promise<AudioProbeResult>;
//# sourceMappingURL=audio-probe.d.ts.map