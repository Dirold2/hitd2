import { HITApi } from "../src/index.js";

const api = new HITApi();
const query = "T-Fest, Скриптонит - Ламбада";

async function main(): Promise<void> {
  const diagnostics: unknown[] = [];
  const started = performance.now();

  const search = await api.search(query, 20, {
    verifyAudio: true,
    maxProbes: 3,
    probeTimeoutMs: 1500,

    onDiagnostic(event) {
      diagnostics.push(event);
    },
  });

  const totalMs = performance.now() - started;

  console.log("\n=== SEARCH TIMING ===");
  console.log(`Total: ${totalMs.toFixed(2)} ms`);

  console.table(
    diagnostics
      .filter(
        (event): event is Record<string, unknown> => typeof event === "object" && event !== null,
      )
      .map((event) => ({
        type: event.type,
        host: event.host ?? "-",
        outcome: event.outcome ?? "-",
        durationMs: typeof event.durationMs === "number" ? event.durationMs.toFixed(2) : "-",
      })),
  );

  console.log("\n=== AUDIO PROBES ===");

  const sources = search.flatMap((track) =>
    track.sources.map((source) => {
      const availability = source.availability;

      return {
        track: track.title,
        artist: track.artist,
        provider: source.provider,
        host: source.host,
        audioHost: source.audioUrl ? new URL(source.audioUrl).hostname : "-",
        status: availability.status,
        totalMs: availability.latencyMs?.toFixed(2) ?? "-",
        pageMs: availability.pageResolutionMs?.toFixed(2) ?? "-",
        requestMs: availability.requestMs?.toFixed(2) ?? "-",
        bodyReadMs: availability.bodyReadMs?.toFixed(2) ?? "-",
        firstByteMs: availability.firstByteMs?.toFixed(2) ?? "-",
        bytesRead: availability.bytesRead ?? "-",
        redirects: availability.redirects ?? "-",
        httpStatus: availability.httpStatus ?? "-",
      };
    }),
  );

  console.table(sources);

  console.log("\n=== RESULTS ===");
  console.dir(search, { depth: null });
}

main().catch((error: unknown) => {
  console.error("Search failed:", error);
  process.exitCode = 1;
});
