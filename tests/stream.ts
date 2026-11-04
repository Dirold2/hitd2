import assert from "node:assert/strict";
import { HITApi } from "../src/index.js";
import type { TrackAudio, StreamTrackAudio } from "../src/index.js";

const url = "https://cdn.example/song?signature=secret";
const audio: TrackAudio = {
  id: "42",
  url,
  format: "wrong",
  urls: [url],
  expiresAt: 0,
  files: [
    { url: "other", format: "flac", bitrate: 999 },
    { url, format: "ogg", bitrate: 192 },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function promptly<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("blocked cancellation")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function fixture(fetchAudio: typeof fetch, resolve = async () => audio) {
  const api = new HITApi({
    fetchAudio,
    fetch: (() => {
      throw new Error("wrong transport");
    }) as typeof fetch,
  });
  api.getAudio = resolve;
  return api;
}

// Lazy resolution, exact metadata, no read-ahead, empty chunks, EOF unlock.
{
  let resolutions = 0,
    requests = 0,
    pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        pulls++;
        if (pulls === 4) c.close();
        else c.enqueue(new Uint8Array(pulls === 1 ? [] : [pulls]));
      },
    },
    { highWaterMark: 0 },
  );
  const api = fixture(
    (async (_, init) => {
      requests++;
      assert.equal(init?.credentials, "omit");
      return new Response(body);
    }) as typeof fetch,
    async () => {
      resolutions++;
      return audio;
    },
  );
  let quality: StreamTrackAudio | undefined;
  const stream = api.streamTrack("42", {
    onAudio: (value) => {
      quality = value;
    },
  });
  assert.equal(resolutions + requests + pulls, 0);
  assert.deepEqual((await stream.next()).value, new Uint8Array([2]));
  assert.deepEqual(quality, { format: "ogg", bitrateKbps: 192 });
  await flush();
  assert.equal(pulls, 2);
  await stream.next();
  assert.equal(pulls, 3);
  assert.equal((await stream.next()).done, true);
  assert.equal(body.locked, false);
}

// Pre-abort and return before first next never start work.
{
  const api = fixture(
    (() => {
      throw new Error("request");
    }) as typeof fetch,
    async () => {
      throw new Error("resolution");
    },
  );
  const abort = new AbortController();
  abort.abort(url);
  await assert.rejects(api.streamTrack("42", {}, abort.signal).next(), { name: "AbortError" });
  const stream = api.streamTrack("42");
  await stream.return(undefined);
  assert.equal((await stream.next()).done, true);
}

// Abort/return unblock resolution, fetch, and reads, even when cleanup rejects.
for (const phase of ["resolve", "fetch", "read", "yield"] as const) {
  for (const method of ["abort", "return"] as const) {
    const resolution = deferred<TrackAudio>();
    const response = deferred<Response>();
    const cancellation = deferred<void>();
    let requests = 0,
      cancels = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          if (phase === "yield") c.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancels++;
          return cancellation.promise;
        },
      },
      { highWaterMark: 0 },
    );
    const api = fixture(
      (async () => {
        requests++;
        return phase === "fetch" ? response.promise : new Response(body);
      }) as typeof fetch,
      () => (phase === "resolve" ? resolution.promise : Promise.resolve(audio)),
    );
    const abort = new AbortController();
    const stream = api.streamTrack("42", {}, abort.signal);
    const reading = stream.next();
    const rejection = phase === "yield" ? reading : assert.rejects(reading, { name: "AbortError" });
    await flush();
    if (phase === "yield") await reading;
    if (method === "abort") abort.abort(url);
    else await promptly(stream.return(undefined));
    await promptly(rejection);
    if (phase === "yield") assert.equal(cancels, 1);
    if (method === "abort" && phase === "yield") {
      await assert.rejects(stream.next(), { name: "AbortError" });
    }
    resolution.resolve(audio);
    if (phase === "fetch") response.resolve(new Response(body));
    await flush();
    if (phase === "resolve") assert.equal(requests, 0);
    else assert.equal(cancels, 1);
    if (phase === "resolve") cancellation.resolve();
    else cancellation.reject(new Error(url));
    await flush();
    assert.equal(body.locked, false);
  }
}

// Bad status, missing body, provider/fetch/callback failures never expose signed URLs.
for (const failure of ["status", "body", "resolve", "fetch", "callback"] as const) {
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancels++;
    },
  });
  const api = fixture(
    (async () => {
      if (failure === "fetch") throw new Error(url);
      return new Response(failure === "body" ? null : body, {
        status: failure === "status" ? 403 : 200,
      });
    }) as typeof fetch,
    async () => {
      if (failure === "resolve") throw new Error(url);
      return audio;
    },
  );
  await assert.rejects(
    api
      .streamTrack("42", {
        onAudio() {
          if (failure === "callback") throw new Error(url);
        },
      })
      .next(),
    { message: "Hitmo audio stream unavailable" },
  );
  await flush();
  if (failure === "status" || failure === "callback") assert.equal(cancels, 1);
  assert.equal(body.locked, false);
}
// Simultaneous openings share neither HTTP signals nor reader cancellation.
{
  const signals: AbortSignal[] = [];
  let cancels = 0;
  const api = fixture((async (_, init) => {
    signals.push(init!.signal!);
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(c) {
            c.enqueue(new Uint8Array([signals.length]));
          },
          cancel() {
            cancels++;
          },
        },
        { highWaterMark: 0 },
      ),
    );
  }) as typeof fetch);
  const first = api.streamTrack("42");
  const second = api.streamTrack("42");
  await Promise.all([first.next(), second.next()]);
  assert.notEqual(signals[0], signals[1]);
  await first.return(undefined);
  assert.equal(signals[0]!.aborted, true);
  assert.equal(signals[1]!.aborted, false);
  assert.equal(cancels, 1);
  assert.equal((await second.next()).done, false);
  await second.return(undefined);
  assert.equal(cancels, 2);
}
console.log("stream tests passed");
