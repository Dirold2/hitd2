import { isValidAudioUrl } from "./filters.js";

export interface AudioProbeResult {
  status: "available" | "unavailable" | "timeout" | "error";
  checkedAt: number;
  latencyMs: number;
  reason?: string;
}

function hasMp3Signature(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return true;
  }
  for (let i = 0; i + 3 < bytes.length; i++) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    const c = bytes[i + 2]!;
    const d = bytes[i + 3]!;
    if (
      a === 0xff && (b & 0xe0) === 0xe0 &&
      (b & 0x18) !== 0x08 && (b & 0x06) === 0x02 &&
      (c & 0xf0) !== 0 && (c & 0xf0) !== 0xf0 &&
      (c & 0x0c) !== 0x0c && (d & 0x03) !== 0x02
    ) return true;
  }
  return false;
}

/** Checks only a small MP3 sample, not the completeness of a recording. */
export async function probeAudio(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number; fetch?: typeof globalThis.fetch } = {},
): Promise<AudioProbeResult> {
  const started = performance.now();
  const result = (status: AudioProbeResult["status"], reason?: string): AudioProbeResult => ({
    status,
    checkedAt: Date.now(),
    latencyMs: Math.max(0, performance.now() - started),
    ...(reason === undefined ? {} : { reason }),
  });
  if (!isValidAudioUrl(url)) return result("unavailable", "Untrusted audio URL");
  const timeoutMs = options.timeoutMs ?? 3000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
    return result("error", "Invalid timeoutMs");
  }

  const controller = new AbortController();
  let timedOut = false;
  const parentAbort = () => controller.abort(options.signal?.reason);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("Probe aborted")), {
      once: true,
    });
  });
  // A pre-aborted parent must not cause an unhandled rejection before the first race.
  void aborted.catch(() => undefined);
  options.signal?.addEventListener("abort", parentAbort, { once: true });
  if (options.signal?.aborted) parentAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = (body: ReadableStream<Uint8Array> | null) => {
    if (body) void body.cancel().catch(() => undefined);
  };

  try {
    const fetchAudio = options.fetch ?? globalThis.fetch;
    for (let redirects = 0; ; redirects++) {
      controller.signal.throwIfAborted();
      const pending = fetchAudio(url, {
        method: "GET",
        headers: { Range: "bytes=0-4095" },
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      });
      // Also dispose of a late response from a fetch implementation ignoring abort.
      void pending.then((response) => {
        if (controller.signal.aborted) cancel(response.body);
      }, () => undefined);
      const response = await Promise.race([pending, aborted]);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        if (response.body) reader = response.body.getReader();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location || redirects >= 5) return result("unavailable", "Invalid or excessive redirects");
          let next: string;
          try {
            next = new URL(location, url).href;
          } catch {
            return result("unavailable", "Invalid audio redirect");
          }
          if (!isValidAudioUrl(next)) return result("unavailable", "Untrusted audio redirect");
          url = next;
          continue;
        }
        if (response.status === 404 || response.status === 410) {
          return result("unavailable", `HTTP ${response.status}`);
        }
        if (response.status !== 200 && response.status !== 206) {
          return result("error", `HTTP ${response.status}`);
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (/text\/|html|json|xml/.test(contentType)) {
          return result("unavailable", "Non-audio content type");
        }
        if (!reader) return result("unavailable", "Empty audio body");
        const sample = new Uint8Array(4096);
        let length = 0;
        while (length < sample.length) {
          const chunk = await Promise.race([reader.read(), aborted]);
          if (chunk.done) break;
          const count = Math.min(chunk.value.length, sample.length - length);
          sample.set(chunk.value.subarray(0, count), length);
          length += count;
          if (hasMp3Signature(sample.subarray(0, length))) return result("available");
        }
        return result("unavailable", length === 0 ? "Empty audio body" : "No MP3 signature in sample");
      } finally {
        // Do not await cancellation: an underlying source may never settle it.
        if (reader) {
          void reader.cancel().catch(() => undefined);
          reader.releaseLock();
        } else {
          cancel(response.body);
        }
      }
    }
  } catch {
    return timedOut
      ? result("timeout", "Audio probe deadline exceeded")
      : result("error", controller.signal.aborted ? "Audio probe aborted" : "Audio probe failed");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", parentAbort);
    controller.abort();
  }
}
