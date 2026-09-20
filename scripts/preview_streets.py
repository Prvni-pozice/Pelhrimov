#!/usr/bin/env python3
"""preview_streets.py — plán hratelné oblasti s názvy ulic.

Kontrolní obrázek k odsouhlasení rozsahu mapy: co je uvnitř, kde jsou zátarasy
a jak se která ulice jmenuje. Výstup: data/preview_streets.png
"""
import json, math, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = json.load(open(os.path.join(ROOT, 'src', 'data', 'pelhrimov.json'), encoding='utf-8'))
HALF, S = 240, 1500
SC = S / (2 * HALF)
def px(p): return (S / 2 + p[0] * SC, S / 2 + p[1] * SC)

try:
    F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
    FS = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
except OSError:
    F = FS = ImageFont.load_default()

img = Image.new('RGB', (S, S), (245, 243, 238)); d = ImageDraw.Draw(img, 'RGBA')

sq = W['square'][0]
def seg_d(x, z, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
    return math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
def d_sq(x, z): return min(seg_d(x, z, sq[i], sq[(i + 1) % len(sq)]) for i in range(len(sq)))

def in_ring(x, z):
    ring = W['boundary']
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        if (ring[i][1] > z) != (ring[j][1] > z):
            xi = ring[i][0] + (z - ring[i][1]) / (ring[j][1] - ring[i][1]) * (ring[j][0] - ring[i][0])
            if x < xi: inside = not inside
        j = i
    return inside

for a in W['areas']:
    col = {'water': (150, 190, 225), 'forest': (150, 190, 145), 'grass': (196, 219, 175),
           'paved': (222, 219, 213)}[a['kind']]
    d.polygon([px(p) for p in a['poly']], fill=col)
for b in W['buildings']:
    inside = b['play']
    d.polygon([px(p) for p in b['poly']],
              fill=(235, 160, 70) if b['sq'] else ((205, 186, 164) if inside else (224, 221, 216)),
              outline=(150, 135, 120))

# ulice: uvnitř plné, venku vybledlé
for r in W['roads']:
    inside = all(in_ring(p[0], p[1]) for p in r['poly'])
    part = any(in_ring(p[0], p[1]) for p in r['poly'])
    col = (70, 70, 74) if inside else ((150, 120, 60) if part else (200, 198, 194))
    d.line([px(p) for p in r['poly']], fill=col, width=max(2, int(r['w'] * SC * 0.55)), joint='curve')

# hranice hry — hotová z dat
ring = W['boundary']
d.line([px(p) for p in ring] + [px(ring[0])], fill=(30, 90, 220, 230), width=6)
d.polygon([px(p) for p in sq], outline=(225, 120, 20), width=4)

for b in W['barriers']:
    ca, sa = math.cos(b['a'] + math.pi / 2), math.sin(b['a'] + math.pi / 2)
    L = b['w'] / 2 + 3
    d.line([px((b['x'] - ca * L, b['z'] - sa * L)), px((b['x'] + ca * L, b['z'] + sa * L))],
           fill=(215, 25, 25), width=9)

# názvy ulic: jednou na ulici, v nejdelším úseku uvnitř mapy
placed = []
best = {}
for r in W['roads']:
    if not r.get('name') or r['name'] == 'Masarykovo náměstí': continue
    for i in range(len(r['poly']) - 1):
        a, b = r['poly'][i], r['poly'][i + 1]
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if max(abs(mx), abs(mz)) > HALF - 12: continue
        L = math.dist(a, b)
        if r['name'] not in best or L > best[r['name']][0]:
            best[r['name']] = (L, mx, mz, d_sq(mx, mz))
for name, (L, mx, mz, ds) in sorted(best.items(), key=lambda kv: -kv[1][0]):
    X, Y = px((mx, mz))
    if any(abs(X - a) < 95 and abs(Y - b) < 17 for a, b in placed): continue
    placed.append((X, Y))
    col = (10, 60, 170) if in_ring(mx, mz) else (130, 120, 110)
    w = d.textlength(name, font=FS)
    d.rectangle([X - w / 2 - 3, Y - 9, X + w / 2 + 3, Y + 9], fill=(255, 255, 255, 215))
    d.text((X - w / 2, Y - 8), name, fill=col, font=FS)

for p in W['pois']:
    if p['k'] in ('gate', 'landmark', 'fountain', 'monument') and p.get('name'):
        X, Y = px((p['x'], p['z']))
        if max(abs(p['x']), abs(p['z'])) > HALF - 5: continue
        d.ellipse([X - 7, Y - 7, X + 7, Y + 7], fill=(20, 150, 70), outline=(0, 0, 0), width=2)
        d.text((X + 10, Y - 8), p['name'], fill=(15, 90, 40), font=F)
# divadlo je v OSM jen bodem bez vlastního POI typu — dokreslíme ručně
X, Y = px((-125, 19))
d.ellipse([X - 8, Y - 8, X + 8, Y + 8], fill=(190, 40, 190), outline=(0, 0, 0), width=2)
d.text((X + 11, Y - 9), 'Městské divadlo', fill=(120, 20, 120), font=F)

d.rectangle([12, 12, 760, 96], fill=(255, 255, 255, 230))
d.text((22, 20), 'Pelhrimov — rozsah hry. MODRA CARA = hranice, za ni se nejde.', fill=(0, 0, 0), font=F)
d.text((22, 42), 'Cerne ulice = cele uvnitr  |  okrove = castecne  |  svetle = mimo hru', fill=(0, 0, 0), font=FS)
d.text((22, 62), 'Cervene pruhy = zatarasy  |  oranzove domy = fronta namesti', fill=(0, 0, 0), font=FS)
d.line([(40, S - 40), (40 + 100 * SC, S - 40)], fill=(0, 0, 0), width=5)
d.text((40, S - 66), '100 m', fill=(0, 0, 0), font=F)

out = os.path.join(ROOT, 'data', 'preview_streets.png')
img.save(out)
print('→', os.path.relpath(out, ROOT))
