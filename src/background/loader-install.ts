import { createHash } from 'node:crypto';
import path from 'node:path';

const LOADER_PREFIX = 'a-stock-watch-background-loader';

export function loaderFileNameForContent(content: string): string {
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `${LOADER_PREFIX}.${digest}.js`;
}

export function loaderPathForWorkbench(workbenchPath: string, fileName: string): string {
  return path.join(path.dirname(workbenchPath), fileName);
}

export function loaderScriptTag(fileName: string): string {
  return `<script src="./${fileName}"></script>`;
}

export function isManagedLoaderFileName(fileName: string): boolean {
  return new RegExp(`^${LOADER_PREFIX}(?:\\.[a-f0-9]{12})?\\.js$`).test(fileName);
}
