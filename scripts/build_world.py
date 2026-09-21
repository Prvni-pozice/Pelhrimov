#!/usr/bin/env python3
"""build_world.py — postaví src/data/pelhrimov.json z reálných otevřených dat.

Zdroje:
  * OpenStreetMap (ODbL)  — půdorysy domů, ulice, hradby, brány, zeleň, voda
  * ČÚZK DMR 5G           — výškopis holé země (5m mřížka), přes ArcGIS ImageServer

Stažená surová data se cachují v data/ (gitignored), takže opakovaný běh
už nesahá na síť. Výstup je jeden JSON, který hra načítá za běhu a teprve
v prohlížeči z něj voxelizuje svět.

Spuštění:  npm run world      (= python3 scripts/build_world.py)
           python3 scripts/build_world.py --refresh   (znovu stáhne zdroje)
"""
import json, math, os, sys, urllib.parse, urllib.request, collections
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(ROOT, 'src', 'data', 'pelhrimov.json')
# OSM i ČÚZK chtějí v hlavičce poznat, kdo se ptá. Kontaktní adresu sem
# schválně nedávám — doplň si vlastní, pokud budeš stahovat ve velkém.
UA = os.environ.get('PELHRIMOV_UA', 'pelhrimov-game/0.1 (open data client)')

# ── geometrie mapy ────────────────────────────────────────────────────
# Střed = těžiště Masarykova náměstí. HALF je poloměr čtvercové mapy v metrech,
# PLAY_R je dosah hratelné oblasti od okraje náměstí (za ním už jen kulisa).
CLAT, CLON = 49.4308115, 15.2232854
HALF = 260
# Dosah hry od okraje náměstí. Okružní ulice kolem jádra (Příkopy, Solní, Tylova,
# Dr. Tyrše) leží 81–120 m od náměstí, takže 130 m spolehlivě obsáhne náměstí,
# blok domů kolem něj, celý okruh i řadu domů na jeho vnější straně. Dál se
# nejde, ale domy tam stojí dál — kulisa uzavřeného jádra.
PLAY_R = 130
SPUR_HALF = 0.34   # poloviční úhel výseku, kterým hranice vybíhá k bráně
MPD_LAT = 110574.0                                   # metrů na stupeň šířky
MPD_LON = 111320.0 * math.cos(math.radians(CLAT))    # ... a délky na této šířce

def xy(lat, lon):
    """WGS84 → lokální metry. +x na východ, +z na jih (jako Three.js scéna)."""
    return ((lon - CLON) * MPD_LON, -(lat - CLAT) * MPD_LAT)

def fetch(url, path, post=None, binary=True):
    """Stáhne do cache, pokud tam ještě není."""
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print(f'  cache: {os.path.relpath(path, ROOT)}')
        return path
    print(f'  stahuji: {url[:95]}...')
    req = urllib.request.Request(url, data=post, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=300) as r, open(path, 'wb') as f:
        f.write(r.read())
    print(f'  → {os.path.relpath(path, ROOT)} ({os.path.getsize(path) // 1024} kB)')
    return path

# ── 1. OpenStreetMap ──────────────────────────────────────────────────
def fetch_osm():
    m = 1.25 * HALF  # o kus víc než mapa, ať jsou domy na okraji celé
    s, n = CLAT - m / MPD_LAT, CLAT + m / MPD_LAT
    w, e = CLON - m / MPD_LON, CLON + m / MPD_LON
    url = f'https://api.openstreetmap.org/api/0.6/map?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}'
    return fetch(url, os.path.join(DATA, 'pelhrimov.osm'))

# ── 2. ČÚZK DMR 5G ────────────────────────────────────────────────────
TERRAIN_G = 131  # mřížka 131×131 přes 2*HALF metrů → krok ~4 m

def fetch_terrain():
    m = HALF + 20
    s, n = CLAT - m / MPD_LAT, CLAT + m / MPD_LAT
    w, e = CLON - m / MPD_LON, CLON + m / MPD_LON
    url = ('https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage'
           f'?bbox={w:.6f},{s:.6f},{e:.6f},{n:.6f}&bboxSR=4326&imageSR=4326'
           f'&size={TERRAIN_G},{TERRAIN_G}&format=tiff&pixelType=F32'
           '&interpolation=RSP_BilinearInterpolation&f=image')
    return fetch(url, os.path.join(DATA, 'dmr5g.tif'))

