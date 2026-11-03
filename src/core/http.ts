import { HyperClient } from "hyperttp";
import { DEFAULT_HTTP_CONFIG } from "./config.js";

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

export class HttpClient {
  private readonly client: HyperClient;

  constructor(
    client?: HyperClient,
    private readonly fetchText?: typeof globalThis.fetch,
  ) {
    this.client = client ?? new HyperClient(DEFAULT_HTTP_CONFIG);
    if (!client && !fetchText) this.fetchText = (...args) => globalThis.fetch(...args);
  }

  async getText(req: HttpRequest): Promise<string> {
    return this.client
      .request(req.url)
      .get()
      .headers(req.headers ?? {})
      .text()
      .send<string>();
  }

  async getTextResponse(req: HttpRequest): Promise<HttpTextResponse> {
    req.signal?.throwIfAborted();
    // Deadline-bound search requests bypass transport plugins/retries, keeping
    // cancellation active through consumption of the response body.
    if (req.signal && this.fetchText) {
      const response = await this.fetchText(req.url, {
        headers: req.headers,
        signal: req.signal,
        redirect: "error",
      });
      return { data: await response.text(), ok: response.ok, status: response.status };
    }
    const response = await this.client.rest.get<unknown>(req.url, {
      headers: req.headers,
      signal: req.signal,
    });
    req.signal?.throwIfAborted();

    const rawBody = (response.raw as { body?: unknown } | undefined)?.body;

    return {
      data: this.asText(rawBody ?? response.data),
      ok: response.ok,
      status: response.status,
    };
  }

  private asText(data: unknown): string {
    if (typeof data === "string") return data;

    if (data instanceof Uint8Array) {
      return new TextDecoder().decode(data);
    }

    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(new Uint8Array(data));
    }

    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
    }

    return String(data ?? "");
  }

  async getJson<T>(req: HttpRequest): Promise<T> {
    return this.client
      .request(req.url)
      .get()
      .headers(req.headers ?? {})
      .json()
      .send<T>();
  }
}
