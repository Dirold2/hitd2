import type { TrackAudio } from "../models/audio.js";
import type { StreamTrackOptions } from "../models/stream.js";
/** Each iterator owns its cancellation, including return() while next() is blocked. */
export declare function streamAudio(resolve: () => Promise<TrackAudio>, fetchAudio: typeof globalThis.fetch, options: StreamTrackOptions, signal?: AbortSignal): AsyncGenerator<Uint8Array>;
//# sourceMappingURL=stream.d.ts.map