def read_terrain(path):
    from PIL import Image
    import numpy as np
    a = np.array(Image.open(path)).astype('float64')
    if a.shape != (TERRAIN_G, TERRAIN_G):
        sys.exit(f'DMR5G: čekal jsem {TERRAIN_G}×{TERRAIN_G}, přišlo {a.shape}')
    if not np.isfinite(a).all() or a.min() < 100 or a.max() > 2000:
        sys.exit(f'DMR5G: nesmyslné výšky {a.min()}..{a.max()} — zkontroluj službu')
    # TIFF má první řádek na severu, naše +z míří na jih → pořadí sedí.
    # Mapa má okraj 20 m navíc, ořízneme zpět na přesně 2*HALF.
    span = 2 * (HALF + 20)
    step = span / (TERRAIN_G - 1)
    g = TERRAIN_G
    out = []
    for j in range(g):
        z = -HALF + (2 * HALF) * j / (g - 1)
        for i in range(g):
            x = -HALF + (2 * HALF) * i / (g - 1)
            fi = (x + HALF + 20) / step
            fj = (z + HALF + 20) / step
            i0 = max(0, min(g - 2, int(fi))); j0 = max(0, min(g - 2, int(fj)))
            tx, tz = fi - i0, fj - j0
            h = ((a[j0, i0] * (1 - tx) + a[j0, i0 + 1] * tx) * (1 - tz)
                 + (a[j0 + 1, i0] * (1 - tx) + a[j0 + 1, i0 + 1] * tx) * tz)
            out.append(h)
    base = math.floor(min(out))
    return {'g': g, 'half': HALF, 'base': base,
            'data': [round((h - base) * 10) for h in out]}  # decimetry, ať je JSON malý

# ── 3. parsování OSM ──────────────────────────────────────────────────
def load_osm(path):
    root = ET.parse(path).getroot()
    nodes, ntags = {}, {}
    for n in root.findall('node'):
        nid = n.get('id')
        nodes[nid] = xy(float(n.get('lat')), float(n.get('lon')))
        tg = {t.get('k'): t.get('v') for t in n.findall('tag')}
        if tg: ntags[nid] = tg
    ways = {}
    for w in root.findall('way'):
        refs = [d.get('ref') for d in w.findall('nd') if d.get('ref') in nodes]
        ways[w.get('id')] = {
            'tags': {t.get('k'): t.get('v') for t in w.findall('tag')},
            'nds': refs,
            'pts': [nodes[r] for r in refs],
        }
    rels = []
    for r in root.findall('relation'):
        rels.append({
            'tags': {t.get('k'): t.get('v') for t in r.findall('tag')},
            'members': [(m.get('type'), m.get('ref'), m.get('role')) for m in r.findall('member')],
        })
    return nodes, ntags, ways, rels

def area_of(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                   for i in range(len(pts)))) / 2

def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

def obb(pts):
    """Nejmenší opsaný obdélník (rotating calipers po hranách) → (úhel, délka, šířka)."""
    best = None
    for i in range(len(pts)):
        dx = pts[(i + 1) % len(pts)][0] - pts[i][0]
        dz = pts[(i + 1) % len(pts)][1] - pts[i][1]
        L = math.hypot(dx, dz)
        if L < 0.3: continue
        ca, sa = dx / L, dz / L
        us = [p[0] * ca + p[1] * sa for p in pts]
        vs = [-p[0] * sa + p[1] * ca for p in pts]
        w, h = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * h < best[0]:
            best = (w * h, math.atan2(dz, dx), w, h)
    if best is None: return (0.0, 1.0, 1.0)
    _, a, w, h = best
    return (a, w, h) if w >= h else (a + math.pi / 2, h, w)

def simplify(pts, tol=0.35):
    """Douglas-Peucker — OSM obrysy mají spoustu bodů, které voxel stejně zahodí."""
    if len(pts) < 3: return pts
    def rec(s, e):
        if e <= s + 1: return []
        x1, z1 = pts[s]; x2, z2 = pts[e]
        dx, dz = x2 - x1, z2 - z1
        L2 = dx * dx + dz * dz
        worst, wi = -1, -1
        for i in range(s + 1, e):
            px, pz = pts[i]
            t = 0.0 if L2 == 0 else max(0, min(1, ((px - x1) * dx + (pz - z1) * dz) / L2))
            d = math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz))
            if d > worst: worst, wi = d, i
        if worst <= tol: return []
        return rec(s, wi) + [wi] + rec(wi, e)
    keep = [0] + rec(0, len(pts) - 1) + [len(pts) - 1]
    return [pts[i] for i in sorted(set(keep))]

# ── 4. vzhled domů ────────────────────────────────────────────────────
# Paleta měšťanských fasád historického jádra: tlumené pastely + bílá.
# Roblox look = sytější a čistší barvy než realita, ale pořád "česká pastelka".
# Odstíny odečtené z fotek náměstí (Commons, CC BY-SA): hořčicová žlutá,
# šalvějová zeleň, lososová, mátová, okr. Pastely z prvního pokusu byly tak
# vybledlé, že celé náměstí splývalo do béžové.
WALL_PALETTE = ['#e8c65a', '#c3cfc0', '#e0917c', '#b7dcc9', '#eddfb4', '#dcc9d6',
                '#f0dc9a', '#d3c3a0', '#e7b98c', '#cfd9e0', '#f2e3ae', '#d9bfae',
                '#bfd3c2', '#e9cfa0', '#c9d2dd', '#efd9c2']
