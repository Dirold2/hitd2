import { isValidAudioUrl } from "./filters.js";

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

const SAMPLE_SIZE = 4096;
const MAX_REDIRECTS = 5;

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
      a === 0xff &&
      (b & 0xe0) === 0xe0 &&
      (b & 0x18) !== 0x08 &&
      (b & 0x06) === 0x02 &&
      (c & 0xf0) !== 0 &&
      (c & 0xf0) !== 0xf0 &&
      (c & 0x0c) !== 0x0c &&
      (d & 0x03) !== 0x02
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks a small MP3 sample.
 *
 * This verifies the beginning of an audio response,
 * not the completeness of the recording.
 */
export async function probeAudio(
  url: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
  } = {},
): Promise<AudioProbeResult> {
  const started = performance.now();

  let requestMs = 0;
  let bodyReadMs = 0;
  let firstByteMs: number | undefined;
  let bytesRead = 0;
  let redirects = 0;
  let httpStatus: number | undefined;

  const result = (status: AudioProbeResult["status"], reason?: string): AudioProbeResult => ({
    status,
    checkedAt: Date.now(),
    latencyMs: Math.max(0, performance.now() - started),
    requestMs,
    bodyReadMs,
    ...(firstByteMs !== undefined ? { firstByteMs } : {}),
    bytesRead,
    redirects,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(reason !== undefined ? { reason } : {}),
  });

  if (!isValidAudioUrl(url)) {
    return result("unavailable", "Untrusted audio URL");
  }

  const timeoutMs = options.timeoutMs ?? 3000;

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) {
    return result("error", "Invalid timeoutMs");
  }

  const controller = new AbortController();

  let timedOut = false;

  const parentAbort = () => {
    controller.abort(options.signal?.reason);
  };

  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("Probe aborted")), {
      once: true,
    });
  });

  // Prevent an unhandled rejection if the parent is already aborted.
  void aborted.catch(() => undefined);

  options.signal?.addEventListener("abort", parentAbort, {
    once: true,
  });

  if (options.signal?.aborted) {
    parentAbort();
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Audio probe deadline exceeded", "TimeoutError"));
  }, timeoutMs);

  const cancel = (body: ReadableStream<Uint8Array> | null): void => {
    if (body) {
      void body.cancel().catch(() => undefined);
    }
  };

  try {
    const fetchAudio = options.fetch ?? globalThis.fetch;

    for (;;) {
      controller.signal.throwIfAborted();

      const requestStarted = performance.now();

      let response: Response;

      try {
        const pending = fetchAudio(url, {
          method: "GET",
          headers: {
            Range: `bytes=0-${SAMPLE_SIZE - 1}`,
          },
          redirect: "manual",
          credentials: "omit",
          signal: controller.signal,
        });

        // Dispose of responses from fetch implementations
        // that resolve after cancellation.
        void pending.then(
          (lateResponse) => {
            if (controller.signal.aborted) {
              cancel(lateResponse.body);
            }
          },
          () => undefined,
        );

        response = await Promise.race([pending, aborted]);
      } finally {
        requestMs += performance.now() - requestStarted;
      }

      httpStatus = response.status;

      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

      try {
        if (response.body) {
          reader = response.body.getReader();
        }

        // Redirect handling.
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          redirects++;

          const location = response.headers.get("location");

          if (!location || redirects > MAX_REDIRECTS) {
            return result("unavailable", "Invalid or excessive redirects");
          }

          let next: string;

          try {
            next = new URL(location, url).href;
          } catch {
            return result("unavailable", "Invalid audio redirect");
          }

          if (!isValidAudioUrl(next)) {
            return result("unavailable", "Untrusted audio redirect");
          }

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

        if (!reader) {
          return result("unavailable", "Empty audio body");
        }

        const sample = new Uint8Array(SAMPLE_SIZE);
        let length = 0;

        while (length < SAMPLE_SIZE) {
          controller.signal.throwIfAborted();

          const readStarted = performance.now();

          let chunk: ReadableStreamReadResult<Uint8Array>;

          try {
            chunk = await Promise.race([reader.read(), aborted]);
          } finally {
            bodyReadMs += performance.now() - readStarted;
          }

          if (chunk.done) break;

          if (firstByteMs === undefined && chunk.value.length > 0) {
            firstByteMs = performance.now() - started;
          }

          const count = Math.min(chunk.value.length, SAMPLE_SIZE - length);

          if (count === 0) continue;

          sample.set(chunk.value.subarray(0, count), length);

          length += count;
          bytesRead += count;

          if (hasMp3Signature(sample.subarray(0, length))) {
            return result("available");
          }
        }

        return result(
          "unavailable",
          length === 0 ? "Empty audio body" : "No MP3 signature in sample",
        );
      } finally {
        // Never wait for stream cancellation.
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
