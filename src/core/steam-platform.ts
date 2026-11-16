/** Steam implementation of Platform (Electron only; uses the preload bridge to steamworks.js). */
import { NullPlatform, setPlatform, type Platform } from './platform.ts';

interface SteamBridge { unlockAchievement(id: string): void; setRichPresence(text: string): void }

export class SteamPlatform implements Platform {
  private bridge: SteamBridge;
  constructor(bridge: SteamBridge) { this.bridge = bridge; }
  unlockAchievement(id: string): void { this.bridge.unlockAchievement(id); }
  setRichPresence(text: string): void { this.bridge.setRichPresence(text); }
}

/** Pick the platform at boot: Steam inside Electron, the NullPlatform elsewhere. */
export function installPlatform(): void {
  const bridge = (globalThis as unknown as { dmtSteam?: SteamBridge }).dmtSteam;
  setPlatform(bridge ? new SteamPlatform(bridge) : new NullPlatform());
}
