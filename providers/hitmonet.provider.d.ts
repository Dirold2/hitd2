import type { HtmlElement } from "../core/html.js";
import type { Album } from "../models/album.js";
import type { TrackMeta } from "../models/track.js";
import type { SiteProvider } from "./base.js";
export declare class HitmonetProvider implements SiteProvider {
    readonly name = "hitmonet";
    readonly hosts: string[];
    matches(host: string, _html?: string): boolean;
    parseSearch(root: HtmlElement, host: string): TrackMeta[];
    parseAlbum(root: HtmlElement, host: string, albumId: string): Album | null;
    parseTrackPage(root: HtmlElement, host: string, trackId: string): Partial<TrackMeta>;
    extractAudioUrl(_root: HtmlElement, html: string, host: string, trackId: string): string | null;
}
//# sourceMappingURL=hitmonet.provider.d.ts.map