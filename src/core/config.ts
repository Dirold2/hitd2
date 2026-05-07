export const DEFAULT_HTTP_CONFIG = {
  timeout: 15_000,
  maxRetries: 2,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  enableCache: false,
  verbose: true,
  maxResponseBytes: 100 * 1024 * 1024,
  logger: (level: string, message: string, meta?: unknown) => {
    console.log(`[HTTP ${level.toUpperCase()}] ${message}`, meta ?? "");
  },
};
