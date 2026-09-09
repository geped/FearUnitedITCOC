#!/usr/bin/env node
/**
 * Converte PNG/JPEG locali in WebP (qualità 85, sforzo 4).
 * Cartelle: assets/, telegram-bot/assets/, leagues/, th/
 *
 * Uso: node scripts/convert-images.mjs
 * Richiede: npm install sharp (devDependency)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const DIRS = [
  path.join(ROOT, 'assets'),
  path.join(ROOT, 'telegram-bot', 'assets'),
  path.join(ROOT, 'leagues'),
  path.join(ROOT, 'th'),
  path.join(ROOT, 'th', 'webp'),
];

const SKIP_IF_WEBP_NEWER = true;

async function convertFile(srcPath) {
  const ext = path.extname(srcPath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;

  const destPath = srcPath.replace(/\.(png|jpe?g)$/i, '.webp');
  if (SKIP_IF_WEBP_NEWER && fs.existsSync(destPath)) {
    const srcM = fs.statSync(srcPath).mtimeMs;
    const dstM = fs.statSync(destPath).mtimeMs;
    if (dstM >= srcM) return { skipped: true, destPath };
  }

  const srcSize = fs.statSync(srcPath).size;
  await sharp(srcPath)
    .webp({ quality: 85, effort: 4, alphaQuality: 90 })
    .toFile(destPath);
  const dstSize = fs.statSync(destPath).size;
  const pct = srcSize ? Math.round((1 - dstSize / srcSize) * 100) : 0;
  return { srcPath, destPath, srcSize, dstSize, pct };
}

async function walkDir(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkDir(full, out);
    else if (/\.(png|jpe?g)$/i.test(name)) out.push(full);
  }
  return out;
}

async function main() {
  const files = [];
  for (const d of DIRS) walkDir(d, files);

  let converted = 0;
  let skipped = 0;
  let saved = 0;

  for (const f of files) {
    try {
      const r = await convertFile(f);
      if (!r) continue;
      if (r.skipped) {
        skipped++;
        continue;
      }
      converted++;
      saved += r.srcSize - r.dstSize;
      console.log(
        `${path.relative(ROOT, r.destPath)}  ${(r.srcSize / 1024).toFixed(1)}KB → ${(r.dstSize / 1024).toFixed(1)}KB (−${r.pct}%)`,
      );
    } catch (e) {
      console.warn('FAIL', path.relative(ROOT, f), e.message);
    }
  }

  console.log(`\nDone: ${converted} convertiti, ${skipped} già aggiornati, risparmio ${(saved / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
