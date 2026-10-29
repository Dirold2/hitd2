export function normalizeImageUrl(
  value: string | null | undefined,
  baseUrl: string,
): string | undefined {
  const raw = value?.trim();
  if (!raw || raw.startsWith("data:")) return undefined;

  try {
    const url = new URL(raw, baseUrl);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}

export function extractImageUrl(
  element: { querySelector(selector: string): any },
  baseUrl: string,
): string | undefined {
  const image = element.querySelector("img");
  if (!image) return undefined;

  const src =
    image.getAttribute("data-src") ||
    image.getAttribute("data-lazy-src") ||
    image.getAttribute("data-original") ||
    image.getAttribute("src");

  if (src) {
    const normalized = normalizeImageUrl(src, baseUrl);
    if (normalized) return normalized;
  }

  const srcset = image.getAttribute("srcset");
  if (srcset) {
    const candidates = srcset.split(",").map((part: string) => part.trim());
    const largest = candidates[candidates.length - 1]?.split(/\s+/)[0];
    return normalizeImageUrl(largest, baseUrl);
  }

  return undefined;
}
