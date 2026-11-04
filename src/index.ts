export { HITApi } from "./api/HITApi.js";
export { TrackNotFoundError, AudioExtractionError, AlbumError } from "./core/errors.js";
export type { AlbumErrorCode } from "./core/errors.js";
export type { Album, AlbumTrack } from "./models/album.js";
export type { TrackMeta } from "./models/track.js";
export type { TrackAudio } from "./models/audio.js";
export type {
  InitializeOptions,
  InitializationReport,
  ProviderInitializationStatus,
  SearchDiagnostic,
  SearchOptions,
  SearchAvailability,
  SearchSource,
  SearchTrack,
} from "./models/search.js";
