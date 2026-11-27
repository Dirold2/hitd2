"use strict";import{providerForHost as e}from"../core/hosts.js";export class ProviderRegistry{providers;constructor(r){this.providers=r}resolve(r,s){return this.providers.find(i=>i.name===e(r))??this.providers.find(i=>i.matches(r,s))??this.providers[0]}}
//# sourceMappingURL=registry.js.map
