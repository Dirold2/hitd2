import assert from "node:assert/strict";
import { isValidAudioUrl } from "../src/core/filters.js";

const validUrls = [
  "https://hitmos.fm/song.mp3",
  "http://hitmos.me/song.mp3",
  "https://hitmos.me/song.mp3",
  "https://pl1.hitmos.fm/Lcorrect.mp3",
  "https://pl2.hitmos.fm/track.mp3",
  "https://plc1.hitmos.fm/face-labirint.mp3",
  "https://plc2.hitmos.me/mp3/song.mp3",
  "https://dwc1.hitmos.fm/song.mp3?token=abc&expires=123",
  "https://dwc2.hitmos.me/song.mp3",
  "https://cdn.audio.hitmos.fm/song.mp3",
  "https://hitmoz.org/get/music/20230808/Moz_Artist_-_Moz_Song_moz-7.mp3",
  "https://ru.hitmoz.org/get/music/song.mp3",
  "https://rue.hitmoz.org/get/music/song.mp3",
  "https://cdn.rue.hitmoz.org/get/music/song.mp3?token=abc",
  "http://rue.hitmoz.org:8080/get/music/song.mp3",
  "HTTPS://PLC1.HITMOS.FM/song.mp3",
];

const invalidUrls = [
  "",
  "not a URL",
  "/mp3/track.mp3",
  "//plc1.hitmos.fm/song.mp3",
  "https://",
  "https://hitmos.fm:invalid/song.mp3",
  "javascript:alert('hitmos.fm/track.mp3')",
  "javascript://hitmos.fm/track.mp3",
  "data:audio/mpeg,hitmos.fm/track.mp3",
  "file://hitmos.fm/track.mp3",
  "ftp://hitmos.fm/track.mp3",
  "https://user@hitmos.fm/song.mp3",
  "https://user:password@plc1.hitmos.fm/song.mp3",
  "https://:password@rue.hitmoz.org/get/music/song.mp3",
  "https://user%40example.com@hitmos.me/song.mp3",
  "https://hitmos.fm@evil.example/track.mp3",
  "https://evil.example@hitmos.fm/track.mp3",
  "https://evil.example/track.mp3",
  "https://evil.example/mp3/song.mp3",
  "https://evil.example/hitmos.fm/song.mp3",
  "https://evil.example/?url=https://hitmos.me/song.mp3",
  "https://evil.example/#https://rue.hitmoz.org/get/music/song.mp3",
  "https://hitmos.fm.evil.example/track.mp3",
  "https://plc1.hitmos.me.evil.example/song.mp3",
  "https://rue.hitmoz.org.evil.example/get/music/song.mp3",
  "https://evilhitmos.fm/song.mp3",
  "https://evilhitmos.me/song.mp3",
  "https://evilhitmoz.org/get/music/song.mp3",
  "https://hitmos-fm.example/song.mp3",
  "https://hitmoz.org%2eevil.example/get/music/song.mp3",
  "https://127.0.0.1/track.mp3",
  "https://[::1]/mp3/song.mp3",
];

// Keep the existing substring exclusions, including query strings and mixed case.
const rejectedFragments = [
  "radio",
  "stream",
  "hostingradio",
  "listen",
  "retro256",
  "128.mp3",
  "320.mp3",
];
for (const host of ["plc1.hitmos.fm", "dwc1.hitmos.me", "rue.hitmoz.org"]) {
  for (const fragment of rejectedFragments) {
    invalidUrls.push(`https://${host}/get/music/${fragment.toUpperCase()}`);
    invalidUrls.push(`https://${host}/song.mp3?source=${fragment}`);
  }
}

for (const url of validUrls) {
  assert.equal(isValidAudioUrl(url), true, `Expected valid audio URL: ${url}`);
}
for (const url of invalidUrls) {
  assert.equal(isValidAudioUrl(url), false, `Expected rejected audio URL: ${url}`);
}

console.log(`Audio URL tests passed (${validUrls.length + invalidUrls.length} cases)`);
