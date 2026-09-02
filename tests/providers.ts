import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseHtml } from "../src/core/html.js";
import { HitmosProvider } from "../src/providers/hitmos.provider.js";
import { HitmozProvider } from "../src/providers/hitmoz.provider.js";

async function readFixture(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

async function testHitmosProvider(): Promise<void> {
  const html = await readFixture("hitmos.html");
  const provider = new HitmosProvider();
  const root = parseHtml(html);

  assert.deepEqual(provider.parseSearch(root), [
    {
      id: "42",
      title: "RSC Song",
      artist: "RSC Artist",
      duration: 210,
      uri: "hitmos:track:42",
      name: "RSC Song",
      duration_ms: 210_000,
      explicit: false,
    },
  ]);
  assert.deepEqual(provider.parseTrackPage(root, "hitmos.fm", "42"), { title: "RSC Song" });
}

async function testHitmozProvider(): Promise<void> {
  const html = await readFixture("hitmoz.html");
  const provider = new HitmozProvider();
  const root = parseHtml(html);

  assert(provider.hosts.includes("ru.hitmoz.org"));
  assert(provider.matches("ru.hitmoz.org"));
  assert.deepEqual(provider.parseSearch(root), [
    {
      id: "moz-7",
      title: "Moz Song",
      artist: "Moz Artist",
      duration: 185,
      uri: "hitmoz:track:moz-7",
      name: "Moz Song",
      duration_ms: 185_000,
      explicit: false,
    },
  ]);
  assert.deepEqual(provider.parseTrackPage(root, "hitmoz.org", "moz-7"), {
    title: "Moz Song",
    artist: "Moz Artist",
    image: "https://cdn.example.test/moz-song.jpg",
  });
  assert.equal(
    provider.extractAudioUrl(root, html, "hitmoz.org", "moz-7"),
    "https://cdn.example.test/moz-song.mp3",
  );
}

await testHitmosProvider();
await testHitmozProvider();

console.log("Provider HTML fixture tests passed");
