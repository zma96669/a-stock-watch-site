import path from 'node:path';

export function workbenchCandidates(appRoot: string): string[] {
  const rendererFolders = ['electron-browser', 'electron-sandbox'];
  const fileNames = ['workbench.html', 'workbench-dev.html'];

  return rendererFolders.flatMap((renderer) =>
    fileNames.map((fileName) =>
      path.join(appRoot, 'out', 'vs', 'code', renderer, 'workbench', fileName)
    )
  );
}
