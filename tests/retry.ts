import assert from "node:assert/strict";
import { HITApi } from "../src/api/HITApi.js";
import { TrackNotFoundError, AudioExtractionError } from "../src/core/errors.js";
import { parseHtml } from "../src/core/html.js";
import { Retry } from "../src/core/retry.js";
import { HitmosProvider } from "../src/providers/hitmos.provider.js";

type TextResponse = {
  data: unknown;
  raw?: { body: Uint8Array };
  status: number;
};

class FakeHyperClient {
  calls = 0;
  urls: string[] = [];

  readonly rest = {
    get: async <T>(_url: string): Promise<{ data: T; ok: boolean; status: number }> => {
      this.calls += 1;
      this.urls.push(_url);
      const response = this.responses.shift();

      if (!response) throw new Error("No mocked response left");
      if (response instanceof Error) throw response;

      return {
        data: response.data as T,
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        ...(response.raw && { raw: response.raw }),
      };
    },
  };

  constructor(private readonly responses: Array<TextResponse | Error>) {}
}

function withoutRetryDelay(retry: Retry): void {
  (retry as unknown as { sleep: () => Promise<void> }).sleep = async () => undefined;
}

async function expectTrackNotFound(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert(error instanceof TrackNotFoundError);
    return true;
  });
}

const errorPageWithRadio = `
  <html><body>
    <h1>404 Not Found</h1>
    <script>const radio = "https://radio.example.test/live.mp3";</script>
  </body></html>
`;

const validTrackPage = `
  <html><body>
    <script>self.__next_f.push([1,"{\\"list\\":[{\\"id\\":42,\\"artist\\":\\"Artist\\",\\"title\\":\\"Song\\",\\"duration\\":180,\\"play\\":\\"https://pl1.hitmos.fm/Lcorrect.mp3\\"}],\\"footer\\":[]}"])</script>
  </body></html>
`;

async function test404IsNotCachedAndUsesNegativeCache(): Promise<void> {
  const client = new FakeHyperClient([{ status: 404, data: errorPageWithRadio }]);
  const retry = new Retry({ httpClient: client as never });
  withoutRetryDelay(retry);

  await expectTrackNotFound(() => retry.fetchTrackPage("404", "hitmos.fm"));
  assert.equal((retry as unknown as { pageCache: Map<string, string> }).pageCache.size, 0);
  await expectTrackNotFound(() => retry.fetchTrackPage("404", "hitmos.fm"));

  assert.equal(
    client.calls,
    1,
    "404 must neither populate the page cache nor cause another request",
  );
}

async function testGetAudioThrowsTrackNotFound(): Promise<void> {
  const client = new FakeHyperClient([{ status: 410, data: errorPageWithRadio }]);
  const api = new HITApi({ httpClient: client as never });

  await expectTrackNotFound(() => api.getAudio("gone", "hitmos.fm"));
  assert.equal(client.calls, 1);
}

function testErrorPageMp3IsIgnored(): void {
  const provider = new HitmosProvider();
  const root = parseHtml(errorPageWithRadio);

  assert.equal(provider.extractAudioUrl(root, errorPageWithRadio, "hitmos.fm", "404"), null);
}

async function testTemporary5xxIsRetried(): Promise<void> {
  const client = new FakeHyperClient([
    { status: 503, data: "temporarily unavailable" },
    { status: 503, data: "temporarily unavailable" },
    { status: 200, data: validTrackPage },
  ]);
  const retry = new Retry({ httpClient: client as never });
  withoutRetryDelay(retry);

  const page = await retry.fetchTrackPage("42", "hitmos.fm");

  assert.equal(page.host, "hitmos.fm");
  assert.equal(client.calls, 3, "5xx responses must be retried");
}

async function testTemporaryNetworkErrorIsRetried(): Promise<void> {
  const client = new FakeHyperClient([
    new Error("network timeout"),
    { status: 200, data: validTrackPage },
  ]);
  const retry = new Retry({ httpClient: client as never });
  withoutRetryDelay(retry);

  await retry.fetchTrackPage("42", "hitmos.fm");

  assert.equal(client.calls, 2, "temporary network errors must be retried");
}

async function testValidTrackPageStillExtractsAudio(): Promise<void> {
  const client = new FakeHyperClient([
    {
      status: 200,
      data: { title: "parsed HTML object" },
      raw: { body: new TextEncoder().encode(validTrackPage) },
    },
  ]);
  const api = new HITApi({ httpClient: client as never });

  const audio = await api.getAudio("42", "hitmos.fm");

  assert.equal(audio.url, "https://pl1.hitmos.fm/Lcorrect.mp3");
  assert.equal(client.calls, 1);
}

async function testCurrentHitmozDomain(): Promise<void> {
  const html = `<div data-musid="track-id-42" data-musmeta='{"title":"Song","artist":"Artist","url":"/get/music/song.mp3"}'></div>`;
  const client = new FakeHyperClient([{ status: 200, data: html }]);
  const api = new HITApi({ httpClient: client as never });
  const audio = await api.getAudioByUrl("https://rue.hitmoz.org/song/42");
  assert.equal(audio.url, "https://rue.hitmoz.org/get/music/song.mp3");
  assert.equal(new URL(client.urls[0]!).hostname, "rue.hitmoz.org");
}

