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
const B_MEDENKA = 22
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
  const ny = eaveC + roofC + 4 + (b.tower ? Math.round((b.tower.h + b.tower.side * 5 + 6) / VOX) : 0)

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

  // ── 3b. podloubí ──
  let collidePoly = poly
  if (b.arcade && front) {
    const clipped = carveArcade(b, {
      set, get, M, nx, nz, ou, ov, uc, vc, floorC,
      front: toLocal(front[0], front[1]), toWorld, lp,
    })
    if (clipped) collidePoly = clipped
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
  if (b.tower) {
    buildTower(b, { set, M, nx, nz, ou, ov, uc, vc, floorC, eaveC, ny })
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
  // Do podloubí se musí dát vejít, takže kolizní obrys je o jeho hloubku menší.
  mesh.collide = collidePoly
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

    }
  }

  // ── štíty domů na náměstí: samostatný průchod ──
  //
  // Musí běžet AŽ PO celé střeše. Když se štít stavěl uvnitř téže smyčky,
  // přepsal ho pak roofovací zápis sousední buňky a výsledek závisel na tom,
  // kterým směrem štít kouká — polovina domů měla místo omítnutého štítu
  // oranžový trojúhelník krytiny.
  if (b.sq && b.roof === 'gable') {
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        if (!M(i, j)) continue
        const out = !M(i - 1, j) ? -1 : (!M(i + 1, j) ? 1 : 0)
        if (out === 0) continue
        const h = prof(ou + (i + 0.5) * VOX - uc, ov + (j + 0.5) * VOX - vc)
        if (h <= 2) continue
        const hs = Math.max(1, 3 * Math.floor(h / 3))   // schod pod vrcholem
        // Zeď se staví i o buňku PŘED líc: střecha má přes půdorys buňku
        // přesahu a bez toho by štít překryla.
        for (let y = 1; y <= hs; y++) {
          set(i, eaveC + y, j, B_STIT)
          set(i + out, eaveC + y, j, B_STIT)
        }
        set(i, eaveC + hs + 1, j, B_RIMSA)              // krycí deska schodu
        set(i + out, eaveC + hs + 1, j, B_RIMSA)
      }
    }
  }
}

// ── podloubí ──────────────────────────────────────────────────────────
const ARC_DEPTH = 6     // 3,0 m — hloubka podloubí
const ARC_TOP = 7       // 3,5 m — vrchol oblouku (přízemí má 4 m)
const ARC_SPAN = 8      // rozteč pilířů, 4 m
const ARC_PIER = 2      // šířka pilíře, 1 m

/**
 * Vykrojí do přízemí podloubí a vrátí zmenšený půdorys pro kolize.
 *
 * Podloubí je na Masarykově náměstí to nejnápadnější — kamenné sloupy nesou
 * půlkruhové oblouky a za nimi je krytý chodník s obchody. Dělá se skutečným
 * odebráním hmoty, ne nalepenou fasádou, takže se pod ním dá projít; proto se
 * musí zmenšit i kolizní obrys, jinak by hráč narazil do něčeho, co vidí jako
 * průchod.
 *
 * @returns {?Array} zmenšený půdorys ve světových souřadnicích
 */
