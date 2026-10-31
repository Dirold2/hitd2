# Changelog

## [1.3.0] - 2026-11-01

- Require exact normalized artist/title intent for structured searches and all whole-word tokens for plain queries; retain explicitly requested alternate versions.
- Preserve version distinctions during search deduplication and rank before duplicate selection.
- Read all Hitmos RSC track arrays and reject conflicting audio URLs for the requested ID.
- Validate Hitmoz search routes against declared IDs and use only selected-track metadata for track-page parsing.
- Export `AudioExtractionError` for missing or ambiguous verified audio; remove the unverified play-API fallback and preserve active hosts for extraction failures.
- Support `rue.hitmoz.org` alongside `rus.hitmos.fm` and legacy aliases using shared host lists.
- Configure domain/TLD migrations with provider-specific `HITD2_MIRRORS` and exact CDN trust via `HITD2_AUDIO_HOSTS`; retain `HITD2_HOSTS` as an ordered discovery override and built-in defaults when unset.
- Accept new `hitmos.fm` and `hitmoz.org` subdomains in direct track URLs and host discovery without package updates; enforce domain boundaries when selecting providers.
- Validate host-probe status and redirect/canonical domains, bound probe duration, and reject discovery when no host is available.
- Preserve search-source hosts for subsequent ID-based lookups and isolate cached search metadata by host.
- Propagate search HTTP failures rather than caching error pages as empty search results.
- Validate audio URL protocols, credentials, and domain boundaries; reject lookalike domains.
- Resolve relative Hitmoz cover URLs against the source host.
- Remove live host discovery from provider fixture tests; add offline regression coverage for environment configuration, discovery order, source preservation, track/version matching, malformed metadata, conflicting audio URLs, and unsafe routes.

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
