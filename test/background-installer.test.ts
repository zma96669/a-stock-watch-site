import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workbenchCandidates } from '../src/background/workbench-paths';

describe('workbenchCandidates', () => {
  it('supports VS Code 1.110 electron-browser and older electron-sandbox layouts', () => {
    const root = path.join('C:', 'VS Code', 'resources', 'app');
    const candidates = workbenchCandidates(root);

    expect(candidates).toContain(path.join(
      root, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'
    ));
    expect(candidates).toContain(path.join(
      root, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'
    ));
    expect(candidates).toHaveLength(4);
  });

  it('prefers the current electron-browser layout', () => {
    expect(workbenchCandidates('app')[0]).toContain('electron-browser');
  });
});
