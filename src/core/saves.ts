/**
 * Saves (IndexedDB via idb-keyval): 3 household slots, each holding the household (night count, run seed,
 * room, chart), up to 4 dreamer profiles (settings), the last night's seed + input log (Afterimage),
 * and journal pages (with small polaroid PNGs).
 */
import { get, set, del } from 'idb-keyval';
import type { Household } from '../director/household.ts';
import type { NightRecord } from '../director/game.ts';

export const SAVE_VERSION = 1;
export const SLOTS = 3;

export interface DreamerProfile {
  figure: string;
  fov: number;
  lookSens: number;
  invertY: boolean;
  rumble: boolean;
  gentle: boolean;
  instant: boolean;
  drift: boolean;
}

export const DEFAULT_PROFILE: DreamerProfile = { figure: 'moth', fov: 75, lookSens: 1, invertY: false, rumble: true, gentle: false, instant: false, drift: false };

export interface JournalPage {
  night: number;
  /** Polaroid(s) as PNG data URLs (one per dreamer in co-op: a two-page spread). */
  photos: string[];
  poem: string[];
  laws: string[];
  dots: { dreamer: number; x: number; y: number }[];
  group: [number, number];
  realms: string[];
  diary: string;
}

export interface SaveData {
  version: number;
  savedAt: string;
  household: Household;
  eventCooldown: [string, number][];
  profiles: DreamerProfile[];
  lastNight: NightRecord | null;
  journal: JournalPage[];
  unlocked: string[];
}

const key = (slot: number) => `dmt.save.${slot}`;

export async function loadSlot(slot: number): Promise<SaveData | null> {
  try {
    const d = (await get(key(slot))) as SaveData | undefined;
    if (!d || d.version !== SAVE_VERSION) return null;
    return d;
  } catch {
    return null; // private mode / blocked storage: play without saves
  }
}

export async function saveSlot(slot: number, data: Omit<SaveData, 'version' | 'savedAt'>): Promise<boolean> {
  try {
    // keep journals light: at most 400 pages
    const journal = data.journal.slice(-400);
    await set(key(slot), { ...data, journal, version: SAVE_VERSION, savedAt: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
}

export async function deleteSlot(slot: number): Promise<void> {
  try { await del(key(slot)); } catch { /* ignore */ }
}

export async function listSlots(): Promise<(SaveData | null)[]> {
  return Promise.all(Array.from({ length: SLOTS }, (_, i) => loadSlot(i)));
}
