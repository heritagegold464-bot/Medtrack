/** Random UUID v4 for user-created records. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Deterministic UUID from (userId, key). Seed records and cycle days/sessions use this so that two
 * devices that create "Cycle 1 Day 1" independently produce the SAME id and therefore merge instead
 * of duplicating.
 */
export function detId(userId: string, key: string): string {
  const s = `${userId}|${key}`;
  const seeds = [0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f];
  const out: number[] = [];
  for (const seed of seeds) {
    let h = seed;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
      h = (h << 13) | (h >>> 19);
      h = Math.imul(h, 5) + 0xe6546b64;
    }
    h ^= s.length;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    out.push((h ^ (h >>> 16)) >>> 0);
  }
  const hex = out.map((n) => n.toString(16).padStart(8, '0')).join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
