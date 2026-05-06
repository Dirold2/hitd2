
export interface Image {
  url: string;
  width: number | null;
  height: number | null;
}

export interface TrackFile {
  format: string;
  fileId: string;
  bitrate?: number;
  quality?: string;
}

export interface TrackUrl {
  quality: string;
  fileId: string;
  url: string;
  decryptedBuffer?: Buffer;
  blobUrl?: string;
}

export interface TrackAudio {
  files: TrackFile[];
  urls: TrackUrl[];
}

export interface TrackMeta {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  artists: Array<{ id: string; name: string; uri: string }>;
  album: {
    id: string;
    name: string;
    uri: string;
    images: Image[];
    release_date: string;
  };
}