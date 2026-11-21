import assert from "node:assert/strict";
import { parseHtml } from "../src/core/html.js";
import { HitmosProvider } from "../src/providers/hitmos.provider.js";
import { parseHitmosStructuredData } from "../src/providers/hitmos/structured-data.js";

const HOST = "rus.hitmos.fm";

function jsonLd(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
}

function rscTracks(
  tracks: Array<{
    id: number;
    title: string;
    artist: string;
    duration: number;
  }>,
): string {
  const payload = JSON.stringify({ tracks });
  return `<script>self.__next_f.push([1,${JSON.stringify(payload)}])</script>`;
}

function recording(
  id: string,
  title: string,
  duration: string,
  albums?: unknown[],
): Record<string, unknown> {
  return {
    "@type": "MusicRecording",
    url: `https://${HOST}/song/${id}`,
    name: title,
    byArtist: {
      "@type": "MusicGroup",
      name: "ЛСП & Pharaoh",
    },
    duration,
    ...(albums ? { inAlbum: albums } : {}),
  };
}

function albumReference() {
  return {
    "@type": "MusicAlbum",
    name: "Кондитерская",
    url: `https://${HOST}/album/7148463`,
  };
}

function testArtistPageIsIncomplete(): void {
  const artistJsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: "ЛСП & Pharaoh",
    track: [
      recording("9876480", "Золотые рыбки (Кондитерская 2016)", "PT4M", [albumReference()]),
      recording("9876483", "Неон (Кондитерская 2016)", "PT3M53S", [albumReference()]),
      recording("9876481", "PiT (Кондитерская 2016)", "PT3M29S", [albumReference()]),
      recording("9876482", "Кекс (Кондитерская 2016)", "PT4M", [albumReference()]),
      // The title contains the album name, but no explicit relationship.
      recording("9876484", "Порнозвезда (Кондитерская 2016)", "PT4M35S"),
    ],
  };

  const root = parseHtml(`<html><head>${jsonLd(artistJsonLd)}</head></html>`);
  const data = parseHitmosStructuredData(root, HOST);
  const album = data.albums.get("7148463");

  assert.ok(album);
  assert.equal(album.title, "Кондитерская");
  assert.equal(album.numTracks, undefined);
  assert.equal(album.tracks.length, 4);
  assert.equal(album.trackListComplete, false);

  assert.deepEqual(
    data.recordings.get("9876484")?.albums,
    [],
    "album membership must not be inferred from parenthetical title text",
  );
}

function testAlbumPageIsComplete(): void {
  const albumJsonLd = {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name: "Кондитерская",
    url: `https://${HOST}/album/7148463`,
    numTracks: 6,
    byArtist: {
      "@type": "MusicGroup",
      name: "Pharaoh feat Лсп",
    },
    track: [
      recording("10113161", "Порнозвезда", "PT4M35S"),
      recording("9876482", "Кекс", "PT4M"),
      recording("9876480", "Золотые рыбки", "PT4M"),
      recording("10178036", "9 жизней", "PT3M50S"),
      recording("9876481", "Pit", "PT3M29S"),
      recording("9876483", "Неон", "PT3M53S"),
    ],
  };

  const root = parseHtml(`<html><head>${jsonLd(albumJsonLd)}</head></html>`);
  const data = parseHitmosStructuredData(root, HOST);
  const album = data.albums.get("7148463");

  assert.ok(album);
  assert.equal(album.numTracks, 6);
  assert.equal(album.tracks.length, 6);
  assert.equal(album.trackListComplete, true);

  const recordingFromAlbum = data.recordings.get("10113161");
  assert.ok(recordingFromAlbum);
  assert.deepEqual(
    recordingFromAlbum.albums.map((reference) => reference.id),
    ["7148463"],
  );
}

function testProviderPassesOnlyExplicitAlbumRelations(): void {
  const provider = new HitmosProvider();
  const album = albumReference();

  const withoutAlbumHtml =
    rscTracks([
      {
        id: 9876484,
        title: "Порнозвезда (Кондитерская 2016)",
        artist: "ЛСП & PHARAOH",
        duration: 275,
      },
    ]) +
    jsonLd({
      "@context": "https://schema.org",
      "@type": "MusicRecording",
      ...recording("9876484", "Порнозвезда (Кондитерская 2016)", "PT4M35S"),
    });

  const withoutAlbum = provider.parseTrackPage(parseHtml(withoutAlbumHtml), HOST, "9876484");

  assert.equal(withoutAlbum.title, "Порнозвезда (Кондитерская 2016)");
  assert.equal(withoutAlbum.duration, 275);
  assert.equal(withoutAlbum.albums, undefined);

  const withAlbumHtml =
    rscTracks([
      {
        id: 10113161,
        title: "Порнозвезда",
        artist: "Pharaoh feat Лсп",
        duration: 275,
      },
    ]) +
    jsonLd({
      "@context": "https://schema.org",
      ...recording("10113161", "Порнозвезда", "PT4M35S", [album]),
    });

  const withAlbum = provider.parseTrackPage(parseHtml(withAlbumHtml), HOST, "10113161");

  assert.deepEqual(withAlbum.albums, [
    {
      id: "7148463",
      title: "Кондитерская",
      uri: "hitmos:album:7148463",
    },
  ]);
}

function testSearchCarriesExplicitAlbumRelations(): void {
  const provider = new HitmosProvider();
  const html =
    rscTracks([
      {
        id: 10113161,
        title: "Порнозвезда",
        artist: "Pharaoh feat Лсп",
        duration: 275,
      },
    ]) +
    jsonLd({
      "@context": "https://schema.org",
      ...recording("10113161", "Порнозвезда", "PT4M35S", [albumReference()]),
    });

  const tracks = provider.parseSearch(parseHtml(html), HOST);
  assert.equal(tracks.length, 1);
  assert.deepEqual(tracks[0]?.albums, [
    {
      id: "7148463",
      title: "Кондитерская",
      uri: "hitmos:album:7148463",
    },
  ]);
}

function testExternalAlbumUrlsAreRejected(): void {
  const root = parseHtml(
    `<html><head>${jsonLd({
      "@context": "https://schema.org",
      ...recording("777", "External relation", "PT3M", [
        {
          "@type": "MusicAlbum",
          name: "Not Hitmos",
          url: "https://example.com/album/123",
        },
      ]),
    })}</head></html>`,
  );

  const data = parseHitmosStructuredData(root, HOST);
  assert.deepEqual(data.recordings.get("777")?.albums, []);
}

testArtistPageIsIncomplete();
testAlbumPageIsComplete();
testProviderPassesOnlyExplicitAlbumRelations();
testSearchCarriesExplicitAlbumRelations();
testExternalAlbumUrlsAreRejected();

console.log("Hitmos structured data and album relation tests passed");
