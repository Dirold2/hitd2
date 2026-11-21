import { HITApi } from "../src/index.js";

const host =
  process.env.HITD2_TRACK_HOST ??
  process.argv[2] ??
  "rue.hitmoz.org";

const trackId =
  process.env.HITD2_TRACK_ID ??
  "62323749";

async function main(): Promise<void> {
  const api = new HITApi();
  const url = `https://${host}/song/${trackId}`;

  console.log(`Testing track: ${url}`);

  const started = performance.now();

  try {
    const track = await api.getTrack(url);

    console.log(
      `Track resolved in ${(performance.now() - started).toFixed(2)} ms`,
    );

    console.dir(track, { depth: null });
  } catch (error) {
    console.error(
      `Track resolution failed after ${(performance.now() - started).toFixed(2)} ms`,
    );

    console.error(error);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("Track smoke test failed:", error);
  process.exitCode = 1;
});
