"""
Chiama l'endpoint /api/import-bonus su Vercel con i dati dell'Excel.
"""
import sys, subprocess, json

subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'requests', '-q'],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
import requests

API_URL = 'https://fearunited-coc.vercel.app/api/import-bonus'

# Configura qui il SYNC_SECRET (stesso valore della variabile d'ambiente su Vercel)
import os
SYNC_SECRET = os.environ.get('SYNC_SECRET', '')
if not SYNC_SECRET:
    print("⚠ ATTENZIONE: variabile d'ambiente SYNC_SECRET non impostata.")
    print("  Imposta: set SYNC_SECRET=<valore> prima di eseguire lo script.")
    sys.exit(1)

# Carica dati
with open(r'C:\Users\pedro\Desktop\Claude\FearUnitedCoC\excel_data.json', encoding='utf-8') as f:
    ex = json.load(f)

headers = ex['headers']
data    = ex['data']

# Identifica le colonne mese (formato YYYY-MM)
month_cols = [(i, h) for i, h in enumerate(headers)
              if h and len(h) == 7 and h[4] == '-']

print(f"Mesi: {[m for _, m in month_cols]}")
print(f"Giocatori: {len(data)}")

# Costruisce lista upsert (solo record con bonus_assigned=True)
upsert_rows = []
for row in data:
    player_name = row[0]
    if not player_name or not isinstance(player_name, str):
        continue
    player_name = player_name.strip()

    for col_idx, season in month_cols:
        cell_val = row[col_idx] if col_idx < len(row) else None
        if isinstance(cell_val, (int, float)) and cell_val > 0:
            upsert_rows.append({
                'player_name':      player_name,
                'season':           season,
                'participated':     True,
                'bonus_assigned':   True,
                'stars':            0,
                'destruction':      0.0,
                'attacks_made':     0,
                'attacks_required': 0,
                'bonus_score':      0,
                'still_in_clan':    True,
                'is_secondary':     False,
            })

print(f"Record con bonus da importare: {len(upsert_rows)}")

# Invia tutto in un blocco (l'API gestisce max payload JSON)
CHUNK = 100
total_ok = 0
errors = []

for i in range(0, len(upsert_rows), CHUNK):
    chunk = upsert_rows[i:i+CHUNK]
    r = requests.post(API_URL, json=chunk, headers={'x-sync-key': SYNC_SECRET}, timeout=30)
    if r.status_code == 200:
        total_ok += len(chunk)
        print(f"  Blocco {i//CHUNK+1}: ✅ {len(chunk)} righe")
    else:
        err = f"Blocco {i//CHUNK+1}: {r.status_code} - {r.text[:300]}"
        errors.append(err)
        print(f"  ✗ {err}")

print(f"\n{'✅' if not errors else '⚠'} Completato: {total_ok} inseriti, {len(errors)} errori")
if errors:
    for e in errors:
        print("  ✗", e)
