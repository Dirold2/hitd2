import type { SearchSource } from "../models/search.js";
/**
 * Ranks audio sources using current verification results and in-memory
 * historical host reliability. History is scoped to one HITApi instance.
 */
export declare class SourceQualityRanker {
    private readonly hosts;
    private hostKey;
    /** Records one completed source verification. */
    record(source: SearchSource): void;
    private getHealth;
    /** Negative means `a` should be preferred over `b`. */
    compare(a: SearchSource, b: SearchSource): number;
    /** Returns a ranked copy and preserves original order for exact ties. */
    sort(sources: readonly SearchSource[]): SearchSource[];
}
//# sourceMappingURL=source-quality.d.ts.map