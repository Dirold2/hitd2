import type { TrackMeta } from "./track.js";

export interface AlbumTrack extends TrackMeta {
  /** Canonical track page, addressed by fileId rather than the internal track ID. */
  url: string;
  /** Internal provider ID; id and uri use the public fileId. */
  sourceId?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  image?: string;
  tracks: AlbumTrack[];
  totalTracks: number;
  /** Whether this response contains the entire album, not just one pagination page. */
  complete: boolean;
}
