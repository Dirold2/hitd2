export declare const HITMOS_HOSTS: string[];
export declare const HITMOZ_HOSTS: string[];
export declare const HITMONET_HOSTS: string[];
export declare const SEARCH_HOSTS: string[];
export declare function isDomainHost(host: string, domain: string): boolean;
export declare function isSupportedHost(host: string): boolean;
/** Read lazily so applications can load their environment before creating the API. */
export declare function getSearchHosts(value?: string | undefined): string[];
export declare function isSupportedPageUrl(url: URL): boolean;
export type HostProvider = "hitmos" | "hitmoz" | "hitmonet";
export declare function getConfiguredMirrors(): Partial<Record<HostProvider, string[]>>;
export declare function providerForHost(host: string): HostProvider | undefined;
export declare function isTrustedAudioHost(host: string): boolean;
export declare function trackPagePath(host: string, id: string): string;
//# sourceMappingURL=hosts.d.ts.map