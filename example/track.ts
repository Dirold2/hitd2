import { HITApi } from "../src"

const api = new HITApi();

(async () => {
    const search = await api.search(`Макс Корж`)
    console.log(search);
})();
