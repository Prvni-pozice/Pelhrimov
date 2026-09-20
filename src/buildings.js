// buildings.js — z půdorysu OSM udělá voxelový dům.
//
// Postup: rastr půdorysu → hmota domu od terénu po okap → sokl, okna, portál
// → římsa → střecha podle tvaru z OSM. Dům se staví do vlastní malé mřížky
// a teprve pak se mešuje, takže se sousedi navzájem neruší.
//
// Dvě věci, které se vyplatilo udělat jinak, než se nabízelo:
//
//  * Dům je PLNÝ, ne dutá skořepina. Dovnitř se stejně nedá, a greedy mesher
//    z plné hmoty udělá jen vnější plášť — skořepina naopak generuje i vnitřní
//    líc každé zdi. Na 414 domech to byl rozdíl 3,1 M vs. 0,4 M trojúhelníků.
//  * Každý sloupec zdi začíná na terénu POD SEBOU, ne na společném dně. Dům
//    tím nemá zakopanou část, kterou nikdo neuvidí, a ve svahu mu sám od sebe
//    vyroste vyšší sokl na dolní straně — přesně jak to na Vysočině vypadá.
//  * Mřížka je natočená podle domu, ne podle světových os. Reálné půdorysy z OSM
//    jsou skoro vždy o pár stupňů pootočené a v osové mřížce se z každé zdi
//    stane schodiště, které se nemá jak slít — jeden dům pak stál 12 000
//    trojúhelníků místo 400. Natočená mřížka dá rovné zdi a pravidelnou střechu;
//    sousední domy pak nemají voxely v zákrytu, což u Roblox vzhledu nevadí.
//
// Patra jsou v celých voxelech (přízemí 4 m, patro 3 m). Kdyby se braly metry
// z OSM doslova, okna by se v mřížce rozjela a každý dům by je měl jinde.

import { greedyMesh } from './voxel.js'
import { blockColor, isSolid } from './palette.js'

export const VOX = 0.5        // hrana voxelu domu
const G_CELLS = 8             // přízemí = 4 m
const F_CELLS = 6             // další patro = 3 m
const PAD = 3                 // okraj mřížky pro římsu a přesah střechy
const FOOT = 3                // kolik buněk zdi pokračuje pod terén

const B_OMITKA = 10, B_SOKL = 11, B_STRECHA = 13, B_HREBEN = 14, B_RIMSA = 15
const B_SKLO = 16, B_RAM = 17, B_DVERE = 18, B_STIT = 21, B_JADRO = 12, B_PLECH = 20
const B_KAMEN = 12

function hexRGB(h) { return [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255] }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] }

/**
 * Postaví jeden dům.
 * @param {object} b    záznam budovy z pelhrimov.json
 * @param {Terrain} ter terén (kvůli osazení na svah)
 * @param {[number,number]|null} front  bod, ke kterému dům "kouká" (náměstí/ulice)
 * @param {boolean} detail  true = hratelná oblast (okna, portál), false = kulisa
 * @param {?[number,number]} through  směr ulice skrz bránu (jednotkový vektor)
 * @returns {?{positions:number[],normals:number[],colors:number[],indices:number[],box:object}}
 */
