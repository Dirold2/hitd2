import { HITApi } from "../src/index.js";

const api = new HITApi();

(async () => {
  const search = await api.search(`Дико например`);

  console.log(search);
})();
