# hitd2

> Unofficial Node.js wrapper for the Hitmo API ([hitmo.me](http://hitmo.me))

Search for music tracks, retrieve metadata, and extract MP3 audio URLs from hitmo sites.

## Features

- Search tracks by query
- Get track metadata (title, artist, duration, cover image)
- Extract playable MP3 URLs
- Built-in retry with host failover (`hitmos.fm`, `hitmoz.org`)
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

### `getTrack(trackId)`

Get full metadata for a track. Returns `TrackMeta`.

### `getAudio(trackId)`

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

Search results parsed from Hitmos RSC data are retained only when the same search page contains a
matching `/song/<id>` route. The library does not fetch every result during search, so a track can
still disappear between search and lookup; in that case callers receive `TrackNotFoundError`.

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