function carveArcade(b, C) {
  const { set, get, M, nx, nz, ou, ov, uc, vc, floorC, front, toWorld, lp } = C

  // Která strana domu kouká na náměstí: ta, jejíž vnější směr míří k `front`.
  const du = front[0] - uc, dv = front[1] - vc
  const alongU = Math.abs(du) < Math.abs(dv)     // fasáda kolmá na v?
  const sign = (alongU ? dv : du) > 0 ? 1 : -1

  // Pro každou linii kolmou k fasádě najdi krajní buňku a zakroj dovnitř.
  const outer = new Int16Array(alongU ? nx : nz).fill(-1)
  const N1 = alongU ? nx : nz, N2 = alongU ? nz : nx
  const cell = (a, bIdx) => alongU ? M(a, bIdx) : M(bIdx, a)
  const put = (a, y, bIdx, v) => alongU ? set(a, y, bIdx, v) : set(bIdx, y, a, v)
  for (let a = 0; a < N1; a++) {
    for (let k = 0; k < N2; k++) {
      const bIdx = sign > 0 ? N2 - 1 - k : k
      if (cell(a, bIdx)) { outer[a] = bIdx; break }
    }
  }

  // střed fasády v buňkách, aby oblouky vyšly symetricky
  const centre = Math.round(((alongU ? uc - ou : vc - ov)) / VOX)
  let carved = 0
  for (let a = 0; a < N1; a++) {
    const o = outer[a]
    if (o < 0) continue
    // je dům v téhle linii dost hluboký?
    let depth = 0
    for (let d = 0; d < ARC_DEPTH + 2; d++) {
      if (!cell(a, o - sign * d)) break
      depth++
    }
    if (depth <= ARC_DEPTH) continue

    const t = ((a - centre) % ARC_SPAN + ARC_SPAN + ARC_SPAN / 2) % ARC_SPAN - ARC_SPAN / 2
    const pier = Math.abs(t) > (ARC_SPAN - ARC_PIER) / 2

    for (let d = 0; d < ARC_DEPTH; d++) {
      const bIdx = o - sign * d
      for (let y = floorC + 1; y <= floorC + ARC_TOP; y++) put(a, y, bIdx, 0)
      put(a, floorC, bIdx, 8)          // dlažba pod podloubím
    }
    carved++

    if (pier) {
      // kamenný sloup v líci fasády
      for (let y = floorC + 1; y <= floorC + ARC_TOP; y++) put(a, y, o, B_KAMEN)
    } else {
      // Půlkruhový oblouk. Bílý je jen samotný klenební pás (dvě buňky),
      // plocha nad ním zůstává v barvě fasády — přesně tak to na náměstí
      // vypadá a teprve tím je oblouk na dálku poznat. Vyplnit celé pole
      // bílou znamenalo, že otvor vypadal hranatě.
      const R = (ARC_SPAN - ARC_PIER) / 2
      const rise = Math.round(Math.sqrt(Math.max(0, R * R - t * t)))
      const yArch = floorC + ARC_TOP - R + rise
      for (let y = yArch; y <= floorC + ARC_TOP; y++) {
        put(a, y, o, y <= yArch + 1 ? B_RIMSA : B_OMITKA)
      }
      // výkladec v zadní stěně podloubí
      const back = o - sign * ARC_DEPTH
      if (cell(a, back)) {
        const isDoor = Math.abs(t) < 1
        for (let y = floorC + 1; y <= floorC + 5; y++) {
          if (isDoor || y >= floorC + 2) put(a, y, back, isDoor ? B_DVERE : B_SKLO)
        }
      }
    }
  }
  if (carved < 3) return null

  // ── zmenšený půdorys pro kolize ──
  // Ořízneme mnohoúhelník polorovinou posunutou o hloubku podloubí dovnitř.
  const axis = alongU ? 1 : 0
  let lim = sign > 0 ? -1e9 : 1e9
  for (const p of lp) lim = sign > 0 ? Math.max(lim, p[axis]) : Math.min(lim, p[axis])
  lim -= sign * ARC_DEPTH * VOX
  const inside = (p) => sign > 0 ? p[axis] <= lim : p[axis] >= lim
  const out = []
  for (let i = 0; i < lp.length; i++) {
    const a = lp[i], c = lp[(i + 1) % lp.length]
    const ia = inside(a), ic = inside(c)
    if (ia) out.push(a)
    if (ia !== ic) {
      const t2 = (lim - a[axis]) / (c[axis] - a[axis])
      const cut = [a[0] + (c[0] - a[0]) * t2, a[1] + (c[1] - a[1]) * t2]
      out.push(cut)
    }
  }
  if (out.length < 3) return null
  return out.map(p => toWorld(p[0], p[1]))
}

