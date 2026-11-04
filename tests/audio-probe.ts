import assert from "node:assert/strict";
import { probeAudio } from "../src/core/audio-probe.js";

const url = "https://pl1.hitmos.fm/track.mp3";
const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);
const frame = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const encode = (text: string) => new TextEncoder().encode(text);

function streamed(chunks: Uint8Array[], status = 206, headers: HeadersInit = {}) {
  let pulls = 0;
  let cancels = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[pulls++];
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
        cancel() {
          cancels++;
        },
      },
      { highWaterMark: 0 },
    ),
    { status, headers },
  );
  return { response, pulls: () => pulls, cancels: () => cancels };
}

function injected(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input, init) => {
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).get("range"), "bytes=0-4095");
    assert(init?.signal instanceof AbortSignal);
    return handler(String(input), init);
  }) as typeof fetch;
}

for (const chunks of [
  [id3],
  [frame],
  [id3.subarray(0, 1), id3.subarray(1)],
  [encode("padding"), frame],
]) {
  const body = streamed(chunks);
  const before = Date.now();
  const result = await probeAudio(url, { fetch: injected(() => body.response) });
  assert.equal(result.status, "available");
  assert(result.checkedAt >= before && result.checkedAt <= Date.now());
  assert(result.latencyMs >= 0 && Number.isFinite(result.latencyMs));
  assert.equal(body.cancels(), 1);
  assert.equal(body.response.body?.locked, false);
}

for (const contentType of [
  "text/html",
  "text/plain",
  "application/json",
  "application/problem+json",
  "application/xml",
  "image/svg+xml",
]) {
  const body = streamed([id3], 200, { "Content-Type": contentType });
  assert.equal(
    (await probeAudio(url, { fetch: injected(() => body.response) })).status,
    "unavailable",
  );
  assert.equal(body.pulls(), 0);
  assert.equal(body.cancels(), 1);
}

for (const chunks of [
  [],
  [encode("<!doctype html><html>Not audio</html>")],
  [new Uint8Array([0xff, 0xff, 0xff, 0xff])],
  [new Uint8Array([0xff, 0xfb, 0, 0])],
  [new Uint8Array([0xff, 0xf3, 0x9c, 0])],
]) {
  const body = streamed(chunks);
  assert.equal(
    (await probeAudio(url, { fetch: injected(() => body.response) })).status,
    "unavailable",
  );
  assert.equal(body.response.body?.locked, false);
}
assert.equal(
  (await probeAudio(url, { fetch: injected(() => new Response(null)) })).status,
  "unavailable",
);

for (const [status, expected] of [
  [404, "unavailable"],
  [410, "unavailable"],
  [429, "error"],
  [500, "error"],
  [503, "error"],
  [403, "error"],
  [204, "error"],
] as const) {
  const body = status === 204 ? null : streamed([id3], status);
  assert.equal(
    (
      await probeAudio(url, {
        fetch: injected(() => body?.response ?? new Response(null, { status })),
      })
    ).status,
    expected,
  );
  if (body) assert.equal(body.cancels(), 1);
}

// A server ignoring Range cannot force a second read or signature scanning beyond 4096 bytes.
for (const chunks of [
  [new Uint8Array(4096), id3],
  [new Uint8Array([...new Uint8Array(4096), ...id3])],
]) {
  const body = streamed(chunks, 200);
  assert.equal(
    (await probeAudio(url, { fetch: injected(() => body.response) })).status,
    "unavailable",
  );
  assert.equal(body.pulls(), 1);
  assert.equal(body.cancels(), 1);
}

for (const status of [301, 302, 303, 307, 308]) {
  const redirect = streamed([], status, { location: "/next.mp3" });
  const audio = streamed([frame]);
  const urls: string[] = [];
  const result = await probeAudio(url, {
    fetch: injected((input) => {
      urls.push(input);
      return urls.length === 1 ? redirect.response : audio.response;
    }),
  });
  assert.equal(result.status, "available");
  assert.deepEqual(urls, [url, "https://pl1.hitmos.fm/next.mp3"]);
  assert.equal(redirect.cancels(), 1);
  assert.equal(audio.cancels(), 1);
}

