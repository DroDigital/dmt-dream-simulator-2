/** Title + first-launch photosensitivity warning. DOM/CSS only. */
const KEY = 'dmt.photosensitivity.ack';

export function showTitle(root: HTMLElement, onStart: () => void): void {
  const el = document.createElement('div');
  el.className = 'overlay';
  let acked = false;
  try { acked = localStorage.getItem(KEY) === '1'; } catch { /* private mode */ }
  el.innerHTML = acked
    ? `<div class="title">DMT: Dream Simulator</div><div class="subtitle">DREAM MEMORY TRANSIT</div><button class="btn">sleep</button>`
    : `<div class="title">A note before you sleep</div>
       <div class="warn">This dream contains shifting colours, flowing light and moving patterns.
       A small number of people may experience seizures when exposed to certain visual images.
       If you feel dizzy or unwell, stop playing and rest. Gentle mode is available in settings.</div>
       <button class="btn">I understand</button>`;
  root.appendChild(el);
  el.querySelector('button')!.addEventListener('click', () => {
    if (!acked) {
      try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
      el.remove();
      showTitle(root, onStart);
      return;
    }
    el.classList.add('hidden');
    setTimeout(() => el.remove(), 1300);
    onStart();
  });
}
