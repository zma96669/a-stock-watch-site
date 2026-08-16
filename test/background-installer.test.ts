import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isManagedLoaderFileName, loaderFileNameForContent, loaderPathForWorkbench, loaderScriptTag } from '../src/background/loader-install';
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
  it('places a content-addressed loader beside workbench.html', () => {
    const workbench = path.join('C:', 'VS Code', 'workbench', 'workbench.html');
    const fileName = loaderFileNameForContent('loader source');
    expect(fileName).toMatch(/^a-stock-watch-background-loader\.[a-f0-9]{12}\.js$/);
    expect(loaderPathForWorkbench(workbench, fileName)).toBe(path.join('C:', 'VS Code', 'workbench', fileName));
    expect(loaderFileNameForContent('changed source')).not.toBe(fileName);
  });

  it('uses a relative cache-busting script URL', () => {
    const fileName = loaderFileNameForContent('loader source');
    expect(loaderScriptTag(fileName)).toBe(`<script src="./${fileName}"></script>`);
    expect(loaderScriptTag(fileName)).not.toContain('file://');
    expect(isManagedLoaderFileName(fileName)).toBe(true);
    expect(isManagedLoaderFileName('workbench.js')).toBe(false);
  });
});
