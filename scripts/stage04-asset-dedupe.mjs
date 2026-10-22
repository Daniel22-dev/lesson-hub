/* Deterministic, fail-closed P5 artifact deduplication. Source files untouched.
 * Both pairs must match byte-for-byte; otherwise fail the build before writes.
 * The single remaining icon is declared with both 'any' and 'maskable' purposes.
 * Source data-manifest remains in the repository for P5/source audits.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function dedupeStage04Assets(dist) {
  const iconAnyPath = path.join(dist, 'icons/icon-512.png');
  const iconMaskPath = path.join(dist, 'icons/icon-maskable-512.png');
  const sourceManifestPath = path.join(dist, 'src/config/data-manifest.json');
  const publicManifestPath = path.join(dist, 'config/data-manifest.json');
  const pwaPath = path.join(dist, 'manifest.webmanifest');
  // Preflight every input before mutating the dist tree.
  const [anyIcon, maskIcon, sourceData, publicData, manifestSource] = await Promise.all([
    readFile(iconAnyPath), readFile(iconMaskPath),
    readFile(sourceManifestPath), readFile(publicManifestPath), readFile(pwaPath, 'utf8'),
  ]);
  if (!anyIcon.equals(maskIcon)) throw new Error('STAGE04_MASKABLE_IMAGE_NOT_IDENTICAL');
  if (!sourceData.equals(publicData)) throw new Error('STAGE04_DATA_MANIFEST_NOT_IDENTICAL');
  const manifest = JSON.parse(manifestSource);
  if (!Array.isArray(manifest.icons) ||
      manifest.icons.filter(x => x.src === './icons/icon-maskable-512.png' && x.purpose === 'maskable').length !== 1 ||
      manifest.icons.filter(x => x.src === './icons/icon-512.png' && x.purpose === 'any').length !== 1) {
    throw new Error('STAGE04_PWA_ICON_CONTRACT_CHANGED');
  }
  const maskable=manifest.icons.find(x => x.src === './icons/icon-maskable-512.png' && x.purpose === 'maskable');
  if (maskable.sizes !== '512x512' || maskable.type !== 'image/png') {
    throw new Error('STAGE04_PWA_MASKABLE_FORMAT_CHANGED');
  }
  maskable.src='./icons/icon-512.png';
  const optimized = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(pwaPath, optimized);
  await rm(iconMaskPath);
  await rm(sourceManifestPath);
  return {reusedMaskableBytes: maskIcon.byteLength, eliminatedDuplicateManifestBytes: sourceData.byteLength,
    manifestChangeBytes: Buffer.byteLength(optimized) - Buffer.byteLength(manifestSource),
    savingsBytes: maskIcon.byteLength + sourceData.byteLength - (Buffer.byteLength(optimized)-Buffer.byteLength(manifestSource))};
}
