# hitd2

> Unofficial Node.js wrapper for the Hitmo API ([hitmo.me](http://hitmo.me))

Search for music tracks, retrieve metadata, and extract MP3 audio URLs from hitmo sites.

## Features

- Search tracks by query
- Get track metadata (title, artist, duration, cover image)
- Extract playable MP3 URLs
- Built-in retries and discovery of available hosts (`rus.hitmos.fm`, `rue.hitmoz.org`, `music.hitmo.net`, and legacy aliases)
- Caching via `hcacher` (configurable TTLs)
- TypeScript-first with full type definitions

## Installation

```bash
npm install hitd2
```

## Usage

```ts
import { HITApi } from "hitd2";

const api = new HITApi();

const tracks = await api.search("Дико например");
console.log(tracks);

const track = await api.getTrack(tracks[0].url);
const audio = await api.getAudio(tracks[0].url);

console.log(track, audio);
```

## API

### `HITApi(options?)`

| Option          | Type          | Default | Description                               |
| --------------- | ------------- | ------- | ----------------------------------------- |
| `httpClient`    | `HyperClient` | —       | Custom HTTP client instance               |
| `sessionCookie` | `string`      | —       | Session cookie for authenticated requests |

### `initialize(options?): Promise<InitializationReport>`

Optional startup diagnostic search; no constructor network requests or homepage probes.

```ts
import { HITApi, type InitializationReport } from "hitd2";

const api = new HITApi();
const report: InitializationReport = await api.initialize();
for (const group of report.providers) {
  console.log(group.provider, group.status);
  if (group.status === "temporarily_disabled") console.log(group.retryAt);
}
```

| `InitializeOptions` field | Default   | Meaning                                                           |
| ------------------------- | --------- | ----------------------------------------------------------------- |
| `query`                   | `"music"` | Non-empty diagnostic search query                                 |
| `searchTimeoutMs`         | `1500`    | Shared mirror-chain budget per provider (groups run concurrently) |
| `cooldownMs`              | `300000`  | Temporary exclusion duration after a whole provider chain fails   |

Exports: `InitializeOptions`, `InitializationReport`, `ProviderInitializationStatus`.
The report is `{ providers: ProviderInitializationStatus[] }`; each entry contains
`provider` (`"hitmos" | "hitmoz" | "hitmonet"`), ordered `hosts`, and either
`{ status: "healthy" }` or `{ status: "temporarily_disabled", retryAt: number }`.
`retryAt` is a Unix timestamp in milliseconds. HTTP success plus successful parsing is
healthy even with zero accepted/relevant tracks. A failed mirror followed by a successful
fallback does not disable the group. Initialization never verifies audio or probes CDNs.

All-provider outage resolves with disabled statuses, so it does not break plugin startup.
Invalid options/environment configuration still reject. Numeric options accept integers
from 0 to 2147483647; zero cooldown permits immediate retries. Concurrent and repeated calls
share one initialization run (first call's options win). Returned reports are defensive
snapshots of that run, not live health; later `initialize()` calls do not re-run the diagnostic.

Cooldown is per `HITApi` instance and applies to ordinary searches too, including without
initialization (five minutes by default). A whole-chain failure/exhausted deadline starts
or refreshes cooldown; any successful mirror clears it. Searches skip disabled groups
without mirror diagnostic events, and automatically retry normally once cooldown expires.
There is no permanent disable, background timer or recovery probe. Track/audio lookup is
unaffected. The diagnostic query is sent to configured providers just like a normal search.

### `search(query, limit?, options?)`

Search all configured provider groups not currently in cooldown concurrently. Returns `SearchTrack[]`.
Mirrors within one provider are tried in order under one shared deadline; no homepage
probe is required. A failed provider does not discard another provider’s results.
If all attempted providers fail or all groups are in cooldown, throws `AggregateError`.
Search results are not cached.

Each result adds `host`, `url`, and `sources` to `TrackMeta`. Each source retains its
`provider`, native `id`, `host`, page `url`, availability evidence, and `audioUrl` when
the sample check succeeds. Matching normalized artist/title/version records with
known durations within two seconds are grouped; this is metadata-based, not an audio fingerprint.
The primary result ID/host/URL belongs to an available source when possible, then an
unchecked source, otherwise a failed source. Use `getAudio(track.url)`, not bare IDs.

| Search option     | Default | Meaning                                                                |
| ----------------- | ------- | ---------------------------------------------------------------------- |
| `verifyAudio`     | `true`  | Extract and probe selected sources                                     |
| `maxProbes`       | `6`     | Maximum source checks per call                                         |
| `probeTimeoutMs`  | `3000`  | Page extraction plus audio sample deadline per source                  |
| `searchTimeoutMs` | `5000`  | Shared mirror-chain budget per provider                                |
| `onDiagnostic`    | —       | Optional `(event: SearchDiagnostic) => void \| Promise<void>` callback |

At most three sources are checked concurrently per call. Audio requests download up
to a 4 KiB sample, reject untrusted redirects/error bodies and check an MP3 signature.
Availability is `available`, `unavailable`, `timeout`, `error`, or `unchecked`; a timeout
is not proof of absence. Results are retained even if no source is verified. Check
`sources` before playback. `available` describes the sample at `checkedAt`, not a full
download guarantee or proof of recording contents. Calls add CDN traffic and disclose
the query to every non-skipped provider. Concurrent search calls have independent budgets.

```ts
const results = await api.search("Скриптонит - Точно не нужно новых", 10);
for (const track of results) {
  console.log(track.url, track.sources);
}
// Explicitly skip verification when only metadata is needed:
const metadata = await api.search("Face", 20, { verifyAudio: false });
```

### Search diagnostics (opt-in)

```ts
import type { SearchDiagnostic } from "hitd2";

const events: SearchDiagnostic[] = [];
await api.search("Artist", 20, {
  onDiagnostic: (event) => {
    events.push(event);
  },
});
```

`SearchDiagnostic` is an exported discriminated union:

- `{ type: "mirror", provider, host, durationMs, outcome: "success", trackCount }`
- `{ type: "mirror", provider, host, durationMs, outcome: "error" | "timeout" }`
- `{ type: "complete", durationMs, trackCount }`

Each actually attempted mirror emits one event after its request and parsing/filtering;
`trackCount` on success counts accepted metadata before relevance ranking, grouping and the
result limit (including zero). `timeout` means that request's deadline fired; other transport,
HTTP or parsing failures are `error`. Mirrors skipped because the shared budget expired or
an earlier mirror succeeded emit nothing. Provider groups still use `Promise.allSettled`:
partial results do not return before the remaining groups settle.

Exactly one `complete` event is emitted at the end of each call, including empty queries,
zero limits, invalid options and rejected searches. Its duration includes ranking and optional
audio verification; its count is the final returned track count, or zero on rejection. It does
not imply success; the search promise remains the authority for success/failure. Durations use
`performance.now()` in milliseconds. Verification requests do not emit mirror events.

Events contain only the fields above: no query, URL, credentials, HTML, error object or error
message. Diagnostics are disabled unless a callback is supplied. Callbacks are invoked inline,
not awaited; thrown exceptions and rejected promises are ignored. Keep handlers fast: synchronous
work can consume the existing shared deadline. No logging, network telemetry or dependency is added.

Migration: this replaces single-provider search. Old `TrackMeta` fields remain, but
primary IDs may change when a different source is verified. Persist full track URLs.
No separate legacy search method is provided.

`artist - full title` queries use strict normalized title equality and exact artist/explicit
collaborator matching. Unicode compatibility forms, punctuation, case, and Russian `ё`/`е` are
normalized. An unrequested `(Live)`/remix/cover is not substituted for the original. Request the
version explicitly to find it. Plain queries require all whole-word tokens across artist/title;
they are discovery searches, not proof that the top result is the intended recording.

A strict query may return no results rather than a similar song. Ranking uses site metadata,
not audio fingerprints: it cannot prove that a site's file contains the advertised recording.

### `getTrack(trackIdOrUrl, preferredHost?)`

Get full metadata for a track. Returns `TrackMeta`.

### `getAudio(trackIdOrUrl, preferredHost?)`

Extract a track-bound MP3 audio URL from its track page. Returns `TrackAudio`.

If the track page returns HTTP `404` or `410`, `getAudio()` (and `getTrack()`) throws
`TrackNotFoundError`. This error has `trackId`, `status`, and optional `host` properties.
It is safe to handle it separately from transient transport failures:

```ts
import { TrackNotFoundError } from "hitd2";

try {
  await api.getAudio("80810006");
} catch (error) {
  if (error instanceof TrackNotFoundError) {
    // The track is unavailable; no alternate/radio URL is returned.
  } else {
    throw error;
  }
}
```

### Unverified audio

`getAudio()` throws exported `AudioExtractionError` (`code: "AUDIO_NOT_VERIFIED"`, `trackId`,
`host`) when the selected track has no unambiguous trusted audio URL. Handle it separately from
`TrackNotFoundError`: a page may exist without verified audio. Neither error invalidates the active
mirror. There is no generic MP3 scan or unverified `/api/track/<id>/play` fallback.

Hitmos URLs come only from the requested ID across RSC track arrays. Hitmoz URLs come only from
matching `data-musid` metadata. Conflicting URLs for one ID are rejected, not chosen arbitrarily.
This validates the site's declared association, not the audio contents or future URL availability.

### Configuring mirrors with environment variables

To support domain/TLD changes, configure mirrors by provider in your application's `.env`:

```dotenv
HITD2_MIRRORS='{"hitmos":["rus.hitmos.fm"],"hitmoz":["rue.hitmoz.org"]}'
```

The values may use **any domain/TLD**: explicit configuration maps each hostname to its parser.
For example, after a verified migration, replace a hostname with `music.example.net` without
rebuilding the package. Configured hosts are trusted **exactly**, not including their subdomains.
Only configure sites you trust: requests (including a configured session cookie) are sent to them.
This is configuration, not automatic detection of domain ownership or parser compatibility.

If the audio CDN also changes, trust its exact hostname separately:

```dotenv
HITD2_AUDIO_HOSTS='["cdn.example.net"]'
```

Configured page mirrors are also accepted as audio hosts for relative `/get/music/...` URLs.
Built-in Hitmos/Hitmoz audio domains remain trusted. Track binding and radio rejection still apply.

`HITD2_MIRRORS` replaces the discovery list; only the specified provider groups are probed, in
provider-group insertion order and array order within each group. Empty arrays, unknown provider names,
URLs, credentials, ports, IP addresses, and conflicting provider assignments are rejected.

The earlier `HITD2_HOSTS='["rus.hitmos.fm","rue.hitmoz.org"]'` remains supported as an optional
ordered discovery override. New domains in that list must also be assigned in `HITD2_MIRRORS`.
With neither variable set, built-in defaults are used. New subdomains of `hitmos.fm`/`hitmoz.org`
remain accepted in direct URLs without explicit configuration.

The library reads `process.env` lazily but does not load `.env` itself. Bun loads it automatically;
Node applications must load it before use (for example, `node --env-file=.env ...`). Restart the
application after changing configuration: selected hosts and results are cached.

### Domains and source preservation

Current primary domains are `rus.hitmos.fm` and `rue.hitmoz.org`. Existing Hitmoz aliases
(`ru.hitmoz.org`, `rus.hitmoz.org`, `hitmoz.org`, `www.hitmoz.org`) remain supported.

```ts
const audio = await api.getAudioByUrl("https://rue.hitmoz.org/song/76619761");
// Equivalent: api.getAudio("76619761", "rue.hitmoz.org")
```

Direct URL lookups preserve the specified host. Search remembers observed source hosts for ten minutes within the same `HITApi`
instance. Bare-ID lookups work only for unambiguous IDs; collisions throw and require a URL. If you persist IDs or use a different instance, also persist/pass their host or full
track URL. Numeric IDs alone do not identify the source across providers.

By default, host discovery tries Hitmos first and then Hitmoz aliases, checks HTTP success, and rejects
untrusted redirect/canonical domains. If no host responds successfully, it throws instead of caching
an unavailable fallback. A missing track is not automatically looked up on the other provider:
identical numeric IDs need not represent the same recording. Temporary track-request failures are
retried; an exhausted request fails and invalidates discovery for the next lookup.

Total search failure throws rather than becoming an empty result. Bounded per-source audio checks
are enabled by default during search. Audio URLs must use HTTP(S) on a Hitmos/Hitmoz domain without credentials;
track binding and radio rejection remain enforced separately.

Search results parsed from Hitmos RSC data are filtered against `/song/<id>` links when those links
are available. RSC-only responses remain searchable. A track can still disappear between search
and lookup; in that case callers receive `TrackNotFoundError`.

## Types

```ts
interface TrackMeta {
  id: string;
  title: string;
  artist: string;
  duration: number; // seconds
  uri: string; // "hitmos:track:{id}"
  name: string;
  duration_ms: number;
  explicit: boolean;
  image?: string;
}

interface TrackAudio {
  id: string;
  url: string; // best MP3 URL
  format: string;
  files: TrackAudioFile[];
  urls: string[];
  expiresAt: number;
}
```

## License

MIT

### Hitmo.net (third site format)

`music.hitmo.net` uses its own `hitmonet` provider, `/track/<id>` pages, and
`/search/<encoded-query>?type=tracks` searches. It is included after existing mirrors
in default discovery and parallel search. To configure mirrors explicitly:

```dotenv
HITD2_HOSTS='["music.hitmo.net","rus.hitmos.fm","rue.hitmoz.org"]'
```

```ts
const track = await api.getTrackByUrl("https://music.hitmo.net/track/9073969");
const audio = await api.getAudioByUrl("https://music.hitmo.net/track/9073969");
// Explicit source for numeric IDs:
const sameAudio = await api.getAudio("9073969", "music.hitmo.net");
```

Only the selected RSC component `item` with the requested ID supplies track metadata
and playback URLs. Related/similar tracks, radio lists, download links and arbitrary MP3
markup are not fallbacks; conflicting selected-track data is rejected. Search reads only
query-marked track lists. Built-in CDN domains such as `p1.hitmo.net` are trusted, subject
to normal audio validation. IDs are not portable between providers.

Future mirrors using this exact format can be assigned with
`HITD2_MIRRORS='{"hitmonet":["music.example.net"]}'`; custom external CDN hosts still
require `HITD2_AUDIO_HOSTS`. Other `hitmo.net` page hosts are not automatically assumed
to serve this format. No new public method or dependency is required.

### Hitmo.net albums

```ts
import { HITApi, AlbumError } from "hitd2";

const api = new HITApi();
const album = await api.getAlbumByUrl("https://music.hitmo.net/album/4335299");
console.log(album.title, album.artist, album.totalTracks, album.complete);
for (const track of album.tracks) {
  console.log(track.title, track.url);
  // Resolve on demand, not for every album entry upfront:
  // const audio = await api.getAudioByUrl(track.url);
}
```

`Album` contains `id`, `title`, `artist`, optional `image`, `tracks`, `totalTracks`,
and `complete`. Each `AlbumTrack` adds `url` and optional `sourceId` to `TrackMeta`.
The site distinguishes internal track IDs from public page IDs: album track `id`,
`uri`, and `url` use `fileId`; `sourceId` retains the internal ID. Use `track.url`
for subsequent lookups to preserve the source site.

Only the requested album source and matching album membership metadata are accepted.
Album order is preserved; recommendations are excluded. No automatic pagination is
attempted: `complete: false` explicitly indicates a partial album response.
Currently album URLs are supported only by the `hitmonet` provider.

`AlbumError` is exported with `albumId`, `host`, optional HTTP `status`, and code
`ALBUM_NOT_FOUND` (404/410), `ALBUM_HTTP_ERROR`, or `ALBUM_INVALID_DATA`.
429/5xx and recognized transient network failures are retried; missing albums are not.

The browser URL `https://music.hitmo.net/search/face` corresponds to `api.search("face")`
for the Hitmo.net part of parallel search (when enabled in configuration). The library
uses the track-only search variant and applies its normal relevance filters;
`getTrackByUrl()` accepts track URLs, not album or search pages.

### Live search → audio → download smoke test

```sh
bun run smoke:audio
bun run smoke:audio "FACE - ЛАБИРИНТ"
bun run smoke:audio "Скриптонит - Точно не нужно новых" --host=music.hitmo.net --full
```

Runs the three primary sites in isolated parallel processes, with a fresh API/cache
and an independent 45-second deadline per provider. Override the deadline with
`HITD2_SMOKE_TIMEOUT_MS` (milliseconds, minimum 1000). `--host=...` selects one
supported mirror. Reports search time, selected track ID, URL-resolution time, first-byte
latency, downloaded bytes, transfer rate and total elapsed time. Only the top-ranked
result is checked: unavailable candidates are not silently replaced.

By default, requests a 256 KiB byte range and cancels the stream after the sample
if the server ignores Range. It validates HTTP status, content type and an MP3 signature,
including redirect-host validation. This checks the beginning of a file, not that the
entire file is playable or contains the intended recording. `--full` reads the full
response to EOF without saving it (several MB per provider); audio transfer has a
30-second deadline capped by the provider deadline. Times are measured observations,
not availability or speed guarantees. Cold timings include host discovery.

This is an opt-in network diagnostic, not part of `test`/CI. Any failed provider
produces exit code 1. Queries and requests are sent to the selected sites/CDNs;
`.env` must be loaded by your runtime or environment.
