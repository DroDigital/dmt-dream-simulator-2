/** Platform services (Steam at M6). The null implementation only logs. */
export interface Platform {
  unlockAchievement(id: string): void;
  setRichPresence(text: string): void;
}

export class NullPlatform implements Platform {
  unlocked = new Set<string>();
  unlockAchievement(id: string): void {
    if (this.unlocked.has(id)) return;
    this.unlocked.add(id);
    console.info(`[platform] achievement ${id}`);
  }
  setRichPresence(text: string): void {
    console.info(`[platform] presence: ${text}`);
  }
}

export let platform: Platform = new NullPlatform();
export function setPlatform(p: Platform): void { platform = p; }