async function testSearchPreservesSourceHost(): Promise<void> {
  const searchHtml = `<li class="tracks__item"><a href="/song/42">Song</a><span class="track__artist">Artist</span></li>`;
  const trackHtml = `<div data-musid="track-id-42" data-musmeta='{"url":"/get/music/song.mp3"}'></div>`;
  const client = new FakeHyperClient([
    { status: 200, data: searchHtml },
    { status: 200, data: trackHtml },
  ]);
  const api = new HITApi({ httpClient: client as never });
  const retry = (api as unknown as { retry: Retry }).retry;
  retry.resolveHost = async () => "rue.hitmoz.org";
  const tracks = await api.search("Artist - Song", 20, { verifyAudio: false });
  assert.equal(tracks[0]?.id, "42");
  retry.resolveHost = async () => "rus.hitmos.fm";
  const audio = await api.getAudio("42");
  assert.equal(audio.url, "https://rue.hitmoz.org/get/music/song.mp3");
  assert.equal(new URL(client.urls[1]!).hostname, "rue.hitmoz.org");
}

async function testHostResolution(): Promise<void> {
  const retry = new Retry();
  const probes: string[] = [];
  retry.probeHost = async (host) => {
    probes.push(host);
    return host === "rue.hitmoz.org" ? host : null;
  };
  assert.equal(await retry.resolveHost(), "rue.hitmoz.org");
  assert.equal(probes[0], "rus.hitmos.fm");
  const count = probes.length;
  assert.equal(await retry.resolveHost(), "rue.hitmoz.org");
  assert.equal(probes.length, count, "successful host must be cached");

  retry.probeHost = async () => null;
  await assert.rejects(() => retry.resolveHost(true), /No available Hitmo hosts/);
}

async function testHostProbeRejectsErrorsAndForeignHosts(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const retry = new Retry();
  const cases = [
    { status: 503, url: "https://rus.hitmos.fm/", body: "error", expected: null },
    { status: 200, url: "https://evil.test/", body: "", expected: null },
    {
      status: 200,
      url: "https://rue.hitmoz.org/",
      body: '<link rel="canonical" href="https://evil.test/">',
      expected: "rue.hitmoz.org",
    },
    {
      status: 200,
      url: "https://rus.hitmos.fm/",
      body: '<link rel="canonical" href="https://rue.hitmoz.org/">',
      expected: "rus.hitmos.fm",
    },
  ];
  try {
    for (const item of cases) {
      globalThis.fetch = (async () => {
        const response = new Response(item.body, { status: item.status });
        Object.defineProperty(response, "url", { value: item.url });
        return response;
      }) as typeof fetch;
      assert.equal(await retry.probeHost("rus.hitmos.fm"), item.expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testSearchHttpErrorsAreNotCached(): Promise<void> {
  const client = new FakeHyperClient([
    { status: 404, data: errorPageWithRadio },
    {
      status: 200,
      data: '<li class="tracks__item"><a href="/song/42">Song</a><span class="track__artist">Artist</span></li>',
    },
  ]);
  const api = new HITApi({ httpClient: client as never });
  const retry = (api as unknown as { retry: Retry }).retry;
  retry.resolveHost = async () => "rue.hitmoz.org";
  await assert.rejects(
    () => api.search("Artist - Song", 20, { verifyAudio: false }),
    AggregateError,
  );
  assert.equal((await api.search("Artist - Song", 20, { verifyAudio: false }))[0]?.id, "42");
  assert.equal(client.calls, 2);
}

async function testUnverifiedAudioIsRejected(): Promise<void> {
  const client = new FakeHyperClient([{ status: 200, data: validTrackPage }]);
  const api = new HITApi({ httpClient: client as never });
  const retry = (api as unknown as { retry: Retry }).retry;
  let invalidations = 0;
  retry.invalidateHost = () => {
    invalidations += 1;
  };
  await assert.rejects(
    () => api.getAudio("99", "rus.hitmos.fm"),
    (error: unknown) => {
      assert(error instanceof AudioExtractionError);
      assert.equal(error.trackId, "99");
      assert.equal(error.code, "AUDIO_NOT_VERIFIED");
      return true;
    },
  );
  assert.equal(client.calls, 1, "missing selected data must not call an unverified play API");
  assert.equal(invalidations, 0, "missing audio is not a mirror outage");
  await assert.rejects(
    () => api.getAudioByUrl("https://rus.hitmos.fm/song/42/extra"),
    /Unsupported Hitmo track URL/,
  );
}
await testUnverifiedAudioIsRejected();
await withSearchHost(testSearchHttpErrorsAreNotCached);
await testCurrentHitmozDomain();
await withSearchHost(testSearchPreservesSourceHost);
await testHostResolution();
await testHostProbeRejectsErrorsAndForeignHosts();
await test404IsNotCachedAndUsesNegativeCache();
await testGetAudioThrowsTrackNotFound();
testErrorPageMp3IsIgnored();
await testTemporary5xxIsRetried();
await testTemporaryNetworkErrorIsRetried();
await testValidTrackPageStillExtractsAudio();

console.log("Track page HTTP handling tests passed");

async function withSearchHost(test: () => Promise<void>): Promise<void> {
  const previous = process.env.HITD2_HOSTS;
  process.env.HITD2_HOSTS = '["rue.hitmoz.org"]';
  try {
    await test();
  } finally {
    if (previous === undefined) delete process.env.HITD2_HOSTS;
    else process.env.HITD2_HOSTS = previous;
  }
}
