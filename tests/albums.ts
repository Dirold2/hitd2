import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HITApi, AlbumError, TrackNotFoundError, type Album } from "../src/index.js";
import { parseHtml } from "../src/core/html.js";
import { HitmonetProvider } from "../src/providers/hitmonet.provider.js";

// Album-bound component captured from /album/4335299; no network needed.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/hitmonet-album.json", import.meta.url), "utf8"),
);
const host = "music.hitmo.net";
const id = "4335299";
const url = `https://${host}/album/${id}`;
const provider = new HitmonetProvider();
function page(...props: unknown[]): string {
  const component = ["$", "$L1", null, { children: props.map((p) => ["$", "$L2", null, p]) }];
  return `<script>self.__next_f.push([1,${JSON.stringify(`1:${JSON.stringify(component)}\n`)}])</script>`;
}
function parse(props = fixture, ...extra: unknown[]) {
  return provider.parseAlbum(parseHtml(page(props, ...extra)), host, id);
}
function changed(change: (p: typeof fixture) => void) {
  const p = structuredClone(fixture);
  change(p);
  return p;
}
const album: Album = parse()!;
assert(album);
assert.equal(album.title, "Бог рэпа");
assert.equal(album.artist, "Face");
assert.equal(album.id, id);
assert.equal(album.totalTracks, 11);
assert.equal(album.complete, true);
assert.equal(album.tracks.length, 11);
assert.equal(album.tracks[0]!.id, "9706646");
assert.equal(album.tracks[0]!.sourceId, "7744353");
assert.equal(album.tracks[0]!.uri, "hitmonet:track:9706646");
assert.equal(album.tracks[0]!.url, `https://${host}/track/9706646`);
assert.equal(album.tracks[0]!.duration, 136);
assert.equal(album.tracks[0]!.duration_ms, 136000);
assert.equal(album.image, fixture.tracks[0].albumsList[0].imageInfo.imageUrl);
assert.deepEqual(parse(fixture, fixture), album);
const unrelated = changed((p) => {
  p.source.id++;
  p.tracks[0].title = "Unrelated";
});
assert.deepEqual(
  parse(fixture, unrelated, { list: unrelated.tracks, source: { entity: "query" } }),
  album,
);
assert.equal(parse(unrelated), null);
assert.equal(
  parse({ tracks: fixture.tracks, source: { ...fixture.source, entity: "query" } }),
  null,
);
assert.equal(
  parse({ tracks: fixture.tracks, source: { ...fixture.source, type: "tracks" } }),
  null,
);
assert.equal(parse({ list: fixture.tracks, source: fixture.source }), null);
assert.equal(provider.parseAlbum(parseHtml(page(fixture)), "evil.music.hitmo.net", id), null);
assert.equal(provider.parseAlbum(parseHtml(page(fixture)), host, "04335299"), null);
for (const change of [
  (p: typeof fixture) => {
    p.tracks[0].fileId = undefined;
  },
  (p: typeof fixture) => {
    p.tracks[0].fileId = "9706646";
  },
  (p: typeof fixture) => {
    p.tracks[0].fileId = 0;
  },
  (p: typeof fixture) => {
    p.tracks[0].fileId = -1;
  },
  (p: typeof fixture) => {
    p.tracks[0].fileId = 1.5;
  },
  (p: typeof fixture) => {
    p.tracks[0].fileId = Number.MAX_SAFE_INTEGER + 1;
  },
  (p: typeof fixture) => {
    p.tracks[0].title = " ";
  },
  (p: typeof fixture) => {
    p.tracks[0].duration = "136";
  },
  (p: typeof fixture) => {
    p.tracks[0].id = null;
  },
  (p: typeof fixture) => {
    p.tracks[0].albumsList = [];
  },
  (p: typeof fixture) => {
    p.tracks[0].albumsList[0].id++;
  },
  (p: typeof fixture) => {
    p.tracks[0].albumsList[0].title = "Other";
  },
  (p: typeof fixture) => {
    p.tracks[0].albumsList[0].artist = "Other";
  },
  (p: typeof fixture) => {
    p.tracks[0].albumsList[0].imageInfo.imageUrl = "https://example.org/other.jpg";
  },
  (p: typeof fixture) => {
    p.tracks[0].albumsList.push({ ...p.tracks[0].albumsList[0], title: "Conflict" });
  },
  (p: typeof fixture) => {
    p.tracks[0].imageInfo.imageUrl = "javascript:bad";
  },
  (p: typeof fixture) => {
    p.tracks[1].fileId = p.tracks[0].fileId;
  },
  (p: typeof fixture) => {
    p.tracks[1].id = p.tracks[0].id;
  },
  (p: typeof fixture) => {
    p.source.pagination.totalItems = 10;
  },
  (p: typeof fixture) => {
    p.source.pagination.itemsPerCurrentPage = 10;
  },
  (p: typeof fixture) => {
    p.source.pagination.page = 2;
  },
  (p: typeof fixture) => {
    p.source.pagination.itemsPerPage = 0;
  },
  (p: typeof fixture) => {
    p.source.pagination.lastPage = 2;
  },
  (p: typeof fixture) => {
    p.source.pagination = null;
  },
])
  assert.equal(parse(changed(change)), null, change.toString());
