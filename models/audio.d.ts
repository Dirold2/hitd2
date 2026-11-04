export interface TrackAudioFile {
    url: string;
    format: string;
    bitrate?: number;
}
export interface TrackAudio {
    id: string;
    url: string;
    format: string;
    files: TrackAudioFile[];
    urls: string[];
    expiresAt: number;
}
//# sourceMappingURL=audio.d.ts.map