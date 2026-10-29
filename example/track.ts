import { HITApi } from "../src/index.js";

const api = new HITApi();

(async () => {
  const url = `https://ru.hitmoz.org/song/62323749`;
  const track = await api.getTrack(url);

  console.log(track);
})();