# Na fotkách náměstí jsou střechy jasně cihlově oranžové, ne hnědé — tlumená
# paleta z prvního pokusu dělala z Pelhřimova podzimní kulisu.
ROOF_PALETTE = ['#c45f39', '#b85535', '#d06c42', '#a85030', '#c96540', '#b45a3c',
                '#d4753f', '#bf5c33']
LEVEL_H, GROUND_H = 3.2, 4.2   # výška běžného a přízemního podlaží

def seeded(sid, palette):
    h = 2166136261
    for ch in sid:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return palette[h % len(palette)]

def area_kind(kind, area):
    """Velká veřejná stavba — hřeben vede podél ulice, ne do hloubky parcely."""
    return area > 420 and kind in ('civic', 'commercial', 'retail', 'hotel', 'public', 'office')


def roof_shape(tags, L, W, kind, area):
    """Tvar střechy. OSM ho uvádí u 35 budov z 1566, zbytek je odhad.

    Sedlovka s hřebenem kolmo na ulici sedí na měšťanský dům na hluboké
    parcele. Na velký blok banky, spořitelny nebo hotelu ne — ty mají hřeben
    podél ulice, a odhad podle poměru stran je dělal stejné jako sousedy.
    """
    s = tags.get('roof:shape')
    if s in ('flat', 'gabled', 'hipped', 'pyramidal', 'skillion', 'half-hipped', 'mansard'):
        return {'gabled': 'gable', 'half-hipped': 'gable'}.get(s, s)
    if kind in ('garage', 'warehouse', 'industrial', 'roof', 'carport'): return 'flat'
    if kind == 'church': return 'gable'
    if W < 4.5: return 'skillion'
    if area > 420 and kind in ('civic', 'commercial', 'retail', 'hotel', 'public', 'office'):
        return 'hipped'
    return 'gable' if L / max(W, 0.1) > 1.25 else 'hipped'

# ── ověřené rozměry dominant ────────────────────────────────────────
# OSM u žádné z nich nemá výšku a paušální odhad byl špatně: ze Solní brány
# dělal sedmnáctimetrovou věž, ačkoli je to nízký patrový domek s červenou
# sedlovkou. Hodnoty níž jsou odečtené z fotografií na Wikimedia Commons
# (vše CC BY-SA), ne vymyšlené:
#   Dolní (Jihlavská) brána — vysoká bílá věž, strmá červená jehlanová střecha,
#     hodiny ve štítu, měděná lucerna na hřebeni (soubor uvádí 36 m)
#   Horní (Rynárecká) brána — nižší věž s dřevěným ochozem, valbová střecha,
#     hodiny, cibulová měděná lucerna
#   Solní brána — jen průjezdní domek o dvou podlažích, cihlově červená omítka
#   kostel sv. Bartoloměje — hranolová věž s jehlou a lucernou
# 'h' je výška zdiva nad podlahou; střecha a lucerna se přičtou.
LANDMARKS = {
    'Dolní brána': {'tower': {'h': 26.0, 'side': 8.5, 'roof': 'steep', 'lantern': 2.0},
                    'wall': '#f3f0e8', 'roofcol': '#c25a34'},
    'Horní brána': {'tower': {'h': 17.0, 'side': 8.0, 'roof': 'hip', 'lantern': 2.2},
                    'wall': '#d6ccb6', 'roofcol': '#b2543a'},
    'Solní brána': {'tower': None, 'roof': 'gable',
                    'wall': '#c0543a', 'roofcol': '#c25a34'},
    'svatý Bartoloměj': {'tower': {'h': 34.0, 'side': 6.0, 'roof': 'spire', 'lantern': 2.0},
                         'wall': '#efe9dc', 'roofcol': '#b2543a'},
    'svatý Vít': {'tower': {'h': 22.0, 'side': 5.0, 'roof': 'spire', 'lantern': 1.4},
                  'wall': '#eee8da', 'roofcol': '#b2543a'},
    'zámek Pelhřimov': {'tower': None},
}


def special_kind(tags, kind):
    """Stavby, které nejsou jen dům — dostanou v enginu vlastní hmotu.

    Bez toho má Pelhřimov siluetu jako každé jiné město: samé sedlovky. Věž
    kostela a brány jsou to, podle čeho se jádro pozná z dálky.
    """
    name = tags.get('name', '')
    if kind in ('church', 'chapel') or tags.get('amenity') == 'place_of_worship':
        return 'church'
    if 'brána' in name or tags.get('historic') == 'city_gate':
        return 'gate'
    if name.startswith('zámek') or tags.get('historic') == 'castle':
        return 'castle'
    return None


# ── podloubí ────────────────────────────────────────────────────────
# Podloubí se NEODHADUJE podle strany náměstí. První pokus ho dával celé
# frontě kromě jižní strany a pletl se: Komerční banka ani čp. 78 a 79 ho
# nemají, přestože na "podloubené" straně stojí.
#
# Bere se ze dvou tvrdých zdrojů:
#   1. OSM cesta s covered=arcade — 69 m dlouhá fronta na severozápadě,
#      jediné podloubí, které je v mapě opravdu zakreslené
#   2. src/data/domy.json — ruční záznamy, každý se zdrojem
# Co není doloženo, podloubí nedostane. Chybějící podloubí je menší chyba
# než vymyšlené.
ARCADE_NEAR = 8.0      # metrů od zakreslené cesty s podloubím


