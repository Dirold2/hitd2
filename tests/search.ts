import assert from "node:assert/strict";
import { createServer } from "node:http";
import { HITApi } from "../src/api/HITApi.js";
import { HttpClient } from "../src/core/http.js";

const originalHosts = process.env.HITD2_HOSTS;
const originalMirrors = process.env.HITD2_MIRRORS;
const hosts = ["rus.hitmos.fm", "rue.hitmoz.org", "music.hitmo.net"];
function configure(values = hosts): void {
  delete process.env.HITD2_MIRRORS;
  process.env.HITD2_HOSTS = JSON.stringify(values);
}
function rsc(value: unknown): string {
  return `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(value))}])</script>`;
}
function list(host: string, id = 42, title = "Song", duration = 180): string {
  const track = { id, artist: "Artist", title, duration };
  if (host === hosts[2]) {
    return `<script>self.__next_f.push([1,${JSON.stringify(`1:${JSON.stringify(["$", "$L1", null, { query: "Artist", list: { category: 1, items: [track] } }])}\n`)}])</script>`;
  }
  if (host.includes("hitmoz")) {
    return `<li class="tracks__item"><a href="/song/${id}">${title}</a><span class="track__artist">Artist</span><time>${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}</time></li>`;
  }
  return rsc({ list: [track] });
}
function client(
  handler: (url: URL, signal?: AbortSignal) => Promise<{ status: number; data: string }>,
) {
  return {
    rest: {
      get: async (url: string, options: { signal?: AbortSignal }) => {
        const response = await handler(new URL(url), options.signal);
        return { ...response, ok: response.status >= 200 && response.status < 300 };
      },
    },
  };
}
function pending(signal?: AbortSignal): Promise<never> {
  assert(signal, "deadline signal must reach HTTP transport");
  signal.throwIfAborted();
  return new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
  );
}
const ok = (data: string) => ({ status: 200, data });

