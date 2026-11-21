import { HyperClient } from "hyperttp";
export interface HttpRequest {
    url: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}
export interface HttpTextResponse {
    data: string;
    ok: boolean;
    status: number;
}
export declare class HttpClient {
    private readonly fetchText?;
    private readonly client;
    constructor(client?: HyperClient, fetchText?: typeof globalThis.fetch | undefined);
    getText(req: HttpRequest): Promise<string>;
    getTextResponse(req: HttpRequest): Promise<HttpTextResponse>;
    private asText;
    getJson<T>(req: HttpRequest): Promise<T>;
}
//# sourceMappingURL=http.d.ts.map