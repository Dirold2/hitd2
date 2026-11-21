import { parse } from "node-html-parser";

const HOST = "rus.hitmos.fm";
const ARTIST_IDS = ["7137654", "7137880"];

function extractRscPayloads(html: string): string[] {
  const payloads: string[] = [];

  const pattern = /self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:\\.|[^"\\])*")\s*\]\s*\)/g;

  for (const match of html.matchAll(pattern)) {
    try {
      payloads.push(JSON.parse(match[1]!));
    } catch {
      // Ignore malformed RSC records.
    }
  }

  return payloads;
}

async function inspectArtist(artistId: string): Promise<void> {
  const url = `https://${HOST}/artist/${artistId}`;

  console.log(`\n=== ARTIST ${artistId} ===`);

  const response = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Artist page returned HTTP ${response.status}`);
  }

  const html = await response.text();
  const root = parse(html);
  const payloads = extractRscPayloads(html);

  const links = root.querySelectorAll("a[href]").flatMap((element) => {
    const href = element.getAttribute("href");

    if (!href) return [];

    try {
      const parsed = new URL(href, `https://${HOST}`);

      if (parsed.origin !== `https://${HOST}`) return [];

      const match = parsed.pathname.match(/^\/(album|artist|collection|song)\/([^/]+)\/?$/);

      if (!match) return [];

      return [
        {
          type: match[1],
          id: match[2],
          title: element.textContent.trim(),
          path: parsed.pathname,
        },
      ];
    } catch {
      return [];
    }
  });

  const relationKeys = new Set<string>();
  const contexts = new Set<string>();
  const searchPattern = /album|release|discograph|collection/giu;

  for (const payload of payloads) {
    const normalized = payload.replace(/\\"/g, '"');

    for (const match of normalized.matchAll(
      /"([^"]*(?:album|release|discograph|collection)[^"]*)"\s*:/giu,
    )) {
      relationKeys.add(match[1]!);
    }

    for (const match of normalized.matchAll(searchPattern)) {
      const index = match.index ?? 0;

      contexts.add(
        normalized.slice(Math.max(0, index - 350), Math.min(normalized.length, index + 700)),
      );

      if (contexts.size >= 15) break;
    }

    if (contexts.size >= 15) break;
  }

  const jsonLd: unknown[] = [];

  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      jsonLd.push(JSON.parse(script.textContent));
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  console.dir(
    {
      artistId,
      status: response.status,
      htmlBytes: new TextEncoder().encode(html).byteLength,
      rscPayloadCount: payloads.length,
      links,
      relationKeys: [...relationKeys].sort(),
      contexts: [...contexts],
      jsonLd,
    },
    { depth: null },
  );
}

async function main(): Promise<void> {
  for (const id of ARTIST_IDS) {
    try {
      await inspectArtist(id);
    } catch (error) {
      console.error(`Artist ${id} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

main();
