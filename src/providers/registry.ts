import type { SiteProvider } from "./base.js";

export class ProviderRegistry {
  constructor(private readonly providers: SiteProvider[]) {}

  resolve(host: string, html?: string): SiteProvider {
    return (
      this.providers.find((p) => p.hosts.includes(host)) ??
      this.providers.find((p) => p.matches(host, html)) ??
      this.providers[0]
    );
  }
}
