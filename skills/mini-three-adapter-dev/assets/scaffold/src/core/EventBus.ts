import type { Disposer } from './DisposalGroup.js';

export type EventMap = Record<string, unknown>;
type Listener<T> = (payload: T) => void;

/** 类型化事件总线。纯 TS，可在 Node 里单测；不要挂在 globalThis 上。 */
export class EventBus<E extends EventMap> {
  private readonly listeners = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(type: K, listener: Listener<E[K]>): Disposer {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const wrapped = listener as Listener<never>;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
      if (set && set.size === 0) this.listeners.delete(type);
    };
  }

  once<K extends keyof E>(type: K, listener: Listener<E[K]>): Disposer {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        (listener as Listener<E[K]>)(payload);
      } catch (error) {
        console.warn(`[EventBus] listener for ${String(type)} threw`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
