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

  const searchPayload = JSON.stringify({
    list: [
      { id: 42, artist: "RSC Artist", title: "RSC Song", duration: 210 },
      { id: 404, artist: "Stale Artist", title: "Stale Song", duration: 210 },
    ],
    footer: [],
  });
  const searchRoot = parseHtml(
    `<a href="/song/42">RSC Song</a><script>self.__next_f.push([1,${JSON.stringify(searchPayload)}])</script>`,
  );

  assert.deepEqual(
    provider.parseSearch(searchRoot).map((track) => track.id),
    ["42"],
    "RSC results without a matching /song/<id> link must be excluded when links are present",
  );

  const rscOnlyRoot = parseHtml(
    `<script>self.__next_f.push([1,${JSON.stringify(searchPayload)}])</script>`,
  );

  assert.deepEqual(
    provider.parseSearch(rscOnlyRoot).map((track) => track.id),
    ["42", "404"],
    "RSC-only responses must remain searchable when no server-rendered track links are available",
  );

  const currentRscRoot = parseHtml(
    '<script>self.__next_f.push([1,"1:\\\"payload\\\",\\\"list\\\":[{\\\"id\\\":7,\\\"artist\\\":\\\"Face\\\",\\\"title\\\":\\\"Лабиринт\\\",\\\"duration\\\":169}]}]]"])</script>',
  );

  assert.deepEqual(
    provider.parseSearch(currentRscRoot).map((track) => track.id),
    ["7"],
    "RSC lists must be parsed even when no footer follows the list",
  );

  const trackPageRsc =
    '<script>self.__next_f.push([1,"1:\\\"payload\\\",\\\"tracks\\\":[{\\\"id\\\":10962226,\\\"artist\\\":\\\"Face\\\",\\\"title\\\":\\\"Лабиринт\\\",\\\"duration\\\":169,\\\"play\\\":\\\"https://plc1.hitmos.fm/face-labirint.mp3\\\"}]}]]"])</script>';

  assert.equal(
    provider.extractAudioUrl(parseHtml(trackPageRsc), trackPageRsc, "rus.hitmos.fm", "10962226"),
    "https://plc1.hitmos.fm/face-labirint.mp3",
    "track-page RSC payloads must read the selected track from a tracks array",
  );
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
    "https://hitmoz.org/get/music/20230808/Moz_Artist_-_Moz_Song_moz-7.mp3",
  );
}

await testHitmosProvider();
await testHitmozProvider();

console.log("Provider HTML fixture tests passed");
