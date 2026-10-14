import { HyperClient, Request } from "hyperttp";
import { DEFAULT_HTTP_CONFIG } from "./config.js";

export interface HttpTextResponse {
  data: string;
  ok: boolean;
  status: number;
}

export class HttpClient {
  private readonly client: HyperClient;

  constructor(client?: HyperClient) {
    this.client = client ?? new HyperClient(DEFAULT_HTTP_CONFIG);
  }

  async getText(req: Request): Promise<string> {
    return this.client.get<string>(req.url, {
      headers: req.headers,
      responseType: "text",
    });
  }

  async getTextResponse(req: Request): Promise<HttpTextResponse> {
    const response = await this.client.rest.get<unknown>(req.url, {
      headers: req.headers,
    });

    const rawBody = (response.raw as { body?: unknown } | undefined)?.body;

    return {
      data: this.asText(rawBody ?? response.data),
      ok: response.ok,
      status: response.status,
    };
  }

  private asText(data: unknown): string {
    if (typeof data === "string") return data;
    if (data instanceof Uint8Array) return new TextDecoder().decode(data);
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
    }

    return String(data ?? "");
  }

  async getJson<T>(req: Request): Promise<T> {
    return this.client.get<T>(req.url, {
      headers: req.headers,
      responseType: "json",
    });
  }
}
