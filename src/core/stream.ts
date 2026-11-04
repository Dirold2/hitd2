import type { TrackAudio } from "../models/audio.js";
import type { StreamTrackOptions } from "../models/stream.js";

/** Each iterator owns its cancellation, including return() while next() is blocked. */
export function streamAudio(
  resolve: () => Promise<TrackAudio>,
  fetchAudio: typeof globalThis.fetch,
  options: StreamTrackOptions,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const abort = new AbortController();
  const aborted = () => new DOMException("Hitmo audio stream aborted", "AbortError");
  const generator = (async function* (): AsyncGenerator<Uint8Array> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    const cancelReader = () => {
      const current = reader;
      reader = undefined;
      if (!current) return;
      // Do not hold the caller on a remote cancellation handshake.
      void current
        .cancel()
        .finally(() => current.releaseLock())
        .catch(() => {});
    };
    abort.signal.addEventListener("abort", cancelReader, { once: true });
    const onAbort = () => abort.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) abort.abort();
    const wait = <T>(value: Promise<T>): Promise<T> =>
      new Promise((resolve, reject) => {
        const cancelled = () => {
          cleanup();
          reject(aborted());
        };
        const cleanup = () => abort.signal.removeEventListener("abort", cancelled);
        abort.signal.addEventListener("abort", cancelled, { once: true });
        if (abort.signal.aborted) cancelled();
        value.then(
          (result) => {
            cleanup();
            resolve(result);
          },
          (error: unknown) => {
            cleanup();
            reject(error);
          },
        );
      });
    try {
      if (abort.signal.aborted) throw aborted();
      const audio = await wait(resolve());
      if (abort.signal.aborted) throw aborted();
      const response = await wait(
        Promise.resolve(
          fetchAudio(audio.url, {
            signal: abort.signal,
            credentials: "omit",
          }),
        ).then((response) => {
          // Injected transports may ignore abort and resolve after cancellation.
          if (abort.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            throw aborted();
          }
          return response;
        }),
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new Error(`Hitmo audio HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Hitmo audio body missing");
      reader = response.body.getReader();
      const file = audio.files?.find((file) => file.url === audio.url);
      const format = file?.format?.trim() || audio.format?.trim();
      const bitrate = file?.bitrate;
      options.onAudio?.({
        ...(format ? { format } : {}),
        ...(typeof bitrate === "number" && Number.isFinite(bitrate) && bitrate > 0
          ? { bitrateKbps: bitrate }
          : {}),
      });
      while (true) {
        if (abort.signal.aborted) throw aborted();
        const chunk = await wait(reader.read());
        if (abort.signal.aborted) throw aborted();
        if (chunk.done) {
          complete = true;
          return;
        }
        if (chunk.value.byteLength) yield chunk.value;
      }
    } catch {
      // Never expose transport/provider errors, causes, or arbitrary abort reasons with URLs.
      if (abort.signal.aborted) throw aborted();
      throw new Error("Hitmo audio stream unavailable");
    } finally {
      signal?.removeEventListener("abort", onAbort);
      abort.signal.removeEventListener("abort", cancelReader);
      if (complete) {
        reader?.releaseLock();
        reader = undefined;
      } else cancelReader();
      abort.abort();
    }
  })();
  const finish = generator.return.bind(generator);
  generator.return = (value) => {
    abort.abort();
    return finish(value);
  };
  const fail = generator.throw.bind(generator);
  generator.throw = (error) => {
    abort.abort();
    return fail(error);
  };
  return generator;
}
