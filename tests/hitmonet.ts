import assert from "node:assert/strict";
import { parseHtml } from "../src/core/html.js";
import { HitmonetProvider } from "../src/providers/hitmonet.provider.js";

const provider = new HitmonetProvider();
const host = "music.hitmo.net";
const id = "9073969";
// Reduced from the captured /track/9073969 component (recommendations omitted).
const item = {
  id: 9073969,
  artist: "Face",
  title: "Юморист (2019)",
  duration: 143,
  play: "https://p1.hitmo.net/L3QvNjQ3ODIwNy90cmFjay5tcDM=.mp3",
  download: "https://d1.hitmo.net/other-download.mp3",
  imageInfo: { imageUrl: "https://s1.hitmo.net/album/cover.jpg" },
};
const other = { ...item, id: 7873611, title: "Салам", play: "https://p1.hitmo.net/other.mp3" };
function component(props: unknown): unknown[] {
  return ["$", "$L34", null, props];
}
function script(payload: string): string {
  return `<script>self.__next_f.push([1,${JSON.stringify(payload).replace(/</g, "\\u003c")}])</script>`;
}
function page(...components: unknown[]): string {
  return script(`e:${JSON.stringify(component({ children: components }))}\n`);
}
function selected(value: unknown = item): string {
  return page(component({ item: value, seo: {} }));
}
function audio(html: string, trackId = id): string | null {
  return provider.extractAudioUrl(parseHtml(html), html, host, trackId);
}
function metadata(html: string, trackId = id) {
  return provider.parseTrackPage(parseHtml(html), host, trackId);
}
function rejected(html: string, message: string): void {
  assert.equal(audio(html), null, message);
  assert.deepEqual(metadata(html), {}, message);
}

assert.equal(provider.name, "hitmonet");
assert.deepEqual(provider.hosts, [host]);
assert(provider.matches(host));
for (const foreign of ["hitmo.net", "evil.music.hitmo.net", "music.hitmo.net.evil", "hitmos.fm"]) {
  assert(!provider.matches(foreign, selected()));
  assert.deepEqual(provider.parseTrackPage(parseHtml(selected()), foreign, id), {});
  assert.equal(provider.extractAudioUrl(parseHtml(selected()), selected(), foreign, id), null);
}
const good = selected({ ...item, related: [other], similar: [other], radio: [other] });
assert.equal(audio(good), item.play);
assert.deepEqual(metadata(good), {
  title: item.title,
  artist: item.artist,
  duration: 143,
  image: item.imageInfo.imageUrl,
});
assert.equal(audio(good, String(other.id)), null, "must not select related by requested ID");
assert.deepEqual(metadata(good, String(other.id)), {});
assert.equal(audio(good, ""), null);
assert.equal(audio(good, "09073969"), null);
assert.equal(audio(good, "9073969/extra"), null);
assert.equal(
  audio(page(component({ item }), component({ item }))),
  item.play,
  "identical repeats allowed",
);

rejected(selected(other), "wrong selected ID");
rejected(page(component({ item: { ...other, related: [item] } })), "requested ID only in related");
rejected(page(component({ list: [item], source: { key: "related-9073969" } })), "no selected item");
rejected(page(component({ data: { item } })), "item is not a direct component prop");
rejected(page(component({ item: { title: "Album", id: 1, tracks: [item] } })), "album not a track");
rejected(
  page(component({ item }), component({ item: { ...item, play: other.play } })),
  "conflicting play URLs",
);
for (const change of [
  { title: "Different" },
  { artist: "Different" },
  { duration: 144 },
  { imageInfo: { imageUrl: "https://s1.hitmo.net/different.jpg" } },
  { id: other.id },
]) {
  rejected(
    page(component({ item }), component({ item: { ...item, ...change } })),
    "conflicting selected data",
  );
}
for (const change of [
  { id: undefined },
  { id: id },
  { title: null },
  { duration: "143" },
  { play: "javascript:alert(1)" },
  { play: "/unbound.mp3" },
  { play: "https://user:pass@p1.hitmo.net/a.mp3" },
]) {
  rejected(selected({ ...item, ...change }), "malformed selected track");
}
const noPlay = selected({ ...item, play: undefined, related: [item] });
assert.equal(audio(noPlay), null, "no download/related fallback");
assert.equal(metadata(noPlay).title, item.title);
const untrusted =
  `<audio src="${item.play}"></audio><a href="/track/${id}">Track</a>` +
  `<meta property="og:title" content="Face"><script type="application/ld+json">${JSON.stringify({ item })}</script>`;
rejected(untrusted, "no arbitrary HTML, JSON-LD or audio fallback");
for (const props of [
  { related: [item] },
  { similar: [item] },
  { radio: [item] },
  { list: [item], source: { entity: "radio", id: 1 } },
  { error: { item } },
]) {
  rejected(
    page(component(props)) + untrusted,
    "recommendations/radio/error must not supply selected data",
  );
}
rejected(script('1:E{"message":"Not found"}\n') + untrusted, "Flight error has no fallback");
rejected(
  '<script>self.__next_f.push([1,"invalid\\xZZ"])</script>' + untrusted,
  "invalid JSON escape",
);
rejected(
  `<script>const unrelated = ${JSON.stringify({ item })}</script>`,
  "no execution or generic JSON scan",
);

// Flight payload chunks can split a JSON string or a length-prefixed UTF-8 text record.
const tricky = { ...item, title: 'Юморист "quoted" \\ [brackets] {braces}\nnext line' };
const lyric = `Лирика\ne:${JSON.stringify(component({ item: other }))}\nnot a real record`;
const stream =
  `1:I[123,[],"default"]\n:HL["/style.css","style"]\n35:T${Buffer.byteLength(lyric).toString(16)},${lyric}` +
  `e:${JSON.stringify(component({ item: tricky }))}\n`;
