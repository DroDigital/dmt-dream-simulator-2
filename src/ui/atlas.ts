/**
 * Atlas (§3.13): a collection book of realms x eras x moods, events, laws, Visions, souvenirs and
 * entities (~600 entries), shown as silhouettes until found. Pictures only: no names, no numbers.
 * Opened in the Flat (A).
 */
import { META, REALM_META } from '../realms/registry.ts';
import { LAWS, SOUVENIRS } from '../director/household.ts';
import { EVENTS } from '../director/director.ts';
import visionsJson from '../../data/visions.json' with { type: 'json' };

export const ATLAS_ENTITIES = ['lanternfolk', 'watcher', 'echo', 'drifter', 'bookfish', 'moth', 'kite', 'train', 'lantern-woman', 'moons'];
export const MOODS = ['halo', 'bloom', 'hush', 'undertow'];
export type AtlasBook = Record<string, string[]>;

export function atlasTotal(): number {
  const realms = REALM_META.filter((r) => r.id !== 'lantern-flat').length * 4 * 4;
  return realms + EVENTS.length + LAWS.length + visionsJson.visions.length + SOUVENIRS.length + ATLAS_ENTITIES.length;
}

function hueOf(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function tile(found: boolean, color: string, shape: number): string {
  const fill = found ? color : '#2a2430';
  const shapes = [
    `<circle cx="12" cy="12" r="8" fill="${fill}"/>`,
    `<rect x="5" y="5" width="14" height="14" rx="2" fill="${fill}"/>`,
    `<polygon points="12,3 21,20 3,20" fill="${fill}"/>`,
    `<polygon points="12,3 20,12 12,21 4,12" fill="${fill}"/>`,
    `<path d="M4 18 Q12 2 20 18 Z" fill="${fill}"/>`,
    `<rect x="7" y="3" width="10" height="18" rx="5" fill="${fill}"/>`,
  ];
  return `<svg viewBox="0 0 24 24" width="22" height="22" style="opacity:${found ? 1 : 0.55}">${shapes[shape % shapes.length]}</svg>`;
}

export class AtlasUI {
  private el: HTMLDivElement;
  open = false;
  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'atlas hidden';
    root.appendChild(this.el);
  }

  show(book: AtlasBook): void {
    const has = (cat: string, id: string) => (book[cat] ?? []).includes(id);
    const section = (icon: string, cells: string[]) => `<section><div class="cat">${icon}</div><div class="cells">${cells.join('')}</div></section>`;
    const realms: string[] = [];
    for (const r of REALM_META) {
      if (r.id === 'lantern-flat') continue;
      for (let era = 0; era < 4; era++) for (const mood of MOODS) {
        const id = `${r.id}|${era}|${mood}`;
        realms.push(tile(has('realms', id), r.key, era));
      }
    }
    const ev = EVENTS.map((e) => tile(has('events', e.id), META.get(e.realm)?.key ?? '#E8C27A', 0));
    const laws = LAWS.map((l) => tile(has('laws', l.id), `hsl(${hueOf(l.id)} 60% 70%)`, 3));
    const vis = visionsJson.visions.map((v) => tile(has('visions', v.id), `hsl(${Math.round(v.hue * 360)} 80% 70%)`, 2));
    const souv = SOUVENIRS.map((s) => tile(has('souvenirs', s.id), META.get(s.realms[0])?.key ?? '#fff', 4));
    const ent = ATLAS_ENTITIES.map((e, i) => tile(has('entities', e), `hsl(${i * 36} 70% 70%)`, 5));
    this.el.innerHTML = `<div class="book">
      ${section(tile(true, '#FFD9A0', 1), realms)}${section(tile(true, '#FFC9DE', 0), ev)}${section(tile(true, '#BDE7FF', 3), laws)}
      ${section(tile(true, '#D9C8FF', 2), vis)}${section(tile(true, '#FFE7A3', 4), souv)}${section(tile(true, '#8FB8B0', 5), ent)}
    </div>`;
    this.el.classList.remove('hidden');
    this.open = true;
  }

  hide(): void { this.el.classList.add('hidden'); this.open = false; }
}
