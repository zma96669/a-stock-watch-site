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
    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.increaseBackgroundOpacity');
    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.decreaseBackgroundOpacity');
    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.manageData');
    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.exportData');
    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.importData');
    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.githubSync');
    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.githubUpload');
    expect(manifest.activationEvents).toContain('onCommand:aStockWatch.githubDownload');
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({
      command: 'aStockWatch.toggleBackgroundVisibility'
    }));
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: 'aStockWatch.manageData' }));
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: 'aStockWatch.exportData' }));
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: 'aStockWatch.importData' }));
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: 'aStockWatch.githubSync' }));
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: 'aStockWatch.githubUpload' }));
    expect(manifest.contributes.commands).toContainEqual(expect.objectContaining({ command: 'aStockWatch.githubDownload' }));
    expect(manifest.contributes.keybindings).toContainEqual({
      command: 'aStockWatch.toggleBackgroundVisibility',
      key: 'ctrl+shift+n'
    });
    expect(manifest.contributes.keybindings).toContainEqual({
      command: 'aStockWatch.increaseBackgroundOpacity',
      key: 'ctrl+alt+shift+.'
    });
    expect(manifest.contributes.keybindings).toContainEqual({
      command: 'aStockWatch.decreaseBackgroundOpacity',
      key: 'ctrl+alt+shift+,'
    });
    expect(manifest.contributes.configuration.properties['aStockWatch.background.showVolume'].default).toBe(true);
  });
});
