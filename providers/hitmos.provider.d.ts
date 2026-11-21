import type { HtmlElement } from "../core/html.js";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
export declare class HitmosProvider implements SiteProvider {
    readonly name = "hitmos";
    readonly hosts: string[];
    matches(host: string, html?: string): boolean;
    parseSearch(root: HtmlElement, host: string): TrackMeta[];
    extractSearchAudioUrls(root: HtmlElement, html: string, host: string): ReadonlyMap<string, string>;
    parseTrackPage(root: HtmlElement, host: string, trackId: string): Partial<TrackMeta>;
    extractAudioUrl(_root: HtmlElement, html: string, _host: string, trackId: string): string | null;
    private parseSearchLegacy;
}
//# sourceMappingURL=hitmos.provider.d.ts.map