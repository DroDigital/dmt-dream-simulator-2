/**
 * Dream codes (§3.13): 12 characters = run seed (32 bits, which also fixes the link grammar)
 * + night (9 bits) + laws (13-bit mask), Crockford base32 with a check character.
 * Entering a code in the Flat dreams that night without advancing the night count.
 * Daily Dream: a code derived from the real date.
 */
import { hashString } from '../core/rng.ts';
import { LAWS } from './household.ts';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface DreamCode { runSeed: number; night: number; laws: string[] }

export function encodeDreamCode(c: DreamCode): string {
  let mask = 0;
  for (const id of c.laws) { const i = LAWS.findIndex((l) => l.id === id); if (i >= 0 && i < 13) mask |= 1 << i; }
  // 54 bits: seed(32) | night(9) | laws(13), as BigInt for exactness
  const v = (BigInt(c.runSeed >>> 0) << 22n) | (BigInt(Math.max(1, Math.min(511, c.night))) << 13n) | BigInt(mask);
  let s = '';
  let x = v;
  for (let i = 0; i < 11; i++) { s = ALPHABET[Number(x & 31n)] + s; x >>= 5n; }
  let check = 0;
  for (let i = 0; i < s.length; i++) check = (check * 7 + ALPHABET.indexOf(s[i]) * (i + 3)) % 32;
  return s + ALPHABET[check];
}

export function decodeDreamCode(code: string): DreamCode | null {
  const s = code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 12) return null;
  let check = 0;
  for (let i = 0; i < 11; i++) {
    const k = ALPHABET.indexOf(s[i]);
    if (k < 0) return null;
    check = (check * 7 + k * (i + 3)) % 32;
  }
  if (ALPHABET[check] !== s[11]) return null;
  let v = 0n;
  for (let i = 0; i < 11; i++) v = (v << 5n) | BigInt(ALPHABET.indexOf(s[i]));
  const mask = Number(v & 0x1fffn);
  const night = Number((v >> 13n) & 0x1ffn);
  const runSeed = Number((v >> 22n) & 0xffffffffn) >>> 0;
  const laws = LAWS.slice(0, 13).filter((_, i) => mask & (1 << i)).map((l) => l.id);
  return { runSeed, night, laws };
}

/** Daily Dream: seed derived from the real date (YYYY-MM-DD). */
export function dailyDream(date: Date): DreamCode {
  const iso = date.toISOString().slice(0, 10);
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  const seed = hashString(`daily:${iso}`);
  const lawIdx = seed % 13;
  return { runSeed: seed, night: ((day - 1) % 365) + 1, laws: seed % 3 === 0 ? [] : [LAWS[lawIdx].id] };
}
