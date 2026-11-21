import { parse } from "node-html-parser";

const HOST = "rus.hitmos.fm";
const ALBUM_ID = "7148463";

const TARGET_TRACK_IDS = new Set(["9876484", "10113157"]);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getTypes(value: JsonObject): string[] {
  const type = value["@type"];

  if (typeof type === "string") return [type];
  if (Array.isArray(type)) {
    return type.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getSongId(value: unknown): string | undefined {
  const url = getString(value);
  return url?.match(/\/song\/(\d+)/)?.[1];
}

function getAlbumId(value: unknown): string | undefined {
  const url = getString(value);
  return url?.match(/\/album\/(\d+)/)?.[1];
}

function collectNodes(
  value: unknown,
  predicate: (node: JsonObject) => boolean,
  result: JsonObject[] = [],
): JsonObject[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNodes(item, predicate, result);
    }

    return result;
  }

  if (!isObject(value)) return result;

  if (predicate(value)) result.push(value);

  for (const child of Object.values(value)) {
    collectNodes(child, predicate, result);
  }

  return result;
}

function isMusicAlbum(node: JsonObject): boolean {
  return getTypes(node).includes("MusicAlbum");
}

function isMusicRecording(node: JsonObject): boolean {
  return getTypes(node).includes("MusicRecording");
}

function parseJsonLd(html: string): unknown[] {
  const root = parse(html);
  const result: unknown[] = [];

  // Обычные JSON-LD script-теги.
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      result.push(JSON.parse(script.textContent.trim()));
    } catch {
      // Некоторые страницы содержат некорректные или пустые блоки.
    }
  }

  // JSON-LD, встроенный Next.js в RSC через dangerouslySetInnerHTML.
  const rscPattern = /self\.__next_f\.push\(\[1,\s*("(?:\\.|[^"\\])*")\]\)/g;

  for (const match of html.matchAll(rscPattern)) {
    const encodedPayload = match[1];

    if (encodedPayload === undefined) continue;

    try {
      const payload: unknown = JSON.parse(encodedPayload);

      if (typeof payload !== "string") continue;

      const htmlPattern = /"__html":"((?:\\.|[^"\\])*)"/g;

      for (const htmlMatch of payload.matchAll(htmlPattern)) {
        const encodedHtml = htmlMatch[1];

        if (encodedHtml === undefined) continue;

        try {
          const jsonText: unknown = JSON.parse(`"${encodedHtml}"`);

          if (typeof jsonText !== "string") continue;

          result.push(JSON.parse(jsonText));
        } catch {
          // Не каждый dangerouslySetInnerHTML содержит JSON.
        }
      }
    } catch {
      // Пропускаем нераспознанный RSC payload.
    }
  }

  return result;
}

function summarizeRecording(track: JsonObject) {
  const inAlbum = Array.isArray(track.inAlbum)
    ? track.inAlbum
    : track.inAlbum
      ? [track.inAlbum]
      : [];

  return {
    id: getSongId(track.url) ?? null,
    title: getString(track.name) ?? null,
    url: getString(track.url) ?? null,
    duration: getString(track.duration) ?? null,
    artists: track.byArtist ?? null,
    albums: inAlbum.map((album) => {
      if (!isObject(album)) return album;

      return {
        name: album.name ?? null,
        id: getAlbumId(album.url) ?? null,
        url: album.url ?? null,
      };
    }),
  };
}

async function main() {
  const url = `https://${HOST}/album/${ALBUM_ID}`;

  const response = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(15_000),
  });

  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Hitmos returned HTTP ${response.status}`);
  }

  const jsonLd = parseJsonLd(html);

  const albums = collectNodes(jsonLd, (node) => {
    return isMusicAlbum(node) && getAlbumId(node.url) === ALBUM_ID;
  });

  const recordings = collectNodes(jsonLd, isMusicRecording);

  const albumTracks = albums.flatMap((album) => {
    return collectNodes(album.track, isMusicRecording);
  });

  const targetRecordings = recordings.filter((track) => {
    return TARGET_TRACK_IDS.has(getSongId(track.url) ?? "");
  });

  const targetAlbumTracks = albumTracks.filter((track) => {
    return TARGET_TRACK_IDS.has(getSongId(track.url) ?? "");
  });

  const root = parse(html);

  const targetLinks = root
    .querySelectorAll("a[href]")
    .map((anchor) => {
      const href = anchor.getAttribute("href") ?? "";
      const id = getSongId(href);

      if (!id || !TARGET_TRACK_IDS.has(id)) return null;

      return {
        id,
        title: anchor.textContent.trim(),
        href,
      };
    })
    .filter((item) => item !== null);

  console.dir(
    {
      albumId: ALBUM_ID,
      status: response.status,
      htmlBytes: new TextEncoder().encode(html).byteLength,
      jsonLdBlocks: jsonLd.length,

      albumEntities: albums.map((album) => ({
        name: album.name ?? null,
        url: album.url ?? null,
        datePublished: album.datePublished ?? null,
        albumReleaseType: album.albumReleaseType ?? null,
        numTracks: album.numTracks ?? null,
        tracks: collectNodes(album.track, isMusicRecording).map(summarizeRecording),
      })),

      targetRecordings: targetRecordings.map(summarizeRecording),

      targetAlbumTracks: targetAlbumTracks.map(summarizeRecording),

      targetHtmlLinks: targetLinks,
    },
    { depth: null },
  );
}

main().catch(console.error);