for (const location of [
  "https://evil.test/a.mp3",
  "https://pl1.hitmos.fm.evil.test/a.mp3",
  "https://user:pass@pl1.hitmos.fm/a.mp3",
  "file:///a.mp3",
  "http://[",
  "",
]) {
  let calls = 0;
  const body = streamed([], 302, { location });
  assert.equal(
    (
      await probeAudio(url, {
        fetch: injected(() => {
          calls++;
          return body.response;
        }),
      })
    ).status,
    "unavailable",
  );
  assert.equal(calls, 1);
  assert.equal(body.cancels(), 1);
}
for (const initial of [
  "not a url",
  "https://evil.test/a.mp3",
  "https://user@pl1.hitmos.fm/a.mp3",
]) {
  assert.equal(
    (
      await probeAudio(initial, {
        fetch: injected(() => {
          throw new Error("Must not fetch");
        }),
      })
    ).status,
    "unavailable",
  );
}
for (const limit of [5, 6]) {
  const bodies: ReturnType<typeof streamed>[] = [];
  const result = await probeAudio(url, {
    fetch: injected(() => {
      const body =
        bodies.length < limit
          ? streamed([], 302, { location: `/next-${bodies.length}.mp3` })
          : streamed([id3]);
      bodies.push(body);
      return body.response;
    }),
  });
  assert.equal(result.status, limit === 5 ? "available" : "unavailable");
  assert.equal(bodies.length, 6);
  for (const body of bodies) assert.equal(body.cancels(), 1);
}

// Both fetch and reader must be bounded even if the injected implementation ignores abort.
for (const phase of ["fetch", "reader"] as const) {
  let signal: AbortSignal | null | undefined;
  let cancels = 0;
  let cancelSawAbort = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel() {
        cancels++;
        cancelSawAbort = signal?.aborted ?? false;
      },
    }),
  );
  const started = performance.now();
  const result = await probeAudio(url, {
    timeoutMs: 20,
    fetch: injected((_url, init) => {
      signal = init.signal;
      return phase === "fetch" ? new Promise<Response>(() => {}) : response;
    }),
  });
  assert.equal(result.status, "timeout");
  assert.equal(signal?.aborted, true);
  assert(performance.now() - started < 1000);
  if (phase === "reader") {
    assert.equal(cancels, 1);
    assert.equal(cancelSawAbort, true);
    assert.equal(response.body?.locked, false);
  }
}

for (const phase of ["fetch", "reader", "pre-aborted"] as const) {
  const parent = new AbortController();
  let calls = 0;
  let cancels = 0;
  let signal: AbortSignal | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (phase === "pre-aborted") parent.abort();
  const result = await probeAudio(url, {
    signal: parent.signal,
    timeoutMs: 500,
    fetch: injected((_url, init) => {
      calls++;
      signal = init.signal;
      timer = setTimeout(() => parent.abort(), 10);
      if (phase === "fetch") return new Promise<Response>(() => {});
      return new Response(
        new ReadableStream<Uint8Array>({
          pull: () => new Promise<void>(() => {}),
          cancel() {
            cancels++;
          },
        }),
      );
    }),
  });
  clearTimeout(timer);
  assert.equal(result.status, "error");
  assert.match(result.reason!, /aborted/i);
  assert.equal(calls, phase === "pre-aborted" ? 0 : 1);
  if (phase !== "pre-aborted") assert.equal(signal?.aborted, true);
  if (phase === "reader") assert.equal(cancels, 1);
}

let lateResolve!: (response: Response) => void;
const late = streamed([id3]);
assert.equal(
  (
    await probeAudio(url, {
      timeoutMs: 10,
      fetch: injected(
        () =>
          new Promise<Response>((resolve) => {
            lateResolve = resolve;
          }),
      ),
    })
  ).status,
  "timeout",
);
lateResolve(late.response);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(late.cancels(), 1);

let readAttempts = 0;
let cancelAttempts = 0;
const readerFailure = new Response(
  new ReadableStream<Uint8Array>(
    {
      pull() {
        readAttempts++;
        throw new Error("Read failed");
      },
    },
    { highWaterMark: 0 },
  ),
);
// Errored streams do not invoke their underlying cancel callback; observe the reader call instead.
const getReader = readerFailure.body!.getReader.bind(readerFailure.body!);
readerFailure.body!.getReader = (() => {
  const reader = getReader();
  const cancel = reader.cancel.bind(reader);
  reader.cancel = (reason?: unknown) => {
    cancelAttempts++;
    return cancel(reason);
  };
  return reader;
}) as typeof getReader;
assert.equal((await probeAudio(url, { fetch: injected(() => readerFailure) })).status, "error");
assert.equal(readAttempts, 1);
assert.equal(cancelAttempts, 1);
assert.equal(readerFailure.body!.locked, false);
assert.equal(
  (
    await probeAudio(url, {
      fetch: injected(() => {
        throw new Error("Network failure");
      }),
    })
  ).status,
  "error",
);

// A nonsettling cancel must not extend the probe deadline or hold its reader lock.
const slowCancel = new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(id3);
    },
    cancel: () => new Promise<void>(() => {}),
  }),
);
assert.equal((await probeAudio(url, { fetch: injected(() => slowCancel) })).status, "available");
assert.equal(slowCancel.body!.locked, false);

for (const timeoutMs of [NaN, Infinity, -1, 2_147_483_648]) {
  assert.equal(
    (
      await probeAudio(url, {
        timeoutMs,
        fetch: injected(() => {
          throw new Error("Must not fetch");
        }),
      })
    ).status,
    "error",
  );
}

console.log("Audio probe tests passed (offline)");
