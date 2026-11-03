import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { HITApi } from "../src/index.js";
import { isValidAudioUrl } from "../src/core/filters.js";

const args = process.argv.slice(2);
const full = args.includes("--full");
const query = args.find((arg) => !arg.startsWith("--")) ?? "Скриптонит - Точно не нужно новых";
const workerHost = args.find((arg) => arg.startsWith("--worker="))?.slice(9);
const timeoutMs = Number(process.env.HITD2_SMOKE_TIMEOUT_MS ?? 45_000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) {
  throw new Error("HITD2_SMOKE_TIMEOUT_MS must be an integer >= 1000");
}
const sampleBytes = 256 * 1024;
const ms = (start: number) => Math.round(performance.now() - start);

async function worker(host: string): Promise<void> {
  const total = performance.now();
  let stage = "search";
  try {
    const api = new HITApi();
    let start = performance.now();
    const tracks = await api.search(query, 5, { verifyAudio: false });
    console.log(`[${host}] search: ${ms(start)} ms; candidates: ${tracks.length}`);
    const selected = tracks[0];
    if (!selected) throw new Error("No matching search results (audio availability not tested)");
    console.log(`[${host}] selected: ${selected.artist} — ${selected.title}; ID=${selected.id}`);
    stage = "audio URL";
    start = performance.now();
    const audio = await api.getAudio(selected.id, host);
    console.log(`[${host}] audio URL: ${ms(start)} ms; ${audio.url}`);
    if (!isValidAudioUrl(audio.url)) throw new Error("Untrusted audio URL");

    stage = "download";
    start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 30_000));
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      // Check every redirect before following it; never download from an untrusted host.
      let url = audio.url;
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 5; redirects++) {
        response = await fetch(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: full ? {} : { Range: `bytes=0-${sampleBytes - 1}` },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 5) throw new Error("Invalid/too many audio redirects");
        url = new URL(location, url).href;
        if (!isValidAudioUrl(url)) throw new Error("Untrusted audio redirect");
      }
      if (!response?.ok || !response.body) {
        await response?.body?.cancel();
        throw new Error(`Audio HTTP ${response?.status}`);
      }
      const type = response.headers.get("content-type") ?? "unknown";
      if (/text\/|html|json|xml/i.test(type)) {
        await response.body.cancel();
        throw new Error(`Non-audio Content-Type: ${type}`);
      }
      reader = response.body.getReader();
      let bytes = 0;
      let firstByteMs: number | undefined;
      const prefix: number[] = [];
      let ended = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          ended = true;
          break;
        }
        if (!value.length) continue;
        firstByteMs ??= ms(start);
        for (const byte of value.subarray(0, Math.max(0, 4096 - prefix.length))) prefix.push(byte);
        bytes += value.length;
        if (!full && bytes >= sampleBytes) break;
      }
      const elapsed = ms(start);
      const id3 = prefix[0] === 0x49 && prefix[1] === 0x44 && prefix[2] === 0x33;
      const frame = prefix.some(
        (byte, index) =>
          byte === 0xff &&
          ((prefix[index + 1] ?? 0) & 0xe0) === 0xe0 &&
          ((prefix[index + 1] ?? 0) & 0x06) !== 0 &&
          ((prefix[index + 2] ?? 0) & 0xf0) !== 0xf0,
      );
      if (!bytes || (!id3 && !frame))
        throw new Error("Empty body or no MP3 signature in first 4 KiB");
      if (full && response.status === 206)
        throw new Error("Unexpected partial response for full download");
      console.log(
        `[${host}] PASS: HTTP ${response.status}, ${type}; first byte=${firstByteMs} ms; ` +
          `${bytes} bytes in ${elapsed} ms (${Math.round(bytes / 1024 / Math.max(elapsed / 1000, 0.001))} KiB/s); ` +
          `${full ? "full response" : "sample only"}${ended ? ", EOF" : ""}; total=${ms(total)} ms`,
      );
    } finally {
      clearTimeout(timer);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  } catch (error) {
    console.error(
      `[${host}] FAIL at ${stage} after ${ms(total)} ms:`,
      error instanceof Error ? error.message : error,
    );
    if (error instanceof Error && error.cause) console.error(`[${host}] cause:`, error.cause);
    process.exitCode = 1;
  }
}

if (workerHost) {
  await worker(workerHost);
} else {
  const override = args.find((arg) => arg.startsWith("--host="))?.slice(7);
  const hosts = override ? [override] : ["rus.hitmos.fm", "rue.hitmoz.org", "music.hitmo.net"];
  console.log(
    `Query: ${query}; mode: ${full ? "FULL download (discarded, may use several MB per host)" : "256 KiB sample"}`,
  );
  console.log(
    `Deadline: ${timeoutMs} ms per provider. Only the top ranked result is tested; no fallback hides failures.`,
  );
  const results = await Promise.all(
    hosts.map(
      (host) =>
        new Promise<{ host: string; ok: boolean }>((resolve) => {
          const child = spawn(
            process.execPath,
            [
              ...process.execArgv,
              process.argv[1]!,
              query,
              `--worker=${host}`,
              ...(full ? ["--full"] : []),
            ],
            {
              stdio: "inherit",
              env: { ...process.env, HITD2_HOSTS: JSON.stringify([host]) },
            },
          );
          const timer = setTimeout(() => {
            console.error(`[${host}] FAIL: provider deadline exceeded (${timeoutMs} ms)`);
            child.kill("SIGKILL");
          }, timeoutMs);
          child.on("error", (error) => {
            clearTimeout(timer);
            console.error(`[${host}] Cannot start worker: ${error.message}`);
            resolve({ host, ok: false });
          });
          child.on("exit", (code) => {
            clearTimeout(timer);
            resolve({ host, ok: code === 0 });
          });
        }),
    ),
  );
  console.table(results.map(({ host, ok }) => ({ host, result: ok ? "PASS" : "FAIL" })));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}
