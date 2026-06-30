import { HyperClient, Request } from "hyperttp";
import { DEFAULT_HTTP_CONFIG } from "./config.js";

export class HttpClient {
  private readonly client: HyperClient;

  constructor(client?: HyperClient) {
    this.client = client ?? new HyperClient(DEFAULT_HTTP_CONFIG);
  }

  async getText(req: Request): Promise<string> {
    return this.client.get<string>(req, "text");
  }

  async getJson<T>(req: Request): Promise<T> {
    return this.client.get<T>(req, "json");
  }
}