export function buildHouse(b, ter, front, detail, through) {
  const poly = b.poly
  // těžiště půdorysu = počátek lokální soustavy, osa u leží podél domu
  let mx = 0, mz = 0
  for (const p of poly) { mx += p[0]; mz += p[1] }
  mx /= poly.length; mz /= poly.length
  const ca = Math.cos(b.a), sa = Math.sin(b.a)
  const toLocal = (x, z) => [(x - mx) * ca + (z - mz) * sa, -(x - mx) * sa + (z - mz) * ca]
  const toWorld = (u, v) => [mx + u * ca - v * sa, mz + u * sa + v * ca]

  const lp = poly.map(p => toLocal(p[0], p[1]))
  let minU = 1e9, minV = 1e9, maxU = -1e9, maxV = -1e9
  for (const p of lp) {
    minU = Math.min(minU, p[0]); maxU = Math.max(maxU, p[0])
    minV = Math.min(minV, p[1]); maxV = Math.max(maxV, p[1])
  }
  const nx = Math.ceil((maxU - minU) / VOX) + PAD * 2
  const nz = Math.ceil((maxV - minV) / VOX) + PAD * 2
  const ou = minU - PAD * VOX, ov = minV - PAD * VOX
  const uc = (minU + maxU) / 2, vc = (minV + maxV) / 2

  // ── 1. rastr půdorysu + terén pod ním ──
  const mask = new Uint8Array(nx * nz)
  const gc = new Int16Array(nx * nz)     // terén pod buňkou, v buňkách od y0
  let gMin = 1e9, gMax = -1e9, cells = 0
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const u = ou + (i + 0.5) * VOX, v = ov + (j + 0.5) * VOX
      const [x, z] = toWorld(u, v)
      const gy = ter.groundY(x, z)
      gc[j * nx + i] = gy                 // zatím v metrech, přepočet níž
      if (!inPoly(u, v, lp)) continue
      mask[j * nx + i] = 1
      if (gy < gMin) gMin = gy
      if (gy > gMax) gMax = gy
      cells++
    }
  }
  if (!cells) return null                 // půdorys menší než jedna buňka

  const y0 = gMin - FOOT * VOX
  for (let k = 0; k < gc.length; k++) gc[k] = Math.round((gc[k] - y0) / VOX)

  // podlaha leží na nejvyšším terénu pod domem → dům nikde nezapadá do země
  const floorC = Math.round((gMax - y0) / VOX)
  const levels = b.levels
  const eaveC = floorC + G_CELLS + (levels - 1) * F_CELLS
  const roofC = Math.max(1, Math.round(b.rh / VOX))
  const ny = eaveC + roofC + 4 + (b.special ? Math.round(46 / VOX) : 0)

  const g = new Uint8Array(nx * ny * nz)
  const at = (x, y, z) => x + nx * (z + nz * y)
  const set = (x, y, z, v) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return
    g[at(x, y, z)] = v
  }
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : g[at(x, y, z)]
  const M = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz) ? 0 : mask[j * nx + i]

  // obvodové buňky + směr ven
  const wall = []
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (!M(i, j)) continue
      const e = [M(i - 1, j), M(i + 1, j), M(i, j - 1), M(i, j + 1)]
      if (e[0] && e[1] && e[2] && e[3]) continue
      wall.push({ i, j, dx: (e[0] ? 0 : -1) + (e[1] ? 0 : 1), dz: (e[2] ? 0 : -1) + (e[3] ? 0 : 1) })
    }
  }
  if (!wall.length) return null

  // ── 2. hmota domu ──
  const soklTop = floorC + 2
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (!M(i, j)) continue
      const bottom = Math.max(0, gc[j * nx + i] - FOOT)
      const edge = !(M(i - 1, j) && M(i + 1, j) && M(i, j - 1) && M(i, j + 1))
      for (let y = bottom; y < eaveC; y++) {
        // jádro nikdo neuvidí, ale musí být plné — mesher pak dělá jen plášť
        set(i, y, j, !edge ? B_JADRO : (y <= soklTop ? B_SOKL : B_OMITKA))
      }
    }
  }

  // ── 3. okna, rámy, portál ──
  if (detail) {
    let door = null
    if (front) {
      const [fu, fv] = toLocal(front[0], front[1])
      let best = 1e9
      for (const w of wall) {
        if (!w.dx && !w.dz) continue
        const u = ou + (w.i + 0.5) * VOX, v = ov + (w.j + 0.5) * VOX
        const d = (u - fu) ** 2 + (v - fv) ** 2
        if (d < best) { best = d; door = w }
      }
    }
    for (const w of wall) {
      if (!w.dx && !w.dz) continue
      const u = ou + (w.i + 0.5) * VOX, v = ov + (w.j + 0.5) * VOX
      // souřadnice PODÉL zdi, měřená od středu domu → okna vyjdou symetricky,
      // uprostřed fasády zůstane pilíř a pod ním je místo na portál
      const t = Math.abs(w.dx) >= Math.abs(w.dz) ? v - vc : u - uc
      if ((Math.floor(Math.abs(t) + 0.5) % 2) !== 1) continue

      for (let k = 0; k < levels; k++) {
        const base = floorC + (k === 0 ? 0 : G_CELLS + (k - 1) * F_CELLS)
        const y0w = base + (k === 0 ? 3 : 2)
        const y1w = base + (k === 0 ? 6 : 4)
        if (y1w + 1 >= eaveC) continue
        for (let y = y0w; y <= y1w; y++) set(w.i, y, w.j, B_SKLO)
        set(w.i, y0w - 1, w.j, B_RAM)    // parapet
        set(w.i, y1w + 1, w.j, B_RAM)    // nadpraží
      }
    }
    if (door) {
      const perp = Math.abs(door.dx) >= Math.abs(door.dz) ? [0, 1] : [1, 0]
      for (let s = 0; s <= 1; s++) {
        const i = door.i + perp[0] * s, j = door.j + perp[1] * s
        if (!M(i, j)) continue
        for (let y = floorC; y < floorC + 5; y++) set(i, y, j, B_DVERE)
        set(i, floorC + 5, j, B_RAM)
      }
    }
  }

  // ── 4. římsa ── vystupuje o buňku z líce, dělá stín a dělí zeď od střechy
  for (const w of wall) {
    set(w.i, eaveC, w.j, B_RIMSA)
    if (w.dx) set(w.i + Math.sign(w.dx), eaveC, w.j, B_RIMSA)
    if (w.dz) set(w.i, eaveC, w.j + Math.sign(w.dz), B_RIMSA)
    if (w.dx && w.dz) set(w.i + Math.sign(w.dx), eaveC, w.j + Math.sign(w.dz), B_RIMSA)
  }

  // ── 5. střecha ──
  buildRoof(b, { set, M, nx, nz, ou, ov, uc, vc, eaveC, roofC })

  // ── 5b. věže ──
  if (b.special) {
    buildTower(b, { set, M, nx, nz, ou, ov, uc, vc, floorC, eaveC, ny, levels })
  }

  // ── 5c. průjezd branou ──
  // Brána je budova postavená napříč ulicí. Bez díry by se jí nedalo projít —
  // a protože všechny tři stojí na jediných vstupech do jádra, uzavřela by
  // celé město. Průjezd vede po směru ulice, vysoký 4,5 m a široký 4 m.
  if (b.special === 'gate' && through) {
    const tu = through[0] * ca + through[1] * sa      // směr ulice v soustavě domu
    const tv = -through[0] * sa + through[1] * ca
    const L = Math.hypot(tu, tv) || 1
    const pu = -tv / L, pv = tu / L                   // kolmice na ulici
    const PW = 2.0, PH = Math.round(4.5 / VOX)
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const du = ou + (i + 0.5) * VOX - uc, dv = ov + (j + 0.5) * VOX - vc
        if (Math.abs(du * pu + dv * pv) > PW) continue
        for (let y = floorC; y < floorC + PH; y++) set(i, y, j, 0)
        // ostění průjezdu z kamene
        for (const k of [-1, 1]) {
          const qi = Math.round(i + k * pu * (PW + 0.5) / VOX)
          const qj = Math.round(j + k * pv * (PW + 0.5) / VOX)
          if (get(qi, floorC + 1, qj)) {
            for (let y = floorC; y < floorC + PH; y++) {
              if (get(qi, y, qj)) set(qi, y, qj, B_KAMEN)
            }
          }
        }
      }
    }
  }

  // ── 6. mesh ──
  const wallCol = hexRGB(parseInt(b.wall.slice(1), 16))
  const roofCol = hexRGB(parseInt(b.roofcol.slice(1), 16))
  const colorOf = (id) => {
    switch (id) {
      case B_OMITKA: return wallCol
      case B_JADRO:  return wallCol
      case B_STIT:   return mix(wallCol, [1, 1, 1], 0.1)
      case B_SOKL:   return mix(wallCol, [0.40, 0.38, 0.36], 0.62)
      case B_STRECHA: return roofCol
      case B_HREBEN: return mix(roofCol, [0, 0, 0], 0.2)
      case B_RIMSA:  return mix(wallCol, [1, 1, 1], 0.5)
      default: return hexRGB(blockColor(id))
    }
  }
  const mesh = greedyMesh(get, [nx, ny, nz], {
    scale: VOX, origin: [ou, y0, ov], colorOf, solid: isSolid, noise: 0.026,
  })
  // mesh vznikl v natočené soustavě domu → otočit zpět do světa
  const P = mesh.positions, N = mesh.normals
  for (let k = 0; k < P.length; k += 3) {
    const u = P[k], v = P[k + 2]
    P[k] = mx + u * ca - v * sa
    P[k + 2] = mz + u * sa + v * ca
    const nu = N[k], nv = N[k + 2]
    N[k] = nu * ca - nv * sa
    N[k + 2] = nu * sa + nv * ca
  }
  mesh.floorY = y0 + floorC * VOX
  mesh.eaveY = y0 + eaveC * VOX
  return mesh
}