def square_side(poly, sq_polys):
    """Na které straně náměstí dům stojí — S/J/V/Z podle nejbližší hrany."""
    cx = sum(p[0] for p in poly) / len(poly)
    cz = sum(p[1] for p in poly) / len(poly)
    best, bd = None, 1e9
    for ring in sq_polys:
        n = len(ring)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L2 = dx * dx + dz * dz
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((cx - a[0]) * dx + (cz - a[1]) * dz) / L2))
            px, pz = a[0] + t * dx, a[1] + t * dz
            d = math.hypot(cx - px, cz - pz)
            if d < bd:
                bd = d
                # normála hrany otočená ven z náměstí (těžiště prstence ~ 0,0)
                nx_, nz_ = -dz, dx
                gx = sum(q[0] for q in ring) / n
                gz = sum(q[1] for q in ring) / n
                if (px - gx) * nx_ + (pz - gz) * nz_ < 0:
                    nx_, nz_ = -nx_, -nz_
                best = (nx_, nz_)
    if not best:
        return None
    ang = math.degrees(math.atan2(best[1], best[0]))   # +x=0°, +z(jih)=90°
    if -135 <= ang < -45: return 'S'
    if -45 <= ang < 45:   return 'V'
    if 45 <= ang < 135:   return 'J'
    return 'Z'


def arcade_ways(ways):
    """Geometrie cest označených v OSM jako podloubí (covered=arcade)."""
    out = []
    for w in ways.values():
        if w['tags'].get('covered') == 'arcade' and len(w['pts']) >= 2:
            out.append(w['pts'])
    return out


def load_manual():
    """Ruční údaje o domech ze src/data/domy.json (každý se zdrojem)."""
    path = os.path.join(ROOT, 'src', 'data', 'domy.json')
    if not os.path.exists(path):
        return {}
    d = json.load(open(path, encoding='utf-8'))
    bad = [k for k, v in d.get('domy', {}).items() if 'zdroj' not in v]
    if bad:
        sys.exit(f'domy.json: záznamy bez zdroje: {bad}')
    return d.get('domy', {})


def landmark_overrides(name):
    """Ověřené hodnoty pro konkrétní stavbu, jinak prázdno."""
    L = LANDMARKS.get(name)
    if not L:
        return {}
    out = {'tower': L.get('tower')}
    for k in ('wall', 'roofcol', 'roof'):
        if k in L:
            out[k] = L[k]
    return out


def build_buildings(ways, rels, sq_polys):
    out = []
    for wid, w in ways.items():
        tg = w['tags']
        if 'building' not in tg and 'building:part' not in tg: continue
        pts = w['pts']
        if len(pts) < 4: continue
        if pts[0] == pts[-1]: pts = pts[:-1]
        if len(pts) < 3: continue
        A = area_of(pts)
        if A < 9: continue                       # kůlny a boudy pod 9 m² zahodíme
        cx, cz = centroid(pts)
        if max(abs(cx), abs(cz)) > HALF: continue
        pts = simplify(pts)
        if len(pts) < 3: continue
        kind = tg.get('building', 'yes')
        ang, L, W = obb(pts)

        lv = tg.get('building:levels')
        try: levels = max(1, min(8, int(float(lv))))
        except (TypeError, ValueError):
            levels = 1 if kind in ('garage', 'shed', 'carport', 'roof') else (3 if A > 220 else 2)
        eave = GROUND_H + (levels - 1) * LEVEL_H
        if tg.get('height'):
            try: eave = max(2.5, float(str(tg['height']).replace('m', '').strip()))
            except ValueError: pass

        shape = roof_shape(tg, L, W, kind, A)
        front_ridge = shape in ('hipped', 'mansard') and area_kind(kind, A)
        # U hřebene podél ulice se střecha rozpíná přes hloubku parcely, ne
        # přes šířku domu — počítat rozpon z W by z ní udělalo horu.
        rh = (0.6 if shape == 'flat'
              else min(6.0, max(2.5, min(L, W) * 0.40)) if front_ridge
              else min(7.5, max(2.2, W * 0.42)))
        if kind == 'church': rh = max(rh, 8.0)

        # Vzdálenost měříme od NEJBLIŽŠÍHO rohu domu, ne od těžiště — náměstí je
        # v OSM prstenec okružní jízdy a domy stojí až za ním. V datech je čistý
        # předěl: fronta náměstí končí na 14,8 m, další dům je až na 18,6 m.
        d = min(dist_to_polys(p, sq_polys) for p in pts)
        out.append({
            'id': 'w' + wid,
            'poly': [[round(p[0], 2), round(p[1], 2)] for p in pts],
            'a': round(ang, 4), 'L': round(L, 2), 'W': round(W, 2),
            'levels': levels, 'eave': round(eave, 2),
            'roof': shape, 'rh': round(rh, 2),
            'ridge': 'front' if front_ridge else 'long',
            'wall': seeded(wid, WALL_PALETTE), 'roofcol': seeded(wid + 'r', ROOF_PALETTE),
            'kind': kind,
            'special': special_kind(tg, kind),
            'name': tg.get('name'),
            **landmark_overrides(tg.get('name')),
            'sq': d < 16,            # dům ve frontě náměstí (viz předěl výše)
            'side': square_side(pts, sq_polys) if d < 16 else None,
            'play': d < PLAY_R,      # uvnitř hratelné oblasti
            'd': round(d, 1),        # vzdálenost od náměstí
        })
    return out

