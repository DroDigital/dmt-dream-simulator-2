/** Credits screen, generated from assets/manifest.json plus fonts and ported shader notices. */
import manifest from '../../assets/manifest.json' with { type: 'json' };
import paperNotice from '../render/paper/NOTICE?raw';

export function creditsHtml(): string {
  const packs = (manifest as { packs: { credit: string; license: string }[] }).packs;
  const assetLines = packs.map((p) => `<li>${p.credit}</li>`).join('');
  return `<div class="panel credits-panel">
    <h2>DMT: Dream Simulator</h2>
    <p class="sub">Dream Memory Transit</p>
    <h3>assets</h3><ul>${assetLines || '<li>procedural</li>'}</ul>
    <h3>fonts</h3><ul><li>VT323 by Peter Hull (SIL Open Font License 1.1)</li><li>Cormorant Garamond by Christian Thalmann (SIL Open Font License 1.1)</li></ul>
    <h3>shaders</h3><pre>${paperNotice.replace(/</g, '&lt;')}</pre><p>Licensed under the Apache License 2.0 (licenses/Apache-2.0-paper-shaders.txt).</p>
    <h3>libraries</h3><ul><li>three.js (MIT)</li><li>Rapier (Apache-2.0)</li><li>bitECS (MPL-2.0)</li><li>Tone.js (MIT)</li><li>simplex-noise (MIT)</li><li>idb-keyval (Apache-2.0)</li></ul>
    <button class="btn close">close</button>
  </div>`;
}

export function showCredits(root: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'settings';
  el.innerHTML = creditsHtml();
  root.appendChild(el);
  el.querySelector('.close')!.addEventListener('click', () => el.remove());
}
