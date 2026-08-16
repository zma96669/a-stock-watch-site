const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info'
};

const loaderOptions = {
  entryPoints: ['src/background/browser-loader.ts'],
  bundle: true,
  outfile: 'media/background-loader.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome100',
  minify: false,
  logLevel: 'info'
};

if (watch) {
  Promise.all([esbuild.context(extensionOptions), esbuild.context(loaderOptions)])
    .then((contexts) => Promise.all(contexts.map((context) => context.watch())))
    .catch(() => process.exit(1));
} else {
  Promise.all([esbuild.build(extensionOptions), esbuild.build(loaderOptions)])
    .catch(() => process.exit(1));
}