def dist_point_seg(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))


def dist_to_polys(p, polys):
    best = 1e9
    for poly in polys:
        if point_in_poly(p, poly): return 0.0
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L2 = dx * dx + dz * dz
            t = 0.0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
            best = min(best, math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)))
    return best

def point_in_poly(p, poly):
    x, z = p; inside = False
    for i in range(len(poly)):
        x1, z1 = poly[i]; x2, z2 = poly[(i + 1) % len(poly)]
        if (z1 > z) != (z2 > z):
            xi = x1 + (z - z1) / (z2 - z1) * (x2 - x1)
            if x < xi: inside = not inside
    return inside

# ── 5. ulice, plochy, mobiliář ────────────────────────────────────────
ROAD_W = {'primary': 9, 'secondary': 8, 'tertiary': 7, 'unclassified': 6, 'residential': 6,
          'living_street': 6, 'service': 4, 'pedestrian': 7, 'footway': 2.2, 'path': 2,
          'steps': 2, 'track': 3}

def build_roads(ways):
    out = []
    for wid, w in ways.items():
        tg = w['tags']
        hw = tg.get('highway')
        if not hw or hw not in ROAD_W: continue
        pts = [p for p in w['pts']]
        if len(pts) < 2: continue
        if all(max(abs(p[0]), abs(p[1])) > HALF for p in pts): continue
        surf = tg.get('surface', '')
        mat = ('sett' if surf in ('sett', 'cobblestone', 'paving_stones', 'unhewn_cobblestone')
               else 'gravel' if surf in ('gravel', 'ground', 'dirt', 'compacted', 'grass')
               else 'paved')
        if hw in ('footway', 'pedestrian', 'steps') and not surf: mat = 'sett'
        try: wd = float(str(tg.get('width', '')).replace('m', '').strip())
        except ValueError: wd = ROAD_W[hw]
        out.append({'poly': [[round(p[0], 2), round(p[1], 2)] for p in simplify(pts, 0.6)],
                    'w': round(max(1.5, min(14, wd)), 1), 'm': mat,
                    'name': tg.get('name'), 'hw': hw})
    return out

AREA_KINDS = [
    (lambda t: t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('landuse') == 'reservoir', 'water'),
    (lambda t: t.get('landuse') in ('forest', 'meadow') or t.get('natural') == 'wood', 'forest'),
    (lambda t: t.get('leisure') in ('park', 'garden', 'pitch', 'playground') or t.get('landuse') in ('grass', 'village_green', 'cemetery') or t.get('natural') == 'scrub', 'grass'),
    (lambda t: t.get('amenity') == 'parking' or t.get('landuse') in ('retail', 'commercial', 'industrial'), 'paved'),
]

def build_areas(ways):
    out = []
    for wid, w in ways.items():
        tg = w['tags']
        if 'building' in tg: continue
        pts = w['pts']
        if len(pts) < 4 or pts[0] != pts[-1]: continue
        pts = pts[:-1]
        if area_of(pts) < 25: continue
        cx, cz = centroid(pts)
        if max(abs(cx), abs(cz)) > HALF * 1.1: continue
        for test, kind in AREA_KINDS:
            if test(tg):
                out.append({'poly': [[round(p[0], 2), round(p[1], 2)] for p in simplify(pts, 0.8)],
                            'kind': kind})
                break
    return out

def build_walls(ways):
    out = []
    for wid, w in ways.items():
        tg = w['tags']
        if tg.get('historic') == 'citywalls' or tg.get('barrier') == 'city_wall':
            pts = w['pts']
            if len(pts) < 2: continue
            # OSM u pelhřimovských hradeb výšku neuvádí. 3,5 m odpovídá tomu,
            # co je na fotkách jádra vidět — zeď mezi domy a zahradami, ne
            # obranná kurtina. Kdyby se výška do OSM doplnila, vezme se odtud.
            try: h = float(str(tg.get('height', '3.5')).replace('m', '').strip())
            except ValueError: h = 3.5
            out.append({'poly': [[round(p[0], 2), round(p[1], 2)] for p in pts],
                        'h': round(max(2.5, min(12, h)), 1), 'name': tg.get('name')})
    return out

