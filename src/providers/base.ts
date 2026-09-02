import type { HtmlElement } from "../core/html.js";
import type { TrackMeta } from "../models/track.js";

export interface SiteProvider {
  readonly name: string;
  readonly hosts: string[];

  matches(host: string, html?: string): boolean;

  parseSearch(root: HtmlElement): TrackMeta[];

  parseTrackPage(root: HtmlElement, host: string, trackId: string): Partial<TrackMeta>;

  extractAudioUrl(root: HtmlElement, html: string, host: string, trackId: string): string | null;
}
