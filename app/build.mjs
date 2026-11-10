// Сборка для Apps Script: один файл build/Code.js + манифест.
// Apps Script видит только функции верхнего уровня, поэтому к бандлу дописываются обёртки.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const ENTRY_POINTS = ['run', 'install', 'uninstall', 'dumpSample'];

const res = await build({
  entryPoints: ['src/gas/main.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'ZenApp',
  target: 'es2020',
  charset: 'utf8',
  write: false,
});
const stubs = ENTRY_POINTS.map((f) => `function ${f}() { return ZenApp.${f}(); }`).join('\n');
mkdirSync('build', { recursive: true });
writeFileSync(
  'build/Code.js',
  `// СГЕНЕРИРОВАНО (npm run build) — не редактировать.\n${res.outputFiles[0].text}\n${stubs}\n`,
);
copyFileSync('appsscript.json', 'build/appsscript.json');
