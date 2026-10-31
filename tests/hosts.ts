import assert from "node:assert/strict";
import { getSearchHosts, isSupportedPageUrl, SEARCH_HOSTS } from "../src/core/hosts.js";
import { Retry } from "../src/core/retry.js";
import { HITApi } from "../src/api/HITApi.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { HitmosProvider } from "../src/providers/hitmos.provider.js";
import { HitmozProvider } from "../src/providers/hitmoz.provider.js";

const original = process.env.HITD2_HOSTS;
const originalMirrors = process.env.HITD2_MIRRORS;
const originalAudio = process.env.HITD2_AUDIO_HOSTS;
try {
  delete process.env.HITD2_HOSTS;
  delete process.env.HITD2_MIRRORS;
  delete process.env.HITD2_AUDIO_HOSTS;
  assert.deepEqual(getSearchHosts(), SEARCH_HOSTS);
  assert.deepEqual(getSearchHosts('[" NEW.HITMOZ.ORG ","rus.hitmos.fm","new.hitmoz.org"]'), [
    "new.hitmoz.org",
    "rus.hitmos.fm",
  ]);
  for (const value of [
    "",
    "[]",
    "{}",
    "null",
    "[1]",
    '["https://rue.hitmoz.org"]',
    '["evil.test"]',
    '["hitmoz.org.evil.test"]',
    '["evilhitmos.fm"]',
    '["user@rus.hitmos.fm"]',
    '["rus.hitmos.fm:8080"]',
    '["bad..hitmoz.org"]',
  ]) {
    assert.throws(() => getSearchHosts(value), /HITD2_HOSTS/);
  }
  const registry = new ProviderRegistry([new HitmosProvider(), new HitmozProvider()]);
  assert.equal(registry.resolve("new.hitmoz.org").name, "hitmoz");
  assert.equal(registry.resolve("new.hitmos.fm").name, "hitmos");
  assert(isSupportedPageUrl(new URL("https://new.hitmoz.org/song/42")));
  assert(!isSupportedPageUrl(new URL("https://hitmoz.org.evil.test/song/42")));

  const retry = new Retry();
  const probes: string[] = [];
  retry.probeHost = async (host) => {
    probes.push(host);
    return host === "new.hitmoz.org" ? host : null;
  };
  process.env.HITD2_HOSTS = '["old.hitmoz.org","new.hitmoz.org"]';
  assert.equal(await retry.resolveHost(), "new.hitmoz.org");
  assert.deepEqual(probes, ["old.hitmoz.org", "new.hitmoz.org"]);

  let requested = "";
  const client = {
    rest: {
      get: async (url: string) => {
        requested = url;
        return {
          ok: true,
          status: 200,
          data: `<div data-musid="track-id-42" data-musmeta='{"url":"/get/music/song.mp3"}'></div>`,
        };
      },
    },
  };
  const api = new HITApi({ httpClient: client as never });
  assert.equal(
    (await api.getAudioByUrl("https://new.hitmoz.org/song/42")).url,
    "https://new.hitmoz.org/get/music/song.mp3",
  );
  assert.equal(new URL(requested).hostname, "new.hitmoz.org");
  await assert.rejects(
    () => api.getAudioByUrl("https://hitmoz.org.evil.test/song/42"),
    /Unsupported Hitmo host/,
  );
  delete process.env.HITD2_HOSTS;
  process.env.HITD2_MIRRORS = '{"hitmos":["music.example.net"],"hitmoz":["songs.example.org"]}';
  assert.deepEqual(getSearchHosts(), ["music.example.net", "songs.example.org"]);
  assert.equal(registry.resolve("songs.example.org").name, "hitmoz");
  assert.equal(registry.resolve("music.example.net").name, "hitmos");
  assert(isSupportedPageUrl(new URL("https://songs.example.org/song/42")));
  assert(!isSupportedPageUrl(new URL("https://songs.example.org.evil.test/song/42")));
  assert.equal(
    (await api.getAudioByUrl("https://songs.example.org/song/42")).url,
    "https://songs.example.org/get/music/song.mp3",
  );
  const { isValidAudioUrl } = await import("../src/core/filters.js");
  assert(!isValidAudioUrl("https://cdn.example.net/song.mp3"));
  process.env.HITD2_AUDIO_HOSTS = '["cdn.example.net"]';
  assert(isValidAudioUrl("https://cdn.example.net/song.mp3"));
  assert(!isValidAudioUrl("https://cdn.example.net.evil.test/song.mp3"));
  for (const value of [
    "{}",
    "[]",
    '{"unknown":["songs.example.org"]}',
    '{"hitmos":["same.example.org"],"hitmoz":["same.example.org"]}',
    '{"hitmos":["rue.hitmoz.org"]}',
    '{"hitmoz":["https://songs.example.org"]}',
  ]) {
    process.env.HITD2_MIRRORS = value;
    assert.throws(() => getSearchHosts(), /HITD2_MIRRORS/);
  }
} finally {
  if (originalMirrors === undefined) delete process.env.HITD2_MIRRORS;
  else process.env.HITD2_MIRRORS = originalMirrors;
  if (originalAudio === undefined) delete process.env.HITD2_AUDIO_HOSTS;
  else process.env.HITD2_AUDIO_HOSTS = originalAudio;
  if (original === undefined) delete process.env.HITD2_HOSTS;
  else process.env.HITD2_HOSTS = original;
}
console.log("Host environment configuration tests passed");
