import type { HtmlElement } from "../../core/html.js";
import type { HitmosStructuredData } from "./types.js";
/**
 * Parses JSON-LD from an already downloaded Hitmos page. It performs no
 * network requests and only accepts entity URLs belonging to the current
 * host or the Hitmos.fm domain family.
 *
 * Album membership is derived only from explicit MusicRecording.inAlbum or
 * MusicAlbum.track relationships. It is never inferred from title text.
 */
export declare function parseHitmosStructuredData(root: HtmlElement, host: string): HitmosStructuredData;
//# sourceMappingURL=structured-data.d.ts.map