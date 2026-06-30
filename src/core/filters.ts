export function isBadTitle(title: string): boolean {
  const t = title.toLowerCase();

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

  const badVariants = [
    /\b(минус|instrumental|karaoke|cover|remix|mix|rington|рингтон)\b/i,
    /\(([^)]*(минус|remix|cover|instrumental|8d)[^)]*)\)/i,
  ];

  return hardNoise.some((r) => r.test(t)) || badVariants.some((r) => r.test(t));
}

export function isValidAudioUrl(url: string): boolean {
  const lower = url.toLowerCase();

  // мусорные радио/стрим URL
  if (
    lower.includes("radio") ||
    lower.includes("stream") ||
    lower.includes("hostingradio") ||
    lower.includes("listen")
  ) {
    return false;
  }

  // подозрительные generic mp3
  if (lower.includes("retro256") || lower.includes("128.mp3") || lower.includes("320.mp3")) {
    return false;
  }

  // нормальные hitmos CDN
  if (lower.includes("hitmos") || lower.includes("track.mp3") || lower.includes("/mp3/")) {
    return true;
  }

  return false;
}

export function scoreAudioUrl(url: string): number {
  const lower = url.toLowerCase();

  let score = 0;

  // приоритет hitmos CDN
  if (lower.includes("pl1.hitmos.fm")) score += 100;
  if (lower.includes("pl2.hitmos.fm")) score += 90;
  if (lower.includes("track.mp3")) score += 50;
  if (lower.includes("/mp3/")) score += 25;

  // штрафы
  if (lower.includes("radio")) score -= 1000;
  if (lower.includes("hostingradio")) score -= 1000;
  if (lower.includes("stream")) score -= 500;

  return score;
}
