import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceDist = path.join(root, 'dist');
const targetDist = path.join(root, 'dist-pages');
if (!fs.existsSync(sourceDist)) throw new Error('Chybí dist/. Nejprve spusťte standardní build.');
fs.rmSync(targetDist, { recursive: true, force: true });
fs.cpSync(sourceDist, targetDist, { recursive: true });

for (const rel of ['tests', 'test-results', 'qa-results']) {
  fs.rmSync(path.join(targetDist, rel), { recursive: true, force: true });
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

for (const manifestPath of walk(targetDist).filter((file) => file.endsWith(`${path.sep}studio-manifest.json`))) {
  const manifest = readJson(manifestPath);
  manifest.deploymentProfile = 'github-pages';
  manifest.capabilities = (manifest.capabilities || []).filter((item) => item !== 'internal-self-tests');
  writeJson(manifestPath, manifest);
}

const pkg = readJson(path.join(root, 'package.json'));
console.log(`${pkg.name} ${pkg.version}: dist-pages/ sestaven jako veřejný Pages profil bez interních testů.`);
