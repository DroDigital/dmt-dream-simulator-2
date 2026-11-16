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
    if (set) for (const h of set) (h as Handler<M[K]>)(payload);
  }
}
