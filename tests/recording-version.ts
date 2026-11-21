import assert from "node:assert/strict";
import type { SearchTrack } from "../src/models/search.js";
import {
  classifyRecordingVersions,
  prioritizeOriginalRecordings,
} from "../src/core/recording-version.js";

function track(id: string, artist: string, duration: number): SearchTrack {
  return {
    id,
    title: "Порнозвезда",
    artist,
    duration,
    uri: `hitmos:track:${id}`,
    name: "Порнозвезда",
    duration_ms: duration * 1000,
    explicit: false,
    host: "rus.hitmos.fm",
    url: `https://rus.hitmos.fm/song/${id}`,
    sources: [],
  };
}

function classify(tracks: SearchTrack[], titles: Array<[SearchTrack, string]>): void {
  classifyRecordingVersions(tracks, new Map(titles));
}

// 1. Real example: release-associated original + probable slow version.
{
  const original = track("9876484", "ЛСП & PHARAOH", 275);
  const slow = track("10113157", "Pharaoh & ЛСП", 289);

  const tracks = [slow, original];

  classify(tracks, [
    [original, "Порнозвезда (Кондитерская 2016)"],
    [slow, "Порнозвезда"],
  ]);

  assert.equal(original.recordingVersion?.type, "original");
  assert.equal(slow.recordingVersion?.type, "slow");
  assert.equal(slow.recordingVersion?.speedFactor, 0.95);

  prioritizeOriginalRecordings(tracks);

  assert.deepEqual(
    tracks.map((item) => item.id),
    ["9876484", "10113157"],
  );
}

// 2. No release annotation: do not guess.
{
  const first = track("first", "Artist A & Artist B", 275);
  const second = track("second", "Artist B & Artist A", 289);

  classify(
    [first, second],
    [
      [first, "Порнозвезда"],
      [second, "Порнозвезда"],
    ],
  );

  assert.equal(first.recordingVersion, undefined);
  assert.equal(second.recordingVersion, undefined);
}

// 3. Same duration: different IDs do not imply a speed variant.
{
  const first = track("first", "Artist A & Artist B", 275);
  const second = track("second", "Artist B & Artist A", 275);

  classify(
    [first, second],
    [
      [first, "Порнозвезда (Кондитерская 2016)"],
      [second, "Порнозвезда"],
    ],
  );

  assert.equal(first.recordingVersion, undefined);
  assert.equal(second.recordingVersion, undefined);
}

// 4. Duration ratio outside supported speed factors.
{
  const first = track("first", "Artist A & Artist B", 275);
  const second = track("second", "Artist B & Artist A", 300);

  classify(
    [first, second],
    [
      [first, "Порнозвезда (Кондитерская 2016)"],
      [second, "Порнозвезда"],
    ],
  );

  assert.equal(first.recordingVersion, undefined);
  assert.equal(second.recordingVersion, undefined);
}

// 5. Both recordings have release annotations: insufficient evidence.
{
  const first = track("first", "Artist A & Artist B", 275);
  const second = track("second", "Artist B & Artist A", 289);

  classify(
    [first, second],
    [
      [first, "Порнозвезда (Кондитерская 2016)"],
      [second, "Порнозвезда (Другой альбом 2018)"],
    ],
  );

  assert.equal(first.recordingVersion, undefined);
  assert.equal(second.recordingVersion, undefined);
}

// 6. More than two sibling recordings: do not guess.
{
  const first = track("first", "Artist A & Artist B", 275);
  const second = track("second", "Artist B & Artist A", 289);
  const third = track("third", "Artist A & Artist B", 305);

  classify(
    [first, second, third],
    [
      [first, "Порнозвезда (Кондитерская 2016)"],
      [second, "Порнозвезда"],
      [third, "Порнозвезда"],
    ],
  );

  assert.equal(first.recordingVersion, undefined);
  assert.equal(second.recordingVersion, undefined);
  assert.equal(third.recordingVersion, undefined);
}

// 7. Longer release-associated recording + shorter alternative = sped up.
{
  const original = track("original", "Artist A & Artist B", 289);
  const spedUp = track("sped-up", "Artist B & Artist A", 275);

  classify(
    [spedUp, original],
    [
      [original, "Порнозвезда (Кондитерская 2016)"],
      [spedUp, "Порнозвезда"],
    ],
  );

  assert.equal(original.recordingVersion?.type, "original");
  assert.equal(spedUp.recordingVersion?.type, "sped_up");
  assert.ok(Math.abs(spedUp.recordingVersion!.speedFactor - 1 / 0.95) < 0.0001);
}

console.log("Recording version tests passed");
