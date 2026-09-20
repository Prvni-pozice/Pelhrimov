#!/usr/bin/env python3
"""preview_plan.py — kontrolní půdorys z vygenerovaného src/data/pelhrimov.json.

Není součástí hry. Slouží k tomu, aby šlo na jednom obrázku zkontrolovat, že
datová pipeline dává smysl: terén, plochy, ulice, domy, hradby, brány a hranice
hratelné oblasti. Výstup: data/preview_plan.png
"""
import json, math, os
from PIL import Image, ImageDraw
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = json.load(open(os.path.join(ROOT, 'src', 'data', 'pelhrimov.json'), encoding='utf-8'))
HALF, S = W['half'], 1400
SC = S / (2 * HALF)
def px(p): return (S / 2 + p[0] * SC, S / 2 + p[1] * SC)

# ── podklad: stínovaný reliéf z DMR 5G ───────────────────────────────
T = W['terrain']; g = T['g']
h = np.array(T['data'], dtype='float64').reshape(g, g) / 10.0
gz, gx = np.gradient(h, (2 * HALF) / (g - 1))
shade = np.clip(0.5 + 1.6 * (gx * 0.7 - gz * 0.7), 0.15, 1.0)
rel = np.stack([shade * 236, shade * 233, shade * 224], -1).astype('uint8')
img = Image.fromarray(rel).resize((S, S), Image.BICUBIC)
d = ImageDraw.Draw(img, 'RGBA')

FILL = {'water': (120, 170, 214, 220), 'forest': (110, 158, 96, 200),
        'grass': (162, 198, 130, 190), 'paved': (198, 194, 186, 170)}
for a in W['areas']:
    d.polygon([px(p) for p in a['poly']], fill=FILL[a['kind']])

ROAD = {'sett': (188, 178, 166), 'paved': (158, 158, 160), 'gravel': (186, 172, 148)}
for r in W['roads']:
    d.line([px(p) for p in r['poly']], fill=ROAD[r['m']], width=max(1, int(r['w'] * SC)), joint='curve')

d.polygon([px(p) for p in W['square'][0]], outline=(230, 130, 20), width=3)

# hranice hratelné oblasti — hotová z dat, ať se plán a hra nemůžou rozejít
ring = W['boundary']
d.line([px(p) for p in ring] + [px(ring[0])], fill=(20, 60, 200, 210), width=5)

for b in W['buildings']:
    pts = [px(p) for p in b['poly']]
    if b['sq']:      fill, out = (232, 150, 60, 255), (120, 60, 10)
    elif b['play']:  fill, out = (198, 176, 152, 255), (110, 96, 82)
    else:            fill, out = (210, 205, 198, 130), (170, 165, 158)
    d.polygon(pts, fill=fill, outline=out)

for w in W['walls']:
    d.line([px(p) for p in w['poly']], fill=(196, 40, 40), width=6, joint='curve')

for b in W['barriers']:
    ca, sa = math.cos(b['a'] + math.pi / 2), math.sin(b['a'] + math.pi / 2)
    L = b['w'] / 2 + 3
    d.line([px((b['x'] - ca * L, b['z'] - sa * L)), px((b['x'] + ca * L, b['z'] + sa * L))],
           fill=(230, 20, 20), width=8)

MARK = {'gate': (20, 140, 60), 'fountain': (40, 120, 220), 'monument': (150, 60, 190),
        'landmark': (220, 40, 140), 'tree': (60, 130, 50), 'bench': (140, 120, 90),
        'lamp': (200, 180, 60)}
for p in W['pois']:
    X, Y = px((p['x'], p['z'])); c = MARK.get(p['k'], (90, 90, 90))
    r = 9 if p['k'] in ('gate', 'landmark', 'fountain', 'monument') else 3
    d.ellipse([X - r, Y - r, X + r, Y + r], fill=c, outline=(0, 0, 0) if r > 5 else None)
    if r > 5 and p.get('name'):
        d.text((X + r + 3, Y - 6), p['name'], fill=(20, 20, 20))

d.rectangle([14, 14, 640, 84], fill=(255, 255, 255, 215))
d.text((24, 22), f"{W['place']} — {len(W['buildings'])} domu, "
                 f"{sum(1 for b in W['buildings'] if b['play'])} hratelnych, "
                 f"{sum(1 for b in W['buildings'] if b['sq'])} na namesti", fill=(0, 0, 0))
d.text((24, 40), f"teren {T['base']}-{T['base'] + max(T['data'])/10:.0f} m n.m. (CUZK DMR 5G), "
                 f"mapa {2*HALF}x{2*HALF} m", fill=(0, 0, 0))
d.text((24, 58), "oranz. = fronta namesti | hneda = hratelne | seda = kulisa | modra = hranice hry | cervena = zatarasy",
       fill=(0, 0, 0))
d.line([(40, S - 40), (40 + 100 * SC, S - 40)], fill=(0, 0, 0), width=4)
d.text((40, S - 62), '100 m', fill=(0, 0, 0))

out = os.path.join(ROOT, 'data', 'preview_plan.png')
img.save(out)
print('→', os.path.relpath(out, ROOT))