// ── tvary střech ──────────────────────────────────────────────────────
// Pracuje v natočené soustavě domu: u leží podél hřebene, v napříč. Profil je
// tím pádem po celé délce stejný a schody krytiny se slijí do dlouhých pruhů.
function buildRoof(b, C) {
  const { set, M, nx, nz, ou, ov, uc, vc, eaveC, roofC } = C
  const halfW = Math.max(1.2, b.W / 2), halfL = Math.max(1.2, b.L / 2)

  /** výška střechy nad okapem v buňkách (0 = mimo střechu) */
  const prof = (dl, dd) => {
    let t
    switch (b.roof) {
      case 'flat': return 1
      case 'skillion': t = 0.15 + 0.85 * (dd / (2 * halfW) + 0.5); break
      case 'hipped': t = Math.min(1 - Math.abs(dd) / halfW,
                                  1 - Math.max(0, Math.abs(dl) - (halfL - halfW)) / halfW); break
      case 'pyramidal': t = 1 - Math.max(Math.abs(dd) / halfW, Math.abs(dl) / halfL); break
      default: t = 1 - Math.abs(dd) / halfW    // gable
    }
    return Math.max(0, Math.round(t * roofC))
  }

  const D = (i, j) => M(i, j) || M(i - 1, j) || M(i + 1, j) || M(i, j - 1) || M(i, j + 1)

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (!D(i, j)) continue
      if (b.roof === 'flat') {
        set(i, eaveC + 1, j, B_STRECHA)
        if (!(M(i - 1, j) && M(i + 1, j) && M(i, j - 1) && M(i, j + 1))) set(i, eaveC + 2, j, B_RIMSA)
        continue
      }
      const h = prof(ou + (i + 0.5) * VOX - uc, ov + (j + 0.5) * VOX - vc)
      if (h <= 0) continue
      // štítová zeď: na okraji půdorysu je pod krytinou omítnutý štít, ne taška
      const gableEdge = M(i, j) && !(M(i - 1, j) && M(i + 1, j) && M(i, j - 1) && M(i, j + 1))
      for (let y = 1; y < h; y++) set(i, eaveC + y, j, gableEdge ? B_STIT : B_STRECHA)
      set(i, eaveC + h, j, h >= roofC ? B_HREBEN : B_STRECHA)

      // Renesanční štít domů na náměstí.
      //
      // Měšťanské domy na Masarykově náměstí stojí na hlubokých parcelách,
      // takže hřeben míří od náměstí pryč a do náměstí kouká štítová stěna.
      // Holý trojúhelník krytiny je na ní to nejméně zajímavé; zdivo se proto
      // vytáhne o kus nad střechu a po spádu se odstupňuje římsou. Je to ta
      // zubatá silueta, podle které se náměstí pozná.
      if (b.sq && b.roof === 'gable' && M(i, j)) {
        const out = !M(i - 1, j) ? -1 : (!M(i + 1, j) ? 1 : 0)
        if (out !== 0) {
          set(i, eaveC + h + 1, j, B_STIT)               // atika nad krytinou
          for (let y = 2; y <= h; y++) {
            if (y % 3 !== 0) continue
            set(i, eaveC + y, j, B_RIMSA)
            set(i + out, eaveC + y, j, B_RIMSA)          // odsazený stupeň
          }
        }
      }
    }
  }
}

