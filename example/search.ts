import { HITApi } from "../src/index.js";

const api = new HITApi();
const query = "PHARAOH, ЛСП - Порнозвезда";

const TRACK_URLS = ["https://rus.hitmos.fm/song/9876484", "https://rus.hitmos.fm/song/10113157"];

async function main(): Promise<void> {
  const diagnostics: unknown[] = [];
  const started = performance.now();

  // Search without version classification.
  // We want to inspect track pages explicitly and only once.
  const search = await api.search(query, 20, {
    verifyAudio: true,
    maxProbes: 3,
    probeTimeoutMs: 1500,
    classifyVersions: false,

    onDiagnostic(event) {
      diagnostics.push(event);
    },
  });

  console.log("\n=== SEARCH TIMING ===");
  console.log(`Total: ${(performance.now() - started).toFixed(2)} ms`);

  console.log("\n=== SEARCH RESULTS ===");

  console.table(
    search.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      providerVersion: track.version ?? "(empty)",
    })),
  );

  // Fetch exactly two track pages.
  console.log("\n=== TRACK PAGE METADATA ===");

  const details = await Promise.all(
    TRACK_URLS.map(async (url) => {
      try {
        const track = await api.getTrackByUrl(url);

        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          version: track.version ?? "(empty)",
          albums: track.albums?.length
            ? track.albums
                .map((album) => {
                  const title = album.title ?? "(untitled)";
                  const id = album.id ?? "(no ID)";

                  return `${title} [${id}]`;
                })
                .join("; ")
            : "(not provided)",
          image: track.image ?? "-",
        };
      } catch (error) {
        return {
          url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  console.table(details);

  console.log("\n=== SEARCH DIAGNOSTICS ===");

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

  console.log("\n=== SEARCH RESULTS WITH SOURCES ===");
  console.dir(search, { depth: null });
}

main().catch((error: unknown) => {
  console.error("Search failed:", error);
  process.exitCode = 1;
});
