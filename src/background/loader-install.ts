import path from 'node:path';

export const LOADER_FILE_NAME = 'a-stock-watch-background-loader.js';

export function loaderPathForWorkbench(workbenchPath: string): string {
  return path.join(path.dirname(workbenchPath), LOADER_FILE_NAME);
}

export function loaderScriptTag(): string {
  return `<script src="./${LOADER_FILE_NAME}"></script>`;
}
