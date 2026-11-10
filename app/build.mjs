// Сборка в один файл для Apps Script: функции верхнего уровня объявляются в подвале.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/gas/main.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'App',
  target: 'es2020',
  outfile: 'dist/Code.js',
  footer: { js: 'function run() { App.run(); }\nfunction setup() { App.setup(); }\nfunction check() { App.check(); }' },
});
copyFileSync('appsscript.json', 'dist/appsscript.json');
console.log('dist/Code.js готов');
