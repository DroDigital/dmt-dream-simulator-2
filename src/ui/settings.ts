/**
 * Settings (§9.4), per dreamer profile: field of view (60-100), look sensitivity, invert Y, rumble,
 * colour-blind-safe dreamer colours, telephone subtitle icon, Gentle mode (per pane), Instant
 * transitions, Drift mode. DOM/CSS only, opened from the Flat (Esc) or the title.
 */
import type { DreamerProfile } from '../core/saves.ts';

export const CB_SAFE_COLORS = ['#F0E442', '#0072B2', '#E69F00', '#CC79A7']; // Okabe-Ito based

export interface SettingsHost {
  profiles: DreamerProfile[];
  apply(): void;
  credits(): void;
  cbSafe: { value: boolean };
  phoneIcons: { value: boolean };
}

export class SettingsUI {
  private el: HTMLDivElement;
  open = false;
  private host: SettingsHost;
  constructor(root: HTMLElement, host: SettingsHost) {
    this.host = host;
    this.el = document.createElement('div');
    this.el.className = 'settings hidden';
    root.appendChild(this.el);
  }

  show(): void {
    const h = this.host;
    const rows = h.profiles.map((p, i) => `
      <fieldset data-i="${i}"><legend>dreamer ${i + 1}</legend>
        <label>field of view <input type="range" min="60" max="100" step="1" name="fov" value="${p.fov}"><output>${p.fov}°</output></label>
        <label>look speed <input type="range" min="0.3" max="2.5" step="0.05" name="lookSens" value="${p.lookSens}"><output>${p.lookSens.toFixed(2)}</output></label>
        <label><input type="checkbox" name="invertY" ${p.invertY ? 'checked' : ''}> invert look up/down</label>
        <label><input type="checkbox" name="rumble" ${p.rumble ? 'checked' : ''}> rumble</label>
        <label><input type="checkbox" name="gentle" ${p.gentle ? 'checked' : ''}> gentle mode (calmer trails, colour fringes and transitions)</label>
        <label><input type="checkbox" name="instant" ${p.instant ? 'checked' : ''}> instant transitions</label>
        <label><input type="checkbox" name="drift" ${p.drift ? 'checked' : ''}> drift mode (no lucidity powers or steering)</label>
      </fieldset>`).join('');
    this.el.innerHTML = `<div class="panel">
      <h2>settings</h2>${rows}
      <fieldset><legend>everyone</legend>
        <label><input type="checkbox" name="cbSafe" ${h.cbSafe.value ? 'checked' : ''}> colour-blind-safe dreamer colours</label>
        <label><input type="checkbox" name="phoneIcons" ${h.phoneIcons.value ? 'checked' : ''}> show an icon when a telephone rings</label>
      </fieldset>
      <div class="row"><button class="btn credits">credits</button><button class="btn close">back to sleep</button></div>
    </div>`;
    this.el.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => this.read()));
    this.el.querySelector('.close')!.addEventListener('click', () => this.hide());
    this.el.querySelector('.credits')!.addEventListener('click', () => this.host.credits());
    this.el.classList.remove('hidden');
    this.open = true;
    document.exitPointerLock?.();
  }

  private read(): void {
    this.el.querySelectorAll('fieldset[data-i]').forEach((fs) => {
      const p = this.host.profiles[Number((fs as HTMLElement).dataset.i)];
      const v = (n: string) => fs.querySelector(`[name="${n}"]`) as HTMLInputElement;
      p.fov = Number(v('fov').value); p.lookSens = Number(v('lookSens').value);
      p.invertY = v('invertY').checked; p.rumble = v('rumble').checked; p.gentle = v('gentle').checked;
      p.instant = v('instant').checked; p.drift = v('drift').checked;
      fs.querySelectorAll('output')[0].textContent = `${p.fov}°`;
      fs.querySelectorAll('output')[1].textContent = p.lookSens.toFixed(2);
    });
    this.host.cbSafe.value = (this.el.querySelector('[name="cbSafe"]') as HTMLInputElement).checked;
    this.host.phoneIcons.value = (this.el.querySelector('[name="phoneIcons"]') as HTMLInputElement).checked;
    this.host.apply();
  }

  hide(): void { this.el.classList.add('hidden'); this.open = false; }
}
