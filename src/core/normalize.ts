export function normalizeText(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeQuery(value: string): string {
  return normalizeText(value).toLowerCase();
}

export function normalizeTrackId(input: string): string {
  return input.replace("hitmos:track:", "").replace("hitmoz:track:", "").trim();
}

export function normalizeTitle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[(),.-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(
      /\b(remix|edit|version|bassboosted|8d|slowed|speed up)\b/g,
      "",
    )
    .trim();
}