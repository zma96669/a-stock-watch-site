import { describe, expect, it } from 'vitest';
import { BACKGROUND_HIDDEN_KEY, BackgroundVisibilityStore } from '../src/state/background-visibility-store';

class MemoryState {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : fallback) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

describe('BackgroundVisibilityStore', () => {
  it('defaults to visible and persists both toggle states', async () => {
    const state = new MemoryState();
    const store = new BackgroundVisibilityStore(state);

    expect(store.isVisible()).toBe(true);
    expect(await store.toggle()).toBe(false);
    expect(state.get(BACKGROUND_HIDDEN_KEY)).toBe(true);
    expect(new BackgroundVisibilityStore(state).isVisible()).toBe(false);
    expect(await store.toggle()).toBe(true);
    expect(new BackgroundVisibilityStore(state).isVisible()).toBe(true);
  });
});
