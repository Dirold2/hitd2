"use strict";export class ProviderRegistry{providers;constructor(r){this.providers=r}resolve(r,i){return this.providers.find(s=>s.hosts.includes(r))??this.providers.find(s=>s.matches(r,i))??this.providers[0]}}
//# sourceMappingURL=registry.js.map
