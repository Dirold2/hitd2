import { parse } from "node-html-parser";
import { parseHitmosStructuredData } from "../src/providers/hitmos/structured-data.js";

const urls = ["https://rus.hitmos.fm/artist/7137654", "https://rus.hitmos.fm/album/7148463"];

async function main() {
  for (const url of urls) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status}`);
    }

    const html = await response.text();
    const root = parse(html);

    const data = parseHitmosStructuredData(root, new URL(url).hostname);

    console.log(`\n=== ${url} ===`);

    console.log("ALBUMS:");
    console.dir([...data.albums.values()], { depth: null });

    console.log("TARGET RECORDINGS:");
    console.dir(
      [...data.recordings.values()].filter((track) =>
        ["9876484", "10113157", "10113161"].includes(track.id),
      ),
      { depth: null },
    );

    console.table(
      [...data.albums.values()].map((album) => ({
        id: album.id,
        title: album.title,
        numTracks: album.numTracks ?? "(unknown)",
        parsedTracks: album.tracks.length,
        trackListComplete: album.trackListComplete,
      })),
    );
  }
}

main().catch(console.error);
