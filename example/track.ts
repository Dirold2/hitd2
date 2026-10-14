import { HITApi } from "../src/index.js";

const api = new HITApi();

(async () => {
  const search = await api.search(`Дико например`);

  console.log("\n=== Results ===");
  search.forEach((track: { artist: any; title: any; duration: any; id: any }, i: number) => {
    console.log(
      `${i + 1}. ${track.artist} - ${track.title} [${track.duration}s] (ID: ${track.id})`,
    );
  });
  console.log(`\nTotal found: ${search.length}`);

  const firstTrack = search[0];
  if (!firstTrack) {
    console.log("No tracks found; skipping track and audio lookups.");
    return;
  }

  const track = await api.getTrack(firstTrack.id);
  const audio = await api.getAudio(firstTrack.id);

  console.log(track);
  console.log(audio);
})();
