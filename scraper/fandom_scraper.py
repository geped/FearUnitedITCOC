"""
Scraper AGGIORNATO per clashofclans.fandom.com
Usa la Fandom REST API v1 (pubblica, nessuna chiave richiesta, nessun blocco 403).

Endpoint base: https://clashofclans.fandom.com/api/v1/

Autore: Generato da Antigravity AI
"""

import os
import time
import json
import logging
import requests
from pathlib import Path
from PIL import Image
from io import BytesIO

# ─── Configurazione ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# API Fandom pubblica — nessun blocco, nessuna chiave
FANDOM_API   = "https://clashofclans.fandom.com/api/v1"
OUTPUT_DIR   = Path(__file__).parent / "output"
INDEX_FILE   = OUTPUT_DIR / "index.json"

DELAY = 1.2   # secondi tra richieste

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# Edifici prioritari con i loro titoli esatti sulla wiki
PRIORITY_BUILDINGS = {
    "Town Hall":           "Town Hall",
    "Cannon":              "Cannon",
    "Archer Tower":        "Archer Tower",
    "Mortar":              "Mortar",
    "Air Defense":         "Air Defense",
    "Wizard Tower":        "Wizard Tower",
    "Air Sweeper":         "Air Sweeper",
    "X-Bow":               "X-Bow",
    "Inferno Tower":       "Inferno Tower",
    "Eagle Artillery":     "Eagle Artillery",
    "Scattershot":         "Scattershot",
    "Gold Mine":           "Gold Mine",
    "Elixir Collector":    "Elixir Collector",
    "Dark Elixir Drill":   "Dark Elixir Drill",
    "Gold Storage":        "Gold Storage",
    "Elixir Storage":      "Elixir Storage",
    "Dark Elixir Storage": "Dark Elixir Storage",
    "Clan Castle":         "Clan Castle",
    "Barracks":            "Barracks",
    "Dark Barracks":       "Dark Barracks",
    "Army Camp":           "Army Camp",
    "Laboratory":          "Laboratory",
    "Spell Factory":       "Spell Factory",
    "Builder's Hut":       "Builder%27s_Hut",
    "Wall":                "Wall",
    "Bomb":                "Bomb",
    "Spring Trap":         "Spring Trap",
    "Giant Bomb":          "Giant Bomb",
    "Air Bomb":            "Air Bomb",
}

session = requests.Session()
session.headers.update(HEADERS)


# ─── API Fandom ────────────────────────────────────────────────────────────────

def cerca_immagini_edificio(building_name: str, wiki_title: str) -> list[dict]:
    """
    Usa l'endpoint Articles/AsSimpleJson e poi cerca immagini correlate
    tramite l'endpoint Search/List della Fandom API v1.
    """
    risultati = []

    # 1. Cerca immagini con keyword "<NomeEdificio> level"
    query = f"{building_name}"
    url = f"{FANDOM_API}/Search/List"
    params = {
        "query":  query,
        "limit":  25,
        "namespaces": 6,   # Namespace 6 = File (immagini)
    }

    try:
        resp = session.get(url, params=params, timeout=15)
        resp.raise_for_status()
        dati = resp.json()
        items = dati.get("items", [])
        log.info(f"  API Search: {len(items)} risultati per '{query}'")

        for item in items:
            title = item.get("title", "")
            # Filtra solo immagini rilevanti al nome dell'edificio e che contengono livelli
            nome_lower = title.lower()
            edificio_lower = building_name.lower().replace("'", "")
            if any(part in nome_lower for part in edificio_lower.split()):
                risultati.append({
                    "title": title,
                    "url":   item.get("url", ""),
                })
    except Exception as e:
        log.warning(f"  Errore Search API: {e}")

    # 2. Fallback: tenta l'endpoint Images dell'articolo direttamente
    if not risultati:
        url2 = f"{FANDOM_API}/Articles/AsSimpleJson"
        try:
            resp2 = session.get(url2, params={"id": wiki_title}, timeout=15)
            resp2.raise_for_status()
        except Exception:
            pass

    return risultati


def ottieni_url_immagine(file_title: str) -> str | None:
    """
    Dato il titolo di un file sulla wiki (es. "File:Cannon1.png"),
    usa l'API per ottenere l'URL diretto all'immagine.
    """
    url = f"{FANDOM_API}/Articles/AsSimpleJson"
    # Usa l'endpoint MediaWiki action API per i file
    media_url = "https://clashofclans.fandom.com/api.php"
    params = {
        "action":  "query",
        "titles":  file_title,
        "prop":    "imageinfo",
        "iiprop":  "url",
        "format":  "json",
    }
    try:
        resp = session.get(media_url, params=params, timeout=15)
        resp.raise_for_status()
        dati = resp.json()
        pages = dati.get("query", {}).get("pages", {})
        for page in pages.values():
            imageinfo = page.get("imageinfo", [{}])
            if imageinfo:
                return imageinfo[0].get("url")
    except Exception as e:
        log.warning(f"  Errore imageinfo per '{file_title}': {e}")
    return None


