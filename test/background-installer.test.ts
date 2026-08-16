import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loaderPathForWorkbench, loaderScriptTag } from '../src/background/loader-install';
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

describe('same-origin background loader', () => {
  it('places the loader beside workbench.html', () => {
    const workbench = path.join('C:', 'VS Code', 'workbench', 'workbench.html');
    expect(loaderPathForWorkbench(workbench)).toBe(path.join(
      'C:', 'VS Code', 'workbench', 'a-stock-watch-background-loader.js'
    ));
  });

  it('uses a relative script URL', () => {
    expect(loaderScriptTag()).toBe('<script src="./a-stock-watch-background-loader.js"></script>');
    expect(loaderScriptTag()).not.toContain('file://');
  });
});