/**
 * Věž ke kostelu nebo bráně.
 *
 * Rozměry NEODHADUJE — bere je z dat (`b.tower`), kde jsou odečtené z fotek
 * konkrétní stavby. Paušální odhad tu byl dřív a dělal ze Solní brány
 * sedmnáctimetrovou věž, ačkoli je to nízký patrový domek; teď žádnou
 * nedostane, protože ji v datech nemá.
 *
 * Věž se postaví dovnitř půdorysu (u kostela na konec lodi, u brány doprostřed)
 * a probourá střechu nad sebou.
 */
function buildTower(b, C) {
  const { set, M, nx, nz, ou, ov, uc, vc, floorC, eaveC, ny } = C
  const T = b.tower
  const atEnd = b.special === 'church'
  const iC = Math.round((uc - ou) / VOX), jC = Math.round((vc - ov) / VOX)

  // Požadovanou stranu zmenšujeme, dokud se čtverec do půdorysu nevejde.
  // Dolní brána má půdorys 10,9 × 10,9 m, ale obrys není přesně v mřížce —
  // bez tohoto ústupku se devítimetrová věž nevešla a brána zůstala bez ní.
  let half = 0, ci = 0, cj = 0
  for (let h = Math.max(2, Math.round(T.side / 2 / VOX)); h >= 4; h--) {
    if (atEnd) {
      let found = false
      for (let d = 0; d < nx && !found; d++) {
        for (const i of [h + d, nx - 1 - h - d]) {
          if (i < h || i >= nx - h) continue
          if (fits(M, i, jC, h)) { half = h; ci = i; cj = jC; found = true; break }
        }
      }
      if (found) break
    } else if (fits(M, iC, jC, h)) {
      half = h; ci = iC; cj = jC; break
    }
  }
  if (!half) return

  const topC = Math.min(ny - Math.round(30 / VOX), floorC + Math.round(T.h / VOX))
  if (topC <= eaveC + 2) return

  for (let j = -half; j <= half; j++) {
    for (let i = -half; i <= half; i++) {
      const edge = Math.abs(i) === half || Math.abs(j) === half
      for (let y = floorC; y < topC; y++) set(ci + i, y, cj + j, edge ? B_OMITKA : B_JADRO)
      // střílny a okna po výšce dříku, nahoře ciferník hodin
      if (edge && (Math.abs(i) < half - 1 || Math.abs(j) < half - 1)) {
        for (let y = floorC + 8; y < topC - 4; y += 8) { set(ci + i, y, cj + j, B_SKLO) }
        for (let y = topC - 4; y < topC - 1; y++) set(ci + i, y, cj + j, B_SKLO)
      }
    }
  }
  for (let j = -half - 1; j <= half + 1; j++) {
    for (let i = -half - 1; i <= half + 1; i++) set(ci + i, topC, cj + j, B_RIMSA)
  }

  // ── střecha věže ──
  const H = T.roof === 'spire' ? Math.round(half * 4.8)
          : T.roof === 'steep' ? Math.round(half * 2.2)
          : Math.round(half * 1.6)
  for (let y = 1; y <= H; y++) {
    const r = Math.max(0, Math.round(half * (1 - y / (H + 1))))
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      set(ci + i, topC + y, cj + j, T.roof === 'spire' ? B_PLECH : B_STRECHA)
    }
  }

  // ── měděná lucerna na hřebeni ──
  // Zelená měděnka nahoře je to, podle čeho se věž pozná přes celé město.
  const LH = Math.round((T.lantern || 0) / VOX)
  let y = topC + H + 1
  for (let k = 0; k < LH; k++, y++) {
    const r = k < LH * 0.45 ? 1 : 0
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) set(ci + i, y, cj + j, B_MEDENKA)
  }
  if (LH) set(ci, y, cj, B_MEDENKA)
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