POI_TESTS = [
    (lambda t: t.get('amenity') == 'fountain', 'fountain'),
    (lambda t: t.get('historic') in ('memorial', 'monument', 'wayside_shrine'), 'monument'),
    (lambda t: t.get('historic') == 'city_gate', 'gate'),
    (lambda t: t.get('amenity') == 'bench', 'bench'),
    (lambda t: t.get('natural') == 'tree', 'tree'),
    (lambda t: t.get('highway') == 'street_lamp', 'lamp'),
    (lambda t: t.get('tourism') == 'museum' or t.get('amenity') in ('townhall', 'theatre', 'cinema'), 'landmark'),
]

def build_pois(nodes, ntags, ways):
    out = []
    for nid, tg in ntags.items():
        p = nodes[nid]
        if max(abs(p[0]), abs(p[1])) > HALF: continue
        for test, kind in POI_TESTS:
            if test(tg):
                out.append({'x': round(p[0], 2), 'z': round(p[1], 2), 'k': kind,
                            'name': tg.get('name')})
                break
    for wid, w in ways.items():
        tg = w['tags']
        if not w['pts']: continue
        cx, cz = centroid(w['pts'])
        if max(abs(cx), abs(cz)) > HALF: continue
        for test, kind in POI_TESTS:
            if test(tg) and kind in ('gate', 'fountain', 'monument', 'landmark'):
                out.append({'x': round(cx, 2), 'z': round(cz, 2), 'k': kind,
                            'name': tg.get('name'), 'w': True})
                break
    return out

def stitch_ring(segs):
    """Slepí úseky (seznamy uzlů) přes sdílené koncové body do uzavřených smyček."""
    rings, pool = [], list(segs)
    while pool:
        cur = list(pool.pop(0))
        grew = True
        while grew and cur[0] != cur[-1]:
            grew = False
            for i, s in enumerate(pool):
                if s[0] == cur[-1]:   cur += s[1:];            pool.pop(i); grew = True; break
                if s[-1] == cur[-1]:  cur += s[::-1][1:];      pool.pop(i); grew = True; break
                if s[-1] == cur[0]:   cur = s[:-1] + cur;      pool.pop(i); grew = True; break
                if s[0] == cur[0]:    cur = s[::-1][:-1] + cur; pool.pop(i); grew = True; break
        if cur[0] == cur[-1] and len(cur) > 4:
            rings.append(cur[:-1])
    return rings


def boundary_ring(sq_polys, gates, steps=360):
    """Hranice hratelné oblasti jako uzavřený mnohoúhelník.

    Základ je prostý: všechno do PLAY_R od okraje náměstí. K tomu se ale musí
    dostat tři historické brány — Dolní je od náměstí 164 m, tedy daleko za
    hranicí, a bez výběžku by se k Muzeu rekordů nedalo dojít. Poloměr se proto
    v úzkém výseku směrem ke každé bráně plynule zvedne tak, aby ji obsáhl.
    Vznikne tvar jádra se třemi výběžky po ulicích k branám.

    Počítá se to JEDNOU a uloží do dat. Hru, zátarasy i kontrolní plány pak
    zajímá stejný mnohoúhelník a nemůžou se rozejít.
    """
    cx = sum(p[0] for poly in sq_polys for p in poly) / sum(len(p) for p in sq_polys)
    cz = sum(p[1] for poly in sq_polys for p in poly) / sum(len(p) for p in sq_polys)
    spurs = []
    for g in gates:
        need = dist_to_polys((g['x'], g['z']), sq_polys) + 16
        if need <= PLAY_R:
            continue
        spurs.append((math.atan2(g['z'] - cz, g['x'] - cx), need))

    def radius(ang):
        r = PLAY_R
        for ga, need in spurs:
            d = abs((ang - ga + math.pi) % (2 * math.pi) - math.pi)
            if d >= SPUR_HALF:
                continue
            # kosinový náběh: uprostřed výseku plná délka, na kraji zpět na PLAY_R
            t = 0.5 * (1 + math.cos(math.pi * d / SPUR_HALF))
            r = max(r, PLAY_R + (need - PLAY_R) * t)
        return r

    ring = []
    for k in range(steps):
        ang = k / steps * 2 * math.pi
        R = radius(ang)
        lo, hi = 0.0, R * 2 + 140
        for _ in range(28):
            mid = (lo + hi) / 2
            if dist_to_polys((cx + math.cos(ang) * mid, cz + math.sin(ang) * mid), sq_polys) < R:
                lo = mid
            else:
                hi = mid
        ring.append([round(cx + math.cos(ang) * lo, 2), round(cz + math.sin(ang) * lo, 2)])
    return ring


