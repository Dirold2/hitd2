# hitd2

> Unofficial Node.js wrapper for the Hitmo API ([hitmo.me](http://hitmo.me))

Search for music tracks, retrieve metadata, and extract MP3 audio URLs from hitmo sites.

## Features

- Search tracks by query
- Get track metadata (title, artist, duration, cover image)
- Extract playable MP3 URLs
- Built-in retries and discovery of available hosts (`rus.hitmos.fm`, `rue.hitmoz.org`, and legacy aliases)
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

const track = await api.getTrack(tracks[0].id);
const audio = await api.getAudio(tracks[0].id);

console.log(track, audio);
```

## API

### `HITApi(options?)`

| Option          | Type          | Default | Description                               |
| --------------- | ------------- | ------- | ----------------------------------------- |
| `httpClient`    | `HyperClient` | —       | Custom HTTP client instance               |
| `sessionCookie` | `string`      | —       | Session cookie for authenticated requests |

### `search(query, limit?)`

Search for tracks. Returns `TrackMeta[]`.

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
`hitmos` then `hitmoz` order and array order within each group. Empty arrays, unknown provider names,
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

Direct URL lookups preserve the specified host. Search remembers the source host for each returned
ID for ten minutes within the same `HITApi` instance, so subsequent `getAudio(id)` and `getTrack(id)`
use that source. If you persist IDs or use a different instance, also persist/pass their host or full
track URL. Numeric IDs alone do not identify the source across providers.

By default, host discovery tries Hitmos first and then Hitmoz aliases, checks HTTP success, and rejects
untrusted redirect/canonical domains. If no host responds successfully, it throws instead of caching
an unavailable fallback. A missing track is not automatically looked up on the other provider:
identical numeric IDs need not represent the same recording. Temporary track-request failures are
retried; an exhausted request fails and invalidates discovery for the next lookup.

Search HTTP errors are propagated rather than cached as an empty result. No per-result audio requests
are made during search. Audio URLs must use HTTP(S) on a Hitmos/Hitmoz domain without credentials;
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
