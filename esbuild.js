//@ts-check
const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');
const isProd = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node16',
  sourcemap: !isProd,
  minify: isProd,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ['webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: ['chrome110'],
  sourcemap: !isProd,
  minify: isProd,
  logLevel: 'info',
  loader: { '.css': 'text' },
};

async function main() {
  if (isWatch) {
    const ctxExt = await esbuild.context(extensionOptions);
    const ctxWv = await esbuild.context(webviewOptions);
    await Promise.all([ctxExt.watch(), ctxWv.watch()]);
    console.log('[esbuild] watching for changes...');
  } else {
    await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
    console.log('[esbuild] build complete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
