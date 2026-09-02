import { HyperClient, Request } from "hyperttp";
export declare class HttpClient {
    private readonly client;
    constructor(client?: HyperClient);
    getText(req: Request): Promise<string>;
    getJson<T>(req: Request): Promise<T>;
}
//# sourceMappingURL=http.d.ts.map