function normalizeArtistParticipant(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const PARTICIPANT_SEPARATOR =
  /\s+(?:feat(?:uring)?|ft)\.?\s+|\s+(?:and|with|x|х)\s+|\s*[&,×]\s*/giu;

export function getArtistParticipants(artist: string): string[] {
  return artist
    .normalize("NFKC")
    .split(PARTICIPANT_SEPARATOR)
    .map(normalizeArtistParticipant)
    .filter(Boolean);
}

export function getArtistIdentityKey(artist: string): string | undefined {
  const participants = getArtistParticipants(artist);

  if (participants.length === 0 || participants.includes("unknown")) {
    return undefined;
  }

  return JSON.stringify([...new Set(participants)].sort());
}