assert.equal(
  parse(
    fixture,
    changed((p) => {
      p.tracks[0].title = "Conflict";
    }),
  ),
  null,
);
const partial = changed((p) => {
  p.tracks = p.tracks.slice(0, 5);
  Object.assign(p.source.pagination, { itemsPerPage: 5, itemsPerCurrentPage: 5, lastPage: 3 });
});
assert.equal(parse(partial)!.complete, false);
assert.equal(parse(partial)!.totalTracks, 11);
const last = changed((p) => {
  p.tracks = p.tracks.slice(10);
  Object.assign(p.source.pagination, {
    page: 3,
    itemsPerPage: 5,
    itemsPerCurrentPage: 1,
    lastPage: 3,
  });
});
assert.equal(parse(last)!.complete, false);

let calls = 0;
let requested = "";
let headers: Record<string, string> = {};
let body = page(fixture, unrelated);
let statuses = [200];
const client = {
  rest: {
    get: async (requestUrl: string, options: { headers: Record<string, string> }) => {
      calls++;
      requested = requestUrl;
      headers = options.headers;
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      return { ok: status >= 200 && status < 300, status, data: body };
    },
  },
};
const api = new HITApi({ httpClient: client as never, sessionCookie: "album-session" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("Unexpected fetch bypass");
};
try {
  assert.deepEqual(await api.getAlbumByUrl(url), album);
  assert.equal(requested, url);
  assert.equal(headers.Cookie, "sid=album-session");
  assert.equal(headers.Referer, `https://${host}/`);
  assert.equal(headers.Accept, "text/html");
  for (const invalid of [
    "not a URL",
    `http://${host}/album/${id}`,
    `https://${host}:443/album/${id}`,
    `https://${host}:8443/album/${id}`,
    `https://user:pass@${host}/album/${id}`,
    `https://@${host}/album/${id}`,
    `https://evil.${host}/album/${id}`,
    `https://${host}.evil/album/${id}`,
    `https://hitmos.fm/album/${id}`,
    `https://${host}/album/0`,
    `https://${host}/album/-1`,
    `https://${host}/album/01`,
    `https://${host}/album/1.2`,
    `${url}/`,
    `${url}/extra`,
    `${url}?page=2`,
    `${url}#tracks`,
    `https://${host}/track/${id}`,
    `https://${host}/x/../album/${id}`,
    `https://${host}/album/%34${id.slice(1)}`,
  ]) {
    const before = calls;
    await assert.rejects(() => api.getAlbumByUrl(invalid));
    assert.equal(calls, before, invalid);
  }
  for (const status of [404, 410, 403]) {
    statuses = [status];
    const before = calls;
    await assert.rejects(
      () => api.getAlbumByUrl(url),
      (error: unknown) => {
        assert(error instanceof AlbumError);
        assert(!(error instanceof TrackNotFoundError));
        assert.equal(error.status, status);
        assert.equal(error.albumId, id);
        assert.equal(error.host, host);
        assert.equal(error.code, status === 403 ? "ALBUM_HTTP_ERROR" : "ALBUM_NOT_FOUND");
        return true;
      },
    );
    assert.equal(calls - before, 1);
  }
  statuses = [503, 429, 200];
  const before = calls;
  assert.deepEqual(await api.getAlbumByUrl(url), album);
  assert.equal(calls - before, 3);
  statuses = [200];
  body = page(unrelated);
  await assert.rejects(
    () => api.getAlbumByUrl(url),
    (error: unknown) => error instanceof AlbumError && error.code === "ALBUM_INVALID_DATA",
  );
  body = page(partial);
  const partialBefore = calls;
  assert.equal((await api.getAlbumByUrl(url)).complete, false);
  assert.equal(calls - partialBefore, 1, "no invented pagination requests");
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Album provider and public API tests passed");
