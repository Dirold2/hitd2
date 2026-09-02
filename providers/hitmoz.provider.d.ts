import type { HtmlElement } from "../core/html.js";
import type { SiteProvider } from "./base.js";
import type { TrackMeta } from "../models/track.js";
export declare class HitmozProvider implements SiteProvider {
    readonly name = "hitmoz";
    readonly hosts: string[];
    matches(host: string, html?: string): boolean;
    parseSearch(root: HtmlElement): TrackMeta[];
    parseTrackPage(root: HtmlElement, _host: string, trackId: string): Partial<TrackMeta>;
    extractAudioUrl(root: HtmlElement, html: string, _host: string, trackId: string): string | null;
}
//# sourceMappingURL=hitmoz.provider.d.ts.map