const chunks =
  script(stream.slice(0, 27)) + script(stream.slice(27, 91)) + script(stream.slice(91));
assert.equal(audio(chunks), item.play, "skip text records by byte length, not newline");
assert.equal(metadata(chunks).title, 'Юморист "quoted" \\ [brackets] {braces} next line');
rejected(
  script(`1:T${Buffer.byteLength(lyric).toString(16)},${lyric}`),
  "fake components in lyrics ignored",
);
rejected(script(`e:${JSON.stringify(component({ item })).slice(0, -10)}`), "truncated JSON");

const searchSource = { query: "face", entity: "query", pagination: { page: 1, lastPage: 5 } };
const searchHtml = page(
  component({ list: [other], source: { key: `related-${id}` } }),
  component({ title: component({ children: "Треки" }), source: searchSource, list: [item] }),
  component({ list: [other], source: { entity: "recommendation" } }),
  component({ item: other }),
);
const results = provider.parseSearch(parseHtml(searchHtml), host);
assert.deepEqual(results, [
  {
    id,
    title: item.title,
    artist: "Face",
    duration: 143,
    uri: `hitmonet:track:${id}`,
    name: item.title,
    duration_ms: 143000,
    explicit: false,
    image: item.imageInfo.imageUrl,
  },
]);
assert.deepEqual(
  provider.parseSearch(parseHtml(good), host),
  [],
  "track page recommendations aren't search",
);
assert.deepEqual(
  provider.parseSearch(parseHtml(untrusted), host),
  [],
  "links alone aren't results",
);
assert.deepEqual(provider.parseSearch(parseHtml(searchHtml), "hitmos.fm"), []);
for (const source of [
  undefined,
  {},
  { key: "top" },
  { entity: "radio", query: "face" },
  { entity: "query" },
  { entity: "query", query: " " },
]) {
  assert.deepEqual(
    provider.parseSearch(parseHtml(page(component({ source, list: [item] }))), host),
    [],
  );
}
assert.deepEqual(
  provider.parseSearch(
    parseHtml(
      page(
        component({
          source: searchSource,
          list: [item, item, { id: 3, title: "Album" }, { ...item, id: -1 }],
        }),
      ),
    ),
    host,
  ),
  results,
  "deduplicate results and reject invalid tracks",
);
assert.deepEqual(
  provider.parseSearch(
    parseHtml(
      page(
        component({ source: searchSource, list: [item] }),
        component({ source: searchSource, list: [{ ...item, title: "Conflicting" }] }),
      ),
    ),
    host,
  ),
  [],
  "conflicting search metadata excluded",
);
console.log("Hitmonet provider tests passed");

// Public API route selection, CDN trust and source-host preservation, offline.
const { HITApi } = await import("../src/api/HITApi.js");
const { Retry } = await import("../src/core/retry.js");
const { isValidAudioUrl } = await import("../src/core/filters.js");
const { providerForHost, getSearchHosts } = await import("../src/core/hosts.js");
assert.equal(providerForHost(host), "hitmonet");
assert(getSearchHosts('["music.hitmo.net"]').includes(host));
assert(isValidAudioUrl(item.play));
assert(!isValidAudioUrl("https://p1.hitmo.net.evil.test/track.mp3"));
const requests: URL[] = [];
const client = {
  rest: {
    get: async (url: string) => {
      const parsed = new URL(url);
      requests.push(parsed);
      return {
        ok: true,
        status: 200,
        data: parsed.pathname.startsWith("/search/") ? searchHtml : good,
      };
    },
  },
};
const api = new HITApi({ httpClient: client as never });
assert.equal((await api.getAudioByUrl(`https://${host}/track/${id}`)).url, item.play);
assert.equal(requests[0]!.pathname, `/track/${id}`);
const resolveHost = Retry.prototype.resolveHost;
const previousSearchHosts = process.env.HITD2_HOSTS;
process.env.HITD2_HOSTS = JSON.stringify([host]);
Retry.prototype.resolveHost = async () => host;
try {
  const found = await api.search("Face", 10, { verifyAudio: false });
  assert(found.some((entry) => entry.id === id));
  const searchRequest = requests.find((url) => url.pathname.startsWith("/search/"))!;
  assert.equal(searchRequest.pathname, "/search/face");
  assert.equal(searchRequest.searchParams.get("type"), "tracks");
  const before = requests.length;
  assert.equal((await api.getTrackByUrl(`https://${host}/track/${id}`)).artist, "Face");
  assert.equal((await api.getAudio(id)).url, item.play);
  assert.equal(requests.length, before, "reuse selected track page and source host");
} finally {
  Retry.prototype.resolveHost = resolveHost;
  if (previousSearchHosts === undefined) delete process.env.HITD2_HOSTS;
  else process.env.HITD2_HOSTS = previousSearchHosts;
}
console.log("Hitmo.net API routing tests passed");

assert.equal(
  provider.parseSearch(
    parseHtml(page(component({ query: "face", list: { category: 1, items: [item] } }))),
    host,
  )[0]?.id,
  id,
);
assert.deepEqual(
  provider.parseSearch(
    parseHtml(page(component({ query: "face", list: { category: 2, items: [item] } }))),
    host,
  ),
  [],
);
assert.deepEqual(
  provider.parseSearch(parseHtml(page(component({ list: { category: 1, items: [item] } }))), host),
  [],
);
