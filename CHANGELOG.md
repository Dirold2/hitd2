# Changelog

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