def routes_to_gates(roads, sq_polys, gates):
    """Úseky ulic na cestě z náměstí ke každé bráně.

    Fasády se ladí tam, kam hráč opravdu chodí: na náměstí a v ulicích, které
    z něj vedou k branám. Cestu nehádáme podle názvů ulic — postavíme z ulic
    graf (koncové i mezilehlé body slepené na půlmetrovou mřížku) a Dijkstrou
    najdeme nejkratší trasu od náměstí ke každé bráně. Vrací seznam úseček.
    """
    import heapq
    SNAP = 0.5
    def key(p):
        return (round(p[0] / SNAP), round(p[1] / SNAP))

    graph = collections.defaultdict(list)
    for r in roads:
        if r['hw'] in ('steps',):
            continue
        pts = r['poly']
        for i in range(len(pts) - 1):
            a, b = key(pts[i]), key(pts[i + 1])
            if a == b:
                continue
            w = math.dist(pts[i], pts[i + 1])
            graph[a].append((b, w, (pts[i], pts[i + 1])))
            graph[b].append((a, w, (pts[i], pts[i + 1])))
    if not graph:
        return []

    def nearest_node(p):
        return min(graph, key=lambda n: (n[0] * SNAP - p[0]) ** 2 + (n[1] * SNAP - p[1]) ** 2)

    cx = sum(q[0] for poly in sq_polys for q in poly) / sum(len(p) for p in sq_polys)
    cz = sum(q[1] for poly in sq_polys for q in poly) / sum(len(p) for p in sq_polys)
    start = nearest_node((cx, cz))

    dist = {start: 0.0}
    prev = {}
    pq = [(0.0, start)]
    while pq:
        d, n = heapq.heappop(pq)
        if d > dist.get(n, 1e18):
            continue
        for m, w, seg in graph[n]:
            nd = d + w
            if nd < dist.get(m, 1e18):
                dist[m] = nd
                prev[m] = (n, seg)
                heapq.heappush(pq, (nd, m))

    segs = []
    for g in gates:
        node = nearest_node((g['x'], g['z']))
        seen = set()
        while node in prev and node not in seen:
            seen.add(node)
            node, seg = prev[node]
            segs.append(seg)
    return segs


def crossings(roads, ring):
    """Kde ulice protínají hranici — tam přijde zátaras.

    Blízké nálezy sloučíme, jinak by na jedné křižovatce stálo pět zátarasů
    vedle sebe.
    """
    found = []
    for r in roads:
        if r['hw'] in ('steps', 'path', 'footway'):
            continue
        pts = r['poly']
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ia = point_in_poly(a, ring)
            ib = point_in_poly(b, ring)
            if ia == ib:
                continue
            lo, hi = 0.0, 1.0
            for _ in range(24):
                mid = (lo + hi) / 2
                p = (a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid)
                if point_in_poly(p, ring) == ia:
                    lo = mid
                else:
                    hi = mid
            t = (lo + hi) / 2
            found.append({'x': round(a[0] + (b[0] - a[0]) * t, 2),
                          'z': round(a[1] + (b[1] - a[1]) * t, 2),
                          'a': round(math.atan2(b[1] - a[1], b[0] - a[0]), 4),
                          'w': r['w'], 'name': r.get('name')})
    out = []
    for c in found:
        if any(math.dist((c['x'], c['z']), (o['x'], o['z'])) < 9 for o in out):
            continue
        out.append(c)
    return out


def square_polys(nodes, ways):
    """Plocha Masarykova náměstí.

    V OSM není zmapované jako plocha, ale jako okružní jízda (junction=roundabout)
    kolem středového ostrůvku. Slepíme ty úseky do prstence — ten obkružuje
    vlastní plochu náměstí a od něj počítáme, které domy stojí ve frontě.
    """
    segs = [w['nds'] for w in ways.values()
            if w['tags'].get('name') == 'Masarykovo náměstí'
            and w['tags'].get('junction') == 'roundabout' and len(w['nds']) > 1]
    polys = []
    for ring in stitch_ring(segs):
        pts = [nodes[r] for r in ring]
        if area_of(pts) > 300:
            polys.append(pts)
    return polys


