import assert from "node:assert/strict";
import { scoreSearchCandidate, sortTracksByScore } from "../src/core/scoring.js";
import type { TrackMeta } from "../src/models/track.js";

function track(id: string, artist: string, title: string, duration = 240): TrackMeta {
  return {
    id,
    artist,
    title,
    duration,
    uri: `hitmos:track:${id}`,
    name: title,
    duration_ms: duration * 1000,
    explicit: false,
  };
}

function ids(query: string, candidates: TrackMeta[]): string[] {
  return sortTracksByScore(query, candidates).map((candidate) => candidate.id);
}

const candidates = [
  track("live", "Скриптонит", "Точно не нужно новых (Live)", 600),
  track("exact", "Скриптонит", "Точно не нужно новых"),
  track("artist-only", "Скриптонит", "Проблемы"),
  track("unrelated", "Другой артист", "Совсем другая песня"),
  track("extra", "Скриптонит", "Точно не нужно новых слов"),
  track("reordered", "Скриптонит", "Новых точно не нужно"),
  track("partial", "Скриптонит", "Точно не нужно"),
];

assert.deepEqual(
  ids("Скриптонит - Точно не нужно новых", candidates),
  ["exact"],
  "structured queries require the full title in order, without unsolicited Live or extra words",
);
assert.deepEqual(
  ids("Скриптонит — Точно не нужно новых (Live)", candidates),
  ["live"],
  "an explicitly requested Live recording must not match the original",
);
assert.deepEqual(
  ids("Скриптонит", candidates.slice(0, 4)),
  ["exact", "artist-only", "live"],
  "artist-only queries remain broad, with originals before live recordings",
);

const normalized = [track("normalized", "БЬЁРК", "Ｆｕｌｌ：  Ёлка… Ночь!")];
for (const separator of ["-", "–", "—"]) {
  assert.deepEqual(
    ids(`  бьерК ${separator} full елка ночь  `, normalized),
    ["normalized"],
    "matching uses NFKC, lowercase, ё=е and punctuation/whitespace normalization",
  );
}
assert.deepEqual(
  ids("Björk - Jóga", [track("accent", "Björk", "Jóga"), track("different", "Bjork", "Joga")]),
  ["accent"],
  "normalization must not erase meaningful accents",
);
assert.deepEqual(
  ids("Artist - Go Go", [track("once", "Artist", "Go"), track("twice", "Artist", "Go Go")]),
  ["twice"],
  "full title equality preserves repeated tokens",
);

const artists = [
  track("exact", "Ann", "Song"),
  track("substring", "Anna", "Song"),
  track("extra", "Ann Marie", "Song"),
  track("reordered", "Marie Ann", "Song"),
  track("feat", "Guest feat. Ann", "Song"),
  track("ft", "Ann ft. Guest", "Song"),
  track("featuring", "Guest featuring Ann", "Song"),
  track("and", "Guest and Ann", "Song"),
  track("ampersand", "Guest & Ann", "Song"),
  track("participant-extra", "Guest feat. Ann Marie", "Song"),
  track("word", "Guest and Anna", "Song"),
];
assert.deepEqual(
  ids("Ann - Song", artists),
  ["exact", "feat", "ft", "featuring", "and", "ampersand"],
  "artist identity is exact or a complete explicitly delimited participant, never a token/substring",
);
assert.deepEqual(
  ids("Ann Marie - Song", artists),
  ["extra", "participant-extra"],
  "multiword artist identity preserves order and the entire participant name",
);
assert.deepEqual(
  ids("Guest & Ann - Song", artists),
  ["ampersand"],
  "the full collaboration identity may also match exactly",
);

for (const variant of [
  "Live",
  "Remix",
  "Cover",
  "Instrumental",
  "Karaoke",
  "Acoustic",
  "Radio Edit",
  "Slowed",
  "Remastered",
]) {
  const recordings = [
    track("original", "Artist", "Song"),
    track("requested", "Artist", `Song (${variant})`),
    track("other", "Artist", `Song (${variant} Extended)`),
  ];
  assert.deepEqual(
    ids("Artist - Song", recordings),
    ["original"],
    `${variant} is not the original`,
  );
  assert.deepEqual(
    ids(`Artist - Song (${variant})`, recordings),
    ["requested"],
    `explicit ${variant} survives filtering and still requires the full title`,
  );
  assert.deepEqual(
    ids(`Song ${variant}`, recordings),
    ["requested", "other"],
    `plain queries can explicitly request ${variant}`,
  );
}
assert.deepEqual(
  ids("Artist - Song (DJ Remix)", [
    track("other-dj", "Artist", "Song (Other Remix)"),
    track("requested", "Artist", "Song (DJ Remix)"),
    track("cover", "Artist", "Song (DJ Cover)"),
  ]),
  ["requested"],
  "requesting a remix does not authorize other remix names or covers",
);
assert.deepEqual(
  ids("Remix Band - Song", [track("wrong", "Remix Band", "Song (Remix)")]),
  [],
  "variant words in artist names do not authorize unrequested variants",
);
assert.deepEqual(
  ids("Song Remix", [
    track("noise", "Artist", "Song Remix TikTok"),
    track("cover", "Artist", "Song Remix Cover"),
    track("remix", "Artist", "Song Remix"),
  ]),
  ["remix"],
  "requesting one variant does not bypass filtering of additional unwanted variants/noise",
);

assert.deepEqual(
  ids("Ann Song", [
    track("split", "Ann", "Song"),
    track("title-only", "Someone", "Ann Song"),
    track("partial", "Ann", "Other"),
    track("substring", "Anna", "Songbook"),
    track("one-substring", "Ann", "Songbook"),
  ]),
  ["title-only", "split"],
  "plain queries require every whole token across the combined artist/title fields",
);
assert.deepEqual(
  ids("елка ночь", [track("unicode", "ЁЛКА", "Ночь!"), track("prefix", "Ёлками", "Ночной")]),
  ["unicode"],
  "plain queries use the same Unicode normalization and whole-token boundaries",
);
for (const query of ["", "   ", "?!"]) {
  assert.deepEqual(ids(query, candidates), [], "empty/tokenless queries match nothing");
}

const ranking = [
  track("live", "Artist", "Song (Live)", 900),
  track("version", "Artist", "Song (Album Version)", 800),
  track("original", "Artist", "Song", 10),
];
assert.deepEqual(
  ids("Song", ranking),
  ["original", "live", "version"],
  "an exact original ranks above variants regardless of duration",
);
assert.ok(
  scoreSearchCandidate("Song", "Artist", "Song") >
    scoreSearchCandidate("Song (Live)", "Artist", "Song"),
  "the exported candidate scorer also ranks the original first",
);
assert.ok(
  scoreSearchCandidate("Song (Live)", "Artist", "Artist - Song") < 8,
  "the exported candidate scorer rejects structured title mismatches",
);
assert.deepEqual(
  ids("Artist - Song", [
    track("short", "Artist", "Song", 100),
    track("long", "Artist", "Song", 300),
  ]),
  ["long", "short"],
  "duration remains the tie-breaker for equally relevant recordings",
);
const before = [...ranking];
ids("Song", ranking);
assert.deepEqual(ranking, before, "sorting does not mutate the caller's candidate array");

console.log("Search scoring tests passed");
