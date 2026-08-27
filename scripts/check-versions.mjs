import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const release = await readFile('src/core/release.js', 'utf8');
const sw = await readFile('public/sw.js', 'utf8');
const qa = JSON.parse(await readFile('qa/qa-manifest.json', 'utf8'));
const server = await readFile('server/app.mjs', 'utf8');
const manual = await readFile('public/manual/manual.js', 'utf8');
const versions = {
  'package.json': String(pkg.version || ''),
  'src/core/release.js': release.match(/version:\s*['"]([^'"]+)['"]/)?.[1] || '',
  'public/sw.js': sw.match(/CACHE_NAME\s*=\s*['"][^'"]*v([^'"]+)['"]/)?.[1] || '',
  'qa/qa-manifest.json': String(qa.appVersion || ''),
  'server/app.mjs': server.match(/SERVER_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] || '',
  'public/manual/manual.js': manual.includes('__APP_VERSION__') ? String(pkg.version || '') : '',
};
const values = Object.values(versions);
if (values.some((value) => !value) || new Set(values).size !== 1) {
  console.error('Verze nejsou synchronizované:');
  for (const [file, value] of Object.entries(versions)) console.error(`- ${file}: ${value || 'NENALEZENO'}`);
  process.exit(1);
}
console.log(`Verze ${values[0]} je synchronizovaná napříč projektem.`);