def scarica_immagini_da_mediawiki(building_name: str) -> list[dict]:
    """
    Strategia principale: usa l'API MediaWiki action per cercare
    tutte le immagini associate a un articolo.
    Funziona anche senza essere autenticati.
    """
    media_url = "https://clashofclans.fandom.com/api.php"
    risultati = []

    # Cerca il titolo dell'articolo dell'edificio
    params_search = {
        "action":  "query",
        "list":    "search",
        "srsearch": building_name,
        "srlimit": 3,
        "format":  "json",
    }
    try:
        resp = session.get(media_url, params=params_search, timeout=15)
        resp.raise_for_status()
        search_results = resp.json().get("query", {}).get("search", [])
        if not search_results:
            log.warning(f"  Nessun articolo trovato per '{building_name}'")
            return []
        page_title = search_results[0]["title"]
        log.info(f"  → Articolo: '{page_title}'")
    except Exception as e:
        log.warning(f"  Errore ricerca articolo: {e}")
        return []

    time.sleep(DELAY)

    # Scarica le immagini dell'articolo
    params_images = {
        "action":  "query",
        "titles":  page_title,
        "prop":    "images",
        "imlimit": 50,
        "format":  "json",
    }
    try:
        resp = session.get(media_url, params=params_images, timeout=15)
        resp.raise_for_status()
        pages = resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            imgs = page.get("images", [])
            for img in imgs:
                title = img.get("title", "")
                # Filtra: deve contenere il nome dell'edificio e non essere un'icona generica
                nome_lower  = building_name.lower().replace(" ", "").replace("'", "")
                title_lower = title.lower().replace(" ", "").replace("_", "").replace("'", "")
                if nome_lower[:4] in title_lower and title.endswith((".png", ".jpg", ".gif")):
                    risultati.append(title)
    except Exception as e:
        log.warning(f"  Errore recupero immagini articolo: {e}")
        return []

    log.info(f"  → {len(risultati)} immagini candidate sull'articolo")

    # Per ogni file ottieni l'URL reale
    entries = []
    for i, file_title in enumerate(risultati[:20]):   # max 20 immagini per edificio
        time.sleep(DELAY * 0.5)
        img_url = ottieni_url_immagine(file_title)
        if img_url:
            entries.append({
                "building":   building_name,
                "level":      i + 1,
                "image_url":  img_url,
                "file_title": file_title,
            })

    return entries


# ─── Download immagine ─────────────────────────────────────────────────────────

def download_image(url: str, dest_path: Path) -> bool:
    """Scarica l'immagine e la salva in formato PNG."""
    try:
        resp = session.get(url, timeout=20)
        resp.raise_for_status()
        img = Image.open(BytesIO(resp.content)).convert("RGBA")
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest_path.with_suffix(".png"), "PNG")
        log.info(f"    💾 {dest_path.with_suffix('.png').name}")
        return True
    except Exception as e:
        log.warning(f"    ⚠ Download fallito per {url[:60]}...: {e}")
        return False


# ─── Pipeline principale ───────────────────────────────────────────────────────

def _ricostruisci_indice_esistente() -> dict:
    """
    Ricostruisce il master_index dalle cartelle già presenti su disco,
    così lo scraper può riprendere senza ri-scaricare le immagini già salvate.
    """
    indice = {}
    for building_name in PRIORITY_BUILDINGS:
        safe_name    = building_name.replace(" ", "_").replace("'", "").lower()
        building_dir = OUTPUT_DIR / safe_name
        if not building_dir.exists():
            continue
        imgs = sorted(building_dir.glob("level_*.png"))
        if imgs:
            records = []
            for i, img_path in enumerate(imgs, 1):
                records.append({
                    "level":      i,
                    "image_path": str(img_path.relative_to(OUTPUT_DIR)),
                    "image_url":  "",
                    "stats":      {},
                })
            indice[building_name] = records
            log.info(f"  ♻️  Ripreso da disco: '{building_name}' ({len(records)} img)")
    return indice


def run_scraper():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Resume: ricostruisce l'indice dalle cartelle già presenti ──────────────
    master_index = _ricostruisci_indice_esistente()
    gia_scaricati = set(master_index.keys())
    if gia_scaricati:
        log.info(f"♻️  Resume: {len(gia_scaricati)} edifici già presenti su disco, li salto.")

    total = len(PRIORITY_BUILDINGS)

    for idx, (building_name, wiki_title) in enumerate(PRIORITY_BUILDINGS.items(), 1):
        log.info(f"\n[{idx}/{total}] 🏠 {building_name}")

        # ── Salta gli edifici già scaricati ──────────────────────────────────
        if building_name in gia_scaricati:
            log.info(f"  ⏭️  Già presente su disco — salto.")
            continue

        safe_name     = building_name.replace(" ", "_").replace("'", "").lower()
        building_dir  = OUTPUT_DIR / safe_name
        building_records = []

        entries = scarica_immagini_da_mediawiki(building_name)

        for entry in entries:
            img_url  = entry["image_url"]
            level    = entry["level"]
            filename = building_dir / f"level_{level:02d}"
            if download_image(img_url, filename):
                building_records.append({
                    "level":      level,
                    "image_path": str(filename.with_suffix(".png").relative_to(OUTPUT_DIR)),
                    "image_url":  img_url,
                    "stats":      {},
                })
            time.sleep(DELAY)

        if building_records:
            master_index[building_name] = building_records
            log.info(f"  ✅ {len(building_records)} livelli salvati per '{building_name}'")
        else:
            log.warning(f"  ⚠ Nessuna immagine trovata per '{building_name}'")

        time.sleep(DELAY)

    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(master_index, f, ensure_ascii=False, indent=2)

    log.info(f"\n🎉 Scraping completato!")
    log.info(f"   Edifici: {len(master_index)}")
    log.info(f"   Immagini totali: {sum(len(v) for v in master_index.values())}")
    log.info(f"   Index: {INDEX_FILE}")


if __name__ == "__main__":
    log.info("🚀 Avvio scraper CoC – MediaWiki API (no blocchi 403)")
    run_scraper()
