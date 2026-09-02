import type { HtmlElement } from "../core/html.js";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
export declare class HitmosProvider implements SiteProvider {
    readonly name = "hitmos";
    readonly hosts: string[];
    matches(host: string, html?: string): boolean;
    parseSearch(root: HtmlElement): TrackMeta[];
    private parseSearchLegacy;
    parseTrackPage(root: HtmlElement, _host: string, _trackId: string): Partial<TrackMeta>;
    extractAudioUrl(_root: HtmlElement, html: string, _host: string, trackId: string): string | null;
}
//# sourceMappingURL=hitmos.provider.d.ts.map