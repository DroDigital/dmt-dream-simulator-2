/**
 * Journal page per night (§3.13): polaroid of the best frame (in the journal-print glyph style, drawn on
 * paper), a 3-line poem, the chart dot(s), the night's laws, the night number. Co-op: two-page spread.
 * Exportable as PNG. DOM/CSS only, shown in the Flat in the morning.
 */
import type { JournalPage } from '../core/saves.ts';
import { LAW } from '../director/household.ts';
import { META } from '../realms/registry.ts';
import { FIGURE_COLORS } from '../director/game.ts';

/** CPU port of the journal-print glyph look: mono ink ASCII over paper, from an RGBA frame. */
export function polaroidFromPixels(px: Uint8Array | Uint8ClampedArray, w: number, h: number, outW = 384, outH = 216): string {
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const g = c.getContext('2d')!;
  // paper
  g.fillStyle = '#F2E8D5';
  g.fillRect(0, 0, outW, outH);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(120,90,60,${(i % 7) / 160})`; g.fillRect((i * 97) % outW, (i * 53) % outH, 1 + (i % 3), 1); }
  const ramp = ' .:-=+*#%@';
  const cell = 6;
  g.font = `${cell + 2}px VT323, monospace`;
  g.textBaseline = 'top';
  g.fillStyle = '#2B2138';
  for (let cy = 0; cy < outH / cell; cy++) for (let cx = 0; cx < outW / cell; cx++) {
    const sx = Math.floor(((cx + 0.5) * cell / outW) * w), sy = Math.floor((1 - (cy + 0.5) * cell / outH) * h);
    const i = (Math.min(h - 1, Math.max(0, sy)) * w + Math.min(w - 1, sx)) * 4;
    const l = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
    const ink = 1 - Math.min(1, Math.max(0, (l - 0.04) / 0.8)); // invert: dark scene -> dense ink
    const ch = ramp[Math.min(ramp.length - 1, Math.floor((1 - ink) * ramp.length))];
    if (ch !== ' ') g.fillText(ch, cx * cell, cy * cell);
  }
  return c.toDataURL('image/png');
}

function chartSvg(page: JournalPage, history: { x: number; y: number; age: number }[]): string {
  const S = 9, cell = 14;
  const toPx = (v: number) => (v + 4) * cell + cell / 2;
  let dots = '';
  for (const h of history) dots += `<circle cx="${toPx(h.x)}" cy="${toPx(h.y)}" r="2" fill="#2B2138" opacity="${Math.max(0.08, 1 - h.age / 60)}"/>`;
  for (const d of page.dots) dots += `<circle cx="${toPx(d.x)}" cy="${toPx(d.y)}" r="4" fill="${FIGURE_COLORS[d.dreamer]}" stroke="#2B2138" stroke-width="0.8"/>`;
  dots += `<circle cx="${toPx(page.group[0])}" cy="${toPx(page.group[1])}" r="5" fill="none" stroke="#2B2138" stroke-width="1.4"/>`;
  let grid = '';
  for (let i = 0; i <= S; i++) grid += `<line x1="${i * cell}" y1="0" x2="${i * cell}" y2="${S * cell}" stroke="#2B213833"/><line x1="0" y1="${i * cell}" x2="${S * cell}" y2="${i * cell}" stroke="#2B213833"/>`;
  return `<svg viewBox="0 0 ${S * cell} ${S * cell}" width="126" height="126" aria-hidden="true">${grid}${dots}</svg>`;
}

export class JournalUI {
  private el: HTMLDivElement;
  open = false;
  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'journal hidden';
    root.appendChild(this.el);
  }

  show(page: JournalPage, history: { x: number; y: number; age: number }[]): void {
    const photos = page.photos.map((p) => `<figure class="polaroid"><img src="${p}" alt=""></figure>`).join('');
    const laws = page.laws.map((l) => LAW.get(l)?.name ?? l);
    const realms = page.realms.map((r) => META.get(r)?.name ?? r);
    this.el.innerHTML = `
      <div class="page ${page.photos.length > 1 ? 'spread' : ''}">
        <div class="night">night ${page.night}</div>
        <div class="photos">${photos}</div>
        <div class="poem">${page.poem.map((l) => `<div>${l}</div>`).join('')}</div>
        <div class="meta">
          <div class="chart">${chartSvg(page, history)}</div>
          <div class="facts">
            ${laws.length ? `<div class="laws">${laws.map((l) => `<span>${l}</span>`).join(' · ')}</div>` : '<div class="laws quiet">no laws</div>'}
            <div class="realms">${realms.join(' → ')}</div>
            <div class="diary">“${page.diary}”</div>
          </div>
        </div>
        <button class="btn export">keep this page</button>
      </div>`;
    this.el.querySelector('.export')!.addEventListener('click', (e) => { e.stopPropagation(); void this.exportPng(page); });
    this.el.classList.remove('hidden');
    this.open = true;
  }

  hide(): void { this.el.classList.add('hidden'); this.open = false; }

  async exportPng(page: JournalPage): Promise<void> {
    const W = 900, H = 600;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#EFE3CC'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2B2138';
    g.font = 'italic 34px "Cormorant Garamond", serif';
    g.fillText(`night ${page.night}`, 40, 60);
    let x = 40;
    for (const src of page.photos) {
      const img = new Image();
      img.src = src;
      await img.decode().catch(() => {});
      g.fillStyle = '#FBF7EE'; g.fillRect(x - 10, 90, 404, 260);
      g.drawImage(img, x, 100, 384, 216);
      x += 420;
    }
    g.fillStyle = '#2B2138';
    g.font = 'italic 26px "Cormorant Garamond", serif';
    page.poem.forEach((l, i) => g.fillText(l, 40, 410 + i * 34));
    g.font = '20px VT323, monospace';
    g.fillText(page.laws.map((l) => LAW.get(l)?.name ?? l).join(' · '), 40, 540);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `dmt-journal-night-${page.night}.png`;
    a.click();
  }
}
