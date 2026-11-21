import type { SiteProvider } from "./base.js";
export declare class ProviderRegistry {
    private readonly providers;
    constructor(providers: SiteProvider[]);
    resolve(host: string, html?: string): SiteProvider;
}
//# sourceMappingURL=registry.d.ts.map