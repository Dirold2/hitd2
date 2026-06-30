import type { HTMLElement } from "node-html-parser";
import type { TrackMeta } from "../models/track.js";

export interface SiteProvider {
  readonly name: string;
  readonly hosts: string[];

  matches(host: string, html?: string): boolean;

  parseSearch(root: HTMLElement): TrackMeta[];

  parseTrackPage(root: HTMLElement, host: string, trackId: string): Partial<TrackMeta>;

  extractAudioUrl(root: HTMLElement, html: string, host: string, trackId: string): string | null;
}
