import assert from "node:assert/strict";
import {
  HITApi,
  type InitializeOptions,
  type InitializationReport,
  type SearchDiagnostic,
} from "../src/index.js";

const originalHosts = process.env.HITD2_HOSTS;
const originalMirrors = process.env.HITD2_MIRRORS;
const originalNow = Date.now;
let now = 1_000_000;
Date.now = () => now;
const hosts = ["rus.hitmos.fm", "hitmos.fm", "rue.hitmoz.org", "music.hitmo.net"];
const configure = (values = hosts) => {
  process.env.HITD2_HOSTS = JSON.stringify(values);
  delete process.env.HITD2_MIRRORS;
};
const empty = "<html></html>";
const calls: URL[] = [];
function apiWith(handler: (url: URL, signal: AbortSignal) => Promise<Response>): HITApi {
  return new HITApi({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push(url);
      assert(init?.signal);
      assert(url.pathname.startsWith("/search"), "initialization must not verify audio");
      return handler(url, init.signal);
    },
  });
}
const options: InitializeOptions = { query: "music", cooldownMs: 100, searchTimeoutMs: 100 };

try {
  configure();
  let outage = true;
  const api = apiWith(async (url) => {
    if (url.hostname.includes("hitmos") && outage) return new Response("down", { status: 503 });
    return new Response(empty);
  });
  const report: InitializationReport = await api.initialize(options);
  assert.deepEqual(
    report.providers.map((entry) => entry.status),
    ["temporarily_disabled", "healthy", "healthy"],
  );
  const failed = report.providers[0]!;
  assert(failed.status === "temporarily_disabled");
  assert.equal(failed.retryAt, now + 100);
  assert.deepEqual(failed.hosts, hosts.slice(0, 2));
  assert.equal(calls.length, 4, "both failed mirrors attempted");
  calls.length = 0;
  outage = false;
  const events: SearchDiagnostic[] = [];
  assert.deepEqual(
    await api.search("music", 20, {
      verifyAudio: false,
      onDiagnostic: (event) => {
        events.push(event);
      },
    }),
    [],
  );
  assert.deepEqual(
    calls.map((url) => url.hostname),
    hosts.slice(2),
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ["mirror", "mirror", "complete"],
  );
  now += 99;
  calls.length = 0;
  await api.search("music", 20, { verifyAudio: false });
  assert.equal(calls.length, 2, "empty parse successes stay healthy");
  now++;
  calls.length = 0;
  await api.search("music", 20, { verifyAudio: false });
  assert.equal(calls.length, 3, "at expiry normal search retries first mirror");
  assert.equal(calls[0]!.hostname, hosts[0]);
  report.providers.length = 0;
  calls.length = 0;
  assert.equal(
    (await api.initialize()).providers.length,
    3,
    "cached report is a defensive snapshot",
  );
  assert.equal(calls.length, 0, "initialize remains idempotent after expiry");

  // First mirror failure must not disable a provider whose fallback parses successfully.
  configure(hosts.slice(0, 2));
  calls.length = 0;
  const fallback = apiWith(async (url) => {
    if (url.hostname === hosts[0]) throw new Error("network error");
    return new Response(empty);
  });
  assert.equal((await fallback.initialize()).providers[0]!.status, "healthy");
  assert.equal(calls.length, 2);
  calls.length = 0;
  await fallback.search("music", 20, { verifyAudio: false });
  await fallback.search("music", 20, { verifyAudio: false });
  assert.equal(calls.length, 4, "normal search fallback success also keeps provider enabled");

  // All failed is a report, not startup failure; all-skipped search still rejects.
  configure();
  calls.length = 0;
  let down = true;
  const dead = apiWith(async () => {
    if (down) throw new Error("offline");
    return new Response(empty);
  });
  const deadReport = await dead.initialize();
  assert(deadReport.providers.every((entry) => entry.status === "temporarily_disabled"));
  for (const entry of deadReport.providers) {
    assert(entry.status === "temporarily_disabled");
    assert.equal(entry.retryAt, now + 300_000);
  }
  assert(
    calls.every((url) => url.searchParams.get("q") === "music" || url.pathname === "/search/music"),
  );
  calls.length = 0;
  down = false;
  await assert.rejects(() => dead.search("music"), AggregateError);
  assert.equal(calls.length, 0);
  now += 300_000;
  await dead.search("music", 20, { verifyAudio: false });
  assert.equal(calls.length, 3, "all failed groups recover after default cooldown");

  // Normal search failures apply and refresh cooldown without requiring initialization.
  calls.length = 0;
  down = true;
  await assert.rejects(() => dead.search("music", 20, { verifyAudio: false }), AggregateError);
  assert.equal(calls.length, 4);
  down = false;
  now += 299_999;
  calls.length = 0;
  await assert.rejects(() => dead.search("music"), AggregateError);
  assert.equal(calls.length, 0);
  now++;
  await dead.search("music", 20, { verifyAudio: false });
  assert.equal(calls.length, 3);

  // Separate API instances never inherit disabled groups.
  const independent = apiWith(async () => new Response(empty));
  calls.length = 0;
  await independent.search("music", 20, { verifyAudio: false });
  assert.equal(calls.length, 3);

  // Concurrent initialization runs one search; first options win.
  configure([hosts[0]!]);
  calls.length = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrent = apiWith(async () => {
    await barrier;
    return new Response(empty);
  });
  const first = concurrent.initialize({ query: "first", cooldownMs: 0 });
  const second = concurrent.initialize({ query: "ignored" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.searchParams.get("q"), "first");
  release();
  assert.deepEqual(await first, await second);
  await concurrent.initialize();
  assert.equal(calls.length, 1);

  // Deadline exhaustion reports failure even if no mirror was launched.
  calls.length = 0;
  const zero = apiWith(async () => new Response(empty));
  const zeroReport = await zero.initialize({ searchTimeoutMs: 0, cooldownMs: 0 });
  assert.equal(zeroReport.providers[0]!.status, "temporarily_disabled");
  assert.equal(calls.length, 0);
  await zero.search("music", 20, { verifyAudio: false });
  assert.equal(calls.length, 1);

  const timeout = apiWith(
    async (_url, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  assert.equal(
    (await timeout.initialize({ searchTimeoutMs: 10 })).providers[0]!.status,
    "temporarily_disabled",
  );
  await assert.rejects(() => new HITApi().initialize({ cooldownMs: -1 }), RangeError);
  await assert.rejects(() => new HITApi().initialize({ query: " " }), RangeError);
  console.log("Initialization, provider cooldown, fallback, recovery and concurrency tests passed");
} finally {
  Date.now = originalNow;
  if (originalHosts === undefined) delete process.env.HITD2_HOSTS;
  else process.env.HITD2_HOSTS = originalHosts;
  if (originalMirrors === undefined) delete process.env.HITD2_MIRRORS;
  else process.env.HITD2_MIRRORS = originalMirrors;
}
