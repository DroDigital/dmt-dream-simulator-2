/** Journal poems and placeholder Dream Diary fragments, assembled from data/phrases.json (seeded). */
import { PCG32, hash } from '../core/rng.ts';
import phrases from '../../data/phrases.json' with { type: 'json' };

export function makePoem(seed: number, tagCounts: Record<string, number>): string[] {
  const rng = new PCG32(hash(seed, 0x9e3), 0x9e3);
  const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = tags[0]?.[0] ?? 'light';
  const opening = (phrases.opening as Record<string, string[]>)[top] ?? phrases.opening.light;
  return [rng.pick(opening), rng.pick(phrases.middle), rng.pick(phrases.closing)];
}

export interface DiaryFragment { text: string; keywords: string[] }

/** One placeholder fragment per night (365 per run), shown at each waking; its keywords bias tonight's events. */
export function diaryFragment(runSeed: number, night: number): DiaryFragment {
  const rng = new PCG32(hash(runSeed, hash(night, 0xd1a)), 0xd1a);
  const d = phrases.diary;
  const subject = rng.pick(d.subjects), verb = rng.pick(d.verbs), place = rng.pick(d.places);
  const text = `${subject[0].toUpperCase()}${subject.slice(1)} ${verb} ${place}.`;
  const keywords = `${subject} ${verb} ${place}`.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !['the', 'was', 'and', 'kept', 'into', 'made', 'inside', 'under', 'end', 'bottom'].includes(w));
  return { text, keywords };
}
