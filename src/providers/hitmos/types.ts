export interface RscTrack {
  id: number;
  artist: string;
  title: string;
  version?: string;
  duration: number;
  bitrate?: number;
  play?: string;
  download?: string;
}

export interface HitmosArtist {
  id?: string;
  name?: string;
  url?: string;
}

export interface HitmosAlbumReference {
  id?: string;
  name?: string;
  url?: string;
}

export interface HitmosRecording {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  artists: HitmosArtist[];
  duration?: number;
  albums: HitmosAlbumReference[];
}

export interface HitmosAlbum {
  id: string;
  url: string;
  title?: string;
  artists: HitmosArtist[];
  datePublished?: string;
  albumReleaseType?: string;
  numTracks?: number;
  tracks: HitmosRecording[];
  /** True only when the explicit track list is resolved and matches numTracks. */
  trackListComplete: boolean;
}

export interface HitmosStructuredData {
  recordings: ReadonlyMap<string, HitmosRecording>;
  albums: ReadonlyMap<string, HitmosAlbum>;
}
