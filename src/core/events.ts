/** Tiny typed event bus (sim -> view/audio). Handlers must not mutate sim state. */
export type Handler<T> = (payload: T) => void;

export class EventBus<M extends Record<string, unknown>> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();
  on<K extends keyof M>(type: K, h: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(h as Handler<never>);
    return () => set!.delete(h as Handler<never>);
  }
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    // listeners are view/audio/UI: one failing must never stop the simulation
    for (const h of set) {
      try { (h as Handler<M[K]>)(payload); } catch (e) { console.warn(`[events] ${String(type)} handler failed:`, (e as Error).message); }
    }
  }
}
