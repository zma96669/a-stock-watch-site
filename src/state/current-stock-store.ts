import * as vscode from 'vscode';

const KEY = 'aStockWatch.currentCode';

export class CurrentStockStore {
  private code?: string;
  private readonly emitter = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly state: vscode.Memento) {
    this.code = state.get<string>(KEY);
  }

  get(): string | undefined {
    return this.code;
  }

  async set(code: string | undefined): Promise<void> {
    if (code === this.code) return;
    this.code = code;
    await this.state.update(KEY, code);
    this.emitter.fire(code);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

