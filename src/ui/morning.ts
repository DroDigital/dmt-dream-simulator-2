/**
 * Morning menu in the Lantern Flat (Tab): enter a dream code, dream the Daily Dream, or relive
 * last night as an Afterimage (from night 20). Text lives only here, in the Flat.
 */
import { decodeDreamCode, dailyDream, encodeDreamCode, type DreamCode } from '../director/codes.ts';

export interface MorningActions {
  code(c: DreamCode): void;
  afterimage(): void;
  canAfterimage(): boolean;
  currentCode(): string;
}

export class MorningMenu {
  private el: HTMLDivElement;
  open = false;
  private actions: MorningActions;

  constructor(root: HTMLElement, actions: MorningActions) {
    this.actions = actions;
    this.el = document.createElement('div');
    this.el.className = 'morning hidden';
    this.el.innerHTML = `<input maxlength="14" placeholder="dream code" aria-label="dream code" />
      <button class="btn dream">dream it</button><button class="btn daily">daily dream</button><button class="btn after">afterimage</button>
      <span class="code" style="font-family:VT323,monospace;opacity:.7"></span>`;
    root.appendChild(this.el);
    const input = this.el.querySelector('input')!;
    this.el.querySelector('.dream')!.addEventListener('click', () => {
      const c = decodeDreamCode(input.value);
      if (!c) { input.style.borderColor = '#FF5A6E'; return; }
      input.style.borderColor = '';
      this.actions.code(c);
      this.hide();
    });
    this.el.querySelector('.daily')!.addEventListener('click', () => { this.actions.code(dailyDream(new Date())); this.hide(); });
    this.el.querySelector('.after')!.addEventListener('click', () => { this.actions.afterimage(); this.hide(); });
    input.addEventListener('keydown', (e) => e.stopPropagation());
  }

  toggle(): void { if (this.open) this.hide(); else this.show(); }

  show(): void {
    (this.el.querySelector('.after') as HTMLElement).style.display = this.actions.canAfterimage() ? '' : 'none';
    (this.el.querySelector('.code') as HTMLElement).textContent = `tonight: ${this.actions.currentCode()}`;
    this.el.classList.remove('hidden');
    this.open = true;
    document.exitPointerLock?.();
  }

  hide(): void { this.el.classList.add('hidden'); this.open = false; }
}

export { encodeDreamCode };
