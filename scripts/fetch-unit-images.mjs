#!/usr/bin/env node
/**
 * Scarica icone truppe/eroi/incantesimi/equipment e le salva come WebP locali in units/.
 * Priorità sorgente: coc.guide → GitHub clash_widgets → Fandom wiki (UNIT_WIKI_URL).
 *
 * Uso: node scripts/fetch-unit-images.mjs [--force]
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UNITS_DIR = path.join(ROOT, 'units');
const FORCE = process.argv.includes('--force');

const GH_WIDGETS_BASE =
  'https://raw.githubusercontent.com/Zacatac3/clash_widgets/main/clash_widgets/Assets.xcassets';

/** Estrae un oggetto const { key: value } da app.js (solo stringhe semplici). */
function extractStringMap(appJs, constName) {
  const re = new RegExp(`const ${constName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`, 'm');
  const m = appJs.match(re);
  if (!m) return {};
  const out = {};
  const pairRe = /'([^']+)':\s*'([^']*)'/g;
  let pm;
  while ((pm = pairRe.exec(m[1])) !== null) out[pm[1]] = pm[2];
  return out;
}

/** Estrae UNIT_COC_SLUG: 'Name': {c:'cat', s:'slug'} */
function extractUnitCocSlug(appJs) {
  const re = /const UNIT_COC_SLUG\s*=\s*\{([\s\S]*?)\n\};/m;
  const m = appJs.match(re);
  if (!m) return {};
  const out = {};
  const pairRe = /'([^']+)':\s*\{c:'([^']+)',\s*s:'([^']+)'\}/g;
  let pm;
  while ((pm = pairRe.exec(m[1])) !== null) {
    out[pm[1]] = { c: pm[2], s: pm[3] };
  }
  return out;
}

/** Estrae UNIT_GH_WIDGETS_PATH */
function extractGhWidgets(appJs) {
  const re = /const UNIT_GH_WIDGETS_PATH\s*=\s*\{([\s\S]*?)\n\};/m;
  const m = appJs.match(re);
  if (!m) return {};
  const out = {};
  const pairRe = /'([^']+)':\s*'([^']+)'/g;
  let pm;
  while ((pm = pairRe.exec(m[1])) !== null) out[pm[1]] = pm[2];
  return out;
}

function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/['.()]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function buildSources(name, slugEntry, wikiUrl, ghRel) {
  const urls = [];
  if (slugEntry) {
    urls.push(`https://coc.guide/static/imgs/${slugEntry.c}/${slugEntry.s}.png`);
  }
  if (ghRel) urls.push(`${GH_WIDGETS_BASE}/${ghRel}`);
  if (wikiUrl) urls.push(wikiUrl);
  if (!slugEntry) {
    const slug = slugifyName(name);
    for (const cat of ['troop', 'hero', 'spell', 'pet', 'equipment']) {
      urls.push(`https://coc.guide/static/imgs/${cat}/${slug}.png`);
    }
  }
  return [...new Set(urls)];
}

async function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(
      url,
      {
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'CoCBoard/1.0 (image-cache)' },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchBuffer(res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (buf.length < 200) reject(new Error('too small'));
          else resolve(buf);
        });
      },
    ).on('error', reject);
  });
}

async function saveWebp(destPath, buf) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await sharp(buf)
    .webp({ quality: 85, effort: 4, alphaQuality: 90 })
    .toFile(destPath);
}

async function main() {
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const unitCocSlug = extractUnitCocSlug(appJs);
  const unitWikiUrl = extractStringMap(appJs, 'UNIT_WIKI_URL');
  const ghWidgets = extractGhWidgets(appJs);

  const names = new Set([
    ...Object.keys(unitCocSlug),
    ...Object.keys(unitWikiUrl),
    ...Object.keys(ghWidgets),
  ]);

  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const name of [...names].sort()) {
    const slugEntry = unitCocSlug[name];
    const cat = slugEntry?.c || 'troop';
    const slug = slugEntry?.s || slugifyName(name);
    const destPath = path.join(UNITS_DIR, cat, `${slug}.webp`);

    if (!FORCE && fs.existsSync(destPath) && fs.statSync(destPath).size > 500) {
      skip++;
      continue;
    }

    const urls = buildSources(name, slugEntry, unitWikiUrl[name], ghWidgets[name]);
    let saved = false;
    for (const url of urls) {
      try {
        const buf = await fetchBuffer(url);
        await saveWebp(destPath, buf);
        const kb = (fs.statSync(destPath).size / 1024).toFixed(1);
        console.log(`OK  units/${cat}/${slug}.webp  (${kb} KB) ← ${url.slice(0, 70)}…`);
        ok++;
        saved = true;
        break;
      } catch (_) {
        /* prova sorgente successiva */
      }
    }
    if (!saved) {
      console.warn(`FAIL ${name}`);
      fail++;
    }
  }

  // Builder Hall (BH_WIKI_URL)
  const bhWiki = extractStringMap(appJs, 'BH_WIKI_URL');
  for (const [lvl, url] of Object.entries(bhWiki)) {
    const destPath = path.join(UNITS_DIR, 'builder', `hall-${lvl}.webp`);
    if (!FORCE && fs.existsSync(destPath)) {
      skip++;
      continue;
    }
    try {
      const buf = await fetchBuffer(url);
      await saveWebp(destPath, buf);
      console.log(`OK  units/builder/hall-${lvl}.webp`);
      ok++;
    } catch (e) {
      console.warn(`FAIL BH ${lvl}`, e.message);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} salvati, ${skip} skip, ${fail} falliti`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
