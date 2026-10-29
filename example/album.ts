import { HITApi } from "../src/index.js";

const api = new HITApi();

(async () => {
  const url = `https://rus.hitmos.fm/song/9937652`;
  const track = await api.getAudio(url);

  console.log(track);
})();
