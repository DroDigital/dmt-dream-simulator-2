/// <reference lib="webworker" />
/** Generates realm layouts off the main thread with the same code as tools/realmgen. */
import { generateLayout } from './layoutgen.ts';
import { REALM_DATA } from './registry.ts';

self.onmessage = (e: MessageEvent<{ realm: string; seed: number }>) => {
  const { realm, seed } = e.data;
  try {
    const { layout } = generateLayout(REALM_DATA[realm], seed);
    (self as unknown as Worker).postMessage({ realm, seed, layout });
  } catch (err) {
    (self as unknown as Worker).postMessage({ realm, seed, error: String(err) });
  }
};
