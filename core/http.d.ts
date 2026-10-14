import { HyperClient, Request } from "hyperttp";
export interface HttpTextResponse {
    data: string;
    ok: boolean;
    status: number;
}
export declare class HttpClient {
    private readonly client;
    constructor(client?: HyperClient);
    getText(req: Request): Promise<string>;
    getTextResponse(req: Request): Promise<HttpTextResponse>;
    private asText;
    getJson<T>(req: Request): Promise<T>;
}
//# sourceMappingURL=http.d.ts.map