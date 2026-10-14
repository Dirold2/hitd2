import assert from "node:assert/strict";
import { HITApi } from "../src/api/HITApi.js";
import { TrackNotFoundError } from "../src/core/errors.js";
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

  readonly rest = {
    get: async <T>(_url: string): Promise<{ data: T; ok: boolean; status: number }> => {
      this.calls += 1;
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

await test404IsNotCachedAndUsesNegativeCache();
await testGetAudioThrowsTrackNotFound();
testErrorPageMp3IsIgnored();
await testTemporary5xxIsRetried();
await testTemporaryNetworkErrorIsRetried();
await testValidTrackPageStillExtractsAudio();

console.log("Track page HTTP handling tests passed");
