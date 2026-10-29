# Changelog

## [1.2.5] - 2026-10-29

- Improve search-result validation, ranking, de-duplication, and caching; reject obviously non-musical results while retaining legitimate alternate versions.
- Improve structured `artist - title` searches: require both artist and full title matches, and exclude candidates with no relevant query terms.
- Add fixture-free scoring coverage for artist/title searches and generic relevance filtering.
- Keep separate host-aware caches for search metadata, track metadata, and audio URLs; return defensive copies so callers cannot mutate cached values.
- Accept supported Hitmo track URLs directly in `getTrack()` and `getAudio()`, with validation of protocols, hosts, credentials, and track IDs.
- Extract and normalize cover URLs from Hitmos and Hitmoz search results, including lazy-loaded and `srcset` images.
- Harden request construction and session-cookie handling, and update `hyperttp` to `0.6.2` plus development tooling dependencies.
- Add examples for search and direct track/audio URL resolution.

## [1.2.4] — 2026-10-20

- Upgrade to `hyperttp` 0.6 and update development tooling dependencies.

## [1.2.3] — 2026-10-16

- Support Hitmos RSC `list` and `tracks` arrays when they are not followed by a `footer` field.
- Add deterministic regression coverage for missing tracks, cache/retry behavior, and track-bound audio extraction without live Hitmo requests.

## [1.2.2] — 2026-10-07

- Add exported `TrackNotFoundError` for track pages returning HTTP 404 or 410.
- Do not cache error pages; cache missing track IDs for three minutes to avoid repeated requests.
- Preserve the active host when a specific track is missing, while retaining retry/failover for 429, 5xx, and transport errors.
- Bind Hitmos/Hitmoz audio extraction to the requested track data and never select arbitrary MP3 URLs from page markup.
- Resolve relative Hitmoz `/get/music/...` URLs from a selected track's metadata against the source host.
- Read the raw HTML response body under Bun, where Hyperttp may expose parsed HTML through `response.data`; this restores Hitmoz track metadata and audio URL extraction.
- Filter RSC Hitmos search entries without a matching `/song/<id>` link when server-rendered links are available, while retaining RSC-only search responses.
- Support multiline and single-quoted Next/RSC script payloads emitted by Hitmos.

## [1.2.1] — 2026-09-02

- Add an HTML parsing adapter and fixture-based provider tests.
- Restore Hyperttp 0.5.x compatibility by passing request URLs and headers to `HyperClient`.
- Preserve the source host for track and audio URL lookups.
- Extract Hitmoz audio URLs from `data-musmeta` and `/get/cuts/...mp3` markup.
- Reject radio and generic stream URLs when selecting an audio source.
- Verify smoke tests with Bun and Node.

## [1.2.0] — 2026-07-01

- Bump version in package.json

## [1.1.1] — 2026-06-27

- Fixes and improvements

## [1.1.0] — 2026-06-27

- Feature release

## [1.0.0] — 2026-06-27

- Initial stable release
