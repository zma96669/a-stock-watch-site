import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Contribution {
  command: string;
  key?: string;
}

describe('extension contributions', () => {
  it('binds the persistent background toggle to Ctrl+Shift+N', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      activationEvents: string[];
      contributes: {
        commands: Contribution[];
        keybindings: Contribution[];
        configuration: { properties: Record<string, { default?: unknown }> };
      };
    };

    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.toggleBackgroundVisibility');
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({
      command: 'aStockWatch.toggleBackgroundVisibility'
    }));
    expect(manifest.contributes.keybindings).toContainEqual({
      command: 'aStockWatch.toggleBackgroundVisibility',
      key: 'ctrl+shift+n'
    });
    expect(manifest.contributes.configuration.properties['aStockWatch.background.showVolume'].default).toBe(true);
  });
});
