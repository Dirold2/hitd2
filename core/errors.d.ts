export declare class TrackNotFoundError extends Error {
    readonly trackId: string;
    readonly host?: string;
    readonly status: 404 | 410;
    constructor(trackId: string, status?: 404 | 410, host?: string);
}
//# sourceMappingURL=errors.d.ts.map