# ── main ──────────────────────────────────────────────────────────────
def main():
    if '--refresh' in sys.argv:
        for f in ('pelhrimov.osm', 'dmr5g.tif'):
            p = os.path.join(DATA, f)
            if os.path.exists(p): os.remove(p)
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    print('OpenStreetMap:')
    osm_path = fetch_osm()
    print('ČÚZK DMR 5G:')
    ter_path = fetch_terrain()

    nodes, ntags, ways, rels = load_osm(osm_path)
    sq = square_polys(nodes, ways)
    if not sq: sys.exit('Nenašel jsem plochu Masarykova náměstí — zkontroluj OSM data.')

    world = {
        'place': 'Pelhřimov — historické jádro',
        'center': {'lat': CLAT, 'lon': CLON},
        'half': HALF, 'playR': PLAY_R,
        'square': [[[round(p[0], 2), round(p[1], 2)] for p in simplify(poly, 0.5)] for poly in sq],
        'terrain': read_terrain(ter_path),
        'buildings': build_buildings(ways, rels, sq),
        'roads': build_roads(ways),
        'areas': build_areas(ways),
        'walls': build_walls(ways),
        'arcades': [],    # osy podloubí z OSM (covered=arcade)
        'boundary': [],   # doplní se níž, potřebuje brány
        'barriers': [],
        'pois': build_pois(nodes, ntags, ways),
        'attribution': 'Budovy a ulice © přispěvatelé OpenStreetMap (ODbL). Výškopis © ČÚZK, DMR 5G.',
    }
    arcs = arcade_ways(ways)
    arc_segs = [(a, b2) for line in arcs for a, b2 in zip(line, line[1:])]
    world['arcades'] = [[[round(p[0], 2), round(p[1], 2)] for p in line] for line in arcs]
    gates = [p for p in world['pois'] if p['k'] == 'gate']
    world['boundary'] = boundary_ring(sq, gates)
    world['barriers'] = crossings(world['roads'], world['boundary'])
    # přeznačit budovy podle skutečné hranice, ne podle holé vzdálenosti
    for b in world['buildings']:
        b['play'] = any(point_in_poly(p, world['boundary']) for p in b['poly'])
        # podloubí jen na stranách, které ho podle fotek mají, a jen u domů
        # dost hlubokých na to, aby se do nich dalo zakrojit
        near = min((min(dist_point_seg(p, a, c) for a, c in arc_segs) for p in b['poly']),
                   default=1e9) if arc_segs else 1e9
        b['arcade'] = bool(b['sq'] and near < ARCADE_NEAR and min(b['L'], b['W']) > 8.5)
        # O kolik je dům odsazený od společné osy podloubí. Fasády té fronty
        # se v OSM postupně odsazují o skoro pět metrů, takže každý dům začínal
        # jinde a mezi sousedy vznikal schod napříč průchodem. Patra se proto
        # o tenhle kus předsadí až k ose a podloubí je pak rovné.
        b['push'] = round(min(3.5, near), 2) if b['arcade'] else 0

    # Ruční údaje přebijí všechno odvozené — a jen ty mají zdroj.
    manual = load_manual()
    for b in world['buildings']:
        m = manual.get(b['id'])
        if not m:
            continue
        for k in ('levels', 'roof', 'ridge', 'arcade', 'wall', 'roofcol'):
            if k in m:
                b[k] = m[k]
        if 'nazev' in m and not b.get('name'):
            b['name'] = m['nazev']
        b['rucne'] = True
        if 'levels' in m:
            b['eave'] = round(GROUND_H + (m['levels'] - 1) * LEVEL_H, 2)

    # Domy s propracovanou fasádou: fronta náměstí a domy v ulicích k branám.
    routes = routes_to_gates(world['roads'], sq, gates)
    for b in world['buildings']:
        if b['sq']:
            b['rich'] = True
            continue
        if not b['play'] or b['kind'] in ('garage', 'shed', 'carport', 'roof'):
            b['rich'] = False
            continue
        b['rich'] = any(
            min((dist_point_seg(p, a, c) for a, c in routes), default=1e9) < 15
            for p in b['poly'])

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(world, f, ensure_ascii=False, separators=(',', ':'))

    b = world['buildings']
    print(f"\nhotovo → {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT)//1024} kB)")
    print(f"  náměstí: {len(sq)} ploch, {sum(area_of(p) for p in sq):.0f} m²")
    print(f"  budovy: {len(b)}  (v hratelné oblasti {sum(1 for x in b if x['play'])},"
          f" přímo na náměstí {sum(1 for x in b if x['sq'])})")
    print(f"  střechy: {dict(collections.Counter(x['roof'] for x in b))}")
    print(f"  hřeben podél ulice: {sum(1 for x in b if x.get('ridge') == 'front')} budov")
    print(f"  ruční údaje se zdrojem: {sum(1 for x in b if x.get('rucne'))} budov")
    tw = [x['name'] for x in b if x.get('tower')]
    print(f"  věže podle fotografií: {', '.join(tw) if tw else 'žádné'}")
    print(f"  propracované fasády: {sum(1 for x in b if x.get('rich'))} domů "
          f"(z toho {sum(1 for x in b if x.get('arcade'))} s podloubím)")
    sides = collections.Counter(x['side'] for x in b if x['sq'])
    print(f"  fronta náměstí po stranách: {dict(sides)}; podloubí: "
          f"{sum(1 for x in b if x.get('arcade'))} domů")
    sp = collections.Counter(x['special'] for x in b if x['special'])
    print(f"  zvláštní stavby: {dict(sp)} — "
          + ', '.join(x['name'] or x['id'] for x in b if x['special']))
    print(f"  patra:   {dict(sorted(collections.Counter(x['levels'] for x in b).items()))}")
    ring = world['boundary']
    rr = [math.hypot(p[0], p[1]) for p in ring]
    print(f"  hranice hry: {len(ring)} bodů, {min(rr):.0f}–{max(rr):.0f} m od středu")
    print(f"  zátarasy na okraji: {len(world['barriers'])}")
    print(f"  ulice: {len(world['roads'])}, plochy: {len(world['areas'])}, "
          f"hradby: {len(world['walls'])}, POI: {len(world['pois'])}")
    t = world['terrain']
    print(f"  terén: {t['g']}×{t['g']}, {t['base']}–{t['base'] + max(t['data'])/10:.1f} m n. m.")

if __name__ == '__main__':
    main()
