import { Retry } from "./retry.js";

export class Format {
  private retry: Retry;

  constructor() {
    this.retry = new Retry();
  }

  normalizeQuery(query: string): string {
    return this.retry.normalizeText(query).toLowerCase();
  }

  isBadVariant(title: string): boolean {
    const t = title.toLowerCase();

    const badPatterns = [
      /\b(минус|instrumental|karaoke|караоке|remix|mix|bassboosted|rington|рингтон|cover|live|lyrics?|текст|version|ver\.?|slowed|sped\s*up|nightcore)\b/i,
      /\((?:[^)]*\b(?:минус|instrumental|karaoke|remix|mix|bassboosted|rington|рингтон|cover|live|lyrics?|текст|version|ver\.?|slowed|sped\s*up|nightcore)\b[^)]*)\)/i,
    ];

    return badPatterns.some((re) => re.test(t));
  }

  private getTrackType(title: string): number {
    const t = this.normalizeQuery(title);

    if (!this.isBadVariant(t) && !t.includes("(")) return 0;

    if (t.includes("2017") || t.includes("album") || t.includes("original")) return 1;

    if (t.includes("версия") || t.includes("version")) return 2;

    if (/\(([^)]*)\)/.test(t)) return 3;

    return 4;
  }

  scoreSearchCandidate(title: string, artist: string, query: string): number {
    const q = this.normalizeQuery(query);
    const t = this.normalizeQuery(title);
    const a = this.normalizeQuery(artist);
    const haystack = `${a} ${t}`;

    let score = 0;

    const hardNoise = [
      /популярн(ое|ый)\s*вк/i,
      /\bvk\b/i,
      /tiktok/i,
      /instagram/i,
      /8d/i,
      /bass\s*boost/i,
      /nightcore/i,
      /slowed/i,
      /sped\s*up/i,
      /lyrics|текст/i,
      /radio edit/i,
    ];

    if (hardNoise.some((r) => r.test(t))) {
      score -= 60;
    }

    const badVariants = [
      /\b(минус|instrumental|karaoke|cover|remix|mix|rington|рингтон)\b/i,
      /\(([^)]*(минус|remix|cover|instrumental|8d)[^)]*)\)/i,
    ];

    if (badVariants.some((r) => r.test(t))) {
      score -= 35;
    }

    const qTokens = q.split(/\s+/).filter(Boolean);
    const hits = qTokens.filter((x) => haystack.includes(x)).length;

    const type = this.getTrackType(title);

    score += (4 - type) * 20;

    score += hits * 10;

    if (t === q) score += 120;
    if (t.startsWith(q)) score += 70;
    if (t.includes(q)) score += 40;

    if (a.includes(q)) score += 25;

    const isCanonical =
      !this.isBadVariant(t) && !hardNoise.some((r) => r.test(t)) && !t.includes("(");

    if (isCanonical) {
      score += 30;
    }

    const baseTitle = t.replace(/\([^)]*\)/g, "").trim();
    if (baseTitle === q) score += 15;

    if (t.length < 40) score += 5;

    return score;
  }
}