/**
 * Věž ke kostelu, bráně nebo zámku.
 *
 * Postaví se dovnitř půdorysu na jeho konec (u kostela na konec lodi, u brány
 * doprostřed) a probourá střechu nad sebou. Bez věží má jádro siluetu jako
 * každé jiné město — teprve ony z toho udělají Pelhřimov, který je poznat
 * z dálky.
 */
function buildTower(b, C) {
  const { set, M, nx, nz, ou, ov, uc, vc, floorC, eaveC, ny } = C
  const SPEC = {
    church: { side: 5.0, h: 34, roof: 'spire', end: true },
    gate:   { side: 7.0, h: 17, roof: 'hip', end: false },
    castle: { side: 5.0, h: 20, roof: 'hip', end: true },
  }
  const sp = SPEC[b.special]
  if (!sp) return
  const half = Math.round(sp.side / 2 / VOX)

  // střed věže: u kostela na konci lodi, jinak v těžišti půdorysu
  let ci = 0, cj = 0
  if (sp.end) {
    // projdi podél osy u od kraje a vezmi první místo, kam se věž vejde celá
    const iC = Math.round((uc - ou) / VOX), jC = Math.round((vc - ov) / VOX)
    let found = false
    for (let d = 0; d < nx && !found; d++) {
      for (const i of [half + d, nx - 1 - half - d]) {
        if (i < half || i >= nx - half) continue
        if (fits(M, i, jC, half)) { ci = i; cj = jC; found = true; break }
      }
    }
    if (!found) return
  } else {
    ci = Math.round((uc - ou) / VOX); cj = Math.round((vc - ov) / VOX)
    if (!fits(M, ci, cj, half)) return
  }

  const topC = Math.min(ny - 14, floorC + Math.round(sp.h / VOX))
  if (topC <= eaveC + 2) return

  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      const edge = Math.abs(i) === half || Math.abs(j) === half
      for (let y = floorC; y < topC; y++) {
        set(ci + i, y, cj + j, edge ? B_OMITKA : B_JADRO)
      }
      // zvonicové okno na každé straně těsně pod římsou
      if (edge && (Math.abs(i) < half - 1 || Math.abs(j) < half - 1)) {
        for (let y = topC - 6; y < topC - 2; y++) set(ci + i, y, cj + j, B_SKLO)
      }
    }
  }
  // římsa věže
  for (let j = -half - 1; j <= half + 1; j++) {
    for (let i = -half - 1; i <= half + 1; i++) set(ci + i, topC, cj + j, B_RIMSA)
  }

  if (sp.roof === 'spire') {
    // štíhlá jehla: čtverec se zmenšuje po vrstvách, nahoře makovice
    const H = half * 5
    for (let y = 1; y <= H; y++) {
      const r = Math.max(0, Math.round(half * (1 - y / H)))
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        set(ci + i, topC + y, cj + j, B_PLECH)
      }
    }
    set(ci, topC + H + 1, cj, B_RIMSA)
    set(ci, topC + H + 2, cj, B_RIMSA)
  } else {
    const H = half + 2
    for (let y = 1; y <= H; y++) {
      const r = Math.max(0, half - Math.round((y / H) * half))
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        set(ci + i, topC + y, cj + j, B_STRECHA)
      }
    }
  }
}

function fits(M, i, j, half) {
  for (let b = -half; b <= half; b++) for (let a = -half; a <= half; a++) {
    if (!M(i + a, j + b)) return false
  }
  return true
}

export function inPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