try {
  configure();
  // A barrier proves all provider groups launch without waiting for another.
  const launched: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrent = new HITApi({
    httpClient: client(async (url, signal) => {
      assert(signal);
      assert.notEqual(url.pathname, "/", "no homepage resolution");
      launched.push(url.hostname);
      if (launched.length === 3) release();
      await barrier;
      return ok(list(url.hostname, url.hostname === hosts[2] ? 99 : 42));
    }) as never,
  });
  const merged = await concurrent.search("Artist", 20, { verifyAudio: false });
  assert.equal(launched.length, 3);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.sources.length, 3);
  assert.deepEqual(
    merged[0]!.sources.map((source) => source.id),
    ["42", "42", "99"],
  );
  await assert.rejects(() => concurrent.getAudio("42"), /Ambiguous.*URL/);
  await assert.rejects(() => concurrent.getTrack("42"), /Ambiguous.*URL/);
  merged[0]!.sources[0]!.availability.status = "error";
  assert.equal(
    (await concurrent.search("Artist", 20, { verifyAudio: false }))[0]!.sources[0]!.availability
      .status,
    "unchecked",
  );

  configure(["rus.hitmos.fm", "hitmos.fm", "rue.hitmoz.org"]);
  const order: string[] = [];
  let outage = true;
  const failover = new HITApi({
    httpClient: client(async (url) => {
      order.push(url.hostname);
      if (url.hostname === "rus.hitmos.fm") throw new Error("network down");
      if (url.hostname === "rue.hitmoz.org" && outage) throw new Error("outage");
      return ok(list(url.hostname, url.hostname === "hitmos.fm" ? 1 : 2));
    }) as never,
  });
  assert.equal((await failover.search("Artist", 20, { verifyAudio: false }))[0]!.sources.length, 1);
  assert(order.indexOf("hitmos.fm") > order.indexOf("rus.hitmos.fm"));
  outage = false;
  assert.equal(
    (await failover.search("Artist", 20, { verifyAudio: false }))[0]!.sources.length,
    2,
    "partial outages aren't cached",
  );

  configure();
  const selected = new HITApi({
    httpClient: client(async (url) => {
      if (url.pathname.startsWith("/search"))
        return ok(list(url.hostname, url.hostname === hosts[1] ? 77 : 42));
      if (url.hostname === hosts[0]) return { status: 404, data: "missing" };
      return ok(
        `<div data-musid="track-id-77" data-musmeta='{"url":"/get/music/song.mp3"}'></div>`,
      );
    }) as never,
    fetch: (async () =>
      new Response(new Uint8Array([0x49, 0x44, 0x33]), {
        status: 206,
        headers: { "content-type": "audio/mpeg" },
      })) as typeof fetch,
  });
  const verified = (await selected.search("Artist", 20, { maxProbes: 2 }))[0]!;
  assert.equal(verified.id, "77");
  assert.equal(verified.host, hosts[1]);
  assert.equal(verified.uri, "hitmoz:track:77");
  assert.equal(verified.url, `https://${hosts[1]}/song/77`);
  assert.deepEqual(
    verified.sources.map((source) => source.availability.status),
    ["unavailable", "available", "unchecked"],
  );
  assert(verified.sources[1]!.audioUrl);
  const unchecked = (await selected.search("Artist", 20, { maxProbes: 1 }))[0]!;
  assert.equal(unchecked.host, hosts[1], "unchecked beats failed sources");

  configure([hosts[0]!]);
  let active = 0;
  let maximum = 0;
  let pageCount = 0;
  const bounded = new HITApi({
    httpClient: client(async (url, signal) => {
      if (url.pathname === "/search")
        return ok(
          rsc({
            list: Array.from({ length: 10 }, (_, id) => ({
              id: id + 1,
              artist: "Artist",
              title: `Song ${id}`,
              duration: 180,
            })),
          }),
        );
      active++;
      pageCount++;
      maximum = Math.max(maximum, active);
      try {
        return await pending(signal);
      } finally {
        active--;
      }
    }) as never,
  });
  const timed = await bounded.search("Artist", 20, { probeTimeoutMs: 15 });
  assert.equal(pageCount, 6);
  assert.equal(maximum, 3);
  assert.equal(active, 0);
  assert.equal(
    timed.filter((track) => track.sources[0]!.availability.status === "timeout").length,
    6,
  );
  assert.equal(
    timed.filter((track) => track.sources[0]!.availability.status === "unchecked").length,
    4,
  );
  assert.equal((await bounded.search("", 20)).length, 0);
  assert.equal((await bounded.search("Artist", 0)).length, 0);
  await assert.rejects(() => bounded.search("Artist", 20, { maxProbes: -1 }), RangeError);

  let aborts = 0;
  configure();
  const dead = new HITApi({
    httpClient: client(async (_url, signal) => {
      try {
        return await pending(signal);
      } finally {
        aborts++;
      }
    }) as never,
  });
  await assert.rejects(
    () => dead.search("Artist", 20, { searchTimeoutMs: 10 }),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors.length, 3);
      return true;
    },
  );
  assert.equal(aborts, 3, "all timed out HTTP requests were cancelled");

  // A provider's mirrors share one budget, rather than each adding a full
  // timeout. Fast failures may fail over, but exhausted budgets stop the chain.
  configure([
    "rus.hitmos.fm",
    "rue.hitmoz.org",
    "ru.hitmoz.org",
    "rus.hitmoz.org",
    "hitmoz.org",
    "www.hitmoz.org",
    "music.hitmo.net",
  ]);
  const budgetCalls: string[] = [];
  const budgetAborts: string[] = [];
  const budgeted = new HITApi({
    httpClient: client(async (url, signal) => {
      budgetCalls.push(url.hostname);
      if (url.hostname === "rue.hitmoz.org") {
        await new Promise((resolve) => setTimeout(resolve, 40));
        throw new Error("First mirror failed quickly");
      }
      try {
        return await pending(signal);
      } finally {
        budgetAborts.push(url.hostname);
      }
    }) as never,
  });
  const budgetStarted = performance.now();
  await assert.rejects(
    () => budgeted.search("Artist", 20, { verifyAudio: false, searchTimeoutMs: 120 }),
    AggregateError,
  );
  const budgetElapsed = performance.now() - budgetStarted;
  assert(budgetElapsed < 300, `Provider mirror chains exceeded shared budget: ${budgetElapsed}ms`);
  assert.deepEqual(budgetCalls, [
    "rus.hitmos.fm",
    "rue.hitmoz.org",
    "music.hitmo.net",
    "ru.hitmoz.org",
  ]);
  assert.deepEqual(
    new Set(budgetAborts),
    new Set(["rus.hitmos.fm", "music.hitmo.net", "ru.hitmoz.org"]),
  );
  const callsBeforeZeroBudget = budgetCalls.length;
  await assert.rejects(() => budgeted.search("Artist", 20, { searchTimeoutMs: 0 }), AggregateError);
  assert.equal(
    budgetCalls.length,
    callsBeforeZeroBudget,
    "exhausted budgets never launch a mirror",
  );

  configure([hosts[0]!]);
  const identities = new HITApi({
    httpClient: client(async () =>
      ok(
        rsc({
          list: [
            { id: 1, artist: "Artist", title: "Song", duration: 180 },
            { id: 2, artist: "Artist", title: " song ", duration: 182 },
            { id: 3, artist: "Artist", title: "Song", duration: 185 },
            { id: 4, artist: "Artist", title: "Song (Live)", duration: 180 },
            { id: 5, artist: "Artist", title: "Song", duration: 0 },
            { id: 6, artist: "Artist", title: "Song", duration: 0 },
          ],
        }),
      ),
    ) as never,
  });
  const distinct = await identities.search("Artist", 20, { verifyAudio: false });
  // Version qualifiers, duration variants and unknown durations remain distinct.
  assert.equal(distinct.length, 5);
  assert(distinct.some((track) => track.sources.length === 2));
  assert.equal((await identities.search("Artist Song Live", 20, { verifyAudio: false })).length, 1);

  configure([hosts[1]!]);
  let audioAborted = false;
  const slowAudio = new HITApi({
    httpClient: client(async (url) =>
      url.pathname === "/search"
        ? ok(list(url.hostname, 77))
        : ok(`<div data-musid="track-id-77" data-musmeta='{"url":"/get/music/song.mp3"}'></div>`),
    ) as never,
    fetch: (async (_url, init) => {
      try {
        return await pending(init?.signal ?? undefined);
      } finally {
        audioAborted = true;
      }
    }) as typeof fetch,
  });
  assert.equal(
    (await slowAudio.search("Artist", 20, { probeTimeoutMs: 20 }))[0]!.sources[0]!.availability
      .status,
    "timeout",
  );
  assert(audioAborted, "audio transport receives cancellation too");

  // A completely injected fetch handles search, selected page, then MP3 bytes.
  const fetchRoutes: string[] = [];
  const fetchApi = new HITApi({
    fetch: (async (input, init) => {
      assert(init?.signal);
      const url = new URL(String(input));
      fetchRoutes.push(url.pathname);
      if (url.pathname === "/search") return new Response(list(url.hostname, 77));
      if (url.pathname === "/song/77")
        return new Response(
          `<div data-musid="track-id-77" data-musmeta='{"url":"/get/music/song.mp3"}'></div>`,
        );
      return new Response(new Uint8Array([0x49, 0x44, 0x33]));
    }) as typeof fetch,
  });
  assert.equal((await fetchApi.search("Artist"))[0]!.sources[0]!.availability.status, "available");
  assert.deepEqual(fetchRoutes, ["/search", "/song/77", "/get/music/song.mp3"]);

  // Exercise the default native HTTP path against a local stalled body: the
  // abort must close the actual socket, not just reject a wrapper promise.
  let closed!: () => void;
  const wasClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer((_req, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.write("partial");
    response.on("close", closed);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    try {
      await assert.rejects(() =>
        new HttpClient().getTextResponse({
          url: `http://127.0.0.1:${address.port}/`,
          signal: controller.signal,
        }),
      );
      await wasClosed;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log("Search aggregation, identity, verification and cancellation tests passed");
} finally {
  if (originalHosts === undefined) delete process.env.HITD2_HOSTS;
  else process.env.HITD2_HOSTS = originalHosts;
  if (originalMirrors === undefined) delete process.env.HITD2_MIRRORS;
  else process.env.HITD2_MIRRORS = originalMirrors;
}
