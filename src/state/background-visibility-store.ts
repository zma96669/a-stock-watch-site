import type { Memento } from 'vscode';

export const BACKGROUND_HIDDEN_KEY = 'aStockWatch.backgroundHidden';

export class BackgroundVisibilityStore {
  constructor(private readonly state: Pick<Memento, 'get' | 'update'>) {}

  isVisible(): boolean {
    return !this.state.get<boolean>(BACKGROUND_HIDDEN_KEY, false);
  }

  async toggle(): Promise<boolean> {
    const visible = !this.isVisible();
    await this.state.update(BACKGROUND_HIDDEN_KEY, !visible);
    return visible;
  }
}
